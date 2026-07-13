'use strict';

const {
  SecretManager,
  SECRET_KEYS,
  ENCRYPTION_CLASS_KEYS,
  CREDENTIAL_KEYS,
  isEncryptionClassKey,
} = require('../../supervisor/secret-manager');

// In-memory async store standing in for KeychainSecretStore.
function makeMemStore(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    m,
    get: async (k) => (m.has(k) ? m.get(k) : null),
    set: async (k, v) => { m.set(k, v); },
  };
}

describe('SecretManager', () => {
  it('generates all required secrets with non-empty values', async () => {
    const store = makeMemStore();
    const secrets = await new SecretManager({ store }).ensureSecrets();
    for (const key of SECRET_KEYS) {
      expect(typeof secrets[key]).toBe('string');
      expect(secrets[key].length).toBeGreaterThan(8);
    }
    // crypto keys are 32-byte hex
    expect(secrets.JWT_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(secrets.MFA_ENCRYPTION_KEY).toMatch(/^[0-9a-f]{64}$/);
    expect(secrets.WEBHOOK_SECRET_ENCRYPTION_KEY).toMatch(/^[0-9a-f]{64}$/);
    expect(secrets.MINIO_ACCESS_KEY.startsWith('lana')).toBe(true);
  });

  it('is stable across calls (same instance)', async () => {
    const store = makeMemStore();
    const mgr = new SecretManager({ store });
    const a = await mgr.ensureSecrets();
    const b = await mgr.ensureSecrets();
    expect(b).toEqual(a);
  });

  it('is stable across "launches" (new instance, same store)', async () => {
    const store = makeMemStore();
    const first = await new SecretManager({ store }).ensureSecrets();
    const second = await new SecretManager({ store }).ensureSecrets();
    // A fresh JWT_SECRET would kill the user's local session — must be identical.
    expect(second.JWT_SECRET).toBe(first.JWT_SECRET);
    expect(second).toEqual(first);
  });

  it('preserves a pre-existing value instead of regenerating', async () => {
    const store = makeMemStore({ JWT_SECRET: 'pre-existing-stable-secret' });
    const secrets = await new SecretManager({ store }).ensureSecrets();
    expect(secrets.JWT_SECRET).toBe('pre-existing-stable-secret');
  });

  it('rejects a store without get/set', () => {
    expect(() => new SecretManager({ store: {} })).toThrow(/store with async get\/set/);
  });

  describe('secret taxonomy', () => {
    it('classifies the six data/session-losing keys as encryption-class', () => {
      const expected = [
        'JWT_SECRET',
        'MFA_ENCRYPTION_KEY',
        'WEBHOOK_SECRET_ENCRYPTION_KEY',
        'FILE_ENCRYPTION_KEY',
        'CONNECTOR_ENCRYPTION_KEY',
        'INTERNAL_SERVICE_SECRET',
      ];
      expect([...ENCRYPTION_CLASS_KEYS].sort()).toEqual([...expected].sort());
      for (const k of expected) expect(isEncryptionClassKey(k)).toBe(true);
    });

    it('classifies the datastore credentials as recoverable credential-class', () => {
      expect([...CREDENTIAL_KEYS].sort()).toEqual(
        ['POSTGRES_PASSWORD', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY'].sort()
      );
      for (const k of CREDENTIAL_KEYS) expect(isEncryptionClassKey(k)).toBe(false);
    });

    it('every spec is exactly one class and the two sets partition SECRET_KEYS', () => {
      expect(ENCRYPTION_CLASS_KEYS.length + CREDENTIAL_KEYS.length).toBe(SECRET_KEYS.length);
      const union = new Set([...ENCRYPTION_CLASS_KEYS, ...CREDENTIAL_KEYS]);
      expect(union.size).toBe(SECRET_KEYS.length);
    });
  });

  describe('loud-fail contract (P1)', () => {
    it('propagates a store get() throw instead of regenerating a lost protected key', async () => {
      const err = Object.assign(new Error('encryption key unavailable'), {
        code: 'ENCRYPTION_KEY_UNAVAILABLE',
        keys: ['FILE_ENCRYPTION_KEY'],
      });
      const store = {
        get: async (k) => { if (k === 'FILE_ENCRYPTION_KEY') throw err; return null; },
        set: async () => {},
      };
      const setSpy = jest.spyOn(store, 'set');
      await expect(new SecretManager({ store }).ensureSecrets()).rejects.toMatchObject({
        code: 'ENCRYPTION_KEY_UNAVAILABLE',
      });
      // It must NOT have regenerated/persisted the lost protected key.
      expect(setSpy).not.toHaveBeenCalledWith('FILE_ENCRYPTION_KEY', expect.anything());
    });
  });
});
