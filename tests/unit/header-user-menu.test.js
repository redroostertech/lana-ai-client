/**
 * The V1 header account menu has one implementation (js/shared/header-user-menu.js).
 * Pages carry only a [data-header-user-menu] placeholder; no page keeps its own
 * copy of the dropdown markup or its toggle/logout wiring.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SRC = path.join(__dirname, '../../src');
const readSrc = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const LEX = ['js/lex/lex.core.js', 'js/lex/lex.icons.js', 'js/lex/components/form/lex-dropdown-btn.js'].map(readSrc);
const source = readSrc('js/shared/header-user-menu.js');

let window;
let document;

function boot(body) {
  const dom = new JSDOM('<!doctype html><body>' + body + '</body>', { url: 'http://localhost/admin/page.html', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  window = dom.window;
  document = window.document;
  LEX.forEach((code) => window.eval(code));
  window.eval(source);
  return window.HeaderUserMenu;
}

const tick = () => new Promise((resolve) => window.setTimeout(resolve, 0));
const key = (el, k) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const trigger = () => document.querySelector('#userMenuButton [data-action="toggle"]');
const isOpen = () => !!document.querySelector('#userMenuButton .lex-ddbtn-dropdown--open');

describe('HeaderUserMenu', () => {
  let HeaderUserMenu;

  beforeEach(async () => {
    HeaderUserMenu = boot('<header><div id="userMenu" class="relative" data-header-user-menu data-settings-href="../settings-v2.html" data-login-href="../login.html"></div></header><main id="elsewhere"></main>');
    await tick();
  });

  test('auto-mounts an icon-only, end-aligned lex-dropdown-btn with Settings and Sign out', () => {
    const btn = document.querySelector('#userMenu > lex-dropdown-btn#userMenuButton');
    expect(btn).not.toBeNull();
    expect(btn.hasAttribute('icon-only')).toBe(true);
    expect(btn.getAttribute('align')).toBe('end');
    expect(trigger().getAttribute('aria-label')).toBe('Account menu');
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger().querySelector('svg')).not.toBeNull();
    expect(btn.querySelector('.lex-ddbtn-dropdown').classList.contains('lex-ddbtn-dropdown--end')).toBe(true);
    const settings = btn.querySelector('a.lex-ddbtn-item');
    expect(settings.getAttribute('href')).toBe('../settings-v2.html');
    expect(settings.textContent).toContain('Settings');
    expect(btn.querySelectorAll('[role="separator"]').length).toBe(1);
    const logout = btn.querySelector('[data-value="logout"]');
    expect(logout.textContent).toContain('Sign out');
    expect(logout.classList.contains('lex-ddbtn-item--danger')).toBe(true);
    expect(document.getElementById('userDropdown')).toBeNull();
  });

  test('mount is idempotent', () => {
    const menu = document.getElementById('userMenu');
    const first = HeaderUserMenu.mount(menu);
    expect(HeaderUserMenu.mount(menu)).toBe(first);
    expect(menu.querySelectorAll('lex-dropdown-btn').length).toBe(1);
  });

  test('trigger toggles; outside click and Escape close; Escape returns focus to the trigger', async () => {
    trigger().click();
    await tick();
    expect(isOpen()).toBe(true);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    trigger().click();
    await tick();
    expect(isOpen()).toBe(false);

    trigger().click();
    await tick();
    await tick();
    document.getElementById('elsewhere').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    await tick();
    expect(isOpen()).toBe(false);

    key(trigger(), 'ArrowDown');
    await tick();
    expect(isOpen()).toBe(true);
    key(document.activeElement, 'Escape');
    await tick();
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(trigger());
  });

  test('ArrowDown on the trigger focuses Settings; arrows skip the separator', async () => {
    key(trigger(), 'ArrowDown');
    await tick();
    expect(document.activeElement.textContent).toContain('Settings');
    key(document.activeElement, 'ArrowDown');
    await tick();
    expect(document.activeElement.dataset.value).toBe('logout');
  });

  test('handle open/close/isOpen drive the dropdown', async () => {
    const handle = HeaderUserMenu.mount(document.getElementById('userMenu'));
    handle.open();
    await tick();
    expect(handle.isOpen()).toBe(true);
    handle.close();
    await tick();
    expect(handle.isOpen()).toBe(false);
  });

  test('Sign out runs opts.onLogout when given', async () => {
    HeaderUserMenu = boot('<div id="userMenu" data-login-href="../login.html"></div>');
    const onLogout = jest.fn();
    HeaderUserMenu.mount(document.getElementById('userMenu'), { onLogout });
    await tick();
    trigger().click();
    await tick();
    document.querySelector('[data-value="logout"]').click();
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  test('default logout awaits api.logout', async () => {
    const logout = jest.fn(() => Promise.reject(new Error('offline')));
    window.api = { logout };
    trigger().click();
    await tick();
    document.querySelector('[data-value="logout"]').click();
    await Promise.resolve();
    expect(logout).toHaveBeenCalledTimes(1);
  });
});

describe('pages use the shared header menu', () => {
  const PAGES = [
    'index.html',
    'blank.html',
    'admin/relevance-labeling.html',
    'admin/dashboard.html',
    'admin/integrations.html',
    'admin/onboarding_management.html',
    'admin/search-analytics.html',
    'admin/settings.html',
    'admin/management-boards.html',
  ];

  test.each(PAGES)('%s holds a placeholder, loads the module, and has no copied dropdown', (page) => {
    const html = fs.readFileSync(path.join(SRC, page), 'utf8');
    expect(html).toMatch(/<div class="relative" id="userMenu" data-header-user-menu[^>]*><\/div>/);
    expect(html).toMatch(/<script src="(\.\.\/)?js\/shared\/header-user-menu\.js"><\/script>/);
    const icons = html.indexOf('lex/lex.icons.js');
    const dropdown = html.indexOf('lex/components/form/lex-dropdown-btn.js');
    expect(icons).toBeGreaterThan(-1);
    expect(dropdown).toBeGreaterThan(icons);
    expect(html).not.toContain('id="userDropdown"');
    expect(html).not.toContain('id="logoutBtn"');
    expect(html).not.toMatch(/userDropdown\.classList\.toggle/);
  });
});
