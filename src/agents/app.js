// src/agents/app.js
//
// LanaAgents SPA controller. Modeled on src/automation/app.js.
//
// Mounts in src/agents/index.html (the host shell) and drives a
// state-machine over the workspace, builder, detail, live-run, outcomes,
// and tools views. View modules under src/agents/js/views/ register
// themselves on window.LanaAgentsApp.Views and are dispatched by
// setView() based on URL hash + sidebar clicks.
//
// Internal navigation goes through window.LanaAgentsApp.setView, NOT
// through Lex.Nav.go. Lex.Nav.go does a full window navigation; this
// SPA replaces that with hash-based routing.
//
// Cross-app navigation (back to LanaWorks) still uses the lex-app
// logo-href (set in index.html to '../dashboard.html').
//
// View module contract — each view module on
// window.LanaAgentsApp.Views[<viewId>] must expose:
//   {
//     render(rootEl, ctx),       // ctx: { ...viewParams, app: window.LanaAgentsApp }
//     destroy?(rootEl)           // optional cleanup before next view renders
//   }
//
// Hash routes (defensive — unknown hashes fall through to 'catalog'):
//   ''            or '#catalog'        -> catalog        ({})
//   '#agent/<slug>'                    -> agentDetail    ({ slug })
//   '#run/<runId>'                     -> agentRun       ({ runId })
//   '#activity'                        -> activity       ({})
//   '#activity/<id>'                   -> activityDetail ({ id })
//   '#create'                          -> create         ({})
//   '#create/import'                   -> create         ({ mode: 'import' })
//   '#tools/browse'                    -> toolsBrowse    ({})
//
// Sub-routes keep the parent's sidebar nav highlighted:
//   agentDetail, agentRun  -> 'catalog'
//   activityDetail         -> 'activity'
//   create, toolsBrowse    -> 'create' (sidebar Create button stays highlighted
//                            while the user is in the full-screen
//                            create + browse-tools flow). 'create' is a
//                            non-nav virtual parent — it doesn't appear
//                            in SIDEBAR_NAV_ITEMS but the sidebar Create
//                            button shares the id so VIEW_PARENT can map
//                            both views to it.
//
// Public surface (window.LanaAgentsApp):
//   .setView(view, params)   navigate to a view (also updates URL hash)
//   .navigate(view, params)  alias for setView (kept stable for view modules)
//   .state                   read-only view of controller state
//   .Views                   namespace where view modules register
//   .SIDEBAR_NAV_ITEMS       array clone of the top-level nav

'use strict';

(function (global) {
  // -------------------------------------------------------------------------
  // Top-level nav (replaces sidebar-config.js — Agent 3 deletes that file).
  // The id here doubles as the view slug for top-level nav. Sub-routes
  // (agentDetail, agentRun, activityDetail) resolve to a parent id via
  // VIEW_PARENT below so the sidebar highlight stays consistent.
  // -------------------------------------------------------------------------
  var SIDEBAR_NAV_ITEMS = [
    { id: 'catalog',  label: 'Workspace', icon: 'layout-dashboard' },
    { id: 'activity', label: 'Outcomes',  icon: 'sparkles' }
  ];

  var VIEW_IDS = {
    catalog: 'catalog',
    agentDetail: 'agentDetail',
    agentRun: 'agentRun',
    activity: 'activity',
    activityDetail: 'activityDetail',
    create: 'create',
    toolsBrowse: 'toolsBrowse'
  };

  // Sub-route -> top-level nav id used for sidebar activeId.
  // 'create' is a virtual parent: it isn't in SIDEBAR_NAV_ITEMS, but the
  // sidebar's static Create button uses the same id so the highlight is
  // shared. Both 'create' and 'toolsBrowse' map to it.
  var VIEW_PARENT = {
    catalog: 'catalog',
    agentDetail: 'catalog',
    agentRun: 'catalog',
    activity: 'activity',
    activityDetail: 'activity',
    create: 'create',
    toolsBrowse: 'create'
  };

  // Topbar / page title metadata. Falls back to 'Agents' for unknown views.
  var VIEW_META = {
    catalog:        { title: 'Agent Studio' },
    agentDetail:    { title: 'Agent' },
    agentRun:       { title: 'Run' },
    activity:       { title: 'Outcomes' },
    activityDetail: { title: 'Outcome detail' },
    create:         { title: 'Build an agent' },
    toolsBrowse:    { title: 'Browse tools' }
  };

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  var state = {
    currentView: null,    // one of VIEW_IDS
    viewParams: {},       // view-specific params (e.g., { slug }, { runId }, { id })
    initialized: false,   // true once lex-app-ready fired and we wired the shell
    booted: false         // true once the very first setView() landed
  };

  var els = {
    shell: null,    // <lex-app id="agents-shell">
    sidebar: null,  // resolved on lex-app-ready
    topbar: null,   // resolved on lex-app-ready
    content: null   // resolved on lex-app-ready (the lex-app's content slot)
  };

  // Internal flag so we don't loop when setView() updates the URL hash
  // and the resulting hashchange event fires back into the router.
  var _suppressNextHashChange = false;

  // -------------------------------------------------------------------------
  // Element resolution
  //
  // automation/app.js (line 282-300) resolves the content slot via
  //   shell.getContentEl ? shell.getContentEl() : document.getElementById('lex-main-content')
  // and resolves the sidebar/topbar via querySelector inside the shell.
  // We mirror that exactly here.
  // -------------------------------------------------------------------------
  function cacheElements() {
    els.shell = document.getElementById('agents-shell');
    if (!els.shell) {
      console.warn('[agents] <lex-app id="agents-shell"> not found; SPA cannot mount.');
      return false;
    }
    els.sidebar = els.shell.querySelector('lex-sidebar') || document.querySelector('lex-sidebar');
    els.topbar = els.shell.querySelector('lex-topbar') || document.querySelector('lex-topbar');
    els.content = (typeof els.shell.getContentEl === 'function')
      ? els.shell.getContentEl()
      : document.getElementById('lex-main-content');
    return Boolean(els.content);
  }

  // -------------------------------------------------------------------------
  // Sidebar wiring (mirrors automation/app.js renderUserChip lines 3066-3102)
  // -------------------------------------------------------------------------
  function applySidebarSections() {
    if (!els.shell && !els.sidebar) return;

    var sections = [
      {
        id: 'main-actions',
        isStaticTop: true,
        // The static CTA routes into the full-screen guided builder.
        items: [{ id: 'create', label: 'Build an agent', icon: 'plus', isButton: true, onClick: 'openAgentCreateModal', variant: 'create-chat' }]
      },
      {
        id: 'navigation',
        items: SIDEBAR_NAV_ITEMS.map(function (item) {
          return Object.assign({}, item, { href: '#' + item.id });
        })
      }
    ];

    if (els.shell && typeof els.shell.setSections === 'function') {
      els.shell.setSections(sections);
    } else if (els.sidebar) {
      els.sidebar.sections = sections;
    }

    syncSidebarActive();

    // Footer (user block + canonical user menu + version) is shared with the
    // host shell — set via the LanaSidebarFooter helper so every sub-app
    // routes Settings/Connectors/Help/Admin to the same host pages. This
    // mirrors automation/app.js's footer hydration.
    if (global.LanaSidebarFooter && els.sidebar) {
      try {
        global.LanaSidebarFooter.hydrate(els.sidebar, { pathPrefix: '../' });
      } catch (err) {
        console.warn('[agents] LanaSidebarFooter.hydrate failed', err);
      }
    }
  }

  function syncSidebarActive() {
    var activeId = VIEW_PARENT[state.currentView] || 'catalog';
    if (els.sidebar) {
      els.sidebar.activeId = activeId;
    }
    if (els.shell) {
      els.shell.activeNavId = activeId;
    }
  }

  // -------------------------------------------------------------------------
  // View dispatch
  // -------------------------------------------------------------------------
  function getViews() {
    return (global.LanaAgentsApp && global.LanaAgentsApp.Views) || {};
  }

  function callViewDestroy(viewId, rootEl) {
    if (!viewId || !rootEl) return;
    var views = getViews();
    var prev = views[viewId];
    if (prev && typeof prev.destroy === 'function') {
      try {
        prev.destroy(rootEl);
      } catch (err) {
        console.warn('[agents] view destroy() threw for "' + viewId + '"', err);
      }
    }
  }

  function renderMissingViewPlaceholder(viewId) {
    if (!els.content) return;
    var safeId = String(viewId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '');
    els.content.innerHTML =
      '<div class="agents-view-error" role="alert">' +
        '<h2>View unavailable</h2>' +
        '<p>' +
          'The "' + safeId + '" view module is not registered. ' +
          'View modules attach themselves to window.LanaAgentsApp.Views.' +
        '</p>' +
      '</div>';
  }

  function callViewRender(viewId) {
    if (!els.content) return;
    var views = getViews();
    var view = views[viewId];
    if (!view || typeof view.render !== 'function') {
      console.warn('[agents] view module not registered: "' + viewId + '"');
      renderMissingViewPlaceholder(viewId);
      return;
    }
    var ctx = Object.assign({}, state.viewParams, { app: global.LanaAgentsApp });
    try {
      view.render(els.content, ctx);
    } catch (err) {
      console.error('[agents] view render() threw for "' + viewId + '"', err);
      renderMissingViewPlaceholder(viewId);
    }
  }

  // setView is the single transition point. It tears down the previous view,
  // updates state, clears the content slot, syncs URL hash + sidebar, then
  // calls render() on the next view module.
  function setView(view, params, options) {
    options = options || {};
    var nextView = VIEW_PARENT[view] ? view : VIEW_IDS.catalog;
    var nextParams = (params && typeof params === 'object') ? params : {};

    // 1) Teardown previous view (if any).
    if (state.currentView && state.currentView !== nextView) {
      callViewDestroy(state.currentView, els.content);
    } else if (state.currentView === nextView) {
      // Same view, different params (e.g. agentDetail slug change).
      callViewDestroy(state.currentView, els.content);
    }

    // 2) Update state.
    state.currentView = nextView;
    state.viewParams = nextParams;

    // 3) Clear content (clean slate for the next view).
    if (els.content) {
      els.content.innerHTML = '';
    }

    // 4) Sync URL hash (so deep links work + reload restores the view).
    var nextHash = buildHashFor(nextView, nextParams);
    if (typeof window !== 'undefined' && window.location) {
      var currentHash = window.location.hash || '';
      var path = window.location.pathname + window.location.search;
      var historyPayload = {
        lanaSubApp: 'agents',
        agentsView: nextView,
        agentsParams: nextParams
      };

      if (!options.skipHistory && currentHash !== nextHash) {
        if (typeof window.history !== 'undefined' && window.history.pushState) {
          if (options.replaceHistory || !state.booted) {
            window.history.replaceState(historyPayload, '', path + nextHash);
          } else {
            window.history.pushState(historyPayload, '', path + nextHash);
          }
        } else {
          _suppressNextHashChange = true;
          window.location.hash = nextHash;
        }
      } else if (!options.skipHistory && currentHash === nextHash && !state.booted && typeof window.history !== 'undefined' && window.history.replaceState) {
        window.history.replaceState(historyPayload, '', path + nextHash);
      }
    }

    // 5) Sync sidebar active id + page title.
    syncSidebarActive();
    var meta = VIEW_META[nextView] || VIEW_META.catalog;
    if (els.shell) {
      try { els.shell.pageTitle = meta.title || 'Agents'; } catch (_e) {}
    }
    if (els.topbar) {
      try { els.topbar.heading = meta.title || 'Agents'; } catch (_e) {}
    }

    // 6) Render the next view.
    callViewRender(nextView);
    state.booted = true;
  }

  // -------------------------------------------------------------------------
  // Hash routing
  // -------------------------------------------------------------------------
  function parseHash(rawHash) {
    var hash = String(rawHash || '');
    if (hash.charAt(0) === '#') hash = hash.slice(1);
    hash = hash.trim();

    if (!hash || hash === 'catalog') {
      return { view: VIEW_IDS.catalog, params: {} };
    }

    // '#agent/<slug>?definition_id=<id>'
    if (hash.indexOf('agent/') === 0) {
      var agentRoute = hash.slice('agent/'.length).trim();
      var queryIndex = agentRoute.indexOf('?');
      var slug = queryIndex === -1 ? agentRoute : agentRoute.slice(0, queryIndex);
      var agentParams = { slug: decodeURIComponent(slug) };
      if (queryIndex !== -1) {
        var query = new URLSearchParams(agentRoute.slice(queryIndex + 1));
        var definitionId = query.get('definition_id');
        if (definitionId) agentParams.definitionId = definitionId;
      }
      if (slug) {
        return { view: VIEW_IDS.agentDetail, params: agentParams };
      }
      return { view: VIEW_IDS.catalog, params: {} };
    }

    // '#run/<runId>'
    if (hash.indexOf('run/') === 0) {
      var runId = hash.slice('run/'.length).trim();
      if (runId) {
        return { view: VIEW_IDS.agentRun, params: { runId: decodeURIComponent(runId) } };
      }
      return { view: VIEW_IDS.catalog, params: {} };
    }

    // '#activity' or '#activity/<id>'
    if (hash === 'activity') {
      return { view: VIEW_IDS.activity, params: {} };
    }
    if (hash.indexOf('activity/') === 0) {
      var actId = hash.slice('activity/'.length).trim();
      if (actId) {
        return { view: VIEW_IDS.activityDetail, params: { id: decodeURIComponent(actId) } };
      }
      return { view: VIEW_IDS.activity, params: {} };
    }

    // '#create' — full-screen agent-create view.
    if (hash === 'create') {
      return { view: VIEW_IDS.create, params: {} };
    }
    if (hash === 'create/import') {
      return { view: VIEW_IDS.create, params: { mode: 'import' } };
    }

    // '#tools/browse' — full-screen tools-browser view.
    if (hash === 'tools/browse' || hash === 'tools') {
      return { view: VIEW_IDS.toolsBrowse, params: {} };
    }

    // Top-level nav id used as a hash (e.g. '#catalog', '#activity').
    if (VIEW_PARENT[hash]) {
      return { view: hash, params: {} };
    }

    // Defensive: unknown hashes fall back to catalog.
    return { view: VIEW_IDS.catalog, params: {} };
  }

  function buildHashFor(view, params) {
    var p = params || {};
    switch (view) {
      case VIEW_IDS.catalog:
        return '#catalog';
      case VIEW_IDS.activity:
        return '#activity';
      case VIEW_IDS.agentDetail:
        return p.slug
          ? '#agent/' + encodeURIComponent(p.slug)
            + (p.definitionId ? '?definition_id=' + encodeURIComponent(p.definitionId) : '')
          : '#catalog';
      case VIEW_IDS.agentRun:
        return p.runId ? '#run/' + encodeURIComponent(p.runId) : '#catalog';
      case VIEW_IDS.activityDetail:
        return p.id ? '#activity/' + encodeURIComponent(p.id) : '#activity';
      case VIEW_IDS.create:
        return p.mode === 'import' ? '#create/import' : '#create';
      case VIEW_IDS.toolsBrowse:
        return '#tools/browse';
      default:
        return '#catalog';
    }
  }

  function dispatchFromHash(options) {
    var parsed = parseHash(typeof window !== 'undefined' ? window.location.hash : '');
    setView(parsed.view, parsed.params, options || {});
  }

  function onHashChange() {
    if (_suppressNextHashChange) {
      _suppressNextHashChange = false;
      return;
    }
    dispatchFromHash({ replaceHistory: true });
  }

  function onPopState() {
    _suppressNextHashChange = true;
    dispatchFromHash({ skipHistory: true });
  }

  // -------------------------------------------------------------------------
  // Sidebar nav click handler
  // -------------------------------------------------------------------------
  function onSidebarNavClick(event) {
    if (event && typeof event.stopPropagation === 'function') {
      event.stopPropagation();
    }
    var detail = (event && event.detail) || {};
    var id = detail.id;
    if (!id) return;

    // Only act on top-level nav items defined in SIDEBAR_NAV_ITEMS.
    var match = null;
    for (var i = 0; i < SIDEBAR_NAV_ITEMS.length; i += 1) {
      if (SIDEBAR_NAV_ITEMS[i].id === id) { match = SIDEBAR_NAV_ITEMS[i]; break; }
    }
    if (!match) return;

    setView(id, {});
  }

  function onSidebarUserAction(event) {
    // The host shell's sidebar footer surfaces canonical user actions
    // (Settings, Sign out, Admin, etc.). Sub-apps don't own a router, so
    // navigate manually when an href is present. This mirrors
    // automation/app.js's onSidebarUserAction (lines ~699-716).
    var detail = event && event.detail;
    if (!detail) return;
    if (detail.action === 'signout') {
      // Sign-out flow lives in auth-guard / api on the host. A best-effort
      // bounce keeps parity with automation when no logout helper is wired.
      if (global.api && typeof global.api.logout === 'function') {
        try { global.api.logout(); } catch (_e) {}
      }
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('token');
        }
      } catch (_e) {}
      window.location.href = '../login.html';
      return;
    }
    if (detail.href) {
      window.location.href = detail.href;
    }
  }

  // -------------------------------------------------------------------------
  // Boot sequence — wait for lex-app-ready, then wire and dispatch.
  // -------------------------------------------------------------------------
  function onShellReady() {
    if (state.initialized) return;
    state.initialized = true;

    if (!cacheElements()) {
      console.warn('[agents] cacheElements() failed; aborting SPA boot.');
      return;
    }

    // lex-page-init.js may have already cloned <template id="page-content">
    // into the content slot. Clear it so the SPA owns the surface.
    if (els.content) {
      els.content.innerHTML = '';
    }

    applySidebarSections();

    if (els.sidebar) {
      els.sidebar.addEventListener('sidebar-nav-click', onSidebarNavClick);
      els.sidebar.addEventListener('sidebar-user-action', onSidebarUserAction);
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', onHashChange);
      window.addEventListener('popstate', onPopState);
    }

    // Dispatch the initial route from URL hash.
    dispatchFromHash({ replaceHistory: true });
  }

  function bindShellReady() {
    var shell = document.getElementById('agents-shell');
    if (!shell) {
      console.warn('[agents] <lex-app id="agents-shell"> not in DOM at script load.');
      return;
    }
    // If the shell is already rendered (race against script ordering), boot
    // immediately. Otherwise wait for lex-app-ready exactly once.
    if (shell._shellRendered) {
      onShellReady();
      return;
    }
    var fired = false;
    var done = function () {
      if (fired) return;
      fired = true;
      shell.removeEventListener('lex-app-ready', done);
      onShellReady();
    };
    shell.addEventListener('lex-app-ready', done);
    // Safety net — if lex-app-ready never fires (component swallowed the
    // event), still attempt boot after a short delay so the SPA isn't stuck
    // on a blank shell.
    window.setTimeout(done, 1000);
  }

  // -------------------------------------------------------------------------
  // Public API — exposed on window.LanaAgentsApp for view modules.
  // -------------------------------------------------------------------------
  global.LanaAgentsApp = global.LanaAgentsApp || {};
  global.LanaAgentsApp.Views = global.LanaAgentsApp.Views || {};
  global.LanaAgentsApp.SIDEBAR_NAV_ITEMS = SIDEBAR_NAV_ITEMS.slice();
  global.LanaAgentsApp.state = state;
  global.LanaAgentsApp.setView = setView;
  // Alias kept stable for view modules — same function reference as setView.
  global.LanaAgentsApp.navigate = setView;

  // Wired to the sidebar's static Create button (see applySidebarSections).
  // The legacy function name remains because the shared sidebar resolves
  // named callbacks, but the action opens the full-screen guided builder.
  global.openAgentCreateModal = function () {
    setView('create', {});
  };

  // -------------------------------------------------------------------------
  // Entry
  // -------------------------------------------------------------------------
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bindShellReady, { once: true });
    } else {
      bindShellReady();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
