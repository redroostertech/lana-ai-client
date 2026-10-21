'use strict';

// Skill step builders (skills.js, matter-skills.js) and the file editor use
// lex-select, not native <select>: values stay strings, the first option is
// the default as a native select had it, and lex-change drives the config.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const windows = [];
afterAll(() => windows.forEach((window) => window.close()));

function boot() {
  const dom = new JSDOM('<!doctype html><body><div id="workflow-steps-container"></div></body>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.LanaTime = { nowMs: () => 1700000000000 };
  window.eval(read('js/lex/lex.core.js'));
  window.eval(read('js/lex/lex.forms.js'));
  window.eval(read('js/lex/components/form/lex-select.js'));
  window.eval(read('js/shared/event-catalog.js'));
  // Top-level let bindings stay inside the eval, so expose the step list.
  window.eval(read('js/matter-skills.js') + '\nwindow.__skillSteps = function () { return skillSteps; };');
  windows.push(window);
  return window;
}

const tick = (window) => new Promise((resolve) => window.setTimeout(resolve, 0));

function pick(window, select, value) {
  const option = select.querySelector(`.lex-select-option[data-value="${value}"]`);
  option.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

describe('matter skill step builder lex-selects', () => {
  test('a new step renders lex-selects with string values and first-option defaults', async () => {
    const window = boot();
    window.addWorkflowStep();
    await tick(window);
    const doc = window.document;
    expect(doc.querySelector('select')).toBeNull();

    const typeSelect = doc.querySelector('lex-select.step-type-selector');
    expect(typeSelect.value).toBe('trigger');
    expect(typeSelect.options.map((o) => o.value)).toEqual(['trigger', 'condition', 'ai-action', 'integration', 'transform']);

    const eventSelect = doc.querySelector('lex-select[id^="event-type-select-"]');
    const catalog = window.LanaEventCatalog;
    expect(eventSelect.searchable).toBe(true);
    expect(eventSelect.options.length).toBe(catalog.categories.reduce((n, g) => n + g.events.length, 0));
    expect(eventSelect.options[0]).toEqual(expect.objectContaining({ group: catalog.categories[0].label }));
    expect(eventSelect.value).toBe(catalog.categories[0].events[0]);
    expect(window.__skillSteps()[0].config).toEqual({ event_type: catalog.categories[0].events[0] });
  });

  test('choosing a step type and an operator goes through lex-change', async () => {
    const window = boot();
    window.addWorkflowStep();
    await tick(window);
    const doc = window.document;

    pick(window, doc.querySelector('lex-select.step-type-selector'), 'condition');
    await tick(window);
    const operator = doc.querySelector('lex-select.condition-operator-select');
    expect(operator.value).toBe('equals');
    expect(operator.options.map((o) => o.label)).toEqual(['Equals', 'Contains', 'Greater than', 'Less than']);

    pick(window, operator, 'greater_than');
    await tick(window);
    expect(window.__skillSteps()[0].type).toBe('condition');
    expect(window.__skillSteps()[0].config.operator).toBe('greater_than');
  });

  test('custom prompt mode reveals the system prompt field', async () => {
    const window = boot();
    window.addWorkflowStep();
    await tick(window);
    const doc = window.document;
    pick(window, doc.querySelector('lex-select.step-type-selector'), 'ai-action');
    await tick(window);
    const field = doc.querySelector('.ai-system-prompt-field');
    expect(field.classList.contains('hidden')).toBe(true);
    pick(window, doc.querySelector('lex-select.ai-prompt-mode-select'), 'custom');
    await tick(window);
    expect(field.classList.contains('hidden')).toBe(false);
    expect(window.__skillSteps()[0].config.prompt_mode).toBe('custom');
  });
});

describe('skills.js and file-editor.js select markup', () => {
  const skills = read('js/skills.js');
  const editor = read('js/file-editor.js');

  test('no native selects remain', () => {
    expect(skills).not.toMatch(/<select[\s>]/);
    expect(editor).not.toMatch(/<select[\s>]/);
    expect(read('js/matter-skills.js')).not.toMatch(/<select[\s>]/);
  });

  test('skill step selects listen for lex-change and skip the lex-select search box', () => {
    expect(skills).toContain("typeSelect.addEventListener('lex-change', function(e) {");
    expect(skills).toContain("allSelects[si].addEventListener('lex-change', syncHandler);");
    expect(skills).toContain("return !input.closest('lex-select');");
    expect(skills).toContain("new CustomEvent('lex-change'");
  });

  test('file editor toolbar selects are lex-selects driven by lex-change, keeping the caret', () => {
    ['formatBlock', 'fontName', 'fontSize'].forEach((command) => {
      expect(editor).toContain(`lexSelectHtml('class="office-format-select${command === 'fontSize' ? ' office-format-select-narrow' : ''}" data-command="${command}"`);
      expect(editor).toContain(`lex-select[data-command="${command}"]`);
    });
    expect(editor).toContain("document.addEventListener('lex-change', function (event) {");
    expect(editor).toContain("if (embedCommandTarget.matches('lex-select')) event.preventDefault();");
    expect(editor).toContain("lexSelectHtml('id=\"officeMetaDocType\" label=\"Document Type\"'");
  });

  test('host pages load lex-select', () => {
    ['file-editor.html', 'matter-skills.html', 'skills.html'].forEach((page) => {
      expect(read(page)).toContain('<script src="js/lex/components/form/lex-select.js"></script>');
    });
  });
});
