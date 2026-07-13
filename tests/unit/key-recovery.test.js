'use strict';

const {
  exportRecoveryBundle,
  importRecoveryBundle,
  restoreInto,
  serializeBundle,
  parseBundle,
  RecoveryBundleError,
  RecoveryPassphraseError,
  FORMAT,
} = require('../../supervisor/key-recovery');
const { ENCRYPTION_CLASS_KEYS } = require('../../supervisor/secret-manager');

// A full secret map (encryption-class + credential-class) to export from.
function fullSecrets() {
  const s = {
    POSTGRES_PASSWORD: 'pg-pw',
    MINIO_ACCESS_KEY: 'lanaabcd',
    MINIO_SECRET_KEY: 'minio-secret',
  };
  for (const k of ENCRYPTION_CLASS_KEYS) s[k] = `${k}-value`;
  return s;
}

const PASS = 'correct horse battery staple';

describe('key-recovery', () => {
  it('exports only the encryption-class keys and round-trips them', () => {
    const bundle = exportRecoveryBundle(fullSecrets(), PASS);
    expect(bundle.format).toBe(FORMAT);
    expect([...bundle.keyNames].sort()).toEqual([...ENCRYPTION_CLASS_KEYS].sort());

    const restored = importRecoveryBundle(bundle, PASS);
    for (const k of ENCRYPTION_CLASS_KEYS) expect(restored[k]).toBe(`${k}-value`);
    // Credential-class secrets are intentionally NOT in the bundle.
    expect(restored.POSTGRES_PASSWORD).toBeUndefined();
    expect(restored.MINIO_SECRET_KEY).toBeUndefined();
  });

  it('never leaks a secret value into the plaintext envelope', () => {
    const bundle = exportRecoveryBundle(fullSecrets(), PASS);
    const text = serializeBundle(bundle);
    for (const k of ENCRYPTION_CLASS_KEYS) {
      expect(text).not.toContain(`${k}-value`); // values only exist inside ciphertext
    }
  });

  it('rejects a wrong passphrase with RecoveryPassphraseError', () => {
    const bundle = exportRecoveryBundle(fullSecrets(), PASS);
    expect(() => importRecoveryBundle(bundle, 'wrong passphrase!!')).toThrow(RecoveryPassphraseError);
    try {
      importRecoveryBundle(bundle, 'wrong passphrase!!');
    } catch (e) {
      expect(e.code).toBe('RECOVERY_PASSPHRASE_INVALID');
    }
  });

  it('rejects tampered ciphertext (GCM auth failure)', () => {
    const bundle = exportRecoveryBundle(fullSecrets(), PASS);
    const buf = Buffer.from(bundle.cipher.ciphertext, 'base64');
    buf[0] ^= 0xff;
    bundle.cipher.ciphertext = buf.toString('base64');
    expect(() => importRecoveryBundle(bundle, PASS)).toThrow(RecoveryPassphraseError);
  });

  it('rejects a short passphrase on export', () => {
    expect(() => exportRecoveryBundle(fullSecrets(), 'short')).toThrow(RecoveryBundleError);
  });

  it('rejects exporting when there are no encryption-class secrets', () => {
    expect(() => exportRecoveryBundle({ POSTGRES_PASSWORD: 'x' }, PASS)).toThrow(RecoveryBundleError);
  });

  it('serialize/parse survives a round-trip and validates format', () => {
    const bundle = exportRecoveryBundle(fullSecrets(), PASS);
    const parsed = parseBundle(serializeBundle(bundle));
    expect(importRecoveryBundle(parsed, PASS)[ENCRYPTION_CLASS_KEYS[0]]).toBe(
      `${ENCRYPTION_CLASS_KEYS[0]}-value`
    );
  });

  it('rejects a malformed / foreign bundle', () => {
    expect(() => importRecoveryBundle({ format: 'nope' }, PASS)).toThrow(RecoveryBundleError);
    expect(() => parseBundle('{not json')).toThrow(RecoveryBundleError);
    expect(() => importRecoveryBundle(null, PASS)).toThrow(RecoveryBundleError);
  });

  describe('hostile-bundle hardening', () => {
    it('rejects a non-32 keylen as RecoveryBundleError', () => {
      const bundle = exportRecoveryBundle(fullSecrets(), PASS);
      bundle.kdf.keylen = 16;
      expect(() => importRecoveryBundle(bundle, PASS)).toThrow(RecoveryBundleError);
    });

    it('rejects a wrong-length IV as RecoveryBundleError', () => {
      const bundle = exportRecoveryBundle(fullSecrets(), PASS);
      bundle.cipher.iv = Buffer.alloc(8).toString('base64'); // 8 != 12
      expect(() => importRecoveryBundle(bundle, PASS)).toThrow(RecoveryBundleError);
    });

    it('rejects a wrong-length auth tag as RecoveryBundleError', () => {
      const bundle = exportRecoveryBundle(fullSecrets(), PASS);
      bundle.cipher.authTag = Buffer.alloc(8).toString('base64'); // 8 != 16
      expect(() => importRecoveryBundle(bundle, PASS)).toThrow(RecoveryBundleError);
    });

    it('rejects a wrong-length salt as RecoveryBundleError', () => {
      const bundle = exportRecoveryBundle(fullSecrets(), PASS);
      bundle.kdf.salt = Buffer.alloc(4).toString('base64'); // 4 != 16
      expect(() => importRecoveryBundle(bundle, PASS)).toThrow(RecoveryBundleError);
    });

    it('clamps an absurd scrypt N so import stays bounded and fast', () => {
      // A hostile bundle sets N enormous to force a huge scrypt allocation. We clamp
      // N/r/p, so the derive is bounded; the tampered KDF then fails GCM auth. The
      // key assertion is that this returns quickly (clamped) rather than allocating
      // gigabytes / hanging.
      const bundle = exportRecoveryBundle(fullSecrets(), PASS);
      bundle.kdf.N = 1 << 30; // way past the clamp ceiling
      const started = Date.now();
      expect(() => importRecoveryBundle(bundle, PASS)).toThrow(RecoveryPassphraseError);
      expect(Date.now() - started).toBeLessThan(5000);
    });

    it('a correct passphrase still round-trips (clamp is a no-op for a good bundle)', () => {
      const bundle = exportRecoveryBundle(fullSecrets(), PASS);
      const restored = importRecoveryBundle(bundle, PASS);
      expect(restored.FILE_ENCRYPTION_KEY).toBe('FILE_ENCRYPTION_KEY-value');
    });
  });

  describe('restoreInto', () => {
    function makeStore(seed = {}) {
      const m = new Map(Object.entries(seed));
      return {
        m,
        get: async (k) => (m.has(k) ? m.get(k) : null),
        set: async (k, v) => { m.set(k, v); },
        delete: async (k) => { m.delete(k); },
      };
    }

    it('restores keys into an empty store', async () => {
      const bundle = exportRecoveryBundle(fullSecrets(), PASS);
      const store = makeStore();
      const res = await restoreInto(store, bundle, PASS);
      expect([...res.restored].sort()).toEqual([...ENCRYPTION_CLASS_KEYS].sort());
      expect(res.skipped).toEqual([]);
      expect(store.m.get('FILE_ENCRYPTION_KEY')).toBe('FILE_ENCRYPTION_KEY-value');
    });

    it('does not clobber existing readable keys unless overwrite is set', async () => {
      const bundle = exportRecoveryBundle(fullSecrets(), PASS);
      const store = makeStore({ FILE_ENCRYPTION_KEY: 'existing-good' });
      const res = await restoreInto(store, bundle, PASS);
      expect(res.skipped).toContain('FILE_ENCRYPTION_KEY');
      expect(store.m.get('FILE_ENCRYPTION_KEY')).toBe('existing-good');

      const res2 = await restoreInto(store, bundle, PASS, { overwrite: true });
      expect(res2.restored).toContain('FILE_ENCRYPTION_KEY');
      expect(store.m.get('FILE_ENCRYPTION_KEY')).toBe('FILE_ENCRYPTION_KEY-value');
    });

    it('restores a SEALED key atomically via restore-mode set (no delete-first)', async () => {
      const bundle = exportRecoveryBundle(fullSecrets(), PASS);
      const deleted = [];
      const setCalls = [];
      // Store that is faulted on FILE_ENCRYPTION_KEY: get() throws the guard error.
      const store = {
        get: async (k) => {
          if (k === 'FILE_ENCRYPTION_KEY') {
            throw Object.assign(new Error('sealed'), { code: 'ENCRYPTION_KEY_UNAVAILABLE' });
          }
          return null;
        },
        set: async (k, v, opts) => { setCalls.push({ k, v, opts }); },
        delete: async (k) => { deleted.push(k); },
      };
      const res = await restoreInto(store, bundle, PASS);
      expect(res.restored).toContain('FILE_ENCRYPTION_KEY');
      // Atomic: the key is written with the restore flag, and delete() is NEVER
      // called (no window where the key is absent from the store).
      expect(deleted).toEqual([]);
      const fileSet = setCalls.find((c) => c.k === 'FILE_ENCRYPTION_KEY');
      expect(fileSet).toBeTruthy();
      expect(fileSet.v).toBe('FILE_ENCRYPTION_KEY-value');
      expect(fileSet.opts).toEqual({ restore: true });
    });

    it('propagates a non-guard store error', async () => {
      const bundle = exportRecoveryBundle(fullSecrets(), PASS);
      const store = {
        get: async () => { throw new Error('disk on fire'); },
        set: async () => {},
      };
      await expect(restoreInto(store, bundle, PASS)).rejects.toThrow(/disk on fire/);
    });
  });
});
