'use strict';

/**
 * The library count names every dashboard. Pinned dashboards were left out
 * of the table, so a firm with 12 dashboards (one pinned) read "11
 * dashboards" twice while the page showed 12 names. Pinned dashboards now
 * stay in the table (with a filled pin); the strip above is a shortcut.
 */

const fs = require('fs');
const path = require('path');

const js = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', 'admin', 'dashboard-library.js'), 'utf8');

test('the table and its count hold every dashboard, pinned ones included', () => {
  const render = js.slice(js.indexOf('function renderDashboardLibrary'), js.indexOf('function confirmDelete'));
  // Every dashboard goes in (each row gains its "Who can see it" text).
  expect(render).toMatch(/var rows = sourceDashboards\.map\(/);
  expect(render).toMatch(/table\.setData\(rows\)/);
  expect(render).not.toMatch(/pinnedIds\.has/);
});

test('the count says how many are pinned', () => {
  expect(js).toMatch(/onCount: function \(total\)/);
  expect(js).toContain("' pinned'");
});
