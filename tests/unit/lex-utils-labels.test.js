'use strict';

const fs = require('fs');
const path = require('path');

function loadUtils() {
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', rel), 'utf8');
  const window = { localStorage: { getItem: () => null }, Intl, Date };
  // eslint-disable-next-line no-new-func
  new Function('window', read('time-utils.js'))(window);
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', read('lex/lex.utils.js'))(window, { createTextNode: (t) => ({ textContent: String(t) }) });
  return window.Lex.Utils;
}

describe('Lex.Utils display labels', () => {
  const utils = loadUtils();

  test('capitalizeFirst uppercases only the first letter', () => {
    expect(utils.capitalizeFirst('template')).toBe('Template');
    expect(utils.capitalizeFirst('in progress')).toBe('In progress');
    expect(utils.capitalizeFirst('')).toBe('');
    expect(utils.capitalizeFirst(null)).toBe('');
  });

  test('humanizeLabel turns slugs and enums into labels', () => {
    expect(utils.humanizeLabel('lead-management')).toBe('Lead management');
    expect(utils.humanizeLabel('automation_execution')).toBe('Automation execution');
    expect(utils.humanizeLabel('  org__wide ')).toBe('Org wide');
  });
});
