/**
 * Matter Fields API Client
 *
 * Transport for typed custom matter fields. A field lives in the organization
 * library and applies only to the matters that attached it. Request shapes and
 * mapping live in shared/matter-fields.js.
 *
 *   GET    /api/v1/matters/:id/field-attachments                 this matter's fields
 *   POST   /api/v1/matters/:id/field-attachments                 attach { field_definition_id }
 *   DELETE /api/v1/matters/:id/field-attachments/:definition_id  detach (value kept, hidden)
 *   GET    /api/v1/matters/:id/field-library?q=                  library, each row `attached`
 *   POST   /api/v1/matter-field-definitions                      create a library field
 *   PATCH  /api/v1/matter-field-definitions/:id                  label, required, options
 *   GET    /api/v1/matters/:id/field-values
 *   PUT    /api/v1/matters/:id/field-values                      { values: [{ field_key, value }] }
 *
 * A failed save rejects with the api error, plus `userMessage` (the server's
 * wording) and, when it could be read, `baseline` (what the server now holds).
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

  /** The organization library for the picker (server response). */
  async searchLibrary(matterId, query) {
    return this.send(this.fields().libraryRequest(matterId, query));
  }

  /** This matter's attached fields plus their values, as drawer state. */
  async loadDrawer(matterId) {
    const fields = this.fields();
    const [attached, values] = await Promise.all([
      this.send(fields.attachedRequest(matterId)),
      this.listValues(matterId)
    ]);
    return fields.toDrawerState(attached, values);
  }

  /**
   * Create a library field and return its id. When the key already exists in
   * the library (409, for example after a save that half landed), the
   * existing field is used instead of failing again.
   */
  async createOrFind(matterId, create) {
    const fields = this.fields();
    try {
      const created = await this.send(fields.createRequest(create.body));
      return created && created.data && created.data.id;
    } catch (error) {
      if (error && error.status === 409) {
        const existing = fields.findLibraryDefinition(await this.searchLibrary(matterId, create.key), create.key);
        if (existing) return existing.id;
      }
      throw error;
    }
  }

  /**
   * Write the drawer: library fields first (create, edit), then this matter's
   * attachments, then its values in one transaction.
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
      const attachIds = plan.attaches.slice();
      for (const create of plan.creates) {
        attachIds.push(await this.createOrFind(matterId, create));
      }
      for (const update of plan.updates) {
        await this.send(fields.updateRequest(update));
      }
      for (const id of attachIds) {
        await this.send(fields.attachRequest(matterId, id));
      }
      for (const id of plan.detaches) {
        await this.send(fields.detachRequest(matterId, id));
      }
      if (plan.values.length) {
        await this.send(fields.valuesWriteRequest(matterId, plan.values));
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
