/**
 * automation-routes.js
 * Pure hash routes for the automation app: view names, #automation/<id> for
 * one automation, and #run/<executionId> for one run (the Runs view with
 * that run's detail open; run alerts link here).
 *
 * Classic script (window.AutomationRoutes) so Jest can require it; app.js
 * reads it from window.
 */
(function (global) {
  'use strict';

  function decode(value) {
    try { return decodeURIComponent(value); } catch (_error) { return value; }
  }

  function parseAutomationHash(rawHash, viewDefinitions) {
    var hash = String(rawHash || '').replace(/^#/, '').trim();
    if (!hash) return null;
    if (hash.indexOf('automation/') === 0) {
      var automationId = decode(hash.slice('automation/'.length).trim());
      return automationId ? { view: 'library-detail', automationId: automationId } : null;
    }
    if (hash.indexOf('run/') === 0) {
      var runId = decode(hash.slice('run/'.length).split('?')[0].trim());
      return runId ? { view: 'runs', runId: runId } : null;
    }
    var view = hash.split('?')[0];
    return viewDefinitions && viewDefinitions[view] ? { view: view } : null;
  }

  function buildAutomationHash(view, state, viewDefinitions) {
    var current = state || {};
    if (view === 'library-detail') {
      var automationId = current.libraryDetail && current.libraryDetail.automationId;
      return automationId ? '#automation/' + encodeURIComponent(automationId) : '#library';
    }
    if (view === 'runs' && current.selectedRunId) {
      return '#run/' + encodeURIComponent(current.selectedRunId);
    }
    if (viewDefinitions && viewDefinitions[view]) return '#' + encodeURIComponent(view);
    return '#library';
  }

  var moduleApi = { parseAutomationHash: parseAutomationHash, buildAutomationHash: buildAutomationHash };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.AutomationRoutes = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);
