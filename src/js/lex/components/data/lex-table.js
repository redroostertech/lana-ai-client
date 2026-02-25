/* Lex UI — Data Table Component
   Sortable, paginated, searchable, filterable table with endpoint binding
   and row selection with bulk actions.

   Usage (Tier 2 - Dynamic):
     <lex-table endpoint="/api/v1/matters" limit="20" columns="title,status,created_at" searchable></lex-table>

   Usage (Tier 3 - AI-Native / inline data):
     const table = document.querySelector('lex-table');
     table.setData([{ name: 'Smith', status: 'active' }, ...]);

   Filterable (auto-detects column types, renders lex-filter-bar):
     <lex-table filterable columns="title,status,type" ...></lex-table>

   Selectable with bulk actions:
     <lex-table selectable bulk-actions='[{"label":"Delete","action":"delete","variant":"danger"},{"label":"Export","action":"export"}]' ...></lex-table>

   Column filters (per-column dropdown filters in header):
     <lex-table column-filters columns="status,type" ...></lex-table>

   Events: row-click, sort-change, selection-change, bulk-action, lex-filter-change
*/

(function () {
  'use strict';

  const { LexElement, defineLex, withDataSource } = window.Lex;

  // ---------------------------------------------------------------------------
  // Style injection (once)
  // ---------------------------------------------------------------------------

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-table-styles';
    style.textContent = `
      /* Base element: flex column so scroll area can fill remaining space */
      lex-table {
        display: flex;
        flex-direction: column;
      }

      /* Scrollable table body — sticky header stays visible while rows scroll */
      .lex-table-scroll-area thead {
        position: sticky;
        top: 0;
        z-index: 1;
        background: var(--lex-bg-secondary, #F5F5F0);
      }

      /* Toolbar: column layout when both search and filters are present */
      .lex-table-toolbar {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 0 4px;
        margin-bottom: 8px;
        flex-shrink: 0;
      }

      /* Top row within toolbar: search + count */
      .lex-table-toolbar-row {
        display: flex;
        flex-direction: row;
        gap: 8px;
        align-items: center;
      }

      .lex-table-search {
        position: relative;
        flex: 1;
        max-width: 300px;
      }

      .lex-table-search input {
        width: 100%;
        height: 32px;
        border-radius: var(--lex-radius-md, 6px);
        border: 1px solid var(--lex-border-default);
        padding: 0 28px 0 30px;
        font-size: var(--lex-form-font-size, 0.8125rem);
        line-height: 32px;
        background: var(--lex-bg-primary);
        color: var(--lex-text-primary);
        outline: none;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
        box-sizing: border-box;
      }

      .lex-table-search input:focus {
        border-color: var(--lex-input-border-focus, #8B7355);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--lex-input-border-focus, #8B7355) 20%, transparent);
      }

      .lex-table-search input::placeholder {
        color: var(--lex-text-tertiary);
      }

      .lex-table-search svg.lex-search-icon {
        position: absolute;
        left: 8px;
        top: 50%;
        transform: translateY(-50%);
        width: 16px;
        height: 16px;
        color: var(--lex-text-tertiary);
        pointer-events: none;
      }

      .lex-table-search .lex-search-clear {
        position: absolute;
        right: 6px;
        top: 50%;
        transform: translateY(-50%);
        width: 18px;
        height: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        color: var(--lex-text-tertiary);
        border-radius: 50%;
        border: none;
        background: none;
        padding: 0;
        line-height: 1;
        transition: color 0.15s ease, background 0.15s ease;
      }

      .lex-table-search .lex-search-clear:hover {
        color: var(--lex-text-primary);
        background: var(--lex-bg-tertiary, rgba(0,0,0,0.06));
      }

      .lex-table-count {
        font-size: var(--lex-body-xs-size, 0.75rem);
        color: var(--lex-text-tertiary);
        margin-left: auto;
        white-space: nowrap;
      }

      /* Page-size select */
      .lex-page-size-select {
        appearance: none;
        -webkit-appearance: none;
        padding: 3px 22px 3px 8px;
        font-size: var(--lex-body-xs-size, 0.75rem);
        line-height: 1.4;
        border-radius: var(--lex-radius-md, 6px);
        border: 1px solid var(--lex-border-default, #E8E5E1);
        background-color: var(--lex-bg-primary, #fff);
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 5px center;
        color: var(--lex-text-primary, #1A1A1A);
        cursor: pointer;
        outline: none;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
      }
      .lex-page-size-select:hover {
        border-color: var(--lex-border-strong, #C5BDB2);
      }
      .lex-page-size-select:focus {
        border-color: var(--lex-input-border-focus, #8B7355);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--lex-input-border-focus, #8B7355) 20%, transparent);
      }

      /* Pagination bar */
      .lex-pagination-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 16px;
        border-top: 1px solid var(--lex-border-default, #E8E5E1);
        font-size: var(--lex-form-font-size, 0.8125rem);
        flex-shrink: 0;
      }
      .lex-pagination-controls {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .lex-pagination-label {
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--lex-text-secondary, #6B6B6B);
        font-size: var(--lex-body-xs-size, 0.75rem);
      }
      .lex-page-btn {
        padding: 3px 12px;
        font-size: var(--lex-body-xs-size, 0.75rem);
        border-radius: var(--lex-radius-md, 6px);
        border: 1px solid var(--lex-border-default, #E8E5E1);
        background: var(--lex-bg-primary, #fff);
        color: var(--lex-text-secondary, #6B6B6B);
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .lex-page-btn:hover:not(:disabled) {
        background: var(--lex-bg-secondary, #F5F5F0);
        border-color: var(--lex-border-strong, #C5BDB2);
      }
      .lex-page-btn:disabled {
        opacity: 0.35;
        cursor: default;
      }

      /* Column header filter icon */
      .lex-th-filter {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        margin-left: 4px;
        cursor: pointer;
        color: var(--lex-text-tertiary);
        opacity: 0.4;
        transition: opacity 0.15s, color 0.15s;
        vertical-align: middle;
      }
      .lex-th-filter:hover,
      .lex-th-filter--active {
        opacity: 1;
        color: var(--lex-text-accent, #8B7355);
      }

      /* Column filter dropdown */
      .lex-th-filter-dropdown {
        position: absolute;
        top: 100%;
        left: 0;
        min-width: 180px;
        background: var(--lex-bg-elevated, #FFFFFF);
        border: 1px solid var(--lex-border-default);
        border-radius: var(--lex-radius-lg, 8px);
        box-shadow: var(--lex-shadow-lg);
        z-index: var(--lex-z-dropdown, 10);
        padding: 6px;
        display: flex;
        flex-direction: column;
      }
      .lex-th-filter-options {
        max-height: 200px;
        overflow-y: auto;
      }
      .lex-th-filter-dropdown label {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 6px;
        font-size: var(--lex-body-xs-size, 0.75rem);
        font-weight: 400;
        text-transform: none;
        letter-spacing: 0;
        color: var(--lex-text-primary);
        border-radius: 4px;
        cursor: pointer;
      }
      .lex-th-filter-dropdown label:hover {
        background: var(--lex-bg-accent-soft, #F5F0EA);
      }
      .lex-th-filter-dropdown input[type="checkbox"] {
        width: 14px;
        height: 14px;
        accent-color: var(--lex-bg-accent, #8B7355);
      }
      .lex-th-filter-dropdown .lex-col-filter-actions {
        display: flex;
        gap: 4px;
        justify-content: flex-end;
        padding: 6px 4px 2px;
        border-top: 1px solid var(--lex-border-default);
        margin-top: 4px;
      }
      .lex-th-filter-dropdown button {
        padding: 3px 10px;
        font-size: var(--lex-body-xs-size, 0.75rem);
        border-radius: 4px;
        cursor: pointer;
        border: none;
      }
      .lex-th-filter-dropdown .lex-col-filter-apply {
        background: var(--lex-bg-accent, #8B7355);
        color: white;
      }
      .lex-th-filter-dropdown .lex-col-filter-clear {
        background: transparent;
        color: var(--lex-text-secondary);
        border: 1px solid var(--lex-border-default);
      }

      /* Selection checkboxes */
      .lex-select-check {
        width: 15px;
        height: 15px;
        accent-color: var(--lex-bg-accent, #8B7355);
        cursor: pointer;
      }

      /* Bulk action bar */
      .lex-bulk-bar {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 12px;
        background: var(--lex-bg-accent-soft, #F5F0EA);
        border-radius: var(--lex-radius-md, 6px);
        margin-bottom: 8px;
        font-size: var(--lex-form-font-size, 0.8125rem);
        flex-shrink: 0;
      }
      .lex-bulk-count {
        font-weight: 600;
        color: var(--lex-text-accent, #8B7355);
      }
      .lex-bulk-actions {
        display: flex;
        gap: 6px;
      }
      .lex-bulk-btn {
        padding: 3px 10px;
        font-size: var(--lex-body-xs-size, 0.75rem);
        border-radius: var(--lex-radius-md, 6px);
        border: 1px solid var(--lex-border-default, #E8E5E1);
        background: var(--lex-bg-primary);
        color: var(--lex-text-primary);
        cursor: pointer;
        transition: all 0.15s;
      }
      .lex-bulk-btn:hover {
        border-color: var(--lex-text-secondary);
      }
      .lex-bulk-btn-danger {
        color: var(--lex-status-danger-text, #B42318);
        border-color: var(--lex-status-danger-text, #B42318);
      }
      .lex-bulk-btn-danger:hover {
        background: var(--lex-status-danger-bg, #FEF3F2);
      }
      .lex-bulk-clear {
        margin-left: auto;
        font-size: var(--lex-form-help-size, 0.6875rem);
        color: var(--lex-text-tertiary);
        cursor: pointer;
        background: none;
        border: none;
        padding: 2px 6px;
      }
      .lex-bulk-clear:hover {
        color: var(--lex-text-primary);
      }

      /* Selected row highlight */
      tr.lex-row-selected {
        background: var(--lex-bg-accent-soft, #F5F0EA) !important;
      }
    `;
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // Helper utilities (module-scoped)
  // ---------------------------------------------------------------------------

  /**
   * Detect whether a string value looks like an ISO date (YYYY-MM-DD...).
   * Uses string-method character checks instead of regex — NO regex allowed.
   * Requires length >= 10, positions 4 and 7 to be '-', and the three
   * numeric segments (year, month, day) to parse as finite integers.
   * @param {string} val
   * @returns {boolean}
   */
  function _isDateString(val) {
    if (typeof val !== 'string' || val.length < 10) return false;
    if (val.charAt(4) !== '-' || val.charAt(7) !== '-') return false;
    var year  = parseInt(val.substring(0, 4), 10);
    var month = parseInt(val.substring(5, 7), 10);
    var day   = parseInt(val.substring(8, 10), 10);
    return isFinite(year) && isFinite(month) && isFinite(day);
  }

  // ---------------------------------------------------------------------------
  // LexTable component
  // ---------------------------------------------------------------------------

  class LexTable extends withDataSource(LexElement) {
    static get properties() {
      return {
        ...super.properties,
        columns:       { type: String },       // Comma-separated column keys (auto-detected if empty)
        labels:        { type: String },       // Comma-separated column labels (defaults to column keys)
        sortBy:        { type: String },
        sortDir:       { type: String, default: 'asc' },
        compact:       { type: Boolean, default: false },
        columnFilters: { type: Boolean, default: false },
        emptyText:     { type: String, default: 'No data found' },
        bulkActions:   { type: Array, default: [] }   // [{label, action, variant, icon}]
      };
    }

    constructor() {
      super();
      this._searchValue = '';
      this._searchTimer = null;
      this._searchHadFocus = false;
      this._selectedIds = new Set();
      this._colFilterOpen = null;  // Which column's filter dropdown is open
      // Column-type detection cache — invalidated when the raw data reference changes
      this._filterCacheDataRef = null;
      this._cachedFilterColumns = null;
    }

    connected() {
      super.connected();
      injectStyles();

      // Sync initial sort state to the dataSource
      if (this.sortBy && this.dataSource && this.dataSource._sortBy !== this.sortBy) {
        this.dataSource._sortBy = this.sortBy;
        this.dataSource._sortDir = this.sortDir || 'asc';
      }
    }

    _getColumns() {
      if (this.columns) return this.columns.split(',').map(c => c.trim());
      const data = this.dataSource?.data;
      if (Array.isArray(data) && data.length > 0) {
        return Object.keys(data[0]).filter(k => !k.startsWith('_') && k !== 'id');
      }
      return [];
    }

    _getLabels() {
      if (this.labels) return this.labels.split(',').map(l => l.trim());
      return this._getColumns().map(col =>
        col.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      );
    }

    _getSearchColumns() {
      return this._getColumns();
    }

    // -------------------------------------------------------------------------
    // Filter bar helpers
    // -------------------------------------------------------------------------

    get _filterId() {
      if (!this.__filterId) this.__filterId = 'lex-fb-' + Math.random().toString(36).slice(2, 8);
      return this.__filterId;
    }

    _getFilterColumns() {
      const data = this.dataSource?._rawData || this.dataSource?.data;
      if (!Array.isArray(data) || data.length === 0) return [];

      // Return cached result when the data array reference has not changed.
      // Column types are a structural property of the dataset — they only need
      // recomputation when the caller loads a new dataset, not on every render.
      if (data === this._filterCacheDataRef && this._cachedFilterColumns !== null) {
        return this._cachedFilterColumns;
      }

      const columns = this._getColumns();
      const labels = this._getLabels();
      const result = columns.map((col, colIdx) => {
        // Detect type from first non-null value
        const sample = data.find(row => row[col] != null)?.[col];
        let type = 'string';
        if (typeof sample === 'number') type = 'number';
        else if (sample instanceof Date || (typeof sample === 'string' && _isDateString(sample))) type = 'date';

        // Check if it's an enum (few unique values relative to data size)
        const unique = [...new Set(data.map(r => r[col]).filter(v => v != null))];
        if (unique.length <= 10 && unique.length < data.length * 0.3) {
          type = 'enum';
        }

        return {
          key: col,
          label: labels[colIdx] || col.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          type,
          options: type === 'enum' ? unique.sort() : undefined
        };
      });

      this._filterCacheDataRef = data;
      this._cachedFilterColumns = result;
      return result;
    }

    // -------------------------------------------------------------------------
    // Filter API (delegates to dataSource and syncs with filter bar)
    // -------------------------------------------------------------------------

    addFilter(column, operator, value) {
      if (this.dataSource) this.dataSource.setFilter(column, operator, value);
      const fb = this.$('lex-filter-bar');
      if (fb) fb.addFilter(column, operator, value);
    }

    removeFilter(column) {
      if (this.dataSource) this.dataSource.removeFilter(column);
      const fb = this.$('lex-filter-bar');
      if (fb) fb.removeFilter(column);
    }

    clearFilters() {
      if (this.dataSource) this.dataSource.clearFilters();
      const fb = this.$('lex-filter-bar');
      if (fb) fb.clearAll();
    }

    getActiveFilters() {
      return this.dataSource ? this.dataSource.getActiveFilters() : new Map();
    }

    _isStatusValue(val) {
      if (typeof val !== 'string') return false;
      const lower = val.toLowerCase();
      return ['active', 'inactive', 'pending', 'completed', 'failed', 'error',
              'success', 'open', 'closed', 'draft', 'archived'].includes(lower);
    }

    _statusBadgeClass(val) {
      const lower = String(val).toLowerCase();
      const map = {
        active: 'lex-bg-success lex-text-success', success: 'lex-bg-success lex-text-success',
        completed: 'lex-bg-success lex-text-success', open: 'lex-bg-success lex-text-success',
        error: 'lex-bg-danger lex-text-danger', failed: 'lex-bg-danger lex-text-danger',
        inactive: 'lex-bg-neutral lex-text-neutral', closed: 'lex-bg-neutral lex-text-neutral',
        archived: 'lex-bg-neutral lex-text-neutral', draft: 'lex-bg-neutral lex-text-neutral',
        pending: 'lex-bg-warning lex-text-warning'
      };
      return map[lower] || 'lex-bg-neutral lex-text-neutral';
    }

    _renderToolbar(data) {
      const hasSearch = this.searchable;
      const hasFilter = this.filterable;

      if (!hasSearch && !hasFilter) return '';

      const escapedValue = this.escapeHtml(this._searchValue);

      const clearBtn = this._searchValue
        ? `<button type="button" class="lex-search-clear" data-action="clear-search" aria-label="Clear search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>`
        : '';

      // Count text
      let countText = '';
      const pg = this.dataSource?.pagination;
      if (pg) {
        const rawTotal = this.dataSource?._rawData?.length;
        const displayTotal = pg.total;
        if (this.dataSource?._clientSideMode && rawTotal !== undefined && (this._searchValue || (this.dataSource._filters && this.dataSource._filters.size > 0))) {
          countText = `${displayTotal} of ${rawTotal} items`;
        } else {
          countText = `${displayTotal} item${displayTotal !== 1 ? 's' : ''}`;
        }
      }

      // Build toolbar as a column (stacked rows)
      let html = '<div class="lex-table-toolbar">';

      // Top row: search + count
      if (hasSearch) {
        html += '<div class="lex-table-toolbar-row">';
        html += `
          <div class="lex-table-search">
            <svg class="lex-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input type="text" placeholder="Search..." value="${escapedValue}" data-action="table-search" />
            ${clearBtn}
          </div>
        `;
        if (countText) {
          html += `<span class="lex-table-count">${countText}</span>`;
        }
        html += '</div>';
      } else if (countText) {
        // No search but show count on its own row
        html += `<div class="lex-table-toolbar-row"><span class="lex-table-count">${countText}</span></div>`;
      }

      // Filter bar row
      if (hasFilter) {
        const filterColumns = this._getFilterColumns();
        html += `<lex-filter-bar id="${this._filterId}" columns='${JSON.stringify(filterColumns).replace(/'/g, "&#39;")}'></lex-filter-bar>`;
      }

      html += '</div>';
      return html;
    }

    // -----------------------------------------------------------------------
    // Selection API
    // -----------------------------------------------------------------------

    select(id) {
      this._selectedIds.add(String(id));
      this._emitSelectionChange();
      this._scheduleUpdate();
    }

    deselect(id) {
      this._selectedIds.delete(String(id));
      this._emitSelectionChange();
      this._scheduleUpdate();
    }

    selectAll() {
      const data = this.dataSource?.data;
      const idKey = this.idKey || 'id';
      if (Array.isArray(data)) {
        data.forEach((row, idx) => {
          const id = row[idKey] !== undefined ? row[idKey] : idx;
          this._selectedIds.add(String(id));
        });
      }
      this._emitSelectionChange();
      this._scheduleUpdate();
    }

    deselectAll() {
      this._selectedIds.clear();
      this._emitSelectionChange();
      this._scheduleUpdate();
    }

    get selectedItems() {
      const data = this.dataSource?.data;
      const idKey = this.idKey || 'id';
      if (!Array.isArray(data)) return [];
      return data.filter((row, idx) => {
        const id = String(row[idKey] !== undefined ? row[idKey] : idx);
        return this._selectedIds.has(id);
      });
    }

    get selectedIds() {
      return new Set(this._selectedIds);
    }

    _emitSelectionChange() {
      this.emit('selection-change', {
        selected: this.selectedIds,
        items: this.selectedItems,
        count: this._selectedIds.size
      });
    }

    // -----------------------------------------------------------------------
    // Column filter dropdown
    // -----------------------------------------------------------------------

    _renderColFilterDropdown(col) {
      const rawData = this.dataSource?._rawData || this.dataSource?._data || [];
      const uniqueVals = window.Lex.LexDataPipeline.uniqueValues(rawData, col);
      const currentFilter = this.dataSource?._filters?.get(col);
      const checkedVals = currentFilter && currentFilter.operator === 'in'
        ? (Array.isArray(currentFilter.value) ? currentFilter.value : String(currentFilter.value).split(','))
        : (currentFilter ? [String(currentFilter.value)] : []);

      let html = '<div class="lex-th-filter-dropdown" data-col-filter-dropdown>';
      html += '<div class="lex-th-filter-options">';
      uniqueVals.forEach(val => {
        const checked = checkedVals.includes(String(val)) ? ' checked' : '';
        html += `<label><input type="checkbox" data-col-check="${this.escapeHtml(String(val))}"${checked} /> ${this.escapeHtml(String(val))}</label>`;
      });
      html += '</div>';
      html += `<div class="lex-col-filter-actions">
        <button class="lex-col-filter-clear" data-action="col-filter-clear">Clear</button>
        <button class="lex-col-filter-apply" data-action="col-filter-apply">Apply</button>
      </div>`;
      html += '</div>';
      return html;
    }

    render() {
      // Track focus before re-render
      const activeEl = document.activeElement;
      if (activeEl && activeEl.dataset && activeEl.dataset.action === 'table-search' && this.contains(activeEl)) {
        this._searchHadFocus = true;
      }

      // Loading state
      if (this.dataSource?.loading) {
        return `
          <div class="animate-pulse space-y-3 p-4">
            <div class="h-8 lex-bg-tertiary rounded w-full"></div>
            <div class="h-6 lex-bg-secondary rounded w-full"></div>
            <div class="h-6 lex-bg-secondary rounded w-full"></div>
            <div class="h-6 lex-bg-secondary rounded w-full"></div>
          </div>
        `;
      }

      // Error state
      if (this.dataSource?.error) {
        return `<div class="lex-text-danger text-sm p-4">${this.escapeHtml(this.dataSource.error)}</div>`;
      }

      const data = this.dataSource?.data;
      const hasData = Array.isArray(data) && data.length > 0;

      // When searchable, show toolbar even if data is empty (so user can clear search)
      const toolbarHtml = this._renderToolbar(data);

      if (!hasData) {
        return `${toolbarHtml}<lex-empty message="${this.escapeHtml(this.emptyText)}" icon="folder"></lex-empty>`;
      }

      const columns = this._getColumns();
      const labels = this._getLabels();
      const cellPad = this.compact ? 'px-3 py-2' : 'px-4 py-3';
      const idKey = this.idKey || 'id';

      // Header
      let html = toolbarHtml;

      // Bulk action bar (when items selected)
      if (this.selectable && this._selectedIds.size > 0) {
        const bulkActions = Array.isArray(this.bulkActions) ? this.bulkActions : [];
        html += `<div class="lex-bulk-bar">
          <span class="lex-bulk-count">${this._selectedIds.size} selected</span>
          <div class="lex-bulk-actions">
            ${bulkActions.map(a => {
              const dangerClass = a.variant === 'danger' ? ' lex-bulk-btn-danger' : '';
              return `<button class="lex-bulk-btn${dangerClass}" data-bulk-action="${this.escapeHtml(a.action)}">${this.escapeHtml(a.label)}</button>`;
            }).join('')}
          </div>
          <button class="lex-bulk-clear" data-action="deselect-all">Clear selection</button>
        </div>`;
      }

      // aria-label provides an accessible name for the table.
      // Prefer an explicit aria-label attribute on the element; fall back to a generic label.
      const tableLabel = this.getAttribute('aria-label') || this.getAttribute('label') || 'Data table';
      html += `<div class="lex-table-scroll-area" style="flex:1;min-height:0;overflow:auto"><table class="w-full text-sm" aria-label="${this.escapeHtml(tableLabel)}">`;
      html += `<thead><tr class="border-b lex-border lex-bg-secondary">`;

      // Select-all checkbox column
      if (this.selectable) {
        const allIds = data.map((r, i) => String(r[idKey] !== undefined ? r[idKey] : i));
        const allSelected = allIds.length > 0 && allIds.every(id => this._selectedIds.has(id));
        const someSelected = allIds.some(id => this._selectedIds.has(id));
        const indeterminate = someSelected && !allSelected;
        html += `<th scope="col" class="px-2 py-2 w-10">
          <input type="checkbox" data-action="select-all"${allSelected ? ' checked' : ''}${indeterminate ? ' data-indeterminate="true"' : ''} class="lex-select-check" aria-label="Select all rows" />
        </th>`;
      }

      columns.forEach((col, i) => {
        const sortIcon = this.sortBy === col
          ? (this.sortDir === 'asc' ? ' &#9650;' : ' &#9660;')
          : '';

        // Column header filter icon
        let filterIcon = '';
        if (this.columnFilters) {
          const hasFilter = this.dataSource?._filters?.has(col);
          filterIcon = `<span class="lex-th-filter ${hasFilter ? 'lex-th-filter--active' : ''}" data-col-filter="${col}" style="position:relative">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            ${this._colFilterOpen === col ? this._renderColFilterDropdown(col) : ''}
          </span>`;
        }

        html += `<th scope="col" class="text-left ${cellPad} text-xs font-medium lex-text-secondary uppercase tracking-wider cursor-pointer select-none" data-sort-col="${col}">
          ${this.escapeHtml(labels[i] || col)}${sortIcon}${filterIcon}
        </th>`;
      });
      html += `</tr></thead>`;

      // Body
      html += `<tbody class="divide-y lex-divide">`;
      data.forEach((row, idx) => {
        const rowId = row[idKey] !== undefined ? row[idKey] : idx;
        const isSelected = this.selectable && this._selectedIds.has(String(rowId));
        const rowClasses = `${idx % 2 === 0 ? 'lex-bg-primary' : 'lex-bg-secondary'} lex-hover-bg-accent transition-colors cursor-pointer${isSelected ? ' lex-row-selected' : ''}`;
        html += `<tr class="${rowClasses}" data-row-id="${this.escapeHtml(String(rowId))}">`;

        // Selection checkbox cell
        if (this.selectable) {
          html += `<td class="px-2 py-2 w-10">
            <input type="checkbox" data-select-row="${this.escapeHtml(String(rowId))}"${isSelected ? ' checked' : ''} class="lex-select-check" />
          </td>`;
        }

        columns.forEach(col => {
          const val = row[col] ?? '';
          if (this._isStatusValue(val)) {
            html += `<td class="${cellPad}"><span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${this._statusBadgeClass(val)}">${this.escapeHtml(val)}</span></td>`;
          } else {
            html += `<td class="${cellPad} lex-text-primary truncate max-w-xs">${this.escapeHtml(String(val))}</td>`;
          }
        });
        html += `</tr>`;
      });
      html += `</tbody></table></div>`;

      // Pagination
      const pg = this.dataSource?.pagination;
      if (pg && pg.totalPages > 1) {
        const pageSizes = [10, 20, 50, 100];
        const currentLimit = pg.limit || 20;
        html += `
          <div class="lex-pagination-bar">
            <span class="lex-text-secondary" style="font-size:12px">Page ${pg.page} of ${pg.totalPages} (${pg.total} total)</span>
            <div class="lex-pagination-controls">
              <label class="lex-pagination-label">
                <span>Show</span>
                <select data-action="page-size" class="lex-page-size-select">
                  ${pageSizes.map(s => `<option value="${s}"${s === currentLimit ? ' selected' : ''}>${s}</option>`).join('')}
                </select>
              </label>
              <div style="display:flex;gap:4px">
                <button class="lex-page-btn" data-action="prev" ${pg.page <= 1 ? 'disabled' : ''}>Prev</button>
                <button class="lex-page-btn" data-action="next" ${pg.page >= pg.totalPages ? 'disabled' : ''}>Next</button>
              </div>
            </div>
          </div>
        `;
      }

      return html;
    }

    updated() {
      // Restore search input focus after re-render
      if (this._searchHadFocus) {
        const input = this.$('[data-action="table-search"]');
        if (input) {
          input.focus();
          input.selectionStart = input.selectionEnd = input.value.length;
        }
        this._searchHadFocus = false;
      }

      // Row click
      this.delegate('click', '[data-row-id]', (e, el) => {
        // Ignore clicks on buttons or inputs inside rows
        if (e.target.closest('button, input, a')) return;
        const rowId = el.dataset.rowId;
        const data = this.dataSource?.data;
        const idKey = this.idKey || 'id';
        const row = Array.isArray(data)
          ? data.find(r => String(r[idKey]) === rowId || String(data.indexOf(r)) === rowId)
          : null;
        this.emit('row-click', { id: rowId, row });
      });

      // Sort click
      this.delegate('click', '[data-sort-col]', (e, el) => {
        // Don't trigger sort when clicking column filter icon
        if (e.target.closest('[data-col-filter]')) return;
        const col = el.dataset.sortCol;
        if (this.sortBy === col) {
          this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          this.sortBy = col;
          this.sortDir = 'asc';
        }
        this.emit('sort-change', { sortBy: this.sortBy, sortDir: this.sortDir });

        // Delegate sorting to the data source pipeline
        if (this.dataSource) {
          this.dataSource.setSort(this.sortBy, this.sortDir);
        }
      });

      // Search input
      const searchInput = this.$('[data-action="table-search"]');
      if (searchInput) {
        this.listen(searchInput, 'input', (e) => {
          this._searchValue = e.target.value;
          clearTimeout(this._searchTimer);
          this._searchTimer = setTimeout(() => {
            if (this.dataSource) {
              this.dataSource.setSearch(this._searchValue);
            }
          }, 300);
        });

        // Clear button
        const clearBtn = this.$('[data-action="clear-search"]');
        if (clearBtn) {
          this.listen(clearBtn, 'click', () => {
            this._searchValue = '';
            clearTimeout(this._searchTimer);
            if (this.dataSource) {
              this.dataSource.setSearch('');
            }
          });
        }
      }

      // Pagination
      this.delegate('click', '[data-action="prev"]', () => this.dataSource?.prevPage());
      this.delegate('click', '[data-action="next"]', () => this.dataSource?.nextPage());
      this.delegate('change', '[data-action="page-size"]', (e) => {
        const newLimit = parseInt(e.target.value, 10);
        if (this.dataSource && newLimit > 0) this.dataSource.setLimit(newLimit);
      });

      // Filter bar integration
      if (this.filterable) {
        const filterBar = this.$('lex-filter-bar');
        if (filterBar) {
          // Sync filter bar chips from dataSource filters (e.g. column header filters)
          if (this.dataSource && this.dataSource._filters.size > 0 && filterBar.syncFromMap) {
            filterBar.syncFromMap(this.dataSource._filters);
          }
          this.listen(filterBar, 'lex-filter-change', (e) => {
            const { filterMap } = e.detail;
            if (this.dataSource) {
              this.dataSource.setFilters(filterMap);
            }
          });
        }
      }

      // Column header filter toggle (ignore clicks inside the open dropdown)
      this.delegate('click', '[data-col-filter]', (e, el) => {
        e.stopPropagation(); // Don't trigger sort
        if (e.target.closest('[data-col-filter-dropdown]')) return;
        const col = el.dataset.colFilter;
        this._colFilterOpen = this._colFilterOpen === col ? null : col;
        this._scheduleUpdate();
      });

      // Column filter apply
      this.delegate('click', '[data-action="col-filter-apply"]', (e) => {
        e.stopPropagation();
        const checks = this.$$('[data-col-check]:checked');
        const values = checks.map(c => c.dataset.colCheck);
        if (values.length > 0 && this.dataSource && this._colFilterOpen) {
          this.dataSource.setFilter(this._colFilterOpen, 'in', values);
        }
        this._colFilterOpen = null;
        this._scheduleUpdate();
      });

      // Column filter clear
      this.delegate('click', '[data-action="col-filter-clear"]', (e) => {
        e.stopPropagation();
        if (this.dataSource && this._colFilterOpen) {
          this.dataSource.removeFilter(this._colFilterOpen);
        }
        this._colFilterOpen = null;
        this._scheduleUpdate();
      });

      // Close column filter dropdown on outside click
      if (this._colFilterOpen) {
        let skipFirst = true;
        const closeColFilter = (ev) => {
          if (skipFirst) { skipFirst = false; return; }
          if (!ev.target.closest('[data-col-filter-dropdown]') && !ev.target.closest('[data-col-filter]')) {
            this._colFilterOpen = null;
            this._scheduleUpdate();
          }
        };
        document.addEventListener('mousedown', closeColFilter);
        this._eventCleanups.push(() => document.removeEventListener('mousedown', closeColFilter));
      }

      // Selection: row checkbox — use targeted DOM updates to avoid full re-render.
      // A full re-render is only needed when the bulk-action bar must appear or
      // disappear (transition between 0 and 1 selected items, or N to 0).
      this.delegate('change', '[data-select-row]', (e, el) => {
        const id = el.dataset.selectRow;
        const wasEmpty = this._selectedIds.size === 0;

        if (el.checked) {
          this._selectedIds.add(id);
        } else {
          this._selectedIds.delete(id);
        }

        const nowEmpty = this._selectedIds.size === 0;

        // Bulk bar needs to appear/disappear — requires a full re-render.
        if (wasEmpty !== nowEmpty) {
          this._emitSelectionChange();
          this._scheduleUpdate();
          return;
        }

        // Fast path: toggle row highlight and update select-all checkbox state
        // without touching innerHTML at all.
        const row = this.querySelector('tr[data-row-id="' + id + '"]');
        if (row) {
          if (el.checked) {
            row.classList.add('lex-row-selected');
          } else {
            row.classList.remove('lex-row-selected');
          }
        }

        // Update the bulk bar count label in-place
        const bulkCount = this.$('.lex-bulk-count');
        if (bulkCount) {
          bulkCount.textContent = this._selectedIds.size + ' selected';
        }

        // Sync the select-all header checkbox state
        const idKey = this.idKey || 'id';
        const data = this.dataSource?.data;
        if (Array.isArray(data)) {
          const allIds = data.map((r, i) => String(r[idKey] !== undefined ? r[idKey] : i));
          const allSelected = allIds.length > 0 && allIds.every(id2 => this._selectedIds.has(id2));
          const someSelected = allIds.some(id2 => this._selectedIds.has(id2));
          const selectAllCb = this.$('[data-action="select-all"]');
          if (selectAllCb) {
            selectAllCb.checked = allSelected;
            selectAllCb.indeterminate = someSelected && !allSelected;
          }
        }

        this._emitSelectionChange();
      });

      // Selection: select-all
      this.delegate('change', '[data-action="select-all"]', (e, el) => {
        if (el.checked) {
          this.selectAll();
        } else {
          this.deselectAll();
        }
      });

      // Set indeterminate state on select-all checkbox
      const selectAllCb = this.$('[data-action="select-all"]');
      if (selectAllCb && selectAllCb.dataset.indeterminate === 'true') {
        selectAllCb.indeterminate = true;
      }

      // Deselect all
      this.delegate('click', '[data-action="deselect-all"]', () => {
        this.deselectAll();
      });

      // Bulk actions
      this.delegate('click', '[data-bulk-action]', (e, el) => {
        const action = el.dataset.bulkAction;
        this.emit('bulk-action', {
          action,
          items: this.selectedItems,
          count: this._selectedIds.size
        });
      });
    }
  }

  defineLex('lex-table', LexTable);
})();
