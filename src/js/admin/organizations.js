/* Organization Details — Page Controller
   SPA page fragment loaded by lex-router after admin/organizations.html
   is injected into the content area.

   Zones:
     A  Page Banner          — org name, slug, status badge, action slot
     B  Quota Metrics        — users and matters progress bars
     C  Organization Info    — ID, tier, created, updated (key-value pairs)

   Rules:
     - NO regex anywhere — string methods only (includes, indexOf, split, etc.)
     - IIFE wrapper — no top-level const/class/let leaking to window scope
     - registerPageInit before init() — enables SPA re-navigation
     - Lex.Nav.go() for all navigation — never window.location.href
     - Lex.Utils.formatDate() for date formatting
     - Lex.Toast.error() for error notifications
     - Lex.Redact.on/off for loading shimmer — no manual skeleton divs
     - Lex.Utils.escapeHtml() for all user-supplied text rendered as HTML
     - Lex design tokens only in CSS — no hardcoded color values in JS
*/

(function () {
  'use strict';

  // =========================================================================
  // Lex aliases
  // =========================================================================

  var escHtml    = Lex.Utils.escapeHtml;
  var formatDate = Lex.Utils.formatDate;

  // =========================================================================
  // DOM helpers
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
   * Show an element by removing its 'hidden' class.
   * @param {Element|string} target
   */
  function show(target) {
    var elem = typeof target === 'string' ? el(target) : target;
    if (elem) elem.classList.remove('hidden');
  }

  /**
   * Hide an element by adding its 'hidden' class.
   * @param {Element|string} target
   */
  function hide(target) {
    var elem = typeof target === 'string' ? el(target) : target;
    if (elem) elem.classList.add('hidden');
  }

  // =========================================================================
  // Status helpers
  // =========================================================================

  /**
   * Map an organization status string to a lex-badge color.
   * No regex — uses string comparison only.
   * @param {string} status
   * @returns {string} Lex badge color: 'green' | 'red' | 'yellow' | 'gray'
   */
  function statusBadgeColor(status) {
    if (!status) return 'gray';
    var s = String(status).toLowerCase();
    if (s === 'active')    return 'green';
    if (s === 'suspended') return 'red';
    if (s === 'trial')     return 'yellow';
    if (s === 'inactive')  return 'gray';
    return 'gray';
  }

  /**
   * Produce a display label from a status string.
   * Capitalizes the first character without regex.
   * @param {string} status
   * @returns {string}
   */
  function statusLabel(status) {
    if (!status) return 'Unknown';
    var s = String(status);
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }

  /**
   * Produce a display label for a subscription tier.
   * Capitalizes the first character without regex.
   * @param {string} tier
   * @returns {string}
   */
  function tierLabel(tier) {
    if (!tier) return 'Standard';
    var t = String(tier);
    return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  }

  /**
   * Calculate the quota fill percentage (capped 0–100).
   * @param {number} used
   * @param {number|null} limit
   * @returns {number} 0–100
   */
  function quotaPercent(used, limit) {
    if (!limit || limit <= 0) return 0;
    var pct = Math.round((used / limit) * 100);
    if (pct < 0)   return 0;
    if (pct > 100) return 100;
    return pct;
  }

  /**
   * Choose a CSS modifier class for the quota fill bar based on the percentage.
   * Below 75%: default (blue). 75–90%: warning. Above 90%: danger.
   * @param {number} pct
   * @returns {string} Extra class name to apply (or empty string)
   */
  function quotaFillClass(pct) {
    if (pct > 90) return 'org-quota-bar__fill--danger';
    if (pct > 75) return 'org-quota-bar__fill--warning';
    return '';
  }

  /**
   * Build a human-readable quota label: "4 of 10 used" or "4 used" if no limit.
   * No regex — uses string concatenation only.
   * @param {number} used
   * @param {number|null} limit
   * @returns {string}
   */
  function quotaLabel(used, limit) {
    if (!limit || limit <= 0) {
      return String(used) + ' used';
    }
    return String(used) + ' of ' + String(limit) + ' used';
  }

  // =========================================================================
  // Rendering functions
  // =========================================================================

  /**
   * Render the page banner (Zone A).
   * Sets heading to org name, subtitle to slug if present, and injects a
   * status badge into the action slot.
   * @param {Object} org - Organization record from API
   */
  function _renderBanner(org) {
    var banner = el('orgBanner');
    if (!banner) return;

    var name = org.name || 'Organization';
    var slug = org.slug ? ('@' + org.slug) : '';

    banner.heading  = escHtml(name);
    banner.subtitle = escHtml(slug);

    // Inject status badge into the action slot
    var actionsSlot = el('orgBannerActions');
    if (actionsSlot) {
      var status = org.status || 'active';
      var badgeColor = statusBadgeColor(status);
      var badgeLabel = statusLabel(status);
      actionsSlot.innerHTML =
        '<lex-badge label="' + escHtml(badgeLabel) + '" color="' + escHtml(badgeColor) + '"></lex-badge>';
    }
  }

  /**
   * Render the quota metric cards with progress bars (Zone B).
   * Updates lex-metric values, progress bar widths, aria attributes,
   * and quota label text for both users and matters.
   * @param {Object} org   - Organization record (may contain max_users, max_matters)
   * @param {Object} stats - Stats record (may contain user_count, matter_count)
   */
  function _renderQuotas(org, stats) {
    // Safely extract counts: prefer stats, fall back to org fields
    var userCount   = parseInt(String((stats && stats.user_count)   || (org && org.user_count)   || 0), 10);
    var matterCount = parseInt(String((stats && stats.matter_count) || (org && org.matter_count) || 0), 10);

    // Safely extract limits: prefer org fields, fall back to stats
    var userLimit   = parseInt(String((org && org.max_users)   || (stats && stats.max_users)   || 0), 10) || null;
    var matterLimit = parseInt(String((org && org.max_matters) || (stats && stats.max_matters) || 0), 10) || null;

    // -- Users metric --
    var metricUsers    = el('metricUsers');
    var userFill       = el('userQuotaFill');
    var userFillTrack  = userFill && userFill.parentElement;
    var userLabelEl    = el('userQuotaLabel');
    var userPct        = quotaPercent(userCount, userLimit);
    var userFillCls    = quotaFillClass(userPct);
    var userMetricStat = userPct > 90 ? 'red' : (userPct > 75 ? 'yellow' : 'blue');

    if (metricUsers) {
      metricUsers.value  = String(userCount);
      metricUsers.status = userMetricStat;
    }
    if (userFill) {
      userFill.style.width = String(userPct) + '%';
      // Reset modifier classes then apply the appropriate one
      userFill.classList.remove('org-quota-bar__fill--warning', 'org-quota-bar__fill--danger');
      if (userFillCls) userFill.classList.add(userFillCls);
    }
    if (userFillTrack) {
      userFillTrack.setAttribute('aria-valuenow', String(userPct));
    }
    if (userLabelEl) {
      userLabelEl.textContent = quotaLabel(userCount, userLimit);
    }

    // -- Matters metric --
    var metricMatters   = el('metricMatters');
    var matterFill      = el('matterQuotaFill');
    var matterFillTrack = matterFill && matterFill.parentElement;
    var matterLabelEl   = el('matterQuotaLabel');
    var matterPct       = quotaPercent(matterCount, matterLimit);
    var matterFillCls   = quotaFillClass(matterPct);
    var matterMetricStat = matterPct > 90 ? 'red' : (matterPct > 75 ? 'yellow' : 'blue');

    if (metricMatters) {
      metricMatters.value  = String(matterCount);
      metricMatters.status = matterMetricStat;
    }
    if (matterFill) {
      matterFill.style.width = String(matterPct) + '%';
      matterFill.classList.remove('org-quota-bar__fill--warning', 'org-quota-bar__fill--danger');
      if (matterFillCls) matterFill.classList.add(matterFillCls);
    }
    if (matterFillTrack) {
      matterFillTrack.setAttribute('aria-valuenow', String(matterPct));
    }
    if (matterLabelEl) {
      matterLabelEl.textContent = quotaLabel(matterCount, matterLimit);
    }
  }

  /**
   * Render the organization information key-value pairs (Zone C).
   * Uses Lex.Utils.formatDate() for all date formatting.
   * All user-supplied strings are set via .value property (component escapes internally).
   * @param {Object} org - Organization record from API
   */
  function _renderInfo(org) {
    var kvId      = el('kvOrgId');
    var kvTier    = el('kvOrgTier');
    var kvCreated = el('kvOrgCreated');
    var kvUpdated = el('kvOrgUpdated');

    if (kvId)      kvId.value      = String(org.id || '-');
    if (kvTier)    kvTier.value    = tierLabel(org.tier || 'standard');
    if (kvCreated) kvCreated.value = org.created_at ? formatDate(org.created_at) : '-';
    if (kvUpdated) kvUpdated.value = org.updated_at ? formatDate(org.updated_at) : '-';
  }

  /**
   * Show the error state and hide the main zones.
   * Displays a toast notification and reveals the lex-empty error panel.
   * @param {Error} err
   */
  function _showError(err) {
    var banner    = el('orgBanner');
    var quotaGrid = el('orgQuotaGrid');
    var infoCard  = el('orgInfoCard');
    var errorState = el('orgErrorState');

    // Remove shimmer from all zones before hiding them
    if (banner)    Lex.Redact.off(banner);
    if (quotaGrid) Lex.Redact.off(quotaGrid);
    if (infoCard)  Lex.Redact.off(infoCard);

    // Hide data zones
    if (banner)    hide(banner);
    if (quotaGrid) hide(quotaGrid);
    if (infoCard)  hide(infoCard);

    // Show error panel
    if (errorState) show(errorState);

    // Notify user via toast
    Lex.Toast.error(
      (err && err.message)
        ? 'Failed to load organization: ' + err.message
        : 'Failed to load organization details'
    );

    console.warn('[Organizations] Load failed:', err && err.message);
  }

  // =========================================================================
  // Data loading
  // =========================================================================

  /**
   * Fetch organization data and stats in parallel, then render all zones.
   * Uses Lex.Redact shimmer during fetch. Gracefully degrades if stats fail.
   * @param {string} orgId
   * @returns {Promise<void>}
   */
  async function _loadOrganization(orgId) {
    var banner     = el('orgBanner');
    var quotaGrid  = el('orgQuotaGrid');
    var infoCard   = el('orgInfoCard');
    var errorState = el('orgErrorState');

    // Hide any prior error state on reload
    if (errorState) hide(errorState);

    // Reveal all data zones (may have been hidden by a prior error)
    if (banner)    show(banner);
    if (quotaGrid) show(quotaGrid);
    if (infoCard)  show(infoCard);

    // Apply shimmer loading state to all three zones simultaneously
    if (banner)    Lex.Redact.on(banner);
    if (quotaGrid) Lex.Redact.on(quotaGrid);
    if (infoCard)  Lex.Redact.on(infoCard);

    try {
      // Fetch org details and stats in parallel.
      // Stats endpoint gracefully degrades to empty object on failure so that
      // the rest of the page can still render with the org record data.
      var results = await Promise.all([
        window.api.getOrganization(orgId),
        window.api.getOrganizationStats(orgId).catch(function (statsErr) {
          console.warn('[Organizations] Stats fetch failed (non-fatal):', statsErr && statsErr.message);
          return {};
        })
      ]);

      var rawOrg   = results[0];
      var rawStats = results[1];

      // Normalize: API may return { organization: {...} } or the record directly
      var org   = (rawOrg && rawOrg.organization) ? rawOrg.organization : rawOrg;
      var stats = rawStats || {};

      // Render all zones
      _renderBanner(org);
      _renderQuotas(org, stats);
      _renderInfo(org);

    } catch (err) {
      _showError(err);
      return; // skip finally Redact.off — _showError handles it

    } finally {
      // Remove shimmer regardless of success or error.
      // _showError also calls Redact.off, but calling it twice is idempotent.
      if (banner)    Lex.Redact.off(banner);
      if (quotaGrid) Lex.Redact.off(quotaGrid);
      if (infoCard)  Lex.Redact.off(infoCard);
    }
  }

  // =========================================================================
  // Page entry point
  // =========================================================================

  /**
   * Initialize the Organization Details page.
   * Reads the current user's organization ID from Lex.Auth, defers if auth
   * has not yet resolved, then kicks off the data load.
   */
  function init() {
    var user = Lex.Auth.user;

    // If the auth singleton has not hydrated yet, wait for the auth:changed
    // event emitted by the shell once the session is resolved.
    if (!user) {
      function onAuth() {
        document.removeEventListener('auth:changed', onAuth);
        init();
      }
      document.addEventListener('auth:changed', onAuth);
      return;
    }

    // Resolve the organization ID from either camelCase or snake_case fields
    var orgId = user.organizationId || user.organization_id;

    if (!orgId) {
      _showError(new Error('No organization found for current user'));
      return;
    }

    _loadOrganization(orgId);
  }

  // =========================================================================
  // Page lifecycle — register with router for SPA re-navigation support
  // =========================================================================

  // registerPageInit ensures init() is called on every navigation to this page
  // (first load + re-navigation from cached scripts after the IIFE has run).
  if (window.LexRouter) {
    LexRouter.registerPageInit('admin/organizations.html', function () {
      LexRouter.registerView({ onLeave: onLeave });
      init();
    });
  } else {
    // Fallback for non-SPA contexts (should not occur in normal operation)
    init();
  }

  // =========================================================================
  // Page lifecycle — onLeave cleanup
  // =========================================================================

  /**
   * Clean up when navigating away.
   * This page has no intervals, globals, or document listeners to remove,
   * but the hook is registered for future-proofing and consistency.
   */
  function onLeave() {
    // Nothing to clean up for this page currently.
    // If intervals / globals / document listeners are added later,
    // remove them here following the dashboard.js onLeave pattern.
  }

})();
