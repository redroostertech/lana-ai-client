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
    reviewBaselineRevisionKeyCounts: {},
    reviewBaselineRevisionIds: [],
    reviewBaselineAcceptedForReview: false,
    reviewTab: 'changes',
    reviewCounts: { changes: 0, comments: 0 },
    reviewBatches: [],
    currentReviewBatch: null,
    pendingReviewReleaseBatch: null,
    currentReviewBatchRestoreFailed: false,
    reviewSourceDocumentId: null,
    reviewReleases: [],
    reviewDisplayTarget: null,
    selectedReviewReleaseId: null,
    selectedReviewReleaseDocumentId: null,
    versionCompareMode: false,
    versionCompareSelections: [],
    explicitVersionView: false,
    releaseChangeGroups: [],
    releaseChangeHistory: [],
    releaseHistoryFilters: { user: 'all', date: 'all' },
    releaseComparison: null,
    releaseComparisonLoading: false,
    showTrackedChanges: true,
    suppressReviewDraftRestoreForLoad: false,
    formatCapabilities: null,
    formatConversionRunning: false,
    viewerPlainText: null,
    editorFocusedContext: null,
    workspaceFieldCatalog: null,
    workspaceFieldCatalogMatterId: null,
    matterLookupMapPromise: null,
    reviewDirty: false,
    reviewSaving: false,
    reviewReleasing: false,
    reviewRestoring: false,
    // askLanaDrawer/askLanaChatEl/askLanaThreadsEl removed — managed by lex-lana-panel
    _lanaSessionBootstrapped: false
  };

  // The retired office-release localStorage bridge. Releases now come only
  // from the server; purge any stale bridge data left by older sessions so
  // fabricated local releases can never surface in the viewer again.
  try { localStorage.removeItem('lana:file-viewer:office-releases'); } catch (_) {}

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

  function documentDisplayFilename(file) {
    var value = file || {};
    return value.display_filename || value.original_filename || value.original_name ||
      value.filename || value.name || 'Document';
  }

  function explicitFileSourceDocumentId(file) {
    return LanaDocumentReview.explicitSourceDocumentId(file);
  }

  function canonicalReviewSourceDocumentId(file) {
    return state.reviewSourceDocumentId || explicitFileSourceDocumentId(file) || (file && file.id ? String(file.id) : '');
  }

  function isReleasedArtifactFile(file) {
    return LanaDocumentReview.isReleasedArtifact(file);
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

  function normalizeFieldGroup(name) {
    var key = String(name || '').split('.')[0];
    if (key === 'org' || key === 'organization') return 'Organization';
    if (key === 'contact' || key === 'contacts') return 'Contacts';
    if (key === 'matter') return 'Matter';
    if (key === 'custom') return 'Custom fields';
    if (key === 'date' || key === 'dates') return 'Dates';
    if (key === 'attorney') return 'Attorney';
    if (key === 'template') return 'Template variables';
    return 'Workspace data';
  }

  function mergeFieldToken(name) {
    var value = String(name || '').trim();
    if (!value) return '';
    if (value.indexOf('{{') === 0 && value.lastIndexOf('}}') === value.length - 2) return value;
    return '{{' + value + '}}';
  }

  function normalizeCatalogField(field, fallbackGroup) {
    if (!field) return null;
    var name = field.name || field.path || field.key || '';
    var token = field.token || field.placeholder || mergeFieldToken(name);
    if (!name && token) name = token.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '');
    if (!name || !token) return null;
    var value = field.value;
    return {
      name: String(name),
      label: field.label || humanizeFieldPath(name),
      token: token,
      value: value,
      description: field.description || fieldPreview(value),
      group: field.group || fallbackGroup || normalizeFieldGroup(name),
      source: field.source || 'merge_fields'
    };
  }

  function addCatalogField(out, seen, field, fallbackGroup) {
    var normalized = normalizeCatalogField(field, fallbackGroup);
    if (!normalized || seen[normalized.token]) return;
    seen[normalized.token] = true;
    out.push(normalized);
  }

  function flattenMergeFields(source, prefix, out, seen) {
    if (!source || typeof source !== 'object') return;
    Object.keys(source).sort().forEach(function (key) {
      if (key === 'field_definitions') return;
      var value = source[key];
      var path = prefix ? prefix + '.' + key : key;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        flattenMergeFields(value, path, out, seen);
        return;
      }
      addCatalogField(out, seen, {
        name: path,
        label: humanizeFieldPath(path),
        token: mergeFieldToken(path),
        value: value,
        description: fieldPreview(value)
      });
    });
  }

  function addTemplateVariableFields(out, seen, templateData) {
    if (!templateData || typeof templateData !== 'object') return;
    var placeholders = Array.isArray(templateData.placeholders) ? templateData.placeholders : [];
    for (var i = 0; i < placeholders.length; i++) {
      var raw = placeholders[i];
      var name = typeof raw === 'string' ? raw : (raw && (raw.name || raw.placeholder || raw.key));
      if (!name) continue;
      addCatalogField(out, seen, {
        name: String(name).replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, ''),
        token: mergeFieldToken(name),
        description: 'Existing template variable in this document.',
        source: 'template_variables'
      }, 'Template variables');
    }
  }

  function sortWorkspaceFields(fields) {
    var groupOrder = {
      Matter: 1,
      Contacts: 2,
      Organization: 3,
      Attorney: 4,
      Dates: 5,
      'Custom fields': 6,
      'Template variables': 7,
      'Workspace data': 8
    };
    return fields.slice().sort(function (a, b) {
      var ga = groupOrder[a.group] || 99;
      var gb = groupOrder[b.group] || 99;
      if (ga !== gb) return ga - gb;
      return String(a.label || a.name).localeCompare(String(b.label || b.name));
    });
  }

  async function loadWorkspaceFieldCatalog(matterId, file) {
    if (!matterId) return [];
    var cacheKey = matterId + ':' + ((file && file.id) || '');
    if (state.workspaceFieldCatalogMatterId === cacheKey && Array.isArray(state.workspaceFieldCatalog)) {
      return state.workspaceFieldCatalog;
    }
    var response = await api.get('/api/v1/matters/' + encodeURIComponent(matterId) + '/merge-fields');
    var fields = [];
    var seen = {};
    var catalog = response && Array.isArray(response.field_catalog) ? response.field_catalog : [];
    for (var i = 0; i < catalog.length; i++) {
      addCatalogField(fields, seen, catalog[i]);
    }
    if (!fields.length) {
      flattenMergeFields(response && response.merge_fields ? response.merge_fields : {}, '', fields, seen);
    }
    if (file && file.id) {
      try {
        var templateResponse = await api.get('/api/v1/matters/' + encodeURIComponent(matterId) + '/documents/' + encodeURIComponent(file.id) + '/template-variables');
        addTemplateVariableFields(fields, seen, templateResponse && (templateResponse.data || templateResponse));
      } catch (error) {
        console.warn('[FileViewerPage] Template variable catalog unavailable:', error);
      }
    }
    state.workspaceFieldCatalog = sortWorkspaceFields(fields);
    state.workspaceFieldCatalogMatterId = cacheKey;
    return state.workspaceFieldCatalog;
  }

  function buildEditorModuleContext(file, focusedContext, typeOverride, extras) {
    var matterId = getConversationMatterId(file);
    var storageMatterId = getFileMatterId(file);
    var contextType = typeOverride || (focusedContext && focusedContext.kind === 'revision' ? 'editor_revision' : 'editor_selection');
    var base = {
      type: contextType,
      ui_label: contextType === 'document_edit'
        ? 'Document edit'
        : focusedContext && focusedContext.kind === 'revision'
          ? 'Tracked change'
          : 'Document selection',
      source: 'file_viewer',
      document: {
        id: file && file.id,
        name: file && file.filename,
        matter_id: matterId || null,
        storage_matter_id: storageMatterId && storageMatterId !== matterId ? storageMatterId : null,
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
    if (contextType === 'document_edit' && extras && extras.edit_intent) {
      base.document_edit = {
        strategy: extras.edit_intent.strategy || null,
        draft_text: truncateContextText(extras.edit_intent.draft_text || '', 4000),
        selection_text: base.selection && base.selection.text ? base.selection.text : ''
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
    var moduleContext = buildEditorModuleContext(file, detail.context, detail.edit_intent ? 'document_edit' : null, detail.edit_intent ? {
      edit_intent: detail.edit_intent
    } : null);
    state.editorFocusedContext = moduleContext;
    if (typeof panel.show === 'function') panel.show();
    setTimeout(function () {
      if (typeof panel.attachFile === 'function') panel.attachFile(file.id, file.filename || 'Document');
      if (typeof panel.attachModuleContext === 'function') panel.attachModuleContext(moduleContext);
      if (typeof panel.prefillPrompt === 'function') panel.prefillPrompt(prompt);
    }, 80);
  }

  function parseDocumentEditSuggestion(content) {
    var raw = String(content || '');
    var blockPattern = /```(?:lana-document-edit|json)?\s*\n([\s\S]*?)```/gi;
    var match;
    while ((match = blockPattern.exec(raw))) {
      try {
        var parsed = JSON.parse(String(match[1] || '').trim());
        if (!parsed || parsed.type !== 'document_edit_suggestion') continue;
        var suggestedText = String(parsed.suggested_text || '').trim();
        if (!suggestedText) continue;
        return {
          strategy: parsed.strategy === 'replace' ? 'replace' : 'insert_after',
          suggested_text: suggestedText,
          rationale: truncateContextText(parsed.rationale || '', 1000)
        };
      } catch (error) {
        console.warn('[FileViewerPage] Unable to parse fenced LANA document edit suggestion:', error);
      }
    }
    return null;
  }

  function handleLanaDocumentEditSuggestion(detail) {
    if (!state.editorFocusedContext || state.editorFocusedContext.type !== 'document_edit') return;
    var suggestion = parseDocumentEditSuggestion(detail && detail.content);
    if (!suggestion) return;
    notify('Open this document in File Editor to apply LANA suggested edits.', 'error');
  }

  function fieldOptionsAttribute(fields) {
    return escapeHtml(JSON.stringify(fields.map(function (field) {
      return {
        value: field.name,
        label: field.label,
        description: field.description,
        group: field.group
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
      var fields = await loadWorkspaceFieldCatalog(matterId, file);
      if (!fields.length) {
        notify('No workspace fields are available for this document.', 'error');
        return;
      }
      var selected = fields[0].name;
      var insertionMode = fields[0].value === null || fields[0].value === undefined || fields[0].value === '' ? 'token' : 'value';
      var modal = typeof Lex !== 'undefined' && Lex.Modal && typeof Lex.Modal.open === 'function'
        ? Lex.Modal.open({
          heading: 'Insert Workspace Field',
          size: 'sm',
          hideActions: false,
          confirmText: 'Insert Field',
          cancelText: 'Cancel',
          content: '<div style="display:flex;flex-direction:column;gap:12px;">' +
            '<p style="margin:0;color:var(--lex-text-secondary);font-size:var(--lex-body-sm-size);">Choose workspace data or an existing template field to insert as a tracked edit.</p>' +
            '<lex-select data-editor-field-select searchable="true" label="Field" value="' + escapeHtml(selected) + '" options=\'' + fieldOptionsAttribute(fields) + '\'></lex-select>' +
            '<lex-segmented data-editor-field-mode value="' + escapeHtml(insertionMode) + '" size="sm" options=\'[{"value":"value","label":"Current value"},{"value":"token","label":"Template field"}]\'></lex-segmented>' +
            '<div data-editor-field-preview style="border:1px solid var(--lex-border-subtle);border-radius:8px;padding:10px;font-size:var(--lex-body-sm-size);color:var(--lex-text-secondary);background:var(--lex-bg-secondary);"></div>' +
            '</div>'
        })
        : null;
      if (!modal) return;
      var renderPreview = function () {
        var field = fields.find(function (candidate) { return candidate.name === selected; }) || fields[0];
        var preview = modal.querySelector('[data-editor-field-preview]');
        if (!preview || !field) return;
        var current = field.value === null || field.value === undefined || field.value === ''
          ? 'No current value. The template field token will be inserted.'
          : fieldPreview(field.value);
        preview.innerHTML =
          '<div style="font-weight:600;color:var(--lex-text-primary);margin-bottom:4px;">' + escapeHtml(field.token) + '</div>' +
          '<div>' + escapeHtml(current) + '</div>';
      };
      renderPreview();
      modal.addEventListener('lex-change', function (event) {
        var target = event && event.target;
        if (target && target.closest && target.closest('[data-editor-field-mode]')) {
          insertionMode = (event.detail && event.detail.value) || insertionMode;
          return;
        }
        if (event && event.detail && event.detail.value) {
          selected = event.detail.value;
          var field = fields.find(function (candidate) { return candidate.name === selected; });
          if (field && (field.value === null || field.value === undefined || field.value === '')) {
            insertionMode = 'token';
            var mode = modal.querySelector('[data-editor-field-mode]');
            if (mode) mode.value = 'token';
          }
          renderPreview();
        }
      });
      modal.addEventListener('lex-confirm', async function () {
        var field = fields.find(function (candidate) { return candidate.name === selected; });
        if (!field) {
          if (modal && typeof modal.remove === 'function') modal.remove();
          return;
        }
        var valueAvailable = !(field.value === null || field.value === undefined || field.value === '');
        var insertion = insertionMode === 'value' && valueAvailable ? String(field.value) : field.token;
        try {
          await editor.insertWorkspaceField(insertion);
          state.editorFocusedContext = buildEditorModuleContext(file, detail && detail.context, 'editor_field_insert', {
            field: {
              name: field.name,
              label: field.label,
              token: field.token,
              group: field.group,
              source: field.source,
              insertion_mode: insertionMode === 'value' && valueAvailable ? 'value' : 'token'
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
    if (!file) return '';
    var metadata = fileMetadata(file);
    var nested = metadata.metadata && typeof metadata.metadata === 'object' ? metadata.metadata : {};
    return file.client_matter ||
      file.matter_number ||
      file.client_matter_number ||
      file.matter_id ||
      file.matterId ||
      file.clientMatter ||
      file.matter && (file.matter.matter_id || file.matter.client_matter || file.matter.matter_number || file.matter.id) ||
      metadata.client_matter ||
      metadata.matter_number ||
      metadata.client_matter_number ||
      metadata.matter_id ||
      metadata.matterId ||
      metadata.clientMatter ||
      metadata.matter && (metadata.matter.matter_id || metadata.matter.client_matter || metadata.matter.matter_number || metadata.matter.id) ||
      nested.client_matter ||
      nested.matter_number ||
      nested.client_matter_number ||
      nested.matter_id ||
      nested.matterId ||
      nested.clientMatter ||
      nested.matter && (nested.matter.matter_id || nested.matter.client_matter || nested.matter.matter_number || nested.matter.id) ||
      '';
  }

  function isLikelyUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
  }

  function conversationMatterCandidate(value) {
    var normalized = String(value || '').trim();
    return normalized && !isLikelyUuid(normalized) ? normalized : '';
  }

  function getConversationMatterId(file) {
    if (!file) return '';
    var metadata = fileMetadata(file);
    var nested = metadata.metadata && typeof metadata.metadata === 'object' ? metadata.metadata : {};
    var candidates = [
      file.matter_number,
      file.client_matter_number,
      file.external_matter_id,
      file.client_matter,
      file.clientMatter,
      file.matter_id,
      file.matterId,
      metadata.matter_number,
      metadata.client_matter_number,
      metadata.external_matter_id,
      metadata.client_matter,
      metadata.matter_id,
      nested.matter_number,
      nested.client_matter_number,
      nested.external_matter_id,
      nested.client_matter,
      nested.matter_id
    ];
    for (var i = 0; i < candidates.length; i++) {
      var candidate = conversationMatterCandidate(candidates[i]);
      if (candidate) return candidate;
    }
    return '';
  }

  function getFileMatterDisplayName(file) {
    if (!file) return '';
    var metadata = fileMetadata(file);
    var nested = metadata.metadata && typeof metadata.metadata === 'object' ? metadata.metadata : {};
    var candidates = [
      file.workspace_name,
      file.workspaceName,
      file.workspace && file.workspace.name,
      file.workspace && file.workspace.matter_name,
      file.matter && file.matter.matter_name,
      file.matter && file.matter.name,
      file.matter && file.matter.title,
      file.matter && file.matter.display_name,
      file.matter_name,
      file.client_matter_name,
      file.client_workspace_name,
      file.clientWorkspaceName,
      file.matter_display_name,
      file.matterDisplayName,
      metadata.matter_name,
      metadata.client_matter_name,
      metadata.workspace_name,
      metadata.workspaceName,
      metadata.workspace && metadata.workspace.name,
      metadata.workspace && metadata.workspace.matter_name,
      metadata.matter && metadata.matter.matter_name,
      metadata.matter && metadata.matter.name,
      metadata.matter && metadata.matter.title,
      metadata.matter && metadata.matter.display_name,
      metadata.client_workspace_name,
      metadata.matter_display_name,
      nested.matter_name,
      nested.client_matter_name,
      nested.workspace_name,
      nested.workspaceName,
      nested.workspace && nested.workspace.name,
      nested.workspace && nested.workspace.matter_name,
      nested.matter && nested.matter.matter_name,
      nested.matter && nested.matter.name,
      nested.matter && nested.matter.title,
      nested.matter && nested.matter.display_name,
      nested.client_workspace_name,
      nested.matter_display_name
    ];
    for (var i = 0; i < candidates.length; i++) {
      var label = String(candidates[i] || '').trim();
      if (label && !isLikelyUuid(label)) return label;
    }
    return '';
  }

  function getMatterResponseRecord(response) {
    if (!response) return null;
    if (response.matter && typeof response.matter === 'object') return response.matter;
    if (response.data && response.data.matter && typeof response.data.matter === 'object') return response.data.matter;
    if (response.data && typeof response.data === 'object') return response.data;
    return typeof response === 'object' ? response : null;
  }

  function getMatterRecordDisplayName(matter) {
    if (!matter) return '';
    var candidates = [
      matter.workspace_name,
      matter.workspaceName,
      matter.matter_name,
      matter.name,
      matter.title,
      matter.display_name,
      matter.displayName,
      matter.client_matter_name,
      matter.matter_display_name
    ];
    for (var i = 0; i < candidates.length; i++) {
      var label = String(candidates[i] || '').trim();
      if (label && !isLikelyUuid(label)) return label;
    }
    return '';
  }

  function getMatterRecordIdentityValues(matter) {
    if (!matter) return [];
    return [
      matter.id,
      matter.uuid,
      matter.matter_id,
      matter.matterId,
      matter.matter_number,
      matter.matterNumber,
      matter.client_matter,
      matter.clientMatter,
      matter.client_matter_number,
      matter.external_matter_id
    ].filter(Boolean).map(function (value) {
      return String(value).trim();
    }).filter(Boolean);
  }

  function getMatterRecordDetailId(matter) {
    if (!matter) return '';
    var candidates = [
      matter.matter_id,
      matter.matterId,
      matter.client_matter,
      matter.clientMatter,
      matter.matter_number,
      matter.matterNumber,
      matter.id,
      matter.uuid
    ];
    for (var i = 0; i < candidates.length; i++) {
      var value = String(candidates[i] || '').trim();
      if (value) return value;
    }
    return '';
  }

  function matterRowsFromResponse(response) {
    if (!response) return [];
    if (Array.isArray(response.matters)) return response.matters;
    if (Array.isArray(response.data)) return response.data;
    if (Array.isArray(response.items)) return response.items;
    if (response.data && Array.isArray(response.data.matters)) return response.data.matters;
    if (response.data && Array.isArray(response.data.items)) return response.data.items;
    return [];
  }

  function buildMatterLookupMap(matters) {
    var rows = Array.isArray(matters) ? matters : [];
    var map = {};
    for (var i = 0; i < rows.length; i++) {
      var matter = rows[i];
      var name = getMatterRecordDisplayName(matter);
      if (!name) continue;
      var hrefId = getMatterRecordDetailId(matter);
      var ids = getMatterRecordIdentityValues(matter);
      for (var j = 0; j < ids.length; j++) {
        map[ids[j]] = {
          name: name,
          hrefId: hrefId || ids[j]
        };
      }
    }
    return map;
  }

  async function loadMatterLookupMap() {
    if (!api || typeof api.getMatters !== 'function') return {};
    if (!state.matterLookupMapPromise) {
      state.matterLookupMapPromise = api.getMatters(1, 250, {
        status: 'active',
        sort_by: 'updated_at',
        sort_order: 'desc'
      }).then(function (response) {
        return buildMatterLookupMap(matterRowsFromResponse(response));
      }).catch(function (error) {
        state.matterLookupMapPromise = null;
        console.warn('[FileViewerPage] Matter list lookup failed:', error);
        return {};
      });
    }
    return state.matterLookupMapPromise;
  }

  async function resolveMatterFromList(matterId) {
    var id = String(matterId || '').trim();
    if (!id) return null;
    var map = await loadMatterLookupMap();
    return map[id] || null;
  }

  function isMatterIdentifierLabel(label, matterId) {
    var normalized = String(label || '').trim();
    if (!normalized) return true;
    if (isLikelyUuid(normalized)) return true;
    if (matterId && normalized === String(matterId).trim()) return true;
    return /^MATT-\d+$/i.test(normalized);
  }

  function setFileBreadcrumb(file, matterLabel, matterHrefId) {
    var breadcrumb = document.getElementById('viewerBreadcrumb');
    if (!breadcrumb || !file) return;
    var crumbItems = [];
    var matterId = getFileMatterId(file);
    var hrefId = matterHrefId || matterId;
    if (matterId) {
      crumbItems.push({ label: 'Workspaces & Matters', href: 'workspaces.html' });
      crumbItems.push({
        label: matterLabel || getFileMatterDisplayName(file) || 'Workspace',
        href: 'workspace-details.html?id=' + encodeURIComponent(hrefId)
      });
    }
    crumbItems.push({ label: documentDisplayFilename(file) || 'File' });
    breadcrumb.setAttribute('items', JSON.stringify(crumbItems));
  }

  async function hydrateFileBreadcrumbMatterLabel(file) {
    var matterId = getFileMatterId(file);
    if (!matterId || !api) return;
    var currentLabel = getFileMatterDisplayName(file);
    if (!isMatterIdentifierLabel(currentLabel, matterId)) return;

    var listMatter = await resolveMatterFromList(matterId);
    if (listMatter && listMatter.name) {
      if (!state.currentFile || String(state.currentFile.id || '') !== String(file.id || '')) return;
      setFileBreadcrumb(file, listMatter.name, listMatter.hrefId);
      return;
    }

    if (isLikelyUuid(matterId) || typeof api.getMatter !== 'function') return;

    try {
      var response = await api.getMatter(matterId);
      var matter = getMatterResponseRecord(response);
      var name = getMatterRecordDisplayName(matter);
      if (!name) return;
      if (!state.currentFile || String(state.currentFile.id || '') !== String(file.id || '')) return;
      setFileBreadcrumb(file, name, getMatterRecordDetailId(matter));
    } catch (error) {
      console.warn('[FileViewerPage] Failed to hydrate breadcrumb matter label:', error);
    }
  }

  function getCurrentMatterId() {
    return getFileMatterId(state.currentFile);
  }

  function currentReviewerName() {
    var user = api && api.user ? api.user : null;
    if (!user) {
      try {
        user = JSON.parse(localStorage.getItem('user') || 'null');
      } catch (_) {
        user = null;
      }
    }
    if (!user) return 'Reviewer';
    var fullName = [
      user.firstName || user.first_name || '',
      user.lastName || user.last_name || ''
    ].join(' ').trim();
    return user.full_name || user.fullName || user.display_name || user.displayName || fullName || user.email || 'Reviewer';
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

  function detectViewerFormat(file) {
    var mimeType = String((file && (file.content_type || file.mime_type)) || '').toLowerCase();
    var filename = String((file && file.filename) || '').toLowerCase();
    if (isEditorDocx(file)) return 'docx';
    if (mimeType === 'application/pdf' || filename.endsWith('.pdf')) return 'pdf';
    if (mimeType === 'text/csv' || filename.endsWith('.csv')) return 'csv';
    if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || filename.endsWith('.xlsx')) return 'xlsx';
    if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' || filename.endsWith('.pptx')) return 'pptx';
    if (mimeType === 'text/markdown' || filename.endsWith('.md') || filename.endsWith('.markdown')) return 'markdown';
    if (mimeType.indexOf('text/') === 0 || filename.endsWith('.txt') || filename.endsWith('.text') || filename.endsWith('.log')) return 'text';
    return filename.indexOf('.') !== -1 ? filename.split('.').pop() : 'unknown';
  }

  function localFormatCapabilities(file) {
    var format = detectViewerFormat(file);
    var editable = format === 'docx' || format === 'text' || format === 'markdown';
    return {
      format: format,
      editable: editable,
      reviewable: editable,
      release_supported: editable,
      compare_supported: ['docx', 'text', 'markdown', 'pdf'].indexOf(format) !== -1,
      conversion: {
        target_format: format === 'pdf' ? 'docx' : null,
        available: false,
        requires_user_action: format === 'pdf',
        note: format === 'pdf'
          ? 'PDFs open read-only. Conversion is available only when the server confirms support.'
          : null
      },
      export: {
        pdf_supported: ['docx', 'text', 'markdown'].indexOf(format) !== -1
      }
    };
  }

  async function loadFormatCapabilities(file) {
    state.formatCapabilities = localFormatCapabilities(file);
    var matterId = getFileMatterId(file);
    if (!matterId || !file || !file.id) return state.formatCapabilities;
    try {
      var response = await api.get(reviewEndpoint('/documents/' + encodeURIComponent(file.id) + '/format-capabilities'));
      var capabilities = response && response.data ? response.data : response;
      if (capabilities && typeof capabilities === 'object') {
        state.formatCapabilities = Object.assign({}, state.formatCapabilities, capabilities);
      }
    } catch (error) {
      console.warn('[FileViewerPage] Format capabilities unavailable; using local fallback:', error);
    }
    return state.formatCapabilities;
  }

  function currentFormatCapabilities(file) {
    return state.formatCapabilities || localFormatCapabilities(file || state.currentFile);
  }

  function canReviewFile(file) {
    return currentFormatCapabilities(file).reviewable === true;
  }

  function isOfficeEditFormat(file) {
    var kind = fileEditorKindForFile(file);
    if (kind !== 'sheet' && kind !== 'deck') return false;
    var filename = String(file && file.filename || '').toLowerCase();
    var contentType = String(file && (file.content_type || file.mime_type) || '').toLowerCase();
    return filename.endsWith('.csv') || filename.endsWith('.xlsx') || filename.endsWith('.pptx') ||
      contentType === 'text/csv' ||
      contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      contentType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  }

  function officeCapabilitySupportsEditing(capabilities) {
    var value = capabilities && typeof capabilities === 'object' ? capabilities : {};
    return value.editable === true || value.edit_model_supported === true ||
      Boolean(value.file_editor && value.file_editor.editable === true);
  }

  function canOpenFileInEditor(file) {
    if (isOfficeEditFormat(file)) return officeCapabilitySupportsEditing(currentFormatCapabilities(file));
    return canReviewFile(file);
  }

  function releaseContentType(file) {
    var capabilities = currentFormatCapabilities(file);
    var format = capabilities.format || detectViewerFormat(file);
    if (format === 'markdown') return 'text/markdown';
    if (format === 'text') return 'text/plain';
    return (file && file.content_type) || capabilities.content_type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
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
    var matterName = getFileMatterDisplayName(file);
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

  function isFileViewerRoute(route) {
    var value = String(route || '').trim();
    if (!value) return false;
    var queryIndex = value.indexOf('?');
    var path = queryIndex === -1 ? value : value.substring(0, queryIndex);
    var parts = path.split('/');
    var page = parts[parts.length - 1] || path;
    return page === 'file-viewer.html';
  }

  function normalizeBackReferrer(referrer) {
    var value = String(referrer || '').trim();
    if (!value || isFileViewerRoute(value)) return '';
    return value;
  }

  function fallbackBackReferrer() {
    return '';
  }

  function fileViewerRouteForFile(file) {
    return file && file.id ? 'file-viewer.html?id=' + encodeURIComponent(file.id) : '';
  }

  function fileViewerNavContext(file) {
    return {
      referrer: normalizeBackReferrer(state.referrerPage) || fallbackBackReferrer(),
      fileViewerReferrer: fileViewerRouteForFile(file)
    };
  }

  function fileEditorKindForFile(file) {
    var mimeType = String((file && (file.content_type || file.mime_type)) || '').toLowerCase();
    var filename = String((file && file.filename) || '').toLowerCase();
    var ext = filename.split('.').pop();
    if (mimeType === 'text/csv' || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || ext === 'xlsx' || ext === 'csv') return 'sheet';
    if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' || ext === 'pptx') return 'deck';
    return 'doc';
  }

  function plainTextToViewerHtml(text) {
    var normalized = String(text || '').replace(/\r\n?/g, '\n');
    if (!normalized.trim()) return '';
    return normalized.split(/\n{2,}/).map(function (part) {
      var lines = part.split('\n').map(function (line) {
        return escapeHtml(line.replace(/\s+$/, ''));
      });
      while (lines.length && !lines[0]) lines.shift();
      while (lines.length && !lines[lines.length - 1]) lines.pop();
      if (!lines.length) return '';
      return '<p>' + lines.join('<br>') + '</p>';
    }).filter(Boolean).join('');
  }

  function visibleViewerDocumentHtml() {
    // Text-like files: build the handoff from the decoded source text, not a
    // DOM scrape. The LANA Editor embed renders one block element per line,
    // so textContent jams lines together with no separator.
    var textHtml = plainTextToViewerHtml(state.viewerPlainText);
    if (textHtml) return textHtml;
    var sources = [
      document.getElementById('viewerDocx'),
      document.getElementById('viewerEditor'),
      document.getElementById('viewerText')
    ];
    for (var i = 0; i < sources.length; i += 1) {
      var node = sources[i];
      if (!node || node.classList.contains('hidden')) continue;
      if (node.id === 'viewerDocx' && String(node.textContent || '').trim()) return node.innerHTML;
      // innerText preserves rendered line breaks; textContent does not.
      var raw = String(typeof node.innerText === 'string' ? node.innerText : node.textContent || '');
      var fallbackHtml = plainTextToViewerHtml(raw);
      if (fallbackHtml) return fallbackHtml;
    }
    return '';
  }

  function fileEditorReviewChange(change, type) {
    var status = reviewStatus(change, type || 'changes');
    var before = type === 'comments' ? '' : changeOriginalText(change);
    var after = type === 'comments' ? '' : changeProposedText(change);
    return {
      type: reviewItemLabel(type || 'changes', change),
      status: status && status.label ? status.label : (type === 'comments' ? 'Open' : 'Pending'),
      text: reviewItemText(change) || after || before || 'Tracked change from File Viewer.',
      before: before,
      after: after || reviewItemText(change),
      author: historyChangeUser(change),
      createdAt: historyChangeDate(change, null)
    };
  }

  function fileEditorReviewChanges() {
    var reviewState = currentReviewState();
    var revisions = currentUnreleasedDisplayChanges();
    var comments = reviewState && Array.isArray(reviewState.comments) ? reviewState.comments.filter(Boolean) : [];
    var changes = revisions.map(function (change) {
      return fileEditorReviewChange(change, 'changes');
    });
    comments.forEach(function (comment) {
      changes.push(fileEditorReviewChange(comment, 'comments'));
    });
    return changes;
  }

  function fileEditorVersions(file) {
    var versions = [];
    versions.push({
      label: 'Current draft',
      status: 'Draft',
      time: state.currentReviewBatch && state.currentReviewBatch.updated_at
        ? 'Updated ' + formatDate(state.currentReviewBatch.updated_at)
        : 'Opened from File Viewer'
    });
    reviewReleasesNewestFirst().forEach(function (item) {
      var release = item.release || {};
      versions.push({
        label: 'Version ' + (release.release_number || versions.length),
        status: release.status || 'Released',
        time: release.released_at ? 'Released ' + formatDate(release.released_at) : 'Released version'
      });
    });
    if (file) {
      versions.push({
        label: 'Source file',
        status: 'Base',
        time: file.created_at ? 'Uploaded ' + formatDate(file.created_at) : 'Original document'
      });
    }
    return versions;
  }

  function fileEditorHandoff(file) {
    var sourceUrl = file && file.id ? getFileDownloadUrl(file) : '';
    var displayFilename = documentDisplayFilename(file);
    var draftBatch = state.currentReviewBatch && isActiveReviewDraftBatch(state.currentReviewBatch)
      ? state.currentReviewBatch
      : null;
    return {
      source: 'file_viewer',
      referrer: fileViewerRouteForFile(file) || targetBackRoute(),
      file: {
        id: file && file.id ? 'file-editor-' + String(file.id) : '',
        documentId: file && file.id ? String(file.id) : '',
        sourceDocumentId: canonicalReviewSourceDocumentId(file),
        releasedDocumentId: isReleasedArtifactFile(file) && file && file.id ? file.id : '',
        matterId: getCurrentMatterId() || '',
        matterNumber: getConversationMatterId(file) || '',
        matterName: getFileMatterDisplayName(file) || '',
        kind: fileEditorKindForFile(file),
        title: displayFilename,
        filename: displayFilename,
        storageFilename: file && file.filename,
        original_filename: file && (file.original_filename || displayFilename),
        display_filename: file && (file.display_filename || displayFilename),
        contentType: file && (file.content_type || file.mime_type),
        fileSize: file && file.file_size,
        createdAt: file && file.created_at,
        documentUpdatedAt: (file && (file.updated_at || file.created_at)) || '',
        updatedAt: LanaDocumentReview.latestActivityIso(file, draftBatch) || (file && (file.updated_at || file.created_at)),
        lastSavedAt: draftBatch && draftBatch.updated_at ? draftBatch.updated_at : null,
        metadata: fileMetadata(file),
        summary: file && file.summary,
        summaryGeneratedAt: file && file.summary_generated_at,
        editorEngine: fileEditorKindForFile(file) === 'doc' ? 'lana-editor' : 'server-edit-model',
        editorMode: fileEditorKindForFile(file) === 'doc' ? 'review' : 'edit',
        officeEditingSupported: isOfficeEditFormat(file) && officeCapabilitySupportsEditing(currentFormatCapabilities(file)),
        formatCapabilities: currentFormatCapabilities(file),
        content: visibleViewerDocumentHtml(),
        reviewChanges: fileEditorReviewChanges(),
        versions: fileEditorVersions(file),
        sourceUrl: sourceUrl
      }
    };
  }

  function openCurrentFileInFileEditor() {
    var file = state.currentFile;
    if (!file || !file.id) {
      notify('No file is open to edit.', 'error');
      return;
    }
    if (!canOpenFileInEditor(file)) {
      notify(isOfficeEditFormat(file)
        ? 'This Office format is read-only because the server did not report edit-model support.'
        : 'This format is read-only. Convert it to DOCX before opening File Editor.', 'error');
      return;
    }
    var matterId = getCurrentMatterId() || '';
    Lex.Nav.go('file-editor.html', {
      params: { id: file.id, matter_id: matterId || null },
      context: {
        fileEditor: fileEditorHandoff(file),
        referrer: fileViewerRouteForFile(file) || targetBackRoute()
      }
    });
  }

  function targetBackRoute() {
    return normalizeBackReferrer(state.referrerPage) || fallbackBackReferrer();
  }

  function navigateBack() {
    if (state.metadataChanged) {
      if (!confirm('You have unsaved changes. Leave anyway?')) return;
    }
    var target = targetBackRoute();
    if (target) {
      Lex.Nav.go(target);
      return;
    }
    if (window.history && window.history.length > 1) {
      window.history.back();
      return;
    }
    Lex.Nav.go('dashboard.html');
  }

  function interceptShellBack(event) {
    if (!event) return;
    if (typeof event.preventDefault === 'function') event.preventDefault();
    if (typeof event.stopPropagation === 'function') event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    navigateBack();
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
      reviewBadge.textContent = 'Open in File Editor';
      reviewBadge.classList.remove('file-viewer-mode-badge--active');
      reviewBadge.classList.toggle('hidden', !reviewAvailable);
    });
    var subtitle = document.querySelector('.file-viewer-review-subtitle');
    if (subtitle) {
      subtitle.textContent = state.releaseComparison
        ? 'View / Version comparison'
        : (isReview ? 'Review / Redline active' : 'View / Read-only');
    }
  }

  function setReviewRailVisible(visible) {
    var rail = document.getElementById('reviewRail');
    if (rail) rail.classList.toggle('hidden', !visible);
    setCanvasModeDisplay(canOpenFileInEditor(state.currentFile));
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
    var revisions = liveEditorChangesShouldDisplay() && Array.isArray(next.revisions) ? next.revisions : null;
    var comments = Array.isArray(next.comments) ? next.comments : null;
    var selectedVersionChanges = selectedReviewReleaseChanges();
    var showingCurrentDraft = reviewDisplayScope() === 'current';
    var unreleasedChanges = unreleasedReviewChangesForDisplay(next);
    var pendingChangeCount = unreleasedChanges.length;
    var releasedChangeCount = state.releaseChangeGroups.reduce(function (total, group) {
      return total + displayReviewChanges(group.changes || []).length;
    }, 0);
    var displayedReleasedChangeCount = selectedVersionChanges ? displayReviewChanges(selectedVersionChanges).length : (showingCurrentDraft ? releasedChangeCount : 0);
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

  function reviewDisplayScope() {
    if (state.reviewDisplayTarget) return state.reviewDisplayTarget;
    if (state.selectedReviewReleaseId === 'original') return 'original';
    if (state.selectedReviewReleaseId) return 'release';
    return 'current';
  }

  function releaseChangeGroupForId(releaseId) {
    if (!releaseId) return null;
    for (var i = 0; i < state.releaseChangeGroups.length; i++) {
      if (state.releaseChangeGroups[i] && state.releaseChangeGroups[i].release_id === releaseId) {
        return state.releaseChangeGroups[i];
      }
    }
    return null;
  }

  function selectedReviewReleaseChanges() {
    if (reviewDisplayScope() !== 'release') return null;
    if (Array.isArray(state.releaseChangeHistory) && state.releaseChangeHistory.length) {
      return state.releaseChangeHistory;
    }
    var group = releaseChangeGroupForId(state.selectedReviewReleaseId);
    return group && Array.isArray(group.changes) ? group.changes : [];
  }

  function pendingReviewChangeCount() {
    currentReviewState();
    return unreleasedReviewChangesForDisplay().length;
  }

  function liveEditorChangesShouldDisplay() {
    return Boolean(state.reviewDirty && !state.reviewRestoring);
  }

  function liveEditorReviewDisplayChanges(reviewState) {
    if (!liveEditorChangesShouldDisplay()) return [];
    return displayReviewChanges(LanaDocumentReview.changesFromRevisions(
      unreleasedRawReviewRevisions(reviewState)
    ));
  }

  function unreleasedReviewChangesForDisplay(reviewState) {
    var liveChanges = liveEditorReviewDisplayChanges(reviewState);
    if (liveChanges.length) return liveChanges;
    return currentReviewBatchDisplayChanges();
  }

  function markReviewDirty(reviewState) {
    if (reviewState) {
      state.reviewState = reviewState;
    } else {
      currentReviewState();
    }
    if (state.reviewRestoring) {
      updateReviewRailCounts(state.reviewState || {});
      return;
    }
    state.currentReviewBatchRestoreFailed = false;
    state.reviewDirty = true;
    updateReviewRailCounts(state.reviewState || {});
  }

  function reviewItemLabel(type, item) {
    if (type === 'comments') return 'Comment';
    return LanaDocumentReview.changeLabel(item);
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
    if (operation === 'replace' || operation === 'replacement') return 'modified';
    if (operation === 'delete' || operation === 'del' || operation === 'remove' || operation === 'removed') return 'removed';
    if (operation === 'insert' || operation === 'ins' || operation === 'add' || operation === 'added') return 'added';
    if (change && change.original_text && change.proposed_text && change.original_text !== change.proposed_text) return 'modified';
    if (change && change.original_text && !change.proposed_text) return 'removed';
    return 'added';
  }

  // Change readers, grouping, and serialization are shared with File Editor
  // through LanaDocumentReview so both pages treat batch data identically.
  function reviewChangeOperation(change) {
    return LanaDocumentReview.reviewChangeOperation(change);
  }

  function isDeletionChange(change) {
    return LanaDocumentReview.isDeletionChange(change);
  }

  function isInsertionChange(change) {
    return LanaDocumentReview.isInsertionChange(change);
  }

  function changeOriginalText(change) {
    return LanaDocumentReview.changeOriginalText(change);
  }

  function changeProposedText(change) {
    return LanaDocumentReview.changeProposedText(change);
  }

  function sourceChangesForReviewChange(change) {
    return LanaDocumentReview.sourceChangesForReviewChange(change);
  }

  function reviewChangeIdentityKey(change) {
    return LanaDocumentReview.reviewChangeIdentityKey(change);
  }

  function displayReviewChanges(changes) {
    return LanaDocumentReview.displayReviewChanges(changes);
  }

  function revisionIdsForReviewChange(change) {
    return LanaDocumentReview.revisionIdsForReviewChange(change);
  }

  function editScriptOpsForReviewChange(change) {
    return LanaDocumentReview.editScriptOpsForReviewChange(change);
  }

  function liveRevisionChangesForReviewChange(change) {
    return LanaDocumentReview.liveRevisionChangesForChange(change, currentReviewState());
  }

  function editableOpsForReviewChange(change) {
    return LanaDocumentReview.editableOpsForChange(change, currentReviewState());
  }

  function firstEditableDraftOpForChange(change, nextText) {
    return LanaDocumentReview.firstEditableDraftOpForChange(change, nextText, currentReviewState());
  }

  function isReplacementReviewChange(change) {
    return LanaDocumentReview.isReplacementReviewChange(change);
  }

  function canEditDraftReviewChange(change) {
    return LanaDocumentReview.canEditDraftReviewChange(change, currentReviewState());
  }

  function ensureDraftReviewChangeCanBeEdited(change) {
    if (canEditDraftReviewChange(change)) return;
    throw new Error('This change cannot be edited directly. Revert it and create a new change instead.');
  }

  function inverseEditOpsForReleasedChange(change) {
    return LanaDocumentReview.inverseEditOpsForReleasedChange(change);
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

  function reviewChangeLanaPrompt(change) {
    return reviewChangeLanaSummary(change) + ' Review whether this tracked change is well-grounded and whether it creates legal or factual risk.';
  }

  function reviewChangeLanaSummary(change) {
    var original = truncateContextText(changeOriginalText(change) || '', 500);
    var proposed = truncateContextText(changeProposedText(change) || '', 500);
    var kind = reviewItemLabel('changes', change);
    if (original && proposed && original !== proposed) {
      return kind + ': replace "' + original + '" with "' + proposed + '".';
    }
    if (original) return kind + ': remove "' + original + '".';
    if (proposed) return kind + ': add "' + proposed + '".';
    return kind + ': ' + truncateContextText(reviewItemText(change) || 'No preview available', 500);
  }

  function reviewChangeLanaContext(change, index, options) {
    options = options || {};
    var file = state.currentFile || {};
    var matterId = getConversationMatterId(file) || null;
    var original = changeOriginalText(change);
    var proposed = changeProposedText(change);
    var summary = reviewChangeLanaSummary(change);
    return {
      type: 'tracked_change',
      context_type: 'tracked_change',
      name: reviewItemLabel('changes', change),
      ui_label: reviewItemLabel('changes', change),
      summary: summary,
      source: 'file_viewer_review_rail',
      change_index: index,
      change_section: options.unreleased ? 'unreleased' : 'released',
      status: reviewStatus(change, 'changes'),
      operation: change && (change.operation || change.type || null),
      original_text: truncateContextText(original || '', 2000),
      proposed_text: truncateContextText(proposed || '', 2000),
      preview_text: truncateContextText(reviewItemText(change) || '', 2000),
      revision: {
        text: summary,
        original_text: truncateContextText(original || '', 2000),
        proposed_text: truncateContextText(proposed || '', 2000),
        operation: change && (change.operation || change.type || null)
      },
      details: {
        original_text: truncateContextText(original || '', 2000),
        proposed_text: truncateContextText(proposed || '', 2000),
        change_summary: summary
      },
      anchor: change && change.anchor ? change.anchor : null,
      metadata: change && change.metadata ? change.metadata : {},
      document: {
        id: file.id || null,
        name: file.filename || 'Document',
        matter_id: matterId,
        content_type: file.content_type || file.mime_type || ''
      },
      page: {
        route: 'file-viewer',
        matter_id: matterId,
        document_id: file.id || null,
        document_name: file.filename || 'Document'
      }
    };
  }

  function renderReviewChangeLanaButton(change, index, options) {
    options = options || {};
    if (!change) return '';
    var file = state.currentFile || {};
    var matterId = getConversationMatterId(file) || '';
    var matterName = getFileMatterDisplayName(file) || '';
    var context = reviewChangeLanaContext(change, index, options);
    var prompt = reviewChangeLanaPrompt(change);
    return '<div class="file-viewer-review-history-row__lana">' +
      '<button type="button" class="lex-card-lana-talk file-viewer-review-history-row__lana-button" data-lana-dock-trigger' +
        ' data-lana-context-type="document_chat"' +
        ' data-lana-document-id="' + escapeHtml(file.id || '') + '"' +
        ' data-lana-document-name="' + escapeHtml(file.filename || 'Document') + '"' +
        (matterId ? ' data-lana-matter-id="' + escapeHtml(matterId) + '"' : '') +
        (matterName ? ' data-lana-matter-name="' + escapeHtml(matterName) + '"' : '') +
        ' data-lana-prefill="' + escapeHtml(prompt) + '"' +
        ' data-lana-card-context="' + escapeHtml(JSON.stringify(context)) + '">' +
        '<span class="lex-card-lana-icon" aria-hidden="true">' +
          '<svg width="8" height="8" viewBox="0 0 8 8"><path d="M0 0L8 0M0 0L0 8"/></svg>' +
          '<svg width="8" height="8" viewBox="0 0 8 8"><path d="M8 8L0 8M8 8L8 0"/></svg>' +
        '</span>' +
        '<span>Talk about this.</span>' +
      '</button>' +
    '</div>';
  }

  function editReviewChangeContent(change) {
    var value = changeProposedText(change) || '';
    return '<div class="file-viewer-edit-change-modal">' +
      '<p>Edit the proposed text for this unreleased change. LANA will replace the pending tracked change with a new tracked change at the same document location.</p>' +
      '<label class="file-viewer-edit-change-modal__label" for="reviewEditChangeText">Proposed text</label>' +
      '<textarea id="reviewEditChangeText" class="file-viewer-edit-change-modal__textarea" rows="6">' + escapeHtml(value) + '</textarea>' +
    '</div>';
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
    if (reviewDisplayScope() === 'original') return [];
    if (reviewDisplayScope() === 'release') {
      return state.reviewReleases
        .filter(function (release) { return release.id === state.selectedReviewReleaseId; })
        .map(releaseGroupForRelease);
    }
    return reviewReleasesNewestFirst().map(function (item) {
      return releaseGroupForRelease(item.release);
    });
  }

  function renderChangeHistory(editorItems) {
    var target = document.getElementById('reviewChangesList');
    if (!target) return;
    var groups = selectedReleaseGroups();
    var draftBatchChanges = currentReviewBatchDisplayChanges();
    var editorChanges = liveEditorReviewDisplayChanges({ revisions: editorItems || [] });
    // The unreleased working copy belongs to the document lineage, not to any
    // one version, so it stays visible whichever version is selected.
    var unreleasedChanges = editorChanges.length ? editorChanges : draftBatchChanges;
    if (!groups.length && !unreleasedChanges.length) {
      renderReviewList('changes', editorItems || []);
      return;
    }

    var filteredGroups = groups.map(function (group) {
      return {
        release: group.release,
        changes: filterHistoryChanges(displayReviewChanges(group.changes || []), group.release)
      };
    });
    var controls = groups.length ? renderHistoryFilters(groups) : '';
    function renderHistorySection(options) {
      var changes = Array.isArray(options.changes) ? options.changes : [];
      var rows = changes.length
        ? changes.map(function (change, index) {
            var badge = renderReviewStatusBadge(reviewStatus(change, 'changes'));
            var releaseAttr = options.releaseId ? ' data-review-history-release="' + escapeHtml(options.releaseId) + '"' : '';
            var focusIndex = change && change.anchor && Number.isFinite(Number(change.anchor.index)) ? Number(change.anchor.index) : index;
            var section = options.unreleased ? 'unreleased' : 'released';
            return '<div role="button" tabindex="0" class="file-viewer-review-history-row"' + releaseAttr + ' data-review-history-section="' + section + '" data-review-item-type="changes" data-review-item-index="' + focusIndex + '">' +
              '<span class="file-viewer-review-history-row__heading">' +
                '<span class="file-viewer-review-history-row__heading-main"><span class="file-viewer-review-history-row__title">' + escapeHtml(reviewItemLabel('changes', change)) + '</span>' + badge + '</span>' +
                '<span class="file-viewer-review-history-row__actions"></span>' +
              '</span>' +
              renderReviewChangeDiff(change) +
              renderReviewChangeLanaButton(change, index, options) +
            '</div>';
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

  function releaseSortValue(release) {
    var releaseNumber = Number(release && release.release_number);
    if (Number.isFinite(releaseNumber) && releaseNumber > 0) return releaseNumber;
    var releasedAt = release && release.released_at ? Date.parse(release.released_at) : 0;
    return Number.isFinite(releasedAt) ? releasedAt : 0;
  }

  function reviewReleasesNewestFirst() {
    var releases = Array.isArray(state.reviewReleases) ? state.reviewReleases : [];
    return releases
      .map(function (release, index) {
        return { release: release, index: index };
      })
      .sort(function (a, b) {
        return releaseSortValue(b.release) - releaseSortValue(a.release);
      });
  }

  function releaseIsSelected(release) {
    return Boolean(release && state.selectedReviewReleaseId && release.id === state.selectedReviewReleaseId);
  }

  function originalVersionIsSelected() {
    return state.selectedReviewReleaseId === 'original';
  }

  function versionIdentityForOriginal() {
    return {
      key: 'original',
      documentId: originalVersionDocumentId(),
      label: 'Original',
      releaseId: 'original',
      changes: []
    };
  }

  function versionIdentityForRelease(release) {
    if (!release) return null;
    return {
      key: release.id,
      releaseId: release.id,
      documentId: releaseDocumentId(release),
      label: release.released_document_filename || ('Version ' + release.release_number),
      release: release,
      changes: []
    };
  }

  function versionCompareSelectionIndex(key) {
    var selections = Array.isArray(state.versionCompareSelections) ? state.versionCompareSelections : [];
    for (var i = 0; i < selections.length; i++) {
      if (selections[i] && selections[i].key === key) return i;
    }
    return -1;
  }

  function versionCompareSelectionClass(key) {
    var index = versionCompareSelectionIndex(key);
    if (index === 0) return ' file-viewer-review-release--base';
    if (index === 1) return ' file-viewer-review-release--comparison';
    return '';
  }

  function selectedReleaseLabel() {
    if (originalVersionIsSelected()) return 'Original';
    for (var i = 0; i < state.reviewReleases.length; i++) {
      var release = state.reviewReleases[i];
      if (releaseIsSelected(release)) {
        return release.released_document_filename || ('Version ' + release.release_number);
      }
    }
    return '';
  }

  function selectedReviewRelease() {
    if (reviewDisplayScope() !== 'release') return null;
    var releases = Array.isArray(state.reviewReleases) ? state.reviewReleases : [];
    for (var i = 0; i < releases.length; i++) {
      if (releaseIsSelected(releases[i])) return releases[i];
    }
    return null;
  }

  function parentReleaseForRelease(release) {
    if (!release) return null;
    var releaseNumber = Number(release.release_number || 0);
    var releases = Array.isArray(state.reviewReleases) ? state.reviewReleases : [];
    var parent = null;
    for (var i = 0; i < releases.length; i++) {
      var candidate = releases[i];
      var candidateNumber = Number(candidate && candidate.release_number || 0);
      if (!releaseDocumentId(candidate)) continue;
      if (releaseNumber > 0 && candidateNumber >= releaseNumber) continue;
      if (!parent || candidateNumber > Number(parent.release_number || 0)) parent = candidate;
    }
    return parent;
  }

  function parentDocumentIdForRelease(release) {
    var parent = parentReleaseForRelease(release);
    return releaseDocumentId(parent) || originalVersionDocumentId();
  }

  function reviewVersionSelectValueForRelease(release) {
    return release && release.id ? 'release:' + release.id : '';
  }

  function hasCurrentDraftReviewChanges() {
    if (state.reviewDirty) return true;
    return unreleasedReviewChangesForDisplay(state.reviewState || {}).length > 0;
  }

  function hasUnreleasedWorkingCopy() {
    if (hasCurrentDraftReviewChanges()) return true;
    if (state.currentReviewBatchRestoreFailed) return false;
    return Boolean(state.currentReviewBatch
      && isActiveReviewDraftBatch(state.currentReviewBatch)
      && Array.isArray(state.currentReviewBatch.changes)
      && state.currentReviewBatch.changes.length > 0);
  }

  function reviewVersionSelectOptions() {
    var options = [{
      value: 'original',
      label: 'Original',
      description: 'Source document',
      group: 'Document'
    }, {
      value: 'current',
      label: 'Current draft',
      description: hasCurrentDraftReviewChanges() ? 'Live unreleased edits' : 'Current document view',
      group: 'Working copy'
    }];
    var releases = reviewReleasesNewestFirst();
    for (var i = 0; i < releases.length; i++) {
      var release = releases[i].release;
      var label = release.released_document_filename || ('Version ' + release.release_number);
      var releasedAt = release.released_at ? formatDate(release.released_at) : '';
      options.push({
        value: reviewVersionSelectValueForRelease(release),
        label: label,
        description: 'Version ' + (release.release_number || '') + (releasedAt ? ' · ' + releasedAt : ''),
        group: 'Versions'
      });
    }
    return options;
  }

  function currentReviewVersionSelectValue() {
    if (state.reviewDisplayTarget === 'current') return 'current';
    if (state.reviewDisplayTarget === 'original') return 'original';
    var releases = Array.isArray(state.reviewReleases) ? state.reviewReleases : [];
    for (var i = 0; i < releases.length; i++) {
      if (releaseIsSelected(releases[i])) return reviewVersionSelectValueForRelease(releases[i]);
    }
    if (hasCurrentDraftReviewChanges()) return 'current';
    var currentFileId = state.currentFile && state.currentFile.id ? String(state.currentFile.id) : '';
    var originalId = originalVersionDocumentId();
    if (currentFileId && originalId && currentFileId === String(originalId)) {
      return 'original';
    }
    for (i = 0; i < releases.length; i++) {
      var release = releases[i];
      var documentId = releaseDocumentId(release);
      if (currentFileId && documentId && currentFileId === String(documentId)) {
        return reviewVersionSelectValueForRelease(release);
      }
    }
    return originalId ? 'original' : '';
  }

  function selectReviewDisplayScope(scope, release) {
    state.versionCompareMode = false;
    state.versionCompareSelections = [];
    state.releaseComparison = null;
    state.releaseComparisonLoading = false;
    if (scope === 'original') {
      state.showTrackedChanges = false;
      forceReadOnlyDisplayMode();
      state.reviewDisplayTarget = 'original';
      state.selectedReviewReleaseId = 'original';
      state.selectedReviewReleaseDocumentId = originalVersionDocumentId();
      state.releaseChangeHistory = [];
      return;
    }
    if (scope === 'release' && release) {
      state.showTrackedChanges = false;
      forceReadOnlyDisplayMode();
      state.reviewDisplayTarget = 'release';
      state.selectedReviewReleaseId = release.id || null;
      state.selectedReviewReleaseDocumentId = releaseDocumentId(release);
      var group = releaseChangeGroupForId(release.id);
      state.releaseChangeHistory = group && Array.isArray(group.changes) ? group.changes : [];
      return;
    }
    state.showTrackedChanges = true;
    state.reviewDisplayTarget = 'current';
    state.selectedReviewReleaseId = null;
    state.selectedReviewReleaseDocumentId = null;
    state.releaseChangeHistory = [];
  }

  function refreshReviewDisplayScope() {
    restorePrimaryViewerSurface();
    applyTrackedChangesDisplay();
    renderReviewWorkflow();
    updateReviewRailCounts(state.reviewState || {});
  }

  async function showSelectedReleaseChangesFromParent() {
    var release = selectedReviewRelease();
    var comparisonDocumentId = releaseDocumentId(release);
    var baseDocumentId = parentDocumentIdForRelease(release);
    if (!release || !comparisonDocumentId || !baseDocumentId) {
      notify('This version cannot be compared to a parent document.', 'error');
      state.showTrackedChanges = false;
      applyTrackedChangesDisplay();
      return;
    }
    state.releaseComparison = null;
    state.releaseComparisonLoading = true;
    renderReviewWorkflow('Loading changes for ' + (release.released_document_filename || 'selected version') + '...');
    showLoading();
    try {
      var comparisonResponse = await api.post(
        reviewEndpoint('/documents/' + encodeURIComponent(baseDocumentId) + '/compare'),
        { comparison_document_id: comparisonDocumentId }
      );
      state.releaseComparison = comparisonResponse && comparisonResponse.data ? comparisonResponse.data : comparisonResponse;
      renderDiffComparison(state.releaseComparison);
    } catch (error) {
      console.error('[FileViewerPage] Version parent comparison failed:', error);
      notify((error && error.message) || 'Failed to show changes for selected version', 'error');
      state.showTrackedChanges = false;
      restorePrimaryViewerSurface();
      applyTrackedChangesDisplay();
    } finally {
      state.releaseComparisonLoading = false;
      renderReviewWorkflow();
    }
  }

  async function setTrackedChangesDisplay(enabled) {
    if (reviewDisplayScope() === 'original') {
      state.showTrackedChanges = false;
      state.releaseComparison = null;
      state.releaseComparisonLoading = false;
      restorePrimaryViewerSurface();
      applyTrackedChangesDisplay();
      renderReviewWorkflow();
      return;
    }
    state.showTrackedChanges = Boolean(enabled);
    if (state.showTrackedChanges && reviewDisplayScope() === 'release') {
      await showSelectedReleaseChangesFromParent();
      return;
    }
    state.releaseComparison = null;
    state.releaseComparisonLoading = false;
    restorePrimaryViewerSurface();
    applyTrackedChangesDisplay();
    renderReviewWorkflow();
  }

  function syncReviewVersionSelect() {
    var select = document.getElementById('viewerVersionSelect');
    if (!select) return;
    select.options = reviewVersionSelectOptions();
    select.value = currentReviewVersionSelectValue();
  }

  async function restoreCurrentDraftForDisplay() {
    selectReviewDisplayScope('current');
    if (state.currentReviewBatch && state.currentReviewBatch.id && state.editorInstance) {
      try {
        if (!Array.isArray(state.currentReviewBatch.changes)) {
          var draftResponse = await api.get(reviewEndpoint('/document-edit-batches/' + encodeURIComponent(state.currentReviewBatch.id)));
          state.currentReviewBatch = draftResponse && draftResponse.data ? draftResponse.data : draftResponse;
        }
        state.currentReviewBatchRestoreFailed = false;
      } catch (error) {
        console.warn('[FileViewerPage] Current draft detail load failed:', error);
        state.currentReviewBatchRestoreFailed = true;
      }
    }
    state.reviewState = currentReviewState();
    refreshReviewDisplayScope();
  }

  async function openReviewVersionFromSelect(value) {
    if (!value) return;
    if (value === 'current') {
      await restoreCurrentDraftForDisplay();
      return;
    }
    if (value === 'original') {
      selectReviewDisplayScope('original');
      if (state.editorInstance) {
        refreshReviewDisplayScope();
        return;
      }
      await openVersionDocument(originalVersionDocumentId(), {
        scope: 'original'
      });
      return;
    }
    if (value.indexOf('release:') !== 0) return;
    var releaseId = value.slice('release:'.length);
    var releases = Array.isArray(state.reviewReleases) ? state.reviewReleases : [];
    var release = releases.find(function (item) { return item && item.id === releaseId; });
    if (!release) return;
    selectReviewDisplayScope('release', release);
    await openVersionDocument(releaseDocumentId(release), {
      scope: 'release',
      release: release
    });
    state.showTrackedChanges = false;
    state.releaseComparison = null;
    state.releaseComparisonLoading = false;
    refreshReviewDisplayScope();
  }

  function latestReviewRelease() {
    var releases = Array.isArray(state.reviewReleases) ? state.reviewReleases : [];
    var latest = null;
    for (var i = 0; i < releases.length; i++) {
      var release = releases[i];
      if (!releaseDocumentId(release)) continue;
      if (!latest || Number(release.release_number || 0) > Number(latest.release_number || 0)) {
        latest = release;
      }
    }
    return latest;
  }

  function releaseForCurrentFile(file) {
    var currentFileId = file && file.id ? String(file.id) : '';
    if (!currentFileId) return null;
    var releases = Array.isArray(state.reviewReleases) ? state.reviewReleases : [];
    for (var i = 0; i < releases.length; i++) {
      var documentId = releaseDocumentId(releases[i]);
      if (documentId && currentFileId === String(documentId)) return releases[i];
    }
    return null;
  }

  function originalVersionDocumentId() {
    if (state.reviewSourceDocumentId) return state.reviewSourceDocumentId;
    var latest = latestReviewRelease();
    if (latest && latest.source_document_id) return latest.source_document_id;
    return state.currentFile && state.currentFile.id ? state.currentFile.id : '';
  }

  function openLatestReleasedDocumentIfAvailable(file) {
    if (shouldHonorExplicitVersionView(file)) return false;
    if (isReleasedArtifactFile(file) || releaseForCurrentFile(file)) return false;
    var latest = latestReviewRelease();
    var documentId = releaseDocumentId(latest);
    if (!file || !documentId || String(file.id) === String(documentId)) return false;
    var params = new URLSearchParams({ id: documentId });
    Lex.Nav.go('file-viewer.html?' + params.toString(), {
      context: fileViewerNavContext(file)
    });
    return true;
  }

  function shouldHonorExplicitVersionView(file) {
    if (!state.explicitVersionView) return false;
    var currentFileId = file && file.id ? String(file.id) : '';
    var originalId = originalVersionDocumentId();
    return !(currentFileId && originalId && currentFileId === String(originalId));
  }

  function selectInitialReviewDisplay(file) {
    if (shouldHonorExplicitVersionView(file) || state.reviewDisplayTarget) return false;
    var openedRelease = releaseForCurrentFile(file);
    if (openedRelease) {
      selectReviewDisplayScope('release', openedRelease);
      return false;
    }
    if (hasUnreleasedWorkingCopy()) {
      selectReviewDisplayScope('current');
      return false;
    }
    return openLatestReleasedDocumentIfAvailable(file);
  }

  function normalizedDiffText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function fallbackReviewChangesForDiff() {
    var changes = Array.isArray(state.releaseChangeHistory) && state.releaseChangeHistory.length
      ? state.releaseChangeHistory
      : selectedReviewReleaseChanges();
    return displayReviewChanges(changes || []).filter(function (change) {
      return Boolean(changeOriginalText(change) && changeProposedText(change));
    });
  }

  function formattingReviewChangesForDiff() {
    var changes = Array.isArray(state.releaseChangeHistory) && state.releaseChangeHistory.length
      ? state.releaseChangeHistory
      : selectedReviewReleaseChanges();
    return displayReviewChanges(changes || []).filter(function (change) {
      return LanaDocumentReview.isFormattingChange(change) &&
        Boolean(changeOriginalText(change) || changeProposedText(change));
    });
  }

  function renderFormattingComparison(changes) {
    if (!Array.isArray(changes) || !changes.length) return '';
    return '<section class="file-viewer-format-diff" aria-label="Formatting changes">' +
      '<h5>Formatting changes</h5>' +
      changes.map(function (change) {
        return '<div class="file-viewer-format-diff__change">' +
          '<span class="file-viewer-format-diff__label">' + escapeHtml(LanaDocumentReview.changeLabel(change)) + '</span>' +
          '<span class="file-viewer-diff-part file-viewer-diff-part--removed">' + escapeHtml(changeOriginalText(change) || 'Default / inherited') + '</span>' +
          '<span class="file-viewer-format-diff__arrow" aria-hidden="true">→</span>' +
          '<span class="file-viewer-diff-part file-viewer-diff-part--added">' + escapeHtml(changeProposedText(change) || 'Default / inherited') + '</span>' +
          '</div>';
      }).join('') +
      '</section>';
  }

  function proposedTextForBlankAddedDiffPart(previousRemovedText, fallbackChanges, usedIndexes) {
    var normalizedRemoved = normalizedDiffText(previousRemovedText);
    if (!normalizedRemoved) return '';
    for (var i = 0; i < fallbackChanges.length; i++) {
      if (usedIndexes.indexOf(i) !== -1) continue;
      var change = fallbackChanges[i];
      var proposed = changeProposedText(change);
      if (!normalizedDiffText(proposed)) continue;
      if (normalizedDiffText(changeOriginalText(change)) !== normalizedRemoved) continue;
      usedIndexes.push(i);
      return proposed;
    }
    return '';
  }

  function renderDiffComparisonBody(parts) {
    var formattingChanges = formattingReviewChangesForDiff();
    var formattingHtml = renderFormattingComparison(formattingChanges);
    if (!parts.length) {
      return formattingHtml || '<p class="file-viewer-review-releases__empty">No textual or formatting differences detected.</p>';
    }
    var fallbackChanges = fallbackReviewChangesForDiff();
    var usedFallbackIndexes = [];
    var previousRemovedText = '';
    var rendered = parts.map(function (part) {
      var kind = part.kind === 'added' || part.kind === 'removed' ? part.kind : 'unchanged';
      var text = String(part.text || '');
      if (kind === 'added' && !normalizedDiffText(text)) {
        text = proposedTextForBlankAddedDiffPart(previousRemovedText, fallbackChanges, usedFallbackIndexes);
      }
      previousRemovedText = kind === 'removed' ? text : '';
      if (!normalizedDiffText(text) && kind !== 'unchanged') return '';
      return '<span class="file-viewer-diff-part file-viewer-diff-part--' + kind + '">' + escapeHtml(text) + '</span>';
    }).join('');
    return (rendered || '<p class="file-viewer-review-releases__empty">No textual differences detected.</p>') + formattingHtml;
  }

  function renderDiffComparison(comparison) {
    var target = document.getElementById('viewerDiff');
    if (!target) return;
    var parts = Array.isArray(comparison && comparison.parts) ? comparison.parts : [];
    var originalName = comparison && comparison.original_document ? comparison.original_document.filename : 'Source document';
    var newName = comparison && comparison.new_document ? comparison.new_document.filename : 'Selected version';
    var textChangeCount = comparison && Number(comparison.changes || 0);
    var formattingChangeCount = formattingReviewChangesForDiff().length;
    var meta = textChangeCount + ' changed segment' + (textChangeCount === 1 ? '' : 's') +
      (formattingChangeCount ? ' · ' + formattingChangeCount + ' formatting change' + (formattingChangeCount === 1 ? '' : 's') : '');
    var body = renderDiffComparisonBody(parts);

    target.innerHTML =
      '<div class="file-viewer-diff-header">' +
        '<div>' +
          '<h4 class="file-viewer-diff-title">' + escapeHtml(originalName || 'Source document') + ' vs ' + escapeHtml(newName || 'Selected version') + '</h4>' +
          '<p class="file-viewer-diff-meta">' + escapeHtml(meta) + '</p>' +
        '</div>' +
      '</div>' +
      '<div class="file-viewer-diff-document">' + body + '</div>';
    hideAllViewers();
    setViewerDocumentCardVisible(true);
    setViewerDisplayControlsVisible(Boolean(state.editorInstance));
    target.classList.remove('hidden');
  }

  function setViewerDocumentCardVisible(visible) {
    var card = document.getElementById('viewerDocumentCard');
    if (card) card.classList.toggle('hidden', !visible);
  }

  function setViewerDisplayControlsVisible(visible) {
    var controls = document.getElementById('viewerDisplayControls');
    if (controls) controls.classList.toggle('hidden', !visible);
  }

  function applyTrackedChangesDisplay() {
    var host = document.getElementById('viewerEditor');
    var toggle = document.getElementById('viewerChangeDisplayToggle');
    if (host) {
      var isOriginalScope = reviewDisplayScope() === 'original';
      host.classList.toggle('file-viewer-editor-host--final', !state.showTrackedChanges && !isOriginalScope);
      host.classList.toggle('file-viewer-editor-host--original', isOriginalScope);
    }
    if (toggle) {
      var isOriginal = reviewDisplayScope() === 'original';
      toggle.checked = Boolean(state.showTrackedChanges && !isOriginal);
      toggle.disabled = isOriginal;
      var toggleLabel = toggle.closest ? toggle.closest('.file-viewer-change-toggle') : null;
      if (toggleLabel) {
        toggleLabel.classList.toggle('file-viewer-change-toggle--disabled', isOriginal);
        toggleLabel.title = isOriginal ? 'Original has no tracked changes to display.' : '';
      }
    }
    syncReviewVersionSelect();
    if (state.editorInstance && !state.releaseComparison) setViewerDocumentCardVisible(true);
    setViewerDisplayControlsVisible(Boolean(state.editorInstance && !state.releaseComparison));
  }

  function restorePrimaryViewerSurface() {
    var diff = document.getElementById('viewerDiff');
    if (diff) diff.classList.add('hidden');
    var editorEl = document.getElementById('viewerEditor');
    if (editorEl && state.editorInstance) {
      setViewerDocumentCardVisible(true);
      editorEl.classList.remove('hidden');
      applyTrackedChangesDisplay();
      hideLoading();
      return;
    }
    var visibleFallback = ['viewerText', 'viewerImage', 'viewerIframe', 'viewerDocx'].some(function (id) {
      var el = document.getElementById(id);
      return el && !el.classList.contains('hidden');
    });
    if (visibleFallback) hideLoading();
  }

  async function clearReleaseComparison() {
    state.selectedReviewReleaseId = null;
    state.selectedReviewReleaseDocumentId = null;
    state.releaseChangeHistory = [];
    state.releaseComparison = null;
    state.releaseComparisonLoading = false;
    renderReviewWorkflow();
    setReviewTab('releases');
    if (state.currentFile) {
      await loadFileContent(state.currentFile);
    }
  }

  function applyReviewDisplayScopeAfterLoad(options) {
    options = options || {};
    if (options.scope === 'original') {
      selectReviewDisplayScope('original');
    } else if (options.scope === 'release' && options.release) {
      selectReviewDisplayScope('release', options.release);
    } else if (options.scope === 'current') {
      selectReviewDisplayScope('current');
    }
    refreshReviewDisplayScope();
  }

  async function openVersionDocument(documentId, options) {
    if (!documentId) return;
    var suppressDraftRestore = Boolean(options && (options.scope === 'original' || options.scope === 'release'));
    var previousSuppress = state.suppressReviewDraftRestoreForLoad;
    state.suppressReviewDraftRestoreForLoad = suppressDraftRestore;
    if (suppressDraftRestore) {
      state.explicitVersionView = true;
    }
    if (state.currentFile && String(state.currentFile.id) === String(documentId)) {
      try {
        if (suppressDraftRestore) {
          await loadFileContent(state.currentFile);
        }
        applyReviewDisplayScopeAfterLoad(options);
      } finally {
        state.suppressReviewDraftRestoreForLoad = previousSuppress;
      }
      return;
    }
    var params = new URLSearchParams({ id: documentId, version_view: '1' });
    state.fileId = documentId;
    state.explicitVersionView = true;
    if (window.history && typeof window.history.pushState === 'function') {
      window.history.pushState({}, '', 'file-viewer.html?' + params.toString());
    }
    try {
      await loadFile(documentId);
      applyReviewDisplayScopeAfterLoad(options);
    } finally {
      state.suppressReviewDraftRestoreForLoad = previousSuppress;
    }
  }

  async function changesForRelease(release) {
    if (!release || !release.edit_batch_id) return [];
    try {
      var batchResponse = await api.get(reviewEndpoint('/document-edit-batches/' + encodeURIComponent(release.edit_batch_id)));
      var batch = batchResponse && batchResponse.data ? batchResponse.data : batchResponse;
      return Array.isArray(batch && batch.changes) ? batch.changes : [];
    } catch (error) {
      console.warn('[FileViewerPage] Release change history unavailable:', error);
      return [];
    }
  }

  async function runVersionComparison() {
    var selections = Array.isArray(state.versionCompareSelections) ? state.versionCompareSelections : [];
    if (selections.length !== 2) return;
    var base = selections[0];
    var comparison = selections[1];
    if (!base.documentId || !comparison.documentId) {
      notify('Both selected versions must have documents before comparison.', 'error');
      return;
    }
    state.selectedReviewReleaseId = comparison.key;
    state.selectedReviewReleaseDocumentId = comparison.documentId;
    state.releaseChangeHistory = Array.isArray(comparison.changes) ? comparison.changes : [];
    state.releaseComparison = null;
    state.releaseComparisonLoading = true;
    renderReviewWorkflow('Comparing ' + base.label + ' with ' + comparison.label + '...');
    setReviewTab('releases');
    showLoading();
    try {
      var comparisonResponse = await api.post(
        reviewEndpoint('/documents/' + encodeURIComponent(base.documentId) + '/compare'),
        { comparison_document_id: comparison.documentId }
      );
      state.releaseComparison = comparisonResponse && comparisonResponse.data ? comparisonResponse.data : comparisonResponse;
      renderDiffComparison(state.releaseComparison);
    } catch (error) {
      console.error('[FileViewerPage] Version comparison failed:', error);
      notify((error && error.message) || 'Failed to compare selected versions', 'error');
      hideLoading();
      var editorEl = document.getElementById('viewerEditor');
      if (editorEl && state.editorInstance) editorEl.classList.remove('hidden');
    } finally {
      state.releaseComparisonLoading = false;
      renderReviewWorkflow();
    }
  }

  async function selectVersionForCompare(identity) {
    if (!identity || !identity.key) return;
    var selections = Array.isArray(state.versionCompareSelections) ? state.versionCompareSelections.slice() : [];
    var existingIndex = selections.findIndex(function (item) { return item && item.key === identity.key; });
    if (existingIndex >= 0) {
      selections.splice(existingIndex, 1);
      state.versionCompareSelections = selections;
      state.selectedReviewReleaseId = selections.length === 1 ? selections[0].key : null;
      state.selectedReviewReleaseDocumentId = selections.length === 1 ? selections[0].documentId : null;
      state.releaseComparison = null;
      renderReviewWorkflow();
      restorePrimaryViewerSurface();
      return;
    }
    if (selections.length >= 2) {
      notify('Select at most two versions to compare. Unselect one before adding another.', 'error');
      return;
    }
    if (identity.release) {
      identity.changes = await changesForRelease(identity.release);
    }
    selections.push(identity);
    state.versionCompareSelections = selections;
    state.selectedReviewReleaseId = identity.key;
    state.selectedReviewReleaseDocumentId = identity.documentId;
    renderReviewWorkflow();
    if (selections.length === 2) {
      await runVersionComparison();
    }
  }

  async function toggleVersionCompareMode(enabled) {
    state.versionCompareMode = Boolean(enabled);
    state.versionCompareSelections = [];
    state.selectedReviewReleaseId = null;
    state.selectedReviewReleaseDocumentId = null;
    state.releaseChangeHistory = [];
    state.releaseComparison = null;
    renderReviewWorkflow();
    setReviewTab('releases');
    restorePrimaryViewerSurface();
  }

  async function compareCurrentDocumentAgainst(target) {
    target = target || {};
    var documentId = target.documentId;
    if (!documentId) {
      notify('This version does not have an attached document.', 'error');
      return;
    }
    if (state.currentFile && String(state.currentFile.id) === String(documentId)) {
      await clearReleaseComparison();
      return;
    }

    state.selectedReviewReleaseId = target.selectionId || documentId;
    state.selectedReviewReleaseDocumentId = documentId;
    state.releaseChangeHistory = Array.isArray(target.changes) ? target.changes : [];
    state.releaseComparison = null;
    state.releaseComparisonLoading = true;
    renderReviewWorkflow('Loading ' + (target.label || 'selected version') + '...');
    setReviewTab('releases');
    showLoading();

    try {
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

  async function selectOriginalForComparison() {
    await compareCurrentDocumentAgainst({
      selectionId: 'original',
      documentId: originalVersionDocumentId(),
      label: 'original document',
      changes: []
    });
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

    var changes = [];
    if (release.edit_batch_id) {
      try {
        var batchResponse = await api.get(reviewEndpoint('/document-edit-batches/' + encodeURIComponent(release.edit_batch_id)));
        var batch = batchResponse && batchResponse.data ? batchResponse.data : batchResponse;
        changes = Array.isArray(batch && batch.changes) ? batch.changes : [];
      } catch (error) {
        console.warn('[FileViewerPage] Release change history unavailable:', error);
      }
    }
    await compareCurrentDocumentAgainst({
      selectionId: release.id,
      documentId: documentId,
      label: release.released_document_filename || ('Version ' + release.release_number),
      changes: changes
    });
  }

  async function deleteReviewRelease(index) {
    var release = state.reviewReleases && state.reviewReleases[index];
    if (!release || !release.id) return;
    var label = release.released_document_filename || ('Version ' + release.release_number);
    var run = async function () {
      try {
        var response = await api.delete(reviewEndpoint('/document-version-releases/' + encodeURIComponent(release.id)));
        var data = response && response.data ? response.data : response;
        var nextDocumentId = data && data.next_document_id;
        notify('Deleted ' + label, 'success');
        if (nextDocumentId) {
          var params = new URLSearchParams({ id: nextDocumentId });
          Lex.Nav.go('file-viewer.html?' + params.toString(), {
            context: fileViewerNavContext(state.currentFile)
          });
          return;
        }
        if (state.currentFile) await loadReviewWorkflow(state.currentFile);
      } catch (error) {
        console.error('[FileViewerPage] Delete release failed:', error);
        notify((error && error.message) || 'Failed to delete version', 'error');
      }
    };
    var content = '<div class="file-viewer-release-confirm">' +
      '<div class="file-viewer-release-confirm__hero">' +
        '<span class="file-viewer-release-confirm__eyebrow">Delete version</span>' +
        '<strong>' + escapeHtml('Version ' + (release.release_number || '')) + '</strong>' +
      '</div>' +
      '<p class="file-viewer-release-confirm__note">' +
        '<strong>' + escapeHtml(label) + '</strong><br>' +
        'This removes the released document from the active workspace versions. The immutable release record remains for audit, and the viewer will roll back to the previous version or original document.' +
      '</p>' +
    '</div>';
    if (typeof Lex !== 'undefined' && Lex.Modal && typeof Lex.Modal.open === 'function') {
      Lex.Modal.open({
        heading: 'Delete Version',
        size: 'md',
        content: content,
        confirmText: 'Delete Version',
        cancelText: 'Cancel',
        variant: 'danger',
        onConfirm: run
      });
    } else if (window.confirm('Delete ' + label + '?')) {
      run();
    }
  }

  async function acceptBaselineRevisionsForReviewMode() {
    if (!state.editorInstance || typeof state.editorInstance.decide !== 'function') return;
    if (state.reviewBaselineAcceptedForReview) return;
    var ids = Array.isArray(state.reviewBaselineRevisionIds)
      ? state.reviewBaselineRevisionIds.filter(Boolean)
      : [];
    if (!ids.length) return;
    var wasRestoring = state.reviewRestoring;
    var wasDirty = state.reviewDirty;
    state.reviewRestoring = true;
    try {
      await state.editorInstance.decide({
        decisions: ids.map(function (id) {
          return { id: id, action: 'accept' };
        })
      });
      state.reviewBaselineAcceptedForReview = true;
      state.reviewBaselineRevisionIds = [];
      state.reviewBaselineRevisionKeyCounts = {};
      state.reviewState = currentReviewState();
      state.reviewDirty = wasDirty;
      updateReviewRailCounts(state.reviewState || {});
      applyTrackedChangesDisplay();
    } catch (error) {
      console.warn('[FileViewerPage] Baseline revision acceptance failed:', error);
    } finally {
      state.reviewRestoring = wasRestoring;
    }
  }

  async function setEditorInteractionMode(mode) {
    var nextMode = 'view';
    state.editorMode = nextMode;
    if (state.editorInstance && typeof state.editorInstance.setMode === 'function') {
      state.editorInstance.setMode(nextMode);
    }
    setCanvasModeDisplay(Boolean(state.editorInstance));
  }

  function forceReadOnlyDisplayMode() {
    state.editorMode = 'view';
    if (state.editorInstance && typeof state.editorInstance.setMode === 'function') {
      try {
        state.editorInstance.setMode('view');
      } catch (error) {
        console.warn('[FileViewerPage] Read-only display mode update failed:', error);
      }
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

  function currentUnreleasedDisplayChanges() {
    var reviewState = currentReviewState();
    var revisions = unreleasedRawReviewRevisions(reviewState);
    if (revisions.length) return displayReviewChanges(revisions);
    return currentReviewBatchDisplayChanges();
  }

  function reviewHistoryChangeForRevert(section, index, releaseId) {
    var displayIndex = Number(index);
    if (!Number.isFinite(displayIndex) || displayIndex < 0) return null;
    var changes = section === 'released'
      ? releasedDisplayChangesForReleaseId(releaseId)
      : currentUnreleasedDisplayChanges();
    return changes[displayIndex] || null;
  }

  function reviewChangePreviewText(change) {
    if (!change) return 'This tracked change';
    var original = changeOriginalText(change);
    var proposed = changeProposedText(change);
    if (original && proposed && original !== proposed) return original + ' -> ' + proposed;
    return proposed || original || reviewItemText(change) || 'This tracked change';
  }

  function reviewRevertConfirmationContent(change, section) {
    var title = section === 'released' ? 'Create Revert Draft' : 'Revert Draft Change';
    var explanation = section === 'released'
      ? 'Released versions are immutable. LANA will stage an inverse edit as a new unreleased change when the stored edit data can be safely reversed.'
      : 'This removes the tracked change from the current review draft and updates the saved draft.';
    return '<div class="file-viewer-revert-confirm">' +
      '<div class="file-viewer-revert-confirm__hero">' +
        '<span>' + escapeHtml(title) + '</span>' +
        '<strong>' + escapeHtml(reviewItemLabel('changes', change)) + '</strong>' +
      '</div>' +
      '<p>' + escapeHtml(explanation) + '</p>' +
      '<div class="file-viewer-revert-confirm__preview">' + escapeHtml(reviewChangePreviewText(change)) + '</div>' +
    '</div>';
  }

  function confirmReviewHistoryChangeRevert(section, index, releaseId) {
    var change = reviewHistoryChangeForRevert(section, index, releaseId);
    if (!change) return;
    var title = section === 'released' ? 'Revert Released Change' : 'Revert Draft Change';
    var confirmText = section === 'released' ? 'Create Revert Draft' : 'Revert Change';
    var run = function () {
      revertReviewHistoryChange(section, index, releaseId).catch(function (error) {
        console.error('[FileViewerPage] Revert review change failed:', error);
        notify((error && error.message) || 'Failed to revert review change', 'error');
      });
    };
    if (typeof Lex !== 'undefined' && Lex.Modal && typeof Lex.Modal.open === 'function') {
      Lex.Modal.open({
        heading: title,
        size: 'sm',
        content: reviewRevertConfirmationContent(change, section),
        confirmText: confirmText,
        cancelText: 'Cancel',
        variant: section === 'released' ? 'default' : 'danger',
        onConfirm: run
      });
      return;
    }
    if (typeof Lex !== 'undefined' && Lex.Modal && typeof Lex.Modal.confirm === 'function') {
      Lex.Modal.confirm(title, reviewChangePreviewText(change), run, {
        confirmText: confirmText,
        variant: section === 'released' ? 'default' : 'danger'
      });
      return;
    }
    if (window.confirm(title + '?\n\n' + reviewChangePreviewText(change))) run();
  }

  function confirmReviewHistoryChangeEdit(index) {
    var change = reviewHistoryChangeForRevert('unreleased', index, null);
    try {
      ensureDraftReviewChangeCanBeEdited(change);
    } catch (error) {
      notify((error && error.message) || 'This change cannot be edited directly. Revert it and create a new change instead.', 'error');
      return;
    }
    var run = function () {
      var input = document.getElementById('reviewEditChangeText');
      var nextText = input && typeof input.value === 'string' ? input.value : '';
      editUnreleasedReviewChange(change, nextText).catch(function (error) {
        console.error('[FileViewerPage] Edit review change failed:', error);
        notify((error && error.message) || 'Failed to edit review change', 'error');
      });
    };
    if (typeof Lex !== 'undefined' && Lex.Modal && typeof Lex.Modal.open === 'function') {
      var modal = Lex.Modal.open({
        heading: 'Edit Draft Change',
        size: 'md',
        content: editReviewChangeContent(change),
        confirmText: 'Update Change',
        cancelText: 'Cancel',
        onConfirm: run
      });
      setTimeout(function () {
        var input = modal && modal.querySelector ? modal.querySelector('#reviewEditChangeText') : document.getElementById('reviewEditChangeText');
        if (input && typeof input.focus === 'function') input.focus();
      }, 0);
      return;
    }
    var fallback = window.prompt('Edit proposed text', changeProposedText(change) || '');
    if (fallback !== null) {
      editUnreleasedReviewChange(change, fallback).catch(function (error) {
        console.error('[FileViewerPage] Edit review change failed:', error);
        notify((error && error.message) || 'Failed to edit review change', 'error');
      });
    }
  }

  function releasedDisplayChangesForReleaseId(releaseId) {
    for (var i = 0; i < state.releaseChangeGroups.length; i++) {
      var group = state.releaseChangeGroups[i];
      if (group && group.release_id === releaseId) {
        return displayReviewChanges(group.changes || []);
      }
    }
    return [];
  }

  async function revertUnreleasedReviewChange(change) {
    if (!state.editorInstance || typeof state.editorInstance.decide !== 'function') {
      throw new Error('This editor session cannot revert draft changes yet.');
    }
    var revisionIds = revisionIdsForReviewChange(change);
    if (!revisionIds.length) {
      throw new Error('This draft change is not loaded into the editor. Reload the document and try again.');
    }
    if (state.editorMode !== 'review') {
      await setEditorInteractionMode('review');
    }
    await state.editorInstance.decide({
      decisions: revisionIds.map(function (id) {
        return { id: id, action: 'reject' };
      })
    });
    state.reviewState = currentReviewState();
    state.reviewDirty = true;
    updateReviewRailCounts(state.reviewState || {});
    if (state.currentReviewBatch && state.currentReviewBatch.id) {
      await saveReviewBatch({ silent: true, allowEmpty: true });
    }
    notify('Draft change reverted', 'success');
  }

  async function editUnreleasedReviewChange(change, nextText) {
    if (!state.editorInstance || typeof state.editorInstance.decide !== 'function' || typeof state.editorInstance.applyEdits !== 'function') {
      throw new Error('This editor session cannot edit draft changes yet.');
    }
    var revisionIds = revisionIdsForReviewChange(change);
    if (!revisionIds.length) {
      throw new Error('This draft change is not loaded into the editor. Reload the document and try again.');
    }
    ensureDraftReviewChangeCanBeEdited(change);
    var op = firstEditableDraftOpForChange(change, nextText);
    if (!op) {
      throw new Error('This change cannot be edited directly. Revert it and create a new change instead.');
    }
    if (state.editorMode !== 'review') {
      await setEditorInteractionMode('review');
    }
    await state.editorInstance.decide({
      decisions: revisionIds.map(function (id) {
        return { id: id, action: 'reject' };
      })
    });
    await state.editorInstance.applyEdits([op]);
    state.reviewState = currentReviewState();
    state.reviewDirty = true;
    updateReviewRailCounts(state.reviewState || {});
    if (state.currentReviewBatch && state.currentReviewBatch.id) {
      await saveReviewBatch({ silent: true });
    }
    notify('Draft change updated', 'success');
  }

  async function revertReleasedReviewChange(change) {
    if (!state.editorInstance || typeof state.editorInstance.applyEdits !== 'function') {
      throw new Error('Open the current editable document before reverting a released change.');
    }
    if (!canReviewFile(state.currentFile)) {
      throw new Error('Convert this file to DOCX before reverting released changes.');
    }
    var inverseOps = inverseEditOpsForReleasedChange(change);
    if (!inverseOps.length) {
      throw new Error('This released change cannot be reverted automatically from its stored edit data.');
    }
    if (state.editorMode !== 'review') {
      await setEditorInteractionMode('review');
    }
    await state.editorInstance.applyEdits(inverseOps);
    state.reviewState = currentReviewState();
    state.reviewDirty = true;
    updateReviewRailCounts(state.reviewState || {});
    notify('Revert staged as an unreleased change', 'success');
  }

  async function revertReviewHistoryChange(section, index, releaseId) {
    var change = reviewHistoryChangeForRevert(section, index, releaseId);
    if (!change) return;
    if (section === 'released') {
      await revertReleasedReviewChange(change);
      return;
    }
    await revertUnreleasedReviewChange(change);
  }

  function bytesToBase64(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      var chunk = bytes.subarray(i, i + 0x8000);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  function bytesToUtf8(bytes) {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }

  function hasDocxZipEnvelope(bytes) {
    if (!bytes || bytes.length < 22) return false;
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
    var min = Math.max(0, bytes.length - 65557);
    for (var i = bytes.length - 22; i >= min; i--) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
        return true;
      }
    }
    return false;
  }

  function hasPdfEnvelope(bytes) {
    return !!(bytes && bytes.length >= 5 &&
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46 &&
      bytes[4] === 0x2d);
  }

  function assertReleaseBytesMatchFormat(file, bytes) {
    var contentType = releaseContentType(file);
    var format = currentFormatCapabilities(file).format || detectViewerFormat(file);
    if ((format === 'docx' || contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') && !hasDocxZipEnvelope(bytes)) {
      throw new Error('The editor did not return a valid Word document package. Reload the document and try again.');
    }
    if ((format === 'pdf' || contentType === 'application/pdf') && !hasPdfEnvelope(bytes)) {
      throw new Error('The editor did not return a valid PDF document. Reload the document and try again.');
    }
  }

  function releasePayloadForEditorBytes(file, bytes) {
    var contentType = releaseContentType(file);
    var format = currentFormatCapabilities(file).format || detectViewerFormat(file);
    assertReleaseBytesMatchFormat(file, bytes);
    var payload = {
      approved: false,
      filename: releaseFilename(),
      content_type: contentType,
      release_notes: 'Released from File Viewer review workflow.'
    };
    if (format === 'markdown' || format === 'text' || contentType.indexOf('text/') === 0) {
      payload.content_text = bytesToUtf8(bytes);
    } else {
      payload.content_base64 = bytesToBase64(bytes);
    }
    return payload;
  }

  async function acceptedReleaseBytesForEditor(file, bytes) {
    var contentType = releaseContentType(file);
    var format = currentFormatCapabilities(file).format || detectViewerFormat(file);
    if (format !== 'docx' && contentType !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      return bytes;
    }
    assertReleaseBytesMatchFormat(file, bytes);
    var response = await fetch(getEditorServiceBase() + '/v1/redline/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        docxBase64: bytesToBase64(bytes),
        mode: 'accept_all'
      })
    });
    await assertFetchOk(response, 'Failed to prepare clean release document');
    var buffer = await response.arrayBuffer();
    var acceptedBytes = new Uint8Array(buffer);
    assertReleaseBytesMatchFormat(file, acceptedBytes);
    return acceptedBytes;
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

  function rawReviewRevisions(reviewState) {
    var source = reviewState || state.reviewState || {};
    return Array.isArray(source.revisions) ? source.revisions.filter(Boolean) : [];
  }

  function reviewRevisionKey(revision) {
    if (!revision) return '';
    var revisionId = revision.id || revision.revision_id || revision.revisionId || '';
    var payload = {
      id: revisionId ? String(revisionId) : '',
      type: String((revision.type || revision.operation || revision.op || '')).toLowerCase(),
      text: revision.text !== undefined ? String(revision.text) : '',
      original_text: changeOriginalText(revision),
      proposed_text: changeProposedText(revision)
    };
    try {
      return JSON.stringify(payload);
    } catch (_) {
      return '';
    }
  }

  function resetReviewBaselineRevisions() {
    state.reviewBaselineRevisionKeyCounts = {};
    state.reviewBaselineRevisionIds = [];
    state.reviewBaselineAcceptedForReview = false;
  }

  function captureReviewBaselineRevisions(reviewState) {
    var counts = {};
    var ids = [];
    rawReviewRevisions(reviewState).forEach(function (revision) {
      var key = reviewRevisionKey(revision);
      if (!key) return;
      counts[key] = (counts[key] || 0) + 1;
      if (revision && revision.id) ids.push(String(revision.id));
    });
    state.reviewBaselineRevisionKeyCounts = counts;
    state.reviewBaselineRevisionIds = ids;
    state.reviewBaselineAcceptedForReview = false;
  }

  function unreleasedRawReviewRevisions(reviewState) {
    var revisions = rawReviewRevisions(reviewState);
    var baseline = state.reviewBaselineRevisionKeyCounts || {};
    var keys = Object.keys(baseline);
    if (!keys.length) return revisions;
    var remaining = Object.assign({}, baseline);
    return revisions.filter(function (revision) {
      var key = reviewRevisionKey(revision);
      if (key && remaining[key] > 0) {
        remaining[key] -= 1;
        return false;
      }
      return true;
    });
  }

  function normalizeReviewChanges(reviewState) {
    return LanaDocumentReview.changesFromRevisions(unreleasedRawReviewRevisions(reviewState));
  }

  function persistableReviewChange(change, index) {
    return LanaDocumentReview.persistableReviewChange(change, index);
  }

  function persistableReviewChanges(reviewState) {
    return displayReviewChanges(normalizeReviewChanges(reviewState)).map(persistableReviewChange).filter(Boolean);
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

  function nextReleaseNumber() {
    var releases = Array.isArray(state.reviewReleases) ? state.reviewReleases : [];
    var highest = 0;
    for (var i = 0; i < releases.length; i++) {
      var releaseNumber = Number(releases[i] && releases[i].release_number);
      if (Number.isFinite(releaseNumber) && releaseNumber > highest) highest = releaseNumber;
    }
    return highest + 1;
  }

  function releaseConfirmationMessage() {
    var details = releaseConfirmationDetails();
    return 'Release ' + details.versionLabel + ' as "' + details.filename + '"?\n\n' +
      details.draftSummary + '\n' +
      'Changes: ' + details.changeSummary + '\n' +
      'Approval: owners release directly; other users request owner approval.';
  }

  function releaseConfirmationDetails() {
    var versionLabel = 'Version ' + nextReleaseNumber();
    var filename = releaseFilename();
    var draftLabel = state.currentReviewBatch && state.currentReviewBatch.title
      ? state.currentReviewBatch.title
      : 'current review draft';
    var changeCount = pendingReviewChangeCount();
    var changeSummary = changeCount > 0
      ? changeCount + ' visible tracked change' + (changeCount === 1 ? '' : 's')
      : 'the saved tracked changes';
    var draftSummary = state.reviewDirty
      ? 'Unsaved edits will be saved first, then submitted for release.'
      : 'The saved draft "' + draftLabel + '" will be submitted for release.';
    return {
      versionLabel: versionLabel,
      filename: filename,
      draftLabel: draftLabel,
      draftSummary: draftSummary,
      changeSummary: changeSummary
    };
  }

  function releaseConfirmationContent(details) {
    return '<div class="file-viewer-release-confirm">' +
      '<div class="file-viewer-release-confirm__hero">' +
        '<span class="file-viewer-release-confirm__eyebrow">Ready for approval</span>' +
        '<strong>' + escapeHtml(details.versionLabel) + '</strong>' +
      '</div>' +
      '<div class="file-viewer-release-confirm__grid">' +
        '<div>' +
          '<span>Release file</span>' +
          '<strong>' + escapeHtml(details.filename) + '</strong>' +
        '</div>' +
        '<div>' +
          '<span>Draft source</span>' +
          '<strong>' + escapeHtml(details.draftLabel) + '</strong>' +
        '</div>' +
        '<div>' +
          '<span>Changes included</span>' +
          '<strong>' + escapeHtml(details.changeSummary) + '</strong>' +
        '</div>' +
      '<div>' +
        '<span>Approval</span>' +
          '<strong>Owner releases directly</strong>' +
      '</div>' +
      '</div>' +
      '<p class="file-viewer-release-confirm__note">' +
        escapeHtml(details.draftSummary) + '<br>' +
        '<strong>If you do not own this file, LANA will request approval from the document owner.</strong>' +
      '</p>' +
    '</div>';
  }

  function activeDraftBatchFromList(list) {
    var batches = Array.isArray(list) ? list : [];
    for (var i = 0; i < batches.length; i++) {
      if (isActiveReviewDraftBatch(batches[i])) {
        return batches[i];
      }
    }
    return null;
  }

  function activeDraftBatchForCurrentFile(list, file, releases, currentDocumentIsRelease) {
    if (!currentDocumentIsRelease) return activeDraftBatchFromList(list);
    var documentId = file && file.id ? String(file.id) : '';
    var owningRelease = (Array.isArray(releases) ? releases : []).find(function (release) {
      return release && String(release.released_document_id || '') === documentId;
    });
    var baseFileVersionId = owningRelease && owningRelease.file_version_id
      ? String(owningRelease.file_version_id)
      : '';
    if (!baseFileVersionId) return null;
    var batches = Array.isArray(list) ? list : [];
    for (var i = 0; i < batches.length; i++) {
      if (isActiveReviewDraftBatch(batches[i]) && String(batches[i].base_file_version_id || '') === baseFileVersionId) {
        return batches[i];
      }
    }
    return null;
  }

  function isActiveReviewDraftBatch(batch) {
    var status = batch && batch.status ? String(batch.status) : '';
    return status === 'draft' || status === 'proposed';
  }

  function pendingReleaseBatchFromList(list) {
    var batches = Array.isArray(list) ? list : [];
    for (var i = 0; i < batches.length; i++) {
      if (batches[i] && batches[i].status === 'pending_release') {
        return batches[i];
      }
    }
    return null;
  }

  function currentReviewBatchDisplayChanges() {
    if (state.currentReviewBatchRestoreFailed) return [];
    if (!isActiveReviewDraftBatch(state.currentReviewBatch)) return [];
    var changes = state.currentReviewBatch && Array.isArray(state.currentReviewBatch.changes)
      ? state.currentReviewBatch.changes
      : [];
    return displayReviewChanges(changes);
  }

  function dedupeEditOps(ops) {
    return LanaDocumentReview.dedupeEditOps(ops);
  }

  function editOpsFromPersistedBatch(batch) {
    return LanaDocumentReview.editOpsFromBatch(batch);
  }

  function editScriptsFromPersistedBatch(batch) {
    return LanaDocumentReview.editScriptsFromBatch(batch);
  }

  function persistedBatchChangeCount(batch) {
    return Array.isArray(batch && batch.changes) ? batch.changes.length : 0;
  }

  function waitForReviewRestoreRetry(attempt) {
    return new Promise(function (resolve) {
      var delay = Math.max(40, Math.min(180, 40 * (Number(attempt) || 1)));
      setTimeout(resolve, delay);
    });
  }

  async function applyPersistedEditScriptsSequentially(scripts, fallbackOps) {
    if (scripts.length && typeof state.editorInstance.applyEditScripts === 'function') {
      await state.editorInstance.applyEditScripts(scripts);
      return;
    }
    await state.editorInstance.applyEdits(fallbackOps);
  }

  function restoredDraftHasVisibleRevisions() {
    var reviewState = currentReviewState();
    var revisions = Array.isArray(reviewState && reviewState.revisions) ? reviewState.revisions : [];
    return revisions.length > 0;
  }

  async function restorePersistedDraftIntoEditor(batch) {
    if (!batch || !state.editorInstance || typeof state.editorInstance.applyEdits !== 'function') return false;
    if (state.editorMode !== 'review') {
      await setEditorInteractionMode('review');
    }
    var current = currentReviewState();
    if (Array.isArray(current.revisions) && current.revisions.length > 0) return false;
    var scripts = editScriptsFromPersistedBatch(batch);
    var ops = scripts.length ? [] : editOpsFromPersistedBatch(batch);
    for (var scriptIndex = 0; scriptIndex < scripts.length; scriptIndex++) {
      var scriptOps = Array.isArray(scripts[scriptIndex].ops) ? scripts[scriptIndex].ops : [];
      for (var opIndex = 0; opIndex < scriptOps.length; opIndex++) {
        if (scriptOps[opIndex]) ops.push(scriptOps[opIndex]);
      }
    }
    if (!ops.length) return false;
    state.reviewRestoring = true;
    try {
      await applyPersistedEditScriptsSequentially(scripts, ops);
      state.reviewState = currentReviewState();
      state.reviewDirty = false;
      updateReviewRailCounts(state.reviewState || {});
      return true;
    } catch (error) {
      console.warn('[FileViewerPage] Persisted review draft could not be restored into editor:', error);
      return false;
    } finally {
      state.reviewRestoring = false;
    }
  }

  async function restorePersistedDraftIntoEditorWithRetry(batch) {
    var hasPersistedChanges = persistedBatchChangeCount(batch) > 0;
    if (!hasPersistedChanges) return false;
    var attempts = 4;
    for (var attempt = 0; attempt < attempts; attempt++) {
      var restored = await restorePersistedDraftIntoEditor(batch);
      if (restored || restoredDraftHasVisibleRevisions()) {
        state.currentReviewBatchRestoreFailed = false;
        return true;
      }
      if (attempt < attempts - 1) {
        await waitForReviewRestoreRetry(attempt + 1);
      }
    }
    return false;
  }

  async function loadReviewWorkflow(file) {
    state.reviewBatches = [];
    state.currentReviewBatch = null;
    state.pendingReviewReleaseBatch = null;
    state.currentReviewBatchRestoreFailed = false;
    state.reviewSourceDocumentId = null;
    state.reviewReleases = [];
    state.selectedReviewReleaseId = null;
    state.selectedReviewReleaseDocumentId = null;
    state.releaseChangeHistory = [];
    state.releaseComparison = null;
    state.releaseComparisonLoading = false;
    state.versionCompareMode = false;
    state.versionCompareSelections = [];
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
      var reviewDocumentId = String(file.id);
      var releasesResponse = await api.get(reviewEndpoint('/documents/' + encodeURIComponent(reviewDocumentId) + '/releases?limit=20'));
      var currentDocumentIsRelease = Boolean(
        releasesResponse
        && releasesResponse.metadata
        && releasesResponse.metadata.current_document_is_release
      );
      var metadataSourceDocumentId = releasesResponse && releasesResponse.metadata && releasesResponse.metadata.source_document_id
        ? String(releasesResponse.metadata.source_document_id)
        : '';
      if (metadataSourceDocumentId && metadataSourceDocumentId !== reviewDocumentId) {
        reviewDocumentId = metadataSourceDocumentId;
        releasesResponse = await api.get(reviewEndpoint('/documents/' + encodeURIComponent(reviewDocumentId) + '/releases?limit=20'));
      }
      state.reviewSourceDocumentId = reviewDocumentId;
      var query = '?document_id=' + encodeURIComponent(reviewDocumentId) + '&limit=20&sort_by=updated_at&sort_dir=desc';
      var batchesResponse = await api.get(reviewEndpoint('/document-edit-batches' + query));
      state.reviewBatches = Array.isArray(batchesResponse && batchesResponse.data) ? batchesResponse.data : [];
      state.reviewReleases = Array.isArray(releasesResponse && releasesResponse.data) ? releasesResponse.data : [];
      state.currentReviewBatch = activeDraftBatchForCurrentFile(
        state.reviewBatches,
        file,
        state.reviewReleases,
        currentDocumentIsRelease
      );
      state.pendingReviewReleaseBatch = pendingReleaseBatchFromList(state.reviewBatches);
      if (!state.suppressReviewDraftRestoreForLoad && state.currentReviewBatch && state.currentReviewBatch.id) {
        try {
          var draftResponse = await api.get(reviewEndpoint('/document-edit-batches/' + encodeURIComponent(state.currentReviewBatch.id)));
          state.currentReviewBatch = draftResponse && draftResponse.data ? draftResponse.data : draftResponse;
          state.currentReviewBatchRestoreFailed = false;
        } catch (draftError) {
          console.warn('[FileViewerPage] Draft review batch detail load failed:', draftError);
          state.currentReviewBatchRestoreFailed = true;
        }
      }
      state.releaseChangeGroups = await loadReleaseChangeGroups(state.reviewReleases);
      if (selectInitialReviewDisplay(file)) {
        return;
      }
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
    var releaseBtn = document.getElementById('reviewReleaseBtn');
    var releasesEl = document.getElementById('reviewReleasesList');
    var matterId = getCurrentMatterId();
    var hasEditor = !!state.editorInstance;
    var canUseWorkflow = !!(matterId && state.currentFile && state.currentFile.id && hasEditor && canReviewFile(state.currentFile));
    var changeCount = pendingReviewChangeCount();
    var persistedDraftChanges = state.currentReviewBatch && Array.isArray(state.currentReviewBatch.changes)
      ? state.currentReviewBatch.changes.length
      : 0;
    var hasReviewWork = changeCount > 0 || persistedDraftChanges > 0;

    if (statusEl) {
      if (message) {
        statusEl.textContent = message;
      } else if (state.releaseComparison) {
        statusEl.textContent = 'Comparing selected versions.';
      } else if (state.versionCompareMode) {
        var selectedCount = Array.isArray(state.versionCompareSelections) ? state.versionCompareSelections.length : 0;
        statusEl.textContent = selectedCount === 1
          ? 'Select a comparison version.'
          : 'Select a base version, then a comparison version.';
      } else if (!matterId) {
        statusEl.textContent = 'Workspace association required to save review drafts.';
      } else if (hasEditor && !canReviewFile(state.currentFile)) {
        statusEl.textContent = 'This format is read-only. Convert it to DOCX before review edits.';
      } else if (state.currentReviewBatchRestoreFailed) {
        statusEl.textContent = 'Saved draft details could not be loaded.';
      } else if (state.currentReviewBatch && hasReviewWork) {
        statusEl.textContent = 'Draft saved. Open File Editor to edit or release it.';
      } else if (hasReviewWork) {
        statusEl.textContent = changeCount + ' pending change' + (changeCount === 1 ? '' : 's') + ' available in this view.';
      } else {
        statusEl.textContent = 'No saved review draft.';
      }
    }

    if (releaseBtn) {
      // Editing and releasing live in File Editor; this button routes there.
      releaseBtn.disabled = !(state.currentFile && state.currentFile.id && canReviewFile(state.currentFile));
      releaseBtn.textContent = 'Open in File Editor';
    }

    if (releasesEl) {
      syncReviewVersionSelect();
      var originalDocumentId = originalVersionDocumentId();
      var originalIsCurrent = state.currentFile && originalDocumentId && String(state.currentFile.id) === String(originalDocumentId);
      var originalSelected = originalVersionIsSelected();
      var originalCompareIndex = versionCompareSelectionIndex('original');
      var originalMeta = 'Original' + (originalIsCurrent ? ' \u2022 Current view' : '');
      var originalAttrs = originalIsCurrent && !state.versionCompareMode
        ? ''
        : ' role="button" tabindex="0" data-review-version-open-original="true" aria-pressed="' + (originalCompareIndex >= 0 ? 'true' : 'false') + '"';
      var originalRow = '<div class="file-viewer-review-release' + (originalSelected ? ' file-viewer-review-release--selected' : '') + versionCompareSelectionClass('original') + '"' + originalAttrs + '>' +
        '<span class="file-viewer-review-release__copy">' +
          '<span class="file-viewer-review-release__title-row"><span class="file-viewer-review-release__title">Original</span>' +
            (originalCompareIndex === 0 ? '<span class="file-viewer-review-release__role file-viewer-review-release__role--base">Base</span>' : '') +
            (originalCompareIndex === 1 ? '<span class="file-viewer-review-release__role file-viewer-review-release__role--comparison">Comparison</span>' : '') +
          '</span>' +
          '<span class="file-viewer-review-release__meta">' + escapeHtml(originalMeta) + '</span>' +
        '</span>' +
        '<span class="file-viewer-review-release__actions">' + (state.versionCompareMode ? '<span class="file-viewer-review-release__selector" aria-hidden="true"></span>' : '') + '</span>' +
      '</div>';
      var releaseRows = reviewReleasesNewestFirst().map(function (item) {
          var release = item.release;
          var index = item.index;
          var label = release.released_document_filename || ('Version ' + release.release_number);
          var releasedAt = release.released_at ? formatDate(release.released_at) : '';
          var documentId = releaseDocumentId(release);
          var isCurrent = state.currentFile && documentId && String(state.currentFile.id) === String(documentId);
          var selected = releaseIsSelected(release);
          var compareIndex = versionCompareSelectionIndex(release.id);
          var selectedClass = (selected ? ' file-viewer-review-release--selected' : '') + versionCompareSelectionClass(release.id);
          var rowAttrs = documentId
            ? ' role="button" tabindex="0" data-review-version-open-index="' + index + '" aria-pressed="' + (compareIndex >= 0 ? 'true' : 'false') + '"'
            : '';
          var selector = state.versionCompareMode ? '<span class="file-viewer-review-release__selector" aria-hidden="true"></span>' : '';
          var deleteButton = '<button type="button" class="file-viewer-review-release__action file-viewer-review-release__delete" data-review-release-delete-index="' + index + '" aria-label="Delete ' + escapeHtml(label) + '">' +
              '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3m-8 0h10"></path></svg>' +
            '</button>';
          return '<div class="file-viewer-review-release' + selectedClass + '"' + rowAttrs + '>' +
            '<span class="file-viewer-review-release__copy">' +
              '<span class="file-viewer-review-release__title-row"><span class="file-viewer-review-release__title">' + escapeHtml(label) + '</span>' +
                (compareIndex === 0 ? '<span class="file-viewer-review-release__role file-viewer-review-release__role--base">Base</span>' : '') +
                (compareIndex === 1 ? '<span class="file-viewer-review-release__role file-viewer-review-release__role--comparison">Comparison</span>' : '') +
              '</span>' +
              '<span class="file-viewer-review-release__meta">Version ' + escapeHtml(release.release_number || '') + (releasedAt ? ' &middot; ' + escapeHtml(releasedAt) : '') + (isCurrent ? ' &middot; Current view' : '') + (state.versionCompareMode && compareIndex >= 0 ? ' &middot; Selected for compare' : '') + '</span>' +
            '</span>' +
            '<span class="file-viewer-review-release__actions">' + selector + deleteButton + '</span>' +
            '</div>';
        }).join('');
      var compareToggle = '<button type="button" class="file-viewer-review-compare-toggle' + (state.versionCompareMode ? ' file-viewer-review-compare-toggle--active' : '') + '" data-review-version-compare-toggle="true" aria-pressed="' + (state.versionCompareMode ? 'true' : 'false') + '">' +
        '<span class="file-viewer-review-compare-toggle__radio" aria-hidden="true"></span>' +
        '<span>Compare Versions</span>' +
      '</button>';
      releasesEl.innerHTML = compareToggle + releaseRows + originalRow;
    }
  }

  async function saveReviewBatch(options) {
    options = options || {};
    if (!state.currentFile || !state.editorInstance) throw new Error('No editable document is open.');
    if (!canReviewFile(state.currentFile)) throw new Error('This format is read-only. Convert it to DOCX before editing.');
    var reviewState = currentReviewState();
    var changes = persistableReviewChanges(reviewState);
    if (state.currentReviewBatch
      && Array.isArray(state.currentReviewBatch.changes)
      && state.currentReviewBatch.changes.length > 0
      && changes.length === 0
      && !options.allowEmpty) {
      throw new Error('Saved draft changes are not loaded into the editor yet. Make a new tracked change or reload the document before saving.');
    }
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
      if (state.currentReviewBatch
        && state.currentReviewBatch.id
        && (state.currentReviewBatch.status === 'draft' || state.currentReviewBatch.status === 'proposed')) {
        response = await api.patch(
          reviewEndpoint('/document-edit-batches/' + encodeURIComponent(state.currentReviewBatch.id)),
          payload
        );
      } else {
        var reviewDocumentId = String(state.currentFile.id);
        response = await api.post(
          reviewEndpoint('/documents/' + encodeURIComponent(reviewDocumentId) + '/edit-batches'),
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
    if (!canReviewFile(state.currentFile)) {
      notify('Convert this file to DOCX before releasing review edits.', 'error');
      return;
    }
    if (!state.currentReviewBatch || !state.currentReviewBatch.id) {
      notify('Open this document in File Editor to create a saved draft before release.', 'error');
      return;
    }
    var run = async function () {
      state.reviewReleasing = true;
      renderReviewWorkflow();
      try {
        var batch = state.currentReviewBatch;
        if (!batch || !batch.id) throw new Error('Review draft could not be saved.');
        if (typeof state.editorInstance.bytes !== 'function') throw new Error('Editor bytes are unavailable.');
        var bytes = state.editorInstance.bytes();
        if (!bytes) throw new Error('No document bytes are available to release.');
        var releaseBytes = await acceptedReleaseBytesForEditor(state.currentFile, bytes);
        var response = await api.post(
          reviewEndpoint('/document-edit-batches/' + encodeURIComponent(batch.id) + '/release'),
          releasePayloadForEditorBytes(state.currentFile, releaseBytes)
        );
        state.currentReviewBatch = response && response.data && response.data.batch
          ? response.data.batch
          : batch;
        state.reviewDirty = false;
        var releasedDocument = response && response.data && response.data.document;
        if (releasedDocument && releasedDocument.id) {
          notify('Version released', 'success');
          var params = new URLSearchParams({ id: releasedDocument.id });
          Lex.Nav.go('file-viewer.html?' + params.toString(), {
            context: fileViewerNavContext(state.currentFile)
          });
          return;
        }
        await loadReviewWorkflow(state.currentFile);
        var approvalId = response && response.data && (response.data.approval_id || (response.data.approval && response.data.approval.id));
        if (response && response.data && response.data.approval_required) {
          notify('Release approval requested' + (approvalId ? ': ' + approvalId : ''), 'success');
        } else {
          notify('Version released', 'success');
        }
      } catch (error) {
        console.error('[FileViewerPage] Release version failed:', error);
        notify((error && error.message) || 'Failed to release version', 'error');
      } finally {
        state.reviewReleasing = false;
        renderReviewWorkflow();
      }
    };

    var details = releaseConfirmationDetails();
    var message = releaseConfirmationMessage();
    if (typeof Lex !== 'undefined' && Lex.Modal && typeof Lex.Modal.open === 'function') {
      Lex.Modal.open({
        heading: 'Release Version',
        size: 'md',
        content: releaseConfirmationContent(details),
        confirmText: 'Release Version',
        cancelText: 'Cancel',
        onConfirm: run
      });
    } else if (typeof Lex !== 'undefined' && Lex.Modal && typeof Lex.Modal.confirm === 'function') {
      Lex.Modal.confirm('Release Version', message, run, { confirmText: 'Release Version' });
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

  function hideFormatNotice() {
    var notice = document.getElementById('viewerFormatNotice');
    if (!notice) return;
    notice.classList.add('hidden');
    notice.innerHTML = '';
  }

  function showFormatNotice(options) {
    var notice = document.getElementById('viewerFormatNotice');
    if (!notice) return;
    options = options || {};
    var action = options.action
      ? '<button type="button" class="file-viewer-format-notice__action" data-viewer-action="' + escapeHtml(options.action) + '">' + escapeHtml(options.actionLabel || 'Continue') + '</button>'
      : '';
    notice.innerHTML =
      '<span class="file-viewer-format-notice__copy">' +
        '<span class="file-viewer-format-notice__title">' + escapeHtml(options.title || '') + '</span>' +
        '<span class="file-viewer-format-notice__text">' + escapeHtml(options.message || '') + '</span>' +
      '</span>' +
      action;
    notice.classList.remove('hidden');
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
    var errorDownloadBtn = document.getElementById('viewerErrorDownload');
    var errorDeleteBtn = document.getElementById('viewerErrorDelete');
    var hasLoadedFile = Boolean(state.currentFile && state.currentFile.id);
    if (askBtn) askBtn.disabled = true;
    if (dlBtn) dlBtn.classList.add('hidden');
    if (docStudioBtn) docStudioBtn.classList.add('hidden');
    if (fileInfoBtn) fileInfoBtn.classList.add('hidden');
    if (errorDownloadBtn) errorDownloadBtn.classList.toggle('hidden', !hasLoadedFile);
    if (errorDeleteBtn) errorDeleteBtn.classList.toggle('hidden', !hasLoadedFile);
    setReviewRailVisible(false);
  }

  function isFileAccessDenied(error) {
    // Storage intentionally uses 404 for both missing and inaccessible
    // document identities in several read paths. Treat both as the same
    // non-disclosing viewer state so the UI cannot become an existence oracle.
    return !!error && (Number(error.status) === 403 || Number(error.status) === 404);
  }

  function showFileAccessDenied() {
    showError('You do not have access to this file.');
    if (typeof Lex !== 'undefined' && Lex.Modal && typeof Lex.Modal.alert === 'function') {
      Lex.Modal.alert('Access denied', 'You do not have access to this file.', {
        variant: 'danger',
        confirmText: 'OK'
      });
    }
  }

  function hideAllViewers() {
    var ids = ['viewerLoading', 'viewerError', 'viewerIframe', 'viewerText', 'viewerImage', 'viewerDocumentCard', 'viewerEditor', 'viewerDiff', 'viewerDocx'];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el) el.classList.add('hidden');
    }
    setViewerDisplayControlsVisible(false);
  }

  async function loadFile(fileId) {
    // Never leave the previous document actionable while resolving a new
    // identity (for example, after selecting a released version). If the new
    // metadata request fails, error actions must not download/delete stale data.
    state.currentFile = null;
    showLoading();

    try {
      var encodedFileId = encodeURIComponent(fileId);
      var response = await api.get('/api/v1/storage/files/' + encodedFileId);
      if (!response || !response.id) {
        throw new Error('File not found');
      }
      var displayFilename = documentDisplayFilename(response);

      // Track file activity (non-blocking)
      api.post('/api/v1/storage/files/' + encodedFileId + '/activity', { event_type: 'opened' })
        .catch(function () { /* non-critical */ });

      state.currentFile = response;
      var conversationMatterId = getConversationMatterId(response);

      // Configure LANA panel with file context
      var lanaPanel = document.getElementById('fileViewerLana');
      if (lanaPanel) {
        lanaPanel.threadTitle = displayFilename;
        if (conversationMatterId) {
          lanaPanel.setAttribute('matter-id', conversationMatterId);
        } else {
          lanaPanel.removeAttribute('matter-id');
        }
      }

      // The Ask LANA button injects this document's context into the dock
      var askLanaBtn = document.getElementById('askLanaBtn');
      if (askLanaBtn) {
        askLanaBtn.setAttribute('document-id', response.id);
        askLanaBtn.setAttribute('document-name', displayFilename);
        askLanaBtn.setAttribute('context-type', 'document_chat');
        if (conversationMatterId) {
          askLanaBtn.setAttribute('matter-id', conversationMatterId);
        } else {
          askLanaBtn.removeAttribute('matter-id');
        }
      }

      // Declare the document as the dock's page context so a rail-opened
      // dock can OFFER it ("Ask about <file>") instead of arriving blank.
      var pageDock = document.querySelector('lex-lana-dock');
      if (pageDock && typeof pageDock.setPageContext === 'function') {
        pageDock.setPageContext({
          documentId: response.id,
          documentName: displayFilename,
          matterId: conversationMatterId || null,
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
        banner.setAttribute('heading', displayFilename);
        banner.setAttribute('subtitle',
          formatFileSize(response.file_size) + ' \u2022 ' + formatDate(response.updated_at || response.created_at));
      }

      // Breadcrumb mirrors workspace-details: matter-scoped files thread
      // through "Workspaces & Matters > [Matter] > filename"; workspace-only
      // files just show the filename, since there's no global storage page
      // worth linking to from here.
      setFileBreadcrumb(response);
      hydrateFileBreadcrumbMatterLabel(response);

      // Update page title
      document.title = displayFilename + ' - LANA AI';

      // Flush the banner re-render queued by the setAttribute calls above so
      // subsequent class toggles target the final rendered DOM nodes, not
      // the soon-to-be-replaced clones. Click handlers are wired via
      // delegation on the banner itself, so they survive re-renders.
      await Promise.resolve();

      updateDocStudioButton(response);
      var fileInfoBtn = document.getElementById('viewerFileInfoBtn');
      if (fileInfoBtn) fileInfoBtn.classList.remove('hidden');

      // Load content + metadata
      await loadFormatCapabilities(response);
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
      if (isFileAccessDenied(error)) {
        showFileAccessDenied();
      } else {
        showError('Failed to load file: ' + error.message);
      }
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
    hideFormatNotice();
    state.editorMode = 'view';
    state.viewerPlainText = null;
    state.reviewState = null;
    resetReviewBaselineRevisions();
    state.reviewBatches = [];
    state.currentReviewBatch = null;
    state.pendingReviewReleaseBatch = null;
    state.reviewSourceDocumentId = null;
    state.reviewReleases = [];
    state.reviewDisplayTarget = null;
    state.selectedReviewReleaseId = null;
    state.selectedReviewReleaseDocumentId = null;
    state.releaseChangeHistory = [];
    state.releaseComparison = null;
    state.releaseComparisonLoading = false;
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
    var capabilities = currentFormatCapabilities(file);
    var canConvert = !!(capabilities.conversion && capabilities.conversion.target_format === 'docx' && capabilities.conversion.available === true);
    showFormatNotice({
      title: 'PDF opens read-only',
      message: canConvert
        ? 'Convert this PDF to DOCX before making review edits. You can export the reviewed DOCX back to PDF when the version is ready.'
        : 'This PDF is read-only here. DOCX conversion will appear when the server reports conversion support.',
      action: canConvert ? 'convertPdfToDocx' : null,
      actionLabel: state.formatConversionRunning ? 'Converting...' : 'Convert to DOCX'
    });
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
      state.viewerPlainText = buildDemoDocumentText(file);
      demoText.textContent = state.viewerPlainText;
      demoText.classList.remove('hidden');
      hideLoading();
      return;
    }

    var response = await fetch(getFileDownloadUrl(file), {
      headers: getAuthHeaders()
    });
    await assertFetchOk(response, 'Failed to fetch file');
    var arrayBuffer = await response.arrayBuffer();
    var text = new TextDecoder('utf-8').decode(arrayBuffer);
    state.viewerPlainText = text;
    if (isEditorEnabled() && isEditorPreviewFile(file)) {
      var renderedWithEditor = await loadFileInEditor(file, arrayBuffer);
      if (renderedWithEditor) return;
    }
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
      setViewerDocumentCardVisible(true);
      host.classList.remove('hidden');
      var editor = mod.LanaEditor.mount(host, {
        api: baseUrl,
        fontsUrl: baseUrl + '/editor-fonts',
        pdfWorkerUrl: baseUrl + '/pdfjs/pdf.worker.min.mjs',
        mode: 'view',
        readOnly: true,
        readonly: true,
        editable: false,
        enableEditing: false,
        enableReviewEditing: false,
        selectionToolbar: false,
        showSelectionToolbar: false,
        workspaceFields: false,
        author: currentReviewerName()
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
        if (state.reviewRestoring) return;
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
        state.editorMode = 'view';
        if (reviewState && reviewState.editorMode && reviewState.editorMode !== 'view') {
          forceReadOnlyDisplayMode();
        }
        updateReviewRailCounts(reviewState || null);
        setCanvasModeDisplay(true);
        applyTrackedChangesDisplay();
      });
      editor.on('lana-context-requested', openLanaForEditorContext);

      var bytes = new Uint8Array(arrayBuffer);
      await editor.open_file(new File([bytes], file.filename || 'document', {
        type: file.content_type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      }));
      if (typeof editor.reviewState === 'function') {
        state.reviewState = editor.reviewState();
        captureReviewBaselineRevisions(state.reviewState);
        updateReviewRailCounts(state.reviewState);
      }
      applyTrackedChangesDisplay();
      setReviewRailVisible(canReviewFile(file));
      if (canReviewFile(file)) {
        await loadReviewWorkflow(file);
      } else {
        renderReviewWorkflow('This format is read-only. Convert it to DOCX before review edits.');
      }
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

  async function convertCurrentPdfToDocx() {
    var file = state.currentFile;
    if (!file || state.formatConversionRunning) return;
    var capabilities = currentFormatCapabilities(file);
    if (!capabilities.conversion || capabilities.conversion.target_format !== 'docx') {
      notify('This file does not need PDF conversion before editing.', 'error');
      return;
    }
    if (capabilities.conversion.available !== true) {
      notify('PDF conversion is not available on this server yet.', 'error');
      return;
    }
    state.formatConversionRunning = true;
    showFormatNotice({
      title: 'Converting PDF to DOCX',
      message: 'Creating an editable DOCX copy from the PDF text. Review the converted document before releasing any version.',
      action: 'convertPdfToDocx',
      actionLabel: 'Converting...'
    });
    var action = document.querySelector('[data-viewer-action="convertPdfToDocx"]');
    if (action) action.disabled = true;

    try {
      var response = await api.post(
        reviewEndpoint('/documents/' + encodeURIComponent(file.id) + '/convert-format'),
        { target_format: 'docx' }
      );
      var data = response && response.data ? response.data : response;
      var converted = data && data.converted_document;
      if (!converted || !converted.id) throw new Error('Conversion did not return a document.');
      notify('Editable DOCX created', 'success');
      var params = new URLSearchParams({ id: converted.id });
      Lex.Nav.go('file-viewer.html?' + params.toString(), {
        context: fileViewerNavContext(file)
      });
    } catch (error) {
      console.error('[FileViewerPage] PDF conversion failed:', error);
      notify((error && error.message) || 'Failed to convert PDF to DOCX', 'error');
      showFormatNotice({
        title: 'PDF opens read-only',
        message: 'Conversion failed. You can still view, download, and ask LANA about this PDF.',
        action: 'convertPdfToDocx',
        actionLabel: 'Try conversion again'
      });
    } finally {
      state.formatConversionRunning = false;
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
    var accessLabels = { organization: 'Organization', workspace: 'Workspace', private: 'Private' };
    var accessScope = file.access_scope || (file.metadata && file.metadata.access_scope) || 'workspace';
    var accessEl = document.getElementById('metaAccessScope');
    if (accessEl) accessEl.textContent = accessLabels[accessScope] || 'Workspace';

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

    panel.addEventListener('lex-lana-response-end', function (e) {
      handleLanaDocumentEditSuggestion(e.detail || {});
    });
    panel.addEventListener('lex-lana-module-context-remove', function (e) {
      var removed = e && e.detail ? e.detail.moduleContext : null;
      if (!removed || removed === state.editorFocusedContext || removed.type === (state.editorFocusedContext && state.editorFocusedContext.type)) {
        state.editorFocusedContext = null;
      }
    });

    // Inject file attachment on every send + conversation bootstrap on first send
    panel.addEventListener('lex-lana-before-send', function (e) {
      var file = state.currentFile;
      if (!file) return;

      var matterId = getConversationMatterId(file) || null;
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
      } else if (opts.matterId) {
        delete opts.matterId;
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
    state.explicitVersionView = params.get('version_view') === '1';

    // Read referrer context
    var ctx = Lex.Nav.consume();
    if (ctx && ctx.referrer) {
      state.referrerPage = normalizeBackReferrer(ctx.referrer);
    }
    if (!state.referrerPage && ctx && ctx.fileViewerReferrer) {
      state.referrerPage = normalizeBackReferrer(ctx.fileViewerReferrer);
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
    document.addEventListener('topbar-back-click', interceptShellBack, true);
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
            openCurrentFileInFileEditor();
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
    var formatNotice = document.getElementById('viewerFormatNotice');
    if (formatNotice) {
      formatNotice.addEventListener('click', function (event) {
        var actionTarget = event.target && event.target.closest ? event.target.closest('[data-viewer-action]') : null;
        if (!actionTarget) return;
        if (actionTarget.getAttribute('data-viewer-action') === 'convertPdfToDocx') {
          convertCurrentPdfToDocx();
        }
      });
    }
    var changeDisplayToggle = document.getElementById('viewerChangeDisplayToggle');
    if (changeDisplayToggle) {
      var handleChangeDisplayToggle = function () {
        setTrackedChangesDisplay(Boolean(changeDisplayToggle.checked)).catch(function (error) {
          console.error('[FileViewerPage] Change display toggle failed:', error);
          notify((error && error.message) || 'Failed to update change display', 'error');
          applyTrackedChangesDisplay();
        });
      };
      changeDisplayToggle.addEventListener('change', handleChangeDisplayToggle);
    }
    var versionSelect = document.getElementById('viewerVersionSelect');
    if (versionSelect) {
      versionSelect.addEventListener('lex-change', function (event) {
        var value = event && event.detail ? event.detail.value : versionSelect.value;
        openReviewVersionFromSelect(value).catch(function (error) {
          console.error('[FileViewerPage] Open selected version failed:', error);
          notify((error && error.message) || 'Failed to open selected version', 'error');
          syncReviewVersionSelect();
        });
      });
    }
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
      reviewRail.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        var lanaTrigger = event.target && event.target.closest ? event.target.closest('[data-lana-dock-trigger]') : null;
        if (lanaTrigger) return;
        var actionable = event.target && event.target.closest
          ? event.target.closest('[data-review-version-open-original],[data-review-version-open-index],[data-review-version-compare-toggle],[data-review-item-index]')
          : null;
        if (!actionable) return;
        event.preventDefault();
        actionable.click();
      });
      reviewRail.addEventListener('click', function (event) {
        var releaseButton = event.target && event.target.closest ? event.target.closest('#reviewReleaseBtn') : null;
        if (releaseButton) {
          openCurrentFileInFileEditor();
          return;
        }
        var lanaDockTrigger = event.target && event.target.closest ? event.target.closest('[data-lana-dock-trigger]') : null;
        if (lanaDockTrigger) {
          return;
        }
        var releaseDeleteItem = event.target && event.target.closest ? event.target.closest('[data-review-release-delete-index]') : null;
        if (releaseDeleteItem) {
          deleteReviewRelease(parseInt(releaseDeleteItem.getAttribute('data-review-release-delete-index') || '0', 10));
          return;
        }
        var versionCompareToggle = event.target && event.target.closest ? event.target.closest('[data-review-version-compare-toggle]') : null;
        if (versionCompareToggle) {
          toggleVersionCompareMode(!state.versionCompareMode).catch(function (error) {
            console.error('[FileViewerPage] Toggle version comparison failed:', error);
            notify((error && error.message) || 'Failed to update version comparison mode', 'error');
          });
          return;
        }
        var originalVersionItem = event.target && event.target.closest ? event.target.closest('[data-review-version-open-original]') : null;
        if (originalVersionItem) {
          if (state.versionCompareMode) {
            selectVersionForCompare(versionIdentityForOriginal()).catch(function (error) {
              console.error('[FileViewerPage] Select original for comparison failed:', error);
              notify((error && error.message) || 'Failed to select original version', 'error');
            });
          } else {
            openReviewVersionFromSelect('original').catch(function (error) {
              console.error('[FileViewerPage] Open original version failed:', error);
              notify((error && error.message) || 'Failed to open original version', 'error');
            });
          }
          return;
        }
        var versionItem = event.target && event.target.closest ? event.target.closest('[data-review-version-open-index]') : null;
        if (versionItem) {
          var versionIndex = parseInt(versionItem.getAttribute('data-review-version-open-index') || '0', 10);
          var versionRelease = state.reviewReleases && state.reviewReleases[versionIndex];
          if (state.versionCompareMode) {
            selectVersionForCompare(versionIdentityForRelease(versionRelease)).catch(function (error) {
              console.error('[FileViewerPage] Select version for comparison failed:', error);
              notify((error && error.message) || 'Failed to select version', 'error');
            });
          } else if (versionRelease) {
            openReviewVersionFromSelect(reviewVersionSelectValueForRelease(versionRelease)).catch(function (error) {
              console.error('[FileViewerPage] Open version failed:', error);
              notify((error && error.message) || 'Failed to open version', 'error');
            });
          }
          return;
        }
        var originalItem = event.target && event.target.closest ? event.target.closest('[data-review-release-original]') : null;
        if (originalItem) {
          selectOriginalForComparison();
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

    // Keyboard: Escape closes viewer-owned overlays only. It should not route
    // the file viewer away from the current document.
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var lanaPanel = document.getElementById('fileViewerLana');
        if (lanaPanel && lanaPanel.open) return;
        var fileInfoDrawer = document.getElementById('fileInfoDrawer');
        if (fileInfoDrawer && fileInfoDrawer.open) return;
      }
    });

    setCanvasModeDisplay(false);
    setReviewTab('changes');

    // Load the file
    loadFile(state.fileId);
  });

})();
