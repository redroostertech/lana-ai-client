/* Lex UI — Toggle (Switch) Component
   Pill-shaped toggle switch with animated knob.

   Usage:
     <lex-toggle label="Dark Mode" checked="true"></lex-toggle>
     <lex-toggle label="Notifications" label-side="left" size="sm"></lex-toggle>

   Sizes: sm (36x20), md (44x24)
   Events: lex-change { name, value: Boolean }
*/

(function () {
  'use strict';

  const { LexElement, defineLex, withFormField } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-toggle-styles';
    style.textContent = `
      lex-toggle {
        display: block;
      }

      .lex-toggle-row {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        cursor: pointer;
        user-select: none;
      }

      .lex-toggle-row--disabled {
        opacity: var(--lex-input-disabled-opacity, 0.5);
        cursor: not-allowed;
      }

      .lex-toggle-label {
        font-size: var(--lex-form-font-size, 0.8125rem);
        font-weight: var(--lex-weight-regular, 400);
        color: var(--lex-text-primary);
        letter-spacing: 0.01em;
      }

      /* ── Track ─────────────────────────────────────────── */

      .lex-toggle-track {
        position: relative;
        flex-shrink: 0;
        border-radius: var(--lex-radius-full);
        background: var(--lex-toggle-bg, var(--lex-color-gray-300));
        transition: background 0.2s ease;
      }

      .lex-toggle-track--md {
        width: 44px;
        height: 24px;
      }

      .lex-toggle-track--sm {
        width: 36px;
        height: 20px;
      }

      .lex-toggle-track--checked {
        background: var(--lex-toggle-bg-active, var(--lex-bg-accent));
      }

      .lex-toggle-track--mixed {
        background: var(--lex-toggle-bg-active, var(--lex-bg-accent));
      }

      /* ── Knob ──────────────────────────────────────────── */

      .lex-toggle-knob {
        position: absolute;
        top: 2px;
        left: 2px;
        border-radius: 50%;
        background: var(--lex-toggle-knob, var(--lex-color-white));
        box-shadow: var(--lex-shadow-sm);
        transition: transform 0.2s ease;
      }

      .lex-toggle-knob--md {
        width: 20px;
        height: 20px;
      }

      .lex-toggle-knob--sm {
        width: 16px;
        height: 16px;
      }

      .lex-toggle-track--checked .lex-toggle-knob--md {
        transform: translateX(20px);
      }

      .lex-toggle-track--checked .lex-toggle-knob--sm {
        transform: translateX(16px);
      }

      .lex-toggle-track--mixed .lex-toggle-knob--md {
        transform: translateX(10px);
      }

      .lex-toggle-track--mixed .lex-toggle-knob--sm {
        transform: translateX(8px);
      }

      /* Hidden native input for accessibility */
      .lex-toggle-native {
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

      .lex-toggle-track:focus-within {
        box-shadow: var(--lex-focus-ring, 0 0 0 3px rgba(89, 82, 70, 0.3));
      }
    `;
    document.head.appendChild(style);
  }

  class LexToggle extends withFormField(LexElement) {
    static get properties() {
      return {
        ...super.properties,
        checked:   { type: Boolean, default: false, reflect: true },
        mixed:     { type: Boolean, default: false, reflect: true },
        labelSide: { type: String, default: 'right' }
      };
    }

    render() {
      injectStyles();

      const sz = this.size === 'sm' ? 'sm' : 'md';
      const mixedCls = this.mixed && !this.checked ? ' lex-toggle-track--mixed' : '';
      const checkedCls = this.checked ? ' lex-toggle-track--checked' : '';
      const disabledCls = this.disabled ? ' lex-toggle-row--disabled' : '';
      const checkedAttr = this.checked ? 'checked' : '';
      const disabledAttr = this.disabled ? 'disabled' : '';
      const ariaChecked = this.mixed && !this.checked ? 'mixed' : String(Boolean(this.checked));
      const fallbackLabel = this.name ? String(this.name).replace(/[_-]+/g, ' ') : 'Toggle';
      const ariaLabel = this.label || this.getAttribute('aria-label') || fallbackLabel;

      const track = `
        <div class="lex-toggle-track lex-toggle-track--${sz}${checkedCls}${mixedCls}">
          <input type="checkbox" class="lex-toggle-native" ${checkedAttr} ${disabledAttr}
            name="${this.escapeHtml(this.name)}"
            aria-label="${this.escapeHtml(ariaLabel)}"
            aria-checked="${ariaChecked}" />
          <div class="lex-toggle-knob lex-toggle-knob--${sz}"></div>
        </div>
      `;

      const label = this.label
        ? `<span class="lex-toggle-label">${this.escapeHtml(this.label)}</span>`
        : '';

      const inner = this.labelSide === 'left'
        ? `<div class="lex-toggle-row${disabledCls}">${label}${track}</div>`
        : `<div class="lex-toggle-row${disabledCls}">${track}${label}</div>`;

      // Use field wrapper only if help/error text is present
      if (this.help || this.error) {
        return this._renderFieldWrapper(inner);
      }
      return inner;
    }

    updated() {
      const row = this.querySelector('.lex-toggle-row');
      if (!row || this.disabled) return;

      this.listen(row, 'click', (e) => {
        if (e.target.closest('.lex-toggle-native')) return; // Let native handle
        this.checked = this.mixed && !this.checked ? true : !this.checked;
        this.mixed = false;
        this._emitChange(this.checked);
      });

      const native = this.querySelector('.lex-toggle-native');
      if (native) {
        native.indeterminate = this.mixed && !this.checked;
        native.setAttribute('aria-checked', native.indeterminate ? 'mixed' : String(Boolean(native.checked)));
        this.listen(native, 'change', (e) => {
          this.checked = e.target.checked;
          this.mixed = false;
          this._emitChange(this.checked);
        });
      }
    }
  }

  defineLex('lex-toggle', LexToggle);
})();
