/* Lex UI — Data List Component
   Scrollable data list with endpoint binding, search, sorting, filtering, and selection.

   Usage:
     <lex-list endpoint="/api/v1/matters" display-key="title" secondary-key="status"></lex-list>
     <lex-list endpoint="/api/v1/contacts" display-key="name" searchable sortable sort-keys="name,email,status"></lex-list>
     <lex-list endpoint="/api/v1/matters" display-key="title" filterable searchable></lex-list>
     <lex-list endpoint="/api/v1/items" display-key="name" selectable bulk-actions='[{"label":"Delete","action":"delete","variant":"danger"}]'></lex-list>

   Events: item-click, sort-change, lex-search, lex-filter-change, selection-change, bulk-action
*/

(function () {
  'use strict';

  const { LexElement, defineLex, withDataSource } = window.Lex;

  let stylesInjected = false;

  // -----------------------------------------------------------------------
  // Inject styles once
  // -----------------------------------------------------------------------

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-list-styles';
    style.textContent = `
      .lex-list-toolbar {
        display: flex;
        flex-direction: row;
        gap: 8px;
        padding: 8px 12px;
        align-items: center;
        margin-bottom: 4px;
      }

      .lex-list-search {
        position: relative;
        flex: 1;
        max-width: 260px;
      }

      .lex-list-search input {
        height: 30px;
        width: 100%;
        border-radius: var(--lex-radius-md, 6px);
        border: 1px solid var(--lex-border-default);
        padding-left: 30px;
        padding-right: 28px;
        font-size: 13px;
        background: var(--lex-bg-primary);
        color: var(--lex-text-primary);
        outline: none;
        transition: border 0.15s;
        box-sizing: border-box;
      }

      .lex-list-search input:focus {
        border-color: var(--lex-input-border-focus);
      }

      .lex-list-search svg {
        position: absolute;
        left: 8px;
        top: 50%;
        transform: translateY(-50%);
        width: 14px;
        height: 14px;
        color: var(--lex-text-tertiary);
        pointer-events: none;
      }

      .lex-list-search .lex-search-clear {
        position: absolute;
        right: 6px;
        top: 50%;
        transform: translateY(-50%);
        cursor: pointer;
        width: 16px;
        height: 16px;
        color: var(--lex-text-tertiary);
        background: none;
        border: none;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color 0.15s;
      }

      .lex-list-search .lex-search-clear:hover {
        color: var(--lex-text-primary);
      }

      .lex-list-sort {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-left: auto;
      }

      .lex-list-sort select {
        height: 28px;
        font-size: 12px;
        border: 1px solid var(--lex-border-default);
        border-radius: var(--lex-radius-sm, 4px);
        padding: 0 24px 0 8px;
        background: var(--lex-bg-primary);
        color: var(--lex-text-secondary);
        cursor: pointer;
        outline: none;
        appearance: auto;
      }

      .lex-list-sort-dir {
        width: 28px;
        height: 28px;
        flex-shrink: 0;
        border-radius: var(--lex-radius-sm, 4px);
        border: 1px solid var(--lex-border-default);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        background: var(--lex-bg-primary);
        color: var(--lex-text-secondary);
        transition: all 0.15s;
        padding: 0;
      }

      .lex-list-sort-dir:hover {
        border-color: var(--lex-text-secondary);
      }

      .lex-list-sort-dir svg {
        width: 14px;
        height: 14px;
      }

      .lex-list-count {
        font-size: 11px;
        color: var(--lex-text-tertiary);
        padding: 0 12px 4px;
      }

      /* Pagination */
      .lex-list-pagination {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        border-top: 1px solid var(--lex-border-default, #E8E5E1);
      }
      .lex-list-pagination .lex-page-size-select {
        appearance: none;
        -webkit-appearance: none;
        padding: 3px 22px 3px 8px;
        font-size: 12px;
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
      .lex-list-pagination .lex-page-size-select:hover {
        border-color: var(--lex-border-strong, #C5BDB2);
      }
      .lex-list-pagination .lex-page-size-select:focus {
        border-color: var(--lex-input-border-focus, #8B7355);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--lex-input-border-focus, #8B7355) 20%, transparent);
      }
      .lex-list-page-btn {
        padding: 3px 12px;
        font-size: 12px;
        border-radius: var(--lex-radius-md, 6px);
        border: 1px solid var(--lex-border-default, #E8E5E1);
        background: var(--lex-bg-primary, #fff);
        color: var(--lex-text-secondary);
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .lex-list-page-btn:hover:not(:disabled) {
        background: var(--lex-bg-secondary, #F5F5F0);
        border-color: var(--lex-border-strong, #C5BDB2);
      }
      .lex-list-page-btn:disabled {
        opacity: 0.35;
        cursor: default;
      }

      /* Selection styles */
      .lex-list-select-all {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        border-bottom: 1px solid var(--lex-border-default, #E8E5E1);
      }
      .lex-select-check {
        width: 15px;
        height: 15px;
        accent-color: var(--lex-bg-accent, #8B7355);
        cursor: pointer;
        flex-shrink: 0;
      }
      .lex-bulk-bar {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 12px;
        background: var(--lex-bg-accent-soft, #F5F0EA);
        border-radius: var(--lex-radius-md, 6px);
        margin-bottom: 8px;
        font-size: 13px;
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
        font-size: 12px;
        border-radius: var(--lex-radius-md, 6px);
        border: 1px solid var(--lex-border-default);
        background: var(--lex-bg-primary);
        color: var(--lex-text-primary);
        cursor: pointer;
        transition: all 0.15s;
      }
      .lex-bulk-btn:hover {
        border-color: var(--lex-text-secondary);
      }
      .lex-bulk-btn-danger {
        color: var(--lex-text-danger, #C53030);
        border-color: var(--lex-text-danger, #C53030);
      }
      .lex-bulk-btn-danger:hover {
        background: var(--lex-bg-danger, #FFF5F5);
      }
      .lex-bulk-clear {
        margin-left: auto;
        font-size: 11px;
        color: var(--lex-text-tertiary);
        cursor: pointer;
        background: none;
        border: none;
        padding: 2px 6px;
      }
      .lex-bulk-clear:hover {
        color: var(--lex-text-primary);
      }
    `;
    document.head.appendChild(style);
  }

  // -----------------------------------------------------------------------
  // SVG templates
  // -----------------------------------------------------------------------

  const SEARCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

  const CLEAR_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  const SORT_ASC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 11 12 6 7 11"/><line x1="12" y1="6" x2="12" y2="18"/></svg>';

  const SORT_DESC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 13 12 18 17 13"/><line x1="12" y1="18" x2="12" y2="6"/></svg>';

  // -----------------------------------------------------------------------
  // Humanize a field key: "first_name" -> "First Name", "createdAt" -> "Created At"
  // -----------------------------------------------------------------------

  function humanize(key) {
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/[_-]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim();
  }

  // -----------------------------------------------------------------------
  // Component
  // -----------------------------------------------------------------------

  class LexList extends withDataSource(LexElement) {
    static get properties() {
      return {
        ...super.properties,
        displayKey:   { type: String, default: 'name' },
        secondaryKey: { type: String },
        badgeKey:     { type: String },
        avatarKey:    { type: String },
        emptyText:    { type: String, default: 'No items found' },
        maxHeight:    { type: String },
        searchable:   { type: Boolean, default: false },
        filterable:   { type: Boolean, default: false },
        sortable:     { type: Boolean, default: false },
        sortBy:       { type: String },
        sortDir:      { type: String, default: 'asc' },
        sortKeys:     { type: String },
        idKey:        { type: String, default: 'id' },
        bulkActions:  { type: Array, default: [] }
      };
    }

    constructor() {
      super();
      this._searchValue = '';
      this._searchTimer = null;
      this._selectedIds = new Set();
    }

    connected() {
      super.connected();
      injectStyles();

      // Sync initial sort state to dataSource
      if (this.sortBy && this.dataSource) {
        this.dataSource._sortBy = this.sortBy;
        this.dataSource._sortDir = this.sortDir || 'asc';
      }
    }

    // -----------------------------------------------------------------------
    // Determine which columns can be sorted
    // -----------------------------------------------------------------------

    _getSortKeys() {
      if (this.sortKeys) {
        return this.sortKeys.split(',').map(k => k.trim()).filter(Boolean);
      }
      // Auto-detect from configured keys
      const keys = [];
      if (this.displayKey) keys.push(this.displayKey);
      if (this.secondaryKey) keys.push(this.secondaryKey);
      if (this.badgeKey) keys.push(this.badgeKey);
      return keys;
    }

    // -----------------------------------------------------------------------
    // Specify which columns the pipeline should search
    // -----------------------------------------------------------------------

    _getSearchColumns() {
      const cols = [];
      if (this.displayKey) cols.push(this.displayKey);
      if (this.secondaryKey) cols.push(this.secondaryKey);
      if (this.badgeKey) cols.push(this.badgeKey);
      return cols.length > 0 ? cols : null;
    }

    // -----------------------------------------------------------------------
    // Auto-detect filterable columns from data
    // -----------------------------------------------------------------------

    _getFilterColumns() {
      const data = this.dataSource?._rawData || this.dataSource?.data;
      if (!Array.isArray(data) || data.length === 0) return [];
      const keys = [this.displayKey, this.secondaryKey, this.badgeKey].filter(Boolean);
      // Also detect other keys from data
      if (data.length > 0) {
        Object.keys(data[0]).forEach(k => {
          if (!k.startsWith('_') && k !== 'id' && !keys.includes(k)) keys.push(k);
        });
      }
      return keys.map(col => {
        const sample = data.find(row => row[col] != null)?.[col];
        let type = 'string';
        if (typeof sample === 'number') type = 'number';
        else if (sample instanceof Date || (typeof sample === 'string' && /^\d{4}-\d{2}-\d{2}/.test(sample))) type = 'date';
        const unique = [...new Set(data.map(r => r[col]).filter(v => v != null))];
        if (unique.length <= 10 && unique.length < data.length * 0.3) type = 'enum';
        return {
          key: col,
          label: col.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim(),
          type,
          options: type === 'enum' ? unique.sort() : undefined
        };
      });
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
      if (Array.isArray(data)) {
        data.forEach((item, idx) => {
          const id = item[this.idKey] || item.id || idx;
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
      if (!Array.isArray(data)) return [];
      return data.filter((item, idx) => {
        const id = String(item[this.idKey] || item.id || idx);
        return this._selectedIds.has(id);
      });
    }

    get selectedIds() {
      return [...this._selectedIds];
    }

    _emitSelectionChange() {
      this.emit('selection-change', {
        selectedIds: this.selectedIds,
        selectedItems: this.selectedItems,
        count: this._selectedIds.size
      });
    }

    // -----------------------------------------------------------------------
    // Filter API (programmatic, delegates to dataSource + filter bar)
    // -----------------------------------------------------------------------

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

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------

    render() {
      // Preserve focus before re-render
      const activeEl = document.activeElement;
      const hadSearchFocus = activeEl && activeEl.matches && activeEl.matches('[data-input="list-search"]');
      const searchCursorPos = hadSearchFocus ? activeEl.selectionStart : null;

      if (this.dataSource?.loading) {
        return `
          <div class="animate-pulse space-y-2 p-2">
            ${Array(4).fill('<div class="h-12 lex-bg-tertiary rounded-lg"></div>').join('')}
          </div>
        `;
      }

      if (this.dataSource?.error) {
        return `<div class="lex-text-danger text-sm p-4">${this.escapeHtml(this.dataSource.error)}</div>`;
      }

      const data = this.dataSource?.data;
      const rawData = this.dataSource?._rawData;
      const totalCount = Array.isArray(rawData) ? rawData.length : (Array.isArray(data) ? data.length : 0);
      const displayCount = Array.isArray(data) ? data.length : 0;
      const hasData = Array.isArray(data) && data.length > 0;
      const showToolbar = this.searchable || this.sortable;
      const isFiltered = (this._searchValue || '').length > 0;
      const hasActiveFilters = this.dataSource?._filters?.size > 0;

      let html = '';

      // ----- Toolbar -----
      if (showToolbar) {
        html += '<div class="lex-list-toolbar">';

        // Search input
        if (this.searchable) {
          const showClear = (this._searchValue || '').length > 0;
          html += `
            <div class="lex-list-search">
              ${SEARCH_ICON}
              <input
                type="text"
                data-input="list-search"
                placeholder="Search..."
                value="${this.escapeHtml(this._searchValue || '')}"
                autocomplete="off"
                spellcheck="false"
              />
              ${showClear ? `
                <button type="button" class="lex-search-clear" data-action="clear-search" tabindex="-1" aria-label="Clear search">
                  ${CLEAR_ICON}
                </button>
              ` : ''}
            </div>
          `;
        }

        // Sort controls
        if (this.sortable) {
          const sortKeys = this._getSortKeys();
          const currentSort = this.dataSource?._sortBy || this.sortBy || '';
          const currentDir = this.dataSource?._sortDir || this.sortDir || 'asc';

          html += '<div class="lex-list-sort">';
          html += '<select data-action="sort-select">';
          html += '<option value="">Sort by...</option>';
          sortKeys.forEach(key => {
            const selected = key === currentSort ? ' selected' : '';
            html += `<option value="${this.escapeHtml(key)}"${selected}>${this.escapeHtml(humanize(key))}</option>`;
          });
          html += '</select>';
          html += `
            <button type="button" class="lex-list-sort-dir" data-action="sort-dir" title="Toggle sort direction">
              ${currentDir === 'asc' ? SORT_ASC_ICON : SORT_DESC_ICON}
            </button>
          `;
          html += '</div>';
        }

        html += '</div>';
      }

      // ----- Filter bar -----
      if (this.filterable) {
        const filterColumns = this._getFilterColumns();
        html += `
          <div style="padding: 4px 12px 8px">
            <lex-filter-bar columns='${JSON.stringify(filterColumns).replace(/'/g, "&#39;")}'></lex-filter-bar>
          </div>
        `;
      }

      // ----- Count display -----
      if ((isFiltered || hasActiveFilters) && totalCount > 0) {
        html += `<div class="lex-list-count">${displayCount} of ${totalCount} items</div>`;
      } else if (showToolbar && totalCount > 0) {
        html += `<div class="lex-list-count">${totalCount} items</div>`;
      }

      // ----- Bulk action bar (when items are selected) -----
      if (this.selectable && this._selectedIds.size > 0) {
        const count = this._selectedIds.size;
        const actions = Array.isArray(this.bulkActions) ? this.bulkActions : [];
        html += `
          <div class="lex-bulk-bar">
            <span class="lex-bulk-count">${count} selected</span>
            <div class="lex-bulk-actions">
              ${actions.map(a => {
                const variantClass = a.variant === 'danger' ? ' lex-bulk-btn-danger' : '';
                const iconHtml = a.icon ? `<span style="margin-right: 3px">${this.escapeHtml(a.icon)}</span>` : '';
                return `<button class="lex-bulk-btn${variantClass}" data-bulk-action="${this.escapeHtml(a.action)}">${iconHtml}${this.escapeHtml(a.label)}</button>`;
              }).join('')}
            </div>
            <button class="lex-bulk-clear" data-action="deselect-all">Clear</button>
          </div>
        `;
      }

      // ----- Empty state -----
      if (!hasData) {
        if (isFiltered || hasActiveFilters) {
          html += `<lex-empty message="No matching items" icon="search"></lex-empty>`;
        } else {
          html += `<lex-empty message="${this.escapeHtml(this.emptyText)}" icon="inbox"></lex-empty>`;
        }
        // Store focus info for restoration
        this._restoreFocus = hadSearchFocus ? searchCursorPos : null;
        return html;
      }

      // ----- Select-all row -----
      if (this.selectable) {
        const allIds = data.map((item, idx) => String(item[this.idKey] || item.id || idx));
        const allSelected = allIds.length > 0 && allIds.every(id => this._selectedIds.has(id));
        const someSelected = !allSelected && allIds.some(id => this._selectedIds.has(id));
        html += `
          <div class="lex-list-select-all">
            <input type="checkbox" data-action="select-all" ${allSelected ? 'checked' : ''} ${someSelected ? 'data-indeterminate="true"' : ''} class="lex-select-check" />
            <span class="text-xs lex-text-secondary">Select all</span>
          </div>
        `;
      }

      // ----- List items -----
      const scrollStyle = this.maxHeight ? `max-height: ${this.maxHeight}; overflow-y: auto;` : '';

      html += `
        <div class="divide-y lex-divide" style="${scrollStyle}">
          ${data.map((item, idx) => {
            const id = item[this.idKey] || item.id || idx;
            const idStr = String(id);
            const display = item[this.displayKey] || '';
            const secondary = this.secondaryKey ? (item[this.secondaryKey] || '') : '';
            const badge = this.badgeKey ? (item[this.badgeKey] || '') : '';
            const avatar = this.avatarKey ? (item[this.avatarKey] || '') : '';
            const checked = this._selectedIds.has(idStr);

            return `
              <div class="flex items-center gap-3 px-3 py-3 lex-hover-bg cursor-pointer transition-colors" data-item-id="${id}">
                ${this.selectable ? `
                  <input type="checkbox" data-select-item="${this.escapeHtml(idStr)}" ${checked ? 'checked' : ''} class="lex-select-check" />
                ` : ''}
                ${avatar ? `
                  <div class="w-8 h-8 rounded-full lex-bg-accent-muted flex items-center justify-center flex-shrink-0 lex-text-accent text-xs font-semibold">
                    ${this.escapeHtml(avatar.charAt(0).toUpperCase())}
                  </div>
                ` : ''}
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-medium lex-text-primary truncate">${this.escapeHtml(display)}</div>
                  ${secondary ? `<div class="text-xs lex-text-secondary truncate">${this.escapeHtml(secondary)}</div>` : ''}
                </div>
                ${badge ? `<lex-badge label="${this.escapeHtml(badge)}" color="${this._badgeColor(badge)}"></lex-badge>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `;

      // Pagination
      const pg = this.dataSource?.pagination;
      if (pg && pg.totalPages > 1) {
        const pageSizes = [10, 20, 50, 100];
        const currentLimit = pg.limit || 20;
        html += `
          <div class="lex-list-pagination">
            <span class="lex-text-secondary" style="font-size:12px">Page ${pg.page} of ${pg.totalPages} (${pg.total} total)</span>
            <div style="display:flex;align-items:center;gap:12px">
              <label style="display:flex;align-items:center;gap:6px;color:var(--lex-text-secondary);font-size:12px">
                <span>Show</span>
                <select data-action="page-size" class="lex-page-size-select">
                  ${pageSizes.map(s => `<option value="${s}"${s === currentLimit ? ' selected' : ''}>${s}</option>`).join('')}
                </select>
              </label>
              <div style="display:flex;gap:4px">
                <button class="lex-list-page-btn" data-action="prev" ${pg.page <= 1 ? 'disabled' : ''}>Prev</button>
                <button class="lex-list-page-btn" data-action="next" ${pg.page >= pg.totalPages ? 'disabled' : ''}>Next</button>
              </div>
            </div>
          </div>
        `;
      }

      // Store focus info for restoration
      this._restoreFocus = hadSearchFocus ? searchCursorPos : null;

      return html;
    }

    _badgeColor(val) {
      const lower = String(val).toLowerCase();
      if (['active', 'success', 'open', 'completed'].includes(lower)) return 'green';
      if (['error', 'failed', 'closed'].includes(lower)) return 'red';
      if (['pending', 'processing'].includes(lower)) return 'yellow';
      if (['draft', 'inactive', 'archived'].includes(lower)) return 'gray';
      return 'gray';
    }

    // -----------------------------------------------------------------------
    // Event wiring
    // -----------------------------------------------------------------------

    updated() {
      // Restore search input focus after re-render
      if (this._restoreFocus !== null && this._restoreFocus !== undefined) {
        const searchInput = this.$('[data-input="list-search"]');
        if (searchInput) {
          searchInput.focus();
          const pos = this._restoreFocus;
          if (typeof pos === 'number' && pos >= 0) {
            searchInput.setSelectionRange(pos, pos);
          }
        }
        this._restoreFocus = null;
      }

      // ----- Search input listener (debounced) -----
      const searchInput = this.$('[data-input="list-search"]');
      if (searchInput) {
        this.listen(searchInput, 'input', (e) => {
          const val = e.target.value;
          this._searchValue = val;

          clearTimeout(this._searchTimer);
          this._searchTimer = setTimeout(() => {
            if (this.dataSource) {
              this.dataSource.setSearch(val);
            }
            this.emit('lex-search', { query: val });
          }, 300);
        });
      }

      // ----- Clear search button -----
      this.delegate('click', '[data-action="clear-search"]', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._searchValue = '';
        clearTimeout(this._searchTimer);
        this._searchTimer = null;

        if (this.dataSource) {
          this.dataSource.setSearch('');
        }
        this.emit('lex-search', { query: '' });
        this._scheduleUpdate();

        queueMicrotask(() => {
          const inp = this.$('[data-input="list-search"]');
          if (inp) inp.focus();
        });
      });

      // ----- Sort select change -----
      this.delegate('change', '[data-action="sort-select"]', (e) => {
        const col = e.target.value;
        const dir = this.dataSource?._sortDir || this.sortDir || 'asc';

        this.sortBy = col;

        if (this.dataSource) {
          this.dataSource.setSort(col, dir);
        }
        this.emit('sort-change', { sortBy: col, sortDir: dir });
      });

      // ----- Sort direction toggle -----
      this.delegate('click', '[data-action="sort-dir"]', () => {
        const currentDir = this.dataSource?._sortDir || this.sortDir || 'asc';
        const newDir = currentDir === 'asc' ? 'desc' : 'asc';
        const currentSort = this.dataSource?._sortBy || this.sortBy || '';

        this.sortDir = newDir;

        if (this.dataSource && currentSort) {
          this.dataSource.setSort(currentSort, newDir);
        }
        this.emit('sort-change', { sortBy: currentSort, sortDir: newDir });
      });

      // ----- Filter bar integration -----
      if (this.filterable) {
        const filterBar = this.$('lex-filter-bar');
        if (filterBar) {
          this.listen(filterBar, 'lex-filter-change', (e) => {
            const { filterMap } = e.detail;
            if (this.dataSource) {
              this.dataSource.setFilters(filterMap);
            }
          });
        }
      }

      // ----- Pagination -----
      this.delegate('click', '[data-action="prev"]', () => this.dataSource?.prevPage());
      this.delegate('click', '[data-action="next"]', () => this.dataSource?.nextPage());
      this.delegate('change', '[data-action="page-size"]', (e) => {
        const newLimit = parseInt(e.target.value, 10);
        if (this.dataSource && newLimit > 0) this.dataSource.setLimit(newLimit);
      });

      // ----- Selection event wiring -----
      if (this.selectable) {
        // Select all checkbox
        this.delegate('change', '[data-action="select-all"]', (e) => {
          e.target.checked ? this.selectAll() : this.deselectAll();
        });

        // Individual item checkbox
        this.delegate('change', '[data-select-item]', (e, el) => {
          const id = el.dataset.selectItem;
          el.checked ? this.select(id) : this.deselect(id);
        });

        // Deselect all button
        this.delegate('click', '[data-action="deselect-all"]', () => this.deselectAll());

        // Bulk action buttons
        this.delegate('click', '[data-bulk-action]', (e, el) => {
          this.emit('bulk-action', {
            action: el.dataset.bulkAction,
            items: this.selectedItems,
            count: this._selectedIds.size
          });
        });

        // Set indeterminate state on the select-all checkbox
        const selectAllCb = this.$('[data-action="select-all"]');
        if (selectAllCb && selectAllCb.dataset.indeterminate === 'true') {
          selectAllCb.indeterminate = true;
        }
      }

      // ----- Item click delegate -----
      this.delegate('click', '[data-item-id]', (e, el) => {
        // Ignore clicks on checkboxes (selection) or other inputs
        if (e.target.closest('input')) return;

        const id = el.dataset.itemId;
        const data = this.dataSource?.data;
        const item = Array.isArray(data) ? data.find(r => String(r[this.idKey] || r.id) === id || String(data.indexOf(r)) === id) : null;
        this.emit('item-click', { id, item });
      });
    }
  }

  defineLex('lex-list', LexList);
})();
