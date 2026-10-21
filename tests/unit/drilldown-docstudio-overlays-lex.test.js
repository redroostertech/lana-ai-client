/**
 * Wave 3b part 2B of the UI standard (docs/TABLE-STANDARD.md section 11):
 * the drilldown column help, the automation builder's publish dialog and the
 * file editor's remaining dialogs use lex components, never hand-built
 * popovers, overlays or raw-HTML confirms.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function boot(bodyHtml = '', components = ['lex-modal', 'lex-btn']) {
  const dom = new JSDOM(`<!doctype html><body>${bodyHtml}</body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.eval(read('js/lex/lex.core.js'));
  components.forEach((name) => window.eval(read(`js/lex/components/foundation/${name}.js`)));
  window.console.log = () => {};
  window.console.warn = () => {};
  return window;
}

const tick = (window, ms = 30) => new Promise((resolve) => window.setTimeout(resolve, ms));
const click = (window, el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

describe('drilldown column help', () => {
  const source = read('js/drilldown-renderer.js');

  test('is the trigger button\'s native tooltip, not a hand-built popover', () => {
    expect(source).not.toContain('cell-tooltip-popover');
    expect(source).not.toMatch(/showTooltip\(/);
    expect(source).not.toMatch(/(^|[^.\w])(alert|confirm|prompt)\(/m);
    expect(source).not.toMatch(/Modal\.alert\(/);
  });

  test('renders an escaped title and a click does not open the row', () => {
    const window = boot('<lex-modal id="drilldown-modal"><lex-table id="drilldown-table"></lex-table></lex-modal>', []);
    const DrilldownRenderer = window.eval(`(function () { var module = { exports: {} }; ${source}; return module.exports; })()`);
    const renderer = new DrilldownRenderer();
    let renderers = null;
    const table = window.document.getElementById('drilldown-table');
    table.setCellRenderers = (r) => { renderers = r; };
    table.setColumnFilterOptions = () => {};
    renderer.currentConfig = { columns: [{ field: 'name', label: 'Name', tooltip: 'Client <b>name</b> "quoted"' }] };
    renderer.loadColumnFilterOptions = () => {};
    renderer.configureTable(table);

    const cell = window.document.createElement('div');
    cell.innerHTML = renderers.name('Acme');
    const trigger = cell.querySelector('button.cell-tooltip-trigger');
    expect(trigger).not.toBeNull();
    expect(trigger.getAttribute('type')).toBe('button');
    expect(trigger.getAttribute('title')).toBe('Client <b>name</b> "quoted"');
    expect(trigger.getAttribute('aria-label')).toBe('Client <b>name</b> "quoted"');
    expect(cell.querySelector('b')).toBeNull();

    renderer.showRawData = jest.fn();
    renderer.attachEventListeners();
    table.appendChild(cell);
    const rowClick = jest.fn();
    window.document.body.addEventListener('click', rowClick);
    click(window, trigger);
    expect(renderer.showRawData).not.toHaveBeenCalled();
    expect(rowClick).not.toHaveBeenCalled();
    expect(window.document.getElementById('cell-tooltip-popover')).toBeNull();
  });
});

describe('automation builder publish dialog', () => {
  const builder = read('automation/js/views/builder.js');
  const app = read('automation/app.js');
  const css = read('automation/styles.css');

  test('is a lex-modal with footer-slot buttons, not a hand-built overlay', () => {
    expect(builder).toMatch(/<lex-modal id="builder-publish-modal" heading="Publish Automation" size="lg" hide-actions data-builder-publish-modal \$\{context\.state\.builder\.publishModalOpen \? 'open' : ''\}>/);
    expect(builder).not.toMatch(/builder-publish-(overlay|panel|header|footer)/);
    expect(builder).toMatch(/<lex-btn data-slot="footer" variant="secondary" size="sm" data-close-publish-modal>Cancel<\/lex-btn>/);
    expect(builder).toMatch(/<lex-btn data-slot="footer" id="create-automation-btn"/);
    expect(css).not.toMatch(/\.builder-publish-(modal|overlay|panel|header|footer)\b/);
  });

  test('header close, backdrop and Escape clear publishModalOpen', () => {
    expect(app).toMatch(/matches\?\.\('\[data-builder-publish-modal\]'\)\) \{\s*state\.builder\.publishModalOpen = false;/);
    expect(app).toMatch(/#create-automation-btn[\s\S]{0,200}getElementById\('builder-publish-modal'\)/);
  });

  test('re-rendered markup opens with its footer buttons in the modal footer', async () => {
    const window = boot('<div id="view-content"></div>');
    const mount = window.document.getElementById('view-content');
    mount.innerHTML = `
      <section>
        <lex-modal id="builder-publish-modal" heading="Publish Automation" size="lg" hide-actions data-builder-publish-modal open>
          <div class="builder-publish-body"><p>Scope</p></div>
          <lex-btn data-slot="footer" variant="secondary" size="sm" data-close-publish-modal>Cancel</lex-btn>
          <lex-btn data-slot="footer" id="create-automation-btn" variant="primary" size="sm">Publish Automation</lex-btn>
        </lex-modal>
      </section>`;
    const modal = window.document.getElementById('builder-publish-modal');
    await tick(window);
    expect(modal.open).toBe(true);
    const footer = modal.querySelector('.lex-modal-footer');
    expect(footer.querySelector('#create-automation-btn')).not.toBeNull();
    expect(footer.querySelector('[data-close-publish-modal]')).not.toBeNull();
    expect(footer.querySelectorAll('button.lex-modal-btn').length).toBe(0);
    expect(modal.contentRoot.querySelector('.builder-publish-body')).not.toBeNull();
    // The footer buttons stay inside the mount, so the app's body-level click
    // delegation still sees them.
    expect(mount.contains(footer.querySelector('#create-automation-btn'))).toBe(true);

    const closed = jest.fn();
    modal.addEventListener('lex-close', closed);
    click(window, modal.querySelector('.lex-modal-close'));
    expect(closed).toHaveBeenCalledTimes(1);
    expect(modal.open).toBeFalsy();
  });
});

describe('file editor dialogs', () => {
  const source = read('js/file-editor.js');

  test('refreshes the file info drawer through drawer.contentRoot', () => {
    expect(source).not.toContain(".lex-drawer-body slot-content");
    expect(source).toMatch(/var slot = drawer\.contentRoot;/);
  });

  test('release confirm escapes the filename (confirmAsync, not raw-HTML confirm)', () => {
    expect(source).not.toMatch(/Lex\.Modal\.confirm\(/);
    expect(source).toMatch(/Lex\.Modal\.confirmAsync\('Release Version', message, \{ confirmText: 'Release Version' \}\)/);
    expect(source).not.toMatch(/(^|[^.\w])(alert|confirm|prompt)\(/m);
    expect(source).not.toMatch(/<select[\s>]|createElement\(['"]select['"]\)/);
  });
});

describe('doc studio', () => {
  test('rename and share use Lex.Modal.prompt; no native dialogs or selects', () => {
    const app = read('doc-studio/app.js');
    const html = read('doc-studio/index.html');
    expect(app).toMatch(/Lex\.Modal\.prompt\('Rename file'/);
    expect(app).toMatch(/Lex\.Modal\.prompt\('Presentation viewer link'/);
    expect(app).not.toMatch(/(^|[^.\w])(alert|confirm|prompt)\(/m);
    [app, html].forEach((text) => {
      expect(text).not.toMatch(/<select[\s>]|createElement\(['"]select['"]\)/);
      expect(text).not.toContain('fixed inset-0');
    });
  });
});
