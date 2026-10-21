'use strict';

/**
 * Wave 3b overlays: the workflow pages and the automation app use lex-modal
 * instead of hand-built fixed overlays (docs/TABLE-STANDARD.md section 11).
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const tick = (window) => new Promise((resolve) => window.setTimeout(resolve, 30));

function bootLex(html, scripts) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  for (const rel of scripts) window.eval(read(rel));
  return window;
}

const LEX_MODAL_THEN_BTN = [
  'js/lex/lex.core.js',
  'js/lex/components/foundation/lex-modal.js',
  'js/lex/components/foundation/lex-btn.js'
];

describe('workflow pages: no hand-built overlays', () => {
  const pages = [
    'workflows/templates.html',
    'workflows/builder.html',
    'workflows/execution-logs.html',
    'workflows/retargeting.html',
    'automation/index.html'
  ];

  test.each(pages)('%s has no fixed-inset backdrop modal', (rel) => {
    const html = read(rel);
    expect(html).not.toMatch(/class="[^"]*fixed inset-0[^"]*bg-black/);
    expect(html).not.toMatch(/template-modal-overlay|data-template-modal-close/);
  });

  test.each(pages)('%s loads lex-modal before lex-btn so footer buttons upgrade once', (rel) => {
    const html = read(rel);
    const modalAt = html.indexOf('components/foundation/lex-modal.js');
    const btnAt = html.indexOf('components/foundation/lex-btn.js');
    expect(modalAt).toBeGreaterThan(-1);
    if (btnAt > -1) expect(modalAt).toBeLessThan(btnAt);
  });

  test('lex-btn takes its label as content, never a label attribute', () => {
    for (const rel of pages) {
      expect(read(rel)).not.toMatch(/<lex-btn[^>]*\slabel="/);
    }
  });

  test('templates.html declares the details dialog as a lex-modal with footer buttons', () => {
    const html = read('workflows/templates.html');
    expect(html).toMatch(/<lex-modal id="templateModal"/);
    expect(html).toMatch(/<lex-btn data-slot="footer"[^>]*onclick="installTemplate\(\)"/);
    expect(html).toContain('templateModal.open = true');
    // The lex scripts come after the dialog markup so it upgrades with its children.
    expect(html.indexOf('<lex-modal id="templateModal"')).toBeLessThan(html.indexOf('js/lex/lex.core.js'));
  });

  test('builder.html builds its template picker as a lex-modal', () => {
    const html = read('workflows/builder.html');
    expect(html).toContain("document.createElement('lex-modal')");
    expect(html).toContain('templateModal.open = true');
    expect(html).toContain('<div id="templateList"');
  });

  test('retargeting keeps the dialog open with keepOpen() when the name is missing', () => {
    const html = read('workflows/retargeting.html');
    expect(html).toContain('createModal.keepOpen()');
    expect(html).not.toContain('createModal.open = true;\n    });');
  });
});

describe('footer lex-btns inside a declarative lex-modal', () => {
  test('render a single inner button (no nested buttons) and keep their data attributes', async () => {
    const html = read('workflows/execution-logs.html');
    const start = html.indexOf('<lex-modal id="logModal"');
    const end = html.indexOf('</lex-modal>', start) + '</lex-modal>'.length;
    const window = bootLex(html.slice(start, end), LEX_MODAL_THEN_BTN);
    await tick(window);
    const modal = window.document.getElementById('logModal');
    const footer = modal.querySelector('.lex-modal-footer');
    const buttons = footer.querySelectorAll('lex-btn');
    expect(buttons).toHaveLength(2);
    expect(footer.querySelectorAll('button button')).toHaveLength(0);
    expect(buttons[1].getAttribute('data-log-action')).toBe('retry');
    expect(buttons[1].textContent.trim()).toBe('Retry execution');
  });
});

describe('automation app dialogs', () => {
  function bootAutomationModals() {
    const html = read('automation/index.html');
    const start = html.indexOf('<div id="automation-modals">');
    const end = html.indexOf('<!-- Canonical lana-ai-client API + auth -->');
    return bootLex(html.slice(start, end), LEX_MODAL_THEN_BTN);
  }

  test('all five dialogs are lex-modals with their footer actions in the footer', async () => {
    const window = bootAutomationModals();
    await tick(window);
    const ids = ['template-modal', 'check-data-modal', 'connector-import-modal', 'connector-add-instance-modal', 'connector-confirm-modal'];
    for (const id of ids) {
      const modal = window.document.getElementById(id);
      expect(modal.tagName).toBe('LEX-MODAL');
      expect(modal.querySelector('.lex-modal-footer lex-btn')).not.toBeNull();
      expect(modal.querySelectorAll('button button')).toHaveLength(0);
    }
    expect(window.document.querySelector('#template-modal .lex-modal-footer #template-modal-try')).not.toBeNull();
    expect(window.document.querySelector('#connector-confirm-modal .lex-modal-footer #connector-confirm-submit')).not.toBeNull();
  });

  test('Create Instance submits the add-instance form from the footer', async () => {
    const window = bootAutomationModals();
    await tick(window);
    const form = window.document.getElementById('connector-add-instance-form');
    const submit = window.document.querySelector('#connector-add-instance-submit button');
    expect(submit.getAttribute('type')).toBe('submit');
    expect(submit.getAttribute('form')).toBe('connector-add-instance-form');
    let submitted = 0;
    form.addEventListener('submit', (event) => { event.preventDefault(); submitted += 1; });
    submit.click();
    expect(submitted).toBe(1);
  });

  test('Escape on an open dialog emits lex-close (app.js resets state from it)', async () => {
    const window = bootAutomationModals();
    await tick(window);
    const modal = window.document.getElementById('connector-confirm-modal');
    let closed = 0;
    modal.addEventListener('lex-close', () => { closed += 1; });
    modal.open = true;
    await tick(window);
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toBe(1);
    expect(modal.open).toBeFalsy();
  });

  test('app.js drives dialogs through open/heading, not hidden classes', () => {
    const app = read('automation/app.js');
    expect(app).not.toMatch(/(templateModal|checkDataModal|connectorImportModal|connectorConfirmModal|connectorAddInstanceModal)\.classList/);
    expect(app).toContain("els.connectorAddInstanceForm?.addEventListener('submit'");
    expect(app).toContain("els.connectorConfirmModal?.addEventListener('lex-close'");
    expect(app).toContain('syncLibraryDetailModals(context, {})');
  });
});

describe('library-detail dialogs (syncLibraryDetailModals)', () => {
  const source = read('automation/js/views/library-detail.js');

  // The view is an ES module that jest cannot require; evaluate just the
  // dialog-sync section (DOM-only, no imports) inside jsdom.
  function bootSync() {
    const start = source.indexOf('const LD_MODAL_DISMISS');
    const fnStart = source.indexOf('export function syncLibraryDetailModals');
    const end = source.indexOf('\n}\n', fnStart) + 3;
    const section = source.slice(start, end).replace('export function', 'function');
    const window = bootLex('', ['js/lex/lex.core.js', 'js/lex/components/foundation/lex-modal.js', 'js/lex/components/foundation/lex-btn.js']);
    window.eval(`${section}\nwindow.__sync = syncLibraryDetailModals;`);
    return window;
  }

  function makeContext() {
    const ctx = {
      renders: 0,
      state: { libraryDetail: { deleteModalOpen: true, attachMatterModal: { open: true } } },
      renderCurrentView() { ctx.renders += 1; }
    };
    return ctx;
  }

  test('render functions return dialog specs, not overlay markup', () => {
    expect(source).not.toMatch(/ld-delete-modal-overlay|ld-artifact-modal-overlay|data-ld-attach-matter-overlay|data-ld-overrides-overlay/);
    expect(source).toMatch(/function renderDeleteModal[\s\S]*?heading: 'Delete this automation\?'/);
  });

  test('opens one lex-modal per dialog and refreshes it in place', async () => {
    const window = bootSync();
    const ctx = makeContext();
    const spec = { heading: 'Delete this automation?', size: 'sm', body: '<p>Gone</p>', footer: '<lex-btn data-ld-delete-confirm>Delete</lex-btn>' };
    window.__sync(ctx, { delete: spec });
    await tick(window);
    const modals = window.document.querySelectorAll('lex-modal[data-ld-modal="delete"]');
    expect(modals).toHaveLength(1);
    const modal = modals[0];
    expect(modal.open).toBe(true);
    expect(modal.querySelector('.lex-modal-footer [data-ld-delete-confirm]')).not.toBeNull();

    window.__sync(ctx, { delete: { ...spec, body: '<p>Still gone</p>' } });
    await tick(window);
    expect(window.document.querySelectorAll('lex-modal[data-ld-modal="delete"]')).toHaveLength(1);
    expect(window.document.querySelector('lex-modal[data-ld-modal="delete"]')).toBe(modal);
    expect(modal.textContent).toContain('Still gone');
  });

  test('header close clears the dialog state and re-renders; a closed spec removes the modal', async () => {
    const window = bootSync();
    const ctx = makeContext();
    window.__sync(ctx, { attachMatter: { heading: 'Attach to Matter', size: 'md', body: '<input data-ld-attach-matter-search>', footer: '' } });
    await tick(window);
    const modal = window.document.querySelector('lex-modal[data-ld-modal="attachMatter"]');
    modal.querySelector('[data-action="close"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(ctx.state.libraryDetail.attachMatterModal).toBeNull();
    expect(ctx.renders).toBe(1);

    window.__sync(ctx, { delete: { heading: 'D', size: 'sm', body: '', footer: '' } });
    await tick(window);
    window.__sync(ctx, {});
    await new Promise((resolve) => window.setTimeout(resolve, 600));
    expect(window.document.querySelector('lex-modal[data-ld-modal="delete"]')).toBeNull();
    // Closing because state changed does not count as a user dismissal.
    expect(ctx.state.libraryDetail.deleteModalOpen).toBe(true);
  });

  test('keeps focus in the attach-matter search when its content refreshes', async () => {
    const window = bootSync();
    const ctx = makeContext();
    const spec = (q) => ({ heading: 'Attach to Matter', size: 'md', body: `<input type="search" value="${q}" data-ld-attach-matter-search>`, footer: '' });
    window.__sync(ctx, { attachMatter: spec('ac') });
    await tick(window);
    const input = window.document.querySelector('[data-ld-attach-matter-search]');
    input.focus();
    input.setSelectionRange(2, 2);
    window.__sync(ctx, { attachMatter: spec('acm') });
    const next = window.document.querySelector('[data-ld-attach-matter-search]');
    expect(next).not.toBe(input);
    expect(window.document.activeElement).toBe(next);
  });
});
