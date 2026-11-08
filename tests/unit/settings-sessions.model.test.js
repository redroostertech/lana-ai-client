'use strict';

/** Settings > Profile > Active sessions view helpers (src/js/settings-sessions.model.js). */
const S = require('../../src/js/settings-sessions.model');

const NOW = new Date('2026-11-08T18:00:00.000Z');

describe('title and icon', () => {
  test('names what signed in and where', () => {
    expect(S.title({ client: 'LANA app', os: 'macOS' })).toBe('LANA app on macOS');
    expect(S.title({ client: 'Safari', os: 'iOS' })).toBe('Safari on iOS');
    expect(S.title({ client: 'Command line', os: 'Unknown' })).toBe('Command line');
    expect(S.title({ user_agent: 'Mozilla/5.0' })).toBe('Signed-in device');
  });

  test('icon follows the device', () => {
    expect(S.icon({ device: 'Desktop', client: 'LANA app' })).toBe('laptop');
    expect(S.icon({ device: 'Mobile', client: 'Safari' })).toBe('smartphone');
    expect(S.icon({ device: 'Desktop', client: 'Command line' })).toBe('terminal');
  });
});

describe('details', () => {
  test('last seen, signed in, and address', () => {
    const line = S.details({ last_accessed: '2026-11-08T17:55:00.000Z', created_at: '2026-11-02T15:00:00.000Z', ip_address: '10.0.0.12/32' }, NOW, 'America/New_York');
    expect(line).toBe('Last seen 5 minutes ago · Signed in Nov 2, 2026 · 10.0.0.12');
  });

  test('relative times', () => {
    expect(S.ago('2026-11-08T17:59:40.000Z', NOW)).toBe('just now');
    expect(S.ago('2026-11-08T17:59:00.000Z', NOW)).toBe('1 minute ago');
    expect(S.ago('2026-11-08T15:00:00.000Z', NOW)).toBe('3 hours ago');
    expect(S.ago('2026-11-06T18:00:00.000Z', NOW)).toBe('2 days ago');
    expect(S.ago('2026-10-01T18:00:00.000Z', NOW, 'UTC')).toBe('Oct 1, 2026');
    expect(S.ago(null, NOW)).toBe('');
  });

  test('missing fields are left out', () => {
    expect(S.details({}, NOW)).toBe('');
  });
});

describe('sorted and summary', () => {
  test('this device first, then the most recently seen', () => {
    const rows = S.sorted([
      { id: 'a', last_accessed: '2026-11-01T00:00:00Z' },
      { id: 'b', last_accessed: '2026-11-08T00:00:00Z' },
      { id: 'c', last_accessed: '2026-10-01T00:00:00Z', is_current: true },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect(S.sorted(null)).toEqual([]);
  });

  test('summary counts devices', () => {
    expect(S.summary(0)).toBe('No devices are signed in to your account.');
    expect(S.summary(1)).toBe('1 device is signed in to your account.');
    expect(S.summary(3)).toBe('3 devices are signed in to your account.');
  });
});
