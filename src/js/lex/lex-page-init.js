/**
 * Lex Page Init — shared bootstrap for standalone <lex-app> pages.
 *
 * 1. Injects <template id="page-content"> into the shell content area.
 * 2. Hoists declarative <lex-modal> and [data-hoist] elements to document.body
 *    so they aren't clipped by <lex-content>'s overflow stacking context.
 *    (Mirrors lex-router.js _hoistPageModals behavior.)
 *
 * Include this script AFTER all component <script> tags, BEFORE the page controller.
 */
(function () {
  var tpl = document.getElementById('page-content');
  var target = document.getElementById('lex-main-content');
  if (!tpl || !target) return;

  target.appendChild(document.importNode(tpl.content, true));

  var modals = target.querySelectorAll('lex-modal');
  for (var i = 0; i < modals.length; i++) document.body.appendChild(modals[i]);

  var hoistable = target.querySelectorAll('[data-hoist]');
  for (var j = 0; j < hoistable.length; j++) document.body.appendChild(hoistable[j]);
})();
