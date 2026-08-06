/* ==========================================================================
   Lex UI — Activity Context Collector
   Captures client-side user activity for intent-enriched chat interactions.
   Tracks current page, matter, and recent actions. Attaches context to
   chat messages so the backend's intent classifier has richer signals.

   Provides:
     - LexActivityContext.capture()          — snapshot of current activity
     - LexActivityContext.track(type, detail) — record a user action
     - LexActivityContext.getRecent(n)        — last N tracked actions
     - LexActivityContext.setMatterId(id)     — set current matter context
     - LexActivityContext.setPage(page)       — set current page/view

   Storage: sessionStorage (survives page navigation, cleared on tab close)
   ========================================================================== */

(function (global) {
  'use strict';

  const Lex = global.Lex;
  if (!Lex) { console.error('[Lex ActivityContext] Lex core not loaded'); return; }

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  const STORAGE_KEY = 'lex_activity_context';
  const MAX_TRACKED_ACTIONS = 50;

  // ---------------------------------------------------------------------------
  // LexActivityContext
  // ---------------------------------------------------------------------------

  const LexActivityContext = {

    _matterId: null,
    _page: null,

    /**
     * Set the current matter ID context.
     * Call this when the user navigates to a matter or loads a matter page.
     * @param {string|null} matterId
     */
    setMatterId(matterId) {
      this._matterId = matterId || null;
    },

    /**
     * Set the current page/view name.
     * @param {string|null} page — e.g. 'dashboard', 'matter-detail', 'chat', 'documents'
     */
    setPage(page) {
      this._page = page || null;
    },

    /**
     * Track a user action. Stored in sessionStorage for the current tab's lifetime.
     * @param {string} eventType — e.g. 'document_view', 'matter_open', 'search', 'block_interact'
     * @param {Object} [detail] — additional metadata
     */
    track(eventType, detail) {
      if (!eventType) return;

      const actions = this._loadActions();
      actions.push({
        type: eventType,
        detail: detail || null,
        timestamp: LanaTime.nowIso(),
        page: this._page,
        matterId: this._matterId
      });

      // Keep only the most recent actions
      if (actions.length > MAX_TRACKED_ACTIONS) {
        actions.splice(0, actions.length - MAX_TRACKED_ACTIONS);
      }

      this._saveActions(actions);
    },

    /**
     * Get the last N tracked actions.
     * @param {number} [count=10]
     * @returns {Array}
     */
    getRecent(count) {
      const n = count || 10;
      const actions = this._loadActions();
      return actions.slice(-n);
    },

    /**
     * Capture a full activity context snapshot for sending with a chat message.
     * @returns {Object} Context object to attach to ChatSource.send() options
     */
    capture() {
      const recentActions = this.getRecent(5);

      return {
        currentPage: this._page || this._detectPage(),
        matterId: this._matterId || this._detectMatterId(),
        recentActions: recentActions.map(a => ({
          type: a.type,
          detail: a.detail,
          timestamp: a.timestamp
        })),
        timestamp: LanaTime.nowIso(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      };
    },

    /**
     * Clear all tracked actions (e.g., on logout or session reset).
     */
    clear() {
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch (_) { /* ignore */ }
    },

    // ── Internal helpers ────────────────────────────────────────────────

    _loadActions() {
      try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
      } catch (_) {
        return [];
      }
    },

    _saveActions(actions) {
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(actions));
      } catch (_) { /* storage full — silently discard */ }
    },

    /**
     * Auto-detect current page from URL path or body data attributes.
     */
    _detectPage() {
      const path = global.location?.pathname || '';
      const filename = path.split('/').pop().replace('.html', '') || 'unknown';
      return filename;
    },

    /**
     * Auto-detect current matter ID from URL params or page state.
     */
    _detectMatterId() {
      try {
        const params = new URLSearchParams(global.location?.search || '');
        return params.get('matter_id') || params.get('matterId') || null;
      } catch (_) {
        return null;
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  Lex.ActivityContext = LexActivityContext;

})(typeof window !== 'undefined' ? window : globalThis);
