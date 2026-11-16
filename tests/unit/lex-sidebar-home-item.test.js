/**
 * Every app's home item in the sidebar is "Dashboard" with the four-squares grid icon,
 * from one shared definition in lex-sidebar (an item marked home: true), so the apps
 * cannot drift apart again.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function loadSidebar() {
  const dom = new JSDOM('<!doctype html><html><head></head><body><lex-sidebar></lex-sidebar></body></html>', {
    url: 'http://localhost/dashboard.html', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole()
  });
  ['js/lex/lex.core.js', 'js/lex/lex.icons.js', 'js/lex/components/layout/lex-sidebar.js'].forEach((rel) => dom.window.eval(read(rel)));
  return dom;
}

// The first item after the create button, per app shell, as written in its source.
function firstNavItem(source, anchor) {
  const at = source.indexOf(anchor);
  expect(at).toBeGreaterThan(-1);
  return source.slice(at, source.indexOf('}', at) + 1);
}

describe('sidebar home item', () => {
  test('lex-sidebar defines the home item once: Dashboard with the grid icon', () => {
    const dom = loadSidebar();
    const { Lex } = dom.window;
    expect(Lex.SidebarNav.HOME).toEqual({ label: 'Dashboard', icon: 'layout-dashboard' });
    const bar = dom.window.document.querySelector('lex-sidebar');
    bar.sections = [{ id: 'main', items: [{ id: 'catalog', home: true, label: 'Workspace', icon: 'home' }, { id: 'activity', label: 'Outcomes', icon: 'sparkles' }] }];
    return new Promise((resolve) => dom.window.setTimeout(resolve, 0)).then(() => {
      const item = bar.querySelector('.lex-sidebar-nav-item[data-id="catalog"]');
      expect(item.textContent.trim()).toBe('Dashboard');
      expect(item.getAttribute('data-tooltip')).toBe('Dashboard');
      expect(item.querySelector('svg').outerHTML).toBe(dom.window.document.createRange().createContextualFragment(Lex.Icons['layout-dashboard'].normal).firstElementChild.outerHTML);
      dom.window.close();
    });
  });

  test.each([
    ['Workspaces (main)', 'js/lex/components/layout/lex-app.js', "{ id: 'dashboard',"],
    ['Briefs', 'js/lex/components/layout/lex-app.js', "{ id: 'briefs-dashboard',"],
    ['Agents', 'agents/app.js', "{ id: 'catalog',"],
    ['Automate', 'automation/js/constants.js', "{ id: 'library',"]
  ])('%s marks its first nav item home: true and does not set its own label or icon', (_app, file, anchor) => {
    const item = firstNavItem(read(file), anchor);
    expect(item).toMatch(/home: true/);
    expect(item).not.toMatch(/label:|icon:/);
  });

  test('Insights: its sidebar is being renamed on feat/insights-reports-dashboards; allowed until that lands', () => {
    // When that branch lands, its home item must also be { id: ..., home: true }: move it into the table above.
    const item = firstNavItem(read('js/lex/components/layout/lex-app.js'), "{ id: 'insights-dashboard',");
    expect(item).toMatch(/home: true|label: 'Dashboard'/);
  });

  test('Automate calls its home Dashboard everywhere: page title and breadcrumbs', () => {
    expect(read('automation/js/constants.js')).toMatch(/library: \{\s*kicker: 'Dashboard',\s*title: 'Dashboard'/);
    expect(read('automation/js/views/builder.js')).not.toMatch(/label: 'Library'/);
    expect(read('automation/js/views/library-detail.js')).not.toMatch(/Back to Library/);
    // The shell's first paint, before app.js sets the view title.
    expect(read('automation/index.html')).toMatch(/page-title="Dashboard"/);
    expect(read('js/walkthroughs/automate-walkthrough.js')).not.toMatch(/from the Library/);
  });
});
