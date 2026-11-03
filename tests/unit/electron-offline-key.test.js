/**
 * The offline copy key (phase 10): only ever stored as keychain ciphertext,
 * none without a keychain, removed on sign-out.
 */
const { createOfflineKeyStore } = require('../../electron-offline-key');

function fakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (text) => Buffer.from(`enc:${text}`, 'utf8'),
    decryptString: (buffer) => {
      const text = buffer.toString('utf8');
      if (!text.startsWith('enc:')) throw new Error('not ours');
      return text.slice(4);
    }
  };
}

function memoryPersistence() {
  let value = null;
  return { read: () => value, write: (v) => { value = v; }, remove: () => { value = null; }, peek: () => value };
}

describe('offline copy key store', () => {
  test('makes a 32 byte key once, persists only ciphertext, and reads it back', () => {
    const persistence = memoryPersistence();
    const store = createOfflineKeyStore({ safeStorage: fakeSafeStorage(), persistence });
    const key = store.get();
    expect(key).toHaveLength(32);
    expect(persistence.peek()).not.toContain(key.toString('base64'));
    const again = createOfflineKeyStore({ safeStorage: fakeSafeStorage(), persistence });
    expect(again.get().equals(key)).toBe(true);
  });

  test('no keychain: no key and nothing written', () => {
    const persistence = memoryPersistence();
    const store = createOfflineKeyStore({ safeStorage: fakeSafeStorage(false), persistence });
    expect(store.get()).toBeNull();
    expect(persistence.peek()).toBeNull();
  });

  test('clear removes the key; the next one is different', () => {
    const persistence = memoryPersistence();
    const store = createOfflineKeyStore({ safeStorage: fakeSafeStorage(), persistence });
    const first = store.get();
    store.clear();
    expect(persistence.peek()).toBeNull();
    expect(store.get().equals(first)).toBe(false);
  });
});

describe('the offline key follows the session', () => {
  jest.mock('electron-store', () => class MockStore { get() { return undefined; } set() {} delete() {} }, { virtual: true });
  jest.mock('electron', () => ({ app: { getPath: () => '/tmp/lana-test-userdata' } }), { virtual: true });
  const { pushOfflineKeyFor } = require('../../electron-local-engine');

  function setup() {
    const sent = [];
    const control = { setOfflineKey: (key) => { sent.push(key); return Promise.resolve({ ok: true }); } };
    const persistence = memoryPersistence();
    const offlineKey = createOfflineKeyStore({ safeStorage: fakeSafeStorage(), persistence });
    return { sent, control, persistence, offlineKey };
  }

  test('signed in: the engine gets the key; signed out: the engine closes the copy and the key is removed', async () => {
    const { sent, control, persistence, offlineKey } = setup();
    await pushOfflineKeyFor({ token: 'token-a', offlineKey, control });
    expect(Buffer.from(sent[0], 'base64')).toHaveLength(32);
    await pushOfflineKeyFor({ token: null, offlineKey, control });
    expect(sent[1]).toBeNull();
    expect(persistence.peek()).toBeNull();
  });
});

describe('opening the app while the server cannot be reached', () => {
  const { canOpenOffline } = require('../../electron-local-engine');
  const keyStore = (available) => createOfflineKeyStore({ safeStorage: fakeSafeStorage(available), persistence: memoryPersistence() });
  test.each([
    [{ mode: 'spawn' }, true, true, true],
    [{ mode: 'off' }, true, true, false],
    [{ mode: 'spawn' }, false, true, false],
    [{ mode: 'spawn' }, true, false, false]
  ])('engine %j, keychain %s, signed in %s: opens offline %s', (config, keychain, signedIn, expected) => {
    expect(canOpenOffline({ config, offlineKey: keyStore(keychain), signedIn })).toBe(expected);
  });
});
