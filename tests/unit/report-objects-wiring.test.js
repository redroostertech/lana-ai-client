'use strict';

/**
 * Every data object opens the record panel: worklist rows, breakdown rows
 * that carry refs, the metric detail records table and report drilldown
 * rows. The API method, the page scripts and the router entries are in
 * place.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const View = require(path.join(SRC, 'js/shared/metric-card-view.js'));
const Charts = require(path.join(SRC, 'js/shared/mini-charts.js'));
global.ReportObjects = require(path.join(SRC, 'js/shared/report-objects.js'));

test('api.getReportObject sends the object, id and the page dates', async () => {
  const context = { console, URLSearchParams, AbortController, FormData: class {}, setTimeout, clearTimeout, setInterval, clearInterval, fetch: jest.fn(),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, document: { addEventListener() {}, body: {}, getElementById: () => null },
    location: { protocol: 'http:', origin: 'http://client.test', pathname: '/app.html' }, LanaConfig: {},
    LanaTime: { nowMs: () => 1000, millisecondsSince: () => 0, MS_PER_MINUTE: 60000 } };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(read('js/api.js'), context);
  const api = context.window.api;
  api.get = jest.fn().mockResolvedValue({});
  await api.getReportObject('person', 'p 1', { start: '2026-11-01', end: '2026-11-30' });
  expect(api.get).toHaveBeenCalledWith('/api/v1/report-objects/person/p%201?periodStart=2026-11-01&periodEnd=2026-11-30');
  await api.getReportObject('deal', 'd-1');
  expect(api.get).toHaveBeenLastCalledWith('/api/v1/report-objects/deal/d-1');
});

test('breakdown rows that carry refs open the record, not the metric', () => {
  const model = View.listBars([{ attorney_name: 'Avery Stone', value: 4, refs: [{ object: 'person', id: 'p-1', user_id: 'u-9' }] }, { attorney_name: 'Blake Ross', value: 2 }], 12);
  expect(model.rows[0].ref).toEqual({ object: 'person', id: 'p-1', user_id: 'u-9' });
  expect(model.rows[1].ref).toBeUndefined();
  model.rows.forEach((row) => { row.key = 'metric.key'; });
  const html = Charts.breakdownHtml(model, String, { href: () => 'detail' });
  const avery = html.split('<g class="mini-cols__group').find((g) => g.includes('Avery'));
  expect(avery).toContain('data-record-ref="person|p-1|u-9"');
  expect(avery).toContain('tabindex="0"');
  expect(avery).not.toContain('data-metric-detail-link');
  expect(html.split('<g class="mini-cols__group').find((g) => g.includes('Blake'))).toContain('data-metric-detail-link="detail"');
});

test('the pages load the panel and the router entries match', () => {
  ['admin/dashboard-detail.html', 'admin/metric_detail.html', 'admin/report.html'].forEach((page) => {
    const html = read(page);
    ['lex-drawer.js', 'shared/report-objects.js', 'shared/data-fixes.js', 'shared/report-object-panel.js', 'report-object-panel.css'].forEach((s) => expect([page, html.includes(s)]).toEqual([page, true]));
  });
  const pages = read('js/lex/lex-router.pages.js');
  ['admin/dashboard-detail.html', 'admin/metric_detail.html', 'admin/report.html'].forEach((page) => {
    const start = pages.indexOf("'" + page + "': {");
    const entry = pages.slice(start, pages.indexOf('\n    },', start));
    ['js/lex/components/foundation/lex-drawer.js', 'js/shared/report-objects.js', 'js/shared/data-fixes.js', 'js/shared/report-object-panel.js', 'css/report-object-panel.css']
      .forEach((s) => expect([page, entry.includes("'" + s + "'")]).toEqual([page, true]));
  });
});

test('pages bind rows to the panel; metric detail and drilldown rows with refs open it', () => {
  expect(read('js/admin/dashboard-detail.js')).toContain('LanaRecordPanel.bindRows(');
  expect(read('js/admin/metric-detail.js')).toContain('LanaRecordPanel.open(');
  expect(read('js/drilldown-renderer.js')).toContain('LanaRecordPanel.open(');
});

test('pages wire fixes: worklists and the metric detail table bind DataFixes and refetch after a save', () => {
  expect(read('js/admin/dashboard-detail.js')).toContain('DataFixes.bind(content, { onSaved: onFixSaved })');
  expect(read('js/admin/metric-detail.js')).toContain('DataFixes.bind(table, { onSaved: onFixSaved })');
  expect(read('js/admin/metric-detail.js')).toContain('loadMetricDetail(); }, info.delayMs)');
});
