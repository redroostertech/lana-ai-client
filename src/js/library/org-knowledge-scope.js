/*
 * library/org-knowledge-scope.js
 *
 * Renderer-only "Shared Knowledge" scope controller for the Library (drive)
 * surface. It mirrors library/brainchild-scope.js but lists the organization's
 * PROMOTED knowledge notes (notes a user promoted from their personal Brainchild
 * vault into the shared org knowledge base) instead of the personal vault.
 *
 * This is pure presentation plus light wiring: it only talks to the LANA-AI
 * backend through the injected api client. NO direct DOM access and NO
 * node/electron calls live here; all rendering happens in drive.js.
 *
 * Backend contract consumed (already deployed, read-only):
 *   LIST   GET    /api/v1/organizations/{orgId}/promoted-knowledge
 *                   ?limit={n}&offset={n}&search={q}
 *            -> { items: [ { id, title, preview, content, vault,
 *                            original_note_id, created_by, created_by_name,
 *                            created_at, source } ], total, hasMore }
 *   DELETE DELETE /api/v1/organizations/{orgId}/promoted-knowledge/{id}
 *            -> { success: true, ... }  (may 403 when the user lacks
 *               knowledge:promote)
 *
 * Org isolation: the backend re-derives the org from the JWT and enforces
 * permissions. The orgId resolved here is only used to shape the URL and must
 * equal the signed-in user's org; it is never treated as authorization.
 *
 * Project constraint: no emojis, no em dashes, no en dashes anywhere here.
 */
(function (global) {
  'use strict';

  // Resolve the org id from a user object the same way the promote flow does.
  function orgIdFromUser(user) {
    if (!user) return null;
    return user.organizationId || user.organization_id || user.org_id || null;
  }

  /*
   * create(options)
   *
   * options:
   *   api             LanaAPI client with get(path) and delete(path)
   *   currentUser()   returns the authenticated user (defaults to api.user /
   *                   localStorage)
   *   onStatus(text)  optional progress callback (status line copy)
   *   onToast(kind,m) optional toast callback ('success' | 'error')
   *   onChange()      optional callback fired after items change so the host can
   *                   re-render
   */
  function create(options) {
    var opts = options || {};
    var api = opts.api || global.api || null;
    var onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
    var onToast = typeof opts.onToast === 'function' ? opts.onToast : function () {};
    var onChange = typeof opts.onChange === 'function' ? opts.onChange : function () {};

    var getCurrentUser = typeof opts.currentUser === 'function'
      ? opts.currentUser
      : function () {
          if (api && api.user) return api.user;
          if (global.api && global.api.user) return global.api.user;
          try {
            return JSON.parse((global.localStorage && global.localStorage.getItem('user')) || 'null');
          } catch (_error) {
            return null;
          }
        };

    var state = {
      items: [],
      allItems: [],
      total: 0,
      loading: false,
      search: '',
      orgId: null,
      error: null
    };

    function notify() { onChange(); }

    // Resolve and cache the signed-in user's org id. When the cached user object
    // has no org, refresh the profile (loadUserProfile populates organizationId)
    // and re-read. Returns the org id or null when it still cannot be resolved.
    async function resolveOrgId() {
      if (state.orgId) return state.orgId;

      var orgId = orgIdFromUser(getCurrentUser());
      if (!orgId && api && typeof api.loadUserProfile === 'function') {
        try {
          await api.loadUserProfile();
        } catch (_error) { /* best effort; handled by the null return below */ }
        orgId = orgIdFromUser(getCurrentUser());
      }

      state.orgId = orgId || null;
      return state.orgId;
    }

    // Build the list endpoint for the resolved org. The list is always fetched in
    // full (capped at 100) so search can be applied client-side in runSearch().
    function listPath(orgId) {
      var params = new global.URLSearchParams({ limit: '100', offset: '0' });
      return '/api/v1/organizations/' + encodeURIComponent(orgId) +
        '/promoted-knowledge?' + params.toString();
    }

    // Load the full shared-knowledge list. Resolves the org, GETs the list, and
    // stores it in BOTH state.allItems (the unfiltered source for client-side
    // search) and state.items (what the host renders, and what the drive.js
    // promoted-ids reader walks for original_note_id). Sets state.error on
    // failure (including a missing org) so the host can render an empty/error
    // state.
    async function load() {
      if (state.loading) return state.items;
      if (!api || typeof api.get !== 'function') {
        state.error = 'unavailable';
        state.allItems = [];
        state.items = [];
        state.total = 0;
        notify();
        return state.items;
      }

      state.loading = true;
      try {
        var orgId = await resolveOrgId();
        if (!orgId) {
          state.error = 'no_org';
          state.allItems = [];
          state.items = [];
          state.total = 0;
          notify();
          return state.items;
        }

        var response = await api.get(listPath(orgId));
        var items = Array.isArray(response && response.items) ? response.items : [];
        state.allItems = items;
        state.items = items.slice();
        state.total = (response && typeof response.total === 'number')
          ? response.total
          : items.length;
        state.error = null;
      } catch (error) {
        state.error = (error && error.message) ? error.message : 'load_failed';
        state.allItems = [];
        state.items = [];
        state.total = 0;
      } finally {
        state.loading = false;
      }
      notify();
      return state.items;
    }

    // Filter the already-loaded list client-side. Does NOT hit the network: it
    // matches the trimmed query against each item's title or preview
    // (case-insensitive substring). An empty query restores the full list.
    async function runSearch(query) {
      var trimmed = (query || '').trim();
      state.search = trimmed;
      if (!trimmed) {
        state.items = state.allItems.slice();
      } else {
        var needle = trimmed.toLowerCase();
        state.items = state.allItems.filter(function (item) {
          var title = (item && item.title ? String(item.title) : '').toLowerCase();
          var preview = (item && item.preview ? String(item.preview) : '').toLowerCase();
          return title.indexOf(needle) !== -1 || preview.indexOf(needle) !== -1;
        });
      }
      notify();
      return state.items;
    }

    // Remove a promoted note. On success drop it from BOTH state.allItems and
    // state.items so the full and filtered lists stay in sync, then toast; a
    // 403 means the user lacks knowledge:promote, handled with a clear toast and
    // no crash. onChange() fires after either outcome so the host re-renders.
    async function remove(id) {
      if (!id) return { success: false };
      if (!api || typeof api.delete !== 'function') {
        onToast('error', 'Remove is unavailable.');
        return { success: false };
      }

      var orgId = await resolveOrgId();
      if (!orgId) {
        onToast('error', 'Sign in to lana-ai to manage shared knowledge.');
        return { success: false };
      }

      onStatus('Removing note from shared knowledge.');
      try {
        await api.delete(
          '/api/v1/organizations/' + encodeURIComponent(orgId) +
          '/promoted-knowledge/' + encodeURIComponent(id)
        );
        state.allItems = state.allItems.filter(function (item) {
          return item && item.id !== id;
        });
        state.items = state.items.filter(function (item) {
          return item && item.id !== id;
        });
        state.total = state.total > 0 ? state.total - 1 : 0;
        onToast('success', 'Removed from shared knowledge.');
        onStatus('');
        notify();
        return { success: true };
      } catch (error) {
        var status = error && typeof error.status === 'number' ? error.status : 0;
        if (status === 403) {
          onToast('error', 'You do not have permission to remove shared knowledge.');
        } else {
          onToast('error', (error && error.message) ? error.message : 'Failed to remove note.');
        }
        onStatus('');
        notify();
        return { success: false, error: error };
      }
    }

    return {
      state: state,
      resolveOrgId: resolveOrgId,
      load: load,
      runSearch: runSearch,
      remove: remove
    };
  }

  var moduleApi = {
    create: create,
    orgIdFromUser: orgIdFromUser
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  global.LibraryOrgKnowledgeScope = moduleApi;
})(typeof window !== 'undefined' ? window : this);
