'use strict';

/**
 * Hosted discovery asked by the main process for the sign-in and activation pages
 * (electron-discovery.js requestDiscovery / discoveryForPage, electron-main.js
 * discovery:resolve). The page gets the answer without the firm's service keys; main keeps them.
 */

jest.mock('electron', () => ({ app: { getPath: jest.fn(() => '/tmp') } }));
jest.mock('../../electron-logger', () => ({ logInfo: jest.fn(), logError: jest.fn() }));

const { HOSTED_DISCOVERY_URL, CONTROL_PLANE_URLS, requestDiscovery, discoveryForPage } = require('../../electron-discovery');
const { refusalFor } = require('../../electron-ipc-guard');
const { IPC_POLICY } = require('../../electron-ipc-policy');

const ANSWER = {
  status: 'healthy',
  domain: 'smithlaw.lanaai.io',
  discovery: { static_ip: '10.0.0.5', port: 8080, vpn: { enabled: true, type: 'tailscale' } },
  server: { org_id: 'smithlaw', org_name: 'Smith Law' },
  burst_api_key: 'burst-secret',
  forge_api_key: 'forge-secret',
  burst_url: 'https://burst.example',
  forge_url: 'https://forge.example'
};

const answering = (status, data) => ({ post: jest.fn(async () => ({ status, data })) });

test('the page CSP no longer allows the discovery origin: no page fetches it', () => {
  expect(CONTROL_PLANE_URLS.map((u) => new URL(u).origin)).not.toContain(new URL(HOSTED_DISCOVERY_URL).origin);
});

describe('requestDiscovery', () => {
  test('posts the org id and bare domain to main\'s control-plane address', async () => {
    const http = answering(200, ANSWER);
    const answer = await requestDiscovery({ orgId: ' smithlaw ', domain: 'smithlaw.lanaai.io' }, { http });
    expect(http.post).toHaveBeenCalledWith(HOSTED_DISCOVERY_URL, { org_id: 'smithlaw', domain: 'smithlaw.lanaai.io' }, expect.objectContaining({ validateStatus: expect.any(Function) }));
    expect(answer).toEqual({ reached: true, status: 200, body: ANSWER });
  });

  test('checks the request before asking: an empty, too long or non-string id, or a too long domain', async () => {
    const http = answering(200, ANSWER);
    for (const request of [{ orgId: '', domain: 'x' }, { orgId: '   ' }, { orgId: 'x'.repeat(129), domain: 'x' }, { orgId: 42, domain: 'x' }, { orgId: 'smithlaw', domain: 'd'.repeat(254) }, null]) {
      expect(await requestDiscovery(request, { http })).toEqual({ invalid: true });
    }
    expect(http.post).not.toHaveBeenCalled();
  });

  test('no network is not reached; any status and a non-JSON body come back as they are', async () => {
    expect(await requestDiscovery({ orgId: 'x', domain: 'x' }, { http: { post: async () => { throw new Error('ENOTFOUND'); } } })).toEqual({ reached: false });
    expect(await requestDiscovery({ orgId: 'x', domain: 'x' }, { http: answering(404, { error: 'Organization not found or inactive' }) }))
      .toEqual({ reached: true, status: 404, body: { error: 'Organization not found or inactive' } });
    expect(await requestDiscovery({ orgId: 'x', domain: 'x' }, { http: answering(200, '<html>') })).toEqual({ reached: true, status: 200, body: null });
  });
});

describe('discoveryForPage (the discovery:resolve handler)', () => {
  test('the page gets the answer without the keys; main remembers them for this firm', async () => {
    const remember = jest.fn();
    const answer = await discoveryForPage({ orgId: 'smithlaw', domain: 'smithlaw.lanaai.io' }, { http: answering(200, ANSWER), remember });
    expect(answer.body).not.toHaveProperty('burst_api_key');
    expect(answer.body).not.toHaveProperty('forge_api_key');
    expect(JSON.stringify(answer)).not.toMatch(/secret/);
    // Everything else stays, including the VPN block behind the VPN-only message.
    expect(answer.body).toMatchObject({ burst_url: 'https://burst.example', forge_url: 'https://forge.example', discovery: { vpn: { enabled: true, type: 'tailscale' } } });
    expect(remember).toHaveBeenCalledWith({ orgId: 'smithlaw', burstApiKey: 'burst-secret', burstUrl: 'https://burst.example', forgeApiKey: 'forge-secret', forgeUrl: 'https://forge.example' });
  });

  test('failures pass through unchanged and remember nothing', async () => {
    const remember = jest.fn();
    expect(await discoveryForPage({ orgId: '' }, { remember })).toEqual({ invalid: true });
    expect(await discoveryForPage({ orgId: 'x', domain: 'x' }, { http: { post: async () => { throw new Error('offline'); } }, remember })).toEqual({ reached: false });
    expect(await discoveryForPage({ orgId: 'x', domain: 'x' }, { http: answering(404, { error: 'nope' }), remember })).toEqual({ reached: true, status: 404, body: { error: 'nope' } });
    expect(remember).not.toHaveBeenCalled();
  });

  test('only the sign-in and activation pages may ask, with an object', () => {
    const from = (page) => ({ senderFrame: { url: `lana-app://app/public_html/${page}`, parent: null }, sender: { id: 1 } });
    const policy = IPC_POLICY['discovery:resolve'];
    expect(refusalFor(from('login.html'), policy, [{ orgId: 'x', domain: 'x' }])).toBe(null);
    expect(refusalFor(from('activate.html'), policy, [{ orgId: 'x', domain: 'x' }])).toBe(null);
    expect(refusalFor(from('app.html'), policy, [{ orgId: 'x', domain: 'x' }])).toBe('wrong_page');
    expect(refusalFor(from('accept-invite.html'), policy, [{ orgId: 'x', domain: 'x' }])).toBe('wrong_page');
    expect(refusalFor(from('login.html'), policy, ['smithlaw'])).toBe('bad_arguments');
  });
});
