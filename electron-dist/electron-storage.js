var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// electron-logger.js
var require_electron_logger = __commonJS({
  "electron-logger.js"(exports2, module2) {
    var fs = require("fs");
    var path = require("path");
    var { app: app2 } = require("electron");
    var LOG_LEVELS = {
      DEBUG: 0,
      INFO: 1,
      WARN: 2,
      ERROR: 3
    };
    var logBuffer = [];
    var MAX_LOG_ENTRIES = 1e3;
    var currentLogLevel = process.env.NODE_ENV === "development" ? LOG_LEVELS.DEBUG : LOG_LEVELS.INFO;
    function getTimestamp() {
      return (/* @__PURE__ */ new Date()).toISOString();
    }
    function addToBuffer(level, message, args) {
      const entry = {
        timestamp: getTimestamp(),
        level,
        message,
        args: args.length > 0 ? JSON.stringify(args, null, 2) : void 0
      };
      logBuffer.push(entry);
      if (logBuffer.length > MAX_LOG_ENTRIES) {
        logBuffer.shift();
      }
    }
    function logDebug(message, ...args) {
      addToBuffer("DEBUG", message, args);
      if (currentLogLevel <= LOG_LEVELS.DEBUG) {
        console.log(`[DEBUG] ${message}`, ...args);
      }
    }
    function logInfo2(message, ...args) {
      addToBuffer("INFO", message, args);
      if (currentLogLevel <= LOG_LEVELS.INFO) {
        console.log(`[INFO] ${message}`, ...args);
      }
    }
    function logWarn(message, ...args) {
      addToBuffer("WARN", message, args);
      if (currentLogLevel <= LOG_LEVELS.WARN) {
        console.warn(`[WARN] ${message}`, ...args);
      }
    }
    function logError2(message, error) {
      const errorDetails = error ? { message: error.message, stack: error.stack } : void 0;
      addToBuffer("ERROR", message, errorDetails ? [errorDetails] : []);
      if (currentLogLevel <= LOG_LEVELS.ERROR) {
        if (error) {
          console.error(`[ERROR] ${message}`, error);
        } else {
          console.error(`[ERROR] ${message}`);
        }
      }
    }
    function getLogFilePath() {
      const userDataPath = app2?.getPath?.("userData") || ".";
      return path.join(userDataPath, "lana-debug.log");
    }
    function exportLogs() {
      const logPath = getLogFilePath();
      const systemInfo = {
        timestamp: getTimestamp(),
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.versions.node,
        electronVersion: process.versions.electron,
        chromeVersion: process.versions.chrome,
        appVersion: app2?.getVersion?.() || "unknown"
      };
      let logContent = "=== LANA AI DEBUG LOG ===\n\n";
      logContent += "--- System Info ---\n";
      logContent += JSON.stringify(systemInfo, null, 2) + "\n\n";
      logContent += "--- Application Logs ---\n";
      for (const entry of logBuffer) {
        logContent += `[${entry.timestamp}] [${entry.level}] ${entry.message}`;
        if (entry.args) {
          logContent += `
  ${entry.args}`;
        }
        logContent += "\n";
      }
      fs.writeFileSync(logPath, logContent, "utf8");
      return logPath;
    }
    function getLogsAsString() {
      return logBuffer.map((entry) => {
        let line = `[${entry.timestamp}] [${entry.level}] ${entry.message}`;
        if (entry.args) {
          line += ` ${entry.args}`;
        }
        return line;
      }).join("\n");
    }
    function clearLogs() {
      logBuffer.length = 0;
    }
    module2.exports = {
      logDebug,
      logInfo: logInfo2,
      logWarn,
      logError: logError2,
      exportLogs,
      getLogsAsString,
      getLogFilePath,
      clearLogs
    };
  }
});

// electron-storage.js
var Store = require("electron-store");
var { app } = require("electron");
var crypto = require("crypto");
var os = require("os");
var { logInfo, logError } = require_electron_logger();
function generateEncryptionKey() {
  try {
    const machineId = os.hostname();
    const userHome = os.homedir();
    const keyMaterial = `${machineId}-${userHome}-lana-ai-client-stable`;
    const hash = crypto.createHash("sha256");
    hash.update(keyMaterial);
    return hash.digest("hex");
  } catch (error) {
    logError("Failed to generate encryption key, using fallback", error);
    return crypto.createHash("sha256").update("lana-ai-fallback-key").digest("hex");
  }
}
var store;
function initializeStore() {
  const storeOptions = {
    name: "server-config",
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
    logError("Config file corrupted, resetting to defaults", error);
    try {
      const fs = require("fs");
      const path = require("path");
      const configDir = app.getPath("userData");
      const configPath = path.join(configDir, "server-config.json");
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
        logInfo(`Deleted corrupted config file: ${configPath}`);
      }
      store = new Store(storeOptions);
      logInfo("Successfully initialized fresh config store");
    } catch (retryError) {
      logError("Failed to recover from corrupted config", retryError);
      store = {
        _data: storeOptions.defaults,
        get: function(key, defaultValue) {
          return this._data[key] !== void 0 ? this._data[key] : defaultValue;
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
      logInfo("Using in-memory fallback store");
    }
  }
}
initializeStore();
function saveServerConnection(server) {
  try {
    const connectionData = {
      url: server.url || `http://${server.host}:${server.port}`,
      host: server.host,
      port: server.port,
      orgId: server.orgId,
      orgName: server.orgName,
      version: server.version,
      apiVersion: server.apiVersion,
      // Burst API configuration for direct calls to burst service
      burstApiKey: server.burstApiKey || null,
      burstUrl: server.burstUrl || null,
      tier: server.tier || "standard",
      rateLimit: server.rateLimit || 100,
      connectedAt: (/* @__PURE__ */ new Date()).toISOString(),
      lastVerified: (/* @__PURE__ */ new Date()).toISOString()
    };
    store.set("server", connectionData);
    store.set("lastConnected", (/* @__PURE__ */ new Date()).toISOString());
    logInfo(`Server connection saved: ${server.orgName} (${server.orgId})`);
    return true;
  } catch (error) {
    logError("Failed to save server connection", error);
    return false;
  }
}
function getSavedServer() {
  try {
    const server = store.get("server");
    if (!server) {
      logInfo("No saved server found");
      return null;
    }
    logInfo(`Retrieved saved server: ${server.orgName} (${server.orgId})`);
    return server;
  } catch (error) {
    logError("Failed to get saved server", error);
    return null;
  }
}
function updateLastVerified() {
  try {
    const server = store.get("server");
    if (!server) {
      return false;
    }
    server.lastVerified = (/* @__PURE__ */ new Date()).toISOString();
    store.set("server", server);
    return true;
  } catch (error) {
    logError("Failed to update last verified timestamp", error);
    return false;
  }
}
function clearSavedServer() {
  try {
    const server = store.get("server");
    if (server) {
      logInfo(`Clearing saved server: ${server.orgName}`);
    }
    store.delete("server");
    return true;
  } catch (error) {
    logError("Failed to clear saved server", error);
    return false;
  }
}
function getPreferences() {
  try {
    return store.get("preferences", {
      autoConnect: true,
      rememberServer: true
    });
  } catch (error) {
    logError("Failed to get preferences", error);
    return {
      autoConnect: true,
      rememberServer: true
    };
  }
}
function updatePreferences(preferences) {
  try {
    const current = getPreferences();
    const updated = { ...current, ...preferences };
    store.set("preferences", updated);
    logInfo("Preferences updated");
    return true;
  } catch (error) {
    logError("Failed to update preferences", error);
    return false;
  }
}
function getAllData() {
  try {
    return store.store;
  } catch (error) {
    logError("Failed to get all data", error);
    return {};
  }
}
function clearAllData() {
  try {
    store.clear();
    logInfo("All stored data cleared");
    return true;
  } catch (error) {
    logError("Failed to clear all data", error);
    return false;
  }
}
function addToConnectionHistory(server) {
  try {
    const history = store.get("connectionHistory", []);
    const entry = {
      orgId: server.orgId,
      orgName: server.orgName,
      url: server.url,
      connectedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    const filtered = history.filter((h) => h.orgId !== server.orgId);
    filtered.unshift(entry);
    const trimmed = filtered.slice(0, 10);
    store.set("connectionHistory", trimmed);
    return true;
  } catch (error) {
    logError("Failed to add to connection history", error);
    return false;
  }
}
function getConnectionHistory() {
  try {
    return store.get("connectionHistory", []);
  } catch (error) {
    logError("Failed to get connection history", error);
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
