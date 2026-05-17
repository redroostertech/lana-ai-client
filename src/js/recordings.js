// recordings.js - List page for meeting recordings captured by PAC.
//
// View-only: this page browses recordings owned by the current organization
// and links into a per-recording detail page. No capture/upload UI.

(function () {
  'use strict';

  var PAGE_SIZE = 50;

  var STATUS_BADGE_COLOR = {
    ready: 'success',
    transcribing: 'warning',
    uploading: 'warning',
    pending: 'neutral',
    failed: 'danger',
    archived: 'neutral'
  };

  var STATUS_LABEL = {
    ready: 'Ready',
    transcribing: 'Transcribing',
    uploading: 'Uploading',
    pending: 'Pending',
    failed: 'Failed',
    archived: 'Archived'
  };

  var SCOPE_LABEL = {
    private: 'Private',
    organization: 'Organization',
    matter: 'Matter'
  };

  // Cache of matter UUID → { matter_id, name } so we can render friendly
  // labels once we discover a row references a matter we have not seen yet.
  var matterCache = {};
  var matterFetchPromise = null;

  var state = {
    statusFilter: 'all',
    scopeFilter: '',
    offset: 0,
    limit: PAGE_SIZE,
    total: 0,
    recordings: [],
    loading: false
  };

  var els = {};

  function init() {
    els = {
      list: document.getElementById('recordingsList'),
      state: document.getElementById('recordingsState'),
      count: document.getElementById('recordingsCount'),
      statusFilter: document.getElementById('recordingsStatusFilter'),
      scopeFilter: document.getElementById('recordingsScopeFilter'),
      refresh: document.getElementById('recordingsRefresh'),
      prev: document.getElementById('recordingsPrev'),
      next: document.getElementById('recordingsNext')
    };

    if (els.statusFilter) els.statusFilter.value = state.statusFilter;
    if (els.scopeFilter) els.scopeFilter.value = state.scopeFilter;

    bindEvents();
    primeMatterCache();
    loadRecordings();
  }

  function bindEvents() {
    if (els.statusFilter) {
      els.statusFilter.addEventListener('lex-change', function (e) {
        // Status filtering moved to the server in Task #18 — the API supports
        // ?status=ready and comma-separated lists. We re-fetch instead of
        // filtering client-side so pagination totals stay accurate.
        state.statusFilter = (e.detail && e.detail.value) || 'all';
        state.offset = 0;
        loadRecordings();
      });
    }
    if (els.scopeFilter) {
      els.scopeFilter.addEventListener('lex-change', function (e) {
        state.scopeFilter = (e.detail && e.detail.value) || '';
        state.offset = 0;
        loadRecordings();
      });
    }
    if (els.refresh) {
      els.refresh.addEventListener('click', function () {
        els.refresh.loading = true;
        loadRecordings().finally(function () {
          setTimeout(function () { els.refresh.loading = false; }, 200);
        });
      });
    }
    if (els.prev) {
      els.prev.addEventListener('click', function () {
        if (state.offset <= 0) return;
        state.offset = Math.max(0, state.offset - state.limit);
        loadRecordings();
      });
    }
    if (els.next) {
      els.next.addEventListener('click', function () {
        if (state.offset + state.limit >= state.total) return;
        state.offset += state.limit;
        loadRecordings();
      });
    }
  }

  function primeMatterCache() {
    if (matterFetchPromise) return matterFetchPromise;
    if (!window.api || typeof api.getMatters !== 'function' || !api.isAuthenticated()) {
      return Promise.resolve();
    }
    // One-shot fetch: pull a generous page so per-row matter lookups stay
    // client-side. Matter names rarely change during a session.
    matterFetchPromise = api.getMatters(1, 200, {})
      .then(function (result) {
        var matters = (result && (result.matters || result.data || [])) || [];
        matters.forEach(function (m) {
          if (m && m.id) {
            matterCache[m.id] = {
              matter_id: m.matter_id || '',
              name: m.matter_name || m.name || m.title || ''
            };
          }
        });
      })
      .catch(function (err) {
        console.warn('[Recordings] Failed to prime matter cache', err && err.message ? err.message : err);
      });
    return matterFetchPromise;
  }

  function loadRecordings() {
    if (state.loading) return Promise.resolve();
    if (!window.api || !api.isAuthenticated()) return Promise.resolve();

    state.loading = true;
    renderLoading();

    var path = '/api/v1/recordings?limit=' + state.limit + '&offset=' + state.offset;
    // Server-side status filter (Task #18). 'all' is the sentinel for "no
    // filter" and is omitted so the server returns every status.
    if (state.statusFilter && state.statusFilter !== 'all') {
      path += '&status=' + encodeURIComponent(state.statusFilter);
    }

    return api.get(path)
      .then(function (result) {
        var rows = (result && result.data) || [];
        var pagination = (result && result.pagination) || {};
        state.recordings = rows;
        state.total = typeof pagination.total === 'number' ? pagination.total : rows.length;
        // Ensure any matter UUIDs referenced get a friendly lookup;
        // primeMatterCache is in-flight or done, but we may have new matters.
        return ensureMatterNamesFor(rows);
      })
      .then(function () {
        render();
      })
      .catch(function (err) {
        console.error('[Recordings] Failed to load recordings:', err && err.message ? err.message : err);
        renderError();
      })
      .finally(function () {
        state.loading = false;
      });
  }

  function ensureMatterNamesFor(rows) {
    var missing = [];
    rows.forEach(function (row) {
      if (row && row.visibility === 'matter' && row.matter_id && !matterCache[row.matter_id]) {
        missing.push(row.matter_id);
      }
    });
    if (missing.length === 0) return Promise.resolve();
    if (typeof api.getMatter !== 'function') return Promise.resolve();

    // Per-row resolver as a fallback for matters not present in the priming
    // page. We swallow individual failures so one bad row doesn't sink render.
    var unique = {};
    missing.forEach(function (id) { unique[id] = true; });
    var lookups = Object.keys(unique).map(function (id) {
      return api.getMatter(id, {})
        .then(function (res) {
          var m = res && (res.matter || res.data || res);
          if (m && m.id) {
            matterCache[m.id] = {
              matter_id: m.matter_id || '',
              name: m.matter_name || m.name || m.title || ''
            };
          }
        })
        .catch(function () { /* silent */ });
    });
    return Promise.all(lookups);
  }

  function applyClientFilters(rows) {
    // Status filtering is server-side now (Task #18); we keep the scope
    // filter local because the server endpoint does not yet expose a scope
    // query param — if/when it does, this can shrink to a passthrough.
    return rows.filter(function (row) {
      if (state.scopeFilter && row.visibility !== state.scopeFilter) return false;
      return true;
    });
  }

  function renderLoading() {
    if (els.state) {
      els.state.hidden = false;
      els.state.innerHTML = '<lex-spinner size="md" label="Loading recordings"></lex-spinner>';
    }
    if (els.list) els.list.innerHTML = '';
    if (els.count) els.count.textContent = 'Loading recordings...';
    if (els.prev) els.prev.hidden = true;
    if (els.next) els.next.hidden = true;
  }

  function renderError() {
    if (!els.state) return;
    els.state.hidden = false;
    els.state.innerHTML = [
      '<lex-empty icon="alert-circle" message="Failed to load recordings" description="Refresh to try again."></lex-empty>'
    ].join('');
    if (els.count) els.count.textContent = '';
    if (els.list) els.list.innerHTML = '';
    if (els.prev) els.prev.hidden = true;
    if (els.next) els.next.hidden = true;
  }

  function render() {
    if (!els.list || !els.state || !els.count) return;

    var visible = applyClientFilters(state.recordings);

    if (state.recordings.length === 0) {
      els.list.innerHTML = '';
      els.state.hidden = false;
      els.state.innerHTML = '<lex-empty icon="inbox" message="No recordings yet" description="Capture a meeting in PAC to see it here."></lex-empty>';
      els.count.textContent = '';
      if (els.prev) els.prev.hidden = true;
      if (els.next) els.next.hidden = true;
      return;
    }

    if (visible.length === 0) {
      els.list.innerHTML = '';
      els.state.hidden = false;
      els.state.innerHTML = '<lex-empty icon="filter" message="No recordings match these filters" description="Adjust the status or scope filter above."></lex-empty>';
    } else {
      els.state.hidden = true;
      els.list.innerHTML = visible.map(renderRow).join('');
      attachRowHandlers();
    }

    var rangeStart = state.total === 0 ? 0 : state.offset + 1;
    var rangeEnd = Math.min(state.offset + state.recordings.length, state.total);
    els.count.textContent = 'Showing ' + rangeStart + '–' + rangeEnd + ' of ' + state.total;

    if (els.prev) {
      els.prev.hidden = state.total <= state.limit;
      els.prev.disabled = state.offset <= 0;
    }
    if (els.next) {
      els.next.hidden = state.total <= state.limit;
      els.next.disabled = state.offset + state.limit >= state.total;
    }
  }

  function renderRow(row) {
    var status = row.status || 'pending';
    var badgeColor = STATUS_BADGE_COLOR[status] || 'neutral';
    var statusLabel = STATUS_LABEL[status] || status;

    var title = recordingTitle(row);
    var scopeChip = renderScopeChip(row);
    var duration = formatDuration(row.duration_ms);
    var when = formatWhen(row.created_at);
    var whenAbsolute = formatAbsolute(row.created_at);
    // Real owner name comes from the backend's LEFT JOIN on `users` (Task #18).
    // Falls back to email or a short user-id label when the owner is missing.
    var owner = ownerLabel(row);
    var secondary = owner ? (when + ' · ' + owner) : when;

    return [
      '<button type="button" class="recordings-item" data-recording-id="' + escapeHtml(row.id) + '">',
      '  <div class="recordings-item__primary">',
      '    <span class="recordings-item__title">' + escapeHtml(title) + '</span>',
      '    <span class="recordings-item__meta">',
      '      <lex-badge label="' + escapeHtml(statusLabel) + '" color="' + escapeHtml(badgeColor) + '" size="sm" dot></lex-badge>',
      scopeChip,
      duration ? '      <span class="recordings-item__chip recordings-item__chip--neutral">' + escapeHtml(duration) + '</span>' : '',
      '    </span>',
      '  </div>',
      '  <div class="recordings-item__secondary" title="' + escapeHtml(whenAbsolute) + '">' + escapeHtml(secondary) + '</div>',
      '</button>'
    ].join('');
  }

  function ownerLabel(row) {
    if (!row) return '';
    if (row.owner_name) return String(row.owner_name);
    if (row.owner_email) return String(row.owner_email);
    if (row.owner_id) {
      var id = String(row.owner_id);
      return 'User ' + id.substring(0, 8);
    }
    return '';
  }

  function renderScopeChip(row) {
    var visibility = row.visibility || 'private';
    var label = SCOPE_LABEL[visibility] || visibility;
    var modifier = visibility === 'matter' ? 'matter' : (visibility === 'organization' ? 'org' : 'private');

    if (visibility === 'matter' && row.matter_id) {
      var resolved = matterCache[row.matter_id];
      if (resolved) {
        var pieces = [];
        if (resolved.name) pieces.push(resolved.name);
        if (resolved.matter_id) pieces.push('(' + resolved.matter_id + ')');
        if (pieces.length > 0) {
          label = pieces.join(' ');
        }
      }
    }

    return '<span class="recordings-item__chip recordings-item__chip--' + escapeHtml(modifier) + '">'
      + escapeHtml(label) + '</span>';
  }

  function attachRowHandlers() {
    if (!els.list) return;
    var buttons = els.list.querySelectorAll('[data-recording-id]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function () {
        var id = this.getAttribute('data-recording-id');
        if (!id) return;
        var href = 'recording-detail.html?id=' + encodeURIComponent(id);
        if (window.Lex && window.Lex.Nav && typeof window.Lex.Nav.go === 'function') {
          window.Lex.Nav.go(href);
        } else {
          window.location.href = href;
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function recordingTitle(row) {
    var meta = (row && row.metadata) || {};
    if (meta && typeof meta === 'object' && meta.title) {
      return String(meta.title);
    }
    var id = row && row.id ? String(row.id) : '';
    var short = id ? id.substring(0, 8) : '';
    return short ? 'Recording ' + short : 'Recording';
  }

  function formatDuration(ms) {
    var n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return '';
    var totalSeconds = Math.round(n / 1000);
    var hours = Math.floor(totalSeconds / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;
    var pad = function (v) { return v < 10 ? '0' + v : '' + v; };
    if (hours > 0) {
      return hours + ':' + pad(minutes) + ':' + pad(seconds);
    }
    return pad(minutes) + ':' + pad(seconds);
  }

  function formatWhen(dateString) {
    if (!dateString) return '';
    var date = new Date(dateString);
    var now = new Date();
    var diffMs = now.getTime() - date.getTime();
    if (!Number.isFinite(diffMs) || diffMs < 0) {
      return formatAbsolute(dateString);
    }
    var minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return minutes + 'm ago';
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    var days = Math.floor(hours / 24);
    if (days === 1) return 'Yesterday';
    if (days < 7) return days + 'd ago';
    return formatAbsolute(dateString);
  }

  function formatAbsolute(dateString) {
    if (!dateString) return '';
    if (window.Lex && window.Lex.Utils && typeof window.Lex.Utils.formatDateTime === 'function') {
      return window.Lex.Utils.formatDateTime(dateString) || '';
    }
    var date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleString();
  }

  function escapeHtml(value) {
    var div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
