/**
 * The V1 header account menu has one implementation (js/shared/header-user-menu.js).
 * Pages carry only a [data-header-user-menu] placeholder; no page keeps its own
 * copy of the dropdown markup or its toggle/logout wiring.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '../../src');
const source = fs.readFileSync(path.join(SRC, 'js/shared/header-user-menu.js'), 'utf8');

let window;
let document;
let KeyboardEvent;

function boot(body) {
  const dom = new JSDOM('<!doctype html><body>' + body + '</body>', { url: 'http://localhost/admin/page.html', runScripts: 'outside-only', pretendToBeVisual: true });
  window = dom.window;
  document = window.document;
  KeyboardEvent = window.KeyboardEvent;
  window.eval(source);
  return window.HeaderUserMenu;
}

describe('HeaderUserMenu', () => {
  let HeaderUserMenu;

  beforeEach(() => {
    HeaderUserMenu = boot('<header><div id="userMenu" class="relative" data-header-user-menu data-settings-href="../settings-v2.html" data-login-href="../login.html"></div></header><main id="elsewhere"></main>');
  });

  test('auto-mounts the placeholder with the shared markup and ids', () => {
    const menu = document.getElementById('userMenu');
    const trigger = menu.querySelector('[data-user-menu-trigger]');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('userDropdown').classList.contains('hidden')).toBe(true);
    expect(menu.querySelector('a[role="menuitem"]').getAttribute('href')).toBe('../settings-v2.html');
    expect(document.getElementById('logoutBtn')).not.toBeNull();
  });

  test('mount is idempotent', () => {
    const menu = document.getElementById('userMenu');
    const first = HeaderUserMenu.mount(menu);
    expect(HeaderUserMenu.mount(menu)).toBe(first);
    expect(menu.querySelectorAll('#userDropdown').length).toBe(1);
  });

  test('trigger toggles; outside click and Escape close', () => {
    const trigger = document.querySelector('[data-user-menu-trigger]');
    const dropdown = document.getElementById('userDropdown');
    trigger.click();
    expect(dropdown.classList.contains('hidden')).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    trigger.click();
    expect(dropdown.classList.contains('hidden')).toBe(true);

    trigger.click();
    document.getElementById('elsewhere').click();
    expect(dropdown.classList.contains('hidden')).toBe(true);

    trigger.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dropdown.classList.contains('hidden')).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  test('ArrowDown on the trigger opens and focuses the first item; arrows cycle', () => {
    const trigger = document.querySelector('[data-user-menu-trigger]');
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const items = document.querySelectorAll('#userDropdown [role="menuitem"]');
    expect(document.activeElement).toBe(items[0]);
    document.getElementById('userDropdown').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(items[1]);
    document.getElementById('userDropdown').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(items[0]);
  });

  test('Sign out runs opts.onLogout when given', async () => {
    HeaderUserMenu = boot('<div id="userMenu" data-login-href="../login.html"></div>');
    const onLogout = jest.fn();
    HeaderUserMenu.mount(document.getElementById('userMenu'), { onLogout });
    document.getElementById('logoutBtn').click();
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  test('default logout awaits api.logout', async () => {
    const logout = jest.fn(() => Promise.resolve());
    window.api = { logout };
    document.getElementById('logoutBtn').click();
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
  ];

  test.each(PAGES)('%s holds a placeholder, loads the module, and has no copied dropdown', (page) => {
    const html = fs.readFileSync(path.join(SRC, page), 'utf8');
    expect(html).toMatch(/<div class="relative" id="userMenu" data-header-user-menu[^>]*><\/div>/);
    expect(html).toMatch(/<script src="(\.\.\/)?js\/shared\/header-user-menu\.js"><\/script>/);
    expect(html).not.toContain('id="userDropdown"');
    expect(html).not.toContain('id="logoutBtn"');
    expect(html).not.toMatch(/userDropdown\.classList\.toggle/);
  });
});
