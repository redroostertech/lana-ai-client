'use strict';

const {
  capabilityViewModels,
  isCapabilityActive,
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

  test('uses a local preference without weakening the discovery entitlement', () => {
    const server = serverWith(capability);
    expect(isCapabilityActive(server, 'screen-diction', {}, 'darwin')).toBe(true);
    expect(isCapabilityActive(server, 'screen-diction', { 'screen-diction': false }, 'darwin')).toBe(false);
    expect(isCapabilityActive({ enabledApps: [] }, 'screen-diction', { 'screen-diction': true }, 'darwin')).toBe(false);
  });

  test('required capabilities stay active and default_enabled can opt in later', () => {
    const required = { ...capability, route: { type: 'capability', meta: { required: true } } };
    const defaultOff = { ...capability, route: { type: 'capability', meta: { default_enabled: false } } };
    expect(isCapabilityActive(serverWith(required), 'screen-diction', { 'screen-diction': false }, 'darwin')).toBe(true);
    expect(isCapabilityActive(serverWith(defaultOff), 'screen-diction', {}, 'darwin')).toBe(false);
    expect(capabilityViewModels(serverWith(required), {}, 'darwin')[0]).toMatchObject({
      id: 'screen-diction', required: true, active: true, available: true
    });
  });
});
