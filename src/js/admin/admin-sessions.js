/**
 * Admin Active Sessions — standalone page controller.
 *
 * Handles session listing with pagination. Row-click navigates to
 * the session-details page.
 *
 * @requires api.js          - window.api — getSessions
 * @requires lex.utils.js    - Lex.Utils.escapeHtml, Lex.Utils.formatDateTime
 * @requires lex-toast.js    - Lex.Toast.error
 * @requires lex-table.js    - table.setData()
 * @requires lex-nav.js      - Lex.Nav.go
 */

(function () {
  'use strict';

  // =========================================================================
  // Lex aliases
  // =========================================================================

  var escHtml     = Lex.Utils.escapeHtml;
  var fmtDateTime = Lex.Utils.formatDateTime;

  // =========================================================================
  // Module-level state
  // =========================================================================

  /** Generation counter — incremented on every loadSessions() call. */
  var _gen = 0;

  /** Pagination state. */
  var _currentPage = 1;
  var _pageSize    = 20;

  // =========================================================================
  // Entry point
  // =========================================================================

  function init() {
    _wireRefreshButton();
    _wirePagination();
    loadSessions();
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  function el(id) {
    return document.getElementById(id);
  }

  /**
   * Get first character initial from a name or email.
   * @param {string} name
   * @returns {string}
   */
  function getInitial(name) {
    if (!name) return '?';
    return name.charAt(0).toUpperCase();
  }

  /**
   * Format a date string as relative time (e.g., "2m ago", "1h ago").
   * @param {string} dateStr
   * @returns {string}
   */
  function timeAgo(dateStr) {
    if (!dateStr) return '-';
    var diff = Date.now() - new Date(dateStr).getTime();
    if (diff < 0) return 'just now';
    var seconds = Math.floor(diff / 1000);
    var minutes = Math.floor(seconds / 60);
    var hours   = Math.floor(minutes / 60);
    var days    = Math.floor(hours / 24);

    if (days > 0)    return days + 'd ago';
    if (hours > 0)   return hours + 'h ago';
    if (minutes > 0) return minutes + 'm ago';
    return 'just now';
  }

  /**
   * Determine if a session is currently active (activity within last 5 min).
   * @param {Object} session
   * @returns {boolean}
   */
  function isSessionActive(session) {
    if (!session.last_activity) return false;
    return (Date.now() - new Date(session.last_activity).getTime()) < 5 * 60 * 1000;
  }

  /**
   * Build an HTML pill for session status.
   * @param {boolean} active
   * @returns {string}
   */
  function statusPill(active) {
    var color = active
      ? 'var(--lex-status-success-bg,#ECFDF3)'
      : 'var(--lex-status-neutral-bg,#F2F4F7)';
    var label = active ? 'Active' : 'Idle';
    return (
      '<span style="' +
        'display:inline-flex;align-items:center;' +
        'padding:2px 8px;border-radius:9999px;' +
        'font-size:var(--lex-body-xs-size,0.75rem);' +
        'font-weight:500;background:' + color + ';' +
      '">' + escHtml(label) + '</span>'
    );
  }

  // =========================================================================
  // Wire UI
  // =========================================================================

  function _wireRefreshButton() {
    var btn = el('refreshSessionsBtn');
    if (!btn || btn._sessionsWired) return;
    btn._sessionsWired = true;
    btn.addEventListener('click', function () {
      _currentPage = 1;
      loadSessions();
    });
  }

  // =========================================================================
  // Pagination
  // =========================================================================

  function _wirePagination() {
    var pager = el('sessionsPagination');
    if (!pager || pager._sessionsWired) return;
    pager._sessionsWired = true;
    pager.addEventListener('page-change', function (e) {
      var page = e.detail && e.detail.page;
      if (page && page !== _currentPage) {
        _currentPage = page;
        loadSessions();
      }
    });
  }

  function _updatePagination(total) {
    var pager = el('sessionsPagination');
    if (!pager) return;
    var totalPages = Math.max(1, Math.ceil(total / _pageSize));
    pager.page       = _currentPage;
    pager.totalPages = totalPages;
    pager.total      = total;
    pager.limit      = _pageSize;
  }

  // =========================================================================
  // Load Sessions
  // =========================================================================

  function loadSessions() {
    var gen = ++_gen;
    var table = el('sessionsTable');
    if (!table) return;

    Lex.Redact.on(table);

    api.getSessions(_currentPage, _pageSize)
      .then(function (result) {
        if (gen !== _gen) return;

        var sessions = [];
        var total = 0;
        if (Array.isArray(result)) {
          sessions = result;
          total = result.length;
        } else if (result && Array.isArray(result.sessions)) {
          sessions = result.sessions;
          total = result.total || result.count || sessions.length;
        } else if (result && Array.isArray(result.data)) {
          sessions = result.data;
          total = result.total || result.count || sessions.length;
        }

        var rows = sessions.map(function (s) {
          var active = isSessionActive(s);
          var userName = String(s.user_name || s.user_email || '');
          var userEmail = String(s.user_email || '');

          return {
            _id:           String(s.session_id || s.id || ''),
            user_display:  userName || userEmail,
            _userName:     userName,
            _userEmail:    userEmail,
            device:        String(s.browser || 'Unknown') + ' / ' + String(s.os || s.device || 'Unknown'),
            ip_location:   String(s.ip_address || '-') + (s.location ? ' (' + s.location + ')' : ''),
            started:       s.created_at || '',
            last_activity: s.last_activity || '',
            status:        active ? 'Active' : 'Idle',
            _active:       active,
            _raw:          s
          };
        });

        Lex.Redact.off(table);
        _ensureTableObserver(table);
        table.setData(rows);
        _updatePagination(total);
      })
      .catch(function (err) {
        if (gen !== _gen) return;
        Lex.Redact.off(table);
        console.error('[admin-sessions] loadSessions error:', err);
        Lex.Toast.error('Failed to load sessions');
      });
  }

  // =========================================================================
  // Table Renderers (MutationObserver pattern)
  // =========================================================================

  function _ensureTableObserver(table) {
    if (table._sessionsRendererAttached) return;
    table._sessionsRendererAttached = true;

    table.addEventListener('row-click', function (e) {
      var row = e.detail && e.detail.row;
      if (row) {
        Lex.Nav.go('admin/session-details.html', {
          params: { sessionId: row._id },
          context: { session: row._raw }
        });
      }
    });

    new MutationObserver(function () {
      requestAnimationFrame(function () { _applyTableRenderers(table); });
    }).observe(table, { childList: true });
  }

  function _applyTableRenderers(table) {
    var rows = (table.dataSource && table.dataSource.data) || [];

    var tbody = table.querySelector('tbody');
    if (!tbody) return;

    var trs = tbody.querySelectorAll('tr');
    for (var i = 0; i < trs.length; i++) {
      var tr  = trs[i];
      var row = rows[i];
      if (!row) continue;

      var tds = tr.querySelectorAll('td');
      if (tds.length === 0) continue;

      // Column order: user_display(0), device(1), ip_location(2), started(3), last_activity(4), status(5)

      // User display cell (index 0): avatar + name + email
      var nameVal  = row._userName || row.user_display || '';
      var emailVal = row._userEmail || '';
      var initial  = getInitial(nameVal || emailVal);
      if (tds[0]) {
        tds[0].innerHTML =
          '<div style="display:flex;align-items:center;gap:0.625rem;">' +
            '<div style="' +
              'flex-shrink:0;width:2rem;height:2rem;border-radius:9999px;' +
              'background:var(--lex-bg-accent,#8B7355);' +
              'color:var(--lex-text-on-accent,#fff);' +
              'display:flex;align-items:center;justify-content:center;' +
              'font-size:0.6875rem;font-weight:600;' +
            '">' +
              escHtml(initial) +
            '</div>' +
            '<div style="min-width:0;">' +
              '<div style="font-weight:500;color:var(--lex-text-primary);' +
                'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
                escHtml(nameVal || emailVal) +
              '</div>' +
              (emailVal && emailVal !== nameVal ?
                '<div style="font-size:var(--lex-body-xs-size,0.75rem);' +
                  'color:var(--lex-text-tertiary);' +
                  'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
                  escHtml(emailVal) +
                '</div>' : '') +
            '</div>' +
          '</div>';
      }

      // Started cell (index 3): formatted datetime
      if (tds[3] && row.started) {
        tds[3].innerHTML =
          '<span style="font-size:var(--lex-body-sm-size,0.875rem);color:var(--lex-text-secondary);">' +
            escHtml(fmtDateTime(row.started)) +
          '</span>';
      }

      // Last activity cell (index 4): relative time
      if (tds[4]) {
        tds[4].innerHTML =
          '<span style="font-size:var(--lex-body-sm-size,0.875rem);color:var(--lex-text-secondary);">' +
            escHtml(row.last_activity ? timeAgo(row.last_activity) : '-') +
          '</span>';
      }

      // Status cell (index 5): coloured pill
      if (tds[5]) {
        tds[5].innerHTML = statusPill(row._active);
      }
    }
  }

  // =========================================================================
  // Bootstrap
  // =========================================================================

  init();

})();
