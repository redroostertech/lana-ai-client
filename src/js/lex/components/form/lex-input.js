/* Lex UI — Input Component
   Text input with leading/trailing icons, clearable, password toggle, sizes.

   Usage:
     <lex-input label="Email" type="email" placeholder="you@example.com"></lex-input>
     <lex-input label="Search" type="search" clearable="true" leading-icon="search"></lex-input>
     <lex-input label="Password" type="password"></lex-input>
     <lex-input label="Amount" trailing-icon="dollar-sign" size="lg"></lex-input>

   Types: text, email, password, number, url, tel, search
   Sizes: sm (32px), md (40px), lg (48px)
   Events: lex-input (keystroke), lex-change (blur/commit)
*/

(function () {
  'use strict';

  const { LexElement, defineLex, withFormField, Icons } = window.Lex;

  let stylesInjected = false;

  /** Override Tailwind form borders — inject after a delay so we run after Tailwind. */
  function injectTailwindOverride() {
    var el = document.getElementById('lex-input-tailwind-override');
    if (el) {
      document.head.appendChild(el);
      return;
    }
    el = document.createElement('style');
    el.id = 'lex-input-tailwind-override';
    el.textContent = [
      'lex-input input.lex-field-input, lex-input input[data-lex-type] {',
      '  border: 0 none !important; border-width: 0 !important; border-color: transparent !important;',
      '  box-shadow: none !important; outline: none !important;',
      '}'
    ].join(' ');
    document.head.appendChild(el);
  }

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-input-styles';
    style.textContent = `
      lex-input {
        display: block;
      }

      .lex-input-wrap {
        position: relative;
        display: flex;
        align-items: center;
      }

      .lex-input-wrap input.lex-field-input {
        flex: 1;
        min-width: 0;
        border: 0 none !important;
        border-width: 0 !important;
        border-color: transparent !important;
        box-shadow: none !important;
      }

      /* Password masking — replaces type="password" */
      .lex-input--masked {
        -webkit-text-security: disc;
        text-security: disc;
      }

      /* Leading/trailing icon slots */
      .lex-input-icon {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        color: var(--lex-text-tertiary);
      }

      .lex-input-icon--lead { left: 10px; }
      .lex-input-icon--trail { right: 10px; }

      .lex-input-icon svg {
        width: 16px;
        height: 16px;
      }

      /* Adjust input padding when icons are present */
      .lex-input-wrap--has-lead input.lex-field-input {
        padding-left: 34px;
      }

      .lex-input-wrap--has-trail input.lex-field-input {
        padding-right: 34px;
      }

      /* Clickable trailing icons (clear, password toggle) */
      .lex-input-action {
        position: absolute;
        top: 50%;
        right: 8px;
        transform: translateY(-50%);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2px;
        border: none;
        background: none;
        cursor: pointer;
        color: var(--lex-text-tertiary);
        border-radius: var(--lex-radius-sm);
        transition: color 0.15s ease, background 0.15s ease;
      }

      .lex-input-action:hover {
        color: var(--lex-text-primary);
        background: var(--lex-bg-tertiary);
      }

      .lex-input-action svg {
        width: 16px;
        height: 16px;
      }

      /* When both trail icon and action exist, shift action further right */
      .lex-input-wrap--has-action input.lex-field-input {
        padding-right: 34px;
      }

      .lex-input-wrap--has-lead.lex-input-wrap--has-action input.lex-field-input {
        padding-left: 34px;
        padding-right: 34px;
      }

      /* Character count */
      .lex-input-count {
        font-size: var(--lex-form-counter-size, 0.625rem);
        color: var(--lex-text-tertiary);
        text-align: right;
        letter-spacing: 0.02em;
      }

      .lex-input-count--over {
        color: var(--lex-color-danger-500);
      }
    `;
    document.head.appendChild(style);
    setTimeout(injectTailwindOverride, 200);
    setTimeout(injectTailwindOverride, 1200);
  }

  // Fallback SVGs for when Icons aren't available for a specific icon
  const ICON_CLEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  const ICON_EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>';
  const ICON_EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>';
  const ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';

  function getIcon(name) {
    if (Icons && Icons.has && Icons.has(name)) {
      return Icons[name].small.toString();
    }
    // Fallback for common icons
    const fallbacks = { search: ICON_SEARCH, x: ICON_CLEAR, eye: ICON_EYE, 'eye-off': ICON_EYE_OFF };
    return fallbacks[name] || '';
  }

  class LexInput extends withFormField(LexElement) {
    static get properties() {
      return {
        ...super.properties,
        type:         { type: String, default: 'text' },
        placeholder:  { type: String, default: '' },
        leadingIcon:  { type: String, default: '' },
        trailingIcon: { type: String, default: '' },
        clearable:    { type: Boolean, default: false },
        maxlength:    { type: Number, default: 0 },
        showCount:    { type: Boolean, default: false }
      };
    }

    constructor() {
      super();
      this._showPassword = false;
    }

    render() {
      injectStyles();

      // Save focus state before innerHTML replacement destroys the old input
      var oldInput = this.querySelector('input');
      this._hadFocus = oldInput && this.contains(document.activeElement);
      this._savedCaret = (this._hadFocus && oldInput) ? oldInput.selectionStart : null;

      // Semantic type from data-lex-type (preferred) or type prop; never render native type on input
      const semanticType = (this.dataset.lexType || this.type || 'text').toLowerCase();

      const isPassword = semanticType === 'password';
      const isSearch = semanticType === 'search';

      // Map semantic type to inputmode for mobile keyboards
      const inputModes = {
        email: 'email',
        url: 'url',
        tel: 'tel',
        number: 'numeric',
        search: 'search'
      };
      const inputMode = inputModes[semanticType] || '';

      // Autocomplete hints for browsers
      const autocompleteMap = {
        email: 'email',
        password: 'current-password',
        'current-password': 'current-password',
        tel: 'tel',
        url: 'url',
        search: 'off'
      };
      const autocomplete = autocompleteMap[semanticType] || 'off';

      // Password masking via CSS (avoids type="password" which Tailwind targets)
      const isMasked = isPassword && !this._showPassword;

      // Leading icon
      const leadIcon = this.leadingIcon || (isSearch ? 'search' : '');
      const hasLead = !!leadIcon;

      // Trailing action: password toggle or clear button
      const showClear = (this.clearable || isSearch) && this.value;
      const hasAction = isPassword || showClear;

      // Trailing icon (non-interactive)
      const trailIcon = (!hasAction && this.trailingIcon) ? this.trailingIcon : '';
      const hasTrail = !!trailIcon;

      // Build wrapper classes
      let wrapCls = 'lex-input-wrap';
      if (hasLead) wrapCls += ' lex-input-wrap--has-lead';
      if (hasTrail) wrapCls += ' lex-input-wrap--has-trail';
      if (hasAction) wrapCls += ' lex-input-wrap--has-action';

      // Build input classes
      let inputCls = this._inputClasses();
      if (isMasked) inputCls += ' lex-input--masked';

      // Build input attrs (no type attribute — use data-lex-type and inputmode/autocomplete instead)
      const maxlenAttr = this.maxlength > 0 ? `maxlength="${this.maxlength}"` : '';
      const disabledAttr = this.disabled ? 'disabled' : '';
      const readonlyAttr = this.readonly ? 'readonly' : '';
      const requiredAttr = this.required ? 'required' : '';
      const modeAttr = inputMode ? `inputmode="${inputMode}"` : '';
      const autoAttr = `autocomplete="${this.escapeHtml(autocomplete)}"`;
      const dataTypeAttr = `data-lex-type="${this.escapeHtml(semanticType)}"`;

      let html = `<div class="${wrapCls}">`;

      // Leading icon
      if (hasLead) {
        html += `<span class="lex-input-icon lex-input-icon--lead">${getIcon(leadIcon)}</span>`;
      }

      // Input element — no type attribute (avoids Tailwind form borders); semantic type in data-lex-type
      html += `<input
        class="${inputCls}"
        style="border: 0 none; border-width: 0; box-shadow: none;"
        ${dataTypeAttr}
        value="${this.escapeHtml(this.value || '')}"
        placeholder="${this.escapeHtml(this.placeholder)}"
        name="${this.escapeHtml(this.name)}"
        ${modeAttr} ${autoAttr} ${maxlenAttr} ${disabledAttr} ${readonlyAttr} ${requiredAttr}
      />`;

      // Trailing icon (non-interactive)
      if (hasTrail) {
        html += `<span class="lex-input-icon lex-input-icon--trail">${getIcon(trailIcon)}</span>`;
      }

      // Password toggle
      if (isPassword) {
        const icon = this._showPassword ? ICON_EYE_OFF : ICON_EYE;
        html += `<button type="button" class="lex-input-action" data-action="toggle-password" tabindex="-1">${icon}</button>`;
      }

      // Clear button
      if (showClear && !isPassword) {
        html += `<button type="button" class="lex-input-action" data-action="clear" tabindex="-1">${ICON_CLEAR}</button>`;
      }

      html += '</div>';

      // Character count
      if (this.showCount && this.maxlength > 0) {
        const len = (this.value || '').length;
        const overCls = len > this.maxlength ? ' lex-input-count--over' : '';
        html += `<div class="lex-input-count${overCls}">${len}/${this.maxlength}</div>`;
      }

      return this._renderFieldWrapper(html);
    }

    updated() {
      const input = this.querySelector('input');
      if (!input) return;

      // Restore focus + caret position after re-render replaced the old input element
      if (this._hadFocus) {
        input.focus();
        if (this._savedCaret !== null) {
          try { input.setSelectionRange(this._savedCaret, this._savedCaret); } catch (e) { /* ignore for non-text types */ }
        }
        this._hadFocus = false;
        this._savedCaret = null;
      }

      // Input event (real-time)
      this.listen(input, 'input', (e) => {
        this._props.value = e.target.value;
        this._emitInput(e.target.value);

        // Re-render for clearable/count updates
        if (this.clearable || (this.dataset.lexType || this.type) === 'search' || this.showCount) {
          this._scheduleUpdate();
        }
      });

      // Change event (on blur/commit) — run custom type-based validation
      this.listen(input, 'change', (e) => {
        this._props.value = e.target.value;
        this._emitChange(e.target.value);
        this.validate();
      });

      this.listen(input, 'blur', () => {
        this.validate();
      });

      // Password toggle
      this.delegate('click', '[data-action="toggle-password"]', () => {
        this._showPassword = !this._showPassword;
        const cursorPos = input.selectionStart;
        this._scheduleUpdate();
        // Restore focus after re-render
        queueMicrotask(() => {
          const newInput = this.querySelector('input');
          if (newInput) {
            newInput.focus();
            newInput.setSelectionRange(cursorPos, cursorPos);
          }
        });
      });

      // Clear
      this.delegate('click', '[data-action="clear"]', () => {
        this._props.value = '';
        this._emitChange('');
        this._scheduleUpdate();
        queueMicrotask(() => {
          const newInput = this.querySelector('input');
          if (newInput) newInput.focus();
        });
      });
    }

    /** Type-based validation (replaces browser validation from type="email" etc.) */
    _validate() {
      const base = super._validate ? super._validate() : { valid: true, message: '' };
      if (!base.valid) return base;

      const v = (this.value || '').trim();
      if (!v) return { valid: true, message: '' };

      const semanticType = (this.dataset.lexType || this.type || 'text').toLowerCase();
      if (semanticType === 'email') {
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRe.test(v)) return { valid: false, message: 'Please enter a valid email address' };
      } else if (semanticType === 'url') {
        try {
          new URL(v.startsWith('http') ? v : 'https://' + v);
        } catch (e) {
          return { valid: false, message: 'Please enter a valid URL' };
        }
      } else if (semanticType === 'tel') {
        const telRe = /^[+\d\s\-().]{10,}$/;
        if (!telRe.test(v)) return { valid: false, message: 'Please enter a valid phone number' };
      } else if (semanticType === 'number') {
        if (v !== '' && isNaN(Number(v))) return { valid: false, message: 'Please enter a valid number' };
      }
      return { valid: true, message: '' };
    }
  }

  defineLex('lex-input', LexInput);
})();
