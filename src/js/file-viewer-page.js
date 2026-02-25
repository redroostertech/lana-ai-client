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
    askLanaDrawer: null,
    askLanaChatEl: null,
    askLanaThreadsEl: null
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

    // Hide Ask LANA and Download buttons when file fails
    var askBtn = document.getElementById('askLanaBtn');
    var dlBtn = document.getElementById('viewerDownloadBtn');
    if (askBtn) askBtn.style.display = 'none';
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
      state.originalMetadata = {
        document_type: (response.metadata && response.metadata.document_type) || '',
        tags: (response.metadata && response.metadata.tags) || '',
        notes: (response.metadata && response.metadata.notes) || ''
      };
      state.metadataChanged = false;

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
    var response = await fetch(api.baseUrl + '/api/v1/storage/files/' + file.id + '/download', {
      headers: { 'Authorization': 'Bearer ' + api.token }
    });
    if (!response.ok) throw new Error('Failed to fetch PDF');
    var blob = await response.blob();
    var objectUrl = URL.createObjectURL(blob);
    var iframe = document.getElementById('viewerIframe');
    iframe.src = objectUrl;
    iframe.classList.remove('hidden');
    hideLoading();
  }

  async function loadImage(file) {
    var response = await fetch(api.baseUrl + '/api/v1/storage/files/' + file.id + '/download', {
      headers: { 'Authorization': 'Bearer ' + api.token }
    });
    if (!response.ok) throw new Error('Failed to fetch image');
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
    var response = await fetch(api.baseUrl + '/api/v1/storage/files/' + file.id + '/download', {
      headers: { 'Authorization': 'Bearer ' + api.token }
    });
    if (!response.ok) throw new Error('Failed to fetch file');
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
    var response = await fetch(api.baseUrl + '/api/v1/storage/files/' + file.id + '/download', {
      headers: { 'Authorization': 'Bearer ' + api.token }
    });
    if (!response.ok) throw new Error('Failed to fetch file');
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
      var response = await fetch(api.baseUrl + '/api/v1/storage/files/' + fileId + '/download', {
        headers: { 'Authorization': 'Bearer ' + api.token }
      });
      if (!response.ok) throw new Error('Failed to download: ' + response.status);
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
    if (summarySection && summaryView) {
      if (file.summary) {
        summaryView.textContent = file.summary;
        if (summaryTs && file.summary_generated_at) {
          summaryTs.textContent = 'Generated ' + new Date(file.summary_generated_at).toLocaleDateString();
        } else if (summaryTs) {
          summaryTs.textContent = '';
        }
        summarySection.classList.remove('hidden');
      } else {
        summarySection.classList.add('hidden');
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
  // Ask LANA — Document Chat Drawer
  // =========================================================================

  function openAskLana() {
    if (state.askLanaDrawer) {
      state.askLanaDrawer.setAttribute('open', 'true');
      return;
    }

    var file = state.currentFile;
    if (!file) return;

    // Create drawer
    var drawer = document.createElement('lex-drawer');
    drawer.setAttribute('heading', 'LANA — Document Chat');
    drawer.setAttribute('side', 'right');
    drawer.setAttribute('width', 'lg');
    drawer.setAttribute('open', 'true');
    state.askLanaDrawer = drawer;

    // Build wrapper: threads list + chat
    var wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;flex-direction:column;height:100%;';

    var threadsEl = document.createElement('lex-chat-threads');
    threadsEl.setAttribute('page-scope', 'workspace');
    threadsEl.setAttribute('context-type', 'document_chat');
    threadsEl.style.flexShrink = '0';

    var chatEl = document.createElement('lex-chat');
    chatEl.setAttribute('context-type', 'document_chat');
    chatEl.setAttribute('source', 'sse');
    chatEl.setAttribute('placeholder', 'Ask a question about this document...');
    chatEl.style.flex = '1';
    chatEl.style.minHeight = '0';

    wrapper.appendChild(threadsEl);
    wrapper.appendChild(chatEl);
    drawer.appendChild(wrapper);
    document.body.appendChild(drawer);

    // Re-acquire live references after drawer clones children
    state.askLanaChatEl = drawer.querySelector('lex-chat');
    state.askLanaThreadsEl = drawer.querySelector('lex-chat-threads');

    // Wire thread selection
    drawer.addEventListener('lex-thread-select', function (e) {
      var thread = e.detail && e.detail.thread;
      if (!thread || !state.askLanaChatEl) return;
      state.askLanaChatEl.loadConversation(thread.conversation_id);
    });

    // Wire new conversation
    drawer.addEventListener('lex-chat-new', function () {
      if (!state.askLanaChatEl) return;
      state.askLanaChatEl.clearConversation();
      if (state.askLanaThreadsEl) state.askLanaThreadsEl.setActiveThread(null);
    });

    // Register thread when conversation is created
    drawer.addEventListener('lex-chat-conversation-created', function (e) {
      var conversationId = e.detail && e.detail.conversationId;
      if (!conversationId || typeof api === 'undefined') return;

      var threadsComp = state.askLanaThreadsEl;
      if (threadsComp && threadsComp._threads) {
        for (var i = 0; i < threadsComp._threads.length; i++) {
          if (threadsComp._threads[i].conversation_id === conversationId) return;
        }
      }

      api.post('/api/v1/conversation-threads', {
        thread_type: 'page_general',
        page_scope: 'workspace',
        context_type: 'document_chat',
        thread_id: conversationId,
        title: file.filename,
        metadata: {
          document_id: file.id,
          document_name: file.filename,
          matter_id: file.client_matter || file.matter_id || null
        }
      }).then(function (resp) {
        var created = resp.data || resp;
        if (threadsComp && typeof threadsComp.addThread === 'function') {
          threadsComp.addThread(created);
        } else if (threadsComp && typeof threadsComp.refresh === 'function') {
          threadsComp.refresh();
        }
      }).catch(function (err) {
        console.error('[FileViewerPage] Failed to register thread:', err);
      });
    });

    // Wrap send() to:
    //   1. On first message: create chat_session with proper context, then addDocument
    //   2. On every message: inject attachments.files with the current document
    var _fileAttachment = {
      file_id: file.id,
      name: file.filename,
      type: file.content_type || file.mime_type || ''
    };
    var _sessionBootstrapped = false;

    setTimeout(function () {
      if (!state.askLanaChatEl) return;

      var originalSend = state.askLanaChatEl.send.bind(state.askLanaChatEl);
      state.askLanaChatEl.send = function (content, opts) {
        opts = opts || {};
        opts.attachments = opts.attachments || {};
        opts.attachments.files = [_fileAttachment];

        // First message: bootstrap session + document before sending
        if (!_sessionBootstrapped) {
          _sessionBootstrapped = true;
          var matterId = file.client_matter || file.matter_id || null;

          return api.post('/api/v1/chat/sessions', {
            title: file.filename,
            matter_id: matterId || undefined
          }).then(function (resp) {
            var session = resp.session || resp.data || resp;
            var threadId = session.thread_id || session.id;

            // Add to sidebar conversation menu so it appears immediately
            if (window.ConversationMenu && typeof window.ConversationMenu.addConversation === 'function') {
              window.ConversationMenu.addConversation({
                thread_id: threadId,
                title: file.filename || 'Document Chat',
                matter_id: matterId,
                updated_at: new Date().toISOString()
              });
            }

            // Bind chat to the pre-created session
            state.askLanaChatEl._props.conversationId = threadId;
            if (state.askLanaChatEl._source) {
              state.askLanaChatEl._source._conversationId = threadId;
            }

            // Register document in chat state (server-side activeDocumentIds)
            var docPromise = Promise.resolve();
            if (typeof state.askLanaChatEl.addDocument === 'function') {
              docPromise = state.askLanaChatEl.addDocument(
                file.id, file.filename, matterId
              ).catch(function (err) {
                console.warn('[FileViewerPage] addDocument failed (non-fatal):', err);
              });
            }

            return docPromise.then(function () {
              return originalSend(content, opts);
            });
          }).catch(function (err) {
            console.error('[FileViewerPage] Failed to create session, sending without:', err);
            _sessionBootstrapped = false; // retry next time
            return originalSend(content, opts);
          });
        }

        return originalSend(content, opts);
      };

      var composer = state.askLanaChatEl.querySelector('lex-chat-composer');
      if (!composer) return;

      // Hide plus button (no doc management in this context)
      var plusBtn = composer.querySelector('[data-plus]');
      if (plusBtn && plusBtn.parentElement) {
        plusBtn.parentElement.style.display = 'none';
      }

      // Pre-select document_chat tool and lock the tools button
      composer.setActiveTools(['document_chat']);
      composer.setToolsLocked(true);
    }, 150);

    // Clean up on close
    drawer.addEventListener('lex-drawer-close', function () {
      // Keep drawer in DOM for reuse — just mark as closed
    });
  }

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
    document.getElementById('askLanaBtn').addEventListener('click', openAskLana);

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
        // If Ask LANA drawer is open, let it handle Escape
        if (state.askLanaDrawer && state.askLanaDrawer.getAttribute('open') === 'true') return;
        navigateBack();
      }
    });

    // Load the file
    loadFile(state.fileId);
  });

})();
