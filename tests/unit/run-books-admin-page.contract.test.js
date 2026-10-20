'use strict';

/**
 * Wiring contract for the Run Books admin page.
 *
 * These are the things that break silently rather than loudly: a script that
 * loads after the code that needs it, an entry point that stops being
 * admin-only, or a Lex property set in a shape the component cannot read. None
 * of them throw in Jest, and all of them have broken a page here before.
 *
 * The behaviour of the page's pure half is covered by run-books-draft.test.js.
 */

const fs = require('fs');
const path = require('path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', relativePath), 'utf8');
}

const page = read('src/admin/run-books.html');
const controller = read('src/js/admin/run-books.js');
const adminIndex = read('src/admin/index.html');
const menu = read('src/js/menu.js');
const switcher = read('src/js/admin/admin-switcher.js');

describe('run books page script order', () => {
  test('the pure draft module loads before the controller that consumes it', () => {
    const draft = page.indexOf('js/admin/run-books-draft.js');
    const pageController = page.indexOf('js/admin/run-books.js');

    expect(draft).toBeGreaterThan(-1);
    expect(pageController).toBeGreaterThan(-1);
    expect(draft).toBeLessThan(pageController);
  });

  test('the text extractors load before the controller, since it reads files itself', () => {
    // /drafts/propose takes extracted text, and a run book is not a matter
    // document, so the renderer does the extraction rather than pushing files
    // into the document store to be read.
    const mammoth = page.indexOf('js/vendor/mammoth.min.js');
    const pdf = page.indexOf('js/vendor/pdf.min.js');
    const pageController = page.indexOf('js/admin/run-books.js');

    expect(mammoth).toBeGreaterThan(-1);
    expect(pdf).toBeGreaterThan(-1);
    expect(mammoth).toBeLessThan(pageController);
    expect(pdf).toBeLessThan(pageController);
  });

  test('lex-page-init runs after the components the template uses', () => {
    // The template is injected by lex-page-init; a component defined after
    // that point never upgrades the markup already on the page.
    const init = page.indexOf('js/lex/lex-page-init.js');

    for (const component of ['lex-card.js', 'lex-badge.js', 'lex-input.js', 'lex-select.js', 'lex-form.js']) {
      expect(page.indexOf('foundation/' + component) === -1
        ? page.indexOf('form/' + component)
        : page.indexOf('foundation/' + component)).toBeLessThan(init);
    }
  });

  test('auth-guard is the last script, so the admin path check runs after api.js is live', () => {
    const lastScriptTag = page.slice(page.lastIndexOf('<script src='));

    expect(page.indexOf('js/auth-guard.js')).toBeGreaterThan(-1);
    expect(lastScriptTag).toContain('js/auth-guard.js');
  });
});

describe('run books is admin only, everywhere it is reachable from', () => {
  test('the controller sends a non-admin away instead of rendering the page', () => {
    expect(controller).toContain('Lex.Auth.canViewSystemStatus()');
    expect(controller).toContain("Lex.Nav.go('dashboard.html', { replace: true })");
  });

  test('the admin hub tile is role gated', () => {
    const cardStart = adminIndex.indexOf('title="Run Books"');
    expect(cardStart).toBeGreaterThan(-1);

    const card = adminIndex.slice(cardStart, adminIndex.indexOf('</lex-action-card>', cardStart));
    expect(card).toContain('data-href="admin/run-books.html"');
    expect(card).toContain('data-admin-roles="system_admin,org_admin,organization_admin"');
  });

  test('the sidebar entry is role gated', () => {
    const itemStart = menu.indexOf("id: 'admin-run-books'");
    expect(itemStart).toBeGreaterThan(-1);

    const item = menu.slice(itemStart, menu.indexOf('\n', itemStart));
    expect(item).toContain("href: '/admin/run-books.html'");
    expect(item).toContain('requiredRoles: ADMIN_ROLES');
  });

  test('the admin page switcher lists it, so the topbar keeps its page picker', () => {
    expect(switcher).toContain("value: 'admin/run-books.html'");
  });
});

describe('Lex property shapes the components can actually read', () => {
  test('a multi-select selection is handed over as a JSON attribute, not an array', () => {
    // withFormField types `value` as String, so assigning an array stringifies
    // to "a,b" and lex-select's JSON.parse comes back empty. The pre-selected
    // scope values would silently vanish.
    expect(controller).toContain("select.setAttribute('value', JSON.stringify(entry.scope_values || []))");
    expect(controller).not.toContain('select.value =');
  });

  test('the controller calls the backend run book routes and nothing else', () => {
    expect(controller).toContain("var API_BASE = '/api/v1/admin/run-books'");
    expect(controller).toContain("API_BASE + '/formats'");
    expect(controller).toContain("API_BASE + '/drafts/propose'");
    expect(controller).toContain("API_BASE + '/drafts/check'");
  });
});
