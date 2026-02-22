/* ==========================================================================
   Lex UI — Data Source Layer
   Connects components to API endpoints for Tier 2 (Dynamic) usage.
   Uses the existing global window.api (ApiClient) for requests.

   Provides:
     - LexDataPipeline: Client-side filter/search/sort/paginate engine
     - LexDataSource:   Manages fetch/loading/error state for an endpoint
     - withDataSource:  Mixin to add data binding to any LexElement
   ========================================================================== */

(function (global) {
  'use strict';

  const { LexElement } = global.Lex;

  // =========================================================================
  // LexDataPipeline — Client-side data processing engine
  // Stateless utility: rawData → filter → search → sort → paginate → result
  // =========================================================================

  class LexDataPipeline {

    /**
     * Process raw data through the full pipeline.
     * @param {Array} rawData - The unprocessed data array
     * @param {Object} options
     * @param {Map}    options.filters       - Map<column, {operator, value}>
     * @param {string} options.searchQuery   - Free-text search string
     * @param {Array}  options.searchColumns - Columns to search (null = all)
     * @param {string} options.sortBy        - Column to sort by
     * @param {string} options.sortDir       - 'asc' | 'desc'
     * @param {number} options.page          - Current page (1-indexed)
     * @param {number} options.limit         - Items per page (0 = no pagination)
     * @returns {{ data: Array, pagination: Object }}
     */
    static process(rawData, options = {}) {
      if (!Array.isArray(rawData)) return { data: [], pagination: { page: 1, limit: 0, total: 0, totalPages: 0 } };

      let data = rawData;

      // Step 1: Filter
      if (options.filters && options.filters.size > 0) {
        data = LexDataPipeline.applyFilters(data, options.filters);
      }

      // Step 2: Search
      if (options.searchQuery) {
        data = LexDataPipeline.applySearch(data, options.searchQuery, options.searchColumns);
      }

      // Step 3: Sort
      if (options.sortBy) {
        data = LexDataPipeline.applySort(data, options.sortBy, options.sortDir || 'asc');
      }

      const total = data.length;

      // Step 4: Paginate
      const limit = options.limit || 0;
      const page = options.page || 1;
      if (limit > 0) {
        const start = (page - 1) * limit;
        data = data.slice(start, start + limit);
      }

      return {
        data,
        pagination: {
          page,
          limit: limit || total,
          total,
          totalPages: limit > 0 ? Math.ceil(total / limit) : 1
        }
      };
    }

    /**
     * Apply filters to data array.
     * @param {Array} data
     * @param {Map} filters - Map<column, {operator, value}>
     * @returns {Array}
     */
    static applyFilters(data, filters) {
      return data.filter(row => {
        for (const [column, { operator, value }] of filters) {
          const cellValue = row[column];
          if (!LexDataPipeline._matchOperator(cellValue, operator || 'eq', value)) {
            return false;
          }
        }
        return true;
      });
    }

    /**
     * Apply search across columns.
     * @param {Array}  data
     * @param {string} query
     * @param {Array}  columns - Specific columns to search (null = all string/number fields)
     * @returns {Array}
     */
    static applySearch(data, query, columns) {
      if (!query || !query.trim()) return data;
      const q = query.trim().toLowerCase();
      return data.filter(row => {
        const keys = columns || Object.keys(row);
        return keys.some(key => {
          const val = row[key];
          if (val === null || val === undefined) return false;
          return String(val).toLowerCase().includes(q);
        });
      });
    }

    /**
     * Sort data by column.
     * Smart: detects number, date, and string types for comparison.
     * @param {Array}  data
     * @param {string} sortBy
     * @param {string} sortDir - 'asc' | 'desc'
     * @returns {Array}
     */
    static applySort(data, sortBy, sortDir) {
      const dir = sortDir === 'desc' ? -1 : 1;
      return [...data].sort((a, b) => {
        const aVal = a[sortBy] ?? '';
        const bVal = b[sortBy] ?? '';

        // Numeric comparison
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return (aVal - bVal) * dir;
        }

        // Date detection (ISO strings)
        const aDate = LexDataPipeline._tryParseDate(aVal);
        const bDate = LexDataPipeline._tryParseDate(bVal);
        if (aDate && bDate) {
          return (aDate - bDate) * dir;
        }

        // String comparison
        return String(aVal).localeCompare(String(bVal)) * dir;
      });
    }

    /**
     * Operator matching for filters.
     */
    static _matchOperator(cellValue, operator, filterValue) {
      // Null/undefined cell values
      if (cellValue === null || cellValue === undefined) {
        if (operator === 'empty') return true;
        if (operator === 'notEmpty') return false;
        return false;
      }
      if (operator === 'empty') return false;
      if (operator === 'notEmpty') return true;

      const cell = cellValue;
      const filter = filterValue;

      switch (operator) {
        case 'eq':
          return String(cell).toLowerCase() === String(filter).toLowerCase();
        case 'neq':
          return String(cell).toLowerCase() !== String(filter).toLowerCase();
        case 'contains':
          return String(cell).toLowerCase().includes(String(filter).toLowerCase());
        case 'startsWith':
          return String(cell).toLowerCase().startsWith(String(filter).toLowerCase());
        case 'gt':
          return Number(cell) > Number(filter);
        case 'gte':
          return Number(cell) >= Number(filter);
        case 'lt':
          return Number(cell) < Number(filter);
        case 'lte':
          return Number(cell) <= Number(filter);
        case 'in': {
          const set = Array.isArray(filter) ? filter : String(filter).split(',');
          return set.some(v => String(cell).toLowerCase() === String(v).trim().toLowerCase());
        }
        case 'between': {
          const [min, max] = Array.isArray(filter) ? filter : String(filter).split(',');
          const num = Number(cell);
          return num >= Number(min) && num <= Number(max);
        }
        default:
          return String(cell).toLowerCase() === String(filter).toLowerCase();
      }
    }

    /**
     * Try to parse a value as a Date. Returns timestamp or null.
     * Uses string-method character checks instead of regex — no regex allowed.
     * Detects ISO date patterns: YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.
     * Requires length >= 10, dashes at positions 4 and 7, and the year/month/day
     * segments to each parse as finite integers.
     */
    static _tryParseDate(val) {
      if (val instanceof Date) return val.getTime();
      if (typeof val !== 'string' || val.length < 10) return null;
      // Check structural markers: '-' at positions 4 and 7
      if (val.charAt(4) !== '-' || val.charAt(7) !== '-') return null;
      // Verify each numeric segment is a finite integer
      const year  = parseInt(val.substring(0, 4), 10);
      const month = parseInt(val.substring(5, 7), 10);
      const day   = parseInt(val.substring(8, 10), 10);
      if (!isFinite(year) || !isFinite(month) || !isFinite(day)) return null;
      const ts = Date.parse(val);
      return isNaN(ts) ? null : ts;
    }

    /**
     * Extract unique values for a column (for column filter dropdowns).
     * @param {Array}  data
     * @param {string} column
     * @returns {Array}
     */
    static uniqueValues(data, column) {
      const set = new Set();
      for (const row of data) {
        const val = row[column];
        if (val !== null && val !== undefined && val !== '') {
          set.add(val);
        }
      }
      return [...set].sort((a, b) => String(a).localeCompare(String(b)));
    }
  }

  // =========================================================================
  // LexDataSource — Endpoint binding with state management
  // Enhanced with dual-mode: endpoint (API) or client-side (pipeline)
  // =========================================================================

  class LexDataSource {
    constructor(element, config = {}) {
      this.element = element;
      this.endpoint = config.endpoint || null;
      this.params = config.params || {};
      this.autoFetch = config.autoFetch !== false;
      this.pollInterval = config.pollInterval || 0;
      this.transform = config.transform || (data => data);

      // Core data state
      this._data = null;
      this._loading = false;
      this._error = null;
      this._timer = null;
      this._pagination = { page: 1, limit: 20, total: 0, totalPages: 0 };

      // Pipeline state
      this._rawData = null;           // Original unprocessed data (client-side mode)
      this._displayData = null;       // Post-pipeline processed data
      this._displayPagination = null; // Pagination computed after client-side processing
      this._filters = new Map();      // Map<column, {operator, value}>
      this._searchQuery = '';
      this._sortBy = '';
      this._sortDir = 'asc';
      this._clientSideMode = false;   // True when data injected via setData()
    }

    // -----------------------------------------------------------------------
    // Getters — backward-compatible, returns processed data when available
    // -----------------------------------------------------------------------

    get data() {
      if (this._clientSideMode && this._displayData !== null) return this._displayData;
      return this._data;
    }

    get loading()    { return this._loading; }
    get error()      { return this._error; }

    get pagination() {
      if (this._clientSideMode && this._displayPagination) return { ...this._displayPagination };
      return { ...this._pagination };
    }

    // -----------------------------------------------------------------------
    // Filter API
    // -----------------------------------------------------------------------

    setFilter(column, operator, value) {
      this._filters.set(column, { operator, value });
      this._onPipelineChanged();
    }

    removeFilter(column) {
      this._filters.delete(column);
      this._onPipelineChanged();
    }

    setFilters(filtersMap) {
      this._filters.clear();
      if (filtersMap instanceof Map) {
        for (const [k, v] of filtersMap) this._filters.set(k, v);
      } else if (filtersMap && typeof filtersMap === 'object') {
        for (const [k, v] of Object.entries(filtersMap)) {
          if (typeof v === 'object' && v.operator) {
            this._filters.set(k, v);
          } else {
            this._filters.set(k, { operator: 'eq', value: v });
          }
        }
      }
      this._onPipelineChanged();
    }

    clearFilters() {
      this._filters.clear();
      this._onPipelineChanged();
    }

    getActiveFilters() {
      return new Map(this._filters);
    }

    // -----------------------------------------------------------------------
    // Search API
    // -----------------------------------------------------------------------

    setSearch(query) {
      this._searchQuery = query || '';
      this._onPipelineChanged();
    }

    // -----------------------------------------------------------------------
    // Sort API
    // -----------------------------------------------------------------------

    setSort(column, direction) {
      this._sortBy = column || '';
      this._sortDir = direction || 'asc';
      this._onPipelineChanged();
    }

    // -----------------------------------------------------------------------
    // Pipeline changed handler — determines endpoint vs client-side path
    // -----------------------------------------------------------------------

    _onPipelineChanged() {
      if (this._clientSideMode) {
        // Client-side: run pipeline on raw data
        this._pagination.page = 1; // Reset to page 1 on filter/search/sort change
        this._reprocess();
        this.element._scheduleUpdate();
        this.element.emit('lex-filter-change', {
          filters: Object.fromEntries(this._filters),
          searchQuery: this._searchQuery,
          sortBy: this._sortBy,
          sortDir: this._sortDir
        });
      } else if (this.endpoint) {
        // Endpoint mode: re-fetch with updated params
        this._pagination.page = 1;
        this.fetch();
        this.element.emit('lex-filter-change', {
          filters: Object.fromEntries(this._filters),
          searchQuery: this._searchQuery,
          sortBy: this._sortBy,
          sortDir: this._sortDir
        });
      }
    }

    // -----------------------------------------------------------------------
    // Client-side pipeline execution
    // -----------------------------------------------------------------------

    _reprocess() {
      if (!this._rawData) return;

      const searchColumns = this.element._getSearchColumns
        ? this.element._getSearchColumns()
        : null;

      const result = LexDataPipeline.process(this._rawData, {
        filters: this._filters,
        searchQuery: this._searchQuery,
        searchColumns,
        sortBy: this._sortBy,
        sortDir: this._sortDir,
        page: this._pagination.page,
        limit: this._pagination.limit
      });

      this._displayData = result.data;
      this._displayPagination = result.pagination;
    }

    // -----------------------------------------------------------------------
    // Fetch — enhanced with sort/filter/search query params
    // -----------------------------------------------------------------------

    async fetch(overrideParams = {}) {
      if (!this.endpoint) return;

      const api = window.api;
      if (!api) {
        this._error = 'API client not available';
        this.element._scheduleUpdate();
        return;
      }

      this._loading = true;
      this._error = null;
      this.element._scheduleUpdate();

      try {
        const params = { ...this.params, ...overrideParams };

        // Add pagination params
        if (params.page === undefined) params.page = this._pagination.page;
        if (params.limit === undefined) params.limit = this._pagination.limit;

        // Add sort params (endpoint mode)
        if (this._sortBy && params.sortBy === undefined) {
          params.sortBy = this._sortBy;
          params.sortOrder = this._sortDir;
        }

        // Add search param
        if (this._searchQuery && params.q === undefined) {
          params.q = this._searchQuery;
        }

        // Add filter params: filter[column]=operator:value
        for (const [column, { operator, value }] of this._filters) {
          const key = `filter[${column}]`;
          if (params[key] === undefined) {
            params[key] = operator === 'eq' ? value : `${operator}:${value}`;
          }
        }

        const queryString = Object.entries(params)
          .filter(([, v]) => v !== null && v !== undefined && v !== '')
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join('&');

        const url = queryString ? `${this.endpoint}?${queryString}` : this.endpoint;

        let response;
        if (api.get) {
          response = await api.get(url);
        } else if (api.request) {
          response = await api.request(url, { method: 'GET' });
        } else {
          const fetchResponse = await fetch(url);
          response = await fetchResponse.json();
        }

        // Extract data and pagination from response
        const rawData = response.data || response.results || response;
        this._data = this.transform(rawData);

        // Extract pagination metadata if present
        if (response.pagination) {
          Object.assign(this._pagination, response.pagination);
        } else if (response.total !== undefined) {
          this._pagination.total = response.total;
          this._pagination.totalPages = Math.ceil(response.total / this._pagination.limit);
        }

        this._loading = false;
        this.element._scheduleUpdate();
        this.element.emit('lex-data-loaded', { data: this._data, pagination: this._pagination });

      } catch (err) {
        this._error = err.message || 'Failed to load data';
        this._loading = false;
        this.element._scheduleUpdate();
        this.element.emit('lex-data-error', { error: this._error });
      }
    }

    // -----------------------------------------------------------------------
    // Pagination helpers
    // -----------------------------------------------------------------------

    async goToPage(page) {
      this._pagination.page = page;
      if (this._clientSideMode) {
        this._reprocess();
        this.element._scheduleUpdate();
        return;
      }
      return this.fetch();
    }

    async nextPage() {
      const pg = this._clientSideMode ? this._displayPagination : this._pagination;
      if (pg && pg.page < pg.totalPages) {
        return this.goToPage(pg.page + 1);
      }
    }

    async prevPage() {
      const pg = this._clientSideMode ? this._displayPagination : this._pagination;
      if (pg && pg.page > 1) {
        return this.goToPage(pg.page - 1);
      }
    }

    async setLimit(limit) {
      this._pagination.limit = limit;
      this._pagination.page = 1;
      if (this._clientSideMode) {
        this._reprocess();
        this.element._scheduleUpdate();
        return;
      }
      return this.fetch();
    }

    // Refresh current data
    async refresh() {
      if (this._clientSideMode) {
        this._reprocess();
        this.element._scheduleUpdate();
        return;
      }
      return this.fetch();
    }

    // Polling
    startPolling() {
      if (this.pollInterval > 0 && !this._timer) {
        this._timer = setInterval(() => this.fetch(), this.pollInterval);
      }
    }

    stopPolling() {
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }
    }

    destroy() {
      this.stopPolling();
    }
  }

  // =========================================================================
  // withDataSource — Mixin that adds data binding to any LexElement
  // =========================================================================

  function withDataSource(BaseClass) {
    return class extends BaseClass {
      static get properties() {
        return {
          ...super.properties,
          endpoint:     { type: String, attribute: true },
          pollInterval: { type: Number, default: 0 },
          limit:        { type: Number, default: 20 },
          autoFetch:    { type: Boolean, default: true },
          searchable:   { type: Boolean, default: false },
          filterable:   { type: Boolean, default: false },
          selectable:   { type: Boolean, default: false },
          linkedTo:     { type: String },
          idKey:        { type: String, default: 'id' }
        };
      }

      connected() {
        super.connected();
        if (this.endpoint) {
          this.dataSource = new LexDataSource(this, {
            endpoint: this.endpoint,
            params: this._buildParams(),
            pollInterval: this.pollInterval || 0,
            autoFetch: this.autoFetch,
            transform: this.transformData.bind(this)
          });
          this.dataSource._pagination.limit = this.limit;
          if (this.dataSource.autoFetch) {
            this.dataSource.fetch();
          }
          if (this.pollInterval > 0) {
            this.dataSource.startPolling();
          }
        }
      }

      disconnected() {
        super.disconnected();
        if (this.dataSource) {
          this.dataSource.destroy();
          this.dataSource = null;
        }
      }

      // Override in subclass to add custom query params
      _buildParams() { return {}; }

      // Override in subclass to transform API response data
      transformData(data) { return data; }

      // Override in subclass to specify which columns to search
      _getSearchColumns() { return null; }

      // Convenience: refresh data
      refresh() {
        if (this.dataSource) return this.dataSource.refresh();
      }

      // Set data directly (Tier 3 AI-Native or client-side mode)
      setData(data) {
        if (!this.dataSource) {
          this.dataSource = new LexDataSource(this, { autoFetch: false });
        }
        this.dataSource._pagination.limit = this.limit || 20;
        this.dataSource._clientSideMode = true;
        this.dataSource._rawData = Array.isArray(data) ? [...data] : data;
        this.dataSource._data = data;
        this.dataSource._loading = false;
        this.dataSource._error = null;
        this.dataSource._reprocess();
        this._scheduleUpdate();
      }

      // -----------------------------------------------------------------------
      // Filter/Search/Sort convenience methods (delegate to dataSource)
      // -----------------------------------------------------------------------

      addFilter(column, operator, value) {
        if (this.dataSource) this.dataSource.setFilter(column, operator, value);
      }

      removeFilter(column) {
        if (this.dataSource) this.dataSource.removeFilter(column);
      }

      setFilters(filters) {
        if (this.dataSource) this.dataSource.setFilters(filters);
      }

      clearFilters() {
        if (this.dataSource) this.dataSource.clearFilters();
      }

      getActiveFilters() {
        return this.dataSource ? this.dataSource.getActiveFilters() : new Map();
      }
    };
  }

  // =========================================================================
  // Export
  // =========================================================================

  global.Lex.LexDataSource = LexDataSource;
  global.Lex.LexDataPipeline = LexDataPipeline;
  global.Lex.withDataSource = withDataSource;

})(typeof window !== 'undefined' ? window : globalThis);
