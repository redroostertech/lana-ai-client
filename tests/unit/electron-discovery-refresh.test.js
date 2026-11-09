'use strict';

jest.mock('electron', () => ({ app: { getPath: jest.fn(() => '/tmp') } }));
jest.mock('../../electron-logger', () => ({ logInfo: jest.fn(), logError: jest.fn() }));

const {
  HOSTED_DISCOVERY_URL,
  mergeHostedDiscovery,
  refreshHostedDiscovery,
  serverFromDiscovery,
  discoverByDomain
} = require('../../electron-discovery');

const saved = {
  url: 'http://100.100.10.20:8080',
  host: '100.100.10.20',
  port: '8080',
  domain: 'redrooster.lanaai.io',
  orgId: 'redrooster',
  orgName: 'Old name',
  tier: 'standard',
  burstApiKey: 'old-key',
  enabledApps: [{ id: 'lana-works' }]
};

const responseData = {
  status: 'healthy',
  domain: 'redrooster.lanaai.io',
  server: { org_id: 'redrooster', org_name: 'RedRooster Technologies', version: '4.1.0', api_version: 'v1' },
  discovery: { static_ip: 'new-address.example', port: 443, is_secure_ssl: true },
  tier: 'enterprise',
  rate_limit: 500,
  burst_api_key: null,
  enabled_apps: [
    { id: 'lana-works' },
    { id: 'screen-diction', label: 'Screen Dictation', route: { type: 'capability', meta: { platforms: ['darwin'] } } }
  ]
};

describe('hosted discovery startup refresh', () => {
  test('updates control-plane metadata without replacing the verified server route', () => {
    const merged = mergeHostedDiscovery(saved, responseData);
    expect(merged).toMatchObject({
      url: saved.url,
      host: saved.host,
      orgName: 'RedRooster Technologies',
      tier: 'enterprise',
      rateLimit: 500,
      burstApiKey: null
    });
    expect(merged.enabledApps.map((app) => app.id)).toEqual(['lana-works', 'screen-diction']);
  });

  test('posts the persisted organization identity to the hosted resolver', async () => {
    const http = { post: jest.fn(async () => ({ status: 200, data: responseData })) };
    const refreshed = await refreshHostedDiscovery(saved, { http });
    expect(http.post).toHaveBeenCalledWith(HOSTED_DISCOVERY_URL, {
      org_id: saved.orgId,
      domain: saved.domain
    }, expect.objectContaining({ timeout: 5000 }));
    expect(refreshed.enabledApps).toEqual(responseData.enabled_apps);
  });

  test('fails open to the last saved connection when refresh is unavailable', async () => {
    const http = { post: jest.fn(async () => { throw new Error('offline'); }) };
    await expect(refreshHostedDiscovery(saved, { http })).resolves.toBeNull();
    expect(http.post).toHaveBeenCalledTimes(1);
  });

  test('does not call hosted discovery without its persisted lookup identity', async () => {
    const http = { post: jest.fn() };
    await expect(refreshHostedDiscovery({ ...saved, domain: null }, { http })).resolves.toBeNull();
    expect(http.post).not.toHaveBeenCalled();
  });
});

// App links (electron-app-links.js) find a firm from the link's domain.
describe('discoverByDomain', () => {
  test('maps the answer the way the sign-in page saves it', () => {
    expect(serverFromDiscovery(responseData)).toMatchObject({
      url: 'https://new-address.example:443',
      host: 'new-address.example',
      port: 443,
      orgId: 'redrooster',
      orgName: 'RedRooster Technologies',
      domain: 'redrooster.lanaai.io',
      tier: 'enterprise'
    });
    expect(serverFromDiscovery({ status: 'not_found' })).toBeNull();
  });

  test('posts the org id hint with the domain and returns the server once it answers', async () => {
    const http = { post: jest.fn(async () => ({ status: 200, data: responseData })) };
    const verify = jest.fn(async () => ({ url: 'ok' }));
    const server = await discoverByDomain('redrooster.lanaai.io', 'redrooster', { http, verify });
    expect(http.post).toHaveBeenCalledWith(HOSTED_DISCOVERY_URL, { org_id: 'redrooster', domain: 'redrooster.lanaai.io' }, expect.any(Object));
    expect(verify).toHaveBeenCalledWith('https://new-address.example:443');
    expect(server.orgId).toBe('redrooster');
  });

  test('null when the firm is not found, unreachable, or there is no hint', async () => {
    const notFound = { post: jest.fn(async () => { throw Object.assign(new Error('404'), { response: { status: 404 } }); }) };
    expect(await discoverByDomain('x.lanaai.io', 'x', { http: notFound })).toBeNull();
    const found = { post: jest.fn(async () => ({ status: 200, data: responseData })) };
    expect(await discoverByDomain('redrooster.lanaai.io', 'redrooster', { http: found, verify: async () => null })).toBeNull();
    expect(await discoverByDomain('redrooster.lanaai.io', null, { http: found })).toBeNull();
    expect(found.post).toHaveBeenCalledTimes(1);
  });
});
