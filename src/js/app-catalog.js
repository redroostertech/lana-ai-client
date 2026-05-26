(function (global) {
  'use strict';

  var CATALOG = {
    'lana-works': {
      id: 'lana-works',
      label: 'LanaWorks',
      description: 'Manage matters, workspaces and client operations',
      route: 'dashboard.html',
      colors: ['#82d8ff', '#4267df', '#126f62', '#111827']
    },
    'lana-agents': {
      id: 'lana-agents',
      label: 'LanaAgents',
      description: 'Browse and run AI agents',
      route: 'agents/index.html',
      colors: ['#a78bfa', '#7c3aed', '#5b21b6', '#1e1b4b']
    },
    'lana-insights': {
      id: 'lana-insights',
      label: 'LanaInsights',
      description: 'Dashboards, reporting, and firm analytics',
      route: 'admin/analytics.html',
      colors: ['#60a5fa', '#2563eb', '#7c3aed', '#0f172a']
    },
    'doc-studio': {
      id: 'doc-studio',
      label: 'Doc Studio',
      description: 'Generate decks, legal documents, PDFs, and pages',
      route: 'doc-studio/index.html',
      colors: ['#2f6f73', '#b56b45', '#17201f', '#f7f4ef']
    }
  };

  var ALIASES = {
    works: 'lana-works',
    'lana-works': 'lana-works',
    agents: 'lana-agents',
    'lana-agents': 'lana-agents',
    insights: 'lana-insights',
    'business-intelligence': 'lana-insights',
    'lana-insights': 'lana-insights',
    'doc-studio': 'doc-studio',
    'deck-studio': 'doc-studio',
    documents: 'doc-studio'
  };

  function canonicalId(value) {
    var id = String(value || '').trim();
    return ALIASES[id] || id;
  }

  function normalizeApp(item) {
    if (!item) return null;
    var rawId = typeof item === 'string'
      ? item
      : (item.id || item.app_id || item.slug || item.key || '');
    var id = canonicalId(rawId);
    var base = CATALOG[id] || {};
    var normalized = typeof item === 'string'
      ? Object.assign({}, base, { id: id })
      : Object.assign({}, base, item, { id: id });

    if (!normalized.id || !normalized.label || !normalized.route) return null;
    if (!Array.isArray(normalized.colors)) normalized.colors = [];
    return normalized;
  }

  function normalizeAppList(items, fallbackItems) {
    var source = Array.isArray(items) && items.length ? items : (fallbackItems || []);
    var seen = Object.create(null);
    var result = [];
    for (var i = 0; i < source.length; i += 1) {
      var normalized = normalizeApp(source[i]);
      if (!normalized || seen[normalized.id]) continue;
      seen[normalized.id] = true;
      result.push(normalized);
    }
    return result;
  }

  function defaultApps() {
    return [CATALOG['lana-works'], CATALOG['lana-agents']];
  }

  global.LanaClientApps = {
    catalog: CATALOG,
    aliases: ALIASES,
    canonicalId: canonicalId,
    normalizeApp: normalizeApp,
    normalizeAppList: normalizeAppList,
    defaultApps: defaultApps
  };
})(window);
