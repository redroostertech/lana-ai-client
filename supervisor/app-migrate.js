/**
 * app-migrate.js
 *
 * Headless runner for installed-app migrations on the sovereign desktop stack.
 *
 * The full server runs Core migrations (scripts/migrate.js) and THEN each
 * installed app's numbered SQL in manifest order (see
 * infra/lib/commands/migrations.js runAll()). The desktop supervisor only ran
 * Core, so any @app tables (@agents/@automation/@insights/@heartbeat/@voice/
 * @meet/@communications) were never created. This module reuses the SAME
 * parent mechanism headlessly:
 *   - scripts/app-migration-manifest.js  -> APP_MIGRATION_MANIFEST (order + files)
 *   - infra/lib/utils/app-migrations.js  -> applyAppMigrations (idempotent apply
 *                                            via the shared schema_migrations table)
 *
 * Both parent modules resolve their own deps ('pg', 'chalk') from the backend
 * tree they live in, so requiring them from the resolved backend root keeps the
 * desktop supervisor free of those runtime deps until this actually runs.
 *
 * Everything here is best-effort and idempotent: re-running is safe, and a
 * missing backend tree (e.g. a stripped bundle that ships no apps) is a clean
 * no-op rather than a boot blocker.
 */
'use strict';

const path = require('path');
const fs = require('fs');

/**
 * Resolve the backend root that contains scripts/app-migration-manifest.js and
 * infra/lib/utils/app-migrations.js. Returns null when no candidate qualifies.
 *
 * @param {object} opts
 * @param {string} [opts.explicit]      - caller-provided backend root (wins)
 * @param {object} [opts.env]           - process.env-like map (LANA_* overrides)
 * @param {string} [opts.resourcesPath] - Electron process.resourcesPath (bundle)
 * @param {string} [opts.fromDir]       - __dirname of the supervisor (dev fallback)
 * @param {object} [opts.io]            - { existsSync } (injectable for tests)
 * @returns {string|null}
 */
function resolveBackendRoot(opts) {
  const o = opts || {};
  const env = o.env || {};
  const io = o.io || fs;
  const candidates = [];
  if (o.explicit) candidates.push(o.explicit);
  if (env.LANA_ONE_BACKEND_ROOT) candidates.push(env.LANA_ONE_BACKEND_ROOT);
  if (env.LANA_AI_ROOT) candidates.push(env.LANA_AI_ROOT);
  if (o.resourcesPath) candidates.push(path.join(o.resourcesPath, 'backend'));
  if (o.fromDir) {
    // dev: client/supervisor -> lana-one repo root (has scripts/ + @app + infra/)
    candidates.push(path.resolve(o.fromDir, '..', '..'));
    candidates.push(path.resolve(o.fromDir, '..', '..', '..'));
  }
  for (const c of candidates) {
    if (!c) continue;
    const hasManifest = io.existsSync(path.join(c, 'scripts', 'app-migration-manifest.js'));
    const hasRunner = io.existsSync(path.join(c, 'infra', 'lib', 'utils', 'app-migrations.js'));
    if (hasManifest && hasRunner) return c;
  }
  return null;
}

/**
 * Determine which apps to migrate. Mirrors runAll(): honour the installed-app
 * registry (.lana-app-services.json -> { apps: [{ name }] }) when present,
 * otherwise every manifest app whose migrations dir is on disk.
 *
 * @param {string} backendRoot
 * @param {object} manifest - APP_MIGRATION_MANIFEST
 * @param {object} [io] - { existsSync, readFileSync }
 * @returns {string[]} sorted app names
 */
function selectAppNames(backendRoot, manifest, io) {
  const _io = io || fs;
  let names = Object.keys(manifest);
  const registryPath = path.join(backendRoot, '.lana-app-services.json');
  if (_io.existsSync(registryPath) && _io.readFileSync) {
    try {
      const reg = JSON.parse(_io.readFileSync(registryPath, 'utf8'));
      const registered = Array.isArray(reg && reg.apps)
        ? reg.apps.map((a) => a && a.name).filter(Boolean)
        : [];
      if (registered.length) names = registered;
    } catch (_e) {
      /* malformed registry: fall back to manifest scope */
    }
  }
  return names.slice().sort();
}

/**
 * Apply installed-app migrations in manifest order. Best-effort per app: one
 * broken app is recorded and does not stop the others.
 *
 * @param {object} opts
 * @param {string} opts.backendRoot
 * @param {string} [opts.databaseUrl] - seeds process.env.DATABASE_URL if unset
 * @param {object} [opts.logger]      - { info, warn }
 * @param {function} [opts.requireFn] - injectable require (tests)
 * @returns {Promise<{ran:string[],skipped:string[],failed:string[],appNames:string[]}>}
 */
async function runInstalledAppMigrations(opts) {
  const o = opts || {};
  const log = o.logger || { info() {}, warn() {} };
  const req = o.requireFn || require;
  const backendRoot = o.backendRoot;

  const { APP_MIGRATION_MANIFEST } = req(path.join(backendRoot, 'scripts', 'app-migration-manifest.js'));
  const { applyAppMigrations } = req(path.join(backendRoot, 'infra', 'lib', 'utils', 'app-migrations.js'));

  if (o.databaseUrl && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = o.databaseUrl;
  }

  const appNames = selectAppNames(backendRoot, APP_MIGRATION_MANIFEST);
  const ran = [];
  const skipped = [];
  const failed = [];

  for (const name of appNames) {
    const manifest = APP_MIGRATION_MANIFEST[name];
    if (!manifest || !Array.isArray(manifest.migrations) || manifest.migrations.length === 0) {
      skipped.push(name + ' (no manifest)');
      continue;
    }
    if (!fs.existsSync(manifest.migrationsDir)) {
      skipped.push(name + ' (not on disk)');
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      await applyAppMigrations({
        appLabel: name,
        migrationsRoot: manifest.migrationsDir,
        migrations: manifest.migrations,
        skipMigrations: false,
      });
      ran.push(name);
    } catch (err) {
      const message = (err && err.message) ? err.message : 'unknown error';
      failed.push(name + ': ' + message);
      log.warn('[pg-init] app migration FAILED for ' + name + ': ' + message);
    }
  }

  return { ran, skipped, failed, appNames };
}

module.exports = { resolveBackendRoot, selectAppNames, runInstalledAppMigrations };
