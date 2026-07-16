'use strict';

/**
 * The legacy localhost companion bridge was intentionally removed because it
 * returned desktop backend credentials to self-identified local applications.
 * This compatibility module is fail-closed so stale imports cannot resurrect
 * a listener or credential-return path.
 */
function start() {
  const error = new Error('Legacy companion bridge has been removed');
  error.code = 'LEGACY_BRIDGE_REMOVED';
  throw error;
}
function stop() {}
function isRunning() { return false; }
module.exports = { start, stop, isRunning };
