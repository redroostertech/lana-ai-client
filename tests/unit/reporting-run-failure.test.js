'use strict';

/**
 * Runs the real Reports page script. A 400 invalid_request whose body
 * carries a data state in error.details shows the shared DataState block,
 * not the raw error message, for modules and saved reports.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withReportSharedScripts } = require('./helpers/report-shared-scripts');

function node() {
  return { value: '', hidden: false, innerHTML: '', textContent: '', style: {}, loading: false, querySelectorAll: () => [] };
}

function page(post) {
  let source = fs.readFileSync(path.join(__dirname, '../../src/js/admin/report.js'), 'utf8');
  const end = source.lastIndexOf('  init();');
  source = source.slice(0, end)
    + '  window.testExports = { executeModule, setModule: function (k) { selectedModuleKey = k; selectedImportedReportId = null; },'
    + ' setReport: function (id) { selectedImportedReportId = id; } };'
    + source.slice(end + '  init();'.length);
  const window = withReportSharedScripts({ addEventListener() {} });
  window.ReportingGoalComparisonMapper = require('../../src/js/shared/reporting-goal-comparison-mapper.js');
  const nodes = {};
  const document = { addEventListener() {}, getElementById: (id) => (nodes[id] = nodes[id] || node()), createElement: () => node() };
  nodes.periodStart = Object.assign(node(), { value: '2026-11-01' });
  nodes.periodEnd = Object.assign(node(), { value: '2026-11-15' });
  const timeWin = { Date };
  new Function('window', fs.readFileSync(path.join(__dirname, '../../src/js/time-utils.js'), 'utf8'))(timeWin);
  vm.runInNewContext(source, { window, document, console: { log() {}, error() {}, warn() {} }, Intl, URLSearchParams,
    setTimeout: jest.fn(), clearTimeout: jest.fn(), LanaTime: timeWin.LanaTime, api: { post } });
  return { exports: window.testExports, nodes };
}

function invalidRequest() {
  const error = new Error('Request failed with status 400');
  error.status = 400;
  error.data = { success: false, error: { code: 'INVALID_REQUEST', message: 'Validation failed',
    details: { data_state: 'invalid_request', data_state_reason: 'Pick an end date after the start date.' } } };
  return error;
}

test('a module run that fails with a data state shows the state block', async () => {
  const p = page(jest.fn().mockRejectedValue(invalidRequest()));
  p.exports.setModule('some-module');
  await p.exports.executeModule();
  expect(p.nodes.executionState.innerHTML).toContain('lex-data-state--invalid-request');
  expect(p.nodes.executionState.innerHTML).toContain('Pick an end date after the start date.');
  expect(p.nodes.executionState.hidden).toBe(false);
  expect(String((p.nodes.executionErrorText || {}).textContent || '')).not.toContain('status 400');
});

test('a saved report run that fails with a data state shows the state block', async () => {
  const p = page(jest.fn().mockRejectedValue(invalidRequest()));
  p.exports.setReport('r1');
  await p.exports.executeModule();
  expect(p.nodes.executionState.innerHTML).toContain('Pick an end date after the start date.');
  expect(String((p.nodes.executionErrorText || {}).textContent || '')).not.toContain('status 400');
});

test('a failure with no data state still shows the error message', async () => {
  const p = page(jest.fn().mockRejectedValue(new Error('Network error occurred')));
  p.exports.setModule('some-module');
  await p.exports.executeModule();
  expect(p.nodes.executionErrorText.textContent).toBe('Network error occurred');
  expect(p.nodes.executionState.hidden).toBe(true);
});
