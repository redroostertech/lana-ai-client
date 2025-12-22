/**
 * Electron Logger Module
 *
 * Logging utility for Electron main process with file logging support
 * for user debugging.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

// Store logs in memory for export
const logBuffer = [];
const MAX_LOG_ENTRIES = 1000;

const currentLogLevel = process.env.NODE_ENV === 'development' ? LOG_LEVELS.DEBUG : LOG_LEVELS.INFO;

function getTimestamp() {
  return new Date().toISOString();
}

function addToBuffer(level, message, args) {
  const entry = {
    timestamp: getTimestamp(),
    level,
    message,
    args: args.length > 0 ? JSON.stringify(args, null, 2) : undefined
  };
  logBuffer.push(entry);

  // Keep buffer size manageable
  if (logBuffer.length > MAX_LOG_ENTRIES) {
    logBuffer.shift();
  }
}

function logDebug(message, ...args) {
  addToBuffer('DEBUG', message, args);
  if (currentLogLevel <= LOG_LEVELS.DEBUG) {
    console.log(`[DEBUG] ${message}`, ...args);
  }
}

function logInfo(message, ...args) {
  addToBuffer('INFO', message, args);
  if (currentLogLevel <= LOG_LEVELS.INFO) {
    console.log(`[INFO] ${message}`, ...args);
  }
}

function logWarn(message, ...args) {
  addToBuffer('WARN', message, args);
  if (currentLogLevel <= LOG_LEVELS.WARN) {
    console.warn(`[WARN] ${message}`, ...args);
  }
}

function logError(message, error) {
  const errorDetails = error ? { message: error.message, stack: error.stack } : undefined;
  addToBuffer('ERROR', message, errorDetails ? [errorDetails] : []);
  if (currentLogLevel <= LOG_LEVELS.ERROR) {
    if (error) {
      console.error(`[ERROR] ${message}`, error);
    } else {
      console.error(`[ERROR] ${message}`);
    }
  }
}

/**
 * Get the path to the debug log file
 */
function getLogFilePath() {
  const userDataPath = app?.getPath?.('userData') || '.';
  return path.join(userDataPath, 'lana-debug.log');
}

/**
 * Export logs to a file for user to share with support
 * @returns {string} Path to the exported log file
 */
function exportLogs() {
  const logPath = getLogFilePath();
  const systemInfo = {
    timestamp: getTimestamp(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    appVersion: app?.getVersion?.() || 'unknown'
  };

  let logContent = '=== LANA AI DEBUG LOG ===\n\n';
  logContent += '--- System Info ---\n';
  logContent += JSON.stringify(systemInfo, null, 2) + '\n\n';
  logContent += '--- Application Logs ---\n';

  for (const entry of logBuffer) {
    logContent += `[${entry.timestamp}] [${entry.level}] ${entry.message}`;
    if (entry.args) {
      logContent += `\n  ${entry.args}`;
    }
    logContent += '\n';
  }

  fs.writeFileSync(logPath, logContent, 'utf8');
  return logPath;
}

/**
 * Get logs as a string (for displaying in dialog)
 */
function getLogsAsString() {
  return logBuffer.map(entry => {
    let line = `[${entry.timestamp}] [${entry.level}] ${entry.message}`;
    if (entry.args) {
      line += ` ${entry.args}`;
    }
    return line;
  }).join('\n');
}

/**
 * Clear log buffer
 */
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
