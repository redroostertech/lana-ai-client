/**
 * @jest-environment node
 *
 * The login token lives in the main process and is exposed only to the top
 * window by the preload (window.lanaAuthToken). Pages loaded in a same-origin
 * iframe (connector viewer, embedded file viewer, Doc Studio preview) must
 * reach the top window's bridge, and must never read across origins.
 */
const Bridge = require('../../../src/js/shared/auth-token-bridge.js');

function makeBridge(token) {
  let value = token;
  return {
    get: () => value,
    set: (t) => { value = t; return true; },
    clear: () => { value = null; }
  };
}

function makeWindow(opts = {}) {
  const win = {
    location: { origin: opts.origin || 'file://', href: 'file:///app/page.html' },
    postMessage: jest.fn()
  };
  if (opts.bridge) win.lanaAuthToken = opts.bridge;
  win.top = win;
  win.parent = win;
  return win;
}

describe('auth-token-bridge', () => {
  test('unframed window uses its own bridge', () => {
    const own = makeBridge('own-token');
    const win = makeWindow({ bridge: own });
    expect(Bridge.resolve(win)).toBe(own);
    expect(Bridge.getToken(win)).toBe('own-token');
    expect(Bridge.isFramed(win)).toBe(false);
  });

  test('framed same-origin window returns the top window token', () => {
    const top = makeWindow({ bridge: makeBridge('parent-token') });
    const frame = makeWindow();
    frame.top = top;
    frame.parent = top;
    expect(Bridge.isFramed(frame)).toBe(true);
    expect(Bridge.resolve(frame)).toBe(top.lanaAuthToken);
    expect(Bridge.getToken(frame)).toBe('parent-token');
  });

  test('nested frame reaches the top window, not just the parent', () => {
    const top = makeWindow({ bridge: makeBridge('top-token') });
    const middle = makeWindow();
    middle.top = top; middle.parent = top;
    const inner = makeWindow();
    inner.top = top; inner.parent = middle;
    expect(Bridge.getToken(inner)).toBe('top-token');
  });

  test('framed cross-origin window (access throws) returns null and does not redirect', () => {
    const frame = makeWindow();
    const hostile = {};
    Object.defineProperty(hostile, 'location', { get() { throw new Error('SecurityError'); } });
    Object.defineProperty(hostile, 'lanaAuthToken', { get() { throw new Error('SecurityError'); } });
    frame.top = hostile;
    frame.parent = hostile;
    expect(Bridge.resolve(frame)).toBeNull();
    expect(Bridge.getToken(frame)).toBeNull();
    expect(frame.location.href).toBe('file:///app/page.html');
  });

  test('framed window with a different top origin returns null', () => {
    const top = makeWindow({ origin: 'https://evil.example', bridge: makeBridge('secret') });
    const frame = makeWindow();
    frame.top = top; frame.parent = top;
    expect(Bridge.getToken(frame)).toBeNull();
  });

  test('install aliases the top bridge into a framed window that has none', () => {
    const top = makeWindow({ bridge: makeBridge('parent-token') });
    const frame = makeWindow();
    frame.top = top; frame.parent = top;
    Bridge.install(frame);
    expect(frame.lanaAuthToken.get()).toBe('parent-token');
    frame.lanaAuthToken.set('refreshed');
    expect(top.lanaAuthToken.get()).toBe('refreshed');
  });

  test('install leaves an unframed window and a cross-origin frame alone', () => {
    const own = makeBridge('own');
    const win = makeWindow({ bridge: own });
    Bridge.install(win);
    expect(win.lanaAuthToken).toBe(own);

    const frame = makeWindow();
    const hostile = {};
    Object.defineProperty(hostile, 'lanaAuthToken', { get() { throw new Error('SecurityError'); } });
    Object.defineProperty(hostile, 'location', { get() { throw new Error('SecurityError'); } });
    frame.top = hostile; frame.parent = hostile;
    Bridge.install(frame);
    expect(frame.lanaAuthToken).toBeUndefined();
  });

  test('notifyAuthRequired posts to the parent instead of navigating', () => {
    const top = makeWindow();
    const frame = makeWindow();
    frame.top = top; frame.parent = top;
    expect(Bridge.notifyAuthRequired(frame, 'missing')).toBe(true);
    // '*' delivers under file:// (opaque origin); the payload carries no secret.
    expect(top.postMessage).toHaveBeenCalledWith({ type: 'lana-auth-required', reason: 'missing' }, '*');
    expect(frame.location.href).toBe('file:///app/page.html');
  });

  describe('parent listener for lana-auth-required', () => {
    function host() {
      const childA = {};
      const childB = {};
      const frames = [{ contentWindow: childA }, { contentWindow: childB }];
      let handler = null;
      const win = {
        document: { querySelectorAll: (sel) => (sel === 'iframe' ? frames : []) },
        addEventListener: (type, fn) => { if (type === 'message') handler = fn; }
      };
      const onAuthRequired = jest.fn();
      Bridge.listenForFramedAuthRequired(win, onAuthRequired);
      return { frames, childA, childB, onAuthRequired, send: (event) => handler(event) };
    }

    test('a message from one of our iframes calls the handler with that frame', () => {
      const h = host();
      h.send({ source: h.childB, data: { type: 'lana-auth-required', reason: 'expired' } });
      expect(h.onAuthRequired).toHaveBeenCalledWith(h.frames[1], 'expired');
    });

    test('a message from a window that is not our iframe is ignored', () => {
      const h = host();
      h.send({ source: {}, data: { type: 'lana-auth-required', reason: 'missing' } });
      h.send({ source: null, data: { type: 'lana-auth-required' } });
      expect(h.onAuthRequired).not.toHaveBeenCalled();
    });

    test('other message types from our iframes are ignored', () => {
      const h = host();
      h.send({ source: h.childA, data: { type: 'lex-embedded-back' } });
      h.send({ source: h.childA, data: 'lana-auth-required' });
      expect(h.onAuthRequired).not.toHaveBeenCalled();
    });
  });
});
