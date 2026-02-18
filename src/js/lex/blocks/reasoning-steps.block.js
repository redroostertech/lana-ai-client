/* Lex UI — Reasoning Steps Block
   Displays a multi-step reasoning timeline with text badge labels
   (STEP 01, STEP 02), vertical border-left connector, and status indicators.
*/

(function () {
  'use strict';

  const { SchemaRegistry } = window.Lex;

  // Inject styles once for the reasoning steps block
  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-reasoning-steps-block-styles';
    style.textContent = `
      .lex-rs-timeline {
        display: flex;
        flex-direction: column;
      }

      .lex-rs-step {
        display: flex;
        flex-direction: column;
        padding-left: 16px;
        border-left: 1px solid var(--lex-chat-step-line);
        padding-bottom: 20px;
      }

      .lex-rs-step:last-child {
        border-left-color: transparent;
        padding-bottom: 0;
      }

      .lex-rs-badge {
        display: inline-block;
        align-self: flex-start;
        padding: 3px 10px;
        font-family: var(--lex-font-mono);
        font-size: var(--lex-chat-step-badge-size);
        font-weight: var(--lex-weight-bold);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        background: transparent;
        color: var(--lex-chat-step-badge-text);
        border-radius: var(--lex-radius-sm);
        margin-bottom: 6px;
      }

      .lex-rs-badge--active {
        background: var(--lex-chat-accent-soft);
        color: var(--lex-chat-accent);
      }

      .lex-rs-badge--complete {
        background: var(--lex-status-success-bg);
        color: var(--lex-status-success-text);
      }

      .lex-rs-badge--pending {
        color: var(--lex-chat-text-dim);
      }

      .lex-rs-title {
        font-size: var(--lex-form-font-size);
        font-weight: var(--lex-weight-regular);
        color: var(--lex-chat-text);
        line-height: 1.6;
      }

      .lex-rs-title--pending {
        color: var(--lex-chat-text-muted);
      }
    `;
    document.head.appendChild(style);
  }

  SchemaRegistry.register('reasoning_steps', {
    description: 'Display a multi-step reasoning timeline with text badge labels (STEP 01), vertical border-left connector, and status indicators for each step.',
    fields: {
      type:  { type: 'string', required: true, description: 'Must be "reasoning_steps"' },
      steps: {
        type: 'array', required: true,
        description: 'Array of step objects with number (int), title (string), status ("complete"|"active"|"pending")'
      }
    },
    example: {
      type: 'reasoning_steps',
      steps: [
        { number: 1, title: 'Modify Section 8.2(b) Termination Clause', status: 'complete' },
        { number: 2, title: 'Update Liability Cap to $50,000', status: 'active' },
        { number: 3, title: 'Add Force Majeure Provision', status: 'pending' }
      ]
    }
  }, function renderReasoningSteps(container, block) {
    injectStyles();

    const steps = block.steps || [];

    let html = '<div class="lex-rs-timeline lex-chat-block">';

    steps.forEach(function (step, idx) {
      const status = step.status || 'pending';
      const stepNum = String(step.number || idx + 1).padStart(2, '0');

      // Badge modifier class
      var badgeClass = 'lex-rs-badge';
      if (status === 'active') badgeClass += ' lex-rs-badge--active';
      else if (status === 'complete') badgeClass += ' lex-rs-badge--complete';
      else badgeClass += ' lex-rs-badge--pending';

      var titleClass = 'lex-rs-title' + (status === 'pending' ? ' lex-rs-title--pending' : '');

      html += '<div class="lex-rs-step">';
      html += '<div class="' + badgeClass + '">STEP ' + escapeHtml(stepNum) + '</div>';
      html += '<div class="' + titleClass + '">' + escapeHtml(step.title) + '</div>';
      html += '</div>';
    });

    html += '</div>';

    container.innerHTML = html;
  });

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
})();
