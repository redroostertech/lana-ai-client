'use strict';

// <lex-segmented collapsible> swaps its segments for a <lex-select> when they
// do not fit. The select's options travel as a JSON attribute; it used to end
// at the JSON's first double quote, so the collapsed dropdown had no options
// and the selected tab showed as "Select...". The File Viewer review rail
// (five tabs since the Redlines tab) collapses on every width.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');

test('the collapsed dropdown carries every segment and the selected value', () => {
  const dom = new JSDOM('<!doctype html><head></head><body></body>', {
    url: 'http://localhost/src/index.html', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  try {
    ['js/lex/lex.core.js', 'js/lex/lex.icons.js', 'js/lex/lex.forms.js',
      'js/lex/components/form/lex-select.js', 'js/lex/components/form/lex-segmented.js'].forEach((rel) => window.eval(read(rel)));
    const host = window.document.createElement('div');
    host.innerHTML = '<lex-segmented collapsible value="redlines" options=\'[{"value":"changes","label":"History"},{"value":"redlines","label":"Redlines \\"LANA\\""}]\'></lex-segmented>';
    window.document.body.appendChild(host);
    const select = host.querySelector('.lex-seg-select');
    expect(select).not.toBeNull();
    expect(select.options).toEqual([
      { value: 'changes', label: 'History' },
      { value: 'redlines', label: 'Redlines "LANA"' }
    ]);
    expect(select.value).toBe('redlines');
  } finally {
    window.close();
  }
});
