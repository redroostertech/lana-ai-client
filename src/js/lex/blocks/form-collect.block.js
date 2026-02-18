/* Lex UI — Form Collect Block
   AI presents a mini-form to collect multiple structured fields at once.
   Dogfoods Lex form components: <lex-input>, <lex-textarea>, <lex-select>, <lex-btn>.
   Emits 'lex-form-submit' with { values: { field: value, ... } } on submit.
*/

(function () {
  'use strict';

  const { SchemaRegistry } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-form-collect-block-styles';
    style.textContent = `
      .lex-fc-title {
        font-size: var(--lex-body-sm-size, 0.875rem);
        font-weight: var(--lex-weight-medium, 500);
        color: var(--lex-chat-accent, var(--lex-text-accent));
        margin-bottom: 16px;
        line-height: 1.5;
      }

      .lex-fc-fields {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 16px;
      }

      .lex-fc-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
    `;
    document.head.appendChild(style);
  }

  SchemaRegistry.register('form_collect', {
    description: 'Collect structured data from the user via a mini-form. Use when you need multiple pieces of information at once (e.g. creating a matter, scheduling a meeting, setting preferences).',
    fields: {
      type:         { type: 'string', required: true, description: 'Must be "form_collect"' },
      title:        { type: 'string', description: 'Form title/prompt' },
      fields:       {
        type: 'array', required: true,
        description: 'Array of field definitions: { name(str,req), label(str,req), type("text"|"email"|"number"|"date"|"select"|"textarea"), required(bool), placeholder(str), options(str[] for select) }'
      },
      submit_label: { type: 'string', description: 'Submit button label (default: "Submit")' }
    },
    example: {
      type: 'form_collect',
      title: 'New Matter Details',
      fields: [
        { name: 'matter_name', label: 'Matter Name', type: 'text', required: true },
        { name: 'client', label: 'Client', type: 'text', placeholder: 'Client name' },
        { name: 'priority', label: 'Priority', type: 'select', options: ['High', 'Medium', 'Low'] }
      ],
      submit_label: 'Create Matter'
    }
  }, function renderFormCollect(container, block) {
    injectStyles();

    var fields = block.fields || [];
    var submitLabel = block.submit_label || 'Submit';

    container.classList.add('lex-chat-block');
    container.innerHTML = '';

    // Title
    if (block.title) {
      var titleDiv = document.createElement('div');
      titleDiv.className = 'lex-fc-title';
      titleDiv.textContent = block.title;
      container.appendChild(titleDiv);
    }

    // Fields container
    var fieldsDiv = document.createElement('div');
    fieldsDiv.className = 'lex-fc-fields';

    var fieldRefs = [];

    fields.forEach(function (field, idx) {
      var name = field.name || 'field_' + idx;
      var label = field.label || name;
      var type = field.type || 'text';
      var placeholder = field.placeholder || '';
      var required = field.required === true;

      // NOTE: Use property assignment, NOT setAttribute('type', ...).
      // Tailwind preflight matches [type='text'] on ANY element, which
      // would apply form-reset styles to the custom element wrapper.
      var el;

      if (type === 'select' && Array.isArray(field.options)) {
        el = document.createElement('lex-select');
        // Convert string[] to { value, label }[] for lex-select
        el.options = field.options.map(function (opt) {
          return { value: opt, label: opt };
        });
        el.placeholder = 'Select...';
      } else if (type === 'textarea') {
        el = document.createElement('lex-textarea');
        el.rows = 3;
        el.placeholder = placeholder;
      } else {
        el = document.createElement('lex-input');
        el.type = type;
        el.placeholder = placeholder;
      }

      el.name = name;
      el.label = label;
      el.required = required;

      fieldsDiv.appendChild(el);
      fieldRefs.push({ name: name, required: required, el: el });
    });

    container.appendChild(fieldsDiv);

    // Actions row: submit button
    var actionsDiv = document.createElement('div');
    actionsDiv.className = 'lex-fc-actions';

    var btnEl = document.createElement('lex-btn');
    btnEl.variant = 'primary';
    btnEl.disabled = true;
    btnEl.textContent = submitLabel;
    actionsDiv.appendChild(btnEl);

    container.appendChild(actionsDiv);

    // ── Validation: enable button when all required fields are filled ──

    function checkValidity() {
      var allFilled = true;
      fieldRefs.forEach(function (ref) {
        if (!ref.required) return;
        var val = ref.el.value;
        if (!val || (typeof val === 'string' && !val.trim())) {
          allFilled = false;
        }
      });
      btnEl.disabled = !allFilled;
    }

    // Listen for value changes on all field components
    fieldsDiv.addEventListener('lex-input', checkValidity);
    fieldsDiv.addEventListener('lex-change', checkValidity);

    // ── Submit handler ────────────────────────────────────────────

    btnEl.addEventListener('click', function () {
      if (btnEl.disabled) return;

      var values = {};
      fieldRefs.forEach(function (ref) {
        var val = ref.el.value;
        values[ref.name] = typeof val === 'string' ? val.trim() : val;
      });

      container.dispatchEvent(new CustomEvent('lex-form-submit', {
        detail: { values: values },
        bubbles: true
      }));
    });

    // Auto-focus first field
    requestAnimationFrame(function () {
      if (fieldRefs.length > 0) {
        var inner = fieldRefs[0].el.querySelector('input, textarea, [tabindex]');
        if (inner) inner.focus();
      }
    });
  });
})();
