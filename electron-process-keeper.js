'use strict';

/**
 * A local server process the client keeps running (Pip's servers, the redactor). Main process.
 *
 * Start it with a command and a health check. It counts as ready once the check passes, is
 * restarted after an exit, after three failed checks in a row, or when it does not pass within
 * the start timeout, waiting 1 second, then 2, 4 and so on up to 60. The restart count goes back
 * to 0 after a minute of good health. Stop sends SIGTERM, and SIGKILL after a grace period.
 *
 * Spawn and timers are injected, so it runs under Jest without Electron.
 */

const LOOPBACK_HOST = '127.0.0.1';

const DEFAULTS = Object.freeze({
  minBackoffMs: 1000,
  maxBackoffMs: 60000,
  stableResetMs: 60000,
  // A big model read from a cold disk takes a while before /health answers.
  startTimeoutMs: 180000,
  healthIntervalStartingMs: 500,
  healthIntervalRunningMs: 5000,
  healthTimeoutMs: 3000,
  maxHealthFailures: 3,
  stopGraceMs: 5000
});

/**
 * One local server process, kept running.
 *
 * @param {Object} deps
 * @param {string} deps.name - what it is in logs and state ("chat", "embedding", "redactor")
 * @param {string} deps.label - log prefix ("pip", "redactor")
 * @param {Function} deps.spawn
 * @param {Object} deps.timers - { setTimeout, clearTimeout }
 * @param {Function} deps.now
 * @param {Object} deps.log
 * @param {Function} deps.openLog - (name) => a writable stream for its output, or null
 * @param {Function} deps.onChange - (state) => void
 * @param {Object} [deps.options] - overrides for DEFAULTS
 * @returns {{ start(spec): void, stop(): Promise<void>, getState(): Object }}
 */
function createKeptProcess({ name, label, spawn, timers, now, log, openLog, onChange, options }) {
  const role = name;
  const opts = { ...DEFAULTS, ...options };
  const state = { role, process: 'stopped', port: null, url: null, pid: null, healthy: false, answeredOnce: false, restarts: 0, lastExit: null, lastHealthError: null };
  let spec = null;
  let child = null;
  let generation = 0;
  let healthFailures = 0;
  const timer = { health: null, restart: null, start: null, stable: null };

  const emit = () => { try { onChange({ ...state }); } catch (_error) { /* listener errors are not ours */ } };
  const clear = (name) => { if (timer[name]) {timers.clearTimeout(timer[name]);} timer[name] = null; };
  const clearAll = () => { for (const name of Object.keys(timer)) {clear(name);} };

  function kill(target) {
    if (!target || (target.exitCode !== null && target.exitCode !== undefined)) {return Promise.resolve();}
    return new Promise((resolve) => {
      let done = false;
      let grace = null;
      const finish = () => { if (!done) { done = true; if (grace) {timers.clearTimeout(grace);} resolve(); } };
      target.once('exit', finish);
      try { target.kill('SIGTERM'); } catch (_error) { finish(); return; }
      grace = timers.setTimeout(() => {
        try { target.kill('SIGKILL'); } catch (_error) { /* already gone */ }
        finish();
      }, opts.stopGraceMs);
    });
  }

  function scheduleHealth(gen, delay) {
    clear('health');
    timer.health = timers.setTimeout(() => { checkHealth(gen); }, delay);
  }

  async function checkHealth(gen) {
    timer.health = null;
    if (gen !== generation) {return;}
    let problem = null;
    try {
      problem = await spec.check(state.url, { starting: state.process === 'starting' });
    } catch (error) {
      problem = error.message;
    }
    if (gen !== generation) {return;}
    if (!problem) {
      healthFailures = 0;
      const first = !state.healthy;
      Object.assign(state, { healthy: true, answeredOnce: true, lastHealthError: null });
      if (state.process === 'starting') {
        state.process = 'running';
        clear('start');
        clear('stable');
        timer.stable = timers.setTimeout(() => { state.restarts = 0; emit(); }, opts.stableResetMs);
        log.info(`[${label}] ${role} server is ready on ${state.url}`);
      }
      if (first) {emit();}
      scheduleHealth(gen, opts.healthIntervalRunningMs);
      return;
    }
    healthFailures += 1;
    const wasHealthy = state.healthy;
    Object.assign(state, { healthy: false, lastHealthError: problem });
    if (state.process === 'running' && healthFailures >= opts.maxHealthFailures) {
      log.warn(`[${label}] ${role} server stopped answering (${problem}); restarting`);
      restart(gen, 'unhealthy');
      return;
    }
    if (wasHealthy) {emit();}
    scheduleHealth(gen, state.process === 'starting' ? opts.healthIntervalStartingMs : opts.healthIntervalRunningMs);
  }

  function scheduleRestart(gen) {
    state.restarts += 1;
    const delay = Math.min(opts.maxBackoffMs, opts.minBackoffMs * 2 ** (state.restarts - 1));
    state.process = 'restarting';
    emit();
    log.warn(`[${label}] restarting the ${role} server in ${delay} ms (restart ${state.restarts})`);
    clear('restart');
    timer.restart = timers.setTimeout(() => {
      timer.restart = null;
      if (gen === generation) {launch(gen);}
    }, delay);
  }

  function restart(gen, why) {
    const target = child;
    child = null;
    clear('health');
    clear('start');
    clear('stable');
    Object.assign(state, { healthy: false, pid: null, lastExit: { reason: why, at: new Date(now()).toISOString() } });
    kill(target).then(() => { if (gen === generation) {scheduleRestart(gen);} });
  }

  function launch(gen) {
    Object.assign(state, { process: 'starting', healthy: false });
    healthFailures = 0;
    let spawned;
    try {
      spawned = spawn(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (error) {
      log.error(`[${label}] could not start the ${role} server: ${error.message}`);
      state.lastExit = { reason: 'spawn_failed', message: error.message, at: new Date(now()).toISOString() };
      scheduleRestart(gen);
      return;
    }
    child = spawned;
    state.pid = spawned.pid || null;
    log.info(`[${label}] ${role} server started (pid ${state.pid}) on ${state.url}`);
    const sink = openLog(role);
    if (sink) {
      if (spawned.stdout) {spawned.stdout.pipe(sink, { end: false });}
      if (spawned.stderr) {spawned.stderr.pipe(sink, { end: false });}
    }
    spawned.on('error', (error) => log.error(`[${label}] ${role} server process error: ${error.message}`));
    spawned.on('exit', (code, signal) => {
      if (sink) {sink.end();}
      if (child !== spawned) {return;} // stopped or replaced on purpose
      child = null;
      clear('health');
      clear('start');
      clear('stable');
      Object.assign(state, { pid: null, healthy: false, lastExit: { reason: 'exited', code, signal, at: new Date(now()).toISOString() } });
      log.warn(`[${label}] ${role} server exited (code ${code}, signal ${signal})`);
      if (gen === generation) {scheduleRestart(gen);}
    });
    timer.start = timers.setTimeout(() => {
      timer.start = null;
      if (gen === generation && child === spawned && state.process === 'starting') {
        log.warn(`[${label}] ${role} server did not answer in ${opts.startTimeoutMs} ms; restarting`);
        restart(gen, 'start_timeout');
      }
    }, opts.startTimeoutMs);
    emit();
    scheduleHealth(gen, opts.healthIntervalStartingMs);
  }

  /**
   * Run it: { command, args, cwd?, env?, port, check }. `check(url, { starting })` answers null
   * when the server is fine, or a short reason when it is not.
   */
  function start(next) {
    generation += 1;
    spec = next;
    Object.assign(state, { port: next.port, url: `http://${LOOPBACK_HOST}:${next.port}`, restarts: 0, lastExit: null, answeredOnce: false });
    launch(generation);
  }

  async function stop() {
    generation += 1;
    clearAll();
    const target = child;
    child = null;
    await kill(target);
    Object.assign(state, { process: 'stopped', pid: null, healthy: false, port: null, url: null, answeredOnce: false });
    emit();
  }

  return { start, stop, getState: () => ({ ...state }) };
}

module.exports = { createKeptProcess, DEFAULTS };
