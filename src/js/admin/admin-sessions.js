/**
 * Admin Active Sessions — standalone page controller.
 *
 * Handles session listing, stats, detail drawer, and session termination
 * for the admin/sessions.html page.
 *
 * @requires api.js          - window.api — getSessions, terminateSession
 * @requires lex.utils.js    - Lex.Utils.escapeHtml, Lex.Utils.formatDateTime
 * @requires lex-modal.js    - Lex.Modal.confirm
 * @requires lex-toast.js    - Lex.Toast.success, Lex.Toast.error
 * @requires lex-table.js    - table.setData()
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

  /** All sessions from the last fetch (for drawer lookups). */
  var _sessions = [];

  /** Auto-refresh interval ID. */
  var _refreshInterval = null;

  /** Session currently displayed in the drawer. */
  var _drawerSessionId = null;

  // =========================================================================
  // Entry point
  // =========================================================================

  function init() {
    _wireRefreshButton();
    _wireDrawer();
    loadSessions();

    // Auto-refresh every 30 seconds
    _refreshInterval = setInterval(loadSessions, 30000);
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  function el(id) {
    return document.getElementById(id);
  }

  function show(target) {
    var elem = typeof target === 'string' ? el(target) : target;
    if (elem) elem.classList.remove('hidden');
  }

  function hide(target) {
    var elem = typeof target === 'string' ? el(target) : target;
    if (elem) elem.classList.add('hidden');
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
   * Format a duration in milliseconds to a human-readable string.
   * Uses string methods — no regex.
   * @param {number} ms
   * @returns {string}
   */
  function formatDuration(ms) {
    if (!ms || ms < 0) return '-';
    var seconds = Math.floor(ms / 1000);
    var minutes = Math.floor(seconds / 60);
    var hours   = Math.floor(minutes / 60);
    var days    = Math.floor(hours / 24);

    if (days > 0) return days + 'd ' + (hours % 24) + 'h';
    if (hours > 0) return hours + 'h ' + (minutes % 60) + 'm';
    if (minutes > 0) return minutes + 'm';
    return seconds + 's';
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
      loadSessions();
    });
  }

  function _wireDrawer() {
    var drawer = el('sessionDrawer');
    if (!drawer || drawer._sessionsCloseWired) return;
    drawer._sessionsCloseWired = true;

    drawer.addEventListener('lex-close', function () {
      _drawerSessionId = null;
    });

    // Terminate button
    var termBtn = el('drawerTerminateBtn');
    if (termBtn && !termBtn._sessionsWired) {
      termBtn._sessionsWired = true;
      termBtn.addEventListener('click', function () {
        if (_drawerSessionId) {
          _terminateSession(_drawerSessionId);
        }
      });
    }
  }

  // =========================================================================
  // Load Sessions
  // =========================================================================

  function loadSessions() {
    var gen = ++_gen;
    var table = el('sessionsTable');
    if (!table) return;

    Lex.Redact.on(table);

    api.getSessions(1, 100)
      .then(function (result) {
        if (gen !== _gen) return;

        var sessions = [];
        if (Array.isArray(result)) {
          sessions = result;
        } else if (result && Array.isArray(result.sessions)) {
          sessions = result.sessions;
        } else if (result && Array.isArray(result.data)) {
          sessions = result.data;
        }

        _sessions = sessions;

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
        _updateStats(sessions);
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
      if (row) openDrawer(row._id, row._raw);
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

      // Actions cell — append if not already there
      var sessionId = escHtml(row._id || '');
      var actionsCell = tr.querySelector('td.sessions-actions-cell');
      if (!actionsCell) {
        actionsCell = document.createElement('td');
        actionsCell.className = 'sessions-actions-cell';
        actionsCell.style.cssText = 'white-space:nowrap;text-align:right;padding-right:0.5rem;';
        tr.appendChild(actionsCell);
      }
      actionsCell.innerHTML =
        '<lex-dropdown-btn ' +
          'data-session-id="' + sessionId + '" ' +
          'label="Actions" ' +
          'size="sm" ' +
          'variant="secondary" ' +
          'items=\'[' +
            '{"value":"view","label":"View Details"},' +
            '{"value":"terminate","label":"Terminate","variant":"danger"}' +
          ']\'' +
        '></lex-dropdown-btn>';

      // Wire the dropdown
      (function (rowRef) {
        var ddBtn = tr.querySelector('lex-dropdown-btn');
        if (ddBtn && !ddBtn._sessionsWired) {
          ddBtn._sessionsWired = true;
          ddBtn.addEventListener('item-click', function (e) {
            var action = e.detail && e.detail.value;
            var sid = ddBtn.getAttribute('data-session-id');
            if (action === 'view')      openDrawer(sid, rowRef._raw);
            if (action === 'terminate') _terminateSession(sid);
          });
        }
      })(row);
    }
  }

  // =========================================================================
  // Stats
  // =========================================================================

  function _updateStats(sessions) {
    var metricActive = el('metricActiveSessions');
    var metricUsers  = el('metricUniqueUsers');
    var metricLocs   = el('metricLocations');
    var metricAge    = el('metricAvgAge');

    if (metricActive) metricActive.value = String(sessions.length);

    // Unique users
    var userSet = {};
    for (var i = 0; i < sessions.length; i++) {
      var uid = sessions[i].user_id || sessions[i].user_email || '';
      if (uid) userSet[uid] = true;
    }
    var uniqueUserCount = Object.keys(userSet).length;
    if (metricUsers) metricUsers.value = String(uniqueUserCount);

    // Unique locations
    var locSet = {};
    for (var j = 0; j < sessions.length; j++) {
      var loc = sessions[j].location || sessions[j].ip_address || '';
      if (loc) locSet[loc] = true;
    }
    var uniqueLocCount = Object.keys(locSet).length;
    if (metricLocs) metricLocs.value = String(uniqueLocCount);

    // Average session age
    if (sessions.length > 0) {
      var now = Date.now();
      var totalAge = 0;
      for (var k = 0; k < sessions.length; k++) {
        totalAge += (now - new Date(sessions[k].created_at).getTime());
      }
      var avgMs = totalAge / sessions.length;
      if (metricAge) metricAge.value = formatDuration(avgMs);
    } else {
      if (metricAge) metricAge.value = '-';
    }
  }

  // =========================================================================
  // Session Details Drawer
  // =========================================================================

  function openDrawer(sessionId, rawSession) {
    var drawer = el('sessionDrawer');
    if (!drawer) return;

    _drawerSessionId = sessionId;

    // If we don't have the raw session, find it
    if (!rawSession) {
      for (var i = 0; i < _sessions.length; i++) {
        var s = _sessions[i];
        if ((s.session_id || s.id) === sessionId) {
          rawSession = s;
          break;
        }
      }
    }

    if (!rawSession) {
      Lex.Toast.error('Session not found');
      return;
    }

    _renderDrawerBody(rawSession);
    drawer.open = true;
  }

  function _renderDrawerBody(session) {
    var active = isSessionActive(session);
    var userName  = String(session.user_name || session.user_email || '');
    var userEmail = String(session.user_email || '');

    // Avatar
    var avatarEl = el('sessionDrawerAvatar');
    if (avatarEl) avatarEl.textContent = getInitial(userName || userEmail);

    // Name + email header
    var nameEl  = el('sessionDrawerName');
    var emailEl = el('sessionDrawerEmail');
    if (nameEl)  nameEl.textContent  = userName || userEmail;
    if (emailEl) emailEl.textContent = userEmail && userEmail !== userName ? userEmail : '';

    // KV pairs
    var kvStatus     = el('drawerKvStatus');
    var kvSessionId  = el('drawerKvSessionId');
    var kvBrowser    = el('drawerKvBrowser');
    var kvOS         = el('drawerKvOS');
    var kvDeviceType = el('drawerKvDeviceType');
    var kvIP         = el('drawerKvIP');
    var kvLocation   = el('drawerKvLocation');
    var kvStarted    = el('drawerKvStarted');
    var kvLastActive = el('drawerKvLastActive');
    var kvDuration   = el('drawerKvDuration');

    if (kvStatus)     kvStatus.value     = active ? 'Active' : 'Idle';
    if (kvSessionId)  kvSessionId.value  = String(session.session_id || session.id || '\u2014');
    if (kvBrowser)    kvBrowser.value    = String(session.browser || 'Unknown');
    if (kvOS)         kvOS.value         = String(session.os || 'Unknown');
    if (kvDeviceType) kvDeviceType.value = String(session.device_type || session.device || 'Unknown');
    if (kvIP)         kvIP.value         = String(session.ip_address || '\u2014');
    if (kvLocation)   kvLocation.value   = String(session.location || 'Unknown');
    if (kvStarted)    kvStarted.value    = session.created_at ? fmtDateTime(session.created_at) : '\u2014';
    if (kvLastActive) kvLastActive.value = session.last_activity ? fmtDateTime(session.last_activity) : '\u2014';
    if (kvDuration)   kvDuration.value   = session.created_at
      ? formatDuration(Date.now() - new Date(session.created_at).getTime())
      : '\u2014';

    hide('sessionDrawerLoading');
    show('sessionDrawerBody');
  }

  // =========================================================================
  // Terminate Session
  // =========================================================================

  function _terminateSession(sessionId) {
    Lex.Modal.confirm(
      'Terminate Session',
      'Are you sure you want to terminate this session? The user will be logged out immediately.',
      function () {
        api.terminateSession(sessionId)
          .then(function () {
            Lex.Toast.success('Session terminated successfully');

            // Close drawer if showing this session
            if (_drawerSessionId === sessionId) {
              var drawer = el('sessionDrawer');
              if (drawer) drawer.open = false;
              _drawerSessionId = null;
            }

            loadSessions();
          })
          .catch(function (err) {
            console.error('[admin-sessions] terminateSession error:', err);
            var msg = (err && err.message) ? err.message : 'Failed to terminate session';
            Lex.Toast.error(msg);
          });
      },
      { variant: 'danger', confirmText: 'Terminate' }
    );
  }

  // =========================================================================
  // Bootstrap
  // =========================================================================

  init();

})();
