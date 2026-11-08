'use strict';

/** Settings > General text (src/js/settings-general.model.js). */
const G = require('../../src/js/settings-general.model');

const info = {
  app: { version: '4.1.0', displayVersion: 'v4.1.0', packaged: true, electron: '44.9.1', chrome: '146.0.7680.0', node: '24.11.0' },
  device: { computerName: 'Studio', platform: 'darwin', osVersion: '26.3.0', arch: 'arm64', cpuModel: 'Apple M3 Max', cpuCores: 16, memoryBytes: 64 * 1024 ** 3 },
  storage: { totalBytes: 994_662_584_320, freeBytes: 412_345_678_912 },
  locale: { appLocale: 'en-US', systemLocale: 'en-US', preferredLanguages: ['en-US', 'es-MX'] },
};

describe('sizes', () => {
  test('disk sizes are decimal, like the computer shows them', () => {
    expect(G.bytes(994_662_584_320)).toBe('995 GB');
    expect(G.bytes(41_234_567_891)).toBe('41.2 GB');
    expect(G.bytes(2_000_000_000_000)).toBe('2 TB');
    expect(G.bytes(null)).toBe('Not available');
  });

  test('memory is whole gigabytes', () => {
    expect(G.memory(64 * 1024 ** 3)).toBe('64 GB');
    expect(G.memory(0)).toBe('Not available');
  });
});

describe('About', () => {
  test('name, version, the computer and its storage, in order', () => {
    const view = G.aboutView(info, 'LANA AI');
    expect(view.rows).toEqual([
      { label: 'Name', value: 'LANA AI' },
      { label: 'Version', value: 'v4.1.0' },
      { label: 'Computer name', value: 'Studio' },
      { label: 'Operating system', value: 'macOS 26.3' },
      { label: 'Processor', value: 'Apple M3 Max, 16 cores' },
      { label: 'Architecture', value: 'Apple silicon (arm64)' },
      { label: 'Memory', value: '64 GB' },
      { label: 'Capacity', value: '995 GB' },
      { label: 'Available', value: '412 GB available' },
      { label: 'Runtime', value: 'Electron 44.9.1, Chromium 146.0.7680.0, Node.js 24.11.0' },
    ]);
    expect(view.warning).toBe('');
  });

  test('Windows and Intel read plainly', () => {
    const view = G.aboutView({ ...info, device: { ...info.device, platform: 'win32', osVersion: '10.0.26100', arch: 'x64' } }, 'LANA AI');
    expect(view.rows.find((row) => row.label === 'Operating system').value).toBe('Windows 10.0.26100');
    expect(view.rows.find((row) => row.label === 'Architecture').value).toBe('64-bit (x64)');
  });

  test('under 10 GB free warns', () => {
    expect(G.aboutView({ ...info, storage: { totalBytes: 500e9, freeBytes: 6e9 } }, 'LANA AI').warning).toMatch(/Less than 10 GB/);
  });

  test('missing facts say so', () => {
    const view = G.aboutView({}, '');
    expect(view.rows.find((row) => row.label === 'Name').value).toBe('LANA AI');
    expect(view.rows.find((row) => row.label === 'Available').value).toBe('Not available');
  });
});

describe('Software update', () => {
  const at = '2026-11-08T18:42:00.000Z';

  test('not checked yet: Check for updates', () => {
    expect(G.updateView({ currentVersion: 'v4.1.0', packaged: true, lastChecked: null, result: null }, 'America/New_York')).toMatchObject({
      version: 'v4.1.0', badge: 'Not checked', action: 'check', checked: 'Not checked since LANA started.', note: '',
    });
  });

  test('up to date, with the time of the check in the person\'s zone', () => {
    const view = G.updateView({ currentVersion: 'v4.1.0', packaged: true, lastChecked: at, result: { updateAvailable: false } }, 'America/New_York');
    expect(view).toMatchObject({ badge: 'Up to date', color: 'green', action: 'check', checked: 'Last checked Nov 8, 2026, 1:42 PM.' });
  });

  test('an update: Update to the version, with its notes', () => {
    const view = G.updateView({ currentVersion: 'v4.1.0', lastChecked: at, result: { updateAvailable: true, version: '4.2.0', releaseNotes: 'Faster search.' } });
    expect(view).toMatchObject({ badge: 'Update available', color: 'blue', action: 'install', actionLabel: 'Update to 4.2.0', releaseNotes: 'Faster search.' });
  });

  test('a required update says the organization requires it', () => {
    const view = G.updateView({ currentVersion: 'v4.1.0', lastChecked: at, result: { updateAvailable: true, updateRequired: true, version: '4.2.0' } });
    expect(view.badge).toBe('Update required');
    expect(view.summary).toBe('Version 4.2.0 is ready to install. Your organization requires it.');
  });

  test('a failed check keeps Check for updates', () => {
    const view = G.updateView({ currentVersion: 'v4.1.0', lastChecked: at, result: { error: 'LANA could not reach the update service.' } });
    expect(view).toMatchObject({ badge: 'Could not check', color: 'red', action: 'check', summary: 'LANA could not reach the update service.' });
  });

  test('a copy run from source says updates apply to installed copies', () => {
    expect(G.updateView({ packaged: false }).note).toMatch(/installed copies only/);
  });
});

describe('Date & time', () => {
  test('now, in the chosen zone', () => {
    expect(G.nowText(new Date('2026-11-08T18:42:00.000Z'), 'America/Chicago')).toBe('Sunday, November 8, 2026 at 12:42 PM CST');
  });

  test('an unknown zone falls back to the computer\'s', () => {
    expect(G.nowText(new Date('2026-11-08T18:42:00.000Z'), 'Not/AZone')).toMatch(/November 8, 2026/);
  });
});

describe('Language & region', () => {
  test('LANA in English; the computer\'s languages and region by name', () => {
    expect(G.languageView(info.locale).rows).toEqual([
      { label: 'LANA language', value: 'English' },
      { label: 'This computer\'s languages', value: 'American English, Mexican Spanish' },
      { label: 'Region', value: 'United States' },
    ]);
  });

  test('no preferred list: the system language', () => {
    expect(G.languageView({ systemLocale: 'fr-CA' }).rows[1].value).toBe('Canadian French');
    expect(G.languageView({ systemLocale: 'fr-CA' }).rows[2].value).toBe('Canada');
  });
});
