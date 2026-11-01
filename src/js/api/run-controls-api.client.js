/**
 * Run Controls API Client
 *
 * The one place the client talks to the organization's run limits and agent
 * usage routes (design 13 decision 5, design 14 "Cost"). If a backend shape
 * changes, adjust it here.
 *
 * Run limits, backend src/services/processor/runs (runs.routes.js, runs.models.js,
 * services/runs/run-limits.service.js), admin:manage_organization:
 *   GET /api/v1/admin/run-limits
 *       -> { status, data: { limits } }
 *   PUT /api/v1/admin/run-limits   body: any of the three limit fields (at least one, no others) and
 *       expected_updated_at (required: the updated_at read, null when is_default)
 *       -> { status, data: { limits } }
 *   limits: { max_automatic_agent_runs_per_day: int, max_agent_spend_microdollars_per_day: int|null,
 *             automatic_runs_paused: bool, paused_by: uuid|null, paused_by_name: string|null, paused_at: iso|null,
 *             updated_by: uuid|null, updated_by_name: string|null, updated_at: iso|null, is_default: bool,
 *             started_today: int (automatic agent runs counted against the daily limit today) }
 *   Fields left out keep their stored value. 400 VALIDATION_ERROR { error: { field, details: [zod issue] } },
 *   403 AUTHORIZATION_ERROR (no admin:manage_organization), 409 RUN_LIMITS_STALE (the limits changed since
 *   expected_updated_at; nothing written; error.details.limits is the current limits).
 *
 * Usage, @agents app (optional; 404 when it is not installed), agents:run:
 *   GET /api/v1/agents/usage?since=ISO&until=ISO   (bare body; default window the last 30 days)
 *       -> { usage: { window: { since, until }, totals: bucket,
 *            by_agent: [{ agent_definition_id, agent_slug, agent_name, ...bucket }],
 *            by_trigger_type: [{ trigger_type, ...bucket }],
 *            by_matter: [{ matter_id|null, matter_code|null, matter_name|null, ...bucket }] } }
 *   bucket: { runs, input_tokens, output_tokens, total_tokens, estimated_cost_microdollars: int|null }
 *   (null cost: no model_pricing row for the models used). 400 { error } when until <= since;
 *   400 VALIDATION_ERROR when since or until is not an ISO date-time.
 *
 * @requires api.js (global api instance)
 */

(function (global) {
  'use strict';

  function enc(value) { return encodeURIComponent(String(value)); }

  var requests = {
    runLimits: function () {
      return { method: 'GET', path: '/api/v1/admin/run-limits' };
    },
    updateRunLimits: function (change) {
      return { method: 'PUT', path: '/api/v1/admin/run-limits', body: change };
    },
    usage: function (window) {
      var range = window || {};
      var parts = [];
      if (range.since) parts.push('since=' + enc(range.since));
      if (range.until) parts.push('until=' + enc(range.until));
      return { method: 'GET', path: '/api/v1/agents/usage' + (parts.length ? '?' + parts.join('&') : '') };
    }
  };

  class RunControlsAPIClient {
    constructor(apiClient) {
      this.api = apiClient;
    }

    send(request) {
      if (request.method === 'GET') return this.api.get(request.path);
      return this.api.put(request.path, request.body);
    }

    async getRunLimits() {
      var response = await this.send(requests.runLimits());
      return (response && response.data && response.data.limits) || null;
    }

    async updateRunLimits(change) {
      var response = await this.send(requests.updateRunLimits(change));
      return (response && response.data && response.data.limits) || null;
    }

    async getUsage(window) {
      var response = await this.send(requests.usage(window));
      return (response && response.usage) || null;
    }
  }

  RunControlsAPIClient.requests = requests;

  if (typeof module !== 'undefined' && module.exports) module.exports = RunControlsAPIClient;
  if (global) global.RunControlsAPIClient = RunControlsAPIClient;
})(typeof window !== 'undefined' ? window : globalThis);
