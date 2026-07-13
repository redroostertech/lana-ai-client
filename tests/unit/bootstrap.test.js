'use strict';

const path = require('path');
const { EventEmitter } = require('events');
const { createStackBootstrap, resolveBundledPaths } = require('../../supervisor/bootstrap');

function makeFakeChild(pid) {
  const c = new EventEmitter();
  c.pid = pid;
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.kill = () => { setImmediate(() => c.emit('exit', 0, 'SIGTERM')); return true; };
  return c;
}

function makeDeps() {
  const spawnCalls = [];
  let pid = 2000;
  const spawn = (command, args, opts) => {
    pid += 1;
    const child = makeFakeChild(pid);
    spawnCalls.push({ command, args, opts, child });
    return child;
  };
  const readyProbe = () => () => Promise.resolve(true);
  const probes = { httpProbe: readyProbe, tcpProbe: readyProbe };

  const execCalls = [];
  const exec = async (cmd, args) => {
    execCalls.push({ cmd, args });
    const j = (args || []).join(' ');
    if (j.includes('pg_database WHERE datname')) return { stdout: '', code: 0 }; // db missing -> createdb
    if (j.includes('information_schema.tables')) return { stdout: '0', code: 0 }; // fresh -> migrate
    return { stdout: '', code: 0 };
  };

  const store = new Map();
  const secretStore = { get: async (k) => store.get(k) || null, set: async (k, v) => { store.set(k, v); } };

  const fs = { existsSync: () => false, mkdirSync: () => {} };
  const crypto = { randomBytes: () => ({ toString: () => 'deadbeefkey' }) };
  // Apple Silicon 32GB -> localChat selected, but the gguf isn't on disk (existsSync=false)
  const os = { totalmem: () => 32 * 1e9, homedir: () => '/home/tester' };

  return { spawn, spawnCalls, probes, exec, execCalls, secretStore, fs, crypto, os };
}

describe('createStackBootstrap', () => {
  it('brings the stack up and returns a backend URL', async () => {
    const d = makeDeps();
    const boot = createStackBootstrap({
      repoRoot: '/lana-one', secretStore: d.secretStore,
      spawn: d.spawn, probes: d.probes, exec: d.exec, fs: d.fs, crypto: d.crypto, os: d.os,
      // force Apple-Silicon arch for selectModelPlan via os injection isn't enough (arch),
      // so pass paths explicitly to avoid resolveDevPaths + keep the test hermetic:
      paths: {
        postgres: 'postgres', initdb: 'initdb', psql: 'psql', createdb: 'createdb',
        minio: 'minio', llamaServer: 'llama-server', embedModel: '/m/nomic.gguf',
        node: 'node', backendCwd: '/lana-one',
      },
    });

    const result = await boot.start();
    expect(result.backendUrl).toBe('http://127.0.0.1:8090');
    expect(result.desktopKey).toBe('deadbeefkey');
    // required services all spawned
    const commands = d.spawnCalls.map((c) => c.command);
    expect(commands).toEqual(expect.arrayContaining(['postgres', 'minio', 'llama-server', 'node']));
    // postgres first-run ran initdb (prepare) + migrate (onReady, fresh db)
    expect(d.execCalls.some((c) => c.cmd === 'initdb')).toBe(true);
    expect(d.execCalls.some((c) => (c.args || []).join(' ').includes('scripts/migrate.js'))).toBe(true);
    // stable secrets were generated + persisted
    expect(typeof (await d.secretStore.get('JWT_SECRET'))).toBe('string');

    await boot.stop();
  });

  it('is idempotent on stop before start', async () => {
    const d = makeDeps();
    const boot = createStackBootstrap({ repoRoot: '/lana-one', secretStore: d.secretStore, spawn: d.spawn, probes: d.probes, exec: d.exec, fs: d.fs, crypto: d.crypto, os: d.os, paths: { postgres: 'postgres', initdb: 'initdb', psql: 'psql', createdb: 'createdb', minio: 'minio', llamaServer: 'llama-server', embedModel: '/m/n.gguf', node: 'node', backendCwd: '/lana-one' } });
    await expect(boot.stop()).resolves.toBeUndefined();
  });

  it('prefers bundled paths over dev paths when opts.packaged is true', async () => {
    const d = makeDeps();
    const resourcesPath = '/Applications/LANA One.app/Contents/Resources';
    // resolveBundledPaths discovers the postgres Cellar version dir via
    // readdirSync (the version is not fixed -- whatever
    // scripts/relocate-postgres.sh was run against).
    const fs = {
      ...d.fs,
      readdirSync: (dir) => {
        if (dir === path.join(resourcesPath, 'postgres', 'Cellar', 'postgresql@17')) return ['17.10'];
        return [];
      },
    };
    const boot = createStackBootstrap({
      repoRoot: '/lana-one', secretStore: d.secretStore,
      spawn: d.spawn, probes: d.probes, exec: d.exec, fs, crypto: d.crypto, os: d.os,
      packaged: true, resourcesPath,
    });

    await boot.start();
    const commands = d.spawnCalls.map((c) => c.command);
    expect(commands).toEqual(expect.arrayContaining([
      path.join(resourcesPath, 'postgres', 'Cellar', 'postgresql@17', '17.10', 'bin', 'postgres'),
      path.join(resourcesPath, 'minio', 'minio'),
      path.join(resourcesPath, 'llama-server', 'llama-server'),
      'node',
    ]));
    await boot.stop();
  });
});

describe('resolveBundledPaths', () => {
  const resourcesPath = '/App.app/Contents/Resources';

  it('discovers the versioned postgres Cellar bin dir and resolves every bundled binary', () => {
    const fs = {
      readdirSync: (dir) => {
        if (dir === path.join(resourcesPath, 'postgres', 'Cellar', 'postgresql@17')) return ['17.10'];
        throw new Error(`unexpected readdirSync(${dir})`);
      },
    };
    const paths = resolveBundledPaths({ resourcesPath, fs });

    expect(paths.postgres).toBe(path.join(resourcesPath, 'postgres', 'Cellar', 'postgresql@17', '17.10', 'bin', 'postgres'));
    expect(paths.initdb).toBe(path.join(resourcesPath, 'postgres', 'Cellar', 'postgresql@17', '17.10', 'bin', 'initdb'));
    expect(paths.psql).toBe(path.join(resourcesPath, 'postgres', 'Cellar', 'postgresql@17', '17.10', 'bin', 'psql'));
    expect(paths.createdb).toBe(path.join(resourcesPath, 'postgres', 'Cellar', 'postgresql@17', '17.10', 'bin', 'createdb'));
    expect(paths.minio).toBe(path.join(resourcesPath, 'minio', 'minio'));
    expect(paths.llamaServer).toBe(path.join(resourcesPath, 'llama-server', 'llama-server'));
    expect(paths.embedModel).toBe(path.join(resourcesPath, 'models', 'nomic-embed-text-v1.5.f16.gguf'));
    expect(paths.doclingCmd).toBe(path.join(resourcesPath, 'python', 'docling', 'venv', 'bin', 'docling-serve'));
    expect(paths.unstructuredUvicorn).toBe(path.join(resourcesPath, 'python', 'unstructured', 'venv', 'bin', 'uvicorn'));
  });

  it('picks the highest version when multiple postgres Cellar versions are staged', () => {
    const fs = { readdirSync: () => ['17.2', '17.10', '17.9'] };
    const paths = resolveBundledPaths({ resourcesPath, fs });
    expect(paths.postgres).toBe(path.join(resourcesPath, 'postgres', 'Cellar', 'postgresql@17', '17.9', 'bin', 'postgres'));
  });

  it('falls back to a flat postgres/bin layout if no Cellar tree is staged', () => {
    const fs = { readdirSync: () => { throw new Error('ENOENT'); } };
    const paths = resolveBundledPaths({ resourcesPath, fs });
    expect(paths.postgres).toBe(path.join(resourcesPath, 'postgres', 'bin', 'postgres'));
  });

  it('throws without a resourcesPath', () => {
    expect(() => resolveBundledPaths({})).toThrow(/resourcesPath/);
  });
});
