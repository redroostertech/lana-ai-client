/* ==========================================================================
   Billing and Plan - Page Controller

   Sections:
     Current plan   : resolved tier + Manage billing (Stripe portal)
     Usage          : storage meter (real /api/v1/storage/usage)
     Choose a plan  : Free / Pro / Max cards with upgrade CTAs
     Graduate       : LANA One edition only - pointer to LANA AI Business

   EDITION-AWARE (form factor, not capability): the product edition (from
   window.LanaProductEdition, fed by GET /api/v1/system/status) only decides
   WHICH PLANS ARE OFFERED and whether the "Graduate to Business" section
   shows. Everything the user can DO keys off the resolved account tier
   (_currentTier), never the edition, so an org that upgrades on the same
   binary just unlocks. Under the base LANA AI edition (the fail-safe
   default) this page renders exactly as it did before edition awareness.

   The read side uses REAL LANA One endpoints (profile, storage usage). The
   checkout/portal side calls the conventional billing routes; when the backend
   has not implemented them yet (404/501), the UI shows a clear
   "billing not available yet" banner instead of failing loudly.

   No regex. No classes. No top-level const/let.
   ========================================================================== */

(function () {
  'use strict';

  var _currentTier = 'free';

  // Product edition (form factor only). Fail-safe default is the base LANA AI
  // edition: until (and unless) the backend says 'lana_one', the page renders
  // exactly today's LANA AI behavior.
  var _edition = 'lana_ai';

  var dom = {};

  function cacheDom() {
    dom.planIcon        = document.getElementById('bl-plan-icon');
    dom.planName        = document.getElementById('bl-plan-name');
    dom.planMeta        = document.getElementById('bl-plan-meta');
    dom.manageBtn       = document.getElementById('bl-manage-btn');
    dom.unavailable     = document.getElementById('bl-billing-unavailable');
    dom.storageDetail   = document.getElementById('bl-usage-storage-detail');
    dom.storageFill     = document.getElementById('bl-usage-storage-fill');
    dom.storageItem     = document.getElementById('bl-usage-storage-item');
    dom.grid            = document.getElementById('bl-plan-grid');
    dom.gridLockedNote  = document.getElementById('bl-grid-locked-note');
    dom.graduateSection = document.getElementById('bl-graduate-section');
    dom.graduateIcon    = document.getElementById('bl-graduate-icon');
    dom.graduateBtn     = document.getElementById('bl-graduate-btn');
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

  function toast(kind, msg) {
    if (window.Lex && window.Lex.Toast && window.Lex.Toast[kind]) {
      window.Lex.Toast[kind](msg);
    }
  }


  // =========================================================================
  // Current plan
  // =========================================================================

  function renderCurrentPlan() {
    var P = window.LanaPricing;
    var label = P.tierLabel(_currentTier);
    var tier = null;
    for (var i = 0; i < P.TIERS.length; i++) {
      if (P.tierRank(P.TIERS[i].key) === P.tierRank(_currentTier)) { tier = P.TIERS[i]; break; }
    }

    if (dom.planName) dom.planName.textContent = label + ' plan';
    if (dom.planMeta) {
      dom.planMeta.textContent = _currentTier === 'free'
        ? 'You are on the Free plan. Upgrade for higher usage and full Forge access.'
        : 'Thank you for supporting LANA One.';
    }
    if (dom.planIcon) dom.planIcon.innerHTML = icon(tier ? tier.icon : 'sparkles', 'medium');

    // Manage billing only makes sense on a paid plan.
    if (dom.manageBtn) {
      dom.manageBtn.style.display = (_currentTier === 'free') ? 'none' : '';
    }
  }

  function loadProfile() {
    return window.LanaBillingApi.getProfile().then(function (result) {
      var profile = result.profile || result.user || result;
      _currentTier = window.LanaBillingApi.resolveTier(profile);
      renderCurrentPlan();
      renderPlanGrid();
    }).catch(function () {
      // Fall back to free view; still render grid so upgrade paths exist.
      _currentTier = 'free';
      renderCurrentPlan();
      renderPlanGrid();
    });
  }


  // =========================================================================
  // Usage meter (storage)
  // =========================================================================

  function loadUsage() {
    if (!dom.storageDetail) return;
    window.LanaBillingApi.getStorageUsage().then(function (u) {
      var used = u.used_formatted || '0 B';
      var total = u.total_formatted || '';
      var pct = typeof u.percentage_used === 'number' ? u.percentage_used : 0;
      var clamped = Math.max(0, Math.min(100, Math.round(pct)));

      dom.storageDetail.textContent = total ? (used + ' of ' + total) : used;
      if (dom.storageFill) dom.storageFill.style.width = clamped + '%';
      if (dom.storageItem) {
        if (clamped >= 80) dom.storageItem.classList.add('bl-warn');
        else dom.storageItem.classList.remove('bl-warn');
      }
    }).catch(function () {
      // Best-effort: leave the meter quiet rather than error.
      dom.storageDetail.textContent = 'Usage unavailable';
    });
  }


  // =========================================================================
  // Plan grid
  // =========================================================================

  function planCardHtml(tier, gridState) {
    var P = window.LanaPricing;
    // Current-card marking keys on the resolved grid state (exact card key,
    // never rank), so a tier with no card in the grid marks nothing.
    var isCurrent = !gridState.locked && tier.key === gridState.currentKey;
    var isUpgrade = !gridState.locked && P.tierRank(tier.key) > P.tierRank(_currentTier);

    var cardClass = 'bl-card' +
      (tier.featured ? ' bl-featured' : '') +
      (isCurrent ? ' bl-current' : '');

    var features = tier.features.map(function (f) {
      return '<li class="bl-card-feature">' + icon('check', 'small') +
             '<span>' + window.Lex.Utils.escapeHtml(f) + '</span></li>';
    }).join('');

    var cta;
    if (gridState.locked) {
      // The account's current tier has no card in this grid (e.g. a business
      // org signed into this binary). Plan changes here could downgrade or
      // double-subscribe, so every plan-change CTA is disabled. This keys on
      // grid membership only, never on the edition.
      cta = '<lex-btn class="bl-card-cta" variant="secondary" size="sm" disabled>Managed on LANA AI</lex-btn>';
    } else if (isCurrent) {
      cta = '<lex-btn class="bl-card-cta" variant="secondary" size="sm" disabled>Your current plan</lex-btn>';
    } else if (isUpgrade) {
      cta = '<lex-btn class="bl-card-cta bl-upgrade" data-plan="' + window.Lex.Utils.escapeHtml(tier.key) +
            '" variant="primary" size="sm" leading-icon="arrow-up-right">Upgrade to ' +
            window.Lex.Utils.escapeHtml(tier.name) + '</lex-btn>';
    } else {
      // Lower tier than current -> manage/downgrade via portal.
      cta = '<lex-btn class="bl-card-cta bl-manage-plan" data-plan="' + window.Lex.Utils.escapeHtml(tier.key) +
            '" variant="ghost" size="sm">Change plan</lex-btn>';
    }

    return '' +
      '<div class="' + cardClass + '">' +
        '<div class="bl-card-head">' +
          '<span class="bl-card-icon">' + icon(tier.icon, 'small') + '</span>' +
          '<h3 class="bl-card-name">' + window.Lex.Utils.escapeHtml(tier.name) + '</h3>' +
          (tier.featured ? '<lex-badge label="Popular" color="indigo" size="sm" style="margin-left:auto"></lex-badge>' : '') +
        '</div>' +
        '<div><span class="bl-card-price">' + window.Lex.Utils.escapeHtml(tier.price) + '</span>' +
          '<span class="bl-card-cadence">' + window.Lex.Utils.escapeHtml(tier.cadence) + '</span></div>' +
        '<p class="bl-card-tagline">' + window.Lex.Utils.escapeHtml(tier.tagline) + '</p>' +
        '<ul class="bl-card-features">' + features + '</ul>' +
        cta +
      '</div>';
  }

  function renderPlanGrid() {
    if (!dom.grid) return;
    var P = window.LanaPricing;
    // Edition picks which plans are OFFERED (LANA One: Free/Pro/Max only;
    // LANA AI: the full list, unchanged). Offering only, never capability.
    var offered = P.tiersForEdition(_edition);

    // Grid state keys on grid MEMBERSHIP only (never the edition): when the
    // account's current tier is not one of the offered cards, no card is
    // "current" and every plan-change CTA locks (see resolvePlanGridState).
    var gridState = P.resolvePlanGridState(offered, _currentTier);

    dom.grid.innerHTML = offered.map(function (tier) {
      return planCardHtml(tier, gridState);
    }).join('');

    if (dom.gridLockedNote) {
      if (gridState.locked) dom.gridLockedNote.classList.remove('bl-hidden');
      else dom.gridLockedNote.classList.add('bl-hidden');
    }

    dom.grid.querySelectorAll('.bl-upgrade').forEach(function (btn) {
      btn.addEventListener('click', function () {
        startCheckout(btn.getAttribute('data-plan'));
      });
    });
    dom.grid.querySelectorAll('.bl-manage-plan').forEach(function (btn) {
      btn.addEventListener('click', openPortal);
    });
  }


  // =========================================================================
  // Graduate to Business (LANA One edition affordance)
  // =========================================================================

  // Shown ONLY under the LANA One edition. This is a form-factor affordance
  // (where teams/firms buy), explicitly allowed to key off the edition. It
  // does not gate any capability.
  function renderGraduateSection() {
    if (!dom.graduateSection) return;
    var E = window.LanaProductEdition;
    var show = !!(E && E.isLanaOne(_edition));
    if (show) {
      dom.graduateSection.classList.remove('bl-hidden');
      if (dom.graduateIcon) dom.graduateIcon.innerHTML = icon('building-2', 'medium');
    } else {
      dom.graduateSection.classList.add('bl-hidden');
    }
  }

  function openGraduateLink() {
    var url = window.LanaPricing.GRADUATE_TO_BUSINESS_URL;
    // New window/tab only. Never fall back to navigating the app itself to a
    // remote site; this CTA is an affordance, not a critical path.
    var win = window.open(url, '_blank', 'noopener');
    if (!win) console.warn('[Billing] Popup blocked; graduate link not opened:', url);
  }

  function loadEdition() {
    var E = window.LanaProductEdition;
    if (!E || typeof E.getEdition !== 'function') return; // fail-safe: stay lana_ai
    E.getEdition().then(function (edition) {
      _edition = E.normalizeEdition(edition);
      renderPlanGrid();
      renderGraduateSection();
    });
  }


  // =========================================================================
  // Checkout / portal (guarded; routes not yet in LANA One backend)
  // =========================================================================

  function showBillingUnavailable() {
    if (dom.unavailable) dom.unavailable.classList.remove('bl-hidden');
  }

  // LANA One edition: the billing API hands off to the account plane in the
  // system browser and resolves { external: true, opened, url }. opened=false
  // means the window was blocked; fall back to the fail-closed banner (never
  // navigate the app itself). Returns true when the result was an external
  // handoff (handled here), false when the caller should keep going.
  function handleExternalBilling(res) {
    if (!res || !res.external) return false;
    if (res.opened) {
      toast('info', 'Continue in the browser window we just opened.');
    } else {
      showBillingUnavailable();
      toast('info', 'We could not open your browser. Visit ' + res.url + ' to manage your plan.');
    }
    return true;
  }

  function startCheckout(plan) {
    if (!plan) return;
    toast('info', 'Preparing checkout...');
    window.LanaBillingApi.startCheckout(plan, 1).then(function (res) {
      if (handleExternalBilling(res)) return;
      if (res && res.url) {
        window.location.href = res.url;
      } else {
        toast('error', 'Checkout could not be started.');
      }
    }).catch(function (err) {
      if (window.LanaBillingApi.isNotImplemented(err)) {
        showBillingUnavailable();
        toast('info', 'Self-serve checkout is not available yet.');
      } else {
        toast('error', (err && err.message) || 'Checkout failed.');
      }
    });
  }

  function openPortal() {
    toast('info', 'Opening billing portal...');
    window.LanaBillingApi.openPortal().then(function (res) {
      if (handleExternalBilling(res)) return;
      if (res && res.url) {
        window.location.href = res.url;
      } else {
        toast('error', 'Billing portal is unavailable.');
      }
    }).catch(function (err) {
      if (window.LanaBillingApi.isNotImplemented(err)) {
        showBillingUnavailable();
        toast('info', 'Billing management is not available yet.');
      } else {
        toast('error', (err && err.message) || 'Could not open billing portal.');
      }
    });
  }


  // =========================================================================
  // Init
  // =========================================================================

  function init() {
    cacheDom();

    if (dom.manageBtn) dom.manageBtn.addEventListener('click', openPortal);
    if (dom.graduateBtn) dom.graduateBtn.addEventListener('click', openGraduateLink);

    document.addEventListener('lex-refresh', function (e) {
      e.preventDefault();
      loadProfile();
      loadUsage();
    });

    loadEdition();
    loadProfile();
    loadUsage();
  }

  init();

})();
