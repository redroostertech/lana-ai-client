/**
 * Authenticated content boundary for spreadsheet and presentation editing.
 *
 * JSON edit models travel through the shared Lana API client. Native exports
 * use fetch directly because ApiClient intentionally parses responses as JSON.
 */
(function (global) {
  'use strict';

  var DEFAULT_BASE_PATH = '/api/v1/file-editor';
  var EXPORT_FORMATS = ['csv', 'xlsx', 'pptx'];

  function requiredIdentifier(value, label) {
    var id = String(value === undefined || value === null ? '' : value).trim();
    if (!id) throw new TypeError((label || 'Identifier') + ' is required.');
    if (id.length > 512) throw new TypeError((label || 'Identifier') + ' is too long.');
    return id;
  }

  function requiredModel(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('Edit model is required.');
    }
    return value;
  }

  function basePath(value) {
    var path = String(value || DEFAULT_BASE_PATH).trim();
    if (!path || path.charAt(0) !== '/') throw new TypeError('File Editor API base path must begin with /.');
    return path.replace(/\/+$/, '');
  }

  function responseData(response) {
    return response && response.data !== undefined && response.data !== null
      ? response.data
      : response;
  }

  function normalizeEditResponse(response) {
    var value = responseData(response);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('File Editor content API returned an invalid response.');
    }
    var model = value.model || value.edit_model;
    if (!model || typeof model !== 'object' || Array.isArray(model)) {
      throw new Error('File Editor content API did not return an edit model.');
    }
    return {
      model: model,
      document: value.document || value.file || null
    };
  }

  function exportFormat(value) {
    var format = String(value || '').trim().toLowerCase();
    if (EXPORT_FORMATS.indexOf(format) === -1) {
      throw new TypeError('Export format must be csv, xlsx, or pptx.');
    }
    return format;
  }

  function dispositionFilename(header) {
    var value = String(header || '');
    var encoded = /filename\*=UTF-8''([^;]+)/i.exec(value);
    if (encoded) {
      try { return decodeURIComponent(encoded[1].replace(/^"|"$/g, '')); } catch (_) {}
    }
    var simple = /filename=(?:"([^"]+)"|([^;]+))/i.exec(value);
    return simple ? String(simple[1] || simple[2] || '').trim() : '';
  }

  function errorMessage(text, fallback) {
    if (!text) return fallback;
    try {
      var parsed = JSON.parse(text);
      return String(
        parsed.detail || parsed.message ||
        (parsed.error && (parsed.error.message || parsed.error.detail)) ||
        fallback
      );
    } catch (_) {
      return String(text).slice(0, 300) || fallback;
    }
  }

  function create(options) {
    var settings = options || {};
    var rootPath = basePath(settings.basePath);

    function client() {
      var value = settings.api || global.api;
      if (!value || typeof value.get !== 'function' || typeof value.put !== 'function') {
        throw new Error('Authenticated Lana API client is unavailable.');
      }
      return value;
    }

    function documentPath(documentId, suffix) {
      return rootPath + '/documents/' + encodeURIComponent(requiredIdentifier(documentId, 'Document id')) + (suffix || '');
    }

    async function exportRequest(documentId, format) {
      var api = client();
      if (api._readyPromise && typeof api._readyPromise.then === 'function') await api._readyPromise;
      var fetchImpl = settings.fetch || global.fetch;
      if (typeof fetchImpl !== 'function') throw new Error('File export is unavailable in this client.');

      var headers = typeof api.getHeaders === 'function' ? api.getHeaders() : { 'Content-Type': 'application/json' };
      headers = Object.assign({}, headers, { Accept: 'application/octet-stream' });
      var response = await fetchImpl(
        String(api.baseUrl || '').replace(/\/+$/, '') + documentPath(documentId, '/export'),
        {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({ format: format })
        }
      );
      if (!response.ok) {
        var text = await response.text();
        throw new Error(errorMessage(text, 'The Office file could not be exported.'));
      }
      return {
        blob: await response.blob(),
        filename: dispositionFilename(response.headers && response.headers.get('Content-Disposition')),
        mimeType: String(response.headers && response.headers.get('Content-Type') || 'application/octet-stream')
      };
    }

    return {
      paths: {
        editModel: function (documentId) { return documentPath(documentId, '/edit-model'); },
        export: function (documentId) { return documentPath(documentId, '/export'); }
      },

      getEditModel: async function (documentId) {
        return normalizeEditResponse(await client().get(documentPath(documentId, '/edit-model')));
      },

      saveEditModel: async function (documentId, model) {
        return normalizeEditResponse(await client().put(documentPath(documentId, '/edit-model'), {
          model: requiredModel(model)
        }));
      },

      exportDocument: async function (documentId, format) {
        return exportRequest(documentId, exportFormat(format));
      }
    };
  }

  var service = create();
  service.create = create;
  service.DEFAULT_BASE_PATH = DEFAULT_BASE_PATH;

  if (typeof module !== 'undefined' && module.exports) module.exports = service;
  global.LanaFileEditorContentApi = service;
})(typeof window !== 'undefined' ? window : globalThis);
