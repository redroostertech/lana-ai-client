/* ==========================================================================
   Lex UI — Form Field Layer
   Mixin that adds consistent form behaviour to any LexElement:
   label, help text, error state, sizes, disabled/readonly, and change events.

   Follows the same pattern as lex.data.js → withDataSource.

   Provides:
     - withFormField(BaseClass): Mixin adding form properties + helpers
   ========================================================================== */

(function (global) {
  'use strict';

  // =========================================================================
  // Shared form base styles — injected once by the first form component
  // =========================================================================

  let baseStylesInjected = false;

  function injectFormBaseStyles() {
    if (baseStylesInjected) return;
    baseStylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-form-base-styles';
    style.textContent = `
      /* ── Field wrapper ─────────────────────────────────── */

      .lex-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        width: 100%;
      }

      /* ── Label ─────────────────────────────────────────── */

      .lex-field-label {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: var(--lex-form-label-size, 0.8125rem);
        font-weight: var(--lex-weight-medium, 500);
        color: var(--lex-text-primary);
        letter-spacing: 0.01em;
        line-height: 1.4;
      }

      .lex-field-required {
        color: var(--lex-color-danger-500);
        font-weight: var(--lex-weight-regular, 400);
      }

      /* ── Help text ─────────────────────────────────────── */

      .lex-field-help {
        font-size: var(--lex-form-help-size, 0.6875rem);
        font-weight: var(--lex-weight-light, 300);
        color: var(--lex-text-tertiary);
        letter-spacing: 0.02em;
        line-height: 1.4;
      }

      /* ── Error message ─────────────────────────────────── */

      .lex-field-error {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: var(--lex-form-help-size, 0.6875rem);
        font-weight: var(--lex-weight-regular, 400);
        color: var(--lex-color-danger-500);
        letter-spacing: 0.02em;
        line-height: 1.4;
      }

      .lex-field-error svg {
        width: 12px;
        height: 12px;
        flex-shrink: 0;
      }

      /* ── Success message ───────────────────────────────── */

      .lex-field-success {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: var(--lex-form-help-size, 0.6875rem);
        font-weight: var(--lex-weight-regular, 400);
        color: var(--lex-color-success-500);
        letter-spacing: 0.02em;
        line-height: 1.4;
      }

      .lex-field-success svg {
        width: 12px;
        height: 12px;
        flex-shrink: 0;
      }

      /* ── Tooltip ───────────────────────────────────────── */

      .lex-field-label-wrap {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .lex-field-tooltip-trigger {
        position: relative;
        display: inline-flex;
        align-items: center;
        cursor: help;
        color: var(--lex-text-tertiary);
      }

      .lex-field-tooltip-trigger svg {
        width: 14px;
        height: 14px;
      }

      .lex-field-tooltip {
        position: absolute;
        bottom: calc(100% + 6px);
        left: 50%;
        transform: translateX(-50%);
        padding: 6px 10px;
        background: var(--lex-color-gray-800);
        color: var(--lex-color-white);
        font-size: var(--lex-form-help-size, 0.6875rem);
        font-weight: var(--lex-weight-regular, 400);
        line-height: 1.4;
        letter-spacing: 0.01em;
        border-radius: var(--lex-radius-md);
        white-space: nowrap;
        max-width: 220px;
        white-space: normal;
        pointer-events: none;
        opacity: 0;
        transition: opacity var(--lex-transition-fast);
        z-index: var(--lex-z-dropdown);
        box-shadow: var(--lex-shadow-md);
      }

      .lex-field-tooltip::after {
        content: '';
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        border: 4px solid transparent;
        border-top-color: var(--lex-color-gray-800);
      }

      .lex-field-tooltip-trigger:hover .lex-field-tooltip {
        opacity: 1;
      }

      /* ── Input base (shared across text input, textarea, select trigger) */

      .lex-field-input {
        width: 100%;
        box-sizing: border-box;
        font-family: inherit;
        font-size: var(--lex-form-font-size, 0.8125rem);
        color: var(--lex-input-text, var(--lex-text-primary));
        background: var(--lex-color-gray-50);
        border: 0 none !important;
        border-width: 0 !important;
        border-color: transparent !important;
        border-radius: var(--lex-input-radius);
        outline: none;
        transition: background 0.2s ease, box-shadow 0.2s ease;
        -webkit-appearance: none;
        appearance: none;
      }

      .lex-field-input::placeholder {
        color: var(--lex-input-placeholder, var(--lex-text-tertiary));
        font-weight: var(--lex-weight-light, 300);
      }

      .lex-field-input:hover:not(:disabled):not(:focus):not(.lex-field-input--error) {
        background: var(--lex-bg-tertiary);
      }

      .lex-field-input:focus {
        background: var(--lex-color-gray-50);
        box-shadow: none;
      }

      .lex-field-input--error {
        box-shadow: none;
      }

      .lex-field-input--error:focus {
        box-shadow: none;
      }

      .lex-field-input--success {
        box-shadow: none;
      }

      .lex-field-input:disabled {
        opacity: var(--lex-input-disabled-opacity);
        cursor: not-allowed;
      }

      .lex-field-input[readonly] {
        background: var(--lex-bg-tertiary);
      }

      /* ── Size variants ─────────────────────────────────── */

      .lex-field-input--sm {
        height: var(--lex-input-height-sm);
        padding: 0 10px;
        font-size: var(--lex-form-font-size-sm, 0.75rem);
      }

      .lex-field-input--md {
        height: var(--lex-input-height-md);
        padding: 0 12px;
        font-size: var(--lex-form-font-size, 0.8125rem);
      }

      .lex-field-input--lg {
        height: var(--lex-input-height-lg);
        padding: 0 14px;
        font-size: var(--lex-form-font-size-lg, 0.875rem);
      }
    `;
    document.head.appendChild(style);

    // Tailwind (@tailwindcss/forms) injects after our styles and adds borders.
    // Inject override after a delay so it appears after Tailwind; run twice for slow CDN.
    setTimeout(injectTailwindFormOverride, 200);
    setTimeout(injectTailwindFormOverride, 1200);
  }

  /** Override Tailwind form styles (border etc.). Injected after a delay so it runs after Tailwind. */
  function injectTailwindFormOverride() {
    var el = document.getElementById('lex-form-tailwind-override');
    if (el) {
      document.head.appendChild(el);
      return;
    }
    el = document.createElement('style');
    el.id = 'lex-form-tailwind-override';
    el.textContent = `
      lex-input input.lex-field-input,
      lex-input input[type="text"],
      lex-input input:where(:not([type])),
      lex-input input[type="email"],
      lex-input input[type="password"],
      lex-input input[type="search"],
      lex-input input[type="url"],
      lex-input input[type="number"],
      lex-textarea textarea.lex-field-input,
      lex-textarea textarea,
      lex-format-input input.lex-field-input,
      lex-select input.lex-field-input,
      lex-search input,
      lex-dropdown-btn input,
      .lex-field-input {
        border: 0 none !important;
        border-width: 0 !important;
        border-color: transparent !important;
        box-shadow: none !important;
      }
    `;
    document.head.appendChild(el);
  }


  // =========================================================================
  // withFormField — Mixin that adds form field behaviour
  // =========================================================================

  function withFormField(BaseClass) {
    return class extends BaseClass {
      static get properties() {
        return {
          ...super.properties,
          name:     { type: String, default: '' },
          label:    { type: String, default: '' },
          help:     { type: String, default: '' },
          error:    { type: String, default: '' },
          success:  { type: String, default: '' },
          tooltip:  { type: String, default: '' },
          required: { type: Boolean, default: false },
          disabled: { type: Boolean, default: false, reflect: true },
          readonly: { type: Boolean, default: false },
          size:     { type: String, default: 'md' },
          value:    { type: String, default: '' }
        };
      }

      connected() {
        super.connected();
        injectFormBaseStyles();
      }

      // -------------------------------------------------------------------
      // HTML helpers — return strings for consistent label/help/error
      // -------------------------------------------------------------------

      _renderLabel() {
        if (!this.label) return '';
        const req = this.required
          ? '<span class="lex-field-required">*</span>'
          : '';
        const tooltipHtml = this.tooltip
          ? `<span class="lex-field-tooltip-trigger">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <span class="lex-field-tooltip">${this.escapeHtml(this.tooltip)}</span>
            </span>`
          : '';
        return `<div class="lex-field-label-wrap"><span class="lex-field-label">${this.escapeHtml(this.label)}${req}</span>${tooltipHtml}</div>`;
      }

      _renderHelp() {
        if (!this.help || this.error) return '';
        return `<div class="lex-field-help">${this.escapeHtml(this.help)}</div>`;
      }

      _renderError() {
        if (!this.error) return '';
        return `<div class="lex-field-error"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>${this.escapeHtml(this.error)}</div>`;
      }

      _renderSuccess() {
        if (!this.success || this.error) return '';
        return `<div class="lex-field-success"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>${this.escapeHtml(this.success)}</div>`;
      }

      _renderFieldWrapper(innerHtml) {
        return `
          <div class="lex-field">
            ${this._renderLabel()}
            ${innerHtml}
            ${this._renderError()}
            ${this._renderSuccess()}
            ${this._renderHelp()}
          </div>
        `;
      }

      // -------------------------------------------------------------------
      // CSS class helpers
      // -------------------------------------------------------------------

      _inputClasses(extra = '') {
        let cls = 'lex-field-input';
        cls += ` lex-field-input--${this.size || 'md'}`;
        if (this.error) cls += ' lex-field-input--error';
        if (extra) cls += ' ' + extra;
        return cls;
      }

      // -------------------------------------------------------------------
      // Change emission
      // -------------------------------------------------------------------

      _emitChange(value) {
        this._props.value = value;
        this.emit('lex-change', {
          name: this.name,
          value: value
        });
      }

      _emitInput(value) {
        this.emit('lex-input', {
          name: this.name,
          value: value
        });
      }

      // -------------------------------------------------------------------
      // Validation — basic built-in + extensible
      // -------------------------------------------------------------------

      /**
       * Validate the current value. Sets error/success automatically.
       * Override _validate() in subclass for custom rules.
       * Returns { valid: Boolean, message: String }
       */
      validate() {
        const result = this._validate();
        if (!result.valid) {
          this.error = result.message;
          this.success = '';
        } else {
          this.error = '';
          if (result.message) this.success = result.message;
        }
        return result;
      }

      /**
       * Override in subclass for custom validation.
       * Return { valid: Boolean, message: String }
       */
      _validate() {
        // Required check
        if (this.required) {
          const val = this.value;
          const isEmpty = val === null || val === undefined || val === '' ||
            (Array.isArray(val) && val.length === 0);
          if (isEmpty) {
            return { valid: false, message: 'This field is required' };
          }
        }
        return { valid: true, message: '' };
      }

      /** Clear error/success state */
      clearValidation() {
        this.error = '';
        this.success = '';
      }
    };
  }


  // =========================================================================
  // Export
  // =========================================================================

  global.Lex.withFormField = withFormField;
  global.Lex.injectFormBaseStyles = injectFormBaseStyles;

})(typeof window !== 'undefined' ? window : globalThis);
