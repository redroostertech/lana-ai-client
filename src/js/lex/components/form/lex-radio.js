/* Lex UI — Radio Group Component
   Styled radio button group with vertical/horizontal layouts.

   Usage:
     <lex-radio label="Priority" value="medium"
       options='[{"value":"low","label":"Low"},{"value":"medium","label":"Medium"},{"value":"high","label":"High"}]'>
     </lex-radio>

     <lex-radio direction="horizontal"
       options='[{"value":"a","label":"Option A","description":"First choice"},{"value":"b","label":"Option B"}]'>
     </lex-radio>

   Events: lex-change { name, value: string }
*/

(function () {
  'use strict';

  const { LexElement, defineLex, withFormField } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-radio-styles';
    style.textContent = `
      lex-radio {
        display: block;
      }

      .lex-radio-group {
        display: flex;
        gap: 8px;
      }

      .lex-radio-group--vertical {
        flex-direction: column;
      }

      .lex-radio-group--horizontal {
        flex-direction: row;
        flex-wrap: wrap;
        gap: 16px;
      }

      .lex-radio-row {
        display: inline-flex;
        align-items: flex-start;
        gap: 8px;
        cursor: pointer;
        user-select: none;
        padding: 2px 0;
      }

      .lex-radio-row--disabled {
        opacity: var(--lex-input-disabled-opacity, 0.5);
        cursor: not-allowed;
      }

      /* ── Custom radio circle ───────────────────────────── */

      .lex-radio-circle {
        position: relative;
        width: 18px;
        height: 18px;
        flex-shrink: 0;
        border: none;
        border-radius: 50%;
        background: var(--lex-color-gray-200);
        transition: background 0.15s ease;
        margin-top: 1px;
      }

      .lex-radio-circle--selected {
        background: var(--lex-bg-accent-soft);
      }

      .lex-radio-dot {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) scale(0);
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--lex-bg-accent);
        transition: transform 0.15s ease;
      }

      .lex-radio-circle--selected .lex-radio-dot {
        transform: translate(-50%, -50%) scale(1);
      }

      .lex-radio-content {
        display: flex;
        flex-direction: column;
        gap: 1px;
      }

      .lex-radio-label {
        font-size: var(--lex-form-font-size, 0.8125rem);
        color: var(--lex-text-primary);
        line-height: 1.4;
      }

      .lex-radio-desc {
        font-size: var(--lex-form-help-size, 0.6875rem);
        color: var(--lex-text-tertiary);
        line-height: 1.4;
      }

      /* Hidden native for a11y */
      .lex-radio-native {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0,0,0,0);
        white-space: nowrap;
        border: 0;
      }

      .lex-radio-row:focus-within .lex-radio-circle {
        box-shadow: 0 0 0 3px rgba(89, 82, 70, var(--lex-input-focus-ring-alpha, 0.2));
      }
    `;
    document.head.appendChild(style);
  }

  class LexRadio extends withFormField(LexElement) {
    static get properties() {
      return {
        ...super.properties,
        options:   { type: Array, default: [] },
        direction: { type: String, default: 'vertical' }
      };
    }

    render() {
      injectStyles();

      const options = this.options || [];
      const dirCls = this.direction === 'horizontal' ? 'lex-radio-group--horizontal' : 'lex-radio-group--vertical';
      const disabledAttr = this.disabled ? 'disabled' : '';
      const disabledCls = this.disabled ? ' lex-radio-row--disabled' : '';

      let groupHtml = `<div class="lex-radio-group ${dirCls}" role="radiogroup">`;

      options.forEach((opt) => {
        const isSelected = this.value === opt.value;
        const circleCls = isSelected ? 'lex-radio-circle lex-radio-circle--selected' : 'lex-radio-circle';

        groupHtml += `
          <label class="lex-radio-row${disabledCls}">
            <div class="${circleCls}">
              <input type="radio" class="lex-radio-native"
                name="${this.escapeHtml(this.name)}"
                value="${this.escapeHtml(opt.value)}"
                ${isSelected ? 'checked' : ''} ${disabledAttr} />
              <div class="lex-radio-dot"></div>
            </div>
            <div class="lex-radio-content">
              <span class="lex-radio-label">${this.escapeHtml(opt.label)}</span>
              ${opt.description ? `<span class="lex-radio-desc">${this.escapeHtml(opt.description)}</span>` : ''}
            </div>
          </label>
        `;
      });

      groupHtml += '</div>';

      return this._renderFieldWrapper(groupHtml);
    }

    updated() {
      this.delegate('change', '.lex-radio-native', (e, target) => {
        this._props.value = target.value;
        this._emitChange(target.value);
        this._scheduleUpdate();
      });
    }
  }

  defineLex('lex-radio', LexRadio);
})();
