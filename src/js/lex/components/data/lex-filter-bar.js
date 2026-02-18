/* Lex UI — Filter Bar Component
   Interactive filter bar with chip-based active filters and a two-step dropdown
   for adding column/operator/value filters.

   Usage:
     <lex-filter-bar columns='[{"key":"status","label":"Status","type":"enum","options":["Active","Closed"]},{"key":"name","label":"Name","type":"string"}]'></lex-filter-bar>

   Programmatic:
     const bar = document.querySelector('lex-filter-bar');
     bar.addFilter('status', 'eq', 'Active');
     bar.removeFilter('status');
     bar.clearAll();
     const filters = bar.getFilters();
     const map = bar.toFilterMap();

   Events: lex-filter-change
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  // ---------------------------------------------------------------------------
  // Operator definitions by column type
  // ---------------------------------------------------------------------------

  const OPERATORS_BY_TYPE = {
    string: [
      { value: 'eq', label: 'is' },
      { value: 'neq', label: 'is not' },
      { value: 'contains', label: 'contains' },
      { value: 'startsWith', label: 'starts with' }
    ],
    number: [
      { value: 'eq', label: 'equals' },
      { value: 'neq', label: 'not equals' },
      { value: 'gt', label: 'greater than' },
      { value: 'gte', label: 'at least' },
      { value: 'lt', label: 'less than' },
      { value: 'lte', label: 'at most' },
      { value: 'between', label: 'between' }
    ],
    enum: [
      { value: 'eq', label: 'is' },
      { value: 'neq', label: 'is not' },
      { value: 'in', label: 'is any of' }
    ],
    date: [
      { value: 'eq', label: 'is' },
      { value: 'gt', label: 'after' },
      { value: 'gte', label: 'on or after' },
      { value: 'lt', label: 'before' },
      { value: 'lte', label: 'on or before' },
      { value: 'between', label: 'between' }
    ]
  };

  // ---------------------------------------------------------------------------
  // Style injection (once)
  // ---------------------------------------------------------------------------

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-filter-bar-styles';
    style.textContent = `
      lex-filter-bar {
        display: block;
      }
      lex-filter-bar .lex-fb {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        min-height: 32px;
      }
      lex-filter-bar .lex-fb-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 8px 3px 10px;
        border-radius: var(--lex-radius-md, 6px);
        background: var(--lex-bg-accent-soft, #F5F0EA);
        color: var(--lex-text-primary);
        font-size: 12px;
        line-height: 1.4;
        white-space: nowrap;
      }
      lex-filter-bar .lex-fb-chip-col {
        font-weight: 600;
        color: var(--lex-text-accent, #8B7355);
      }
      lex-filter-bar .lex-fb-chip-op {
        color: var(--lex-text-tertiary);
      }
      lex-filter-bar .lex-fb-chip-val {
        /* default color */
      }
      lex-filter-bar .lex-fb-chip-x {
        cursor: pointer;
        margin-left: 2px;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--lex-text-tertiary);
        transition: all 0.15s;
      }
      lex-filter-bar .lex-fb-chip-x:hover {
        background: var(--lex-bg-tertiary);
        color: var(--lex-text-primary);
      }
      lex-filter-bar .lex-fb-add {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 10px;
        border-radius: var(--lex-radius-md, 6px);
        border: 1px dashed var(--lex-border-default, #E8E5E1);
        background: transparent;
        color: var(--lex-text-secondary);
        font-size: 12px;
        cursor: pointer;
        transition: all 0.15s;
      }
      lex-filter-bar .lex-fb-add:hover {
        border-color: var(--lex-text-secondary);
        color: var(--lex-text-primary);
      }
      lex-filter-bar .lex-fb-clear {
        font-size: 11px;
        color: var(--lex-text-tertiary);
        cursor: pointer;
        margin-left: 4px;
        padding: 2px 6px;
        border-radius: 4px;
        transition: all 0.15s;
      }
      lex-filter-bar .lex-fb-clear:hover {
        color: var(--lex-text-danger, #C53030);
        background: var(--lex-bg-danger, #FFF5F5);
      }

      /* Dropdown */
      lex-filter-bar .lex-fb-dropdown {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        min-width: 240px;
        max-width: 320px;
        background: var(--lex-bg-elevated, #FFFFFF);
        border: 1px solid var(--lex-border-default, #E8E5E1);
        border-radius: var(--lex-radius-lg, 8px);
        box-shadow: 0 4px 16px rgba(0,0,0,0.12);
        z-index: 50;
        padding: 4px;
      }
      lex-filter-bar .lex-fb-dd-item {
        padding: 7px 10px;
        font-size: 13px;
        color: var(--lex-text-primary);
        border-radius: 4px;
        cursor: pointer;
        transition: background 0.1s;
      }
      lex-filter-bar .lex-fb-dd-item:hover {
        background: var(--lex-bg-accent-soft, #F5F0EA);
      }
      lex-filter-bar .lex-fb-dd-header {
        padding: 6px 10px 4px;
        font-size: 11px;
        font-weight: 600;
        color: var(--lex-text-tertiary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      lex-filter-bar .lex-fb-dd-form {
        padding: 8px 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      lex-filter-bar .lex-fb-dd-form select,
      lex-filter-bar .lex-fb-dd-form input {
        height: 30px;
        width: 100%;
        border: 1px solid var(--lex-border-default, #E8E5E1);
        border-radius: var(--lex-radius-md, 6px);
        padding: 0 8px;
        font-size: 13px;
        background: var(--lex-bg-primary);
        color: var(--lex-text-primary);
        outline: none;
      }
      lex-filter-bar .lex-fb-dd-form select:focus,
      lex-filter-bar .lex-fb-dd-form input:focus {
        border-color: var(--lex-input-border-focus, #8B7355);
      }
      lex-filter-bar .lex-fb-dd-actions {
        display: flex;
        gap: 6px;
        justify-content: flex-end;
      }
      lex-filter-bar .lex-fb-dd-apply {
        padding: 4px 14px;
        font-size: 12px;
        font-weight: 500;
        border-radius: var(--lex-radius-md, 6px);
        background: var(--lex-bg-accent, #8B7355);
        color: white;
        border: none;
        cursor: pointer;
        transition: opacity 0.15s;
      }
      lex-filter-bar .lex-fb-dd-apply:hover {
        opacity: 0.9;
      }
      lex-filter-bar .lex-fb-dd-cancel {
        padding: 4px 10px;
        font-size: 12px;
        border-radius: var(--lex-radius-md, 6px);
        background: transparent;
        color: var(--lex-text-secondary);
        border: 1px solid var(--lex-border-default);
        cursor: pointer;
      }
      /* Between inputs */
      lex-filter-bar .lex-fb-dd-between {
        display: flex;
        gap: 6px;
        align-items: center;
      }
      lex-filter-bar .lex-fb-dd-between input {
        flex: 1;
      }
      lex-filter-bar .lex-fb-dd-between span {
        font-size: 12px;
        color: var(--lex-text-tertiary);
      }
      /* Multi-select for enum 'in' operator */
      lex-filter-bar .lex-fb-dd-checks {
        max-height: 160px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      lex-filter-bar .lex-fb-dd-check {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 6px;
        font-size: 13px;
        color: var(--lex-text-primary);
        border-radius: 4px;
        cursor: pointer;
      }
      lex-filter-bar .lex-fb-dd-check:hover {
        background: var(--lex-bg-accent-soft, #F5F0EA);
      }
      lex-filter-bar .lex-fb-dd-check input[type="checkbox"] {
        width: 14px;
        height: 14px;
        accent-color: var(--lex-bg-accent, #8B7355);
      }

      /* Wrapper for relative positioning */
      lex-filter-bar .lex-fb-wrap {
        position: relative;
        display: inline-flex;
      }
    `;
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // LexFilterBar component
  // ---------------------------------------------------------------------------

  class LexFilterBar extends LexElement {

    static get properties() {
      return {
        columns: { type: Array, default: [] },
        compact:  { type: Boolean, default: false }
      };
    }

    constructor() {
      super();
      this._filters = [];
      this._dropdownOpen = false;
      this._dropdownStep = 1;
      this._selectedColumn = null;
    }

    connected() {
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    _getColumnConfig(key) {
      if (!Array.isArray(this.columns)) return null;
      return this.columns.find(c => c.key === key);
    }

    _getOperatorLabel(column, operator) {
      const colConfig = this._getColumnConfig(column);
      const type = colConfig?.type || 'string';
      const ops = OPERATORS_BY_TYPE[type] || OPERATORS_BY_TYPE.string;
      const found = ops.find(o => o.value === operator);
      return found ? found.label : operator;
    }

    _getOperatorsForType(type) {
      return OPERATORS_BY_TYPE[type] || OPERATORS_BY_TYPE.string;
    }

    _emitChange() {
      this.emit('lex-filter-change', {
        filters: this.getFilters(),
        filterMap: this.toFilterMap()
      });
    }

    // -----------------------------------------------------------------------
    // Programmatic API
    // -----------------------------------------------------------------------

    /**
     * Rebuild chips from an external filter Map without emitting events.
     * Used by host components (e.g. lex-table column filters) to keep the
     * filter bar in sync.
     * @param {Map} filterMap - Map<column, {operator, value}>
     */
    syncFromMap(filterMap) {
      this._filters = [];
      if (filterMap && filterMap.size > 0) {
        for (const [column, { operator, value }] of filterMap) {
          const colConfig = this._getColumnConfig(column);
          this._filters.push({ column, operator, value, label: colConfig?.label || column });
        }
      }
      this._scheduleUpdate();
    }

    addFilter(column, operator, value) {
      const colConfig = this._getColumnConfig(column);
      this._filters.push({
        column,
        operator,
        value,
        label: colConfig?.label || column
      });
      this._emitChange();
      this._scheduleUpdate();
    }

    removeFilter(column) {
      this._filters = this._filters.filter(f => f.column !== column);
      this._emitChange();
      this._scheduleUpdate();
    }

    removeFilterAt(index) {
      this._filters.splice(index, 1);
      this._emitChange();
      this._scheduleUpdate();
    }

    clearAll() {
      this._filters = [];
      this._emitChange();
      this._scheduleUpdate();
    }

    getFilters() {
      return [...this._filters];
    }

    toFilterMap() {
      const map = new Map();
      for (const f of this._filters) {
        map.set(f.column, { operator: f.operator, value: f.value });
      }
      return map;
    }

    // -----------------------------------------------------------------------
    // Dropdown rendering
    // -----------------------------------------------------------------------

    _renderDropdown() {
      if (this._dropdownStep === 1) {
        return this._renderDropdownStep1();
      }
      return this._renderDropdownStep2();
    }

    _renderDropdownStep1() {
      const cols = Array.isArray(this.columns) ? this.columns : [];
      let html = '<div class="lex-fb-dropdown">';
      html += '<div class="lex-fb-dd-header">Filter by</div>';
      cols.forEach(col => {
        html += `<div class="lex-fb-dd-item" data-select-col="${this.escapeHtml(col.key)}">${this.escapeHtml(col.label || col.key)}</div>`;
      });
      html += '</div>';
      return html;
    }

    _renderDropdownStep2() {
      const col = this._selectedColumn;
      if (!col) return '';

      const type = col.type || 'string';
      const operators = this._getOperatorsForType(type);

      // Determine currently selected operator (default to first)
      const opSelect = this.$('[data-filter="operator"]');
      const currentOp = opSelect ? opSelect.value : operators[0].value;

      let html = '<div class="lex-fb-dropdown">';
      html += `<div class="lex-fb-dd-header">${this.escapeHtml(col.label || col.key)}</div>`;
      html += '<div class="lex-fb-dd-form">';

      // Operator select
      html += '<select data-filter="operator">';
      operators.forEach(op => {
        const selected = op.value === currentOp ? ' selected' : '';
        html += `<option value="${this.escapeHtml(op.value)}"${selected}>${this.escapeHtml(op.label)}</option>`;
      });
      html += '</select>';

      // Value input - depends on type and operator
      html += this._renderValueInput(col, currentOp);

      // Actions
      html += '<div class="lex-fb-dd-actions">';
      html += '<button class="lex-fb-dd-cancel" data-action="dd-back">Back</button>';
      html += '<button class="lex-fb-dd-apply" data-action="dd-apply">Apply</button>';
      html += '</div>';

      html += '</div>'; // .lex-fb-dd-form
      html += '</div>'; // .lex-fb-dropdown
      return html;
    }

    _renderValueInput(col, operator) {
      const type = col.type || 'string';
      const options = Array.isArray(col.options) ? col.options : [];

      // Between operator: two inputs with "and" separator
      if (operator === 'between') {
        const inputType = type === 'date' ? 'date' : 'number';
        return `
          <div class="lex-fb-dd-between">
            <input type="${inputType}" data-filter="value-min" placeholder="Min" />
            <span>and</span>
            <input type="${inputType}" data-filter="value-max" placeholder="Max" />
          </div>
        `;
      }

      // Enum with 'in' operator: checkbox list
      if (type === 'enum' && operator === 'in') {
        let html = '<div class="lex-fb-dd-checks">';
        options.forEach(opt => {
          const val = typeof opt === 'object' ? opt.value : opt;
          const label = typeof opt === 'object' ? (opt.label || opt.value) : opt;
          html += `
            <label class="lex-fb-dd-check">
              <input type="checkbox" data-filter-check value="${this.escapeHtml(String(val))}" />
              ${this.escapeHtml(String(label))}
            </label>
          `;
        });
        html += '</div>';
        return html;
      }

      // Enum with eq/neq: select dropdown of options
      if (type === 'enum') {
        let html = '<select data-filter="value">';
        html += '<option value="">Select...</option>';
        options.forEach(opt => {
          const val = typeof opt === 'object' ? opt.value : opt;
          const label = typeof opt === 'object' ? (opt.label || opt.value) : opt;
          html += `<option value="${this.escapeHtml(String(val))}">${this.escapeHtml(String(label))}</option>`;
        });
        html += '</select>';
        return html;
      }

      // Date type
      if (type === 'date') {
        return '<input type="date" data-filter="value" />';
      }

      // Number type
      if (type === 'number') {
        return '<input type="number" data-filter="value" placeholder="Value" />';
      }

      // Default: string text input
      return '<input type="text" data-filter="value" placeholder="Value" />';
    }

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------

    render() {
      injectStyles();

      let html = '<div class="lex-fb">';

      // Active filter chips
      const filters = this._filters || [];
      filters.forEach((f, idx) => {
        const opLabel = this._getOperatorLabel(f.column, f.operator);
        const displayValue = Array.isArray(f.value) ? f.value.join(', ') : f.value;
        html += `
          <div class="lex-fb-chip">
            <span class="lex-fb-chip-col">${this.escapeHtml(f.label || f.column)}</span>
            <span class="lex-fb-chip-op">${this.escapeHtml(opLabel)}</span>
            <span class="lex-fb-chip-val">${this.escapeHtml(String(displayValue))}</span>
            <span class="lex-fb-chip-x" data-remove-idx="${idx}" title="Remove filter">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </span>
          </div>
        `;
      });

      // Add filter button + dropdown wrapper
      html += '<div class="lex-fb-wrap">';
      html += `
        <button class="lex-fb-add" data-action="toggle-dropdown">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          Add filter
        </button>
      `;

      if (this._dropdownOpen) {
        html += this._renderDropdown();
      }

      html += '</div>'; // .lex-fb-wrap

      // Clear all button
      if (filters.length > 0) {
        html += '<span class="lex-fb-clear" data-action="clear-all">Clear all</span>';
      }

      html += '</div>'; // .lex-fb
      return html;
    }

    // -----------------------------------------------------------------------
    // Event wiring
    // -----------------------------------------------------------------------

    updated() {
      // Toggle dropdown
      this.delegate('click', '[data-action="toggle-dropdown"]', () => {
        this._dropdownOpen = !this._dropdownOpen;
        this._dropdownStep = 1;
        this._selectedColumn = null;
        this._scheduleUpdate();
      });

      // Column selection (step 1)
      this.delegate('click', '[data-select-col]', (e, el) => {
        const key = el.dataset.selectCol;
        this._selectedColumn = this._getColumnConfig(key);
        this._dropdownStep = 2;
        this._scheduleUpdate();
      });

      // Back button
      this.delegate('click', '[data-action="dd-back"]', () => {
        this._dropdownStep = 1;
        this._selectedColumn = null;
        this._scheduleUpdate();
      });

      // Apply filter
      this.delegate('click', '[data-action="dd-apply"]', () => {
        const opSelect = this.$('[data-filter="operator"]');
        const operator = opSelect?.value || 'eq';
        let value;

        if (operator === 'in') {
          // Gather checked checkboxes
          const checks = this.$$('[data-filter-check]:checked');
          value = checks.map(c => c.value);
          if (value.length === 0) return;
        } else if (operator === 'between') {
          const min = this.$('[data-filter="value-min"]')?.value;
          const max = this.$('[data-filter="value-max"]')?.value;
          if (!min || !max) return;
          value = `${min},${max}`;
        } else {
          value = this.$('[data-filter="value"]')?.value;
          if (!value && value !== 0) return;
        }

        // Remove existing filter for same column, then add new
        this._filters = this._filters.filter(f => f.column !== this._selectedColumn.key);
        this.addFilter(this._selectedColumn.key, operator, value);

        // Close dropdown
        this._dropdownOpen = false;
        this._dropdownStep = 1;
        this._selectedColumn = null;
        this._scheduleUpdate();
      });

      // Remove filter chip
      this.delegate('click', '[data-remove-idx]', (e, el) => {
        const idx = parseInt(el.closest('[data-remove-idx]').dataset.removeIdx);
        this.removeFilterAt(idx);
      });

      // Clear all
      this.delegate('click', '[data-action="clear-all"]', () => {
        this.clearAll();
      });

      // Close dropdown on outside click
      if (this._dropdownOpen) {
        const closeHandler = (e) => {
          if (!this.contains(e.target)) {
            this._dropdownOpen = false;
            this._dropdownStep = 1;
            this._selectedColumn = null;
            this._scheduleUpdate();
            document.removeEventListener('mousedown', closeHandler);
          }
        };
        // Delay to prevent immediate close from the same click that opened it
        setTimeout(() => {
          document.addEventListener('mousedown', closeHandler);
          this._eventCleanups.push(() => document.removeEventListener('mousedown', closeHandler));
        }, 0);
      }

      // Dynamic operator/value UI update when operator changes
      const opSelect = this.$('[data-filter="operator"]');
      if (opSelect) {
        this.listen(opSelect, 'change', () => {
          this._scheduleUpdate();
        });
      }
    }
  }

  defineLex('lex-filter-bar', LexFilterBar);
})();
