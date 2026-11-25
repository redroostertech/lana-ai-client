'use strict';

/**
 * The shell (lex-app) and the sidebar's app switcher must agree on which
 * pages belong to Insights. Metric detail was missing from the switcher, so
 * it showed "Workspaces" over the Insights nav.
 */

const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '../../src/js/lex/components/layout', rel), 'utf8');

function insightsPaths(source, marker) {
  const start = source.indexOf(marker);
  const block = source.slice(start, source.indexOf(') return', start) === -1 ? start + 3000 : start + 3000);
  const paths = new Set();
  block.split("path.indexOf('").slice(1).forEach((part) => {
    const p = part.split("'")[0];
    if (p.indexOf('/') === 0 || p.indexOf('admin/') === 0) paths.add(p.charAt(0) === '/' ? p.slice(1) : p);
  });
  return paths;
}

test('every Insights page in the shell is an Insights page in the app switcher', () => {
  const shell = insightsPaths(read('lex-app.js'), '_getAppContext() {');
  const switcher = insightsPaths(read('lex-sidebar.js'), "if (path.indexOf('/automation/') !== -1) return byId('lana-automations')");
  expect(shell.has('admin/metric_detail.html')).toBe(true);
  [...shell].filter((p) => p.indexOf('admin/') === 0).forEach((p) => expect([p, switcher.has(p)]).toEqual([p, true]));
});
