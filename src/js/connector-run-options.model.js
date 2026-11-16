/**
 * Connector viewer Run tab: which run settings come from the package. Pure, no DOM.
 *
 * The backend adds platform run options (today "Force full sync") to every
 * connector's ui_behavior.run.options. A package with no run block of its own
 * then arrives as { options: [...] }; that alone must not replace the Run
 * tab's default layout.
 *
 *   hasPackageRunBehavior(run)   true when the package set anything besides options
 *   servedOptions(run)           the run options to render, or []
 *
 * window.LanaConnectorRunOptions (browser) / module.exports (tests).
 */
(function (root) {
  'use strict';

  var node = typeof module !== 'undefined' && module.exports;

  function hasPackageRunBehavior(run) {
    if (!run || typeof run !== 'object') { return false; }
    return Object.keys(run).some(function (key) { return key !== 'options'; });
  }

  function servedOptions(run) {
    return run && Array.isArray(run.options) ? run.options : [];
  }

  var api = { hasPackageRunBehavior: hasPackageRunBehavior, servedOptions: servedOptions };
  if (node) {module.exports = api;}
  else {root.LanaConnectorRunOptions = api;}
})(typeof window !== 'undefined' ? window : this);
