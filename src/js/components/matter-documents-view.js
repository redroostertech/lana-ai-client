/**
 * matter-documents-view.js - Reusable matter file-list component.
 *
 * Phase 1 of a staged extraction. Encapsulates the LOGIC of the matter
 * "Documents tab" file list (status/lifecycle badges, client-side search and
 * pagination, per-file Download/Delete/Open actions) so multiple host pages
 * (Library folder browser now, workspace-details later) can render the same
 * file list through one API.
 *
 * Exposes a single global: window.MatterDocumentsView with:
 *   mount(containerEl, opts) -> instance
 *
 * The component owns FILES only. Hosts keep their own folder/subfolder
 * navigation and render the component into a dedicated container.
 *
 * Dependencies (loaded by the host page before this file):
 *   - lex.utils.js  (escapeHtml, formatFileSize, formatRelativeDate)
 *   - lex.icons.js  (getFileIcon)
 *   - lex-pagination.js  (lex-pagination custom element)
 *   - Lex.Toast / Lex.Modal (defaults; overridable via opts)
 *
 * Conventions:
 *   - Event delegation on the container (data-action + data-doc-id). No inline
 *     onclick handlers, no global functions, no inline styles.
 *   - All DOM queries are scoped to the mounted container.
 *   - State is instance-local.
 */
(function () {
  'use strict';

  // ── Shared helper fallbacks ─────────────────────────────────────────

  function esc(value) {
    if (window.escapeHtml) return window.escapeHtml(value);
    return String(value == null ? '' : value)
      .split('&').join('&amp;')
      .split('<').join('&lt;')
      .split('>').join('&gt;')
      .split('"').join('&quot;')
      .split("'").join('&#39;');
  }

  function fileSize(bytes) {
    if (window.formatFileSize) return window.formatFileSize(bytes);
    if (!bytes) return '0 B';
    var k = 1024;
    var sizes = ['B', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function relativeDate(value) {
    if (window.formatRelativeDate) return window.formatRelativeDate(value);
    return value || '';
  }

  function fileIcon(file) {
    var name = (file && (file.filename || file.original_filename)) || '';
    if (window.getFileIcon) return window.getFileIcon(name);
    return '';
  }

  // ── Lifecycle / status helpers (ported from workspace-details) ──────

  function parseDocumentMetadata(doc) {
    var metadata = doc && doc.metadata ? doc.metadata : {};
    if (typeof metadata === 'string') {
      try {
        metadata = JSON.parse(metadata);
      } catch (error) {
        metadata = {};
      }
    }
    return metadata && typeof metadata === 'object' ? metadata : {};
  }

  function getDocumentLifecycle(doc) {
    if (window.documentLifecycle && typeof window.documentLifecycle.getDocumentLifecycle === 'function') {
      return window.documentLifecycle.getDocumentLifecycle(doc);
    }

    var status = String((doc && doc.status) || '').toLowerCase();
    var processingStatus = String((doc && doc.processing_status) || '').toLowerCase();
    var hasCompletedWork = Boolean((doc && doc.processed_at) || (doc && doc.chunk_count > 0) || (doc && doc.vector_count > 0));

    if (processingStatus === 'failed' || status === 'failed' || status === 'error') {
      return 'needs_attention';
    }
    if (processingStatus === 'processing' || status === 'processing' || status === 'text_extracted') {
      return 'processing';
    }
    if (processingStatus === 'completed' || status === 'completed' || status === 'active' || hasCompletedWork) {
      return 'ready';
    }
    if (status === 'cancelled' || status === 'deleted') {
      return 'inactive';
    }
    if (status === 'queued' || status === 'pending' || status === 'ready') {
      return 'uploaded';
    }
    return hasCompletedWork ? 'ready' : 'uploaded';
  }

  function getDocumentStatusDisplay(doc) {
    if (window.documentLifecycle && typeof window.documentLifecycle.getDocumentLifecycleDisplay === 'function') {
      return window.documentLifecycle.getDocumentLifecycleDisplay(doc);
    }

    var lifecycle = getDocumentLifecycle(doc);
    var presentations = {
      'ready': {
        label: 'Ready',
        badgeClass: 'mdv-badge--ready',
        progressLabel: 'Ready to review'
      },
      'processing': {
        label: 'Processing',
        badgeClass: 'mdv-badge--processing',
        progressLabel: 'Preparing for AI'
      },
      'uploaded': {
        label: 'Uploaded',
        badgeClass: 'mdv-badge--uploaded',
        progressLabel: 'Uploaded, awaiting processing'
      },
      'needs_attention': {
        label: 'Needs Attention',
        badgeClass: 'mdv-badge--attention',
        progressLabel: 'Processing needs attention'
      },
      'inactive': {
        label: 'Inactive',
        badgeClass: 'mdv-badge--inactive',
        progressLabel: 'Inactive'
      }
    };
    return presentations[lifecycle] || presentations.uploaded;
  }

  function docStatusBadge(doc) {
    var display = getDocumentStatusDisplay(doc);
    // Map the monolith's tailwind badge classes to component-scoped classes
    // when the shared documentLifecycle helper supplies a tailwind class.
    var cls = display.badgeClass || 'mdv-badge--uploaded';
    return '<span class="mdv-status-badge ' + esc(cls) + '">' + esc(display.label) + '</span>';
  }

  // ── SVG icon snippets (no emoji) ────────────────────────────────────

  var ICON_SEARCH = '<svg class="mdv-search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>';
  var ICON_KEBAB = '<svg class="mdv-kebab-icon" fill="currentColor" viewBox="0 0 20 20"><path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"></path></svg>';
  var ICON_DOWNLOAD = '<svg class="mdv-menu-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>';
  var ICON_OPEN = '<svg class="mdv-menu-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>';
  var ICON_DELETE = '<svg class="mdv-menu-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
  var ICON_DOC_STUDIO = '<svg class="mdv-btn-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>';

  // ── Component factory ───────────────────────────────────────────────

  function createInstance(containerEl, opts) {
    opts = opts || {};

    var api = opts.api || window.api;
    var matterId = opts.matterId || null;
    var matterDisplayId = opts.matterDisplayId || matterId;
    var toast = opts.toast || (window.Lex && window.Lex.Toast) || null;
    var confirmFn = opts.confirm || (window.Lex && window.Lex.Modal && window.Lex.Modal.confirm) || null;
    var onFileOpen = typeof opts.onFileOpen === 'function' ? opts.onFileOpen : null;
    var onCreateDocStudio = typeof opts.onCreateDocStudio === 'function' ? opts.onCreateDocStudio : null;
    var enableDocStudio = opts.enableDocStudio === true;
    var enableTemplates = opts.enableTemplates === true;
    var enableOrphans = opts.enableOrphans === true;
    var pageSize = opts.pageSize || 12;

    // Instance-local state.
    var state = {
      files: Array.isArray(opts.files) ? opts.files.slice() : [],
      search: '',
      page: 1,
      filter: 'all',
      openMenuId: null
    };

    var searchTimeout = null;
    var clickHandler = null;
    var inputHandler = null;
    var pageChangeHandler = null;
    var documentClickHandler = null;
    var destroyed = false;

    function toastError(message) {
      if (toast && toast.error) toast.error(message);
    }

    function toastSuccess(message) {
      if (toast && toast.success) toast.success(message);
    }

    // ── Filtering / pagination computation ────────────────────────────

    function fileName(file) {
      return file.original_filename || file.filename || '';
    }

    function applyFilters() {
      var files = state.files.slice();

      if (enableTemplates && state.filter === 'template') {
        files = files.filter(function (f) { return !!f.is_template; });
      } else if (enableTemplates && state.filter === 'document') {
        files = files.filter(function (f) { return !f.is_template; });
      }

      if (state.search) {
        var needle = state.search.toLowerCase();
        files = files.filter(function (f) {
          return fileName(f).toLowerCase().indexOf(needle) !== -1;
        });
      }

      return files;
    }

    // ── Render ─────────────────────────────────────────────────────────

    function fileRow(file) {
      var name = fileName(file);
      var lifecycle = getDocumentLifecycle(file);
      var statusDisplay = getDocumentStatusDisplay(file);
      var isReady = lifecycle === 'ready' || lifecycle === 'summarized';
      var isBusy = lifecycle === 'processing' || lifecycle === 'uploaded' ||
        lifecycle === 'parsed' || lifecycle === 'indexed';

      var templateBadge = (enableTemplates && file.is_template)
        ? '<span class="mdv-template-badge">Template</span>'
        : '';

      var openControl = onFileOpen
        ? '<button type="button" class="mdv-file-name" data-action="open" data-doc-id="' + esc(file.id) + '" title="' + esc(name) + '">' + esc(name) + '</button>'
        : '<span class="mdv-file-name mdv-file-name--static" title="' + esc(name) + '">' + esc(name) + '</span>';

      var busyNote = (isBusy && !isReady)
        ? '<span class="mdv-busy-note">' + esc(statusDisplay.progressLabel) + '</span>'
        : '';

      return [
        '<div class="mdv-file-row" data-doc-id="' + esc(file.id) + '">',
        '  <div class="mdv-file-icon">' + fileIcon(file) + '</div>',
        '  <div class="mdv-file-main">',
        '    <div class="mdv-file-top">',
        '      ' + openControl,
        '      <div class="mdv-file-tags">',
        '        ' + templateBadge,
        '        ' + docStatusBadge(file),
        '      </div>',
        '    </div>',
        '    <div class="mdv-file-meta">',
        '      <span>' + esc(fileSize(file.file_size)) + '</span>',
        '      <span class="mdv-meta-sep">|</span>',
        '      <span>' + esc(relativeDate(file.created_at || file.updated_at)) + '</span>',
        '      ' + busyNote,
        '    </div>',
        '  </div>',
        '  <div class="mdv-file-actions">',
        '    <button type="button" class="mdv-kebab" data-action="menu" data-doc-id="' + esc(file.id) + '" title="File actions" aria-haspopup="true">' + ICON_KEBAB + '</button>',
        '    ' + fileMenu(file, isReady),
        '  </div>',
        '</div>'
      ].join('');
    }

    function fileMenu(file, isReady) {
      var open = state.openMenuId === file.id;
      var items = '';

      if (onFileOpen) {
        items +=
          '<button type="button" class="mdv-menu-item" data-action="open" data-doc-id="' + esc(file.id) + '">' +
            ICON_OPEN + '<span>Open</span>' +
          '</button>';
      }
      items +=
        '<button type="button" class="mdv-menu-item" data-action="download" data-doc-id="' + esc(file.id) + '">' +
          ICON_DOWNLOAD + '<span>Download</span>' +
        '</button>';
      items += '<div class="mdv-menu-divider"></div>';
      items +=
        '<button type="button" class="mdv-menu-item mdv-menu-item--danger" data-action="delete" data-doc-id="' + esc(file.id) + '">' +
          ICON_DELETE + '<span>Delete</span>' +
        '</button>';

      return '<div class="mdv-menu' + (open ? ' mdv-menu--open' : '') + '" data-menu-for="' + esc(file.id) + '">' + items + '</div>';
    }

    function render() {
      if (destroyed) return;

      var filtered = applyFilters();
      var totalCount = filtered.length;
      var totalPages = Math.ceil(totalCount / pageSize) || 1;
      if (state.page > totalPages) state.page = 1;
      var startIdx = (state.page - 1) * pageSize;
      var pageFiles = filtered.slice(startIdx, startIdx + pageSize);

      var templateCount = 0;
      if (enableTemplates) {
        for (var i = 0; i < filtered.length; i++) {
          if (filtered[i].is_template) templateCount++;
        }
      }
      var documentCount = totalCount - templateCount;

      var headerHtml = '';
      if (enableDocStudio) {
        headerHtml =
          '<div class="mdv-header">' +
            '<button type="button" class="mdv-doc-studio-btn" data-action="create-doc-studio">' +
              ICON_DOC_STUDIO + '<span>Create using Doc Studio</span>' +
            '</button>' +
          '</div>';
      }

      var searchHtml =
        '<div class="mdv-search">' +
          ICON_SEARCH +
          '<input type="text" class="mdv-search-input" data-mdv-search placeholder="Search files..." value="' + esc(state.search) + '">' +
        '</div>';

      var filtersHtml = '';
      if (enableTemplates) {
        filtersHtml =
          '<div class="mdv-filters">' +
            filterChip('all', 'All ' + totalCount) +
            (templateCount > 0 ? filterChip('template', 'Templates ' + templateCount) : '') +
            (documentCount > 0 ? filterChip('document', 'Documents ' + documentCount) : '') +
          '</div>';
      }

      var listHtml;
      if (totalCount === 0) {
        listHtml = state.search
          ? '<div class="mdv-empty">No files matching "' + esc(state.search) + '"</div>'
          : '<div class="mdv-empty">No files in this folder</div>';
      } else {
        listHtml = pageFiles.map(fileRow).join('');
      }

      var paginationHtml = totalPages > 1
        ? '<lex-pagination class="mdv-pagination" data-mdv-pagination page="' + state.page + '" total-pages="' + totalPages + '" total="' + totalCount + '" limit="' + pageSize + '"></lex-pagination>'
        : '';

      containerEl.innerHTML =
        '<div class="mdv-root">' +
          headerHtml +
          searchHtml +
          filtersHtml +
          '<div class="mdv-list">' + listHtml + '</div>' +
          paginationHtml +
        '</div>';

      bindPagination();
      restoreSearchFocus();
    }

    function filterChip(value, label) {
      var active = state.filter === value;
      return '<button type="button" class="mdv-chip' + (active ? ' mdv-chip--active' : '') + '" data-action="filter" data-filter="' + esc(value) + '">' + esc(label) + '</button>';
    }

    function restoreSearchFocus() {
      if (!state.search) return;
      var input = containerEl.querySelector('[data-mdv-search]');
      if (input) {
        input.focus();
        try {
          input.setSelectionRange(input.value.length, input.value.length);
        } catch (e) { /* ignore */ }
      }
    }

    function bindPagination() {
      var pag = containerEl.querySelector('[data-mdv-pagination]');
      if (pag) {
        pag.addEventListener('page-change', pageChangeHandler);
      }
    }

    // ── Actions ────────────────────────────────────────────────────────

    function findFile(fileId) {
      for (var i = 0; i < state.files.length; i++) {
        if (String(state.files[i].id) === String(fileId)) return state.files[i];
      }
      return null;
    }

    function closeMenu() {
      if (state.openMenuId !== null) {
        state.openMenuId = null;
        render();
      }
    }

    function toggleMenu(fileId) {
      state.openMenuId = (state.openMenuId === fileId) ? null : fileId;
      render();
    }

    async function downloadFile(fileId) {
      var file = findFile(fileId);
      try {
        var url = (api && api.getFileDownloadUrl)
          ? api.getFileDownloadUrl(fileId, matterId)
          : (api && api.baseUrl ? api.baseUrl + '/api/v1/storage/files/' + fileId + '/download' : null);

        if (!url) {
          throw new Error('Download URL unavailable');
        }

        var headers = {};
        if (api && api.token) headers.Authorization = 'Bearer ' + api.token;

        var response = await fetch(url, { headers: headers });
        if (!response.ok) {
          throw new Error('Download failed: ' + response.status);
        }

        var blob = await response.blob();
        var blobUrl = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = blobUrl;
        a.download = (file && (file.filename || file.original_filename)) || 'download';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      } catch (error) {
        toastError('Failed to download file. Please try again.');
      }
    }

    async function deleteFile(fileId) {
      try {
        await api.delete('/api/v1/storage/files/' + fileId);
        toastSuccess('File deleted');
        await refresh();
      } catch (error) {
        toastError('Failed to delete file. Please try again.');
      }
    }

    function confirmDelete(fileId) {
      var file = findFile(fileId);
      var name = file ? fileName(file) : 'this file';

      if (confirmFn) {
        confirmFn(
          'Delete File',
          'Are you sure you want to delete "' + name + '"? This action moves the file to deleted items.',
          function () { deleteFile(fileId); },
          'Delete',
          'danger'
        );
      } else if (window.confirm('Delete "' + name + '"?')) {
        deleteFile(fileId);
      }
    }

    // ── Event delegation ───────────────────────────────────────────────

    function handleClick(event) {
      var actionEl = event.target.closest ? event.target.closest('[data-action]') : null;
      if (!actionEl || !containerEl.contains(actionEl)) return;

      var action = actionEl.getAttribute('data-action');
      var fileId = actionEl.getAttribute('data-doc-id');

      if (action === 'create-doc-studio') {
        event.preventDefault();
        if (onCreateDocStudio) onCreateDocStudio();
        return;
      }

      if (action === 'filter') {
        event.preventDefault();
        var filterVal = actionEl.getAttribute('data-filter') || 'all';
        if (state.filter !== filterVal) {
          state.filter = filterVal;
          state.page = 1;
          render();
        }
        return;
      }

      if (action === 'menu') {
        event.preventDefault();
        event.stopPropagation();
        toggleMenu(fileId);
        return;
      }

      if (action === 'open') {
        event.preventDefault();
        closeMenu();
        if (onFileOpen) onFileOpen(fileId);
        return;
      }

      if (action === 'download') {
        event.preventDefault();
        closeMenu();
        downloadFile(fileId);
        return;
      }

      if (action === 'delete') {
        event.preventDefault();
        closeMenu();
        confirmDelete(fileId);
        return;
      }
    }

    function handleInput(event) {
      var input = event.target.closest ? event.target.closest('[data-mdv-search]') : null;
      if (!input) return;

      var value = input.value || '';
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(function () {
        state.search = value.trim();
        state.page = 1;
        render();
      }, 300);
    }

    function handlePageChange(event) {
      var newPage = event.detail && event.detail.page;
      if (newPage) {
        // Page change does NOT re-fetch; it only re-slices the current set.
        state.page = newPage;
        render();
      }
    }

    function handleDocumentClick(event) {
      if (state.openMenuId === null) return;
      if (containerEl.contains(event.target)) {
        // Clicks on the kebab toggle are handled by delegation; ignore here so
        // the menu can open. Any other in-container click closes the menu.
        var menuEl = event.target.closest ? event.target.closest('.mdv-menu, .mdv-kebab') : null;
        if (menuEl) return;
      }
      closeMenu();
    }

    // ── Public methods ─────────────────────────────────────────────────

    async function refresh(files) {
      if (destroyed) return;

      if (Array.isArray(files)) {
        state.files = files.slice();
      } else if (api && api.getMatterFiles && matterId) {
        try {
          var response = await api.getMatterFiles(matterId);
          var loaded = (response && response.data && response.data.files) ||
            (response && response.files) || [];
          state.files = loaded.slice();
        } catch (error) {
          toastError('Failed to load files. Please try again.');
          return;
        }
      }

      state.openMenuId = null;
      render();
    }

    function destroy() {
      destroyed = true;
      clearTimeout(searchTimeout);

      containerEl.removeEventListener('click', clickHandler);
      containerEl.removeEventListener('input', inputHandler);
      document.removeEventListener('click', documentClickHandler);

      var pag = containerEl.querySelector('[data-mdv-pagination]');
      if (pag && pageChangeHandler) {
        pag.removeEventListener('page-change', pageChangeHandler);
      }

      containerEl.innerHTML = '';
    }

    // ── Wire up ────────────────────────────────────────────────────────

    clickHandler = handleClick;
    inputHandler = handleInput;
    pageChangeHandler = handlePageChange;
    documentClickHandler = handleDocumentClick;

    containerEl.addEventListener('click', clickHandler);
    containerEl.addEventListener('input', inputHandler);
    document.addEventListener('click', documentClickHandler);

    render();

    return {
      refresh: refresh,
      destroy: destroy,
      matterId: matterId,
      matterDisplayId: matterDisplayId
    };
  }

  // ── Global export ────────────────────────────────────────────────────

  window.MatterDocumentsView = {
    mount: function (containerEl, opts) {
      if (!containerEl) {
        throw new Error('MatterDocumentsView.mount requires a container element');
      }
      return createInstance(containerEl, opts || {});
    }
  };
})();
