'use strict';

/**
 * Where the saved firm's presigned storage links point (Chef's MinIO), for the
 * page CSP and CORS answer (electron-csp.js, electron-cors.js).
 *
 * Chef serves it only to signed-in callers: GET /api/v1/system/client-config,
 * config.storage_origin. The main process asks with the session token from its
 * token store once someone is signed in, again when the firm or the session
 * changes, and every refreshMs after that (a failed ask is retried after
 * retryMs). Before sign-in there is no storage origin: those pages show no
 * stored files. The token goes only into the request's Authorization header.
 *
 * Electron-free: the token store, saved server and fetch are injected.
 */

const CLIENT_CONFIG_PATH = '/api/v1/system/client-config';

/** config.storage_origin from a client-config body, when it is a plain http(s) origin. */
function storageOriginFromClientConfig(body) {
  const value = body && body.config && typeof body.config.storage_origin === 'string' ? body.config.storage_origin.trim() : '';
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password || parsed.hostname.includes('*')) return null;
    return parsed.origin === value.replace(/\/$/, '') ? parsed.origin : null;
  } catch (_) {
    return null;
  }
}

/**
 * @param {Object} deps
 * @param {Function} deps.getServer - () => saved server ({ url } is Chef), or null
 * @param {Function} deps.getToken - () => session token, or null
 * @param {Function} deps.fetch - (url, init) => Response (with its own timeout)
 * @param {Function} [deps.now]
 * @param {number} [deps.refreshMs]
 * @param {number} [deps.retryMs]
 */
function createChefStorage({ getServer, getToken, fetch, now = Date.now, refreshMs = 15 * 60 * 1000, retryMs = 5 * 60 * 1000 }) {
  let known = { key: null, origin: null, at: 0 };
  let tried = { key: null, at: 0 };
  let pending = null;

  function currentKey() {
    const server = getServer();
    const token = getToken();
    if (!server || !server.url || !token) return null;
    return { key: `${server.url}\n${token}`, url: String(server.url).replace(/\/+$/, ''), token };
  }

  async function ask(current) {
    const response = await fetch(`${current.url}${CLIENT_CONFIG_PATH}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${current.token}`, Accept: 'application/json' }
    });
    if (!response || !response.ok) throw new Error(`client-config answered ${response ? response.status : 'nothing'}`);
    return storageOriginFromClientConfig(await response.json());
  }

  /** Ask Chef now unless an answer for this firm and session is fresh. Resolves when done. */
  function refresh() {
    const current = currentKey();
    if (!current) {
      known = { key: null, origin: null, at: 0 };
      return Promise.resolve(null);
    }
    if (pending && pending.key === current.key) return pending.promise;
    if (known.key === current.key && now() - known.at < refreshMs) return Promise.resolve(known.origin);
    if (tried.key === current.key && now() - tried.at < retryMs) return Promise.resolve(known.key === current.key ? known.origin : null);
    tried = { key: current.key, at: now() };
    const promise = ask(current)
      .then((origin) => {
        known = { key: current.key, origin, at: now() };
        return origin;
      })
      .catch(() => (known.key === current.key ? known.origin : null))
      .finally(() => { if (pending && pending.key === current.key) pending = null; });
    pending = { key: current.key, promise };
    return promise;
  }

  /**
   * The storage origin for the firm and session now saved ([] when none is known
   * yet, or nobody is signed in); starts a background refresh when one is due.
   */
  function origins() {
    const current = currentKey();
    refresh();
    return current && known.key === current.key && known.origin ? [known.origin] : [];
  }

  return { origins, refresh };
}

module.exports = { createChefStorage, storageOriginFromClientConfig, CLIENT_CONFIG_PATH };
