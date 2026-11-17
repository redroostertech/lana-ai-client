'use strict';

/**
 * Runs the real Dashboards library script (dashboard-library.js, init()
 * removed) with its shared scripts and renders its cells and Pinned cards.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function page(timezone) {
  const stored = JSON.stringify({ timezone });
  const window = { localStorage: { getItem: () => stored }, Intl, Date, URLSearchParams };
  new Function('window', read('js/time-utils.js'))(window);
  new Function('window', 'document', read('js/lex/lex.utils.js'))(window, { createTextNode: (t) => ({ textContent: String(t) }) });
  new Function('window', read('js/shared/library-column-filters.js'))(window);
  new Function('window', read('js/shared/metric-tables.js'))(window);
  new Function('window', read('js/shared/data-state.js'))(window);
  window.Lex = { Utils: window.Lex ? window.Lex.Utils : window.LexUtils };
  let source = read('js/admin/dashboard-library.js');
  const end = source.lastIndexOf('  init();');
  source = source.slice(0, end) + '  window.testExports = { cellRenderers, renderPinnedStrip, setPinned: function (ids) { pinnedIds = new Set(ids); } };'
    + source.slice(end + '  init();'.length);
  const nodes = { dashboardLibraryPinnedSection: {}, dashboardLibraryPinnedGrid: {}, dashboardLibraryPinnedCount: {} };
  vm.runInNewContext(source, { window, document: { getElementById: (id) => nodes[id] || null }, console, Set, Lex: window.Lex });
  return { exports: window.testExports, nodes, window };
}

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('the state reads the same in the table and the Pinned card', () => {
  const { exports, nodes, window } = page('America/New_York');
  const row = window.LanaMetricTables.mapDashboardRecord({ id: 'd1', name: 'Owner', state: 'active' }, 0);
  const cell = exports.cellRenderers().state(row.state, row);
  exports.setPinned(['d1']);
  exports.renderPinnedStrip([row]);
  expect(cell).toContain('label="Active"');
  expect(text(nodes.dashboardLibraryPinnedGrid.innerHTML)).toContain('Active');
  expect(text(nodes.dashboardLibraryPinnedGrid.innerHTML)).not.toMatch(/\bactive\b/);
});

test('Created shows a real timestamp in the firm time zone', () => {
  const ny = page('America/New_York').exports.cellRenderers().created_at('2026-10-01T14:30:00.000Z');
  const la = page('America/Los_Angeles').exports.cellRenderers().created_at('2026-10-01T14:30:00.000Z');
  expect(text(ny)).toBe('10/1/2026 10:30 AM');
  expect(text(la)).toBe('10/1/2026 7:30 AM');
});

test('the state label reads an enum as words', () => {
  const { window } = page('America/New_York');
  expect(window.DataState.label('in_review')).toBe('In review');
  expect(window.DataState.label('Active')).toBe('Active');
});

describe('the library table fits the page (CSS)', () => {
  const css = read('css/admin/insights-dashboard.css');
  const rules = (selector) => [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(m => m[1].split(',').map(s => s.trim()).includes(selector)).map(m => m[2]);

  test('the Edit and Delete wrapper is never squeezed to a sliver', () => {
    // A 1% width pushed the buttons left over the Last edited column.
    expect(rules('.insights-library-actions').join(';')).not.toMatch(/width:\s*1%/);
  });

  test('the table needs no more than the content width at a 1440px window', () => {
    const minWidth = Number((css.match(/#dashboardLibraryTable table \{ min-width: (\d+)px; \}/) || [])[1]);
    expect(minWidth).toBeLessThanOrEqual(1070);
  });
});
