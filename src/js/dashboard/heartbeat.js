/* Dashboard — Heartbeat Indicator
   Topbar button that polls /api/v1/heartbeat/runs, animates on new runs,
   and opens a status modal on click.

   Requires: api.js, Lex.Modal, Lex.Utils.escapeHtml, Lex.Utils.timeAgo
   CSS:      css/lana-heartbeat.css
*/

(function () {
  'use strict';

  var escHtml = Lex.Utils.escapeHtml;
  var timeAgo = Lex.Utils.timeAgo;

  var _lastHeartbeatRunId = null;
  var _latestHeartbeatRun = null;
  var _heartbeatInterval = null;

  // =========================================================================
  // Button injection
  // =========================================================================

  function injectHeartbeatButton() {
    var topbarRight = document.querySelector('.lex-topbar-right');
    if (!topbarRight) return;
    if (topbarRight.querySelector('.lana-heartbeat-btn')) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lana-heartbeat-btn';
    btn.title = 'System Heartbeat';
    btn.innerHTML = '<span class="lana-hb-icon">'
      + '<svg class="lana-hb-corner-tl" width="8" height="8" viewBox="0 0 8 8" fill="none">'
      + '<path d="M0 0L8 0M0 0L0 8" stroke="currentColor" stroke-width="1.5"/>'
      + '</svg>'
      + '<svg class="lana-hb-corner-br" width="8" height="8" viewBox="0 0 8 8" fill="none">'
      + '<path d="M8 8L0 8M8 8L8 0" stroke="currentColor" stroke-width="1.5"/>'
      + '</svg>'
      + '</span>'
      + '<span class="lana-hb-dot"></span>';

    btn.addEventListener('click', function () {
      openHeartbeatModal();
    });

    // Insert divider + button at end of topbar right (after settings)
    var divider = document.createElement('span');
    divider.className = 'lana-topbar-divider';
    topbarRight.appendChild(divider);
    topbarRight.appendChild(btn);
  }

  // =========================================================================
  // Polling
  // =========================================================================

  function pollHeartbeat() {
    if (typeof api === 'undefined' || typeof api.get !== 'function') return;

    api.get('/api/v1/heartbeat/runs?limit=1&sort_by=created_at&sort_order=desc')
      .then(function (res) {
        var runs = (res && res.data) || (res && res.runs) || [];
        if (!Array.isArray(runs)) runs = [];
        var latest = runs[0];
        if (!latest) return;
        _latestHeartbeatRun = latest;

        var btn = document.querySelector('.lana-heartbeat-btn');
        if (!btn) return;

        var dot = btn.querySelector('.lana-hb-dot');

        // Update status dot color
        if (dot) {
          dot.className = 'lana-hb-dot';
          var status = latest.status || latest.aggregate_status || '';
          if (status === 'error' || status === 'failed') {
            dot.classList.add('lana-hb-dot--error');
          } else if (status === 'warning') {
            dot.classList.add('lana-hb-dot--warning');
          } else {
            dot.classList.add('lana-hb-dot--ok');
          }
        }

        // Animate if this is a new run
        var runId = latest.id || latest.run_id || '';
        if (runId && runId !== _lastHeartbeatRunId) {
          _lastHeartbeatRunId = runId;
          triggerHeartbeatAnimation(btn);
        }
      })
      .catch(function () {
        // Silently ignore — heartbeat is optional
      });
  }

  function triggerHeartbeatAnimation(btn) {
    btn.classList.remove('lana-heartbeat-btn--beating');
    // Force reflow to restart animation
    void btn.offsetWidth;
    btn.classList.add('lana-heartbeat-btn--beating');

    setTimeout(function () {
      btn.classList.remove('lana-heartbeat-btn--beating');
    }, 1300);
  }

  // =========================================================================
  // Modal
  // =========================================================================

  /**
   * Check if the current user is a system admin.
   * @returns {boolean}
   */
  function isSystemAdmin() {
    if (typeof Lex !== 'undefined' && Lex.Auth && typeof Lex.Auth.isAdmin === 'function') {
      return Lex.Auth.isAdmin();
    }
    if (typeof api !== 'undefined' && api.user) {
      var role = api.user.role || api.user.roleName || '';
      return role === 'system_admin' || role === 'org_admin';
    }
    return false;
  }

  /**
   * Check if enough time has passed since the last heartbeat run to allow
   * a manual trigger (minimum 10 minutes).
   * @returns {boolean}
   */
  function canTriggerHeartbeat() {
    var run = _latestHeartbeatRun;
    if (!run) return true; // No runs yet — allow trigger
    var ts = run.created_at || run.generated_at;
    if (!ts) return true;
    var lastRunMs = new Date(ts).getTime();
    if (isNaN(lastRunMs)) return true;
    var elapsedMs = Date.now() - lastRunMs;
    return elapsedMs >= 10 * 60 * 1000; // 10 minutes
  }

  /**
   * Trigger a manual heartbeat run via POST /api/v1/heartbeat/trigger.
   */
  function triggerManualHeartbeat() {
    var triggerBtn = document.getElementById('lanaHbTriggerBtn');
    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.textContent = 'Running...';
    }

    api.post('/api/v1/heartbeat/trigger', {})
      .then(function () {
        if (triggerBtn) {
          triggerBtn.textContent = 'Triggered';
          triggerBtn.style.color = '#059669';
        }
        // Refresh heartbeat data after a short delay
        setTimeout(function () {
          pollHeartbeat();
        }, 3000);
      })
      .catch(function (err) {
        if (triggerBtn) {
          triggerBtn.disabled = false;
          triggerBtn.textContent = 'Run Now';
          triggerBtn.style.color = '#dc2626';
        }
        console.warn('[Heartbeat] Manual trigger failed:', err && err.message);
      });
  }

  function openHeartbeatModal() {
    pollHeartbeat();

    var run = _latestHeartbeatRun;
    var status = run ? (run.status || run.aggregate_status || 'unknown') : 'unknown';
    var badgeClass = 'lana-hb-badge--unknown';
    var badgeLabel = 'No Data';

    if (status === 'completed' || status === 'ok') {
      badgeClass = 'lana-hb-badge--ok';
      badgeLabel = 'Healthy';
    } else if (status === 'warning') {
      badgeClass = 'lana-hb-badge--warning';
      badgeLabel = 'Warning';
    } else if (status === 'error' || status === 'failed') {
      badgeClass = 'lana-hb-badge--error';
      badgeLabel = 'Error';
    } else if (status === 'suppressed') {
      badgeClass = 'lana-hb-badge--ok';
      badgeLabel = 'Suppressed (OK)';
    }

    var lastRanStr = 'Never';
    if (run && (run.created_at || run.generated_at)) {
      var ts = run.created_at || run.generated_at;
      lastRanStr = typeof timeAgo === 'function' ? timeAgo(ts) : new Date(ts).toLocaleString();
    }

    // Build plugin status rows
    var pluginHtml = '';
    var pluginResults = run ? (run.plugin_results || {}) : {};
    var pluginKeys = Object.keys(pluginResults);

    if (pluginKeys.length > 0) {
      pluginHtml += '<div class="lana-hb-plugins">';
      pluginHtml += '<div class="lana-hb-plugin-title">Plugin Results</div>';
      for (var i = 0; i < pluginKeys.length; i++) {
        var key = pluginKeys[i];
        var plugin = pluginResults[key] || {};
        var pStatus = plugin.status || 'unknown';
        var pBadge = 'lana-hb-badge--unknown';
        if (pStatus === 'ok') pBadge = 'lana-hb-badge--ok';
        else if (pStatus === 'warning') pBadge = 'lana-hb-badge--warning';
        else if (pStatus === 'error') pBadge = 'lana-hb-badge--error';

        var displayName = key.split('_').join(' ').split('-').join(' ');
        displayName = displayName.split(' ').map(function (w) {
          return w.charAt(0).toUpperCase() + w.slice(1);
        }).join(' ');

        pluginHtml += '<div class="lana-hb-plugin-row">';
        pluginHtml += '<span class="lana-hb-plugin-name">' + escHtml(displayName) + '</span>';
        pluginHtml += '<span class="lana-hb-badge ' + pBadge + '"><span class="lana-hb-badge-dot"></span>' + escHtml(pStatus) + '</span>';
        pluginHtml += '</div>';
      }
      pluginHtml += '</div>';
    }

    // LLM summary
    var summaryHtml = '';
    if (run && run.llm_summary) {
      summaryHtml = '<div style="margin-top:16px;padding:12px;background:#f0f9ff;border-radius:8px;border:1px solid #bae6fd;">'
        + '<div style="font-size:12px;font-weight:600;color:#0369a1;margin-bottom:6px;">AI Summary</div>'
        + '<div style="font-size:13px;color:#374151;line-height:1.5;white-space:pre-wrap;">' + escHtml(run.llm_summary) + '</div>'
        + '</div>';
    }

    // Run Now button — visible to system admins only, enabled when 10+ min since last run
    var triggerHtml = '';
    if (isSystemAdmin()) {
      var canTrigger = canTriggerHeartbeat();
      var btnDisabled = canTrigger ? '' : ' disabled';
      var btnTitle = canTrigger
        ? 'Manually trigger a heartbeat run now'
        : 'Please wait at least 10 minutes between manual runs';
      triggerHtml = '<div style="margin-top:16px;text-align:right;">'
        + '<button id="lanaHbTriggerBtn" type="button"' + btnDisabled
        + ' title="' + escHtml(btnTitle) + '"'
        + ' style="padding:8px 16px;font-size:13px;font-weight:500;border-radius:6px;'
        + 'border:1px solid #d1d5db;background:#fff;color:#374151;cursor:pointer;'
        + 'transition:all 0.15s ease;"'
        + ' onmouseover="if(!this.disabled){this.style.background=\'#f3f4f6\'}"'
        + ' onmouseout="if(!this.disabled){this.style.background=\'#fff\'}"'
        + '>'
        + (canTrigger ? 'Run Now' : 'Run Now (wait 10 min)')
        + '</button>'
        + '</div>';
    }

    var content = ''
      + '<div class="lana-hb-modal-desc">'
      + 'LANA Heartbeat monitors your platform health by running diagnostic plugins every 30 minutes. '
      + 'It checks database connectivity, storage capacity, connector sync status, document processing health, and pending background tasks. '
      + 'Results are deduplicated and summarized by AI to surface only meaningful changes.'
      + '</div>'
      + '<div class="lana-hb-status-card">'
      + '<div class="lana-hb-status-row">'
      + '<span class="lana-hb-label">Current Status</span>'
      + '<span class="lana-hb-badge ' + badgeClass + '"><span class="lana-hb-badge-dot"></span>' + escHtml(badgeLabel) + '</span>'
      + '</div>'
      + '<div class="lana-hb-status-row">'
      + '<span class="lana-hb-label">Last Run</span>'
      + '<span class="lana-hb-value">' + escHtml(lastRanStr) + '</span>'
      + '</div>'
      + '<div class="lana-hb-status-row">'
      + '<span class="lana-hb-label">Frequency</span>'
      + '<span class="lana-hb-value">Every 30 minutes</span>'
      + '</div>'
      + '</div>'
      + pluginHtml
      + summaryHtml
      + triggerHtml;

    if (!run) {
      content = ''
        + '<div class="lana-hb-modal-desc">'
        + 'LANA Heartbeat monitors your platform health by running diagnostic plugins every 30 minutes. '
        + 'It checks database connectivity, storage capacity, connector sync status, document processing health, and pending background tasks.'
        + '</div>'
        + '<div class="lana-hb-empty">No heartbeat runs recorded yet. The first run will execute automatically.</div>'
        + triggerHtml;
    }

    Lex.Modal.open({
      heading: 'System Heartbeat',
      content: content,
      size: 'md',
      hideActions: true,
      closeOnOverlay: true
    });

    // Attach click handler after modal is rendered
    setTimeout(function () {
      var triggerBtn = document.getElementById('lanaHbTriggerBtn');
      if (triggerBtn) {
        triggerBtn.addEventListener('click', function () {
          triggerManualHeartbeat();
        });
      }
    }, 100);
  }

  // =========================================================================
  // Start / stop
  // =========================================================================

  function startHeartbeatPolling(intervalsArray) {
    pollHeartbeat();
    _heartbeatInterval = setInterval(function () {
      if (document.visibilityState === 'hidden') return;
      pollHeartbeat();
    }, 60000);
    if (intervalsArray) intervalsArray.push(_heartbeatInterval);
  }

  function stopHeartbeatPolling() {
    if (_heartbeatInterval) {
      clearInterval(_heartbeatInterval);
      _heartbeatInterval = null;
    }
  }

  // =========================================================================
  // Public API
  // =========================================================================

  window.LanaHeartbeat = {
    inject: injectHeartbeatButton,
    start:  startHeartbeatPolling,
    stop:   stopHeartbeatPolling,
    poll:   pollHeartbeat
  };

})();
