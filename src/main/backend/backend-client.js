'use strict';

const { getNativeOperation } = require('./native-operation-catalog');

const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

class SafeBackendError extends Error {
  constructor(code, status = 0) {
    super(code === 'BACKEND_UNAVAILABLE' ? 'Backend is unavailable' : 'Backend request failed');
    this.name = 'SafeBackendError';
    this.code = code;
    this.status = status;
  }
}

class BackendClient {
  constructor({ getBaseUrl, getAccessToken, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    if (typeof getBaseUrl !== 'function' || typeof getAccessToken !== 'function' || typeof fetchImpl !== 'function') {
      throw new TypeError('BackendClient requires trusted providers');
    }
    this.getBaseUrl = getBaseUrl;
    this.getAccessToken = getAccessToken;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async dispatchNativeOperation(operationId, body, { signal } = {}) {
    const operation = getNativeOperation(operationId);
    const baseUrl = normalizeBaseUrl(this.getBaseUrl());
    const token = operation.authenticated ? this.getAccessToken() : null;
    if (operation.authenticated && !token) throw new SafeBackendError('SIGN_IN_REQUIRED', 401);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    const headers = { Accept: 'application/json' };
    const init = { method: operation.method, headers, signal: controller.signal };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined && body !== null && operation.method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    try {
      const response = await this.fetchImpl(`${baseUrl}${operation.path()}`, init);
      const declaredLength = Number(response.headers && response.headers.get && response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
        throw new SafeBackendError('BACKEND_RESPONSE_TOO_LARGE', 502);
      }
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new SafeBackendError('BACKEND_RESPONSE_TOO_LARGE', 502);
      let value = null;
      if (text) {
        try { value = JSON.parse(text); } catch (_) { throw new SafeBackendError('BACKEND_INVALID_RESPONSE', 502); }
      }
      if (!response.ok) {
        if (response.status === 401) throw new SafeBackendError('SIGN_IN_REQUIRED', 401);
        if (response.status === 403) throw new SafeBackendError('INSUFFICIENT_PERMISSION', 403);
        throw new SafeBackendError('BACKEND_REQUEST_FAILED', response.status);
      }
      return value;
    } catch (error) {
      if (error instanceof SafeBackendError) throw error;
      if (error && error.name === 'AbortError') throw new SafeBackendError('DEADLINE_EXCEEDED', 504);
      throw new SafeBackendError('BACKEND_UNAVAILABLE', 503);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeBaseUrl(value) {
  const parsed = new URL(String(value || ''));
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new SafeBackendError('BACKEND_CONFIGURATION_INVALID', 500);
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new SafeBackendError('BACKEND_CONFIGURATION_INVALID', 500);
  }
  return parsed.origin + parsed.pathname.replace(/\/$/, '');
}

module.exports = { BackendClient, SafeBackendError, normalizeBaseUrl, MAX_RESPONSE_BYTES };
