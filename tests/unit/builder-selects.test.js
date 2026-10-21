'use strict';

/**
 * Wave 3c of the UI standard (docs/TABLE-STANDARD.md section 11): the
 * automation builder, the workflow builder and the skill builder use
 * lex-select, never a native <select>.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function loadWorkflowBuilder() {
  const win = {};
  // eslint-disable-next-line no-new-func
  return new Function('window', `${read('js/workflow-builder.js')}\nreturn { workflowConfigSelect, EventTypes };`)(win);
}

function parseSelect(html) {
  const { document } = new JSDOM('<!doctype html><body></body>').window;
  document.body.innerHTML = html;
  const el = document.body.querySelector('lex-select');
  return {
    el,
    options: JSON.parse(el.getAttribute('options')),
    value: el.getAttribute('value'),
    placeholder: el.getAttribute('placeholder'),
  };
}

describe('builder dropdowns are lex-select', () => {
  test.each([
    'automation/js/views/builder.js',
    'js/workflow-builder.js',
    'js/skill-builder.js',
  ])('%s has no native select', (rel) => {
    expect(read(rel)).not.toMatch(/<select[\s>]|createElement\(['"]select['"]\)/);
  });

  test('automation builder lex-selects are not wrapped in a <label>', () => {
    const source = read('automation/js/views/builder.js');
    // A label re-clicks its trigger button when an option is picked, which
    // would reopen the dropdown.
    const blocks = source.split('<label');
    blocks.slice(1).forEach((block) => {
      const body = block.split('</label>')[0];
      expect(body).not.toMatch(/builderSelect\(|<lex-select/);
    });
  });

  test('automation app handles lex-change and ignores the lex-select search box', () => {
    const app = read('automation/app.js');
    expect(app).toMatch(/addEventListener\('lex-change', onAppInput\)/);
    expect(app).toMatch(/event\.target\.closest\('lex-select'\)/);
  });

  test('workflow builder pages load lex-select', () => {
    const html = read('workflows/builder.html');
    expect(html).toMatch(/js\/lex\/lex\.forms\.js/);
    expect(html).toMatch(/js\/lex\/components\/form\/lex-select\.js/);
  });

  describe('workflowConfigSelect', () => {
    const { workflowConfigSelect, EventTypes } = loadWorkflowBuilder();

    test('keeps ids, values and the current value', () => {
      const s = parseSelect(workflowConfigSelect('config-event', EventTypes, 'client.signed'));
      expect(s.el.id).toBe('config-event');
      expect(s.options.map((o) => o.value)).toEqual(EventTypes.map((e) => e.value));
      expect(s.value).toBe('client.signed');
    });

    test('an unknown value falls back to the first option, like a native select', () => {
      const s = parseSelect(workflowConfigSelect('config-priority', [
        { value: 'low', label: 'Low' },
        { value: 'normal', label: 'Normal' },
      ], undefined));
      expect(s.value).toBe('low');
    });

    test('an empty option becomes the placeholder and stays selectable', () => {
      const s = parseSelect(workflowConfigSelect('config-template', [
        { value: '', label: 'Select template...' },
        { value: 'welcome', label: 'Welcome Email' },
      ], 'missing'));
      expect(s.value).toBe('');
      expect(s.placeholder).toBe('Select template...');
      expect(s.options[0]).toEqual({ value: '', label: 'Select template...' });
    });

    test('labels with quotes survive the attribute round trip', () => {
      const s = parseSelect(workflowConfigSelect('config-x', [{ value: 'a"b', label: 'It\'s "quoted"' }], 'a"b'));
      expect(s.options[0]).toEqual({ value: 'a"b', label: 'It\'s "quoted"' });
      expect(s.value).toBe('a"b');
    });
  });
});
