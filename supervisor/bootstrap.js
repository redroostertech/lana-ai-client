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
    if (!repoRoot) throw new Error('bootstrap requires repoRoot (the lana-one backend dir)');

    // 1. Stable per-install secrets
    if (!opts.secretStore) throw new Error('bootstrap requires a secretStore');
    const secrets = await new SecretManager({ store: opts.secretStore, logger: log }).ensureSecrets();

    // 2. Hardware model plan
    const plan = selectModelPlan({ os: io.os });
    log.info(`[bootstrap] model plan: localChat=${plan.localChat} tier=${plan.tier || 'none'} (${plan.reason})`);

    // 3. Resolve paths + chat model (only if selected AND present on disk)
    const paths = opts.paths || resolveDevPaths({ home, repoRoot, modelsDir, fs: io.fs });
    let chatModel;
    if (plan.localChat) {
      const f = nodePath.join(modelsDir, plan.chatModelFile);
      if (io.fs.existsSync(f)) chatModel = f;
      else log.warn(`[bootstrap] ${plan.chatModelFile} not downloaded yet; chat routes to relay until present`);
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

module.exports = { createStackBootstrap, resolveDevPaths, makeExec };
