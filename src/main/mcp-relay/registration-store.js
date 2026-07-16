'use strict';

const crypto = require('crypto');

class RegistrationStore {
  constructor({ safeStorage, store, namespace }) {
    this.safeStorage = safeStorage;
    this.store = store;
    this.namespace = namespace;
  }

  create({ claimedMetadata = {}, scopes = [] }) {
    this.assertSecureStorage();
    const registrationId = crypto.randomUUID();
    const secret = crypto.randomBytes(32);
    const record = {
      registrationId, namespace: this.namespace, claimedMetadata: sanitizeClaims(claimedMetadata),
      scopes: [...new Set(scopes)].sort(), createdAt: Date.now(), lastUsedAt: null,
      disabled: false, revokedAt: null, secret: secret.toString('base64url')
    };
    this.write(record);
    return { registration: publicRecord(record), secret: secret.toString('base64url') };
  }

  getWithSecret(registrationId) {
    this.assertSecureStorage();
    const encoded = this.store.get(this.key(registrationId));
    if (!encoded) return null;
    try {
      const record = JSON.parse(this.safeStorage.decryptString(Buffer.from(encoded, 'base64')));
      if (record.namespace !== this.namespace || record.registrationId !== registrationId) return null;
      return record;
    } catch (_) { return null; }
  }

  list() {
    return (this.store.get(`${this.namespace}:registration-index`) || [])
      .map((id) => this.getWithSecret(id)).filter(Boolean).map(publicRecord);
  }

  revoke(registrationId) { return this.update(registrationId, { revokedAt: Date.now(), disabled: true }); }
  disable(registrationId) { return this.update(registrationId, { disabled: true }); }
  rotate(registrationId) {
    const secret = crypto.randomBytes(32).toString('base64url');
    const record = this.update(registrationId, { secret, rotatedAt: Date.now() });
    return record ? { registration: publicRecord(record), secret } : null;
  }

  update(registrationId, patch) {
    const record = this.getWithSecret(registrationId);
    if (!record) return null;
    Object.assign(record, patch);
    this.write(record);
    return record;
  }

  write(record) {
    const encrypted = this.safeStorage.encryptString(JSON.stringify(record));
    this.store.set(this.key(record.registrationId), Buffer.from(encrypted).toString('base64'));
    const indexKey = `${this.namespace}:registration-index`;
    const index = this.store.get(indexKey) || [];
    if (!index.includes(record.registrationId)) this.store.set(indexKey, [...index, record.registrationId]);
  }

  key(id) { return `${this.namespace}:registration:${id}`; }
  assertSecureStorage() {
    if (!this.safeStorage || !this.safeStorage.isEncryptionAvailable || !this.safeStorage.isEncryptionAvailable() ||
        (process.platform === 'linux' && this.safeStorage.getSelectedStorageBackend && this.safeStorage.getSelectedStorageBackend() === 'basic_text')) {
      const error = new Error('Secure registration storage is unavailable'); error.code = 'SECURE_STORAGE_UNAVAILABLE'; throw error;
    }
  }
}

class PairingService {
  constructor({ clock = () => Date.now(), ttlMs = 120000 } = {}) { this.clock = clock; this.ttlMs = ttlMs; this.pending = new Map(); }
  issue() { const code = crypto.randomBytes(16).toString('base64url'); this.pending.set(hash(code), this.clock() + this.ttlMs); return code; }
  consume(code) {
    const key = hash(String(code || '')); const expiry = this.pending.get(key); this.pending.delete(key);
    return Boolean(expiry && expiry >= this.clock());
  }
  clear() { this.pending.clear(); }
}

function publicRecord(record) { const { secret, ...safe } = record; return safe; }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function sanitizeClaims(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const clean = {};
  for (const key of ['name', 'vendor', 'version']) if (typeof value[key] === 'string') clean[key] = value[key].slice(0, 128);
  return clean;
}
module.exports = { RegistrationStore, PairingService, publicRecord };
