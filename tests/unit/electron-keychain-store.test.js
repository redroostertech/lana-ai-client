'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  KeychainSecretStore,
  KeychainEncryptionUnavailableError,
} = require('../../electron-keychain-store');

// Injectable fake safeStorage. Ciphertext is tagged with an "epoch" so a second
// instance with a different epoch simulates a rotated / migrated OS keychain that
// can no longer decrypt what the first one wrote.
function makeFakeSafe(epoch = 'A', available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from(`${epoch}::${s}`, 'utf8'),
    decryptString: (buf) => {
      const str = buf.toString('utf8');
      const sep = str.indexOf('::');
      if (sep < 0 || str.slice(0, sep) !== epoch) {
        throw new Error('safeStorage: cannot decrypt (wrong keychain)');
      }
      return str.slice(sep + 2);
    },
  };
}

let tmpRoot;
beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lana-keychain-'));
});
afterEach(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) {}
});

function newStore(opts = {}) {
  return new KeychainSecretStore({
    userDataRoot: tmpRoot,
    fileName: 'stack-secrets.enc.json',
    ...opts,
  });
}

describe('KeychainSecretStore', () => {
  it('round-trips values and persists them across instances (same keychain)', async () => {
    const s1 = newStore({ safeStorage: makeFakeSafe('A') });
    expect(s1.persistent).toBe(true);
    await s1.set('FILE_ENCRYPTION_KEY', 'file-key-value');
    await s1.set('POSTGRES_PASSWORD', 'pg-pw');

    const s2 = newStore({ safeStorage: makeFakeSafe('A') });
    expect(await s2.get('FILE_ENCRYPTION_KEY')).toBe('file-key-value');
    expect(await s2.get('POSTGRES_PASSWORD')).toBe('pg-pw');
    expect(s2.isSealed()).toBe(false);
    expect(s2.encryptionFault).toBeNull();
  });

  it('defaults its protected set to the secret-manager encryption-class keys', async () => {
    // No protectedKeys passed → FILE_ENCRYPTION_KEY should be protected by default.
    const writer = newStore({ safeStorage: makeFakeSafe('A') });
    await writer.set('FILE_ENCRYPTION_KEY', 'v');

    const reader = newStore({ safeStorage: makeFakeSafe('B') }); // rotated keychain
    expect(reader.isSealed()).toBe(true);
    expect(reader.encryptionFault.keys).toContain('FILE_ENCRYPTION_KEY');
  });

  it('FAILS LOUD on an undecryptable protected key (rotated keychain)', async () => {
    const writer = newStore({
      safeStorage: makeFakeSafe('A'),
      protectedKeys: ['FILE_ENCRYPTION_KEY'],
    });
    await writer.set('FILE_ENCRYPTION_KEY', 'the-real-key');

    const errLogs = [];
    const reader = newStore({
      safeStorage: makeFakeSafe('B'),
      protectedKeys: ['FILE_ENCRYPTION_KEY'],
      logger: { info() {}, warn() {}, error: (m, meta) => errLogs.push({ m, meta }) },
    });

    // Fault is recorded + logged at ERROR level (never a silent WARN/drop).
    expect(reader.isSealed()).toBe(true);
    expect(reader.encryptionFault).toEqual({
      keys: ['FILE_ENCRYPTION_KEY'],
      reason: 'decrypt_failed',
    });
    expect(errLogs.some((e) => e.m === 'secret_store.encryption_key_unavailable')).toBe(true);

    // get() throws the distinct, catchable error rather than returning null
    // (returning null is what would let SecretManager regenerate + orphan data).
    await expect(reader.get('FILE_ENCRYPTION_KEY')).rejects.toBeInstanceOf(
      KeychainEncryptionUnavailableError
    );
    await expect(reader.get('FILE_ENCRYPTION_KEY')).rejects.toMatchObject({
      code: 'ENCRYPTION_KEY_UNAVAILABLE',
    });

    // assertReadable surfaces the same blocking state up front.
    expect(() => reader.assertReadable()).toThrow(/encryption key unavailable/);
  });

  it('drops (does NOT fault on) an undecryptable NON-protected credential', async () => {
    const writer = newStore({
      safeStorage: makeFakeSafe('A'),
      protectedKeys: ['FILE_ENCRYPTION_KEY'],
    });
    await writer.set('POSTGRES_PASSWORD', 'pg-pw'); // credential-class, recoverable

    const reader = newStore({
      safeStorage: makeFakeSafe('B'),
      protectedKeys: ['FILE_ENCRYPTION_KEY'],
    });
    expect(reader.isSealed()).toBe(false);
    expect(await reader.get('POSTGRES_PASSWORD')).toBeNull(); // dropped → regenerable
  });

  it('blocks set() and get() on a faulted key (no silent re-key)', async () => {
    const writer = newStore({ safeStorage: makeFakeSafe('A'), protectedKeys: ['JWT_SECRET'] });
    await writer.set('JWT_SECRET', 'session-key');

    const reader = newStore({ safeStorage: makeFakeSafe('B'), protectedKeys: ['JWT_SECRET'] });
    await expect(reader.set('JWT_SECRET', 'a-fresh-regenerated-key')).rejects.toMatchObject({
      code: 'ENCRYPTION_KEY_UNAVAILABLE',
    });
  });

  it('restore-mode set() overwrites a faulted key in place and clears the fault', async () => {
    const writer = newStore({ safeStorage: makeFakeSafe('A'), protectedKeys: ['JWT_SECRET'] });
    await writer.set('JWT_SECRET', 'original');

    // New keychain epoch → the key is undecryptable → sealed fault.
    const reader = newStore({ safeStorage: makeFakeSafe('B'), protectedKeys: ['JWT_SECRET'] });
    expect(reader.isSealed()).toBe(true);

    // A plain set() is still blocked (guards silent re-key)...
    await expect(reader.set('JWT_SECRET', 'sneaky')).rejects.toMatchObject({
      code: 'ENCRYPTION_KEY_UNAVAILABLE',
    });

    // ...but an explicit restore-mode set() is allowed: no delete-first, fault clears,
    // value is readable, and it persists (re-encrypted under the current epoch B).
    await reader.set('JWT_SECRET', 'restored-real-value', { restore: true });
    expect(reader.isSealed()).toBe(false);
    expect(reader.encryptionFault).toBeNull();
    expect(await reader.get('JWT_SECRET')).toBe('restored-real-value');

    const rereader = newStore({ safeStorage: makeFakeSafe('B'), protectedKeys: ['JWT_SECRET'] });
    expect(rereader.isSealed()).toBe(false);
    expect(await rereader.get('JWT_SECRET')).toBe('restored-real-value');
  });

  it('clears the fault for a key once it is deleted', async () => {
    const writer = newStore({ safeStorage: makeFakeSafe('A'), protectedKeys: ['JWT_SECRET'] });
    await writer.set('JWT_SECRET', 'x');
    const reader = newStore({ safeStorage: makeFakeSafe('B'), protectedKeys: ['JWT_SECRET'] });
    expect(reader.isSealed()).toBe(true);
    await reader.delete('JWT_SECRET');
    expect(reader.isSealed()).toBe(false);
    expect(await reader.get('JWT_SECRET')).toBeNull();
  });

  it('opts out of protection when protectedKeys is []', async () => {
    const writer = newStore({ safeStorage: makeFakeSafe('A'), protectedKeys: [] });
    await writer.set('FILE_ENCRYPTION_KEY', 'v');
    const reader = newStore({ safeStorage: makeFakeSafe('B'), protectedKeys: [] });
    expect(reader.isSealed()).toBe(false); // dropped like the original behavior
    expect(await reader.get('FILE_ENCRYPTION_KEY')).toBeNull();
  });

  describe('in-memory fallback (safeStorage unavailable)', () => {
    it('faults when a protected key is already present on disk (would-be silent regen)', async () => {
      // First launch with encryption available writes a protected key to disk.
      const writer = newStore({ safeStorage: makeFakeSafe('A'), protectedKeys: ['FILE_ENCRYPTION_KEY'] });
      await writer.set('FILE_ENCRYPTION_KEY', 'v');

      // Next launch: encryption unavailable → cannot decrypt, but the plaintext
      // JSON key name reveals the protected key is present → must fault, not regen.
      const reader = newStore({
        safeStorage: makeFakeSafe('A', false),
        protectedKeys: ['FILE_ENCRYPTION_KEY'],
      });
      expect(reader.persistent).toBe(false);
      expect(reader.encryptionFault).toEqual({
        keys: ['FILE_ENCRYPTION_KEY'],
        reason: 'safe_storage_unavailable',
      });
      await expect(reader.get('FILE_ENCRYPTION_KEY')).rejects.toMatchObject({
        code: 'ENCRYPTION_KEY_UNAVAILABLE',
      });
    });

    it('does not fault on a fresh machine with no prior data (headless CI)', async () => {
      const store = newStore({
        safeStorage: makeFakeSafe('A', false),
        protectedKeys: ['FILE_ENCRYPTION_KEY'],
      });
      expect(store.persistent).toBe(false);
      expect(store.isSealed()).toBe(false);
      // Behaves as a per-process in-memory store.
      await store.set('FILE_ENCRYPTION_KEY', 'ephemeral');
      expect(await store.get('FILE_ENCRYPTION_KEY')).toBe('ephemeral');
    });
  });

  it('requires userDataRoot', () => {
    expect(() => new KeychainSecretStore({})).toThrow(/userDataRoot is required/);
  });
});
