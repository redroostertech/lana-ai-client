'use strict';

/**
 * Pip on this computer (docs/plans/first-launch-local-ai-plan.md, phase C). Main process.
 *
 * Pip is LANA's AI server (`lqe` from LANA.cpp v3.0.0). Once the first-launch downloads are in
 * place, this module runs up to two Pip servers from the plan:
 *
 *   chat       the chosen chat model, its image reading file when the plan has one, the
 *              conversation size per slot and the slot count from the plan.
 *   embedding  the pinned nomic file, with the settings the server already uses.
 *
 * Each server gets its own settings file in <userData>/pip, listens on 127.0.0.1 only (chat
 * prefers 8081, embedding 8082, any free port when one is taken), and is checked on /health
 * until it answers "ok" with the planned model file. A server that exits or stops answering
 * is restarted, waiting 1 second, then 2, 4 and so on up to 60. On quit each gets SIGTERM, and
 * SIGKILL after a grace period.
 *
 * When every server it started has answered once, onAddresses gets their addresses and the chat
 * model file, which the local engine passes on as LANA_ENGINE_CHAT_URL,
 * LANA_ENGINE_EMBEDDING_URL and LANA_TOKENIZER_GGUF (so it counts tokens with the chat model's
 * own vocabulary). A role the
 * plan sends to the cloud, or whose address the environment already names (a developer's own
 * Pip), is not started here.
 *
 * Plain CommonJS with spawn, fetch, the port picker, files and timers injected, so it runs
 * under Jest without Electron.
 */

const path = require('path');

const LOOPBACK_HOST = '127.0.0.1';
const PREFERRED_PORTS = Object.freeze({ chat: 8081, embedding: 8082 });
const ADDRESS_ENV = Object.freeze({ chat: 'LANA_ENGINE_CHAT_URL', embedding: 'LANA_ENGINE_EMBEDDING_URL' });

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

/** Processor threads: leave two for the rest of the computer, at most 10 (Pip Desktop's default). */
function threadsFor(cores) {
  const count = Number.isInteger(cores) && cores > 0 ? cores : 4;
  return Math.max(1, Math.min(10, count - 2));
}

function usesGraphics(hardware) {
  const backend = hardware && hardware.accelerator && hardware.accelerator.backend;
  return backend === 'metal' || backend === 'cuda';
}

/**
 * The chat server's settings, from Pip Desktop v2's defaults and the plan. `ctx` is per slot.
 * No session folder: conversations are not written to disk.
 */
function chatConfig({ modelPath, mmprojPath = null, port, contextTokens, parallel, hardware = {} }) {
  const config = {
    model: modelPath,
    host: LOOPBACK_HOST,
    port,
    ctx: contextTokens,
    parallel,
    kv_type: 'q8_0',
    gpu_layers: usesGraphics(hardware) ? 99 : 0,
    gpu_output: usesGraphics(hardware),
    threads: threadsFor(hardware.cores),
    ubatch: 512,
    fair_chunk: 64,
    queue_timeout: 300,
    max_body_mb: 32
  };
  if (mmprojPath) {config.mmproj = mmprojPath;}
  // Keeps the model in graphics memory between questions (Apple only); without it the first
  // question after a few idle minutes waited 15 to 32 seconds.
  if (hardware.platform === 'darwin') {config.metal_residency_keep_alive_s = 86400;}
  return config;
}

/** The embedding server's settings: the same ones the server's own Pip uses for nomic. */
function embeddingConfig({ modelPath, port, hardware = {} }) {
  return {
    model: modelPath,
    role: 'embed',
    alias: 'nomic-embed-text',
    host: LOOPBACK_HOST,
    port,
    ctx: 2048,
    ubatch: 2048,
    parallel: 1,
    threads: Math.min(4, threadsFor(hardware.cores)),
    queue_timeout: 20,
    embed_prefix_policy: 'none',
    embed_empty_input: 'refuse',
    embed_max_batch: 256
  };
}

/**
 * Where `lqe` is: LANA_PIP_BINARY (a developer's build), else inside the installed app
 * (<resources>/pip/lqe, lqe.exe on Windows). Null when there is none, so chat uses the cloud.
 */
function resolvePipBinary({ env = {}, resourcesPath = null, isPackaged = false, platform = process.platform, fileExists }) {
  if (typeof env.LANA_PIP_BINARY === 'string' && env.LANA_PIP_BINARY.trim()) {
    const file = path.resolve(env.LANA_PIP_BINARY.trim());
    return fileExists(file) ? file : null;
  }
  if (!isPackaged || !resourcesPath) {return null;}
  const file = path.join(resourcesPath, 'pip', platform === 'win32' ? 'lqe.exe' : 'lqe');
  return fileExists(file) ? file : null;
}

/**
 * What the plan asks Pip to run: { chat, embedding }, each null or { settings without a port,
 * expectFile }. Roles whose address the environment names are left to that server.
 */
function wantedServers({ result, modelsDir, env = {} }) {
  const { plan, entries, hardware } = result;
  const fileOf = (id) => {
    const entry = id && entries.get(id);
    return entry ? path.join(modelsDir, entry.filename) : null;
  };
  const wanted = { chat: null, embedding: null };
  const chatFile = plan.chat.where === 'local' ? fileOf(plan.chat.id) : null;
  if (chatFile && !env[ADDRESS_ENV.chat]) {
    wanted.chat = {
      modelFile: chatFile,
      expectFile: path.basename(chatFile),
      settings: (port) => chatConfig({
        modelPath: chatFile,
        mmprojPath: fileOf(plan.vision.id),
        port,
        contextTokens: plan.chat.contextTokens,
        parallel: plan.chat.parallel,
        hardware
      })
    };
  }
  const embeddingFile = plan.embedding.where === 'local' ? fileOf(plan.embedding.id) : null;
  if (embeddingFile && !env[ADDRESS_ENV.embedding]) {
    wanted.embedding = {
      modelFile: embeddingFile,
      expectFile: path.basename(embeddingFile),
      settings: (port) => embeddingConfig({ modelPath: embeddingFile, port, hardware })
    };
  }
  return wanted;
}

/**
 * One Pip server process, kept running.
 * @returns {{ start(spec): void, stop(): Promise<void>, getState(): Object }}
 */
function createPipServer({ role, spawn, fetch, timers, now, log, openLog, onChange, options }) {
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
      const response = await fetch(`${state.url}/health`, { method: 'GET', timeoutMs: opts.healthTimeoutMs });
      if (!response.ok) {throw new Error(`health answered ${response.status}`);}
      const body = await response.json();
      const file = body && body.model_file && body.model_file.name;
      if (!body || body.status !== 'ok') {problem = `status ${body && body.status}`;}
      else if (file !== spec.expectFile) {problem = `serving ${file || 'no model'}, expected ${spec.expectFile}`;}
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
        log.info(`[pip] ${role} server is ready on ${state.url}`);
      }
      if (first) {emit();}
      scheduleHealth(gen, opts.healthIntervalRunningMs);
      return;
    }
    healthFailures += 1;
    const wasHealthy = state.healthy;
    Object.assign(state, { healthy: false, lastHealthError: problem });
    if (state.process === 'running' && healthFailures >= opts.maxHealthFailures) {
      log.warn(`[pip] ${role} server stopped answering (${problem}); restarting`);
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
    log.warn(`[pip] restarting the ${role} server in ${delay} ms (restart ${state.restarts})`);
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
      spawned = spawn(spec.binary, ['serve', '--config', spec.configFile], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (error) {
      log.error(`[pip] could not start the ${role} server: ${error.message}`);
      state.lastExit = { reason: 'spawn_failed', message: error.message, at: new Date(now()).toISOString() };
      scheduleRestart(gen);
      return;
    }
    child = spawned;
    state.pid = spawned.pid || null;
    log.info(`[pip] ${role} server started (pid ${state.pid}) on ${state.url}`);
    const sink = openLog(role);
    if (sink) {
      if (spawned.stdout) {spawned.stdout.pipe(sink, { end: false });}
      if (spawned.stderr) {spawned.stderr.pipe(sink, { end: false });}
    }
    spawned.on('error', (error) => log.error(`[pip] ${role} server process error: ${error.message}`));
    spawned.on('exit', (code, signal) => {
      if (sink) {sink.end();}
      if (child !== spawned) {return;} // stopped or replaced on purpose
      child = null;
      clear('health');
      clear('start');
      clear('stable');
      Object.assign(state, { pid: null, healthy: false, lastExit: { reason: 'exited', code, signal, at: new Date(now()).toISOString() } });
      log.warn(`[pip] ${role} server exited (code ${code}, signal ${signal})`);
      if (gen === generation) {scheduleRestart(gen);}
    });
    timer.start = timers.setTimeout(() => {
      timer.start = null;
      if (gen === generation && child === spawned && state.process === 'starting') {
        log.warn(`[pip] ${role} server did not answer in ${opts.startTimeoutMs} ms; restarting`);
        restart(gen, 'start_timeout');
      }
    }, opts.startTimeoutMs);
    emit();
    scheduleHealth(gen, opts.healthIntervalStartingMs);
  }

  /** Run with these settings: { binary, configFile, expectFile, port }. */
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

/**
 * The Pip servers this computer runs.
 *
 * @param {Object} deps
 * @param {string|null} deps.binary - resolvePipBinary(); null means Pip is not installed
 * @param {string} deps.dir - <userData>/pip: settings files and logs
 * @param {Function} deps.spawn
 * @param {Function} deps.fetch - (url, { timeoutMs }) => Response
 * @param {Function} deps.pickPort - async (preferred) => a free loopback port
 * @param {Object} [deps.fsImpl] - { mkdirSync, writeFileSync, createWriteStream }
 * @param {Object} [deps.env]
 * @param {Function} [deps.onAddresses] - ({ chat, embedding }) => void, each an address or null
 * @param {Function} [deps.onState]
 * @param {Object} [deps.timers]
 * @param {Function} [deps.now]
 * @param {Object} [deps.log]
 * @param {Object} [deps.options] - overrides for DEFAULTS
 */
function createPip(deps) {
  const {
    binary, dir, spawn, fetch, pickPort,
    fsImpl = require('fs'),
    env = {},
    onAddresses = () => {},
    onState = () => {},
    timers = { setTimeout, clearTimeout },
    now = () => Date.now(),
    log = { info() {}, warn() {}, error() {} },
    options = {}
  } = deps;

  const running = { chat: null, embedding: null }; // { server, key }
  let lastAddresses = JSON.stringify({ chat: null, embedding: null, chatModelFile: null });

  function openLog(role) {
    try { return fsImpl.createWriteStream(path.join(dir, `${role}.log`), { flags: 'w' }); } catch (_error) { return null; }
  }

  function addresses() {
    const out = { chat: null, embedding: null, chatModelFile: null };
    for (const role of Object.keys(running)) {
      const item = running[role];
      if (item && item.server.getState().answeredOnce) {
        out[role] = item.server.getState().url;
        if (role === 'chat') {out.chatModelFile = item.modelFile;}
      }
    }
    return out;
  }

  function getState() {
    const out = { installed: Boolean(binary), servers: {} };
    for (const role of Object.keys(running)) {out.servers[role] = running[role] ? running[role].server.getState() : null;}
    return out;
  }

  /** Addresses go out only once every server started has answered, and whenever they change after. */
  function changed() {
    try { onState(getState()); } catch (_error) { /* listener errors are not ours */ }
    const started = Object.values(running).filter(Boolean);
    if (started.some((item) => !item.server.getState().answeredOnce)) {return;}
    const now = JSON.stringify(addresses());
    if (now === lastAddresses) {return;}
    lastAddresses = now;
    try { onAddresses(JSON.parse(now)); } catch (_error) { /* listener errors are not ours */ }
  }

  async function stopRole(role) {
    const item = running[role];
    running[role] = null;
    if (item) {await item.server.stop();}
  }

  /**
   * Run what the plan asks for. A server whose settings did not change keeps running, so
   * changing the chat model restarts only the chat server.
   * @param {Object} result - electron-first-launch.js plan result (plan, entries, hardware)
   * @param {string} modelsDir
   */
  async function apply(result, modelsDir) {
    const wanted = binary ? wantedServers({ result, modelsDir, env }) : { chat: null, embedding: null };
    if (!binary) {log.warn('[pip] Pip is not installed on this computer; chat and embedding use the cloud');}
    fsImpl.mkdirSync(dir, { recursive: true });
    for (const role of Object.keys(running)) {
      const want = wanted[role];
      // Settings without the port: the same model and sizes mean the same server.
      const key = want ? JSON.stringify(want.settings(0)) : null;
      if (running[role] && running[role].key === key) {continue;}
      await stopRole(role);
      if (!want) {continue;}
      const port = await pickPort(PREFERRED_PORTS[role]);
      const configFile = path.join(dir, `${role}.json`);
      fsImpl.writeFileSync(configFile, `${JSON.stringify(want.settings(port), null, 2)}\n`);
      const server = createPipServer({ role, spawn, fetch, timers, now, log, openLog, onChange: changed, options });
      running[role] = { server, key, modelFile: want.modelFile };
      server.start({ binary, configFile, expectFile: want.expectFile, port });
    }
    changed();
    return getState();
  }

  async function stop() {
    await Promise.all(Object.keys(running).map(stopRole));
    changed();
  }

  return { apply, stop, getState, addresses };
}

/** What the engine is given for Pip: the servers that answered, and the chat model's vocabulary. */
function engineEndpoints(addresses) {
  const out = {};
  if (addresses.chat) {out.LANA_ENGINE_CHAT_URL = addresses.chat;}
  if (addresses.chat && addresses.chatModelFile) {out.LANA_TOKENIZER_GGUF = addresses.chatModelFile;}
  if (addresses.embedding) {out.LANA_ENGINE_EMBEDDING_URL = addresses.embedding;}
  return out;
}

module.exports = {
  createPip,
  engineEndpoints,
  createPipServer,
  chatConfig,
  embeddingConfig,
  wantedServers,
  resolvePipBinary,
  threadsFor,
  PREFERRED_PORTS,
  ADDRESS_ENV,
  DEFAULTS
};
