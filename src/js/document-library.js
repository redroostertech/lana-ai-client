/* LANA Document Library dashboard.
   Shows the latest organization files by edit time and reuses the shared
   document creation flow used by the global menu and workspace details.
*/
(function (global) {
  'use strict';

  var TABLE_ID = 'documentLibraryTable';
  // File families the library lists. Images are out of scope, so "All" asks
  // for these four instead of sending no filter.
  var LIBRARY_FAMILIES = ['document', 'spreadsheet', 'presentation', 'pdf'];
  // Type column filter values (the server's file_family names).
  var FAMILY_OPTIONS = [
    { value: 'document', label: 'Documents' },
    { value: 'spreadsheet', label: 'Spreadsheets' },
    { value: 'presentation', label: 'Presentations' },
    { value: 'pdf', label: 'PDFs' }
  ];
  var loadSequence = 0;
  var searchTerm = '';
  var searchDebounce = null;
  var openingFileIds = {};

  function el(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function icon(name) {
    if (global.Lex && Lex.Icons && typeof Lex.Icons.get === 'function') {
      return Lex.Icons.get({ name: name, size: 'small' });
    }
    return '';
  }

  function filesFromResponse(response) {
    if (!response) return [];
    if (Array.isArray(response.files)) return response.files;
    if (Array.isArray(response.documents)) return response.documents;
    if (Array.isArray(response.items)) return response.items;
    if (Array.isArray(response.data)) return response.data;
    if (response.data && Array.isArray(response.data.files)) return response.data.files;
    if (response.data && Array.isArray(response.data.documents)) return response.data.documents;
    if (response.data && Array.isArray(response.data.items)) return response.data.items;
    return [];
  }

  function paginationFromResponse(response, visibleCount) {
    var source = response && (response.pagination || (response.data && response.data.pagination));
    source = source || {};
    var total = Number(source.total !== undefined ? source.total : (response && response.total));
    return {
      page: source.page,
      page_size: source.page_size || source.limit,
      total: Number.isFinite(total) ? total : Number(visibleCount || 0),
      total_pages: source.total_pages !== undefined ? source.total_pages : source.totalPages
    };
  }

  // Values a column filter selected: lex-table sends { operator: 'in', value: [...] }.
  function filterValues(filter) {
    if (!filter) return [];
    var value = filter.value !== undefined ? filter.value : filter;
    return (Array.isArray(value) ? value : [value]).map(String).filter(Boolean);
  }

  // The Type filter's families, or every library family (never images).
  function fileFamilyParam(families) {
    var picked = (families || []).filter(function (family) { return LIBRARY_FAMILIES.indexOf(family) !== -1; });
    return (picked.length ? picked : LIBRARY_FAMILIES).join(',');
  }

  function fileName(file) {
    return file.display_filename || file.original_filename || file.original_name ||
      file.filename || file.file_name || file.name || 'Untitled file';
  }

  function isOrganizationScoped(file) {
    var metadata = file && file.metadata;
    return String((file && file.access_scope) || (metadata && metadata.access_scope) || '').toLowerCase() === 'organization';
  }

  function fileWorkspace(file) {
    if (isOrganizationScoped(file)) return 'Organization';
    var nestedMatter = file.matter || file.workspace || {};
    var label = file.matter_name || file.client_matter_name || file.workspace_name || file.workspaceName ||
      nestedMatter.matter_name || nestedMatter.name || nestedMatter.title || '';
    var normalized = String(label || '').trim();
    var uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return normalized && !uuidPattern.test(normalized) ? normalized : '—';
  }

  function fileWorkspaceId(file) {
    if (isOrganizationScoped(file)) return '';
    var nestedMatter = file.matter || file.workspace || {};
    return file.matter_id || file.workspace_id || file.client_matter ||
      nestedMatter.matter_id || nestedMatter.workspace_id || nestedMatter.id || '';
  }

  function editedAt(file) {
    return file.updated_at || file.document_updated_at || file.modified_at || file.last_modified_at || file.created_at || '';
  }

  function extensionFor(file) {
    var name = fileName(file);
    var lastDot = name.lastIndexOf('.');
    return lastDot > 0 && lastDot < name.length - 1 ? name.slice(lastDot + 1).toLowerCase() : '';
  }

  function filePresentation(file) {
    var mime = String(file.content_type || file.mime_type || '').toLowerCase();
    var ext = extensionFor(file);

    if (mime.indexOf('spreadsheet') !== -1 || mime.indexOf('excel') !== -1 || mime.indexOf('csv') !== -1 ||
        ['xls', 'xlsx', 'csv', 'ods'].indexOf(ext) !== -1) {
      return { icon: 'table-2', tone: 'sheet', label: ext ? ext.toUpperCase() : 'Spreadsheet' };
    }
    if (mime.indexOf('presentation') !== -1 || mime.indexOf('powerpoint') !== -1 ||
        ['ppt', 'pptx', 'odp'].indexOf(ext) !== -1) {
      return { icon: 'monitor', tone: 'slides', label: ext ? ext.toUpperCase() : 'Presentation' };
    }
    if (mime.indexOf('pdf') !== -1 || ext === 'pdf') {
      return { icon: 'file-text', tone: 'pdf', label: 'PDF' };
    }
    if (mime.indexOf('image/') === 0 || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].indexOf(ext) !== -1) {
      return { icon: 'image', tone: 'image', label: ext ? ext.toUpperCase() : 'Image' };
    }
    if (mime.indexOf('word') !== -1 || mime.indexOf('document') !== -1 || mime.indexOf('text/') === 0 ||
        ['doc', 'docx', 'odt', 'rtf', 'txt', 'md'].indexOf(ext) !== -1) {
      return { icon: 'file-text', tone: 'document', label: ext ? ext.toUpperCase() : 'Document' };
    }
    return { icon: 'file', tone: 'file', label: ext ? ext.toUpperCase() : 'File' };
  }

  function formatFileSize(bytes) {
    var value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return '';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    var amount = value / Math.pow(1024, index);
    return (index === 0 ? Math.round(amount) : Number(amount.toFixed(1))) + ' ' + units[index];
  }

  // Dates go through Lex.Utils: API timestamps are system time (UTC) and
  // display in the user's timezone (profile, then org, then browser).
  function relativeTime(value) {
    if (!value || !global.Lex || !Lex.Utils) return '';
    var text = Lex.Utils.timeAgo(value);
    return text === '-' ? '' : text;
  }

  function absoluteTime(value) {
    if (!value || !global.Lex || !Lex.Utils) return '';
    var text = Lex.Utils.formatDateTime(value);
    return text === 'Never' ? '' : text;
  }


  function table() {
    return el(TABLE_ID);
  }

  // The count shows in the toolbar and the section header, as on the Library.
  function setCount(text) {
    ['documentLibraryCount', 'documentLibraryRecentCount'].forEach(function (id) {
      var count = el(id);
      if (count) count.textContent = text;
    });
  }

  function sortOrder() {
    var button = el('documentLibrarySortOrder');
    return button && button.dataset.order === 'asc' ? 'asc' : 'desc';
  }

  // Toolbar sort drives the table, which asks the server for page 1.
  function applySort(column, direction) {
    var target = table();
    if (!target || !target.dataSource) return;
    target.sortBy = column;
    target.sortDir = direction;
    target.dataSource.setSort(column, direction);
  }

  // A header click sorted the table: mirror it in the toolbar.
  function syncToolbarSort(column, direction) {
    var select = el('documentLibrarySort');
    var button = el('documentLibrarySortOrder');
    if (select && select.value !== column) select.value = column;
    if (button) button.dataset.order = direction === 'asc' ? 'asc' : 'desc';
  }

  // Table column -> library API sort_by.
  var SORT_BY_COLUMN = { name: 'name', size: 'file_size', created_at: 'created_at', updated_at: 'updated_at' };

  function mapFileForTable(file) {
    return {
      id: file.id || file.document_id || file.file_id || '',
      name: fileName(file),
      type: filePresentation(file).label,
      size: formatFileSize(file.file_size || file.size),
      workspace: fileWorkspace(file),
      created_at: file.created_at || '',
      updated_at: editedAt(file),
      _raw: file
    };
  }

  function cellRenderers() {
    return {
      name: function (val, row) {
        var presentation = filePresentation(row._raw);
        return '<span class="document-library-file-cell">' +
            '<span class="document-library-file-icon document-library-file-icon--' + esc(presentation.tone) + '" aria-hidden="true">' + icon(presentation.icon) + '</span>' +
            '<span class="document-library-file-name" title="' + esc(val) + '">' + esc(val) + '</span>' +
          '</span>';
      },
      type: function (val) {
        return '<span class="document-library-cell-muted">' + esc(val || '\u2014') + '</span>';
      },
      size: function (val) {
        return '<span class="document-library-cell-muted">' + esc(val || '\u2014') + '</span>';
      },
      workspace: function (workspaceName, row) {
        var workspaceId = fileWorkspaceId(row._raw);
        if (workspaceId && workspaceName !== '—') {
          return '<button class="document-library-workspace-link" type="button" data-workspace-id="' + esc(workspaceId) + '" title="Open ' + esc(workspaceName) + ' workspace">' +
              '<span>' + esc(workspaceName) + '</span>' +
            '</button>';
        }
        return '<span class="document-library-cell-muted">' + esc(workspaceName) + '</span>';
      },
      created_at: function (created) {
        return '<time class="document-library-file-time" datetime="' + esc(created) + '" title="' + esc(absoluteTime(created)) + '">' +
            esc(absoluteTime(created) || '\u2014') +
          '</time>';
      },
      updated_at: function (edited) {
        return '<time class="document-library-file-time" datetime="' + esc(edited) + '" title="' + esc(absoluteTime(edited)) + '">' +
            esc(relativeTime(edited) || '\u2014') +
          '</time>';
      }
    };
  }

  // Empty copy depends on the filters outside the table: a filtered-empty
  // state offers no create button.
  function syncEmptyState(target, filters) {
    var filtered = Boolean(searchTerm || Object.keys(filters || {}).length);
    target.emptyText = filtered ? 'No matching documents. Try a different search or document type.' : 'No edited files yet';
    target.emptyActionLabel = filtered ? '' : 'New Document';
  }

  // Answers the table's lex-query-change with one page from the library API.
  async function loadLatestFiles(query) {
    var target = table();
    var client = global.api;
    if (!target) return;
    var sequence = ++loadSequence;
    query = query || target.serverQuery;

    if (!client || typeof client.get !== 'function') {
      target.setServerError('Files could not be loaded. The API client is unavailable.');
      return;
    }

    try {
      var params = new URLSearchParams();
      params.set('page', String(query.page || 1));
      params.set('page_size', String(query.limit || 20));
      params.set('sort_by', SORT_BY_COLUMN[query.sortBy] || 'updated_at');
      params.set('sort_order', query.sortDir || 'desc');
      var filters = query.filters || {};
      params.set('file_family', fileFamilyParam(filterValues(filters.type)));
      var workspaces = filterValues(filters.workspace);
      if (workspaces.length) params.set('workspaces', workspaces.join(','));
      var ranges = global.LanaLibraryColumnFilters;
      var edited = ranges ? ranges.editedRangeBounds(filterValues(filters.updated_at)[0]) : { after: '', before: '' };
      if (edited.after) params.set('updated_after', edited.after);
      if (edited.before) params.set('updated_before', edited.before);
      var created = ranges ? ranges.editedRangeBounds(filterValues(filters.created_at)[0]) : { after: '', before: '' };
      if (created.after) params.set('created_after', created.after);
      if (created.before) params.set('created_before', created.before);
      if (searchTerm) params.set('search', searchTerm);
      var response = await client.get('/api/v1/storage/library/files?' + params.toString());
      if (sequence !== loadSequence || !el('documentLibrary')) return;
      var files = filesFromResponse(response);
      var pagination = paginationFromResponse(response, files.length);
      syncEmptyState(target, filters);
      setCount(pagination.total + (pagination.total === 1 ? ' file' : ' files'));
      target.setServerData(files.map(mapFileForTable), pagination);
    } catch (error) {
      if (sequence !== loadSequence || !el('documentLibrary')) return;
      console.error('[DocumentLibrary] Failed to load latest edited files:', error);
      setCount('');
      target.setServerError('Files could not be loaded. Check your connection and try again.');
    }
  }

  // Outside filters changed: back to page 1 through the table.
  function reloadFromFirstPage() {
    var target = table();
    if (target && typeof target.requestServerQuery === 'function') {
      target.requestServerQuery({ resetPage: true });
    }
  }

  function openCreateDocument() {
    if (!global.LanaDocumentCreate || typeof global.LanaDocumentCreate.open !== 'function') {
      if (global.Lex && Lex.Toast && typeof Lex.Toast.error === 'function') {
        Lex.Toast.error('Document creation is unavailable on this page.');
      }
      return;
    }
    global.LanaDocumentCreate.open({ source: 'document_library' });
  }

  function showFileAccessDenied() {
    if (global.Lex && Lex.Modal && typeof Lex.Modal.alert === 'function') {
      Lex.Modal.alert('Access denied', 'You do not have access to this file.', {
        variant: 'danger',
        confirmText: 'OK'
      });
      return;
    }
    if (global.Lex && Lex.Toast && typeof Lex.Toast.error === 'function') {
      Lex.Toast.error('You do not have access to this file.');
    }
  }

  function isAccessDenied(error) {
    return !!error && (Number(error.status) === 403 || Number(error.status) === 404);
  }

  async function openFile(fileId, workspaceId) {
    if (!fileId || openingFileIds[fileId]) return;
    openingFileIds[fileId] = true;
    try {
      if (!global.api || typeof global.api.get !== 'function') {
        throw new Error('The API client is unavailable.');
      }
      // This preflight provides immediate UX, while the file viewer/download
      // endpoints independently enforce the same policy server-side.
      await global.api.get('/api/v1/storage/files/' + encodeURIComponent(fileId));
      if (global.Lex && Lex.Nav && typeof Lex.Nav.go === 'function') {
        var navParams = { id: fileId };
        if (workspaceId) navParams.matter_id = workspaceId;
        Lex.Nav.go('file-viewer.html', {
          params: navParams,
          context: { referrer: 'document-library.html' }
        });
        return;
      }
      var params = new URLSearchParams({ id: fileId });
      if (workspaceId) params.set('matter_id', workspaceId);
      global.location.href = 'file-viewer.html?' + params.toString();
    } catch (error) {
      if (isAccessDenied(error)) {
        showFileAccessDenied();
      } else if (global.Lex && Lex.Toast && typeof Lex.Toast.error === 'function') {
        Lex.Toast.error((error && error.message) || 'The file could not be opened.');
      }
    } finally {
      delete openingFileIds[fileId];
    }
  }

  function openWorkspace(workspaceId) {
    if (!workspaceId) return;
    if (global.Lex && Lex.Nav && typeof Lex.Nav.go === 'function') {
      Lex.Nav.go('workspace-details.html', {
        params: { id: workspaceId },
        context: { referrer: 'document-library.html' }
      });
      return;
    }
    global.location.href = 'workspace-details.html?id=' + encodeURIComponent(workspaceId);
  }

  function bindEvents(root) {
    if (root.getAttribute('data-document-library-bound') === 'true') return;
    root.setAttribute('data-document-library-bound', 'true');
    root.addEventListener('click', function (event) {
      var workspaceTarget = event.target && event.target.closest ? event.target.closest('[data-workspace-id]') : null;
      if (workspaceTarget) {
        openWorkspace(workspaceTarget.getAttribute('data-workspace-id'));
        return;
      }
      var actionTarget = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
      if (actionTarget && actionTarget.getAttribute('data-action') === 'new-document') {
        openCreateDocument();
      }
    });
    // lex-table events bubble from #documentLibraryTable.
    root.addEventListener('lex-query-change', function (event) {
      if (!event.target || event.target.id !== TABLE_ID) return;
      loadLatestFiles(event.detail);
    });
    root.addEventListener('row-click', function (event) {
      if (!event.target || event.target.id !== TABLE_ID) return;
      var row = event.detail && event.detail.row;
      if (row && row.id) openFile(row.id, fileWorkspaceId(row._raw));
    });
    root.addEventListener('empty-action', function (event) {
      if (!event.target || event.target.id !== TABLE_ID) return;
      openCreateDocument();
    });
    root.addEventListener('sort-change', function (event) {
      if (!event.target || event.target.id !== TABLE_ID || !event.detail) return;
      syncToolbarSort(event.detail.sortBy, event.detail.sortDir);
    });
    root.addEventListener('click', function (event) {
      var button = event.target && event.target.closest ? event.target.closest('#documentLibrarySortOrder') : null;
      if (!button) return;
      button.dataset.order = sortOrder() === 'asc' ? 'desc' : 'asc';
      var select = el('documentLibrarySort');
      applySort(select ? select.value : 'updated_at', sortOrder());
    });
    root.addEventListener('lex-change', function (event) {
      var id = event.target && event.target.id;
      var value = String((event.detail && event.detail.value) || '');
      if (id === 'documentLibraryTypeFilter') {
        // Same state as the Type column filter, as My Tasks' Status select does.
        var target = table();
        if (!target) return;
        if (value && value !== 'all') target.addFilter('type', 'in', [value]);
        else target.removeFilter('type');
      } else if (id === 'documentLibrarySort') {
        applySort(value || 'updated_at', sortOrder());
      }
    });
    // lex-input emits lex-input while typing and lex-change on clear.
    ['lex-input', 'lex-change'].forEach(function (name) {
      root.addEventListener(name, function (event) {
        if (!event.target || event.target.id !== 'documentLibrarySearch') return;
        var value = String((event.detail && event.detail.value) || '').trim();
        global.clearTimeout(searchDebounce);
        searchDebounce = global.setTimeout(function () {
          if (value === searchTerm) return;
          searchTerm = value;
          reloadFromFirstPage();
        }, 350);
      });
    });
  }

  function init() {
    var root = el('documentLibrary');
    if (!root) return;
    var search = el('documentLibrarySearch');
    searchTerm = search && search.value ? String(search.value).trim() : '';
    bindEvents(root);
    var ready = global.customElements && typeof global.customElements.whenDefined === 'function'
      ? global.customElements.whenDefined('lex-table')
      : Promise.resolve();
    ready.then(function () {
      var target = table();
      if (!target) return;
      // Renderers must be registered before the first page lands.
      target.setCellRenderers(cellRenderers());
      applyColumnFilterOptions(target, []);
      reloadFromFirstPage();
      if (global.LanaLibraryColumnFilters) {
        global.LanaLibraryColumnFilters.loadWorkspaceOptions(global.api).then(function (options) {
          if (table() === target) applyColumnFilterOptions(target, options);
        });
      }
    });
  }

  function applyColumnFilterOptions(target, workspaceOptions) {
    var shared = global.LanaLibraryColumnFilters;
    var map = { type: { options: FAMILY_OPTIONS } };
    if (workspaceOptions && workspaceOptions.length) map.workspace = { options: workspaceOptions };
    if (shared) {
      map.created_at = { single: true, options: shared.EDITED_RANGE_OPTIONS };
      map.updated_at = { single: true, options: shared.EDITED_RANGE_OPTIONS };
    }
    target.setColumnFilterOptions(map);
  }

  global.LanaDocumentLibrary = {
    init: init,
    loadLatestFiles: loadLatestFiles,
    filesFromResponse: filesFromResponse,
    fileFamilyParam: fileFamilyParam,
    currentFilters: function () {
      var target = table();
      var query = target && target.dataSource ? target.dataSource.query : {};
      return { search: searchTerm, filters: query.filters || {}, page: query.page || 1, pageSize: query.limit || 20 };
    }
  };

  if (global.LexRouter && typeof LexRouter.registerPageInit === 'function') {
    LexRouter.registerPageInit('document-library.html', init);
  }

  init();
})(window);
