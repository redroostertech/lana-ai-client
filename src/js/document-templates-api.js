// document-templates-api.js - Document Templates & Automation Rules API Client
// Provides API methods for Document Generation feature

/**
 * Document Templates API Wrapper
 *
 * Backend API Endpoints (all production-ready):
 * - GET    /api/v1/document-templates          - List templates
 * - GET    /api/v1/document-templates/:id      - Get single template
 * - POST   /api/v1/document-templates          - Create template
 * - PUT    /api/v1/document-templates/:id      - Update template
 * - DELETE /api/v1/document-templates/:id      - Delete template
 * - POST   /api/v1/document-templates/:id/clone - Clone template
 * - POST   /api/v1/document-templates/:id/generate - Generate document
 * - GET    /api/v1/document-automation/rules   - List automation rules
 * - POST   /api/v1/document-automation/rules   - Create automation rule
 * - PUT    /api/v1/document-automation/rules/:id - Update automation rule
 * - DELETE /api/v1/document-automation/rules/:id - Delete automation rule
 * - POST   /api/v1/document-automation/rules/:id/enable - Enable rule
 * - POST   /api/v1/document-automation/rules/:id/disable - Disable rule
 */

const DocumentTemplatesAPI = {
  // ============================================================
  // Document Templates CRUD
  // ============================================================

  /**
   * List all document templates
   * @param {Object} params - Query parameters (category, search, page, limit)
   * @returns {Promise<Object>} { templates: Array, total: Number }
   */
  async listTemplates(params = {}) {
    const queryParams = new URLSearchParams(params).toString();
    const endpoint = queryParams
      ? `/api/v1/document-templates?${queryParams}`
      : '/api/v1/document-templates';
    return await api.get(endpoint);
  },

  /**
   * Get a single document template by ID
   * @param {string} id - Template ID
   * @returns {Promise<Object>} { template: Object }
   */
  async getTemplate(id) {
    return await api.get(`/api/v1/document-templates/${id}`);
  },

  /**
   * Create a new document template
   * @param {Object} data - Template data (name, description, category, content, variables)
   * @returns {Promise<Object>} { template: Object, message: String }
   */
  async createTemplate(data) {
    return await api.post('/api/v1/document-templates', data);
  },

  /**
   * Update an existing document template
   * @param {string} id - Template ID
   * @param {Object} data - Updated template data
   * @returns {Promise<Object>} { template: Object, message: String }
   */
  async updateTemplate(id, data) {
    return await api.put(`/api/v1/document-templates/${id}`, data);
  },

  /**
   * Delete a document template
   * @param {string} id - Template ID
   * @returns {Promise<Object>} { success: Boolean, message: String }
   */
  async deleteTemplate(id) {
    return await api.delete(`/api/v1/document-templates/${id}`);
  },

  /**
   * Clone an existing template
   * @param {string} id - Template ID to clone
   * @param {string} name - New template name
   * @returns {Promise<Object>} { template: Object, message: String }
   */
  async cloneTemplate(id, name) {
    return await api.post(`/api/v1/document-templates/${id}/clone`, { name });
  },

  /**
   * Generate a document from a template
   * @param {string} id - Template ID
   * @param {Object} variables - Variable values to fill in template
   * @param {string} output_format - Output format (html, pdf, docx)
   * @returns {Promise<Object>} { document: Object, content: String }
   */
  async generateDocument(id, variables, output_format = 'html') {
    return await api.post(`/api/v1/document-templates/${id}/generate`, {
      variables,
      output_format
    });
  },

  // ============================================================
  // Document Automation Rules CRUD
  // ============================================================

  /**
   * List all automation rules
   * @param {Object} params - Query parameters (enabled, trigger, page, limit)
   * @returns {Promise<Object>} { rules: Array, total: Number }
   */
  async listRules(params = {}) {
    const queryParams = new URLSearchParams(params).toString();
    const endpoint = queryParams
      ? `/api/v1/document-automation/rules?${queryParams}`
      : '/api/v1/document-automation/rules';
    return await api.get(endpoint);
  },

  /**
   * Get a single automation rule by ID
   * @param {string} id - Rule ID
   * @returns {Promise<Object>} { rule: Object }
   */
  async getRule(id) {
    return await api.get(`/api/v1/document-automation/rules/${id}`);
  },

  /**
   * Create a new automation rule
   * @param {Object} data - Rule data (trigger, template_id, actions, enabled)
   * @returns {Promise<Object>} { rule: Object, message: String }
   */
  async createRule(data) {
    return await api.post('/api/v1/document-automation/rules', data);
  },

  /**
   * Update an existing automation rule
   * @param {string} id - Rule ID
   * @param {Object} data - Updated rule data
   * @returns {Promise<Object>} { rule: Object, message: String }
   */
  async updateRule(id, data) {
    return await api.put(`/api/v1/document-automation/rules/${id}`, data);
  },

  /**
   * Delete an automation rule
   * @param {string} id - Rule ID
   * @returns {Promise<Object>} { success: Boolean, message: String }
   */
  async deleteRule(id) {
    return await api.delete(`/api/v1/document-automation/rules/${id}`);
  },

  /**
   * Enable an automation rule
   * @param {string} id - Rule ID
   * @returns {Promise<Object>} { rule: Object, message: String }
   */
  async enableRule(id) {
    return await api.post(`/api/v1/document-automation/rules/${id}/enable`);
  },

  /**
   * Disable an automation rule
   * @param {string} id - Rule ID
   * @returns {Promise<Object>} { rule: Object, message: String }
   */
  async disableRule(id) {
    return await api.post(`/api/v1/document-automation/rules/${id}/disable`);
  }
};
