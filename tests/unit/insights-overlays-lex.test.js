/**
 * Insights overlays on lex components (UI standard section 11, wave 3b part 2B).
 *
 * insights/module-execution.html and insights/dashboard.html share their
 * drilldown, chart-help, page and data-override dialogs through
 * src/insights/js/insights-overlays.js. These tests run that module with the
 * real lex components in jsdom, and check the pages no longer ship the
 * hand-built overlays.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function boot(bodyHtml = '') {
  const dom = new JSDOM(`<!doctype html><body>${bodyHtml}</body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.eval(read('js/lex/lex.core.js'));
  ['lex-modal', 'lex-drawer', 'lex-btn'].forEach((name) => window.eval(read(`js/lex/components/foundation/${name}.js`)));
  window.eval(read('insights/js/insights-overlays.js'));
  window.console.log = () => {};
  return window;
}

const tick = (window, ms = 30) => new Promise((resolve) => window.setTimeout(resolve, ms));
const click = (window, el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const pressEscape = (window) => window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

describe('InsightsOverlays drilldown', () => {
  test('mounts one full-size lex-modal, replacing legacy markup, and opens with a title', async () => {
    const window = boot('<div id="drilldownModal" class="hidden fixed inset-0"><div id="drilldownContent"></div></div>');
    const { InsightsOverlays } = window;
    const content = InsightsOverlays.drilldownContent();
    const modal = window.document.getElementById('drilldownModal');
    expect(modal.tagName).toBe('LEX-MODAL');
    expect(modal.getAttribute('size')).toBe('full');
    expect(window.document.querySelectorAll('#drilldownContent').length).toBe(1);
    expect(modal.contentRoot.contains(content)).toBe(true);
    expect(modal.open).toBeFalsy();

    content.innerHTML = '<p id="rows">rows</p>';
    const opened = InsightsOverlays.openDrilldown('Leads from: Web');
    expect(opened).toBe(content);
    expect(modal.open).toBe(true);
    await tick(window); // lex property updates render on the next microtask
    expect(modal.querySelector('.lex-modal-title').textContent).toBe('Leads from: Web');
    expect(window.document.getElementById('rows')).not.toBeNull();

    pressEscape(window);
    expect(modal.open).toBeFalsy();

    // Reopening reuses the same element and the footer Close button closes it.
    InsightsOverlays.openDrilldown('Second');
    expect(window.document.querySelectorAll('lex-modal').length).toBe(1);
    await tick(window);
    click(window, modal.querySelector('.lex-modal-footer [data-action="cancel"]'));
    expect(modal.open).toBeFalsy();

    InsightsOverlays.openDrilldown('Third');
    InsightsOverlays.closeDrilldown();
    expect(modal.open).toBeFalsy();
  });
});

describe('InsightsOverlays chart help', () => {
  const helpText = {
    title: 'Reading this chart',
    sections: [
      { heading: 'What it shows', content: 'Leads per week' },
      { heading: 'Tips', bullets: ['**Hover** a bar', 'Click a legend'] }
    ]
  };

  test('returns an icon button that opens a lex-modal and is removed after Got it', async () => {
    const window = boot('<div id="host"></div>');
    const { InsightsOverlays } = window;
    const html = InsightsOverlays.helpButton(helpText, 'chart-1', {
      renderInline: (t) => String(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    });
    expect(html).toContain('data-insights-help="help-modal-chart-1"');
    expect(html).not.toContain('fixed inset-0');

    const host = window.document.getElementById('host');
    host.innerHTML = html;
    click(window, host.querySelector('button'));
    const modal = window.document.querySelector('lex-modal');
    expect(modal).not.toBeNull();
    expect(modal.open).toBe(true);
    expect(modal.querySelector('.lex-modal-title').textContent).toBe('Reading this chart');
    expect(modal.contentRoot.textContent).toContain('Leads per week');
    expect(modal.contentRoot.querySelector('strong').textContent).toBe('Hover');

    await tick(window);
    click(window, modal.querySelector('.lex-modal-footer [data-action="cancel"]'));
    expect(modal.open).toBeFalsy();
    await tick(window, 400);
    expect(window.document.querySelector('lex-modal')).toBeNull();
  });

  test('returns nothing without sections', () => {
    const window = boot();
    expect(window.InsightsOverlays.helpButton(null, 'x')).toBe('');
    expect(window.InsightsOverlays.helpButton({ sections: [] }, 'x')).toBe('');
  });
});

describe('InsightsOverlays page modals from templates', () => {
  const TEMPLATE = `
    <template id="dataSourcesModalTemplate">
      <div id="dataSourcesList"></div>
      <lex-btn data-slot="footer" variant="secondary" data-action="cancel">Close</lex-btn>
    </template>`;

  test('builds a persistent lex-modal with the template body and a footer Close', async () => {
    const window = boot(TEMPLATE);
    const { InsightsOverlays } = window;
    const modal = InsightsOverlays.pageModal('dataSourcesModal', { heading: 'Data sources' });
    expect(modal.tagName).toBe('LEX-MODAL');
    expect(modal.contentRoot.querySelector('#dataSourcesList')).not.toBeNull();
    const footer = modal.querySelector('.lex-modal-footer');
    expect(footer.querySelectorAll('lex-btn').length).toBe(1);
    // The built-in confirm/cancel pair is not rendered.
    expect(modal.querySelector('.lex-modal-btn--confirm')).toBeNull();

    InsightsOverlays.openModal('dataSourcesModal');
    expect(modal.open).toBe(true);
    await tick(window);
    click(window, footer.querySelector('lex-btn'));
    expect(modal.open).toBeFalsy();

    expect(InsightsOverlays.pageModal('dataSourcesModal')).toBe(modal);
    InsightsOverlays.openModal('dataSourcesModal');
    InsightsOverlays.closeModal('dataSourcesModal');
    expect(modal.open).toBeFalsy();
  });
});

describe('InsightsOverlays data override panel', () => {
  function bootOverride() {
    const window = boot();
    const source = read('js/components/data-override-panel.js')
      .replace('export class DataOverridePanel', 'window.DataOverridePanel = class DataOverridePanel')
      .replace('export default DataOverridePanel;', '');
    window.eval(source);
    window.eval('var LanaTime = { utcDayStart: (d) => d + "T00:00:00Z", utcDayEnd: (d) => d + "T23:59:59Z" };');
    window.eval('var formatDate = (d) => String(d);');
    return window;
  }

  test('returns null until the component is loaded', () => {
    const window = boot();
    expect(window.InsightsOverlays.overridePanel({})).toBeNull();
  });

  test('is one shared lex-drawer; existing overrides can be deleted', async () => {
    const window = bootOverride();
    const overrides = [{ override_id: 'ov-1', metric_key: 'revenue', override_value: 5, period_start: 'a', period_end: 'b', notes: '<b>x</b>', created_at: '2026-01-02' }];
    const apiClient = { get: jest.fn(async () => overrides), post: jest.fn(async () => ({})), delete: jest.fn(async () => ({})) };
    const onDeleteSuccess = jest.fn();
    window.Lex.Modal.confirmAsync = jest.fn(async () => true);

    const panel = window.InsightsOverlays.overridePanel({ apiClient, onError: () => {}, onDeleteSuccess, formatDateRange: () => 'Jan' });
    expect(window.InsightsOverlays.overridePanel({})).toBe(panel);
    expect(window.document.querySelectorAll('#dataOverridePanel').length).toBe(1);

    panel.open('revenue', 'Revenue', '', 100, { periodStart: '2026-01-01', periodEnd: '2026-01-31', periodType: 'monthly', moduleKey: 'growth' });
    await tick(window);
    const list = window.document.getElementById('existingOverridesList');
    // Notes are escaped.
    expect(list.querySelector('b')).toBeNull();
    click(window, list.querySelector('.delete-override-btn'));
    await tick(window);
    expect(apiClient.delete).toHaveBeenCalledWith('/api/v1/modules/growth/data-overrides/ov-1');
    expect(onDeleteSuccess).toHaveBeenCalledWith('ov-1');
  });
});

describe('insights pages ship no hand-built overlays', () => {
  const pages = ['insights/module-execution.html', 'insights/dashboard.html', 'insights/predictions.html'];

  test.each(pages)('%s uses lex components and the shared header menu', (page) => {
    const html = read(page);
    expect(html).not.toMatch(/fixed inset-0/);
    expect(html).not.toMatch(/id="notificationPanel"/);
    expect(html).not.toMatch(/id="dataOverridePanel"/);
    expect(html).not.toMatch(/id="userDropdown"/);
    expect(html).toMatch(/id="userMenu" data-header-user-menu/);
    expect(html).toContain('../js/shared/header-user-menu.js');
    expect(html).toContain('../js/lex/components/foundation/lex-drawer.js');
    expect(html).not.toMatch(/<select[\s>]/);
    expect(html).not.toMatch(/(^|[^.\w])(alert|confirm|prompt)\(/m);
  });

  test.each(['insights/module-execution.html', 'insights/dashboard.html'])('%s loads the shared overlays module', (page) => {
    const html = read(page);
    expect(html).toContain('js/insights-overlays.js');
    expect(html).toContain("import { DataOverridePanel } from '../js/components/data-override-panel.js'");
    expect(html).not.toMatch(/id="drilldownModal"/);
  });
});
