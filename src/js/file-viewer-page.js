/**
 * file-viewer-page.js — Dedicated file viewer page controller.
 *
 * Standalone page at file-viewer.html?id=<fileId>.
 * Replaces the duplicated modal-based file-viewer.js across 4 pages.
 *
 * Features:
 *   - Full-page file preview (PDF, DOCX, image, text)
 *   - Metadata sidebar (view/edit) with save
 *   - "Ask LANA" document chat drawer
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

    state.metadataSidebarVisible = !state.metadataSidebarVisible;
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
    if (askBtn) askBtn.disabled = true;
    if (dlBtn) dlBtn.style.display = 'none';
  }

  function hideAllViewers() {
    var ids = ['viewerLoading', 'viewerError', 'viewerIframe', 'viewerText', 'viewerImage', 'viewerDocx'];
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

      state.originalMetadata = {
        document_type: (response.metadata && response.metadata.document_type) || '',
        tags: (response.metadata && response.metadata.tags) || '',
        notes: (response.metadata && response.metadata.notes) || ''
      };
      state.metadataChanged = false;

      var lifecycleDisplay = window.documentLifecycle && typeof window.documentLifecycle.getDocumentLifecycleDisplay === 'function'
        ? window.documentLifecycle.getDocumentLifecycleDisplay(response)
        : null;

      // Update header
      document.getElementById('viewerFileName').textContent = response.filename;
      document.getElementById('viewerFileInfo').textContent =
        formatFileSize(response.file_size) + ' \u2022 ' + new Date(response.created_at).toLocaleDateString();

      // Update page title
      document.title = response.filename + ' - LANA AI';

      // Set download handler
      var downloadBtn = document.getElementById('viewerDownloadBtn');
      downloadBtn.onclick = function () { downloadFile(fileId, response.filename); };

      // Load content + metadata
      await loadFileContent(response);
      loadMetadata(response);

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
    if (typeof mammoth === 'undefined') {
      throw new Error('Mammoth library not loaded');
    }
    var response = await fetch(getFileDownloadUrl(file), {
      headers: getAuthHeaders()
    });
    await assertFetchOk(response, 'Failed to fetch file');
    var arrayBuffer = await response.arrayBuffer();
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

  // =========================================================================
  // Download
  // =========================================================================

  async function downloadFile(fileId, filename) {
    try {
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
    } catch (error) {
      console.error('[FileViewerPage] Download error:', error);
      notify(error.message || 'Failed to download file', 'error');
    }
  }

  // =========================================================================
  // Metadata
  // =========================================================================

  function loadMetadata(file) {
    document.getElementById('metaFileSize').textContent = formatFileSize(file.file_size);
    document.getElementById('metaUploadedAt').textContent = new Date(file.created_at).toLocaleDateString();
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
          summaryTs.textContent = 'Generated ' + new Date(file.summary_generated_at).toLocaleDateString();
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
  // Ask LANA — Document Chat (via lex-lana-panel)
  // =========================================================================

  function _initLanaPanel() {
    var panel = document.getElementById('fileViewerLana');
    if (!panel) return;

    // Show the current file as a badge in the composer when panel opens
    panel.addEventListener('lex-lana-opened', function () {
      var file = state.currentFile;
      if (file && file.id) {
        panel.attachFile(file.id, file.filename);
      }
    });

    // Inject file attachment on every send + session bootstrap on first send
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

      // First message: bootstrap session + register document before send
      if (!state._lanaSessionBootstrapped) {
        e.preventDefault(); // take over send manually
        state._lanaSessionBootstrapped = true;
        var content = e.detail.content;

        api.post('/api/v1/chat/sessions', {
          title: file.filename,
          matter_id: matterId || undefined
        }).then(function (resp) {
          var session = resp.session || resp.data || resp;
          var threadId = session.thread_id || session.id;

          // bindConversationId handles sidebar + thread registration
          panel.bindConversationId(threadId, {
            title: file.filename || 'Document Chat',
            matterId: matterId
          });

          var docPromise = panel.addDocument(file.id, file.filename, matterId)
            .catch(function (err) {
              console.warn('[FileViewerPage] addDocument failed (non-fatal):', err);
            });

          return docPromise.then(function () {
            panel.sendMessage(content, opts);
          });
        }).catch(function (err) {
          console.error('[FileViewerPage] Session bootstrap failed:', err);
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
    if (!isTemplateable) return;

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
      await DocxTemplateModal.toggleTemplate(file.id, matterId, !file.is_template, {
        onSuccess: function (msg) {
          state.currentFile.is_template = !file.is_template;
          _updateTemplateButtons();
          notify(msg, 'success');
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
    document.getElementById('backBtn').addEventListener('click', navigateBack);
    document.getElementById('viewerErrorBack').addEventListener('click', navigateBack);
    document.getElementById('viewerErrorDownload').addEventListener('click', function () {
      if (state.currentFile) {
        downloadFile(state.currentFile.id, state.currentFile.filename);
      }
    });
    document.getElementById('toggleSidebarBtn').addEventListener('click', toggleMetadataSidebar);

    // Template buttons
    _initDocxTemplateModal();
    var templateBtn = document.getElementById('viewerTemplateBtn');
    if (templateBtn) templateBtn.addEventListener('click', _toggleTemplate);
    var generateBtn = document.getElementById('viewerGenerateBtn');
    if (generateBtn) generateBtn.addEventListener('click', _openGenerateModal);

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
