'use strict';

/**
 * Firm Handbook structured forms (js/firm-handbook/firm-handbook-structured-forms.js):
 * values a form draws are escaped even when Lex.Utils has not loaded (it
 * fails safe instead of writing the raw string into the markup).
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function windowWithoutLexUtils() {
  const w = new JSDOM('<!doctype html><body><div id="c"></div></body>', { runScripts: 'outside-only' }).window;
  w.eval(read('js/firm-handbook/firm-handbook-structured.models.js'));
  w.eval(read('js/firm-handbook/firm-handbook-structured-forms.js'));
  return w;
}

test('a rule\'s values are escaped without Lex.Utils (control: the text itself is kept)', () => {
  const w = windowWithoutLexUtils();
  expect(w.Lex).toBeUndefined();
  const container = w.document.getElementById('c');
  const hostile = '"><img src=x onerror=alert(1)>';
  w.LanaFirmHandbookStructuredForms.render(container, 'followup_rule', {
    source: 'lana', match_field: 'event_type', match_value: hostile, label: hostile, task_title: 'Call & confirm', payment_defaults: {}
  }, { options: { match_fields: [{ value: 'event_type', label: 'LANA event type' }] } });
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('[data-rule="label"]').getAttribute('value')).toBe(hostile);
  expect(container.querySelector('[data-rule="taskTitle"]').getAttribute('value')).toBe('Call & confirm');
});
