'use strict';

/**
 * The date pill on the Dashboards page (real markup from
 * admin/dashboard-detail.html, real page script): a click anywhere on the
 * pill, including its icon or words, opens the panel; Escape and a click
 * outside close it; a quick pick closes it.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { withReportSharedScripts } = require('./helpers/report-shared-scripts');

const SRC = path.join(__dirname, '..', '..', 'src');

function boot() {
  const html = fs.readFileSync(path.join(SRC, 'admin/dashboard-detail.html'), 'utf8');
  const tpl = html.slice(html.indexOf('<main>'), html.indexOf('</main>') + '</main>'.length);
  const dom = new JSDOM('<!doctype html><body><div id="lex-main-content">' + tpl + '</div></body>', { runScripts: 'outside-only' });
  const w = dom.window;
  withReportSharedScripts(w);
  new Function('window', fs.readFileSync(path.join(SRC, 'js/time-utils.js'), 'utf8'))(w);
  w.Lex = { Utils: { getFirmTimezone: () => 'America/New_York' }, Nav: { getParams: () => new w.URLSearchParams(''), go() {} }, Auth: { isAdmin: () => true } };
  w.api = { user: null, ensureFirmTimezone: () => Promise.resolve(), listBIDashboards: () => Promise.resolve({ data: [] }),
    getDashboardMetricCards: () => new Promise(() => {}) };
  w.DashboardTiles = { cardRequestKeys: () => null };
  w.TitleSwitcher = { render() {} };
  w.setInterval = () => 0;
  w.eval(fs.readFileSync(path.join(SRC, 'js/admin/dashboard-detail.js'), 'utf8'));
  return w;
}

test('a click on the pill or anything inside it opens the panel; again closes it', () => {
  const w = boot();
  const toggle = w.document.getElementById('dashboardPeriodToggle');
  const panel = w.document.getElementById('dashboardPeriodPanel');
  expect(panel.hidden).toBe(true);
  w.document.getElementById('dashboardPeriodLabel').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  expect(panel.hidden).toBe(false);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  toggle.querySelector('svg').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  expect(panel.hidden).toBe(true);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
});

test('Escape and a click outside close it; a click inside keeps it open', () => {
  const w = boot();
  const toggle = w.document.getElementById('dashboardPeriodToggle');
  const panel = w.document.getElementById('dashboardPeriodPanel');
  toggle.click();
  w.document.getElementById('dashboardPeriodStart').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  expect(panel.hidden).toBe(false);
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(panel.hidden).toBe(true);
  toggle.click();
  w.document.body.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  expect(panel.hidden).toBe(true);
});

test('a quick pick closes the panel', () => {
  const w = boot();
  w.document.getElementById('dashboardPeriodToggle').click();
  w.document.querySelector('[data-dashboard-preset="lastMonth"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  expect(w.document.getElementById('dashboardPeriodPanel').hidden).toBe(true);
});

test('the header banner comes first, then the breadcrumb, then the tab row', () => {
  const html = fs.readFileSync(path.join(SRC, 'admin/dashboard-detail.html'), 'utf8');
  const banner = html.indexOf('id="dashboardDetailBanner"');
  const pill = html.indexOf('id="dashboardPeriodToggle"');
  const crumbs = html.indexOf('id="dashboardDetailBreadcrumb"');
  const tabs = html.indexOf('id="dashboardTypeFilters"');
  expect(banner).toBeGreaterThan(-1);
  expect(pill).toBeLessThan(crumbs);
  expect(banner).toBeLessThan(crumbs);
  expect(crumbs).toBeLessThan(tabs);
});

test('the date pill sits on the left under the title, before the counts; the panel opens left-aligned', () => {
  const html = fs.readFileSync(path.join(SRC, 'admin/dashboard-detail.html'), 'utf8');
  const bar = html.slice(html.indexOf('class="dash-header__bar"'), html.indexOf('</header>'));
  expect(bar.indexOf('id="dashboardPeriodToggle"')).toBeGreaterThan(-1);
  expect(bar.indexOf('id="dashboardPeriodToggle"')).toBeLessThan(bar.indexOf('id="dashboardViewContext"'));
  const css = fs.readFileSync(path.join(SRC, 'css/admin/insights-dashboard.css'), 'utf8');
  const panel = css.slice(css.lastIndexOf('.dash-period__panel {'));
  expect(panel.slice(0, panel.indexOf('}'))).toContain('left: 0;');
});

test('a calm state hugs its content; on the hero it is a compact row whose reason wraps in full', () => {
  const css = fs.readFileSync(path.join(SRC, 'css/admin/insights-dashboard.css'), 'utf8');
  const tail = css.slice(css.lastIndexOf('/* Calm states hug their content'));
  expect(tail).toContain('.dash-bento .dash-metric-card > .lex-data-state {\n  flex: 0 0 auto;');
  expect(tail).toContain('.dash-metric-card--hero .lex-data-state--calm {');
  expect(tail).not.toContain('-webkit-line-clamp');
});
