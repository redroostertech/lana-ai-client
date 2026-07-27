/* Dashboard — Command Center "Morning Briefing" page logic.
   Loaded by the router after dashboard.html content is injected.

   Zones:
     A  Morning Orientation Bar    — greeting, date, pill stats
     C  My Action Queue            — priority-sorted action list (critical first)
     D  LANA Can Handle            — Phase 3 placeholder
     E  Pipeline Intelligence      — 3 stat columns
     F  Activity Overview + Data Pulse

   Rules:
     - NO regex anywhere — string methods only (includes, indexOf, split, etc.)
     - All HTML escaping via Lex.Utils.escapeHtml()
     - All time/date formatting via Lex.Utils.timeAgo() / Lex.Utils.formatDate()
     - Role checks via Lex.Auth.*
     - Promise.allSettled for parallel zone loading (graceful degradation)
     - IIFE wrapper to keep scope clean
*/

(function () {
  'use strict';

  // =========================================================================
  // Lex aliases (shell singletons)
  // =========================================================================

  var escHtml        = Lex.Utils.escapeHtml;
  var timeAgo        = Lex.Utils.timeAgo;
  var formatDate     = Lex.Utils.formatDate;
  var formatDateTime = Lex.Utils.formatDateTime;
  var formatBytes    = Lex.Utils.formatFileSize;
  var isAdmin        = Lex.Auth.isAdmin;
  var canViewStatus  = Lex.Auth.canViewSystemStatus;

  /** Which detail panel is currently expanded: 'team' | 'docs' | 'storage' | null */
  var activeDetailKey = null;

  /** Cache of action queue items keyed by item ID for detail modal lookup */
  var _actionItemsMap = {};

  // =========================================================================
  // Lifecycle tracking (Finding 7)
  // =========================================================================

  var _timeouts = [];
  var _intervals = [];
  var _globalFns = [];
  var _documentListeners = [];

  /**
   * Expose a function as a window global and track it for cleanup on onLeave.
   * @param {string} name
   * @param {Function} fn
   */
  function exposeGlobal(name, fn) {
    window[name] = fn;
    _globalFns.push(name);
  }

  /**
   * Add a document-level event listener and track it for cleanup on onLeave.
   * @param {string} event
   * @param {Function} handler
   */
  function trackDocListener(event, handler) {
    document.addEventListener(event, handler);
    _documentListeners.push({ event: event, handler: handler });
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  /**
   * Safely get a DOM element by ID without throwing.
   * @param {string} id
   * @returns {Element|null}
   */
  function el(id) {
    return document.getElementById(id);
  }

  /**
   * Show an element (removes 'hidden' class).
   * @param {Element|string} target
   */
  function show(target) {
    var elem = typeof target === 'string' ? el(target) : target;
    if (elem) elem.classList.remove('hidden');
  }

  /**
   * Hide an element (adds 'hidden' class).
   * @param {Element|string} target
   */
  function hide(target) {
    var elem = typeof target === 'string' ? el(target) : target;
    if (elem) elem.classList.add('hidden');
  }

  /**
   * LANA One edition gate for the Zone E pipeline metric tiles.
   *
   * Single-tenant LANA One has exactly one user, so the "Team Members" metric
   * (Zone E tile index 0, data-metric-key="team") is meaningless; hide that
   * specific tile and reflow the 3-column pipeline grid to 2 columns so the two
   * remaining tiles (Total Documents, Storage Used) lay out correctly.
   *
   * Purely edition-gated via the canonical electronAPI.getConfig() pattern: in
   * the browser / org edition there is no window.electronAPI (or isLanaOne is
   * not true), so this is a COMPLETE no-op and the org dashboard is unchanged.
   * Idempotent, safe to call on every render/refresh. The hidden class is not
   * touched by renderZoneE's in-place population loop (which only rewrites
   * label/value/status), so the hide is never undone.
   */
  function applyLanaOneMetricGate() {
    var oneApi = window.electronAPI;
    if (!oneApi || typeof oneApi.getConfig !== 'function') return;
    Promise.resolve(oneApi.getConfig()).then(function (cfg) {
      if (!cfg || cfg.isLanaOne !== true) return;
      var zoneE = el('ccZoneE');
      if (!zoneE) return;
      var teamTile = zoneE.querySelector('lex-metric[data-metric-key="team"]');
      if (teamTile) hide(teamTile);
      // Reflow the 3-col pipeline grid to 2 cols now that a tile is hidden, so
      // the remaining two tiles fill the row instead of leaving an empty column.
      zoneE.style.gridTemplateColumns = 'repeat(2, 1fr)';
    }).catch(function () { /* inert on any failure; org edition stays untouched */ });
  }

  /**
   * @returns {boolean}
   */
  function heartbeatAppEnabled() {
    return Boolean(window.LanaConfig && window.LanaConfig.HEARTBEAT_APP_ENABLED);
  }

  /**
   * @returns {boolean}
   */
  function actionQueueEnabled() {
    return Boolean(window.LanaConfig && window.LanaConfig.ACTION_QUEUE_ENABLED);
  }

  /**
   * Get a display label for a severity string.
   * @param {string} severity
   * @returns {string}
   */
  function severityLabel(severity) {
    if (!severity) return 'Low';
    var s = String(severity).toLowerCase();
    if (s === 'critical') return 'Critical';
    if (s === 'high')     return 'High';
    if (s === 'medium')   return 'Medium';
    return 'Low';
  }

  /**
   * Determine the greeting part of day from a Date.
   * @param {Date} now
   * @returns {string}
   */
  function greetingPart(now) {
    var h = now.getHours();
    if (h < 12) return 'morning';
    if (h < 17) return 'afternoon';
    return 'evening';
  }

  /**
   * Format a Date as a friendly string.
   * Delegates to Lex.Utils.formatDateWeekday for org-timezone correctness.
   * @param {Date} now
   * @returns {string}
   */
  function formatTodayDate(now) {
    return formatDateWeekday(now);
  }

  /**
   * Get a connector health dot class from a status string.
   * @param {string} status
   * @returns {string}
   */
  function connectorDotClass(status) {
    if (!status) return 'cc-connector-row__dot--idle';
    var s = String(status).toLowerCase();
    if (s === 'active' || s === 'connected' || s === 'healthy') return 'cc-connector-row__dot--ok';
    if (s === 'warning' || s === 'degraded')                    return 'cc-connector-row__dot--warn';
    if (s === 'error'   || s === 'disconnected' || s === 'failed') return 'cc-connector-row__dot--error';
    return 'cc-connector-row__dot--idle';
  }

  /**
   * Get a connector status label from a status string.
   * @param {string} status
   * @returns {string}
   */
  function connectorStatusLabel(status) {
    if (!status) return 'Unknown';
    var s = String(status).toLowerCase();
    if (s === 'active' || s === 'connected')   return 'Connected';
    if (s === 'healthy')                       return 'Healthy';
    if (s === 'warning' || s === 'degraded')   return 'Warning';
    if (s === 'error' || s === 'failed')       return 'Error';
    if (s === 'disconnected')                  return 'Disconnected';
    return status;
  }

  // =========================================================================
  // Zone A — Morning Orientation Bar
  // =========================================================================

  /**
   * Render the morning greeting bar with date, user name, and summary pills.
   * Data comes from api.user (already loaded) and is augmented after Zone E
   * resolves matter count.
   */
  function renderZoneA() {
    var now = new Date();
    var banner = el('ccZoneA');
    if (!banner) return;

    var user = api.user;
    var firstName = (user && (user.firstName || user.first_name || '').trim()) || 'there';

    banner.heading = 'Good ' + greetingPart(now) + ', ' + firstName;
    banner.subtitle = formatTodayDate(now);
  }

  /**
   * Update Zone A matters button once stats are loaded.
   * When matters > 0: shows "X active matters" → navigates to matters page.
   * When matters = 0: shows "Create a new matter" → navigates to create flow.
   * @param {number|string} matterCount - Visible matters count (compact-formatted string or number)
   */
  function updateZoneAPills(matterCount) {
    var mattersBtn = el('ccZoneAMatters');
    if (!mattersBtn) return;

    var count = parseInt(String(matterCount), 10);
    var hasMatters = !isNaN(count) && count > 0;

    // Set variant first; this may queue a re-render via lex-btn's
    // _scheduleUpdate (microtask). lex-btn restores _originalChildren on
    // every re-render, so any synchronous mutation of slot children
    // (textContent, display:none) gets clobbered. Defer the content swap
    // with Promise.resolve().then() so it lands AFTER the variant re-render.
    mattersBtn.variant = hasMatters ? 'secondary' : 'primary';

    Promise.resolve().then(function () {
      var slot = mattersBtn.querySelector('slot-content') || mattersBtn;
      if (hasMatters) {
        slot.innerHTML = '<span id="ccZoneAMattersCount">' +
          Utils.escapeHtml(String(matterCount)) +
          '</span> active matters';
      } else {
        slot.innerHTML = 'Create a new matter';
      }
    });
  }

  // =========================================================================
  // Zone C — My Action Queue (includes critical items, sorted by severity)
  // =========================================================================

  /**
   * Determine if an action queue item has a Lana-type suggested action.
   * Checks context.suggested_action.type === 'lana'.
   * @param {Object} item
   * @returns {boolean}
   */
  function isLanaAction(item) {
    var ctx = item.context;
    if (!ctx) return false;
    // context may be a string (JSON) or an object
    if (typeof ctx === 'string') {
      try { ctx = JSON.parse(ctx); } catch (e) { return false; }
    }
    return ctx.suggested_action && ctx.suggested_action.type === 'lana';
  }

  /**
   * Extract the suggested_action from an item's context.
   * @param {Object} item
   * @returns {Object|null}
   */
  function getSuggestedAction(item) {
    var ctx = item.context;
    if (!ctx) return null;
    if (typeof ctx === 'string') {
      try { ctx = JSON.parse(ctx); } catch (e) { return null; }
    }
    if (ctx.suggested_action) return ctx.suggested_action;
    // Generic plugin context nests data inside findings[]
    if (ctx.findings && ctx.findings.length > 0 && ctx.findings[0].suggested_action) {
      return ctx.findings[0].suggested_action;
    }
    return null;
  }

  /**
   * Get the first matter_id from a suggested action (could be matter_id or matter_ids[0]).
   * @param {Object} action
   * @returns {string|null}
   */
  function getActionMatterId(action) {
    if (!action) return null;
    if (action.matter_id) return action.matter_id;
    if (action.matter_ids && action.matter_ids.length > 0) return action.matter_ids[0];
    return null;
  }

  /**
   * Build an enriched description from suggested_action.items for entity-level
   * drill-down display. Falls back to null if no items are available.
   * @param {Object} sa - suggested_action object
   * @param {string} matter - fallback matter name
   * @param {string|null} ts - timestamp for timeAgo
   * @returns {string|null} enriched description or null
   */
  function buildEnrichedDescription(sa, matter, ts) {
    if (!sa) return null;

    var parts = [];
    var hasItems = sa.items && sa.items.length > 0;

    if (hasItems) {
      var items = sa.items;
      var maxPreview = 2;

      // Prepend matter context for document-type items
      if (matter && sa.action === 'review_documents') {
        parts.push(matter);
      }

      for (var k = 0; k < items.length && k < maxPreview; k++) {
        var it = items[k];
        if (it.title) {
          // task_health: task title + due date
          var taskDesc = escHtml(it.title);
          if (it.due_date) taskDesc += ' (due ' + escHtml(formatShortDate(it.due_date)) + ')';
          parts.push(taskDesc);
        } else if (it.filename) {
          // unreviewed_docs: filename
          parts.push(escHtml(it.filename));
        } else if (it.missing_fields) {
          // matter_completeness: matter name + completeness
          parts.push(escHtml(it.matter_name || '') + ' (' + (it.completeness_pct || 0) + '% complete)');
        } else if (it.matter_name) {
          // staleness/engagement: matter name
          parts.push(escHtml(it.matter_name));
        }
      }

      var totalCount = sa.total_count || items.length;
      if (totalCount > maxPreview) {
        parts.push('+ ' + (totalCount - maxPreview) + ' more');
      }
    } else if (sa.matter_ids && sa.matter_ids.length > 0) {
      // No items but have matter_ids — show count + matter IDs
      var docCount = sa.total_count || sa.matter_ids.length;
      parts.push(docCount + ' document' + (docCount !== 1 ? 's' : ''));
      if (sa.matter_ids.length === 1) {
        parts.push(escHtml(sa.matter_ids[0]));
      } else {
        parts.push(sa.matter_ids.length + ' matter' + (sa.matter_ids.length !== 1 ? 's' : ''));
      }
    } else {
      return null;
    }

    if (ts) parts.push(escHtml(timeAgo(ts)));
    return parts.join(' \u00b7 ');
  }

  /**
   * Format a date string as a short date (e.g. "Feb 20").
   * @param {string} dateStr
   * @returns {string}
   */
  function formatShortDate(dateStr) {
    try {
      var d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return months[d.getMonth()] + ' ' + d.getDate();
    } catch (e) {
      return dateStr;
    }
  }

  /**
   * Build and display a detail modal for an action queue item.
   * Shows title, severity, message, affected matters list, and suggested action.
   * @param {Object} item — full action queue item from the API
   */
  function showActionDetail(item) {
    if (!item) return;

    var ctx = item.context;
    if (ctx && typeof ctx === 'string') {
      try { ctx = JSON.parse(ctx); } catch (e) { ctx = null; }
    }

    // Handle two context structures:
    // 1. Finding-based: { suggested_action, details, sub_check }
    // 2. Generic plugin: { findings: [{ suggested_action, message, sub_check }], ... }
    var finding = null;
    if (ctx && ctx.findings && ctx.findings.length > 0) {
      finding = ctx.findings[0];
    }

    var sa = (ctx && ctx.suggested_action) || (finding && finding.suggested_action) || null;
    var details = (ctx && ctx.details) || {};
    var subCheck = (ctx && ctx.sub_check) || '';

    // Pull message from finding if details.message is empty
    if (!details.message && finding && finding.message) {
      details = { message: finding.message };
    }

    // Header: severity badge + sub-check label
    var sevColor = 'var(--lex-text-tertiary)';
    var sev = String(item.severity || 'low').toLowerCase();
    if (sev === 'critical' || sev === 'high') sevColor = 'var(--lex-color-danger-500, #ef4444)';
    else if (sev === 'medium') sevColor = 'var(--lex-color-warning-500, #f59e0b)';

    var subCheckLabel = '';
    if (subCheck) {
      subCheckLabel = subCheck.split('_').join(' ');
      subCheckLabel = subCheckLabel.charAt(0).toUpperCase() + subCheckLabel.slice(1);
    }

    var bodyParts = [];

    // Severity + type row
    bodyParts.push(
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">' +
        '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + sevColor + ';flex-shrink:0;"></span>' +
        '<span style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--lex-text-tertiary);font-weight:500;">' +
          escHtml(sev) + (subCheckLabel ? ' \u00b7 ' + escHtml(subCheckLabel) : '') +
        '</span>' +
      '</div>'
    );

    // Message — prefer context.details.message, fall back to item.message
    var displayMessage = details.message || item.message || '';
    if (displayMessage) {
      bodyParts.push(
        '<p style="font-size:0.8125rem;color:var(--lex-text-secondary);line-height:1.5;margin:0 0 16px;">' +
          escHtml(displayMessage) +
        '</p>'
      );
    }

    // Resolve first matter ID from any available source
    var firstMatterId = null;
    if (sa) {
      if (sa.matter_id) firstMatterId = sa.matter_id;
      if (!firstMatterId && sa.matter_ids && sa.matter_ids.length > 0) firstMatterId = sa.matter_ids[0];
    }
    if (!firstMatterId && item.matter_id) firstMatterId = item.matter_id;

    // Items list (documents, tasks, matters, etc.)
    if (sa && sa.items && sa.items.length > 0) {
      // Pick a contextual section heading based on the action type
      var sectionHeading = 'Affected Matters';
      if (sa.action === 'review_documents') sectionHeading = 'Documents to Review';
      else if (sa.action === 'complete_tasks') sectionHeading = 'Tasks';

      bodyParts.push('<div style="margin-bottom:16px;">');
      bodyParts.push(
        '<div style="font-size:0.6875rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--lex-text-tertiary);font-weight:500;margin-bottom:8px;">' + escHtml(sectionHeading) + '</div>'
      );

      for (var k = 0; k < sa.items.length; k++) {
        var it = sa.items[k];
        var itemLabel;
        var itemMeta = '';
        var matterId = it.matter_id || '';

        if (!firstMatterId && matterId) firstMatterId = matterId;

        // For document items, show filename as label with matter as context
        if (it.filename) {
          itemLabel = escHtml(it.filename);
          if (it.matter_name) {
            itemMeta = it.matter_name; // escaped by outer escHtml at render
          }
        } else {
          itemLabel = escHtml(it.matter_name || it.title || 'Item ' + (k + 1));
        }

        if (it.completeness_pct !== undefined) {
          itemMeta += (itemMeta ? ' \u00b7 ' : '') + it.completeness_pct + '% complete';
        }
        if (it.missing_fields && it.missing_fields.length > 0) {
          itemMeta += (itemMeta ? ' \u00b7 ' : '') + 'Missing: ' + escHtml(it.missing_fields.join(', '));
        }
        if (it.due_date) {
          itemMeta += (itemMeta ? ' \u00b7 ' : '') + 'Due ' + escHtml(formatShortDate(it.due_date));
        }
        if (it.days_since_activity !== undefined) {
          itemMeta += (itemMeta ? ' \u00b7 ' : '') + it.days_since_activity + ' days inactive';
        }

        var rowStyle = 'padding:8px 0;border-bottom:1px solid var(--lex-border-subtle, rgba(0,0,0,0.06));';
        if (matterId) {
          rowStyle += 'cursor:pointer;transition:background 0.15s ease;';
        }

        bodyParts.push(
          '<div class="lex-detail-matter-row" style="' + rowStyle + '"' +
            (matterId ? ' data-matter-id="' + escHtml(matterId) + '"' : '') + '>' +
            '<div style="display:flex;align-items:center;justify-content:space-between;">' +
              '<div style="font-size:0.8125rem;color:var(--lex-text-primary);">' + itemLabel + '</div>' +
              (matterId ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.3;flex-shrink:0;"><path d="M9 18l6-6-6-6"/></svg>' : '') +
            '</div>' +
            (itemMeta ? '<div style="font-size:0.6875rem;color:var(--lex-text-tertiary);margin-top:2px;">' + escHtml(itemMeta) + '</div>' : '') +
          '</div>'
        );
      }

      bodyParts.push('</div>');
    }

    // Fallback: when items are empty but matter_ids exist, show clickable matter links
    if (!(sa && sa.items && sa.items.length > 0) && sa && sa.matter_ids && sa.matter_ids.length > 0) {
      var docCount = sa.total_count || sa.matter_ids.length;
      bodyParts.push('<div style="margin-bottom:16px;">');
      bodyParts.push(
        '<div style="font-size:0.6875rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--lex-text-tertiary);font-weight:500;margin-bottom:8px;">Affected Matters (' + docCount + ' document' + (docCount !== 1 ? 's' : '') + ')</div>'
      );

      for (var mi = 0; mi < sa.matter_ids.length; mi++) {
        var mId = sa.matter_ids[mi];
        if (!firstMatterId) firstMatterId = mId;

        bodyParts.push(
          '<div class="lex-detail-matter-row" style="padding:10px 0;border-bottom:1px solid var(--lex-border-subtle, rgba(0,0,0,0.06));cursor:pointer;transition:background 0.15s ease;" data-matter-id="' + escHtml(mId) + '">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;">' +
              '<div style="display:flex;align-items:center;gap:8px;">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--lex-text-tertiary);flex-shrink:0;"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>' +
                '<span style="font-size:0.8125rem;color:var(--lex-text-primary);">' + escHtml(mId) + '</span>' +
              '</div>' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.3;flex-shrink:0;"><path d="M9 18l6-6-6-6"/></svg>' +
            '</div>' +
          '</div>'
        );
      }

      bodyParts.push('</div>');
    }

    // Suggested action
    if (sa) {
      var actionLabel = '';
      if (sa.type === 'lana') {
        actionLabel = 'Lana can handle this automatically';
      } else if (sa.action) {
        actionLabel = sa.action.split('_').join(' ');
        actionLabel = 'Suggested: ' + actionLabel.charAt(0).toUpperCase() + actionLabel.slice(1);
      }
      if (actionLabel) {
        bodyParts.push(
          '<div style="font-size:0.75rem;color:var(--lex-text-secondary);padding:10px 12px;background:var(--lex-bg-secondary, rgba(0,0,0,0.02));border-radius:6px;">' +
            escHtml(actionLabel) +
          '</div>'
        );
      }
    }

    // Timestamp
    if (item.created_at) {
      bodyParts.push(
        '<div style="font-size:0.6875rem;color:var(--lex-text-tertiary);margin-top:12px;">' +
          'Created ' + escHtml(timeAgo(item.created_at)) +
        '</div>'
      );
    }

    // "Discuss with Lana" button
    if (firstMatterId) {
      var chatMatterId = firstMatterId;
      bodyParts.push(
        '<div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--lex-border-subtle, rgba(0,0,0,0.06));">' +
          '<button class="lex-detail-discuss-btn" data-chat-matter-id="' + escHtml(chatMatterId) + '" style="' +
            'display:flex;align-items:center;justify-content:center;gap:6px;width:100%;' +
            'padding:10px 16px;border:1px solid var(--lex-border-subtle, rgba(0,0,0,0.12));' +
            'border-radius:var(--lex-radius-md, 6px);background:var(--lex-bg-primary);' +
            'color:var(--lex-text-primary);font-size:0.8125rem;font-weight:500;font-family:inherit;' +
            'cursor:pointer;transition:background 0.15s ease;' +
          '">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>' +
            'Discuss with Lana' +
          '</button>' +
        '</div>'
      );
    }

    var drawer = Lex.Drawer.open({
      heading: item.title || 'Action Detail',
      content: bodyParts.join(''),
      width: 'md',
      side: 'right',
      closeOnOverlay: true
    });

    // Wire matter row clicks → navigate to workspace detail
    // Use rAF to ensure the drawer's custom element lifecycle has rendered content
    if (drawer) {
      requestAnimationFrame(function () {
        var matterRows = drawer.querySelectorAll('.lex-detail-matter-row[data-matter-id]');
        for (var m = 0; m < matterRows.length; m++) {
          matterRows[m].addEventListener('click', function () {
            var mid = this.getAttribute('data-matter-id');
            if (mid) Lex.Nav.go('workspace-details.html', { params: { id: mid } });
          });
          matterRows[m].addEventListener('mouseenter', function () {
            this.style.background = 'var(--lex-bg-secondary, rgba(0,0,0,0.02))';
          });
          matterRows[m].addEventListener('mouseleave', function () {
            this.style.background = '';
          });
        }

        // Wire "Discuss with Lana" button
        var discussBtn = drawer.querySelector('.lex-detail-discuss-btn');
        if (discussBtn) {
          discussBtn.addEventListener('mouseenter', function () {
            this.style.background = 'var(--lex-bg-secondary, rgba(0,0,0,0.02))';
          });
          discussBtn.addEventListener('mouseleave', function () {
            this.style.background = 'var(--lex-bg-primary)';
          });
          discussBtn.addEventListener('click', function () {
            var mid = this.getAttribute('data-chat-matter-id');
            var prompt = (item.title || 'Action item') + ': ' + ((details && details.message) || '');
            if (sa && sa.action) {
              var actionText = sa.action.split('_').join(' ');
              prompt += ' Suggested action: ' + actionText + '.';
            }
            try { sessionStorage.setItem('lana_chat_prompt', prompt); } catch (e) { /* ignore */ }
            Lex.Nav.go('chat-v2.html', { params: { matter: mid } });
          });
        }
      });
    }
  }

  /**
   * Render the top-5 action queue items, sorted by severity.
   * Distinguishes between human actions and Lana-suggested actions.
   * - Human actions: click navigates to the matter page
   * - Lana actions: click queues an agentic task, marks acted-on, shows toast
   * @returns {Promise<void>}
   */
  async function renderZoneC(silent) {
    var loadingEl = el('ccZoneCLoading');
    var contentEl = el('ccZoneCContent');
    var zoneEl = el('ccZoneC');

    if (!actionQueueEnabled()) {
      if (zoneEl) zoneEl.style.display = 'none';
      if (loadingEl) hide(loadingEl);
      if (contentEl) hide(contentEl);
      return;
    }

    if (zoneEl) zoneEl.style.display = '';
    if (!contentEl) return;

    var items = [];

    try {
      var result = await api.get('/api/v1/action-queue?limit=5&sort_by=created_at&sort_order=desc');
      items = (result && (result.items || result.actions || result.data)) || [];
    } catch (err) {
      console.warn('[Dashboard Zone C] Could not load action queue:', err && err.message);
    }

    if (!silent && loadingEl) hide(loadingEl);

    if (items.length === 0) {
      contentEl.innerHTML =
        '<lex-empty icon="inbox" message="No actions pending" description="Your action queue is empty"></lex-empty>';
      show(contentEl);
      return;
    }

    // Cache items for detail modal lookup
    _actionItemsMap = {};
    for (var j = 0; j < items.length; j++) {
      _actionItemsMap[String(items[j].id)] = items[j];
    }

    var html = '';
    for (var i = 0; i < items.length; i++) {
      var item     = items[i];
      var sev      = item.severity || item.priority || 'low';
      var title    = escHtml(item.title || item.name || item.description || 'Untitled');
      var ts       = item.due_date || item.created_at || null;
      var priority = (sev === 'critical' || sev === 'high') ? 'high' : (sev === 'medium' ? 'medium' : 'low');
      // Map severity → task priority for Lana assignment (urgent, high, medium, low)
      var taskPriority = (sev === 'critical') ? 'urgent' : (sev === 'high' ? 'high' : (sev === 'medium' ? 'medium' : 'low'));

      var lana = isLanaAction(item);
      var actionAttr = '';
      var sa = getSuggestedAction(item);

      // Resolve matter name: prefer item-level, fall back to context items
      var matter = escHtml(item.matter_name || item.matter || '');
      if (!matter && sa && sa.items && sa.items.length > 0) {
        var _names = [];
        for (var mn = 0; mn < sa.items.length; mn++) {
          if (sa.items[mn].matter_name && _names.indexOf(sa.items[mn].matter_name) === -1) {
            _names.push(sa.items[mn].matter_name);
          }
        }
        if (_names.length === 1) {
          matter = escHtml(_names[0]);
        } else if (_names.length > 1) {
          matter = escHtml(_names.length + ' matters');
        }
      }

      if (lana) {
        // Encode the action config as a data attribute for the click handler
        actionAttr = ' data-lana-action="' + escHtml(JSON.stringify(sa)) + '"';
        // Append "Let Lana handle this" to the description
        var metaParts = [];
        if (matter) metaParts.push(matter);
        metaParts.push('Let Lana handle this');
        if (ts) metaParts.push(escHtml(timeAgo(ts)));
        var metaStr = metaParts.join(' \u00b7 ');

        html +=
          '<lex-action-card' +
            ' title="' + title + '"' +
            ' description="' + escHtml(metaStr) + '"' +
            ' priority="' + priority + '"' +
            ' feedback' +
            ' data-action-id="' + escHtml(String(item.id || '')) + '"' +
            ' data-entity-id="' + escHtml(String(item.entity_id || item.id || '')) + '"' +
            ' data-action-type="' + escHtml(String(item.action_type || '')) + '"' +
            ' data-priority="' + escHtml(taskPriority) + '"' +
            actionAttr +
          '></lex-action-card>';
      } else {
        // Try enriched description from entity-level items
        var enrichedDesc = buildEnrichedDescription(sa, matter, ts);
        var metaStr2;
        if (enrichedDesc) {
          metaStr2 = enrichedDesc;
        } else {
          var meta = [];
          if (matter) meta.push(matter);
          if (ts) meta.push(escHtml(timeAgo(ts)));
          metaStr2 = meta.join(' \u00b7 ');
        }

        // For human actions, store the matter_id for navigation
        var humanMatterId = getActionMatterId(sa) || item.matter_id || '';

        html +=
          '<lex-action-card' +
            ' title="' + title + '"' +
            ' description="' + escHtml(metaStr2) + '"' +
            ' priority="' + priority + '"' +
            ' feedback' +
            ' data-action-id="' + escHtml(String(item.id || '')) + '"' +
            ' data-entity-id="' + escHtml(String(item.entity_id || item.id || '')) + '"' +
            ' data-action-type="' + escHtml(String(item.action_type || '')) + '"' +
            ' data-priority="' + escHtml(taskPriority) + '"' +
            (humanMatterId ? ' data-matter-id="' + escHtml(String(humanMatterId)) + '"' : '') +
          '></lex-action-card>';
      }
    }
    contentEl.innerHTML = html;
    show(contentEl);
  }

  // =========================================================================
  // Zone D — My Tasks
  // =========================================================================

  function dashboardTaskPriorityColor(priority) {
    if (priority === 'urgent' || priority === 'critical') return 'red';
    if (priority === 'high') return 'red';
    if (priority === 'medium' || priority === 'normal') return 'yellow';
    return 'gray';
  }

  function dashboardTaskPriorityLabel(priority) {
    var value = String(priority || 'normal').toLowerCase();
    if (value === 'urgent') return 'Urgent';
    if (value === 'critical') return 'Critical';
    if (value === 'high') return 'High';
    if (value === 'medium') return 'Medium';
    if (value === 'low') return 'Low';
    return 'Normal';
  }

  function dashboardTaskScope(task) {
    return task && task.matter_id ? 'Workspace' : 'Org';
  }

  function dashboardTaskMatterName(task) {
    if (!task) return '';
    return (
      task.matter_name ||
      task.matterName ||
      task.client_matter_name ||
      task.workspace_name ||
      task.workspaceName ||
      (task.matter && (task.matter.matter_name || task.matter.name)) ||
      (task.workspace && task.workspace.name) ||
      splitDashboardTaskTitle(task.title || task.name || task.task_title || '').matterName ||
      ''
    );
  }

  function splitDashboardTaskTitle(title) {
    var value = String(title || '').trim();
    var separators = [' — ', ' – ', ' - '];
    for (var i = 0; i < separators.length; i += 1) {
      var separator = separators[i];
      var index = value.lastIndexOf(separator);
      if (index > 0 && index < value.length - separator.length) {
        return {
          taskTitle: value.slice(0, index).trim(),
          matterName: value.slice(index + separator.length).trim()
        };
      }
    }
    return { taskTitle: value, matterName: '' };
  }

  function renderDashboardTaskMatterKv(task, matterName) {
    if (!matterName) return '';
    var matterId = task && task.matter_id ? String(task.matter_id) : '';
    if (!matterId) {
      return [
        '<div class="cc-task-detail__row">',
        '  <dt>Workspace</dt>',
        '  <dd>' + escHtml(matterName) + '</dd>',
        '</div>'
      ].join('');
    }
    return [
      '<div class="cc-task-detail__row">',
      '  <dt>Workspace</dt>',
      '  <dd>',
      '    <button type="button" class="cc-task-matter-link" data-task-matter-link="' + escHtml(matterId) + '">',
      escHtml(matterName),
      '    </button>',
      '  </dd>',
      '</div>'
    ].join('');
  }

  function dashboardTaskPlanLabel(task) {
    if (!task) return '';
    return task.task_plan_title || (task.task_plan_id ? 'Task group' : '');
  }

  function dashboardTaskMetadata(task) {
    if (!task || !task.metadata) return {};
    if (typeof task.metadata === 'object') return task.metadata;
    try {
      return JSON.parse(task.metadata);
    } catch (err) {
      return {};
    }
  }

  function dashboardTaskChecklistItems(task) {
    var metadata = dashboardTaskMetadata(task);
    return Array.isArray(metadata.checklist_items) ? metadata.checklist_items : [];
  }

  function isTaskDueToday(task) {
    if (!task || !task.due_date) return false;
    var due = new Date(task.due_date);
    var today = new Date();
    return due.getFullYear() === today.getFullYear() &&
      due.getMonth() === today.getMonth() &&
      due.getDate() === today.getDate();
  }

  function taskDaysPastDue(task) {
    if (!task || !task.due_date) return 0;
    var due = new Date(task.due_date);
    if (isNaN(due.getTime())) return 0;
    var today = new Date();
    var dueStart = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
    var todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    return Math.floor((todayStart - dueStart) / 86400000);
  }

  function isTaskSeverelyDelinquent(task) {
    return taskDaysPastDue(task) >= 7;
  }

  // ---- Task status / date helpers (used by row + drawer) ------------------

  var TASK_STATUSES = ['pending', 'in_progress', 'in_review', 'complete', 'cancelled'];

  function taskStatusLabel(status) {
    if (status === 'pending') return 'Pending';
    if (status === 'in_progress') return 'In Progress';
    if (status === 'in_review') return 'In Review';
    if (status === 'complete' || status === 'completed') return 'Complete';
    if (status === 'cancelled') return 'Cancelled';
    return (status || 'Unknown').toString();
  }

  function taskStatusColor(status) {
    if (status === 'complete' || status === 'completed') return 'green';
    if (status === 'in_review') return 'yellow';
    if (status === 'in_progress') return 'blue';
    if (status === 'cancelled') return 'red';
    return 'gray';
  }

  function formatDashboardTaskDate(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function getTaskId(task) {
    return (task && (task.id || task.task_id)) || '';
  }

  function renderTaskStatusPill(task, opts) {
    opts = opts || {};
    var size = opts.size || 'sm';
    var status = task.status || 'pending';
    var label = taskStatusLabel(status);
    var color = taskStatusColor(status);
    var taskId = getTaskId(task);

    return [
      '<button type="button"',
      '  class="cc-task-status-pill"',
      '  data-task-status-pill="1"',
      '  data-task-id="' + escHtml(taskId) + '"',
      '  data-current-status="' + escHtml(status) + '"',
      '  aria-haspopup="listbox"',
      '  aria-expanded="false"',
      '  title="Change status"',
      '  style="display:inline-flex;align-items:center;gap:4px;border:none;background:transparent;padding:0;cursor:pointer;font:inherit;color:inherit;">',
      '  <lex-badge label="' + escHtml(label) + '" color="' + color + '"' + (size === 'lg' ? '' : '') + '></lex-badge>',
      '  <span aria-hidden="true" style="font-size:0.65em;line-height:1;color:var(--lex-color-text-muted,#6b7280);">▾</span>',
      '</button>'
    ].join('');
  }

  function renderTaskStatusSelect(task) {
    var current = task.status || 'pending';
    var options = TASK_STATUSES.map(function (status) {
      return '<option value="' + escHtml(status) + '"' + (status === current ? ' selected' : '') + '>' + escHtml(taskStatusLabel(status)) + '</option>';
    }).join('');
    return [
      '<span class="cc-task-status-control">',
      '  <select class="cc-task-status-select" data-task-status-select aria-label="Update status">',
      options,
      '  </select>',
      '</span>'
    ].join('');
  }

  function renderDashboardTaskRow(task) {
    var taskId = getTaskId(task);
    var title = task.title || 'Untitled task';
    var workspaceName = task && task.matter_id ? dashboardTaskMatterName(task) : '';
    var createdLabel = formatDashboardTaskDate(task.created_at);
    var dueLabel = formatDashboardTaskDate(task.due_date);
    var metaParts = [];
    if (workspaceName) metaParts.push(workspaceName);
    if (createdLabel) metaParts.push('Created ' + createdLabel);
    if (dueLabel) metaParts.push('Due ' + dueLabel);
    var meta = metaParts.filter(Boolean).join(' · ');

    return [
      '<div class="cc-task-row" data-task-row="1" data-task-id="' + escHtml(taskId) + '">',
      '  <button type="button"',
      '    class="cc-task-row__main"',
      '    data-task-open="1"',
      '    data-task-id="' + escHtml(taskId) + '"',
      '    style="flex:1;min-width:0;text-align:left;border:none;background:transparent;padding:0;cursor:pointer;font:inherit;color:inherit;">',
      '    <div class="cc-task-row__title">' + escHtml(title) + '</div>',
      meta ? '    <div class="cc-task-row__meta">' + escHtml(meta) + '</div>' : '',
      '  </button>',
      '  <div style="display:flex;align-items:center;gap:0.375rem;flex-shrink:0;">',
      '    ' + renderTaskStatusPill(task),
      '  </div>',
      '</div>'
    ].join('');
  }

  function renderDashboardTaskGroupRow(group) {
    var count = group.count || 0;
    return [
      '<div class="cc-task-row" data-nav="my-tasks">',
      '  <div style="min-width:0;flex:1;">',
      '    <div class="cc-task-row__title">' + escHtml(group.title || 'Task group') + '</div>',
      '    <div class="cc-task-row__meta">' + escHtml(count + ' task' + (count === 1 ? '' : 's') + ' in this plan') + '</div>',
      '  </div>',
      '  <div style="display:flex;align-items:center;gap:0.375rem;flex-shrink:0;">',
      '    <lex-badge label="' + escHtml(count + ' task' + (count === 1 ? '' : 's')) + '" color="gray"></lex-badge>',
      group.priority ? '    <lex-badge label="' + escHtml(group.priority) + '" color="' + escHtml(dashboardTaskPriorityColor(group.priority)) + '"></lex-badge>' : '',
      '  </div>',
      '</div>'
    ].join('');
  }

  async function renderZoneD() {
    var loadingEl = el('ccZoneDLoading');
    var contentEl = el('ccZoneDContent');
    if (!contentEl) return;

    var tasks = [];

    try {
      var result = await api.getMyTasks({
        limit: 50,
        offset: 0,
        statuses: 'pending,in_progress,in_review',
        sort_by: 'updated_at',
        sort_dir: 'DESC'
      });
      tasks = (result && result.data && result.data.tasks) || (result && result.tasks) || [];
    } catch (err) {
      console.warn('[Dashboard Zone D] Could not load my tasks:', err && err.message);
    }

    if (loadingEl) hide(loadingEl);

    if (tasks.length === 0) {
      contentEl.innerHTML =
        '<lex-empty icon="tasks" message="No outstanding tasks" description="Assigned tasks will appear here."></lex-empty>';
      show(contentEl);
      return;
    }

    var severelyDelinquentTasks = tasks.filter(isTaskSeverelyDelinquent).slice(0, 5);
    var severeIds = {};
    for (var si = 0; si < severelyDelinquentTasks.length; si++) {
      var severeId = getTaskId(severelyDelinquentTasks[si]);
      if (severeId) severeIds[severeId] = true;
    }

    var todayTasks = tasks.filter(function (task) {
      return isTaskDueToday(task) && !severeIds[getTaskId(task)];
    }).slice(0, 4);
    var grouped = {};
    var ungrouped = [];

    for (var i = 0; i < tasks.length; i++) {
      var task = tasks[i];
      if (severeIds[getTaskId(task)]) {
        continue;
      }
      if (task.task_plan_id) {
        if (!grouped[task.task_plan_id]) {
          grouped[task.task_plan_id] = {
            title: dashboardTaskPlanLabel(task),
            count: 0,
            priority: task.priority || 'normal'
          };
        }
        grouped[task.task_plan_id].count++;
      } else {
        ungrouped.push(task);
      }
    }

    var groupRows = Object.keys(grouped).slice(0, 4).map(function (id) {
      return renderDashboardTaskGroupRow(grouped[id]);
    }).join('');

    var outstandingRows = groupRows;
    var remainingSlots = Math.max(0, 5 - Object.keys(grouped).slice(0, 4).length);
    var outstandingTasks = ungrouped.slice(0, remainingSlots);
    outstandingRows += outstandingTasks.map(renderDashboardTaskRow).join('');

    var todayRows = todayTasks.map(renderDashboardTaskRow).join('');
    var severeRows = severelyDelinquentTasks.map(renderDashboardTaskRow).join('');

    contentEl.innerHTML = [
      '<div class="cc-task-section">',
      '  <div class="cc-task-section__heading">Today</div>',
      todayRows || '  <div class="cc-task-empty">No tasks due today</div>',
      '</div>',
      '<div class="cc-task-columns">',
      '  <div class="cc-task-section">',
      '    <div class="cc-task-section__heading">Outstanding</div>',
      outstandingRows || '    <div class="cc-task-empty">No outstanding task groups</div>',
      '  </div>',
      '  <div class="cc-task-section cc-task-section--delinquent">',
      '    <div class="cc-task-section__heading">Severely Delinquent</div>',
      severeRows || '    <div class="cc-task-empty">No severely delinquent tasks</div>',
      '  </div>',
      '</div>'
    ].join('');
    show(contentEl);

    // Build a quick lookup so click handlers can pass the full task object to
    // the drawer without re-fetching.
    var taskLookup = {};
    var allRowTasks = todayTasks.concat(outstandingTasks).concat(severelyDelinquentTasks);
    for (var t = 0; t < allRowTasks.length; t++) {
      var tid = getTaskId(allRowTasks[t]);
      if (tid) taskLookup[tid] = allRowTasks[t];
    }

    attachZoneDTaskHandlers(contentEl, taskLookup);
  }

  // ---- Zone D event wiring (status menu + detail drawer + actions) -------

  // One-time state used to dismiss the floating status menu when the user
  // clicks elsewhere. We attach the listener lazily.
  var _zoneDStatusMenuListenerAttached = false;
  function ensureZoneDStatusMenuDismissListener() {
    if (_zoneDStatusMenuListenerAttached) return;
    _zoneDStatusMenuListenerAttached = true;
    document.addEventListener('click', function (event) {
      var menu = document.getElementById('ccTaskStatusMenu');
      if (!menu) return;
      if (menu.contains(event.target)) return;
      // Don't close immediately if the click is on a status pill — that path
      // toggles the menu via its own handler.
      if (event.target.closest && event.target.closest('[data-task-status-pill]')) return;
      menu.remove();
    }, true);
  }

  function attachZoneDTaskHandlers(contentEl, taskLookup) {
    ensureZoneDStatusMenuDismissListener();

    // Group rows still navigate to the my-tasks page (no per-task drawer for
    // a roll-up entry).
    var groupRows = contentEl.querySelectorAll('[data-nav="my-tasks"]');
    for (var i = 0; i < groupRows.length; i++) {
      groupRows[i].addEventListener('click', function () {
        Lex.Nav.go('my-tasks.html');
      });
    }

    // Per-task open: clicking the title area opens the detail drawer.
    var openButtons = contentEl.querySelectorAll('[data-task-open="1"]');
    for (var j = 0; j < openButtons.length; j++) {
      openButtons[j].addEventListener('click', function (event) {
        event.stopPropagation();
        var taskId = this.getAttribute('data-task-id');
        var task = taskLookup[taskId];
        if (task) openTaskDetailDrawer(task);
      });
    }

    // Status pill: clicking opens a small floating menu of valid statuses.
    var pills = contentEl.querySelectorAll('[data-task-status-pill]');
    for (var k = 0; k < pills.length; k++) {
      pills[k].addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        var taskId = this.getAttribute('data-task-id');
        var current = this.getAttribute('data-current-status') || 'pending';
        showTaskStatusMenu(this, taskId, current);
      });
    }
  }

  function showTaskStatusMenu(anchorEl, taskId, currentStatus) {
    // Toggle if already open against the same anchor.
    var existing = document.getElementById('ccTaskStatusMenu');
    if (existing) {
      existing.remove();
      if (existing.getAttribute('data-anchor-id') === taskId) return;
    }

    var menu = document.createElement('div');
    menu.id = 'ccTaskStatusMenu';
    menu.setAttribute('data-anchor-id', taskId || '');
    menu.setAttribute('role', 'listbox');
    menu.style.cssText = [
      'position:absolute',
      'z-index:1000',
      'min-width:160px',
      'background:var(--lex-color-bg-elevated,#fff)',
      'border:1px solid var(--lex-color-border,#e5e7eb)',
      'border-radius:8px',
      'box-shadow:0 8px 24px rgba(15,23,42,0.12)',
      'padding:4px',
      'display:flex',
      'flex-direction:column'
    ].join(';');

    var rect = anchorEl.getBoundingClientRect();
    menu.style.top = (window.scrollY + rect.bottom + 4) + 'px';
    menu.style.left = (window.scrollX + Math.max(0, rect.right - 160)) + 'px';

    TASK_STATUSES.forEach(function (status) {
      var item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'option');
      item.style.cssText = [
        'display:flex',
        'align-items:center',
        'gap:8px',
        'padding:6px 10px',
        'background:transparent',
        'border:none',
        'border-radius:6px',
        'cursor:pointer',
        'font:inherit',
        'color:inherit',
        'text-align:left',
        'width:100%'
      ].join(';');
      item.innerHTML =
        '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + statusDotColor(status) + ';"></span>' +
        '<span>' + escHtml(taskStatusLabel(status)) + '</span>' +
        (status === currentStatus ? '<span aria-hidden="true" style="margin-left:auto;color:var(--lex-color-primary-600,#2563eb);">✓</span>' : '');
      item.addEventListener('mouseenter', function () { item.style.background = 'rgba(0,0,0,0.04)'; });
      item.addEventListener('mouseleave', function () { item.style.background = 'transparent'; });
      item.addEventListener('click', function (event) {
        event.stopPropagation();
        menu.remove();
        if (status !== currentStatus) {
          updateTaskStatusFromZoneD(taskId, status);
        }
      });
      menu.appendChild(item);
    });

    document.body.appendChild(menu);
  }

  function statusDotColor(status) {
    var color = taskStatusColor(status);
    if (color === 'green')  return '#10b981';
    if (color === 'yellow') return '#f59e0b';
    if (color === 'blue')   return '#3b82f6';
    if (color === 'red')    return '#ef4444';
    return '#9ca3af';
  }

  async function updateTaskStatusFromZoneD(taskId, newStatus) {
    if (!taskId || !newStatus) return;
    try {
      await api.updateTask(taskId, { status: newStatus });
      // Easiest correctness: re-render Zone D so the row, drawer (if open),
      // and the today/outstanding split all reflect the new state.
      var openDrawer = document.querySelector('[data-task-detail-drawer]');
      if (openDrawer) openDrawer.remove();
      await renderZoneD();
    } catch (err) {
      console.error('[Dashboard Zone D] Failed to update task status:', err);
      if (window.Lex && Lex.Toast && Lex.Toast.error) {
        Lex.Toast.error('Could not update task status: ' + (err && err.message || 'unknown error'));
      }
    }
  }

  // ---- Task detail drawer -------------------------------------------------

  // Build a human label for a user object.
  // Fallback chain (most specific → least):
  //   1. "First Last"  — if both first_name and last_name are present
  //   2. "First"       — if only first_name is present
  //   3. email         — if neither name field is present
  //   4. raw id        — absolute last resort
  function userPickerLabel(u) {
    if (!u) return '';
    var first = (u.first_name || u.firstName || '').trim();
    var last  = (u.last_name  || u.lastName  || '').trim();
    if (first && last) return first + ' ' + last;
    if (first) return first;
    if (u.email) return u.email;
    return String(u.id || '');
  }

  // Org users cached for the assignee picker; populated lazily on first
  // edit-mode entry so we don't fetch the directory on every dashboard load.
  var _orgUsersCache = null;
  async function loadOrgUsersForPicker() {
    if (_orgUsersCache) return _orgUsersCache;
    try {
      var result = await api.getUsers(1, 200);
      var users = (result && result.data && result.data.users)
        || (result && result.users)
        || [];
      _orgUsersCache = users.map(function (u) {
        return { value: u.id, label: userPickerLabel(u) };
      });
    } catch (err) {
      console.warn('[Dashboard Zone D] Could not load users for assignee picker:', err);
      _orgUsersCache = [];
    }
    return _orgUsersCache;
  }

  function priorityOptions() {
    return [
      { value: '',       label: 'No priority' },
      { value: 'low',    label: 'Low' },
      { value: 'normal', label: 'Normal' },
      { value: 'medium', label: 'Medium' },
      { value: 'high',   label: 'High' }
    ];
  }

  function dueDateInputValue(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    // YYYY-MM-DD for <input type="date">
    var yyyy = d.getFullYear();
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
  }

  function renderTaskViewBody(task) {
    var description = task.description || task.notes || '';
    var matterName = dashboardTaskMatterName(task);
    var createdLabel = task.created_at ? formatDateTime(task.created_at) : '';
    var updatedLabel = task.updated_at ? formatDateTime(task.updated_at) : '';
    var dueLabel = task.due_date ? formatDashboardTaskDate(task.due_date) : '';
    var priority = task.priority || '';
    var scopeLabel = dashboardTaskScope(task);
    var createdBy = task.created_by_name || task.created_by_email || '';
    var planLabel = dashboardTaskPlanLabel(task);
    var checklist = dashboardTaskChecklistItems(task);

    return [
      '<div class="cc-task-detail" data-task-body="view">',
      '  <div class="cc-task-detail__badges">',
      '    <lex-badge label="' + escHtml(scopeLabel) + '" color="' + (task.matter_id ? 'blue' : 'green') + '"></lex-badge>',
      '    <lex-badge label="' + escHtml(taskStatusLabel(task.status || 'pending')) + '" color="' + escHtml(taskStatusColor(task.status || 'pending')) + '"></lex-badge>',
      priority ? '    <lex-badge label="' + escHtml(dashboardTaskPriorityLabel(priority)) + '" color="' + escHtml(dashboardTaskPriorityColor(priority)) + '"></lex-badge>' : '',
      '  </div>',
      '  <dl class="cc-task-detail__meta">',
      '    <div class="cc-task-detail__row"><dt>Status</dt><dd>' + renderTaskStatusSelect(task) + '</dd></div>',
      priority ? '    <div class="cc-task-detail__row"><dt>Priority</dt><dd>' + escHtml(dashboardTaskPriorityLabel(priority)) + '</dd></div>' : '',
      matterName ? renderDashboardTaskMatterKv(task, matterName) : '    <div class="cc-task-detail__row"><dt>Level</dt><dd>Organization-level</dd></div>',
      createdBy ? '    <div class="cc-task-detail__row"><dt>Created By</dt><dd>' + escHtml(createdBy) + '</dd></div>' : '',
      createdLabel ? '    <div class="cc-task-detail__row"><dt>Created</dt><dd>' + escHtml(createdLabel) + '</dd></div>' : '',
      updatedLabel ? '    <div class="cc-task-detail__row"><dt>Updated</dt><dd>' + escHtml(updatedLabel) + '</dd></div>' : '',
      dueLabel ? '    <div class="cc-task-detail__row"><dt>Due</dt><dd>' + escHtml(dueLabel) + '</dd></div>' : '',
      planLabel ? '    <div class="cc-task-detail__row"><dt>Task Group</dt><dd>' + escHtml(planLabel) + '</dd></div>' : '',
      '  </dl>',
      description ? '  <section class="cc-task-detail__section"><h3>Description</h3><p>' + escHtml(description) + '</p></section>' : '',
      '  <section class="cc-task-detail__section">',
      '    <h3>Checklist</h3>',
      checklist.length ? '    <ul class="cc-task-detail__checklist">' + checklist.map(function (item) {
        var label = typeof item === 'string' ? item : (item.title || item.label || item.description || 'Checklist item');
        return '<li>' + escHtml(label) + '</li>';
      }).join('') + '</ul>' : '    <p class="cc-task-detail__muted">No checklist items attached.</p>',
      '  </section>',
      '</div>'
    ].join('');
  }

  function renderTaskEditBody(task, users) {
    var taskId = getTaskId(task);
    var title = task.title || '';
    var description = task.description || task.notes || '';
    var dueValue = dueDateInputValue(task.due_date);
    var priority = task.priority || '';
    var assigneeId = task.assigned_to_user_id
      || task.assigned_to_id
      || task.assigneeId
      || '';
    var matterName = dashboardTaskMatterName(task);
    var createdLabel = formatDashboardTaskDate(task.created_at) || '—';
    var scopeLabel = dashboardTaskScope(task);

    // Make sure the currently-assigned user always has a labeled option, even
    // if they aren't in the loaded users list (e.g. an inactive user, or a
    // system user the admin endpoint doesn't return). Without this fallback,
    // lex-select would render the raw UUID since it can't find a match.
    var optionUsers = (users || []).slice();
    if (assigneeId && !optionUsers.some(function (u) { return u.value === assigneeId; })) {
      optionUsers.unshift({
        value: assigneeId,
        label: task.assigned_to_name
          || task.assignee_name
          || task.assigned_to_email
          || assigneeId
      });
    }
    var assigneeOptions = [{ value: '', label: 'Unassigned' }].concat(optionUsers);

    return [
      '<lex-stack direction="vertical" gap="4" style="padding:16px;" data-task-body="edit">',
      '  <lex-input label="Title" data-task-field="title" value="' + escHtml(title) + '"></lex-input>',
      '  <lex-textarea label="Description" rows="4" data-task-field="description" value="' + escHtml(description) + '"></lex-textarea>',
      '  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">',
      '    <lex-input label="Due date" type="date" data-task-field="due_date" value="' + escHtml(dueValue) + '"></lex-input>',
      "    <lex-select label='Priority' data-task-field='priority' value='" + escAttr(priority) + "' options='" + escAttr(JSON.stringify(priorityOptions())) + "'></lex-select>",
      '  </div>',
      "  <lex-select label='Assignee' data-task-field='assigned_to_user_id' value='" + escAttr(assigneeId) + "' options='" + escAttr(JSON.stringify(assigneeOptions)) + "'></lex-select>",
      '  <lex-divider></lex-divider>',
      '  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">',
      '    <lex-kv label="Scope" value="' + escHtml(scopeLabel) + '"></lex-kv>',
      matterName ? '    <lex-kv label="Workspace" value="' + escHtml(matterName) + '"></lex-kv>' : '',
      '    <lex-kv label="Created" value="' + escHtml(createdLabel) + '"></lex-kv>',
      '  </div>',
      '  <lex-divider></lex-divider>',
      '  <div style="display:flex;gap:8px;flex-wrap:wrap;">',
      '    <lex-btn variant="primary" size="sm" data-task-action="save" data-task-id="' + escHtml(taskId) + '">Save changes</lex-btn>',
      '    <lex-btn variant="secondary" size="sm" data-task-action="cancel-edit" data-task-id="' + escHtml(taskId) + '">Revert changes</lex-btn>',
      '  </div>',
      '</lex-stack>'
    ].join('');
  }

  // Lightweight attribute-safe escape for embedding JSON in HTML attributes.
  function escAttr(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/'/g, '&#39;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function openTaskDetailDrawer(task) {
    // Replace any existing drawer so reopening doesn't stack them.
    var existing = document.querySelector('[data-task-detail-drawer]');
    if (existing) existing.remove();

    var taskId = getTaskId(task);
    var title = task.title || 'Untitled task';

    var drawer = document.createElement('div');
    drawer.innerHTML = [
      '<lex-drawer heading="' + escHtml(title) + '" side="right" width="md" open data-task-detail-drawer="1" data-task-id="' + escHtml(taskId) + '">',
      renderTaskViewBody(task),
      '</lex-drawer>'
    ].join('');

    var drawerEl = drawer.firstElementChild;
    drawerEl._task = task; // attach for handlers
    document.body.appendChild(drawerEl);
    renderDashboardTaskHeaderActions(drawerEl, task);
    wireTaskDrawerHandlers(drawerEl);
  }

  function renderDashboardTaskHeaderActions(drawerEl, task) {
    var headerActions = drawerEl.querySelector('.lex-drawer-header-actions');
    if (!headerActions) return;

    var isComplete = (task.status === 'complete' || task.status === 'completed');
    var completeLabel = isComplete ? 'Reopen' : 'Mark Complete';
    var completeAction = isComplete ? 'reopen' : 'complete';
    var chevron = '<svg class="cc-task-actions-btn__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

    headerActions.innerHTML = [
      '<div class="cc-task-header-actions" data-task-actions-wrap>',
      '  <button type="button" class="cc-task-actions-btn" data-task-actions-toggle aria-haspopup="true" aria-expanded="false">',
      '    <span>Actions</span>' + chevron,
      '  </button>',
      '  <div class="cc-task-actions-menu hidden" role="menu">',
      '    <button type="button" role="menuitem" data-task-action="edit">Edit</button>',
      '    <button type="button" role="menuitem" data-task-action="' + completeAction + '">' + completeLabel + '</button>',
      '    <button type="button" role="menuitem" class="cc-task-actions-menu__danger" data-task-action="delete">Delete</button>',
      '  </div>',
      '</div>'
    ].join('');
  }

  function closeDashboardTaskActionsMenu(drawerEl) {
    if (!drawerEl) return;
    var menu = drawerEl.querySelector('.cc-task-actions-menu');
    var toggle = drawerEl.querySelector('[data-task-actions-toggle]');
    if (menu) menu.classList.add('hidden');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  function wireTaskDrawerHandlers(drawerEl) {
    var task = drawerEl._task || {};
    var taskId = getTaskId(task);

    var actionsToggle = drawerEl.querySelector('[data-task-actions-toggle]');
    if (actionsToggle) {
      actionsToggle.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        var menu = drawerEl.querySelector('.cc-task-actions-menu');
        if (!menu) return;
        var isHidden = menu.classList.contains('hidden');
        menu.classList.toggle('hidden', !isHidden);
        actionsToggle.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
      });
    }

    drawerEl.addEventListener('click', function (event) {
      if (event.target.closest && event.target.closest('.cc-task-header-actions')) return;
      closeDashboardTaskActionsMenu(drawerEl);
    });

    var statusSelect = drawerEl.querySelector('[data-task-status-select]');
    if (statusSelect) {
      statusSelect.addEventListener('change', async function () {
        await updateTaskStatusFromDrawer(drawerEl, taskId, statusSelect.value);
      });
    }

    // Status pill — same in both view and edit modes.
    var pill = drawerEl.querySelector('[data-task-status-pill]');
    if (pill) {
      pill.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        var current = pill.getAttribute('data-current-status') || 'pending';
        showTaskStatusMenu(pill, taskId, current);
      });
    }

    // Mark Complete (view mode).
    var completeBtn = drawerEl.querySelector('[data-task-action="complete"]');
    if (completeBtn) {
      completeBtn.addEventListener('click', async function () {
        closeDashboardTaskActionsMenu(drawerEl);
        try {
          if (typeof api.completeTask === 'function') {
            await api.completeTask(taskId);
          } else {
            await api.updateTask(taskId, { status: 'complete' });
          }
          drawerEl.remove();
          await renderZoneD();
        } catch (err) {
          console.error('[Dashboard Zone D] Failed to complete task:', err);
          if (window.Lex && Lex.Toast && Lex.Toast.error) {
            Lex.Toast.error('Could not complete task: ' + (err && err.message || 'unknown error'));
          }
        }
      });
    }

    var reopenBtn = drawerEl.querySelector('[data-task-action="reopen"]');
    if (reopenBtn) {
      reopenBtn.addEventListener('click', async function () {
        closeDashboardTaskActionsMenu(drawerEl);
        await updateTaskStatusFromDrawer(drawerEl, taskId, 'pending');
      });
    }

    var deleteBtn = drawerEl.querySelector('[data-task-action="delete"]');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async function () {
        closeDashboardTaskActionsMenu(drawerEl);
        if (!window.confirm('Delete this task?')) return;
        try {
          await api.deleteTask(taskId);
          drawerEl.remove();
          await renderZoneD();
        } catch (err) {
          console.error('[Dashboard Zone D] Failed to delete task:', err);
          if (window.Lex && Lex.Toast && Lex.Toast.error) {
            Lex.Toast.error('Could not delete task: ' + (err && err.message || 'unknown error'));
          }
        }
      });
    }

    var matterLink = drawerEl.querySelector('[data-task-matter-link]');
    if (matterLink) {
      matterLink.addEventListener('click', function () {
        var matterId = matterLink.getAttribute('data-task-matter-link');
        if (!matterId) return;
        if (window.Lex && Lex.Nav && typeof Lex.Nav.go === 'function') {
          Lex.Nav.go('workspace-details.html', {
            params: { id: matterId, tab: 'activity' },
            context: { matterId: matterId, tab: 'activity' }
          });
        } else {
          window.location.href = 'workspace-details.html?id=' + encodeURIComponent(matterId) + '&tab=activity';
        }
      });
    }

    // Edit (view mode → edit mode). Lazy-load org users for the assignee
    // picker, then swap the drawer body and re-wire handlers.
    var editBtn = drawerEl.querySelector('[data-task-action="edit"]');
    if (editBtn) {
      editBtn.addEventListener('click', async function () {
        closeDashboardTaskActionsMenu(drawerEl);
        editBtn.setAttribute('disabled', 'true');
        var users = await loadOrgUsersForPicker();
        var bodyEl = drawerEl.querySelector('[data-task-body]');
        if (bodyEl) {
          bodyEl.outerHTML = renderTaskEditBody(drawerEl._task || task, users);
        }
        var headerActions = drawerEl.querySelector('.lex-drawer-header-actions');
        if (headerActions) headerActions.innerHTML = '';
        wireTaskDrawerHandlers(drawerEl);
      });
    }

    // Cancel (edit mode → view mode).
    var cancelBtn = drawerEl.querySelector('[data-task-action="cancel-edit"]');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        var bodyEl = drawerEl.querySelector('[data-task-body]');
        if (bodyEl) {
          bodyEl.outerHTML = renderTaskViewBody(drawerEl._task || task);
        }
        renderDashboardTaskHeaderActions(drawerEl, drawerEl._task || task);
        wireTaskDrawerHandlers(drawerEl);
      });
    }

    // Save (edit mode). Read values from the lex form components by their
    // `value` properties — set when the user types/selects.
    var saveBtn = drawerEl.querySelector('[data-task-action="save"]');
    if (saveBtn) {
      saveBtn.addEventListener('click', async function () {
        saveBtn.setAttribute('disabled', 'true');
        try {
          var fields = {};
          drawerEl.querySelectorAll('[data-task-field]').forEach(function (el) {
            var key = el.getAttribute('data-task-field');
            // .value reads through lex form components' property accessor;
            // for native fallbacks, the property is also defined.
            var raw = el.value != null ? el.value : '';
            if (key === 'due_date') {
              fields[key] = raw ? raw : null;
            } else if (key === 'priority' || key === 'assigned_to_user_id') {
              fields[key] = raw === '' ? null : raw;
            } else {
              fields[key] = raw;
            }
          });

          var updated = await api.updateTask(taskId, fields);
          // Merge the response (or our local fields) back onto the drawer's
          // task so a subsequent re-edit sees fresh values.
          var nextTask = (updated && updated.data) || updated || {};
          drawerEl._task = Object.assign({}, drawerEl._task || task, nextTask, fields);

          if (window.Lex && Lex.Toast && Lex.Toast.success) {
            Lex.Toast.success('Task updated');
          }

          drawerEl.remove();
          await renderZoneD();
        } catch (err) {
          console.error('[Dashboard Zone D] Failed to save task:', err);
          saveBtn.removeAttribute('disabled');
          if (window.Lex && Lex.Toast && Lex.Toast.error) {
            Lex.Toast.error('Could not save task: ' + (err && err.message || 'unknown error'));
          }
        }
      });
    }
  }

  async function updateTaskStatusFromDrawer(drawerEl, taskId, newStatus) {
    if (!drawerEl || !taskId || !newStatus) return;
    var task = drawerEl._task || {};
    if (newStatus === task.status) return;
    try {
      if (newStatus === 'complete' && typeof api.completeTask === 'function') {
        await api.completeTask(taskId);
      } else {
        await api.updateTask(taskId, { status: newStatus });
      }
      drawerEl._task = Object.assign({}, task, { status: newStatus });
      var bodyEl = drawerEl.querySelector('[data-task-body]');
      if (bodyEl) {
        bodyEl.outerHTML = renderTaskViewBody(drawerEl._task);
      }
      renderDashboardTaskHeaderActions(drawerEl, drawerEl._task);
      wireTaskDrawerHandlers(drawerEl);
      await renderZoneD();
    } catch (err) {
      console.error('[Dashboard Zone D] Failed to update task status:', err);
      if (window.Lex && Lex.Toast && Lex.Toast.error) {
        Lex.Toast.error('Could not update task: ' + (err && err.message || 'unknown error'));
      }
    }
  }

  // =========================================================================
  // Zone E — Pipeline Intelligence (3 stat cards)
  // =========================================================================

  /**
   * Render the three pipeline intelligence stat cards.
   * Populates: team members, documents, storage.
   * Active Matters count is shown in the Zone A banner button instead.
   * @returns {Promise<{matters: number|string}>}
   */
  async function renderZoneE() {
    var zoneEl = el('ccZoneE');
    if (!zoneEl) return { matters: '-' };

    var stats        = null;
    var storageStats = null;
    var orgId        = api.user && (api.user.organizationId || api.user.organization_id);
    var mattersCount = '-';
    var docsCount    = '-';
    var storageStr   = '-';
    var usersCount   = '-';

    // Parallel fetch — graceful degradation
    // Storage Used comes from /admin/health/storage (system storage, same as
    // old index.html). Document counts come from /storage/stats.
    var results = await Promise.allSettled([
      orgId && canViewStatus()
        ? api.getOrganizationStats(orgId)
        : api.getMatters(1, 1),
      canViewStatus()
        ? api.get('/api/v1/storage/stats')
        : Promise.resolve(null),
      canViewStatus()
        ? api.get('/api/v1/admin/health/storage')
        : Promise.resolve(null)
    ]);

    // Stats result
    if (results[0].status === 'fulfilled' && results[0].value) {
      var raw = results[0].value;
      if (raw.statistics || raw.total_matters !== undefined) {
        stats = raw.statistics || raw;
        // Prefer `lana_matters` (matters that have been explicitly imported
        // into client_matters via the connector viewer's Output flow) over
        // `total_matters` (which historically UNIONed raw connector_data
        // matter rows; the route now returns lana-only here too, but the
        // explicit `lana_matters` field is the safer read against any
        // future change). Falls back to `total_matters` for older API
        // responses that don't split the count.
        var lanaMatters = stats.lana_matters;
        var unifiedMatters = stats.total_matters;
        var preferredCount = (lanaMatters !== undefined) ? lanaMatters : unifiedMatters;
        mattersCount = (preferredCount !== undefined)
          ? Utils.formatCompactCount(preferredCount)
          : '-';
        usersCount = (stats.total_users !== undefined)
          ? Utils.formatCompactCount(stats.total_users)
          : '-';
      } else if (raw.pagination) {
        // Regular user — matters list result
        mattersCount = Number(raw.pagination.total || 0).toLocaleString();
      } else if (raw.matters) {
        mattersCount = Number((raw.pagination && raw.pagination.total) || raw.matters.length).toLocaleString();
      }
    }

    // Document counts from /storage/stats
    if (results[1].status === 'fulfilled' && results[1].value) {
      storageStats = results[1].value;
      var totalFiles   = parseInt(storageStats.total_files   || 0, 10);
      docsCount = totalFiles.toLocaleString();
    }

    // System storage from /admin/health/storage (used_bytes + usage_percent)
    if (results[2].status === 'fulfilled' && results[2].value) {
      var storageInfo = results[2].value;
      if (storageInfo.storage && storageInfo.storage.used_bytes) {
        var pct = storageInfo.storage.usage_percent || 0;
        storageStr = formatBytes(storageInfo.storage.used_bytes) + ' (' + pct + '%)';
      }
    }

    // Update 3 lex-metric cards in-place (Active Matters moved to banner)
    var metrics = zoneEl.querySelectorAll('lex-metric');
    var data = [
      { label: 'Team Members',    value: usersCount,   status: 'blue' },
      { label: 'Total Documents', value: docsCount,    status: 'blue' },
      { label: 'Storage Used',    value: storageStr,   status: 'blue' }
    ];
    for (var m = 0; m < metrics.length && m < data.length; m++) {
      metrics[m].label  = data[m].label;
      metrics[m].value  = data[m].value;
      metrics[m].status = data[m].status;
    }

    // LANA One only: hide the meaningless "Team Members" tile + reflow to 2 cols.
    // Runs after population so the hide is never overwritten; no-op in org build.
    applyLanaOneMetricGate();

    return { matters: mattersCount };
  }

  // =========================================================================
  // Zone F right — Data Pulse (connector status)
  // =========================================================================

  /**
   * Get sync age tier from a last-sync timestamp.
   * Returns { tier, label, color } describing how stale the sync is.
   * @param {string|null} lastSync - ISO timestamp
   * @returns {{ tier: string, label: string, color: string, days: number }}
   */
  function syncAgeTier(lastSync) {
    if (!lastSync) return { tier: 'never', label: 'Never synced', color: 'danger', days: Infinity };

    var ms = Date.now() - new Date(lastSync).getTime();
    var days = Math.floor(ms / 86400000);

    if (days < 1)  return { tier: 'fresh',   label: 'Today',            color: 'success', days: days };
    if (days < 3)  return { tier: 'recent',  label: days + 'd ago',     color: 'success', days: days };
    if (days < 7)  return { tier: 'aging',   label: days + 'd ago',     color: 'warning', days: days };
    if (days < 30) return { tier: 'stale',   label: days + 'd ago',     color: 'warning', days: days };
    return            { tier: 'dormant', label: days + 'd ago',     color: 'danger',  days: days };
  }

  /**
   * Get CSS class for the age meter bar fill color.
   * @param {string} color - 'success' | 'warning' | 'danger'
   * @returns {string}
   */
  function ageMeterColorClass(color) {
    if (color === 'success') return 'cc-age-meter__fill--ok';
    if (color === 'warning') return 'cc-age-meter__fill--warn';
    return 'cc-age-meter__fill--danger';
  }

  /**
   * Calculate age meter fill percentage (fresher = fuller).
   * @param {number} days
   * @returns {number} 0-100
   */
  function ageMeterPercent(days) {
    if (days === Infinity) return 0;
    if (days < 1) return 100;
    if (days >= 30) return 5;
    // Linear decay from 100% (0 days) to 5% (30 days)
    return Math.max(5, Math.round(100 - (days / 30) * 95));
  }

  /**
   * Map connector status to lex-badge color.
   * @param {string} status
   * @returns {string}
   */
  function connectorBadgeColor(status) {
    if (!status) return 'gray';
    var s = String(status).toLowerCase();
    if (s === 'active' || s === 'connected' || s === 'healthy') return 'green';
    if (s === 'warning' || s === 'degraded') return 'yellow';
    if (s === 'error' || s === 'disconnected' || s === 'failed') return 'red';
    return 'gray';
  }

  /**
   * Render a list of connector row cards with age meters and recommendations.
   * Uses lex-badge, lex-text, and custom age meter bar.
   * @param {Array} list - Connector objects with ._age already computed
   * @returns {string} HTML string
   */
  function renderConnectorRows(list) {
    var html = '';
    for (var n = 0; n < list.length; n++) {
      var c         = list[n];
      var badgeColor = connectorBadgeColor(c.status);
      var statusLabel = connectorStatusLabel(c.status);
      var cName     = escHtml(c.name);
      var age       = c._age;
      var pct       = ageMeterPercent(age.days);
      var fillCls   = ageMeterColorClass(age.color);

      // Build recommendation text using lex-text
      var rec = '';
      if (age.tier === 'dormant') {
        rec = '<lex-text variant="danger" size="caption">Consider removing if no longer needed</lex-text>';
      } else if (age.tier === 'never') {
        rec = '<lex-text variant="danger" size="caption">Never synced — run initial sync or remove</lex-text>';
      } else if (age.tier === 'stale' && !c.syncEnabled) {
        rec = '<lex-text variant="warning" size="caption">Auto-sync disabled — trigger a manual sync</lex-text>';
      } else if (age.tier === 'aging' && !c.syncEnabled) {
        rec = '<lex-text variant="warning" size="caption">Auto-sync is off — data may be outdated</lex-text>';
      }

      html +=
        '<div class="cc-connector-row-v2">' +
          '<div class="cc-connector-row-v2__header">' +
            '<div class="flex items-center gap-2 min-w-0">' +
              '<lex-badge label="' + escHtml(statusLabel) + '" color="' + badgeColor + '" size="sm"></lex-badge>' +
              '<lex-text variant="primary" size="body-sm" weight="medium">' + cName + '</lex-text>' +
            '</div>' +
            '<lex-text variant="tertiary" size="caption">' + escHtml(age.label) + '</lex-text>' +
          '</div>' +
          '<div class="cc-age-meter">' +
            '<div class="cc-age-meter__fill ' + fillCls + '" style="width:' + pct + '%;"></div>' +
          '</div>' +
          rec +
        '</div>';
    }
    return html;
  }

  /**
   * Render connector status rows in the Data Pulse panel.
   * Fetches installed connectors from /api/v1/integrations/connectors.
   * Shows age meter for last sync + recommendations for stale/dormant connectors.
   * Splits by activity: Active vs Needs Attention. Capped at 10 rows.
   * @returns {Promise<void>}
   */
  // ═══════════════════════════════════════════════════════════════
  // Zone F Center — Billable Hours Today
  // ═══════════════════════════════════════════════════════════════

  async function loadBillableHours() {
    var loadingEl = el('billableHoursLoading');
    var contentEl = el('billableHoursContent');
    if (!contentEl) return;

    try {
      var result = await api.get('/api/v1/billable-hours/current');
      var data = result && result.data;

      if (loadingEl) loadingEl.classList.add('hidden');
      contentEl.classList.remove('hidden');

      // Total hours
      var totalEl = el('billableTotalHours');
      if (totalEl) {
        totalEl.textContent = (data && data.billable_hours != null) ? data.billable_hours.toFixed(1) : '0.0';
      }

      // Per-matter breakdown
      var listEl = el('billableMatterList');
      if (listEl && data && data.matters) {
        var html = '';
        var matters = data.matters.filter(function (m) { return m.hours > 0; });
        if (matters.length === 0) {
          html = '<div style="font-size:0.8rem;color:var(--lex-text-muted);font-style:italic;">No billable activity yet today</div>';
        } else {
          for (var i = 0; i < matters.length && i < 8; i++) {
            var m = matters[i];
            var matterId = m.matter_id || '-';
            var label = matterId.length > 20 ? matterId.substring(0, 17) + '...' : matterId;
            var matterHref = 'workspace-details.html?id=' + encodeURIComponent(matterId) + '&tab=billableHours';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;font-size:0.8rem;padding:0.25rem 0;">';
            html += '<a class="bh-matter-link" href="' + matterHref + '" data-matter="' + Lex.Utils.escapeHtml(matterId) + '" style="color:var(--lex-text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:65%;text-decoration:none;" title="' + Lex.Utils.escapeHtml(matterId) + '">' + Lex.Utils.escapeHtml(label) + '</a>';
            html += '<span style="font-weight:600;color:var(--lex-text-primary);flex-shrink:0;">' + m.hours.toFixed(1) + 'h</span>';
            html += '</div>';
          }
          if (matters.length > 8) {
            html += '<div style="font-size:0.75rem;color:var(--lex-text-muted);margin-top:0.25rem;">+' + (matters.length - 8) + ' more matters</div>';
          }
        }
        listEl.innerHTML = html;

        var matterLinks = listEl.querySelectorAll('.bh-matter-link[data-matter]');
        for (var mi = 0; mi < matterLinks.length; mi++) {
          matterLinks[mi].addEventListener('click', function (e) {
            if (window.Lex && window.Lex.Nav) {
              e.preventDefault();
              var mid = this.getAttribute('data-matter');
              if (mid) Lex.Nav.go('workspace-details.html', { params: { id: mid, tab: 'billableHours' } });
            }
          });
        }
      }

      // Draft entries list
      var draftListEl = el('billableDraftsList');
      var draftsInfoEl = el('billableDraftsInfo');
      if (draftListEl) {
        try {
          var draftsResult = await api.get('/api/v1/billable-hours/drafts?status=draft&limit=10');
          var drafts = (draftsResult && draftsResult.data) || [];
          var draftCount = (draftsResult && draftsResult.pagination && draftsResult.pagination.total) || drafts.length;

          if (drafts.length > 0) {
            var draftHtml = '<div style="font-size:0.7rem;font-weight:600;color:var(--lex-text-muted);text-transform:uppercase;margin-bottom:0.375rem;">Drafts Pending Review</div>';
            for (var di = 0; di < drafts.length; di++) {
              var d = drafts[di];
              var dHours = ((d.duration_minutes || 0) / 60).toFixed(1);
              var dDesc = d.description || d.activity_type || 'Time entry';
              if (dDesc.length > 50) dDesc = dDesc.substring(0, 47) + '...';
              var dMatter = d.matter_number || d.matter_id || '';

              // Anchor the draft's date in UTC so the navigated workspace
              // tab can pre-set its filter to the same window — otherwise
              // a draft from yesterday-UTC opens a matter whose default
              // "first-of-month → today" filter excludes it, and the user
              // sees an empty entry list even though the draft exists.
              var dDate = d.start_time
                ? new Date(d.start_time).toISOString().substring(0, 10)
                : '';
              draftHtml += '<div style="display:flex;align-items:center;gap:0.5rem;padding:0.375rem 0;font-size:0.8rem;">';
              // Hours badge
              draftHtml += '<span style="flex-shrink:0;min-width:2.5rem;text-align:center;padding:0.125rem 0.375rem;background:var(--lex-color-amber-50,#fffbeb);color:var(--lex-color-amber-700,#b45309);border-radius:0.25rem;font-weight:700;font-size:0.75rem;">' + dHours + 'h</span>';
              // Description
              draftHtml += '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--lex-text-secondary);" title="' + Lex.Utils.escapeHtml(d.description || '') + '">' + Lex.Utils.escapeHtml(dDesc) + '</span>';
              // Review link
              draftHtml += '<button class="bh-draft-review-btn" data-matter="' + Lex.Utils.escapeHtml(dMatter) + '" data-date="' + Lex.Utils.escapeHtml(dDate) + '" style="flex-shrink:0;font-size:0.7rem;font-weight:600;color:var(--lex-color-blue-600,#2563eb);background:none;border:none;cursor:pointer;padding:0;">Review</button>';
              draftHtml += '</div>';
            }
            draftListEl.innerHTML = draftHtml;

            // Wire review buttons via Lex.Nav.go. currentTarget pins to
            // the <button> even when the user clicks a child element; pass
            // the draft date through so the workspace tab can scope its
            // filter to the row's actual day.
            var reviewBtns = draftListEl.querySelectorAll('.bh-draft-review-btn');
            for (var ri = 0; ri < reviewBtns.length; ri++) {
              reviewBtns[ri].addEventListener('click', function (e) {
                var btn = e.currentTarget;
                var mid = btn.getAttribute('data-matter');
                var draftDate = btn.getAttribute('data-date');
                if (!mid) return;
                var params = { id: mid, tab: 'billableHours' };
                if (draftDate) {
                  params.bhFrom = draftDate;
                  params.bhTo = draftDate;
                }
                Lex.Nav.go('workspace-details.html', { params: params });
              });
            }

            // Summary below
            if (draftsInfoEl) {
              if (draftCount > drafts.length) {
                draftsInfoEl.innerHTML = '<a href="admin/billable-hours.html" style="color:var(--lex-color-amber-600,#d97706);text-decoration:none;font-weight:600;">' + draftCount + ' total drafts pending</a>';
              } else {
                draftsInfoEl.innerHTML = '';
              }
            }
          } else {
            draftListEl.innerHTML = '';
            if (draftsInfoEl) draftsInfoEl.innerHTML = 'No pending drafts';
          }
        } catch (_) {
          draftListEl.innerHTML = '';
          if (draftsInfoEl) draftsInfoEl.innerHTML = '';
        }
      }

    } catch (err) {
      console.warn('[Dashboard] loadBillableHours failed:', err);
      if (loadingEl) loadingEl.classList.add('hidden');
      if (contentEl) {
        contentEl.classList.remove('hidden');
        contentEl.innerHTML = '<div style="font-size:0.8rem;color:var(--lex-text-muted);font-style:italic;">Billable hours unavailable</div>';
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Zone F Right — Data Pulse
  // ═══════════════════════════════════════════════════════════════

  async function renderZoneFRight() {
    var loadingEl = el('ccZoneFRightLoading');
    var contentEl = el('ccZoneFRightContent');
    if (!contentEl) return;

    var connectors = [];

    try {
      var result = await api.get('/api/v1/integrations/connectors');
      var raw = (result && result.connectors) || [];

      for (var i = 0; i < raw.length; i++) {
        var c = raw[i];
        connectors.push({
          name:        c.name || c.connector_type || 'Connector',
          status:      c.status || c.auth_status || 'unknown',
          syncEnabled: c.sync_enabled != null ? c.sync_enabled : true,
          lastSync:    c.last_sync || c.last_successful_sync || null,
          createdAt:   c.created_at || null
        });
      }
    } catch (err) {
      console.warn('[Dashboard Zone F] Could not load connectors:', err && err.message);
    }

    if (loadingEl) hide(loadingEl);

    if (connectors.length === 0) {
      contentEl.innerHTML =
        '<lex-empty icon="folder" message="No connectors configured" description="Visit Integrations to add your first connector"></lex-empty>';
      show(contentEl);
      return;
    }

    // Categorize connectors by sync freshness
    var healthy = [];       // synced within 7 days
    var needsAttention = []; // stale (7-30d), dormant (30d+), or never synced

    for (var j = 0; j < connectors.length; j++) {
      var age = syncAgeTier(connectors[j].lastSync);
      connectors[j]._age = age;
      if (age.tier === 'fresh' || age.tier === 'recent' || age.tier === 'aging') {
        healthy.push(connectors[j]);
      } else {
        needsAttention.push(connectors[j]);
      }
    }

    // Sort each group: healthy by most recent first, needs attention by stalest first
    healthy.sort(function (a, b) {
      if (!a.lastSync) return 1;
      if (!b.lastSync) return -1;
      return new Date(b.lastSync).getTime() - new Date(a.lastSync).getTime();
    });
    needsAttention.sort(function (a, b) {
      if (!a.lastSync && !b.lastSync) return 0;
      if (!a.lastSync) return -1;
      if (!b.lastSync) return 1;
      return new Date(a.lastSync).getTime() - new Date(b.lastSync).getTime();
    });

    // Cap total displayed at 10
    var maxDisplay = 10;
    var totalCount = healthy.length + needsAttention.length;
    var showHealthy = healthy.slice(0, maxDisplay);
    var remaining = maxDisplay - showHealthy.length;
    var showAttention = remaining > 0 ? needsAttention.slice(0, remaining) : [];

    var html = '';

    // Active section
    if (showHealthy.length > 0) {
      html += '<lex-text variant="tertiary" size="overline" weight="semibold" tag="div" style="margin-bottom:0.25rem;">Active</lex-text>';
      html += renderConnectorRows(showHealthy);
    }

    // Needs attention section
    if (showAttention.length > 0) {
      if (showHealthy.length > 0) {
        html += '<lex-divider spacing="sm"></lex-divider>';
      }
      html += '<lex-text variant="tertiary" size="overline" weight="semibold" tag="div" style="margin-bottom:0.25rem;">Needs Attention</lex-text>';
      html += renderConnectorRows(showAttention);
    }

    // Footer navigation button
    var footerLabel = totalCount > maxDisplay
      ? 'View all ' + escHtml(String(totalCount)) + ' connectors'
      : 'Manage connectors';
    html +=
      '<div style="text-align:center;padding-top:0.625rem;">' +
        '<lex-btn variant="ghost" size="sm" class="cc-connector-nav-btn">' +
          footerLabel +
          ' <svg class="w-3.5 h-3.5 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>' +
        '</lex-btn>' +
      '</div>';

    contentEl.innerHTML = html;

    // Wire footer button click → navigate to connectors page
    var navBtn = contentEl.querySelector('.cc-connector-nav-btn');
    if (navBtn) {
      navBtn.addEventListener('click', function () {
        Lex.Nav.go('data-connectors.html');
      });
    }

    show(contentEl);
  }

  // =========================================================================
  // Zone F left — Activity heatmap + feed
  // (Delegates to existing ActivityHeatmap + ActivityPanel — no changes needed)
  // =========================================================================

  /**
   * Load user productivity data and render the activity heatmap.
   * Delegates rendering to ActivityHeatmap.render() which is a custom
   * non-Lex component loaded separately.
   * TODO: Port ActivityHeatmap to Lex framework
   * @param {string|null} userId  null = current user
   * @returns {Promise<void>}
   */
  async function loadUserProductivity(userId) {
    var skeleton  = el('activityHeatmapSkeleton');
    var container = el('activityHeatmapContainer');

    // Only show purpose-built skeleton on initial load (empty container).
    // Refreshes use the framework-level Lex.Redact state instead.
    var isInitial = !container || container.children.length === 0;
    if (skeleton && isInitial) show(skeleton);

    try {
      var result = userId
        ? await api.get('/api/v1/activity/user/' + userId + '/productivity')
        : await api.getMyProductivity();

      var productivityData = result && result.productivity;
      if (!productivityData) {
        if (skeleton) hide(skeleton);
        return;
      }

      var totalEl = el('totalActivities');
      if (totalEl) {
        totalEl.textContent = Number(productivityData.total_activities || 0).toLocaleString('en-US');
      }

      var heatmapContainer = el('activityHeatmapContainer');
      if (heatmapContainer) {
        var daily = productivityData.daily_activity;
        if (daily && daily.length > 0) {
          if (typeof ActivityHeatmap !== 'undefined') {
            ActivityHeatmap.render('activityHeatmapContainer', daily);
          }
        } else {
          heatmapContainer.innerHTML =
            '<lex-empty icon="chart" message="No activity data yet" description="Activity will appear here as you interact with the system"></lex-empty>';
        }
      }
    } catch (err) {
      console.warn('[Dashboard] loadUserProductivity failed:', err && err.message);
      var totalEl2 = el('totalActivities');
      if (totalEl2) totalEl2.textContent = '0';
    } finally {
      if (skeleton) hide(skeleton);
    }
  }

  /**
   * Load organization-wide productivity data (admin view).
   * @returns {Promise<void>}
   */
  async function loadOrganizationProductivity() {
    var skeleton  = el('activityHeatmapSkeleton');
    var container = el('activityHeatmapContainer');

    var isInitial = !container || container.children.length === 0;
    if (skeleton && isInitial) show(skeleton);

    try {
      var result = await api.get('/api/v1/activity/organization/productivity');
      var productivityData = result && result.productivity;
      if (!productivityData) {
        if (skeleton) hide(skeleton);
        return;
      }

      var totalEl = el('totalActivities');
      if (totalEl) {
        totalEl.textContent = Number(productivityData.total_activities || 0).toLocaleString('en-US');
      }

      var heatmapContainer = el('activityHeatmapContainer');
      if (heatmapContainer) {
        var daily = productivityData.daily_activity;
        if (daily && daily.length > 0) {
          if (typeof ActivityHeatmap !== 'undefined') {
            ActivityHeatmap.render('activityHeatmapContainer', daily);
          }
        } else {
          heatmapContainer.innerHTML =
            '<lex-empty icon="chart" message="No activity data yet" description="Activity will appear here as users interact with the system"></lex-empty>';
        }
      }
    } catch (err) {
      console.warn('[Dashboard] loadOrganizationProductivity failed:', err && err.message);
    } finally {
      if (skeleton) hide(skeleton);
    }
  }

  // =========================================================================
  // Activity feed (inline, right column of Zone F left)
  // =========================================================================

  /**
   * Build a single activity feed item HTML string.
   * @param {Object} activity
   * @param {boolean} showUser
   * @returns {string}
   */
  function renderActivityItem(activity, showUser) {
    var ts       = activity.activity_timestamp || activity.timestamp;
    var relTime  = ts ? timeAgo(ts) : '-';
    var fullTime = ts ? formatDateTime(ts) : '';

    var displayMessage;
    if (typeof EventDisplayNames !== 'undefined') {
      displayMessage = EventDisplayNames.getEventDisplayName(
        activity.event_type,
        activity.display_message
      );
    } else {
      displayMessage = activity.display_message || activity.event_type || 'Activity';
    }

    var metaInner;
    if (showUser && activity.user) {
      var userName = ((activity.user.first_name || '') + ' ' + (activity.user.last_name || '')).trim();
      metaInner = userName
        ? escHtml(userName) + ' &bull; ' + escHtml(relTime)
        : escHtml(relTime);
    } else {
      metaInner = escHtml(relTime);
    }

    var titleAttr = fullTime ? ' title="' + escHtml(fullTime) + '"' : '';

    return (
      '<div class="py-3 hover:lex-bg-secondary transition-colors px-1" style="border-color:var(--lex-border-subtle);">' +
        '<div class="flex items-start gap-3">' +
          '<div class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center" style="background:var(--lex-bg-accent-soft);">' +
            '<svg class="w-4 h-4" style="color:var(--lex-text-accent);" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
              '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>' +
            '</svg>' +
          '</div>' +
          '<div class="flex-1 min-w-0">' +
            '<p class="text-sm lex-text-primary">' + escHtml(displayMessage) + '</p>' +
            '<p class="text-xs lex-text-tertiary mt-0.5"' + titleAttr + '>' + metaInner + '</p>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  /**
   * Load activity feed for a specific user (or current user if null).
   * @param {string|null} userId
   * @returns {Promise<void>}
   */
  async function loadActivityForUser(userId) {
    var loadingEl = el('activityFeedLoading');
    var feedEl    = el('activityFeed');
    if (!feedEl) return;

    // Only show skeleton on initial load (feed not yet populated).
    // Refreshes keep existing content visible behind Lex.Redact overlay.
    var hasContent = feedEl.hasChildNodes() && !feedEl.classList.contains('hidden');
    if (!hasContent) {
      if (loadingEl) show(loadingEl);
      hide(feedEl);
    }

    try {
      var endpoint = userId
        ? '/api/v1/activity/user/' + userId + '?limit=10'
        : '/api/v1/activity/my?limit=10';

      var result     = await api.get(endpoint);
      var activities = (result && result.activities) || [];

      if (activities.length > 0) {
        feedEl.innerHTML = '';
        for (var i = 0; i < activities.length; i++) {
          feedEl.innerHTML += renderActivityItem(activities[i], false);
        }
      } else {
        feedEl.innerHTML = '<div class="py-6 text-center text-sm lex-text-tertiary">No recent activity</div>';
      }
    } catch (err) {
      console.warn('[Dashboard] loadActivityForUser failed:', err && err.message);
      feedEl.innerHTML = '<div class="py-6 text-center text-sm lex-text-tertiary">Failed to load activity</div>';
    } finally {
      if (loadingEl) hide(loadingEl);
      show(feedEl);
    }
  }

  /**
   * Load organization-wide activity feed (admin only).
   * @returns {Promise<void>}
   */
  async function loadOrganizationActivity() {
    var loadingEl = el('activityFeedLoading');
    var feedEl    = el('activityFeed');
    if (!feedEl) return;

    var hasContent = feedEl.hasChildNodes() && !feedEl.classList.contains('hidden');
    if (!hasContent) {
      if (loadingEl) show(loadingEl);
      hide(feedEl);
    }

    try {
      var result     = await api.get('/api/v1/activity/organization/recent?limit=10');
      var activities = (result && result.activities) || [];

      if (activities.length > 0) {
        feedEl.innerHTML = '';
        for (var i = 0; i < activities.length; i++) {
          feedEl.innerHTML += renderActivityItem(activities[i], true);
        }
      } else {
        feedEl.innerHTML = '<div class="py-6 text-center text-sm lex-text-tertiary">No recent activity</div>';
      }
    } catch (err) {
      console.warn('[Dashboard] loadOrganizationActivity failed:', err && err.message);
      feedEl.innerHTML = '<div class="py-6 text-center text-sm lex-text-tertiary">Failed to load activity</div>';
    } finally {
      if (loadingEl) hide(loadingEl);
      show(feedEl);
    }
  }

  // =========================================================================
  // Admin activity user filter (Zone F left header)
  // =========================================================================

  /**
   * Show the user filter dropdown for admins and wire up its change handler.
   * @returns {Promise<void>}
   */
  async function initializeActivityUserFilter() {
    var filterContainer = el('activityUserFilterContainer');
    var filterSelect    = el('activityUserFilter');
    if (!filterContainer || !filterSelect) return;

    // Determine admin status
    var userIsAdmin = false;
    try {
      var profileResult = await api.get('/api/v1/users/me/profile');
      var profile = (profileResult && profileResult.profile) || {};
      var roles   = profile.roles || [];
      for (var i = 0; i < roles.length; i++) {
        var rn = (roles[i] && (roles[i].name || roles[i])) || '';
        if (rn === 'system_admin' || rn === 'org_admin') {
          userIsAdmin = true;
          break;
        }
      }
    } catch (profileErr) {
      console.warn('[Dashboard] Profile fetch failed, falling back to localStorage:', profileErr && profileErr.message);
      try {
        var storedUser = JSON.parse(localStorage.getItem('user') || '{}');
        var roleName   = storedUser.role_name || storedUser.role || '';
        userIsAdmin = (roleName === 'system_admin' || roleName === 'org_admin');
      } catch (parseErr) {
        userIsAdmin = false;
      }
    }

    if (!userIsAdmin) {
      hide(filterContainer);
      return;
    }

    show(filterContainer);

    // Populate users dropdown
    try {
      var result = await api.getOrganizationUsers();
      var users  = (result && result.users) || [];

      var opts = [
        { value: 'me', label: 'My Activity' },
        { value: 'all', label: 'All Users' }
      ];
      for (var j = 0; j < users.length; j++) {
        var u = users[j];
        opts.push({ value: u.id, label: u.full_name || u.email || 'Unknown' });
      }
      filterSelect.options = opts;
    } catch (usersErr) {
      console.warn('[Dashboard] getOrganizationUsers failed:', usersErr && usersErr.message);
    }

    // Change handler (lex-select emits 'lex-change' with detail.value)
    // Uses Lex.Redact to show skeleton shimmer during data switch.
    filterSelect.addEventListener('lex-change', function (e) {
      var val = e.detail && e.detail.value;
      var heatmapArea = document.querySelector('.cc-activity-split__heatmap');
      var feedArea    = document.querySelector('.cc-activity-split__feed');
      Lex.Redact.on(heatmapArea);
      Lex.Redact.on(feedArea);

      var reload;
      if (val === 'me') {
        reload = Promise.allSettled([loadUserProductivity(null), loadActivityForUser(null)]);
      } else if (val === 'all') {
        reload = Promise.allSettled([loadOrganizationProductivity(), loadOrganizationActivity()]);
      } else {
        reload = Promise.allSettled([loadUserProductivity(val), loadActivityForUser(val)]);
      }
      reload.then(function () {
        Lex.Redact.off(heatmapArea);
        Lex.Redact.off(feedArea);
      });
    });
  }

  // =========================================================================
  // Activity heatmap info modal (page-specific)
  // =========================================================================

  /** Close the heatmap info modal. Exposed globally for inline onclick. */
  exposeGlobal('closeActivityHeatmapInfoModal', function () {
    var modal = el('activityHeatmapInfoModal');
    if (modal) modal.open = false;
  });

  // =========================================================================
  // Page-specific navigation helpers
  // =========================================================================

  /** Navigate to orphaned documents page (respects admin vs standard path). */
  exposeGlobal('navigateToOrphans', function () {
    var user = {};
    try {
      user = JSON.parse(localStorage.getItem('user') || '{}');
    } catch (e) { /* ignore */ }
    var role = user.role || '';
    var perms = user.permissions || [];
    var hasAdmin = (role === 'system_admin' || role === 'org_admin' || perms.indexOf('admin:access') !== -1);
    if (hasAdmin) {
      Lex.Nav.go('admin/orphaned-documents.html');
    } else {
      Lex.Nav.go('drive.html', { params: { tab: 'orphaned' } });
    }
  });

  // =========================================================================
  // Zone E — Expandable detail panels (accordion)
  // =========================================================================

  /**
   * Toggle the metric detail panel. Same key = close. Different key = swap.
   * Permission-gated: 'team' and 'storage' require admin/canViewStatus.
   * @param {string} key - 'team' | 'docs' | 'storage'
   */
  function toggleDetailPanel(key) {
    var panel = el('ccDetailPanel');
    if (!panel) return;

    // Same card clicked — close
    if (activeDetailKey === key) {
      panel.open = false;
      activeDetailKey = null;
      highlightMetric(null);
      return;
    }

    // Permission gates
    if (key === 'team' && !isAdmin()) return;
    if (key === 'storage' && !canViewStatus()) return;

    activeDetailKey = key;
    highlightMetric(key);

    // Configure heading, action label, action href
    var config = {
      team:    { heading: 'Team Overview',     actionLabel: 'View all members',   actionHref: 'admin/users.html' },
      docs:    { heading: 'Recent Documents',  actionLabel: 'View all documents', actionHref: 'drive.html?view=documents' },
      storage: { heading: 'Storage Breakdown', actionLabel: 'View system health', actionHref: 'admin/health.html' }
    };
    var c = config[key];
    if (!c) return;

    panel.heading     = c.heading;
    panel.actionLabel = c.actionLabel;
    panel.actionHref  = c.actionHref;

    // Render content, then open (or refresh height if already open)
    var wasOpen = panel.open;
    var renderers = { team: renderTeamDetail, docs: renderDocsDetail, storage: renderStorageDetail };
    renderers[key](panel).then(function () {
      if (!wasOpen) {
        panel.open = true;
      } else {
        // Already open — smoothly adjust height for new content
        panel.refreshHeight();
      }
    });
  }

  /**
   * Highlight the active metric card with a visual indicator.
   * @param {string|null} key - metric key to highlight, or null to clear all
   */
  function highlightMetric(key) {
    var zoneE = el('ccZoneE');
    if (!zoneE) return;
    var metrics = zoneE.querySelectorAll('lex-metric[data-metric-key]');
    for (var i = 0; i < metrics.length; i++) {
      var m = metrics[i];
      if (key && m.getAttribute('data-metric-key') === key) {
        m.classList.add('cc-metric-active');
      } else {
        m.classList.remove('cc-metric-active');
      }
    }
  }

  /**
   * Convert backend role keys into human-readable labels for display.
   * @param {string} value
   * @returns {string}
   */
  function formatRoleLabel(value) {
    if (!value) return '';
    var roleMap = {
      system_admin: 'System Admin',
      org_admin: 'Organization Admin',
      organization_admin: 'Organization Admin',
      admin: 'Admin',
      e2e_test_admin: 'E2E Test Admin',
      upper_leader: 'Upper Leader',
      senior_leader: 'Senior Leader',
      senior_user: 'Senior User',
      user: 'User'
    };
    var key = String(value).trim();
    var normalized = key.toLowerCase();
    if (roleMap[normalized]) return roleMap[normalized];
    return key
      .split('_')
      .filter(Boolean)
      .map(function (part) { return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(); })
      .join(' ');
  }

  /**
   * Build user rows HTML for the team detail panel.
   * Each user object must have: first_name, last_name, email.
   * @param {Array} users
   * @returns {string}
   */
  function buildUserRows(users) {
    var html = '';
    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      var fullName = ((u.first_name || '') + ' ' + (u.last_name || '')).trim() || u.email || 'Unknown';
      var initial = fullName.charAt(0).toUpperCase();
      var role = u.role_display_name || u.role_label || u.display_role || formatRoleLabel(u.role_name || u.role || '');
      var email = u.email || '';

      html +=
        '<div class="cc-detail-user-row">' +
          '<div class="cc-detail-user-avatar">' + escHtml(initial) + '</div>' +
          '<div class="flex-1 min-w-0">' +
            '<div class="text-sm font-medium lex-text-primary truncate">' + escHtml(fullName) + '</div>' +
            '<div class="text-xs lex-text-tertiary truncate">' + escHtml(email) + '</div>' +
          '</div>' +
          (role ? '<lex-badge variant="subtle" size="sm">' + escHtml(role) + '</lex-badge>' : '') +
        '</div>';
    }
    return html;
  }

  /**
   * Render team member snapshot in the detail panel.
   * Fetches activity stats (30 days) and full user list in parallel.
   * Splits into: Most Active (events > 0, top 3) and Needs Attention (0 events, 3 shown + overflow message).
   * @param {Element} panel
   * @returns {Promise<void>}
   */
  async function renderTeamDetail(panel) {
    var content = panel.querySelector('.lex-detail-panel__content');
    if (!content) return;

    content.innerHTML = '<div class="py-4 text-center"><lex-spinner size="sm"></lex-spinner></div>';

    try {
      // Fetch 30-day activity stats and full user list in parallel
      var results = await Promise.allSettled([
        api.get('/api/v1/activity/stats?days=30'),
        api.getOrganizationUsers()
      ]);

      var statsData = results[0].status === 'fulfilled' ? results[0].value : null;
      var usersData = results[1].status === 'fulfilled' ? results[1].value : null;

      var activeUserStats = (statsData && statsData.most_active_users) || [];
      var allUsers = (usersData && usersData.users) || [];

      if (allUsers.length === 0) {
        content.innerHTML = '<lex-empty icon="users" message="No team members found"></lex-empty>';
        return;
      }

      // Build activity count map: user_id → event count
      var activityMap = {};
      for (var i = 0; i < activeUserStats.length; i++) {
        activityMap[activeUserStats[i].user_id] = activeUserStats[i].activity_count;
      }

      // Merge all users with their event counts, then split by active vs inactive
      var active = [];
      var inactive = [];
      for (var j = 0; j < allUsers.length; j++) {
        var u = allUsers[j];
        var entry = {
          id: u.id,
          first_name: u.first_name,
          last_name: u.last_name,
          email: u.email,
          role_name: u.role_name,
          role: u.role,
          role_display_name: u.role_display_name || u.roleDisplayName || (u.role && u.role.display_name),
          role_label: u.role_label || u.roleLabel,
          display_role: u.display_role || u.displayRole,
          event_count: activityMap[u.id] || 0
        };
        if (entry.event_count > 0) {
          active.push(entry);
        } else {
          inactive.push(entry);
        }
      }

      // Sort active users by event count descending (most active first)
      active.sort(function (a, b) { return b.event_count - a.event_count; });

      var html = '<div>';

      var activeSlots = Math.min(active.length, 10);
      var remainingSlots = Math.max(0, 10 - activeSlots);

      // Most Active section — users with events in last 30 days
      if (active.length > 0) {
        var topActive = active.slice(0, activeSlots);
        html +=
          '<lex-text variant="tertiary" size="overline" weight="semibold" tag="div" style="margin-bottom:0.5rem;">Most Active — last 30 days</lex-text>';
        html += buildUserRows(topActive);
      }

      // Needs Attention section — users with 0 events in last 30 days
      if (inactive.length > 0 && remainingSlots > 0) {
        var topInactive = inactive.slice(0, remainingSlots);
        html +=
          '<lex-text variant="tertiary" size="overline" weight="semibold" tag="div" style="margin-bottom:0.5rem;' + (active.length > 0 ? 'margin-top:0.75rem;' : '') + '">Needs Attention</lex-text>';
        html += buildUserRows(topInactive);

        // Overflow message for remaining inactive users
        if (inactive.length > remainingSlots) {
          var remaining = inactive.length - remainingSlots;
          html +=
            '<div class="text-xs lex-text-tertiary mt-2" style="padding-left:0.5rem;">' +
              'There ' + (remaining === 1 ? 'is' : 'are') + ' ' + escHtml(String(remaining)) +
              ' more user' + (remaining === 1 ? '' : 's') + ' that also need' + (remaining === 1 ? 's' : '') + ' attention.' +
            '</div>';
        }
      }

      html += '</div>';
      content.innerHTML = html;
    } catch (err) {
      console.warn('[Dashboard] renderTeamDetail failed:', err && err.message);
      content.innerHTML = '<lex-empty icon="alert" message="Could not load team data"></lex-empty>';
    }
  }

  /**
   * Render recent documents snapshot in the detail panel.
   * Source: /api/v1/storage/recent?limit=10 (cross-matter, falls back to upload date)
   * Shows up to 10 documents with filename, matter name, timestamp.
   * @param {Element} panel
   * @returns {Promise<void>}
   */
  async function renderDocsDetail(panel) {
    var content = panel.querySelector('.lex-detail-panel__content');
    if (!content) return;

    content.innerHTML = '<div class="py-4 text-center"><lex-spinner size="sm"></lex-spinner></div>';

    try {
      var results = await Promise.allSettled([
        api.get('/api/v1/storage/recent?limit=10'),
        api.getMatters(1, 200)
      ]);
      var result = results[0].status === 'fulfilled' ? results[0].value : null;
      var mattersResult = results[1].status === 'fulfilled' ? results[1].value : null;
      var docs = (result && (result.files || result.documents || result.data)) || [];
      var matterMap = buildMatterNameMap((mattersResult && (mattersResult.matters || mattersResult.data || mattersResult.items)) || []);

      if (docs.length === 0) {
        content.innerHTML = '<lex-empty icon="folder" message="No documents yet" description="Upload your first document to get started"></lex-empty>';
        return;
      }

      var html = '<div>';
      for (var i = 0; i < docs.length; i++) {
        var d = docs[i];
        var name = d.filename || d.original_name || d.file_name || d.name || 'Untitled';
        var matterId = getDocumentMatterId(d);
        var matter = getDocumentMatterName(d, matterMap);
        var ts = (d.last_accessed_at || d.created_at) ? timeAgo(d.last_accessed_at || d.created_at) : '';

        var fileId   = d.id || '';

        html +=
          '<div class="cc-detail-doc-row' + (fileId && matterId ? ' cc-detail-doc-row--clickable' : '') + '"' +
            (fileId && matterId
              ? ' data-file-id="' + escHtml(String(fileId)) + '" data-matter-id="' + escHtml(String(matterId)) + '"'
              : '') +
          '>' +
            '<svg class="w-4 h-4 flex-shrink-0 lex-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
              '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>' +
            '</svg>' +
            '<div class="flex-1 min-w-0">' +
              '<div class="text-sm font-medium lex-text-primary truncate">' + escHtml(name) + '</div>' +
              '<div class="text-xs lex-text-tertiary">' +
                (matter ? escHtml(matter) + ' &middot; ' : '') +
                escHtml(ts) +
              '</div>' +
            '</div>' +
          '</div>';
      }
      html += '</div>';
      content.innerHTML = html;

      // Wire doc row clicks → open dedicated file viewer
      var rows = content.querySelectorAll('.cc-detail-doc-row--clickable');
      for (var k = 0; k < rows.length; k++) {
        rows[k].addEventListener('click', function () {
          var fId = this.getAttribute('data-file-id');
          if (fId) {
            Lex.Nav.go('file-viewer.html', {
              params: { id: fId },
              context: { referrer: 'dashboard.html' }
            });
          }
        });
      }
    } catch (err) {
      console.warn('[Dashboard] renderDocsDetail failed:', err && err.message);
      content.innerHTML = '<lex-empty icon="alert" message="Could not load documents"></lex-empty>';
    }
  }

  function getMatterDisplayName(matter) {
    if (!matter) return '';
    return matter.matter_name || matter.name || matter.title || matter.display_name || '';
  }

  function buildMatterNameMap(matters) {
    var map = {};
    for (var i = 0; i < matters.length; i++) {
      var matter = matters[i];
      var name = getMatterDisplayName(matter);
      if (!name) continue;
      var ids = [matter.id, matter.matter_id, matter.matter_number, matter.client_matter].filter(Boolean);
      for (var j = 0; j < ids.length; j++) {
        map[String(ids[j])] = name;
      }
    }
    return map;
  }

  function getDocumentMatterId(doc) {
    if (!doc) return '';
    return doc.matter_id || doc.client_matter_id || doc.client_matter || doc.workspace_id || '';
  }

  function getDocumentMatterName(doc, matterMap) {
    if (!doc) return '';
    var directName = doc.matter_name || doc.client_matter_name || doc.workspace_name || doc.workspaceName ||
      (doc.matter && getMatterDisplayName(doc.matter)) ||
      (doc.workspace && getMatterDisplayName(doc.workspace)) ||
      '';
    if (directName) return directName;
    var matterId = getDocumentMatterId(doc);
    return matterId && matterMap[String(matterId)] ? matterMap[String(matterId)] : '';
  }

  /**
   * Render storage breakdown in the detail panel.
   * Source: /api/v1/admin/health/storage
   * Shows row-based breakdown with percentage bars.
   * @param {Element} panel
   * @returns {Promise<void>}
   */
  async function renderStorageDetail(panel) {
    var content = panel.querySelector('.lex-detail-panel__content');
    if (!content) return;

    content.innerHTML = '<div class="py-4 text-center"><lex-spinner size="sm"></lex-spinner></div>';

    try {
      var result = await api.get('/api/v1/admin/health/storage');

      if (!result || !result.storage) {
        content.innerHTML = '<lex-empty icon="server" message="Storage data unavailable"></lex-empty>';
        return;
      }

      var s = result.storage;
      var html = '<div>';
      var rows = [];

      // Database storage
      if (s.database_size_bytes != null) {
        var dbPct = s.total_bytes ? Math.round((s.database_size_bytes / s.total_bytes) * 100) : 0;
        rows.push({ label: 'Database', size: formatBytes(s.database_size_bytes), pct: dbPct });
      }

      // Document storage (MinIO) — derive from total used minus database
      if (s.used_bytes != null && s.database_size_bytes != null) {
        var docBytes = s.used_bytes - (s.database_size_bytes || 0);
        if (docBytes < 0) docBytes = 0;
        var docPct = s.total_bytes ? Math.round((docBytes / s.total_bytes) * 100) : 0;
        rows.push({ label: 'Documents (MinIO)', size: formatBytes(docBytes), pct: docPct });
      } else if (s.used_bytes != null) {
        var usedPct = s.usage_percent || 0;
        rows.push({ label: 'Used Storage', size: formatBytes(s.used_bytes), pct: usedPct });
      }

      // Volume breakdown if available
      if (s.volumes && Array.isArray(s.volumes)) {
        for (var v = 0; v < s.volumes.length; v++) {
          var vol = s.volumes[v];
          var volPct = vol.total_bytes ? Math.round((vol.used_bytes / vol.total_bytes) * 100) : 0;
          rows.push({ label: vol.name || vol.mount || 'Volume', size: formatBytes(vol.used_bytes), pct: volPct });
        }
      }

      // Render each row
      for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        html +=
          '<div class="cc-detail-storage-row">' +
            '<div style="min-width:8rem;">' +
              '<div class="text-sm font-medium lex-text-primary">' + escHtml(row.label) + '</div>' +
              '<div class="text-xs lex-text-tertiary">' + escHtml(row.size) + '</div>' +
            '</div>' +
            '<div class="cc-detail-storage-bar">' +
              '<div class="cc-detail-storage-fill" style="width:' + row.pct + '%;"></div>' +
            '</div>' +
            '<div class="text-xs font-medium lex-text-secondary" style="min-width:2.5rem;text-align:right;">' + row.pct + '%</div>' +
          '</div>';
      }

      // Total capacity summary
      if (s.total_bytes) {
        html +=
          '<div class="flex items-center justify-between pt-2 mt-2" style="border-top:1px solid var(--lex-border-subtle);">' +
            '<span class="text-xs lex-text-tertiary">Total capacity</span>' +
            '<span class="text-xs font-medium lex-text-primary">' + escHtml(formatBytes(s.total_bytes)) + '</span>' +
          '</div>';
      }

      html += '</div>';
      content.innerHTML = html;
    } catch (err) {
      console.warn('[Dashboard] renderStorageDetail failed:', err && err.message);
      content.innerHTML = '<lex-empty icon="alert" message="Could not load storage data"></lex-empty>';
    }
  }

  // =========================================================================
  // Dashboard initialization — entry point
  // =========================================================================

  /**
   * Initialize the Command Center dashboard.
   * Loads user profile first, then fans out to all six zones in parallel
   * using Promise.allSettled for graceful degradation.
   */
  async function initDashboard() {

    // Topbar refresh button — full dashboard reload
    trackDocListener('lex-refresh', function (e) {
      e.preventDefault();
      initDashboard();
    });

    // ── 0. Reset detail panel state on re-navigation ────────────────────
    activeDetailKey = null;
    var detailPanelReset = el('ccDetailPanel');
    if (detailPanelReset) detailPanelReset.open = false;

    // ── 1. Load full user profile with roles ──────────────────────────────
    try {
      await api.loadUserProfile();
    } catch (profileErr) {
      console.warn('[Dashboard] loadUserProfile failed (non-fatal):', profileErr && profileErr.message);
    }

    // ── 2. Initialize shell-level components ──────────────────────────────
    if (typeof ConversationActionsModal !== 'undefined') {
      ConversationActionsModal.init();
    }
    if (typeof ActivityPanel !== 'undefined') {
      ActivityPanel.init();
    }

    // ── 3. Zone A — render immediately (local data only) ──────────────────
    renderZoneA();

    // ── 4. Fan-out: all zones load in parallel ────────────────────────────
    var zoneResults = await Promise.allSettled([
      renderZoneC(),              // 0 — action queue (critical items first)
      renderZoneE(),              // 1 — pipeline stats → returns {matters}
      renderZoneFRight(),         // 2 — data pulse
      loadUserProductivity(null), // 3 — heatmap
      loadActivityForUser(null),  // 4 — activity feed
      renderZoneD(),              // 5 — Lana Tasks status
      loadBillableHours()         // 6 — billable hours today
    ]);

    // ── 5. Update Zone A matters button once we have the count ─────────────
    var mattersCount = '-';
    if (zoneResults[1].status === 'fulfilled' && zoneResults[1].value) {
      mattersCount = zoneResults[1].value.matters || '-';
    }
    updateZoneAPills(mattersCount);

    // ── 6. Wire up Zone A/C/F event handlers ──────────────────────────────
    wireEvents();

    // ── 7. Admin activity filter ──────────────────────────────────────────
    initializeActivityUserFilter();

    // ── 8. Legacy Widget system (kept for backward-compat) ─────────────────
    _timeouts.push(setTimeout(function () {
      if (typeof WidgetRenderer !== 'undefined') {
        WidgetRenderer.init();
      }
    }, 500));

    // ── 9. Heartbeat indicator in topbar ──────────────────────────────────
    _timeouts.push(setTimeout(function () {
      if (heartbeatAppEnabled() && typeof LanaHeartbeat !== 'undefined') {
        LanaHeartbeat.inject();
        LanaHeartbeat.start(_intervals);
      }
    }, 300));
  }

  // =========================================================================
  // Lana action handler (Zone C)
  // =========================================================================

  /**
   * Handle accept-click on a Zone C feedback button.
   * @param {Element} card
   */
  async function handleAcceptClick(card) {
    var actionType = card.getAttribute('data-action-type') || 'alert';
    var entityId   = card.getAttribute('data-entity-id') || card.getAttribute('data-action-id');
    if (!entityId) return;

    // Resolve matter context from cached item
    var itemId = card.getAttribute('data-action-id');
    var cached = itemId ? _actionItemsMap[itemId] : null;
    var sa     = cached ? getSuggestedAction(cached) : null;
    var title  = cached ? (cached.title || '') : '';

    // Collect all matter IDs for this action
    var matterIds = [];
    if (sa) {
      if (sa.matter_ids && sa.matter_ids.length) {
        matterIds = sa.matter_ids;
      } else if (sa.matter_id) {
        matterIds = [sa.matter_id];
      }
      if (sa.items && sa.items.length) {
        for (var k = 0; k < sa.items.length; k++) {
          var mid = sa.items[k].matter_id || sa.items[k].matterId;
          if (mid && matterIds.indexOf(mid) === -1) matterIds.push(mid);
        }
      }
    }
    if (!matterIds.length && cached && cached.matter_id) {
      matterIds = [cached.matter_id];
    }

    card.classList.add('aq-card-dismissing');
    try {
      await api.patch(
        '/api/v1/action-queue/' + encodeURIComponent(actionType) + '/' + encodeURIComponent(entityId) + '/acknowledge',
        {}
      );

      // Create a task on each related matter so it's trackable
      var taskDescription = sa && sa.action ? sa.action : (cached && cached.message ? cached.message : '');
      for (var t = 0; t < matterIds.length; t++) {
        try {
          await api.post('/api/v1/matters/' + encodeURIComponent(matterIds[t]) + '/tasks', {
            title: title || 'Action queue item',
            description: taskDescription || '',
            priority: (cached && cached.severity === 'critical') ? 'high' : (cached && cached.severity ? cached.severity : 'medium'),
            status: 'pending'
          });
        } catch (taskErr) {
          console.warn('[Dashboard] Could not create task for matter ' + matterIds[t] + ':', taskErr && taskErr.message);
        }
      }

      if (typeof Lex !== 'undefined' && Lex.Toast) {
        var toastMsg = matterIds.length > 0
          ? 'Accepted — task created on ' + matterIds.length + ' matter' + (matterIds.length > 1 ? 's' : '')
          : 'Accepted';
        Lex.Toast.show(toastMsg, 'success');
      }
      setTimeout(function () { renderZoneC(true); }, 350);
    } catch (err) {
      card.classList.remove('aq-card-dismissing');
      console.warn('[Dashboard] Accept failed:', err && err.message);
      if (typeof Lex !== 'undefined' && Lex.Toast) {
        Lex.Toast.show('Could not accept action', 'error');
      }
    }
  }

  /**
   * Handle assign-click — show priority picker then assign to Lana from Zone C.
   * Pre-selects priority based on alert severity, user can override.
   * @param {Element} card
   */
  function handleAssignClick(card) {
    var actionType = card.getAttribute('data-action-type') || 'alert';
    var entityId   = card.getAttribute('data-entity-id') || card.getAttribute('data-action-id');
    if (!entityId) return;

    // Pre-select priority from severity mapping
    var defaultPriority = card.getAttribute('data-priority') || 'medium';

    var modalContent =
      '<div style="margin-bottom:12px;">' +
        '<label style="display:block;font-size:var(--lex-form-font-size,0.8125rem);font-weight:var(--lex-weight-medium,500);color:var(--lex-text-primary);margin-bottom:6px;">Task Priority</label>' +
        '<select id="dashAssignPriority" style="width:100%;padding:8px 12px;font-family:inherit;font-size:var(--lex-form-font-size,0.8125rem);border:1px solid var(--lex-border-subtle,rgba(0,0,0,0.12));border-radius:var(--lex-input-radius,6px);background:var(--lex-bg-primary);color:var(--lex-text-primary);outline:none;">' +
          '<option value="urgent"' + (defaultPriority === 'urgent' ? ' selected' : '') + '>Urgent</option>' +
          '<option value="high"' + (defaultPriority === 'high' ? ' selected' : '') + '>High</option>' +
          '<option value="medium"' + (defaultPriority === 'medium' ? ' selected' : '') + '>Medium</option>' +
          '<option value="low"' + (defaultPriority === 'low' ? ' selected' : '') + '>Low</option>' +
        '</select>' +
        '<p style="font-size:0.6875rem;color:var(--lex-text-tertiary);margin-top:6px;">Higher priority tasks are executed sooner. Urgent and High start immediately.</p>' +
      '</div>';

    Lex.Modal.open({
      heading: 'Assign to Lana',
      content: modalContent,
      hideActions: false,
      confirmText: 'Assign',
      cancelText: 'Cancel',
      size: 'sm',
      onConfirm: function () {
        var priorityEl = document.getElementById('dashAssignPriority');
        var priority = priorityEl ? priorityEl.value : defaultPriority;

        card.classList.add('aq-card-dismissing');

        api.post(
          '/api/v1/action-queue/' + encodeURIComponent(actionType) + '/' + encodeURIComponent(entityId) + '/assign-to-lana',
          { priority: priority }
        ).then(function () {
          if (typeof Lex !== 'undefined' && Lex.Toast) {
            Lex.Toast.show('Queued (' + priority + ') — Lana is working on it', 'success');
          }
          setTimeout(function () { renderZoneC(true); }, 350);
        }).catch(function (queueErr) {
          card.classList.remove('aq-card-dismissing');
          console.warn('[Dashboard] Failed to assign to Lana:', queueErr && queueErr.message);
          if (typeof Lex !== 'undefined' && Lex.Toast) {
            var errMsg = queueErr && queueErr.message ? queueErr.message : '';
            var msg;
            if (errMsg.indexOf('Already assigned') !== -1) {
              msg = 'Already assigned to Lana';
            } else if (errMsg.indexOf('currently handling') !== -1) {
              msg = errMsg;
            } else {
              msg = 'Could not queue task — try again';
            }
            Lex.Toast.show(msg, 'error');
          }
        });
      }
    });
  }

  /**
   * Handle reject-click — open reject modal from Zone C.
   * @param {Element} card
   */
  function handleRejectClick(card) {
    var actionType = card.getAttribute('data-action-type') || 'alert';
    var entityId   = card.getAttribute('data-entity-id') || card.getAttribute('data-action-id');
    if (!entityId) return;

    var modalContent =
      '<div style="margin-bottom:12px;">' +
        '<label style="display:block;font-size:var(--lex-form-font-size,0.8125rem);font-weight:var(--lex-weight-medium,500);color:var(--lex-text-primary);margin-bottom:6px;">Reason for rejection</label>' +
        '<textarea id="dashRejectReason" rows="3" maxlength="500" placeholder="Why is this not relevant?" style="width:100%;padding:8px 12px;font-family:inherit;font-size:var(--lex-form-font-size,0.8125rem);border:1px solid var(--lex-border-subtle,rgba(0,0,0,0.12));border-radius:var(--lex-input-radius,6px);background:var(--lex-bg-primary);color:var(--lex-text-primary);resize:vertical;outline:none;"></textarea>' +
      '</div>' +
      '<div>' +
        '<label style="display:block;font-size:var(--lex-form-font-size,0.8125rem);font-weight:var(--lex-weight-medium,500);color:var(--lex-text-primary);margin-bottom:6px;">Suppress for</label>' +
        '<select id="dashRejectDays" style="padding:8px 12px;font-family:inherit;font-size:var(--lex-form-font-size,0.8125rem);border:1px solid var(--lex-border-subtle,rgba(0,0,0,0.12));border-radius:var(--lex-input-radius,6px);background:var(--lex-bg-primary);color:var(--lex-text-primary);outline:none;">' +
          '<option value="45">45 days</option>' +
          '<option value="60">60 days</option>' +
        '</select>' +
      '</div>';

    Lex.Modal.open({
      heading: 'Reject Action',
      content: modalContent,
      hideActions: false,
      confirmText: 'Reject',
      cancelText: 'Cancel',
      variant: 'danger',
      size: 'sm',
      onConfirm: function () {
        var reasonEl = document.getElementById('dashRejectReason');
        var daysEl   = document.getElementById('dashRejectDays');
        var reason   = reasonEl ? reasonEl.value.trim() : '';
        var days     = daysEl ? parseInt(daysEl.value, 10) : 45;

        if (!reason) {
          if (typeof Lex !== 'undefined' && Lex.Toast) {
            Lex.Toast.show('Please provide a reason', 'error');
          }
          return;
        }

        api.patch(
          '/api/v1/action-queue/' + encodeURIComponent(actionType) + '/' + encodeURIComponent(entityId) + '/reject',
          { reason: reason, suppression_days: days }
        ).then(function () {
          if (typeof Lex !== 'undefined' && Lex.Toast) {
            Lex.Toast.show('Rejected — won\'t resurface for ' + days + ' days', 'success');
          }
          renderZoneC(true);
        }).catch(function (err) {
          console.warn('[Dashboard] Reject failed:', err && err.message);
          if (typeof Lex !== 'undefined' && Lex.Toast) {
            Lex.Toast.show('Could not reject action', 'error');
          }
        });
      }
    });
  }

  // =========================================================================
  // Event wiring
  // =========================================================================

  /**
   * Wire all interactive elements once the DOM is rendered.
   */
  function wireEvents() {

    // Zone A — Matters button (navigates to matters or create-matter flow)
    var mattersBtn = el('ccZoneAMatters');
    if (mattersBtn) {
      mattersBtn.addEventListener('click', function () {
        var countEl = el('ccZoneAMattersCount');
        var count   = countEl ? parseInt(countEl.textContent, 10) : 0;
        if (!isNaN(count) && count > 0) {
          Lex.Nav.go('workspaces.html');
        } else {
          Lex.Nav.go('workspaces.html', {
            params:  { action: 'create' },
            context: { action: 'create' }
          });
        }
      });
    }

    // Refresh activity feed button — uses Lex.Redact for in-page skeleton shimmer
    var refreshBtn = el('refreshActivityFeedBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        refreshBtn.loading = true;

        // Redact both activity areas while new data loads
        var heatmapArea = document.querySelector('.cc-activity-split__heatmap');
        var feedArea    = document.querySelector('.cc-activity-split__feed');
        Lex.Redact.on(heatmapArea);
        Lex.Redact.on(feedArea);

        var filterSelect = el('activityUserFilter');
        var val          = filterSelect ? filterSelect.value : 'me';

        var reload;
        if (val === 'all') {
          reload = Promise.allSettled([loadOrganizationProductivity(), loadOrganizationActivity()]);
        } else if (val !== 'me' && val) {
          reload = Promise.allSettled([loadUserProductivity(val), loadActivityForUser(val)]);
        } else {
          reload = Promise.allSettled([loadUserProductivity(null), loadActivityForUser(null)]);
        }
        reload.then(function () {
          refreshBtn.loading = false;
          Lex.Redact.off(heatmapArea);
          Lex.Redact.off(feedArea);
        });
      });
    }

    // View all activity (opens slide-out panel)
    var viewAllBtn = el('viewAllActivityHeaderBtn');
    if (viewAllBtn) {
      viewAllBtn.addEventListener('click', function () {
        if (typeof ActivityPanel !== 'undefined') ActivityPanel.open();
      });
    }

    // Zone C — View all action queue
    var zoneCViewAll = el('ccZoneCViewAll');
    if (zoneCViewAll) {
      zoneCViewAll.addEventListener('click', function () {
        Lex.Nav.go('action-queue.html');
      });
    }

    // Zone D — View all my tasks
    var zoneDViewAll = el('ccZoneDViewAll');
    if (zoneDViewAll) {
      zoneDViewAll.addEventListener('click', function () {
        Lex.Nav.go('my-tasks.html');
      });
    }

    // Zone D — silent polling every 30s
    _intervals.push(setInterval(function () {
      if (document.hidden) return;
      renderZoneD();
    }, 30000));

    // Activity heatmap info modal
    var heatmapInfoBtn = el('activityHeatmapInfoBtn');
    var heatmapModal   = el('activityHeatmapInfoModal');
    if (heatmapInfoBtn && heatmapModal) {
      heatmapInfoBtn.addEventListener('click', function () {
        heatmapModal.open = true;
      });
    }

    // Add button → navigate to connectors page
    var addWidgetBtn = el('addWidgetBtn');
    if (addWidgetBtn) {
      addWidgetBtn.addEventListener('click', function () {
        Lex.Nav.go('data-connectors.html');
      });
    }

    // Zone E — metric card click → toggle detail panel
    var zoneE = el('ccZoneE');
    if (zoneE) {
      zoneE.addEventListener('click', function (e) {
        var metric = e.target.closest('lex-metric[data-metric-key]');
        if (!metric) return;
        toggleDetailPanel(metric.getAttribute('data-metric-key'));
      });
    }

    // Detail panel action button → SPA navigation
    var detailPanel = el('ccDetailPanel');
    if (detailPanel) {
      detailPanel.addEventListener('detail-action', function (e) {
        var href = e.detail && e.detail.href;
        if (href) Lex.Nav.go(href);
      });
    }

    // Zone C — action card click (Lana vs human action routing)
    var zoneCContent = el('ccZoneCContent');
    if (zoneCContent) {
      zoneCContent.addEventListener('action-click', function (e) {
        var card = e.target.closest('lex-action-card[data-action-id]');
        if (!card) return;

        var itemId = card.getAttribute('data-action-id');
        var cached = itemId ? _actionItemsMap[itemId] : null;
        if (cached) {
          showActionDetail(cached);
        }
      });

      // Feedback: Accept
      zoneCContent.addEventListener('accept-click', function (e) {
        var card = e.target.closest('lex-action-card[data-action-id]');
        if (card) handleAcceptClick(card);
      });

      // Feedback: Assign to Lana
      zoneCContent.addEventListener('assign-click', function (e) {
        var card = e.target.closest('lex-action-card[data-action-id]');
        if (card) handleAssignClick(card);
      });

      // Feedback: Reject
      zoneCContent.addEventListener('reject-click', function (e) {
        var card = e.target.closest('lex-action-card[data-action-id]');
        if (card) handleRejectClick(card);
      });
    }

    // Zone C — silent polling every 60s (skip when tab is hidden)
    _intervals.push(setInterval(function () {
      if (document.hidden) return;
      renderZoneC(true);
    }, 60000));
  }

  // =========================================================================
  // Page lifecycle — onLeave cleanup (Finding 7)
  // =========================================================================

  /**
   * Clean up all tracked resources when navigating away from the dashboard.
   * Clears timeouts, intervals, document listeners, and window globals.
   */
  function onLeave() {
    // Stop heartbeat polling
    if (typeof LanaHeartbeat !== 'undefined') LanaHeartbeat.stop();

    // Clear tracked timeouts and intervals
    _timeouts.forEach(clearTimeout);
    _intervals.forEach(clearInterval);
    _timeouts = [];
    _intervals = [];

    // Remove tracked document listeners
    _documentListeners.forEach(function (entry) {
      document.removeEventListener(entry.event, entry.handler);
    });
    _documentListeners = [];

    // Remove tracked window globals
    _globalFns.forEach(function (name) {
      delete window[name];
    });
    _globalFns = [];
  }

  // =========================================================================
  // Run — register with router for SPA re-navigation support
  // =========================================================================

  // Standalone page — init directly (no SPA router)
  initDashboard();

})();
