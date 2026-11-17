'use strict';

// The profile names the firm's report time zone (firm_timezone). The client
// keeps it on the stored user so Lex.Utils.getFirmTimezone picks report
// preset days in the same zone the backend bounds them in.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadApi(storedUser = null) {
  const store = { user: storedUser ? JSON.stringify(storedUser) : null };
  const context = {
    console,
    URLSearchParams,
    AbortController,
    FormData: class FormData {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch: jest.fn(),
    localStorage: {
      getItem: jest.fn((key) => (key === 'user' ? store.user : null)),
      setItem: jest.fn((key, value) => { if (key === 'user') store.user = value; }),
      removeItem: jest.fn()
    },
    document: {
      addEventListener: jest.fn(),
      body: {},
      getElementById: jest.fn(() => null)
    },
    location: {
      protocol: 'http:',
      origin: 'http://client.test',
      pathname: '/app.html'
    },
    LanaConfig: {},
    LanaTime: {
      nowMs: jest.fn(() => 1000),
      millisecondsSince: jest.fn((start) => 1000 - start),
      MS_PER_MINUTE: 60000
    }
  };
  context.window = context;
  context.globalThis = context;

  const apiPath = path.join(__dirname, '../../src/js/api.js');
  vm.runInNewContext(fs.readFileSync(apiPath, 'utf8'), context, { filename: apiPath });
  context.window.api.__store = () => context.localStorage;
  return context.window.api;
}

test('loading the profile keeps the firm zone beside the organization zone', async () => {
  const api = loadApi();
  api.demoMode = false;
  api.getProfile = jest.fn().mockResolvedValue({ profile: { user_id: 'u-1', org_id: 'org-1',
    organization_timezone: 'America/New_York', firm_timezone: 'America/Los_Angeles' } });
  const { user } = await api.loadUserProfile();
  expect(user).toMatchObject({ organization_timezone: 'America/New_York', firm_timezone: 'America/Los_Angeles' });
});

test('loading the profile keeps whether the firm set its zone', async () => {
  const api = loadApi();
  api.demoMode = false;
  api.getProfile = jest.fn().mockResolvedValue({ profile: { user_id: 'u-1', org_id: 'org-1',
    firm_timezone: 'UTC', firm_timezone_set: false } });
  const { user } = await api.loadUserProfile();
  expect(user).toMatchObject({ firm_timezone: 'UTC', firm_timezone_set: false });
  expect(JSON.parse(api.__store().getItem('user'))).toMatchObject({ firm_timezone_set: false });
});

// A user stored before the profile named firm_timezone refetches the profile
// before report presets pick days, so presets use the firm's zone, not UTC.
describe('ensureFirmTimezone', () => {
  const PROFILE = { profile: { user_id: 'u-1', org_id: 'org-1', firm_timezone: 'America/Los_Angeles' } };

  test('a stored user without firm_timezone refetches the profile and keeps the zone', async () => {
    const api = loadApi({ id: 'u-1', organizationId: 'org-1' });
    api.demoMode = false;
    api.getProfile = jest.fn().mockResolvedValue(PROFILE);
    await api.ensureFirmTimezone();
    expect(api.getProfile).toHaveBeenCalledTimes(1);
    expect(JSON.parse(api.__store().getItem('user')).firm_timezone).toBe('America/Los_Angeles');
  });

  test('a stored user with firm_timezone does not refetch', async () => {
    const api = loadApi({ id: 'u-1', firm_timezone: 'America/New_York' });
    api.demoMode = false;
    api.getProfile = jest.fn().mockResolvedValue(PROFILE);
    await api.ensureFirmTimezone();
    expect(api.getProfile).not.toHaveBeenCalled();
  });

  test('presets asked for at once share one profile fetch', async () => {
    const api = loadApi({ id: 'u-1' });
    api.demoMode = false;
    api.getProfile = jest.fn().mockResolvedValue(PROFILE);
    await Promise.all([api.ensureFirmTimezone(), api.ensureFirmTimezone()]);
    expect(api.getProfile).toHaveBeenCalledTimes(1);
  });

  test('a failed fetch does not throw; presets fall back to the stored zone', async () => {
    const api = loadApi({ id: 'u-1' });
    api.demoMode = false;
    api.getProfile = jest.fn().mockRejectedValue(new Error('offline'));
    await expect(api.ensureFirmTimezone()).resolves.toBeUndefined();
  });

  test('a stored user with firmTimezone (camelCase) does not refetch, like Lex.Utils.getFirmTimezone', async () => {
    const api = loadApi({ id: 'u-1', firmTimezone: 'America/Chicago' });
    api.demoMode = false;
    api.getProfile = jest.fn().mockResolvedValue(PROFILE);
    await api.ensureFirmTimezone();
    expect(api.getProfile).not.toHaveBeenCalled();
  });

  test('a profile with no zone is fetched once per session, not on every preset click', async () => {
    const api = loadApi({ id: 'u-1' });
    api.demoMode = false;
    api.getProfile = jest.fn().mockResolvedValue({ profile: { user_id: 'u-1', org_id: 'org-1' } });
    await api.ensureFirmTimezone();
    await api.ensureFirmTimezone();
    await api.ensureFirmTimezone();
    expect(api.getProfile).toHaveBeenCalledTimes(1);
  });

  test('a failed fetch is not cached as a miss; the next click tries again', async () => {
    const api = loadApi({ id: 'u-1' });
    api.demoMode = false;
    api.getProfile = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(PROFILE);
    await api.ensureFirmTimezone();
    await api.ensureFirmTimezone();
    expect(api.getProfile).toHaveBeenCalledTimes(2);
    expect(JSON.parse(api.__store().getItem('user')).firm_timezone).toBe('America/Los_Angeles');
  });
});
