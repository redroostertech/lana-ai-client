/**
 * bootstrap.js
 *
 * Composition root for the sovereign stack. start() runs the full sequence:
 *   secrets (stable) -> hardware model plan -> data dirs -> Postgres first-run hooks
 *   -> service topology -> ProcessSupervisor.startAll() -> backend URL.
 * stop() tears the stack down. This is what electron-main calls on app.whenReady()
 * (before the login window) and before-quit.
 *
 * Real collaborators (fs, crypto, child_process, probes) are used by default but are
 * all injectable, so the composition is unit-testable without spawning anything and
 * the same code drives dev binaries today and bundled binaries after Phase B (only
 * `paths` change).
 */
'use strict';

const nodePath = require('path');

const { ProcessSupervisor } = require('./process-supervisor');
const { SecretManager } = require('./secret-manager');
const { buildServiceSpecs } = require('./service-topology');
const { makePostgresHooks } = require('./postgres-init');
const { selectModelPlan, EMBED_MODEL_FILE } = require('./model-selector');
const defaultProbes = require('./probes');

// Promisified spawn that captures output and rejects on non-zero exit.
function makeExec(realSpawn) {
  return (cmd, args, opts = {}) => new Promise((resolve, reject) => {
    const child = realSpawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    if (child.stdout) child.stdout.on('data', (d) => { out += d; });
    if (child.stderr) child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0
      ? resolve({ stdout: out, stderr: err, code })
      : reject(new Error(`${cmd} exited ${code}: ${String(err).slice(0, 300)}`))));
  });
}

// First existing candidate, else a bare fallback (found on PATH at spawn time).
function firstExisting(fs, candidates, fallback) {
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch (_e) { /* ignore */ }
  }
  return fallback;
}

/**
 * Resolve the DEV binary paths. Platform-aware (Phase 1 scaffolding): macOS keeps
 * its exact Homebrew/source behavior; linux/win32 resolve from a small candidate
 * list, falling back to a bare command name (found on PATH). This is DEV-mode only
 * scaffolding so the stack can be brought up on a Linux/Windows dev box using
 * distro/PATH binaries; PACKAGED builds use resolveBundledPaths, and true per-OS
 * binary BUNDLING is Phase 2 (see docs/specs/CROSS_PLATFORM_BUILD_MATRIX.md).
 *
 * @param {string} [platform] - defaults to process.platform (injected for tests)
 */
function resolveDevPaths({ home, repoRoot, modelsDir, fs, platform }) {
  const plat = platform || process.platform;
  const embedModel = nodePath.join(modelsDir, 'nomic-embed-text-v1.5.f16.gguf');

  // macOS: UNCHANGED (byte-identical to the prior Homebrew/source resolution).
  if (plat === 'darwin') {
    const pgPrefix = fs.existsSync('/opt/homebrew/opt/postgresql@17')
      ? '/opt/homebrew/opt/postgresql@17' : '/usr/local/opt/postgresql@17';
    const minio = fs.existsSync('/opt/homebrew/bin/minio') ? '/opt/homebrew/bin/minio' : '/usr/local/bin/minio';
    return {
      postgres: `${pgPrefix}/bin/postgres`,
      initdb: `${pgPrefix}/bin/initdb`,
      psql: `${pgPrefix}/bin/psql`,
      createdb: `${pgPrefix}/bin/createdb`,
      minio,
      llamaServer: nodePath.join(home, 'llama.cpp/build/bin/llama-server'),
      embedModel,
      node: 'node',
      backendCwd: repoRoot,
    };
  }

  const exe = plat === 'win32' ? '.exe' : '';

  if (plat === 'linux') {
    // Distro Postgres 17 keg dirs (Debian/Ubuntu, then RHEL); else PATH.
    const pgBinDir = firstExisting(fs, [
      '/usr/lib/postgresql/17/bin',
      '/usr/pgsql-17/bin',
    ], null);
    const pgBin = (name) => (pgBinDir ? nodePath.join(pgBinDir, name) : name);
    return {
      postgres: pgBin('postgres'),
      initdb: pgBin('initdb'),
      psql: pgBin('psql'),
      createdb: pgBin('createdb'),
      minio: firstExisting(fs, ['/usr/local/bin/minio', '/usr/bin/minio'], 'minio'),
      llamaServer: firstExisting(fs, [
        nodePath.join(home, 'llama.cpp/build/bin/llama-server'),
        '/usr/local/bin/llama-server',
      ], 'llama-server'),
      embedModel,
      node: 'node',
      backendCwd: repoRoot,
    };
  }

  // win32 (and any other platform): best-effort PATH/candidate resolution. NOTE:
  // Windows dev currently requires manually provisioned binaries (no Homebrew) --
  // Postgres/MinIO/llama-server on PATH, or bundled per CROSS_PLATFORM_BUILD_MATRIX.md
  // Phase 2. This keeps a Windows dev run from hardcoding darwin-only paths.
  return {
    postgres: `postgres${exe}`,
    initdb: `initdb${exe}`,
    psql: `psql${exe}`,
    createdb: `createdb${exe}`,
    minio: `minio${exe}`,
    llamaServer: firstExisting(fs, [
      nodePath.join(home, 'llama.cpp', 'build', 'bin', `llama-server${exe}`),
    ], `llama-server${exe}`),
    embedModel,
    node: `node${exe}`,
    backendCwd: repoRoot,
  };
}

/**
 * Resolve BUNDLED binary paths — a packaged app's Contents/Resources tree,
 * as assembled by scripts/stage-sovereign-resources.sh and copied in place
 * by electron-builder's `extraResources` (electron-builder.lana-one.js).
 * Same shape as resolveDevPaths(); only `paths` changes between dev and
 * packaged builds, per docs/specs/LANA_ONE_PACKAGING_PLAN.md Phase B.
 *
 * Layout (each a direct child of `resourcesPath`, i.e. process.resourcesPath
 * in a packaged app -- macOS: <App>.app/Contents/Resources):
 *   postgres/Cellar/postgresql@17/<ver>/bin/{postgres,initdb,psql,createdb}
 *     -- the <ver> component is NOT fixed (whatever Homebrew keg version
 *     scripts/relocate-postgres.sh was run against), so it is discovered on
 *     disk rather than hardcoded. This Cellar-mirroring shape is intentional
 *     (see relocate-postgres.sh's header comment): PostgreSQL's own
 *     make_relative_path() derives sharedir/pkglibdir from the binary's own
 *     location by stripping a fixed number of path components, so mirroring
 *     the Homebrew keg depth is what makes that resolution work with zero
 *     env/GUC overrides.
 *   minio/minio
 *   llama-server/llama-server
 *   models/nomic-embed-text-v1.5.f16.gguf
 *   python/docling/venv/bin/{python3.11,docling-serve}
 *   python/unstructured/venv/bin/{python3.11,uvicorn}
 *
 * @param {object} cfg
 * @param {string} cfg.resourcesPath - process.resourcesPath in a packaged app
 * @param {string} [cfg.home] - unused today (kept for signature parity with
 *   resolveDevPaths and for future per-user bundled-path overrides)
 * @param {object} [cfg.fs] - injected fs (defaults to require('fs'))
 */
function resolveBundledPaths({ resourcesPath, home, fs } = {}) {
  if (!resourcesPath) throw new Error('resolveBundledPaths requires resourcesPath (process.resourcesPath in a packaged app)');
  const realFs = fs || require('fs');

  const pgBin = resolvePostgresBinDir(resourcesPath, realFs);
  const doclingVenv = nodePath.join(resourcesPath, 'python', 'docling', 'venv');
  const unstructuredVenv = nodePath.join(resourcesPath, 'python', 'unstructured', 'venv');

  return {
    postgres: nodePath.join(pgBin, 'postgres'),
    initdb: nodePath.join(pgBin, 'initdb'),
    psql: nodePath.join(pgBin, 'psql'),
    createdb: nodePath.join(pgBin, 'createdb'),
    minio: nodePath.join(resourcesPath, 'minio', 'minio'),
    llamaServer: nodePath.join(resourcesPath, 'llama-server', 'llama-server'),
    embedModel: nodePath.join(resourcesPath, 'models', 'nomic-embed-text-v1.5.f16.gguf'),
    doclingCmd: nodePath.join(doclingVenv, 'bin', 'docling-serve'),
    unstructuredUvicorn: nodePath.join(unstructuredVenv, 'bin', 'uvicorn'),
    unstructuredCwd: unstructuredVenv,
    // Bundled Node runtime + the staged lana-one backend (src + node_modules). The
    // bundled node matches the ABI the backend's native modules were built against,
    // so no electron-rebuild dance. stage-sovereign-resources.sh stages both.
    node: nodePath.join(resourcesPath, 'node', 'node'),
    backendCwd: nodePath.join(resourcesPath, 'backend'),
  };
}

// Find the version-suffixed postgres bin dir under a staged
// postgres/Cellar/postgresql@17/<ver>/bin tree (see resolveBundledPaths
// doc comment for why the tree is shaped this way). Falls back to a flat
// postgres/bin in case the staged tree wasn't produced by
// scripts/relocate-postgres.sh's Cellar-mirroring layout.
function resolvePostgresBinDir(resourcesPath, fs) {
  const cellarRoot = nodePath.join(resourcesPath, 'postgres', 'Cellar', 'postgresql@17');
  try {
    const versions = fs.readdirSync(cellarRoot).filter((v) => !v.startsWith('.'));
    if (versions.length > 0) {
      // Deterministic even with multiple versions staged: highest sorts last.
      const chosen = versions.sort()[versions.length - 1];
      return nodePath.join(cellarRoot, chosen, 'bin');
    }
  } catch (_) {
    /* fall through to the flat-layout fallback */
  }
  return nodePath.join(resourcesPath, 'postgres', 'bin');
}

// A packaged app's Contents/Resources only counts as "bundled" if the
// staged sovereign resources actually landed there (checked via a cheap
// marker: the minio or postgres dir). This guards against a plain `electron
// .` dev run, whose process.resourcesPath always points at
// node_modules/electron/dist/Electron.app/Contents/Resources (which exists,
// but was never staged) -- without this check, resolveBundledPaths would be
// selected for ordinary dev runs and break local development.
function isBundledResourcesPath(resourcesPath, fs) {
  if (!resourcesPath) return false;
  try {
    return fs.existsSync(nodePath.join(resourcesPath, 'postgres'))
      || fs.existsSync(nodePath.join(resourcesPath, 'minio'));
  } catch (_) {
    return false;
  }
}

function createStackBootstrap(opts = {}) {
  const io = {
    fs: opts.fs || require('fs'),
    crypto: opts.crypto || require('crypto'),
    spawn: opts.spawn || require('child_process').spawn,
    probes: opts.probes || defaultProbes,
    logger: opts.logger || { info() {}, warn() {}, error() {} },
    os: opts.os || require('os'),
    platform: opts.platform || process.platform,
  };
  const exec = opts.exec || makeExec(io.spawn);
  const log = io.logger;
  // Full default port set (mirrors service-topology's defaults) so the free-port
  // isolation below covers EVERY bundled service, not just the core ones.
  const ports = { pg: 5432, minio: 9000, minioConsole: 9001, llamaEmbed: 8082, llamaChat: 8081, docling: 8085, unstructured: 8000, backend: 8090, vision: 8083, legal: 8084, redactor: 8091, timesfm: 8092, hermes: 8094, ...(opts.ports || {}) };
  let supervisor = null;
  // Boot context captured at the end of start() so the post-boot activateLocalChat()
  // can download + hot-swap the llama-chat sidecar without re-running the whole boot.
  // (ports + supervisor are already closure-level.)
  let _ctx = null;
  // Single-flight guard for activateLocalChat (concurrent activations would race
  // the same .downloading part file and the llama-chat swap).
  let _activating = false;

  async function start() {
    const home = opts.home || io.os.homedir();
    const modelsDir = opts.modelsDir || nodePath.join(home, '.llama-models');
    const userDataRoot = opts.userDataRoot || nodePath.join(home, '.lana-one');
    const repoRoot = opts.repoRoot;

    // 1. Stable per-install secrets
    if (!opts.secretStore) throw new Error('bootstrap requires a secretStore');
    const secrets = await new SecretManager({ store: opts.secretStore, logger: log }).ensureSecrets();

    // 2. Hardware model plan
    const plan = selectModelPlan({ os: io.os });
    log.info(`[bootstrap] model plan: localChat=${plan.localChat} tier=${plan.tier || 'none'} (${plan.reason})`);

    // 3. Resolve paths + chat model (only if selected AND present on disk).
    // Bundled (packaged-app) paths are preferred when the caller says so
    // explicitly (opts.packaged === true, e.g. electron-main passing
    // app.isPackaged) or, absent that, when process.resourcesPath itself
    // looks like a packaged LANA One app (see isBundledResourcesPath) --
    // opts.packaged === false always forces dev paths regardless. Only
    // Phase B (bundling) changes which branch fires; the topology/spec code
    // downstream is identical either way.
    const resourcesPath = opts.resourcesPath
      || (typeof process !== 'undefined' ? process.resourcesPath : undefined);
    const packaged = opts.packaged === true
      || (opts.packaged !== false && isBundledResourcesPath(resourcesPath, io.fs));
    let paths;
    if (opts.paths) {
      paths = opts.paths;
    } else if (packaged) {
      // Packaged: backend + node runtime are bundled (resolveBundledPaths); an
      // explicit opts.repoRoot / opts.node still wins if the caller supplies one.
      const bundled = resolveBundledPaths({ resourcesPath, home, fs: io.fs });
      paths = { ...bundled, node: opts.node || bundled.node, backendCwd: repoRoot || bundled.backendCwd };
    } else {
      if (!repoRoot) throw new Error('bootstrap requires repoRoot (the lana-one backend dir) in dev mode');
      paths = resolveDevPaths({ home, repoRoot, modelsDir, fs: io.fs, platform: io.platform });
    }
    if (!paths.backendCwd) throw new Error('bootstrap could not resolve the backend directory');
    // Optional doc parsers may be absent from the bundle (e.g. staged with
    // --skip-python). Only wire them when actually present so the supervisor never
    // spawns a missing binary; the backend degrades to its native parser.
    for (const k of ['doclingCmd', 'unstructuredUvicorn']) {
      if (paths[k] && !io.fs.existsSync(paths[k])) paths = { ...paths, [k]: undefined };
    }
    // Boot-time snapshot of the chat-model download outcome, surfaced to the
    // frontend via the backend's GET /api/v1/system/local-models endpoint.
    // downloadState is a settled state (bootstrap awaits the download), so
    // 'downloading' is not a persisted boot value; live progress is out of scope.
    let chatModel;
    let downloadState = null; // 'present' | 'missing' | 'error' (null when no local chat selected)
    let downloadReason = null;
    if (plan.localChat) {
      const f = nodePath.join(modelsDir, plan.chatModelFile);
      if (io.fs.existsSync(f)) {
        chatModel = f;
        downloadState = 'present';
      } else {
        // Attempt a runtime download, but ONLY when the catalog entry is real
        // (pinned sha256 + https url). With placeholder shas (pre-release) or any
        // download failure, chat routes to the relay until the file is present.
        downloadState = 'missing';
        try {
          const { resolveChatModel, validateCatalogEntry } = require('./model-catalog');
          const { ensureModel } = require('./model-downloader');
          const entry = resolveChatModel(plan.tier);
          validateCatalogEntry(entry); // throws on placeholder / all-zero sha / bad url
          log.info(`[bootstrap] downloading local chat model ${plan.chatModelFile} (${plan.tier})...`);
          chatModel = await ensureModel({
            modelsDir, file: plan.chatModelFile, url: entry.url,
            sha256: entry.sha256, sizeBytes: entry.sizeBytes,
            onProgress: (p) => log.info(`[bootstrap] model dl: ${p.bytesWritten || 0}/${p.totalBytes || '?'} bytes`),
          });
          downloadState = 'present';
        } catch (err) {
          downloadState = 'error';
          downloadReason = err.message;
          log.warn(`[bootstrap] local chat model unavailable (${err.message}); chat routes to relay`);
        }
      }
    }

    // 3b. Aux local models (legal, vision) -- CHECK-IF-PRESENT ONLY. LANA One
    // downloads GGUFs via a dedicated in-app step on user command; bootstrap
    // NEVER fetches them here. An absent file simply means the corresponding
    // sidecar is not started (inert-safe), exactly like the doc parsers.
    let legalModel;
    let visionModel;
    let visionMmproj;
    for (const aux of (plan.auxModels || [])) {
      if (!aux || !aux.role) continue;
      // Tolerate either a catalog-entry object ({ file, url, sha256, ... }) or a
      // bare filename in aux.model; only the filename is used (no download).
      const entry = aux.model;
      const file = entry && typeof entry === 'object' ? entry.file : entry;
      if (!file || typeof file !== 'string') continue;
      const resolved = nodePath.join(modelsDir, file);
      if (!io.fs.existsSync(resolved)) continue; // absent -> sidecar not started
      if (aux.role === 'legal') {
        legalModel = resolved;
      } else if (aux.role === 'vision') {
        visionModel = resolved;
        // Optional multimodal projector companion (present-only, never fetched).
        const mm = (entry && typeof entry === 'object' && entry.mmproj) || aux.mmproj;
        const mmFile = mm && typeof mm === 'object' ? mm.file : mm;
        if (mmFile && typeof mmFile === 'string') {
          const mmPath = nodePath.join(modelsDir, mmFile);
          if (io.fs.existsSync(mmPath)) visionMmproj = mmPath;
        }
      }
    }

    // 3c. Aux sidecar entrypoints -- present-only gating (mirrors doc-parser
    // gating). Redactor run.sh ships in the client resources tree; TimesFM +
    // Hermes live in the bundled backend tree (paths.backendCwd). None is fetched.
    const redactorCandidates = [
      opts.redactorRunSh,
      packaged && resourcesPath ? nodePath.join(resourcesPath, 'redactor', 'run.sh') : undefined,
      nodePath.join(__dirname, '..', 'resources', 'redactor', 'run.sh'),
    ].filter(Boolean);
    // CORE MOAT: the redactor is ALWAYS started -- it is core, independent of any
    // local chat model. run.sh self-provisions its Presidio/spaCy venv on first
    // run (writing the sentinel) and serves thereafter, so we enable it on run.sh
    // PRESENCE, not on the sentinel. Gating on the sentinel deadlocked a fresh box:
    // nothing else ran run.sh to write it, so the moat never came up. Because
    // REDACTION_ENABLED is therefore always set when run.sh ships, cloud egress
    // fails CLOSED (never leaks) until the redactor is healthy -- the correct
    // posture for a privacy moat. First boot pays the one-time provisioning cost;
    // the redactor service carries a long readiness window (see service-topology).
    const redactorRunSh = redactorCandidates.find((c) => io.fs.existsSync(c));
    // Option C: prefer the BUNDLED (staged) redactor venv so first run is instant +
    // offline -- no runtime pip. REDACTOR_VENV points run.sh at it; it then skips
    // provisioning and serves. Absent (unstaged dev box) => run.sh self-provisions
    // at its default ~/.venv/lana-redactor.
    const redactorVenvCandidates = [
      packaged && resourcesPath ? nodePath.join(resourcesPath, 'python', 'redactor', 'venv') : undefined,
      nodePath.join(__dirname, '..', 'build', 'sovereign-resources', 'python', 'redactor', 'venv'),
    ].filter(Boolean);
    const redactorVenv = redactorVenvCandidates.find(
      (c) => io.fs.existsSync(nodePath.join(c, 'bin', 'python')),
    );

    const timesfmRunShPath = nodePath.join(paths.backendCwd, 'sidecar', 'timesfm', 'run.sh');
    const timesfmVenv = nodePath.join(home, '.venv', 'timesfm');
    const timesfmRunSh = (io.fs.existsSync(timesfmRunShPath) && io.fs.existsSync(timesfmVenv))
      ? timesfmRunShPath : undefined;

    const hermesServerPath = nodePath.join(paths.backendCwd, 'sidecar', 'hermes', 'server.mjs');
    const hermesServer = io.fs.existsSync(hermesServerPath) ? hermesServerPath : undefined;

    // Local-model capability snapshot for the backend to expose (workstream
    // "Expose the plan"). buildServiceSpecs serializes this into the backend
    // spawn env as LANA_LOCAL_MODELS_STATUS; the backend reflects it verbatim.
    const localChatAvailable = Boolean(chatModel);
    const localModelsStatus = {
      hardware: plan.hardware,
      localChat: {
        available: localChatAvailable,
        reason: localChatAvailable ? plan.reason : (downloadReason || plan.reason),
        tier: plan.tier,
        model: plan.chatModelFile,
        contextWindow: plan.contextWindow,
        downloadState,
        downloadProgress: null, // best-effort; download is settled by this point
      },
      embedding: { model: plan.embedModelFile || EMBED_MODEL_FILE, bundled: true },
      // Single source of truth for `fits` = the selector's KV/context fit math
      // (model-selector estimateTierFit), NOT a re-derived floor-only check, so the
      // ladder the UI shows never contradicts the actual selection / localChat.available
      // (e.g. under LANA_ALLOW_NON_METAL_LOCAL a tier can fit CPU-only while a naive
      // isAppleSilicon gate would wrongly show every row as not-fitting).
      tiers: (plan.tiers || []).map((t) => ({
        tier: t.tier,
        minMemoryGB: t.minMemoryGB,
        model: t.model,
        contextWindow: t.contextWindow,
        fits: t.fits,
      })),
      routing: {
        // Local model present AND the redaction moat provisioned => hybrid routing
        // can actually SELECT local (the redactor-first gate requires a healthy
        // redactor beside the model), so the destination is per-request 'auto'.
        // Without the redactor, local is never selectable and cloud egress would be
        // unredacted, so we honestly report 'relay' -- never claim "on-device" /
        // "redacted" that the router will not deliver.
        chatDestination: (localChatAvailable && Boolean(redactorRunSh)) ? 'auto' : 'relay',
        mode: (localChatAvailable && Boolean(redactorRunSh)) ? 'hybrid' : 'relay',
        reason: !localChatAvailable
          ? (downloadReason || plan.reason)
          : (redactorRunSh ? `hybrid_local_${plan.tier}` : 'redactor_not_provisioned'),
      },
      // Additive: aux sovereign capabilities available this boot (present-only;
      // reflects the user's in-app model-setup + which sidecar assets are staged).
      aux: {
        legal: Boolean(legalModel),
        vision: Boolean(visionModel),
        visionMmproj: Boolean(visionMmproj),
        redactor: Boolean(redactorRunSh),
        timesfm: Boolean(timesfmRunSh),
        hermes: Boolean(hermesServer),
      },
    };

    // 4. Per-launch desktop capability key + data dirs
    const desktopKey = io.crypto.randomBytes(24).toString('hex');
    const dataDirs = { pg: nodePath.join(userDataRoot, 'pgdata'), minio: nodePath.join(userDataRoot, 'minio') };
    io.fs.mkdirSync(dataDirs.minio, { recursive: true });

    // Isolate EVERY bundled service port from whatever is already installed or
    // running on the box — a dev's Homebrew Postgres on 5432, a MinIO on 9000, a
    // llama server, etc. For each service we prefer its default port and fall
    // FORWARD to the next free, not-yet-reserved port, so the bundled stack is
    // fully self-contained: it never silently attaches to a system service (and
    // ends up on the wrong, unmigrated data), and is never blocked by one.
    // Assume a fresh box even if things are already installed. An explicit
    // opts.ports[key] still wins.
    {
      const explicit = opts.ports || {};
      const reserved = new Set(Object.values(explicit).map(Number).filter(Boolean));
      const pickFree = async (preferred) => {
        for (let p = preferred; p < preferred + 100; p += 1) {
          if (reserved.has(p)) continue;
          // tcpProbe is a FACTORY returning an async () => boolean (true when
          // something is listening), so it must be invoked -- awaiting the
          // factory result itself would always be truthy.
          // eslint-disable-next-line no-await-in-loop
          const busy = await io.probes.tcpProbe({ host: '127.0.0.1', port: p, timeoutMs: 500 })();
          if (!busy) { reserved.add(p); return p; }
        }
        return preferred;
      };
      for (const key of Object.keys(ports)) {
        if (explicit[key]) continue; // caller pinned this one
        // eslint-disable-next-line no-await-in-loop
        const chosen = await pickFree(ports[key]);
        if (chosen !== ports[key]) {
          log.info(`[bootstrap] ${key} -> port ${chosen} (default ${ports[key]} busy/reserved; isolated)`);
        }
        ports[key] = chosen;
      }
    }

    // 5. Postgres first-run hooks (migrate runs the backend's migrate script)
    const databaseUrl = `postgresql://postgres:${secrets.POSTGRES_PASSWORD}@127.0.0.1:${ports.pg}/lana_chef`;
    const migrate = () => exec(paths.node || 'node', ['scripts/migrate.js'], {
      cwd: paths.backendCwd,
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    const pgHooks = makePostgresHooks({
      bins: { initdb: paths.initdb, psql: paths.psql, createdb: paths.createdb },
      dataDir: dataDirs.pg, port: ports.pg, exec, migrate, fs: io.fs, logger: log,
      // Loopback auth hardening: scram initdb on fresh clusters + per-boot
      // password sync / pg_hba tightening on legacy trust clusters.
      superuserPassword: secrets.POSTGRES_PASSWORD,
    });

    // 6. Topology + supervisor
    const specs = buildServiceSpecs({
      paths: {
        ...paths, chatModel,
        legalModel, visionModel, visionMmproj,
        redactorRunSh, redactorVenv, timesfmRunSh, hermesServer,
      },
      dataDirs, ports, secrets,
      tier: plan.tier || opts.tier || 'demo',
      chatContext: plan.contextWindow,
      // Detected acceleration backend (metal|cuda|cpu, + VRAM) -> drives
      // --n-gpu-layers for every llama-server sidecar (service-topology.gpuLayersFor).
      accel: plan.hardware && plan.hardware.accel,
      localModelsStatus,
      desktopKey,
      extraEnv: opts.extraEnv,
      hooks: { postgresPrepare: pgHooks.prepare, postgresOnReady: pgHooks.onReady },
    }, io.probes);

    supervisor = new ProcessSupervisor({ spawn: io.spawn, logger: log });
    for (const spec of specs) supervisor.register(spec);
    await supervisor.startAll();

    const backendUrl = `http://127.0.0.1:${ports.backend}`;
    log.info(`[bootstrap] stack up; backend at ${backendUrl}`);
    _ctx = { modelsDir, paths, plan, accel: plan.hardware && plan.hardware.accel };
    return { backendUrl, desktopKey, plan, secrets };
  }

  /**
   * Phase 2: activate a local chat model AFTER boot -- download it (if needed) and
   * hot-swap the llama-chat sidecar to serve it, without a full stack restart. The
   * router picks it up within one availability-probe TTL (or immediately when the
   * caller resets the backend cache). Throws on download/activation failure so the
   * caller can report it; the relay path stays intact.
   *
   * @param {object} [args]
   * @param {string} [args.tier] catalog tier (default: the boot plan's tier)
   * @param {(p:object)=>void} [args.onProgress] download-progress callback
   * @param {AbortSignal} [args.signal] cancel the download
   * @returns {Promise<{ok:true, tier:string, model:string, port:number}>}
   */
  async function activateLocalChat({ tier, onProgress, signal } = {}) {
    if (!_ctx || !supervisor) {
      throw new Error('stack not started; cannot activate a local chat model');
    }
    if (_activating) {
      throw new Error('a local model activation is already in progress');
    }
    _activating = true;
    try {
    const { modelsDir, paths, plan, accel } = _ctx;
    const targetTier = tier || plan.tier || 'demo';

    // eslint-disable-next-line global-require
    const { resolveChatModel, validateCatalogEntry } = require('./model-catalog');
    // eslint-disable-next-line global-require
    const { ensureModel } = require('./model-downloader');
    // eslint-disable-next-line global-require
    const { buildChatSpec, gpuLayersFor } = require('./service-topology');

    const entry = resolveChatModel(targetTier);
    validateCatalogEntry(entry); // throws on placeholder sha / bad url
    const file = entry.file || decodeURIComponent(String(entry.url).split('?')[0].split('/').pop() || '');
    if (!file) throw new Error(`model-catalog: no file for tier "${targetTier}"`);

    log.info(`[bootstrap] activating local chat model ${file} (${targetTier})...`);
    const chatModel = await ensureModel({
      modelsDir, file, url: entry.url,
      sha256: entry.sha256, sizeBytes: entry.sizeBytes,
      onProgress: (p) => {
        if (typeof onProgress === 'function') {
          try { onProgress(p); } catch (_e) { /* progress is best-effort */ }
        }
        log.info(`[bootstrap] model dl: ${p.bytesWritten || 0}/${p.totalBytes || '?'} bytes`);
      },
      signal,
    });

    // Hot-swap the llama-chat sidecar (stop-then-start; readiness must pass before
    // this resolves). buildChatSpec is the SAME builder boot uses, so the served
    // model is byte-identical to a boot-time launch.
    const spec = buildChatSpec({
      llamaServer: paths.llamaServer,
      chatModel,
      port: ports.llamaChat,
      nGpuLayers: gpuLayersFor(accel),
      chatContext: plan.contextWindow,
    }, io.probes);
    await supervisor.replaceService('llama-chat', spec);

    log.info(`[bootstrap] local chat model active on 127.0.0.1:${ports.llamaChat} (${targetTier})`);
    return { ok: true, tier: targetTier, model: file, port: ports.llamaChat };
    } finally {
      _activating = false;
    }
  }

  async function stop() {
    if (supervisor) await supervisor.stopAll();
    supervisor = null;
  }

  return { start, stop, activateLocalChat };
}

module.exports = { createStackBootstrap, resolveDevPaths, resolveBundledPaths, makeExec };
