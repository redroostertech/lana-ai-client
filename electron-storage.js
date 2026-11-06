/**
 * Electron Storage Module
 * 
 * Handles secure persistent storage of server connection configuration
 * Uses electron-store with encryption
 */

const Store = require('electron-store');
const { app } = require('electron');
const crypto = require('crypto');
const os = require('os');
const { logInfo, logError } = require('./electron-logger');
const { openSettingsStore, stableKey } = require('./electron-settings-file');

// Config version - increment this when making breaking changes to storage format
const CONFIG_VERSION = 2;

/**
 * The legacy settings key: host name and home folder. The host name is not stable (macOS
 * renames the computer on a network name conflict), so the settings now use a key built
 * from the hardware id (electron-settings-file.js stableKey); this one only reads a file
 * written before that, once, to move it to the stable key.
 */
function generateEncryptionKey() {
  try {
    // Use only stable system identifiers that won't change:
    // - hostname: stable unless user renames their computer
    // - homedir: stable for the user account
    // DO NOT use app.getPath() - it can vary due to App Translocation
    const machineId = os.hostname();
    const userHome = os.homedir();

    // NEVER change this key material string - it would break existing installs
    const keyMaterial = `${machineId}-${userHome}-lana-ai-client-stable`;

    const hash = crypto.createHash('sha256');
    hash.update(keyMaterial);
    return hash.digest('hex');
  } catch (error) {
    logError('Failed to generate encryption key, using fallback', error);
    return crypto.createHash('sha256').update('lana-ai-fallback-key').digest('hex');
  }
}

// Initialize encrypted store with device-specific key
// Wrap in function to handle corrupted config files gracefully
let store;

function initializeStore() {
  const storeOptions = {
    name: 'server-config',
    defaults: {
      server: null,
      lastConnected: null,
      preferences: {
        autoConnect: true,
        rememberServer: true
      }
    }
  };

  // The stable key (hardware id), reading a file written with the old host-name key once;
  // a file that cannot be read is set aside, never deleted (electron-settings-file.js).
  try {
    const opened = openSettingsStore({
      Store,
      options: storeOptions,
      directory: app.getPath('userData'),
      key: stableKey(),
      legacy: generateEncryptionKey(),
      log: { info: logInfo, error: (message) => logError(message) }
    });
    store = opened.store;
  } catch (error) {
    logError('[electron-storage] Settings could not be opened; using in-memory settings for this session', error);
    // Last resort: an in-memory store-like object. The file on disk is left as it is.
    store = {
      _data: storeOptions.defaults,
      get: function(key, defaultValue) {
        return this._data[key] !== undefined ? this._data[key] : defaultValue;
      },
      set: function(key, value) {
        this._data[key] = value;
      },
      delete: function(key) {
        delete this._data[key];
      },
      clear: function() {
        this._data = {};
      },
      get store() {
        return this._data;
      }
    };
  }
}

// Initialize store on module load
initializeStore();

/**
 * Save server connection details
 * @param {Object} server - Server details
 * @returns {boolean} Success status
 */
function saveServerConnection(server) {
  try {
    const connectionData = {
      url: server.url || `http://${server.host}:${server.port}`,
      host: server.host,
      port: server.port,
      // Public domain (e.g. "redrooster.lanaai.io"); needed to refresh hosted
      // discovery on subsequent launches without requiring another login.
      domain: server.domain || null,
      orgId: server.orgId,
      orgName: server.orgName,
      version: server.version,
      apiVersion: server.apiVersion,
      // Burst API configuration for direct calls to burst service
      burstApiKey: server.burstApiKey || null,
      burstUrl: server.burstUrl || null,
      // Forge agents platform configuration (Phase 1) — mirrors burst pattern.
      forgeApiKey: server.forgeApiKey || null,
      forgeUrl: server.forgeUrl || null,
      forgeSovereign: server.forgeSovereign || null,
      tier: server.tier || 'standard',
      rateLimit: server.rateLimit || 100,
      // Organization app entitlements. Routable entries drive the switcher;
      // capability entries gate native/background client features.
      enabledApps: Array.isArray(server.enabledApps) ? server.enabledApps : [],
      connectedAt: new Date().toISOString(),
      lastVerified: new Date().toISOString()
    };

    store.set('server', connectionData);
    store.set('lastConnected', new Date().toISOString());

    logInfo(`[electron-storage] Server connection saved: ${server.orgName} (${server.orgId})`);
    return true;
  } catch (error) {
    logError('[electron-storage] Failed to save server connection', error);
    return false;
  }
}

/**
 * Get saved server connection
 * @returns {Object|null} Saved server details or null
 */
function getSavedServer() {
  try {
    const server = store.get('server');
    
    if (!server) {
      logInfo('[electron-storage] No saved server found');
      return null;
    }

    logInfo(`[electron-storage] Retrieved saved server: ${server.orgName} (${server.orgId})`);
    return server;
  } catch (error) {
    logError('[electron-storage] Failed to get saved server', error);
    return null;
  }
}

/**
 * Update last verified timestamp for saved server
 * @returns {boolean} Success status
 */
function updateLastVerified() {
  try {
    const server = store.get('server');
    
    if (!server) {
      return false;
    }

    server.lastVerified = new Date().toISOString();
    store.set('server', server);
    
    return true;
  } catch (error) {
    logError('[electron-storage] Failed to update last verified timestamp', error);
    return false;
  }
}

/**
 * Clear saved server connection (logout/disconnect)
 * @returns {boolean} Success status
 */
function clearSavedServer() {
  try {
    const server = store.get('server');
    
    if (server) {
      logInfo(`[electron-storage] Clearing saved server: ${server.orgName}`);
    }

    store.delete('server');
    return true;
  } catch (error) {
    logError('[electron-storage] Failed to clear saved server', error);
    return false;
  }
}

/**
 * Save the Brainchild link config (one-time, persisted).
 *
 * Phase B: the client reads the user's brainchild vault through the MCP stdio
 * server. The link pins the install root (which contains bin/brainchild-mcp.js)
 * and the vault path. This is the user's own local data — no auth token is ever
 * cached here (the vault is read from disk).
 *
 * @param {Object} link - { installPath, vaultPath, verified?, installVersion? }
 * @returns {boolean} Success status
 */
function saveBrainchildLink(link) {
  try {
    const data = {
      installPath: (link && link.installPath) || '',
      vaultPath: (link && link.vaultPath) || '',
      verified: Boolean(link && link.verified),
      installVersion: (link && link.installVersion) || null,
      linkedAt: new Date().toISOString()
    };
    store.set('brainchildLink', data);
    logInfo(`[electron-storage] Brainchild link saved (vault: ${data.vaultPath})`);
    return true;
  } catch (error) {
    logError('[electron-storage] Failed to save brainchild link', error);
    return false;
  }
}

/**
 * Get the saved Brainchild link config.
 * @returns {Object|null}
 */
function getBrainchildLink() {
  try {
    return store.get('brainchildLink') || null;
  } catch (error) {
    logError('[electron-storage] Failed to get brainchild link', error);
    return null;
  }
}

/**
 * Clear the saved Brainchild link config.
 *
 * Product decision (per Phase B spec): on logout we KEEP the link (the vault is
 * the user's local file, not org-dependent) and only stop the MCP process. This
 * helper exists for explicit unlink / re-link flows.
 * @returns {boolean}
 */
function clearBrainchildLink() {
  try {
    store.delete('brainchildLink');
    logInfo('[electron-storage] Brainchild link cleared');
    return true;
  } catch (error) {
    logError('[electron-storage] Failed to clear brainchild link', error);
    return false;
  }
}

/**
 * Persist whether the user has suppressed auto-binding the Brainchild bridge.
 *
 * Auto-bind lets the bridge attach to a handshake-discovered vault when there is
 * no explicit persisted link. An explicit Unlink sets this flag so discovery does
 * not immediately re-bind; an explicit Connect clears it. The vault is the user's
 * own local data, so this is a plain preference flag (no token).
 * @param {boolean} disabled
 * @returns {boolean} Success status
 */
function setBrainchildAutoBindDisabled(disabled) {
  try {
    store.set('brainchildAutoBindDisabled', Boolean(disabled));
    return true;
  } catch (error) {
    logError('[electron-storage] Failed to set brainchild auto-bind flag', error);
    return false;
  }
}

/**
 * Read the Brainchild auto-bind suppression flag. Defaults to false (auto-bind
 * allowed) when unset.
 * @returns {boolean}
 */
function isBrainchildAutoBindDisabled() {
  try {
    return Boolean(store.get('brainchildAutoBindDisabled', false));
  } catch (error) {
    logError('[electron-storage] Failed to get brainchild auto-bind flag', error);
    return false;
  }
}

/**
 * Get user preferences
 * @returns {Object} User preferences
 */
function getPreferences() {
  try {
    return store.get('preferences', {
      autoConnect: true,
      rememberServer: true
    });
  } catch (error) {
    logError('[electron-storage] Failed to get preferences', error);
    return {
      autoConnect: true,
      rememberServer: true
    };
  }
}

/**
 * Update user preferences
 * @param {Object} preferences - Preferences to update
 * @returns {boolean} Success status
 */
function updatePreferences(preferences) {
  try {
    const current = getPreferences();
    const updated = { ...current, ...preferences };
    
    store.set('preferences', updated);
    logInfo('[electron-storage] Preferences updated');
    return true;
  } catch (error) {
    logError('[electron-storage] Failed to update preferences', error);
    return false;
  }
}

/**
 * Get all stored data (for debugging)
 * @returns {Object} All stored data
 */
function getAllData() {
  try {
    return store.store;
  } catch (error) {
    logError('[electron-storage] Failed to get all data', error);
    return {};
  }
}

/**
 * Clear all stored data (reset)
 * @returns {boolean} Success status
 */
function clearAllData() {
  try {
    store.clear();
    logInfo('[electron-storage] All stored data cleared');
    return true;
  } catch (error) {
    logError('[electron-storage] Failed to clear all data', error);
    return false;
  }
}

/**
 * Save connection history
 * @param {Object} server - Server connection info
 * @returns {boolean} Success status
 */
function addToConnectionHistory(server) {
  try {
    const history = store.get('connectionHistory', []);
    
    // Add to history (limit to last 10)
    const entry = {
      orgId: server.orgId,
      orgName: server.orgName,
      url: server.url,
      connectedAt: new Date().toISOString()
    };

    // Remove duplicates
    const filtered = history.filter(h => h.orgId !== server.orgId);
    filtered.unshift(entry);

    // Keep only last 10
    const trimmed = filtered.slice(0, 10);
    
    store.set('connectionHistory', trimmed);
    return true;
  } catch (error) {
    logError('[electron-storage] Failed to add to connection history', error);
    return false;
  }
}

/**
 * Get connection history
 * @returns {Array} Connection history
 */
function getConnectionHistory() {
  try {
    return store.get('connectionHistory', []);
  } catch (error) {
    logError('[electron-storage] Failed to get connection history', error);
    return [];
  }
}

// Local AI engine settings (local-ai-engine plan, phase 6). Kept apart from
// the saved server so logging out does not reset them.
//   enabled: null (default: on when an engine is configured) | true | false
//   root:    engine checkout or packaged engine folder (LANA_ENGINE_ROOT wins)
//   port:    last loopback port the engine used, reused when still free
//   backgroundJobs: null (default: on when the engine is on) | true | false,
//            "Run my background jobs on this computer when possible" (phase 8d)
//   engineId: this computer's engine id, generated once and kept
const LOCAL_ENGINE_KEY = 'localEngine';
const LOCAL_ENGINE_DEFAULTS = Object.freeze({ enabled: null, root: null, port: null, backgroundJobs: null, engineId: null });

function getLocalEnginePreferences() {
  try {
    const value = store.get(LOCAL_ENGINE_KEY, null);
    return { ...LOCAL_ENGINE_DEFAULTS, ...(value && typeof value === 'object' ? value : {}) };
  } catch (error) {
    logError('[electron-storage] Failed to read local engine settings', error);
    return { ...LOCAL_ENGINE_DEFAULTS };
  }
}

/**
 * @param {{ enabled?: boolean|null, root?: string|null, port?: number|null, backgroundJobs?: boolean|null, engineId?: string|null }} changes
 * @returns {Object} the saved settings
 */
function updateLocalEnginePreferences(changes = {}) {
  const next = { ...getLocalEnginePreferences() };
  if (Object.prototype.hasOwnProperty.call(changes, 'enabled')) {
    next.enabled = typeof changes.enabled === 'boolean' ? changes.enabled : null;
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'root')) {
    next.root = typeof changes.root === 'string' && changes.root.trim() ? changes.root.trim() : null;
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'backgroundJobs')) {
    next.backgroundJobs = typeof changes.backgroundJobs === 'boolean' ? changes.backgroundJobs : null;
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'engineId')) {
    next.engineId = typeof changes.engineId === 'string' && /^[A-Za-z0-9-]{8,100}$/.test(changes.engineId) ? changes.engineId : null;
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'port')) {
    next.port = Number.isInteger(changes.port) && changes.port > 0 && changes.port < 65536 ? changes.port : null;
  }
  store.set(LOCAL_ENGINE_KEY, next);
  return next;
}

// Ciphertext of the login token (Electron safeStorage output, base64). The
// plain token never reaches this store; see electron-token-store.js.
const AUTH_TOKEN_KEY = 'authTokenEncrypted';

const authTokenPersistence = {
  read: () => store.get(AUTH_TOKEN_KEY) || null,
  write: (ciphertext) => store.set(AUTH_TOKEN_KEY, ciphertext),
  remove: () => store.delete(AUTH_TOKEN_KEY)
};

// Phase 10: the offline copy key, as safeStorage ciphertext only (electron-offline-key.js).
const OFFLINE_KEY_KEY = 'offlineCopyKeyEncrypted';
const offlineKeyPersistence = {
  read: () => store.get(OFFLINE_KEY_KEY) || null,
  write: (ciphertext) => store.set(OFFLINE_KEY_KEY, ciphertext),
  remove: () => store.delete(OFFLINE_KEY_KEY)
};

module.exports = {
  authTokenPersistence,
  offlineKeyPersistence,
  saveServerConnection,
  getSavedServer,
  updateLastVerified,
  clearSavedServer,
  saveBrainchildLink,
  getBrainchildLink,
  clearBrainchildLink,
  setBrainchildAutoBindDisabled,
  isBrainchildAutoBindDisabled,
  getPreferences,
  updatePreferences,
  getLocalEnginePreferences,
  updateLocalEnginePreferences,
  getAllData,
  clearAllData,
  addToConnectionHistory,
  getConnectionHistory
};
