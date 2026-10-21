/* Lex UI — Select Component
   Dropdown selector with search, single/multi-select, keyboard navigation.

   Usage:
     <lex-select label="Country" placeholder="Choose..."
       options='[{"value":"us","label":"United States"},{"value":"uk","label":"United Kingdom"}]'>
     </lex-select>

     <lex-select label="Tags" multiple="true" searchable="true"
       options='[{"value":"a","label":"Alpha"},{"value":"b","label":"Beta"},{"value":"c","label":"Gamma"}]'>
     </lex-select>

   Options: [{ value, label, description?, group?, disabled? }], plain strings,
   or { divider: true } separators. Values are compared as strings, so numeric
   values work (the value you read back is the string form). Disabled options
   and dividers cannot be chosen and keyboard navigation skips them.

   Value:
     single   — select.value is a string. A value that matches no option shows
                the placeholder (the value itself is kept, so options loaded
                later still pick it up).
     multiple — select.value is an array of strings. The setter takes an
                array, a JSON array string, or a comma-separated string.

   .options and .value assigned before the element upgrades are kept.
   select.focus() focuses the trigger. Inside a <form>, the form's reset event
   restores the value the select had when it first connected. Clicks on
   options, the clear button and pill removers call preventDefault, so a
   lex-select inside a <label> does not reopen.

   Events: lex-change { name, value: string | Array }
*/

(function () {
  'use strict';

  const { LexElement, defineLex, withFormField } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-select-styles';
    style.textContent = `
      lex-select {
        display: block;
      }

      .lex-select-wrap {
        position: relative;
      }

      /* ── Trigger button ────────────────────────────────── */

      .lex-select-trigger {
        width: 100%;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        cursor: pointer;
        font-family: inherit;
        background: var(--lex-color-gray-50);
        border: none;
        border-radius: var(--lex-input-radius);
        outline: none;
        transition: background 0.2s ease, box-shadow 0.2s ease;
        color: var(--lex-input-text, var(--lex-text-primary));
      }

      .lex-select-trigger:hover:not(:disabled) {
        background: var(--lex-bg-tertiary);
      }

      .lex-select-trigger:focus, .lex-select-trigger--open {
        background: var(--lex-color-gray-50);
        box-shadow: 0 0 0 2px var(--lex-input-border-focus, var(--lex-color-brand-500));
      }

      .lex-select-trigger--error {
        box-shadow: 0 0 0 2px var(--lex-input-border-error, var(--lex-color-danger-500));
      }

      .lex-select-trigger:disabled {
        opacity: var(--lex-input-disabled-opacity);
        cursor: not-allowed;
      }

      /* Size variants */
      .lex-select-trigger--sm { height: var(--lex-input-height-sm); padding: 0 10px; font-size: var(--lex-form-font-size-sm, 0.75rem); }
      .lex-select-trigger--md { height: var(--lex-input-height-md); padding: 0 12px; font-size: var(--lex-form-font-size, 0.8125rem); }
      .lex-select-trigger--lg { height: var(--lex-input-height-lg); padding: 0 14px; font-size: var(--lex-form-font-size-lg, 0.875rem); }

      .lex-select-display {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-align: left;
      }

      .lex-select-placeholder {
        color: var(--lex-input-placeholder, var(--lex-text-tertiary));
        font-weight: var(--lex-weight-light, 300);
      }

      .lex-select-chevron {
        flex-shrink: 0;
        width: 16px;
        height: 16px;
        color: var(--lex-text-tertiary);
        transition: transform 0.2s ease;
      }

      .lex-select-trigger--open .lex-select-chevron {
        transform: rotate(180deg);
      }

      /* ── Multi-select pills ────────────────────────────── */

      .lex-select-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        flex: 1;
        min-width: 0;
        overflow: hidden;
      }

      .lex-select-pill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        background: var(--lex-bg-tertiary);
        border-radius: var(--lex-radius-full);
        font-size: var(--lex-form-help-size, 0.6875rem);
        color: var(--lex-text-primary);
        white-space: nowrap;
        max-width: 120px;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .lex-select-pill-x {
        cursor: pointer;
        color: var(--lex-text-tertiary);
        font-size: var(--lex-form-counter-size, 0.625rem);
        line-height: 1;
      }

      .lex-select-pill-x:hover {
        color: var(--lex-color-danger-500);
      }

      /* ── Clear button ──────────────────────────────────── */

      .lex-select-clear {
        flex-shrink: 0;
        padding: 2px;
        border: none;
        background: none;
        cursor: pointer;
        color: var(--lex-text-tertiary);
        display: flex;
        align-items: center;
      }

      .lex-select-clear:hover {
        color: var(--lex-text-primary);
      }

      .lex-select-clear svg {
        width: 14px;
        height: 14px;
      }

      /* ── Dropdown ──────────────────────────────────────── */

      .lex-select-dropdown {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        /* Fit the options, never narrower than the trigger. The cap keeps
           long descriptions wrapping instead of widening the page. */
        min-width: 100%;
        width: max-content;
        max-width: max(100%, 20rem);
        box-sizing: border-box;
        max-height: 240px;
        overflow-y: auto;
        overflow-x: hidden;
        background: var(--lex-select-dropdown-bg, var(--lex-bg-primary));
        border: 1px solid var(--lex-border-default);
        border-radius: var(--lex-input-radius);
        box-shadow: var(--lex-shadow-lg);
        z-index: var(--lex-z-dropdown, 10);
        display: none;
      }

      .lex-select-dropdown--open {
        display: block;
      }

      /* Search input inside dropdown */
      .lex-select-search {
        position: sticky;
        top: 0;
        padding: 8px;
        background: var(--lex-select-dropdown-bg, var(--lex-bg-primary));
        border-bottom: 1px solid var(--lex-border-subtle, rgba(0,0,0,0.06));
      }

      .lex-select-search input {
        width: 100%;
        box-sizing: border-box;
        padding: 6px 10px;
        font-size: var(--lex-form-font-size-sm, 0.75rem);
        font-family: inherit;
        border: none;
        border-radius: var(--lex-radius-sm);
        outline: none;
        background: var(--lex-color-gray-50);
        color: var(--lex-text-primary);
      }

      .lex-select-search input:focus {
        background: var(--lex-bg-primary);
        box-shadow: 0 0 0 2px var(--lex-input-border-focus, var(--lex-color-brand-500));
      }

      /* Options */
      .lex-select-option {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        cursor: pointer;
        font-size: var(--lex-form-font-size, 0.8125rem);
        color: var(--lex-text-primary);
        transition: background 0.1s ease;
        white-space: normal;
      }

      .lex-select-option:hover,
      .lex-select-option--focused {
        background: var(--lex-select-option-hover, var(--lex-bg-secondary));
      }

      .lex-select-option--selected {
        font-weight: var(--lex-weight-medium, 500);
      }

      .lex-select-option--disabled {
        opacity: var(--lex-input-disabled-opacity, 0.5);
        cursor: not-allowed;
      }

      .lex-select-option--disabled:hover {
        background: transparent;
      }

      .lex-select-divider {
        height: 1px;
        margin: 4px 0;
        background: var(--lex-border-subtle, rgba(0,0,0,0.06));
      }

      .lex-select-option-check {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        color: var(--lex-text-accent);
        opacity: 0;
      }

      .lex-select-option--selected .lex-select-option-check {
        opacity: 1;
      }

      .lex-select-option-label {
        flex: 1;
        min-width: 0;
        overflow-wrap: break-word;
      }

      .lex-select-option-desc {
        font-size: var(--lex-form-help-size, 0.6875rem);
        color: var(--lex-text-tertiary);
        margin-top: 1px;
      }

      .lex-select-empty {
        padding: 12px;
        text-align: center;
        font-size: var(--lex-form-font-size-sm, 0.75rem);
        color: var(--lex-text-tertiary);
      }

      /* Group headers */
      .lex-select-group-label {
        padding: 8px 12px 4px;
        font-size: var(--lex-form-counter-size, 0.625rem);
        font-weight: var(--lex-weight-semibold, 600);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--lex-text-tertiary);
      }
    `;
    document.head.appendChild(style);
  }

  const CHEVRON_SVG = '<svg class="lex-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  const CHECK_SVG = '<svg class="lex-select-option-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  const CLEAR_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  class LexSelect extends withFormField(LexElement) {
    static get properties() {
      return {
        ...super.properties,
        options:     { type: Array, default: [] },
        multiple:    { type: Boolean, default: false },
        searchable:  { type: Boolean, default: false },
        placeholder: { type: String, default: 'Select...' },
        clearable:   { type: Boolean, default: false },
        visibleLimit:{ type: Number, default: 0, attribute: 'visible-limit' }
      };
    }

    constructor() {
      super();
      this._open = false;
      this._searchTerm = '';
      this._focusedIdx = -1;
      this._selectedValues = new Set();
      // Unique per-instance prefix for option element IDs (used by aria-activedescendant).
      this._instanceId = Math.random().toString(36).slice(2, 8);
      this._initialValue = undefined;
      this._formResetCleanup = null;
      this._refocusTrigger = false;
      // Normally set up by LexElement; guarded so lightweight test stubs work.
      if (!this._props) this._props = {};
      if (!this._changedProps) this._changedProps = new Map();

      // value: an array under `multiple`, a string otherwise. Stored raw in
      // _props.value (array or string) and normalized on read, so the order
      // in which `multiple` and `value` arrive does not matter.
      Object.defineProperty(this, 'value', {
        get: () => this._readValue(),
        set: (val) => {
          const old = this._props.value;
          let next = val;
          if (Array.isArray(val)) next = val.map((v) => String(v));
          else if (val !== null && val !== undefined) next = String(val);
          if (old === next && typeof next !== 'object') return;
          this._props.value = next;
          this._changedProps.set('value', old);
          if (typeof this._scheduleUpdate === 'function') this._scheduleUpdate();
        },
        configurable: true
      });
      if (this._upgradedProps && Object.prototype.hasOwnProperty.call(this._upgradedProps, 'value')) {
        this.value = this._upgradedProps.value;
      }
    }

    // Normalized read of the stored value (see the accessor above).
    _readValue() {
      const raw = this._props.value;
      if (this.multiple) return LexSelect._toList(raw);
      if (Array.isArray(raw)) return raw.length ? String(raw[0]) : '';
      return raw;
    }

    // Array, JSON array string or comma string → array of strings.
    static _toList(raw) {
      if (Array.isArray(raw)) return raw.map((v) => String(v));
      if (raw === null || raw === undefined) return [];
      const text = String(raw).trim();
      if (!text) return [];
      if (text.charAt(0) === '[') {
        try {
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed)) return parsed.map((v) => String(v));
        } catch (e) { /* fall through to the comma form */ }
      }
      return text.split(',').map((v) => v.trim()).filter((v) => v !== '');
    }

    // Options normalized to { value: string, label: string, ... }; plain
    // strings and numbers become value=label; { divider: true } stays a divider.
    _getOptions() {
      const raw = Array.isArray(this.options) ? this.options : [];
      const out = [];
      for (const opt of raw) {
        if (opt === null || opt === undefined) continue;
        if (typeof opt !== 'object') {
          out.push({ value: String(opt), label: String(opt) });
          continue;
        }
        if (opt.divider || opt.separator) {
          out.push({ divider: true });
          continue;
        }
        const value = opt.value === null || opt.value === undefined ? '' : String(opt.value);
        const label = opt.label === null || opt.label === undefined ? value : String(opt.label);
        out.push(Object.assign({}, opt, { value, label }));
      }
      return out;
    }

    static _isSelectable(opt) {
      return !!opt && !opt.divider && !opt.disabled;
    }

    // Next selectable index from `from` in direction dir (+1/-1); stays put
    // when there is none.
    _stepIndex(opts, from, dir) {
      let idx = from;
      for (let i = 0; i < opts.length; i++) {
        idx += dir;
        if (idx < 0 || idx >= opts.length) return from;
        if (LexSelect._isSelectable(opts[idx])) return idx;
      }
      return from;
    }

    connected() {
      super.connected();
      if (this._initialValue === undefined) {
        const v = this._props.value;
        this._initialValue = Array.isArray(v) ? v.slice() : v;
      }
      this._bindFormReset();
    }

    disconnected() {
      super.disconnected();
      if (this._formResetCleanup) {
        this._formResetCleanup();
        this._formResetCleanup = null;
      }
    }

    // Restore the first-connected value when the enclosing <form> resets.
    _bindFormReset() {
      if (this._formResetCleanup) {
        this._formResetCleanup();
        this._formResetCleanup = null;
      }
      const form = typeof this.closest === 'function' ? this.closest('form') : null;
      if (!form) return;
      const onReset = (e) => {
        queueMicrotask(() => {
          if (e.defaultPrevented) return;
          const init = this._initialValue;
          this._open = false;
          this._searchTerm = '';
          this.value = Array.isArray(init) ? init.slice() : (init === undefined ? '' : init);
          if (typeof this.clearValidation === 'function') this.clearValidation();
          this._scheduleUpdate();
        });
      };
      form.addEventListener('reset', onReset);
      this._formResetCleanup = () => form.removeEventListener('reset', onReset);
    }

    /** Focus the trigger button (the element itself is not focusable). */
    focus(options) {
      const trigger = this.querySelector('.lex-select-trigger');
      if (trigger) trigger.focus(options);
      else super.focus(options);
    }

    render() {
      injectStyles();

      // Parse value into selected set
      this._syncSelectedFromValue();

      const options = this._getFilteredOptions();
      const sz = this.size || 'md';
      const triggerCls = `lex-select-trigger lex-select-trigger--${sz}${this._open ? ' lex-select-trigger--open' : ''}${this.error ? ' lex-select-trigger--error' : ''}`;
      const disabledAttr = this.disabled ? 'disabled' : '';
      const ariaExpanded = this._open ? 'true' : 'false';
      // aria-activedescendant points to the currently keyboard-focused option.
      const activeFocusId = (this._open && this._focusedIdx >= 0)
        ? `lex-select-opt-${this._instanceId}-${this._focusedIdx}`
        : '';
      const activeDescendant = activeFocusId ? ` aria-activedescendant="${activeFocusId}"` : '';

      // Display text
      const displayHtml = this._renderDisplay();

      // Clear button (not for a single value that matches no option — the
      // trigger shows the placeholder then)
      const showClear = this.clearable && this._selectedValues.size > 0 &&
        (this.multiple || !!this._findOption(this._singleValue()));
      const clearHtml = showClear
        ? `<button type="button" class="lex-select-clear" data-action="clear" tabindex="-1" aria-label="Clear selection">${CLEAR_SVG}</button>`
        : '';

      let html = `<div class="lex-select-wrap">`;
      html += `<button type="button" class="${triggerCls}" ${disabledAttr} data-action="toggle" aria-haspopup="listbox" aria-expanded="${ariaExpanded}"${activeDescendant}>`;
      html += displayHtml;
      html += clearHtml;
      html += CHEVRON_SVG;
      html += `</button>`;

      // Dropdown — role="listbox" for screen-reader semantics
      html += `<div class="lex-select-dropdown${this._open ? ' lex-select-dropdown--open' : ''}" role="listbox"${this.multiple ? ' aria-multiselectable="true"' : ''}>`;

      if (this.searchable) {
        html += `<div class="lex-select-search"><input type="text" placeholder="Search..." value="${this._escHtml(this._searchTerm)}" /></div>`;
      }

      if (options.length === 0) {
        html += `<div class="lex-select-empty">No options found</div>`;
      } else {
        let currentGroup = null;
        options.forEach((opt, idx) => {
          if (opt.divider) {
            html += `<div class="lex-select-divider" role="separator"></div>`;
            return;
          }
          // Group header
          if (opt.group && opt.group !== currentGroup) {
            currentGroup = opt.group;
            html += `<div class="lex-select-group-label" role="group" aria-label="${this._escHtml(opt.group)}">${this._escHtml(opt.group)}</div>`;
          }

          const isSelected = this._selectedValues.has(opt.value);
          const isFocused = idx === this._focusedIdx;
          let optCls = 'lex-select-option';
          if (isSelected) optCls += ' lex-select-option--selected';
          if (isFocused) optCls += ' lex-select-option--focused';
          if (opt.disabled) optCls += ' lex-select-option--disabled';
          const optId = `lex-select-opt-${this._instanceId}-${idx}`;
          const disabledOpt = opt.disabled ? ' aria-disabled="true" data-disabled="true"' : '';

          html += `<div class="${optCls}" data-value="${this._escHtml(opt.value)}" data-idx="${idx}" id="${optId}" role="option" aria-selected="${isSelected ? 'true' : 'false'}"${disabledOpt}>`;
          if (this.multiple) html += CHECK_SVG;
          html += `<div class="lex-select-option-label">${this._escHtml(opt.label)}`;
          if (opt.description) html += `<div class="lex-select-option-desc">${this._escHtml(opt.description)}</div>`;
          html += `</div>`;
          if (!this.multiple) html += CHECK_SVG;
          html += `</div>`;
        });
      }

      html += `</div></div>`;

      return this._renderFieldWrapper(html);
    }

    _findOption(value) {
      if (value === null || value === undefined) return null;
      const key = String(value);
      return this._getOptions().find((o) => !o.divider && o.value === key) || null;
    }

    _singleValue() {
      const v = this._readValue();
      return v === null || v === undefined ? '' : String(v);
    }

    _renderDisplay() {
      const placeholderHtml = `<span class="lex-select-display lex-select-placeholder">${this._escHtml(this.placeholder)}</span>`;
      if (this._selectedValues.size === 0) {
        return placeholderHtml;
      }

      if (this.multiple) {
        const allOpts = this._getOptions();
        let pillsHtml = '<span class="lex-select-pills">';
        for (const val of this._selectedValues) {
          const opt = allOpts.find(o => !o.divider && o.value === val);
          const label = opt ? opt.label : val;
          pillsHtml += `<span class="lex-select-pill">${this._escHtml(label)}<span class="lex-select-pill-x" data-remove="${this._escHtml(val)}">&times;</span></span>`;
        }
        pillsHtml += '</span>';
        return pillsHtml;
      }

      // Single: show the option label; a value with no matching option shows
      // the placeholder rather than the raw value.
      const selected = this._findOption(this._singleValue());
      if (!selected) return placeholderHtml;
      return `<span class="lex-select-display">${this._escHtml(selected.label)}</span>`;
    }

    _syncSelectedFromValue() {
      if (this.multiple) {
        this._selectedValues = new Set(LexSelect._toList(this._props.value));
      } else {
        const v = this._singleValue();
        this._selectedValues = v ? new Set([v]) : new Set();
      }
    }

    _getFilteredOptions() {
      const opts = this._getOptions();
      if (!this._searchTerm) {
        const limit = Number(this.visibleLimit || 0);
        return Number.isFinite(limit) && limit > 0 ? opts.slice(0, limit) : opts;
      }
      const term = this._searchTerm.toLowerCase();
      return opts.filter(o =>
        !o.divider && (
          o.label.toLowerCase().includes(term) ||
          (o.description && String(o.description).toLowerCase().includes(term))
        )
      );
    }

    _escHtml(text) {
      return this.escapeHtml(text);
    }

    updated() {
      // Keyboard on a non-searchable trigger re-renders it; keep focus there.
      if (this._refocusTrigger) {
        this._refocusTrigger = false;
        const t = this.querySelector('.lex-select-trigger');
        if (t) t.focus();
      }

      // Toggle dropdown
      this.delegate('click', '[data-action="toggle"]', (e) => {
        if (this.disabled) return;
        // Don't toggle if clicking clear or pill remove
        if (e.target.closest('[data-action="clear"]') || e.target.closest('[data-remove]')) return;
        this._open = !this._open;
        this._searchTerm = '';
        this._focusedIdx = -1;
        this._scheduleUpdate();
        if (this._open) {
          queueMicrotask(() => {
            const searchInput = this.querySelector('.lex-select-search input');
            if (searchInput) searchInput.focus();
          });
        }
      });

      // Clear
      this.delegate('click', '[data-action="clear"]', (e) => {
        // preventDefault: inside a <label>, the click would otherwise be
        // forwarded to the trigger and reopen the dropdown.
        e.preventDefault();
        e.stopPropagation();
        this._selectedValues.clear();
        this._emitChange(this.multiple ? [] : '');
        this._scheduleUpdate();
      });

      // Remove pill
      this.delegate('click', '[data-remove]', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const val = e.target.dataset.remove || e.target.closest('[data-remove]').dataset.remove;
        this._selectedValues.delete(val);
        this._emitChange([...this._selectedValues]);
        this._scheduleUpdate();
      });

      // Option click
      this.delegate('click', '.lex-select-option', (e, target) => {
        e.preventDefault();
        if (target.dataset.disabled === 'true') return;
        const val = target.dataset.value;
        if (this.multiple) {
          if (this._selectedValues.has(val)) {
            this._selectedValues.delete(val);
          } else {
            this._selectedValues.add(val);
          }
          this._emitChange([...this._selectedValues]);
          this._scheduleUpdate();
        } else {
          this._selectedValues = new Set([val]);
          this._open = false;
          this._searchTerm = '';
          this._emitChange(val);
          this._scheduleUpdate();
        }
      });

      // Search input
      const searchInput = this.querySelector('.lex-select-search input');
      if (searchInput) {
        this.listen(searchInput, 'input', (e) => {
          this._searchTerm = e.target.value;
          // The update replaces the input element, so capture the caret now
          // and restore it after re-focus — otherwise the fresh input leaves
          // the caret at position 0 and typed text comes out reversed.
          const caret = e.target.selectionStart;
          this._focusedIdx = -1;
          this._scheduleUpdate();
          // Re-focus search after update
          queueMicrotask(() => {
            const si = this.querySelector('.lex-select-search input');
            if (si) {
              si.focus();
              si.value = this._searchTerm;
              const pos = (caret === null || caret === undefined) ? si.value.length : caret;
              try { si.setSelectionRange(pos, pos); } catch (err) {}
            }
          });
        });

        // Keyboard navigation
        this.listen(searchInput, 'keydown', (e) => {
          const opts = this._getFilteredOptions();
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            this._focusedIdx = this._stepIndex(opts, this._focusedIdx, 1);
            this._scheduleUpdate();
            queueMicrotask(() => { const si = this.querySelector('.lex-select-search input'); if (si) si.focus(); });
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this._focusedIdx = this._focusedIdx < 0
              ? this._stepIndex(opts, -1, 1)
              : this._stepIndex(opts, this._focusedIdx, -1);
            this._scheduleUpdate();
            queueMicrotask(() => { const si = this.querySelector('.lex-select-search input'); if (si) si.focus(); });
          } else if (e.key === 'Enter' && this._focusedIdx >= 0) {
            e.preventDefault();
            const opt = opts[this._focusedIdx];
            if (opt) {
              const optEl = this.querySelector(`[data-idx="${this._focusedIdx}"]`);
              if (optEl) optEl.click();
            }
          } else if (e.key === 'Escape') {
            this._open = false;
            this._scheduleUpdate();
          }
        });
      }

      // Keyboard on trigger (when not searchable)
      const trigger = this.querySelector('[data-action="toggle"]');
      if (trigger && !this.searchable) {
        this.listen(trigger, 'keydown', (e) => {
          const opts = this._getFilteredOptions();
          if (!this._open) {
            if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              this._open = true;
              this._focusedIdx = this._stepIndex(opts, -1, 1);
              this._refocusTrigger = true;
              this._scheduleUpdate();
            }
            return;
          }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            this._focusedIdx = e.key === 'ArrowDown'
              ? this._stepIndex(opts, this._focusedIdx, 1)
              : (this._focusedIdx < 0 ? this._stepIndex(opts, -1, 1) : this._stepIndex(opts, this._focusedIdx, -1));
            this._refocusTrigger = true;
            this._scheduleUpdate();
          } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            const optEl = this._focusedIdx >= 0 ? this.querySelector(`[data-idx="${this._focusedIdx}"]`) : null;
            this._refocusTrigger = true;
            if (optEl) optEl.click();
            else { this._open = false; this._scheduleUpdate(); }
          } else if (e.key === 'Escape') {
            this._open = false;
            this._refocusTrigger = true;
            this._scheduleUpdate();
          }
        });
      }

      // Close on outside click — registered synchronously so _eventCleanups
      // handles removal exclusively. No setTimeout: the toggle click that
      // opened the dropdown fires on mouseup, so this mousedown listener
      // won't fire for the same gesture that opened the dropdown.
      if (this._open) {
        const closeHandler = (e) => {
          if (!this.contains(e.target)) {
            this._open = false;
            this._scheduleUpdate();
          }
        };
        document.addEventListener('mousedown', closeHandler);
        this._eventCleanups.push(() => document.removeEventListener('mousedown', closeHandler));
      }
    }
  }

  defineLex('lex-select', LexSelect);
})();
