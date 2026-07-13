/**
 * postgres-init.js
 *
 * First-run Postgres initialization for the sovereign stack, exposed as the
 * supervisor prepare()/onReady() hooks for the `postgres` spec:
 *   prepare()  (before spawn)     -> initdb into an app-relative data dir if empty
 *   onReady()  (after accepting)  -> createdb lana_chef + extensions + migrate
 *
 * Idempotent and data-preserving: a data dir that already has PG_VERSION is not
 * re-initialized, and a database that already has tables (>10) skips the
 * one-time extensions setup. Core + installed-app migrations run on EVERY boot
 * (both are idempotent, guarded by schema_migrations) so update launches pick
 * up new migrations. Mirrors LANA-AI's deploy-prod-mac.sh sequence but
 * relocatable.
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
//
// BOOT-SAFETY: shared_preload_libraries = 'timescaledb' is only written when the
// timescaledb library is actually present in the discovered Postgres install
// (probeTimescale). Preloading a missing library aborts Postgres startup
// entirely, so on a bundle without timescaledb we skip the preload (and the
// CREATE EXTENSION) and let the hypertable migrations degrade instead of
// bricking boot.
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
 * @param {function} [deps.appMigrate] - async () => void. Optional injected
 *        installed-app migration step. When absent, a built-in runner discovers
 *        the backend root and reuses the parent app-migration mechanism.
 * @param {string} [deps.backendRoot] - backend root containing scripts/ + @app + infra/.
 * @param {string} [deps.resourcesPath] - Electron process.resourcesPath (bundle).
 * @param {string} [deps.databaseUrl] - connection string for app migrations.
 * @param {string} [deps.superuserPassword] - the generated POSTGRES_PASSWORD.
 *        When present, fresh clusters initdb with scram-sha-256 (no trust) and
 *        every boot re-syncs the superuser password + tightens legacy trust
 *        pg_hba entries to scram, so loopback connections always authenticate.
 */
function makePostgresHooks(deps) {
  const { bins, dataDir, port, exec, migrate, fs } = deps;
  // Force the one-time extensions setup even on an already-populated DB (e.g.
  // `start.sh --fresh`). Core migrate itself runs on EVERY boot regardless --
  // it is idempotent (guarded by schema_migrations), so it only fills in gaps.
  const forceMigrate = deps.forceMigrate === true || process.env.LANA_ONE_FRESH === '1';
  const dbName = deps.dbName || DEFAULT_DB;
  const log = deps.logger || { info() {}, warn() {}, error() {} };
  const conn = ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres'];
  // All psql/createdb calls present the superuser password via PGPASSWORD so
  // they authenticate under BOTH postures: legacy trust clusters (password is
  // ignored) and hardened scram clusters (password is required).
  const superuserPassword = deps.superuserPassword || '';
  const pgExecOpts = superuserPassword
    ? { env: { ...process.env, PGPASSWORD: superuserPassword } }
    : undefined;

  // Probe the discovered Postgres install for timescaledb. Uses pg_config next
  // to the bundled `initdb` so it resolves the SAME (possibly relocated) tree
  // the server will run from. `resolved` means we positively located a real
  // pkglibdir on disk — i.e. absence is trustworthy, not just "couldn't check".
  async function probeTimescale() {
    const out = { libPresent: false, controlPresent: false, resolved: false, pkglibdir: '', sharedir: '' };
    try {
      const binDir = path.dirname(bins.initdb || '');
      const pgConfig = binDir && binDir !== '.' ? path.join(binDir, 'pg_config') : 'pg_config';
      let pkglibdir = '';
      let sharedir = '';
      try {
        const a = await exec(pgConfig, ['--pkglibdir']);
        pkglibdir = String((a && a.stdout) || '').trim();
        const b = await exec(pgConfig, ['--sharedir']);
        sharedir = String((b && b.stdout) || '').trim();
      } catch (_e) { /* pg_config unavailable; leave dirs empty */ }
      out.pkglibdir = pkglibdir;
      out.sharedir = sharedir;
      if (pkglibdir && fs.existsSync && fs.existsSync(pkglibdir)) out.resolved = true;
      if (pkglibdir && fs.existsSync) {
        out.libPresent = ['timescaledb.dylib', 'timescaledb.so']
          .some((n) => fs.existsSync(path.join(pkglibdir, n)));
      }
      if (sharedir && fs.existsSync) {
        out.controlPresent = fs.existsSync(path.join(sharedir, 'extension', 'timescaledb.control'));
      }
    } catch (_e) { /* keep conservative defaults */ }
    return out;
  }

  async function prepare() {
    if (fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
      log.info('[pg-init] data dir already initialized; skipping initdb');
    } else if (superuserPassword && fs.writeFileSync && fs.unlinkSync) {
      // Fresh cluster: scram-sha-256 from the very first byte (never trust), so
      // no local process can connect as the superuser without the generated
      // POSTGRES_PASSWORD. The password is handed to initdb via --pwfile (mode
      // 0600, deleted immediately after) so it never appears in argv.
      log.info(`[pg-init] initdb into ${dataDir} (auth=scram-sha-256)`);
      const pwFile = path.join(path.dirname(dataDir), '.lana-pg-pw');
      fs.writeFileSync(pwFile, `${superuserPassword}\n`, { mode: 0o600 });
      try {
        await exec(bins.initdb, [
          '-D', dataDir, '-U', 'postgres',
          '--encoding=UTF8', '--locale=en_US.UTF-8',
          '--auth=scram-sha-256', `--pwfile=${pwFile}`,
        ]);
      } finally {
        try { fs.unlinkSync(pwFile); } catch (_e) { /* best-effort cleanup */ }
      }
    } else {
      // Degenerate injection only (no password / minimal fs, as in unit tests):
      // fall back to the legacy trust init. Real boots always inject both, and
      // hardenAuthSafely() converts any legacy trust cluster on next boot.
      log.warn('[pg-init] no superuser password / writable fs injected; initdb falling back to --auth=trust');
      await exec(bins.initdb, [
        '-D', dataDir, '-U', 'postgres',
        '--encoding=UTF8', '--locale=en_US.UTF-8', '--auth=trust',
      ]);
    }
    // timescaledb, WHEN PRESENT, must be listed in shared_preload_libraries
    // BEFORE the server starts, or `CREATE EXTENSION timescaledb` errors. But
    // preloading a library that is NOT bundled aborts Postgres startup entirely,
    // so we only write it when the library actually exists. Idempotent.
    await ensureTimescalePreload();
  }

  // Guarded on fs.readFileSync/appendFileSync so a minimal injected fs (existsSync
  // only, as in unit tests) is a safe no-op; the real fs writes the setting.
  async function ensureTimescalePreload() {
    const confPath = path.join(dataDir, 'postgresql.conf');
    try {
      if (!fs.appendFileSync) return;
      const cur = (fs.existsSync(confPath) && fs.readFileSync) ? fs.readFileSync(confPath, 'utf8') : '';
      if (/shared_preload_libraries\s*=\s*'[^']*timescaledb/.test(cur)) return;

      const ts = await probeTimescale();
      if (!ts.libPresent) {
        // Boot-safety: only enable the preload when the timescaledb library is
        // positively present. Writing shared_preload_libraries='timescaledb' when
        // the .so is absent stops Postgres from starting at all -- and Postgres is
        // a critical service, so that bricks boot. On uncertainty (pg_config
        // unavailable / unknown layout) we take the SAFE direction and skip;
        // worst case, hypertable migrations degrade, which the rest of init
        // already tolerates. Packaged builds always ship pg_config, so `resolved`
        // is reliable there and this only skips when timescaledb is truly absent.
        log.warn(ts.resolved
          ? `[pg-init] timescaledb library not found in ${ts.pkglibdir}; NOT enabling shared_preload_libraries (boot-safe). Hypertable migrations will degrade.`
          : '[pg-init] could not verify timescaledb presence (pg_config unavailable); NOT enabling shared_preload_libraries (boot-safe). Hypertable migrations will degrade.');
        return;
      }
      fs.appendFileSync(confPath, "\n# LANA One: timescaledb hypertable migrations require this preload\nshared_preload_libraries = 'timescaledb'\n");
      log.info('[pg-init] enabled timescaledb shared_preload_libraries');
    } catch (e) {
      log.warn(`[pg-init] could not set timescaledb preload: ${e.message}`);
    }
  }

  // Harden loopback auth on every boot (best-effort, never blocks boot):
  //   1. re-sync the postgres superuser password to the per-install secret, and
  //   2. only once the password is confirmed set, tighten any legacy `trust`
  //      pg_hba entries to scram-sha-256 and reload.
  // The order is load-bearing: on a pre-hardening trust cluster the password
  // must be in place BEFORE trust is removed, or we'd lock the backend out.
  // Fresh clusters initdb'd with scram (prepare) hit only the no-op paths here.
  async function hardenAuthSafely() {
    if (!superuserPassword) return;
    if (!fs.writeFileSync || !fs.unlinkSync || !fs.readFileSync) return; // minimal injected fs (unit tests)
    let passwordSet = false;
    try {
      // ALTER via a 0600 SQL file inside the 0700 data dir so the credential
      // never appears in argv (visible in the process list); removed right after.
      const sqlFile = path.join(dataDir, '.lana-superuser.sql');
      const quoted = superuserPassword.replace(/'/g, "''");
      fs.writeFileSync(sqlFile, `ALTER USER postgres WITH PASSWORD '${quoted}';\n`, { mode: 0o600 });
      try {
        await exec(bins.psql, [...conn, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', sqlFile], pgExecOpts);
        passwordSet = true;
      } finally {
        try { fs.unlinkSync(sqlFile); } catch (_e) { /* best-effort cleanup */ }
      }
    } catch (e) {
      log.warn(`[pg-init] could not set superuser password: ${e.message}`);
    }
    if (!passwordSet) return; // never remove trust before the password is confirmed
    try {
      const hbaPath = path.join(dataDir, 'pg_hba.conf');
      if (!fs.existsSync(hbaPath)) return;
      const cur = fs.readFileSync(hbaPath, 'utf8');
      const tightened = cur.replace(/^(\s*(?:local|host|hostssl|hostnossl)\s+.*?)\btrust\b/gm, '$1scram-sha-256');
      if (tightened !== cur) {
        fs.writeFileSync(hbaPath, tightened);
        await exec(bins.psql, [...conn, '-d', 'postgres', '-tAc', 'SELECT pg_reload_conf();'], pgExecOpts);
        log.info('[pg-init] tightened legacy trust pg_hba entries to scram-sha-256 (config reloaded)');
      }
    } catch (e) {
      log.warn(`[pg-init] could not tighten pg_hba to scram: ${e.message}`);
    }
  }

  async function onReady() {
    // Auth hardening first, so every later connection (psql here, migrate, the
    // backend's DSN) runs against the final scram posture.
    await hardenAuthSafely();

    // createdb lana_chef if it doesn't exist yet
    const exists = await exec(bins.psql, [...conn, '-tAc', `SELECT 1 FROM pg_database WHERE datname='${dbName}'`], pgExecOpts);
    if (!String(exists.stdout || '').trim()) {
      log.info(`[pg-init] createdb ${dbName}`);
      await exec(bins.createdb, [...conn, dbName], pgExecOpts);
    }

    // The >10-table gate only skips the ONE-TIME extensions setup on an
    // already-populated DB (forceMigrate / start.sh --fresh re-runs it anyway).
    // It must NOT gate Core migrate: that runs on every boot below, or new Core
    // migrations shipped in an update would never reach existing installs.
    const tables = await exec(bins.psql, [
      ...conn, '-d', dbName, '-tAc',
      "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'",
    ], pgExecOpts);
    const populated = parseInt(String(tables.stdout || '0').trim(), 10) > 10;
    if (populated && !forceMigrate) {
      log.info('[pg-init] database already populated; skipping one-time extensions setup (Core migrate still runs)');
    } else {
      // Ensure the hard-required extensions (best-effort; migrations also create them).
      for (const ext of REQUIRED_EXTENSIONS) {
        // eslint-disable-next-line no-await-in-loop
        await exec(bins.psql, [...conn, '-d', dbName, '-c', `CREATE EXTENSION IF NOT EXISTS ${ext};`], pgExecOpts)
          .catch((e) => log.warn(`[pg-init] extension ${ext} not created: ${e.message}`));
      }

      // timescaledb is optional: only create it when its control file is present
      // (the preload was likewise only enabled in that case). When absent, skip
      // cleanly — hypertable migrations degrade rather than hard-fail here.
      const ts = await probeTimescale();
      if (ts.controlPresent) {
        await exec(bins.psql, [...conn, '-d', dbName, '-c', 'CREATE EXTENSION IF NOT EXISTS timescaledb;'], pgExecOpts)
          .catch((e) => log.warn(`[pg-init] timescaledb extension not created: ${e.message}`));
      } else {
        log.warn('[pg-init] timescaledb control file absent; skipping CREATE EXTENSION timescaledb (hypertable migrations will degrade)');
      }
    }

    // Core migrate runs on EVERY boot: scripts/migrate.js is idempotent (skips
    // already-applied migrations via schema_migrations, only bootstraps when
    // core tables are missing, reconcile is additive-only), so an update launch
    // on a populated DB applies exactly the new migrations. Best-effort so a
    // migration failure never blocks or crashes desktop boot (same posture as
    // runAppMigrationsSafely).
    try {
      log.info('[pg-init] running Core migrations');
      await migrate();
      log.info('[pg-init] Core migrations complete');
    } catch (e) {
      log.warn(`[pg-init] Core migrations failed; continuing boot: ${e.message}`);
    }

    // Parity with the full server: after Core migrations, apply each installed
    // app's migrations in manifest order (infra/lib/commands/migrations.js
    // runAll). Idempotent (guarded by the shared schema_migrations table), so
    // they too run on EVERY boot. Best-effort and boot-safe — never blocks
    // desktop startup.
    await runAppMigrationsSafely();
  }

  // Run installed-app migrations. Prefers an injected appMigrate; otherwise a
  // built-in runner discovers the backend root and reuses the parent mechanism
  // headlessly. Skipped under jest to preserve unit isolation, and any failure
  // is logged rather than thrown so the desktop always boots.
  async function runAppMigrationsSafely() {
    try {
      if (typeof deps.appMigrate === 'function') {
        log.info('[pg-init] running installed-app migrations (injected)');
        await deps.appMigrate();
        return;
      }
      if (process.env.JEST_WORKER_ID !== undefined) return;

      // eslint-disable-next-line global-require
      const { resolveBackendRoot, runInstalledAppMigrations } = require('./app-migrate');
      const backendRoot = resolveBackendRoot({
        explicit: deps.backendRoot,
        env: process.env,
        resourcesPath: deps.resourcesPath
          || (typeof process !== 'undefined' ? process.resourcesPath : undefined),
        fromDir: __dirname,
      });
      if (!backendRoot) {
        log.warn('[pg-init] app-migration backend root not found; skipping app migrations (Core only)');
        return;
      }
      const databaseUrl = deps.databaseUrl || process.env.DATABASE_URL
        || `postgresql://postgres@127.0.0.1:${port}/${dbName}`;
      log.info('[pg-init] running installed-app migrations');
      const res = await runInstalledAppMigrations({ backendRoot, databaseUrl, logger: log });
      log.info(`[pg-init] app migrations done; applied: ${res.ran.join(', ') || 'none'}${res.skipped.length ? '; skipped: ' + res.skipped.join(', ') : ''}`);
      if (res.failed.length) {
        log.warn(`[pg-init] app migrations completed with failures: ${res.failed.join('; ')}`);
      }
    } catch (e) {
      log.warn(`[pg-init] installed-app migrations skipped due to error: ${e.message}`);
    }
  }

  return { prepare, onReady };
}

module.exports = { makePostgresHooks, REQUIRED_EXTENSIONS };
