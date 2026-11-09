/**
 * Cloud Endpoint API Client
 *
 * The one place the client talks to the organization's own cloud AI endpoint
 * (an outside provider such as OpenAI, Claude, Gemini or Perplexity, or any
 * OpenAI-compatible server). If a backend shape changes, adjust it here.
 *
 * Backend src/services/processor/cloud-endpoint (cloud-endpoint.routes.js, cloud-endpoint.models.js,
 * services/cloud-endpoint/cloud-endpoint.service.js), admin:manage_organization:
 *   GET    /api/v1/admin/cloud-endpoint        -> { status, data: { endpoint|null, providers } }
 *   PUT    /api/v1/admin/cloud-endpoint        body: provider, base_url|null, hosted_by, model,
 *          api_key (leave out to keep the saved key, null to clear it), redaction_enabled, enabled,
 *          expected_updated_at (the updated_at read, null when there was none)
 *          -> { status, data: { endpoint, providers } }
 *   DELETE /api/v1/admin/cloud-endpoint        -> { status, data: { endpoint: null, providers } }
 *   POST   /api/v1/admin/cloud-endpoint/test   body: {} (the saved setting) or the setting fields
 *          without expected_updated_at -> { status, data: { ok, outcome, message, detail, latency_ms } }
 *   endpoint: { provider, provider_label, dialect, base_url|null, effective_base_url, hosted_by,
 *               model, api_key_set, api_key_masked|null, redaction_enabled, enabled,
 *               updated_by, updated_by_name, updated_at }   (the key itself is never returned)
 *   providers: [{ id, label, dialect, default_base_url|null, url_required, key_required, can_be_firm_hosted? }]
 *   outcome: ok | unauthorized | not_found | rate_limited | unreachable | proxy_unavailable | error
 *   Errors: 400 VALIDATION_ERROR { error: { message, field } }, 403 (not an organization admin),
 *   409 CLOUD_ENDPOINT_STALE (changed since expected_updated_at; nothing written).
 *
 * @requires api.js (global api instance)
 */

(function (global) {
  'use strict';

  var PATH = '/api/v1/admin/cloud-endpoint';

  class CloudEndpointAPIClient {
    constructor(apiClient) {
      this.api = apiClient;
    }

    /** { endpoint, providers }. A 403 or 404 (not an admin, or an older server) is not logged. */
    async get() {
      var response = await this.api.get(PATH, { quietStatuses: [403, 404] });
      return (response && response.data) || null;
    }

    async save(body) {
      var response = await this.api.put(PATH, body);
      return (response && response.data) || null;
    }

    async remove() {
      var response = await this.api.delete(PATH);
      return (response && response.data) || null;
    }

    async test(body) {
      var response = await this.api.post(PATH + '/test', body || {});
      return (response && response.data) || null;
    }
  }

  CloudEndpointAPIClient.PATH = PATH;

  if (typeof module !== 'undefined' && module.exports) module.exports = CloudEndpointAPIClient;
  if (global) global.CloudEndpointAPIClient = CloudEndpointAPIClient;
})(typeof window !== 'undefined' ? window : globalThis);
