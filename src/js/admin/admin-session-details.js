/**
 * Admin Session Details — standalone page controller.
 *
 * Displays full session details (KV pairs) and allows termination.
 * Receives session data via Lex.Nav context (fast path) or falls back
 * to fetching all sessions and finding by ID (direct URL / refresh).
 *
 * @requires api.js          - window.api — getSessions, terminateSession
 * @requires lex.utils.js    - Lex.Utils.escapeHtml, Lex.Utils.formatDateTime
 * @requires lex-modal.js    - Lex.Modal.confirm
 * @requires lex-toast.js    - Lex.Toast.success, Lex.Toast.error
 * @requires lex-nav.js      - Lex.Nav.getParams, Lex.Nav.go, Lex.Nav.consume
 */

(function () {
  'use strict';

  // =========================================================================
  // Lex aliases
  // =========================================================================

  var fmtDateTime = Lex.Utils.formatDateTime;

  // =========================================================================
  // Module-level state
  // =========================================================================

  var _sessionId = null;
  var _session   = null;

  // =========================================================================
  // DOM helpers
  // =========================================================================

  function el(id) {
    return document.getElementById(id);
  }

  // =========================================================================
  // Session helpers
  // =========================================================================

  /**
   * Determine if a session is currently active (activity within last 5 min).
   * @param {Object} session
   * @returns {boolean}
   */
  function isSessionActive(session) {
    if (!session || !session.last_activity) return false;
    return (Date.now() - new Date(session.last_activity).getTime()) < 5 * 60 * 1000;
  }

  /**
   * Format a duration in milliseconds to a human-readable string.
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
   * Get first character initial from a name or email.
   * @param {string} name
   * @returns {string}
   */
  function getInitial(name) {
    if (!name) return '?';
    return name.charAt(0).toUpperCase();
  }

  // =========================================================================
  // Entry point
  // =========================================================================

  function init() {
    var params = Lex.Nav.getParams();
    _sessionId = params.get('sessionId');

    if (!_sessionId) {
      Lex.Toast.error('No session ID specified');
      Lex.Nav.go('admin/sessions.html');
      return;
    }

    _wireTerminateButton();
    _loadSession(_sessionId);
  }

  // =========================================================================
  // Load session data
  // =========================================================================

  /**
   * Load session data. Fast path: consume Nav context passed from list page.
   * Fallback: fetch all sessions from API and find by ID.
   */
  function _loadSession(sessionId) {
    var banner = el('sessionBanner');
    if (banner) Lex.Redact.on(banner);

    // Fast path: session object passed via Lex.Nav context
    var ctx = Lex.Nav.hasContext ? Lex.Nav.consume() : null;
    if (ctx && ctx.session) {
      _session = ctx.session;
      _renderSession(_session);
      if (banner) Lex.Redact.off(banner);
      return;
    }

    // Fallback: fetch sessions list and find by ID
    api.getSessions(1, 200)
      .then(function (result) {
        var sessions = [];
        if (Array.isArray(result)) {
          sessions = result;
        } else if (result && Array.isArray(result.sessions)) {
          sessions = result.sessions;
        } else if (result && Array.isArray(result.data)) {
          sessions = result.data;
        }

        var found = null;
        for (var i = 0; i < sessions.length; i++) {
          var s = sessions[i];
          if (String(s.session_id || s.id || '') === String(sessionId)) {
            found = s;
            break;
          }
        }

        if (!found) {
          if (banner) Lex.Redact.off(banner);
          Lex.Toast.error('Session not found');
          Lex.Nav.go('admin/sessions.html');
          return;
        }

        _session = found;
        _renderSession(_session);
        if (banner) Lex.Redact.off(banner);
      })
      .catch(function (err) {
        if (banner) Lex.Redact.off(banner);
        Lex.Toast.error('Failed to load session details');
        console.error('[session-details] load error:', err);
      });
  }

  // =========================================================================
  // Render session data
  // =========================================================================

  function _renderSession(session) {
    var active   = isSessionActive(session);
    var userName  = String(session.user_name || session.user_email || 'Unknown User');
    var userEmail = String(session.user_email || '');

    // Banner
    var banner = el('sessionBanner');
    if (banner) {
      banner.heading  = userName;
      banner.subtitle = active ? 'Active' : 'Idle';
    }

    // Breadcrumb — update last item to user name
    var breadcrumb = el('sessionBreadcrumb');
    if (breadcrumb) {
      breadcrumb.items = [
        { label: 'Administration', href: 'admin/index.html' },
        { label: 'Active Sessions', href: 'admin/sessions.html' },
        { label: userName }
      ];
    }

    // Session Information KVs
    var kvSessionId  = el('kvSessionId');
    var kvStatus     = el('kvStatus');
    var kvBrowser    = el('kvBrowser');
    var kvOS         = el('kvOS');
    var kvDeviceType = el('kvDeviceType');
    var kvIP         = el('kvIP');
    var kvLocation   = el('kvLocation');
    var kvStarted    = el('kvStarted');
    var kvLastActive = el('kvLastActive');
    var kvDuration   = el('kvDuration');

    if (kvSessionId)  kvSessionId.value  = String(session.session_id || session.id || '\u2014');
    if (kvStatus)     kvStatus.value     = active ? 'Active' : 'Idle';
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

    // User Information KVs
    var kvUserName  = el('kvUserName');
    var kvUserEmail = el('kvUserEmail');

    if (kvUserName)  kvUserName.value  = userName;
    if (kvUserEmail) kvUserEmail.value = userEmail || '\u2014';
  }

  // =========================================================================
  // Terminate session
  // =========================================================================

  function _wireTerminateButton() {
    var btn = el('terminateSessionBtn');
    if (!btn || btn._wired) return;
    btn._wired = true;

    // Delegate from banner to survive re-renders
    var banner = el('sessionBanner');
    if (banner) {
      banner.addEventListener('click', function (e) {
        var target = e.target.closest('#terminateSessionBtn');
        if (!target) return;
        _terminateSession();
      });
    }
  }

  function _terminateSession() {
    if (!_sessionId) return;

    Lex.Modal.confirm(
      'Terminate Session',
      'Are you sure you want to terminate this session? The user will be logged out immediately.',
      function () {
        api.terminateSession(_sessionId)
          .then(function () {
            Lex.Toast.success('Session terminated successfully');
            Lex.Nav.go('admin/sessions.html');
          })
          .catch(function (err) {
            var msg = (err && err.message) ? err.message : 'Failed to terminate session';
            Lex.Toast.error(msg);
            console.error('[session-details] terminate error:', err);
          });
      },
      { variant: 'danger', confirmText: 'Terminate' }
    );
  }

  // =========================================================================
  // Boot
  // =========================================================================

  init();

})();
