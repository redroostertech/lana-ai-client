/**
 * Custom Objects API Client
 *
 * Transport for the organization's custom object types and their attachment
 * to matters. Request shapes and mapping live in shared/custom-objects.js;
 * the backend decides every rule.
 *
 * @requires api.js (global api instance)
 * @requires LanaCustomObjects (shared/custom-objects.js)
 */

class CustomObjectsAPIClient {
  constructor(apiClient) {
    this.api = apiClient;
  }

  shape() {
    if (typeof window !== 'undefined' && window.LanaCustomObjects) return window.LanaCustomObjects;
    return require('../shared/custom-objects.js');
  }

  send(request) {
    if (request.method === 'GET') return this.api.get(request.path);
    if (request.method === 'DELETE') return this.api.delete(request.path);
    if (request.method === 'PATCH') return this.api.patch(request.path, request.body);
    return this.api.post(request.path, request.body);
  }

  async listTypes(includeArchived) {
    const answer = await this.send(this.shape().requests.listTypes(includeArchived));
    return (answer && answer.types) || [];
  }

  async saveDraft(draft) {
    const body = this.shape().bodyFromDraft(draft);
    const answer = await this.send(draft.isNew ? this.shape().requests.createType(body) : this.shape().requests.updateType(draft.id, body));
    return answer && answer.type;
  }

  async archiveType(id) {
    const answer = await this.send(this.shape().requests.archiveType(id));
    return answer && answer.type;
  }

  matterTypes(matterId, q) {
    return this.send(this.shape().requests.matterTypes(matterId, q));
  }

  attach(matterId, typeId) {
    return this.send(this.shape().requests.attach(matterId, typeId));
  }

  detach(matterId, typeId) {
    return this.send(this.shape().requests.detach(matterId, typeId));
  }
}

if (typeof module !== 'undefined' && module.exports) { module.exports = CustomObjectsAPIClient; }
if (typeof window !== 'undefined') { window.CustomObjectsAPIClient = CustomObjectsAPIClient; }
