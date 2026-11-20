'use strict';

/**
 * Reports is two pages. The list (admin/reports-list.html) holds the list,
 * search, show more, the about drawer with its footer run controls, and
 * Import Report. The detail page (admin/report.html?report=<key> or
 * ?saved=<id>) holds the report header, the date form, Run Report, results
 * and drilldowns. Running from the drawer opens the detail page with the
 * period in the URL, and the detail page runs it. Both run their real
 * scripts here.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withReportSharedScripts } = require('./helpers/report-shared-scripts');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function node(id) {
  const listeners = {};
  return {
    id, value: '', hidden: false, innerHTML: '', textContent: '', style: {}, dataset: {}, loading: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    listeners,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {}, setAttribute() {}, getAttribute: () => null, appendChild() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    setData: jest.fn(), setCellRenderers() {}, focus() {}
  };
}

const MODULES = [
  { moduleKey: 'case-workload', name: 'Case Workload', purpose: 'See the work across the team.', usesPeriod: true },
  // usesPeriod false is backend data the pages gate nothing on.
  { moduleKey: 'document-count', name: 'Document Count', purpose: 'See how many documents.', usesPeriod: false }
];
const SAVED = [{ report_id: 'r1', name: 'Our report', description: 'Ours.', is_template: false, definition: {} }];
const RESULT = {
  moduleKey: 'case-workload', moduleName: 'Case Workload', metrics: [], visualizations: [], dataSources: [],
  period: { type: 'monthly', startDate: '2026-11-09', endDate: '2026-11-15' }
};

function context({ script, query = '', initOut = true, hiddenIds = [] }) {
  let source = read(script);
  const end = source.lastIndexOf('  init();');
  source = source.slice(0, end) + '  window.testExports = { init: init };' + (initOut ? '' : '\n  init();') + source.slice(end + '  init();'.length);
  const window = withReportSharedScripts({ addEventListener() {}, location: { search: '' } });
  window.ReportingGoalComparisonMapper = require('../../src/js/shared/reporting-goal-comparison-mapper.js');
  const timeWin = { Date };
  new Function('window', read('js/time-utils.js'))(timeWin);
  window.LanaTime = timeWin.LanaTime;
  const go = jest.fn();
  window.Lex = {
    Modal: { alert: jest.fn(), confirm: jest.fn() }, Toast: { success() {}, error() {} },
    Utils: { getFirmTimezone: () => 'UTC', getOrganizationTimezone: () => 'UTC' },
    Nav: { go, getParams: () => new URLSearchParams(query) }
  };
  window.DrilldownRenderer = function DrilldownRenderer() { this.open = async () => {}; };
  window.ReportingTables = { loadAllLeads: jest.fn().mockResolvedValue({ rows: [], truncated: false }), mountClientTable() {},
    LEAD_TABLE: { columns: [], labels: {} }, leadRenderers() { return {}; }, leadFilterOptions() { return {}; } };
  const nodes = {};
  hiddenIds.forEach((id) => { nodes[id] = node(id); nodes[id].hidden = true; });
  const drawer = node('reportAboutDrawer');
  drawer.contentRoot = node('drawerBody');
  drawer.contentRoot.querySelector = () => node('aboutBody');
  nodes.reportAboutDrawer = drawer;
  const docListeners = {};
  const document = {
    addEventListener(type, fn, capture) { (docListeners[type] = docListeners[type] || []).push({ fn, capture }); },
    removeEventListener() {},
    getElementById: (id) => (nodes[id] = nodes[id] || node(id)),
    createElement: () => node(), querySelector: () => null, querySelectorAll: () => []
  };
  const get = jest.fn(async (url) => {
    if (url === '/api/v1/modules') return { modules: MODULES };
    if (url === '/api/v1/reporting/reports') return { data: SAVED };
    return { about: { what: 'What it is here.' } };
  });
  const post = jest.fn().mockResolvedValue(RESULT);
  vm.runInNewContext(source, {
    window, document, console: { log() {}, error() {}, warn() {} }, Intl, URLSearchParams, Promise,
    setTimeout: jest.fn(), clearTimeout: jest.fn(), LanaTime: timeWin.LanaTime, ReportsList: window.ReportsList,
    Lex: window.Lex, DrilldownRenderer: window.DrilldownRenderer,
    api: { get, post, delete: jest.fn().mockResolvedValue({}), user: {}, ensureFirmTimezone: jest.fn(async () => {}) }
  });
  return { window, nodes, drawer, go, get, post, docListeners, LanaTime: timeWin.LanaTime, exports: window.testExports };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
async function settleAll() { for (let i = 0; i < 10; i += 1) await settle(); }

describe('the list page', () => {
  test('renders the reports, with show more opening the drawer', async () => {
    const { nodes, drawer, window } = context({ script: 'js/admin/reports-list.js', initOut: false });
    await settleAll();
    const rows = nodes.reportsListTable.setData.mock.calls.pop()[0];
    expect(rows.map(r => r.id)).toEqual(['module:case-workload', 'module:document-count', 'saved:r1']);
    expect(window.ReportsList.purposeCell(rows[0], window.ReportsList.escapeHtml)).toContain('data-report-about="module:case-workload"');
    expect(drawer.open).toBeFalsy();
  });

  test.each([
    ['a preset', 'module:case-workload', 'lastWeek', null, 'admin/report.html?report=case-workload&period=lastWeek'],
    ['a custom range', 'module:document-count', 'custom', ['2026-11-01', '2026-11-10'], 'admin/report.html?report=document-count&start=2026-11-01&end=2026-11-10'],
    ['a saved report', 'saved:r1', 'today', null, 'admin/report.html?saved=r1&period=today']
  ])('Run in the drawer with %s opens the detail page with the period in the URL', async (_label, id, preset, range, href) => {
    const { nodes, drawer, go } = context({ script: 'js/admin/reports-list.js', initOut: false });
    await settleAll();
    nodes.reportsListTable.listeners.click[0]({ target: { closest: (sel) => (sel === '[data-report-about]' ? { getAttribute: () => id } : null) } });
    await settleAll();
    expect(drawer.open).toBe(true);
    expect(nodes.reportRunFooter.innerHTML).toContain('<lex-select data-run-period');
    const fields = { '[data-run-start]': { value: range ? range[0] : '' }, '[data-run-end]': { value: range ? range[1] : '' } };
    drawer.querySelector = (sel) => fields[sel] || null;
    drawer.listeners['lex-change'][0]({ target: { closest: () => ({ value: preset }) } });
    drawer.listeners.click[0]({ target: { closest: (sel) => (sel === '[data-run-report]' ? {} : null) } });
    await settleAll();
    expect(drawer.open).toBe(false);
    expect(go).toHaveBeenCalledWith(href);
  });

  test.each([['a report that uses the period', 'module:case-workload'], ['a period-free report', 'module:document-count']])(
    'for %s the drawer footer holds the period dropdown and Run; the body has no run card', async (_label, id) => {
      const { nodes, drawer } = context({ script: 'js/admin/reports-list.js', initOut: false });
      await settleAll();
      nodes.reportsListTable.listeners.click[0]({ target: { closest: (sel) => (sel === '[data-report-about]' ? { getAttribute: () => id } : null) } });
      await settleAll();
      const footer = nodes.reportRunFooter.innerHTML;
      expect(footer).toContain('<lex-select data-run-period label="Period"');
      expect(footer).toContain('&quot;label&quot;:&quot;Today and yesterday&quot;');
      expect(footer).toContain('<lex-btn data-run-report variant="primary">Run report</lex-btn>');
      expect(drawer.contentRoot.innerHTML).not.toMatch(/Run this report|data-run-/);
    });

  test('a custom range with no dates stays in the drawer and says why', async () => {
    const { nodes, drawer, go } = context({ script: 'js/admin/reports-list.js', initOut: false });
    await settleAll();
    nodes.reportsListTable.listeners.click[0]({ target: { closest: () => ({ getAttribute: () => 'module:case-workload' }) } });
    await settleAll();
    const problem = node('problem');
    drawer.querySelector = (sel) => (sel === '[data-run-problem]' ? problem : { value: '' });
    drawer.listeners['lex-change'][0]({ target: { closest: () => ({ value: 'custom' }) } });
    drawer.listeners.click[0]({ target: { closest: (sel) => (sel === '[data-run-report]' ? {} : null) } });
    await settleAll();
    expect(go).not.toHaveBeenCalled();
    expect(problem.textContent).toBe('Pick a start date and an end date.');
  });
});

describe('the detail page', () => {
  test('loads its report from the URL and auto-runs for the period given', async () => {
    const { nodes, post, LanaTime } = context({ script: 'js/admin/report.js', query: 'report=case-workload&period=lastWeek', initOut: false });
    await settleAll();
    expect(nodes.selectedReportName.textContent).toBe('Case Workload');
    const days = LanaTime.reportPresetDays('lastWeek', 'UTC');
    expect(post).toHaveBeenCalledWith('/api/v1/modules/case-workload/execute', expect.objectContaining({ periodStart: days.start, periodEnd: days.end }));
  });

  test('a custom range in the URL runs for those days', async () => {
    const { post } = context({ script: 'js/admin/report.js', query: 'report=document-count&start=2026-11-01&end=2026-11-10', initOut: false });
    await settleAll();
    expect(post).toHaveBeenCalledWith('/api/v1/modules/document-count/execute', expect.objectContaining({ periodStart: '2026-11-01', periodEnd: '2026-11-10' }));
  });

  test('a saved report runs through its own endpoint', async () => {
    const { nodes, post } = context({ script: 'js/admin/report.js', query: 'saved=r1&period=today', initOut: false });
    await settleAll();
    expect(nodes.selectedReportName.textContent).toBe('Our report');
    expect(post.mock.calls[0][0]).toBe('/api/v1/reporting/reports/r1/execute');
  });

  test('with no period it opens with the date form and waits for Run Report', async () => {
    const { nodes, post, LanaTime } = context({ script: 'js/admin/report.js', query: 'report=case-workload', initOut: false });
    await settleAll();
    expect(nodes.selectedReportName.textContent).toBe('Case Workload');
    expect(post).not.toHaveBeenCalled();
    expect(nodes.periodStart.value).toBe(LanaTime.reportPresetDays('last7days', 'UTC').start);
  });

  test('a period-free report keeps the full date form', async () => {
    const { nodes, LanaTime } = context({ script: 'js/admin/report.js', query: 'report=document-count', initOut: false });
    await settleAll();
    expect(nodes.selectedReportName.textContent).toBe('Document Count');
    ['periodPresets', 'periodStart', 'periodEnd', 'periodType', 'executeBtn'].forEach(id => expect([id, nodes[id] ? nodes[id].hidden : false]).toEqual([id, false]));
    expect(nodes.periodStart.value).toBe(LanaTime.reportPresetDays('last7days', 'UTC').start);
  });

  test('a period that is not one of ours is ignored', async () => {
    const { post } = context({ script: 'js/admin/report.js', query: 'report=case-workload&period=<x>', initOut: false });
    await settleAll();
    expect(post).not.toHaveBeenCalled();
  });

  test('All reports and the shell Back go to the list page; Customize stays hidden', async () => {
    const { nodes, go, docListeners } = context({ script: 'js/admin/report.js', query: 'report=case-workload', initOut: false, hiddenIds: ['customizeBtn'] });
    await settleAll();
    nodes.backToReportsBtn.listeners.click[0]();
    expect(go).toHaveBeenLastCalledWith('admin/reports-list.html');
    const back = docListeners['topbar-back-click'].find(l => l.capture);
    const event = { preventDefault: jest.fn(), stopPropagation() {}, stopImmediatePropagation() {} };
    back.fn(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(go).toHaveBeenCalledTimes(2);
    expect(go).toHaveBeenLastCalledWith('admin/reports-list.html');
    expect(nodes.customizeBtn.hidden).toBe(true);
  });
});

describe('page files and entry points', () => {
  const pages = read('js/lex/lex-router.pages.js');

  test.each([
    ['admin/reports-list.html', 'js/admin/reports-list.js', 'css/admin/reports-list.css'],
    ['admin/report.html', 'js/admin/report.js', 'css/admin/report.css']
  ])('%s has its own script and stylesheet, routed in the shell', (page, script, css) => {
    const html = read(page);
    expect(html).toContain('<script src="../' + script + '"></script>');
    expect(html).toContain('<link rel="stylesheet" href="../' + css + '">');
    expect(html).toContain('<script src="../js/admin/reports-list.model.js"></script>');
    const entry = pages.slice(pages.indexOf("'" + page + "': {"), pages.indexOf('}', pages.indexOf("stylesheets", pages.indexOf("'" + page + "': {"))));
    expect(entry).toMatch(/activeNav: 'insights-reports'/);
    expect(entry).toContain("'js/admin/reports-list.model.js'");
    expect(entry).toContain("'" + script + "'");
    expect(entry).toContain("'" + css + "'");
    expect(read(script)).toContain("LexRouter.registerPageInit('" + page + "', init)");
  });

  test('the old page and its files are gone; nothing links to it except the redirects', () => {
    ['admin/reporting.html', 'js/admin/reporting.js', 'css/admin/reporting.css'].forEach(rel => expect(fs.existsSync(path.join(SRC, rel))).toBe(false));
    expect(pages).not.toContain("'admin/reporting.html'");
    expect(read('js/lex/components/layout/lex-app.js')).toContain("{ id: 'insights-reports', label: 'Reports', icon: 'bar-chart-2', href: 'admin/reports-list.html' }");
    ['js/lex/components/layout/lex-app.js', 'js/lex/components/layout/lex-sidebar.js', 'admin/analytics.html', 'js/admin/dashboard-detail.js',
      'integrations/leadly.html', 'lex-intent.html', 'lex-test.html']
      .forEach(rel => expect([rel, /reporting\.html/.test(read(rel))]).toEqual([rel, false]));
  });

  test('the list page holds the drawer and import; the detail page holds the date form and results', () => {
    const list = read('admin/reports-list.html');
    const detail = read('admin/report.html');
    ['id="reportsListTable"', 'id="reportAboutDrawer"', 'id="reportRunFooter"', 'id="importReportBtn"', 'id="importReportModal"']
      .forEach(id => { expect(list).toContain(id); expect(detail).not.toContain(id); });
    ['id="periodPresets"', 'id="periodStart"', 'id="executeBtn"', 'id="moduleResults"', 'id="drilldownModal"', 'id="customizePanel"']
      .forEach(id => { expect(detail).toContain(id); expect(list).not.toContain(id); });
  });

  test('Customize is hidden on the detail page, and its code stays', () => {
    const detail = read('admin/report.html');
    expect(detail).toMatch(/<lex-btn id="customizeBtn"[^>]*\shidden[\s>]/);
    expect(read('css/admin/report.css')).toMatch(/#customizeBtn\[hidden\]\s*\{\s*display:\s*none;/);
    expect(read('js/admin/report.js')).toContain('initCustomizePanel()');
  });

  test('the in-page view API is gone', () => {
    const nav = read('js/lex/lex-nav.js');
    ['pushView', 'getView', 'onViewChange', 'closeView'].forEach(name => expect(nav).not.toContain(name));
    expect(read('js/lex/lex-router.js')).not.toContain('entry.view');
  });
});

// The router runs a page's init a second time on a first visit (the page's
// own call, then the registered one). Buttons bind once per element, so one
// click sends one request.
describe('init twice binds each button once', () => {
  const clicks = (n) => (n.listeners.click || []).length;

  test('the list page: Import, New report, the drop zone, clear and submit', async () => {
    const { nodes, exports } = context({ script: 'js/admin/reports-list.js', initOut: false });
    exports.init();
    await settleAll();
    ['importReportBtn', 'newReportBtn', 'importDropZone', 'importFileClear', 'importSubmitBtn']
      .forEach(id => expect([id, clicks(nodes[id])]).toEqual([id, 1]));
    expect(nodes.importFileInput.listeners.change).toHaveLength(1);
  });

  test('the report page: Run Report, the presets, data sources, missing entities and the customize panel', async () => {
    const { nodes, exports } = context({ script: 'js/admin/report.js', query: 'report=case-workload', initOut: false });
    exports.init();
    await settleAll();
    ['executeBtn', 'periodPresets', 'dataSourcesBtn', 'missingEntitiesBtn', 'customizeBtn', 'saveCustomizationBtn', 'addMetricBtn']
      .forEach(id => expect([id, clicks(nodes[id])]).toEqual([id, 1]));
    expect(nodes.periodStart.listeners['lex-change']).toHaveLength(1);
  });
});

describe('links and URLs', () => {
  // Reports the backend hides from the list (LANA-AI index.json or their own
  // status); a link to one would open "not found".
  const HIDDEN = ['service-delivery-operations', 'client-satisfaction', 'matter-efficiency', 'matter-activity-completeness',
    'contact-coverage-analysis', 'data-quality-analysis', 'marketing-attribution-analysis'];

  function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'vendor' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.(html|js)$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  test('no in-app link opens a hidden report', () => {
    const hits = [];
    walk(SRC).forEach((file) => {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/report(?:ing)?\.html\?(?:[^"'\s]*&)?(?:report|module)=([a-z0-9-]+)/g)) {
        if (HIDDEN.includes(m[1])) hits.push(path.relative(SRC, file) + ': ' + m[1]);
      }
    });
    expect(hits).toEqual([]);
  });

  test('a report page URL with a date that is not on the calendar runs no custom range', () => {
    const { window } = context({ script: 'js/admin/report.js', query: 'report=case-workload', initOut: false });
    const ask = (q) => window.ReportsList.reportRequest(new URLSearchParams(q)).period;
    expect(ask('report=a&start=2026-02-31&end=2026-03-02')).toBeNull();
    expect(ask('report=a&start=2026-02-01&end=2026-13-01')).toBeNull();
    expect(ask('report=a&start=2026-02-01&end=2026-02-28')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(ask('report=a&start=2028-02-29&end=2028-02-29')).toEqual({ start: '2028-02-29', end: '2028-02-29' });
  });
});

describe('page hygiene and references', () => {
  test('neither page has a style block or a doubled attribute', () => {
    ['admin/report.html', 'admin/reports-list.html'].forEach((rel) => {
      const html = read(rel);
      expect([rel, /<style[\s>]/.test(html)]).toEqual([rel, false]);
      expect([rel, /\s(hidden|disabled)\s+\1[\s>]/.test(html)]).toEqual([rel, false]);
    });
  });

  test('docs and comments name the current Reports files', () => {
    const ROOT = path.join(__dirname, '../..');
    const files = fs.readdirSync(path.join(ROOT, 'docs/reporting')).filter(f => f.endsWith('.md')).map(f => 'docs/reporting/' + f)
      .concat(fs.readdirSync(path.join(ROOT, 'docs/reporting/tutorials')).map(f => 'docs/reporting/tutorials/' + f))
      .concat(['src/js/admin/report-metric-card.js', 'src/js/shared/metric-card-preview.js', 'src/js/admin/metric-catalog.js',
        'src/js/admin/workspace-analytics.js', 'tests/unit/reporting-attribution-escape.test.js', 'tests/unit/reporting-page.render.test.js']);
    const stale = files.filter(rel => /(^|[^-\w])reporting\.(html|js|css)\b/.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')));
    expect(stale).toEqual([]);
  });
});

