/**
 * file-viewer-page.js — Dedicated file viewer page controller.
 *
 * Standalone page at file-viewer.html?id=<fileId>.
 * Replaces the duplicated modal-based file-viewer.js across 4 pages.
 *
 * Features:
 *   - Full-page file preview (PDF, DOCX, image, text)
 *   - Metadata sidebar (view/edit) with save
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
    metadataSidebarVisible: true,
    metadataMode: 'view',
    metadataChanged: false,
    originalMetadata: {},
    editorInstance: null,
    editorModulePromise: null,
    editorImportMapBase: null,
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
  // Sidebar Toggle
  // =========================================================================

  function toggleMetadataSidebar() {
    var sidebar = document.getElementById('metadataSidebar');
    if (!sidebar) return;

    var currentlyVisible = sidebar.offsetWidth > 0 && sidebar.style.width !== '0px';
    state.metadataSidebarVisible = !currentlyVisible;
    if (state.metadataSidebarVisible) {
      sidebar.style.width = '';
      sidebar.style.borderLeftWidth = '';
      sidebar.style.overflow = '';
    } else {
      sidebar.style.width = '0';
      sidebar.style.borderLeftWidth = '0';
      sidebar.style.overflow = 'hidden';
    }
  }

  function findBannerActionTarget(event) {
    var path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    for (var i = 0; i < path.length; i++) {
      var node = path[i];
      if (!node || node.nodeType !== 1) continue;
      if (node.dataset && node.dataset.viewerAction) return node;
      if (node.id && (
        node.id === 'toggleSidebarBtn' ||
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
    if (askBtn) askBtn.disabled = true;
    if (dlBtn) dlBtn.classList.add('hidden');
    if (docStudioBtn) docStudioBtn.classList.add('hidden');
  }

  function hideAllViewers() {
    var ids = ['viewerLoading', 'viewerError', 'viewerIframe', 'viewerText', 'viewerImage', 'viewerEditor', 'viewerDocx'];
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
    var blob = await response.blob();
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
    var text = await response.text();
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
      var renderedWithEditor = await loadDOCXInEditor(file, arrayBuffer);
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

  async function loadDOCXInEditor(file, arrayBuffer) {
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
        pdfWorkerUrl: baseUrl + '/pdfjs/pdf.worker.min.mjs'
      });
      state.editorInstance = editor;

      editor.on('document-loaded', function (event) {
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
        trackEditorEvent('edit_applied', file, {
          document_id: file.id,
          document_name: file.filename,
          ops: event && event.ops
        });
      });
      editor.on('change-decision', function (event) {
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

      var bytes = new Uint8Array(arrayBuffer);
      await editor.open_file(new File([bytes], file.filename || 'document.docx', {
        type: file.content_type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      }));
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

    if (toggle && toggle.value !== mode) {
      toggle.value = mode;
    }

    if (mode === 'view') {
      viewPanel.classList.remove('hidden');
      editPanel.classList.add('hidden');
      footer.classList.add('hidden');
    } else {
      viewPanel.classList.add('hidden');
      editPanel.classList.remove('hidden');
      footer.classList.remove('hidden');
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
          case 'toggle-sidebar':
          case 'toggleSidebarBtn':
            toggleMetadataSidebar();
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
        navigateBack();
      }
    });

    // Load the file
    loadFile(state.fileId);
  });

})();
