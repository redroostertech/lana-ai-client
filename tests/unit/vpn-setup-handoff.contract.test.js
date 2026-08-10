'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function read(rel) {
  return fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');
}

function createSessionStorage() {
  const values = new Map();
  return {
    setItem: jest.fn((key, value) => values.set(key, String(value))),
    getItem: jest.fn((key) => values.get(key) || null),
    removeItem: jest.fn((key) => values.delete(key))
  };
}

describe('VPN setup handoff', () => {
  test('stores sensitive server info behind an opaque session ref', () => {
    const sessionStorage = createSessionStorage();
    const context = {
      window: {
        crypto: { randomUUID: () => 'vpn-ref-123' },
        sessionStorage
      }
    };
    vm.createContext(context);
    vm.runInContext(read('src/js/vpn-setup-handoff.js'), context);

    const secretServer = {
      orgId: 'acme',
      burstApiKey: 'burst-secret',
      forgeApiKey: 'forge-secret',
      vpn: { enabled: true }
    };

    const ref = context.window.LanaVpnSetupHandoff.create(secretServer);

    expect(ref).toBe('vpn-ref-123');
    expect(sessionStorage.setItem).toHaveBeenCalledWith(
      'lana_vpn_setup_handoff:vpn-ref-123',
      JSON.stringify(secretServer)
    );
    expect(ref).not.toContain('burst-secret');
    expect(context.window.LanaVpnSetupHandoff.read(ref)).toEqual(secretServer);
    expect(context.window.LanaVpnSetupHandoff.consume(ref)).toEqual(secretServer);
    expect(sessionStorage.removeItem).toHaveBeenCalledWith('lana_vpn_setup_handoff:vpn-ref-123');
  });

  test('production callers do not pass encoded server payloads in URLs', () => {
    const loginHtml = read('src/login.html');
    const settingsHtml = read('src/settings-v2.html');
    const settingsJs = read('src/js/settings-v2.js');
    const lexNavJs = read('src/js/lex/lex-nav.js');

    expect(loginHtml).toContain('js/vpn-setup-handoff.js');
    expect(settingsHtml).toContain('js/vpn-setup-handoff.js');
    expect(loginHtml).toContain('LanaVpnSetupHandoff.create(serverInfo)');
    expect(settingsJs).toContain('LanaVpnSetupHandoff.create(serverInfo)');
    expect(loginHtml).toContain('server_ref=');
    expect(settingsJs).toContain('server_ref');
    expect(lexNavJs).toContain("'vpn-setup.html':                         { server_ref: 'string' }");
    expect(loginHtml).not.toContain('btoa(JSON.stringify(serverInfo))');
    expect(settingsJs).not.toContain('btoa(JSON.stringify(serverInfo))');
    expect(loginHtml).not.toContain('vpn-setup.html?server=');
    expect(settingsJs).not.toContain("params: { server:");
  });

  test('fails closed when session storage is unavailable', () => {
    const context = {
      window: {
        crypto: { randomUUID: () => 'vpn-ref-123' }
      }
    };
    vm.createContext(context);
    vm.runInContext(read('src/js/vpn-setup-handoff.js'), context);

    expect(() => context.window.LanaVpnSetupHandoff.create({ burstApiKey: 'secret' }))
      .toThrow('Session storage is not available');
  });
});
