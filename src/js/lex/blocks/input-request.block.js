/* Lex UI — Input Request Block
   AI requests free-text input from the user with context and guidance.
   Dogfoods <lex-input>, <lex-textarea>, and <lex-btn> components.
   Emits 'lex-input-response' with { field, value } on submit.
*/

(function () {
  'use strict';

  const { SchemaRegistry } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-input-request-block-styles';
    style.textContent = `
      .lex-ir-prompt {
        font-size: var(--lex-body-sm-size, 0.875rem);
        font-weight: var(--lex-weight-medium, 500);
        color: var(--lex-chat-accent, var(--lex-text-accent));
        margin-bottom: 12px;
        line-height: 1.5;
      }

      .lex-ir-form {
        display: flex;
        gap: 8px;
        align-items: flex-end;
      }

      .lex-ir-form > :first-child {
        flex: 1;
        min-width: 0;
      }

      .lex-ir-hint {
        font-size: var(--lex-form-help-size, 0.6875rem);
        color: var(--lex-text-tertiary, #999);
        margin-top: 8px;
        line-height: 1.4;
      }
    `;
    document.head.appendChild(style);
  }

  SchemaRegistry.register('input_request', {
    description: 'Request free-text input from the user. Use when you need the user to provide a specific piece of information (date, name, description, etc.) before you can proceed.',
    fields: {
      type:         { type: 'string', required: true, description: 'Must be "input_request"' },
      prompt:       { type: 'string', required: true, description: 'Question or instruction for the user' },
      field:        { type: 'string', required: true, description: 'Field name identifier (e.g. "date_range", "client_name")' },
      input_type:   { type: 'string', description: 'Input type: "text" (default), "email", "number", "date", "textarea"' },
      placeholder:  { type: 'string', description: 'Placeholder text for the input' },
      submit_label: { type: 'string', description: 'Button label (default: "Submit")' },
      hint:         { type: 'string', description: 'Optional help text below the input' }
    },
    example: {
      type: 'input_request',
      prompt: 'What date range should I search for?',
      field: 'date_range',
      input_type: 'text',
      placeholder: 'e.g. January 2024 - March 2024',
      submit_label: 'Search'
    }
  }, function renderInputRequest(container, block) {
    injectStyles();

    var field = block.field || 'response';
    var inputType = block.input_type || 'text';
    var placeholder = block.placeholder || '';
    var submitLabel = block.submit_label || 'Submit';
    var isTextarea = inputType === 'textarea';

    container.classList.add('lex-chat-block');
    container.innerHTML = '';

    // Prompt text
    var promptDiv = document.createElement('div');
    promptDiv.className = 'lex-ir-prompt';
    promptDiv.textContent = block.prompt;
    container.appendChild(promptDiv);

    // Form row: input + button
    var formRow = document.createElement('div');
    formRow.className = 'lex-ir-form';

    // Lex input or textarea component
    // NOTE: Use property assignment, NOT setAttribute('type', ...).
    // Tailwind preflight matches [type='text'] on ANY element, which
    // would apply form-reset styles to the custom element wrapper.
    var inputEl;
    if (isTextarea) {
      inputEl = document.createElement('lex-textarea');
      inputEl.rows = 3;
    } else {
      inputEl = document.createElement('lex-input');
      inputEl.type = inputType;
    }
    inputEl.name = field;
    inputEl.placeholder = placeholder;

    // Lex button component
    var btnEl = document.createElement('lex-btn');
    btnEl.variant = 'primary';
    btnEl.disabled = true;
    btnEl.textContent = submitLabel;

    formRow.appendChild(inputEl);
    formRow.appendChild(btnEl);
    container.appendChild(formRow);

    // Hint text
    if (block.hint) {
      var hintDiv = document.createElement('div');
      hintDiv.className = 'lex-ir-hint';
      hintDiv.textContent = block.hint;
      container.appendChild(hintDiv);
    }

    // ── Submit logic ──────────────────────────────────────────────

    function submitValue() {
      var value = (inputEl.value || '').trim();
      if (!value) return;
      container.dispatchEvent(new CustomEvent('lex-input-response', {
        detail: { field: field, value: value },
        bubbles: true
      }));
    }

    // Enable/disable button based on input value
    function updateState() {
      var val = (inputEl.value || '').trim();
      btnEl.disabled = val.length === 0;
    }

    inputEl.addEventListener('lex-input', updateState);

    // Submit on Enter for single-line inputs (keydown bubbles from inner input)
    if (!isTextarea) {
      inputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !btnEl.disabled) {
          e.preventDefault();
          submitValue();
        }
      });
    }

    // Submit on button click
    btnEl.addEventListener('click', function () {
      if (!btnEl.disabled) submitValue();
    });

    // Auto-focus the inner native input
    requestAnimationFrame(function () {
      var inner = inputEl.querySelector('input, textarea');
      if (inner) inner.focus();
    });
  });
})();
