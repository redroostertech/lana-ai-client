'use strict';

/**
 * Firm Handbook sits in the account menus for every org member: after Data
 * Connectors (admins only) and before Settings, in the sidebar user menu and
 * the topbar settings menu, and the topbar action routes to the page.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', rel), 'utf8');

function loadLexApp() {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  ['lex/lex.core.js', 'lex/lex.icons.js', 'lex/components/layout/lex-app.js'].forEach((rel) => w.eval(read(rel)));
  return w.customElements.get('lex-app');
}

const ids = (items) => items.filter((item) => item.id).map((item) => item.id);

describe('lex-app account menus include Firm Handbook', () => {
  const LexApp = loadLexApp();

  test('a member sees it before Settings, with no admin entries', () => {
    const items = LexApp.buildUserMenuItems({ showAdmin: false, isLanaOne: false });
    const order = ids(items);
    expect(order).not.toContain('admin');
    expect(order).not.toContain('connectors');
    expect(order.indexOf('firm-handbook')).toBeGreaterThan(-1);
    expect(order.indexOf('firm-handbook')).toBe(order.indexOf('settings') - 1);
    const item = items.find((entry) => entry.id === 'firm-handbook');
    expect(item).toEqual({ id: 'firm-handbook', label: 'Firm Handbook', icon: 'book-open', href: 'firm-handbook.html' });
  });

  test('an admin sees it right after Data Connectors and before Settings', () => {
    const order = ids(LexApp.buildUserMenuItems({ showAdmin: true, isLanaOne: false }));
    expect(order.slice(0, 4)).toEqual(['admin', 'connectors', 'firm-handbook', 'settings']);
  });

  test('on LANA One it still comes before Plan and billing and Settings', () => {
    const order = ids(LexApp.buildUserMenuItems({ showAdmin: false, isLanaOne: true }));
    expect(order.indexOf('firm-handbook')).toBeLessThan(order.indexOf('billing'));
    expect(order.indexOf('billing')).toBeLessThan(order.indexOf('settings'));
  });

  test('the topbar menu mirrors it for members and admins', () => {
    expect(ids(LexApp.buildTopbarMenuItems({ showAdmin: false })).slice(0, 2)).toEqual(['firm-handbook', 'settings']);
    expect(ids(LexApp.buildTopbarMenuItems({ showAdmin: true })).slice(0, 4))
      .toEqual(['admin', 'connectors', 'firm-handbook', 'settings']);
  });

  test('the topbar action routes to the handbook page', () => {
    const source = read('lex/components/layout/lex-app.js');
    expect(source).toContain("'firm-handbook': 'firm-handbook.html',");
  });

  test('the sub-app footer menu lists it too', () => {
    const footer = read('sidebar-footer-hydrate.js');
    const connectors = footer.indexOf("id: 'connectors'");
    const handbook = footer.indexOf("id: 'firm-handbook'");
    const settings = footer.indexOf("id: 'settings'");
    expect(handbook).toBeGreaterThan(connectors);
    expect(handbook).toBeLessThan(settings);
  });
});
