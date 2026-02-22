/* Organization Details — Page Controller (standalone page)

   Zones:
     A  Page Banner          — org name, slug, status badge, action slot
     B  Organization Info    — ID, tier, created, updated (key-value pairs)

   Rules:
     - NO regex anywhere — string methods only (includes, indexOf, split, etc.)
     - IIFE wrapper — no top-level const/class/let leaking to window scope
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
   * Capitalize the first character of a string and lowercase the rest.
   * No regex — uses charAt + slice only.
   * @param {string} str
   * @param {string} fallback - Default value if str is falsy
   * @returns {string}
   */
  function capitalizeFirst(str, fallback) {
    if (!str) return fallback || '';
    var s = String(str);
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }

  /**
   * Produce a display label from an organization status string.
   * @param {string} status
   * @returns {string}
   */
  function statusLabel(status) { return capitalizeFirst(status, 'Unknown'); }

  /**
   * Produce a display label for a subscription tier.
   * @param {string} tier
   * @returns {string}
   */
  function tierLabel(tier) { return capitalizeFirst(tier, 'Standard'); }


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
    var infoCard  = el('orgInfoCard');
    var errorState = el('orgErrorState');

    // Remove shimmer from all zones before hiding them
    if (banner)    Lex.Redact.off(banner);
    if (infoCard)  Lex.Redact.off(infoCard);

    // Hide data zones
    if (banner)    hide(banner);
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
    var infoCard   = el('orgInfoCard');
    var errorState = el('orgErrorState');

    // Hide any prior error state on reload
    if (errorState) hide(errorState);

    // Reveal all data zones (may have been hidden by a prior error)
    if (banner)    show(banner);
    if (infoCard)  show(infoCard);

    // Apply shimmer loading state
    if (banner)    Lex.Redact.on(banner);
    if (infoCard)  Lex.Redact.on(infoCard);

    try {
      var rawOrg = await api.getOrganization(orgId);

      // Normalize: API may return { organization: {...} } or the record directly
      var org = (rawOrg && rawOrg.organization) ? rawOrg.organization : rawOrg;

      // Guard against null/empty org response
      if (!org || typeof org !== 'object') {
        throw new Error('Organization data not found');
      }

      // Render all zones
      _renderBanner(org);
      _renderInfo(org);

    } catch (err) {
      // _showError hides the data zones and removes shimmer before showing
      // the error state, so by the time finally runs, Redact.off is a no-op.
      _showError(err);

    } finally {
      // Remove shimmer on both success and error paths.
      // Calling Redact.off twice is idempotent — safe even after _showError.
      if (banner)    Lex.Redact.off(banner);
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
  // Boot
  // =========================================================================

  init();

})();
