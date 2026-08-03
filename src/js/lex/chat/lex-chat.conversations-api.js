/* ==========================================================================
   Lex UI — Conversation Domain API
   Owns Lex chat conversation endpoint knowledge and delegates transport,
   auth headers, and standard JSON requests to the core window.api client.
   ========================================================================== */

(function (global) {
  'use strict';

  const Lex = global.Lex;
  if (!Lex) { console.error('[Lex ConversationsApi] Lex core not loaded'); return; }
  Lex.Chat = Lex.Chat || {};

  function encode(value) {
    return encodeURIComponent(value);
  }

  function readJsonSafe(response) {
    return response.json().catch(function () { return null; });
  }

  class ConversationsApiClient {
    constructor(apiClient, options = {}) {
      this.api = apiClient || global.api || null;
      this.endpoint = options.endpoint || '';
    }

    _requireApi() {
      if (!this.api) {
        throw new Error('Core API client not available');
      }
      return this.api;
    }

    async _resolveBaseUrl() {
      const api = this._requireApi();

      if (api._readyPromise) await api._readyPromise;
      if (api.baseUrl) return api.baseUrl;
      if (this.endpoint) return this.endpoint;

      const configUrl = global.LanaConfig && global.LanaConfig.API_BASE_URL;
      if (configUrl) return configUrl;

      if (global.location && global.location.protocol !== 'file:' && global.location.origin !== 'null') {
        return global.location.origin;
      }

      throw new Error('Server not connected. Please wait for server discovery or check your connection.');
    }

    _headers() {
      const api = this._requireApi();
      if (typeof api.getHeaders === 'function') {
        return api.getHeaders();
      }

      const headers = { 'Content-Type': 'application/json' };
      if (api.token) headers.Authorization = `Bearer ${api.token}`;
      return headers;
    }

    async createConversation(payload = {}) {
      const api = this._requireApi();
      if (typeof api.createConversation === 'function') {
        return api.createConversation(payload);
      }
      return api.post('/api/v1/conversations', payload);
    }

    async getMessages(conversationId, page, limit) {
      const api = this._requireApi();
      return api.get(`/api/v1/conversations/${encode(conversationId)}/messages?page=${page}&limit=${limit}&order=desc`);
    }

    async streamMessage(conversationId, body, signal) {
      const baseUrl = await this._resolveBaseUrl();
      const response = await fetch(`${baseUrl}/api/v1/conversations/${encode(conversationId)}/messages/stream`, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify(body),
        signal
      });
      return response;
    }

    async getGeneration(conversationId) {
      const api = this._requireApi();
      if (typeof api.getConversationGeneration === 'function') {
        return api.getConversationGeneration(conversationId);
      }
      return api.get(`/api/v1/conversations/${encode(conversationId)}/generation`);
    }

    async stopGeneration(conversationId) {
      const api = this._requireApi();
      if (typeof api.stopConversationGeneration === 'function') {
        return api.stopConversationGeneration(conversationId);
      }
      return api.post(`/api/v1/conversations/${encode(conversationId)}/generation/stop`, {});
    }

    async addDocument(conversationId, docId, filename, matterId) {
      const api = this._requireApi();
      const payload = { documentId: docId, filename, matterId };
      const response = await api.post(`/api/chat/conversations/${encode(conversationId)}/documents`, payload);
      return response && response.state ? response.state : null;
    }

    async removeDocument(conversationId, docId) {
      const api = this._requireApi();
      const response = await api.delete(`/api/chat/conversations/${encode(conversationId)}/documents/${encode(docId)}`);
      return response && response.state ? response.state : null;
    }

    async clearDocuments(conversationId) {
      const api = this._requireApi();
      const response = await api.post(`/api/chat/conversations/${encode(conversationId)}/documents/clear`, {});
      return response && response.state ? response.state : null;
    }

    async loadState(conversationId) {
      const api = this._requireApi();
      const response = await api.get(`/api/chat/conversations/${encode(conversationId)}/state`);
      return response && response.state ? response.state : null;
    }

    async readJsonSafe(response) {
      return readJsonSafe(response);
    }
  }

  Lex.Chat.ConversationsApiClient = ConversationsApiClient;

})(typeof window !== 'undefined' ? window : globalThis);
