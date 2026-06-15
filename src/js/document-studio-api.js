// document-studio-api.js - Unified Document Studio Templates API Client (C3)
//
// Thin wrapper over the Phase 3 Part C read surface that lists/gets templates
// across the three engines (fill / compose / render) through one endpoint.
// Reuses window.api for auth + base URL; no fetch/token handling here.
//
// Backend API:
//   GET /api/v1/document-studio/templates
//       ?kind=&matter_id=&document_type=&category=&q=&include_org_wide=&limit=&offset=
//       -> { templates: UnifiedTemplate[], total, counts_by_kind, limit, offset }
//   GET /api/v1/document-studio/templates/:kind/:id -> UnifiedTemplate (with kind_meta)
//
// NOTE: NO regex — string methods only (per LEX-COMPONENT-RULES section 11).

(function (global) {
  'use strict';

  var BASE = '/api/v1/document-studio/templates';

  // Query-string building lives in the pure mapper module so it is unit-testable.
  var mapper = (typeof require === 'function')
    ? require('./shared/document-studio-templates-mapper.js')
    : global.DocumentStudioTemplatesMapper;

  var DocumentStudioAPI = {
    /**
     * List unified templates across all three engines.
     * @param {Object} [filters] - see buildListQuery (kind, matterId, documentType,
     *   category, q, includeOrgWide, limit, offset)
     * @returns {Promise<Object>} raw API body
     *   { templates, total, counts_by_kind, limit, offset }
     */
    async listTemplates(filters) {
      var query = mapper && mapper.buildListQuery ? mapper.buildListQuery(filters) : '';
      var endpoint = query ? BASE + '?' + query : BASE;
      return global.api.get(endpoint);
    },

    /**
     * Fetch a single unified template by kind + id (read model; includes kind_meta).
     * @param {string} kind - 'fill' | 'compose' | 'render'
     * @param {string} id - row id (unique within its kind)
     * @returns {Promise<Object>} UnifiedTemplate
     */
    async getTemplate(kind, id) {
      var k = encodeURIComponent(String(kind || ''));
      var i = encodeURIComponent(String(id || ''));
      return global.api.get(BASE + '/' + k + '/' + i);
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DocumentStudioAPI;
  }
  if (global) {
    global.DocumentStudioAPI = DocumentStudioAPI;
  }
})(typeof window !== 'undefined' ? window : this);
