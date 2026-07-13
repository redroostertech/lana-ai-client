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
const { selectModelPlan } = require('./model-selector');
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

/**
 * Resolve the DEV binary paths (Homebrew PG/minio, source-built llama-server, the
 * lana-one repo). Phase B replaces these with app-bundle-relative paths.
 */
function resolveDevPaths({ home, repoRoot, modelsDir, fs }) {
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
    embedModel: nodePath.join(modelsDir, 'nomic-embed-text-v1.5.f16.gguf'),
    node: 'node',
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
  };
  const exec = opts.exec || makeExec(io.spawn);
  const log = io.logger;
  const ports = { pg: 5432, minio: 9000, minioConsole: 9001, llamaEmbed: 8082, llamaChat: 8081, docling: 8085, unstructured: 8000, backend: 8090, ...(opts.ports || {}) };
  let supervisor = null;

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
      paths = resolveDevPaths({ home, repoRoot, modelsDir, fs: io.fs });
    }
    if (!paths.backendCwd) throw new Error('bootstrap could not resolve the backend directory');
    // Optional doc parsers may be absent from the bundle (e.g. staged with
    // --skip-python). Only wire them when actually present so the supervisor never
    // spawns a missing binary; the backend degrades to its native parser.
    for (const k of ['doclingCmd', 'unstructuredUvicorn']) {
      if (paths[k] && !io.fs.existsSync(paths[k])) paths = { ...paths, [k]: undefined };
    }
    let chatModel;
    if (plan.localChat) {
      const f = nodePath.join(modelsDir, plan.chatModelFile);
      if (io.fs.existsSync(f)) {
        chatModel = f;
      } else {
        // Attempt a runtime download, but ONLY when the catalog entry is real
        // (pinned sha256 + https url). With placeholder shas (pre-release) or any
        // download failure, chat routes to the relay until the file is present.
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
        } catch (err) {
          log.warn(`[bootstrap] local chat model unavailable (${err.message}); chat routes to relay`);
        }
      }
    }

    // 4. Per-launch desktop capability key + data dirs
    const desktopKey = io.crypto.randomBytes(24).toString('hex');
    const dataDirs = { pg: nodePath.join(userDataRoot, 'pgdata'), minio: nodePath.join(userDataRoot, 'minio') };
    io.fs.mkdirSync(dataDirs.minio, { recursive: true });

    // 5. Postgres first-run hooks (migrate runs the backend's migrate script)
    const databaseUrl = `postgresql://postgres:${secrets.POSTGRES_PASSWORD}@127.0.0.1:${ports.pg}/lana_chef`;
    const migrate = () => exec(paths.node || 'node', ['scripts/migrate.js'], {
      cwd: paths.backendCwd,
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    const pgHooks = makePostgresHooks({
      bins: { initdb: paths.initdb, psql: paths.psql, createdb: paths.createdb },
      dataDir: dataDirs.pg, port: ports.pg, exec, migrate, fs: io.fs, logger: log,
    });

    // 6. Topology + supervisor
    const specs = buildServiceSpecs({
      paths: { ...paths, chatModel },
      dataDirs, ports, secrets,
      tier: plan.tier || opts.tier || 'demo',
      chatContext: plan.contextWindow,
      desktopKey,
      extraEnv: opts.extraEnv,
      hooks: { postgresPrepare: pgHooks.prepare, postgresOnReady: pgHooks.onReady },
    }, io.probes);

    supervisor = new ProcessSupervisor({ spawn: io.spawn, logger: log });
    for (const spec of specs) supervisor.register(spec);
    await supervisor.startAll();

    const backendUrl = `http://127.0.0.1:${ports.backend}`;
    log.info(`[bootstrap] stack up; backend at ${backendUrl}`);
    return { backendUrl, desktopKey, plan, secrets };
  }

  async function stop() {
    if (supervisor) await supervisor.stopAll();
    supervisor = null;
  }

  return { start, stop };
}

module.exports = { createStackBootstrap, resolveDevPaths, resolveBundledPaths, makeExec };
