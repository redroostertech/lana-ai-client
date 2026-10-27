/**
 * ActionStep and Leadly dashboards on lex overlays (UI standard section 11,
 * wave 3b part 2B).
 *
 * The shared ConnectorImportDialogs module (create folder, setup required,
 * type-DELETE) runs against the real lex-modal / lex-btn in jsdom; the pages
 * are checked for the lex-modal / lex-drawer markup that replaced their
 * hand-built overlays, and the detail drawer helpers run from page source.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function boot(bodyHtml = '', { components = ['lex-modal', 'lex-drawer', 'lex-btn'] } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${bodyHtml}</body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.eval(read('js/lex/lex.core.js'));
  components.forEach((name) => {
    const dir = 'foundation';
    window.eval(read(`js/lex/components/${dir}/${name}.js`));
  });
  window.console.log = () => {};
  window.Toast = { error: jest.fn(), success: jest.fn() };
  window.eval(read('integrations/js/connector-import-dialogs.js'));
  return window;
}

const tick = (window, ms = 30) => new Promise((resolve) => window.setTimeout(resolve, ms));
const click = (window, el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const openModals = (window) => Array.from(window.document.querySelectorAll('lex-modal')).filter((m) => m.open);

function typeInto(window, input, value) {
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

function promptInput(modal) {
  const el = modal.querySelector('[data-lex-prompt-input]');
  return el.querySelector('input') || el;
}

describe('ConnectorImportDialogs', () => {
  test('validateFolderName accepts letters, numbers, hyphens and underscores only', () => {
    const window = boot();
    const D = window.ConnectorImportDialogs;
    expect(D.validateFolderName('Case_files-2026')).toBe('');
    expect(D.validateFolderName('  ')).toBe('Please enter a folder name');
    expect(D.validateFolderName('a/b')).toMatch(/letters, numbers/);
  });

  test('promptFolderName resolves the name, re-asks after an invalid one, and null on cancel', async () => {
    const window = boot();
    const D = window.ConnectorImportDialogs;

    const pending = D.promptFolderName();
    await tick(window);
    let modal = openModals(window)[0];
    expect(modal.heading).toBe('Create new folder');
    promptInput(modal).value = 'bad name!';
    click(window, modal.querySelector('[data-action="confirm"]'));
    await tick(window);
    expect(window.Toast.error).toHaveBeenCalledWith(expect.stringMatching(/letters, numbers/));

    // Asked again, keeping what was typed.
    modal = openModals(window).find((m) => m !== modal) || openModals(window)[0];
    expect(promptInput(modal).value).toBe('bad name!');
    promptInput(modal).value = 'good_name';
    click(window, modal.querySelector('[data-action="confirm"]'));
    await expect(pending).resolves.toBe('good_name');

    const cancelled = D.promptFolderName();
    await tick(window);
    click(window, openModals(window)[0].querySelector('[data-action="cancel"]'));
    await expect(cancelled).resolves.toBeNull();
  });

  test('showSetupRequired is a lex-modal alert naming the connector', async () => {
    const window = boot();
    const done = window.ConnectorImportDialogs.showSetupRequired('ActionStep');
    const modal = openModals(window)[0];
    expect(modal.heading).toBe('Setup required');
    expect(modal.contentRoot.textContent).toContain('your ActionStep files');
    click(window, modal.querySelector('[data-action="confirm"]'));
    await expect(done).resolves.toBeUndefined();
    expect(window.document.querySelector('.fixed.inset-0')).toBeNull();
  });

  test('confirmTypedDelete enables delete only for DELETE, then runs onConfirm and closes', async () => {
    const window = boot();
    const onConfirm = jest.fn(async () => {});
    const handle = window.ConnectorImportDialogs.confirmTypedDelete({ connectorLabel: 'Leadly CRM', onConfirm });
    await tick(window);
    const modal = handle.modal;
    expect(modal.tagName).toBe('LEX-MODAL');
    expect(modal.contentRoot.textContent).toContain('your Leadly CRM configuration');
    const input = window.document.getElementById('deleteConfirmInput');
    const btn = window.document.getElementById('confirmDeleteBtn');
    // The buttons ride in the modal footer, not the body.
    expect(btn.closest('.lex-modal-footer')).not.toBeNull();
    expect(btn.disabled).toBe(true);

    typeInto(window, input, 'delete');
    expect(btn.disabled).toBe(true);
    await handle.confirm();
    expect(onConfirm).not.toHaveBeenCalled();

    typeInto(window, input, 'DELETE');
    expect(btn.disabled).toBeFalsy();
    await tick(window);
    expect(btn.querySelector('button').disabled).toBe(false);
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick(window);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(modal.open).toBeFalsy();
    expect(window.ConnectorImportDialogs.activeDelete()).toBeNull();
  });

  test('confirmTypedDelete stays open when onConfirm throws, and Cancel closes it', async () => {
    const window = boot();
    const handle = window.ConnectorImportDialogs.confirmTypedDelete({
      connectorLabel: 'ActionStep',
      onConfirm: async () => { throw new Error('nope'); }
    });
    await tick(window);
    typeInto(window, window.document.getElementById('deleteConfirmInput'), 'DELETE');
    await handle.confirm();
    expect(handle.modal.open).toBe(true);
    expect(window.document.getElementById('confirmDeleteBtn').loading).toBe(false);

    click(window, handle.modal.querySelector('[data-delete-cancel]'));
    expect(handle.modal.open).toBeFalsy();
    expect(window.ConnectorImportDialogs.activeDelete()).toBeNull();
  });
});

describe.each(['actionstep.html', 'leadly.html'])('%s overlays', (page) => {
  const html = read(`integrations/${page}`);

  test('has no hand-built overlays, native selects or window dialogs', () => {
    expect(html).not.toMatch(/fixed inset-0/);
    expect(html).not.toMatch(/inset-y-0/);
    expect(html).not.toMatch(/<select[\s>]/);
    expect(html).not.toMatch(/(^|[^.\w])(alert|confirm|prompt)\(/m);
  });

  test('declares the directory browser and settings dialogs as lex-modals', () => {
    expect(html).toMatch(/<lex-modal id="directoryBrowserModal" heading="Select Import Directory"/);
    expect(html).toMatch(/<lex-modal id="settingsModal" heading="[^"]+ Configuration"/);
    expect(html).toContain("document.getElementById('settingsModal').open = true;");
    expect(html).toContain("document.getElementById('directoryBrowserModal').open = false;");
  });

  test('loads lex-modal and lex-drawer before lex-btn, and the shared dialogs module', () => {
    const at = (src) => html.indexOf(`src="${src}"`);
    expect(at('../js/lex/components/foundation/lex-modal.js')).toBeGreaterThan(-1);
    expect(at('../js/lex/components/foundation/lex-drawer.js')).toBeGreaterThan(-1);
    expect(at('../js/lex/components/foundation/lex-btn.js')).toBeGreaterThan(at('../js/lex/components/foundation/lex-modal.js'));
    expect(at('../js/lex/components/foundation/lex-btn.js')).toBeGreaterThan(at('../js/lex/components/foundation/lex-drawer.js'));
    expect(at('js/connector-import-dialogs.js')).toBeGreaterThan(-1);
  });
});

describe('ActionStep detail drawer', () => {
  const html = read('integrations/actionstep.html');

  function extract(name) {
    const start = html.indexOf(`    function ${name}(`);
    const end = html.indexOf('\n    }\n', start);
    return html.slice(start, end + 6);
  }

  test('matter, participant, task and file-note details share one lex-drawer', async () => {
    const start = html.indexOf('<lex-drawer id="matterDetailPanel"');
    const markup = html.slice(start, html.indexOf('</lex-drawer>', start) + '</lex-drawer>'.length);
    expect(markup).toContain('id="matterDetailContent"');
    expect(html).not.toContain('matterDetailOverlay');

    const window = boot(markup);
    window.eval(extract('openDetailDrawer') + '\n' + extract('closeMatterDetail') +
      '\nwindow.openDetailDrawer = openDetailDrawer; window.closeMatterDetail = closeMatterDetail;');
    const drawer = window.document.getElementById('matterDetailPanel');
    expect(drawer.tagName).toBe('LEX-DRAWER');

    const content = window.openDetailDrawer('Participant Details');
    expect(drawer.open).toBe(true);
    expect(drawer.heading).toBe('Participant Details');
    expect(content).toBe(window.document.getElementById('matterDetailContent'));
    expect(drawer.contentRoot.contains(content)).toBe(true);

    window.closeMatterDetail();
    expect(drawer.open).toBeFalsy();

    // Matter details reset the heading a previous detail view changed.
    window.openDetailDrawer('Matter Details');
    expect(drawer.heading).toBe('Matter Details');
    await tick(window);
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(drawer.open).toBeFalsy();
  });

  test('the four detail openers go through openDetailDrawer', () => {
    ['Matter Details', 'Participant Details', 'Task Details', 'File Note Details'].forEach((title) => {
      expect(html).toContain(`openDetailDrawer('${title}')`);
    });
  });
});
