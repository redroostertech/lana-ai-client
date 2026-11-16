'use strict';

// A searchable <lex-select> whose options change while the person is typing
// (the custom fields "Use an existing field" picker loads server results as
// you type) must keep focus, text and caret in its search box. Setting
// .options re-renders the element, and the fresh search input used to lose
// focus, so the next keystroke went nowhere.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');

function mount() {
  const dom = new JSDOM('<!doctype html><head></head><body></body>', {
    url: 'http://localhost/src/index.html', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  ['js/lex/lex.core.js', 'js/lex/lex.icons.js', 'js/lex/lex.forms.js',
    'js/lex/components/form/lex-select.js'].forEach((rel) => window.eval(read(rel)));
  const host = window.document.createElement('div');
  host.innerHTML = '<lex-select searchable="true" options=\'[{"value":"a","label":"Alpha"}]\'></lex-select>';
  window.document.body.appendChild(host);
  return { window, select: host.querySelector('lex-select') };
}

const flush = (window) => new Promise((resolve) => window.setTimeout(resolve, 0));

test('an options update while open keeps focus, text and caret in the search box', async () => {
  const { window, select } = mount();
  try {
    select.querySelector('[data-action="toggle"]').click();
    await flush(window);
    let search = select.querySelector('.lex-select-search input');
    expect(search).not.toBeNull();
    search.focus();
    search.value = 'tru';
    search.setSelectionRange(2, 2);
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    await flush(window);
    search = select.querySelector('.lex-select-search input');
    search.setSelectionRange(2, 2);

    // Server results arrive mid-typing.
    select.options = [{ value: 't', label: 'Trustee (trustee)' }, { value: 'u', label: 'Trust date (trust_date)' }];
    await flush(window);

    const after = select.querySelector('.lex-select-search input');
    expect(window.document.activeElement).toBe(after);
    expect(after.value).toBe('tru');
    expect(after.selectionStart).toBe(2);
    expect(select.querySelectorAll('.lex-select-option').length).toBe(2);
  } finally {
    window.close();
  }
});

test('an options update while closed does not pull focus into the select', async () => {
  const { window, select } = mount();
  try {
    const other = window.document.createElement('input');
    window.document.body.appendChild(other);
    other.focus();
    select.options = [{ value: 'b', label: 'Beta' }];
    await flush(window);
    expect(window.document.activeElement).toBe(other);
  } finally {
    window.close();
  }
});
