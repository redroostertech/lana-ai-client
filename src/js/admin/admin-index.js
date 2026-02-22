/* Admin Index — Page controller for admin/index.html.
   SPA page script loaded by lex-router. Wires action-click navigation
   on lex-action-card elements via event delegation.

   Pattern: IIFE + LexRouter.registerPageInit() (see lex-router.pages.js).
*/

(function () {
  'use strict';

  function init() {
    var content = document.getElementById('lex-main-content');
    if (!content) return;

    content.addEventListener('action-click', function (e) {
      var card = e.target.closest('lex-action-card');
      var href = card && card.dataset && card.dataset.href;
      if (href) {
        Lex.Nav.go(href);
      }
    });
  }

  LexRouter.registerPageInit('admin/index.html', init);
  init();

})();
