/* ==========================================================================
   Settings V2 — Plan & billing
   Billing is managed on the web (one.lanaai.io), not inside the desktop app.
   This wires the "Manage billing" button to open the user's account in the
   external system browser via the established electronAPI.openExternal path.

   No regex. No classes. No top-level const/let.
   ========================================================================== */

(function () {
  'use strict';

  function openExternal(url) {
    if (!url) return;
    if (window.electronAPI && typeof window.electronAPI.openExternal === 'function') {
      window.electronAPI.openExternal(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  function init() {
    var btn = document.getElementById('sv2-manage-billing-btn');
    if (!btn) return;

    btn.addEventListener('click', function () {
      openExternal(btn.getAttribute('data-billing-url'));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
