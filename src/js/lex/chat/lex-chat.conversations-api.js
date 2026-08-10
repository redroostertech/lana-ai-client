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

  function buildQuery(params) {
    return Object.keys(params)
      .filter(function (key) { return params[key] !== undefined && params[key] !== null && params[key] !== ''; })
      .map(function (key) { return `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`; })
      .join('&');
  }

  function documentSelectionToState(response) {
    const payload = response && response.data ? response.data : response;
    const documents = payload && Array.isArray(payload.documents) ? payload.documents : [];
    return {
      mode: documents.length > 0 ? 'document' : 'general',
      activeDocuments: documents,
      retrieval: payload && payload.retrieval ? payload.retrieval : null
    };
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

    async getDocumentCandidates(conversationId, options = {}) {
      const api = this._requireApi();
      if (typeof api.getConversationDocumentCandidates === 'function') {
        return api.getConversationDocumentCandidates(conversationId, options);
      }

      const query = buildQuery({
        limit: options.limit,
        offset: options.offset,
        search: options.search,
        status: options.status,
        sort_by: options.sortBy || options.sort_by,
        order: options.order
      });
      return api.get(`/api/v1/conversations/${encode(conversationId)}/document-candidates${query ? `?${query}` : ''}`);
    }

    async getDocumentContextConfig(conversationId) {
      const api = this._requireApi();
      if (typeof api.getConversationDocumentContextConfig === 'function') {
        return api.getConversationDocumentContextConfig(conversationId);
      }
      return api.get(`/api/v1/conversations/${encode(conversationId)}/document-context/config`);
    }

    async getDocumentContextMergeFields(conversationId, options = {}) {
      const api = this._requireApi();
      if (typeof api.getConversationDocumentContextMergeFields === 'function') {
        return api.getConversationDocumentContextMergeFields(conversationId, options);
      }

      const query = buildQuery({
        matterId: options.matterId || options.matter_id
      });
      return api.get(`/api/v1/conversations/${encode(conversationId)}/document-context/merge-fields${query ? `?${query}` : ''}`);
    }

    async auditDocumentContext(conversationId, payload = {}) {
      const api = this._requireApi();
      if (typeof api.auditConversationDocumentContext === 'function') {
        return api.auditConversationDocumentContext(conversationId, payload);
      }
      return api.post(`/api/v1/conversations/${encode(conversationId)}/document-context/audit`, payload);
    }

    async streamDocumentContext(conversationId, body, signal) {
      const api = this._requireApi();
      if (typeof api.streamConversationDocumentContext === 'function') {
        return api.streamConversationDocumentContext(conversationId, body, { signal });
      }

      const baseUrl = await this._resolveBaseUrl();
      const response = await fetch(`${baseUrl}/api/v1/conversations/${encode(conversationId)}/document-context/stream`, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify(body),
        signal
      });
      return response;
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
      if (typeof api.getConversationActivity === 'function') {
        return api.getConversationActivity(conversationId);
      }
      if (typeof api.getConversationGeneration === 'function') {
        return api.getConversationGeneration(conversationId);
      }
      return api.get(`/api/v1/conversations/${encode(conversationId)}/activity`);
    }

    async executeSlashCommand(conversationId, command, args) {
      const api = this._requireApi();
      if (typeof api.executeConversationSlashCommand === 'function') {
        return api.executeConversationSlashCommand(conversationId, command, args);
      }
      return api.post(`/api/chat/conversations/${encode(conversationId)}/slash-command`, {
        command,
        args: args || ''
      });
    }

    async stopGeneration(conversationId) {
      const api = this._requireApi();
      if (typeof api.stopConversationActivity === 'function') {
        return api.stopConversationActivity(conversationId);
      }
      if (typeof api.stopConversationGeneration === 'function') {
        return api.stopConversationGeneration(conversationId);
      }
      return api.post(`/api/v1/conversations/${encode(conversationId)}/stop`, {});
    }

    async addDocument(conversationId, docId, filename, matterId) {
      const api = this._requireApi();
      const payload = {
        documentId: docId,
        filename,
        matterId,
        selectionSource: 'prompt_mention'
      };
      const response = await api.post(`/api/v1/conversations/${encode(conversationId)}/documents`, payload);
      return documentSelectionToState(response);
    }

    async removeDocument(conversationId, docId) {
      const api = this._requireApi();
      const response = await api.delete(`/api/v1/conversations/${encode(conversationId)}/documents/${encode(docId)}`);
      return documentSelectionToState(response);
    }

    async clearDocuments(conversationId) {
      const api = this._requireApi();
      const response = await api.delete(`/api/v1/conversations/${encode(conversationId)}/documents`);
      return documentSelectionToState(response);
    }

    async loadState(conversationId) {
      const api = this._requireApi();
      const response = await api.get(`/api/v1/conversations/${encode(conversationId)}/documents`);
      return documentSelectionToState(response);
    }

    async readJsonSafe(response) {
      return readJsonSafe(response);
    }
  }

  Lex.Chat.ConversationsApiClient = ConversationsApiClient;

})(typeof window !== 'undefined' ? window : globalThis);
