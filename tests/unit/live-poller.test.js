const path = require('path');

const { createLivePoller } = require(path.join(__dirname, '../../src/js/shared/live-poller.js'));

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
