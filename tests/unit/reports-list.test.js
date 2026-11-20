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

// "What it shows" is the report's one-line summary from the backend, cut to 50
// characters, and a button that opens the report's side panel. The panel text
// (what, how it is built, goal, how to use) is server data, escaped here.
describe('report summary and side panel', () => {
  const { previewText, purposeCell, aboutHtml } = win.ReportsList;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const long = 'See how cases are spread across your team and how many get done.';

  test('a summary longer than 50 characters is cut to 50 with an ellipsis', () => {
    const shown = previewText(long);
    expect(Array.from(shown).length).toBeLessThanOrEqual(50);
    expect(shown.endsWith('…')).toBe(true);
    expect(long.startsWith(shown.slice(0, -1))).toBe(true);
    expect(previewText('See how many documents you have.')).toBe('See how many documents you have.');
    expect(previewText('')).toBe('');
  });

  test('the cut counts characters as people see them, so an emoji is never split in half', () => {
    const emoji = '\u{1F4CA}'.repeat(60);
    const shown = previewText(emoji);
    expect(Array.from(shown)).toHaveLength(50);
    expect(shown.endsWith('\u{1F4CA}\u2026')).toBe(true);
    expect(previewText('\u{1F4CA}'.repeat(50))).toBe('\u{1F4CA}'.repeat(50));
  });

  test('a report summary is a button that opens its panel, keeping the full text for hover and screen readers', () => {
    const html = purposeCell({ kind: 'report', key: 'case-workload', name: 'Case Workload', purpose: long }, esc);
    expect(html).toMatch(/^<button type="button" class="reporting-list__about"/);
    expect(html).toContain('data-report-about="case-workload"');
    expect(html).toContain('title="' + long + '"');
    expect(html).toContain('aria-label="About Case Workload: ' + long + '"');
    expect(html).toContain('>' + previewText(long) + '</button>');
    expect(html).not.toMatch(/\son[a-z]+=|style=/i);
  });

  test('server text is escaped', () => {
    const html = purposeCell({ kind: 'report', key: 'k"><x', name: '<b>', purpose: '<img src=x onerror=alert(1)>' }, esc);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('data-report-about="k&quot;&gt;&lt;x"');
  });

  test('a saved report keeps a plain summary; none says so', () => {
    const saved = purposeCell({ kind: 'saved', key: 'r1', name: 'Mine', purpose: long }, esc);
    expect(saved).not.toContain('<button');
    expect(saved).toContain('title="' + long + '"');
    expect(purposeCell({ kind: 'report', key: 'x', name: 'X', purpose: '' }, esc)).toContain('No description');
  });

  test('the panel shows the four parts in order, as paragraphs or lists, escaped', () => {
    const html = aboutHtml({ what: 'What <it> is.', howBuilt: ['Reads data.', 'Counts it.'], goal: 'The goal.', howToUse: 'Run it.' }, esc);
    const order = ['What it is', 'How it is put together', 'Goal', 'How to use it'].map(h => html.indexOf('>' + h + '<'));
    order.forEach(i => expect(i).toBeGreaterThan(-1));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain('<p class="reporting-about__text">What &lt;it&gt; is.</p>');
    expect(html).toContain('<li>Reads data.</li><li>Counts it.</li>');
    expect(html).not.toMatch(/style=|[–—]/);
  });

  test('a report without details says so instead of a blank panel', () => {
    expect(aboutHtml(null, esc)).toContain('reporting-list__muted');
  });
});

describe('the Reports page wiring', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../src/admin/reporting.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../../src/js/admin/reporting.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../../src/css/admin/reporting.css'), 'utf8');

  test('New report is hidden for now, but its feature code stays', () => {
    expect(html).toMatch(/<lex-btn id="newReportBtn"[^>]*\shidden[\s>]/);
    expect(css).toMatch(/#newReportBtn\[hidden\]\s*\{\s*display:\s*none;/);
    expect(js).toContain("newReportBtn.addEventListener('click', openNewReport)");
  });

  test('the summary button opens a Lex drawer filled from the report detail endpoint', () => {
    expect(html).toMatch(/<lex-drawer id="reportAboutDrawer"[^>]*side="right"/);
    expect(js).toContain('ReportsList.purposeCell');
    expect(js).toMatch(/closest\('\[data-report-about\]'\)/);
    expect(js).toMatch(/api\.get\('\/api\/v1\/modules\/' \+ encodeURIComponent\(/);
    expect(js).toContain('ReportsList.aboutHtml');
  });
});
