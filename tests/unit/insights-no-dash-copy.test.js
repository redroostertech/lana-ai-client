'use strict';

/**
 * Reports and Dashboards copy uses no em or en dashes (house rule); blank
 * cells use the shared empty token (DataState.EMPTY_VALUE).
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');
const FILES = ['js/admin/reporting.js', 'js/admin/report-metric-card.js', 'js/admin/reports-list.js', 'js/admin/dashboard-detail.js',
  'js/admin/dashboard-library.js', 'js/admin/dashboard-builder.js', 'js/shared/data-state.js',
  'js/admin/metric-detail.js', 'admin/reporting.html', 'admin/dashboard-library.html', 'admin/dashboard-detail.html',
  'admin/dashboard-builder.html', 'admin/metric_detail.html'];

// A dash typed as is, as a JS escape (\u2013 or \u2014) or as an HTML entity.
const DASH = /[\u2013\u2014]|\\u201[34]|&[mn]dash;/i;

test.each(FILES)('%s has no dash in its strings or markup text', (rel) => {
  const source = fs.readFileSync(path.join(SRC, rel), 'utf8');
  const strings = rel.endsWith('.html')
    ? source.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '').split('\n')
    : (source.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`[^`]*`/g) || []);
  expect(strings.filter(s => DASH.test(s))).toEqual([]);
});

test('the dash check catches escapes and entities, not only typed dashes', () => {
  ['a \u2014 b', 'a \\u2014 b', '30\\u201360', 'a &mdash; b', 'a &ndash; b'].forEach(s => expect(DASH.test(s)).toBe(true));
  expect(DASH.test('30 to 60, plain - hyphen')).toBe(false);
});

// Placeholders for a blank value: 'N/A', a lone '-' or '--', or an escaped
// em/en dash. Blank values use DataState.EMPTY_VALUE instead.
const PLACEHOLDER = /(?:return|\|\||\?|:)\s*(['"])(?:N\/A|-{1,2}|\\u201[34])\1/;
test.each(FILES.filter(rel => rel.endsWith('.js')))('%s uses the shared empty token, not a placeholder', (rel) => {
  const lines = fs.readFileSync(path.join(SRC, rel), 'utf8').split('\n').filter(line => !/^\s*(\/\/|\*)/.test(line));
  expect(lines.filter(line => PLACEHOLDER.test(line) || /(['"])(?:N\/A|\\u201[34])\1/.test(line)).map(l => l.trim())).toEqual([]);
});
