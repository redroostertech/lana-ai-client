'use strict';

const EventEmitter = require('events');
const SECRET_STORE_KEY = 'desktop-session-v1';

class MainSessionService extends EventEmitter {
  constructor({ safeStorage, secretStore, backendClient, platform = process.platform }) {
    super();
    this.safeStorage = safeStorage;
    this.secretStore = secretStore;
    this.backendClient = backendClient;
    this.platform = platform;
    this.accessToken = null;
    this.user = null;
    this.refreshTimer = null;
  }

  assertSecureStorage() {
    if (!this.safeStorage || !this.safeStorage.isEncryptionAvailable || !this.safeStorage.isEncryptionAvailable()) throw secureStorageError();
    if (this.platform === 'linux' && this.safeStorage.getSelectedStorageBackend &&
        this.safeStorage.getSelectedStorageBackend() === 'basic_text') throw secureStorageError();
  }

  restore() {
    this.assertSecureStorage();
    const encoded = this.secretStore.get(SECRET_STORE_KEY);
    if (!encoded) return false;
    try {
      const parsed = JSON.parse(this.safeStorage.decryptString(Buffer.from(encoded, 'base64')));
      if (!parsed || typeof parsed.accessToken !== 'string' || !parsed.accessToken) throw new Error('invalid');
      this.accessToken = parsed.accessToken;
      this.user = sanitizeRendererUser(parsed.user);
      this.scheduleRefresh();
      return true;
    } catch (_) {
      this.secretStore.delete(SECRET_STORE_KEY);
      this.accessToken = null;
      this.user = null;
      return false;
    }
  }

  async login(credentials) {
    validateCredentials(credentials);
    const result = await this.backendClient.dispatchNativeOperation('auth.login', credentials);
    if (!result || typeof result.token !== 'string' || !result.token) throw new Error('Authentication response was invalid');
    this.accessToken = result.token;
    this.user = sanitizeRendererUser(result.user);
    this.persist();
    this.scheduleRefresh();
    this.emit('signed-in', this.getRendererState());
    return this.getRendererState();
  }

  async refresh() {
    if (!this.accessToken) return false;
    const result = await this.backendClient.dispatchNativeOperation('auth.refresh');
    if (!result || typeof result.token !== 'string' || !result.token) {
      await this.signOut('invalid-refresh');
      return false;
    }
    this.accessToken = result.token;
    if (result.user) this.user = sanitizeRendererUser(result.user);
    this.persist();
    this.scheduleRefresh();
    return true;
  }

  async signOut(reason = 'user') {
    if (this.accessToken) {
      try { await this.backendClient.dispatchNativeOperation('auth.logout'); } catch (_) { /* local invalidation wins */ }
    }
    this.clearLocalSession();
    this.emit('signed-out', { reason });
  }

  clearLocalSession() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.accessToken = null;
    this.user = null;
    this.secretStore.delete(SECRET_STORE_KEY);
  }

  getAccessTokenForBackendClient() { return this.accessToken; }
  getRendererState() { return { signedIn: Boolean(this.accessToken), user: sanitizeRendererUser(this.user) }; }

  persist() {
    this.assertSecureStorage();
    const encrypted = this.safeStorage.encryptString(JSON.stringify({ accessToken: this.accessToken, user: this.user }));
    this.secretStore.set(SECRET_STORE_KEY, Buffer.from(encrypted).toString('base64'));
  }

  scheduleRefresh() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const expiry = readJwtExpiry(this.accessToken);
    if (!expiry) return;
    const delay = Math.max(1_000, expiry - Date.now() - 60 * 60 * 1000);
    this.refreshTimer = setTimeout(() => this.refresh().catch(() => this.signOut('refresh-failed')), delay);
    if (this.refreshTimer.unref) this.refreshTimer.unref();
  }
}

function sanitizeRendererUser(user) {
  if (!user || typeof user !== 'object') return null;
  const allowed = ['id', 'user_id', 'firstName', 'first_name', 'lastName', 'last_name', 'displayName', 'mustChangePassword'];
  const clean = {};
  for (const key of allowed) if (user[key] !== undefined) clean[key] = user[key];
  return clean;
}

function validateCredentials(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Credentials are required');
  if (Object.keys(value).some((key) => !['email', 'password', 'mfaToken'].includes(key))) throw new TypeError('Unknown credential field');
  if (typeof value.email !== 'string' || value.email.length < 3 || value.email.length > 254) throw new TypeError('Invalid email');
  if (typeof value.password !== 'string' || value.password.length < 1 || value.password.length > 1024) throw new TypeError('Invalid password');
  if (value.mfaToken != null && (typeof value.mfaToken !== 'string' || value.mfaToken.length > 64)) throw new TypeError('Invalid MFA token');
}

function readJwtExpiry(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch (_) { return null; }
}

function secureStorageError() {
  const error = new Error('Secure credential storage is unavailable');
  error.code = 'SECURE_STORAGE_UNAVAILABLE';
  return error;
}

module.exports = { MainSessionService, sanitizeRendererUser, validateCredentials, readJwtExpiry, SECRET_STORE_KEY };
