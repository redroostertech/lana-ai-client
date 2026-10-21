/**
 * doc-studio-library-table.js
 * The organization library tables shared by the Doc Studio Library view and
 * the Brainchild Organization scope (docs/TABLE-STANDARD.md).
 *
 * The library has two sources that page separately on the server, so they
 * are two tables, picked by the toolbar's Source select, never one merged
 * list:
 *   - "Documents": stored files, server-paged by GET /api/v1/storage/library/files.
 *   - "Doc Studio files": saved presentations, GET /api/v1/deck-studio/presentations.
 *     That endpoint does not page; it returns the whole list (server max 500),
 *     so this table is client-side.
 *
 * Public API (window.DocStudioLibraryTable, or module.exports in Node):
 *   Pure: storedQueryParams, mapStoredFile, mapPresentation, storedRenderers,
 *         presentationRenderers, storedFilterOptions, presentationFilterOptions,
 *         workspaceHref, paginationFromResponse, filesFromResponse, emptyText,
 *         countLabel, SORT_BY_COLUMN, SOURCES, STORED_SORT_OPTIONS,
 *         PRESENTATION_SORT_OPTIONS, PRESENTATION_FETCH_LIMIT
 *   DOM:  createController(options) -> { reload, presentations, source, setSource }
 */

(function (global) {
  'use strict';

  // Type column filter values until GET /library/files/extensions answers.
  var DEFAULT_EXTENSIONS = ['docx', 'doc', 'pdf', 'txt', 'md', 'rtf', 'xlsx', 'xls', 'csv', 'pptx', 'ppt'];
  // The presentations list's own maximum (deck-studio.service listPresentations).
  var PRESENTATION_FETCH_LIMIT = 500;
  // Table column -> library API sort_by.
  var SORT_BY_COLUMN = { name: 'name', created_at: 'created_at', updated_at: 'updated_at' };
  var SOURCES = [
    { value: 'stored', label: 'Documents' },
    { value: 'studio', label: 'Doc Studio files' }
  ];
  var STORED_SORT_OPTIONS = [
    { value: 'updated_at', label: 'Last edited' },
    { value: 'created_at', label: 'Created' },
    { value: 'name', label: 'File' }
  ];
  var PRESENTATION_SORT_OPTIONS = [
    { value: 'created_at', label: 'Created' },
    { value: 'name', label: 'File' },
    { value: 'style', label: 'Style' },
    { value: 'cards', label: 'Sections' }
  ];
  var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function utils() {
    return global && global.Lex && global.Lex.Utils ? global.Lex.Utils : null;
  }

  function ranges() {
    return global && global.LanaLibraryColumnFilters ? global.LanaLibraryColumnFilters : null;
  }

  var MUTED = '<span class="bc-cell-muted">—</span>';

  // Dates go through Lex.Utils (API time is UTC; shown in the user's zone).
  function dateTime(value) {
    var u = utils();
    if (!value || !u) return '';
    var text = u.formatDateTime(value);
    return text === 'Never' ? '' : text;
  }

  function relative(value) {
    var u = utils();
    if (!value || !u) return '';
    var text = u.timeAgo(value);
    return text === '-' ? '' : text;
  }

  function humanize(value) {
    var u = utils();
    if (!value) return '';
    return u && u.humanizeLabel ? u.humanizeLabel(value) : String(value);
  }

  // Values a column filter selected: { operator: 'in', value: [...] } or
  // { operator: 'contains', value }.
  function filterValues(filter) {
    if (!filter) return [];
    var value = filter.value !== undefined ? filter.value : filter;
    return (Array.isArray(value) ? value : [value]).map(String).filter(Boolean);
  }

  function fileName(file) {
    return file.display_filename || file.original_filename || file.original_name ||
      file.filename || file.file_name || file.name || 'Untitled file';
  }

  function extensionOf(name) {
    var clean = String(name || '').split('?')[0];
    var dot = clean.lastIndexOf('.');
    return dot > 0 && dot < clean.length - 1 ? clean.slice(dot + 1).toLowerCase() : '';
  }

  function workspaceName(file) {
    var nested = file.matter || file.workspace || {};
    var label = String(file.matter_name || file.client_matter_name || file.workspace_name ||
      nested.matter_name || nested.name || nested.title || '').trim();
    return label && !UUID_PATTERN.test(label) ? label : '';
  }

  function workspaceId(file) {
    var nested = file.matter || file.workspace || {};
    return String(file.client_matter || file.matter_id || file.workspace_id ||
      nested.matter_id || nested.id || '');
  }

  /**
   * Library API query string for one table query.
   * @param {Object} query - lex-query-change detail
   * @param {string} search - toolbar search text
   * @param {Date} [now]
   * @returns {string}
   */
  function storedQueryParams(query, search, now) {
    var q = query || {};
    var params = new URLSearchParams();
    params.set('page', String(q.page || 1));
    params.set('page_size', String(q.limit || 20));
    params.set('sort_by', SORT_BY_COLUMN[q.sortBy] || 'updated_at');
    params.set('sort_order', q.sortDir === 'asc' ? 'asc' : 'desc');
    var filters = q.filters || {};
    var name = filterValues(filters.name)[0];
    if (name) params.set('name', name);
    var extensions = filterValues(filters.type);
    if (extensions.length) params.set('extensions', extensions.join(','));
    var workspaces = filterValues(filters.workspace);
    if (workspaces.length) params.set('workspaces', workspaces.join(','));
    var shared = ranges();
    if (shared) {
      var created = shared.editedRangeBounds(filterValues(filters.created_at)[0], now);
      if (created.after) params.set('created_after', created.after);
      if (created.before) params.set('created_before', created.before);
      var edited = shared.editedRangeBounds(filterValues(filters.updated_at)[0], now);
      if (edited.after) params.set('updated_after', edited.after);
      if (edited.before) params.set('updated_before', edited.before);
    }
    var term = String(search || '').trim();
    if (term) params.set('search', term);
    return params.toString();
  }

  function filesFromResponse(response) {
    if (!response) return [];
    if (Array.isArray(response.files)) return response.files;
    if (Array.isArray(response.documents)) return response.documents;
    if (response.data && Array.isArray(response.data.files)) return response.data.files;
    return [];
  }

  function paginationFromResponse(response, visibleCount) {
    var source = (response && (response.pagination || (response.data && response.data.pagination))) || {};
    var total = Number(source.total !== undefined ? source.total : (response && response.total));
    return {
      page: source.page,
      page_size: source.page_size || source.limit,
      total: Number.isFinite(total) ? total : Number(visibleCount || 0),
      total_pages: source.total_pages !== undefined ? source.total_pages : source.totalPages
    };
  }

  /** Raw row for a stored file. */
  function mapStoredFile(file) {
    var f = file || {};
    var name = fileName(f);
    var id = f.id || f.document_id || f.file_id || '';
    return {
      id: 'storage:' + id,
      name: name,
      type: extensionOf(name),
      workspace: workspaceName(f),
      is_template: Boolean(f.is_template),
      created_at: f.created_at || '',
      updated_at: f.updated_at || f.created_at || '',
      _kind: 'storage',
      _fileId: id,
      _matterId: workspaceId(f),
      _raw: f
    };
  }

  /** Raw row for a saved Doc Studio presentation. */
  function mapPresentation(presentation) {
    var p = presentation || {};
    return {
      id: 'deck:' + p.id,
      name: p.title || 'Untitled file',
      style: p.style || '',
      cards: Number(p.card_count || 0),
      created_at: p.created_at || '',
      _kind: 'deck',
      _presentationId: p.id,
      _raw: p
    };
  }

  /**
   * workspace-details link for a matter id, relative to the page's folder.
   * @param {string} matterId
   * @param {string} [prefix] - '../' from doc-studio/ and brainchild/
   */
  function workspaceHref(matterId, prefix) {
    return (prefix || '') + 'workspace-details.html?id=' + encodeURIComponent(matterId);
  }

  function nameCell(value, subtitle) {
    return '<span class="bc-name-cell">' +
        '<span class="bc-name" title="' + esc(value) + '">' + esc(value) + '</span>' +
        (subtitle ? '<span class="bc-subtitle">' + esc(subtitle) + '</span>' : '') +
      '</span>';
  }

  function createdCell(value) {
    var text = dateTime(value);
    return text ? '<time class="bc-time" datetime="' + esc(value) + '">' + esc(text) + '</time>' : MUTED;
  }

  function editedCell(value) {
    var text = relative(value);
    return text
      ? '<time class="bc-time" datetime="' + esc(value) + '" title="' + esc(dateTime(value)) + '">' + esc(text) + '</time>'
      : MUTED;
  }

  function storedRenderers() {
    return {
      name: function (value, row) {
        var raw = (row && row._raw) || {};
        return nameCell(value, humanize(raw.document_type));
      },
      type: function (value) {
        return value ? '<span class="bc-cell-muted">' + esc(String(value).toUpperCase()) + '</span>' : MUTED;
      },
      workspace: function (value, row) {
        var matterId = row && row._matterId;
        if (value && matterId) {
          return '<button type="button" class="bc-workspace-link" data-matter-id="' + esc(matterId) + '" title="Open ' + esc(value) + ' workspace">' +
            '<span>' + esc(value) + '</span></button>';
        }
        return value ? '<span class="bc-cell-muted">' + esc(value) + '</span>' : MUTED;
      },
      is_template: function (value) {
        return value ? '<lex-badge label="Template" color="green"></lex-badge>' : MUTED;
      },
      created_at: createdCell,
      updated_at: editedCell
    };
  }

  function presentationRenderers() {
    return {
      name: function (value, row) {
        var raw = (row && row._raw) || {};
        return nameCell(value, raw.subtitle || '');
      },
      style: function (value) {
        return value ? '<lex-badge label="' + esc(humanize(value)) + '" color="gray"></lex-badge>' : MUTED;
      },
      cards: function (value) {
        return '<span class="bc-cell-muted">' + esc(Number(value || 0)) + '</span>';
      },
      created_at: createdCell
    };
  }

  /**
   * Header filters for the stored table (server-paged: a column filters only
   * when it is listed here). Template has no API filter yet.
   */
  function storedFilterOptions(state) {
    var s = state || {};
    var extensions = s.extensions && s.extensions.length ? s.extensions : DEFAULT_EXTENSIONS;
    var map = {
      name: { text: true, placeholder: 'File name contains...' },
      type: { options: extensions.map(function (ext) { return { value: ext, label: String(ext).toUpperCase() }; }) }
    };
    if (s.workspaces && s.workspaces.length) map.workspace = { options: s.workspaces };
    var shared = ranges();
    if (shared) {
      map.created_at = { single: true, options: shared.EDITED_RANGE_OPTIONS };
      map.updated_at = { single: true, options: shared.EDITED_RANGE_OPTIONS };
    }
    return map;
  }

  /** Header filters for the client-side presentations table. */
  function presentationFilterOptions(rows) {
    var styles = {};
    (rows || []).forEach(function (row) { if (row.style) styles[row.style] = true; });
    var map = {
      name: { text: true, placeholder: 'File name contains...' },
      style: {
        options: Object.keys(styles).sort().map(function (value) { return { value: value, label: humanize(value) }; })
      },
      cards: {
        single: true,
        options: [
          { value: '1_5', label: '1 – 5' },
          { value: '6_10', label: '6 – 10' },
          { value: '11_plus', label: '11 or more' }
        ],
        match: function (cell, values) {
          var n = Number(cell || 0);
          switch (values[0]) {
            case '1_5': return n <= 5;
            case '6_10': return n >= 6 && n <= 10;
            case '11_plus': return n >= 11;
            default: return true;
          }
        }
      }
    };
    var shared = ranges();
    if (shared) {
      map.created_at = {
        single: true,
        options: shared.EDITED_RANGE_OPTIONS,
        match: function (cell, values) { return shared.inEditedRange(cell, values[0]); }
      };
    }
    return map;
  }

  function emptyText(source, filtered) {
    if (filtered) return 'No matching files. Try a different search or clear the filters.';
    return source === 'studio' ? 'No saved Doc Studio files yet.' : 'No organization documents yet.';
  }

  function countLabel(total) {
    var n = Number(total || 0);
    return n + (n === 1 ? ' file' : ' files');
  }

  // ---------------------------------------------------------------------------
  // Controller: wires the toolbar and both tables. Element ids come from
  // options.ids: { search, sort, order, source, count, sectionTitle,
  // sectionCount, storedTable, studioTable }.
  // ---------------------------------------------------------------------------

  /**
   * @param {Object} options
   * @param {Object} options.ids
   * @param {Function} options.fetchJson - path -> Promise of parsed JSON; rejects on HTTP errors
   * @param {string} [options.defaultSource] - 'stored' | 'studio'
   * @param {string} [options.linkPrefix] - '../' for pages in a subfolder
   * @param {Function} [options.onOpen] - row -> void
   * @param {Function} [options.onPresentations] - presentations -> void after each load
   * @param {Function} [options.onError] - message -> void
   */
  function createController(options) {
    var opts = options || {};
    var ids = opts.ids || {};
    var doc = global.document;
    function el(id) { return id ? doc.getElementById(id) : null; }
    var stored = el(ids.storedTable);
    var studio = el(ids.studioTable);
    var state = {
      source: opts.defaultSource === 'studio' ? 'studio' : 'stored',
      search: '',
      debounce: null,
      sequence: 0,
      presentations: [],
      filterState: { workspaces: [], extensions: [] },
      ready: false
    };

    function activeTable() { return state.source === 'studio' ? studio : stored; }

    function setCount(text) {
      [ids.count, ids.sectionCount].forEach(function (id) {
        var node = el(id);
        if (node) node.textContent = text;
      });
    }

    function syncStudioCount() {
      if (state.source !== 'studio' || !studio) return;
      var total = studio.dataSource && studio.dataSource.pagination ? studio.dataSource.pagination.total : 0;
      setCount(countLabel(total));
      var filtered = Boolean(studio.dataSource && studio.dataSource._searchQuery) || hasFilters(studio);
      studio.emptyText = emptyText('studio', filtered);
    }

    function hasFilters(table) {
      return Boolean(table && table.dataSource && table.dataSource._filters && table.dataSource._filters.size);
    }

    function sortOrder() {
      var button = el(ids.order);
      return button && button.dataset.order === 'asc' ? 'asc' : 'desc';
    }

    function syncToolbarSort(column, direction) {
      var select = el(ids.sort);
      var button = el(ids.order);
      if (select && select.value !== column) select.value = column;
      if (button) button.dataset.order = direction === 'asc' ? 'asc' : 'desc';
    }

    function applySort(column, direction) {
      var table = activeTable();
      if (!table || !table.dataSource) return;
      table.sortBy = column;
      table.sortDir = direction;
      table.dataSource.setSort(column, direction);
    }

    // Answers the stored table's lex-query-change with one library page.
    async function loadStored(query) {
      if (!stored) return;
      var sequence = ++state.sequence;
      query = query || stored.serverQuery || {};
      try {
        var response = await opts.fetchJson('/api/v1/storage/library/files?' + storedQueryParams(query, state.search));
        if (sequence !== state.sequence) return;
        var files = filesFromResponse(response);
        var pagination = paginationFromResponse(response, files.length);
        var filtered = Boolean(state.search) || Object.keys(query.filters || {}).length > 0;
        stored.emptyText = emptyText('stored', filtered);
        if (state.source === 'stored') setCount(countLabel(pagination.total));
        stored.setServerData(files.map(mapStoredFile), pagination);
      } catch (error) {
        if (sequence !== state.sequence) return;
        if (state.source === 'stored') setCount('');
        stored.setServerError('Documents could not be loaded. Check your connection and try again.');
        if (opts.onError) opts.onError(error && error.message);
      }
    }

    async function loadPresentations() {
      try {
        var payload = await opts.fetchJson('/api/v1/deck-studio/presentations?limit=' + PRESENTATION_FETCH_LIMIT);
        state.presentations = Array.isArray(payload && payload.presentations) ? payload.presentations : [];
      } catch (error) {
        state.presentations = [];
        if (opts.onError) opts.onError(error && error.message);
      }
      if (studio) {
        var rows = state.presentations.map(mapPresentation);
        studio.setColumnFilterOptions(presentationFilterOptions(rows));
        studio.setData(rows);
        syncStudioCount();
      }
      if (opts.onPresentations) opts.onPresentations(state.presentations);
      return state.presentations;
    }

    function applySource(source) {
      state.source = source === 'studio' ? 'studio' : 'stored';
      // lex-table sets display itself, so the hidden attribute would not hide it.
      if (stored) stored.style.display = state.source === 'stored' ? '' : 'none';
      if (studio) studio.style.display = state.source === 'studio' ? '' : 'none';
      var select = el(ids.source);
      if (select && select.value !== state.source) select.value = state.source;
      var title = el(ids.sectionTitle);
      if (title) title.textContent = state.source === 'studio' ? 'Doc Studio files' : 'Documents';
      var sort = el(ids.sort);
      var table = activeTable();
      if (sort) {
        sort.options = state.source === 'studio' ? PRESENTATION_SORT_OPTIONS : STORED_SORT_OPTIONS;
        sort.value = (table && table.sortBy) || (state.source === 'studio' ? 'created_at' : 'updated_at');
      }
      var button = el(ids.order);
      if (button) button.dataset.order = table && table.sortDir === 'asc' ? 'asc' : 'desc';
      if (state.source === 'studio') {
        syncStudioCount();
      } else if (stored && stored.dataSource && stored.dataSource.pagination) {
        setCount(countLabel(stored.dataSource.pagination.total));
      }
    }

    function openWorkspace(matterId) {
      if (!matterId) return;
      global.location.href = workspaceHref(matterId, opts.linkPrefix);
    }

    function bindTable(table) {
      if (!table) return;
      table.addEventListener('click', function (event) {
        var link = event.target && event.target.closest ? event.target.closest('[data-matter-id]') : null;
        if (link) openWorkspace(link.getAttribute('data-matter-id'));
      });
      table.addEventListener('row-click', function (event) {
        var row = event.detail && event.detail.row;
        if (row && opts.onOpen) opts.onOpen(row);
      });
      table.addEventListener('sort-change', function (event) {
        if (table !== activeTable() || !event.detail) return;
        syncToolbarSort(event.detail.sortBy, event.detail.sortDir);
      });
    }

    function bind() {
      if (stored) {
        stored.addEventListener('lex-query-change', function (event) { loadStored(event.detail); });
      }
      if (studio) {
        studio.addEventListener('lex-filter-change', syncStudioCount);
        studio.addEventListener('lex-data-loaded', syncStudioCount);
      }
      bindTable(stored);
      bindTable(studio);
      var source = el(ids.source);
      if (source) {
        source.addEventListener('lex-change', function (event) {
          applySource(String((event.detail && event.detail.value) || 'stored'));
        });
      }
      var sort = el(ids.sort);
      if (sort) {
        sort.addEventListener('lex-change', function (event) {
          var value = String((event.detail && event.detail.value) || '');
          if (value) applySort(value, sortOrder());
        });
      }
      var order = el(ids.order);
      if (order) {
        order.addEventListener('click', function () {
          order.dataset.order = sortOrder() === 'asc' ? 'desc' : 'asc';
          var select = el(ids.sort);
          var table = activeTable();
          applySort(select ? select.value : (table && table.sortBy), sortOrder());
        });
      }
      var search = el(ids.search);
      if (search) {
        ['lex-input', 'lex-change'].forEach(function (name) {
          search.addEventListener(name, function (event) {
            var value = String((event.detail && event.detail.value) || '').trim();
            // Client table: filter now. Server table: wait for typing to stop.
            if (studio && studio.dataSource) studio.dataSource.setSearch(value);
            syncStudioCount();
            global.clearTimeout(state.debounce);
            state.debounce = global.setTimeout(function () {
              if (value === state.search) return;
              state.search = value;
              if (stored && typeof stored.requestServerQuery === 'function') stored.requestServerQuery({ resetPage: true });
            }, 350);
          });
        });
      }
    }

    function loadFilterFacets() {
      var shared = ranges();
      var client = { get: opts.fetchJson };
      if (shared) {
        shared.loadWorkspaceOptions(client).then(function (options) {
          state.filterState.workspaces = options;
          if (stored) stored.setColumnFilterOptions(storedFilterOptions(state.filterState));
        });
      }
      Promise.resolve()
        .then(function () { return opts.fetchJson('/api/v1/storage/library/files/extensions'); })
        .then(function (response) {
          var rows = (response && (response.extensions || (response.data && response.data.extensions))) || [];
          var values = rows.map(function (row) { return String(row && row.value !== undefined ? row.value : row).toLowerCase(); })
            .filter(Boolean);
          if (!values.length) return;
          state.filterState.extensions = values;
          if (stored) stored.setColumnFilterOptions(storedFilterOptions(state.filterState));
        })
        .catch(function () { /* the built-in extension list stays */ });
    }

    function start() {
      if (state.ready) return;
      state.ready = true;
      // Renderers and filters before the first rows land.
      if (stored) {
        stored.setCellRenderers(storedRenderers());
        stored.setColumnFilterOptions(storedFilterOptions(state.filterState));
      }
      if (studio) studio.setCellRenderers(presentationRenderers());
      bind();
      applySource(state.source);
      loadFilterFacets();
    }

    /** Refetch both sources (after a save, rename, delete...). */
    function reload() {
      start();
      if (stored && typeof stored.requestServerQuery === 'function') stored.requestServerQuery();
      return loadPresentations();
    }

    return {
      start: start,
      reload: reload,
      setSource: applySource,
      get source() { return state.source; },
      get presentations() { return state.presentations; },
      loadStored: loadStored
    };
  }

  var moduleApi = {
    SOURCES: SOURCES,
    SORT_BY_COLUMN: SORT_BY_COLUMN,
    STORED_SORT_OPTIONS: STORED_SORT_OPTIONS,
    PRESENTATION_SORT_OPTIONS: PRESENTATION_SORT_OPTIONS,
    PRESENTATION_FETCH_LIMIT: PRESENTATION_FETCH_LIMIT,
    DEFAULT_EXTENSIONS: DEFAULT_EXTENSIONS,
    filterValues: filterValues,
    storedQueryParams: storedQueryParams,
    filesFromResponse: filesFromResponse,
    paginationFromResponse: paginationFromResponse,
    mapStoredFile: mapStoredFile,
    mapPresentation: mapPresentation,
    workspaceHref: workspaceHref,
    storedRenderers: storedRenderers,
    presentationRenderers: presentationRenderers,
    storedFilterOptions: storedFilterOptions,
    presentationFilterOptions: presentationFilterOptions,
    emptyText: emptyText,
    countLabel: countLabel,
    createController: createController
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.DocStudioLibraryTable = moduleApi;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
