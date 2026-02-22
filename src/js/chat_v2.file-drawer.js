/* ==========================================================================
   Chat V2 — File Drawer Module
   Uses Lex.Drawer.open() to manage document activation/deactivation
   in chat sessions.

   No regex. No classes.
   ========================================================================== */

(function () {
  'use strict';

  var _sessionId = null;
  var _matterId = null;
  var _drawerEl = null;
  var _documents = { active: [], available: [] };

  // =========================================================================
  // Public API
  // =========================================================================

  var ChatFileDrawer = {

    /**
     * Open the file drawer for a given session.
     */
    open: function (sessionId, matterId) {
      if (!sessionId) return;

      _sessionId = sessionId;
      _matterId = matterId;

      // Close existing drawer if open
      if (_drawerEl) {
        try { _drawerEl.remove(); } catch (e) { /* ignore */ }
        _drawerEl = null;
      }

      _drawerEl = window.Lex.Drawer.open({
        heading: 'Documents',
        subtitle: 'Manage files in this conversation',
        side: 'right',
        width: 'md',
        content: buildLoadingContent(),
        onClose: function () {
          _drawerEl = null;
        }
      });

      // Single delegated click handler for all drawer actions
      _drawerEl.addEventListener('click', handleDrawerClick);

      loadDocuments();
    },

    /**
     * Close the drawer.
     */
    close: function () {
      if (_drawerEl) {
        try { _drawerEl.remove(); } catch (e) { /* ignore */ }
        _drawerEl = null;
      }
    },

    /**
     * Get the list of documents as lex-mention-input items.
     * Returns [{id, label}, ...] for all completed documents.
     */
    getMentionItems: function () {
      var all = _documents.active.concat(_documents.available);
      var items = [];
      for (var i = 0; i < all.length; i++) {
        var doc = all[i];
        if (doc.status === 'completed' || !doc.status) {
          items.push({ id: doc.id, label: doc.filename || doc.name || 'Document' });
        }
      }
      return items;
    },

    /**
     * Load documents and return them (for external use).
     */
    loadForSession: function (sessionId) {
      _sessionId = sessionId;
      return loadDocuments();
    }
  };

  // =========================================================================
  // Internals
  // =========================================================================

  function getDrawerBody() {
    if (!_drawerEl) return null;
    return _drawerEl.querySelector('.lex-drawer-body') || _drawerEl;
  }

  function loadDocuments() {
    if (!_sessionId || !window.api) {
      return Promise.resolve();
    }

    var params = 'page=1&limit=100&sort_by=activation&order=desc';
    return window.api.get('/api/v1/chat/sessions/' + _sessionId + '/files?' + params)
      .then(function (data) {
        parseResponse(data);
        if (_drawerEl) renderDrawerContent();
      })
      .catch(function (err) {
        console.error('[ChatFileDrawer] Failed to load documents:', err);
        if (_drawerEl) renderErrorContent();
      });
  }

  function parseResponse(data) {
    if (data.files && Array.isArray(data.files)) {
      // New API format: single files array
      _documents.active = [];
      _documents.available = data.files;
    } else {
      // Legacy format: separate active/available
      _documents.active = (data.documents && data.documents.active) || data.active || [];
      _documents.available = (data.documents && data.documents.available) || data.available || [];
    }
  }

  // =========================================================================
  // Delegated click handler — single handler for all drawer actions
  // =========================================================================

  function handleDrawerClick(e) {
    var target = e.target;

    // Check for toggle action buttons (Add/Remove)
    var actionBtn = target.closest('[data-action]');
    if (actionBtn) {
      var docId = actionBtn.getAttribute('data-doc-id');
      var action = actionBtn.getAttribute('data-action');
      if (docId && action) {
        toggleDocument(docId, action === 'activate');
      }
      return;
    }

    // Check for upload button
    if (target.closest('#cv2-drawer-upload-btn')) {
      handleUpload();
      return;
    }

    // Check for retry button
    if (target.closest('[data-action-retry]')) {
      window.ChatFileDrawer.open(_sessionId, _matterId);
      return;
    }
  }

  // =========================================================================
  // Drawer rendering
  // =========================================================================

  function buildLoadingContent() {
    return '<div style="padding: 24px; text-align: center;">' +
      '<lex-spinner size="md"></lex-spinner>' +
      '<p style="margin-top: 12px; color: var(--lex-text-tertiary); font-size: var(--lex-body-sm-size);">Loading documents...</p>' +
      '</div>';
  }

  function renderErrorContent() {
    var body = getDrawerBody();
    if (!body) return;
    body.innerHTML =
      '<div style="padding: 24px; text-align: center;">' +
      '<p style="color: var(--lex-text-tertiary); font-size: var(--lex-body-sm-size);">Failed to load documents.</p>' +
      '<lex-btn variant="ghost" size="sm" data-action-retry="true">Retry</lex-btn>' +
      '</div>';
  }

  function renderDrawerContent() {
    var body = getDrawerBody();
    if (!body) return;

    var activeCount = _documents.active.length;
    var availableCount = _documents.available.length;
    var totalCount = activeCount + availableCount;

    var html = '';

    // Stats bar
    html += '<div style="padding: 0 20px 12px; display: flex; align-items: center; justify-content: space-between;">';
    html += '<span style="font-size: var(--lex-body-xs-size); color: var(--lex-text-tertiary);">' +
      totalCount + ' document' + (totalCount !== 1 ? 's' : '') + '</span>';
    if (_matterId) {
      html += '<lex-btn variant="ghost" size="sm" id="cv2-drawer-upload-btn">Upload</lex-btn>';
    }
    html += '</div>';

    // Active section
    if (activeCount > 0) {
      html += buildSection('Active', _documents.active, true);
    }

    // Available section
    if (availableCount > 0) {
      html += buildSection('Available', _documents.available, false);
    }

    // Empty state
    if (totalCount === 0) {
      html += '<div style="padding: 40px 24px; text-align: center;">';
      html += '<p style="color: var(--lex-text-tertiary); font-size: var(--lex-body-sm-size);">No documents in this conversation.</p>';
      if (_matterId) {
        html += '<p style="color: var(--lex-text-tertiary); font-size: var(--lex-body-xs-size); margin-top: 8px;">Upload documents to the matter to use them here.</p>';
      }
      html += '</div>';
    }

    body.innerHTML = html;
  }

  function buildSection(title, docs, isActive) {
    var html = '';
    html += '<div style="padding: 0 20px;">';
    html += '<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">';
    html += '<span style="font-size: var(--lex-body-xs-size); font-weight: var(--lex-weight-medium, 500); color: var(--lex-text-secondary); text-transform: uppercase; letter-spacing: 0.05em;">' + title + '</span>';
    html += '<span style="font-size: var(--lex-body-xs-size); color: var(--lex-text-tertiary);">(' + docs.length + ')</span>';
    html += '</div>';

    for (var i = 0; i < docs.length; i++) {
      html += buildDocItem(docs[i], isActive);
    }

    html += '</div>';
    html += '<div style="height: 16px;"></div>';
    return html;
  }

  function buildDocItem(doc, isActive) {
    var fileSize = formatFileSize(doc.file_size);
    var statusLabel = getStatusLabel(doc.status);
    var isCompleted = doc.status === 'completed' || !doc.status;

    var html = '';
    html += '<div class="cv2-drawer-doc" data-doc-id="' + escapeAttr(doc.id) + '" style="' +
      'display: flex; align-items: center; gap: 12px; padding: 10px 12px; ' +
      'border: 1px solid var(--lex-border-subtle); border-radius: var(--lex-radius-md); ' +
      'margin-bottom: 6px; background: var(--lex-bg-primary);">';

    // File icon
    html += '<div style="flex-shrink: 0; color: var(--lex-text-tertiary);">' + getFileIcon(doc.mime_type) + '</div>';

    // Info
    html += '<div style="flex: 1; min-width: 0;">';
    html += '<div style="font-size: var(--lex-body-sm-size); font-weight: var(--lex-weight-medium, 500); color: var(--lex-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="' + escapeAttr(doc.filename) + '">' + escapeHtml(doc.filename) + '</div>';
    html += '<div style="font-size: var(--lex-body-xs-size); color: var(--lex-text-tertiary); margin-top: 2px;">' + fileSize;
    if (statusLabel) html += ' &middot; ' + statusLabel;
    html += '</div>';
    html += '</div>';

    // Toggle button
    if (isCompleted) {
      var action = isActive ? 'deactivate' : 'activate';
      var btnLabel = isActive ? 'Remove' : 'Add';
      var btnVariant = isActive ? 'danger' : 'primary';
      html += '<lex-btn variant="' + btnVariant + '" size="sm" data-action="' + action + '" data-doc-id="' + escapeAttr(doc.id) + '">' + btnLabel + '</lex-btn>';
    }

    html += '</div>';
    return html;
  }

  // =========================================================================
  // Actions
  // =========================================================================

  function toggleDocument(docId, activate) {
    if (!_sessionId || !window.api) return;

    var endpoint = activate ? 'activate' : 'deactivate';

    window.api.post(
      '/api/v1/chat/sessions/' + _sessionId + '/drawer/' + endpoint,
      { document_id: docId }
    )
      .then(function (data) {
        if (window.Lex && window.Lex.Toast) {
          window.Lex.Toast.success(data.message || ('Document ' + endpoint + 'd'));
        }
        // Reload documents to refresh drawer and mention items
        loadDocuments();
      })
      .catch(function (err) {
        console.error('[ChatFileDrawer] Toggle failed:', err);
        if (window.Lex && window.Lex.Toast) {
          window.Lex.Toast.error('Failed to ' + endpoint + ' document');
        }
      });
  }

  function handleUpload() {
    if (!_matterId) {
      if (window.Lex && window.Lex.Toast) {
        window.Lex.Toast.warning('No matter selected for this conversation');
      }
      return;
    }

    if (window.Lex && window.Lex.Toast) {
      window.Lex.Toast.info('Opening matter documents...');
    }

    setTimeout(function () {
      if (window.Lex && window.Lex.Nav) {
        window.Lex.Nav.go('matters.html', { open: _matterId, tab: 'documents' });
      }
    }, 400);
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    var k = 1024;
    var sizes = ['B', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 10) / 10 + ' ' + sizes[i];
  }

  function getStatusLabel(status) {
    if (status === 'processing') return 'Processing';
    if (status === 'pending') return 'Pending';
    if (status === 'failed') return 'Failed';
    return '';
  }

  function getFileIcon(mimeType) {
    var color = 'currentColor';
    if (mimeType && mimeType.indexOf('pdf') !== -1) color = 'var(--lex-icon-danger, var(--lex-color-danger-500))';
    else if (mimeType && (mimeType.indexOf('spreadsheet') !== -1 || mimeType.indexOf('csv') !== -1 || mimeType.indexOf('excel') !== -1)) color = 'var(--lex-icon-success, var(--lex-color-success-500))';

    return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
      '<polyline points="14 2 14 8 20 8"/>' +
      '</svg>';
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('"').join('&quot;');
  }

  function escapeAttr(str) {
    if (!str) return '';
    return String(str).split('&').join('&amp;').split('"').join('&quot;').split("'").join('&#39;');
  }

  // =========================================================================
  // Export
  // =========================================================================

  window.ChatFileDrawer = ChatFileDrawer;

})();
