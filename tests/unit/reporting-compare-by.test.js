'use strict';

/**
 * The backend owns the comparison period: Compare By names the grain and the
 * module engine works out the prior window. The page used to pick an
 * equal-length mode on any date edit, so Compare By = Monthly compared a week
 * to the week before it.
 */

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', 'admin', 'report.js'), 'utf8');

test('the report run sends Compare By and no comparison mode of its own', () => {
  expect(source).toMatch(/compareBy: periodType/);
  expect(source).not.toMatch(/compareMode/);
  expect(source).not.toMatch(/previous_period|previous_calendar/);
});
