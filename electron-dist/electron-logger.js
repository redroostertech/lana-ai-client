// electron-logger.js
var fs = require("fs");
var path = require("path");
var { app } = require("electron");
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
function logInfo(message, ...args) {
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
function logError(message, error) {
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
  const userDataPath = app?.getPath?.("userData") || ".";
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
    appVersion: app?.getVersion?.() || "unknown"
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
module.exports = {
  logDebug,
  logInfo,
  logWarn,
  logError,
  exportLogs,
  getLogsAsString,
  getLogFilePath,
  clearLogs
};
