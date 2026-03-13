/* Analytics Index — Page controller for admin/analytics.html.
   Hub page linking to Firm Reporting, Workspace Analytics,
   Data Visualization, and Predictions. Wires action-click
   navigation on lex-action-card elements via event delegation.

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

  // ── Lifecycle ──────────────────────────────────────────────────────

  function init() {
    var content = el('lex-main-content');
    if (!content) return;

    // Gate: non-admins should not see the analytics hub.
    if (Lex.Auth && !Lex.Auth.isAdmin()) {
      Lex.Nav.go('dashboard.html', { replace: true });
      return;
    }

    content.addEventListener('action-click', onActionClick);
  }

  // ── Boot ───────────────────────────────────────────────────────────

  init();

})();
