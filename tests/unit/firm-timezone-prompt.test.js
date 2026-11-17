'use strict';

/**
 * The one-time "Set your firm time zone" prompt (js/shared/firm-timezone-prompt.js): shown in
 * the app to organization admins whose firm has no zone. Its dismissal is kept on the server in
 * the person's preferences (onboarding.prompts.firm_timezone, PATCH /api/v1/users/me/preferences),
 * so it follows them to another computer. It is marked dismissed only when they choose "Not now"
 * and the save succeeds, or when they save the firm zone in Settings; opening Settings alone does
 * not count.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const opened = [];
afterEach(() => { opened.splice(0).forEach((w) => w.close()); });

function setup({ admin = true, set = false, userId = 'u1', preferences = { onboarding: { walkthroughs: { agents: 'a' } } },
  getError = null, patchError = null } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="host"></div></body></html>', {
    url: 'http://localhost/dashboard.html', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole()
  });
  const w = dom.window;
  opened.push(w);
  // The server's copy of the person's preferences (a group is replaced whole on save).
  const server = { preferences: JSON.parse(JSON.stringify(preferences)) };
  const calls = [];
  w.eval('var api = window.api = {};');
  w.api.getPreferences = () => {
    calls.push(['get']);
    return getError ? Promise.reject(getError) : Promise.resolve({ success: true, data: { preferences: JSON.parse(JSON.stringify(server.preferences)) } });
  };
  w.api.updatePreferences = (updates) => {
    calls.push(['patch', updates]);
    if (patchError) return Promise.reject(patchError);
    Object.assign(server.preferences, JSON.parse(JSON.stringify(updates)));
    return Promise.resolve({ success: true });
  };
  ['js/lex/lex.core.js', 'js/lex/lex.icons.js', 'js/lex/components/foundation/lex-btn.js', 'js/lex/components/foundation/lex-card.js',
    'js/shared/firm-timezone-prompt.js'].forEach((rel) => w.eval(read(rel)));
  const user = { id: userId, firm_timezone: set ? 'America/New_York' : 'UTC', firm_timezone_set: set };
  const navigated = [];
  const host = w.document.getElementById('host');
  const show = () => w.LanaFirmTimezonePrompt.mount(host, { user, isAdmin: admin, navigate: (href) => navigated.push(href) });
  return { w, host, show, navigated, user, server, calls };
}

const prompt = (host) => host.querySelector('.firm-tz-prompt');
const settle = async (w) => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => w.setTimeout(resolve, 0)); };
const click = async (w, host, action) => { prompt(host).querySelector(`[data-firm-tz-action="${action}"]`).click(); await settle(w); };

describe('firm time zone prompt', () => {
  test('an admin whose firm has no zone sees it, with a link to the setting', async () => {
    const { w, host, show, navigated } = setup();
    expect(await show()).toBe(true);
    const card = prompt(host);
    expect(card.textContent).toContain('Reports count days and months in UTC until you set your firm time zone.');
    await click(w, host, 'open');
    expect(navigated).toEqual(['settings-v2.html#general']);
  });

  test('opening the setting does not mark it dismissed: it shows again until the zone is saved', async () => {
    const { w, host, show, calls, server } = setup();
    await show();
    await click(w, host, 'open');
    expect(calls.filter(([kind]) => kind === 'patch')).toEqual([]);
    expect(server.preferences.onboarding.prompts).toBeUndefined();
    expect(await show()).toBe(true);
  });

  test('Not now saves the dismissal in the preferences, keeping the rest of the onboarding group', async () => {
    const { w, host, show, server } = setup();
    await show();
    await click(w, host, 'dismiss');
    expect(prompt(host)).toBeNull();
    expect(server.preferences.onboarding).toEqual({ walkthroughs: { agents: 'a' }, prompts: { firm_timezone: expect.any(String) } });
    expect(await show()).toBe(false);
  });

  test('the dismissal follows the person: another computer with the same preferences does not show it', async () => {
    const { show } = setup({ preferences: { onboarding: { prompts: { firm_timezone: '2026-11-16T15:00:00.000Z' } } } });
    expect(await show()).toBe(false);
  });

  test('a failed save hides it for now but does not count as dismissed', async () => {
    const { w, host, show, server } = setup({ patchError: new Error('offline') });
    await show();
    await click(w, host, 'dismiss');
    expect(prompt(host)).toBeNull();
    expect(server.preferences.onboarding.prompts).toBeUndefined();
  });

  test('markDismissed (called by Settings after the zone saves) records it and answers whether it saved', async () => {
    const ok = setup();
    await expect(ok.w.LanaFirmTimezonePrompt.markDismissed()).resolves.toBe(true);
    expect(ok.server.preferences.onboarding.prompts.firm_timezone).toEqual(expect.any(String));
    const failed = setup({ patchError: new Error('offline') });
    await expect(failed.w.LanaFirmTimezonePrompt.markDismissed()).resolves.toBe(false);
  });

  test('not shown once the firm has a zone, to someone who is not an admin, or when the profile does not say', async () => {
    expect(await setup({ set: true }).show()).toBe(false);
    expect(await setup({ admin: false }).show()).toBe(false);
    const { w, host, calls } = setup();
    expect(await w.LanaFirmTimezonePrompt.mount(host, { user: { id: 'u1', firm_timezone: 'UTC' }, isAdmin: true })).toBe(false);
    expect(calls).toEqual([]);
  });

  test('when the preferences cannot be read it does not interrupt', async () => {
    const { host, show } = setup({ getError: new Error('offline') });
    expect(await show()).toBe(false);
    expect(prompt(host)).toBeNull();
  });

  test('the dashboard mounts it after the profile loads, styled from its own CSS file, with no local storage', () => {
    const html = read('dashboard.html');
    expect(html).toContain('id="ccFirmTimezonePrompt"');
    expect(html).toContain('<script src="js/shared/firm-timezone-prompt.js"></script>');
    expect(html).toContain('<link rel="stylesheet" href="css/firm-timezone-prompt.css">');
    const js = read('js/dashboard/dashboard.js');
    expect(js.indexOf('LanaFirmTimezonePrompt.mount')).toBeGreaterThan(js.indexOf('await api.loadUserProfile()'));
    const source = read('js/shared/firm-timezone-prompt.js');
    expect(source).not.toMatch(/\.style\./);
    expect(source).not.toMatch(/localStorage/);
  });
});
