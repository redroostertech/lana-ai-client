'use strict';

/**
 * A kept local server that cannot start (electron-process-keeper.js): an exit code that means
 * "not installed or not ready" stops it without restarts, and too many restarts in a short time
 * stop it with a clear state, until retry().
 */

const { EventEmitter } = require('events');
const { createKeptProcess } = require('../../electron-process-keeper');
const { DOCLING_DEFAULTS, shouldStartDocling } = require('../../electron-docling');

function fakeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.stdout = { pipe: jest.fn() };
  child.stderr = { pipe: jest.fn() };
  child.kill = () => { Promise.resolve().then(() => { child.exitCode = 0; child.emit('exit', null, 'SIGTERM'); }); return true; };
  return child;
}

function harness(options) {
  const children = [];
  const states = [];
  const keeper = createKeptProcess({
    name: 'docling', label: 'docling',
    spawn: jest.fn(() => { const c = fakeChild(100 + children.length); children.push(c); return c; }),
    timers: { setTimeout, clearTimeout }, now: () => Date.now(),
    log: { info() {}, warn() {}, error() {} }, openLog: () => null,
    onChange: (state) => states.push(state), options
  });
  const spec = { command: '/x/docling-serve', args: [], port: 5001, check: async () => 'not yet' };
  return { keeper, children, states, spec };
}

const exitWith = (child, code) => { child.exitCode = code; child.emit('exit', code, null); };

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

test('an exit code meaning "not ready" stops without restarts', async () => {
  const { keeper, children, spec } = harness({ notReadyExitCodes: [3] });
  keeper.start(spec);
  exitWith(children[0], 3);
  await jest.advanceTimersByTimeAsync(120000);
  expect(children).toHaveLength(1);
  expect(keeper.getState()).toMatchObject({ process: 'not_ready', lastExit: { code: 3 } });
});

test('too many restarts in a short time stop it, with a clear state; retry starts again', async () => {
  const { keeper, children, spec } = harness({ maxRestarts: 3, restartWindowMs: 10 * 60 * 1000 });
  keeper.start(spec);
  for (let i = 0; i < 6; i += 1) {
    const last = children[children.length - 1];
    if (last.exitCode === null) exitWith(last, 1);
    await jest.advanceTimersByTimeAsync(61000);
  }
  // The first launch and three restarts, then no more.
  expect(children).toHaveLength(4);
  expect(keeper.getState()).toMatchObject({ process: 'failed', failure: 'too_many_restarts' });
  keeper.retry();
  expect(children).toHaveLength(5);
  expect(keeper.getState()).toMatchObject({ process: 'starting', failure: null });
  // Try again does not forget the recent failures: one more crash stops it at once.
  exitWith(children[4], 1);
  await jest.advanceTimersByTimeAsync(61000);
  expect(children).toHaveLength(5);
  expect(keeper.getState()).toMatchObject({ process: 'failed', failure: 'too_many_restarts' });
  // Once the failures are older than the window, restarts resume.
  await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
  keeper.retry();
  exitWith(children[5], 1);
  await jest.advanceTimersByTimeAsync(61000);
  expect(children).toHaveLength(7);
});

test('retry-server is limited to Settings and the first-launch screen', () => {
  const { IPC_POLICY } = require('../../electron-ipc-policy');
  expect(IPC_POLICY['first-launch:retry-server']).toMatchObject({ kind: 'invoke', pages: ['settings-v2.html', 'first-launch.html'] });
});

test('without the options a keeper restarts as before (Pip, the redactor)', async () => {
  const { keeper, children, spec } = harness({});
  keeper.start(spec);
  for (let i = 0; i < 5; i += 1) {
    exitWith(children[children.length - 1], 1);
    await jest.advanceTimersByTimeAsync(61000);
  }
  expect(children).toHaveLength(6);
});

test('Docling: exit code 3 is "not ready", and restarts are capped', () => {
  expect(DOCLING_DEFAULTS.notReadyExitCodes).toContain(3);
  expect(DOCLING_DEFAULTS.maxRestarts).toBeGreaterThan(0);
  expect(DOCLING_DEFAULTS.restartWindowMs).toBeGreaterThan(0);
});

test('Docling waits for first-launch setup unless it is set up another way', () => {
  expect(shouldStartDocling(null, { setupDone: true })).toBe(false);
  expect(shouldStartDocling({ source: 'venv' }, { setupDone: false })).toBe(false);
  expect(shouldStartDocling({ source: 'venv' }, { setupDone: true })).toBe(true);
  expect(shouldStartDocling({ source: 'runtime' }, { setupDone: false })).toBe(true);
  expect(shouldStartDocling({ source: 'bin' }, { setupDone: false })).toBe(true);
  expect(shouldStartDocling({ external: 'http://127.0.0.1:5001', source: 'external' }, { setupDone: false })).toBe(true);
});

test('electron-main.js starts Docling at launch only when it may, and again when setup finishes', () => {
  const main = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'electron-main.js'), 'utf8');
  expect(main).toMatch(/if \(shouldStartDocling\(resolveDocling\(\), \{ setupDone: Boolean\(firstLaunchPersistence\.read\(\)\.completedAt\) \}\)\) \{\s*void docling\.start\(\)/);
  const onReady = main.slice(main.indexOf('  onReady: (result) => {'), main.indexOf('\n  }', main.indexOf('  onReady: (result) => {')));
  expect(onReady).toMatch(/docling\.start\(\)/);
});

test('Docling start() twice at once starts one server (whenReady and setup finishing together)', async () => {
  const { createDocling } = require('../../electron-docling');
  let releasePort;
  const spawn = jest.fn(() => fakeChild(500));
  const docling = createDocling({
    command: { command: '/x/docling-serve', args: (port) => ['--port', String(port)], cwd: '/x', env: {}, source: 'runtime' },
    spawn,
    fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    pickPort: jest.fn(() => new Promise((resolve) => { releasePort = () => resolve(51000); })),
    log: { info() {}, warn() {}, error() {} }
  });
  const first = docling.start();
  const second = docling.start();
  releasePort();
  await Promise.all([first, second]);
  expect(spawn).toHaveBeenCalledTimes(1);
  await docling.stop();
});
