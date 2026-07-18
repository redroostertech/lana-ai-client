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
    'lana-automations': {
      id: 'lana-automations',
      label: 'LanaAutomate',
      description: 'Build, deploy and monitor automated workflows',
      route: 'automation/index.html',
      colors: ['#ffd16f', '#f97316', '#7c3aed', '#4c1d95']
    },
    'doc-studio': {
      id: 'doc-studio',
      label: 'Doc Studio',
      description: 'Generate decks, legal documents, PDFs, and pages',
      route: 'doc-studio/index.html',
      colors: ['#2f6f73', '#b56b45', '#17201f', '#f7f4ef']
    },
    'lana-voice': {
      id: 'lana-voice',
      label: 'LanaVoice',
      description: 'Realtime voice agents and call handling',
      route: 'voice/index.html',
      colors: ['#fcd34d', '#f59e0b', '#b45309', '#1c1917']
    },
    'brainchild': {
      id: 'brainchild',
      label: 'Brainchild',
      description: 'Consolidated documents across your org and personal knowledge',
      route: 'brainchild/index.html',
      colors: ['#f4b740', '#e8743b', '#6b3fa0', '#1b1430']
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
    automation: 'lana-automations',
    automations: 'lana-automations',
    'lana-automate': 'lana-automations',
    'lana-automations': 'lana-automations',
    voice: 'lana-voice',
    'lana-voice': 'lana-voice',
    'doc-studio': 'doc-studio',
    'deck-studio': 'doc-studio',
    documents: 'doc-studio',
    brainchild: 'brainchild',
    brain: 'brainchild',
    knowledge: 'brainchild'
    // NOTE: 'lana-brain' is intentionally NOT aliased here. That string is the
    // loopback bridge's protocol/companion app id (see electron-bridge.js
    // KNOWN_APPS) used to authorize token issuance — a different namespace from
    // this UI catalog. The canonical enable keys for the Brainchild surface in
    // enabled_apps are 'brainchild' / 'brain' / 'knowledge'. Aliasing the bridge
    // id would couple UI tile visibility to a companion identifier that was
    // never meant to gate the surface.
  };

  function canonicalId(value) {
    var id = String(value || '').trim();
    if (ALIASES[id]) return ALIASES[id];
    // Upgrade path for legacy payloads. Control-plane releases up to 2026-07 put
    // @-prefixed BACKEND PACKAGE ids ('@insights', '@agents') in enabled_apps —
    // a different namespace from this UI catalog. Those payloads are cached in
    // electron-storage (see electron-storage.js saveServerConnection), so an
    // already-installed client can still hold one after the control plane is
    // fixed. Strip the prefix and re-resolve through the aliases above.
    //
    // Backend-only apps (@voice, @automation, @heartbeat, @meet,
    // @communications) have NO page in this bundle. They intentionally fall
    // through to an id that misses CATALOG, so normalizeApp rejects them rather
    // than rendering a tile that navigates nowhere.
    if (id.charAt(0) === '@') {
      var stripped = id.slice(1);
      return ALIASES[stripped] || stripped;
    }
    return id;
  }

  // Embedded surfaces may only ever frame remote https origins. javascript:,
  // data:, http:, file:, and protocol-relative values must all fail here —
  // this is one of the two gates (the embed host re-checks) that keep a
  // discovery payload from framing arbitrary content.
  function isHttpsUrl(value) {
    if (typeof value !== 'string' || !value) return false;
    try {
      var parsed = new URL(value);
      return parsed.protocol === 'https:' && !!parsed.hostname;
    } catch (_) {
      return false;
    }
  }

  function normalizeApp(item) {
    if (!item) return null;
    var rawId = typeof item === 'string'
      ? item
      : (item.id || item.app_id || item.slug || item.key || '');
    var id = canonicalId(rawId);

    var embeddedRoute = null;
    if (typeof item === 'object' && item.route && typeof item.route === 'object') {
      embeddedRoute = item.route;
    } else if (
      typeof item === 'object'
      && item.embed
      && typeof item.embed === 'object'
      && item.route === 'embed.html?app=' + encodeURIComponent(id)
    ) {
      // Login persists normalized app entries so iframe consumers can use the
      // same safe representation. Accept that representation on subsequent
      // normalization passes, but only when its route is the exact generic
      // host route derived from this id. This makes normalization idempotent
      // without allowing a payload-selected string route.
      embeddedRoute = item.embed;
    }

    // EMBEDDED SURFACES (docs/EMBEDDED-APPS-SPEC.md). A route OBJECT of type
    // 'embedded' is the one sanctioned way a discovery payload may introduce
    // an app this bundle does not know about: the tile always routes to the
    // generic embed host (embed.html) — never to a payload-chosen file — and
    // the host re-resolves this same payload before framing anything, so the
    // query string carries only the app id. Bare discovery string routes keep
    // the catalog-only rule below, unchanged.
    if (embeddedRoute) {
      var embedRoute = embeddedRoute;
      if (embedRoute.type !== 'embedded') return null;
      if (!isHttpsUrl(embedRoute.url)) return null;
      if (!id || !item.label) return null;
      return {
        id: id,
        label: item.label,
        description: item.description || '',
        colors: Array.isArray(item.colors) ? item.colors : [],
        route: 'embed.html?app=' + encodeURIComponent(id),
        embed: {
          type: 'embedded',
          url: embedRoute.url,
          meta: (embedRoute.meta && typeof embedRoute.meta === 'object') ? embedRoute.meta : {}
        }
      };
    }

    var base = CATALOG[id];

    // FAIL CLOSED. An id that does not resolve to a catalog entry has no page in
    // this bundle. Previously `base` defaulted to {} and a caller-supplied
    // label+route was enough to satisfy the guard below, so an unknown app
    // rendered a clickable tile that navigated to a non-existent file — a blank
    // page. An app we cannot route is not renderable: drop it.
    if (!base) return null;

    // `base` LAST for id+route: this catalog is the ONLY source of truth for
    // routes (bundle-relative files like 'admin/analytics.html'). A legacy
    // payload may still carry a URL-path route ('/insights') that is not a file
    // in this bundle; it must never win. label/description/colors stay
    // caller-overridable so the control plane can still customize presentation.
    var normalized = typeof item === 'string'
      ? Object.assign({}, base)
      : Object.assign({}, base, item, { id: id, route: base.route });

    if (!normalized.id || !normalized.label || !normalized.route) return null;
    if (!Array.isArray(normalized.colors)) normalized.colors = [];
    return normalized;
  }

  // Discovery is also the entitlement manifest for native/background client
  // capabilities. Capability entries are intentionally preserved in storage
  // but never returned by normalizeApp()/normalizeAppList(), so they cannot
  // accidentally become sidebar routes.
  function boundedText(value, maxLength) {
    return typeof value === 'string' ? value.slice(0, maxLength) : '';
  }

  // Hints are display-only discovery content. Keep the contract deliberately
  // small so a malformed control-plane payload cannot create an unbounded
  // settings page. Supported values are strings, arrays of strings, or one
  // nested dictionary of strings.
  function normalizeCapabilityHints(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    var result = {};
    Object.keys(value).slice(0, 20).forEach(function (rawKey) {
      var key = boundedText(rawKey, 80);
      var hint = value[rawKey];
      if (!key) return;
      if (typeof hint === 'string') {
        result[key] = boundedText(hint, 500);
      } else if (Array.isArray(hint)) {
        result[key] = hint.filter(function (item) { return typeof item === 'string'; })
          .slice(0, 10).map(function (item) { return boundedText(item, 500); });
      } else if (hint && typeof hint === 'object') {
        var group = {};
        Object.keys(hint).slice(0, 10).forEach(function (rawGroupKey) {
          if (typeof hint[rawGroupKey] !== 'string') return;
          var groupKey = boundedText(rawGroupKey, 80);
          if (groupKey) group[groupKey] = boundedText(hint[rawGroupKey], 500);
        });
        if (Object.keys(group).length) result[key] = group;
      }
    });
    return result;
  }

  function normalizeCapability(item) {
    if (!item || typeof item !== 'object' || !item.route || typeof item.route !== 'object') return null;
    if (item.route.type !== 'capability') return null;
    var id = canonicalId(item.id || item.app_id || item.slug || item.key || '');
    if (!id || !item.label) return null;

    var rawMeta = item.route.meta && typeof item.route.meta === 'object' ? item.route.meta : {};
    var supportedPlatforms = ['darwin', 'win32', 'linux'];
    var platforms = Array.isArray(rawMeta.platforms)
      ? rawMeta.platforms.filter(function (platform, index, source) {
          return supportedPlatforms.indexOf(platform) !== -1 && source.indexOf(platform) === index;
        })
      : [];

    var meta = Object.assign({}, rawMeta, { platforms: platforms });
    if (Object.prototype.hasOwnProperty.call(rawMeta, 'hints')) {
      meta.hints = normalizeCapabilityHints(rawMeta.hints);
    }
    if (typeof rawMeta.required !== 'boolean') delete meta.required;
    if (typeof rawMeta.default_enabled !== 'boolean') delete meta.default_enabled;

    return {
      id: id,
      label: item.label,
      description: item.description || '',
      colors: Array.isArray(item.colors) ? item.colors : [],
      route: {
        type: 'capability',
        meta: meta
      }
    };
  }

  function normalizeEnabledApp(item) {
    return normalizeCapability(item) || normalizeApp(item);
  }

  function normalizeEnabledAppList(items) {
    if (!Array.isArray(items)) return [];
    var seen = Object.create(null);
    var result = [];
    for (var i = 0; i < items.length; i += 1) {
      var normalized = normalizeEnabledApp(items[i]);
      if (!normalized || seen[normalized.id]) continue;
      seen[normalized.id] = true;
      result.push(normalized);
    }
    return result;
  }

  function resolveList(source) {
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

  function normalizeAppList(items, fallbackItems) {
    var hasItems = Array.isArray(items) && items.length;
    var result = resolveList(hasItems ? items : (fallbackItems || []));

    // A non-empty list where NOTHING resolved means the payload speaks a
    // namespace this bundle does not understand — e.g. a cached legacy
    // enabled_apps holding only backend-only ids (@voice, @automation, ...).
    // Rendering an empty switcher would strand the user with no way back to the
    // workspace, so fall back to the built-in defaults instead.
    if (hasItems && !result.length) {
      result = resolveList(Array.isArray(fallbackItems) && fallbackItems.length
        ? fallbackItems
        : defaultApps());
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
    isHttpsUrl: isHttpsUrl,
    normalizeApp: normalizeApp,
    normalizeAppList: normalizeAppList,
    normalizeCapability: normalizeCapability,
    normalizeCapabilityHints: normalizeCapabilityHints,
    normalizeEnabledApp: normalizeEnabledApp,
    normalizeEnabledAppList: normalizeEnabledAppList,
    defaultApps: defaultApps
  };
})(window);
