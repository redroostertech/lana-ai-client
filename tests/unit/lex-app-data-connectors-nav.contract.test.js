'use strict';

const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');
}

describe('Lex app Connectors navigation placement', () => {
  test('places Connectors in the Works main nav directly after Dashboard', () => {
    const app = read('src/js/lex/components/layout/lex-app.js');

    const dashboard = app.indexOf("{ id: 'dashboard', label: 'Dashboard', icon: 'home', href: 'dashboard.html' }");
    const connectors = app.indexOf("{ id: 'connectors', label: 'Connectors', icon: 'plug', href: 'data-connectors.html' }");
    const library = app.indexOf("{ id: 'library', label: 'Library', icon: 'folder', href: 'drive.html'");

    expect(dashboard).toBeGreaterThan(-1);
    expect(connectors).toBeGreaterThan(dashboard);
    expect(library).toBeGreaterThan(connectors);
  });

  test('does not include Connectors in account drawer or topbar action menus', () => {
    const app = read('src/js/lex/components/layout/lex-app.js');
    const drawerStart = app.indexOf('// User menu items (role-gated)');
    const drawerEnd = app.indexOf('// Topbar settings menu', drawerStart);
    const topbarEnd = app.indexOf('this.setTopbarMenuItems(topbarMenuItems);', drawerEnd);

    expect(drawerStart).toBeGreaterThan(-1);
    expect(drawerEnd).toBeGreaterThan(drawerStart);
    expect(topbarEnd).toBeGreaterThan(drawerEnd);

    expect(app.slice(drawerStart, topbarEnd)).not.toContain('Connectors');
  });

  test('sidebar fallback drawer menu also omits Connectors', () => {
    const sidebar = read('src/js/lex/components/layout/lex-sidebar.js');
    const fallbackStart = sidebar.indexOf('_renderUserOverlay()');
    const fallbackEnd = sidebar.indexOf("let menuHtml = '';", fallbackStart);

    expect(fallbackStart).toBeGreaterThan(-1);
    expect(fallbackEnd).toBeGreaterThan(fallbackStart);
    expect(sidebar.slice(fallbackStart, fallbackEnd)).not.toContain('Connectors');
  });

  test('Connectors page uses the matching active nav id', () => {
    const page = read('src/data-connectors.html');

    expect(page).toContain('active-nav-id="connectors"');
  });
});
