/**
 * The API base rule (electron-api-base.js): the local engine's loopback
 * address whenever the engine is configured and on, healthy or not; Chef's
 * URL otherwise. The engine address is never stored as the organization's.
 */

const {
  resolveEngineConfig,
  resolveApiBase,
  presentServer,
  toStoredServer
} = require('../../electron-api-base');

const CHEF = 'https://chef.example.test';
const ENGINE = 'http://127.0.0.1:47011';
const stored = { url: CHEF, orgId: 'org-1', orgName: 'Example' };

const healthy = { mode: 'spawn', url: ENGINE, process: 'running', healthy: true };
const unhealthy = { mode: 'spawn', url: ENGINE, process: 'restarting', healthy: false };
const off = { mode: 'off', url: null, process: 'stopped', healthy: false };

describe('resolveEngineConfig', () => {
  test('no engine root and no attach URL: off, not configured', () => {
    expect(resolveEngineConfig({}, {})).toMatchObject({ mode: 'off', reason: 'not_configured', configured: false, enabled: false });
  });

  test('engine root from env: spawn, on by default', () => {
    expect(resolveEngineConfig({ LANA_ENGINE_ROOT: '/opt/engine' }, { enabled: null })).toMatchObject({ mode: 'spawn', root: '/opt/engine', enabled: true });
  });

  test('engine root from the saved setting when env is unset', () => {
    expect(resolveEngineConfig({}, { root: '/opt/saved' })).toMatchObject({ mode: 'spawn', root: '/opt/saved' });
  });

  test('the setting turned off wins over a configured root', () => {
    expect(resolveEngineConfig({ LANA_ENGINE_ROOT: '/opt/engine' }, { enabled: false })).toMatchObject({ mode: 'off', reason: 'disabled', configured: true, enabled: false });
  });

  test('LANA_ENGINE_URL attaches to an engine started elsewhere', () => {
    expect(resolveEngineConfig({ LANA_ENGINE_URL: 'http://127.0.0.1:46180/' }, {})).toMatchObject({ mode: 'attach', attachUrl: 'http://127.0.0.1:46180' });
  });

  test('the persisted port is passed on when valid', () => {
    expect(resolveEngineConfig({ LANA_ENGINE_ROOT: '/e' }, { port: 48123 }).preferredPort).toBe(48123);
    expect(resolveEngineConfig({ LANA_ENGINE_ROOT: '/e' }, { port: 70000 }).preferredPort).toBeNull();
  });
});

describe('resolveApiBase', () => {
  test('engine in use and healthy: the engine', () => {
    expect(resolveApiBase(CHEF, healthy)).toBe(ENGINE);
  });

  test('engine in use but unhealthy: still the engine (never silently around it)', () => {
    expect(resolveApiBase(CHEF, unhealthy)).toBe(ENGINE);
  });

  test('engine off: Chef, exactly as before', () => {
    expect(resolveApiBase(CHEF, off)).toBe(CHEF);
    expect(resolveApiBase(CHEF, null)).toBe(CHEF);
  });

  test('no server and no engine: nothing', () => {
    expect(resolveApiBase(null, off)).toBeNull();
  });
});

describe('presentServer / toStoredServer', () => {
  test('the renderer sees the engine as url and Chef as chefUrl', () => {
    expect(presentServer(stored, healthy)).toMatchObject({ url: ENGINE, chefUrl: CHEF, localEngine: true, orgId: 'org-1' });
  });

  test('engine off: url is Chef', () => {
    expect(presentServer(stored, off)).toMatchObject({ url: CHEF, chefUrl: CHEF, localEngine: false });
  });

  test('a presented server saved back stores Chef, not the engine', () => {
    const roundTrip = toStoredServer(presentServer(stored, healthy), { engineUrl: ENGINE, storedUrl: CHEF });
    expect(roundTrip.url).toBe(CHEF);
    expect(roundTrip.chefUrl).toBeUndefined();
    expect(roundTrip.localEngine).toBeUndefined();
  });

  test('an object from an earlier engine session (another port) stores Chef', () => {
    const stale = { ...stored, url: 'http://127.0.0.1:40000', chefUrl: CHEF, localEngine: true };
    expect(toStoredServer(stale, { engineUrl: ENGINE, storedUrl: CHEF }).url).toBe(CHEF);
  });

  test('a fresh discovery result is stored as given', () => {
    const fresh = { url: 'https://new-org.example.test', orgId: 'org-2' };
    expect(toStoredServer(fresh, { engineUrl: ENGINE, storedUrl: CHEF }).url).toBe('https://new-org.example.test');
  });

  test('the bare engine address without chefUrl keeps the stored Chef URL', () => {
    expect(toStoredServer({ url: ENGINE, orgId: 'org-1' }, { engineUrl: ENGINE, storedUrl: CHEF }).url).toBe(CHEF);
  });
});
