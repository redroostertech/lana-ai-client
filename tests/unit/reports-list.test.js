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

// "What it shows" is the report's one-line summary from the backend, cut to 25
// characters, then a "show more" button that opens the report's side panel.
// The panel text (what, what you see, how it is built, data used, goal, how to
// use, good to know) is server data, escaped here.
describe('report summary and side panel', () => {
  const { previewText, purposeCell, aboutHtml, runControlsHtml, customPeriodProblem, RUN_PRESETS, compareByFor } = win.ReportsList;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const long = 'See how cases are spread across your team and how many get done.';
  const row = { id: 'module:case-workload', kind: 'report', key: 'case-workload', name: 'Case Workload', purpose: long };

  test('a summary longer than 25 characters is cut to 25 with an ellipsis', () => {
    const shown = previewText(long);
    expect(Array.from(shown).length).toBeLessThanOrEqual(25);
    expect(shown.endsWith('\u2026')).toBe(true);
    expect(long.startsWith(shown.slice(0, -1))).toBe(true);
    expect(previewText('See how many documents.')).toBe('See how many documents.');
    expect(previewText('')).toBe('');
  });

  test('the cut counts characters as people see them, so an emoji is never split in half', () => {
    const emoji = '\u{1F4CA}'.repeat(60);
    const shown = previewText(emoji);
    expect(Array.from(shown)).toHaveLength(25);
    expect(shown.endsWith('\u{1F4CA}\u2026')).toBe(true);
    expect(previewText('\u{1F4CA}'.repeat(25))).toBe('\u{1F4CA}'.repeat(25));
    // A family emoji is one character people see, made of several code points.
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
    expect(previewText(family.repeat(30))).toBe(family.repeat(24) + '\u2026');
  });

  test('the summary is followed by a show more button that opens its panel, for keyboard and screen readers', () => {
    const html = purposeCell(row, esc);
    expect(html).toContain('<span aria-hidden="true">' + previewText(long) + '</span>');
    expect(html).toContain('<span class="reporting-list__sr">' + long + '</span>');
    expect(html).toContain('title="' + long + '"');
    expect(html).toMatch(/<button type="button" class="reporting-list__more" data-report-about="module:case-workload" aria-label="Show more about Case Workload" aria-haspopup="dialog">show more<\/button>$/);
    expect(html).not.toMatch(/\son[a-z]+=|style=/i);
  });

  test('server text is escaped', () => {
    const html = purposeCell({ id: 'module:k"><x', kind: 'report', key: 'k"><x', name: '<b>', purpose: '<img src=x onerror=alert(1)>' }, esc);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('data-report-about="module:k&quot;&gt;&lt;x"');
  });

  test('a saved report also offers show more (its panel can run it); no summary says so', () => {
    const saved = purposeCell({ id: 'saved:r1', kind: 'saved', key: 'r1', name: 'Mine', purpose: long }, esc);
    expect(saved).toContain('data-report-about="saved:r1"');
    expect(saved).toContain('title="' + long + '"');
    expect(purposeCell({ id: 'module:x', kind: 'report', key: 'x', name: 'X', purpose: '' }, esc)).toContain('No description');
  });

  const full = {
    what: 'What <it> is.', howBuilt: ['Reads data.', 'Counts it.'], goal: 'The goal.', howToUse: 'Run it.',
    whatYouSee: ['A bar chart.'], dataUsed: ['Tasks from your apps.'], goodToKnow: ['Only open tasks count.']
  };
  const icon = name => '<svg data-icon="' + name + '"></svg>';

  test('the panel shows each part as its own card with an icon and a heading, in reading order, escaped', () => {
    const html = aboutHtml(full, esc, icon);
    const headings = ['What it is', 'What you see', 'How it is put together', 'Data it uses', 'Goal', 'How to use it', 'Good to know'];
    const order = headings.map(h => html.indexOf('>' + h + '</h4>'));
    order.forEach(i => expect(i).toBeGreaterThan(-1));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html.match(/<section class="report-about__card"/g)).toHaveLength(7);
    expect(html.match(/<span class="report-about__icon" aria-hidden="true"><svg data-icon="[a-z0-9-]+"><\/svg><\/span>/g)).toHaveLength(7);
    expect(html).toContain('<p class="report-about__text">What &lt;it&gt; is.</p>');
    expect(html).toContain('<li>Reads data.</li><li>Counts it.</li>');
    expect(html).not.toMatch(/style=|\son[a-z]+=|[\u2013\u2014]/);
  });

  test('older about text without the new parts shows the four it has', () => {
    const html = aboutHtml({ what: 'W is.', howBuilt: 'B is.', goal: 'G is.', howToUse: 'U is.' }, esc, icon);
    expect(html.match(/<section class="report-about__card"/g)).toHaveLength(4);
    expect(html).not.toContain('Good to know');
  });

  test('a report without details says so instead of a blank panel', () => {
    expect(aboutHtml(null, esc, icon)).toContain('reporting-list__muted');
  });

  test('the run controls offer the quick periods in one Lex select and a custom range, no inline handlers', () => {
    expect(RUN_PRESETS.map(p => p.label)).toEqual(['Today', 'Today and yesterday', 'Yesterday', 'This week', 'Last week', 'Last month', 'Custom']);
    expect(RUN_PRESETS.map(p => p.key)).toContain('todayAndYesterday');
    const html = runControlsHtml('thisWeek', esc, icon);
    const select = html.match(/<lex-select data-run-period label="Period" name="runPeriod" value="thisWeek" options="([^"]*)"><\/lex-select>/);
    expect(select).not.toBeNull();
    const options = JSON.parse(select[1].replace(/&quot;/g, '"'));
    expect(options).toEqual(RUN_PRESETS.map(p => ({ value: p.key, label: p.label })));
    expect(html).toMatch(/<div class="report-run__custom" data-run-custom hidden>/);
    expect(html).toContain('<lex-input data-run-start type="date" label="Start date"');
    expect(html).toContain('<lex-input data-run-end type="date" label="End date"');
    expect(html).toMatch(/<lex-btn data-run-report variant="primary">Run report<\/lex-btn>/);
    expect(runControlsHtml('custom', esc, icon)).toMatch(/<div class="report-run__custom" data-run-custom>/);
    expect(html).not.toMatch(/style=|\son[a-z]+=/i);
  });

  test('a report that ignores the period gets just a Run button, no period choices', () => {
    const html = runControlsHtml('thisWeek', esc, icon, false);
    expect(html).not.toContain('<lex-select');
    expect(html).not.toContain('data-run-custom');
    expect(html).toMatch(/<lex-btn data-run-report variant="primary">Run<\/lex-btn>/);
    expect(runControlsHtml('thisWeek', esc, icon, true)).toContain('<lex-select data-run-period');
  });

  test('one or two days compare by day; a year compares by month; otherwise the choice stays', () => {
    const all = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];
    expect(compareByFor(1, 'today', 'monthly')).toEqual({ options: all, value: 'daily' });
    expect(compareByFor(1, 'yesterday', 'weekly')).toEqual({ options: all, value: 'daily' });
    expect(compareByFor(2, 'todayAndYesterday', 'monthly')).toEqual({ options: all, value: 'daily' });
    expect(compareByFor(2, null, 'monthly')).toEqual({ options: all, value: 'daily' });
    expect(compareByFor(365, 'lastYear', 'weekly')).toEqual({ options: ['monthly'], value: 'monthly' });
    expect(compareByFor(7, 'last7days', 'weekly')).toEqual({ options: all, value: 'weekly' });
    expect(compareByFor(30, 'last30days', 'bogus')).toEqual({ options: all, value: 'monthly' });
  });

  test('list entries carry whether the period changes the report; saved reports assume it does', () => {
    const entries = buildReportEntries([{ moduleKey: 'a', name: 'A', usesPeriod: false }, { moduleKey: 'b', name: 'B' }], [{ report_id: 'r', name: 'R' }]);
    expect(entries.map(e => e.usesPeriod)).toEqual([false, true, true]);
  });

  test('a custom range needs both days, start first', () => {
    expect(customPeriodProblem('', '2026-11-02')).toBe('Pick a start date and an end date.');
    expect(customPeriodProblem('2026-11-03', '2026-11-02')).toBe('The start date must be on or before the end date.');
    expect(customPeriodProblem('2026-11-02', '2026-11-02')).toBeNull();
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

  test('the drawer has its own stylesheet, on the page and in the shell route', () => {
    const drawerCss = fs.readFileSync(path.join(__dirname, '../../src/css/admin/report-about.css'), 'utf8');
    expect(html).toContain('<link rel="stylesheet" href="../css/admin/report-about.css">');
    expect(fs.readFileSync(path.join(__dirname, '../../src/js/lex/lex-router.pages.js'), 'utf8')).toContain("'css/admin/report-about.css'");
    expect(drawerCss).toMatch(/\.report-about__card\s*\{[^}]*var\(--lex-bg-card\)/);
    expect(drawerCss).toMatch(/::marker\s*\{[^}]*var\(--lex-/);
    expect(drawerCss).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });

  test('a report that ignores the period hides the page period controls', () => {
    expect(html.match(/data-period-control/g)).toHaveLength(2);
    expect(css).toMatch(/\[data-period-control\]\[hidden\]\s*\{\s*display:\s*none;/);
    const open = js.slice(js.indexOf('function openReport(entry, opts)'), js.indexOf('function showReportsList'));
    expect(open).toMatch(/querySelectorAll\('\[data-period-control\]'\)/);
    expect(open).toContain('entry.usesPeriod === false');
    expect(js).toMatch(/ReportsList\.runControlsHtml\(drawerPreset, escapeHtml, drawerIcon, entry\.usesPeriod !== false\)/);
    expect(js).toContain('ReportsList.compareByFor(');
  });

  test('Run in the drawer reuses the page period and run code, then opens the report as an in-page view', () => {
    const run = js.slice(js.indexOf('async function runFromDrawer'), js.indexOf('async function runFromDrawer') + 1600);
    expect(run).toContain('ReportsList.customPeriodProblem(');
    expect(run).toContain('drawer.open = false');
    expect(run).toContain('openReport(entry)');
    expect(run).toContain('await selectPeriodPreset(');
    expect(run).toContain('applyPeriodDays(');
    expect(run).toContain('executeModule()');
    expect(run).not.toMatch(/new Date\(|setDate\(|getDay\(/);
  });
});
