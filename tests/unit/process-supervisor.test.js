'use strict';

const { EventEmitter } = require('events');
const { ProcessSupervisor, topoOrder } = require('../../supervisor/process-supervisor');

// A fake child process: EventEmitter with pid/kill and stdout/stderr streams.
function makeFakeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = [];
  child.kill = (sig) => {
    child.killed.push(sig);
    // emit exit on next tick so stopAll's wait loop resolves
    setImmediate(() => child.emit('exit', null, sig));
    return true;
  };
  return child;
}

// Records spawn calls and returns fake children.
function makeSpawnRecorder() {
  const calls = [];
  let pid = 1000;
  const children = [];
  const spawn = (command, args, opts) => {
    pid += 1;
    const child = makeFakeChild(pid);
    calls.push({ command, args, opts, child });
    children.push(child);
    return child;
  };
  return { spawn, calls, children };
}

const silentLogger = { info() {}, warn() {}, error() {} };

describe('topoOrder', () => {
  it('orders by dependsOn', () => {
    const order = topoOrder([
      { name: 'c', dependsOn: ['b'] },
      { name: 'a' },
      { name: 'b', dependsOn: ['a'] },
    ]).map((s) => s.name);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('throws on a cycle', () => {
    expect(() => topoOrder([
      { name: 'a', dependsOn: ['b'] },
      { name: 'b', dependsOn: ['a'] },
    ])).toThrow(/cycle/);
  });

  it('throws on an unknown dependency', () => {
    expect(() => topoOrder([{ name: 'a', dependsOn: ['ghost'] }])).toThrow(/unknown service dependency/);
  });
});

describe('ProcessSupervisor.startAll', () => {
  it('starts in dependency order and gates on readiness', async () => {
    const { spawn, calls } = makeSpawnRecorder();
    const sup = new ProcessSupervisor({ spawn, logger: silentLogger });
    const readyOrder = [];
    const mkReady = (name) => async () => { readyOrder.push(name); return true; };

    sup.register({ name: 'pg', command: 'postgres', readiness: mkReady('pg') });
    sup.register({ name: 'backend', command: 'node', dependsOn: ['pg'], readiness: mkReady('backend') });

    const started = await sup.startAll();
    expect(started).toEqual(['pg', 'backend']);
    expect(calls.map((c) => c.command)).toEqual(['postgres', 'node']); // pg spawned before backend
    expect(readyOrder[0]).toBe('pg');
    expect(sup.isRunning('pg')).toBe(true);
    expect(sup.isRunning('backend')).toBe(true);
    await sup.stopAll();
  });

  it('does not start a dependent until its dependency is ready', async () => {
    const { spawn, calls } = makeSpawnRecorder();
    const sup = new ProcessSupervisor({ spawn, logger: silentLogger });
    let pgReady = false;
    sup.register({ name: 'pg', command: 'postgres', readinessIntervalMs: 2, readiness: async () => pgReady });
    sup.register({ name: 'backend', command: 'node', dependsOn: ['pg'], readiness: async () => true });

    const startPromise = sup.startAll();
    // give the readiness loop a few ticks; backend must NOT be spawned yet
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.map((c) => c.command)).toEqual(['postgres']);
    pgReady = true;
    const started = await startPromise;
    expect(started).toEqual(['pg', 'backend']);
    expect(calls.map((c) => c.command)).toEqual(['postgres', 'node']);
    await sup.stopAll();
  });

  it('rolls back everything when a critical service times out', async () => {
    const { spawn, calls } = makeSpawnRecorder();
    const sup = new ProcessSupervisor({ spawn, logger: silentLogger });
    sup.register({ name: 'pg', command: 'postgres', readiness: async () => true });
    sup.register({
      name: 'backend', command: 'node', dependsOn: ['pg'],
      readiness: async () => false, readinessTimeoutMs: 30, readinessIntervalMs: 5,
    });

    await expect(sup.startAll()).rejects.toThrow(/backend/);
    // pg (which came up) must have been torn down during rollback
    const pgChild = calls.find((c) => c.command === 'postgres').child;
    expect(pgChild.killed.length).toBeGreaterThan(0);
    expect(sup.isRunning('pg')).toBe(false);
  });

  it('continues past a non-critical service that fails', async () => {
    const { spawn, calls } = makeSpawnRecorder();
    const sup = new ProcessSupervisor({ spawn, logger: silentLogger });
    sup.register({ name: 'pg', command: 'postgres', readiness: async () => true });
    sup.register({
      name: 'docling', command: 'docling', critical: false,
      readiness: async () => false, readinessTimeoutMs: 20, readinessIntervalMs: 5,
    });
    sup.register({ name: 'backend', command: 'node', dependsOn: ['pg'], readiness: async () => true });

    const started = await sup.startAll();
    expect(started).toEqual(['pg', 'backend']); // docling skipped, backend still came up
    await sup.stopAll();
  });
});

describe('ProcessSupervisor restart + teardown', () => {
  it('restarts a service that exits unexpectedly', async () => {
    const { spawn, calls } = makeSpawnRecorder();
    const sup = new ProcessSupervisor({ spawn, logger: silentLogger });
    sup.register({
      name: 'pg', command: 'postgres', readiness: async () => true,
      restart: { maxRetries: 2, baseBackoffMs: 5, maxBackoffMs: 10 },
    });
    await sup.startAll();
    expect(calls.length).toBe(1);
    // simulate an unexpected crash (not via stopAll)
    calls[0].child.emit('exit', 1, null);
    await new Promise((r) => setTimeout(r, 40));
    expect(calls.length).toBe(2); // relaunched
    await sup.stopAll();
  });

  it('stops in reverse start order', async () => {
    const { spawn, calls } = makeSpawnRecorder();
    const stopOrder = [];
    const sup = new ProcessSupervisor({ spawn, logger: silentLogger });
    for (const name of ['pg', 'minio', 'backend']) {
      sup.register({
        name, command: name,
        dependsOn: name === 'backend' ? ['pg', 'minio'] : [],
        readiness: async () => true,
      });
    }
    await sup.startAll();
    calls.forEach((c) => {
      const orig = c.child.kill;
      c.child.kill = (sig) => { stopOrder.push(c.command); return orig(sig); };
    });
    await sup.stopAll();
    // backend depends on pg+minio so it started last -> must stop first
    expect(stopOrder[0]).toBe('backend');
  });
});
