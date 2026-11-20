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
new Function('window', fs.readFileSync(path.join(__dirname, '../../src/js/admin/reports-list.model.js'), 'utf8'))(win);
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

test('the Reports pages name no report key', () => {
  const page = ['reports-list.js', 'reports-list.model.js', 'report.js']
    .map(file => fs.readFileSync(path.join(__dirname, '../../src/js/admin', file), 'utf8')).join('\n');
  modules.forEach(m => expect(page).not.toContain("'" + m.moduleKey + "'"));
});

describe('Reports opens on the list page; one report is its own page', () => {
  const list = fs.readFileSync(path.join(__dirname, '../../src/admin/reports-list.html'), 'utf8');
  const detail = fs.readFileSync(path.join(__dirname, '../../src/admin/report.html'), 'utf8');
  const model = fs.readFileSync(path.join(__dirname, '../../src/js/admin/reports-list.model.js'), 'utf8');

  test('the list page has the list; the report page has the controls, shown', () => {
    expect(list).toContain('id="reportsListSection"');
    expect(list).toContain('columns="name,purpose,audience,last_run_at"');
    expect(detail).not.toContain('id="reportsListSection"');
    expect(detail).toMatch(/id="reportingLayout" class="reporting-layout">/);
    expect(list + detail).not.toContain('reportModuleSelect');
  });

  test('no report is picked until someone picks one (or a link names it)', () => {
    const js = fs.readFileSync(path.join(__dirname, '../../src/js/admin/report.js'), 'utf8');
    expect(js).not.toMatch(/Auto-select first available module/);
    expect(model).toMatch(/params\.get\('report'\)/);
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
  const { previewText, purposeCell, aboutHtml, runFooterHtml, customPeriodProblem, RUN_PRESETS, compareByFor } = win.ReportsList;
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

  test('the drawer footer holds the period dropdown and Run, with the custom dates above them; no card', () => {
    expect(RUN_PRESETS.map(p => p.label)).toEqual(['Today', 'Today and yesterday', 'Yesterday', 'This week', 'Last week', 'Last month', 'Custom']);
    const html = runFooterHtml('thisWeek', esc);
    const select = html.match(/<lex-select data-run-period label="Period" name="runPeriod" value="thisWeek" options="([^"]*)"><\/lex-select>/);
    expect(select).not.toBeNull();
    expect(JSON.parse(select[1].replace(/&quot;/g, '"'))).toEqual(RUN_PRESETS.map(p => ({ value: p.key, label: p.label })));
    expect(html).toMatch(/<div class="report-run__row">\s*<lex-select data-run-period[\s\S]*<lex-btn data-run-report variant="primary">Run report<\/lex-btn><\/div>$/);
    expect(html.indexOf('data-run-custom')).toBeLessThan(html.indexOf('report-run__row'));
    expect(html).toMatch(/<div class="report-run__custom" data-run-custom hidden>/);
    expect(html).toContain('<lex-input data-run-start type="date" label="Start date"');
    expect(html).toContain('<lex-input data-run-end type="date" label="End date"');
    expect(runFooterHtml('custom', esc)).toMatch(/<div class="report-run__custom" data-run-custom>/);
    expect(html).not.toMatch(/report-about__card|Run this report|style=|\son[a-z]+=/i);
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

  test('a custom range needs both days, start first', () => {
    expect(customPeriodProblem('', '2026-11-02')).toBe('Pick a start date and an end date.');
    expect(customPeriodProblem('2026-11-03', '2026-11-02')).toBe('The start date must be on or before the end date.');
    expect(customPeriodProblem('2026-11-02', '2026-11-02')).toBeNull();
  });
});

describe('the Reports pages wiring', () => {
  const read = rel => fs.readFileSync(path.join(__dirname, '../../src', rel), 'utf8');
  const listHtml = read('admin/reports-list.html');
  const listJs = read('js/admin/reports-list.js');
  const listCss = read('css/admin/reports-list.css');
  const html = read('admin/report.html');
  const js = read('js/admin/report.js');
  const css = read('css/admin/report.css');

  test('New report is hidden for now, but its feature code stays', () => {
    expect(listHtml).toMatch(/<lex-btn id="newReportBtn"[^>]*\shidden[\s>]/);
    expect(listCss).toMatch(/#newReportBtn\[hidden\]\s*\{\s*display:\s*none;/);
    expect(listJs).toContain("newReportBtn.addEventListener('click', openNewReport)");
  });

  test('the summary button opens a Lex drawer filled from the report detail endpoint', () => {
    expect(listHtml).toMatch(/<lex-drawer id="reportAboutDrawer"[^>]*side="right"/);
    expect(listJs).toContain('ReportsList.purposeCell');
    expect(listJs).toMatch(/closest\('\[data-report-about\]'\)/);
    expect(listJs).toMatch(/api\.get\('\/api\/v1\/modules\/' \+ encodeURIComponent\(/);
    expect(listJs).toContain('ReportsList.aboutHtml');
  });

  test('the drawer has its own stylesheet, on the list page and in its shell route', () => {
    const drawerCss = read('css/admin/report-about.css');
    expect(listHtml).toContain('<link rel="stylesheet" href="../css/admin/report-about.css">');
    const pages = read('js/lex/lex-router.pages.js');
    const listRoute = pages.slice(pages.indexOf("'admin/reports-list.html': {"), pages.indexOf("'admin/report.html': {"));
    expect(listRoute).toContain("'css/admin/report-about.css'");
    expect(drawerCss).toMatch(/\.report-about__card\s*\{[^}]*var\(--lex-bg-card\)/);
    expect(drawerCss).toMatch(/::marker\s*\{[^}]*var\(--lex-/);
    expect(drawerCss).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });

  test('the run controls live in the drawer footer slot, not in a body card', () => {
    expect(listHtml).toMatch(/<lex-drawer id="reportAboutDrawer"[^>]*>\s*<div id="reportRunFooter" class="report-run" data-slot="footer"><\/div>\s*<\/lex-drawer>/);
    expect(listJs).toContain('ReportsList.runFooterHtml(drawerPreset, escapeHtml)');
    expect(listJs + js).not.toContain('runControlsHtml');
  });

  // usesPeriod stays backend data; the client gates nothing on it, and every
  // report keeps the full date form (Quick Select Period, dates, Compare By).
  test('no client code gates on usesPeriod, and the date form is never hidden', () => {
    const model = read('js/admin/reports-list.model.js');
    expect(js + listJs + model + css + listCss).not.toMatch(/usesPeriod|data-period-control/);
    expect(html).not.toMatch(/data-period-control/);
    expect(html).toMatch(/<div class="detail-period-card__presets">/);
    expect(html).toMatch(/<div class="detail-period-card__fields">/);
    expect(js).toContain('ReportsList.compareByFor(');
  });

  test('Run in the drawer opens the report page with the period; the report page runs it with its own period and run code', () => {
    const run = listJs.slice(listJs.indexOf('function runFromDrawer'), listJs.indexOf('\n  }\n', listJs.indexOf('function runFromDrawer')));
    expect(run).toContain('ReportsList.customPeriodProblem(');
    expect(run).toContain('drawer.open = false');
    expect(run).toContain('Lex.Nav.go(ReportsList.reportHref(entry, period))');
    const load = js.slice(js.indexOf('async function loadReport'), js.indexOf('\n  }\n', js.indexOf('async function loadReport')));
    expect(load).toContain('ReportsList.reportRequest(');
    expect(load).toContain('await selectPeriodPreset(');
    expect(load).toContain('applyPeriodDays(');
    expect(load).toContain('executeModule()');
    expect(run + load).not.toMatch(/new Date\(|setDate\(|getDay\(/);
  });
});
