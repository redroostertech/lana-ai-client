/* Lex UI - Stepper Component
   Ordered list of steps with a state per step. Wide, it shows every step with
   its label; narrow (container query on the host), it collapses to
   "Step N of M: label" over a row of step markers.

   Usage:
     const stepper = document.createElement('lex-stepper');
     stepper.items = [
       { id: 'intro', label: 'Before you start', state: 'done' },
       { id: 'key', label: 'Copy your key', state: 'current' },
       { id: 'connect', label: 'Connect', state: 'upcoming' }
     ];

   Properties:
     items  Array  []  [{ id, label, state }] where state is
                       upcoming | current | done | error

   Accessibility: an <ol> with aria-current="step" on the current step. Done
   steps are buttons; every other step is plain text.

   Events:
     lex-step-select { index, id } - only when a done step is chosen
*/

// Pure helpers (no DOM), exported for unit tests.
var LEX_STEPPER_STATES = ['upcoming', 'current', 'done', 'error'];

function lexStepperNormalizeItems(items) {
  var list = Array.isArray(items) ? items : [];
  return list.filter(function (item) { return item && typeof item === 'object'; }).map(function (item, index) {
    var state = String(item.state || '').toLowerCase();
    return {
      id: String(item.id == null ? index : item.id),
      label: String(item.label == null ? '' : item.label),
      state: LEX_STEPPER_STATES.indexOf(state) === -1 ? 'upcoming' : state
    };
  });
}

// Index of the step to summarise: the current one, else the step with an
// error, else the last done step, else the first.
function lexStepperActiveIndex(items) {
  var list = lexStepperNormalizeItems(items);
  var i;
  for (i = 0; i < list.length; i++) if (list[i].state === 'current') return i;
  for (i = 0; i < list.length; i++) if (list[i].state === 'error') return i;
  for (i = list.length - 1; i >= 0; i--) if (list[i].state === 'done') return i;
  return list.length ? 0 : -1;
}

function lexStepperSummary(items) {
  var list = lexStepperNormalizeItems(items);
  var index = lexStepperActiveIndex(list);
  if (index === -1) return '';
  var label = list[index].label;
  return 'Step ' + (index + 1) + ' of ' + list.length + (label ? ': ' + label : '');
}

function lexStepperIsSelectable(item) {
  return !!item && item.state === 'done';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeItems: lexStepperNormalizeItems,
    activeIndex: lexStepperActiveIndex,
    summary: lexStepperSummary,
    isSelectable: lexStepperIsSelectable
  };
}

if (typeof window !== 'undefined' && window.Lex) (function () {
  'use strict';

  var _lex = window.Lex;
  var LexElement = _lex.LexElement;
  var defineLex = _lex.defineLex;

  var stylesInjected = false;

  var STATE_LABELS = {
    upcoming: 'Not started',
    current: 'Current step',
    done: 'Done',
    error: 'Needs attention'
  };

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    var style = document.createElement('style');
    style.id = 'lex-stepper-styles';
    style.textContent = [
      'lex-stepper {',
      '  display: block;',
      '  container: lex-stepper / inline-size;',
      '}',

      '.lex-stepper-summary {',
      '  display: none;',
      '  margin: 0 0 var(--lex-space-md);',
      '  font-size: var(--lex-body-sm-size);',
      '  font-weight: 600;',
      '  color: var(--lex-text-primary);',
      '  min-width: 0;',
      '  overflow: hidden;',
      '  text-overflow: ellipsis;',
      '  white-space: nowrap;',
      '}',

      '.lex-stepper-list {',
      '  display: flex;',
      '  gap: var(--lex-space-md);',
      '  margin: 0;',
      '  padding: 0;',
      '  list-style: none;',
      '}',

      '.lex-stepper-item {',
      '  flex: 1 1 0;',
      '  min-width: 0;',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: var(--lex-space-sm);',
      '}',

      '.lex-stepper-bar {',
      '  display: block;',
      '  height: 4px;',
      '  border-radius: 9999px;',
      '  background: var(--lex-border-default);',
      '}',
      '.lex-stepper-item--done .lex-stepper-bar { background: var(--lex-bg-accent); }',
      '.lex-stepper-item--current .lex-stepper-bar { background: var(--lex-bg-accent); opacity: 0.55; }',
      '.lex-stepper-item--error .lex-stepper-bar { background: var(--lex-color-danger-500); }',

      '.lex-stepper-label,',
      '.lex-stepper-btn {',
      '  display: block;',
      '  min-width: 0;',
      '  overflow: hidden;',
      '  text-overflow: ellipsis;',
      '  white-space: nowrap;',
      '  font-size: var(--lex-body-xs-size);',
      '  color: var(--lex-text-secondary);',
      '  text-align: left;',
      '}',
      '.lex-stepper-item--current .lex-stepper-label { color: var(--lex-text-primary); font-weight: 600; }',
      '.lex-stepper-item--error .lex-stepper-label { color: var(--lex-status-danger-text); font-weight: 600; }',

      '.lex-stepper-btn {',
      '  padding: 0;',
      '  border: 0;',
      '  background: none;',
      '  cursor: pointer;',
      '  font: inherit;',
      '  font-size: var(--lex-body-xs-size);',
      '  color: var(--lex-text-accent);',
      '}',
      '.lex-stepper-btn:hover { text-decoration: underline; }',
      '.lex-stepper-btn:focus-visible {',
      '  outline: 2px solid var(--lex-border-accent);',
      '  outline-offset: 2px;',
      '  border-radius: var(--lex-radius-sm);',
      '}',

      '.lex-stepper-sr {',
      '  position: absolute;',
      '  width: 1px;',
      '  height: 1px;',
      '  padding: 0;',
      '  margin: -1px;',
      '  overflow: hidden;',
      '  clip: rect(0, 0, 0, 0);',
      '  white-space: nowrap;',
      '  border: 0;',
      '}',

      /* Narrow: the summary line, markers only, labels kept for screen readers. */
      '@container lex-stepper (max-width: 639px) {',
      '  .lex-stepper-summary { display: block; }',
      '  .lex-stepper-list { gap: var(--lex-space-sm); }',
      '  .lex-stepper-label,',
      '  .lex-stepper-btn {',
      '    position: absolute;',
      '    width: 1px;',
      '    height: 1px;',
      '    padding: 0;',
      '    margin: -1px;',
      '    overflow: hidden;',
      '    clip: rect(0, 0, 0, 0);',
      '    white-space: nowrap;',
      '    border: 0;',
      '  }',
      '  .lex-stepper-item { position: relative; }',
      '}'
    ].join('\n');

    document.head.appendChild(style);
  }

  class LexStepper extends LexElement {
    static get properties() {
      return {
        items: { type: Array, default: [] }
      };
    }

    render() {
      injectStyles();
      var self = this;
      var list = lexStepperNormalizeItems(this.items);
      var summary = lexStepperSummary(list);

      var itemsHtml = list.map(function (item, index) {
        var number = index + 1;
        var stateText = STATE_LABELS[item.state];
        var text = self.escapeHtml(number + '. ' + item.label);
        var labelHtml = lexStepperIsSelectable(item)
          ? '<button type="button" class="lex-stepper-btn" data-lex-step-index="' + index + '">' +
              text + '<span class="lex-stepper-sr"> (' + self.escapeHtml(stateText) + ', go back to this step)</span>' +
            '</button>'
          : '<span class="lex-stepper-label">' + text +
              '<span class="lex-stepper-sr"> (' + self.escapeHtml(stateText) + ')</span>' +
            '</span>';
        return '<li class="lex-stepper-item lex-stepper-item--' + item.state + '"' +
          (item.state === 'current' ? ' aria-current="step"' : '') + '>' +
          '<span class="lex-stepper-bar" aria-hidden="true"></span>' +
          labelHtml +
          '</li>';
      }).join('');

      return '<p class="lex-stepper-summary" aria-hidden="true">' + this.escapeHtml(summary) + '</p>' +
        '<ol class="lex-stepper-list" aria-label="Steps">' + itemsHtml + '</ol>';
    }

    updated() {
      this.delegate('click', '[data-lex-step-index]', function (event, button) {
        var index = Number(button.getAttribute('data-lex-step-index'));
        var list = lexStepperNormalizeItems(this.items);
        var item = list[index];
        if (!lexStepperIsSelectable(item)) return;
        this.emit('lex-step-select', { index: index, id: item.id });
      });
    }
  }

  defineLex('lex-stepper', LexStepper);
})();
