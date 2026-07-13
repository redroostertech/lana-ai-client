/**
 * postgres-init.js
 *
 * First-run Postgres initialization for the sovereign stack, exposed as the
 * supervisor prepare()/onReady() hooks for the `postgres` spec:
 *   prepare()  (before spawn)     -> initdb into an app-relative data dir if empty
 *   onReady()  (after accepting)  -> createdb lana_chef + extensions + migrate
 *
 * Idempotent and data-preserving: a data dir that already has PG_VERSION is not
 * re-initialized, and a database that already has tables (>10) is not re-migrated.
 * Mirrors LANA-AI's deploy-prod-mac.sh sequence but relocatable.
 *
 * All side effects (exec, fs existence, the migrate runner) are injected so the
 * control flow is unit-testable without a real Postgres.
 */
'use strict';

const path = require('path');

const DEFAULT_DB = 'lana_chef';
// Extensions the schema needs. timescaledb is intentionally OMITTED here: it may
// not be present in every bundle, and the migrations create it themselves — a
// missing timescaledb should degrade (hypertable migration skipped), not block
// the whole init. vector/pg_trgm/pgcrypto/uuid-ossp are the hard requirements.
const REQUIRED_EXTENSIONS = ['vector', 'pg_trgm', 'pgcrypto', '"uuid-ossp"'];

/**
 * @param {object} deps
 * @param {object} deps.bins - { initdb, psql, createdb }
 * @param {string} deps.dataDir
 * @param {number} deps.port
 * @param {string} [deps.dbName='lana_chef']
 * @param {function} deps.exec - async (cmd, args, opts) => { stdout, stderr, code }
 * @param {function} deps.migrate - async () => void  (runs node scripts/migrate.js with DATABASE_URL)
 * @param {object} deps.fs - { existsSync }
 * @param {object} [deps.logger]
 */
function makePostgresHooks(deps) {
  const { bins, dataDir, port, exec, migrate, fs } = deps;
  const dbName = deps.dbName || DEFAULT_DB;
  const log = deps.logger || { info() {}, warn() {}, error() {} };
  const conn = ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres'];

  async function prepare() {
    if (fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
      log.info('[pg-init] data dir already initialized; skipping initdb');
    } else {
      log.info(`[pg-init] initdb into ${dataDir}`);
      // --auth=trust: loopback-only, single-user desktop cluster. Password-auth
      // hardening (scram + pg_hba) is a Phase-C security follow-up.
      await exec(bins.initdb, [
        '-D', dataDir, '-U', 'postgres',
        '--encoding=UTF8', '--locale=en_US.UTF-8', '--auth=trust',
      ]);
    }
    // timescaledb MUST be listed in shared_preload_libraries BEFORE the server
    // starts, or `CREATE EXTENSION timescaledb` (run by the migrations, two of
    // which hard-fail without it) errors. Set it in postgresql.conf now. Idempotent.
    ensureTimescalePreload();
  }

  // Guarded on fs.readFileSync/appendFileSync so a minimal injected fs (existsSync
  // only, as in unit tests) is a safe no-op; the real fs writes the setting.
  function ensureTimescalePreload() {
    const confPath = path.join(dataDir, 'postgresql.conf');
    try {
      if (!fs.appendFileSync) return;
      const cur = (fs.existsSync(confPath) && fs.readFileSync) ? fs.readFileSync(confPath, 'utf8') : '';
      if (/shared_preload_libraries\s*=\s*'[^']*timescaledb/.test(cur)) return;
      fs.appendFileSync(confPath, "\n# LANA One: timescaledb hypertable migrations require this preload\nshared_preload_libraries = 'timescaledb'\n");
      log.info('[pg-init] enabled timescaledb shared_preload_libraries');
    } catch (e) {
      log.warn(`[pg-init] could not set timescaledb preload: ${e.message}`);
    }
  }

  async function onReady() {
    // createdb lana_chef if it doesn't exist yet
    const exists = await exec(bins.psql, [...conn, '-tAc', `SELECT 1 FROM pg_database WHERE datname='${dbName}'`]);
    if (!String(exists.stdout || '').trim()) {
      log.info(`[pg-init] createdb ${dbName}`);
      await exec(bins.createdb, [...conn, dbName]);
    }

    // If the DB already has a populated schema, preserve it: skip extensions+migrate.
    const tables = await exec(bins.psql, [
      ...conn, '-d', dbName, '-tAc',
      "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'",
    ]);
    if (parseInt(String(tables.stdout || '0').trim(), 10) > 10) {
      log.info('[pg-init] database already populated; skipping extensions + migrate');
      return;
    }

    // Ensure the hard-required extensions (best-effort; migrations also create them).
    for (const ext of REQUIRED_EXTENSIONS) {
      // eslint-disable-next-line no-await-in-loop
      await exec(bins.psql, [...conn, '-d', dbName, '-c', `CREATE EXTENSION IF NOT EXISTS ${ext};`])
        .catch((e) => log.warn(`[pg-init] extension ${ext} not created: ${e.message}`));
    }

    log.info('[pg-init] running migrations');
    await migrate();
    log.info('[pg-init] migrations complete');
  }

  return { prepare, onReady };
}

module.exports = { makePostgresHooks, REQUIRED_EXTENSIONS };
