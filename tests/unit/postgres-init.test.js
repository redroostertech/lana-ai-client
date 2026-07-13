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

describe('makePostgresHooks.prepare timescaledb preload', () => {
  it('writes shared_preload_libraries=timescaledb when the library is present', async () => {
    const appended = [];
    const fs = {
      // conf exists; pkglibdir + the timescaledb .dylib exist -> libPresent
      existsSync: (p) => p.endsWith('.conf') || p === '/pg/lib' || p.endsWith('timescaledb.dylib'),
      readFileSync: () => '', // no existing preload line
      appendFileSync: (p, data) => appended.push({ p, data }),
    };
    const exec = async (cmd, args) => {
      const j = (args || []).join(' ');
      if (j.includes('--pkglibdir')) return { stdout: '/pg/lib', code: 0 };
      if (j.includes('--sharedir')) return { stdout: '/pg/share', code: 0 };
      return { stdout: '', code: 0 };
    };
    const hooks = makePostgresHooks({
      bins: { initdb: 'initdb', psql: 'psql', createdb: 'createdb' },
      dataDir: '/data/pg', port: 5432, exec, migrate: async () => {}, fs,
    });
    await hooks.prepare();
    expect(appended.length).toBe(1);
    expect(appended[0].data).toMatch(/shared_preload_libraries\s*=\s*'timescaledb'/);
  });

  it('does NOT enable the preload when timescaledb is absent/unverifiable (boot-safe)', async () => {
    const appended = [];
    const fs = {
      existsSync: (p) => p.endsWith('.conf'), // conf exists; no pkglibdir, no lib
      readFileSync: () => '',
      appendFileSync: (p, data) => appended.push({ p, data }),
    };
    const hooks = makePostgresHooks({
      bins: { initdb: 'initdb', psql: 'psql', createdb: 'createdb' },
      // pg_config returns nothing -> presence unverifiable; boot-safe path skips.
      dataDir: '/data/pg', port: 5432, exec: async () => ({ stdout: '', code: 0 }),
      migrate: async () => {}, fs,
    });
    await hooks.prepare();
    expect(appended.length).toBe(0);
  });

  it('does not duplicate the preload when already present', async () => {
    const appended = [];
    const fs = {
      existsSync: (p) => p.endsWith('.conf'),
      readFileSync: () => "shared_preload_libraries = 'timescaledb'\n",
      appendFileSync: (p, data) => appended.push({ p, data }),
    };
    const hooks = makePostgresHooks({
      bins: { initdb: 'initdb', psql: 'psql', createdb: 'createdb' },
      dataDir: '/data/pg', port: 5432, exec: async () => ({ stdout: '', code: 0 }), migrate: async () => {}, fs,
    });
    await hooks.prepare();
    expect(appended.length).toBe(0);
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
