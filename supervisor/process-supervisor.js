/**
 * process-supervisor.js
 *
 * Dependency-ordered process manager for the LANA One sovereign stack. The
 * Electron main process registers each service (Postgres, MinIO, llama-server,
 * docling/unstructured, the Node backend) as a spec, then calls startAll(): the
 * supervisor spawns each in dependency order, waits for a readiness probe before
 * starting its dependents, and rolls back (stops everything already started) if
 * any critical service fails to come up. On unexpected exit of a running service
 * it restarts with capped exponential backoff. stopAll() tears everything down in
 * reverse order (SIGTERM, then SIGKILL after a grace period).
 *
 * All side-effecting collaborators (spawn, clock, logger) are injected so the
 * ordering / readiness / restart / rollback logic is unit-testable without real
 * processes. This is the fresh Node orchestration the packaging plan calls for;
 * it deliberately does NOT reuse the retired lana-gpt Python SidecarManager.
 */
'use strict';

const DEFAULTS = {
  readinessTimeoutMs: 60000,
  readinessIntervalMs: 500,
  stopGraceMs: 8000,
  restart: { maxRetries: 5, baseBackoffMs: 500, maxBackoffMs: 15000 },
};

// Topological sort of specs by their dependsOn edges; throws on a cycle or a
// reference to an unknown service so a mis-wired topology fails loud at start.
function topoOrder(specs) {
  const byName = new Map(specs.map((s) => [s.name, s]));
  const state = new Map(); // name -> 0 unvisited, 1 visiting, 2 done
  const order = [];
  function visit(name, chain) {
    const spec = byName.get(name);
    if (!spec) throw new Error(`unknown service dependency: ${name} (from ${chain.join(' -> ')})`);
    const st = state.get(name) || 0;
    if (st === 2) return;
    if (st === 1) throw new Error(`dependency cycle: ${[...chain, name].join(' -> ')}`);
    state.set(name, 1);
    for (const dep of spec.dependsOn || []) visit(dep, [...chain, name]);
    state.set(name, 2);
    order.push(spec);
  }
  for (const s of specs) visit(s.name, []);
  return order;
}

class ProcessSupervisor {
  /**
   * @param {object} deps
   * @param {function} deps.spawn  - (command, args, opts) -> child (EventEmitter with .pid, .kill, .stdout, .stderr)
   * @param {object}   deps.logger - { info, warn, error }
   * @param {object}   [deps.clock] - { now(), setTimeout(), clearTimeout() } (defaults to real timers)
   */
  constructor({ spawn, logger, clock } = {}) {
    if (typeof spawn !== 'function') throw new Error('ProcessSupervisor requires a spawn function');
    this._spawn = spawn;
    this._log = logger || { info() {}, warn() {}, error() {} };
    this._clock = clock || {
      now: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (t) => clearTimeout(t),
    };
    this._specs = new Map();     // name -> spec
    this._procs = new Map();     // name -> { child, spec, retries, stopping, started }
    this._startedOrder = [];     // names in the order they came up (for reverse teardown)
    this._shuttingDown = false;
  }

  /**
   * @param {object} spec
   * @param {string} spec.name
   * @param {string} spec.command
   * @param {string[]} [spec.args]
   * @param {object} [spec.env]
   * @param {string} [spec.cwd]
   * @param {string[]} [spec.dependsOn]
   * @param {boolean} [spec.critical=true] - if true, failure aborts startAll (rollback)
   * @param {function} [spec.readiness] - async () => boolean; polled until true or timeout
   * @param {number} [spec.readinessTimeoutMs]
   * @param {object} [spec.restart] - { maxRetries, baseBackoffMs, maxBackoffMs } | false to disable
   */
  register(spec) {
    if (!spec || !spec.name || !spec.command) throw new Error('register requires { name, command }');
    if (this._specs.has(spec.name)) throw new Error(`service already registered: ${spec.name}`);
    this._specs.set(spec.name, { critical: true, ...spec });
    return this;
  }

  isRunning(name) {
    const p = this._procs.get(name);
    return !!(p && p.child && !p.stopping && p.started);
  }

  /** Start all registered services in dependency order. Rolls back on a critical failure. */
  async startAll() {
    const order = topoOrder([...this._specs.values()]);
    for (const spec of order) {
      try {
        await this._startOne(spec);
        this._startedOrder.push(spec.name);
      } catch (err) {
        this._log.error(`[supervisor] ${spec.name} failed to start: ${err.message}`);
        if (spec.critical !== false) {
          await this.stopAll(); // rollback everything already up
          throw new Error(`stack startup aborted at ${spec.name}: ${err.message}`);
        }
        this._log.warn(`[supervisor] ${spec.name} is non-critical; continuing without it`);
      }
    }
    return this._startedOrder.slice();
  }

  async _startOne(spec) {
    // prepare() runs BEFORE spawn (e.g. Postgres initdb on first run).
    if (typeof spec.prepare === 'function') {
      this._log.info(`[supervisor] preparing ${spec.name}`);
      await spec.prepare();
    }
    this._log.info(`[supervisor] starting ${spec.name}: ${spec.command} ${(spec.args || []).join(' ')}`);
    const child = this._launch(spec);
    const rec = { child, spec, retries: 0, stopping: false, started: false };
    this._procs.set(spec.name, rec);
    await this._awaitReadiness(spec, rec);
    // onReady() runs AFTER readiness, BEFORE dependents (e.g. createdb + extensions
    // + migrate once Postgres is accepting connections).
    if (typeof spec.onReady === 'function') {
      this._log.info(`[supervisor] ${spec.name} post-ready init`);
      await spec.onReady();
    }
    rec.started = true;
    this._log.info(`[supervisor] ${spec.name} ready (pid ${child.pid})`);
  }

  _launch(spec) {
    const child = this._spawn(spec.command, spec.args || [], {
      env: { ...process.env, ...(spec.env || {}) },
      cwd: spec.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (child.stdout && child.stdout.on) child.stdout.on('data', (d) => this._drain(spec.name, 'out', d));
    if (child.stderr && child.stderr.on) child.stderr.on('data', (d) => this._drain(spec.name, 'err', d));
    // A spawn failure (e.g. ENOENT for a missing/optional binary) emits 'error',
    // NOT 'exit'. Without this handler the unhandled event crashes the process.
    // Record it on the child so readiness bails fast, and surface it as a failure.
    child.on('error', (err) => {
      child._spawnError = err;
      this._log.error(`[supervisor] ${spec.name} spawn error: ${err.message}`);
    });
    child.on('exit', (code, signal) => this._onExit(spec.name, code, signal));
    return child;
  }

  _drain(name, stream, data) {
    const line = String(data).trimEnd();
    if (line) this._log.info(`[${name}:${stream}] ${line}`);
  }

  _onExit(name, code, signal) {
    const rec = this._procs.get(name);
    if (!rec) return;
    if (rec.stopping || this._shuttingDown) {
      this._log.info(`[supervisor] ${name} stopped (code=${code} signal=${signal})`);
      return;
    }
    // Unexpected exit of a running service — restart with backoff.
    this._log.warn(`[supervisor] ${name} exited unexpectedly (code=${code} signal=${signal})`);
    const policy = rec.spec.restart === false ? null : { ...DEFAULTS.restart, ...(rec.spec.restart || {}) };
    if (!policy || rec.retries >= policy.maxRetries) {
      this._log.error(`[supervisor] ${name} exceeded restart retries; leaving down`);
      rec.started = false;
      return;
    }
    rec.retries += 1;
    const backoff = Math.min(policy.maxBackoffMs, policy.baseBackoffMs * 2 ** (rec.retries - 1));
    this._log.warn(`[supervisor] restarting ${name} in ${backoff}ms (attempt ${rec.retries}/${policy.maxRetries})`);
    this._clock.setTimeout(() => {
      if (this._shuttingDown) return;
      rec.child = this._launch(rec.spec);
      // Best-effort readiness re-check; failures will surface on the next probe/exit.
      this._awaitReadiness(rec.spec, rec).then(
        () => { rec.started = true; this._log.info(`[supervisor] ${name} recovered`); },
        (e) => this._log.error(`[supervisor] ${name} restart not ready: ${e.message}`),
      );
    }, backoff);
  }

  async _awaitReadiness(spec, rec) {
    if (typeof spec.readiness !== 'function') return; // no probe = ready on spawn
    const timeoutMs = spec.readinessTimeoutMs || DEFAULTS.readinessTimeoutMs;
    const intervalMs = spec.readinessIntervalMs || DEFAULTS.readinessIntervalMs;
    const deadline = this._clock.now() + timeoutMs;
    for (;;) {
      if (rec.stopping) throw new Error('stopped before ready');
      // Bail fast if the process failed to spawn (e.g. a missing optional binary).
      if (rec.child && rec.child._spawnError) throw new Error(`spawn failed: ${rec.child._spawnError.message}`);
      let ok = false;
      try { ok = await spec.readiness(); } catch (_e) { ok = false; }
      if (ok) return;
      if (this._clock.now() >= deadline) throw new Error(`readiness timeout after ${timeoutMs}ms`);
      await this._sleep(intervalMs);
    }
  }

  _sleep(ms) {
    return new Promise((resolve) => this._clock.setTimeout(resolve, ms));
  }

  /** Stop everything in reverse start order. Idempotent. */
  async stopAll() {
    this._shuttingDown = true;
    const names = this._startedOrder.length
      ? this._startedOrder.slice().reverse()
      : [...this._procs.keys()].reverse();
    for (const name of names) {
      // eslint-disable-next-line no-await-in-loop
      await this._stopOne(name);
    }
    this._startedOrder = [];
  }

  async _stopOne(name) {
    const rec = this._procs.get(name);
    if (!rec || !rec.child) return;
    rec.stopping = true;
    const child = rec.child;
    this._log.info(`[supervisor] stopping ${name} (pid ${child.pid})`);
    let exited = false;
    const onExit = () => { exited = true; };
    child.once('exit', onExit);
    try { child.kill('SIGTERM'); } catch (_e) { /* already gone */ }
    const grace = rec.spec.stopGraceMs || DEFAULTS.stopGraceMs;
    const deadline = this._clock.now() + grace;
    while (!exited && this._clock.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      await this._sleep(100);
    }
    if (!exited) {
      this._log.warn(`[supervisor] ${name} did not exit in ${grace}ms; SIGKILL`);
      try { child.kill('SIGKILL'); } catch (_e) { /* already gone */ }
    }
    this._procs.delete(name);
  }
}

module.exports = { ProcessSupervisor, topoOrder };
