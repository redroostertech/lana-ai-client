/* ==========================================================================
   Account - Page Controller

   Sections:
     Profile  : identity (read-only view; edit deep-links to Settings)
     Plan     : current tier + link to Billing and plan
     Session  : sign out

   Reads from the REAL LANA One profile endpoint via LanaBillingApi.getProfile
   (GET /api/v1/users/me/profile). The profile now carries `effective_tier`
   (resolved from organizations.plan_tier, stamped from the cloud plan at
   cloud-adopt); resolveTier prefers it and falls back to 'free'.

   No regex. No classes. No top-level const/let.
   ========================================================================== */

(function () {
  'use strict';

  var dom = {};

  function cacheDom() {
    dom.avatarInitials = document.getElementById('ac-avatar-initials');
    dom.name           = document.getElementById('ac-name');
    dom.email          = document.getElementById('ac-email');
    dom.kvFirstName    = document.getElementById('ac-kv-firstname');
    dom.kvLastName     = document.getElementById('ac-kv-lastname');
    dom.kvRole         = document.getElementById('ac-kv-role');
    dom.kvOrg          = document.getElementById('ac-kv-org');
    dom.editProfileBtn = document.getElementById('ac-edit-profile-btn');
    dom.planIcon       = document.getElementById('ac-plan-icon');
    dom.planName       = document.getElementById('ac-plan-name');
    dom.planMeta       = document.getElementById('ac-plan-meta');
    dom.billingBtn     = document.getElementById('ac-billing-btn');
    dom.signoutBtn     = document.getElementById('ac-signout-btn');
  }

  function icon(name, size) {
    try {
      var ic = window.Lex && window.Lex.Icons ? window.Lex.Icons[name] : null;
      if (!ic) return '';
      return String(size ? ic[size] : ic);
    } catch (e) {
      return '';
    }
  }


  // =========================================================================
  // Profile + plan
  // =========================================================================

  function renderPlan(tier) {
    var P = window.LanaPricing;
    var label = P.tierLabel(tier);
    var t = null;
    for (var i = 0; i < P.TIERS.length; i++) {
      if (P.tierRank(P.TIERS[i].key) === P.tierRank(tier)) { t = P.TIERS[i]; break; }
    }
    if (dom.planName) dom.planName.textContent = label + ' plan';
    if (dom.planMeta) {
      dom.planMeta.textContent = (tier === 'free')
        ? 'Upgrade for higher usage and full Forge access.'
        : 'Manage your subscription from Billing.';
    }
    if (dom.planIcon) dom.planIcon.innerHTML = icon(t ? t.icon : 'sparkles', 'medium');
  }

  function loadProfile() {
    window.LanaBillingApi.getProfile().then(function (result) {
      var user = result.profile || result.user || result;

      var firstName = user.first_name || '';
      var lastName = user.last_name || '';
      var name = (firstName + ' ' + lastName).trim() || user.email || '';
      var initials = ((firstName.charAt(0) || '') + (lastName.charAt(0) || '')).toUpperCase() ||
                     (user.email ? user.email.charAt(0).toUpperCase() : 'U');

      if (dom.name) dom.name.textContent = name;
      if (dom.email) dom.email.textContent = user.email || '';
      if (dom.avatarInitials) dom.avatarInitials.textContent = initials;
      if (dom.kvFirstName) dom.kvFirstName.setAttribute('value', firstName || '--');
      if (dom.kvLastName) dom.kvLastName.setAttribute('value', lastName || '--');
      if (dom.kvRole) dom.kvRole.setAttribute('value', user.role_name || '--');
      if (dom.kvOrg) dom.kvOrg.setAttribute('value', user.organization_name || '--');

      renderPlan(window.LanaBillingApi.resolveTier(user));
    }).catch(function () {
      if (window.Lex && window.Lex.Toast) window.Lex.Toast.error('Failed to load account');
      renderPlan('free');
    });
  }


  // =========================================================================
  // Sign out
  // =========================================================================

  function loginHref() {
    // Mirror the sidebar user-menu sign-out target.
    return 'login.html';
  }

  function doSignOut() {
    var go = function () { window.location.href = loginHref(); };
    if (window.api && typeof window.api.logout === 'function') {
      window.api.logout().then(go).catch(go);
    } else {
      go();
    }
  }

  function confirmSignOut() {
    if (window.Lex && window.Lex.Modal && typeof window.Lex.Modal.confirm === 'function') {
      window.Lex.Modal.confirm('Sign Out', 'Are you sure you want to sign out?', doSignOut, {
        confirmText: 'Sign Out',
        variant: 'danger'
      });
    } else {
      doSignOut();
    }
  }


  // =========================================================================
  // Init
  // =========================================================================

  function init() {
    cacheDom();

    if (dom.editProfileBtn) {
      dom.editProfileBtn.addEventListener('click', function () {
        window.location.href = 'settings-v2.html';
      });
    }
    if (dom.billingBtn) {
      dom.billingBtn.addEventListener('click', function () {
        window.location.href = 'billing.html';
      });
    }
    if (dom.signoutBtn) {
      dom.signoutBtn.addEventListener('click', confirmSignOut);
    }

    document.addEventListener('lex-refresh', function (e) {
      e.preventDefault();
      loadProfile();
    });

    loadProfile();
  }

  init();

})();
