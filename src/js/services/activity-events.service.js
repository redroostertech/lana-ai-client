/**
 * activity-events.service.js
 *
 * Best-effort client adapter for governed workspace/editor/chat activity
 * events. This intentionally stays tiny: product surfaces emit structured
 * event facts; Chef owns validation, authorization, persistence, and
 * projection.
 */
(function () {
  'use strict';

  var FORBIDDEN_DETAIL_KEYS = [
    'raw_text',
    'rawtext',
    'selected_text',
    'selectedtext',
    'selection_text',
    'selectiontext',
    'document_text',
    'documenttext',
    'full_text',
    'fulltext',
    'content',
    'prompt',
    'prompt_text',
    'prompttext',
    'completion',
    'completion_text',
    'completiontext',
    'message',
    'message_text',
    'messagetext'
  ];

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
  }

  function valueOrNull(value) {
    if (value === undefined || value === null || value === '') return null;
    return value;
  }

  function firstValue(values) {
    for (var i = 0; i < values.length; i++) {
      var value = valueOrNull(values[i]);
      if (value !== null) return value;
    }
    return null;
  }

  function mergeDetails() {
    var details = {};
    for (var i = 0; i < arguments.length; i++) {
      var source = arguments[i];
      if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
      var keys = Object.keys(source);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        if (source[key] !== undefined) details[key] = source[key];
      }
    }
    return details;
  }

  function hasForbiddenKey(value) {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) {
        if (hasForbiddenKey(value[i])) return true;
      }
      return false;
    }

    var keys = Object.keys(value);
    for (var k = 0; k < keys.length; k++) {
      var key = String(keys[k]).toLowerCase();
      if (FORBIDDEN_DETAIL_KEYS.indexOf(key) !== -1) return true;
      if (hasForbiddenKey(value[keys[k]])) return true;
    }
    return false;
  }

  function safeDetails(details, eventType) {
    details = details && typeof details === 'object' && !Array.isArray(details) ? details : {};
    if (hasForbiddenKey(details)) {
      console.warn('[ActivityEvents] Dropped unsafe activity event details', {
        event_type: eventType
      });
      return {};
    }
    return details;
  }

  function compactPayload(payload) {
    payload = payload || {};
    var details = safeDetails(payload.details, payload.event_type);

    return {
      event_type: payload.event_type,
      resource_type: payload.resource_type || 'other',
      resource_id: payload.resource_id || null,
      resource_name: payload.resource_name || null,
      matter_id: payload.matter_id || null,
      surface: payload.surface || null,
      interaction: payload.interaction || null,
      visibility: payload.visibility || 'workspace',
      details: details
    };
  }

  async function track(payload) {
    try {
      if (!window.api || typeof window.api.post !== 'function') return null;
      var body = compactPayload(payload);
      if (!body.event_type) return null;
      return await window.api.post('/api/v1/activity/events', body);
    } catch (error) {
      console.warn('[ActivityEvents] Failed to track activity event', {
        event_type: payload && payload.event_type,
        message: error && error.message
      });
      return null;
    }
  }

  function normalizeDocument(file, options) {
    file = file || {};
    options = options || {};

    var fileId = firstValue([
      options.document_id,
      options.documentId,
      options.file_id,
      options.fileId,
      file.id,
      file.document_id,
      file.documentId,
      file.file_id,
      file.fileId
    ]);

    var matterId = firstValue([
      options.matter_id,
      options.matterId,
      file.client_matter,
      file.matter_id,
      file.matterId,
      file.clientMatter
    ]);

    var documentName = firstValue([
      options.document_name,
      options.documentName,
      options.file_name,
      options.fileName,
      options.resource_name,
      options.resourceName,
      file.filename,
      file.file_name,
      file.fileName,
      file.name,
      file.title
    ]);

    return {
      fileId: fileId,
      matterId: matterId,
      documentName: documentName,
      contentType: firstValue([
        options.content_type,
        options.contentType,
        file.content_type,
        file.contentType,
        file.mime_type,
        file.mimeType
      ]),
      fileSize: firstValue([
        options.file_size,
        options.fileSize,
        file.file_size,
        file.fileSize,
        file.size
      ])
    };
  }

  function documentPayload(eventType, file, options, defaults) {
    options = options || {};
    defaults = defaults || {};

    var normalized = normalizeDocument(file, options);
    var baseDetails = mergeDetails({
      document_id: normalized.fileId,
      document_name: normalized.documentName,
      content_type: normalized.contentType,
      file_size: normalized.fileSize
    }, defaults.details);

    return {
      event_type: eventType,
      resource_type: 'document',
      resource_id: isUuid(normalized.fileId) ? normalized.fileId : null,
      resource_name: normalized.documentName,
      matter_id: normalized.matterId,
      surface: options.surface || defaults.surface || 'file_viewer',
      interaction: options.interaction || defaults.interaction || null,
      visibility: options.visibility || defaults.visibility || (normalized.matterId ? 'workspace' : 'private'),
      details: mergeDetails(baseDetails, options.details)
    };
  }

  function documentOpened(file, options) {
    file = file || {};
    options = options || {};
    return track(documentPayload('document.opened', file, options, {
      interaction: 'open',
      details: {
        lifecycle: firstValue([
          options.lifecycle,
          options.status,
          file.status,
          file.processing_status,
          file.processingStatus
        ]),
        chunk_count: firstValue([
          options.chunk_count,
          options.chunkCount,
          file.chunk_count,
          file.chunkCount,
          0
        ]),
        source: firstValue([
          options.source,
          file.source
        ])
      }
    }));
  }

  function documentDownloaded(file, options) {
    file = file || {};
    options = options || {};
    return track(documentPayload('document.downloaded', file, options, {
      interaction: 'download',
      details: {
        downloaded_as: firstValue([
          options.downloaded_as,
          options.downloadedAs,
          file.filename,
          file.file_name,
          file.fileName,
          file.name
        ]),
        demo_mode: options.demo_mode === true || options.demoMode === true || null
      }
    }));
  }

  function documentMetadataUpdated(file, options) {
    options = options || {};
    return track(documentPayload('document.metadata_updated', file, options, {
      interaction: 'metadata_save',
      details: {
        changed_fields: Array.isArray(options.changed_fields)
          ? options.changed_fields
          : (Array.isArray(options.changedFields) ? options.changedFields : [])
      }
    }));
  }

  function documentTemplateToggled(file, options) {
    file = file || {};
    options = options || {};
    var isTemplate = firstValue([
      options.is_template,
      options.isTemplate,
      options.enabled,
      file.is_template,
      file.isTemplate
    ]);
    if (isTemplate === null) {
      console.warn('[ActivityEvents] Skipped template toggle event without a resolved template state');
      return null;
    }
    var eventType = isTemplate === false ? 'document.template_disabled' : 'document.template_enabled';

    return track(documentPayload(eventType, file, options, {
      interaction: 'template_toggle',
      details: {
        is_template: isTemplate === null ? null : !!isTemplate
      }
    }));
  }

  function lanaOpenedForDocument(file, options) {
    options = options || {};
    var normalized = normalizeDocument(file, options);
    return track(documentPayload('document.lana_opened', file, options, {
      interaction: 'lana_open',
      details: {
        document_attached: normalized.fileId !== null,
        has_matter_scope: normalized.matterId !== null
      }
    }));
  }

  function lanaMessageSentForDocument(file, options) {
    options = options || {};
    var normalized = normalizeDocument(file, options);
    return track(documentPayload('document.lana_message_sent', file, options, {
      interaction: 'lana_message',
      details: {
        message_length: firstValue([
          options.message_length,
          options.messageLength
        ]),
        has_matter_scope: normalized.matterId !== null,
        has_document_attachment: normalized.fileId !== null
      }
    }));
  }

  function scopedEventName(scope, eventType) {
    eventType = valueOrNull(eventType);
    if (eventType === null) return null;
    eventType = String(eventType);
    if (eventType.indexOf('.') !== -1) return eventType;
    if (scope === 'workspace') return 'chat.' + eventType;
    return eventType.indexOf(scope + '.') === 0 ? eventType : scope + '.' + eventType;
  }

  function scopedEvent(scope, eventType, payload, options) {
    payload = payload || {};
    options = options || {};
    var normalizedEventType = scopedEventName(scope, eventType);
    var rawResourceId = payload.resource_id || options.resource_id || options.resourceId || null;
    var defaultResourceType = scope === 'workspace' ? 'chat' : scope;
    return track({
      event_type: normalizedEventType,
      resource_type: payload.resource_type || options.resource_type || options.resourceType || defaultResourceType,
      resource_id: isUuid(rawResourceId) ? rawResourceId : null,
      resource_name: payload.resource_name || options.resource_name || options.resourceName || null,
      matter_id: payload.matter_id || payload.matterId || options.matter_id || options.matterId || null,
      surface: payload.surface || options.surface || scope,
      interaction: payload.interaction || options.interaction || eventType || null,
      visibility: payload.visibility || options.visibility || 'workspace',
      details: mergeDetails(payload.details, options.details)
    });
  }

  function editorEvent(eventType, payload, options) {
    return scopedEvent('editor', eventType, payload, options);
  }

  function workspaceEvent(eventType, payload, options) {
    return scopedEvent('workspace', eventType, payload, options);
  }

  window.LanaActivityEvents = {
    track: track,
    documentOpened: documentOpened,
    documentDownloaded: documentDownloaded,
    documentMetadataUpdated: documentMetadataUpdated,
    documentTemplateToggled: documentTemplateToggled,
    lanaOpenedForDocument: lanaOpenedForDocument,
    lanaMessageSentForDocument: lanaMessageSentForDocument,
    editorEvent: editorEvent,
    workspaceEvent: workspaceEvent
  };
})();
