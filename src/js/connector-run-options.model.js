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
 *   catalogPaths(type, sourceId) catalog URLs to try in order: by connection id
 *                                first (the backend then words "Force full sync"
 *                                for that connection's own filters), then by type
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

  // A connection (integration source) id; matches the viewer's looksLikeUuid.
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var CATALOG = '/api/v1/integrations/connectors/catalog/';

  function catalogPaths(connectorType, sourceId) {
    var byType = CATALOG + encodeURIComponent(connectorType);
    if (sourceId && UUID.test(String(sourceId))) {
      return [CATALOG + encodeURIComponent(sourceId), byType];
    }
    return [byType];
  }

  var api = { hasPackageRunBehavior: hasPackageRunBehavior, servedOptions: servedOptions, catalogPaths: catalogPaths };
  if (node) {module.exports = api;}
  else {root.LanaConnectorRunOptions = api;}
})(typeof window !== 'undefined' ? window : this);
