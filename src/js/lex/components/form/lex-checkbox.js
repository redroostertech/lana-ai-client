/* Lex UI — Checkbox Component
   Single checkbox or checkbox group with styled custom check marks.

   Usage:
     Single:
       <lex-checkbox label="I agree" checked="true"></lex-checkbox>

     Group:
       <lex-checkbox label="Interests"
         items='[{"value":"a","label":"Option A"},{"value":"b","label":"Option B","checked":true}]'>
       </lex-checkbox>

   Events: lex-change { name, value: Boolean (single) | Array (group) }
*/

(function () {
  'use strict';

  const { LexElement, defineLex, withFormField } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-checkbox-styles';
    style.textContent = `
      lex-checkbox {
        display: block;
      }

      .lex-checkbox-row {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        user-select: none;
        padding: 2px 0;
      }

      .lex-checkbox-row--disabled {
        opacity: var(--lex-input-disabled-opacity, 0.5);
        cursor: not-allowed;
      }

      .lex-checkbox-box {
        position: relative;
        width: 18px;
        height: 18px;
        flex-shrink: 0;
        border: none;
        border-radius: var(--lex-radius-sm);
        background: var(--lex-color-gray-200);
        transition: background 0.15s ease;
      }

      .lex-checkbox-box--checked {
        background: var(--lex-bg-accent);
        border-color: var(--lex-bg-accent);
      }

      .lex-checkbox-box--indeterminate {
        background: var(--lex-bg-accent);
        border-color: var(--lex-bg-accent);
      }

      .lex-checkbox-check {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 12px;
        height: 12px;
        color: var(--lex-color-white);
        opacity: 0;
        transition: opacity 0.15s ease;
      }

      .lex-checkbox-box--checked .lex-checkbox-check,
      .lex-checkbox-box--indeterminate .lex-checkbox-check {
        opacity: 1;
      }

      .lex-checkbox-text {
        font-size: var(--lex-form-font-size, 0.8125rem);
        color: var(--lex-text-primary);
        line-height: 1.4;
      }

      .lex-checkbox-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      /* Hidden native for accessibility */
      .lex-checkbox-native {
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

      .lex-checkbox-row:focus-within .lex-checkbox-box {
        box-shadow: 0 0 0 3px rgba(89, 82, 70, var(--lex-input-focus-ring-alpha, 0.2));
      }
    `;
    document.head.appendChild(style);
  }

  const CHECK_SVG = '<svg class="lex-checkbox-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  const DASH_SVG = '<svg class="lex-checkbox-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="6" y1="12" x2="18" y2="12"/></svg>';

  class LexCheckbox extends withFormField(LexElement) {
    static get properties() {
      return {
        ...super.properties,
        checked:       { type: Boolean, default: false, reflect: true },
        indeterminate: { type: Boolean, default: false },
        items:         { type: Array, default: [] }
      };
    }

    _isGroupMode() {
      return Array.isArray(this.items) && this.items.length > 0;
    }

    render() {
      injectStyles();

      if (this._isGroupMode()) {
        return this._renderGroup();
      }
      return this._renderSingle();
    }

    _renderSingle() {
      const boxCls = this.indeterminate
        ? 'lex-checkbox-box lex-checkbox-box--indeterminate'
        : (this.checked ? 'lex-checkbox-box lex-checkbox-box--checked' : 'lex-checkbox-box');
      const icon = this.indeterminate ? DASH_SVG : CHECK_SVG;
      const disabledCls = this.disabled ? ' lex-checkbox-row--disabled' : '';
      const checkedAttr = this.checked ? 'checked' : '';
      const disabledAttr = this.disabled ? 'disabled' : '';

      const html = `
        <label class="lex-checkbox-row${disabledCls}">
          <div class="${boxCls}">
            <input type="checkbox" class="lex-checkbox-native" ${checkedAttr} ${disabledAttr}
              name="${this.escapeHtml(this.name)}" />
            ${icon}
          </div>
          ${this.label ? `<span class="lex-checkbox-text">${this.escapeHtml(this.label)}</span>` : ''}
        </label>
      `;

      if (this.help || this.error) {
        return `<div class="lex-field">${html}${this._renderError()}${this._renderHelp()}</div>`;
      }
      return html;
    }

    _renderGroup() {
      let groupHtml = '<div class="lex-checkbox-group">';
      this.items.forEach((item, idx) => {
        const isChecked = !!item.checked;
        const boxCls = isChecked ? 'lex-checkbox-box lex-checkbox-box--checked' : 'lex-checkbox-box';
        const disabledCls = this.disabled ? ' lex-checkbox-row--disabled' : '';
        const disabledAttr = this.disabled ? 'disabled' : '';

        groupHtml += `
          <label class="lex-checkbox-row${disabledCls}">
            <div class="${boxCls}">
              <input type="checkbox" class="lex-checkbox-native" data-idx="${idx}"
                ${isChecked ? 'checked' : ''} ${disabledAttr}
                name="${this.escapeHtml(this.name)}" value="${this.escapeHtml(item.value)}" />
              ${CHECK_SVG}
            </div>
            <span class="lex-checkbox-text">${this.escapeHtml(item.label)}</span>
          </label>
        `;
      });
      groupHtml += '</div>';

      return this._renderFieldWrapper(groupHtml);
    }

    updated() {
      if (this._isGroupMode()) {
        this._setupGroupEvents();
      } else {
        this._setupSingleEvents();
      }
    }

    _setupSingleEvents() {
      const row = this.querySelector('.lex-checkbox-row');
      if (!row || this.disabled) return;

      const native = this.querySelector('.lex-checkbox-native');
      if (native) {
        this.listen(native, 'change', (e) => {
          this.checked = e.target.checked;
          this.indeterminate = false;
          this._emitChange(this.checked);
        });
      }
    }

    _setupGroupEvents() {
      this.delegate('change', '.lex-checkbox-native', (e, target) => {
        const idx = parseInt(target.dataset.idx);
        if (!isNaN(idx) && this.items[idx]) {
          // Update the items array
          const newItems = JSON.parse(JSON.stringify(this.items));
          newItems[idx].checked = target.checked;
          this.items = newItems;

          // Emit value as array of checked values
          const checkedValues = newItems.filter(i => i.checked).map(i => i.value);
          this._emitChange(checkedValues);
        }
      });
    }
  }

  defineLex('lex-checkbox', LexCheckbox);
})();
