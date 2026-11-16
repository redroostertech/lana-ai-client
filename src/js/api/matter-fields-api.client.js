/**
 * Matter Fields API Client
 *
 * Transport for typed custom matter fields. Request shapes and mapping live
 * in shared/matter-fields.js.
 *
 *   GET    /api/v1/matter-field-definitions          (org-level catalog)
 *   POST   /api/v1/matter-field-definitions
 *   PATCH  /api/v1/matter-field-definitions/:id
 *   DELETE /api/v1/matter-field-definitions/:id      (archive)
 *   GET    /api/v1/matters/:matter_id/field-values
 *   PUT    /api/v1/matters/:matter_id/field-values   { values: [{ field_key, value }] }
 *
 * A failed save rejects with the api error, plus `userMessage` (the server's
 * wording) and, when it could be read, `baseline` (what the server now holds,
 * so a retry does not create a field twice).
 *
 * @requires api.js (global api instance)
 * @requires LanaMatterFields (shared/matter-fields.js)
 */

class MatterFieldsAPIClient {
  /**
   * @param {Object} apiClient - global api instance
   */
  constructor(apiClient) {
    this.api = apiClient;
  }

  fields() {
    if (typeof window !== 'undefined' && window.LanaMatterFields) return window.LanaMatterFields;
    return require('../shared/matter-fields.js');
  }

  async send(request) {
    if (request.method === 'GET') return this.api.get(request.path);
    if (request.method === 'DELETE') return this.api.delete(request.path);
    if (request.method === 'PATCH') return this.api.patch(request.path, request.body);
    if (request.method === 'PUT') return this.api.put(request.path, request.body);
    return this.api.post(request.path, request.body);
  }

  /** This matter's values, as the server returns them. */
  async listValues(matterId) {
    return this.send(this.fields().valuesRequest(matterId));
  }

  /** Org definitions plus this matter's values, as drawer state. */
  async loadDrawer(matterId) {
    const fields = this.fields();
    const [definitions, values] = await Promise.all([
      this.send(fields.definitionsRequest()),
      this.listValues(matterId)
    ]);
    return fields.toDrawerState(definitions, values);
  }

  /**
   * Write the drawer: definition changes first (org-level), then this matter's
   * values in one transaction.
   * @param {string} matterId
   * @param {Object} baseline - the state loadDrawer returned
   * @param {Object} current - the edited state
   */
  async saveDrawer(matterId, baseline, current) {
    const fields = this.fields();
    const plan = fields.planSave(baseline, current);
    if (plan.errors.length) {
      const invalid = new Error(plan.errors.join(' '));
      invalid.userMessage = invalid.message;
      throw invalid;
    }
    try {
      for (const request of fields.buildSaveRequests(matterId, plan)) {
        await this.send(request);
      }
    } catch (error) {
      error.userMessage = fields.errorMessage(error);
      try {
        error.baseline = await this.loadDrawer(matterId);
      } catch (_) { /* keep the original refusal */ }
      throw error;
    }
  }
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MatterFieldsAPIClient;
}

// Make available globally for browser use
if (typeof window !== 'undefined') {
  window.MatterFieldsAPIClient = MatterFieldsAPIClient;
}
