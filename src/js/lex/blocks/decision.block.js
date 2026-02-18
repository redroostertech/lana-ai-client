/* Lex UI — Decision Block
   AI can present decision options as selectable cards.
   User picks one option (or types a custom response) then clicks Continue.
   Emits a 'lex-decision' event with the chosen value.
*/

(function () {
  'use strict';

  const { SchemaRegistry } = window.Lex;

  // Inject styles once for the decision block
  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-decision-block-styles';
    style.textContent = `
      .lex-dec-prompt {
        font-size: var(--lex-body-sm-size);
        font-weight: var(--lex-weight-medium);
        color: var(--lex-chat-accent);
        margin-bottom: 16px;
        line-height: 1.5;
      }

      .lex-dec-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 14px;
      }

      .lex-dec-card {
        background: var(--lex-chat-decision-bg);
        border: 1px solid var(--lex-chat-decision-border);
        border-radius: var(--lex-radius-lg);
        padding: 14px 16px;
        cursor: pointer;
        transition: border-color var(--lex-transition-fast),
                    background var(--lex-transition-fast);
      }

      .lex-dec-card:hover {
        background: var(--lex-chat-decision-hover);
      }

      .lex-dec-card.lex-dec-selected {
        border-color: var(--lex-chat-decision-active);
        background: var(--lex-chat-accent-soft);
      }

      .lex-dec-label {
        font-size: var(--lex-form-font-size);
        font-weight: var(--lex-weight-regular);
        color: var(--lex-chat-text);
        line-height: 1.4;
      }

      .lex-dec-desc {
        font-size: var(--lex-form-help-size);
        color: var(--lex-chat-text-muted);
        margin-top: 4px;
        line-height: 1.4;
      }

      .lex-dec-custom-card {
        background: var(--lex-chat-decision-bg);
        border: 1px solid var(--lex-chat-decision-border);
        border-radius: var(--lex-radius-lg);
        overflow: hidden;
      }

      .lex-dec-input {
        width: 100%;
        box-sizing: border-box;
        background: transparent;
        color: var(--lex-chat-text);
        border: none;
        padding: 14px 16px;
        font-size: var(--lex-form-font-size);
        font-weight: var(--lex-weight-regular);
        outline: none;
      }

      .lex-dec-input::placeholder {
        color: var(--lex-chat-text-dim);
      }

      .lex-dec-input:focus {
        background: var(--lex-chat-decision-hover);
      }

      .lex-dec-actions {
        margin-top: 4px;
      }
    `;
    document.head.appendChild(style);
  }

  SchemaRegistry.register('decision', {
    description: 'Present decision options as selectable cards. Use when the AI needs the user to choose between distinct alternatives before proceeding. Optionally allow a free-text custom response.',
    fields: {
      type:               { type: 'string', required: true, description: 'Must be "decision"' },
      prompt:             { type: 'string', required: true, description: 'Question or prompt text' },
      options:            {
        type: 'array', required: true,
        description: 'Array of option objects with label (string), value (string), description (string, optional)'
      },
      allow_custom:       { type: 'boolean', description: 'Whether to show a custom text input option' },
      custom_placeholder: { type: 'string', description: 'Placeholder for custom input' }
    },
    example: {
      type: 'decision',
      prompt: 'Should I proceed with the final drafting?',
      options: [
        { label: 'Proceed with Standard V4', value: 'standard' },
        { label: 'Draft with custom notice period', value: 'custom' }
      ],
      allow_custom: true,
      custom_placeholder: 'Type your own message...'
    }
  }, function renderDecision(container, block) {
    injectStyles();

    const options = block.options || [];
    const allowCustom = block.allow_custom === true;
    const placeholder = block.custom_placeholder || 'Type your own message...';

    let selectedIdx = -1;
    let customText = '';

    // Build HTML
    let html = '';

    html += '<div class="lex-dec-prompt">' + escapeHtml(block.prompt) + '</div>';

    html += '<div class="lex-dec-list">';
    options.forEach(function (opt, idx) {
      var num = idx + 1;
      html += '<div class="lex-dec-card" data-dec-idx="' + idx + '">';
      html += '<div class="lex-dec-label">' + num + '. ' + escapeHtml(opt.label) + '</div>';
      if (opt.description) {
        html += '<div class="lex-dec-desc">' + escapeHtml(opt.description) + '</div>';
      }
      html += '</div>';
    });

    // Custom input as a card-style option
    if (allowCustom) {
      var customNum = options.length + 1;
      html += '<div class="lex-dec-custom-card">';
      html += '<input type="text" class="lex-dec-input" placeholder="' + customNum + '. ' + escapeHtml(placeholder) + '" />';
      html += '</div>';
    }
    html += '</div>';

    html += '<div class="lex-dec-actions"><lex-btn variant="primary" disabled>Continue</lex-btn></div>';

    container.classList.add('lex-chat-block');
    container.innerHTML = html;

    // References
    var cards = container.querySelectorAll('.lex-dec-card');
    var input = container.querySelector('.lex-dec-input');
    var continueBtn = container.querySelector('lex-btn');

    function updateState() {
      var hasSelection = selectedIdx >= 0;
      var hasCustom = customText.trim().length > 0;
      var enabled = hasSelection || hasCustom;
      if (enabled) {
        continueBtn.removeAttribute('disabled');
      } else {
        continueBtn.setAttribute('disabled', '');
      }
    }

    // Card selection
    container.addEventListener('click', function (e) {
      var card = e.target.closest('[data-dec-idx]');
      if (!card) return;

      var idx = parseInt(card.dataset.decIdx, 10);

      // Deselect all
      cards.forEach(function (c) { c.classList.remove('lex-dec-selected'); });

      // Select clicked
      selectedIdx = idx;
      card.classList.add('lex-dec-selected');

      // Clear custom input when a card is selected
      if (input) {
        input.value = '';
        customText = '';
      }

      updateState();
    });

    // Custom input
    if (input) {
      input.addEventListener('input', function () {
        customText = input.value;

        // Deselect cards when user types
        if (customText.trim().length > 0) {
          cards.forEach(function (c) { c.classList.remove('lex-dec-selected'); });
          selectedIdx = -1;
        }

        updateState();
      });
    }

    // Continue button
    continueBtn.addEventListener('click', function () {
      if (continueBtn.hasAttribute('disabled')) return;

      var detail;

      if (selectedIdx >= 0) {
        var opt = options[selectedIdx];
        detail = { value: opt.value, label: opt.label, custom: null };
      } else {
        detail = { value: customText.trim(), label: null, custom: customText.trim() };
      }

      container.dispatchEvent(new CustomEvent('lex-decision', {
        detail: detail,
        bubbles: true
      }));
    });
  });

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
})();
