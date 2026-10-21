'use strict';

/**
 * UI standard section 11, wave 3b part 2B: the integrations connector pages
 * use lex-modal / lex-drawer instead of hand-built backdrops and slide-overs,
 * and the shared header account menu instead of a copied #userMenu.
 *
 * Static checks parse the real pages; the behaviour checks run the real
 * lex components in jsdom with the same markup and wiring the pages use.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const { DOMParser } = new JSDOM('').window;

const PAGES = [
  'integrations/connector-viewer.html',
  'integrations/connectors.html',
  'integrations/connector-crm.html',
  'integrations/connector-case.html',
  'integrations/connector-communications.html',
  'integrations/sync-status.html'
];

// Parse a page, template contents included.
function parse(rel) {
  const doc = new DOMParser().parseFromString(read(rel), 'text/html');
  const roots = [doc];
  doc.querySelectorAll('template').forEach((tpl) => roots.push(tpl.content));
  return { doc, find: (sel) => roots.map((r) => r.querySelector(sel)).find(Boolean) || null };
}

const scriptOrder = (rel) => Array.from(parse(rel).doc.querySelectorAll('script[src]')).map((s) => s.getAttribute('src'));

describe('integrations pages: no hand-built overlays', () => {
  test.each(PAGES)('%s has no fixed inset-0 backdrops or native dialogs', (rel) => {
    const html = read(rel);
    expect(html).not.toMatch(/fixed inset-0/);
    expect(html).not.toMatch(/<select[\s>]/);
    expect(html).not.toMatch(/(^|[^.\w])(alert|confirm|prompt)\(/m);
    expect(html).not.toMatch(/\.lex-(modal|drawer)-body/);
  });

  test('connectors.html dialogs are lex-modals with footer buttons', () => {
    const { find } = parse('integrations/connectors.html');
    ['connectorActionsModal', 'uninstallConfirmModal', 'deleteConfirmModal', 'connectorDetailsModal', 'importConnectorModal']
      .forEach((id) => expect(find('#' + id).tagName).toBe('LEX-MODAL'));
    expect(find('#connectorDetailsModal #detailsActionBtn').getAttribute('data-slot')).toBe('footer');
    expect(find('#importConnectorModal #importConnectorBtn').getAttribute('data-slot')).toBe('footer');
    expect(find('#importConnectorModal #importConnectorBtn').hasAttribute('disabled')).toBe(true);
  });

  test('connector-viewer detail panels are lex-drawers and the assign dialog a lex-modal', () => {
    const { find } = parse('integrations/connector-viewer.html');
    expect(find('#recordDetailPanel').tagName).toBe('LEX-DRAWER');
    expect(find('#logDetailPanel').tagName).toBe('LEX-DRAWER');
    expect(find('#assignMatterModal').tagName).toBe('LEX-MODAL');
    expect(find('#recordDetailBackdrop')).toBeNull();
    expect(find('#logDetailBackdrop')).toBeNull();
    expect(scriptOrder('integrations/connector-viewer.html')).toContain('../js/lex/components/foundation/lex-drawer.js');
  });

  test.each(['integrations/connectors.html', 'integrations/sync-status.html'])(
    '%s uses the shared header account menu and the notifications drawer', (rel) => {
      const { doc } = parse(rel);
      const menu = doc.getElementById('userMenu');
      expect(menu.hasAttribute('data-header-user-menu')).toBe(true);
      expect(menu.children.length).toBe(0);
      expect(doc.getElementById('notificationPanel')).toBeNull();
      expect(doc.getElementById('notificationOverlay')).toBeNull();
      const scripts = scriptOrder(rel);
      expect(scripts).toContain('../js/shared/header-user-menu.js');
      expect(scripts).toContain('../js/lex/components/foundation/lex-drawer.js');
      expect(read(rel)).not.toMatch(/userDropdown\.classList\.toggle/);
    });

  test.each([
    'integrations/connector-crm.html',
    'integrations/connector-case.html',
    'integrations/connector-communications.html'
  ])('%s builds its config lex-modal in script and loads lex-modal before lex-btn', (rel) => {
    const html = read(rel);
    expect(html).toContain("document.createElement('lex-modal')");
    expect(parse(rel).doc.getElementById('configModal')).toBeNull();
    const scripts = scriptOrder(rel);
    const modalAt = scripts.indexOf('../js/lex/components/foundation/lex-modal.js');
    const btnAt = scripts.indexOf('../js/lex/components/foundation/lex-btn.js');
    expect(modalAt).toBeGreaterThan(-1);
    expect(btnAt).toBeGreaterThan(modalAt);
  });
});

describe('integrations overlays behave on the real components', () => {
  function boot(body = '') {
    const dom = new JSDOM(`<!doctype html><body>${body}</body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom;
    window.eval(read('js/lex/lex.core.js'));
    ['lex-modal', 'lex-drawer', 'lex-btn'].forEach((n) => window.eval(read(`js/lex/components/foundation/${n}.js`)));
    return window;
  }
  const tick = (w, ms = 30) => new Promise((r) => w.setTimeout(r, ms));
  const escape = (w) => w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  test('a script-built config modal puts its Save button in the footer and submits the form from there', async () => {
    const w = boot();
    const d = w.document;
    const modal = d.createElement('lex-modal');
    modal.id = 'configModal';
    modal.setAttribute('heading', 'Configure Connector');
    modal.innerHTML = `<form id="configForm"><div id="formFields"><input name="api_key" value="k"></div></form>
      <lex-btn data-slot="footer" variant="secondary" data-config-cancel>Cancel</lex-btn>
      <lex-btn data-slot="footer" type="submit" form="configForm" variant="primary">Save Configuration</lex-btn>`;
    d.body.appendChild(modal);
    const submitted = jest.fn((e) => e.preventDefault());
    d.getElementById('configForm').addEventListener('submit', submitted);
    modal.open = true;
    await tick(w);
    const footer = modal.querySelector('.lex-modal-footer');
    expect(footer.querySelector('[data-config-cancel]')).not.toBeNull();
    expect(footer.querySelectorAll('lex-btn').length).toBe(2);
    footer.querySelector('lex-btn[form="configForm"] button').click();
    expect(submitted).toHaveBeenCalledTimes(1);
    escape(w);
    expect(modal.open).toBeFalsy();
  });

  test('Escape on a dialog stacked over the record drawer keeps the drawer open', async () => {
    const w = boot('<lex-drawer id="recordDetailPanel" heading="Record detail" width="xl" flush></lex-drawer>');
    const d = w.document;
    const drawer = d.getElementById('recordDetailPanel');
    const onClose = jest.fn();
    // Same guard as connector-viewer.html bindDetailDrawerClose.
    drawer.addEventListener('lex-close', () => {
      if (d.querySelector('lex-modal[open]')) { w.queueMicrotask(() => { drawer.open = true; }); return; }
      onClose();
    });
    drawer.contentRoot.innerHTML = '<p id="payload">record</p>';
    drawer.open = true;
    await tick(w);

    const modal = d.createElement('lex-modal');
    modal.setAttribute('heading', 'Delete annotation?');
    modal.addEventListener('lex-close', () => { modal.open = false; modal.remove(); });
    d.body.appendChild(modal);
    modal.open = true;
    await tick(w);

    escape(w);
    await tick(w);
    expect(modal.isConnected).toBe(false);
    expect(drawer.open).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    escape(w);
    await tick(w);
    expect(drawer.open).toBeFalsy();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('a footer lex-btn label updates without losing its inner button', async () => {
    const w = boot();
    const d = w.document;
    const modal = d.createElement('lex-modal');
    modal.setAttribute('heading', 'Connector Details');
    modal.innerHTML = '<div id="detailsContent"></div><lex-btn data-slot="footer" id="detailsActionBtn" variant="primary" label="Connect"></lex-btn>';
    d.body.appendChild(modal);
    const btn = d.getElementById('detailsActionBtn');
    btn.label = 'Manage Connector';
    await tick(w);
    expect(btn.querySelectorAll('button').length).toBe(1);
    expect(btn.textContent.trim()).toBe('Manage Connector');
  });
});
