/**
 * Firm Handbook view models (pure, no DOM).
 *
 * Maps /api/v1/firm-handbook DTOs to what the page renders, names statuses,
 * and builds and checks the visibility payload. The backend is the authority
 * for every rule here; these checks only stop an obviously incomplete form
 * from being sent and give the person a plain message.
 *
 * Loaded as a plain script (window.LanaFirmHandbookModels) and required by
 * Jest (module.exports). No regex, per the Lex rules.
 */
(function (global) {
  'use strict';

  var TITLE_MAX = 500;
  var SUMMARY_MAX = 600;
  var RECIPIENTS_MAX = 200;
  var VISIBILITY_ORGANIZATION = 'organization';
  var VISIBILITY_RESTRICTED = 'restricted';
  var INGESTION_PENDING = ['pending', 'queued', 'processing', 'running', 'embedding'];
  var INGESTION_FAILED = ['failed', 'error', 'enqueue_failed'];
  var UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
  var UPLOAD_EXTENSIONS = ['.docx', '.pdf', '.txt'];
  var CREATE_BLANK = 'blank';
  var CREATE_UPLOAD = 'upload';

  var STATUS = {
    draft: { label: 'Draft', color: 'gray' },
    published: { label: 'Published', color: 'green' },
    unpublished: { label: 'Not published', color: 'gray' }
  };

  var MESSAGES = {
    titleRequired: 'Give the item a title.',
    titleTooLong: 'Keep the title under ' + TITLE_MAX + ' characters.',
    summaryTooLong: 'Keep the summary under ' + SUMMARY_MAX + ' characters.',
    noRecipients: 'Choose at least one role, group or person, or make it visible to everyone in the firm.',
    tooManyRecipients: 'Choose up to ' + RECIPIENTS_MAX + ' roles, ' + RECIPIENTS_MAX + ' groups and ' + RECIPIENTS_MAX + ' people.',
    versionNotReady: 'This version is not ready to publish yet. Refresh and try again in a minute.',
    notReady: {
      no_version: 'There is no saved version yet. Open it in the editor and save first.',
      not_current: 'A newer version was saved since you opened this. Refresh and publish the current version.',
      processing: 'LANA is still reading this version. Try again in a minute.',
      checksum_mismatch: 'This version is still being prepared. Wait a minute and try again.'
    },
    ingestionPending: 'LANA is still reading this version',
    ingestionFailed: 'LANA could not read this version',
    published: 'Published. LANA is reading it now.',
    enqueueFailed: 'Published, but LANA could not start reading it. Publish again in a few minutes. If it keeps happening, check that LANA is running.',
    noFile: 'Choose a file to upload.',
    fileTooLarge: 'That file is over 100 MB. Choose a smaller file.',
    fileType: 'Upload a Word document (.docx), a PDF or a plain text file (.txt).',
    manageForbidden: 'Only firm admins can manage the handbook.'
  };

  // ── Small readers ─────────────────────────────────────────────────

  function text(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function trimmed(value) {
    return text(value).trim();
  }

  function numberOrNull(value) {
    if (value === undefined || value === null || value === '') return null;
    var n = Number(value);
    return isFinite(n) ? n : null;
  }

  function defaultFormatDate(value) {
    var raw = text(value);
    return raw ? raw.substring(0, 10) : '';
  }

  function formatterFrom(options) {
    return options && typeof options.formatDate === 'function' ? options.formatDate : defaultFormatDate;
  }

  /** The list in a response: a bare array, payload[key], or payload.items. */
  function listFrom(payload, key) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    if (key && Array.isArray(payload[key])) return payload[key];
    if (Array.isArray(payload.items)) return payload.items;
    return [];
  }

  function versionLabel(versionNumber) {
    return versionNumber === null ? '' : 'Version ' + versionNumber;
  }

  /** "Version 3, published Nov 15, 2026" (either half may be missing). */
  function publishedLine(versionNumber, publishedAt, formatDate) {
    var date = publishedAt ? formatDate(publishedAt) : '';
    var version = versionLabel(versionNumber);
    if (version && date) return version + ', published ' + date;
    if (version) return version;
    if (date) return 'Published ' + date;
    return '';
  }

  function isIngestionPending(status) {
    return INGESTION_PENDING.indexOf(trimmed(status).toLowerCase()) !== -1;
  }

  function isIngestionFailed(status) {
    return INGESTION_FAILED.indexOf(trimmed(status).toLowerCase()) !== -1;
  }

  /** Toast after a publish: { level: 'success'|'warning', message }. */
  function publishResultMessage(result) {
    var status = trimmed(result && result.ingestion_status).toLowerCase();
    if (status === 'enqueue_failed') return { level: 'warning', message: MESSAGES.enqueueFailed };
    return { level: 'success', message: MESSAGES.published };
  }

  // ── Member views ──────────────────────────────────────────────────

  /** One row of GET /items. */
  function toMemberItem(dto, options) {
    var item = dto || {};
    var published = item.published_version || {};
    var versionNumber = numberOrNull(published.number !== undefined ? published.number : item.version_number);
    var publishedAt = text(published.published_at || item.published_at);
    return {
      id: text(item.id),
      title: text(item.title),
      summary: text(item.summary),
      versionNumber: versionNumber,
      publishedAt: publishedAt,
      versionLabel: versionLabel(versionNumber),
      publishedLine: publishedLine(versionNumber, publishedAt, formatterFrom(options)),
      createdAt: text(item.created_at),
      ingestionStatus: text(published.ingestion_status || item.ingestion_status)
    };
  }

  /** GET /items -> { items, total, hasMore }. */
  function toMemberPage(payload, options) {
    var items = listFrom(payload, 'items').map(function (dto) { return toMemberItem(dto, options); });
    var total = numberOrNull(payload && payload.total);
    return {
      items: items,
      total: total === null ? items.length : total,
      hasMore: !!(payload && payload.has_more)
    };
  }

  /** GET /items/:id for the reader drawer. */
  function toReaderView(dto, options) {
    var item = dto || {};
    var versionNumber = numberOrNull(item.version_number);
    return {
      id: text(item.id),
      title: text(item.title),
      summary: text(item.summary),
      content: text(item.content),
      documentId: text(item.document_id),
      versionNumber: versionNumber,
      publishedAt: text(item.published_at),
      meta: publishedLine(versionNumber, item.published_at, formatterFrom(options))
    };
  }

  // ── Admin views ───────────────────────────────────────────────────

  function idList(values) {
    if (!Array.isArray(values)) return [];
    var seen = {};
    var out = [];
    values.forEach(function (value) {
      var id = trimmed(value);
      if (id && !seen[id]) { seen[id] = true; out.push(id); }
    });
    return out;
  }

  function toVisibility(dto) {
    var v = dto || {};
    var mode = v.mode === VISIBILITY_RESTRICTED ? VISIBILITY_RESTRICTED : VISIBILITY_ORGANIZATION;
    return {
      mode: mode,
      roleIds: idList(v.role_ids),
      groupIds: idList(v.group_ids),
      userIds: idList(v.user_ids)
    };
  }

  function visibilityLabel(visibility) {
    return visibility && visibility.mode === VISIBILITY_RESTRICTED ? 'Restricted' : 'Everyone in the firm';
  }

  /**
   * Status chips for an item: the status, "Unpublished changes" when the
   * current version is newer than the published one, and the reading notice
   * while LANA is still taking in the published version.
   */
  function statusChips(item) {
    var chips = [];
    var status = STATUS[item.status] || STATUS.draft;
    chips.push({ key: item.status || 'draft', label: status.label, color: status.color });
    if (item.hasUnpublishedChanges && item.status === 'published') {
      chips.push({ key: 'changes', label: 'Unpublished changes', color: 'yellow' });
    }
    if (item.ingestionPending) {
      chips.push({ key: 'reading', label: MESSAGES.ingestionPending, color: 'blue' });
    }
    if (item.ingestionFailed) {
      chips.push({ key: 'read-failed', label: MESSAGES.ingestionFailed, color: 'red' });
    }
    return chips;
  }

  /** One row of GET /manage/items. */
  function toManageItem(dto, options) {
    var item = dto || {};
    var base = toMemberItem(item, options);
    var published = item.published_version || {};
    var editor = item.editor || {};
    var status = trimmed(item.status).toLowerCase();
    var view = {
      id: base.id,
      title: base.title,
      summary: base.summary,
      versionNumber: base.versionNumber,
      publishedAt: base.publishedAt,
      versionLabel: base.versionLabel,
      publishedLine: base.publishedLine,
      status: STATUS[status] ? status : 'draft',
      hasUnpublishedChanges: !!item.has_unpublished_changes,
      sourceDocumentId: text(item.source_document_id || editor.document_id),
      editorMatterId: text(editor.matter_id || item.matter_id),
      visibility: toVisibility(item.visibility),
      ingestionStatus: text(item.ingestion_status || published.ingestion_status),
      ingestionPending: false,
      ingestionFailed: false,
      currentVersionNumber: numberOrNull(item.current_version_number),
      createdAt: text(item.created_at),
      updatedAt: text(item.updated_at)
    };
    view.ingestionPending = view.status === 'published' && isIngestionPending(view.ingestionStatus);
    view.ingestionFailed = view.status === 'published' && isIngestionFailed(view.ingestionStatus);
    view.statusLabel = (STATUS[view.status] || STATUS.draft).label;
    view.visibilityLabel = visibilityLabel(view.visibility);
    view.chips = statusChips(view);
    return view;
  }

  function toManageList(payload, options) {
    return listFrom(payload, 'items').map(function (dto) { return toManageItem(dto, options); });
  }

  /** GET /items/:id/versions, newest first. */
  function toVersionRows(payload, options) {
    var formatDate = formatterFrom(options);
    return listFrom(payload, 'versions').map(function (dto) {
      var v = dto || {};
      var number = numberOrNull(v.version_number);
      return {
        versionNumber: number,
        label: versionLabel(number),
        createdAt: text(v.created_at),
        createdLabel: v.created_at ? formatDate(v.created_at) : '',
        createdBy: text(v.created_by_name),
        isCurrent: !!v.is_current,
        isPublished: !!v.is_published,
        signed: !!v.signed,
        canRestore: !v.is_current && number !== null
      };
    }).sort(function (a, b) { return (b.versionNumber || 0) - (a.versionNumber || 0); });
  }

  /** The version Publish acts on: the current one, or null. */
  function currentVersion(rows) {
    var list = Array.isArray(rows) ? rows : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].isCurrent) return list[i];
    }
    return null;
  }

  /** GET /items/:id/publications, newest first. */
  function toPublicationRows(payload, options) {
    var formatDate = formatterFrom(options);
    return listFrom(payload, 'publications').map(function (dto) {
      var p = dto || {};
      var number = numberOrNull(p.version_number);
      var endedAt = text(p.unpublished_at || p.superseded_at);
      var state = p.unpublished_at ? 'Unpublished' : (p.superseded_at ? 'Replaced' : 'Live');
      var by = text(p.published_by_name);
      return {
        versionNumber: number,
        title: text(p.title_at_publish),
        publishedAt: text(p.published_at),
        state: state,
        line: [versionLabel(number), p.published_at ? 'published ' + formatDate(p.published_at) : '', by ? 'by ' + by : '']
          .filter(Boolean).join(', '),
        endedLine: endedAt
          ? state + ' ' + formatDate(endedAt) + (p.unpublished_at && p.unpublished_by_name ? ' by ' + text(p.unpublished_by_name) : '')
          : ''
      };
    }).sort(function (a, b) {
      return a.publishedAt < b.publishedAt ? 1 : (a.publishedAt > b.publishedAt ? -1 : 0);
    });
  }

  // ── Recipient options ─────────────────────────────────────────────

  function roleOptions(payload) {
    return listFrom(payload, 'roles').filter(function (r) { return r && r.id && r.is_active !== false; })
      .map(function (r) { return { value: text(r.id), label: text(r.display_name || r.name) }; });
  }

  function groupOptions(payload) {
    return listFrom(payload, 'groups').filter(function (g) { return g && g.id; })
      .map(function (g) { return { value: text(g.id), label: text(g.name) }; });
  }

  function userOptions(payload) {
    return listFrom(payload, 'users').filter(function (u) { return u && u.id && u.is_active !== false; })
      .map(function (u) {
        var name = (trimmed(u.first_name) + ' ' + trimmed(u.last_name)).trim();
        return { value: text(u.id), label: name || text(u.email || u.username), description: name ? text(u.email) : '' };
      });
  }

  /** A lex-select multiple value (array, JSON array string, or "a,b") as ids. */
  function parseMultiValue(value) {
    if (Array.isArray(value)) return idList(value);
    var raw = trimmed(value);
    if (!raw) return [];
    if (raw.charAt(0) === '[') {
      try { return idList(JSON.parse(raw)); } catch (_e) { return []; }
    }
    return idList(raw.split(','));
  }

  // ── Payloads and validation ───────────────────────────────────────

  /** { mode, role_ids, group_ids, user_ids } for the API. Everyone sends no recipients. */
  function buildVisibilityPayload(form) {
    var f = form || {};
    if (f.mode !== VISIBILITY_RESTRICTED) {
      return { mode: VISIBILITY_ORGANIZATION, role_ids: [], group_ids: [], user_ids: [] };
    }
    return {
      mode: VISIBILITY_RESTRICTED,
      role_ids: parseMultiValue(f.roleIds),
      group_ids: parseMultiValue(f.groupIds),
      user_ids: parseMultiValue(f.userIds)
    };
  }

  function validateVisibility(payload) {
    var p = payload || {};
    if (p.mode !== VISIBILITY_RESTRICTED) return { valid: true, message: '' };
    var roles = (p.role_ids || []).length;
    var groups = (p.group_ids || []).length;
    var users = (p.user_ids || []).length;
    if (!roles && !groups && !users) return { valid: false, message: MESSAGES.noRecipients };
    if (roles > RECIPIENTS_MAX || groups > RECIPIENTS_MAX || users > RECIPIENTS_MAX) {
      return { valid: false, message: MESSAGES.tooManyRecipients };
    }
    return { valid: true, message: '' };
  }

  /** Title and summary as the API takes them, with a message when they cannot be sent. */
  function buildDetailsPayload(form) {
    var f = form || {};
    var title = trimmed(f.title);
    var summary = trimmed(f.summary);
    if (!title) return { valid: false, message: MESSAGES.titleRequired, field: 'title' };
    if (title.length > TITLE_MAX) return { valid: false, message: MESSAGES.titleTooLong, field: 'title' };
    if (summary.length > SUMMARY_MAX) return { valid: false, message: MESSAGES.summaryTooLong, field: 'summary' };
    return { valid: true, message: '', payload: { title: title, summary: summary } };
  }

  function fileExtension(name) {
    var value = text(name).toLowerCase();
    var dot = value.lastIndexOf('.');
    return dot === -1 ? '' : value.substring(dot);
  }

  /** A chosen upload: DOCX, PDF or plain text, up to 100 MB (the backend checks again). */
  function validateUploadFile(file) {
    if (!file) return { valid: false, message: MESSAGES.noFile };
    if (UPLOAD_EXTENSIONS.indexOf(fileExtension(file.name)) === -1) return { valid: false, message: MESSAGES.fileType };
    if (Number(file.size) > UPLOAD_MAX_BYTES) return { valid: false, message: MESSAGES.fileTooLarge };
    return { valid: true, message: '' };
  }

  /**
   * POST /items: a blank document to write in the editor (JSON body), or an
   * uploaded file (multipart; `file` is returned beside the payload and the
   * service sends visibility as a JSON string).
   */
  function buildCreatePayload(form) {
    var f = form || {};
    var details = buildDetailsPayload(f);
    if (!details.valid) return details;
    var visibility = buildVisibilityPayload(f);
    var check = validateVisibility(visibility);
    if (!check.valid) return { valid: false, message: check.message, field: 'visibility' };
    var payload = { title: details.payload.title, summary: details.payload.summary, visibility: visibility };
    if (f.source === CREATE_UPLOAD) {
      var upload = validateUploadFile(f.file);
      if (!upload.valid) return { valid: false, message: upload.message, field: 'file' };
      return { valid: true, message: '', payload: payload, file: f.file };
    }
    payload.template = 'blank_docx';
    return { valid: true, message: '', payload: payload };
  }

  /** Query for file-editor.html, or null when there is no document yet. */
  function editorParams(source) {
    var s = source || {};
    var editor = s.editor || {};
    var id = text(editor.document_id || s.source_document_id || s.sourceDocumentId);
    if (!id) return null;
    var params = { id: id };
    var matterId = text(editor.matter_id || s.editorMatterId || s.matter_id);
    if (matterId) params.matter_id = matterId;
    return params;
  }

  function errorCode(error) {
    var e = error || {};
    var data = e.data || {};
    return text(e.code || data.code || (data.error && data.error.code));
  }

  function errorReason(error) {
    var e = error || {};
    var data = e.data || {};
    var details = (data.error && data.error.details) || data.details || e.details || {};
    return text(details.reason);
  }

  /** A plain message for a failed handbook call. */
  function describeError(error, fallback) {
    var e = error || {};
    if (errorCode(e) === 'VERSION_NOT_READY') return MESSAGES.notReady[errorReason(e)] || MESSAGES.versionNotReady;
    if (e.status === 403) return 'You do not have permission to do that.';
    if (e.status === 404) return 'That item is no longer available.';
    if (e.status === 400 && e.message) return text(e.message);
    return fallback || 'Something went wrong. Check your connection and try again.';
  }

  var api = {
    TITLE_MAX: TITLE_MAX,
    SUMMARY_MAX: SUMMARY_MAX,
    RECIPIENTS_MAX: RECIPIENTS_MAX,
    VISIBILITY_ORGANIZATION: VISIBILITY_ORGANIZATION,
    VISIBILITY_RESTRICTED: VISIBILITY_RESTRICTED,
    MESSAGES: MESSAGES,
    listFrom: listFrom,
    CREATE_BLANK: CREATE_BLANK,
    CREATE_UPLOAD: CREATE_UPLOAD,
    UPLOAD_MAX_BYTES: UPLOAD_MAX_BYTES,
    publishedLine: publishedLine,
    isIngestionPending: isIngestionPending,
    isIngestionFailed: isIngestionFailed,
    publishResultMessage: publishResultMessage,
    validateUploadFile: validateUploadFile,
    toMemberItem: toMemberItem,
    toMemberPage: toMemberPage,
    toReaderView: toReaderView,
    toVisibility: toVisibility,
    visibilityLabel: visibilityLabel,
    statusChips: statusChips,
    toManageItem: toManageItem,
    toManageList: toManageList,
    toVersionRows: toVersionRows,
    currentVersion: currentVersion,
    toPublicationRows: toPublicationRows,
    roleOptions: roleOptions,
    groupOptions: groupOptions,
    userOptions: userOptions,
    parseMultiValue: parseMultiValue,
    buildVisibilityPayload: buildVisibilityPayload,
    validateVisibility: validateVisibility,
    buildDetailsPayload: buildDetailsPayload,
    buildCreatePayload: buildCreatePayload,
    editorParams: editorParams,
    errorCode: errorCode,
    errorReason: errorReason,
    describeError: describeError
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LanaFirmHandbookModels = api;
})(typeof window !== 'undefined' ? window : globalThis);
