/**
 * Regression: the dashboard must never parse a workspace out of a free-text
 * task title. A system task titled "Review UTM Source Hygiene - INFO" showed
 * WORKSPACE "INFO" because the text after the last " - " was treated as the
 * matter name. The workspace comes only from real task data.
 *
 * dashboard.js is an IIFE bound to Lex globals, so the pure helper is lifted
 * out of the source and evaluated on its own.
 */
const fs = require('fs');
const path = require('path');

function loadDashboardTaskMatterName() {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src/js/dashboard/dashboard.js'),
    'utf8'
  );
  const start = source.indexOf('function dashboardTaskMatterName(task)');
  const end = source.indexOf('function renderDashboardTaskMatterKv(');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  // eslint-disable-next-line no-new-func
  return new Function('Lex', source.slice(start, end) + '\nreturn dashboardTaskMatterName;')(loadLex());
}

// The real Lex.Utils (the shared taskWorkspaceName rule) on a bare window.
function loadLex() {
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
  const window = { localStorage: { getItem: () => null }, Intl, Date };
  // eslint-disable-next-line no-new-func
  new Function('window', read('src/js/time-utils.js'))(window);
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', read('src/js/lex/lex.utils.js'))(window, { createTextNode: (t) => ({ textContent: String(t) }) });
  return window.Lex;
}



describe('dashboardTaskMatterName', () => {
  const dashboardTaskMatterName = loadDashboardTaskMatterName();

  test('does not read a workspace from a title suffix', () => {
    expect(dashboardTaskMatterName({ title: 'Review UTM Source Hygiene - INFO' })).toBe('');
    expect(dashboardTaskMatterName({ title: 'Review X - INFO' })).toBe('');
    expect(dashboardTaskMatterName({ name: 'Call client — Smith Estate' })).toBe('');
  });

  test('uses the matter name from the task data', () => {
    expect(dashboardTaskMatterName({
      title: 'Review X - INFO',
      matter_id: 'm-1',
      matter_name: 'Smith Estate'
    })).toBe('Smith Estate');
    expect(dashboardTaskMatterName({ title: 'Draft will', matter: { name: 'Jones Trust' } })).toBe('Jones Trust');
    expect(dashboardTaskMatterName({ title: 'Draft will', workspace_name: 'Doe Probate' })).toBe('Doe Probate');
  });

  test('returns empty for a task with no workspace data', () => {
    expect(dashboardTaskMatterName({ title: 'Org cleanup' })).toBe('');
    expect(dashboardTaskMatterName(null)).toBe('');
  });
});
