'use strict';

/**
 * Runs the real Reports page script and checks the rows it exports to CSV
 * and PDF: a real 0 prints 0, only a missing value prints the empty token.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withReportSharedScripts } = require('./helpers/report-shared-scripts');

function page() {
  let source = fs.readFileSync(path.join(__dirname, '../../src/js/admin/report.js'), 'utf8');
  const end = source.lastIndexOf('  init();');
  source = source.slice(0, end) + '  window.testExports = { buildExportRows };' + source.slice(end + '  init();'.length);
  const window = withReportSharedScripts({ addEventListener() {} });
  window.ReportingGoalComparisonMapper = require('../../src/js/shared/reporting-goal-comparison-mapper.js');
  const document = { addEventListener() {}, getElementById: () => null, createElement: () => ({}) };
  vm.runInNewContext(source, { window, document, console, Intl, URLSearchParams, setTimeout: jest.fn(), clearTimeout: jest.fn() });
  return { exports: window.testExports, EMPTY: window.DataState.EMPTY_VALUE };
}

test('a real 0 prior, target and change % export as 0, not the empty token', () => {
  const { exports } = page();
  const rows = exports.buildExportRows([{ name: 'Count', current: 0, prior: 0, target: 0, changePercent: 0, status: 'ok' }], true);
  expect(rows[0]).toEqual(['Count', 0, 0, 0, page().EMPTY, '0%', 'OK']);
});

test('missing values export as the empty token', () => {
  const { exports, EMPTY } = page();
  const rows = exports.buildExportRows([{ name: 'Count', current: null, prior: null, target: undefined, changePercent: null }], true);
  expect(rows[0]).toEqual(['Count', EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY]);
});

test('formatted values win, and the PDF rows leave out change %', () => {
  const { exports } = page();
  const rows = exports.buildExportRows([{ name: 'Fees', current: 5, formattedCurrent: '$5.00', prior: 0, formattedPrior: '$0.00',
    target: 10, formattedTarget: '$10.00', formattedChange: '+$5.00', changePercent: 12.5, status: 'green' }], false);
  expect(rows[0]).toEqual(['Fees', '$5.00', '$0.00', '$10.00', '+$5.00', 'GREEN']);
});
