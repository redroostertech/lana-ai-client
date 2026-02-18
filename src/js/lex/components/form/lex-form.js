/* Lex UI — Form Container Component
   Orchestrates child form fields: collects values, validates, submits.

   Usage:
     <lex-form>
       <lex-input name="email" label="Email" required="true"></lex-input>
       <lex-textarea name="notes" label="Notes"></lex-textarea>
       <lex-btn type="submit" variant="primary">Submit</lex-btn>
     </lex-form>

   Methods:
     getValues()  → { email: '...', notes: '...' }
     validate()   → { valid: true/false, errors: [{name, message}] }
     reset()      → resets all child form fields

   Events: lex-submit { values, valid }
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  class LexForm extends LexElement {
    static get properties() {
      return {
        novalidate: { type: Boolean, default: false }
      };
    }

    // Don't touch children — they manage themselves
    render() {
      return null;
    }

    connected() {
      super.connected();

      // Listen for submit-type button clicks
      this.delegate('click', 'lex-btn[type="submit"], button[type="submit"]', (e) => {
        e.preventDefault();
        this._handleSubmit();
      });

      // Listen for Enter key in inputs
      this.delegate('keydown', 'lex-input', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this._handleSubmit();
        }
      });
    }

    _handleSubmit() {
      const result = this.novalidate ? { valid: true, errors: [] } : this.validate();
      const values = this.getValues();

      this.emit('lex-submit', {
        values,
        valid: result.valid,
        errors: result.errors
      });
    }

    /**
     * Get all values from child form fields as a plain object.
     * @returns {Object} { [name]: value }
     */
    getValues() {
      const values = {};
      const fields = this._getFormFields();
      fields.forEach(field => {
        if (field.name) {
          values[field.name] = field.value;
        }
      });
      return values;
    }

    /**
     * Validate all child form fields.
     * @returns {{ valid: boolean, errors: Array<{name: string, message: string}> }}
     */
    validate() {
      const errors = [];
      const fields = this._getFormFields();

      fields.forEach(field => {
        if (typeof field.validate === 'function') {
          const result = field.validate();
          if (!result.valid) {
            errors.push({
              name: field.name || '',
              message: result.message
            });
          }
        }
      });

      return {
        valid: errors.length === 0,
        errors
      };
    }

    /**
     * Reset all child form fields.
     */
    reset() {
      const fields = this._getFormFields();
      fields.forEach(field => {
        if (typeof field.clearValidation === 'function') {
          field.clearValidation();
        }
        // Reset value to default
        const props = field.constructor.properties || {};
        if (props.value) {
          field.value = props.value.default || '';
        }
        if (props.checked) {
          field.checked = props.checked.default || false;
        }
      });
    }

    /**
     * Get all child form field elements.
     * @private
     */
    _getFormFields() {
      const formTags = [
        'lex-input', 'lex-textarea', 'lex-toggle', 'lex-checkbox',
        'lex-radio', 'lex-select', 'lex-segmented', 'lex-format-input',
        'lex-mention-input', 'lex-editor'
      ];
      return Array.from(this.querySelectorAll(formTags.join(',')));
    }
  }

  defineLex('lex-form', LexForm);
})();
