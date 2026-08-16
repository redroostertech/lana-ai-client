/**
 * matter-documents-view.js - Reusable, feature-complete matter file-list view.
 *
 * A single component that renders the rich matter "Documents" file view used by
 * both the Library folder browser and the workspace-details drawer. It OWNS all
 * rendering and every per-row action (download / rename / delete / retry /
 * replace / template toggle / Doc Studio workflow), client-side search +
 * filtering + pagination, batch select, and an orphaned-files section. Hosts
 * keep their own folder/subfolder navigation and chrome; the component renders
 * the file view into one mounted container.
 *
 * Ported faithfully from workspace-details.js renderDocumentsTab and its
 * handlers: downloadDocument, deleteDrawerDocument, retryDocumentIngestion,
 * replaceDrawerDocument, toggleDocxTemplate, openDocxTemplateModal, filterDocs,
 * toggleDocSelectAll / updateDocSelection / batchDeleteDocs, assignOrphanedFile,
 * deleteOrphanedFile, requestDocStudioLegalReview / requestDocStudioSignatures /
 * updateDocStudioLegalReviewStatus / updateDocStudioSignatureStatus,
 * docStatusBadge / getDocumentLifecycle / getDocumentStatusDisplay /
 * parseDocumentMetadata / isDocStudioGeneratedDocument / docStudioWorkflowBadges,
 * getFileIcon / formatSize / timeAgo.
 *
 * Public API (additive, backward compatible):
 *   window.MatterDocumentsView.mount(containerEl, opts) -> instance
 *   opts = {
 *     api (default window.api), matterId, matterDisplayId,
 *     files (array), orphanedFiles (array, default []),
 *     onFileOpen(fileId), onCreateDocStudio(),
 *     viewMode ('grid'|'list', default 'list'), pageSize (default 12),
 *     toast (default Lex.Toast), confirm (default Lex.Modal.confirm),
 *     enableRename (default true), enableTemplates (default false),
 *     enableOrphans (default false), enableWorkflow (default false),
 *     enableBatch (default false), enableTemplateToggle (default false),
 *     enableRetry (default false), enableReplace (default false)
 *   }
 *   instance.refresh(files, orphanedFiles)
 *   instance.setViewMode(mode)
 *   instance.destroy()
 *
 * Conventions:
 *   - All rendering and DOM queries are scoped to the mounted container.
 *   - Event delegation on the container (data-action + data-doc-id /
 *     data-orphan-key). No inline onclick handlers, no global functions, no
 *     inline styles.
 *   - All mutating actions go through the injected api; after any mutation the
 *     component calls refresh() (re-fetching via api.getMatterFiles /
 *     api.getOrphanedFiles when ids are available).
 *
 * Dependencies (loaded by the host page before this file):
 *   - lex.utils.js  (escapeHtml, formatFileSize, formatRelativeDate)
 *   - lex.icons.js  (getFileIcon)
 *   - lex-pagination.js  (lex-pagination custom element)
 *   - Lex.Toast / Lex.Modal (defaults; overridable via opts)
 *   - DocxTemplateModal (optional; used by the template generate/toggle actions)
 */
(function () {
  'use strict';

  // -- Shared helper fallbacks ---------------------------------------------

  function esc(value) {
    if (window.escapeHtml) return window.escapeHtml(value);
    return String(value == null ? '' : value)
      .split('&').join('&amp;')
      .split('<').join('&lt;')
      .split('>').join('&gt;')
      .split('"').join('&quot;')
      .split("'").join('&#39;');
  }

  function formatSize(bytes) {
    if (window.formatFileSize) return window.formatFileSize(bytes);
    if (!bytes) return '0 B';
    var k = 1024;
    var sizes = ['B', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function timeAgo(value) {
    if (window.formatRelativeDate) return window.formatRelativeDate(value);
    return value || '';
  }

  // Resolve a file icon. lex.icons exposes Lex.Icons.fileIconByMime (content
  // type, matches the monolith's getFileIcon behavior) and window.getFileIcon
  // (filename-based in this client library). Prefer the MIME variant when a
  // content type is present, otherwise fall back to the filename-based icon.
  function fileIconHtml(doc) {
    var contentType = (doc && doc.content_type) || '';
    var name = (doc && (doc.filename || doc.original_filename)) || '';
    var icons = (window.Lex && window.Lex.Icons) || null;
    if (contentType && icons && typeof icons.fileIconByMime === 'function') {
      return icons.fileIconByMime(contentType);
    }
    if (window.getFileIcon) return window.getFileIcon(name);
    return '<svg class="mdv-file-icon-svg" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>';
  }

  function artifactIconHtml(artifact) {
    var type = String((artifact && (artifact.artifact_type || artifact.type)) || '').toLowerCase();
    var title = String(
      artifact && (artifact.artifact_name || artifact.title || artifact.name || artifact.label) || 'Generated work product'
    ).toLowerCase();
    var contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    if (type.indexOf('presentation') !== -1 || type.indexOf('deck') !== -1 || title.indexOf('presentation') !== -1 || title.indexOf('deck') !== -1) {
      contentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    } else if (type.indexOf('csv') !== -1 || type.indexOf('spreadsheet') !== -1 || title.indexOf('spreadsheet') !== -1) {
      contentType = 'text/csv';
    } else if (type.indexOf('text') !== -1 || type.indexOf('transcript') !== -1) {
      contentType = 'text/plain';
    } else if (type.indexOf('pdf') !== -1 || title.indexOf('.pdf') !== -1) {
      contentType = 'application/pdf';
    }

    return fileIconHtml({
      filename: title + '.docx',
      content_type: contentType
    });
  }

  // -- Lifecycle / status helpers (ported from workspace-details) ----------

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
    var cls = display.badgeClass || 'mdv-badge--uploaded';
    return '<span class="mdv-status-badge ' + esc(cls) + '">' + esc(display.label) + '</span>';
  }

  function isDocStudioGeneratedDocument(doc) {
    var metadata = parseDocumentMetadata(doc);
    return metadata.source === 'doc_studio' ||
      doc.document_type === 'generated_legal_document' ||
      doc.document_type === 'generated_presentation';
  }

  // Doc Studio + legal-review + signature workflow badges (component-scoped).
  function docStudioWorkflowBadges(doc) {
    var metadata = parseDocumentMetadata(doc);
    var badges = '';
    if (isDocStudioGeneratedDocument(doc)) {
      badges += '<span class="mdv-wf-badge mdv-wf-badge--studio">Doc Studio</span>';
    }
    if (metadata.legal_review && metadata.legal_review.status) {
      var reviewCls = metadata.legal_review.status === 'approved'
        ? 'mdv-wf-badge--approved'
        : metadata.legal_review.status === 'changes_requested'
          ? 'mdv-wf-badge--changes'
          : 'mdv-wf-badge--review';
      badges += '<span class="mdv-wf-badge ' + reviewCls + '">Review: ' + esc(String(metadata.legal_review.status).split('_').join(' ')) + '</span>';
    }
    if (metadata.signature_workflow && metadata.signature_workflow.status) {
      var signCls = metadata.signature_workflow.status === 'completed'
        ? 'mdv-wf-badge--approved'
        : metadata.signature_workflow.status === 'cancelled'
          ? 'mdv-wf-badge--inactive'
          : 'mdv-wf-badge--sign';
      badges += '<span class="mdv-wf-badge ' + signCls + '">Sign: ' + esc(String(metadata.signature_workflow.status).split('_').join(' ')) + '</span>';
    }
    return badges;
  }

  function sourceBadge(doc) {
    if (doc.source === 'workspace') {
      return '<span class="mdv-source-badge mdv-source-badge--workspace">From Workspace</span>';
    }
    if (doc.source === 'inherited') {
      return '<span class="mdv-source-badge mdv-source-badge--shared">Shared</span>';
    }
    return '';
  }

  // -- SVG icon snippets (no emoji) ----------------------------------------

  var ICON_SEARCH = '<svg class="mdv-search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>';
  var ICON_KEBAB = '<svg class="mdv-kebab-icon" fill="currentColor" viewBox="0 0 20 20"><path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"></path></svg>';
  var ICON_DOWNLOAD = '<svg class="mdv-menu-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>';
  var ICON_OPEN = '<svg class="mdv-menu-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>';
  var ICON_DELETE = '<svg class="mdv-menu-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
  var ICON_RENAME = '<svg class="mdv-menu-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>';
  var ICON_RETRY = '<svg class="mdv-menu-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>';
  var ICON_REPLACE = '<svg class="mdv-menu-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>';
  var ICON_TEMPLATE = '<svg class="mdv-menu-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>';
  var ICON_GENERATE = '<svg class="mdv-menu-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>';
  var ICON_REVIEW = '<svg class="mdv-menu-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4M7 3h10a2 2 0 012 2v14l-4-2-4 2-4-2-4 2V5a2 2 0 012-2z"></path></svg>';
  var ICON_SIGN = '<svg class="mdv-menu-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536M4 20h4l10.5-10.5a2.5 2.5 0 00-3.536-3.536L4 16.929V20z"></path></svg>';
  var ICON_CHECK = '<svg class="mdv-menu-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>';
  var ICON_DOC_STUDIO = '<svg class="mdv-btn-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>';
  var ICON_ASSIGN = '<svg class="mdv-menu-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>';

  // -- Component factory ----------------------------------------------------

  function createInstance(containerEl, opts) {
    opts = opts || {};

    var api = opts.api || window.api;
    var matterId = opts.matterId || null;
    var matterDisplayId = opts.matterDisplayId || matterId;
    var matter = opts.matter || (matterId ? { matter_id: matterId } : null);
    var toast = opts.toast || (window.Lex && window.Lex.Toast) || null;
    var confirmFn = opts.confirm || (window.Lex && window.Lex.Modal && window.Lex.Modal.confirm) || null;
    var onFileOpen = typeof opts.onFileOpen === 'function' ? opts.onFileOpen : null;
    var onCreateDocStudio = typeof opts.onCreateDocStudio === 'function' ? opts.onCreateDocStudio : null;
    var onArtifactPromoted = typeof opts.onArtifactPromoted === 'function' ? opts.onArtifactPromoted : null;

    var enableTemplates = opts.enableTemplates === true;
    var enableOrphans = opts.enableOrphans === true;
    var enableRename = opts.enableRename !== false;
    var enableWorkflow = opts.enableWorkflow === true;
    var enableBatch = opts.enableBatch === true;
    var enableTemplateToggle = opts.enableTemplateToggle === true;
    var enableRetry = opts.enableRetry === true;
    var enableReplace = opts.enableReplace === true;
    var enableArtifacts = opts.enableArtifacts === true;
    // Host may own search via its own toolbar (e.g. the Library folder view),
    // in which case the component's built-in search bar is suppressed to avoid
    // a duplicate control. Defaults on for standalone use (workspace-details).
    var enableSearch = opts.enableSearch !== false;
    var showEmptyState = opts.showEmptyState !== false;
    // Whether the component renders its own "Create using Doc Studio" button.
    // Hosts that already provide their own Doc Studio entry point (e.g. the
    // workspace-details Matter documents header) pass false to avoid a
    // duplicate. Defaults on so standalone hosts (the Library folder) keep it.
    var enableDocStudio = opts.enableDocStudio !== false;
    var pageSize = opts.pageSize || 12;

    // Instance-local state.
    var state = {
      files: Array.isArray(opts.files) ? opts.files.slice() : [],
      artifacts: Array.isArray(opts.artifacts) ? opts.artifacts.slice() : [],
      orphans: Array.isArray(opts.orphanedFiles) ? opts.orphanedFiles.slice() : [],
      search: '',
      page: 1,
      filter: 'all',
      openMenuId: null,
      selected: {},
      artifactLoadError: null,
      viewMode: opts.viewMode === 'grid' ? 'grid' : 'list'
    };

    var searchTimeout = null;
    var clickHandler = null;
    var inputHandler = null;
    var changeHandler = null;
    var pageChangeHandler = null;
    var documentClickHandler = null;
    var viewportChangeHandler = null;
    var artifactController = null;
    var destroyed = false;

    function toastError(message) {
      if (toast && toast.error) toast.error(message);
    }

    function toastSuccess(message) {
      if (toast && toast.success) toast.success(message);
    }

    function toastInfo(message) {
      if (toast && toast.info) toast.info(message);
    }

    // Invoke the injected confirm dialog. The default (this client library's
    // Lex.Modal.confirm) takes (title, message, onConfirm, options) where
    // options = { confirmText, variant }. We pass that options object. Falls
    // back to window.confirm when no confirm function is available.
    function doConfirm(title, message, onConfirm, confirmText, variant) {
      if (confirmFn) {
        confirmFn(title, message, onConfirm, { confirmText: confirmText, variant: variant });
      } else if (window.confirm(message)) {
        onConfirm();
      }
    }

    function fileName(file) {
      return file.original_filename || file.filename || '';
    }

    function findFile(fileId) {
      for (var i = 0; i < state.files.length; i++) {
        if (String(state.files[i].id) === String(fileId)) return state.files[i];
      }
      return null;
    }

    function artifactHelpers() {
      return window.WorkspaceArtifactsView || {};
    }

    function artifactId(artifact) {
      var helper = artifactHelpers();
      if (helper.getArtifactId) return helper.getArtifactId(artifact);
      return artifact && (artifact.artifact_id || artifact.id || '');
    }

    function artifactTitle(artifact) {
      var helper = artifactHelpers();
      if (helper.getArtifactTitle) return helper.getArtifactTitle(artifact);
      return artifact && (artifact.artifact_name || artifact.title || artifact.name || artifact.label) || 'Generated work product';
    }

    function artifactPersistence(artifact) {
      var helper = artifactHelpers();
      if (helper.getArtifactPersistence) return helper.getArtifactPersistence(artifact);
      return { status: 'unknown', tone: 'neutral', message: 'Status unavailable' };
    }

    function artifactPromotionAction(artifact) {
      var helper = artifactHelpers();
      if (helper.getArtifactPromotionAction) return helper.getArtifactPromotionAction(artifact);
      return null;
    }

    function artifactDocument(artifact) {
      var helper = artifactHelpers();
      if (helper.getArtifactDocument) return helper.getArtifactDocument(artifact);
      return artifact && (artifact.document || artifact.canonical_document || null);
    }

    function findArtifact(id) {
      for (var i = 0; i < state.artifacts.length; i++) {
        if (String(artifactId(state.artifacts[i])) === String(id)) return state.artifacts[i];
      }
      return null;
    }

    function fileSelectKey(fileId) {
      return 'file:' + String(fileId);
    }

    function artifactSelectKey(id) {
      return 'artifact:' + String(id);
    }

    function findOrphan(storageKey) {
      for (var i = 0; i < state.orphans.length; i++) {
        if (String(state.orphans[i].storage_key) === String(storageKey)) return state.orphans[i];
      }
      return null;
    }

    // -- Filtering / pagination computation ---------------------------------

    function applyFilters() {
      var items = [];
      var files = state.files.slice();

      if (enableTemplates && state.filter === 'template') {
        files = files.filter(function (f) { return !!f.is_template; });
      } else if (enableTemplates && state.filter === 'document') {
        files = files.filter(function (f) { return !f.is_template; });
      } else if (enableArtifacts && state.filter === 'artifact') {
        files = [];
      }

      for (var i = 0; i < files.length; i++) {
        items.push({ kind: 'file', file: files[i] });
      }

      if (enableArtifacts && state.filter !== 'template' && state.filter !== 'document') {
        for (var a = 0; a < state.artifacts.length; a++) {
          items.push({ kind: 'artifact', artifact: state.artifacts[a] });
        }
      }

      if (state.search) {
        var needle = state.search.toLowerCase();
        items = items.filter(function (item) {
          if (item.kind === 'artifact') {
            return artifactTitle(item.artifact).toLowerCase().indexOf(needle) !== -1;
          }
          return fileName(item.file).toLowerCase().indexOf(needle) !== -1;
        });
      }

      return items;
    }

    function isDocxOrPdf(doc) {
      var ct = doc.content_type || '';
      var fn = (doc.filename || '').toLowerCase();
      var ofn = (doc.original_filename || '').toLowerCase();
      var isDocx = ct.indexOf('wordprocessingml') !== -1 || fn.indexOf('.docx') !== -1 || ofn.indexOf('.docx') !== -1;
      var isPdf = ct === 'application/pdf' || fn.indexOf('.pdf') !== -1 || ofn.indexOf('.pdf') !== -1;
      return isDocx || isPdf;
    }

    // -- Per-file action menu -----------------------------------------------

    function fileMenu(file) {
      var open = String(state.openMenuId) === String(file.id);
      var lifecycle = getDocumentLifecycle(file);
      var isReady = lifecycle === 'ready' || lifecycle === 'summarized';
      var needsAttention = lifecycle === 'needs_attention';
      var isGenerated = isDocStudioGeneratedDocument(file);
      var metadata = parseDocumentMetadata(file);
      var readOnly = !!file.read_only;
      var items = '';

      function item(action, icon, label, extraAttrs, danger) {
        return '<button type="button" class="mdv-menu-item' + (danger ? ' mdv-menu-item--danger' : '') + '" data-action="' + action + '" data-doc-id="' + esc(file.id) + '"' + (extraAttrs || '') + '>' +
          icon + '<span>' + esc(label) + '</span></button>';
      }

      if (onFileOpen && (isReady || isGenerated)) {
        items += item('open', ICON_OPEN, 'Open');
      }
      items += item('download', ICON_DOWNLOAD, 'Download');

      // Doc Studio workflow actions.
      if (enableWorkflow && isGenerated) {
        var hasReviewRequest = metadata.legal_review && metadata.legal_review.status && metadata.legal_review.status !== 'not_requested';
        var hasSignatureRequest = metadata.signature_workflow && metadata.signature_workflow.status && metadata.signature_workflow.status !== 'not_requested';
        items += item('request-review', ICON_REVIEW, hasReviewRequest ? 'Re-request Review' : 'Request Review');
        items += item('request-signatures', ICON_SIGN, hasSignatureRequest ? 'Re-request Signatures' : 'Request Signatures');
        if (hasReviewRequest && metadata.legal_review.status !== 'approved') {
          items += item('mark-approved', ICON_CHECK, 'Mark Approved');
        }
        if (hasSignatureRequest && metadata.signature_workflow.status !== 'completed') {
          items += item('mark-signed', ICON_CHECK, 'Mark Signed');
        }
      }

      // Retry ingestion (failed documents).
      if (enableRetry && needsAttention) {
        items += item('retry', ICON_RETRY, 'Retry Ingestion');
      }

      // Template generate / mark / unmark.
      if (enableTemplateToggle && isDocxOrPdf(file) && !readOnly && isReady) {
        if (file.is_template) {
          items += item('template-generate', ICON_GENERATE, 'Generate');
          items += item('template-unmark', ICON_TEMPLATE, 'Unmark Template');
        } else {
          items += item('template-mark', ICON_TEMPLATE, 'Use as Template');
        }
      }

      if (enableRename && !readOnly) {
        items += item('rename', ICON_RENAME, 'Rename');
      }
      if (enableReplace && !readOnly) {
        items += item('replace', ICON_REPLACE, 'Replace');
      }

      if (!readOnly) {
        items += '<div class="mdv-menu-divider"></div>';
        items += item('delete', ICON_DELETE, 'Delete', '', true);
      }

      return '<div class="mdv-menu' + (open ? ' mdv-menu--open' : '') + '" data-menu-for="' + esc(file.id) + '">' + items + '</div>';
    }

    function artifactMenu(artifact) {
      var id = artifactId(artifact);
      var menuId = 'artifact:' + id;
      var open = String(state.openMenuId) === String(menuId);
      var savedDocument = artifactDocument(artifact);
      var canPromote = !!artifactPromotionAction(artifact);
      var items = '';

      function item(action, icon, label, attrs) {
        return '<button type="button" class="mdv-menu-item" data-action="' + action + '" data-artifact-id="' + esc(id) + '"' + (attrs || '') + '>' +
          icon + '<span>' + esc(label) + '</span></button>';
      }

      items += item('artifact-view', ICON_OPEN, 'View');
      if (canPromote) {
        items += item('artifact-promote', ICON_DOWNLOAD, 'Save to Documents');
      }
      if (savedDocument && savedDocument.id) {
        items += item('artifact-open-document', ICON_OPEN, 'Open Document', ' data-document-id="' + esc(savedDocument.id) + '"');
      }

      return '<div class="mdv-menu' + (open ? ' mdv-menu--open' : '') + '" data-menu-for="' + esc(menuId) + '">' + items + '</div>';
    }

    function workflowBadgesHtml(file) {
      if (!enableWorkflow) return '';
      return docStudioWorkflowBadges(file);
    }

    function templateBadgeHtml(file) {
      return (enableTemplates && file.is_template)
        ? '<span class="mdv-template-badge">Template</span>'
        : '';
    }

    function selectCheckbox(file) {
      if (!enableBatch) return '';
      var key = fileSelectKey(file.id);
      var checked = state.selected[key] ? ' checked' : '';
      return '<input type="checkbox" class="mdv-select-cb" data-action="select" data-select-key="' + esc(key) + '" data-doc-id="' + esc(file.id) + '"' + checked + ' aria-label="Select file">';
    }

    function artifactCheckbox(artifact) {
      if (!enableBatch) return '';
      var id = artifactId(artifact);
      var key = artifactSelectKey(id);
      var checked = state.selected[key] ? ' checked' : '';
      return '<input type="checkbox" class="mdv-select-cb" data-action="select" data-select-key="' + esc(key) + '" data-artifact-id="' + esc(id) + '"' + checked + ' aria-label="Select artifact">';
    }

    // -- List row renderer ---------------------------------------------------

    function fileRow(file) {
      var name = fileName(file);
      var lifecycle = getDocumentLifecycle(file);
      var statusDisplay = getDocumentStatusDisplay(file);
      var isReady = lifecycle === 'ready' || lifecycle === 'summarized';
      var isBusy = lifecycle === 'processing' || lifecycle === 'uploaded' ||
        lifecycle === 'parsed' || lifecycle === 'indexed';

      var openControl = (onFileOpen && (isReady || isDocStudioGeneratedDocument(file)))
        ? '<button type="button" class="mdv-file-name" data-action="open" data-doc-id="' + esc(file.id) + '" title="' + esc(name) + '">' + esc(name) + '</button>'
        : '<span class="mdv-file-name mdv-file-name--static" title="' + esc(name) + '">' + esc(name) + '</span>';

      var busyNote = (isBusy && !isReady)
        ? '<span class="mdv-busy-note">' + esc(statusDisplay.progressLabel) + '</span>'
        : '';

      return [
        '<div class="mdv-file-row" data-doc-id="' + esc(file.id) + '" data-doc-type="' + (file.is_template ? 'template' : 'document') + '">',
        (enableBatch ? '  <div class="mdv-file-select">' + selectCheckbox(file) + '</div>' : ''),
        '  <div class="mdv-file-icon">' + fileIconHtml(file) + '</div>',
        '  <div class="mdv-file-main">',
        '    <div class="mdv-file-top">',
        '      ' + openControl,
        '      <div class="mdv-file-tags">',
        '        ' + templateBadgeHtml(file),
        '        ' + workflowBadgesHtml(file),
        '        ' + docStatusBadge(file),
        '      </div>',
        '    </div>',
        '    <div class="mdv-file-meta">',
        '      <span>' + esc(formatSize(file.file_size)) + '</span>',
        '      <span class="mdv-meta-sep">|</span>',
        '      <span>' + esc(timeAgo(file.created_at || file.updated_at)) + '</span>',
        '      ' + sourceBadge(file),
        '      ' + busyNote,
        '    </div>',
        '  </div>',
        '  <div class="mdv-file-actions">',
        '    <button type="button" class="mdv-kebab" data-action="menu" data-doc-id="' + esc(file.id) + '" title="File actions" aria-haspopup="true">' + ICON_KEBAB + '</button>',
        '    ' + fileMenu(file),
        '  </div>',
        '</div>'
      ].join('');
    }

    // -- Grid card renderer --------------------------------------------------

    function fileCard(file) {
      var name = fileName(file);
      var lifecycle = getDocumentLifecycle(file);
      var isReady = lifecycle === 'ready' || lifecycle === 'summarized';
      var openControl = (onFileOpen && (isReady || isDocStudioGeneratedDocument(file)))
        ? '<button type="button" class="mdv-card-name" data-action="open" data-doc-id="' + esc(file.id) + '" title="' + esc(name) + '">' + esc(name) + '</button>'
        : '<span class="mdv-card-name mdv-card-name--static" title="' + esc(name) + '">' + esc(name) + '</span>';

      return [
        '<div class="mdv-card" data-doc-id="' + esc(file.id) + '" data-doc-type="' + (file.is_template ? 'template' : 'document') + '">',
        (enableBatch ? '  <div class="mdv-card-select">' + selectCheckbox(file) + '</div>' : ''),
        '  <div class="mdv-card-actions">',
        '    <button type="button" class="mdv-kebab" data-action="menu" data-doc-id="' + esc(file.id) + '" title="File actions" aria-haspopup="true">' + ICON_KEBAB + '</button>',
        '    ' + fileMenu(file),
        '  </div>',
        '  <div class="mdv-card-body">',
        '    <div class="mdv-card-icon">' + fileIconHtml(file) + '</div>',
        '    ' + openControl,
        '    <div class="mdv-card-meta">' + templateBadgeHtml(file) + docStatusBadge(file) + '</div>',
        '    <div class="mdv-card-sub">' + esc(formatSize(file.file_size)) + '</div>',
        '  </div>',
        '</div>'
      ].join('');
    }

    function artifactStatusBadge(artifact) {
      var status = artifactPersistence(artifact);
      var cls = status.tone === 'success'
        ? 'mdv-badge--ready'
        : status.tone === 'error'
          ? 'mdv-badge--attention'
          : 'mdv-badge--uploaded';
      return '<span class="mdv-status-badge ' + cls + '">' + esc(status.message || status.status || 'Draft') + '</span>';
    }

    function artifactRow(artifact) {
      var id = artifactId(artifact);
      var title = artifactTitle(artifact);
      var type = artifact.artifact_type || artifact.type || 'artifact';
      var version = artifact.version || artifact.current_version || 1;
      var createdAt = artifact.updated_at || artifact.created_at || artifact.createdAt || '';

      return [
        '<div class="mdv-file-row mdv-artifact-row" data-artifact-id="' + esc(id) + '" data-doc-type="artifact">',
        (enableBatch ? '  <div class="mdv-file-select">' + artifactCheckbox(artifact) + '</div>' : ''),
        '  <div class="mdv-file-icon mdv-file-icon--artifact">' + artifactIconHtml(artifact) + '</div>',
        '  <div class="mdv-file-main">',
        '    <div class="mdv-file-top">',
        '      <button type="button" class="mdv-file-name" data-action="artifact-view" data-artifact-id="' + esc(id) + '" title="' + esc(title) + '">' + esc(title) + '</button>',
        '      <div class="mdv-file-tags">',
        '        <span class="mdv-template-badge">Generated</span>',
        '        ' + artifactStatusBadge(artifact),
        '      </div>',
        '    </div>',
        '    <div class="mdv-file-meta">',
        '      <span>' + esc(type) + '</span>',
        '      <span class="mdv-meta-sep">|</span>',
        '      <span>Version ' + esc(String(version)) + '</span>',
        (createdAt ? '      <span class="mdv-meta-sep">|</span><span>' + esc(timeAgo(createdAt)) + '</span>' : ''),
        '    </div>',
        '  </div>',
        '  <div class="mdv-file-actions">',
        '    <button type="button" class="mdv-kebab" data-action="artifact-menu" data-artifact-id="' + esc(id) + '" title="Artifact actions" aria-haspopup="true">' + ICON_KEBAB + '</button>',
        '    ' + artifactMenu(artifact),
        '  </div>',
        '</div>'
      ].join('');
    }

    function renderItem(item) {
      return item.kind === 'artifact' ? artifactRow(item.artifact) : fileRow(item.file);
    }

    // -- Orphaned files section ---------------------------------------------

    function orphanRow(file) {
      var name = file.filename || '';
      var connectorBadge = file.connector_id
        ? '<span class="mdv-meta-sep">|</span><span class="mdv-connector-badge">' + esc(file.connector_id) + '</span>'
        : '';
      return [
        '<div class="mdv-orphan-row" data-orphan-key="' + esc(file.storage_key) + '">',
        '  <div class="mdv-orphan-icon">' + fileIconHtml(file) + '</div>',
        '  <div class="mdv-orphan-main">',
        '    <div class="mdv-orphan-name" title="' + esc(name) + '">' + esc(name) + '</div>',
        '    <div class="mdv-file-meta"><span>' + esc(formatSize(file.file_size)) + '</span>' + connectorBadge + '</div>',
        '    <div class="mdv-orphan-key" title="' + esc(file.storage_key) + '">' + esc(file.storage_key) + '</div>',
        '    <div class="mdv-orphan-actions">',
        '      <button type="button" class="mdv-orphan-btn" data-action="assign-orphan" data-orphan-key="' + esc(file.storage_key) + '">' + ICON_ASSIGN + '<span>Assign to Matter</span></button>',
        '      <button type="button" class="mdv-orphan-btn mdv-orphan-btn--danger" data-action="delete-orphan" data-orphan-key="' + esc(file.storage_key) + '">' + ICON_DELETE + '<span>Delete</span></button>',
        '    </div>',
        '  </div>',
        '</div>'
      ].join('');
    }

    function orphansHtml() {
      if (!enableOrphans || state.orphans.length === 0) return '';
      var count = state.orphans.length;
      return [
        '<div class="mdv-orphans">',
        '  <div class="mdv-orphans-head">',
        '    <h5 class="mdv-orphans-title">Unassigned Documents</h5>',
        '    <span class="mdv-orphans-count">' + count + ' file' + (count !== 1 ? 's' : '') + ' found in storage</span>',
        '  </div>',
        '  <p class="mdv-orphans-note">These files exist in storage but are not tracked in the database. Use "Assign to Matter" to add them.</p>',
        '  <div class="mdv-orphans-list">' + state.orphans.map(orphanRow).join('') + '</div>',
        '</div>'
      ].join('');
    }

    // -- Render --------------------------------------------------------------

    function filterChip(value, label) {
      var active = state.filter === value;
      return '<button type="button" class="mdv-chip' + (active ? ' mdv-chip--active' : '') + '" data-action="filter" data-filter="' + esc(value) + '">' + esc(label) + '</button>';
    }

    function render() {
      if (destroyed) return;

      var filtered = applyFilters();
      var totalCount = filtered.length;
      var totalPages = Math.ceil(totalCount / pageSize) || 1;
      if (state.page > totalPages) state.page = 1;
      var startIdx = (state.page - 1) * pageSize;
      var pageItems = filtered.slice(startIdx, startIdx + pageSize);

      var templateCount = 0;
      if (enableTemplates) {
        for (var i = 0; i < state.files.length; i++) {
          if (state.files[i].is_template) templateCount++;
        }
      }
      var artifactCount = enableArtifacts ? state.artifacts.length : 0;
      var documentCount = state.files.length - templateCount;
      var allCount = state.files.length + artifactCount;

      var headerHtml = '';
      if (onCreateDocStudio && enableDocStudio) {
        headerHtml =
          '<div class="mdv-header">' +
            '<button type="button" class="mdv-doc-studio-btn" data-action="create-doc-studio">' +
              ICON_DOC_STUDIO + '<span>Create using Doc Studio</span>' +
            '</button>' +
          '</div>';
      }

      var searchHtml = enableSearch
        ? '<div class="mdv-search">' +
            ICON_SEARCH +
            '<input type="text" class="mdv-search-input" data-mdv-search placeholder="Search files..." value="' + esc(state.search) + '">' +
          '</div>'
        : '';

      var controlsHtml = '';
      var filtersHtml = '';
      if (enableTemplates || enableArtifacts) {
        filtersHtml =
          filterChip('all', 'All ' + allCount) +
          (templateCount > 0 ? filterChip('template', 'Templates ' + templateCount) : '') +
          (documentCount > 0 ? filterChip('document', 'Documents ' + documentCount) : '') +
          (artifactCount > 0 ? filterChip('artifact', 'Artifacts ' + artifactCount) : '');
      }
      var batchHtml = '';
      if (enableBatch) {
        var selectedCount = countSelected();
        var pageSelectable = pageItems.map(function (item) {
          return item.kind === 'artifact'
            ? artifactSelectKey(artifactId(item.artifact))
            : fileSelectKey(item.file.id);
        });
        var allChecked = pageSelectable.length > 0 && pageSelectable.every(function (key) { return state.selected[key]; });
        batchHtml =
          '<label class="mdv-select-all">' +
            '<input type="checkbox" data-action="select-all"' + (allChecked ? ' checked' : '') + '>' +
            '<span>Select All</span>' +
          '</label>' +
          '<button type="button" class="mdv-batch-delete' + (selectedCount > 0 ? '' : ' mdv-hidden') + '" data-action="batch-delete">' +
            'Delete ' + (selectedCount > 0 ? selectedCount + ' ' : '') + 'Selected' +
          '</button>';
      }
      if (filtersHtml || batchHtml) {
        controlsHtml =
          '<div class="mdv-controls">' +
            '<div class="mdv-filters">' + filtersHtml + '</div>' +
            '<div class="mdv-batch">' + batchHtml + '</div>' +
          '</div>';
      }

      var listHtml;
      if (totalCount === 0) {
        listHtml = showEmptyState
          ? (state.search
            ? '<div class="mdv-empty">No documents matching "' + esc(state.search) + '"</div>'
            : '<div class="mdv-empty">No documents in this workspace</div>')
          : '';
      } else if (state.viewMode === 'grid') {
        var gridFiles = pageItems.filter(function (item) { return item.kind === 'file'; }).map(function (item) { return item.file; });
        listHtml = '<div class="mdv-grid">' + gridFiles.map(fileCard).join('') + '</div>';
      } else {
        listHtml = '<div class="mdv-list">' + pageItems.map(renderItem).join('') + '</div>';
      }

      var paginationHtml = totalPages > 1
        ? '<lex-pagination class="mdv-pagination" data-mdv-pagination page="' + state.page + '" total-pages="' + totalPages + '" total="' + totalCount + '" limit="' + pageSize + '"></lex-pagination>'
        : '';
      var artifactErrorHtml = state.artifactLoadError
        ? '<div class="mdv-inline-error">Generated work product could not be loaded. ' + esc(state.artifactLoadError) + '</div>'
        : '';

      containerEl.innerHTML =
        '<div class="mdv-root">' +
          headerHtml +
          searchHtml +
          controlsHtml +
          listHtml +
          paginationHtml +
          artifactErrorHtml +
          orphansHtml() +
        '</div>';

      bindPagination();
      restoreSearchFocus();
    }

    function countSelected() {
      var n = 0;
      for (var k in state.selected) {
        if (state.selected[k]) n++;
      }
      return n;
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

    // -- Menu open/close -----------------------------------------------------

    function applyMenuState() {
      var menus = containerEl.querySelectorAll('.mdv-menu[data-menu-for]');
      for (var m = 0; m < menus.length; m++) {
        var id = menus[m].getAttribute('data-menu-for');
        var open = String(id) === String(state.openMenuId);
        menus[m].classList.toggle('mdv-menu--open', open);
        if (open) {
          positionMenu(id, menus[m]);
        } else {
          menus[m].style.left = '';
          menus[m].style.top = '';
          menus[m].style.right = '';
        }
      }
    }

    function findKebabByMenuId(menuId) {
      var artifactPrefix = 'artifact:';
      if (String(menuId).indexOf(artifactPrefix) === 0) {
        var artifactIdValue = String(menuId).slice(artifactPrefix.length);
        var artifactButtons = containerEl.querySelectorAll('.mdv-kebab[data-artifact-id]');
        for (var a = 0; a < artifactButtons.length; a++) {
          if (String(artifactButtons[a].getAttribute('data-artifact-id')) === artifactIdValue) {
            return artifactButtons[a];
          }
        }
        return null;
      }

      var buttons = containerEl.querySelectorAll('.mdv-kebab[data-doc-id]');
      for (var i = 0; i < buttons.length; i++) {
        if (String(buttons[i].getAttribute('data-doc-id')) === String(menuId)) {
          return buttons[i];
        }
      }
      return null;
    }

    function positionMenu(menuId, menu) {
      if (!menu) return;
      var trigger = findKebabByMenuId(menuId);
      if (!trigger) return;

      var triggerRect = trigger.getBoundingClientRect();
      var menuRect = menu.getBoundingClientRect();
      var gap = 6;
      var margin = 12;
      var menuWidth = menuRect.width || 176;
      var menuHeight = menuRect.height || 220;

      var left = triggerRect.right - menuWidth;
      left = Math.max(margin, Math.min(left, window.innerWidth - menuWidth - margin));

      var top = triggerRect.bottom + gap;
      if (top + menuHeight + margin > window.innerHeight) {
        top = triggerRect.top - menuHeight - gap;
      }
      top = Math.max(margin, Math.min(top, window.innerHeight - menuHeight - margin));

      menu.style.left = left + 'px';
      menu.style.top = top + 'px';
      menu.style.right = 'auto';
    }

    function closeMenu() {
      if (state.openMenuId !== null) {
        state.openMenuId = null;
        applyMenuState();
      }
    }

    function toggleMenu(fileId) {
      state.openMenuId = (String(state.openMenuId) === String(fileId)) ? null : fileId;
      applyMenuState();
    }

    // -- Mutating actions ----------------------------------------------------

    async function downloadFile(fileId) {
      var file = findFile(fileId);
      try {
        var url = (api && api.getFileDownloadUrl)
          ? api.getFileDownloadUrl(fileId, matterId)
          : (api && api.baseUrl ? api.baseUrl + '/api/v1/storage/files/' + fileId + '/download' : null);
        if (!url) throw new Error('Download URL unavailable');

        var headers = {};
        if (api && api.token) headers.Authorization = 'Bearer ' + api.token;

        var response = await fetch(url, { headers: headers });
        if (!response.ok) throw new Error('Download failed: ' + response.status);

        var blob = await response.blob();
        var blobUrl = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = blobUrl;
        a.download = (file && (file.filename || file.original_filename)) || 'download';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
        toastSuccess('Download started');
      } catch (error) {
        toastError('Failed to download file. Please try again.');
      }
    }

    async function deleteFile(fileId) {
      try {
        if (api && api.deleteDocument) {
          await api.deleteDocument(fileId);
        } else {
          await api.delete('/api/v1/storage/files/' + fileId);
        }
        toastSuccess('File deleted');
        await refresh();
      } catch (error) {
        toastError((error && error.message) || 'Failed to delete file. Please try again.');
      }
    }

    function confirmDelete(fileId) {
      var file = findFile(fileId);
      var name = file ? fileName(file) : 'this file';
      doConfirm(
        'Delete File',
        'Are you sure you want to delete "' + name + '"? This action moves the file to deleted items.',
        function () { deleteFile(fileId); },
        'Delete',
        'danger'
      );
    }

    async function retryIngestion(fileId) {
      var file = findFile(fileId);
      var name = file ? fileName(file) : 'this file';
      function run() {
        (async function () {
          try {
            toastInfo('Retriggering document ingestion...');
            await api.post('/api/v1/storage/documents/' + fileId + '/retry-ingestion', {});
            toastSuccess('Document processing started. This may take a few minutes.');
            setTimeout(function () { refresh(); }, 2000);
          } catch (error) {
            toastError((error && error.message) || 'Failed to retry document processing');
          }
        })();
      }
      doConfirm(
        'Retry Document Processing',
        'Retry processing for "' + name + '"? This will re-attempt to parse, chunk, and embed the document.',
        run,
        'Retry',
        'primary'
      );
    }

    function replaceFile(fileId) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf,.doc,.docx,.txt,.html,.rtf';
      input.onchange = function (e) {
        var file = e.target.files[0];
        if (!file) return;
        function run() {
          (async function () {
            try {
              toastInfo('Replacing document...');
              await api.replaceDocument(fileId, file);
              toastSuccess('Document replaced successfully. Re-processing for search...');
              await refresh();
            } catch (error) {
              toastError((error && error.message) || 'Failed to replace document');
            }
          })();
        }
        doConfirm(
          'Replace Document',
          'Replace document with "' + file.name + '"? This will re-process the document and update all embeddings for search.',
          run,
          'Replace',
          'primary'
        );
      };
      input.click();
    }

    // -- Template actions (reuse window.DocxTemplateModal when present) ------

    var _docxModal = null;

    function ensureDocxModal() {
      if (_docxModal || typeof window.DocxTemplateModal === 'undefined') return _docxModal;
      _docxModal = new window.DocxTemplateModal({
        prefix: 'mdvDocxTemplate',
        getMatterData: function () { return null; },
        onGenerated: function () { refresh(); },
        onError: function (msg) { toastError(msg); },
        onSuccess: function (msg) { toastSuccess(msg); }
      });
      return _docxModal;
    }

    async function toggleTemplate(fileId, isTemplate) {
      if (typeof window.DocxTemplateModal === 'undefined' || typeof window.DocxTemplateModal.toggleTemplate !== 'function') {
        toastError('Template support is unavailable.');
        return;
      }
      try {
        await window.DocxTemplateModal.toggleTemplate(fileId, matterId, isTemplate, {
          onSuccess: function (msg) { toastSuccess(msg); },
          onError: function (msg) { toastError(msg); }
        });
        await refresh();
      } catch (e) { /* handled by callbacks */ }
    }

    function openTemplateModal(fileId) {
      var file = findFile(fileId);
      var modal = ensureDocxModal();
      if (modal) {
        modal.open(fileId, matterId, file ? fileName(file) : '');
      } else {
        toastError('Template generator is unavailable.');
      }
    }

    // -- Doc Studio workflow actions (deck-studio endpoints) ----------------

    function docStudioBaseUrl(endpoint) {
      return String(endpoint || '').indexOf('http') === 0
        ? endpoint
        : (api && api.baseUrl ? api.baseUrl : '') + endpoint;
    }

    async function docStudioRequest(method, endpoint, data) {
      var headers = api && typeof api.getHeaders === 'function'
        ? api.getHeaders()
        : { 'Content-Type': 'application/json' };
      var response = await fetch(docStudioBaseUrl(endpoint), {
        method: method,
        headers: headers,
        body: JSON.stringify(data || {})
      });
      var text = await response.text();
      var payload = {};
      if (text) {
        try { payload = JSON.parse(text); } catch (e) { /* leave empty */ }
      }
      if (!response.ok) {
        var err = new Error((payload.error && payload.error.message) || payload.detail || payload.message || 'Doc Studio request failed.');
        err.statusCode = response.status;
        throw err;
      }
      return payload;
    }

    async function requestLegalReview(fileId) {
      try {
        var proceed = window.confirm('Request Lana legal review for this generated document?');
        if (!proceed) return;
        await docStudioRequest('POST', '/api/v1/deck-studio/matter-documents/' + encodeURIComponent(fileId) + '/legal-review', {
          notes: 'Review requested from the matter Documents view.'
        });
        toastSuccess('Legal review requested');
        await refresh();
      } catch (error) {
        toastError((error && error.message) || 'Failed to request legal review');
      }
    }

    async function requestSignatures(fileId) {
      try {
        var signerText = window.prompt('Enter signer names or emails separated by commas. Leave blank to create a signature request without named signers.', '');
        if (signerText === null) return;
        var signers = signerText.split(',')
          .map(function (v) { return v.trim(); })
          .filter(Boolean)
          .map(function (v) { return v.indexOf('@') !== -1 ? { email: v } : { name: v }; });
        await docStudioRequest('POST', '/api/v1/deck-studio/matter-documents/' + encodeURIComponent(fileId) + '/signatures', {
          signers: signers,
          notes: 'Signature workflow requested from the matter Documents view.'
        });
        toastSuccess('Signature workflow requested');
        await refresh();
      } catch (error) {
        toastError((error && error.message) || 'Failed to request signatures');
      }
    }

    async function updateLegalReviewStatus(fileId, status) {
      try {
        await docStudioRequest('PATCH', '/api/v1/deck-studio/matter-documents/' + encodeURIComponent(fileId) + '/legal-review', { status: status });
        toastSuccess('Legal review updated');
        await refresh();
      } catch (error) {
        toastError((error && error.message) || 'Failed to update legal review');
      }
    }

    async function updateSignatureStatus(fileId, status) {
      try {
        await docStudioRequest('PATCH', '/api/v1/deck-studio/matter-documents/' + encodeURIComponent(fileId) + '/signatures', { status: status });
        toastSuccess('Signature workflow updated');
        await refresh();
      } catch (error) {
        toastError((error && error.message) || 'Failed to update signature workflow');
      }
    }

    // -- Batch select / delete ----------------------------------------------

    function toggleSelect(selectKey, checked) {
      if (!selectKey) return;
      if (checked) {
        state.selected[selectKey] = true;
      } else {
        delete state.selected[selectKey];
      }
      updateBatchUi();
    }

    function toggleSelectAll(checked) {
      var filtered = applyFilters();
      var startIdx = (state.page - 1) * pageSize;
      var pageItems = filtered.slice(startIdx, startIdx + pageSize);
      pageItems.forEach(function (item) {
        var key = item.kind === 'artifact'
          ? artifactSelectKey(artifactId(item.artifact))
          : fileSelectKey(item.file.id);
        if (checked) state.selected[key] = true;
        else delete state.selected[key];
      });
      render();
    }

    function updateBatchUi() {
      var selectedCount = countSelected();
      var btn = containerEl.querySelector('.mdv-batch-delete');
      if (btn) {
        btn.classList.toggle('mdv-hidden', selectedCount === 0);
        btn.textContent = 'Delete ' + (selectedCount > 0 ? selectedCount + ' ' : '') + 'Selected';
      }
    }

    function batchDelete() {
      var keys = Object.keys(state.selected).filter(function (k) { return state.selected[k]; });
      if (keys.length === 0) return;
      var fileIds = keys.filter(function (key) { return key.indexOf('file:') === 0; }).map(function (key) { return key.slice(5); });
      var artifactIds = keys.filter(function (key) { return key.indexOf('artifact:') === 0; }).map(function (key) { return key.slice(9); });
      var count = fileIds.length + artifactIds.length;
      function run() {
        (async function () {
          var deleted = 0;
          var failed = 0;
          for (var i = 0; i < fileIds.length; i++) {
            try {
              if (api && api.deleteDocument) {
                await api.deleteDocument(fileIds[i]);
              } else {
                await api.delete('/api/v1/storage/files/' + fileIds[i] + (matterId ? '?matter_id=' + encodeURIComponent(matterId) : ''));
              }
              deleted++;
            } catch (e) {
              failed++;
            }
          }
          for (var a = 0; a < artifactIds.length; a++) {
            try {
              await api.delete('/api/v1/matters/' + encodeURIComponent(matterId) + '/artifacts/' + encodeURIComponent(artifactIds[a]));
              deleted++;
            } catch (e) {
              failed++;
            }
          }
          if (deleted > 0) toastSuccess(deleted + ' item' + (deleted !== 1 ? 's' : '') + ' deleted');
          if (failed > 0) toastError(failed + ' item' + (failed !== 1 ? 's' : '') + ' failed to delete');
          state.selected = {};
          await refresh();
        })();
      }
      doConfirm(
        'Delete ' + count + ' Item' + (count !== 1 ? 's' : ''),
        'Delete ' + count + ' selected workspace item' + (count !== 1 ? 's' : '') + '? Documents are removed through the document delete path; artifacts are archived with provenance.',
        run,
        'Delete',
        'danger'
      );
    }

    // -- Orphaned file actions ----------------------------------------------

    function assignOrphan(storageKey) {
      var file = findOrphan(storageKey);
      if (!file) return;
      var name = file.filename || '';
      var source = file.source || 'minio';
      var message = source === 'database'
        ? 'Link "' + name + '" to this matter? The file is already in the database.'
        : 'Assign "' + name + '" to this matter? This will create a database record and make it available for AI search.';
      function run() {
        (async function () {
          try {
            toastInfo('Assigning file...');
            await api.assignOrphanedFile({
              storage_key: storageKey,
              matter_id: matterId,
              filename: name,
              content_type: file.content_type || '',
              file_size: file.file_size || 0,
              document_id: file.id || null,
              source: source
            });
            toastSuccess('Document assigned. Processing started.');
            await refresh();
          } catch (error) {
            toastError((error && error.message) || 'Failed to assign file');
          }
        })();
      }
      doConfirm('Assign File to Matter', message, run, 'Assign', 'primary');
    }

    function deleteOrphan(storageKey) {
      var file = findOrphan(storageKey);
      var name = file ? (file.filename || '') : storageKey;
      function run() {
        (async function () {
          try {
            toastInfo('Deleting file...');
            await api.delete('/api/v1/storage/orphaned?storage_key=' + encodeURIComponent(storageKey));
            toastSuccess('File deleted successfully');
            await refresh();
          } catch (error) {
            toastError((error && error.message) || 'Failed to delete file');
          }
        })();
      }
      doConfirm('Delete File', 'Permanently delete "' + name + '" from storage? This action cannot be undone.', run, 'Delete', 'danger');
    }

    function ensureArtifactController() {
      if (!enableArtifacts || !window.WorkspaceArtifactsView || typeof window.WorkspaceArtifactsView.mount !== 'function') {
        return null;
      }
      if (!artifactController) {
        artifactController = window.WorkspaceArtifactsView.mount(document.createElement('div'), {
          api: api,
          matter: matter,
          Lex: window.Lex,
          escapeHtml: esc,
          formatDate: timeAgo,
          onOpenDocument: function (fileId) {
            if (onFileOpen) onFileOpen(fileId);
          },
          onPromoted: function (detail) {
            if (onArtifactPromoted) onArtifactPromoted(detail);
            refresh();
          }
        });
      }
      artifactController.matter = matter;
      artifactController.artifacts = state.artifacts.slice();
      return artifactController;
    }

    async function loadArtifacts() {
      if (!enableArtifacts || !api || !matterId) return;
      if (!api.get) return;
      try {
        var helper = artifactHelpers();
        var query = helper.buildQuery
          ? helper.buildQuery({ limit: 25, offset: 0, sort_by: 'updated_at', sort_dir: 'desc' })
          : 'limit=25&offset=0&sort_by=updated_at&sort_dir=desc';
        var result = await api.get('/api/v1/matters/' + encodeURIComponent(matterId) + '/artifacts?' + query);
        var extracted = helper.extractArtifactList
          ? helper.extractArtifactList(result)
          : { artifacts: [], pagination: null };
        state.artifacts = extracted.artifacts || [];
        state.artifactLoadError = null;
      } catch (error) {
        state.artifacts = [];
        state.artifactLoadError = error && error.message ? error.message : 'Artifact API request failed.';
      }
    }

    async function viewArtifact(id) {
      var controller = ensureArtifactController();
      if (!controller || typeof controller.openArtifact !== 'function') {
        toastError('Generated work product viewer is unavailable.');
        return;
      }
      await controller.openArtifact(id);
    }

    function promoteArtifact(id) {
      var controller = ensureArtifactController();
      if (!controller || typeof controller.promote !== 'function') {
        toastError('Save to Documents is unavailable.');
        return;
      }
      controller.promote(matterId, id);
    }

    // -- Rename (component-owned Lex modal) ---------------------------------

    var MODAL_ID = 'mdvRenameModal';
    var INPUT_ID = 'mdvRenameInput';
    var FORM_ID = 'mdvRenameForm';
    var SAVE_ID = 'mdvRenameSaveBtn';
    var CANCEL_ID = 'mdvRenameCancelBtn';

    var pendingRenameId = null;
    var pendingRenameOriginal = '';

    function ensureRenameModal() {
      var existing = document.getElementById(MODAL_ID);
      if (existing) return existing;

      var wrapper = document.createElement('div');
      wrapper.innerHTML =
        '<lex-modal id="' + MODAL_ID + '" heading="Rename File" size="md" hide-actions="true">' +
          '<form id="' + FORM_ID + '">' +
            '<lex-input id="' + INPUT_ID + '" label="File Name" placeholder="Enter file name" required="true"></lex-input>' +
            '<div class="mdv-rename-actions">' +
              '<lex-btn type="button" variant="secondary" id="' + CANCEL_ID + '">Cancel</lex-btn>' +
              '<lex-btn type="submit" variant="primary" id="' + SAVE_ID + '">Save</lex-btn>' +
            '</div>' +
          '</form>' +
        '</lex-modal>';
      var modal = wrapper.firstChild;
      document.body.appendChild(modal);
      return modal;
    }

    function openRenameModal(fileId) {
      var file = findFile(fileId);
      if (!file) return;

      pendingRenameId = fileId;
      pendingRenameOriginal = fileName(file);

      var modal = ensureRenameModal();
      var lexInput = document.getElementById(INPUT_ID);
      if (lexInput) lexInput.value = pendingRenameOriginal;

      modal._mdvOnSubmit = submitRename;
      modal._mdvOnCancel = closeRenameModal;

      var form = document.getElementById(FORM_ID);
      if (form && !form._mdvBound) {
        form._mdvBound = true;
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          if (modal._mdvOnSubmit) modal._mdvOnSubmit();
        });
      }
      var cancelBtn = document.getElementById(CANCEL_ID);
      if (cancelBtn && !cancelBtn._mdvBound) {
        cancelBtn._mdvBound = true;
        cancelBtn.addEventListener('click', function () {
          if (modal._mdvOnCancel) modal._mdvOnCancel();
        });
      }

      modal.open = true;
      setTimeout(function () {
        var inner = lexInput && lexInput.querySelector('input');
        if (inner) inner.focus();
      }, 100);
    }

    function closeRenameModal() {
      var modal = document.getElementById(MODAL_ID);
      if (modal) {
        modal.open = false;
        modal._mdvOnSubmit = null;
        modal._mdvOnCancel = null;
      }
      var lexInput = document.getElementById(INPUT_ID);
      if (lexInput) lexInput.value = '';
      pendingRenameId = null;
      pendingRenameOriginal = '';
    }

    async function submitRename() {
      if (!pendingRenameId) return;

      var lexInput = document.getElementById(INPUT_ID);
      var newName = lexInput ? (lexInput.value || '').trim() : '';

      if (!newName) {
        toastError('Please enter a file name');
        return;
      }
      if (newName === (pendingRenameOriginal || '').trim()) {
        closeRenameModal();
        return;
      }

      var fileId = pendingRenameId;
      try {
        await api.post('/api/v1/files/' + fileId + '/rename', { new_filename: newName });
        closeRenameModal();
        toastSuccess('File renamed');
        await refresh();
      } catch (error) {
        toastError('Failed to rename file. Please try again.');
      }
    }

    // -- Event delegation ----------------------------------------------------

    function handleClick(event) {
      var actionEl = event.target.closest ? event.target.closest('[data-action]') : null;
      if (!actionEl || !containerEl.contains(actionEl)) return;

      var action = actionEl.getAttribute('data-action');
      var fileId = actionEl.getAttribute('data-doc-id');
      var artifactIdValue = actionEl.getAttribute('data-artifact-id');
      var orphanKey = actionEl.getAttribute('data-orphan-key');

      switch (action) {
        case 'create-doc-studio':
          event.preventDefault();
          if (onCreateDocStudio) onCreateDocStudio();
          return;
        case 'filter':
          event.preventDefault();
          var filterVal = actionEl.getAttribute('data-filter') || 'all';
          if (state.filter !== filterVal) {
            state.filter = filterVal;
            state.page = 1;
            render();
          }
          return;
        case 'menu':
          event.preventDefault();
          event.stopPropagation();
          toggleMenu(fileId);
          return;
        case 'artifact-menu':
          event.preventDefault();
          event.stopPropagation();
          toggleMenu('artifact:' + artifactIdValue);
          return;
        case 'select':
          // Checkbox toggle handled by change listener; just stop bubbling.
          event.stopPropagation();
          return;
        case 'select-all':
          event.stopPropagation();
          return;
        case 'batch-delete':
          event.preventDefault();
          closeMenu();
          batchDelete();
          return;
        case 'open':
          event.preventDefault();
          closeMenu();
          if (onFileOpen) onFileOpen(fileId);
          return;
        case 'artifact-view':
          event.preventDefault();
          closeMenu();
          viewArtifact(artifactIdValue);
          return;
        case 'artifact-promote':
          event.preventDefault();
          closeMenu();
          promoteArtifact(artifactIdValue);
          return;
        case 'artifact-open-document':
          event.preventDefault();
          closeMenu();
          if (onFileOpen) onFileOpen(actionEl.getAttribute('data-document-id') || '');
          return;
        case 'download':
          event.preventDefault();
          closeMenu();
          downloadFile(fileId);
          return;
        case 'rename':
          event.preventDefault();
          closeMenu();
          openRenameModal(fileId);
          return;
        case 'delete':
          event.preventDefault();
          closeMenu();
          confirmDelete(fileId);
          return;
        case 'retry':
          event.preventDefault();
          closeMenu();
          retryIngestion(fileId);
          return;
        case 'replace':
          event.preventDefault();
          closeMenu();
          replaceFile(fileId);
          return;
        case 'template-mark':
          event.preventDefault();
          closeMenu();
          toggleTemplate(fileId, true);
          return;
        case 'template-unmark':
          event.preventDefault();
          closeMenu();
          toggleTemplate(fileId, false);
          return;
        case 'template-generate':
          event.preventDefault();
          closeMenu();
          openTemplateModal(fileId);
          return;
        case 'request-review':
          event.preventDefault();
          closeMenu();
          requestLegalReview(fileId);
          return;
        case 'request-signatures':
          event.preventDefault();
          closeMenu();
          requestSignatures(fileId);
          return;
        case 'mark-approved':
          event.preventDefault();
          closeMenu();
          updateLegalReviewStatus(fileId, 'approved');
          return;
        case 'mark-signed':
          event.preventDefault();
          closeMenu();
          updateSignatureStatus(fileId, 'completed');
          return;
        case 'assign-orphan':
          event.preventDefault();
          closeMenu();
          assignOrphan(orphanKey);
          return;
        case 'delete-orphan':
          event.preventDefault();
          closeMenu();
          deleteOrphan(orphanKey);
          return;
        default:
          return;
      }
    }

    function handleChange(event) {
      var el = event.target.closest ? event.target.closest('[data-action]') : null;
      if (!el || !containerEl.contains(el)) return;
      var action = el.getAttribute('data-action');
      if (action === 'select') {
        toggleSelect(el.getAttribute('data-select-key'), el.checked);
      } else if (action === 'select-all') {
        toggleSelectAll(el.checked);
      }
    }

    function handleInput(event) {
      var input = event.target.closest ? event.target.closest('[data-mdv-search]') : null;
      if (!input || !containerEl.contains(input)) return;

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
        state.page = newPage;
        render();
      }
    }

    function handleDocumentClick(event) {
      if (state.openMenuId === null) return;
      if (containerEl.contains(event.target)) {
        var menuEl = event.target.closest ? event.target.closest('.mdv-menu, .mdv-kebab') : null;
        if (menuEl) return;
      }
      closeMenu();
    }

    function handleViewportChange() {
      closeMenu();
    }

    // -- Public methods ------------------------------------------------------

    async function refresh(files, orphanedFiles, artifacts) {
      if (destroyed) return;

      // Explicit arrays => host-driven refresh. Otherwise re-fetch from the api
      // when ids are available so the list reflects the latest server state.
      if (Array.isArray(files)) {
        state.files = files.slice();
      } else if (api && api.getMatterFiles && matterId) {
        try {
          var response = await api.getMatterFiles(matterId, { pageSize: 500 });
          var loaded = (response && response.data && response.data.files) ||
            (response && response.files) || [];
          state.files = loaded.slice();
        } catch (error) {
          toastError('Failed to load files. Please try again.');
        }
      }

      if (Array.isArray(orphanedFiles)) {
        state.orphans = orphanedFiles.slice();
      } else if (enableOrphans && api && api.getOrphanedFiles && matterId) {
        try {
          var oResponse = await api.getOrphanedFiles(matterId);
          var oLoaded = (oResponse && oResponse.data && oResponse.data.files) ||
            (oResponse && oResponse.files) || (oResponse && oResponse.data && oResponse.data.orphaned_files) || [];
          state.orphans = oLoaded.slice();
        } catch (error) {
          // Non-fatal; leave existing orphans state.
        }
      }

      if (Array.isArray(artifacts)) {
        state.artifacts = artifacts.slice();
      } else {
        await loadArtifacts();
      }

      state.openMenuId = null;
      // Prune selections for files that no longer exist.
      var present = {};
      state.files.forEach(function (f) { present[fileSelectKey(f.id)] = true; });
      state.artifacts.forEach(function (artifact) { present[artifactSelectKey(artifactId(artifact))] = true; });
      Object.keys(state.selected).forEach(function (id) {
        if (!present[id]) delete state.selected[id];
      });

      render();
    }

    async function openArtifact(id) {
      if (!id) return;
      if (!findArtifact(id)) {
        await loadArtifacts();
        render();
      }
      await viewArtifact(id);
    }

    function setViewMode(mode) {
      state.viewMode = mode === 'grid' ? 'grid' : 'list';
      render();
      return state.viewMode;
    }

    function destroy() {
      destroyed = true;
      clearTimeout(searchTimeout);

      containerEl.removeEventListener('click', clickHandler);
      containerEl.removeEventListener('input', inputHandler);
      containerEl.removeEventListener('change', changeHandler);
      document.removeEventListener('click', documentClickHandler);
      window.removeEventListener('resize', viewportChangeHandler);
      window.removeEventListener('scroll', viewportChangeHandler, true);

      var pag = containerEl.querySelector('[data-mdv-pagination]');
      if (pag && pageChangeHandler) {
        pag.removeEventListener('page-change', pageChangeHandler);
      }

      if (artifactController && typeof artifactController.destroy === 'function') {
        artifactController.destroy();
      }
      artifactController = null;
      containerEl.innerHTML = '';
    }

    // -- Wire up -------------------------------------------------------------

    clickHandler = handleClick;
    inputHandler = handleInput;
    changeHandler = handleChange;
    pageChangeHandler = handlePageChange;
    documentClickHandler = handleDocumentClick;
    viewportChangeHandler = handleViewportChange;

    containerEl.addEventListener('click', clickHandler);
    containerEl.addEventListener('input', inputHandler);
    containerEl.addEventListener('change', changeHandler);
    document.addEventListener('click', documentClickHandler);
    window.addEventListener('resize', viewportChangeHandler);
    window.addEventListener('scroll', viewportChangeHandler, true);

    render();
    if (enableArtifacts) {
      refresh(state.files, state.orphans);
    }

    return {
      refresh: refresh,
      render: render,
      openArtifact: openArtifact,
      setViewMode: setViewMode,
      destroy: destroy,
      matterId: matterId,
      matterDisplayId: matterDisplayId
    };
  }

  // -- Global export --------------------------------------------------------

  window.MatterDocumentsView = {
    mount: function (containerEl, opts) {
      if (!containerEl) {
        throw new Error('MatterDocumentsView.mount requires a container element');
      }
      return createInstance(containerEl, opts || {});
    }
  };
})();
