const path = require('path');

const { createLivePoller, ensurePoller, latestOnly } = require(path.join(__dirname, '../../src/js/shared/live-poller.js'));

function fakeDocument() {
  const listeners = {};
  return {
    hidden: false,
    addEventListener: (name, fn) => { listeners[name] = fn; },
    removeEventListener: (name) => { delete listeners[name]; },
    fire: (name) => listeners[name] && listeners[name](),
    listeners
  };
}

describe('live poller (shared by the automations and agents run lists)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('refreshes on its interval, one at a time, until stopped', async () => {
    let resolve;
    const refresh = jest.fn(() => new Promise((done) => { resolve = done; }));
    const poller = createLivePoller({ refresh, intervalMs: 1000, doc: fakeDocument() });
    poller.start();
    jest.advanceTimersByTime(1000);
    expect(refresh).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(3000);
    expect(refresh).toHaveBeenCalledTimes(1); // the first is still running
    resolve();
    await Promise.resolve(); await Promise.resolve();
    jest.advanceTimersByTime(1000);
    expect(refresh).toHaveBeenCalledTimes(2);
    poller.stop();
    resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(5000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  test('pauses while the window is hidden and refreshes at once when it comes back', () => {
    const doc = fakeDocument();
    const refresh = jest.fn(() => Promise.resolve());
    const poller = createLivePoller({ refresh, intervalMs: 1000, doc });
    poller.start();
    doc.hidden = true;
    jest.advanceTimersByTime(5000);
    expect(refresh).not.toHaveBeenCalled();
    doc.hidden = false;
    doc.fire('visibilitychange');
    expect(refresh).toHaveBeenCalledTimes(1);
    poller.stop();
    expect(doc.listeners.visibilitychange).toBeUndefined();
  });

  test('stops itself when its view is gone, and slows down while nothing is live', async () => {
    let alive = true;
    let live = false;
    const refresh = jest.fn(() => Promise.resolve());
    const poller = createLivePoller({ refresh, intervalMs: 1000, idleIntervalMs: 4000, isActive: () => alive, isLive: () => live, doc: fakeDocument() });
    poller.start();
    jest.advanceTimersByTime(1000);
    expect(refresh).not.toHaveBeenCalled(); // idle: waits the longer interval
    jest.advanceTimersByTime(3000);
    expect(refresh).toHaveBeenCalledTimes(1);
    await Promise.resolve(); await Promise.resolve();
    alive = false;
    jest.advanceTimersByTime(10000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(poller.running).toBe(false);
  });

  test('a failing refresh does not stop the poller', async () => {
    const refresh = jest.fn(() => Promise.reject(new Error('offline')));
    const poller = createLivePoller({ refresh, intervalMs: 1000, doc: fakeDocument() });
    poller.start();
    jest.advanceTimersByTime(1000);
    await Promise.resolve(); await Promise.resolve();
    jest.advanceTimersByTime(1000);
    expect(refresh).toHaveBeenCalledTimes(2);
    poller.stop();
  });
});

describe('ensurePoller: one poller per slot, replaced when its subject changes', () => {
  const make = () => ({ running: true, stop: jest.fn(function stop() { this.running = false; }) });

  test('the same subject keeps the running poller; a new subject replaces it; a stopped one is started again', () => {
    const holder = {};
    const create = jest.fn(make);
    const first = ensurePoller(holder, 'poller', 'run-1', create);
    expect(ensurePoller(holder, 'poller', 'run-1', create)).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);

    const second = ensurePoller(holder, 'poller', 'run-2', create);
    expect(second).not.toBe(first);
    expect(first.stop).toHaveBeenCalled();
    expect(holder.poller).toBe(second);

    second.running = false; // stopped itself (its view went away)
    const third = ensurePoller(holder, 'poller', 'run-2', create);
    expect(third).not.toBe(second);
    expect(create).toHaveBeenCalledTimes(3);
  });
});

describe('latestOnly: a slow answer for an older request is ignored', () => {
  test('opening run A then run B keeps B even when A answers last', async () => {
    const guard = latestOnly();
    let answerA;
    const applied = [];
    const open = (id, promise) => guard(promise).then((value) => { if (value !== latestOnly.STALE) applied.push([id, value]); });
    const a = open('A', new Promise((resolve) => { answerA = resolve; }));
    const b = open('B', Promise.resolve('detail-B'));
    await b;
    answerA('detail-A');
    await a;
    expect(applied).toEqual([['B', 'detail-B']]);
  });

  test('control: a single request is applied, and a failure still rejects', async () => {
    const guard = latestOnly();
    await expect(guard(Promise.resolve(1))).resolves.toBe(1);
    await expect(guard(Promise.reject(new Error('gone')))).rejects.toThrow('gone');
  });
});

