/**
 * Regression: the sidebar TASKS list showed a task's severity suffix as its
 * workspace ("INFO · No Due Date" for "Review UTM Source Hygiene - INFO").
 * The sidebar, the task drawer, My Tasks and the dashboard now share one rule,
 * Lex.Utils.taskWorkspaceName: the workspace comes from the task's matter
 * fields only, otherwise the task is organization-level.
 */
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

function loadLex() {
  const window = { localStorage: { getItem: () => null }, Intl, Date };
  // eslint-disable-next-line no-new-func
  new Function('window', read('src/js/time-utils.js'))(window);
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', read('src/js/lex/lex.utils.js'))(window, { createTextNode: (t) => ({ textContent: String(t) }) });
  return window.Lex;
}

// lex-sidebar.js is a Lex element bound to the DOM, so the one method under
// test is lifted out of the class and run with a minimal `this`.
function loadRenderTaskItem(Lex) {
  const source = read('src/js/lex/components/layout/lex-sidebar.js');
  const start = source.indexOf('_renderTaskItem(task) {');
  const end = source.indexOf('_findSidebarTask(taskId) {');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  // eslint-disable-next-line no-new-func
  return new Function('Lex', 'icon', 'return function ' + source.slice(start, end) + ';')(Lex, () => '');
}

// Older builds split the title in helper methods; lift them when present so
// this test exercises the real old behaviour rather than a missing method.
function liftMethod(name) {
  const source = read('src/js/lex/components/layout/lex-sidebar.js');
  const start = source.indexOf(`    ${name}(`);
  if (start === -1) return undefined;
  const end = source.indexOf('\n    _', start + 5);
  // eslint-disable-next-line no-new-func
  return new Function('return function ' + source.slice(start + 4, end) + ';')();
}

function metaOf(Lex, task) {
  const self = {
    _splitTaskTitle: liftMethod('_splitTaskTitle'),
    _getTaskMatterName: liftMethod('_getTaskMatterName'),
    escapeHtml: (v) => String(v),
    _truncateTaskTitle: (t) => t,
    _getTaskDueBucket: () => ({ label: 'No Due Date', rank: 900 })
  };
  const html = loadRenderTaskItem(Lex).call(self, task);
  const match = html.match(/lex-sidebar-task-meta">([^<]*)</);
  const name = html.match(/lex-sidebar-task-name">([^<]*)</);
  return { meta: match ? match[1] : '', name: name ? name[1] : '' };
}

describe('task workspace in the sidebar', () => {
  const Lex = loadLex();

  test('a severity suffix in the title is not a workspace', () => {
    expect(metaOf(Lex, { id: 't1', title: 'Review UTM Source Hygiene - INFO' })).toEqual({
      meta: 'Organization-level · No Due Date',
      name: 'Review UTM Source Hygiene - INFO'
    });
    expect(metaOf(Lex, { id: 't2', title: 'Fix sync — CRITICAL' }).meta).toBe('Organization-level · No Due Date');
  });

  test('a real matter is shown as the workspace', () => {
    expect(metaOf(Lex, { id: 't3', title: 'Draft will - INFO', matter_id: 'm1', matter_name: 'Smith Estate' }).meta)
      .toBe('Smith Estate · No Due Date');
  });

  test('the shared rule reads only matter and workspace fields', () => {
    expect(Lex.Utils.taskWorkspaceName({ title: 'Review X - INFO' })).toBe('');
    expect(Lex.Utils.taskWorkspaceName({ matter: { name: 'Jones Trust' } })).toBe('Jones Trust');
    expect(Lex.Utils.taskWorkspaceName({ workspace: { name: 'Doe Probate' } })).toBe('Doe Probate');
    expect(Lex.Utils.taskWorkspaceName(null)).toBe('');
  });

  test('the drawer, My Tasks and the dashboard use the shared rule and no longer parse titles', () => {
    for (const rel of ['src/js/components/task-detail-drawer.js', 'src/js/pages/my-tasks.js', 'src/js/dashboard/dashboard.js',
      'src/js/lex/components/layout/lex-sidebar.js']) {
      const source = read(rel);
      expect(source).toContain('Lex.Utils.taskWorkspaceName(task)');
      expect(source).not.toMatch(/splitTaskTitle|_splitTaskTitle|splitDashboardTaskTitle/);
    }
  });
});

describe('task drawer without Lex.Utils', () => {
  // The drawer guards every other Lex call (esc, icons); a page that loads it
  // before Lex.Utils must still render the task as organization-level.
  test('taskMatterName answers empty instead of throwing', () => {
    const source = read('src/js/components/task-detail-drawer.js');
    const start = source.indexOf('function taskMatterName(task) {');
    const end = source.indexOf('function currentUserName()');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const make = (Lex) => new Function('window', 'Lex', source.slice(start, end) + '\nreturn taskMatterName;')({ Lex }, Lex);
    expect(make(undefined)({ matter_name: 'Smith Estate' })).toBe('');
    expect(make({})({ matter_name: 'Smith Estate' })).toBe('');
    // Control arm: with Lex.Utils, the shared rule answers.
    expect(make(loadLex())({ matter_name: 'Smith Estate' })).toBe('Smith Estate');
  });
});
