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
  var formatBytes    = Lex.Utils.formatFileSize;
  var isAdmin        = Lex.Auth.isAdmin;
  var canViewStatus  = Lex.Auth.canViewSystemStatus;

  /** Which detail panel is currently expanded: 'team' | 'docs' | 'storage' | null */
  var activeDetailKey = null;

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
   * Uses toLocaleDateString — no regex.
   * @param {Date} now
   * @returns {string}
   */
  function formatTodayDate(now) {
    return now.toLocaleDateString('en-US', {
      weekday: 'long',
      year:    'numeric',
      month:   'long',
      day:     'numeric'
    });
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
   * Render the top-5 action queue items, sorted by severity.
   * @returns {Promise<void>}
   */
  async function renderZoneC() {
    var loadingEl = el('ccZoneCLoading');
    var contentEl = el('ccZoneCContent');
    if (!contentEl) return;

    var items = [];

    try {
      var result = await api.get('/api/v1/action-queue?limit=5&sort_by=severity&sort_order=desc');
      items = (result && (result.items || result.actions || result.data)) || [];
    } catch (err) {
      console.warn('[Dashboard Zone C] Could not load action queue:', err && err.message);
    }

    if (loadingEl) hide(loadingEl);

    if (items.length === 0) {
      contentEl.innerHTML =
        '<lex-empty icon="inbox" message="No actions pending" description="Your action queue is empty"></lex-empty>';
      show(contentEl);
      return;
    }

    var html = '';
    for (var i = 0; i < items.length; i++) {
      var item     = items[i];
      var sev      = item.severity || item.priority || 'low';
      var title    = escHtml(item.title || item.name || item.description || 'Untitled');
      var matter   = escHtml(item.matter_name || item.matter || '');
      var ts       = item.due_date || item.created_at || null;
      var meta     = [];
      if (matter) meta.push(matter);
      if (ts)     meta.push(escHtml(timeAgo(ts)));
      var metaStr  = meta.join(' \u00b7 ');
      var priority = (sev === 'critical' || sev === 'high') ? 'high' : (sev === 'medium' ? 'medium' : 'low');

      html +=
        '<lex-action-card' +
          ' title="' + title + '"' +
          ' description="' + escHtml(metaStr) + '"' +
          ' priority="' + priority + '"' +
          ' data-action-id="' + escHtml(String(item.id || '')) + '"' +
        '></lex-action-card>';
    }
    contentEl.innerHTML = html;
    show(contentEl);
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
      var deletedFiles = parseInt(storageStats.deleted_files || 0, 10);
      docsCount = (totalFiles + deletedFiles).toLocaleString();
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
        Lex.Nav.go('integrations/data_connectors.html');
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
    var ts   = activity.activity_timestamp || activity.timestamp;
    var time = ts ? new Date(ts).toLocaleString() : '-';

    var displayMessage;
    if (typeof EventDisplayNames !== 'undefined') {
      displayMessage = EventDisplayNames.getEventDisplayName(
        activity.event_type,
        activity.display_message
      );
    } else {
      displayMessage = activity.display_message || activity.event_type || 'Activity';
    }

    var meta = time;
    if (showUser && activity.user) {
      var userName = ((activity.user.first_name || '') + ' ' + (activity.user.last_name || '')).trim();
      if (userName) meta = escHtml(userName) + ' &bull; ' + escHtml(time);
    } else {
      meta = escHtml(time);
    }

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
            '<p class="text-xs lex-text-tertiary mt-0.5">' + meta + '</p>' +
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
      docs:    { heading: 'Recent Documents',  actionLabel: 'Go to My Drive',     actionHref: 'drive.html' },
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

      // Most Active section — users with events in last 30 days
      if (active.length > 0) {
        var topActive = active.slice(0, 3);
        html +=
          '<lex-text variant="tertiary" size="overline" weight="semibold" tag="div" style="margin-bottom:0.5rem;">Most Active — last 30 days</lex-text>';
        html += buildUserRows(topActive);
      }

      // Needs Attention section — users with 0 events in last 30 days
      if (inactive.length > 0) {
        var topInactive = inactive.slice(0, 3);
        html +=
          '<lex-text variant="tertiary" size="overline" weight="semibold" tag="div" style="margin-bottom:0.5rem;' + (active.length > 0 ? 'margin-top:0.75rem;' : '') + '">Needs Attention</lex-text>';
        html += buildUserRows(topInactive);

        // Overflow message for remaining inactive users
        if (inactive.length > 3) {
          var remaining = inactive.length - 3;
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
   * Source: /api/v1/storage/recent?limit=5 (cross-matter, based on file_activity)
   * Shows 5 most recently accessed documents with filename, matter name, timestamp.
   * @param {Element} panel
   * @returns {Promise<void>}
   */
  async function renderDocsDetail(panel) {
    var content = panel.querySelector('.lex-detail-panel__content');
    if (!content) return;

    content.innerHTML = '<div class="py-4 text-center"><lex-spinner size="sm"></lex-spinner></div>';

    try {
      var result = await api.get('/api/v1/storage/recent?limit=5');
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

        html +=
          '<div class="cc-detail-doc-row">' +
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
      loadActivityForUser(null)   // 4 — activity feed
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
        // Navigate to action queue page when it exists
        // For now route to workspaces as a fallback
        Lex.Nav.go('workspaces.html');
      });
    }

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
        Lex.Nav.go('integrations/data_connectors.html');
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

    // Zone C — action card click
    var zoneCContent = el('ccZoneCContent');
    if (zoneCContent) {
      zoneCContent.addEventListener('action-click', function (e) {
        var card = e.target.closest('lex-action-card[data-action-id]');
        if (card) {
          var actionId = card.getAttribute('data-action-id');
          // TODO: navigate to action detail when page exists
          console.log('[Dashboard] Zone C action clicked:', actionId);
        }
      });
    }
  }

  // =========================================================================
  // Page lifecycle — onLeave cleanup (Finding 7)
  // =========================================================================

  /**
   * Clean up all tracked resources when navigating away from the dashboard.
   * Clears timeouts, intervals, document listeners, and window globals.
   */
  function onLeave() {
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

  // registerPageInit ensures initDashboard() is called on every navigation
  // to this page (first load + re-navigation from cached scripts).
  // registerView only carries onLeave for cleanup — onEnter is handled
  // by registerPageInit to avoid double-init.
  if (window.LexRouter) {
    LexRouter.registerPageInit('dashboard.html', function () {
      LexRouter.registerView({ onLeave: onLeave });
      initDashboard();
    });
  } else {
    // Fallback for non-SPA contexts (should not happen in normal flow)
    initDashboard();
  }

})();
