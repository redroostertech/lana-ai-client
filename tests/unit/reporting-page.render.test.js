'use strict';

/**
 * Runs the real Reports page script (reporting.js, init() removed) after its
 * shared scripts, and renders its tiles and helpers.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withReportSharedScripts } = require('./helpers/report-shared-scripts');

function page() {
  let source = fs.readFileSync(path.join(__dirname, '../../src/js/admin/reporting.js'), 'utf8');
  const end = source.lastIndexOf('  init();');
  source = source.slice(0, end)
    + '  window.testExports = { formatCurrency, formatNumber, formatPercentage, renderMetricCardBody };'
    + source.slice(end + '  init();'.length);
  const window = withReportSharedScripts({ addEventListener() {} });
  window.ReportingGoalComparisonMapper = require('../../src/js/shared/reporting-goal-comparison-mapper.js');
  const document = { addEventListener() {}, getElementById: () => null, createElement: () => ({ textContent: '', innerHTML: '' }) };
  vm.runInNewContext(source, { window, document, console, Intl, URLSearchParams, setTimeout: jest.fn(), clearTimeout: jest.fn() });
  return { exports: window.testExports, window };
}

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('blank values use the shared empty token', () => {
  const { exports, window } = page();
  const EMPTY = window.DataState.EMPTY_VALUE;
  expect(exports.formatCurrency(null)).toBe(EMPTY);
  expect(exports.formatNumber(undefined)).toBe(EMPTY);
  expect(exports.formatPercentage(null)).toBe(EMPTY);
});

test('a tile with no current or prior value shows the empty token, never N/A', () => {
  const { exports, window } = page();
  const html = exports.renderMetricCardBody({ key: 'c', name: 'Count', type: 'count', current: null, prior: null, data_state: 'ok' });
  expect(text(html)).toContain('Current Period ' + window.DataState.EMPTY_VALUE);
  expect(text(html)).toContain('Prior Period ' + window.DataState.EMPTY_VALUE);
  expect(html).not.toContain('N/A');
});

describe('tile buttons run through one delegated listener', () => {
  function setup() {
    const ids = { periodStart: { value: '2026-11-10' }, periodEnd: { value: '2026-11-16' } };
    let source = fs.readFileSync(path.join(__dirname, '../../src/js/admin/reporting.js'), 'utf8');
    const end = source.lastIndexOf('  init();');
    source = source.slice(0, end) + '  selectedModuleKey = "m"; runPeriodDays = { periodStart: "2026-11-01", periodEnd: "2026-11-15" };  window.testExports = { renderMetricCardBody, onTileClick };' + source.slice(end + '  init();'.length);
    const window = withReportSharedScripts({ addEventListener() {}, location: { href: '' } });
    window.ReportingGoalComparisonMapper = require('../../src/js/shared/reporting-goal-comparison-mapper.js');
    const open = jest.fn().mockResolvedValue();
    const modalOpen = jest.fn(() => ({ querySelector: () => null }));
    window.Lex = { Modal: { open: modalOpen, alert: jest.fn() }, Auth: { isOrgAdmin: () => true },
      Nav: { go: jest.fn() } };
    const timeWin = { Date };
    new Function('window', fs.readFileSync(path.join(__dirname, '../../src/js/time-utils.js'), 'utf8'))(timeWin);
    const document = { addEventListener() {}, getElementById: (id) => ids[id] || null, createElement: () => ({}) };
    vm.runInNewContext(source, { window, document, console, Intl, URLSearchParams, setTimeout: jest.fn(), clearTimeout: jest.fn(),
      Lex: window.Lex, LanaTime: timeWin.LanaTime, DrilldownRenderer: function () { this.open = open; } });
    return { exports: window.testExports, open, modalOpen, Lex: window.Lex };
  }
  // A click on the element in the rendered tile that carries `attr`.
  function clickOn(html, attr) {
    const tag = html.match(new RegExp('<[a-z-]+[^>]*' + attr + '[^>]*>'))[0];
    const attrs = {};
    tag.replace(/([a-z-]+)="([^"]*)"/g, (m, k, v) => { attrs[k] = v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'); });
    const el = { getAttribute: (k) => (k in attrs ? attrs[k] : null) };
    return { target: { closest: (sel) => (sel === '[' + attr + ']' ? el : null) } };
  }
  const metric = { key: 'k1', name: 'Count', current: 3, data_state: 'ok', hasDrilldown: true };

  test('no tile button has an inline onclick', () => {
    const html = setup().exports.renderMetricCardBody(metric);
    expect(html).not.toMatch(/onclick/i);
  });

  test('Details opens the drilldown for that metric', () => {
    const s = setup();
    const html = s.exports.renderMetricCardBody(metric);
    s.exports.onTileClick(clickOn(html, 'data-metric-drilldown'));
    expect(s.open).toHaveBeenCalledWith(expect.anything(), 'k1', expect.any(Object));
  });

  test('the info button opens the metric info', () => {
    const s = setup();
    const html = s.exports.renderMetricCardBody(metric);
    s.exports.onTileClick(clickOn(html, 'data-metric-info'));
    expect(s.modalOpen).toHaveBeenCalledWith(expect.objectContaining({ heading: 'Count' }));
  });

  test('the edit goal button opens the goal editor', () => {
    const s = setup();
    const html = s.exports.renderMetricCardBody(metric);
    s.exports.onTileClick(clickOn(html, 'data-metric-edit-goal'));
    expect(s.Lex.Nav.go).toHaveBeenCalledWith(expect.stringContaining('editGoal=k1'));
  });
});
