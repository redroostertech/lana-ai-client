/* Lex UI — Textarea Component
   Multi-line text input with auto-resize, character count, sizes.

   Usage:
     <lex-textarea label="Notes" placeholder="Enter notes..." rows="3"></lex-textarea>
     <lex-textarea label="Bio" auto-resize="true" max-rows="8" show-count="true" maxlength="500"></lex-textarea>

   Sizes: sm | md | lg
   Events: lex-input (keystroke), lex-change (blur/commit)
*/

(function () {
  'use strict';

  const { LexElement, defineLex, withFormField } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-textarea-styles';
    style.textContent = `
      lex-textarea {
        display: block;
      }

      textarea.lex-field-input {
        resize: vertical;
        line-height: 1.5;
        padding: 10px 12px;
        min-height: 80px;
        height: auto;
      }

      textarea.lex-field-input.lex-textarea--no-resize {
        resize: none;
      }

      .lex-textarea-footer {
        display: flex;
        justify-content: flex-end;
      }

      .lex-textarea-count {
        font-size: var(--lex-form-counter-size, 0.625rem);
        color: var(--lex-text-tertiary);
        letter-spacing: 0.02em;
      }

      .lex-textarea-count--over {
        color: var(--lex-color-danger-500);
      }
    `;
    document.head.appendChild(style);
  }

  class LexTextarea extends withFormField(LexElement) {
    static get properties() {
      return {
        ...super.properties,
        placeholder: { type: String, default: '' },
        rows:        { type: Number, default: 3 },
        maxRows:     { type: Number, default: 0 },
        autoResize:  { type: Boolean, default: false },
        maxlength:   { type: Number, default: 0 },
        showCount:   { type: Boolean, default: false }
      };
    }

    render() {
      injectStyles();

      const maxlenAttr = this.maxlength > 0 ? `maxlength="${this.maxlength}"` : '';
      const disabledAttr = this.disabled ? 'disabled' : '';
      const readonlyAttr = this.readonly ? 'readonly' : '';
      const requiredAttr = this.required ? 'required' : '';
      const resizeCls = this.autoResize ? ' lex-textarea--no-resize' : '';

      // Size class affects font-size/padding
      const sizeCls = ` lex-field-input--${this.size || 'md'}`;

      let html = `<textarea
        class="lex-field-input${sizeCls}${resizeCls}${this.error ? ' lex-field-input--error' : ''}"
        rows="${this.rows}"
        placeholder="${this.escapeHtml(this.placeholder)}"
        name="${this.escapeHtml(this.name)}"
        ${maxlenAttr} ${disabledAttr} ${readonlyAttr} ${requiredAttr}
      >${this.escapeHtml(this.value || '')}</textarea>`;

      // Character count
      if (this.showCount && this.maxlength > 0) {
        const len = (this.value || '').length;
        const overCls = len > this.maxlength ? ' lex-textarea-count--over' : '';
        html += `<div class="lex-textarea-footer"><span class="lex-textarea-count${overCls}">${len}/${this.maxlength}</span></div>`;
      }

      return this._renderFieldWrapper(html);
    }

    updated() {
      const textarea = this.querySelector('textarea');
      if (!textarea) return;

      // Auto-resize setup
      if (this.autoResize) {
        this._autoResizeTextarea(textarea);
      }

      // Input event
      this.listen(textarea, 'input', (e) => {
        this._props.value = e.target.value;
        this._emitInput(e.target.value);

        if (this.autoResize) {
          this._autoResizeTextarea(textarea);
        }

        // Re-render for count
        if (this.showCount) {
          const counter = this.querySelector('.lex-textarea-count');
          if (counter) {
            const len = e.target.value.length;
            counter.textContent = `${len}/${this.maxlength}`;
            counter.classList.toggle('lex-textarea-count--over', len > this.maxlength);
          }
        }
      });

      // Change event
      this.listen(textarea, 'change', (e) => {
        this._emitChange(e.target.value);
      });
    }

    _autoResizeTextarea(el) {
      el.style.height = 'auto';
      let targetHeight = el.scrollHeight;

      // Cap at maxRows if set
      if (this.maxRows > 0) {
        const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
        const padding = parseFloat(getComputedStyle(el).paddingTop) + parseFloat(getComputedStyle(el).paddingBottom);
        const maxHeight = (this.maxRows * lineHeight) + padding;
        if (targetHeight > maxHeight) {
          targetHeight = maxHeight;
          el.style.overflowY = 'auto';
        } else {
          el.style.overflowY = 'hidden';
        }
      }

      el.style.height = targetHeight + 'px';
    }
  }

  defineLex('lex-textarea', LexTextarea);
})();
