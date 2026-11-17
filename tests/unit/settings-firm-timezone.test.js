'use strict';

/**
 * Settings > General > Firm time zone (pages/settings-firm-timezone.js): organization admins
 * pick the zone reports count days and months in, from a searchable list of every zone, saved
 * through PUT /api/v1/organizations/:org_id/settings. Everyone else never sees it.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const MARKUP = read('settings-v2.html').match(/<section id="sv2-section-firm-timezone"[\s\S]*?<\/section>/)[0];
const ORG = 'org-1';

const opened = [];
afterEach(() => { opened.splice(0).forEach((w) => w.close()); });

function setup({ admin = true, settings = { firm_timezone: null, firm_timezone_set: false }, getError = null, putError = null } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body>' + MARKUP + '</body></html>', {
    url: 'http://localhost/settings-v2.html', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole()
  });
  const w = dom.window;
  opened.push(w);
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const user = { id: 'u1', organizationId: ORG, roles: admin ? ['org_admin'] : ['member'], firm_timezone: 'UTC', firm_timezone_set: false };
  w.localStorage.setItem('user', JSON.stringify(user));
  const calls = [];
  w.eval('var api = window.api = {};');
  w.api.user = user;
  w.api.getOrganizationSettings = (orgId) => {
    calls.push(['get', orgId]);
    return getError ? Promise.reject(getError) : Promise.resolve({ settings: Object.assign({ organization_id: ORG }, settings) });
  };
  w.api.updateOrganizationSettings = (orgId, body) => {
    calls.push(['put', orgId, body]);
    if (putError) return Promise.reject(putError);
    const zone = body.firm_timezone;
    return Promise.resolve({ message: 'Settings updated', settings: { organization_id: ORG, firm_timezone: zone, firm_timezone_set: !!zone } });
  };
  // The prompt's dismissal lives in the person's preferences.
  w.api.getPreferences = () => Promise.resolve({ preferences: { onboarding: {} } });
  w.api.updatePreferences = (updates) => { calls.push(['preferences', updates]); return Promise.resolve({ success: true }); };
  const toasts = [];
  ['js/shared/firm-timezone-prompt.js', 'js/lex/lex.core.js', 'js/lex/lex.icons.js', 'js/lex/lex.forms.js', 'js/lex/components/form/lex-select.js',
    'js/lex/lex.auth.js', 'js/shared/time-zone-options.js', 'js/settings-firm-timezone.model.js', 'js/pages/settings-firm-timezone.js']
    .forEach((rel) => w.eval(read(rel)));
  w.Lex.Toast = { success: (t) => toasts.push(['success', t]), error: (t) => toasts.push(['error', t]) };
  const el = (id) => w.document.getElementById(id);
  return { w, calls, toasts, el, section: el('sv2-section-firm-timezone'), select: el('sv2-firm-timezone-select') };
}

const tick = (w) => new Promise((resolve) => w.setTimeout(resolve, 0));
const settle = async (w) => { for (let i = 0; i < 4; i += 1) await tick(w); };
const choose = (w, select, value) => {
  select.setAttribute('value', value);
  select.dispatchEvent(new w.CustomEvent('lex-change', { bubbles: true, detail: { name: 'firm_timezone', value } }));
};

describe('Settings Firm time zone', () => {
  test('the section sits in General, hidden until the settings load, made of Lex components', () => {
    const html = read('settings-v2.html');
    const general = html.slice(html.indexOf('id="sv2-panel-general"'), html.indexOf('id="sv2-panel-notifications"'));
    expect(general).toContain('id="sv2-section-firm-timezone"');
    expect(MARKUP).toMatch(/<section id="sv2-section-firm-timezone"[^>]*hidden/);
    expect(MARKUP).toContain('<lex-card heading="Firm time zone"');
    expect(MARKUP).toMatch(/<lex-select id="sv2-firm-timezone-select"[^>]*searchable="true"/);
    expect(MARKUP).not.toMatch(/style=/);
    expect(html).toContain('<script src="js/pages/settings-firm-timezone.js"></script>');
    // The prompt module is loaded first, so a saved zone can mark the prompt dismissed.
    expect(html.indexOf('<script src="js/shared/firm-timezone-prompt.js"></script>'))
      .toBeGreaterThan(-1);
    expect(html.indexOf('<script src="js/shared/firm-timezone-prompt.js"></script>'))
      .toBeLessThan(html.indexOf('<script src="js/pages/settings-firm-timezone.js"></script>'));
  });

  test('an admin sees every zone, searchable, with the note that it is not set', async () => {
    const { w, calls, section, select, el } = setup();
    await settle(w);
    expect(calls).toEqual([['get', ORG]]);
    expect(section.hidden).toBe(false);
    expect(select.options.length).toBe(Intl.supportedValuesOf('timeZone').length);
    expect(select.value || '').toBe('');
    expect(el('sv2-firm-timezone-note').textContent).toBe('Not set yet. Reports use UTC until you choose one.');
  });

  test('typing in the search box narrows the list', async () => {
    const { w, select } = setup();
    await settle(w);
    select.querySelector('[data-action="toggle"]').click();
    await tick(w);
    const search = select.querySelector('.lex-select-search input');
    search.value = 'New York';
    search.dispatchEvent(new w.Event('input', { bubbles: true }));
    await tick(w);
    const shown = Array.from(select.querySelectorAll('.lex-select-option')).map((o) => o.textContent);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(5);
    expect(shown.every((label) => label.includes('New York'))).toBe(true);
  });

  test('a saved zone shows as chosen', async () => {
    const { w, select, el } = setup({ settings: { firm_timezone: 'America/Chicago', firm_timezone_set: true } });
    await settle(w);
    expect(select.value).toBe('America/Chicago');
    expect(el('sv2-firm-timezone-note').textContent).toMatch(/^Reports count days and months in Central Time/);
  });

  test('choosing a zone saves it through the API and updates the stored user', async () => {
    const { w, calls, toasts, select, el } = setup();
    await settle(w);
    choose(w, select, 'America/New_York');
    await settle(w);
    expect(calls[1]).toEqual(['put', ORG, { firm_timezone: 'America/New_York' }]);
    expect(toasts).toEqual([['success', 'Firm time zone saved']]);
    const stored = JSON.parse(w.localStorage.getItem('user'));
    expect(stored).toMatchObject({ firm_timezone: 'America/New_York', firm_timezone_set: true });
    expect(w.api.user).toMatchObject({ firm_timezone: 'America/New_York', firm_timezone_set: true });
    expect(el('sv2-firm-timezone-note').textContent).toMatch(/^Reports count days and months in Eastern Time/);
    // A saved zone also marks the dashboard prompt dismissed for this person.
    expect(calls.filter(([kind]) => kind === 'preferences'))
      .toEqual([['preferences', { onboarding: { prompts: { firm_timezone: expect.any(String) } } }]]);
  });

  test('a refused zone shows the server message and goes back to the saved one', async () => {
    const error = Object.assign(new Error('Choose a time zone from the list.'), { status: 400 });
    const { w, calls, select, el } = setup({ settings: { firm_timezone: 'America/Chicago', firm_timezone_set: true }, putError: error });
    await settle(w);
    choose(w, select, 'America/Denver');
    await settle(w);
    const message = el('sv2-firm-timezone-error');
    expect(message.hidden).toBe(false);
    expect(message.textContent).toBe('Choose a time zone from the list.');
    expect(select.value).toBe('America/Chicago');
    expect(JSON.parse(w.localStorage.getItem('user')).firm_timezone_set).toBe(false);
    expect(calls.filter(([kind]) => kind === 'preferences')).toEqual([]);
  });

  test('someone who is not an admin never sees it and nothing is asked', async () => {
    const { w, calls, section } = setup({ admin: false });
    await settle(w);
    expect(calls).toEqual([]);
    expect(section.hidden).toBe(true);
  });

  test('a server that refuses the read (403) keeps it hidden', async () => {
    const { w, section } = setup({ getError: Object.assign(new Error('Forbidden'), { status: 403 }) });
    await settle(w);
    expect(section.hidden).toBe(true);
  });
});
