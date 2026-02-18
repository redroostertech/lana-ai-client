/* Lex UI — Format Input Component
   Text input with real-time data formatting (date, phone, currency, credit card, custom mask).

   Usage:
     <lex-format-input label="Phone" format="phone"></lex-format-input>
     <lex-format-input label="Date" format="date" placeholder="MM/DD/YYYY"></lex-format-input>
     <lex-format-input label="Amount" format="currency" prefix="$"></lex-format-input>
     <lex-format-input label="Card" format="credit-card"></lex-format-input>
     <lex-format-input label="Code" format="custom" mask="###-AAA" placeholder="123-ABC"></lex-format-input>

   Formats: date | phone | currency | credit-card | custom
   Custom mask: # = digit, A = letter, * = any character
   Events: lex-input, lex-change { name, value (formatted), rawValue (unformatted) }
*/

(function () {
  'use strict';

  const { LexElement, defineLex, withFormField } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-format-input-styles';
    style.textContent = `
      lex-format-input {
        display: block;
      }

      .lex-fmt-wrap {
        position: relative;
        display: flex;
        align-items: center;
      }

      .lex-fmt-prefix {
        position: absolute;
        left: 12px;
        top: 50%;
        transform: translateY(-50%);
        font-size: var(--lex-form-font-size, 0.8125rem);
        color: var(--lex-text-tertiary);
        pointer-events: none;
        font-weight: var(--lex-weight-regular, 400);
      }

      .lex-fmt-wrap--has-prefix input.lex-field-input {
        padding-left: 28px;
      }
    `;
    document.head.appendChild(style);
  }

  // ==========================================================================
  // Formatting engines
  // ==========================================================================

  const formatters = {
    date: {
      placeholder: 'MM/DD/YYYY',
      format(raw) {
        const digits = raw.replace(/\D/g, '').slice(0, 8);
        let result = '';
        for (let i = 0; i < digits.length; i++) {
          if (i === 2 || i === 4) result += '/';
          result += digits[i];
        }
        return result;
      },
      raw(formatted) {
        return formatted.replace(/\D/g, '');
      }
    },

    phone: {
      placeholder: '(555) 555-5555',
      format(raw) {
        const digits = raw.replace(/\D/g, '').slice(0, 10);
        if (digits.length === 0) return '';
        if (digits.length <= 3) return `(${digits}`;
        if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
        return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
      },
      raw(formatted) {
        return formatted.replace(/\D/g, '');
      }
    },

    currency: {
      placeholder: '0.00',
      format(raw) {
        // Remove non-digit/decimal
        let cleaned = raw.replace(/[^\d.]/g, '');
        // Only keep first decimal point
        const parts = cleaned.split('.');
        if (parts.length > 2) {
          cleaned = parts[0] + '.' + parts.slice(1).join('');
        }
        // Format with commas
        const [intPart, decPart] = cleaned.split('.');
        const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return decPart !== undefined ? `${withCommas}.${decPart.slice(0, 2)}` : withCommas;
      },
      raw(formatted) {
        return formatted.replace(/[^\d.]/g, '');
      }
    },

    'credit-card': {
      placeholder: '0000 0000 0000 0000',
      format(raw) {
        const digits = raw.replace(/\D/g, '').slice(0, 16);
        return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
      },
      raw(formatted) {
        return formatted.replace(/\D/g, '');
      }
    }
  };

  function customMaskFormatter(mask) {
    return {
      placeholder: mask,
      format(raw) {
        let result = '';
        let rawIdx = 0;
        for (let i = 0; i < mask.length && rawIdx < raw.length; i++) {
          const m = mask[i];
          if (m === '#') {
            // Digit
            while (rawIdx < raw.length && !/\d/.test(raw[rawIdx])) rawIdx++;
            if (rawIdx < raw.length) result += raw[rawIdx++];
          } else if (m === 'A') {
            // Letter
            while (rawIdx < raw.length && !/[a-zA-Z]/.test(raw[rawIdx])) rawIdx++;
            if (rawIdx < raw.length) result += raw[rawIdx++];
          } else if (m === '*') {
            result += raw[rawIdx++];
          } else {
            result += m;
            // If the user typed the mask char, skip it
            if (raw[rawIdx] === m) rawIdx++;
          }
        }
        return result;
      },
      raw(formatted) {
        let result = '';
        let maskIdx = 0;
        for (let i = 0; i < formatted.length; i++) {
          if (maskIdx < mask.length) {
            const m = mask[maskIdx];
            if (m === '#' || m === 'A' || m === '*') {
              result += formatted[i];
            }
            maskIdx++;
          }
        }
        return result;
      }
    };
  }

  class LexFormatInput extends withFormField(LexElement) {
    static get properties() {
      return {
        ...super.properties,
        format:      { type: String, default: 'text' },
        mask:        { type: String, default: '' },
        prefix:      { type: String, default: '' },
        placeholder: { type: String, default: '' }
      };
    }

    _getFormatter() {
      if (this.format === 'custom' && this.mask) {
        return customMaskFormatter(this.mask);
      }
      return formatters[this.format] || null;
    }

    render() {
      injectStyles();

      const fmt = this._getFormatter();
      const placeholder = this.placeholder || (fmt ? fmt.placeholder : '');
      const hasPrefix = !!this.prefix;
      const wrapCls = `lex-fmt-wrap${hasPrefix ? ' lex-fmt-wrap--has-prefix' : ''}`;

      const disabledAttr = this.disabled ? 'disabled' : '';
      const readonlyAttr = this.readonly ? 'readonly' : '';

      let html = `<div class="${wrapCls}">`;
      if (hasPrefix) {
        html += `<span class="lex-fmt-prefix">${this.escapeHtml(this.prefix)}</span>`;
      }
      html += `<input
        class="${this._inputClasses()}"
        type="text"
        value="${this.escapeHtml(this.value || '')}"
        placeholder="${this.escapeHtml(placeholder)}"
        name="${this.escapeHtml(this.name)}"
        ${disabledAttr} ${readonlyAttr}
      />`;
      html += `</div>`;

      return this._renderFieldWrapper(html);
    }

    updated() {
      const input = this.querySelector('input');
      if (!input) return;

      this.listen(input, 'input', (e) => {
        const fmt = this._getFormatter();
        if (fmt) {
          const cursorPos = input.selectionStart;
          const prevLen = input.value.length;

          const formatted = fmt.format(input.value);
          input.value = formatted;
          this._props.value = formatted;

          // Smart cursor position
          const newLen = formatted.length;
          const diff = newLen - prevLen;
          const newPos = Math.max(0, cursorPos + diff);
          input.setSelectionRange(newPos, newPos);

          this._emitInput(formatted);
          this.emit('lex-input', {
            name: this.name,
            value: formatted,
            rawValue: fmt.raw(formatted)
          });
        } else {
          this._props.value = input.value;
          this._emitInput(input.value);
        }
      });

      this.listen(input, 'change', () => {
        const fmt = this._getFormatter();
        const val = input.value;
        this._emitChange(val);
        if (fmt) {
          this.emit('lex-change', {
            name: this.name,
            value: val,
            rawValue: fmt.raw(val)
          });
        }
      });
    }

    /** Get the unformatted raw value */
    get rawValue() {
      const fmt = this._getFormatter();
      return fmt ? fmt.raw(this.value || '') : (this.value || '');
    }
  }

  defineLex('lex-format-input', LexFormatInput);
})();
