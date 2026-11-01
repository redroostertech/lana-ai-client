/**
 * matter-tab-registry.js
 * One registry of generic matter tab kinds (design 7.1).
 *
 * The matter's makeup (GET /api/v1/matters/:matter_id/makeup) lists its tabs
 * in order: [{ id, kind, label?, hidden?, available?, reason? }]. This module
 * turns that list into the tabs the page shows, finds the panel for each and
 * asks the renderer registered for its kind to fill it. It never looks at a
 * makeup key. When the server has no makeup for the matter (no makeup route,
 * or a matter with no LANA record), STANDARD_TABS is used: the same tabs as
 * the server's standard makeup (src/domains/platform/makeups/standard.makeup.json,
 * held equal by tests/unit/matter-makeups-backend-contract.test.js). When the
 * makeup could not be loaded, failedTabs() shows one unavailable section
 * rather than guessing.
 *
 * Built-in kinds keep their existing page key (used by ?tab= deep links and
 * the page's own code) and their existing panel in workspace-details.html.
 * Every other kind gets a panel created on demand.
 *
 * Public API (window.LanaMatterTabRegistry, or module.exports in Node):
 *   - STANDARD_TABS, BUILT_IN_KINDS
 *   - createRegistry() -> registry (below); the module itself is a default registry
 *
 * Registry: register(kind, render), isKnownKind(kind), buildTabs(serverTabs),
 * failedTabs(reason), barTabs(tabs), resolve(tabs, requested),
 * ensurePanels(container, tabs), render(tab, context). A renderer's context
 * carries renderBuiltIn(), for a tab content answer that says built_in.
 */

(function (global) {
  'use strict';

  var STANDARD_TABS = Object.freeze([
    { id: 'summary', kind: 'summary', label: 'Summary' },
    { id: 'notes', kind: 'notes', label: 'Notes' },
    { id: 'tasks', kind: 'tasks', label: 'Board' },
    { id: 'comments', kind: 'comments', label: 'Discussions' },
    { id: 'documents', kind: 'documents', label: 'Documents' },
    { id: 'billable_hours', kind: 'billable_hours', label: 'Billable Hours' },
    // Reachable by deep link only, as before makeups.
    { id: 'conversations', kind: 'conversations', label: 'Conversations', hidden: true },
    { id: 'doc_generation', kind: 'doc_generation', label: 'Document Generation', hidden: true },
    { id: 'analytics', kind: 'analytics', label: 'Analytics', hidden: true }
  ].map(Object.freeze));

  var BUILT_IN_KINDS = Object.freeze({
    summary: { key: 'summary', panelId: 'tabContentSummary', label: 'Summary' },
    notes: { key: 'notes', panelId: 'tabContentNotes', label: 'Notes' },
    tasks: { key: 'tasks', panelId: 'tabContentTasks', label: 'Board' },
    comments: { key: 'comments', panelId: 'tabContentComments', label: 'Discussions' },
    documents: { key: 'documents', panelId: 'tabContentDocuments', label: 'Documents' },
    conversations: { key: 'conversations', panelId: 'tabContentConversations', label: 'Conversations' },
    billable_hours: { key: 'billableHours', panelId: 'tabContentBillableHours', label: 'Billable Hours' },
    doc_generation: { key: 'docGeneration', panelId: 'tabContentDocGeneration', label: 'Document Generation' },
    analytics: { key: 'analytics', panelId: 'tabContentAnalytics', label: 'Analytics' }
  });

  var NEWER_VERSION = 'This section needs a newer app version';
  var LOAD_FAILED = 'This matter\'s sections could not be loaded. Refresh to try again.';

  function safeIdPart(value) {
    return Array.from(String(value)).map(function (c) {
      var ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '-' || c === '_';
      return ok ? c : '-';
    }).join('');
  }

  function humanize(kind) {
    var words = String(kind || '').split('_').join(' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  function createRegistry() {
    var renderers = {};

    function isKnownKind(kind) {
      return Object.prototype.hasOwnProperty.call(renderers, kind);
    }

    function entryFor(tab) {
      var builtIn = BUILT_IN_KINDS[tab.kind] || null;
      var key = builtIn ? builtIn.key : String(tab.id);
      return {
        key: key,
        id: String(tab.id),
        kind: String(tab.kind),
        label: tab.label || (builtIn ? builtIn.label : humanize(tab.kind)),
        hidden: tab.hidden === true,
        available: tab.available !== false,
        reason: tab.reason || '',
        panelId: builtIn ? builtIn.panelId : 'matterTabPanel-' + safeIdPart(key)
      };
    }

    function fromList(list) {
      var seen = {};
      var tabs = [];
      list.forEach(function (tab) {
        if (!tab || typeof tab.id !== 'string' || !tab.id || typeof tab.kind !== 'string' || !tab.kind) return;
        var entry = entryFor(tab);
        if (seen[entry.key]) return;
        seen[entry.key] = true;
        tabs.push(entry);
      });
      return tabs;
    }

    // Server order is kept (the server makes sure one tab is shown). No list
    // means the server has no makeup for this matter: the standard set.
    function buildTabs(serverTabs) {
      return fromList(Array.isArray(serverTabs) ? serverTabs : STANDARD_TABS);
    }

    // The makeup could not be loaded: one section that says so.
    function failedTabs(reason) {
      return fromList([{ id: 'sections', kind: 'sections', label: 'Matter', available: false, reason: reason || LOAD_FAILED }]);
    }

    function barTabs(tabs) {
      return tabs.filter(function (tab) { return !tab.hidden; }).map(function (tab) {
        return { id: tab.key, label: tab.label };
      });
    }

    function resolve(tabs, requested) {
      var wanted = requested == null ? '' : String(requested);
      var match = wanted && (tabs.find(function (tab) { return tab.key === wanted; }) ||
        tabs.find(function (tab) { return tab.id === wanted; }) ||
        tabs.find(function (tab) { return tab.kind === wanted; }));
      return match || tabs.find(function (tab) { return !tab.hidden; }) || null;
    }

    function ensurePanels(container, tabs) {
      if (!container) return;
      var doc = container.ownerDocument;
      tabs.forEach(function (tab) {
        if (doc.getElementById(tab.panelId)) return;
        var panel = doc.createElement('div');
        panel.id = tab.panelId;
        panel.className = 'hidden p-6';
        panel.setAttribute('data-matter-tab-panel', tab.key);
        container.appendChild(panel);
      });
    }

    function emptyState(panel, message, description) {
      var empty = panel.ownerDocument.createElement('lex-empty');
      empty.setAttribute('icon', 'alert');
      empty.setAttribute('message', message);
      if (description) empty.setAttribute('description', description);
      panel.replaceChildren(empty);
    }

    function render(tab, context) {
      if (!tab) return;
      var ctx = Object.assign({}, context || {}, { tab: tab });
      var doc = ctx.document || (typeof document !== 'undefined' ? document : null);
      var panel = doc ? doc.getElementById(tab.panelId) : null;
      ctx.panel = panel;
      // The server answered this tab's content with built_in: true.
      ctx.renderBuiltIn = function () {
        if (BUILT_IN_KINDS[tab.kind] && isKnownKind(tab.kind)) renderers[tab.kind](ctx);
        else if (panel) emptyState(panel, NEWER_VERSION, '');
      };
      if (!tab.available) {
        if (panel) emptyState(panel, 'This section is not available', tab.reason || 'It is turned off for this matter.');
        return;
      }
      if (!isKnownKind(tab.kind)) {
        if (panel) emptyState(panel, NEWER_VERSION, '');
        return;
      }
      renderers[tab.kind](ctx);
    }

    return {
      register: function (kind, renderFn) {
        if (typeof renderFn !== 'function') throw new Error('A tab renderer must be a function.');
        renderers[kind] = renderFn;
      },
      isKnownKind: isKnownKind,
      buildTabs: buildTabs,
      failedTabs: failedTabs,
      barTabs: barTabs,
      resolve: resolve,
      ensurePanels: ensurePanels,
      render: render
    };
  }

  var moduleApi = Object.assign(createRegistry(), {
    STANDARD_TABS: STANDARD_TABS,
    BUILT_IN_KINDS: BUILT_IN_KINDS,
    NEWER_VERSION: NEWER_VERSION,
    LOAD_FAILED: LOAD_FAILED,
    createRegistry: createRegistry
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = moduleApi;
  if (global) global.LanaMatterTabRegistry = moduleApi;
})(typeof window !== 'undefined' ? window : globalThis);
