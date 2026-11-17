'use strict';

/**
 * The Reports page opens on a list of reports. Each entry comes from what
 * the backend declares (purpose, audience, last run); the page names no
 * report itself. Reports are listed once per key, and saved copies are
 * marked so a saved "Document Count" is never mistaken for the report.
 */

const fs = require('fs');
const path = require('path');

const win = {};
new Function('window', fs.readFileSync(path.join(__dirname, '../../src/js/admin/reports-list.js'), 'utf8'))(win);
const { buildReportEntries } = win.ReportsList;

const modules = [
  { moduleKey: 'document-count', name: 'Document Count', purpose: 'See how many documents you have.', audience: ['Everyone'], lastRunAt: '2026-11-15T14:00:00.000Z', category: 'documents' },
  { moduleKey: 'matter-aging-analysis', name: 'Matter Aging Analysis', purpose: 'Find matters that have gone too long without contact.', audience: ['Managers', 'Attorneys'], lastRunAt: null, category: 'aging' },
  { moduleKey: 'document-count', name: 'Document Count', purpose: 'dup', audience: [], lastRunAt: null },
];
const saved = [{ report_id: 'r1', name: 'Document Count', description: 'Imported from the old reports.', last_run_at: '2026-10-01T10:00:00.000Z', is_template: false }];

test('one entry per report key, then saved copies, each from declared fields', () => {
  const entries = buildReportEntries(modules, saved);
  expect(entries.map(e => e.id)).toEqual(['module:document-count', 'module:matter-aging-analysis', 'saved:r1']);
  expect(entries[0]).toMatchObject({ kind: 'report', key: 'document-count', name: 'Document Count',
    purpose: 'See how many documents you have.', audience: 'Everyone', last_run_at: '2026-11-15T14:00:00.000Z' });
  expect(entries[1]).toMatchObject({ audience: 'Managers, Attorneys', last_run_at: null });
});

test('a saved report is marked as a saved copy and keeps its own last run', () => {
  const entry = buildReportEntries(modules, saved)[2];
  expect(entry).toMatchObject({ kind: 'saved', key: 'r1', name: 'Document Count', saved: true,
    purpose: 'Imported from the old reports.', last_run_at: '2026-10-01T10:00:00.000Z' });
});

test('a report with no declared purpose shows none rather than a guess', () => {
  const [entry] = buildReportEntries([{ moduleKey: 'x', name: 'X' }], []);
  expect(entry.purpose).toBe('');
  expect(entry.audience).toBe('');
});

test('the list page names no report key', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../src/js/admin/reports-list.js'), 'utf8')
    + fs.readFileSync(path.join(__dirname, '../../src/js/admin/reporting.js'), 'utf8');
  modules.forEach(m => expect(page).not.toContain("'" + m.moduleKey + "'"));
});

describe('the Reports page opens on the list', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../src/admin/reporting.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../../src/js/admin/reporting.js'), 'utf8');

  test('the list comes before the controls, which start hidden', () => {
    expect(html.indexOf('id="reportsListSection"')).toBeGreaterThan(-1);
    expect(html.indexOf('id="reportsListSection"')).toBeLessThan(html.indexOf('id="reportingLayout"'));
    expect(html).toMatch(/id="reportingLayout" class="reporting-layout" hidden/);
    expect(html).toContain('columns="name,purpose,audience,last_run_at"');
    expect(html).not.toContain('reportModuleSelect');
  });

  test('no report is picked until someone picks one (or a link names it)', () => {
    expect(js).not.toMatch(/Auto-select first available module/);
    expect(js).toMatch(/get\('report'\)/);
  });
});

test('a seeded template that references a module is listed once, as that module; a firm report stays reachable', () => {
  const entries = buildReportEntries(modules, [
    { report_id: 'r2', name: 'Document Count', module_key: 'document-count', is_template: true, last_run_at: null },
    { report_id: 'r4', name: 'Our Docs', module_key: 'document-count', is_template: false, last_run_at: null },
    { report_id: 'r3', name: 'Custom Thing', module_key: null, last_run_at: null }]);
  expect(entries.map(e => e.id)).toEqual(['module:document-count', 'module:matter-aging-analysis', 'saved:r4', 'saved:r3']);
});
