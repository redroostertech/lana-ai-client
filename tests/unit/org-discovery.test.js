/**
 * Finding the organization (js/shared/org-discovery.js): request shape, reading
 * the answer, and the words shown when it fails, which must always name the
 * support address so nobody is left stuck on the sign-in screen.
 */
'use strict';

const path = require('path');
const discovery = require(path.join(__dirname, '../../src/js/shared/org-discovery.js'));

const HEALTHY = {
  status: 'healthy',
  domain: 'smithlaw.lanaai.io',
  discovery: { static_ip: '10.0.0.5', port: 8080, is_secure_ssl: true, vpn: null },
  server: { org_id: 'smithlaw', org_name: 'Smith Law', version: '3.1.0', api_version: 'v1' },
  tier: 'pro',
  enabled_apps: ['agents']
};

function fakeFetch(status, body) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

describe('buildDiscoveryRequest', () => {
  test('posts org_id and the bare domain', () => {
    const req = discovery.buildDiscoveryRequest('smithlaw', 'https://smithlaw.lanaai.io:443/x');
    expect(req.url).toBe(discovery.DISCOVERY_URL);
    expect(req.init.method).toBe('POST');
    expect(JSON.parse(req.init.body)).toEqual({ org_id: 'smithlaw', domain: 'smithlaw.lanaai.io' });
  });

  test('server name comes from the org id', () => {
    expect(discovery.generateServerUrl(' SmithLaw ')).toBe('smithlaw.lanaai.io');
    expect(discovery.generateServerUrl('')).toBe('');
  });
});

describe('resolveOrganization', () => {
  test('reads a healthy answer into server info', async () => {
    const fetch = fakeFetch(200, HEALTHY);
    const info = await discovery.resolveOrganization('smithlaw', 'smithlaw.lanaai.io', { fetch });
    expect(fetch.calls).toHaveLength(1);
    expect(info).toMatchObject({
      url: 'https://10.0.0.5:8080',
      orgId: 'smithlaw',
      orgName: 'Smith Law',
      tier: 'pro',
      enabledApps: ['agents'],
      isSecure: true
    });
  });

  test('a hardware box carries the control plane pin and is reached over https', async () => {
    const pin = 'AB:'.repeat(31) + 'AB';
    const box = { ...HEALTHY, discovery: { static_ip: '10.0.0.5', port: 8080, is_secure_ssl: false, chef_cert_sha256: pin } };
    const info = await discovery.resolveOrganization('smithlaw', 'smithlaw.lanaai.io', { fetch: fakeFetch(200, box) });
    expect(info).toMatchObject({ url: 'https://10.0.0.5:8080', chefCertSha256: 'ab'.repeat(32), isSecure: true });
    expect(discovery.chefCertPin({ chef_cert_sha256: 'cd'.repeat(32) })).toBe('cd'.repeat(32));
  });

  test('the box\'s own certSha256 is never taken as the pin', async () => {
    const tofu = { ...HEALTHY, discovery: { static_ip: '10.0.0.5', port: 8080, is_secure_ssl: false, certSha256: 'ab'.repeat(32) } };
    const info = await discovery.resolveOrganization('smithlaw', 'smithlaw.lanaai.io', { fetch: fakeFetch(200, tofu) });
    expect(info).toMatchObject({ url: 'http://10.0.0.5:8080', chefCertSha256: null });
  });

  test.each([
    [404, { error: 'Organization not found or inactive' }, 'not_found'],
    [400, { details: ['org_id is required'] }, 'invalid'],
    [500, {}, 'service'],
    [200, { status: 'degraded' }, 'unavailable']
  ])('status %i is a %s failure', async (status, body, kind) => {
    await expect(discovery.resolveOrganization('x', 'x.lanaai.io', { fetch: fakeFetch(status, body) }))
      .rejects.toMatchObject({ kind });
  });

  test('no network is an offline failure', async () => {
    const fetch = async () => { throw new TypeError('Failed to fetch'); };
    await expect(discovery.resolveOrganization('x', 'x.lanaai.io', { fetch })).rejects.toMatchObject({ kind: 'offline' });
  });

  test('a body that is not JSON on a 200 is a service failure', async () => {
    const fetch = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } });
    await expect(discovery.resolveOrganization('x', 'x.lanaai.io', { fetch })).rejects.toMatchObject({ kind: 'service' });
  });
});

describe('describeFailure', () => {
  test.each(['not_found', 'invalid', 'offline', 'service', 'unavailable'])('%s says what to check and names support', (kind) => {
    const view = discovery.describeFailure(discovery.DiscoveryError(kind, 'x'), 'smithlaw');
    expect(view.title).toEqual(expect.any(String));
    expect(view.detail.length).toBeGreaterThan(10);
    expect(view.support).toContain('support@redroostertec.com');
    expect(view.title + view.detail + view.support).not.toMatch(/[\u2013\u2014]/);
  });

  test('not found repeats what was typed', () => {
    expect(discovery.describeFailure(discovery.DiscoveryError('not_found', 'x'), 'smithlaw').detail).toContain('"smithlaw"');
  });

  test('a server that does not answer keeps its own message', () => {
    const view = discovery.describeFailure(new Error('Smith Law is on a private network.'));
    expect(view.detail).toBe('Smith Law is on a private network.');
    expect(view.support).toContain('support@redroostertec.com');
  });
});
