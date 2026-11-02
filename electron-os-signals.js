'use strict';

/**
 * Operating system signals for the local AI engine (local-ai-engine plan,
 * phase 8d). Only the Electron main process sees these, so the client reads
 * them and passes them to the engine it supervises (electron-engine-control.js),
 * which puts them in its capability report and hands running background jobs
 * off before the computer sleeps or the app quits.
 *
 * - power: on mains or battery (powerMonitor on-ac / on-battery and
 *   isOnBatteryPower), battery level and low power mode (macOS `pmset`, Linux
 *   /sys/class/power_supply; unknown elsewhere, and an unknown level on
 *   battery is treated by the server as not eligible);
 * - about_to_sleep: powerMonitor suspend (true) and resume (false);
 * - lid_closed: macOS only (ioreg AppleClamshellState), polled; null elsewhere;
 * - online: Electron net.isOnline(), polled;
 * - app_quitting: set by markQuitting() from before-quit, and by
 *   powerMonitor shutdown.
 *
 * Plain CommonJS with every side effect injected (powerMonitor, net, the
 * command runner, file reads, timers) so it runs under Jest without Electron.
 * The parsers read fixed formats these OS tools print; they decide nothing.
 */

const POLL_MS = 30000;

/** `pmset -g batt`: "Now drawing from 'AC Power'" and " -InternalBattery-0 (id=..)\t71%; discharging; ...". */
function parsePmsetBattery(text) {
  const source = /Now drawing from '([^']+)'/.exec(String(text || ''));
  const level = /\t(\d{1,3})%;/.exec(String(text || ''));
  return {
    on_mains: source ? source[1] === 'AC Power' : null,
    battery_percent: level ? Math.min(100, Number(level[1])) : null
  };
}

/** `pmset -g`: a " lowpowermode 1" line when the setting exists. */
function parsePmsetLowPower(text) {
  const match = /^\s*lowpowermode\s+(\d)\s*$/m.exec(String(text || ''));
  return match ? match[1] === '1' : null;
}

/** `ioreg -r -k AppleClamshellState -d 1`: "\"AppleClamshellState\" = Yes|No". */
function parseClamshell(text) {
  const match = /"AppleClamshellState" = (Yes|No)/.exec(String(text || ''));
  return match ? match[1] === 'Yes' : null;
}

/**
 * @param {Object} deps
 * @param {Object} deps.powerMonitor - Electron powerMonitor (on, isOnBatteryPower)
 * @param {Object} [deps.net] - Electron net (isOnline)
 * @param {string} [deps.platform]
 * @param {Function} [deps.run] - async (command, args) => stdout
 * @param {Function} [deps.readFile] - async (path) => string
 * @param {Function} deps.onChange - (signals, { urgent }) => void; urgent for sleep and quit
 * @param {Object} [deps.timers]
 * @param {number} [deps.pollMs]
 */
function createOsSignals({ powerMonitor, net = null, platform = process.platform, run = null, readFile = null, onChange, timers = { setInterval, clearInterval }, pollMs = POLL_MS }) {
  const state = {
    power: { on_mains: null, battery_percent: null, low_power_mode: null },
    about_to_sleep: false,
    lid_closed: null,
    online: true,
    app_quitting: false
  };
  let poller = null;
  const listeners = [];

  function snapshot() {
    return { ...state, power: { ...state.power } };
  }

  function changed(before, urgent = false) {
    const now = JSON.stringify(snapshot());
    if (now === before && !urgent) {return;}
    try { onChange(snapshot(), { urgent }); } catch (_error) { /* not ours */ }
  }

  async function quietly(fn) {
    try { return await fn(); } catch (_error) { return null; }
  }

  /** Read power level, low power mode, lid and network now. */
  async function poll() {
    const before = JSON.stringify(snapshot());
    try {
      state.power.on_mains = !powerMonitor.isOnBatteryPower();
    } catch (_error) { /* keep the last value */ }
    if (platform === 'darwin' && run) {
      const batt = parsePmsetBattery(await quietly(() => run('pmset', ['-g', 'batt'])));
      if (batt.on_mains !== null) {state.power.on_mains = batt.on_mains;}
      state.power.battery_percent = batt.battery_percent;
      state.power.low_power_mode = parsePmsetLowPower(await quietly(() => run('pmset', ['-g'])));
      state.lid_closed = parseClamshell(await quietly(() => run('ioreg', ['-r', '-k', 'AppleClamshellState', '-d', '1'])));
    } else if (platform === 'linux' && readFile) {
      const level = Number.parseInt(String(await quietly(() => readFile('/sys/class/power_supply/BAT0/capacity')) || '').trim(), 10);
      state.power.battery_percent = Number.isFinite(level) ? Math.min(100, level) : null;
      state.power.low_power_mode = null;
    }
    if (net && typeof net.isOnline === 'function') {
      try { state.online = Boolean(net.isOnline()); } catch (_error) { /* keep */ }
    }
    // A lid that closes is a sleep on its way: urgent, so running jobs hand off now.
    const lidClosedNow = state.lid_closed === true && !JSON.parse(before).lid_closed;
    changed(before, lidClosedNow);
    return snapshot();
  }

  function on(event, handler) {
    powerMonitor.on(event, handler);
    listeners.push([event, handler]);
  }

  function start() {
    on('suspend', () => {
      const before = JSON.stringify(snapshot());
      state.about_to_sleep = true;
      changed(before, true);
    });
    on('resume', () => {
      const before = JSON.stringify(snapshot());
      state.about_to_sleep = false;
      changed(before);
      poll();
    });
    on('on-ac', () => {
      const before = JSON.stringify(snapshot());
      state.power.on_mains = true;
      changed(before);
      poll();
    });
    on('on-battery', () => {
      const before = JSON.stringify(snapshot());
      state.power.on_mains = false;
      changed(before);
      poll();
    });
    on('shutdown', () => {
      const before = JSON.stringify(snapshot());
      state.app_quitting = true;
      changed(before, true);
    });
    poller = timers.setInterval(() => { poll(); }, pollMs);
    if (poller && typeof poller.unref === 'function') {poller.unref();}
    return poll();
  }

  /** The app is quitting (before-quit). */
  function markQuitting() {
    const before = JSON.stringify(snapshot());
    state.app_quitting = true;
    changed(before, true);
    return snapshot();
  }

  function stop() {
    if (poller) {timers.clearInterval(poller);}
    poller = null;
    for (const [event, handler] of listeners.splice(0)) {
      try { powerMonitor.removeListener(event, handler); } catch (_error) { /* gone */ }
    }
  }

  return { start, stop, poll, markQuitting, snapshot };
}

module.exports = { createOsSignals, parsePmsetBattery, parsePmsetLowPower, parseClamshell, POLL_MS };
