'use strict';

/**
 * First run (js/shared/device-time-zone.js): a person with no time zone of
 * their own gets the computer's zone saved once, with no prompt; a person who
 * has one keeps it.
 */
const Z = require('../../src/js/shared/device-time-zone.js');

function fakeApi({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    updatePreferences: (updates) => {
      calls.push(updates);
      return fail ? Promise.reject(new Error('400 invalid zone')) : Promise.resolve({ success: true });
    }
  };
}

beforeEach(() => Z.resetForTests());

describe('first-run computer time zone', () => {
  test('a person with no zone gets the computer zone, saved through preferences', async () => {
    const api = fakeApi();
    const saved = [];
    const zone = await Z.ensure({ user: { id: 'u1', timezone: null }, api, zone: 'America/Chicago', onSaved: (z) => saved.push(z) });
    expect(zone).toBe('America/Chicago');
    expect(api.calls).toEqual([{ regional: { timezone: 'America/Chicago' } }]);
    expect(saved).toEqual(['America/Chicago']);
  });

  test('a person who already chose a zone keeps it (control arm)', async () => {
    const api = fakeApi();
    expect(await Z.ensure({ user: { id: 'u1', timezone: 'Europe/London' }, api, zone: 'America/Chicago' })).toBeNull();
    expect(api.calls).toEqual([]);
  });

  test('only once per person per session, even when the save fails', async () => {
    const api = fakeApi({ fail: true });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await Z.ensure({ user: { id: 'u1' }, api, zone: 'Mars/Base' })).toBeNull();
    expect(await Z.ensure({ user: { id: 'u1' }, api, zone: 'Mars/Base' })).toBeNull();
    expect(api.calls).toHaveLength(1);
    warn.mockRestore();
  });

  test.each([
    ['no user', null, 'America/Chicago'],
    ['no user id', {}, 'America/Chicago'],
    ['no computer zone', { id: 'u1' }, '']
  ])('nothing is saved with %s', async (_label, user, zone) => {
    const api = fakeApi();
    expect(await Z.ensure({ user, api, zone })).toBeNull();
    expect(api.calls).toEqual([]);
  });

  test('reads the computer zone from Intl, and survives an Intl that throws', () => {
    expect(Z.deviceTimeZone({ DateTimeFormat: function () { return { resolvedOptions: () => ({ timeZone: 'Asia/Tokyo' }) }; } })).toBe('Asia/Tokyo');
    expect(Z.deviceTimeZone({ DateTimeFormat: function () { throw new Error('no Intl'); } })).toBe('');
  });
});
