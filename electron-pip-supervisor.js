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
const levers = require('./electron-pip-levers');
const fit = require('./src/js/local-ai-fit.model');

const LOOPBACK_HOST = '127.0.0.1';
const PREFERRED_PORTS = Object.freeze({ chat: 8081, embedding: 8082 });
const ADDRESS_ENV = Object.freeze({ chat: 'LANA_ENGINE_CHAT_URL', embedding: 'LANA_ENGINE_EMBEDDING_URL' });


/** Processor threads: leave two for the rest of the computer, at most 10 (Pip Desktop's default). */
function threadsFor(cores) {
  const count = Number.isInteger(cores) && cores > 0 ? cores : 4;
  return Math.max(1, Math.min(10, count - 2));
}

/**
 * The chat server's settings: the plan's model, context per slot and slot count, with this
 * computer's speed settings (electron-pip-levers.js). No session folder: conversations are not
 * written to disk. `chosen` is chatLevers() for these inputs; flags without a settings-file key
 * (--flash-attn, --repack) are in chosen.args.
 */
function chatConfig({ modelPath, mmprojPath = null, port, contextTokens, parallel, hardware = {}, accepts = {}, chosen = null }) {
  const picked = chosen || levers.chatLevers({ hardware, contextTokens, slots: parallel, modelFile: modelPath, accepts });
  const config = {
    model: modelPath,
    host: LOOPBACK_HOST,
    port,
    ...picked.config,
    queue_timeout: 300,
    max_body_mb: 32
  };
  // An old engine keeps the old thread count; otherwise the levers set 4 on a graphics chip and
  // leave the processor-only count to the engine (its physical cores).
  if (picked.stale) {config.threads = threadsFor(hardware.cores);}
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
 * The computer as chat's speed settings see it: an AMD or Intel chip (vulkan) counts as processor
 * only when the plan was sized for the processor (local-ai-fit.model.js found no fit on the chip)
 * or Vulkan already failed in this run (cpuOnly). Every other computer is as read.
 */
function leverHardware(result, cpuOnly) {
  const hardware = result.hardware || {};
  const accel = hardware.accelerator || {};
  if (accel.backend !== 'vulkan') {return hardware;}
  const planned = result.computer && result.computer.backend;
  if (!cpuOnly && (!planned || planned === 'vulkan')) {return hardware;}
  return { ...hardware, accelerator: { ...accel, backend: 'cpu' } };
}

/**
 * What the plan asks Pip to run: { chat, embedding }, each null or { settings without a port,
 * expectFile }. Roles whose address the environment names are left to that server. cpuOnly: run
 * chat on the processor even where the plan chose Vulkan (after Vulkan failed once).
 */
function wantedServers({ result, modelsDir, env = {}, accepts = {}, cpuOnly = false }) {
  const { plan, entries } = result;
  const hardware = leverHardware(result, cpuOnly);
  const fileOf = (id) => {
    const entry = id && entries.get(id);
    return entry ? path.join(modelsDir, entry.filename) : null;
  };
  const wanted = { chat: null, embedding: null };
  const chatFile = plan.chat.where === 'local' ? fileOf(plan.chat.id) : null;
  if (chatFile && !env[ADDRESS_ENV.chat]) {
    const chosen = levers.chatLevers({ hardware, contextTokens: plan.chat.contextTokens, slots: plan.chat.parallel, poolTokens: plan.chat.poolTokens, modelFile: chatFile, accepts });
    wanted.chat = {
      modelFile: chatFile,
      expectFile: path.basename(chatFile),
      levers: chosen,
      args: chosen.args,
      settings: (port) => chatConfig({
        modelPath: chatFile,
        mmprojPath: fileOf(plan.vision.id),
        port,
        contextTokens: plan.chat.contextTokens,
        parallel: plan.chat.parallel,
        hardware,
        chosen
      })
    };
  }
  const embeddingFile = plan.embedding.where === 'local' ? fileOf(plan.embedding.id) : null;
  if (embeddingFile && !env[ADDRESS_ENV.embedding]) {
    wanted.embedding = {
      modelFile: embeddingFile,
      expectFile: path.basename(embeddingFile),
      args: [],
      settings: (port) => embeddingConfig({ modelPath: embeddingFile, port, hardware })
    };
  }
  return wanted;
}

/**
 * Memory the graphics chip must keep for Pip on Apple silicon: chat (model, pool, recurrent state,
 * shared prompts), its image file and the embedding model. Null when a file's size is unknown.
 */
function metalNeedBytes({ result, wanted }) {
  const { plan, entries, hardware } = result;
  const entry = (id) => (id && entries.get(id)) || null;
  const chat = wanted.chat && entry(plan.chat.id);
  if (!chat || !chat.sizeBytes || !chat.family) {return null;}
  let bytes = fit.chatBytes(chat, plan.chat.contextTokens, wanted.chat.levers.slots, 'metal', hardware.totalMemoryBytes, wanted.chat.levers.config.ctx_pool);
  const vision = entry(plan.vision && plan.vision.id);
  if (vision && vision.sizeBytes) {bytes += vision.sizeBytes;}
  const embedding = wanted.embedding && entry(plan.embedding.id);
  if (embedding && embedding.sizeBytes) {bytes += embedding.sizeBytes;}
  return bytes;
}

/** What the engine status shows when Pip cannot start on this computer. */
const MISSING_FILE_MESSAGE = 'LANA\'s local engine could not start: a required system file is missing.';
/** Windows' "a DLL it needs was not found" (STATUS_DLL_NOT_FOUND), as an unsigned and a signed exit. */
const DLL_NOT_FOUND = [0xC0000135, -1073741515];

/**
 * The bundled Vulkan loader's folder, beside lqe (pip/pip-pin.json vulkanLoader). Not lqe's own
 * folder on purpose: Windows looks there before System32, and the Linux lqe has RUNPATH $ORIGIN,
 * so a copy there would put every computer with its own loader on this one instead.
 */
const VULKAN_FALLBACK_DIR = 'vulkan-fallback';

/**
 * What the fallback looks like on each platform: the loader file, the variable that puts its
 * folder in the search, how that variable joins folders, and how a missing loader shows.
 */
const FALLBACK = Object.freeze({
  win32: {
    loader: 'vulkan-1.dll',
    variable: 'PATH',
    separator: ';',
    missing: (run) => Boolean(run && (DLL_NOT_FOUND.includes(run.status) || (run.error && /0xC0000135|dll/i.test(String(run.error.message || ''))))),
    explain: 'Windows could not load a DLL it needs (0xC0000135)'
  },
  linux: {
    loader: 'libvulkan.so.1',
    variable: 'LD_LIBRARY_PATH',
    separator: ':',
    missing: (run) => Boolean(run && /error while loading shared libraries: libvulkan\.so\.1/.test(`${run.stderr || ''}\n${run.error ? run.error.message : ''}`)),
    explain: 'the system could not load libvulkan.so.1 ("error while loading shared libraries")'
  }
});

/** True when a --version run on Windows failed because a DLL was missing (0xC0000135). */
function dllNotFound(run) {
  return FALLBACK.win32.missing(run);
}

/**
 * `env` with `dir` first on `variable`, whatever case the name has (Windows keeps PATH as "Path").
 * Windows searches PATH after System32, and Linux searches LD_LIBRARY_PATH before RUNPATH; either
 * way it is set only when lqe found no loader of its own, so it only fills the gap.
 */
function withFallbackPath(env, dir, variable = 'PATH', separator = ';') {
  const out = { ...env };
  const key = Object.keys(out).find((name) => name.toUpperCase() === variable) || variable;
  out[key] = out[key] ? `${dir}${separator}${out[key]}` : dir;
  return out;
}

/**
 * Before any server starts on Windows and Linux: (a) lqe --version as it is, so a computer with
 * its own Vulkan loader uses it; (b) only when that fails because the loader is missing, again
 * with the bundled loader's folder first on PATH (Windows) or LD_LIBRARY_PATH (Linux); (c) when
 * that answers, the servers start with the same environment. Returns { env } (null env: nothing
 * changed) or { problem: { warning, message } } when lqe still cannot start, so no server starts
 * and nothing restarts.
 *
 * @param {string} binary
 * @param {Function} runVersion - (binary, env|undefined) => spawnSync result
 * @param {Object} baseEnv - the environment servers would otherwise get
 * @param {string} [platform] - 'win32' or 'linux'
 */
function fallbackStart(binary, runVersion, baseEnv, platform = 'win32') {
  const rules = FALLBACK[platform];
  const first = runVersion(binary, undefined);
  if (first && !first.error && first.status === 0) {return { env: null, fallback: false };}
  const fallbackDir = path.join(path.dirname(binary), VULKAN_FALLBACK_DIR);
  if (rules && rules.missing(first)) {
    const env = withFallbackPath(baseEnv, fallbackDir, rules.variable, rules.separator);
    const second = runVersion(binary, env);
    if (second && !second.error && second.status === 0) {return { env, fallback: true };}
    return { problem: versionProblem(binary, second, fallbackDir, platform) };
  }
  return { problem: versionProblem(binary, first, fallbackDir, platform) };
}

/** fallbackStart on Windows. */
function windowsStart(binary, runVersion, baseEnv) {
  return fallbackStart(binary, runVersion, baseEnv, 'win32');
}

/**
 * The warning and status for a lqe that would not start: it fails the same way every time, so
 * starting servers would only restart forever.
 *
 * @param {{ status: number|null, error?: Error, stderr?: string }} run - spawnSync(binary, ['--version'])
 */
function versionProblem(binary, run, fallbackDir = path.join(path.dirname(binary), VULKAN_FALLBACK_DIR), platform = 'win32') {
  if (run && !run.error && run.status === 0) {return null;}
  const rules = FALLBACK[platform] || FALLBACK.win32;
  const loader = path.join(fallbackDir, rules.loader);
  const why = rules.missing(run)
    ? `${rules.explain}, even with the bundled Vulkan loader's folder on ${rules.variable}. lqe needs ${rules.loader}; the installer carries it at ${loader} (pip/pip-pin.json vulkanLoader)`
    : `it exited with ${run && run.error ? run.error.message : `code ${run && run.status}`}${run && run.stderr ? `: ${String(run.stderr).trim().slice(0, 200)}` : ''}; if a library is missing, lqe needs ${rules.loader}, which the installer carries at ${loader}`;
  return {
    warning: `[pip] ${binary} --version failed, so Pip is not started and chat and search use the cloud: ${why}`,
    message: MISSING_FILE_MESSAGE
  };
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
 * @param {Object} [deps.accepts] - electron-pip-levers.js readAccepts() for `binary`, read once per
 *   app start (so again after every update)
 * @param {Function} [deps.readWiredLimitMb] - () => iogpu.wired_limit_mb on Apple silicon, or null
 * @param {string} [deps.platform] - process.platform
 * @param {Function} [deps.runVersion] - (binary, env) => spawnSync(binary, ['--version'], { env })
 *   result; asked on Windows and Linux before any server starts (fallbackStart)
 * @param {Function} [deps.onProblem] - (message|null) => void, for the engine status
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
    options = {},
    accepts = {},
    readWiredLimitMb = () => null,
    platform = process.platform,
    runVersion = (file, runEnv) => require('child_process').spawnSync(file, ['--version'], { encoding: 'utf8', timeout: 10000, windowsHide: true, ...(runEnv ? { env: runEnv } : {}) }),
    onProblem = () => {}
  } = deps;
  let problem = null;
  // The environment the servers start with: null keeps the app's own; set when the bundled Vulkan
  // loader is needed (windowsStart).
  let serverEnv = null;
  let fallbackLogged = false;
  // Vulkan (AMD or Intel graphics) failed once in this run: chat runs on the processor from then
  // on, so a chip that cannot run Pip costs one restart, never a loop.
  let vulkanFailed = false;
  let lastApply = null;

  function setProblem(next) {
    if (next === problem) {return;}
    problem = next;
    try { onProblem(problem); } catch (_error) { /* listener errors are not ours */ }
  }

  const running = { chat: null, embedding: null }; // { server, key }
  let lastAddresses = JSON.stringify({ chat: null, embedding: null, chatModelFile: null, chatSlots: null });

  /**
   * The server's log file. For chat, every line is also read for an "is off:" line that turns off
   * a lever LANA asked for, which becomes a logged warning.
   */
  // The chat server's first lines since its latest launch, for the startup checks.
  const STARTUP_LINES = 400;
  let startupLines = [];

  function openLog(role, requested = null) {
    let file;
    try { file = fsImpl.createWriteStream(path.join(dir, `${role}.log`), { flags: 'w' }); } catch (_error) { return null; }
    if (!requested) {return file;}
    startupLines = [];
    const { Writable } = require('stream');
    const scanner = levers.lineScanner((line) => {
      if (startupLines.length < STARTUP_LINES) {startupLines.push(line);}
      const warning = levers.offWarning(line, requested);
      if (warning) {log.warn(warning);}
    });
    const tee = new Writable({
      write(chunk, _encoding, done) { scanner.write(chunk); file.write(chunk); done(); },
      final(done) { scanner.end(); file.end(); done(); }
    });
    return tee;
  }

  async function getJson(url) {
    const response = await fetch(url, { method: 'GET', timeoutMs: options.healthTimeoutMs || DEFAULTS.healthTimeoutMs });
    return response.ok ? response.json() : null;
  }

  /** How often /metrics is read until enough traffic has run to judge batching (lazily). */
  const METRICS_EVERY_MS = options.batchMetricsEveryMs || 5 * 60 * 1000;
  let metricsTimer = null;

  function stopMetricsCheck() {
    if (metricsTimer) {timers.clearTimeout(metricsTimer);}
    metricsTimer = null;
  }

  /** Once real traffic has run, check once that batched decode took a step; never blocks start. */
  function scheduleMetricsCheck(url, chosen) {
    stopMetricsCheck();
    if (!chosen.expect.batching) {return;}
    const tick = async () => {
      metricsTimer = null;
      let verdict = { ready: false, problem: null };
      try {
        const response = await fetch(`${url}/metrics`, { method: 'GET', timeoutMs: options.healthTimeoutMs || DEFAULTS.healthTimeoutMs });
        if (response.ok) {verdict = levers.batchMetricsProblem(await response.text(), chosen);}
      } catch (_error) { /* not answering now; the health check reports that */ }
      if (verdict.problem) {log.warn(`[pip] chat: ${verdict.problem}`);}
      if (!verdict.ready) {
        metricsTimer = timers.setTimeout(tick, METRICS_EVERY_MS);
        if (metricsTimer && metricsTimer.unref) {metricsTimer.unref();}
      }
    };
    metricsTimer = timers.setTimeout(tick, METRICS_EVERY_MS);
    if (metricsTimer && metricsTimer.unref) {metricsTimer.unref();}
  }

  /**
   * Ready check for one server: /health first; then, once per launch, the chat server's startup
   * lines, /health and /props against what it was asked for, and later (lazily) /metrics.
   * A mismatch is logged, not a restart.
   */
  /**
   * Chat on Vulkan did not start, found no device, or left the model off the chip: warn, and run
   * chat once more with the processor-only settings. Only once per run.
   */
  function vulkanFallback(why) {
    if (vulkanFailed || !lastApply) {return;}
    vulkanFailed = true;
    log.warn(`[pip] chat: Vulkan on this computer's graphics chip did not work (${why}); restarting chat once on the processor`);
    const { result, modelsDir } = lastApply;
    Promise.resolve().then(() => apply(result, modelsDir)).catch((error) => log.error(`[pip] chat: could not restart on the processor: ${error.message}`));
  }

  /** A Vulkan chat server that exits, fails to spawn or times out before it ever answered. */
  function watchVulkanStart(want) {
    if (!want.levers || want.levers.backend !== 'vulkan') {return () => {}; }
    return (state) => {
      if (state.process === 'restarting' && !state.answeredOnce && state.lastExit) {
        const exit = state.lastExit;
        vulkanFallback(exit.reason === 'exited' ? `it exited with code ${exit.code}${exit.signal ? `, signal ${exit.signal}` : ''} before answering` : `${exit.reason.replace('_', ' ')} before answering`);
      }
    };
  }

  function readyCheck(want) {
    return async (url, { starting = false } = {}) => {
      const problem = await checkPipHealth(fetch, url, want.expectFile, options);
      // The check that first passes after a launch is the one made while starting.
      if (problem || !starting || !want.levers) {return problem;}
      const warn = (issue) => log.warn(`[pip] chat: ${issue}`);
      const unused = levers.gpuUnused(startupLines, want.levers);
      if (unused) {
        // Not ready: its address is never handed on, and the processor-only server replaces it.
        vulkanFallback(unused);
        return unused;
      }
      levers.verifyStartup(startupLines, want.levers).forEach(warn);
      try {
        levers.verifyHealth(await getJson(`${url}/health`), want.levers, startupLines).forEach(warn);
        levers.verifyProps(await getJson(`${url}/props`), want.levers).forEach(warn);
      } catch (error) {
        warn(`/health or /props could not be read (${error.message})`);
      }
      scheduleMetricsCheck(url, want.levers);
      return null;
    };
  }

  function addresses() {
    const out = { chat: null, embedding: null, chatModelFile: null, chatSlots: null };
    for (const role of Object.keys(running)) {
      const item = running[role];
      if (item && item.server.getState().answeredOnce) {
        out[role] = item.server.getState().url;
        if (role === 'chat') {Object.assign(out, { chatModelFile: item.modelFile, chatSlots: item.slots });}
      }
    }
    return out;
  }

  function getState() {
    const out = { installed: Boolean(binary), problem, servers: {} };
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
    if (role === 'chat') {stopMetricsCheck();}
    if (item) {await item.server.stop();}
  }

  /**
   * Run what the plan asks for. A server whose settings did not change keeps running, so
   * changing the chat model restarts only the chat server.
   * @param {Object} result - electron-first-launch.js plan result (plan, entries, hardware)
   * @param {string} modelsDir
   */
  async function apply(result, modelsDir) {
    lastApply = { result, modelsDir };
    let wanted = binary ? wantedServers({ result, modelsDir, env, accepts, cpuOnly: vulkanFailed }) : { chat: null, embedding: null };
    if (!binary) {log.warn('[pip] Pip is not installed on this computer; chat and embedding use the cloud');}
    if (binary && FALLBACK[platform] && (wanted.chat || wanted.embedding)) {
      const start = fallbackStart(binary, runVersion, env, platform);
      serverEnv = start.env || null;
      if (start.problem) {
        log.warn(start.problem.warning);
        wanted = { chat: null, embedding: null };
      } else if (start.fallback && !fallbackLogged) {
        fallbackLogged = true;
        log.info(`[pip] this computer has no Vulkan loader of its own, so Pip uses the bundled one (${path.join(path.dirname(binary), VULKAN_FALLBACK_DIR)})`);
      }
      setProblem(start.problem ? start.problem.message : null);
    }
    fsImpl.mkdirSync(dir, { recursive: true });
    if (wanted.chat) {
      const chosen = wanted.chat.levers;
      log.info(`[pip] chat: ${chosen.backend}, ${chosen.slots} slot(s)${chosen.stale ? ', an older Pip without the newer speed settings' : ''}; flags ${JSON.stringify(chosen.config)} ${chosen.args.join(' ')}`.trim());
      if (chosen.backend === 'metal') {
        const needBytes = metalNeedBytes({ result, wanted });
        const warning = needBytes && levers.wiredLimitProblem({ wiredLimitMb: readWiredLimitMb(), totalMemoryBytes: result.hardware.totalMemoryBytes, needBytes });
        if (warning) {log.warn(warning);}
      }
    }
    for (const role of Object.keys(running)) {
      const want = wanted[role];
      // Settings and flags without the port: the same model, sizes and levers mean the same server.
      const key = want ? JSON.stringify([want.settings(0), want.args, Boolean(serverEnv)]) : null;
      if (running[role] && running[role].key === key) {continue;}
      await stopRole(role);
      if (!want) {continue;}
      const port = await pickPort(PREFERRED_PORTS[role]);
      const configFile = path.join(dir, `${role}.json`);
      fsImpl.writeFileSync(configFile, `${JSON.stringify(want.settings(port), null, 2)}\n`);
      const requested = want.levers ? want.levers.requested : null;
      const watch = watchVulkanStart(want);
      const server = createKeptProcess({ name: role, label: 'pip', spawn, timers, now, log, openLog: (name) => openLog(name, requested), onChange: (state) => { watch(state); changed(); }, options });
      running[role] = { server, key, modelFile: want.modelFile, slots: want.levers ? want.levers.slots : null };
      server.start({ command: binary, args: ['serve', '--config', configFile, ...want.args], port, check: readyCheck(want), ...(serverEnv ? { env: serverEnv } : {}) });
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

/**
 * What the engine is given for Pip: the servers that answered, the chat model's vocabulary, and
 * how many model calls it may run at once. The engine's queue (LANA-AI
 * src/shared/llm/llm-request-queue.js) otherwise takes its concurrency from its tier, which for
 * this app is one call at a time, so Pip's second slot would never be used. Chat may use every
 * slot; background work (summaries, classifiers) holds at most one, so a chat always has a slot.
 */
function engineEndpoints(addresses) {
  const out = {};
  if (addresses.chat) {out.LANA_ENGINE_CHAT_URL = addresses.chat;}
  if (addresses.chat && addresses.chatModelFile) {out.LANA_TOKENIZER_GGUF = addresses.chatModelFile;}
  if (addresses.chat && addresses.chatSlots) {
    out.LLM_QUEUE_CONCURRENCY = String(addresses.chatSlots);
    out.LLM_QUEUE_MAX_BACKGROUND_CONCURRENCY = '1';
  }
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
  DEFAULTS,
  versionProblem,
  windowsStart,
  fallbackStart,
  withFallbackPath,
  leverHardware,
  VULKAN_FALLBACK_DIR,
  MISSING_FILE_MESSAGE
};
