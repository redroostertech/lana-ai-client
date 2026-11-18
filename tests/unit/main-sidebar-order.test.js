'use strict';

/**
 * The main LANA sidebar reads Dashboard, Calendar, then Library.
 */

const fs = require('fs');
const path = require('path');

function mainItems() {
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', 'lex', 'components', 'layout', 'lex-app.js'), 'utf8');
  const start = app.indexOf("{ id: 'dashboard', home: true, href: 'dashboard.html' }");
  return app.slice(start, app.indexOf('const sections', start));
}

test('Calendar sits between Dashboard and Library in the main sidebar', () => {
  const ids = [...mainItems().matchAll(/^\s*\{ id: '([^']+)'/gm)].map(m => m[1]);
  expect(ids.slice(0, 3)).toEqual(['dashboard', 'calendar', 'library']);
});
