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
 * until it answers "ok" with the planned model file. Restarts and stopping are
 * electron-process-keeper.js.
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
const { createKeptProcess, DEFAULTS } = require('./electron-process-keeper');

const LOOPBACK_HOST = '127.0.0.1';
const PREFERRED_PORTS = Object.freeze({ chat: 8081, embedding: 8082 });
const ADDRESS_ENV = Object.freeze({ chat: 'LANA_ENGINE_CHAT_URL', embedding: 'LANA_ENGINE_EMBEDDING_URL' });


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

/** Pip is ready when /health says "ok" and names the planned model file. */
async function checkPipHealth(fetch, url, expectFile, options = {}) {
  const response = await fetch(`${url}/health`, { method: 'GET', timeoutMs: options.healthTimeoutMs || DEFAULTS.healthTimeoutMs });
  if (!response.ok) {return `health answered ${response.status}`;}
  const body = await response.json();
  const file = body && body.model_file && body.model_file.name;
  if (!body || body.status !== 'ok') {return `status ${body && body.status}`;}
  if (file !== expectFile) {return `serving ${file || 'no model'}, expected ${expectFile}`;}
  return null;
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
      const server = createKeptProcess({ name: role, label: 'pip', spawn, timers, now, log, openLog, onChange: changed, options });
      running[role] = { server, key, modelFile: want.modelFile };
      server.start({ command: binary, args: ['serve', '--config', configFile], port, check: (url) => checkPipHealth(fetch, url, want.expectFile, options) });
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
  chatConfig,
  embeddingConfig,
  wantedServers,
  resolvePipBinary,
  threadsFor,
  PREFERRED_PORTS,
  ADDRESS_ENV,
  DEFAULTS
};
