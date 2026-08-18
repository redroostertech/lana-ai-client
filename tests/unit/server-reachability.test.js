/**
 * Regression: a resolved-but-unreachable VPN org must produce an actionable
 * message, never a navigation to vpn-setup.html.
 *
 * The bug: discovery for a sovereign org returns vpn.enabled = true with an
 * address only reachable inside the tailnet. When the reachability probe failed,
 * login redirected the window to `vpn-setup.html`, a page that has never existed
 * in this repo. The navigation failed and left a blank white window with no
 * explanation of what went wrong.
 */
const fs = require('fs');
const path = require('path');

const reachability = require(path.join(__dirname, '../../src/js/shared/server-reachability.js'));

// Mirrors the live discovery payload for the `redrooster` org: VPN is flagged
// as required, but every field that a setup page would need is empty.
const VPN_SERVER_INFO = {
  url: 'http://lana-ai-chef.taile853ba.ts.net:8080',
  orgId: 'redrooster',
  orgName: 'RedRooster Technologies',
  staticIp: 'lana-ai-chef.taile853ba.ts.net',
  port: 8080,
  vpn: {
    enabled: true,
    type: 'tailscale',
    required_for_remote_access: true,
    endpoint: '',
    wireguard_endpoint: '',
    server_public_key: '',
    bootstrap_psk: '',
    subnet: '',
    dns: [],
    allowed_networks: []
  }
};

describe('buildUnreachableMessage', () => {
  test('names the VPN and the unreachable host when the org requires a VPN', () => {
    const message = reachability.buildUnreachableMessage(VPN_SERVER_INFO);

    expect(message).toContain('RedRooster Technologies');
    expect(message).toContain('Tailscale VPN');
    expect(message).toContain('lana-ai-chef.taile853ba.ts.net:8080');
    expect(message).toMatch(/try again/i);
  });

  test('never emits a vpn-setup.html navigation target', () => {
    expect(reachability.buildUnreachableMessage(VPN_SERVER_INFO)).not.toContain('vpn-setup');
  });

  test('falls back to the generic network message when no VPN is advertised', () => {
    const message = reachability.buildUnreachableMessage({
      orgId: 'acme',
      staticIp: '10.0.0.5',
      port: 8080,
      vpn: null
    });

    expect(message).toContain('10.0.0.5:8080');
    expect(message).toContain('contact your administrator');
    expect(message).not.toMatch(/VPN/i);
  });

  test('treats vpn.enabled = false as no VPN', () => {
    const message = reachability.buildUnreachableMessage({
      orgId: 'acme',
      staticIp: '10.0.0.5',
      port: 8080,
      vpn: { enabled: false, type: 'wireguard' }
    });

    expect(message).toContain('contact your administrator');
    expect(message).not.toMatch(/VPN/i);
  });

  test('degrades gracefully when discovery omits fields', () => {
    expect(() => reachability.buildUnreachableMessage({})).not.toThrow();
    expect(() => reachability.buildUnreachableMessage(null)).not.toThrow();

    // No org name and no host: still a sentence, with no "undefined" leaking.
    const bare = reachability.buildUnreachableMessage({ vpn: { enabled: true } });
    expect(bare).toContain('This organization');
    expect(bare).not.toMatch(/undefined|null/);
  });

  test('omits the port when discovery does not supply one', () => {
    const message = reachability.buildUnreachableMessage({
      orgId: 'acme',
      staticIp: 'server.example.com'
    });

    expect(message).toContain('server.example.com');
    expect(message).not.toContain('server.example.com:');
  });
});

describe('requiresVpn', () => {
  test('is true only when discovery enables the vpn block', () => {
    expect(reachability.requiresVpn(VPN_SERVER_INFO)).toBe(true);
    expect(reachability.requiresVpn({ vpn: { enabled: false } })).toBe(false);
    expect(reachability.requiresVpn({ vpn: null })).toBe(false);
    expect(reachability.requiresVpn({})).toBe(false);
    expect(reachability.requiresVpn(null)).toBe(false);
  });
});

describe('dead vpn-setup.html navigation is gone from the client', () => {
  const clientFiles = [
    '../../src/login.html',
    '../../src/js/settings-v2.js'
  ];

  test.each(clientFiles)('%s does not navigate to vpn-setup.html', (relativePath) => {
    const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8');

    expect(source).not.toContain('vpn-setup.html');
  });
});
