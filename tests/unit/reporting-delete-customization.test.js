'use strict';

/**
 * Deleting a saved customization asks first with the Lex confirm dialog
 * (danger variant). Cancel leaves it alone; confirm deletes it.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withReportSharedScripts } = require('./helpers/report-shared-scripts');

function page(confirmed) {
  let source = fs.readFileSync(path.join(__dirname, '../../src/js/admin/reporting.js'), 'utf8');
  const end = source.lastIndexOf('  init();');
  source = source.slice(0, end) + '  window.testExports = { deleteCustomization };' + source.slice(end + '  init();'.length);
  const window = withReportSharedScripts({ addEventListener() {} });
  window.ReportingGoalComparisonMapper = require('../../src/js/shared/reporting-goal-comparison-mapper.js');
  window.confirm = jest.fn(() => true);
  const document = { addEventListener() {}, getElementById: () => null, createElement: () => ({ innerHTML: '' }) };
  const api = { user: { organization_id: 'o1' }, delete: jest.fn().mockResolvedValue({}), get: jest.fn().mockResolvedValue({}) };
  const Lex = { Modal: { confirmAsync: jest.fn().mockResolvedValue(confirmed), alert: jest.fn() } };
  vm.runInNewContext(source, { window, document, console: { log() {}, error() {}, warn() {} }, Intl, URLSearchParams,
    setTimeout: jest.fn(), clearTimeout: jest.fn(), api, Lex });
  return { exports: window.testExports, api, Lex, window };
}

test('cancel does not delete', async () => {
  const p = page(false);
  await p.exports.deleteCustomization('c1');
  expect(p.Lex.Modal.confirmAsync).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ variant: 'danger' }));
  expect(p.api.delete).not.toHaveBeenCalled();
  expect(p.window.confirm).not.toHaveBeenCalled();
});

test('confirm deletes that customization', async () => {
  const p = page(true);
  await p.exports.deleteCustomization('c1');
  expect(p.Lex.Modal.confirmAsync).toHaveBeenCalledTimes(1);
  expect(p.api.delete).toHaveBeenCalledWith('/api/v1/module-customizations/c1');
});
