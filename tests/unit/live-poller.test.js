const path = require('path');

const { createLivePoller, ensurePoller } = require(path.join(__dirname, '../../src/js/shared/live-poller.js'));

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

describe('requestedSubject: only the run the person asked for is applied', () => {
  const { requestedSubject } = require(path.join(__dirname, '../../src/js/shared/live-poller.js'));
  const later = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

  test('a poll for run A that starts after a click on B is not applied; B is', async () => {
    const subject = requestedSubject();
    const applied = [];
    const load = (id, request) => subject.guard(id, request).then((value) => { if (value !== requestedSubject.STALE) applied.push(id); });
    subject.request('A');
    const pollA = later();
    subject.request('B'); // the click lands before the poll tick
    expect(subject.isRequested('A')).toBe(false); // the poller checks this and does not start
    const late = load('A', pollA.promise); // a tick that started anyway
    await load('B', Promise.resolve('detail-B'));
    pollA.resolve('detail-A');
    await late;
    expect(applied).toEqual(['B']);
  });

  test('closing the drawer drops an answer still in flight', async () => {
    const subject = requestedSubject();
    subject.request('A');
    const answer = later();
    const pending = subject.guard('A', answer.promise);
    subject.clear();
    answer.resolve('detail-A');
    await expect(pending).resolves.toBe(requestedSubject.STALE);
    expect(subject.current()).toBeNull();
  });

  test('control: the requested run is applied, and its failure still rejects', async () => {
    const subject = requestedSubject();
    subject.request('A');
    await expect(subject.guard('A', Promise.resolve(1))).resolves.toBe(1);
    await expect(subject.guard('A', Promise.reject(new Error('gone')))).rejects.toThrow('gone');
  });
});

