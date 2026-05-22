/* Admin Index — Page controller for admin/index.html.
   Standalone page. Wires action-click navigation on lex-action-card
   elements via event delegation.

   Pattern: IIFE + direct init() call.
*/

(function () {
  'use strict';

  // ── Helpers ────────────────────────────────────────────────────────

  function el(id) { return document.getElementById(id); }

  function onActionClick(e) {
    var card = e.target.closest('lex-action-card');
    var href = card && card.dataset && card.dataset.href;
    if (href) {
      Lex.Nav.go(href);
    }
  }

  function hasRole(roleName) {
    return !!(Lex.Auth && Lex.Auth.hasRole && Lex.Auth.hasRole(roleName));
  }

  function canViewRoleGatedCard(card) {
    var roles = (card.dataset.adminRoles || '').split(',');
    for (var i = 0; i < roles.length; i++) {
      if (hasRole(roles[i].trim())) return true;
    }
    return false;
  }

  function applyRoleGates() {
    var cards = document.querySelectorAll('lex-action-card[data-admin-roles]');
    for (var i = 0; i < cards.length; i++) {
      cards[i].hidden = !canViewRoleGatedCard(cards[i]);
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  function init() {
    var content = el('lex-main-content');
    if (!content) return;

    // Gate: non-admins should not see the admin index.
    if (Lex.Auth && !Lex.Auth.isAdmin()) {
      Lex.Nav.go('dashboard.html', { replace: true });
      return;
    }

    applyRoleGates();
    content.addEventListener('action-click', onActionClick);
  }

  // ── Boot ───────────────────────────────────────────────────────────

  init();

})();
