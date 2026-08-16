/**
 * file-viewer-page.js — Dedicated file viewer page controller.
 *
 * Standalone page at file-viewer.html?id=<fileId>.
 * Replaces the duplicated modal-based file-viewer.js across 4 pages.
 *
 * Features:
 *   - Full-page file preview (PDF, DOCX, image, text)
 *   - File info drawer (metadata view/edit) with save
 *   - DOCX editor review rail foundation (changes/comments)
 *   - "Ask LANA" document context drawer
 *   - Back navigation via Lex.Nav context referrer
 *
 * Dependencies (loaded before this file):
 *   - api.js (api.get, api.patch, api.post, api.baseUrl, api.token)
 *   - lex-nav.js (Lex.Nav.go, Lex.Nav.consume, Lex.Nav.getParams)
 *   - mammoth.min.js (DOCX rendering)
 *   - marked.min.js (markdown rendering)
 *   - lex-drawer.js, lex-chat*.js (Ask LANA)
 */
(function () {
  'use strict';

  // =========================================================================
  // State
  // =========================================================================

  var state = {
    fileId: null,
    currentFile: null,
    referrerPage: null,
    metadataMode: 'view',
    metadataChanged: false,
    originalMetadata: {},
    editorInstance: null,
    editorModulePromise: null,
    editorImportMapBase: null,
    editorMode: 'view',
    reviewState: null,
    reviewTab: 'changes',
    reviewCounts: { changes: 0, comments: 0 },
    reviewBatches: [],
    currentReviewBatch: null,
    reviewReleases: [],
    selectedReviewReleaseId: null,
    selectedReviewReleaseDocumentId: null,
    releaseChangeGroups: [],
    releaseChangeHistory: [],
    releaseHistoryFilters: { user: 'all', date: 'all' },
    releaseComparison: null,
    releaseComparisonLoading: false,
    editorFocusedContext: null,
    workspaceFieldCatalog: null,
    workspaceFieldCatalogMatterId: null,
    reviewDirty: false,
    reviewSaving: false,
    reviewReleasing: false,
    // askLanaDrawer/askLanaChatEl/askLanaThreadsEl removed — managed by lex-lana-panel
    _lanaSessionBootstrapped: false
  };

  // =========================================================================
  // Helpers
  // =========================================================================

  function escapeHtml(text) {
    if (!text) return '';
    var str = String(text);
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      if (ch === '&') out += '&amp;';
      else if (ch === '<') out += '&lt;';
      else if (ch === '>') out += '&gt;';
      else if (ch === '"') out += '&quot;';
      else if (ch === "'") out += '&#039;';
      else out += ch;
    }
    return out;
  }

  function notify(message, type) {
    if (typeof Lex !== 'undefined' && Lex.Toast && typeof Lex.Toast[type] === 'function') {
      Lex.Toast[type](message);
    }
  }

  function truncateContextText(text, limit) {
    var value = String(text || '').replace(/\s+/g, ' ').trim();
    var max = limit || 2000;
    return value.length > max ? value.slice(0, max - 1) + '\u2026' : value;
  }

  function humanizeFieldPath(path) {
    return String(path || '')
      .split('.')
      .map(function (part) {
        return part
          .split('_')
          .map(function (word) {
            return word ? word.charAt(0).toUpperCase() + word.slice(1) : '';
          })
          .join(' ');
      })
      .join(' / ');
  }

  function fieldPreview(value) {
    if (value === null || value === undefined || value === '') return 'No value currently set';
    if (typeof value === 'object') return 'Structured workspace data';
    return truncateContextText(String(value), 100);
  }

  function flattenMergeFields(source, prefix, out) {
    if (!source || typeof source !== 'object') return;
    Object.keys(source).sort().forEach(function (key) {
      if (key === 'field_definitions') return;
      var value = source[key];
      var path = prefix ? prefix + '.' + key : key;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        flattenMergeFields(value, path, out);
        return;
      }
      out.push({
        name: path,
        label: humanizeFieldPath(path),
        token: '{{' + path + '}}',
        value: value,
        description: fieldPreview(value)
      });
    });
  }

  async function loadWorkspaceFieldCatalog(matterId) {
    if (!matterId) return [];
    if (state.workspaceFieldCatalogMatterId === matterId && Array.isArray(state.workspaceFieldCatalog)) {
      return state.workspaceFieldCatalog;
    }
    var response = await api.get('/api/v1/matters/' + encodeURIComponent(matterId) + '/merge-fields');
    var fields = [];
    flattenMergeFields(response && response.merge_fields ? response.merge_fields : {}, '', fields);
    state.workspaceFieldCatalog = fields;
    state.workspaceFieldCatalogMatterId = matterId;
    return fields;
  }

  function buildEditorModuleContext(file, focusedContext, typeOverride, extras) {
    var matterId = file && (file.client_matter || file.matter_id);
    var base = {
      type: typeOverride || (focusedContext && focusedContext.kind === 'revision' ? 'editor_revision' : 'editor_selection'),
      ui_label: focusedContext && focusedContext.kind === 'revision' ? 'Tracked change' : 'Document selection',
      source: 'file_viewer',
      document: {
        id: file && file.id,
        name: file && file.filename,
        matter_id: matterId || null,
        content_type: file && (file.content_type || file.mime_type || '')
      },
      editor_mode: focusedContext && focusedContext.editorMode,
      document_mode: focusedContext && focusedContext.documentMode,
      page: {
        route: 'file-viewer',
        matter_id: matterId || null,
        document_id: file && file.id,
        document_name: file && file.filename
      }
    };
    if (focusedContext && focusedContext.kind === 'selection') {
      base.selection = {
        text: truncateContextText(focusedContext.text, 2000),
        ranges: Array.isArray(focusedContext.ranges)
          ? focusedContext.ranges.slice(0, 12).map(function (range) {
            return {
              paragraph: range.paragraph,
              start: range.start,
              end: range.end,
              text: truncateContextText(range.text, 500)
            };
          })
          : []
      };
    }
    if (focusedContext && focusedContext.kind === 'revision') {
      base.revision = focusedContext.revision || {};
    }
    return Object.assign(base, extras || {});
  }

  function openLanaForEditorContext(detail) {
    var file = state.currentFile;
    if (!file || !detail || !detail.context) return;
    var panel = document.getElementById('fileViewerLana');
    if (!panel) return;
    var prompt = detail.prompt || 'Help me review this document selection.';
    var moduleContext = buildEditorModuleContext(file, detail.context);
    state.editorFocusedContext = moduleContext;
    if (typeof panel.show === 'function') panel.show();
    setTimeout(function () {
      if (typeof panel.attachFile === 'function') panel.attachFile(file.id, file.filename || 'Document');
      if (typeof panel.attachModuleContext === 'function') panel.attachModuleContext(moduleContext);
      if (typeof panel.send === 'function') {
        panel.send(prompt, {
          contextType: 'document_chat',
          matterId: file.client_matter || file.matter_id || null,
          attachments: {
            module_context: moduleContext
          }
        });
      }
    }, 80);
  }

  function fieldOptionsAttribute(fields) {
    return escapeHtml(JSON.stringify(fields.map(function (field) {
      return {
        value: field.name,
        label: field.label,
        description: field.description
      };
    })));
  }

  async function openWorkspaceFieldPicker(detail) {
    var file = state.currentFile;
    var editor = state.editorInstance;
    var matterId = file && (file.client_matter || file.matter_id);
    if (!file || !editor || !matterId) {
      notify('This document is not associated with a workspace.', 'error');
      return;
    }
    try {
      var fields = await loadWorkspaceFieldCatalog(matterId);
      if (!fields.length) {
        notify('No workspace fields are available for this document.', 'error');
        return;
      }
      var selected = fields[0].name;
      var modal = typeof Lex !== 'undefined' && Lex.Modal && typeof Lex.Modal.open === 'function'
        ? Lex.Modal.open({
          heading: 'Insert Workspace Field',
          size: 'sm',
          hideActions: false,
          confirmText: 'Insert Field',
          cancelText: 'Cancel',
          content: '<div style="display:flex;flex-direction:column;gap:12px;">' +
            '<p style="margin:0;color:var(--lex-text-secondary);font-size:var(--lex-body-sm-size);">Choose a workspace field token to insert as a tracked edit.</p>' +
            '<lex-select data-editor-field-select searchable="true" label="Field" value="' + escapeHtml(selected) + '" options=\'' + fieldOptionsAttribute(fields) + '\'></lex-select>' +
            '</div>'
        })
        : null;
      if (!modal) return;
      modal.addEventListener('lex-change', function (event) {
        if (event && event.detail && event.detail.value) selected = event.detail.value;
      });
      modal.addEventListener('lex-confirm', async function () {
        var field = fields.find(function (candidate) { return candidate.name === selected; });
        if (!field) {
          if (modal && typeof modal.remove === 'function') modal.remove();
          return;
        }
        try {
          await editor.insertWorkspaceField(field.token);
          state.editorFocusedContext = buildEditorModuleContext(file, detail && detail.context, 'editor_field_insert', {
            field: {
              name: field.name,
              label: field.label,
              token: field.token
            }
          });
          notify('Workspace field inserted', 'success');
          if (window.LanaActivityEvents && typeof window.LanaActivityEvents.editorEvent === 'function') {
            window.LanaActivityEvents.editorEvent('editor.edit_applied', {
              surface: 'file_viewer',
              document_id: file.id,
              document_name: file.filename,
              operation: 'insert_workspace_field',
              field_name: field.name
            });
          }
        } catch (error) {
          notify((error && error.message) || 'Failed to insert workspace field', 'error');
        } finally {
          if (modal && typeof modal.remove === 'function') modal.remove();
        }
      });
    } catch (error) {
      console.error('[FileViewerPage] Failed to load workspace fields:', error);
      notify((error && error.message) || 'Failed to load workspace fields', 'error');
    }
  }

  function getConversationIdFromCreateResponse(response) {
    var seen = [];

    function fromObject(obj) {
      if (!obj || typeof obj !== 'object' || seen.indexOf(obj) !== -1) return '';
      seen.push(obj);

      var directId = obj.conversation_id || obj.conversationId || obj.thread_id || obj.threadId;
      if (directId) return directId;

      var nestedId = fromObject(obj.conversation) || fromObject(obj.session) || fromObject(obj.data);
      if (nestedId) return nestedId;

      return obj.id || '';
    }

    return fromObject(response);
  }

  function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    var k = 1024;
    var sizes = ['B', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  function formatMimeType(mimeType) {
    if (!mimeType) return 'Unknown';
    var map = {
      'application/pdf': 'PDF Document',
      'application/msword': 'Word Document',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word Document',
      'application/vnd.ms-excel': 'Excel Spreadsheet',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel Spreadsheet',
      'text/plain': 'Text File',
      'text/html': 'HTML Document',
      'text/csv': 'CSV File',
      'application/json': 'JSON File',
      'image/jpeg': 'JPEG Image',
      'image/png': 'PNG Image',
      'image/gif': 'GIF Image',
      'image/svg+xml': 'SVG Image',
      'image/webp': 'WebP Image',
      'application/zip': 'ZIP Archive',
      'application/octet-stream': 'Binary File'
    };
    if (map[mimeType]) return map[mimeType];
    if (mimeType.indexOf('image/') === 0) return 'Image File';
    if (mimeType.indexOf('video/') === 0) return 'Video File';
    if (mimeType.indexOf('audio/') === 0) return 'Audio File';
    if (mimeType.indexOf('text/') === 0) return 'Text File';
    return mimeType;
  }

  function getFileMatterId(file) {
    return file && (file.client_matter || file.matter_id || file.matterId || file.clientMatter || '');
  }

  function getCurrentMatterId() {
    return getFileMatterId(state.currentFile);
  }

  function normalizeBaseUrl(value) {
    value = String(value || '').trim();
    if (!value) return '';
    return value.replace(/\/+$/, '');
  }

  function getEditorServiceBase() {
    var fromWindow = normalizeBaseUrl(window.LANA_EDITOR_SERVICE);
    if (fromWindow) return fromWindow;

    var fromConfig = normalizeBaseUrl(window.LanaConfig && window.LanaConfig.LANA_EDITOR_SERVICE_URL);
    if (fromConfig) return fromConfig;

    try {
      var fromStorage = normalizeBaseUrl(window.localStorage && window.localStorage.getItem('lana-editor-service'));
      if (fromStorage) return fromStorage;
    } catch (_) {}

    return 'http://127.0.0.1:4710';
  }

  function isEditorEnabled() {
    return !(window.LanaConfig && window.LanaConfig.LANA_EDITOR_ENABLED === false);
  }

  function isEditorDocx(file) {
    var mimeType = String((file && (file.content_type || file.mime_type)) || '').toLowerCase();
    var filename = String((file && file.filename) || '').toLowerCase();
    return mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      filename.endsWith('.docx');
  }

  function isEditorPreviewFile(file) {
    var mimeType = String((file && (file.content_type || file.mime_type)) || '').toLowerCase();
    var filename = String((file && file.filename) || '').toLowerCase();
    return isEditorDocx(file) ||
      mimeType === 'application/pdf' ||
      mimeType.indexOf('text/') === 0 ||
      filename.endsWith('.pdf') ||
      filename.endsWith('.txt') ||
      filename.endsWith('.text') ||
      filename.endsWith('.md') ||
      filename.endsWith('.markdown') ||
      filename.endsWith('.log');
  }

  function shutdownEditorInstance() {
    if (state.editorInstance && typeof state.editorInstance.shutdown === 'function') {
      try {
        state.editorInstance.shutdown();
      } catch (error) {
        console.warn('[FileViewerPage] Editor shutdown failed:', error);
      }
    }
    state.editorInstance = null;
  }

  function ensureEditorImportMap(baseUrl) {
    if (state.editorImportMapBase === baseUrl) return;

    var existing = document.getElementById('lana-editor-import-map');
    if (existing) {
      if (state.editorImportMapBase && state.editorImportMapBase !== baseUrl) {
        throw new Error('Editor service URL changed after editor modules loaded; reload the page to use the new service.');
      }
      state.editorImportMapBase = baseUrl;
      return;
    }

    if (window.HTMLScriptElement && typeof window.HTMLScriptElement.supports === 'function' &&
        !window.HTMLScriptElement.supports('importmap')) {
      throw new Error('This browser does not support import maps required by LANA Editor.');
    }

    var script = document.createElement('script');
    script.id = 'lana-editor-import-map';
    script.type = 'importmap';
    script.textContent = JSON.stringify({
      imports: {
        '@lana/ooxml-kernel/browser': baseUrl + '/kernel/browser.js',
        '@lana/editor': baseUrl + '/editor/index.js',
        '@lana/editor-embed': baseUrl + '/embed/index.js',
        'pdfjs-dist': baseUrl + '/pdfjs/pdf.min.mjs'
      }
    });
    document.head.appendChild(script);
    state.editorImportMapBase = baseUrl;
  }

  async function loadEditorModule(baseUrl) {
    ensureEditorImportMap(baseUrl);
    if (!state.editorModulePromise) {
      state.editorModulePromise = import('@lana/editor-embed');
    }
    return state.editorModulePromise;
  }

  function trackEditorEvent(eventType, file, details) {
    if (!window.LanaActivityEvents || typeof window.LanaActivityEvents.editorEvent !== 'function') return;
    window.LanaActivityEvents.editorEvent(eventType, {
      resource_type: 'editor',
      resource_id: file && file.id,
      resource_name: file && file.filename,
      matter_id: getFileMatterId(file) || null,
      surface: 'file_viewer_editor',
      visibility: getFileMatterId(file) ? 'workspace' : 'private',
      details: details || {}
    });
  }

  function getFileDownloadUrl(fileOrId) {
    var file = typeof fileOrId === 'object' ? fileOrId : null;
    var fileId = file ? file.id : fileOrId;
    var matterId = getFileMatterId(file || state.currentFile);
    if (api && typeof api.getFileDownloadUrl === 'function' && matterId) {
      return api.getFileDownloadUrl(fileId, matterId);
    }
    var url = api.baseUrl + '/api/v1/storage/files/' + encodeURIComponent(fileId) + '/download';
    if (matterId) {
      url += '?matter_id=' + encodeURIComponent(matterId);
    }
    return url;
  }

  function fileMetadata(file) {
    var metadata = file && file.metadata;
    if (typeof metadata === 'string') {
      try {
        metadata = JSON.parse(metadata);
      } catch (_) {
        metadata = {};
      }
    }
    return metadata && typeof metadata === 'object' ? metadata : {};
  }

  function docStudioPresentationId(file) {
    var metadata = fileMetadata(file);
    var nested = metadata.metadata && typeof metadata.metadata === 'object' ? metadata.metadata : {};
    return metadata.presentation_id ||
      metadata.presentationId ||
      metadata.doc_studio_presentation_id ||
      metadata.docStudioPresentationId ||
      nested.presentation_id ||
      nested.presentationId ||
      '';
  }

  function isDocStudioGeneratedFile(file) {
    var metadata = fileMetadata(file);
    var nested = metadata.metadata && typeof metadata.metadata === 'object' ? metadata.metadata : {};
    return !!docStudioPresentationId(file) ||
      metadata.source === 'doc_studio' ||
      metadata.generation_mode === 'async_job' ||
      nested.source === 'doc_studio';
  }

  function docStudioDocumentUrl(file) {
    var presentationId = docStudioPresentationId(file);
    if (!presentationId) return '';
    var params = new URLSearchParams({
      id: presentationId,
      view: 'doc',
      editor: '1'
    });
    if (file && file.id) params.set('file_id', file.id);
    if (file && file.filename) params.set('file_name', file.filename);
    var matterId = getFileMatterId(file);
    if (matterId) params.set('matter_id', matterId);
    var matterName = file && (file.matter_name || file.client_matter_name || file.workspace_name || file.client_workspace_name);
    if (matterName) params.set('matter_name', matterName);
    return 'doc-studio/index.html?' + params.toString();
  }

  function getAuthHeaders() {
    return api && api.token ? { 'Authorization': 'Bearer ' + api.token } : {};
  }

  async function assertFetchOk(response, fallbackMessage) {
    if (response.ok) return;

    var detail = '';
    try {
      var text = await response.text();
      if (text) {
        detail = ': ' + text.substring(0, 180);
      }
    } catch (_) {}

    throw new Error(fallbackMessage + ' (' + response.status + ' ' + response.statusText + ')' + detail);
  }

  function formatDocumentType(type) {
    if (!type) return null;
    var map = {
      'contract': 'Contract',
      'pleading': 'Pleading',
      'deposition': 'Deposition',
      'medical_record': 'Medical Record',
      'police_report': 'Police Report',
      'email': 'Email',
      'correspondence': 'Correspondence',
      'other': 'Other'
    };
    return map[type] || type;
  }

  function isDemoMode() {
    return !!(window.api && typeof window.api.isDemoMode === 'function' && window.api.isDemoMode());
  }

  function buildDemoDocumentText(file) {
    var lines = [
      'LANA AI Demo Document',
      '',
      'Filename: ' + (file.filename || 'Untitled'),
      'Matter: ' + (file.matter_name || file.client_matter || file.matter_id || 'Unassigned'),
      'Type: ' + formatMimeType(file.content_type),
      'Status: ' + (file.status || 'processed'),
      'Created By: ' + (file.created_by || 'Demo User'),
      '',
      'This is a seeded demo document preview generated locally.',
      'In live mode this page would stream the real file contents from storage.',
      '',
      'Suggested walkthrough:',
      '- Open the metadata panel to show document details',
      '- Use Ask LANA to discuss the document context',
      '- Download the demo artifact to show an end-to-end flow'
    ];

    if (Array.isArray(file.tags) && file.tags.length > 0) {
      lines.splice(6, 0, 'Tags: ' + file.tags.join(', '));
    }

    return lines.join('\n');
  }

  function buildDemoDocxHtml(file) {
    return [
      '<article class="prose max-w-none">',
      '<h1>' + escapeHtml(file.filename || 'Demo Document') + '</h1>',
      '<p>This preview is rendered from local demo fixtures.</p>',
      '<p><strong>Matter:</strong> ' + escapeHtml(file.matter_name || file.client_matter || file.matter_id || 'Unassigned') + '</p>',
      '<p><strong>Summary:</strong> This document is part of the seeded walkthrough data and demonstrates the document viewer without a live storage service.</p>',
      '<ul>',
      '<li>Metadata and tags are populated from fixture JSON.</li>',
      '<li>Chat can still reference the document context.</li>',
      '<li>Download produces a local demo artifact.</li>',
      '</ul>',
      '</article>'
    ].join('');
  }

  // =========================================================================
  // Navigation
  // =========================================================================

  function navigateBack() {
    if (state.metadataChanged) {
      if (!confirm('You have unsaved changes. Leave anyway?')) return;
    }
    if (state.referrerPage) {
      Lex.Nav.go(state.referrerPage);
    } else {
      window.history.back();
    }
  }

  // =========================================================================
  // File info + review rail
  // =========================================================================

  function openFileInfoDrawer() {
    var drawer = document.getElementById('fileInfoDrawer');
    if (!drawer) return;
    drawer.heading = 'File Info';
    drawer.subtitle = state.currentFile && state.currentFile.filename ? state.currentFile.filename : '';
    drawer.open = true;

    var toggle = document.getElementById('metaModeToggle');
    if (toggle && typeof toggle._positionIndicator === 'function') {
      requestAnimationFrame(function () { toggle._positionIndicator(); });
    }
  }

  function setCanvasModeDisplay(reviewAvailable) {
    var readOnlyBadges = document.querySelectorAll('#viewerReadOnlyBadge');
    var reviewBadges = document.querySelectorAll('#viewerReviewModeBadge');
    var isReview = state.editorMode === 'review';
    readOnlyBadges.forEach(function (readOnlyBadge) {
      readOnlyBadge.textContent = isReview ? 'View / Read-only available' : 'View / Read-only';
      readOnlyBadge.classList.toggle('file-viewer-mode-badge--active', !isReview);
    });
    reviewBadges.forEach(function (reviewBadge) {
      reviewBadge.textContent = isReview ? 'Exit Review Mode' : 'Enter Review Mode';
      reviewBadge.classList.toggle('file-viewer-mode-badge--active', isReview);
      reviewBadge.classList.toggle('hidden', !reviewAvailable);
    });
    var subtitle = document.querySelector('.file-viewer-review-subtitle');
    if (subtitle) subtitle.textContent = isReview ? 'Review / Redline active' : 'View / Read-only';
  }

  function setReviewRailVisible(visible) {
    var rail = document.getElementById('reviewRail');
    if (rail) rail.classList.toggle('hidden', !visible);
    setCanvasModeDisplay(visible);
    if (visible) {
      requestAnimationFrame(function () {
        var tabs = document.getElementById('reviewTabs');
        if (tabs && tabs.value !== state.reviewTab) {
          tabs.value = state.reviewTab;
        }
        if (tabs && typeof tabs._positionIndicator === 'function') {
          tabs._positionIndicator();
        }
      });
    }
  }

  function setReviewTab(tab) {
    state.reviewTab = tab === 'releases' ? tab : 'changes';
    var tabs = document.getElementById('reviewTabs');
    var changesPanel = document.getElementById('reviewPanelChanges');
    var releasesPanel = document.getElementById('reviewPanelReleases');
    var isChanges = state.reviewTab === 'changes';
    var isReleases = state.reviewTab === 'releases';

    if (tabs && tabs.value !== state.reviewTab) {
      tabs.value = state.reviewTab;
    }
    if (tabs && typeof tabs._positionIndicator === 'function') {
      requestAnimationFrame(function () { tabs._positionIndicator(); });
    }
    if (changesPanel) changesPanel.classList.toggle('hidden', !isChanges);
    if (releasesPanel) releasesPanel.classList.toggle('hidden', !isReleases);
    if (isChanges && state.releaseComparison && state.editorInstance) {
      state.selectedReviewReleaseId = null;
      state.selectedReviewReleaseDocumentId = null;
      state.releaseComparison = null;
      state.releaseComparisonLoading = false;
      hideAllViewers();
      var editorEl = document.getElementById('viewerEditor');
      if (editorEl) editorEl.classList.remove('hidden');
      renderReviewWorkflow();
      updateReviewRailCounts(state.reviewState || {});
    }
  }

  function updateReviewRailCounts(countsOrState) {
    var next = countsOrState || {};
    var revisions = Array.isArray(next.revisions) ? next.revisions : null;
    var comments = Array.isArray(next.comments) ? next.comments : null;
    var selectedVersionChanges = state.selectedReviewReleaseId ? state.releaseChangeHistory : null;
    var draftBatchChanges = state.currentReviewBatch && Array.isArray(state.currentReviewBatch.changes)
      ? state.currentReviewBatch.changes
      : [];
    var pendingChangeCount = revisions ? revisions.length : (draftBatchChanges.length || Number(next.revisions || next.changes || 0) || 0);
    var releasedChangeCount = state.releaseChangeGroups.reduce(function (total, group) {
      return total + (Array.isArray(group.changes) ? group.changes.length : 0);
    }, 0);
    var displayedReleasedChangeCount = selectedVersionChanges ? selectedVersionChanges.length : releasedChangeCount;
    state.reviewCounts = {
      changes: displayedReleasedChangeCount + pendingChangeCount,
      comments: comments ? comments.length : (Number(next.comments || 0) || 0)
    };

    renderChangeHistory(selectedVersionChanges || revisions || []);
    var changesEmpty = document.getElementById('reviewChangesEmptyText');
    var changesEmptyBox = changesEmpty && changesEmpty.closest ? changesEmpty.closest('.file-viewer-review-empty') : null;
    if (changesEmptyBox) changesEmptyBox.classList.toggle('hidden', state.reviewCounts.changes > 0);
    if (changesEmpty) {
      changesEmpty.textContent = state.reviewCounts.changes
        ? state.reviewCounts.changes + ' change' + (state.reviewCounts.changes === 1 ? '' : 's') + (state.selectedReviewReleaseId ? ' shipped in the selected version.' : ' reported by the editor.')
        : (state.selectedReviewReleaseId ? 'No persisted changes are attached to the selected version.' : 'No tracked changes reported by the editor.');
    }
    renderReviewWorkflow();
  }

  function markReviewDirty(reviewState) {
    if (reviewState) {
      state.reviewState = reviewState;
    } else {
      currentReviewState();
    }
    state.reviewDirty = true;
    updateReviewRailCounts(state.reviewState || {});
  }

  function reviewItemLabel(type, item) {
    if (type === 'comments') return 'Comment';
    if (item && item.released_in && item.released_in.release_number) {
      return 'Version ' + item.released_in.release_number + ' change';
    }
    if (item && item.operation) {
      return String(item.operation).charAt(0).toUpperCase() + String(item.operation).slice(1);
    }
    if (item && item.type === 'del') return 'Deletion';
    if (item && item.type === 'ins') return 'Insertion';
    return 'Change';
  }

  function reviewItemText(item) {
    if (!item) return '';
    return item.text || item.proposed_text || item.original_text || item.reviewer_notes || item.summary || '';
  }

  function lexOptionsAttribute(options) {
    return escapeHtml(JSON.stringify(Array.isArray(options) ? options : []));
  }

  function reviewStatus(item, type) {
    if (type === 'comments') return null;
    if (item && item.released_in && item.released_in.release_number) {
      return { label: 'Released', tone: 'released' };
    }
    var status = item && item.status ? String(item.status) : 'proposed';
    if (status === 'accepted') return { label: 'Accepted', tone: 'accepted' };
    if (status === 'rejected') return { label: 'Rejected', tone: 'rejected' };
    return { label: 'Pending', tone: 'pending' };
  }

  function renderReviewStatusBadge(status) {
    if (!status) return '';
    return '<span class="file-viewer-review-status file-viewer-review-status--' + escapeHtml(status.tone) + '">' +
      escapeHtml(status.label) +
    '</span>';
  }

  function reviewChangeKind(change) {
    var operation = String((change && change.operation) || (change && change.type) || '').toLowerCase();
    if (operation === 'delete' || operation === 'del' || operation === 'remove' || operation === 'removed') return 'removed';
    if (operation === 'insert' || operation === 'ins' || operation === 'add' || operation === 'added') return 'added';
    if (change && change.original_text && change.proposed_text && change.original_text !== change.proposed_text) return 'modified';
    if (change && change.original_text && !change.proposed_text) return 'removed';
    return 'added';
  }

  function renderReviewChangeDiff(change) {
    if (!change) return '';
    var original = change.original_text ? String(change.original_text) : '';
    var proposed = change.proposed_text ? String(change.proposed_text) : '';
    var fallback = String(reviewItemText(change) || 'No preview available');
    var kind = reviewChangeKind(change);
    var lines = [];
    if (original && proposed && original !== proposed) {
      lines.push({ mark: '-', tone: 'removed', text: original });
      lines.push({ mark: '+', tone: 'added', text: proposed });
    } else if (kind === 'removed' && original) {
      lines.push({ mark: '-', tone: 'removed', text: original });
    } else {
      lines.push({ mark: '+', tone: kind === 'removed' ? 'removed' : 'added', text: proposed || fallback });
    }
    return '<span class="file-viewer-review-history-row__diff">' + lines.map(function (line) {
      return '<span class="file-viewer-review-history-row__diff-line file-viewer-review-history-row__diff-line--' + line.tone + '">' +
        '<span class="file-viewer-review-history-row__diff-mark">' + escapeHtml(line.mark) + '</span>' +
        '<span>' + escapeHtml(line.text) + '</span>' +
      '</span>';
    }).join('') + '</span>';
  }

  function renderReviewList(type, items) {
    var target = document.getElementById(type === 'comments' ? 'reviewCommentsList' : 'reviewChangesList');
    if (!target) return;
    if (!items || !items.length) {
      target.innerHTML = '';
      return;
    }
    target.innerHTML = items.map(function (item, index) {
      var author = item && item.author ? item.author : 'Unknown';
      var date = item && item.date ? item.date : (item && item.released_in && item.released_in.released_at ? formatDate(item.released_in.released_at) : '');
      var text = String(reviewItemText(item));
      var releasedIn = item && item.released_in && item.released_in.release_number
        ? 'Released in Version ' + item.released_in.release_number
        : '';
      var badge = renderReviewStatusBadge(reviewStatus(item, type));
      return '<button type="button" class="file-viewer-review-item" data-review-item-type="' + type + '" data-review-item-index="' + index + '">' +
        '<span class="file-viewer-review-item-meta"><span>' + escapeHtml(author) + '</span><span>' + escapeHtml(date) + '</span></span>' +
        '<span class="file-viewer-review-item-title-row"><span class="file-viewer-review-item-title">' + escapeHtml(reviewItemLabel(type, item)) + '</span>' + badge + '</span>' +
        '<span class="file-viewer-review-item-text">' + escapeHtml(text || 'No preview available') + '</span>' +
        (releasedIn ? '<span class="file-viewer-review-item-version">' + escapeHtml(releasedIn) + '</span>' : '') +
        '</button>';
    }).join('');
  }

  function releaseGroupForRelease(release) {
    var changes = [];
    for (var i = 0; i < state.releaseChangeGroups.length; i++) {
      if (state.releaseChangeGroups[i].release_id === release.id) {
        changes = state.releaseChangeGroups[i].changes || [];
        break;
      }
    }
    return {
      release: release,
      changes: changes
    };
  }

  function selectedReleaseGroups() {
    if (!state.reviewReleases.length) return [];
    if (state.selectedReviewReleaseId) {
      return state.reviewReleases
        .filter(function (release) { return release.id === state.selectedReviewReleaseId; })
        .map(releaseGroupForRelease);
    }
    return state.reviewReleases.map(releaseGroupForRelease);
  }

  function renderChangeHistory(editorItems) {
    var target = document.getElementById('reviewChangesList');
    if (!target) return;
    var groups = selectedReleaseGroups();
    var editorChanges = Array.isArray(editorItems) ? editorItems : [];
    var draftBatchChanges = state.currentReviewBatch && Array.isArray(state.currentReviewBatch.changes)
      ? state.currentReviewBatch.changes
      : [];
    var unreleasedChanges = editorChanges.length ? editorChanges : draftBatchChanges;
    if (!groups.length && !unreleasedChanges.length) {
      renderReviewList('changes', editorItems || []);
      return;
    }

    var filteredGroups = groups.map(function (group) {
      return {
        release: group.release,
        changes: filterHistoryChanges(group.changes || [], group.release)
      };
    });
    var controls = groups.length ? renderHistoryFilters(groups) : '';
    function renderHistorySection(options) {
      var changes = Array.isArray(options.changes) ? options.changes : [];
      var rows = changes.length
        ? changes.map(function (change, index) {
            var badge = renderReviewStatusBadge(reviewStatus(change, 'changes'));
            var releaseAttr = options.releaseId ? ' data-review-history-release="' + escapeHtml(options.releaseId) + '"' : '';
            return '<button type="button" class="file-viewer-review-history-row"' + releaseAttr + ' data-review-item-type="changes" data-review-item-index="' + index + '">' +
              '<span class="file-viewer-review-history-row__heading"><span class="file-viewer-review-history-row__title">' + escapeHtml(reviewItemLabel('changes', change)) + '</span>' + badge + '</span>' +
              renderReviewChangeDiff(change) +
            '</button>';
          }).join('')
        : '<div class="file-viewer-review-history-empty">' + escapeHtml(options.emptyText || 'No changes in this section.') + '</div>';
      return '<section class="file-viewer-review-history-group' + (options.unreleased ? ' file-viewer-review-history-group--unreleased' : '') + '">' +
        '<header class="file-viewer-review-history-header">' +
          '<h5>' + escapeHtml(options.title) + '</h5>' +
          '<span>' + changes.length + ' change' + (changes.length === 1 ? '' : 's') + '</span>' +
        '</header>' +
        '<div class="file-viewer-review-history-rows">' + rows + '</div>' +
      '</section>';
    }
    var unreleasedHtml = unreleasedChanges.length
      ? renderHistorySection({
          title: 'Unreleased',
          changes: unreleasedChanges,
          unreleased: true
        })
      : '';
    var groupHtml = filteredGroups.map(function (group) {
      var release = group.release || {};
      var changes = Array.isArray(group.changes) ? group.changes : [];
      return renderHistorySection({
        title: 'Version ' + (release.release_number || ''),
        changes: changes,
        releaseId: release.id || '',
        emptyText: 'No persisted changes attached to this version.'
      });
    }).join('');
    target.innerHTML = controls + unreleasedHtml + groupHtml;
  }

  function historyChangeUser(change) {
    if (!change) return 'Unknown';
    return change.decided_by_name || (change.metadata && change.metadata.author) || change.author || change.decided_by || change.updated_by || change.created_by || 'Unknown';
  }

  function historyChangeDate(change, release) {
    return (change && (change.released_at || change.decided_at || change.updated_at || change.created_at)) ||
      (release && release.released_at) ||
      '';
  }

  function historyDateBucket(value) {
    var date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return 'all';
    var now = new Date();
    var diffMs = now.getTime() - date.getTime();
    if (diffMs <= 7 * 24 * 60 * 60 * 1000) return '7d';
    if (diffMs <= 30 * 24 * 60 * 60 * 1000) return '30d';
    return 'older';
  }

  function filterHistoryChanges(changes, release) {
    return (Array.isArray(changes) ? changes : []).filter(function (change) {
      var user = historyChangeUser(change);
      if (state.releaseHistoryFilters.user !== 'all' && user !== state.releaseHistoryFilters.user) return false;
      if (state.releaseHistoryFilters.date !== 'all' && historyDateBucket(historyChangeDate(change, release)) !== state.releaseHistoryFilters.date) return false;
      return true;
    });
  }

  function renderHistoryFilters(groups) {
    var users = [];
    for (var i = 0; i < groups.length; i++) {
      var changes = groups[i].changes || [];
      for (var j = 0; j < changes.length; j++) {
        var user = historyChangeUser(changes[j]);
        if (users.indexOf(user) === -1) users.push(user);
      }
    }
    users.sort();
    var userOptions = [{ value: 'all', label: 'All users' }].concat(users.map(function (user) {
      return { value: user, label: user };
    }));
    var dateOptions = [
      { value: 'all', label: 'All time' },
      { value: '7d', label: 'Last 7 days' },
      { value: '30d', label: 'Last 30 days' },
      { value: 'older', label: 'Older' }
    ];
    var date = state.releaseHistoryFilters.date;
    return '<div class="file-viewer-review-history-filters" aria-label="Change history filters">' +
      '<lex-select label="User" size="sm" value="' + escapeHtml(state.releaseHistoryFilters.user || 'all') + '" data-review-history-filter="user" options=\'' + lexOptionsAttribute(userOptions) + '\'></lex-select>' +
      '<lex-select label="Date" size="sm" value="' + escapeHtml(date || 'all') + '" data-review-history-filter="date" options=\'' + lexOptionsAttribute(dateOptions) + '\'></lex-select>' +
    '</div>';
  }

  function releaseDocumentId(release) {
    if (!release) return '';
    return release.released_document_id || release.releasedDocumentId || '';
  }

  function releaseIsSelected(release) {
    return Boolean(release && state.selectedReviewReleaseId && release.id === state.selectedReviewReleaseId);
  }

  function selectedReleaseLabel() {
    for (var i = 0; i < state.reviewReleases.length; i++) {
      var release = state.reviewReleases[i];
      if (releaseIsSelected(release)) {
        return release.released_document_filename || ('Version ' + release.release_number);
      }
    }
    return '';
  }

  function renderDiffComparison(comparison) {
    var target = document.getElementById('viewerDiff');
    if (!target) return;
    var parts = Array.isArray(comparison && comparison.parts) ? comparison.parts : [];
    var originalName = comparison && comparison.original_document ? comparison.original_document.filename : 'Source document';
    var newName = comparison && comparison.new_document ? comparison.new_document.filename : 'Selected version';
    var meta = (comparison && Number(comparison.changes || 0)) + ' changed segment' + (Number(comparison && comparison.changes || 0) === 1 ? '' : 's');
    var body = parts.length
      ? parts.map(function (part) {
          var kind = part.kind === 'added' || part.kind === 'removed' ? part.kind : 'unchanged';
          return '<span class="file-viewer-diff-part file-viewer-diff-part--' + kind + '">' + escapeHtml(part.text || '') + '</span>';
        }).join('')
      : '<p class="file-viewer-review-releases__empty">No textual differences detected.</p>';

    target.innerHTML =
      '<div class="file-viewer-diff-header">' +
        '<div>' +
          '<h4 class="file-viewer-diff-title">' + escapeHtml(originalName || 'Source document') + ' vs ' + escapeHtml(newName || 'Selected version') + '</h4>' +
          '<p class="file-viewer-diff-meta">' + escapeHtml(meta) + '</p>' +
        '</div>' +
      '</div>' +
      '<div class="file-viewer-diff-document">' + body + '</div>';
    hideAllViewers();
    target.classList.remove('hidden');
  }

  async function clearReleaseComparison() {
    state.selectedReviewReleaseId = null;
    state.selectedReviewReleaseDocumentId = null;
    state.releaseChangeHistory = [];
    state.releaseChangeGroups = [];
    state.releaseComparison = null;
    state.releaseComparisonLoading = false;
    renderReviewWorkflow();
    setReviewTab('releases');
    if (state.currentFile) {
      await loadFileContent(state.currentFile);
    }
  }

  async function selectReleaseForComparison(index) {
    var release = state.reviewReleases && state.reviewReleases[index];
    if (!release) return;
    if (releaseIsSelected(release)) {
      await clearReleaseComparison();
      return;
    }
    var documentId = releaseDocumentId(release);
    if (!documentId) {
      notify('This release does not have an attached document.', 'error');
      return;
    }

    state.selectedReviewReleaseId = release.id;
    state.selectedReviewReleaseDocumentId = documentId;
    state.releaseChangeHistory = [];
    state.releaseChangeGroups = [];
    state.releaseComparison = null;
    state.releaseComparisonLoading = true;
    renderReviewWorkflow('Loading selected version...');
    setReviewTab('releases');
    showLoading();

    try {
      if (release.edit_batch_id) {
        var batchResponse = await api.get(reviewEndpoint('/document-edit-batches/' + encodeURIComponent(release.edit_batch_id)));
        var batch = batchResponse && batchResponse.data ? batchResponse.data : batchResponse;
        state.releaseChangeHistory = Array.isArray(batch && batch.changes) ? batch.changes : [];
        state.releaseChangeGroups = [{
          release_id: release.id,
          release: release,
          changes: state.releaseChangeHistory
        }];
        updateReviewRailCounts(state.reviewState || {});
      }
      var comparisonResponse = await api.post(
        reviewEndpoint('/documents/' + encodeURIComponent(state.currentFile.id) + '/compare'),
        { comparison_document_id: documentId }
      );
      state.releaseComparison = comparisonResponse && comparisonResponse.data ? comparisonResponse.data : comparisonResponse;
      renderDiffComparison(state.releaseComparison);
    } catch (error) {
      console.error('[FileViewerPage] Release comparison failed:', error);
      notify((error && error.message) || 'Failed to compare selected version', 'error');
      hideLoading();
      var editorEl = document.getElementById('viewerEditor');
      if (editorEl && state.editorInstance) editorEl.classList.remove('hidden');
    } finally {
      state.releaseComparisonLoading = false;
      renderReviewWorkflow();
    }
  }

  function setEditorInteractionMode(mode) {
    var nextMode = mode === 'review' ? 'review' : 'view';
    state.editorMode = nextMode;
    if (state.editorInstance && typeof state.editorInstance.setMode === 'function') {
      state.editorInstance.setMode(nextMode);
    }
    setCanvasModeDisplay(Boolean(state.editorInstance));
  }

  function focusReviewItem(type, index) {
    var reviewState = state.reviewState || {};
    var collection = type === 'comments' ? reviewState.comments : reviewState.revisions;
    var item = Array.isArray(collection) ? collection[index] : null;
    if (!item || !item.element || !state.editorInstance || typeof state.editorInstance.jumpTo !== 'function') return;
    state.editorInstance.jumpTo(item.element);
  }

  function bytesToBase64(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      var chunk = bytes.subarray(i, i + 0x8000);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  function reviewEndpoint(path) {
    var matterId = getCurrentMatterId();
    if (!matterId) throw new Error('This file is not associated with a workspace.');
    return '/api/v1/matters/' + encodeURIComponent(matterId) + path;
  }

  function currentReviewState() {
    if (state.editorInstance && typeof state.editorInstance.reviewState === 'function') {
      try {
        state.reviewState = state.editorInstance.reviewState();
      } catch (_) {}
    }
    return state.reviewState || {};
  }

  function normalizeReviewChanges(reviewState) {
    var revisions = Array.isArray(reviewState && reviewState.revisions) ? reviewState.revisions : [];
    return revisions.map(function (revision, index) {
      var id = revision && revision.id ? String(revision.id) : String(index + 1);
      var type = revision && revision.type ? String(revision.type) : 'change';
      var text = revision && revision.text ? String(revision.text) : '';
      return {
        change_key: 'revision:' + id,
        status: 'proposed',
        operation: type === 'del' ? 'delete' : (type === 'ins' ? 'insert' : type),
        original_text: type === 'del' ? text : null,
        proposed_text: type === 'ins' ? text : null,
        anchor: {
          type: 'editor_revision',
          revision_id: id,
          revision_type: type,
          index: index
        },
        metadata: {
          author: revision && revision.author ? revision.author : null,
          date: revision && revision.date ? revision.date : null
        }
      };
    });
  }

  function reviewMetadata(reviewState) {
    var comments = Array.isArray(reviewState && reviewState.comments) ? reviewState.comments : [];
    return {
      source: 'file_viewer',
      editor_mode: state.editorMode,
      document_name: (reviewState && reviewState.documentName) || (state.currentFile && state.currentFile.filename) || null,
      counts: state.reviewCounts,
      comments: comments.map(function (comment, index) {
        return {
          id: comment && comment.id ? String(comment.id) : String(index + 1),
          author: comment && comment.author ? comment.author : null,
          date: comment && comment.date ? comment.date : null,
          text: comment && comment.text ? comment.text : ''
        };
      })
    };
  }

  function draftBatchTitle() {
    var name = state.currentFile && state.currentFile.filename ? state.currentFile.filename : 'Document';
    return 'Review draft: ' + name;
  }

  function releaseFilename() {
    var name = state.currentFile && state.currentFile.filename ? state.currentFile.filename : 'released-document.docx';
    if (/\.docx$/i.test(name)) return name.replace(/\.docx$/i, ' - released.docx');
    var match = /^(.+?)(\.[^.]+)$/.exec(name);
    if (match) return match[1] + ' - released' + match[2];
    return name + ' - released';
  }

  function activeDraftBatchFromList(list) {
    var batches = Array.isArray(list) ? list : [];
    for (var i = 0; i < batches.length; i++) {
      if (batches[i] && batches[i].status !== 'released' && batches[i].status !== 'cancelled') {
        return batches[i];
      }
    }
    return null;
  }

  async function loadReviewWorkflow(file) {
    state.reviewBatches = [];
    state.currentReviewBatch = null;
    state.reviewReleases = [];
    state.selectedReviewReleaseId = null;
    state.selectedReviewReleaseDocumentId = null;
    state.releaseChangeHistory = [];
    state.releaseComparison = null;
    state.releaseComparisonLoading = false;
    state.editorFocusedContext = null;
    state.workspaceFieldCatalog = null;
    state.workspaceFieldCatalogMatterId = null;
    state.reviewDirty = false;
    renderReviewWorkflow();

    var matterId = getFileMatterId(file);
    if (!matterId || !file || !file.id) {
      renderReviewWorkflow('Workspace association required to save review drafts.');
      return;
    }

    try {
      var query = '?document_id=' + encodeURIComponent(file.id) + '&limit=20&sort_by=updated_at&sort_dir=desc';
      var batchesResponse = await api.get(reviewEndpoint('/document-edit-batches' + query));
      state.reviewBatches = Array.isArray(batchesResponse && batchesResponse.data) ? batchesResponse.data : [];
      state.currentReviewBatch = activeDraftBatchFromList(state.reviewBatches);
      if (state.currentReviewBatch && state.currentReviewBatch.id) {
        try {
          var draftResponse = await api.get(reviewEndpoint('/document-edit-batches/' + encodeURIComponent(state.currentReviewBatch.id)));
          state.currentReviewBatch = draftResponse && draftResponse.data ? draftResponse.data : draftResponse;
        } catch (draftError) {
          console.warn('[FileViewerPage] Draft review batch detail load failed:', draftError);
        }
      }

      var releasesResponse = await api.get(reviewEndpoint('/documents/' + encodeURIComponent(file.id) + '/releases?limit=20'));
      state.reviewReleases = Array.isArray(releasesResponse && releasesResponse.data) ? releasesResponse.data : [];
      state.releaseChangeGroups = await loadReleaseChangeGroups(state.reviewReleases);
      state.releaseChangeHistory = state.selectedReviewReleaseId
        ? (state.releaseChangeGroups.find(function (group) { return group.release_id === state.selectedReviewReleaseId; }) || {}).changes || []
        : [];
      renderReviewWorkflow();
      updateReviewRailCounts(state.reviewState || {});
    } catch (error) {
      console.warn('[FileViewerPage] Review workflow load failed:', error);
      renderReviewWorkflow('Unable to load review history.');
    }
  }

  async function loadReleaseChangeGroups(releases) {
    var items = Array.isArray(releases) ? releases : [];
    var groups = await Promise.all(items.map(async function (release) {
      if (!release || !release.edit_batch_id) {
        return {
          release_id: release && release.id,
          release: release,
          changes: []
        };
      }
      try {
        var batchResponse = await api.get(reviewEndpoint('/document-edit-batches/' + encodeURIComponent(release.edit_batch_id)));
        var batch = batchResponse && batchResponse.data ? batchResponse.data : batchResponse;
        return {
          release_id: release.id,
          release: release,
          changes: Array.isArray(batch && batch.changes) ? batch.changes : []
        };
      } catch (error) {
        console.warn('[FileViewerPage] Release change group load failed:', error);
        return {
          release_id: release.id,
          release: release,
          changes: []
        };
      }
    }));
    return groups;
  }

  function renderReviewWorkflow(message) {
    var statusEl = document.getElementById('reviewBatchStatus');
    var saveBtn = document.getElementById('reviewSaveDraftBtn');
    var releaseBtn = document.getElementById('reviewReleaseBtn');
    var releasesEl = document.getElementById('reviewReleasesList');
    var matterId = getCurrentMatterId();
    var hasEditor = !!state.editorInstance;
    var canUseWorkflow = !!(matterId && state.currentFile && state.currentFile.id && hasEditor);
    var changeCount = state.reviewCounts.changes || 0;
    var hasReviewWork = changeCount > 0 || !!state.currentReviewBatch;

    if (statusEl) {
      if (message) {
        statusEl.textContent = message;
      } else if (state.selectedReviewReleaseId) {
        statusEl.textContent = 'Comparing source document with ' + (selectedReleaseLabel() || 'selected version') + '.';
      } else if (!matterId) {
        statusEl.textContent = 'Workspace association required to save review drafts.';
      } else if (state.currentReviewBatch) {
        statusEl.textContent = (state.reviewDirty ? 'Unsaved changes to ' : 'Saved ') + (state.currentReviewBatch.title || 'review draft') + '.';
      } else if (changeCount > 0) {
        statusEl.textContent = changeCount + ' pending change' + (changeCount === 1 ? '' : 's') + ' not saved yet.';
      } else {
        statusEl.textContent = 'No saved review draft.';
      }
    }

    if (saveBtn) {
      saveBtn.disabled = !canUseWorkflow || !hasReviewWork || state.reviewSaving;
      saveBtn.textContent = state.reviewSaving ? 'Saving...' : 'Save Draft';
    }
    if (releaseBtn) {
      releaseBtn.disabled = !canUseWorkflow || !hasReviewWork || state.reviewSaving || state.reviewReleasing;
      releaseBtn.textContent = state.reviewReleasing ? 'Releasing...' : 'Release Version';
    }

    if (releasesEl) {
      if (!state.reviewReleases.length) {
        releasesEl.innerHTML = '<p class="file-viewer-review-releases__empty">No versions yet.</p>';
      } else {
        releasesEl.innerHTML = state.reviewReleases.map(function (release, index) {
          var label = release.released_document_filename || ('Version ' + release.release_number);
          var releasedAt = release.released_at ? formatDate(release.released_at) : '';
          var documentId = releaseDocumentId(release);
          var selected = releaseIsSelected(release);
          var attrs = documentId
            ? ' type="button" data-review-release-compare-index="' + index + '" aria-pressed="' + (selected ? 'true' : 'false') + '" aria-label="' + (selected ? 'Clear comparison for ' : 'Compare source against ') + escapeHtml(label) + '"'
            : '';
          var tag = documentId ? 'button' : 'div';
          var selectedClass = selected ? ' file-viewer-review-release--selected' : '';
          return '<' + tag + ' class="file-viewer-review-release' + selectedClass + '"' + attrs + '>' +
            '<span class="file-viewer-review-release__copy">' +
              '<span class="file-viewer-review-release__title">' + escapeHtml(label) + '</span>' +
              '<span class="file-viewer-review-release__meta">Version ' + escapeHtml(release.release_number || '') + (releasedAt ? ' &middot; ' + escapeHtml(releasedAt) : '') + (selected ? ' &middot; Selected for compare' : '') + '</span>' +
            '</span>' +
            '<span class="file-viewer-review-release__compare" aria-hidden="true">' +
              '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4 4m-4-4l4-4"></path></svg>' +
            '</span>' +
            '</' + tag + '>';
        }).join('');
      }
    }
  }

  async function saveReviewBatch(options) {
    options = options || {};
    if (!state.currentFile || !state.editorInstance) throw new Error('No editable document is open.');
    var reviewState = currentReviewState();
    var changes = normalizeReviewChanges(reviewState);
    var payload = {
      title: draftBatchTitle(),
      summary: changes.length + ' tracked change' + (changes.length === 1 ? '' : 's') + ' captured from File Viewer.',
      status: 'draft',
      changes: changes,
      review_metadata: reviewMetadata(reviewState)
    };

    state.reviewSaving = true;
    renderReviewWorkflow();
    try {
      var response;
      if (state.currentReviewBatch && state.currentReviewBatch.id && state.currentReviewBatch.status !== 'released') {
        response = await api.patch(
          reviewEndpoint('/document-edit-batches/' + encodeURIComponent(state.currentReviewBatch.id)),
          payload
        );
      } else {
        response = await api.post(
          reviewEndpoint('/documents/' + encodeURIComponent(state.currentFile.id) + '/edit-batches'),
          payload
        );
      }
      state.currentReviewBatch = response && response.data ? response.data : response;
      state.reviewDirty = false;
      await loadReviewWorkflow(state.currentFile);
      if (!options.silent) notify('Review draft saved', 'success');
      return state.currentReviewBatch;
    } finally {
      state.reviewSaving = false;
      renderReviewWorkflow();
    }
  }

  async function releaseReviewVersion() {
    if (!state.currentFile || !state.editorInstance) return;
    var run = async function () {
      state.reviewReleasing = true;
      renderReviewWorkflow();
      try {
        var batch = state.currentReviewBatch && !state.reviewDirty
          ? state.currentReviewBatch
          : await saveReviewBatch({ silent: true });
        if (!batch || !batch.id) throw new Error('Review draft could not be saved.');
        if (typeof state.editorInstance.bytes !== 'function') throw new Error('Editor bytes are unavailable.');
        var bytes = state.editorInstance.bytes();
        if (!bytes) throw new Error('No document bytes are available to release.');
        var response = await api.post(
          reviewEndpoint('/document-edit-batches/' + encodeURIComponent(batch.id) + '/release'),
          {
            approved: true,
            filename: releaseFilename(),
            content_type: state.currentFile.content_type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            content_base64: bytesToBase64(bytes),
            release_notes: 'Released from File Viewer review workflow.'
          }
        );
        state.currentReviewBatch = null;
        state.reviewDirty = false;
        await loadReviewWorkflow(state.currentFile);
        var released = response && response.data && response.data.document;
        notify('Released version' + (released && released.filename ? ': ' + released.filename : ''), 'success');
      } catch (error) {
        console.error('[FileViewerPage] Release version failed:', error);
        notify((error && error.message) || 'Failed to release version', 'error');
      } finally {
        state.reviewReleasing = false;
        renderReviewWorkflow();
      }
    };

    var message = 'Release the current document as a new version? This creates an immutable release record and saves a new workspace document.';
    if (typeof Lex !== 'undefined' && Lex.Modal && typeof Lex.Modal.confirm === 'function') {
      Lex.Modal.confirm('Release Version', message, run);
    } else if (window.confirm(message)) {
      run();
    }
  }

  function findBannerActionTarget(event) {
    var path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    for (var i = 0; i < path.length; i++) {
      var node = path[i];
      if (!node || node.nodeType !== 1) continue;
      if (node.dataset && node.dataset.viewerAction) return node;
      if (node.id && (
        node.id === 'viewerFileInfoBtn' ||
        node.id === 'viewerReviewModeBadge' ||
        node.id === 'openDocStudioBtn' ||
        node.id === 'viewerDownloadBtn' ||
        node.id === 'viewerTemplateBtn' ||
        node.id === 'viewerGenerateBtn' ||
        node.id === 'viewerDeleteBtn'
      )) {
        return node;
      }
    }
    return event.target && event.target.closest
      ? event.target.closest('[data-viewer-action], lex-btn, button')
      : null;
  }

  function updateDocStudioButton(file) {
    var button = document.getElementById('openDocStudioBtn');
    if (!button) return;
    var url = docStudioDocumentUrl(file);
    button.classList.toggle('hidden', !url);
  }

  function openCurrentFileInDocStudio() {
    var url = docStudioDocumentUrl(state.currentFile);
    if (!url) {
      notify('This file was not generated by Doc Studio.', 'error');
      return;
    }
    Lex.Nav.go(url);
  }

  // =========================================================================
  // File Loading
  // =========================================================================

  function showLoading() {
    hideAllViewers();
    document.getElementById('viewerLoading').classList.remove('hidden');
  }

  function hideLoading() {
    document.getElementById('viewerLoading').classList.add('hidden');
  }

  function showError(message) {
    hideAllViewers();
    var errorDiv = document.getElementById('viewerError');
    document.getElementById('viewerErrorMsg').textContent = message;
    errorDiv.classList.remove('hidden');
    hideLoading();

    // Disable Ask LANA and hide Download buttons when file fails
    var askBtn = document.getElementById('askLanaBtn');
    var dlBtn = document.getElementById('viewerDownloadBtn');
    var docStudioBtn = document.getElementById('openDocStudioBtn');
    var fileInfoBtn = document.getElementById('viewerFileInfoBtn');
    if (askBtn) askBtn.disabled = true;
    if (dlBtn) dlBtn.classList.add('hidden');
    if (docStudioBtn) docStudioBtn.classList.add('hidden');
    if (fileInfoBtn) fileInfoBtn.classList.add('hidden');
    setReviewRailVisible(false);
  }

  function hideAllViewers() {
    var ids = ['viewerLoading', 'viewerError', 'viewerIframe', 'viewerText', 'viewerImage', 'viewerEditor', 'viewerDiff', 'viewerDocx'];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el) el.classList.add('hidden');
    }
  }

  async function loadFile(fileId) {
    showLoading();

    try {
      var response = await api.get('/api/v1/storage/files/' + fileId);
      if (!response || !response.id) {
        throw new Error('File not found');
      }

      // Track file activity (non-blocking)
      api.post('/api/v1/storage/files/' + fileId + '/activity', { event_type: 'opened' })
        .catch(function () { /* non-critical */ });

      state.currentFile = response;

      // Configure LANA panel with file context
      var lanaPanel = document.getElementById('fileViewerLana');
      if (lanaPanel) {
        lanaPanel.threadTitle = response.filename;
        if (response.client_matter || response.matter_id) {
          lanaPanel.setAttribute('matter-id', response.client_matter || response.matter_id);
        }
      }

      // The Ask LANA button injects this document's context into the dock
      var askLanaBtn = document.getElementById('askLanaBtn');
      if (askLanaBtn) {
        askLanaBtn.setAttribute('document-id', response.id);
        askLanaBtn.setAttribute('document-name', response.filename || 'Document');
        askLanaBtn.setAttribute('context-type', 'document_chat');
        if (response.client_matter || response.matter_id) {
          askLanaBtn.setAttribute('matter-id', response.client_matter || response.matter_id);
        }
      }

      // Declare the document as the dock's page context so a rail-opened
      // dock can OFFER it ("Ask about <file>") instead of arriving blank.
      var pageDock = document.querySelector('lex-lana-dock');
      if (pageDock && typeof pageDock.setPageContext === 'function') {
        pageDock.setPageContext({
          documentId: response.id,
          documentName: response.filename || 'Document',
          matterId: response.client_matter || response.matter_id || null,
          matterName: null
        });
      }

      state.originalMetadata = {
        document_type: (response.metadata && response.metadata.document_type) || '',
        tags: (response.metadata && response.metadata.tags) || '',
        notes: (response.metadata && response.metadata.notes) || ''
      };
      state.metadataChanged = false;

      var lifecycleDisplay = window.documentLifecycle && typeof window.documentLifecycle.getDocumentLifecycleDisplay === 'function'
        ? window.documentLifecycle.getDocumentLifecycleDisplay(response)
        : null;

      // Update header (lex-banner heading + subtitle)
      // Setting attributes triggers a re-render via microtask; wait for it
      // to flush before mutating the rendered overflow buttons.
      var banner = document.getElementById('viewerBanner');
      if (banner) {
        banner.setAttribute('heading', response.filename);
        banner.setAttribute('subtitle',
          formatFileSize(response.file_size) + ' \u2022 ' + formatDate(response.created_at));
      }

      // Breadcrumb mirrors workspace-details: matter-scoped files thread
      // through "Workspaces & Matters > [Matter] > filename"; workspace-only
      // files just show the filename, since there's no global storage page
      // worth linking to from here.
      var breadcrumb = document.getElementById('viewerBreadcrumb');
      if (breadcrumb) {
        var crumbItems = [];
        var matterId = response.client_matter || response.matter_id;
        var matterName = response.matter_name || response.client_matter_name;
        if (matterId) {
          crumbItems.push({ label: 'Workspaces & Matters', href: 'workspaces.html' });
          crumbItems.push({
            label: matterName || matterId,
            href: 'workspace-details.html?id=' + encodeURIComponent(matterId)
          });
        }
        crumbItems.push({ label: response.filename });
        breadcrumb.setAttribute('items', JSON.stringify(crumbItems));
      }

      // Update page title
      document.title = response.filename + ' - LANA AI';

      // Flush the banner re-render queued by the setAttribute calls above so
      // subsequent class toggles target the final rendered DOM nodes, not
      // the soon-to-be-replaced clones. Click handlers are wired via
      // delegation on the banner itself, so they survive re-renders.
      await Promise.resolve();

      updateDocStudioButton(response);
      var fileInfoBtn = document.getElementById('viewerFileInfoBtn');
      if (fileInfoBtn) fileInfoBtn.classList.remove('hidden');

      // Load content + metadata
      await loadFileContent(response);
      loadMetadata(response);
      if (window.LanaActivityEvents && typeof window.LanaActivityEvents.documentOpened === 'function') {
        window.LanaActivityEvents.documentOpened(response, { surface: 'file_viewer' });
      }

      var lifecycleBadge = document.getElementById('metaLifecycleBadge');
      if (lifecycleBadge && lifecycleDisplay) {
        lifecycleBadge.textContent = lifecycleDisplay.label || 'Uploaded';
        lifecycleBadge.className = 'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ' + (lifecycleDisplay.badgeClass || 'bg-blue-100 text-blue-700');
      }
      _updateTemplateButtons();

      // Dismiss loader
      if (typeof Lex !== 'undefined' && Lex.Loader && typeof Lex.Loader.hide === 'function') {
        Lex.Loader.hide();
      }

    } catch (error) {
      console.error('[FileViewerPage] Failed to load file:', error);
      showError('Failed to load file: ' + error.message);
      if (typeof Lex !== 'undefined' && Lex.Loader && typeof Lex.Loader.hide === 'function') {
        Lex.Loader.hide();
      }
    }
  }

  // =========================================================================
  // Content Loaders
  // =========================================================================

  async function loadFileContent(file) {
    shutdownEditorInstance();
    hideAllViewers();
    state.editorMode = 'view';
    state.reviewState = null;
    state.reviewBatches = [];
    state.currentReviewBatch = null;
    state.reviewReleases = [];
    state.reviewDirty = false;
    state.reviewSaving = false;
    state.reviewReleasing = false;
    setReviewRailVisible(false);
    updateReviewRailCounts({ revisions: 0, comments: 0 });
    var mimeType = file.content_type || '';
    var ext = file.filename.split('.').pop().toLowerCase();

    try {
      if (mimeType === 'application/pdf' || ext === 'pdf') {
        await loadPDF(file);
      } else if (
        mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        mimeType === 'application/msword' ||
        ext === 'docx' || ext === 'doc'
      ) {
        await loadDOCX(file);
      } else if (mimeType.indexOf('image/') === 0 || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].indexOf(ext) !== -1) {
        await loadImage(file);
      } else if (mimeType.indexOf('text/') === 0 || ['txt', 'md', 'json', 'xml', 'csv', 'log'].indexOf(ext) !== -1) {
        await loadText(file);
      } else {
        showError('Preview not available for ' + ext.toUpperCase() + ' files');
      }
    } catch (error) {
      console.error('[FileViewerPage] Content load error:', error);
      showError('Failed to load preview: ' + error.message);
    }
  }

  async function loadPDF(file) {
    if (isDemoMode()) {
      var demoIframe = document.getElementById('viewerIframe');
      demoIframe.srcdoc = '<html><body style="font-family:system-ui,sans-serif;padding:32px;background:#f8fafc;color:#0f172a;"><h1 style="margin-top:0;">' +
        escapeHtml(file.filename || 'Demo PDF') +
        '</h1><p>This is a demo-mode PDF placeholder rendered from local fixture data.</p><pre style="white-space:pre-wrap;background:white;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">' +
        escapeHtml(buildDemoDocumentText(file)) +
        '</pre></body></html>';
      demoIframe.classList.remove('hidden');
      hideLoading();
      return;
    }

    var response = await fetch(getFileDownloadUrl(file), {
      headers: getAuthHeaders()
    });
    await assertFetchOk(response, 'Failed to fetch PDF');
    var arrayBuffer = await response.arrayBuffer();
    if (isEditorEnabled() && isEditorPreviewFile(file)) {
      var renderedWithEditor = await loadFileInEditor(file, arrayBuffer);
      if (renderedWithEditor) return;
    }
    var blob = new Blob([arrayBuffer], { type: file.content_type || 'application/pdf' });
    var objectUrl = URL.createObjectURL(blob);
    var iframe = document.getElementById('viewerIframe');
    iframe.src = objectUrl;
    iframe.classList.remove('hidden');
    hideLoading();
  }

  async function loadImage(file) {
    if (isDemoMode()) {
      var demoSvg = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">',
        '<rect width="1200" height="800" fill="#e2e8f0"/>',
        '<rect x="80" y="80" width="1040" height="640" rx="24" fill="#ffffff" stroke="#cbd5e1"/>',
        '<text x="120" y="180" font-family="Arial, sans-serif" font-size="42" fill="#0f172a">Demo Image Preview</text>',
        '<text x="120" y="250" font-family="Arial, sans-serif" font-size="28" fill="#334155">' + escapeHtml(file.filename || 'Image') + '</text>',
        '<text x="120" y="320" font-family="Arial, sans-serif" font-size="24" fill="#64748b">Rendered locally from seeded JSON metadata.</text>',
        '</svg>'
      ].join('');
      var demoImg = document.getElementById('viewerImage');
      demoImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(demoSvg);
      demoImg.classList.remove('hidden');
      hideLoading();
      return;
    }

    var response = await fetch(getFileDownloadUrl(file), {
      headers: getAuthHeaders()
    });
    await assertFetchOk(response, 'Failed to fetch image');
    var blob = await response.blob();
    var objectUrl = URL.createObjectURL(blob);
    var img = document.getElementById('viewerImage');
    img.src = objectUrl;
    img.onload = function () {
      img.classList.remove('hidden');
      hideLoading();
    };
    img.onerror = function () {
      showError('Failed to load image');
    };
  }

  async function loadText(file) {
    if (isDemoMode()) {
      var demoText = document.getElementById('viewerText');
      demoText.textContent = buildDemoDocumentText(file);
      demoText.classList.remove('hidden');
      hideLoading();
      return;
    }

    var response = await fetch(getFileDownloadUrl(file), {
      headers: getAuthHeaders()
    });
    await assertFetchOk(response, 'Failed to fetch file');
    var arrayBuffer = await response.arrayBuffer();
    if (isEditorEnabled() && isEditorPreviewFile(file)) {
      var renderedWithEditor = await loadFileInEditor(file, arrayBuffer);
      if (renderedWithEditor) return;
    }
    var text = new TextDecoder('utf-8').decode(arrayBuffer);
    var pre = document.getElementById('viewerText');
    pre.textContent = text;
    pre.classList.remove('hidden');
    hideLoading();
  }

  async function loadDOCX(file) {
    if (isDemoMode()) {
      var demoContainer = document.getElementById('viewerDocx');
      demoContainer.innerHTML = buildDemoDocxHtml(file);
      demoContainer.classList.remove('hidden');
      hideLoading();
      return;
    }

    var response = await fetch(getFileDownloadUrl(file), {
      headers: getAuthHeaders()
    });
    await assertFetchOk(response, 'Failed to fetch file');
    var arrayBuffer = await response.arrayBuffer();

    if (isEditorEnabled() && isEditorDocx(file)) {
      var renderedWithEditor = await loadFileInEditor(file, arrayBuffer);
      if (renderedWithEditor) return;
    }

    if (typeof mammoth === 'undefined') {
      throw new Error('Mammoth library not loaded');
    }

    var container = document.getElementById('viewerDocx');
    var result = await mammoth.convertToHtml({
      arrayBuffer: arrayBuffer,
      convertImage: mammoth.images.imgElement(function (image) {
        return image.read('base64').then(function (imageBuffer) {
          return { src: 'data:' + image.contentType + ';base64,' + imageBuffer };
        });
      }),
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "p[style-name='Title'] => h1.document-title:fresh",
        "r[style-name='Strong'] => strong",
        "r[style-name='Emphasis'] => em",
        "table => table.docx-table"
      ]
    });
    container.innerHTML = result.value;
    container.classList.remove('hidden');
    hideLoading();
  }

  async function loadFileInEditor(file, arrayBuffer) {
    var baseUrl = getEditorServiceBase();
    var host = document.getElementById('viewerEditor');
    if (!baseUrl || !host) return false;

    try {
      var health = await fetch(baseUrl + '/v1/health', { method: 'GET' });
      if (!health.ok) throw new Error('editor service unavailable');

      var mod = await loadEditorModule(baseUrl);
      if (!mod || !mod.LanaEditor || typeof mod.LanaEditor.mount !== 'function') {
        throw new Error('editor embed module unavailable');
      }

      host.innerHTML = '';
      host.classList.remove('hidden');
      var editor = mod.LanaEditor.mount(host, {
        api: baseUrl,
        fontsUrl: baseUrl + '/editor-fonts',
        pdfWorkerUrl: baseUrl + '/pdfjs/pdf.worker.min.mjs',
        mode: 'view'
      });
      state.editorInstance = editor;
      state.editorMode = 'view';

      editor.on('document-loaded', function (event) {
        updateReviewRailCounts(event && event.counts ? event.counts : null);
        trackEditorEvent('document_loaded', file, {
          document_id: file.id,
          document_name: file.filename,
          mode: event && event.mode,
          counts: event && event.counts ? {
            pages: event.counts.pages,
            paragraphs: event.counts.paragraphs,
            tables: event.counts.tables,
            revisions: event.counts.revisions,
            comments: event.counts.comments
          } : null
        });
      });
      editor.on('change-applied', function (event) {
        markReviewDirty(event && event.reviewState ? event.reviewState : null);
        trackEditorEvent('edit_applied', file, {
          document_id: file.id,
          document_name: file.filename,
          ops: event && event.ops
        });
      });
      editor.on('change-decision', function (event) {
        markReviewDirty(event && event.reviewState ? event.reviewState : null);
        var decisions = event && Array.isArray(event.decisions) ? event.decisions : [];
        var hasReject = event && event.mode === 'reject_all';
        for (var i = 0; i < decisions.length; i++) {
          if (decisions[i] && decisions[i].action === 'reject') {
            hasReject = true;
            break;
          }
        }
        trackEditorEvent(hasReject ? 'revision_rejected' : 'revision_accepted', file, {
          document_id: file.id,
          document_name: file.filename,
          decision_count: decisions.length,
          mode: event && event.mode
        });
      });
      editor.on('save', function () {
        trackEditorEvent('document_saved', file, {
          document_id: file.id,
          document_name: file.filename
        });
      });
      editor.on('error', function (event) {
        console.warn('[FileViewerPage] LANA Editor event error:', event);
      });
      editor.on('review-state-changed', function (reviewState) {
        state.reviewState = reviewState || null;
        state.editorMode = reviewState && reviewState.editorMode ? reviewState.editorMode : state.editorMode;
        updateReviewRailCounts(reviewState || null);
        setCanvasModeDisplay(true);
      });
      editor.on('lana-context-requested', openLanaForEditorContext);
      editor.on('workspace-field-requested', openWorkspaceFieldPicker);

      var bytes = new Uint8Array(arrayBuffer);
      await editor.open_file(new File([bytes], file.filename || 'document', {
        type: file.content_type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      }));
      if (typeof editor.reviewState === 'function') {
        state.reviewState = editor.reviewState();
        updateReviewRailCounts(state.reviewState);
      }
      setReviewRailVisible(editor.documentMode && editor.documentMode() !== 'pdf');
      await loadReviewWorkflow(file);
      hideLoading();
      return true;
    } catch (error) {
      state.editorModulePromise = null;
      shutdownEditorInstance();
      if (host) {
        host.innerHTML = '';
        host.classList.add('hidden');
      }
      console.warn('[FileViewerPage] LANA Editor unavailable; falling back to DOCX preview:', error && error.message ? error.message : error);
      return false;
    }
  }

  // =========================================================================
  // Download
  // =========================================================================

  async function downloadFile(fileId, filename) {
    try {
      if (isDemoMode()) {
        var demoBlob = new Blob([buildDemoDocumentText(state.currentFile || { id: fileId, filename: filename })], { type: 'text/plain;charset=utf-8' });
        var demoUrl = URL.createObjectURL(demoBlob);
        var demoLink = document.createElement('a');
        demoLink.href = demoUrl;
        demoLink.download = filename || 'lana-demo-document.txt';
        document.body.appendChild(demoLink);
        demoLink.click();
        document.body.removeChild(demoLink);
        URL.revokeObjectURL(demoUrl);
        notify('Demo document downloaded', 'success');
        if (window.LanaActivityEvents && typeof window.LanaActivityEvents.documentDownloaded === 'function') {
          window.LanaActivityEvents.documentDownloaded(state.currentFile || { id: fileId, filename: filename }, {
            surface: 'file_viewer',
            downloaded_as: filename || (state.currentFile && state.currentFile.filename) || null,
            demo_mode: true
          });
        }
        return;
      }

      var response = await fetch(getFileDownloadUrl(fileId), {
        headers: getAuthHeaders()
      });
      await assertFetchOk(response, 'Failed to download');
      var blob = await response.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      notify('Download started', 'success');
      if (window.LanaActivityEvents && typeof window.LanaActivityEvents.documentDownloaded === 'function') {
        window.LanaActivityEvents.documentDownloaded(state.currentFile || { id: fileId, filename: filename }, {
          surface: 'file_viewer',
          downloaded_as: filename || (state.currentFile && state.currentFile.filename) || null
        });
      }
    } catch (error) {
      console.error('[FileViewerPage] Download error:', error);
      notify(error.message || 'Failed to download file', 'error');
    }
  }

  function deleteFile() {
    var file = state.currentFile;
    var fileId = (file && file.id) || state.fileId;
    if (!fileId) return;
    var name = (file && file.filename) || 'this file';

    var run = async function () {
      try {
        await api.deleteDocument(fileId, { hard: true });
        notify('File deleted', 'success');
        navigateBack();
      } catch (error) {
        console.error('[FileViewerPage] Delete error:', error);
        notify((error && error.message) || 'Failed to delete file', 'error');
      }
    };

    var msg = 'Permanently delete "' + name + '"? The file, its embeddings, and related metadata will be removed. This cannot be undone.';
    if (typeof Lex !== 'undefined' && Lex.Modal && typeof Lex.Modal.confirm === 'function') {
      Lex.Modal.confirm('Delete File', msg, run);
    } else if (window.confirm(msg)) {
      run();
    }
  }

  // =========================================================================
  // Metadata
  // =========================================================================

  function loadMetadata(file) {
    document.getElementById('metaFileSize').textContent = formatFileSize(file.file_size);
    document.getElementById('metaUploadedAt').textContent = formatDate(file.created_at);
    document.getElementById('metaChunkCount').textContent =
      file.chunk_count !== undefined ? file.chunk_count.toLocaleString() : '0';

    var metadata = file.metadata || {};

    // View mode
    document.getElementById('metaDocTypeView').textContent =
      formatDocumentType(metadata.document_type) || formatMimeType(file.content_type) || 'Not specified';

    renderTagsView(metadata.tags);
    document.getElementById('metaNotesView').textContent = metadata.notes || 'No notes';

    // AI Summary
    var summarySection = document.getElementById('metaSummarySection');
    var summaryView = document.getElementById('metaSummaryView');
    var summaryTs = document.getElementById('metaSummaryTimestamp');
    var summaryState = window.documentLifecycle && typeof window.documentLifecycle.getDocumentSummaryState === 'function'
      ? window.documentLifecycle.getDocumentSummaryState(file)
      : (file.summary ? 'summarized' : 'unavailable');
    if (summarySection && summaryView) {
      if (file.summary) {
        summaryView.textContent = file.summary;
        if (summaryTs && file.summary_generated_at) {
          summaryTs.textContent = 'Generated ' + formatDate(file.summary_generated_at);
        } else if (summaryTs) {
          summaryTs.textContent = '';
        }
        summarySection.classList.remove('hidden');
      } else if (summaryState === 'pending') {
        summaryView.textContent = 'Summary pending';
        if (summaryTs) summaryTs.textContent = '';
        summarySection.classList.remove('hidden');
      } else {
        summaryView.textContent = 'Summary unavailable';
        if (summaryTs) summaryTs.textContent = '';
        summarySection.classList.remove('hidden');
      }
    }

    // Edit mode fields
    document.getElementById('metaDocType').value = metadata.document_type || '';
    document.getElementById('metaTags').value = metadata.tags || '';
    document.getElementById('metaNotes').value = metadata.notes || '';

    trackMetadataChanges();
    setMetadataMode('view');

    var toggle = document.getElementById('metaModeToggle');
    if (toggle && typeof toggle._positionIndicator === 'function') {
      requestAnimationFrame(function () { toggle._positionIndicator(); });
    }
  }

  function renderTagsView(tags) {
    var tagsView = document.getElementById('metaTagsView');
    if (tags && tags.trim()) {
      var tagList = tags.split(',');
      var filtered = [];
      for (var i = 0; i < tagList.length; i++) {
        var t = tagList[i].trim();
        if (t) filtered.push(t);
      }
      if (filtered.length > 0) {
        var html = '';
        for (var j = 0; j < filtered.length; j++) {
          html += '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium lex-bg-accent-muted lex-text-accent mr-1 mb-1">' + escapeHtml(filtered[j]) + '</span>';
        }
        tagsView.innerHTML = html;
      } else {
        tagsView.textContent = 'No tags';
      }
    } else {
      tagsView.textContent = 'No tags';
    }
  }

  function setMetadataMode(mode) {
    state.metadataMode = mode;
    var toggle = document.getElementById('metaModeToggle');
    var viewPanel = document.getElementById('metaViewMode');
    var editPanel = document.getElementById('metaEditMode');
    var footer = document.getElementById('metaActionsFooter');
    var footerShell = footer && footer.closest ? footer.closest('.lex-drawer-footer') : null;

    if (toggle && toggle.value !== mode) {
      toggle.value = mode;
    }

    if (mode === 'view') {
      viewPanel.classList.remove('hidden');
      editPanel.classList.add('hidden');
      footer.classList.add('hidden');
      if (footerShell) footerShell.classList.add('hidden');
    } else {
      viewPanel.classList.add('hidden');
      editPanel.classList.remove('hidden');
      footer.classList.remove('hidden');
      if (footerShell) footerShell.classList.remove('hidden');
    }
  }

  function trackMetadataChanges() {
    var fields = [
      document.getElementById('metaDocType'),
      document.getElementById('metaTags'),
      document.getElementById('metaNotes')
    ];
    for (var i = 0; i < fields.length; i++) {
      var el = fields[i];
      if (!el) continue;
      var evt = (el.tagName && el.tagName.indexOf('LEX-') === 0) ? 'lex-change' : 'input';
      el.addEventListener(evt, function () {
        state.metadataChanged = true;
      });
    }
  }

  async function saveMetadata() {
    if (!state.currentFile) return;

    var saveBtn = document.getElementById('metaSaveBtn');
    var originalText = saveBtn.textContent;

    try {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      var metadata = {
        document_type: document.getElementById('metaDocType').value,
        tags: document.getElementById('metaTags').value,
        notes: document.getElementById('metaNotes').value
      };
      var changedFields = Object.keys(metadata).filter(function (key) {
        return metadata[key] !== state.originalMetadata[key];
      });

      var response = await api.patch(
        '/api/v1/storage/files/' + state.currentFile.id + '/metadata',
        metadata
      );

      if (response.success || response.status === 'success') {
        state.originalMetadata = metadata;
        state.metadataChanged = false;

        // Update view mode
        document.getElementById('metaDocTypeView').textContent =
          formatDocumentType(metadata.document_type) || 'Not specified';
        renderTagsView(metadata.tags);
        document.getElementById('metaNotesView').textContent = metadata.notes || 'No notes';

        notify('Metadata saved successfully', 'success');
        if (window.LanaActivityEvents && typeof window.LanaActivityEvents.documentMetadataUpdated === 'function') {
          window.LanaActivityEvents.documentMetadataUpdated(state.currentFile, {
            surface: 'file_viewer',
            changed_fields: changedFields
          });
        }
        setMetadataMode('view');
      } else {
        throw new Error(response.error || 'Failed to save metadata');
      }
    } catch (error) {
      console.error('[FileViewerPage] Save metadata error:', error);
      notify('Failed to save metadata: ' + error.message, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = originalText;
    }
  }

  function cancelMetadataChanges() {
    document.getElementById('metaDocType').value = state.originalMetadata.document_type;
    document.getElementById('metaTags').value = state.originalMetadata.tags;
    document.getElementById('metaNotes').value = state.originalMetadata.notes;
    state.metadataChanged = false;
    setMetadataMode('view');
  }

  // =========================================================================
  // Ask LANA — Document Context (via lex-lana-panel)
  // =========================================================================

  function _initLanaPanel() {
    var panel = document.getElementById('fileViewerLana');
    if (!panel) return;

    // Show the current file as a badge in the composer when panel opens
    panel.addEventListener('lex-lana-opened', function () {
      var file = state.currentFile;
      if (file && file.id) {
        panel.attachFile(file.id, file.filename);
        if (window.LanaActivityEvents && typeof window.LanaActivityEvents.lanaOpenedForDocument === 'function') {
          window.LanaActivityEvents.lanaOpenedForDocument(file, { surface: 'file_viewer' });
        }
      }
    });

    // When the user resumes a saved thread from the sidebar, suppress the
    // first-message session bootstrap below. Without this, the next send
    // would POST /chat/sessions, mint a fresh thread_id, and silently
    // replace the just-loaded conversation — every "continue this chat"
    // would actually start a new one.
    panel.addEventListener('lex-lana-thread-selected', function () {
      state._lanaSessionBootstrapped = true;
    });

    // Inject file attachment on every send + conversation bootstrap on first send
    panel.addEventListener('lex-lana-before-send', function (e) {
      var file = state.currentFile;
      if (!file) return;

      var matterId = file.client_matter || file.matter_id || null;
      var opts = e.detail.opts;
      opts.attachments = opts.attachments || {};
      opts.attachments.files = [{
        file_id: file.id,
        name: file.filename,
        type: file.content_type || file.mime_type || ''
      }];
      if (state.editorFocusedContext && !opts.attachments.module_context) {
        opts.attachments.module_context = state.editorFocusedContext;
      }
      // Ensure matter context reaches the SSE request
      if (matterId) {
        opts.matterId = matterId;
      }

      if (window.LanaActivityEvents && typeof window.LanaActivityEvents.lanaMessageSentForDocument === 'function') {
        window.LanaActivityEvents.lanaMessageSentForDocument(file, {
          surface: 'file_viewer',
          message_length: String(e.detail.content || '').length
        });
      }

      // First message: create canonical conversation + register document before send.
      // Skip bootstrap if a conversation is already active on the panel —
      // covers the case where the user resumed a saved thread before the
      // bootstrap flag was flipped (defensive backstop to the
      // lex-lana-thread-selected listener above).
      var hasActiveConversation = panel._chatEl
        && panel._chatEl._props
        && panel._chatEl._props.conversationId;
      if (!state._lanaSessionBootstrapped && !hasActiveConversation) {
        e.preventDefault(); // take over send manually
        state._lanaSessionBootstrapped = true;
        var content = e.detail.content;

        var createConversation = api.createConversationRegistryEntry || api.createConversation;
        var payload = {
          title: file.filename,
          thread_type: 'page_general',
          context_type: panel.contextType || 'document_chat',
          page_scope: panel.pageScope || 'workspace'
        };
        if (matterId) payload.matter_id = matterId;

        var createPromise = typeof createConversation === 'function'
          ? createConversation.call(api, payload)
          : Promise.reject(new Error('canonical conversation create API not available'));

        createPromise.then(function (resp) {
          var threadId = getConversationIdFromCreateResponse(resp);

          if (!threadId) {
            throw new Error('No conversation ID returned from API');
          }

          return panel.openConversation(threadId, matterId, {
            title: file.filename || 'Document Context'
          }).then(function () {
            var docPromise = panel.addDocument(file.id, file.filename, matterId)
              .catch(function (err) {
                console.warn('[FileViewerPage] addDocument failed (non-fatal):', err);
              });

            return docPromise.then(function () {
              panel.sendMessage(content, opts);
            });
          });
        }).catch(function (err) {
          console.error('[FileViewerPage] Conversation bootstrap failed:', err);
          state._lanaSessionBootstrapped = false;
          panel.sendMessage(content, opts);
        });
      }
    });
  }

  // =========================================================================
  // DOCX Template — uses shared DocxTemplateModal module
  // =========================================================================

  var _docxModal = null;

  function _initDocxTemplateModal() {
    if (typeof DocxTemplateModal === 'undefined') return;
    _docxModal = new DocxTemplateModal({
      prefix: 'fvDocx',
      getContacts: function () {
        var file = state.currentFile;
        var matterId = file && (file.client_matter || file.matter_id);
        if (!matterId) return [];
        return api.get('/api/v1/matter-participants?matter_id=' + matterId).then(function (res) {
          if (res && res.data) return res.data;
          if (Array.isArray(res)) return res;
          return [];
        });
      },
      onGenerated: function () { /* no-op for file viewer */ },
      onError: function (msg) { notify(msg, 'error'); },
      onSuccess: function (msg) { notify(msg, 'success'); }
    });
  }

  function _updateTemplateButtons() {
    var file = state.currentFile;
    if (!file) return;

    var ct = (file.content_type || '').toLowerCase();
    var fn = (file.filename || '').toLowerCase();
    var isDocx = ct.indexOf('wordprocessingml') !== -1 ||
                 ct.indexOf('openxmlformats-officedocument') !== -1 ||
                 fn.endsWith('.docx');
    var isPdf = ct === 'application/pdf' || fn.endsWith('.pdf');
    var isTemplateable = isDocx || isPdf;

    var templateBtn = document.getElementById('viewerTemplateBtn');
    var generateBtn = document.getElementById('viewerGenerateBtn');
    if (!isTemplateable) {
      if (templateBtn) templateBtn.classList.add('hidden');
      if (generateBtn) generateBtn.classList.add('hidden');
      return;
    }

    if (file.is_template) {
      if (templateBtn) {
        templateBtn.classList.remove('hidden');
        document.getElementById('viewerTemplateBtnLabel').textContent = 'Unmark Template';
      }
      if (generateBtn) generateBtn.classList.remove('hidden');
    } else {
      if (templateBtn) {
        templateBtn.classList.remove('hidden');
        document.getElementById('viewerTemplateBtnLabel').textContent = 'Use as Template';
      }
      if (generateBtn) generateBtn.classList.add('hidden');
    }
  }

  async function _toggleTemplate() {
    var file = state.currentFile;
    if (!file) return;

    var matterId = file.client_matter || file.matter_id;
    if (!matterId) {
      notify('This file is not associated with a matter', 'error');
      return;
    }

    try {
      var nextTemplateState = !file.is_template;
      await DocxTemplateModal.toggleTemplate(file.id, matterId, !file.is_template, {
        onSuccess: function (msg) {
          state.currentFile.is_template = nextTemplateState;
          _updateTemplateButtons();
          notify(msg, 'success');
          if (window.LanaActivityEvents && typeof window.LanaActivityEvents.documentTemplateToggled === 'function') {
            window.LanaActivityEvents.documentTemplateToggled(state.currentFile, {
              surface: 'file_viewer',
              is_template: nextTemplateState
            });
          }
        },
        onError: function (msg) { notify(msg, 'error'); }
      });
    } catch (_) { /* handled by callbacks */ }
  }

  function _openGenerateModal() {
    var file = state.currentFile;
    if (!file || !_docxModal) return;

    var matterId = file.client_matter || file.matter_id;
    if (!matterId) {
      notify('This file is not associated with a matter', 'error');
      return;
    }

    _docxModal.open(file.id, matterId, file.filename);
  }

  function viewFvDocxTemplate() {
    if (_docxModal) _docxModal.viewTemplate();
  }
  window.viewFvDocxTemplate = viewFvDocxTemplate;

  // =========================================================================
  // Initialization
  // =========================================================================

  document.addEventListener('DOMContentLoaded', function () {
    // Read file ID from URL params
    var params = Lex.Nav.getParams();
    state.fileId = params.get('id');

    // Read referrer context
    var ctx = Lex.Nav.consume();
    if (ctx && ctx.referrer) {
      state.referrerPage = ctx.referrer;
    }

    // Validate file ID
    if (!state.fileId) {
      showError('No file specified');
      if (typeof Lex !== 'undefined' && Lex.Loader && typeof Lex.Loader.hide === 'function') {
        Lex.Loader.hide();
      }
      return;
    }

    // Wire up event listeners
    document.getElementById('viewerErrorBack').addEventListener('click', navigateBack);
    document.getElementById('viewerErrorDownload').addEventListener('click', function () {
      if (state.currentFile) {
        downloadFile(state.currentFile.id, state.currentFile.filename);
      }
    });
    // Banner action buttons live inside <lex-banner>, which re-renders
    // (and re-clones its children) whenever heading/subtitle change. Use
    // event delegation on the banner so click handlers survive re-renders.
    var bannerEl = document.getElementById('viewerBanner');
    if (bannerEl) {
      bannerEl.addEventListener('click', function (event) {
        var target = findBannerActionTarget(event);
        if (!target) return;
        var action = target.dataset && target.dataset.viewerAction;
        switch (action || target.id) {
          case 'viewerReviewModeBadge':
            setEditorInteractionMode(state.editorMode === 'review' ? 'view' : 'review');
            break;
          case 'viewerFileInfoBtn':
            openFileInfoDrawer();
            break;
          case 'openDocStudioBtn':
            openCurrentFileInDocStudio();
            break;
          case 'viewerDownloadBtn':
            if (state.currentFile) {
              downloadFile(state.currentFile.id, state.currentFile.filename);
            }
            break;
          case 'viewerTemplateBtn':
            _toggleTemplate();
            break;
          case 'viewerGenerateBtn':
            _openGenerateModal();
            break;
          case 'viewerDeleteBtn':
            deleteFile();
            break;
        }
      });
    }

    var errorDeleteBtn = document.getElementById('viewerErrorDelete');
    if (errorDeleteBtn) errorDeleteBtn.addEventListener('click', deleteFile);
    var reviewRailInfoBtn = document.getElementById('reviewRailInfoBtn');
    if (reviewRailInfoBtn) reviewRailInfoBtn.addEventListener('click', openFileInfoDrawer);
    var reviewTabs = document.getElementById('reviewTabs');
    if (reviewTabs) {
      reviewTabs.addEventListener('lex-change', function (event) {
        setReviewTab(event.detail && event.detail.value);
      });
    }
    var reviewRail = document.getElementById('reviewRail');
    if (reviewRail) {
      reviewRail.addEventListener('lex-change', function (event) {
        var historyFilter = event.target && event.target.closest ? event.target.closest('[data-review-history-filter]') : null;
        if (!historyFilter) return;
        var filterName = historyFilter.getAttribute('data-review-history-filter');
        state.releaseHistoryFilters[filterName] = (event.detail && event.detail.value) || historyFilter.value || 'all';
        updateReviewRailCounts(state.reviewState || {});
      });
      reviewRail.addEventListener('change', function (event) {
        var historyFilter = event.target && event.target.closest ? event.target.closest('[data-review-history-filter]') : null;
        if (!historyFilter) return;
        state.releaseHistoryFilters[historyFilter.getAttribute('data-review-history-filter')] = historyFilter.value || 'all';
        updateReviewRailCounts(state.reviewState || {});
      });
      reviewRail.addEventListener('click', function (event) {
        var saveButton = event.target && event.target.closest ? event.target.closest('#reviewSaveDraftBtn') : null;
        if (saveButton) {
          saveReviewBatch().catch(function (error) {
            console.error('[FileViewerPage] Save review draft failed:', error);
            notify((error && error.message) || 'Failed to save review draft', 'error');
          });
          return;
        }
        var releaseButton = event.target && event.target.closest ? event.target.closest('#reviewReleaseBtn') : null;
        if (releaseButton) {
          releaseReviewVersion();
          return;
        }
        var releaseItem = event.target && event.target.closest ? event.target.closest('[data-review-release-compare-index]') : null;
        if (releaseItem) {
          selectReleaseForComparison(parseInt(releaseItem.getAttribute('data-review-release-compare-index') || '0', 10));
          return;
        }
        var item = event.target && event.target.closest ? event.target.closest('[data-review-item-index]') : null;
        if (!item) return;
        focusReviewItem(
          item.getAttribute('data-review-item-type'),
          parseInt(item.getAttribute('data-review-item-index') || '0', 10)
        );
      });
    }
    var metaDeleteBtn = document.getElementById('metaDeleteBtn');
    if (metaDeleteBtn) metaDeleteBtn.addEventListener('click', deleteFile);

    // Template modal init (handlers attached via delegation above)
    _initDocxTemplateModal();

    _initLanaPanel();

    // Metadata controls
    var modeToggle = document.getElementById('metaModeToggle');
    if (modeToggle) {
      modeToggle.addEventListener('lex-change', function (e) {
        setMetadataMode(e.detail.value);
      });
    }
    document.getElementById('metaSaveBtn').addEventListener('click', saveMetadata);
    document.getElementById('metaCancelBtn').addEventListener('click', cancelMetadataChanges);

    // Keyboard: Escape to go back
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        // If Ask LANA panel drawer is open, let it handle Escape
        var lanaPanel = document.getElementById('fileViewerLana');
        if (lanaPanel && lanaPanel.open) return;
        var fileInfoDrawer = document.getElementById('fileInfoDrawer');
        if (fileInfoDrawer && fileInfoDrawer.open) return;
        navigateBack();
      }
    });

    setCanvasModeDisplay(false);
    setReviewTab('changes');

    // Load the file
    loadFile(state.fileId);
  });

})();
