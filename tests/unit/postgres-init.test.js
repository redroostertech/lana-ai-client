'use strict';

const { makePostgresHooks } = require('../../supervisor/postgres-init');

function makeHarness({ dataDirInitialized = false, dbExists = false, tableCount = 0 } = {}) {
  const execCalls = [];
  const exec = async (cmd, args) => {
    execCalls.push({ cmd, args });
    const joined = args.join(' ');
    if (joined.includes('pg_database WHERE datname')) {
      return { stdout: dbExists ? '1' : '', code: 0 };
    }
    if (joined.includes('information_schema.tables')) {
      return { stdout: String(tableCount), code: 0 };
    }
    return { stdout: '', code: 0 };
  };
  let migrated = 0;
  const migrate = async () => { migrated += 1; };
  const fs = { existsSync: () => dataDirInitialized };
  const hooks = makePostgresHooks({
    bins: { initdb: 'initdb', psql: 'psql', createdb: 'createdb' },
    dataDir: '/data/pg', port: 5432, exec, migrate, fs,
  });
  return { hooks, execCalls, migratedCount: () => migrated };
}

describe('makePostgresHooks.prepare', () => {
  it('runs initdb when the data dir is empty', async () => {
    const h = makeHarness({ dataDirInitialized: false });
    await h.hooks.prepare();
    expect(h.execCalls.some((c) => c.cmd === 'initdb')).toBe(true);
  });

  it('skips initdb when the data dir is already initialized', async () => {
    const h = makeHarness({ dataDirInitialized: true });
    await h.hooks.prepare();
    expect(h.execCalls.some((c) => c.cmd === 'initdb')).toBe(false);
  });
});

describe('makePostgresHooks.onReady', () => {
  it('creates the db, ensures extensions, and migrates on a fresh cluster', async () => {
    const h = makeHarness({ dbExists: false, tableCount: 0 });
    await h.hooks.onReady();
    expect(h.execCalls.some((c) => c.cmd === 'createdb')).toBe(true);
    const extCreates = h.execCalls.filter((c) => c.args.join(' ').includes('CREATE EXTENSION'));
    expect(extCreates.length).toBeGreaterThanOrEqual(4);
    expect(extCreates.some((c) => c.args.join(' ').includes('vector'))).toBe(true);
    expect(h.migratedCount()).toBe(1);
  });

  it('does not createdb when the database already exists', async () => {
    const h = makeHarness({ dbExists: true, tableCount: 0 });
    await h.hooks.onReady();
    expect(h.execCalls.some((c) => c.cmd === 'createdb')).toBe(false);
    expect(h.migratedCount()).toBe(1); // empty schema still migrates
  });

  it('preserves a populated database: no extensions, no migrate', async () => {
    const h = makeHarness({ dbExists: true, tableCount: 42 });
    await h.hooks.onReady();
    expect(h.execCalls.some((c) => c.args.join(' ').includes('CREATE EXTENSION'))).toBe(false);
    expect(h.migratedCount()).toBe(0);
  });
});
