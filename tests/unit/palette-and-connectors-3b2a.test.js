'use strict';

/**
 * Wave 3b part 2A (docs/TABLE-STANDARD.md section 11):
 * - the shell search (js/unified-search-modal.js) is a `lex-modal palette`
 *   kept above other overlays, with its keyboard flow and lex-select filter;
 * - the data-connectors dashboard iframe is a `lex-modal size="full" flush`.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function boot(body) {
  const dom = new JSDOM('<!doctype html><body>' + (body || '') + '</body>', {
    url: 'http://client.test/app.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.eval(read('js/lex/lex.core.js'));
  window.eval(read('js/lex/lex.forms.js'));
  window.eval(read('js/lex/components/foundation/lex-modal.js'));
  window.eval(read('js/lex/components/form/lex-select.js'));
  return window;
}

const tick = (window, ms) => new Promise((resolve) => window.setTimeout(resolve, ms == null ? 30 : ms));

function key(window, target, k, opts) {
  target.dispatchEvent(new window.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, opts || {})));
}

describe('UnifiedSearchModal palette', () => {
  function load() {
    const window = boot();
    window.api = {
      post: jest.fn(async () => ({
        results: [
          { id: 'm1', entity_type: 'matter', title: 'Smith v. Jones', url: 'matter-details.html?id=m1' },
          { id: 'c1', entity_type: 'contact', title: 'Jane Smith' }
        ]
      })),
      get: jest.fn(async () => ({ nodes: [], edges: [] }))
    };
    window.Lex.Nav = { go: jest.fn(), getParams: () => new window.URLSearchParams('') };
    window.eval(read('js/unified-search-filter.js'));
    window.eval(read('js/unified-search-modal.js'));
    // jsdom is still "loading" here; mount as DOMContentLoaded would.
    window.UnifiedSearchModal.init();
    return window;
  }

  test('mounts one lex-modal palette above other overlays, with no hand-built backdrop', () => {
    const window = load();
    const doc = window.document;
    const modal = doc.getElementById('unifiedSearchModal');
    expect(modal.tagName).toBe('LEX-MODAL');
    expect(modal.palette).toBe(true);
    expect(modal.open).toBeFalsy();
    expect(modal.style.getPropertyValue('--lex-z-modal')).toBe('10000');
    expect(modal.querySelector('.lex-modal-panel').getAttribute('aria-label')).toBe('Search Lana');
    expect(modal.querySelector('.lex-modal-header')).toBeNull();
    expect(modal.contentRoot.querySelector('#unifiedSearchInput')).not.toBeNull();
    expect(doc.getElementById('unifiedSearchBackdrop')).toBeNull();
    expect(doc.querySelectorAll('#unifiedSearchModal').length).toBe(1);
    window.UnifiedSearchModal.init();
    expect(doc.querySelectorAll('#unifiedSearchModal').length).toBe(1);
  });

  test('keeps the entity filter as a lex-select', () => {
    const window = load();
    const select = window.document.getElementById('unifiedSearchEntityFilter');
    expect(select.tagName).toBe('LEX-SELECT');
    expect(select.options.map((o) => o.value)).toContain('all');
    expect(window.document.querySelector('#unifiedSearchModal select')).toBeNull();
  });

  test('Cmd+K opens and focuses the input; typing searches; Enter selects a row; Escape closes', async () => {
    const window = load();
    const doc = window.document;
    const modal = doc.getElementById('unifiedSearchModal');

    key(window, doc.body, 'k', { metaKey: true });
    expect(modal.open).toBe(true);
    await tick(window);
    const input = doc.getElementById('unifiedSearchInput');
    expect(doc.activeElement).toBe(input);

    input.value = 'smith';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await tick(window, 250);
    expect(window.api.post).toHaveBeenCalledWith('/api/v1/search', expect.objectContaining({ query: 'smith' }));
    const rows = doc.querySelectorAll('#unifiedSearchResults .unified-search-result');
    expect(rows.length).toBe(2);

    key(window, rows[1], 'Enter');
    expect(rows[1].dataset.active).toBe('true');
    expect(rows[0].dataset.active).toBe('false');

    key(window, input, 'Escape');
    expect(modal.open).toBeFalsy();
    // Reopening works after an Escape close.
    window.UnifiedSearchModal.open('jones');
    expect(modal.open).toBe(true);
    await tick(window);
    expect(input.value).toBe('jones');
  });

  test('close button and open-result both close the palette', async () => {
    const window = load();
    const doc = window.document;
    const modal = doc.getElementById('unifiedSearchModal');
    window.UnifiedSearchModal.open();
    doc.getElementById('unifiedSearchClose').click();
    expect(modal.open).toBeFalsy();

    window.UnifiedSearchModal.open('smith');
    await tick(window, 60);
    doc.querySelector('[data-open-result-index="0"]').click();
    expect(modal.open).toBeFalsy();
    expect(window.Lex.Nav.go).toHaveBeenCalledWith('matter-details.html?id=m1');
  });

  test('defers opening until lex-modal is available', async () => {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://client.test/app.html', runScripts: 'outside-only', pretendToBeVisual: true });
    const window = dom.window;
    window.eval(read('js/lex/lex.core.js'));
    window.eval(read('js/lex/lex.forms.js'));
    // Script loading is not available in jsdom here; define lex-modal by hand
    // after the palette asked for it.
    window.document.head.appendChild = (node) => node;
    window.eval(read('js/unified-search-modal.js'));
    window.UnifiedSearchModal.init();
    window.UnifiedSearchModal.open('later');
    expect(window.document.getElementById('unifiedSearchModal')).toBeNull();
    window.eval(read('js/lex/components/foundation/lex-modal.js'));
    await tick(window);
    const modal = window.document.getElementById('unifiedSearchModal');
    expect(modal).not.toBeNull();
    expect(modal.open).toBe(true);
  });
});

describe('data-connectors dashboard modal', () => {
  const html = read('data-connectors.html');

  test('is a full-size flush lex-modal with no hand-built overlay', () => {
    expect(html).toMatch(/<lex-modal id="connectorDashboardModal"[^>]*size="full"[^>]*flush[^>]*hide-actions/);
    expect(html).not.toMatch(/dc-fullscreen-modal/);
    expect(html).toMatch(/<iframe id="connectorDashboardFrame"/);
  });

  function load() {
    const start = html.indexOf('<lex-modal id="connectorDashboardModal"');
    const end = html.indexOf('</lex-modal>', start) + '</lex-modal>'.length;
    const window = boot(html.slice(start, end));
    window.Lex.Toast = { error: () => {}, warning: () => {}, success: () => {}, info: () => {} };
    const registry = {
      isConnectorInstalled: () => false,
      getInstalledConnectors: async () => [],
      getAvailableConnectors: async () => [],
      loadConnectors: async () => [],
      loadInstalledConnectors: async () => []
    };
    window.ConnectorRegistry = registry;
    window.Lex.ConnectorRegistry = registry;
    window.api = { get: async () => ({}), post: async () => ({}) };
    window.eval(read('js/data_connectors.js'));
    return window;
  }

  test('open sets the frame and heading; close and lex-close unload the frame', async () => {
    const window = load();
    const doc = window.document;
    const modal = doc.getElementById('connectorDashboardModal');
    expect(modal.tagName).toBe('LEX-MODAL');
    expect(modal.size).toBe('full');
    expect(modal.flush).toBe(true);
    expect(modal.querySelector('.lex-modal-footer')).toBeNull();

    window.openCustomConnectorUI('ui/index.html', 'Leadly', 'src-1', 'custom', 'org');
    const frame = doc.getElementById('connectorDashboardFrame');
    expect(modal.contentRoot.contains(frame)).toBe(true);
    expect(modal.open).toBe(true);
    expect(modal.heading).toBe('Leadly');
    expect(frame.getAttribute('src')).toMatch(/^integrations\/connector-viewer\.html\?/);

    window.closeConnectorDashboardModal();
    expect(modal.open).toBeFalsy();
    expect(frame.getAttribute('src')).toBe('about:blank');

    window.openCustomConnectorUI('ui/index.html', 'Leadly', 'src-1', 'custom', 'org');
    await tick(window);
    doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(modal.open).toBeFalsy();
    expect(frame.getAttribute('src')).toBe('about:blank');
  });
});
