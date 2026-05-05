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

// Config version - increment this when making breaking changes to storage format
const CONFIG_VERSION = 2;

/**
 * Generate a device-specific encryption key
 * Uses machine ID and home directory to create a unique key per user
 *
 * IMPORTANT: This key MUST remain stable across app updates and reinstalls.
 * If this formula ever changes, existing users will lose their saved config.
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
    encryptionKey: generateEncryptionKey(),
    defaults: {
      server: null,
      lastConnected: null,
      preferences: {
        autoConnect: true,
        rememberServer: true
      }
    }
  };

  try {
    store = new Store(storeOptions);
  } catch (error) {
    // Config file is corrupted (common after uninstall/reinstall or version mismatch)
    logError('Config file corrupted, resetting to defaults', error);

    try {
      // Get the config file path and delete it
      const fs = require('fs');
      const path = require('path');
      const configDir = app.getPath('userData');
      const configPath = path.join(configDir, 'server-config.json');

      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
        logInfo(`[electron-storage] Deleted corrupted config file: ${configPath}`);
      }

      // Try again with fresh config
      store = new Store(storeOptions);
      logInfo('[electron-storage] Successfully initialized fresh config store');
    } catch (retryError) {
      logError('[electron-storage] Failed to recover from corrupted config', retryError);
      // Last resort: create an in-memory store-like object
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
      logInfo('[electron-storage] Using in-memory fallback store');
    }
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
      // Public domain (e.g. "redrooster.lanaai.io"); needed to re-call
      // hosted discovery on logout for background refresh.
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
      // Sub-apps available to this organization (drives the client app switcher)
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

module.exports = {
  saveServerConnection,
  getSavedServer,
  updateLastVerified,
  clearSavedServer,
  getPreferences,
  updatePreferences,
  getAllData,
  clearAllData,
  addToConnectionHistory,
  getConnectionHistory
};
