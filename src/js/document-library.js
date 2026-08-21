/* LANA Document Library dashboard.
   Shows the latest organization files by edit time and reuses the shared
   document creation flow used by the global menu and workspace details.
*/
(function (global) {
  'use strict';

  var FILE_LIMIT = 12;
  var loadSequence = 0;
  var currentPage = 1;

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

  function hydrateIcons(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll('[data-document-library-icon]');
    for (var i = 0; i < nodes.length; i += 1) {
      nodes[i].innerHTML = icon(nodes[i].getAttribute('data-document-library-icon'));
    }
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
    if (!Number.isFinite(total)) total = Number(visibleCount || 0);
    var totalPages = Number(source.total_pages !== undefined ? source.total_pages : source.totalPages);
    if (!Number.isFinite(totalPages) || totalPages < 1) {
      totalPages = Math.max(1, Math.ceil(total / FILE_LIMIT));
    }
    return {
      page: Number(source.page || currentPage) || 1,
      total: total,
      totalPages: totalPages
    };
  }

  function setTableVisibility(visible) {
    var columns = el('documentLibraryFileColumns');
    if (columns) columns.hidden = !visible;
  }

  function updatePagination(pagination) {
    var pager = el('documentLibraryPagination');
    if (!pager) return;
    var total = pagination ? pagination.total : 0;
    var totalPages = pagination ? pagination.totalPages : 1;
    pager.page = pagination ? pagination.page : currentPage;
    pager.totalPages = totalPages;
    pager.total = total;
    pager.limit = FILE_LIMIT;
    pager.hidden = totalPages <= 1;
  }

  function fileName(file) {
    return file.filename || file.original_name || file.original_filename || file.file_name || file.name || 'Untitled file';
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

  function timestamp(value) {
    var parsed = value ? new Date(value).getTime() : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function sortLatestEdited(files) {
    return files.slice().sort(function (a, b) {
      return timestamp(editedAt(b)) - timestamp(editedAt(a));
    });
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

  function relativeTime(value) {
    if (!value) return '';
    if (global.LanaTime && typeof LanaTime.timeAgo === 'function') {
      return LanaTime.timeAgo(value, { style: 'words' });
    }
    var date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function absoluteTime(value) {
    if (!value) return '';
    var date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function renderLoading() {
    var host = el('documentLibraryRecentFiles');
    var count = el('documentLibraryRecentCount');
    if (!host) return;
    if (count) count.textContent = '';
    setTableVisibility(false);
    updatePagination(null);
    host.setAttribute('aria-busy', 'true');
    host.innerHTML =
      '<div class="document-library-skeleton" aria-hidden="true"></div>' +
      '<div class="document-library-skeleton" aria-hidden="true"></div>' +
      '<div class="document-library-skeleton" aria-hidden="true"></div>' +
      '<div class="document-library-skeleton" aria-hidden="true"></div>';
  }

  function renderEmpty() {
    var host = el('documentLibraryRecentFiles');
    var count = el('documentLibraryRecentCount');
    if (!host) return;
    if (count) count.textContent = '0 files';
    setTableVisibility(false);
    updatePagination(null);
    host.setAttribute('aria-busy', 'false');
    host.innerHTML =
      '<div class="document-library-empty">' +
        '<span class="document-library-empty-icon" data-document-library-icon="file-plus" aria-hidden="true"></span>' +
        '<h3>No edited files yet</h3>' +
        '<p>Create your first document to get started.</p>' +
        '<lex-btn variant="secondary" leading-icon="file-plus" data-action="new-document">New Document</lex-btn>' +
      '</div>';
    hydrateIcons(host);
  }

  function renderError() {
    var host = el('documentLibraryRecentFiles');
    var count = el('documentLibraryRecentCount');
    if (!host) return;
    if (count) count.textContent = '';
    setTableVisibility(false);
    updatePagination(null);
    host.setAttribute('aria-busy', 'false');
    host.innerHTML =
      '<div class="document-library-empty document-library-error" role="alert">' +
        '<span class="document-library-empty-icon" data-document-library-icon="alert-circle" aria-hidden="true"></span>' +
        '<h3>Files could not be loaded</h3>' +
        '<p>Check your connection and try again.</p>' +
        '<lex-btn variant="secondary" data-action="retry">Try again</lex-btn>' +
      '</div>';
    hydrateIcons(host);
  }

  function renderFiles(files, pagination) {
    var host = el('documentLibraryRecentFiles');
    var count = el('documentLibraryRecentCount');
    if (!host) return;

    var rows = sortLatestEdited(files).slice(0, FILE_LIMIT);
    if (!rows.length) {
      renderEmpty();
      return;
    }

    var total = pagination && Number.isFinite(pagination.total) ? pagination.total : rows.length;
    if (count) count.textContent = total + (total === 1 ? ' file' : ' files');
    setTableVisibility(true);
    updatePagination(pagination || { page: currentPage, total: total, totalPages: 1 });
    host.setAttribute('aria-busy', 'false');
    host.innerHTML = rows.map(function (file) {
      var id = file.id || file.document_id || file.file_id || '';
      var name = fileName(file);
      var presentation = filePresentation(file);
      var size = formatFileSize(file.file_size || file.size);
      var meta = [presentation.label, size].filter(Boolean).join(' · ');
      var edited = editedAt(file);
      var editedLabel = relativeTime(edited);
      var timeText = editedLabel ? 'Edited ' + editedLabel : 'Edit time unavailable';
      var workspaceName = fileWorkspace(file);
      var workspaceId = fileWorkspaceId(file);
      var workspaceCell = workspaceId && workspaceName !== '—'
        ? '<button class="document-library-file-workspace document-library-workspace-link" type="button" data-workspace-id="' + esc(workspaceId) + '" title="Open ' + esc(workspaceName) + ' workspace">' +
            '<span class="document-library-mobile-label">Workspace</span>' +
            '<span>' + esc(workspaceName) + '</span>' +
          '</button>'
        : '<span class="document-library-file-workspace">' +
            '<span class="document-library-mobile-label">Workspace</span>' +
            '<span>' + esc(workspaceName) + '</span>' +
          '</span>';

      return (
        '<div class="document-library-file" data-file-id="' + esc(id) + '" data-file-workspace-id="' + esc(workspaceId) + '"' +
          (id ? ' role="link" tabindex="0"' : ' aria-disabled="true"') + ' aria-label="Open ' + esc(name) + '">' +
          '<span class="document-library-file-icon document-library-file-icon--' + esc(presentation.tone) + '" data-document-library-icon="' + esc(presentation.icon) + '" aria-hidden="true"></span>' +
          '<span class="document-library-file-primary">' +
            '<span class="document-library-file-name" title="' + esc(name) + '">' + esc(name) + '</span>' +
            '<span class="document-library-file-type">' + esc(meta) + '</span>' +
          '</span>' +
          workspaceCell +
          '<time class="document-library-file-time" datetime="' + esc(edited) + '" title="' + esc(absoluteTime(edited)) + '">' +
            '<span class="document-library-mobile-label">Last edited</span>' + esc(timeText) +
          '</time>' +
          '<span class="document-library-file-arrow" data-document-library-icon="chevron-right" aria-hidden="true"></span>' +
        '</div>'
      );
    }).join('');
    hydrateIcons(host);
  }

  async function loadLatestFiles(page) {
    var client = global.api;
    var sequence = ++loadSequence;
    currentPage = Number(page || currentPage) || 1;
    renderLoading();

    if (!client || typeof client.get !== 'function') {
      renderError();
      return;
    }

    try {
      var response = await client.get(
        '/api/v1/storage/documents?page=' + currentPage + '&page_size=' + FILE_LIMIT + '&sort_by=updated_at&sort_order=desc'
      );
      if (sequence !== loadSequence || !el('documentLibrary')) return;
      var files = filesFromResponse(response);
      renderFiles(files, paginationFromResponse(response, files.length));
    } catch (error) {
      if (sequence !== loadSequence || !el('documentLibrary')) return;
      console.error('[DocumentLibrary] Failed to load latest edited files:', error);
      renderError();
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

  async function openFile(fileId, workspaceId, row) {
    if (!fileId) return;
    if (row && row.getAttribute('aria-busy') === 'true') return;
    if (row) row.setAttribute('aria-busy', 'true');
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
      if (row) row.setAttribute('aria-busy', 'false');
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
        return;
      }
      if (actionTarget && actionTarget.getAttribute('data-action') === 'retry') {
        loadLatestFiles();
        return;
      }
      var fileTarget = event.target && event.target.closest ? event.target.closest('[data-file-id]') : null;
      if (fileTarget) {
        openFile(
          fileTarget.getAttribute('data-file-id'),
          fileTarget.getAttribute('data-file-workspace-id'),
          fileTarget
        );
      }
    });
    root.addEventListener('keydown', function (event) {
      var fileTarget = event.target && event.target.closest ? event.target.closest('[data-file-id]') : null;
      if (!fileTarget || event.target !== fileTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      openFile(
        fileTarget.getAttribute('data-file-id'),
        fileTarget.getAttribute('data-file-workspace-id'),
        fileTarget
      );
    });
    root.addEventListener('page-change', function (event) {
      if (!event.target || event.target.id !== 'documentLibraryPagination') return;
      var page = event.detail && event.detail.page;
      if (page) loadLatestFiles(page);
    });
  }

  function init() {
    var root = el('documentLibrary');
    if (!root) return;
    bindEvents(root);
    hydrateIcons(root);
    loadLatestFiles();
  }

  global.LanaDocumentLibrary = {
    init: init,
    loadLatestFiles: loadLatestFiles,
    filesFromResponse: filesFromResponse,
    sortLatestEdited: sortLatestEdited
  };

  if (global.LexRouter && typeof LexRouter.registerPageInit === 'function') {
    LexRouter.registerPageInit('document-library.html', init);
  }

  init();
})(window);
