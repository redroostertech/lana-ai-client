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
    var results = await Promise.allSettled([
      orgId && canViewStatus()
        ? api.getOrganizationStats(orgId)
        : api.getMatters(1, 1),
      canViewStatus()
        ? api.get('/api/v1/storage/stats')
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

    // Storage result
    if (results[1].status === 'fulfilled' && results[1].value) {
      storageStats = results[1].value;
      var totalFiles   = parseInt(storageStats.total_files   || 0, 10);
      var deletedFiles = parseInt(storageStats.deleted_files || 0, 10);
      docsCount = (totalFiles + deletedFiles).toLocaleString();
      if (storageStats.total_size_bytes) {
        storageStr = formatBytes(storageStats.total_size_bytes);
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
   * Render connector status rows in the Data Pulse panel.
   * Fetches connector-status widgets then resolves their batch data.
   * @returns {Promise<void>}
   */
  async function renderZoneFRight() {
    var loadingEl = el('ccZoneFRightLoading');
    var contentEl = el('ccZoneFRightContent');
    if (!contentEl) return;

    var connectors = [];

    try {
      var widgetsResult = await api.getDashboardWidgets({ widget_type: 'connector_status' });
      var widgets = (widgetsResult && (widgetsResult.widgets || widgetsResult.data || widgetsResult)) || [];
      if (!Array.isArray(widgets)) widgets = [];

      if (widgets.length > 0) {
        var ids = [];
        for (var i = 0; i < widgets.length; i++) {
          if (widgets[i].id) ids.push(widgets[i].id);
        }

        if (ids.length > 0) {
          try {
            var batchResult = await api.getDashboardWidgetsBatchData(ids);
            var batchData   = (batchResult && batchResult.data) || batchResult || {};

            for (var j = 0; j < widgets.length; j++) {
              var w   = widgets[j];
              var raw = batchData[w.id] || {};
              connectors.push({
                name:   w.title || (w.config && w.config.connector_name) || 'Connector',
                status: raw.status || raw.connector_status || (w.config && w.config.status) || 'unknown',
                last:   raw.last_sync_at || raw.last_synced_at || null
              });
            }
          } catch (batchErr) {
            console.warn('[Dashboard Zone F] Batch data failed, using widget metadata:', batchErr && batchErr.message);
            for (var k = 0; k < widgets.length; k++) {
              var ww = widgets[k];
              connectors.push({
                name:   ww.title || (ww.config && ww.config.connector_name) || 'Connector',
                status: (ww.config && ww.config.status) || 'unknown',
                last:   null
              });
            }
          }
        }
      }
    } catch (err) {
      console.warn('[Dashboard Zone F] Could not load connector widgets:', err && err.message);
    }

    if (loadingEl) hide(loadingEl);

    if (connectors.length === 0) {
      contentEl.innerHTML =
        '<lex-empty icon="folder" message="No connectors configured" description="Visit Integrations to add your first connector"></lex-empty>';
      show(contentEl);
      return;
    }

    var html = '';
    for (var n = 0; n < connectors.length; n++) {
      var c       = connectors[n];
      var dotCls  = connectorDotClass(c.status);
      var label   = escHtml(connectorStatusLabel(c.status));
      var cName   = escHtml(c.name);
      var lastStr = c.last ? escHtml(timeAgo(c.last)) : '';

      html +=
        '<div class="cc-connector-row">' +
          '<span class="cc-connector-row__name">' + cName + '</span>' +
          '<div class="flex items-center gap-1.5">' +
            (lastStr ? '<span class="cc-connector-row__label">' + lastStr + '</span>' : '') +
            '<div class="cc-connector-row__dot ' + dotCls + '" title="' + label + '"></div>' +
          '</div>' +
        '</div>';
    }
    contentEl.innerHTML = html;
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
  window.closeActivityHeatmapInfoModal = function () {
    var modal = el('activityHeatmapInfoModal');
    if (modal) modal.open = false;
  };

  // =========================================================================
  // Page-specific navigation helpers
  // =========================================================================

  /** Navigate to orphaned documents page (respects admin vs standard path). */
  window.navigateToOrphans = function () {
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
  };

  // =========================================================================
  // Dashboard initialization — entry point
  // =========================================================================

  /**
   * Initialize the Command Center dashboard.
   * Loads user profile first, then fans out to all six zones in parallel
   * using Promise.allSettled for graceful degradation.
   */
  async function initDashboard() {

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
    setTimeout(function () {
      if (typeof WidgetRenderer !== 'undefined') {
        WidgetRenderer.init();
      }
    }, 500);
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

    // Add Widget button (opens WidgetConfigModal when available)
    var addWidgetBtn = el('addWidgetBtn');
    if (addWidgetBtn) {
      addWidgetBtn.addEventListener('click', function () {
        if (typeof WidgetConfigModal !== 'undefined') {
          WidgetConfigModal.open();
        }
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
  // Run
  // =========================================================================

  initDashboard();

})();
