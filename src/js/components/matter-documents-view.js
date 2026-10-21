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
    // Created with no text: nothing to process until it is written and released.
    if (parseDocumentMetadata(doc).processing_skipped_reason === 'empty_document' &&
        (status === '' || status === 'pending') && (processingStatus === '' || processingStatus === 'pending')) {
      return 'draft';
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
      'draft': {
        label: 'Draft',
        badgeClass: 'mdv-badge--draft',
        progressLabel: 'Draft, no text yet'
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
  var ICON_DELETE = '<svg class="mdv-menu-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
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
      selected: {},
      artifactLoadError: null,
      viewMode: opts.viewMode === 'grid' ? 'grid' : 'list'
    };

    var searchTimeout = null;
    var clickHandler = null;
    var inputHandler = null;
    var changeHandler = null;
    var pageChangeHandler = null;
    var menuSelectHandler = null;
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
    // options = { confirmText, variant }. We pass that options object.
    function doConfirm(title, message, onConfirm, confirmText, variant) {
      var confirmDialog = confirmFn || window.Lex.Modal.confirm;
      confirmDialog(title, message, onConfirm, { confirmText: confirmText, variant: variant });
    }

    function fileName(file) {
      return file.original_filename || file.filename || '';
    }

    function documentGrouping() {
      return (typeof window !== 'undefined' && window.LanaDocumentGrouping) ? window.LanaDocumentGrouping : null;
    }

    function derivedRoleBadgeHtml(file) {
      var grouping = documentGrouping();
      var label = grouping ? grouping.derivedRoleLabel(file) : '';
      return label ? '<span class="mdv-role-badge">' + esc(label) + '</span>' : '';
    }

    // At most five copies are listed under a document; the rest are reached
    // from the document view, whose Display menu lists every copy and version.
    function nestedChildren(item) {
      var grouping = documentGrouping();
      var children = item.children || [];
      return grouping ? grouping.visibleChildren(children) : { shown: children, hiddenCount: 0 };
    }

    /** Files in display order, sources followed by their listed copies. */
    function flattenFileItems(items) {
      var files = [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind !== 'file') continue;
        files.push(items[i].file);
        var shown = nestedChildren(items[i]).shown;
        for (var c = 0; c < shown.length; c++) files.push(shown[c]);
      }
      return files;
    }

    function showMoreRow(sourceFile, hiddenCount) {
      var label = 'Show ' + hiddenCount + ' more';
      return '<button type="button" class="mdv-file-row mdv-file-row--derived mdv-file-row--more" data-action="open" data-doc-id="' + esc(sourceFile.id) + '" title="Open the document and choose from the Display menu">' +
        '<span class="mdv-more-label">' + esc(label) + '</span>' +
        '<span class="mdv-more-hint">Open the document to choose from its copies and versions</span>' +
      '</button>';
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

      // A converted copy sits under its PDF: one row per document, the copy
      // nested beneath it (LanaDocumentGrouping; the copy's metadata names its
      // source). Without the grouping module every file stays top-level.
      var grouped = documentGrouping()
        ? documentGrouping().groupDerivedDocuments(files).groups
        : files.map(function (f) { return { file: f, children: [] }; });
      for (var i = 0; i < grouped.length; i++) {
        items.push({ kind: 'file', file: grouped[i].file, children: grouped[i].children });
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
          if (fileName(item.file).toLowerCase().indexOf(needle) !== -1) return true;
          // A match on the copy keeps the whole document visible.
          return (item.children || []).some(function (child) {
            return fileName(child).toLowerCase().indexOf(needle) !== -1;
          });
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
    //
    // Each row/card carries a lex-dropdown-btn (icon-only kebab). Its items'
    // values are the same action names the click delegation used; the
    // container's lex-select listener dispatches them (handleMenuSelect).

    function menuItem(action, icon, label, danger) {
      var item = { value: action, label: label, icon: icon };
      if (danger) item.danger = true;
      return item;
    }

    function kebabMenu(items, label, dataAttrs) {
      return '<lex-dropdown-btn class="mdv-kebab-menu" icon="more-vertical" icon-only variant="ghost" align="end" floating' +
        ' aria-label="' + esc(label) + '"' + dataAttrs +
        ' options="' + escAttrJson(items) + '"></lex-dropdown-btn>';
    }

    // JSON for a double-quoted attribute; quotes are always escaped here
    // (a page-level window.escapeHtml may not escape them).
    function escAttrJson(value) {
      return JSON.stringify(value)
        .split('&').join('&amp;')
        .split('"').join('&quot;')
        .split('<').join('&lt;')
        .split('>').join('&gt;');
    }

    function fileMenuItems(file) {
      var lifecycle = getDocumentLifecycle(file);
      var isReady = lifecycle === 'ready' || lifecycle === 'summarized';
      var needsAttention = lifecycle === 'needs_attention';
      var isGenerated = isDocStudioGeneratedDocument(file);
      var metadata = parseDocumentMetadata(file);
      var readOnly = !!file.read_only;
      var items = [];

      if (onFileOpen && (isReady || isGenerated)) {
        items.push(menuItem('open', 'eye', 'Open'));
      }
      items.push(menuItem('download', 'download', 'Download'));

      // Doc Studio workflow actions.
      if (enableWorkflow && isGenerated) {
        var hasReviewRequest = metadata.legal_review && metadata.legal_review.status && metadata.legal_review.status !== 'not_requested';
        var hasSignatureRequest = metadata.signature_workflow && metadata.signature_workflow.status && metadata.signature_workflow.status !== 'not_requested';
        items.push(menuItem('request-review', 'clipboard-check', hasReviewRequest ? 'Re-request Review' : 'Request Review'));
        items.push(menuItem('request-signatures', 'pen', hasSignatureRequest ? 'Re-request Signatures' : 'Request Signatures'));
        if (hasReviewRequest && metadata.legal_review.status !== 'approved') {
          items.push(menuItem('mark-approved', 'check', 'Mark Approved'));
        }
        if (hasSignatureRequest && metadata.signature_workflow.status !== 'completed') {
          items.push(menuItem('mark-signed', 'check', 'Mark Signed'));
        }
      }

      // Retry ingestion (failed documents).
      if (enableRetry && needsAttention) {
        items.push(menuItem('retry', 'refresh-cw', 'Retry Ingestion'));
      }

      // Template generate / mark / unmark.
      if (enableTemplateToggle && isDocxOrPdf(file) && !readOnly && isReady) {
        if (file.is_template) {
          items.push(menuItem('template-generate', 'file-text', 'Generate'));
          items.push(menuItem('template-unmark', 'file', 'Unmark Template'));
        } else {
          items.push(menuItem('template-mark', 'file', 'Use as Template'));
        }
      }

      if (enableRename && !readOnly) {
        items.push(menuItem('rename', 'edit', 'Rename'));
      }
      if (enableReplace && !readOnly) {
        items.push(menuItem('replace', 'upload', 'Replace'));
      }

      if (!readOnly) {
        items.push({ divider: true });
        items.push(menuItem('delete', 'trash-2', 'Delete', true));
      }

      return items;
    }

    function fileMenu(file) {
      return kebabMenu(fileMenuItems(file), 'File actions', ' data-doc-id="' + esc(file.id) + '"');
    }

    function artifactMenu(artifact) {
      var id = artifactId(artifact);
      var savedDocument = artifactDocument(artifact);
      var items = [menuItem('artifact-view', 'eye', 'View')];
      var attrs = ' data-artifact-id="' + esc(id) + '"';

      if (artifactPromotionAction(artifact)) {
        items.push(menuItem('artifact-promote', 'download', 'Save to Documents'));
      }
      if (savedDocument && savedDocument.id) {
        items.push(menuItem('artifact-open-document', 'eye', 'Open Document'));
        attrs += ' data-document-id="' + esc(savedDocument.id) + '"';
      }

      return kebabMenu(items, 'Artifact actions', attrs);
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

    function fileRow(file, options) {
      var nested = Boolean(options && options.nested);
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
        '<div class="mdv-file-row' + (nested ? ' mdv-file-row--derived' : '') + '" data-doc-id="' + esc(file.id) + '" data-doc-type="' + (file.is_template ? 'template' : 'document') + '">',
        (enableBatch ? '  <div class="mdv-file-select">' + selectCheckbox(file) + '</div>' : ''),
        '  <div class="mdv-file-icon">' + fileIconHtml(file) + '</div>',
        '  <div class="mdv-file-main">',
        '    <div class="mdv-file-top">',
        '      ' + openControl,
        '      <div class="mdv-file-tags">',
        '        ' + derivedRoleBadgeHtml(file),
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
        '    ' + fileMenu(file),
        '  </div>',
        '  <div class="mdv-card-body">',
        '    <div class="mdv-card-icon">' + fileIconHtml(file) + '</div>',
        '    ' + openControl,
        '    <div class="mdv-card-meta">' + derivedRoleBadgeHtml(file) + templateBadgeHtml(file) + docStatusBadge(file) + '</div>',
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
        '    ' + artifactMenu(artifact),
        '  </div>',
        '</div>'
      ].join('');
    }

    function renderItem(item) {
      if (item.kind === 'artifact') return artifactRow(item.artifact);
      var rows = [fileRow(item.file)];
      var nested = nestedChildren(item);
      for (var i = 0; i < nested.shown.length; i++) rows.push(fileRow(nested.shown[i], { nested: true }));
      if (nested.hiddenCount > 0) rows.push(showMoreRow(item.file, nested.hiddenCount));
      return rows.join('');
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
      var derivedCount = documentGrouping() ? documentGrouping().groupDerivedDocuments(state.files).derivedCount : 0;
      var documentCount = state.files.length - templateCount - derivedCount;
      var allCount = state.files.length - derivedCount + artifactCount;

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
        var pageSelectable = [];
        pageItems.forEach(function (item) {
          if (item.kind === 'artifact') {
            pageSelectable.push(artifactSelectKey(artifactId(item.artifact)));
            return;
          }
          pageSelectable.push(fileSelectKey(item.file.id));
          nestedChildren(item).shown.forEach(function (child) { pageSelectable.push(fileSelectKey(child.id)); });
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
        var gridFiles = flattenFileItems(pageItems);
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
            await api.post('/api/v1/storage/files/' + fileId + '/retry-ingestion', {});
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
        var proceed = await window.Lex.Modal.confirmAsync('Request Legal Review', 'Request Lana legal review for this generated document?', {
          confirmText: 'Request review'
        });
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
        var signerText = await window.Lex.Modal.prompt('Request Signatures', {
          message: 'Leave blank to create a signature request without named signers.',
          label: 'Signer names or emails, separated by commas',
          value: '',
          confirmText: 'Request signatures'
        });
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
            await api.delete('/api/v1/storage/objects?storage_key=' + encodeURIComponent(storageKey));
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

      // The Save/Cancel buttons live in the modal's own footer (footer-content);
      // the form still submits on Enter, and Save is wired to the same handler.
      var modal = document.createElement('lex-modal');
      modal.id = MODAL_ID;
      modal.setAttribute('heading', 'Rename File');
      modal.setAttribute('size', 'md');
      modal.setAttribute('footer-content',
        '<lex-btn type="button" variant="secondary" id="' + CANCEL_ID + '">Cancel</lex-btn>' +
        '<lex-btn type="button" variant="primary" id="' + SAVE_ID + '">Save</lex-btn>');
      modal.innerHTML =
        '<form id="' + FORM_ID + '">' +
          '<lex-input id="' + INPUT_ID + '" label="File Name" placeholder="Enter file name" required="true"></lex-input>' +
        '</form>';
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
      var saveBtn = modal.querySelector('#' + SAVE_ID);
      if (saveBtn && !saveBtn._mdvBound) {
        saveBtn._mdvBound = true;
        saveBtn.addEventListener('click', function () {
          if (modal._mdvOnSubmit) modal._mdvOnSubmit();
        });
      }
      var cancelBtn = modal.querySelector('#' + CANCEL_ID);
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
      // Kebab menus are lex-dropdown-btns; their items arrive as lex-select.
      if (event.target.closest && event.target.closest('lex-dropdown-btn')) return;
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
        case 'select':
          // Checkbox toggle handled by change listener; just stop bubbling.
          event.stopPropagation();
          return;
        case 'select-all':
          event.stopPropagation();
          return;
        case 'batch-delete':
          event.preventDefault();
          batchDelete();
          return;
        case 'assign-orphan':
          event.preventDefault();
          assignOrphan(orphanKey);
          return;
        case 'delete-orphan':
          event.preventDefault();
          deleteOrphan(orphanKey);
          return;
        default:
          if (runItemAction(action, fileId, artifactIdValue, actionEl.getAttribute('data-document-id'))) {
            event.preventDefault();
          }
          return;
      }
    }

    // A kebab menu item was chosen: the host carries the row's ids.
    function handleMenuSelect(event) {
      var host = event.target && event.target.closest ? event.target.closest('lex-dropdown-btn.mdv-kebab-menu') : null;
      if (!host || !containerEl.contains(host)) return;
      var action = event.detail && event.detail.value;
      runItemAction(action, host.getAttribute('data-doc-id'), host.getAttribute('data-artifact-id'), host.getAttribute('data-document-id'));
    }

    // Per-file and per-artifact actions, from a menu item or an inline button.
    // Returns true when the action is known.
    function runItemAction(action, fileId, artifactIdValue, documentId) {
      switch (action) {
        case 'open': if (onFileOpen) onFileOpen(fileId); return true;
        case 'artifact-view': viewArtifact(artifactIdValue); return true;
        case 'artifact-promote': promoteArtifact(artifactIdValue); return true;
        case 'artifact-open-document': if (onFileOpen) onFileOpen(documentId || ''); return true;
        case 'download': downloadFile(fileId); return true;
        case 'rename': openRenameModal(fileId); return true;
        case 'delete': confirmDelete(fileId); return true;
        case 'retry': retryIngestion(fileId); return true;
        case 'replace': replaceFile(fileId); return true;
        case 'template-mark': toggleTemplate(fileId, true); return true;
        case 'template-unmark': toggleTemplate(fileId, false); return true;
        case 'template-generate': openTemplateModal(fileId); return true;
        case 'request-review': requestLegalReview(fileId); return true;
        case 'request-signatures': requestSignatures(fileId); return true;
        case 'mark-approved': updateLegalReviewStatus(fileId, 'approved'); return true;
        case 'mark-signed': updateSignatureStatus(fileId, 'completed'); return true;
        default: return false;
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
      containerEl.removeEventListener('lex-select', menuSelectHandler);

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
    menuSelectHandler = handleMenuSelect;

    containerEl.addEventListener('click', clickHandler);
    containerEl.addEventListener('input', inputHandler);
    containerEl.addEventListener('change', changeHandler);
    containerEl.addEventListener('lex-select', menuSelectHandler);

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
