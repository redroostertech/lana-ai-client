'use strict';

/**
 * App links from Chef's emails (electron-app-links.js): parsing and the
 * allowlist per action, the firm decision (saved, discovered, mismatch), the
 * link waiting for sign-in, the cold-start queue, and that no token or code
 * ever reaches a log line.
 */

const {
  parseAppLink,
  describeForLog,
  decideServer,
  orgIdHintFromDomain,
  normalizeDomain,
  discoveryTarget,
  targetFor,
  createPendingStore,
  createAppLinkRouter,
  createFirmSignOut,
  oldSessionNotice,
  registerAppLinkIpc,
  createColdStartQueue,
  deepLinkFromArgv,
  PENDING_TTL_MS
} = require('../../electron-app-links');

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9';
const CODE = 'LANA-AB12-CD34-EF56';
const DOC = '3f6c1a2e-9b7d-4c1e-8a55-0d2e4f6a8b10';
const PACKET = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f2a3b4c5d';

describe('parseAppLink', () => {
  test.each([
    ['reset-password', `lana-ai://reset-password?token=${TOKEN}`, { token: TOKEN }],
    ['accept-invite', `lana-ai://accept-invite?token=${TOKEN}`, { token: TOKEN }],
    ['activate', `lana-ai://activate?code=${CODE}`, { code: CODE }],
    ['sign', `lana-ai://sign?document=${DOC}&packet=${PACKET}`, { document: DOC, packet: PACKET }],
    ['shared', `lana-ai://shared?token=${TOKEN}`, { token: TOKEN }]
  ])('accepts a valid %s link', (action, url, params) => {
    expect(parseAppLink(url)).toEqual({ ok: true, action, params, domain: null, org: null });
  });

  test('reads and lowercases the firm domain on any action', () => {
    const link = parseAppLink(`lana-ai://shared?token=${TOKEN}&domain=Norton.LanaAI.io`);
    expect(link.ok).toBe(true);
    expect(link.domain).toBe('norton.lanaai.io');
  });

  test.each(['reset-password', 'accept-invite', 'activate', 'sign', 'shared'])('%s also accepts org (lowercased)', (action) => {
    const params = action === 'activate' ? `code=${CODE}` : action === 'sign' ? `document=${DOC}&packet=${PACKET}` : `token=${TOKEN}`;
    const link = parseAppLink(`lana-ai://${action}?${params}&org=Norton-Law&domain=norton.lanaai.io`);
    expect(link.ok).toBe(true);
    expect(link.org).toBe('norton-law');
    expect(link.domain).toBe('norton.lanaai.io');
  });

  test('an org id of the wrong shape rejects the link', () => {
    expect(parseAppLink(`lana-ai://shared?token=${TOKEN}&org=norton_law`).reason).toBe('invalid_org');
    expect(parseAppLink(`lana-ai://shared?token=${TOKEN}&org=`).reason).toBe('invalid_org');
    expect(parseAppLink(`lana-ai://shared?token=${TOKEN}&org=a&org=b`).reason).toBe('repeated_param');
  });

  test('a trailing slash before the query is allowed', () => {
    expect(parseAppLink(`lana-ai://activate/?code=${CODE}`).ok).toBe(true);
  });

  test.each([
    ['a key from another action', `lana-ai://reset-password?token=${TOKEN}&code=${CODE}`, 'unexpected_param'],
    ['an unknown key', `lana-ai://shared?token=${TOKEN}&redirect=https://evil.example`, 'unexpected_param'],
    ['a repeated key', `lana-ai://shared?token=${TOKEN}&token=${TOKEN}`, 'repeated_param'],
    ['a missing token', 'lana-ai://accept-invite?domain=norton.lanaai.io', 'missing_param'],
    ['an empty code', 'lana-ai://activate?code=', 'invalid_param'],
    ['sign without the packet', `lana-ai://sign?document=${DOC}`, 'missing_param'],
    ['a document id with a path in it', `lana-ai://sign?document=../etc&packet=${PACKET}`, 'invalid_param'],
    ['a token with spaces or markup', 'lana-ai://shared?token=%3Cscript%3E%20x', 'invalid_param'],
    ['a domain that is not a host name', `lana-ai://shared?token=${TOKEN}&domain=http://x`, 'invalid_domain'],
    ['a single-label domain', `lana-ai://shared?token=${TOKEN}&domain=localhost`, 'invalid_domain'],
    ['a path after the action', `lana-ai://shared/extra?token=${TOKEN}`, 'unexpected_parts'],
    ['a fragment', `lana-ai://shared?token=${TOKEN}#x`, 'unexpected_parts']
  ])('rejects %s', (_label, url, reason) => {
    const link = parseAppLink(url);
    expect(link.ok).toBe(false);
    expect(link.reason).toBe(reason);
  });

  test('an unknown action is not an app link', () => {
    expect(parseAppLink('lana-ai://delete-everything?token=x')).toEqual({ ok: false, reason: 'unknown_action' });
    expect(parseAppLink('lana-ai://open?route=dashboard.html').reason).toBe('unknown_action');
  });

  test('another scheme or junk is rejected', () => {
    expect(parseAppLink(`https://shared?token=${TOKEN}`).reason).toBe('wrong_scheme');
    expect(parseAppLink('not a url').reason).toBe('not_a_url');
  });
});

describe('logging never carries a token or code', () => {
  test('describeForLog names the action, keys and domain only', () => {
    const link = parseAppLink(`lana-ai://reset-password?token=${TOKEN}&domain=norton.lanaai.io`);
    const line = describeForLog(link);
    expect(line).toBe('app link action=reset-password keys=token domain=norton.lanaai.io org=none');
    expect(line).not.toContain(TOKEN);
  });

  test('a whole flow logs no token, code or ids', async () => {
    const lines = [];
    const router = createAppLinkRouter(fakeDeps({ log: (m) => lines.push(m), signedIn: false }));
    await router.handleUrl(`lana-ai://shared?token=${TOKEN}&domain=norton.lanaai.io`);
    await router.handleUrl(`lana-ai://activate?code=${CODE}`);
    await router.handleUrl(`lana-ai://sign?document=${DOC}&packet=${PACKET}`);
    await router.handleUrl(`lana-ai://shared?token=${TOKEN}&extra=1`);
    expect(lines.length).toBeGreaterThan(3);
    const all = lines.join('\n');
    for (const secret of [TOKEN, CODE, DOC, PACKET]) expect(all).not.toContain(secret);
  });
});

describe('decideServer', () => {
  const saved = { url: 'https://10.0.0.5:8080', orgId: 'norton', orgName: 'Norton Law', domain: 'norton.lanaai.io' };
  test('no domain on the link uses the saved firm', () => {
    expect(decideServer({ domain: null }, saved)).toBe('use-saved');
  });
  test('the same domain uses the saved firm, ignoring case', () => {
    expect(decideServer({ domain: 'norton.lanaai.io' }, { ...saved, domain: 'Norton.LanaAI.io' })).toBe('use-saved');
  });
  test('another domain is a mismatch', () => {
    expect(decideServer({ domain: 'smith.lanaai.io' }, saved)).toBe('mismatch');
  });
  test('no saved firm resolves the domain, or waits for setup without one', () => {
    expect(decideServer({ domain: 'smith.lanaai.io' }, null)).toBe('resolve');
    expect(decideServer({ domain: null }, null)).toBe('needs-setup');
  });
});

describe('decideServer with org', () => {
  const saved = { url: 'https://10.0.0.5:8080', orgId: 'norton', domain: 'norton.lanaai.io' };
  test('org alone compares with the saved org id', () => {
    expect(decideServer({ domain: null, org: 'norton' }, saved)).toBe('use-saved');
    expect(decideServer({ domain: null, org: 'smith' }, saved)).toBe('mismatch');
  });
  test('the domain decides when both sides have one', () => {
    expect(decideServer({ domain: 'norton.lanaai.io', org: 'other-id' }, saved)).toBe('use-saved');
  });
  test('the org decides when the saved firm has no domain', () => {
    expect(decideServer({ domain: 'smith.lanaai.io', org: 'smith' }, { url: 'u', orgId: 'norton' })).toBe('mismatch');
  });
  test('org alone with no saved firm resolves', () => {
    expect(decideServer({ domain: null, org: 'smith' }, null)).toBe('resolve');
  });
});

describe('discoveryTarget', () => {
  test('org present is used for discovery', () => {
    expect(discoveryTarget({ domain: 'smithlaw.com', org: 'smith-law' })).toEqual({ domain: 'smithlaw.com', orgId: 'smith-law' });
  });
  test('org absent falls back to the guess from the domain', () => {
    expect(discoveryTarget({ domain: 'smithlaw.com', org: null })).toEqual({ domain: 'smithlaw.com', orgId: 'smithlaw' });
  });
  test('org with no domain asks for the hosted name, as sign in does', () => {
    expect(discoveryTarget({ domain: null, org: 'smith-law' })).toEqual({ domain: 'smith-law.lanaai.io', orgId: 'smith-law' });
  });
  test('neither: nothing to ask', () => {
    expect(discoveryTarget({ domain: null, org: null })).toBeNull();
  });
});

test('orgIdHintFromDomain takes the first label', () => {
  expect(orgIdHintFromDomain('norton-law.lanaai.io')).toBe('norton-law');
  expect(orgIdHintFromDomain('bad')).toBeNull();
  expect(normalizeDomain(' A.B ')).toBe('a.b');
});

test('targetFor opens the page each action uses', () => {
  const t = (url) => targetFor(parseAppLink(url));
  expect(t(`lana-ai://reset-password?token=${TOKEN}`)).toBe(`password-reset.html?token=${TOKEN}`);
  expect(t(`lana-ai://accept-invite?token=${TOKEN}`)).toBe(`accept-invite.html?token=${TOKEN}`);
  expect(t(`lana-ai://activate?code=${CODE}`)).toBe(`activate.html?code=${CODE}`);
  expect(t(`lana-ai://sign?document=${DOC}&packet=${PACKET}`)).toBe(`file-editor.html?id=${DOC}&signature_packet=${PACKET}`);
  expect(t(`lana-ai://shared?token=${TOKEN}`)).toBe(`shared-link.html?token=${TOKEN}`);
});

function fakeDeps(overrides = {}) {
  const state = {
    saved: overrides.saved === undefined ? { url: 'https://10.0.0.5:8080', orgId: 'norton', orgName: 'Norton Law', domain: 'norton.lanaai.io' } : overrides.saved,
    signedIn: overrides.signedIn !== undefined ? overrides.signedIn : true
  };
  const calls = { opened: [], signIn: 0, connected: [], signOut: 0, discover: [], askSwitch: [], askNotFound: [], invalid: 0 };
  const deps = {
    getSavedServer: () => state.saved,
    isSignedIn: () => state.signedIn,
    discover: jest.fn(async (domain, hint) => {
      calls.discover.push([domain, hint]);
      return overrides.discovered === undefined ? null : overrides.discovered;
    }),
    connect: async (server) => { calls.connected.push(server); state.saved = server; },
    signOut: async () => {
      calls.signOut += 1;
      state.saved = null;
      state.signedIn = false;
      return overrides.signOutResult || { serverSignedOut: true, expiresAt: null };
    },
    askSwitch: async (info) => { calls.askSwitch.push(info); return overrides.switchChoice || 'stay'; },
    askNotFound: async (info) => { calls.askNotFound.push(info); return overrides.notFoundChoice || 'stay'; },
    tellInvalid: async () => { calls.invalid += 1; },
    tellOldSessionOpen: overrides.tellOldSessionOpen,
    openPage: async (page) => { calls.opened.push(page); },
    openSignIn: async () => { calls.signIn += 1; },
    log: overrides.log || (() => {}),
    now: overrides.now
  };
  deps.calls = calls;
  deps.state = state;
  return deps;
}

describe('createAppLinkRouter', () => {
  test('a reset link for the saved firm opens the reset page', async () => {
    const deps = fakeDeps({ signedIn: false });
    const router = createAppLinkRouter(deps);
    expect(await router.handleUrl(`lana-ai://reset-password?token=${TOKEN}&domain=norton.lanaai.io`)).toBe('opened');
    expect(deps.calls.opened).toEqual([`password-reset.html?token=${TOKEN}`]);
  });

  test('an unknown action is ignored without a message', async () => {
    const deps = fakeDeps();
    const router = createAppLinkRouter(deps);
    expect(await router.handleUrl('lana-ai://format-disk?token=x')).toBe('ignored');
    expect(deps.calls.invalid).toBe(0);
    expect(deps.calls.opened).toEqual([]);
  });

  test('a link with a bad parameter is refused with a plain message', async () => {
    const deps = fakeDeps();
    const router = createAppLinkRouter(deps);
    expect(await router.handleUrl(`lana-ai://shared?token=${TOKEN}&next=file:///etc`)).toBe('rejected');
    expect(deps.calls.invalid).toBe(1);
    expect(deps.calls.opened).toEqual([]);
  });

  test('a share link while signed in opens the share page at once', async () => {
    const deps = fakeDeps({ signedIn: true });
    const router = createAppLinkRouter(deps);
    expect(await router.handleUrl(`lana-ai://shared?token=${TOKEN}`)).toBe('opened');
    expect(deps.calls.opened).toEqual([`shared-link.html?token=${TOKEN}`]);
  });

  test('signed out: a signature link waits, sign-in continues it once', async () => {
    const deps = fakeDeps({ signedIn: false });
    const router = createAppLinkRouter(deps);
    expect(await router.handleUrl(`lana-ai://sign?document=${DOC}&packet=${PACKET}`)).toBe('sign-in');
    expect(deps.calls.signIn).toBe(1);
    expect(deps.calls.opened).toEqual([]);
    expect(router.loginContext()).toEqual({ pending: true, action: 'sign', needsFirm: false, domain: null, orgIdHint: null });
    // Connecting is not enough for a link that needs sign-in.
    expect(router.takePending('connected')).toBeNull();
    expect(router.takePending('signed-in')).toBe(`file-editor.html?id=${DOC}&signature_packet=${PACKET}`);
    expect(router.takePending('signed-in')).toBeNull();
  });

  test('the login context never carries the token', async () => {
    const deps = fakeDeps({ signedIn: false });
    const router = createAppLinkRouter(deps);
    await router.handleUrl(`lana-ai://shared?token=${TOKEN}&domain=norton.lanaai.io`);
    expect(JSON.stringify(router.loginContext())).not.toContain(TOKEN);
  });

  test('a waiting link expires', async () => {
    let now = 1000;
    const deps = fakeDeps({ signedIn: false, now: () => now });
    const router = createAppLinkRouter(deps);
    await router.handleUrl(`lana-ai://shared?token=${TOKEN}`);
    now += PENDING_TTL_MS + 1;
    expect(router.loginContext()).toEqual({ pending: false });
    expect(router.takePending('signed-in')).toBeNull();
  });

  test('no saved firm: the domain is found through discovery, saved, then the page opens', async () => {
    const found = { url: 'https://100.64.0.9:8080', orgId: 'smith', orgName: 'Smith LLP', domain: 'smith.lanaai.io' };
    const deps = fakeDeps({ saved: null, signedIn: false, discovered: found });
    const router = createAppLinkRouter(deps);
    expect(await router.handleUrl(`lana-ai://accept-invite?token=${TOKEN}&domain=smith.lanaai.io`)).toBe('opened');
    expect(deps.calls.discover).toEqual([['smith.lanaai.io', 'smith']]);
    expect(deps.calls.connected).toEqual([found]);
    expect(deps.calls.opened).toEqual([`accept-invite.html?token=${TOKEN}`]);
  });

  test('the link\'s org is what discovery is asked for', async () => {
    const found = { url: 'https://100.64.0.9:8080', orgId: 'smith-law', domain: 'smithlaw.com' };
    const deps = fakeDeps({ saved: null, signedIn: false, discovered: found });
    const router = createAppLinkRouter(deps);
    expect(await router.handleUrl(`lana-ai://reset-password?token=${TOKEN}&domain=smithlaw.com&org=smith-law`)).toBe('opened');
    expect(deps.calls.discover).toEqual([['smithlaw.com', 'smith-law']]);
  });

  test('org with no domain: discovery uses the hosted name and sign in gets the org id', async () => {
    const deps = fakeDeps({ saved: null, signedIn: false, discovered: null });
    const router = createAppLinkRouter(deps);
    expect(await router.handleUrl(`lana-ai://activate?code=${CODE}&org=smith-law`)).toBe('connect-firm');
    expect(deps.calls.discover).toEqual([['smith-law.lanaai.io', 'smith-law']]);
    expect(router.loginContext()).toEqual({ pending: true, action: 'activate', needsFirm: true, domain: null, orgIdHint: 'smith-law' });
  });

  test('org with no domain for another firm than the saved one asks first', async () => {
    const deps = fakeDeps({ signedIn: true, switchChoice: 'stay' });
    const router = createAppLinkRouter(deps);
    expect(await router.handleUrl(`lana-ai://shared?token=${TOKEN}&org=smith`)).toBe('stayed');
    expect(deps.calls.askSwitch).toEqual([{ domain: 'smith', firmName: 'Norton Law' }]);
  });

  test('no saved firm and discovery finds nothing: sign in shows the firm to connect, then the link continues', async () => {
    const deps = fakeDeps({ saved: null, signedIn: false, discovered: null });
    const router = createAppLinkRouter(deps);
    expect(await router.handleUrl(`lana-ai://activate?code=${CODE}&domain=smithlaw.com`)).toBe('connect-firm');
    expect(router.loginContext()).toEqual({ pending: true, action: 'activate', needsFirm: true, domain: 'smithlaw.com', orgIdHint: 'smithlaw' });
    // The person connects the firm on the sign-in page.
    deps.state.saved = { url: 'https://x:1', orgId: 'smith-law', domain: 'smithlaw.com' };
    expect(router.takePending('connected')).toBe(`activate.html?code=${CODE}`);
  });

  test('connecting a different firm than the link names drops the link', async () => {
    const deps = fakeDeps({ saved: null, signedIn: false });
    const router = createAppLinkRouter(deps);
    await router.handleUrl(`lana-ai://reset-password?token=${TOKEN}&domain=smith.lanaai.io`);
    deps.state.saved = { url: 'https://x:1', orgId: 'norton', domain: 'norton.lanaai.io' };
    expect(router.takePending('connected')).toBeNull();
    expect(router.loginContext()).toEqual({ pending: false });
  });

  describe('domain mismatch', () => {
    const OTHER = `lana-ai://shared?token=${TOKEN}&domain=smith.lanaai.io`;

    test('asks, and staying changes nothing', async () => {
      const deps = fakeDeps({ signedIn: true, switchChoice: 'stay' });
      const router = createAppLinkRouter(deps);
      expect(await router.handleUrl(OTHER)).toBe('stayed');
      expect(deps.calls.askSwitch).toEqual([{ domain: 'smith.lanaai.io', firmName: 'Norton Law' }]);
      expect(deps.calls.signOut).toBe(0);
      expect(deps.calls.discover).toEqual([]);
      expect(deps.calls.connected).toEqual([]);
      expect(deps.calls.opened).toEqual([]);
      expect(router.loginContext()).toEqual({ pending: false });
    });

    test('switching signs out, connects the other firm and waits for sign-in there', async () => {
      const found = { url: 'https://100.64.0.9:8080', orgId: 'smith', orgName: 'Smith LLP', domain: 'smith.lanaai.io' };
      const deps = fakeDeps({ signedIn: true, switchChoice: 'switch', discovered: found });
      const router = createAppLinkRouter(deps);
      expect(await router.handleUrl(OTHER)).toBe('sign-in');
      expect(deps.calls.signOut).toBe(1);
      expect(deps.calls.connected).toEqual([found]);
      expect(deps.calls.opened).toEqual([]);
      expect(router.takePending('signed-in')).toBe(`shared-link.html?token=${TOKEN}`);
    });

    test('switching to a firm discovery cannot find: staying keeps the saved firm', async () => {
      const deps = fakeDeps({ signedIn: true, switchChoice: 'switch', discovered: null, notFoundChoice: 'stay' });
      const router = createAppLinkRouter(deps);
      expect(await router.handleUrl(OTHER)).toBe('stayed');
      expect(deps.calls.askNotFound).toHaveLength(1);
      expect(deps.calls.signOut).toBe(0);
      expect(deps.state.saved.orgId).toBe('norton');
    });

    test('switching to a firm discovery cannot find: connecting on sign in signs out first', async () => {
      const deps = fakeDeps({ signedIn: true, switchChoice: 'switch', discovered: null, notFoundChoice: 'sign-in' });
      const router = createAppLinkRouter(deps);
      expect(await router.handleUrl(OTHER)).toBe('connect-firm');
      expect(deps.calls.signOut).toBe(1);
      expect(router.loginContext().needsFirm).toBe(true);
    });
  });
});

describe('switching firms ends the session on the old firm too', () => {
  const OLD = { url: 'https://10.0.0.5:8080/', orgId: 'norton', orgName: 'Norton Law', domain: 'norton.lanaai.io' };
  const EXP_S = 1893456000; // 2030-01-01
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const JWT = `${b64({ alg: 'HS256' })}.${b64({ sub: 'u1', exp: EXP_S })}.c2lnbmF0dXJl`;
  const NOW = () => 1700000000000;

  function signOutWith({ fetchImpl, token = JWT, server = OLD } = {}) {
    const order = [];
    const logs = [];
    const fetch = jest.fn(async (url, init) => {
      order.push('server');
      return fetchImpl ? fetchImpl(url, init) : { ok: true, status: 200 };
    });
    const clearLocal = jest.fn(async () => { order.push('local'); });
    const signOut = createFirmSignOut({
      getSavedServer: () => server,
      getToken: () => token,
      fetch,
      clearLocal,
      now: NOW,
      log: (message) => logs.push(message)
    });
    return { signOut, fetch, clearLocal, order, logs };
  }

  test("calls Chef's sign-out at the old address with the old token, then clears this computer", async () => {
    const t = signOutWith();
    expect(await t.signOut()).toEqual({ serverSignedOut: true, expiresAt: null });
    expect(t.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = t.fetch.mock.calls[0];
    expect(url).toBe('https://10.0.0.5:8080/api/v1/auth/logout');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${JWT}`);
    expect(t.order).toEqual(['server', 'local']);
  });

  test('an unreachable old firm still clears this computer and says when the session ends', async () => {
    const t = signOutWith({ fetchImpl: () => { const error = new Error('connect ECONNREFUSED'); error.name = 'TypeError'; throw error; } });
    expect(await t.signOut()).toEqual({ serverSignedOut: false, expiresAt: EXP_S * 1000 });
    expect(t.order).toEqual(['server', 'local']);
  });

  test('a refusal from the old firm still clears this computer', async () => {
    const t = signOutWith({ fetchImpl: () => ({ ok: false, status: 401 }) });
    expect(await t.signOut()).toEqual({ serverSignedOut: false, expiresAt: EXP_S * 1000 });
    expect(t.clearLocal).toHaveBeenCalledTimes(1);
  });

  test('no live session: nothing to end on the old firm', async () => {
    for (const token of [null, 'demo-token-123', `${b64({ alg: 'HS256' })}.${b64({ exp: 1 })}.c2ln`]) {
      const t = signOutWith({ token });
      expect(await t.signOut()).toEqual({ serverSignedOut: true, expiresAt: null });
      expect(t.fetch).not.toHaveBeenCalled();
      expect(t.clearLocal).toHaveBeenCalledTimes(1);
    }
  });

  test('the token never reaches a log line', async () => {
    for (const fetchImpl of [undefined, () => ({ ok: false, status: 500 }), () => { throw new Error(JWT); }]) {
      const t = signOutWith({ fetchImpl });
      await t.signOut();
      expect(t.logs.length).toBeGreaterThan(0);
      for (const line of t.logs) {expect(line).not.toContain(JWT.split('.')[1]);}
    }
  });

  test('the notice names the firm and the time the session ends, or says it expires on its own', () => {
    const timed = oldSessionNotice({ firmName: 'Norton Law', expiresAt: EXP_S * 1000 }, (ms) => `T${ms}`);
    expect(timed.message).toBe('LANA could not reach Norton Law to sign you out there.');
    expect(timed.detail).toContain(`Your session at Norton Law ends on its own at T${EXP_S * 1000}.`);
    const untimed = oldSessionNotice({ firmName: 'Norton Law', expiresAt: null });
    expect(untimed.detail).toContain('Your session at Norton Law ends on its own when it expires.');
  });

  describe('in the router', () => {
    const OTHER = `lana-ai://shared?token=${TOKEN}&domain=smith.lanaai.io`;
    const found = { url: 'https://100.64.0.9:8080', orgId: 'smith', orgName: 'Smith LLP', domain: 'smith.lanaai.io' };

    test('Switch firm: the old firm could not sign out, the switch goes ahead and the person is told', async () => {
      const tell = jest.fn();
      const deps = fakeDeps({ switchChoice: 'switch', discovered: found, signOutResult: { serverSignedOut: false, expiresAt: 42 }, tellOldSessionOpen: tell });
      const router = createAppLinkRouter(deps);
      expect(await router.handleUrl(OTHER)).toBe('sign-in');
      expect(deps.calls.connected).toEqual([found]);
      expect(tell).toHaveBeenCalledWith({ firmName: 'Norton Law', expiresAt: 42 });
    });

    test('Connect on sign in: same message when the old firm could not sign out', async () => {
      const tell = jest.fn();
      const deps = fakeDeps({ switchChoice: 'switch', discovered: null, notFoundChoice: 'sign-in', signOutResult: { serverSignedOut: false, expiresAt: null }, tellOldSessionOpen: tell });
      const router = createAppLinkRouter(deps);
      expect(await router.handleUrl(OTHER)).toBe('connect-firm');
      expect(tell).toHaveBeenCalledWith({ firmName: 'Norton Law', expiresAt: null });
    });

    test('a message that never closes does not hold up the switch', async () => {
      const deps = fakeDeps({ switchChoice: 'switch', discovered: found, signOutResult: { serverSignedOut: false, expiresAt: null }, tellOldSessionOpen: () => new Promise(() => {}) });
      const router = createAppLinkRouter(deps);
      expect(await router.handleUrl(OTHER)).toBe('sign-in');
    });

    test('the old firm signed out: no message', async () => {
      const tell = jest.fn();
      const deps = fakeDeps({ switchChoice: 'switch', discovered: found, tellOldSessionOpen: tell });
      await createAppLinkRouter(deps).handleUrl(OTHER);
      await Promise.resolve();
      expect(tell).not.toHaveBeenCalled();
    });
  });
});

test('createPendingStore keeps one link and the newer one wins', () => {
  const store = createPendingStore({ now: () => 0 });
  store.set({ action: 'a' });
  store.set({ action: 'b' }, { needsFirm: true });
  expect(store.peek()).toMatchObject({ link: { action: 'b' }, needsFirm: true });
  store.markFirmConnected();
  expect(store.peek().needsFirm).toBe(false);
});

test('registerAppLinkIpc answers only the two stages', async () => {
  const handlers = {};
  const ipcMain = { handle: (channel, fn) => { handlers[channel] = fn; } };
  const router = { loginContext: () => ({ pending: false }), takePending: jest.fn(() => 'x.html') };
  registerAppLinkIpc(ipcMain, router);
  expect(await handlers['app-links:login-context']()).toEqual({ pending: false });
  expect(await handlers['app-links:take-pending'](null, { stage: 'signed-in' })).toEqual({ page: 'x.html' });
  expect(await handlers['app-links:take-pending'](null, { stage: 'anything' })).toEqual({ page: null });
  expect(router.takePending).toHaveBeenCalledTimes(1);
});

describe('cold start', () => {
  test('a link that arrives before the first window waits, then is delivered once', () => {
    const delivered = [];
    const queue = createColdStartQueue((url) => delivered.push(url));
    queue.receive('lana-ai://shared?token=a');
    expect(delivered).toEqual([]);
    queue.markReady();
    expect(delivered).toEqual(['lana-ai://shared?token=a']);
    queue.markReady();
    expect(delivered).toHaveLength(1);
    queue.receive('lana-ai://activate?code=b');
    expect(delivered).toEqual(['lana-ai://shared?token=a', 'lana-ai://activate?code=b']);
  });

  test('the launch command line carries the link on Windows and Linux', () => {
    expect(deepLinkFromArgv(['/app/LANA', '--flag', 'lana-ai://activate?code=x'])).toBe('lana-ai://activate?code=x');
    expect(deepLinkFromArgv(['/app/LANA'])).toBeNull();
    expect(deepLinkFromArgv(undefined)).toBeNull();
  });
});

describe('electron-main wiring', () => {
  const fs = require('fs');
  const path = require('path');
  const main = fs.readFileSync(path.resolve(__dirname, '../../electron-main.js'), 'utf8');

  test('the five actions go to the app link router', () => {
    for (const action of ['reset-password', 'accept-invite', 'activate', 'sign', 'shared']) {
      expect(main).toContain(`case '${action}':`);
    }
    expect(main).toContain('await appLinkRouter.handleUrl(deepLinkUrl);');
  });

  test("the router's sign-out ends the old firm's session before clearing this computer", () => {
    expect(main).toMatch(/createFirmSignOut\(\{[\s\S]{0,200}getToken: \(\) => authTokenStore\.get\(\)/);
    expect(main).toContain('signOut: signOutOfFirm,');
    expect(main).toContain('tellOldSessionOpen: (info) => appLinkMessage({ ...oldSessionNotice(info)');
  });

  test('every deep link entry point goes through the cold-start queue', () => {
    expect(main).toContain('deepLinkFromArgv(process.argv)');
    expect(main).toMatch(/app\.on\('open-url'[\s\S]{0,120}deepLinkQueue\.receive\(url\)/);
    expect(main).toMatch(/deepLinkFromArgv\(commandLine\)[\s\S]{0,80}deepLinkQueue\.receive\(url\)/);
    expect((main.match(/once\('did-finish-load', \(\) => deepLinkQueue\.markReady\(\)\)/g) || []).length).toBe(2);
  });
});
