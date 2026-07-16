'use strict';

const {
  isCapabilityEnabled,
  isScreenDictionEnabled
} = require('../../src/screen-voice/app-entitlement');

function serverWith(entry) {
  return { enabledApps: [entry] };
}

const capability = {
  id: 'screen-diction',
  label: 'Screen Dictation',
  route: { type: 'capability', meta: { platforms: ['darwin', 'win32', 'linux'] } }
};

describe('screen voice discovery entitlement', () => {
  test.each(['darwin', 'win32', 'linux'])('enables the capability on %s', (platform) => {
    expect(isScreenDictionEnabled(serverWith(capability), platform)).toBe(true);
  });

  test('fails closed when the entry is absent or uses a navigable route', () => {
    expect(isScreenDictionEnabled({ enabledApps: [] }, 'darwin')).toBe(false);
    expect(isScreenDictionEnabled(serverWith({ ...capability,
      route: { type: 'embedded', url: 'https://example.com', meta: {} } }), 'darwin')).toBe(false);
    expect(isScreenDictionEnabled(serverWith({ ...capability, route: null }), 'darwin')).toBe(false);
  });

  test('honors an explicit platform allowlist', () => {
    const macOnly = { ...capability, route: { type: 'capability', meta: { platforms: ['darwin'] } } };
    expect(isCapabilityEnabled(serverWith(macOnly), 'screen-diction', 'darwin')).toBe(true);
    expect(isCapabilityEnabled(serverWith(macOnly), 'screen-diction', 'win32')).toBe(false);
  });
});
