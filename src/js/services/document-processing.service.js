/**
 * Document Readiness Service
 *
 * Ensures a document is available for chat context before it enters a
 * conversation. Wraps the check-status → trigger → poll pipeline exposed
 * by api.js.
 *
 * Poll loops are automatically cancelled on page unload via a shared
 * AbortController that is reset each time the page loads.
 *
 * @requires api.js — Base API client must be loaded first.
 */

const DocumentProcessingService = {

  _abortController: null,

  _getSignal() {
    if (!this._abortController) {
      this._abortController = new AbortController();
      window.addEventListener('beforeunload', () => this._abort(), { once: true });
    }
    return this._abortController.signal;
  },

  _abort() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  },

  /**
   * Ensure a single document is ready for chat context.
   * Returns immediately if the document is already vectorized.
   *
   * @param {string} documentId
   * @param {string} triggeredBy  — 'chat_reference' | 'file_drawer' | 'view'
   * @returns {Promise<{ready: boolean, alreadyReady: boolean}>}
   */
  async ensureReady(documentId, triggeredBy = 'chat_reference') {
    const apiClient = this._api();
    if (!apiClient) return { ready: false, alreadyReady: false };

    const signal = this._getSignal();
    const status = await apiClient.getDocumentProcessingStatus(documentId);

    if (status && status.stage === 'completed' && status.hasExtractedText) {
      return { ready: true, alreadyReady: true };
    }

    if (status && status.stage === 'failed') {
      throw new Error('Document processing previously failed');
    }

    if (status && (status.stage === 'processing' || status.stage === 'queued')) {
      await apiClient.pollDocumentProcessing(documentId, 60, 2000, signal);
      return { ready: true, alreadyReady: false };
    }

    await apiClient.triggerDocumentProcessing(documentId, triggeredBy);
    await apiClient.pollDocumentProcessing(documentId, 60, 2000, signal);

    return { ready: true, alreadyReady: false };
  },

  /**
   * Fire-and-forget variant — logs success/failure but never throws.
   * Calls `onReady` when the document is ready, or `onError`.
   * AbortError from navigation is silently swallowed.
   *
   * @param {string}   documentId
   * @param {string}   filename      — Human-readable name (for messages).
   * @param {object}   [callbacks]
   * @param {function} [callbacks.onReady]  — Called with filename when done.
   * @param {function} [callbacks.onError]  — Called with (filename, error).
   */
  ensureReadyBackground(documentId, filename, callbacks = {}) {
    this.ensureReady(documentId, 'chat_reference')
      .then((result) => {
        if (!result.alreadyReady && callbacks.onReady) {
          callbacks.onReady(filename);
        }
      })
      .catch((err) => {
        if (err && err.name === 'AbortError') return;
        console.error(`[DocumentProcessingService] Readiness check failed for "${filename}":`, err);
        if (callbacks.onError) callbacks.onError(filename, err);
      });
  },

  /**
   * Scan a message string for `#filename` mentions, resolve each against a
   * document list, and trigger background JIT processing for any that need it.
   *
   * @param {string}   message       — The outgoing chat message.
   * @param {Array}    documents     — Array of { id, filename|name } objects.
   * @param {object}   [callbacks]   — { onReady(filename), onError(filename, err) }
   * @returns {Array<{id: string, filename: string}>} matched documents
   */
  processMessageMentions(message, documents, callbacks = {}) {
    if (!message || !documents || documents.length === 0) return [];

    const mentions = message.match(/#([a-zA-Z0-9_.\-]+)/g);
    if (!mentions) return [];

    const seen = {};
    const matched = [];

    for (const mention of mentions) {
      const needle = mention.substring(1).toLowerCase();
      if (seen[needle]) continue;
      seen[needle] = true;

      const doc = documents.find((d) => {
        const name = (d.filename || d.name || '').toLowerCase();
        return name === needle || name.startsWith(needle + '.') || name.replace(/\.[^.]+$/, '') === needle;
      });

      if (doc) {
        matched.push({ id: doc.id, filename: doc.filename || doc.name });
        this.ensureReadyBackground(doc.id, doc.filename || doc.name, callbacks);
      }
    }

    return matched;
  },

  _api() {
    const a = window.api || (typeof global !== 'undefined' && global.api);
    if (!a || typeof a.getDocumentProcessingStatus !== 'function') return null;
    return a;
  }
};

if (typeof window !== 'undefined') window.DocumentProcessingService = DocumentProcessingService;
