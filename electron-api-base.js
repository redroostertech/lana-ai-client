'use strict';

/**
 * The one place that decides the API base the client uses (local-ai-engine
 * plan, phase 6).
 *
 * Rule:
 * - no local engine configured, or "Use local AI engine" off: Chef's URL, as
 *   before;
 * - engine configured and on: the engine's loopback URL, whether or not it is
 *   healthy right now. The client never silently routes around an enabled
 *   engine; the UI shows the engine's state instead (restarting, server
 *   unreachable, version refused). The engine forwards every request it does
 *   not serve itself to Chef, so nothing else needs a second address.
 *
 * Chef's URL (from discovery, stored by electron-storage) stays the stored
 * `url`; the renderer sees `url` = API base and `chefUrl` = Chef. Anything the
 * renderer saves back is mapped so the engine address is never persisted as
 * the organization's server.
 *
 * Pure functions, no Electron imports.
 */

function originOf(value) {
  if (typeof value !== 'string' || !value.trim()) {return null;}
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {return null;}
    return parsed.origin;
  } catch (_error) {
    return null;
  }
}

/**
 * Engine configuration from environment and the saved setting.
 *
 * @param {Object} env - process.env
 * @param {{ enabled?: boolean|null, root?: string|null, port?: number|null }} prefs - electron-store localEngine
 * @returns {{ mode: 'off'|'spawn'|'attach', reason: string|null, root: string|null, attachUrl: string|null, configured: boolean, enabled: boolean, preferredPort: number|null }}
 */
function resolveEngineConfig(env = {}, prefs = {}) {
  const attachUrl = originOf(env.LANA_ENGINE_URL);
  const root = (typeof env.LANA_ENGINE_ROOT === 'string' && env.LANA_ENGINE_ROOT.trim())
    || (typeof prefs.root === 'string' && prefs.root.trim())
    || null;
  const configured = Boolean(attachUrl || root);
  // Default on when an engine is configured; an explicit false turns it off.
  const enabled = configured && prefs.enabled !== false;
  const preferredPort = Number.isInteger(prefs.port) && prefs.port > 0 && prefs.port < 65536 ? prefs.port : null;
  const base = { root, attachUrl, configured, enabled, preferredPort };
  if (!configured) {return { ...base, mode: 'off', reason: 'not_configured' };}
  if (!enabled) {return { ...base, mode: 'off', reason: 'disabled' };}
  return { ...base, mode: attachUrl ? 'attach' : 'spawn', reason: null };
}

/**
 * @param {string|null} chefUrl - stored server URL
 * @param {{ mode: string, url: string|null }|null} engineState - supervisor getState()
 * @returns {string|null}
 */
function resolveApiBase(chefUrl, engineState) {
  if (engineState && engineState.mode !== 'off' && engineState.url) {
    return engineState.url;
  }
  return originOf(chefUrl) ? String(chefUrl).trim() : null;
}

/** True when API calls go to the local engine. */
function isEngineInUse(engineState) {
  return Boolean(engineState && engineState.mode !== 'off' && engineState.url);
}

/**
 * The server object the renderer sees.
 * @param {Object|null} stored - electron-storage getSavedServer()
 * @param {Object|null} engineState
 */
function presentServer(stored, engineState) {
  if (!stored) {return null;}
  const inUse = isEngineInUse(engineState);
  return {
    ...stored,
    url: resolveApiBase(stored.url, engineState) || stored.url,
    chefUrl: stored.url,
    localEngine: inUse
  };
}

/**
 * Map a server object from the renderer to what is stored: Chef's address in
 * `url`, never the engine's.
 *
 * @param {Object} incoming - from save-settings / connect-to-server
 * @param {{ engineUrl?: string|null, storedUrl?: string|null }} context
 */
function toStoredServer(incoming, { engineUrl = null, storedUrl = null } = {}) {
  if (!incoming || typeof incoming !== 'object') {return incoming;}
  const { chefUrl, localEngine, ...rest } = incoming;
  const engineOrigin = originOf(engineUrl);
  const validChef = originOf(chefUrl) ? chefUrl : null;
  if (engineOrigin && originOf(rest.url) === engineOrigin) {
    // The current engine address came back: keep Chef's.
    rest.url = validChef || storedUrl || null;
  } else if (localEngine === true && validChef) {
    // A presented object from an earlier engine session (another port).
    rest.url = validChef;
  }
  return rest;
}

module.exports = {
  resolveEngineConfig,
  resolveApiBase,
  isEngineInUse,
  presentServer,
  toStoredServer,
  originOf
};
