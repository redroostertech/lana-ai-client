/**
 * The API base rule (electron-api-base.js): the local engine's loopback
 * address whenever the engine is configured and on, healthy or not; Chef's
 * URL otherwise. The engine address is never stored as the organization's.
 */

const {
  resolveEngineConfig,
  resolveApiBase,
  presentServer,
  toStoredServer,
  withoutFirmSecrets,
  keepStoredFirmSecrets,
  firmSecretsFromDiscovery
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

describe('the firm\'s service keys stay in the main process', () => {
  const stored = { orgId: 'org-1', url: CHEF, burstApiKey: 'burst-secret', forgeApiKey: 'forge-secret', forgeUrl: 'https://forge.example' };

  test('a page never gets them', () => {
    const page = withoutFirmSecrets(presentServer(stored, { mode: 'off' }));
    expect(page).not.toHaveProperty('burstApiKey');
    expect(page).not.toHaveProperty('forgeApiKey');
    expect(page.forgeUrl).toBe('https://forge.example');
    expect(stored.burstApiKey).toBe('burst-secret');
  });

  test('a page cannot set them: the stored keys stay for the same firm', () => {
    const saved = keepStoredFirmSecrets({ orgId: 'org-1', url: CHEF, forgeUrl: 'https://forge.example', burstApiKey: 'page-value', forgeApiKey: 'page-value' }, stored);
    expect(saved).toMatchObject({ burstApiKey: 'burst-secret', forgeApiKey: 'forge-secret' });
  });

  test('another firm starts without keys until main\'s own discovery fetches them', () => {
    const saved = keepStoredFirmSecrets({ orgId: 'org-2', url: CHEF, burstApiKey: 'page-value' }, stored);
    expect(saved).not.toHaveProperty('burstApiKey');
    expect(saved).not.toHaveProperty('forgeApiKey');
    expect(keepStoredFirmSecrets({ orgId: 'org-1' }, null)).toEqual({ orgId: 'org-1' });
  });
});

describe('the firm\'s service keys in a discovery answer', () => {
  test('stripped for the page and read for main', () => {
    const body = { server: { org_id: 'org-1' }, burst_api_key: 'b', forge_api_key: 'f', forge_url: 'https://forge.example' };
    expect(withoutFirmSecrets(body)).toEqual({ server: { org_id: 'org-1' }, forge_url: 'https://forge.example' });
    expect(firmSecretsFromDiscovery(body)).toEqual({ orgId: 'org-1', burstApiKey: 'b', forgeApiKey: 'f', forgeUrl: 'https://forge.example' });
    expect(firmSecretsFromDiscovery({ server: { org_id: 'org-1' } })).toEqual({ orgId: 'org-1' });
    expect(firmSecretsFromDiscovery({ error: 'nope' })).toBe(null);
  });
});

describe('a firm key goes only with its own service address', () => {
  const stored = { orgId: 'org-1', burstApiKey: 'burst-secret', burstUrl: 'https://burst.example', forgeApiKey: 'forge-secret', forgeUrl: 'https://forge.example' };

  test('same org and same address: the stored key stays', () => {
    const saved = keepStoredFirmSecrets({ orgId: 'org-1', burstUrl: 'https://burst.example', forgeUrl: 'https://forge.example/' }, stored);
    expect(saved).toMatchObject({ burstApiKey: 'burst-secret', forgeApiKey: 'forge-secret' });
  });

  test('a page that changes a service address does not get the key sent there', () => {
    const saved = keepStoredFirmSecrets({ orgId: 'org-1', burstUrl: 'https://burst.example', forgeUrl: 'https://evil.example' }, stored);
    expect(saved.burstApiKey).toBe('burst-secret');
    expect(saved).not.toHaveProperty('forgeApiKey');
    const noUrl = keepStoredFirmSecrets({ orgId: 'org-1' }, stored);
    expect(noUrl).not.toHaveProperty('burstApiKey');
    expect(noUrl).not.toHaveProperty('forgeApiKey');
  });

  test('keys read from discovery carry their addresses', () => {
    const body = { server: { org_id: 'org-1' }, burst_api_key: 'b', burst_url: 'https://burst.example', forge_api_key: 'f', forge_url: 'https://forge.example' };
    expect(firmSecretsFromDiscovery(body)).toEqual({ orgId: 'org-1', burstApiKey: 'b', burstUrl: 'https://burst.example', forgeApiKey: 'f', forgeUrl: 'https://forge.example' });
  });
});
