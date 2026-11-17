'use strict';

/**
 * Renders the real report tile (ReportMetricCard) and the shared data state
 * block (DataState), not source greps:
 * - % Change shows from the backend's live change with no snapshot block.
 * - Empty cells use the shared empty token, never an em dash.
 * - A tile whose data_state is not ok shows the plain state instead of N/A.
 * - "Add to dashboard" sits inside the tile footer.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');
function load() {
  const win = {};
  for (const rel of ['js/shared/data-state.js', 'js/shared/reporting-goal-comparison-mapper.js', 'js/admin/report-metric-card.js']) {
    new Function('window', fs.readFileSync(path.join(SRC, rel), 'utf8'))(win);
  }
  return win;
}
const win = load();
const ctx = { goalPeriod: 'monthly', footerStart: '', footerEnd: '<button data-add-to-dashboard="k">Add to dashboard</button>' };
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('% Change renders from changePercent when no comparison block exists', () => {
  const html = win.ReportMetricCard.render({ key: 'd', name: 'Average Days', type: 'days', current: 9.4, prior: 11.2,
    changePercent: -16.1, changeDirection: 'down', data_state: 'ok' }, ctx);
  expect(text(html)).toContain('% Change 16.1%');
  expect(text(html)).toContain('Prior Period 11.2 days');
});

test('empty cells use the shared empty token, never a dash', () => {
  const html = win.ReportMetricCard.render({ key: 'c', name: 'Count', type: 'count', current: 3, prior: null, data_state: 'ok' }, ctx);
  expect(html).not.toMatch(/[–—]/);
  expect(text(html)).toContain('% Change ' + win.DataState.EMPTY_VALUE);
  expect(text(html)).toContain('Goal(s) ' + win.DataState.EMPTY_VALUE);
});

test('a tile that is not ok shows its state and reason, not N/A numbers', () => {
  const html = win.ReportMetricCard.render({ key: 'o', name: 'Owed', current: null, data_state: 'no_data_source',
    data_state_reason: 'No invoice data yet. Connect the app that holds it to see this number.' }, ctx);
  expect(text(html)).toContain('No invoice data yet');
  expect(text(html)).not.toContain('N/A');
  expect(text(html)).not.toContain('% Change');
});

test('Add to dashboard sits inside the card footer', () => {
  const html = win.ReportMetricCard.render({ key: 'c', name: 'Count', current: 3, data_state: 'ok' }, ctx);
  const card = html.slice(html.indexOf('data-metric-card'));
  expect(card.indexOf('data-add-to-dashboard')).toBeGreaterThan(card.indexOf('data-metric-card-footer'));
  expect(html.trim().endsWith('</div>')).toBe(true);
});

describe('DataState', () => {
  test.each(['no_data_source', 'not_configured', 'insufficient_data', 'timeout', 'invalid_request', 'engine_error'])('%s renders a titled status block', (state) => {
    const html = win.DataState.render({ data_state: state, data_state_reason: 'Plain reason.' });
    expect(html).toContain('role="status"');
    expect(html).toContain('lex-data-state--' + state.replace(/_/g, '-'));
    expect(text(html)).toContain('Plain reason.');
    expect(text(html).length).toBeGreaterThan('Plain reason.'.length);
  });
  test('ok and missing states render nothing', () => {
    expect(win.DataState.render({ data_state: 'ok' })).toBe('');
    expect(win.DataState.render({})).toBe('');
    expect(win.DataState.isProblem({ data_state: 'timeout' })).toBe(true);
    expect(win.DataState.isProblem({ data_state: 'ok' })).toBe(false);
  });
  test('reasons are escaped', () => {
    expect(win.DataState.render({ data_state: 'timeout', data_state_reason: '<b>x</b>' })).not.toContain('<b>');
  });
  test('capitalize labels a Compare By value', () => {
    expect(win.DataState.label('monthly')).toBe('Monthly');
  });
});

describe('result header labels', () => {
  const timeWin = { Date };
  new Function('window', fs.readFileSync(path.join(SRC, 'js/time-utils.js'), 'utf8'))(timeWin);
  win.LanaTime = timeWin.LanaTime;

  test('Compare By is a display label and periods name their UTC days', () => {
    const labels = win.ReportMetricCard.headerLabels({
      period: { type: 'monthly', start: '2026-11-10T00:00:00.000Z', end: '2026-11-16T23:59:59.999Z', startDate: '2026-11-10', endDate: '2026-11-16' },
      priorPeriod: { startDate: '2026-10-10', endDate: '2026-10-16' } });
    expect(labels).toEqual({ compareBy: 'Monthly', current: 'Nov 10 - Nov 16, 2026', prior: 'Oct 10 - Oct 16, 2026' });
  });

  test('no prior period shows the empty token', () => {
    expect(win.ReportMetricCard.headerLabels({ period: { type: 'weekly', startDate: '2026-11-10', endDate: '2026-11-16' }, priorPeriod: null }).prior)
      .toBe(win.DataState.EMPTY_VALUE);
  });
});

test('a saved report run in a failed state renders the shared state block', () => {
  const source = fs.readFileSync(path.join(SRC, 'js/admin/reporting.js'), 'utf8');
  const imported = source.slice(source.indexOf('async function executeImportedReport'));
  expect(imported).toMatch(/if \(window\.DataState\.isProblem\(result\)\)/);
});

describe('tile markup is safe', () => {
  const evil = { key: 'k1', name: '<img src=x onerror=alert(1)>', current: 3, data_state: 'ok' };

  test('the metric name is escaped in the title and the drilldown button', () => {
    const html = win.ReportMetricCard.render(evil, ctx);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  test('a tile that is not ok escapes its name too', () => {
    const html = win.ReportMetricCard.render({ ...evil, data_state: 'timeout' }, ctx);
    expect(html).not.toContain('<img');
  });

  test('drilldown buttons use data attributes, not inline onclick', () => {
    const generic = win.ReportMetricCard.render({ ...evil, hasDrilldown: true }, ctx);
    const details = win.ReportMetricCard.render(evil, ctx);
    [generic, details].forEach(html => expect(html).not.toMatch(/onclick/i));
    expect(generic).toContain('data-metric-drilldown="generic"');
    expect(details).toContain('data-metric-drilldown="details"');
    expect(generic).toContain('data-metric-key="k1"');
  });
});

test('an empty Goal(s) cell is muted like the other empty cells', () => {
  const html = win.ReportMetricCard.render({ key: 'c', name: 'Count', current: 3, prior: 2, data_state: 'ok' }, ctx);
  const goal = html.slice(html.indexOf('Goal(s)'), html.indexOf('Percent to Goal'));
  expect(goal).toContain('<span class="text-gray-400">' + win.DataState.EMPTY_VALUE + '</span>');
});

describe('tile styles live in reporting.css, not inline', () => {
  const css = fs.readFileSync(path.join(SRC, 'css/admin/reporting.css'), 'utf8');
  const tiles = [
    win.ReportMetricCard.render({ key: 'c', name: 'Count', current: 3, prior: 2, data_state: 'ok' }, ctx),
    win.ReportMetricCard.render({ key: 'o', name: 'Owed', data_state: 'no_data_source', data_state_reason: 'r' }, ctx)
  ];
  test.each(tiles.map((h, i) => [i, h]))('tile %i has no inline style', (i, html) => {
    expect(html).not.toMatch(/style="/);
  });
  test('every report-tile class the tile uses is defined in reporting.css', () => {
    const used = new Set(tiles.join('').match(/report-tile[a-z_-]*/g));
    expect(used.size).toBeGreaterThan(0);
    for (const cls of used) expect(css).toContain('.' + cls);
  });
});
