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
   * @param {number|string} matterCount - Visible matters count
   */
  function updateZoneAPills(matterCount) {
    var mattersBtn     = el('ccZoneAMatters');
    var mattersCountEl = el('ccZoneAMattersCount');
    if (!mattersBtn) return;

    var count = parseInt(String(matterCount), 10);
    var hasMatters = !isNaN(count) && count > 0;

    if (hasMatters) {
      mattersBtn.variant = 'secondary';
      if (mattersCountEl) {
        mattersCountEl.textContent = String(matterCount);
        mattersCountEl.style.display = '';
      }
      // Replace text nodes after the span
      var lastText = mattersBtn.lastChild;
      if (lastText && lastText.nodeType === 3) {
        lastText.textContent = ' active matters';
      }
    } else {
      mattersBtn.variant = 'primary';
      if (mattersCountEl) mattersCountEl.style.display = 'none';
      // Replace text to "Create a new matter"
      var lastText2 = mattersBtn.lastChild;
      if (lastText2 && lastText2.nodeType === 3) {
        lastText2.textContent = 'Create a new matter';
      }
    }
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
  // Zone D — Lana Tasks (live status)
  // =========================================================================

  /**
   * Status dot color for a Lana task status.
   * @param {string} status
   * @returns {string} CSS color value
   */
  function lanaTaskStatusColor(status) {
    if (status === 'running' || status === 'compiling_context') return '#3b82f6';
    if (status === 'awaiting_input')    return '#f59e0b';
    if (status === 'awaiting_approval') return '#f59e0b';
    if (status === 'completed')         return '#10b981';
    if (status === 'failed')            return '#ef4444';
    if (status === 'rejected')          return '#ef4444';
    if (status === 'cancelled')         return '#6b7280';
    return '#9ca3af';
  }

  /**
   * Human-readable label for a Lana task status.
   * @param {string} status
   * @returns {string}
   */
  function lanaTaskStatusLabel(status) {
    if (!status) return 'Pending';
    if (status === 'compiling_context') return 'Compiling...';
    if (status === 'running')           return 'Running';
    if (status === 'awaiting_input')    return 'Needs Input';
    if (status === 'awaiting_approval') return 'Pending Approval';
    if (status === 'completed')         return 'Completed';
    if (status === 'failed')            return 'Failed';
    if (status === 'rejected')          return 'Rejected';
    if (status === 'cancelled')         return 'Cancelled';
    return status;
  }

  /**
   * Render Lana Tasks zone — shows up to 5 active/recent Lana tasks.
   * @returns {Promise<void>}
   */
  async function renderZoneD() {
    var loadingEl = el('ccZoneDLoading');
    var contentEl = el('ccZoneDContent');
    if (!contentEl) return;

    var tasks = [];

    try {
      var result = await api.get('/api/v1/agentic-tasks?limit=5&sort_by=created_at&sort_order=desc');
      tasks = (result && result.data) || [];
    } catch (err) {
      console.warn('[Dashboard Zone D] Could not load Lana tasks:', err && err.message);
    }

    if (loadingEl) hide(loadingEl);

    if (tasks.length === 0) {
      contentEl.innerHTML =
        '<lex-empty icon="zap" message="No Lana tasks yet" description="Assign actions to Lana from the action queue"></lex-empty>';
      show(contentEl);
      return;
    }

    var html = '';
    for (var i = 0; i < tasks.length; i++) {
      var task = tasks[i];
      var status = task.execution_status || 'pending';
      var dotColor = lanaTaskStatusColor(status);
      var statusText = escHtml(lanaTaskStatusLabel(status));
      var title = escHtml(task.name || 'Untitled task');
      var ts = task.created_at ? escHtml(timeAgo(task.created_at)) : '';

      html +=
        '<div class="cc-lana-task-row" data-task-id="' + escHtml(task.id) + '" ' +
          'style="padding:10px 12px;cursor:pointer;transition:background 0.15s ease;' +
          'border-bottom:1px solid var(--lex-border-subtle, rgba(0,0,0,0.06));" ' +
          'onmouseenter="this.style.background=\'var(--lex-bg-secondary)\'" onmouseleave="this.style.background=\'transparent\'">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
            '<div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">' +
              '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + dotColor + ';flex-shrink:0;' +
                ((status === 'running' || status === 'compiling_context') ? 'animation:cc-pulse 1.5s ease-in-out infinite;' : '') +
              '"></span>' +
              '<span style="font-size:0.8125rem;color:var(--lex-text-primary);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + title + '</span>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">' +
              '<span style="font-size:0.6875rem;color:var(--lex-text-tertiary);">' + statusText + '</span>' +
              (ts ? '<span style="font-size:0.6875rem;color:var(--lex-text-tertiary);">' + ts + '</span>' : '') +
            '</div>' +
          '</div>' +
        '</div>';
    }

    contentEl.innerHTML = html;
    show(contentEl);

    // Wire click → navigate to task detail
    var rows = contentEl.querySelectorAll('.cc-lana-task-row');
    for (var j = 0; j < rows.length; j++) {
      rows[j].addEventListener('click', function () {
        var taskId = this.getAttribute('data-task-id');
        if (taskId) Lex.Nav.go('agentic-task-detail.html', { params: { id: taskId } });
      });
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
        mattersCount = (stats.total_matters !== undefined)
          ? Number(stats.total_matters).toLocaleString()
          : '-';
        usersCount = (stats.total_users !== undefined)
          ? Number(stats.total_users).toLocaleString()
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
      Lex.Nav.go('storage.html', { params: { tab: 'orphaned' } });
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
      docs:    { heading: 'Recent Documents',  actionLabel: 'View all documents', actionHref: 'storage.html?view=documents' },
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
   * Build user rows HTML for the team detail panel.
   * Each user object must have: first_name, last_name, email, role_name.
   * @param {Array} users
   * @returns {string}
   */
  function buildUserRows(users) {
    var html = '';
    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      var fullName = ((u.first_name || '') + ' ' + (u.last_name || '')).trim() || u.email || 'Unknown';
      var initial = fullName.charAt(0).toUpperCase();
      var role = u.role_name || '';
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
      var result = await api.get('/api/v1/storage/recent?limit=10');
      var docs = (result && (result.files || result.documents || result.data)) || [];

      if (docs.length === 0) {
        content.innerHTML = '<lex-empty icon="folder" message="No documents yet" description="Upload your first document to get started"></lex-empty>';
        return;
      }

      var html = '<div>';
      for (var i = 0; i < docs.length; i++) {
        var d = docs[i];
        var name = d.filename || d.original_name || d.file_name || d.name || 'Untitled';
        var matter = d.client_matter || d.matter_name || '';
        var ts = (d.last_accessed_at || d.created_at) ? timeAgo(d.last_accessed_at || d.created_at) : '';

        var fileId   = d.id || '';
        var matterId = d.client_matter || d.matter_id || '';

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

    // Zone D — View all Lana tasks
    var zoneDViewAll = el('ccZoneDViewAll');
    if (zoneDViewAll) {
      zoneDViewAll.addEventListener('click', function () {
        Lex.Nav.go('agentic-tasks.html');
      });
    }

    // Zone D — silent polling every 30s (tasks may change status frequently)
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
