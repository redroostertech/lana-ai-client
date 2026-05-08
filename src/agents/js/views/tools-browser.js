/* tools-browser.js — Full-screen tools-browser SPA view module.
   Modeled on the automation Browse Events modal: 3-column layout
   (categories | list | detail) with a top search input.

   Hash route: '#tools/browse' (registered in src/agents/app.js).
   Sidebar parent: 'create'.

   Source: GET /api/v1/tools/registry. The endpoint returns a
   { categories: [{ id, label, tools: [{ name, description, parameters,
   category_id }] }] } shape (see @agents tool-registry route).

   Selected-tool state is persisted on
   window.LanaAgentsApp.state.pendingCreate.selectedTools so the user
   can return to the create view (#create) with their picks intact.
   sessionStorage mirrors it for hard-reload safety.

   Rules:
     - IIFE wrapper, no top-level const/class
     - Internal navigation goes through ctx.app.setView
     - All HTML escaping via Lex.Utils.escapeHtml()
     - NO regex — string methods only
*/

'use strict';

(function (global) {
  global.LanaAgentsApp = global.LanaAgentsApp || {};
  global.LanaAgentsApp.Views = global.LanaAgentsApp.Views || {};

  var PENDING_KEY = 'lana_agents_pending_create';

  var escHtml = (typeof window !== 'undefined' && window.Lex && window.Lex.Utils && window.Lex.Utils.escapeHtml)
    ? window.Lex.Utils.escapeHtml
    : function (s) { var d = document.createElement('div'); d.textContent = (s == null ? '' : String(s)); return d.innerHTML; };

  // ---------------------------------------------------------------------------
  // Markup template
  // ---------------------------------------------------------------------------
  var TEMPLATE = ''
    + '<main class="tools-browser-page-container">'

    + '<lex-banner'
    +   ' id="toolsBrowserBanner"'
    +   ' variant="light"'
    +   ' heading="Browse tools"'
    +   ' subtitle="Add tools to your agent. Filter by category or search by name."'
    + '>'
    +   '<lex-btn id="toolsBrowserDoneBtn" variant="primary" icon="check">Done</lex-btn>'
    + '</lex-banner>'

    + '<div class="tools-browser-search-bar">'
    +   '<lex-input'
    +     ' id="toolsBrowserSearch"'
    +     ' type="search"'
    +     ' placeholder="Search by name or description..."'
    +     ' leading-icon="search"'
    +     ' clearable'
    +   '></lex-input>'
    + '</div>'

    + '<div class="tools-browser-grid">'

    +   '<aside class="tools-browser-categories">'
    +     '<h4 class="tools-browser-section-title">Categories</h4>'
    +     '<div id="toolsBrowserCategoryList" class="tools-browser-category-list">'
    +       '<div class="tools-browser-loading">Loading categories...</div>'
    +     '</div>'
    +   '</aside>'

    +   '<section class="tools-browser-list">'
    +     '<div id="toolsBrowserListLoading" class="tools-browser-loading">'
    +       '<lex-spinner size="sm"></lex-spinner>'
    +       '<span>Loading tools...</span>'
    +     '</div>'
    +     '<div id="toolsBrowserListContent"></div>'
    +     '<div id="toolsBrowserListEmpty" class="hidden">'
    +       '<lex-empty'
    +         ' icon="search"'
    +         ' message="No tools match your filters"'
    +         ' description="Try a different category or clear the search."'
    +       '></lex-empty>'
    +     '</div>'
    +   '</section>'

    +   '<aside class="tools-browser-detail">'
    +     '<h4 class="tools-browser-section-title">Details</h4>'
    +     '<div id="toolsBrowserDetailContent" class="tools-browser-detail-content">'
    +       '<p class="tools-browser-detail-empty">Select a tool to see its details, parameters, and example invocation.</p>'
    +     '</div>'
    +   '</aside>'

    + '</div>'

    + '</main>';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  function createState() {
    return {
      // Raw response: { categories: [{ id, label, tools: [...] }] }
      categories: [],
      activeCategoryId: '',     // '' = "All"
      query: '',
      selectedToolName: '',
      // Map<toolName, true> — what the user has added to the agent.
      // Persisted to window.LanaAgentsApp.state.pendingCreate.
      selectedTools: {},
      destroyed: false,
      _unbindFns: []
    };
  }

  // ---------------------------------------------------------------------------
  // Pending-state persistence (shared with agent-create.js)
  // ---------------------------------------------------------------------------

  function readPending(app) {
    if (app && app.state && app.state.pendingCreate) {
      return app.state.pendingCreate;
    }
    if (typeof sessionStorage !== 'undefined') {
      try {
        var raw = sessionStorage.getItem(PENDING_KEY);
        if (raw) return JSON.parse(raw);
      } catch (_e) { /* ignore */ }
    }
    return null;
  }

  function writePending(app, snapshot) {
    if (app && app.state) {
      app.state.pendingCreate = snapshot;
    }
    if (typeof sessionStorage !== 'undefined') {
      try {
        if (snapshot) {
          sessionStorage.setItem(PENDING_KEY, JSON.stringify(snapshot));
        } else {
          sessionStorage.removeItem(PENDING_KEY);
        }
      } catch (_e) { /* ignore */ }
    }
  }

  function persistSelected(app, state) {
    var snapshot = readPending(app) || {};
    snapshot.selectedTools = [];
    for (var k in state.selectedTools) {
      if (Object.prototype.hasOwnProperty.call(state.selectedTools, k) && state.selectedTools[k]) {
        snapshot.selectedTools.push(k);
      }
    }
    writePending(app, snapshot);
  }

  // ---------------------------------------------------------------------------
  // Filter helpers — pure (exposed for tests)
  // ---------------------------------------------------------------------------

  function matchesQuery(tool, q) {
    if (!q) return true;
    var lower = String(q).toLowerCase();
    var name = String(tool && tool.name || '').toLowerCase();
    var desc = String(tool && tool.description || '').toLowerCase();
    return name.indexOf(lower) !== -1 || desc.indexOf(lower) !== -1;
  }

  function filterTools(categories, activeCategoryId, query) {
    var out = [];
    for (var i = 0; i < categories.length; i++) {
      var cat = categories[i];
      if (activeCategoryId && cat.id !== activeCategoryId) continue;
      var tools = (cat.tools || []).filter(function (t) {
        return matchesQuery(t, query);
      });
      if (tools.length) {
        out.push({ id: cat.id, label: cat.label, tools: tools });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  function el(id) { return document.getElementById(id); }
  function show(node) { if (node) node.classList.remove('hidden'); }
  function hide(node) { if (node) node.classList.add('hidden'); }

  function renderCategoryList(state) {
    var holder = el('toolsBrowserCategoryList');
    if (!holder) return;

    // Always include the synthetic "All" entry first.
    var html = ''
      + '<button type="button" class="tools-browser-category '
      + (state.activeCategoryId === '' ? 'active' : '') + '" '
      + 'data-category-id="">'
      + '<strong>All</strong>'
      + '<span class="tools-browser-category-count">'
      + escHtml(String(totalToolCount(state.categories))) + ' tools'
      + '</span>'
      + '</button>';

    for (var i = 0; i < state.categories.length; i++) {
      var cat = state.categories[i];
      var safeId = escHtml(cat.id);
      var label = escHtml(cat.label);
      var count = (cat.tools || []).length;
      var active = state.activeCategoryId === cat.id ? 'active' : '';
      html += ''
        + '<button type="button" class="tools-browser-category ' + active + '" '
        + 'data-category-id="' + safeId + '">'
        + '<strong>' + label + '</strong>'
        + '<span class="tools-browser-category-count">' + count + ' tools</span>'
        + '</button>';
    }
    holder.innerHTML = html;
  }

  function totalToolCount(categories) {
    var n = 0;
    for (var i = 0; i < categories.length; i++) {
      n += (categories[i].tools || []).length;
    }
    return n;
  }

  function renderToolList(state) {
    var loadingEl = el('toolsBrowserListLoading');
    var contentEl = el('toolsBrowserListContent');
    var emptyEl = el('toolsBrowserListEmpty');
    if (!contentEl) return;

    hide(loadingEl);

    var groups = filterTools(state.categories, state.activeCategoryId, state.query);
    if (!groups.length) {
      contentEl.innerHTML = '';
      show(emptyEl);
      return;
    }
    hide(emptyEl);

    var html = '';
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      html += '<div class="tools-browser-group">'
            + '<h5 class="tools-browser-group-label">' + escHtml(g.label) + '</h5>';
      for (var j = 0; j < g.tools.length; j++) {
        var t = g.tools[j];
        var name = escHtml(t.name || '');
        var desc = escHtml(t.description || '');
        var isSelected = !!state.selectedTools[t.name];
        var isActive = (state.selectedToolName === t.name);
        var btnLabel = isSelected ? 'Remove' : 'Add';
        var btnVariant = isSelected ? 'ghost' : 'primary';
        var rowClasses = 'tools-browser-tool-row'
          + (isActive ? ' active' : '')
          + (isSelected ? ' selected' : '');
        html += ''
          + '<div class="' + rowClasses + '" data-tool-name="' + name + '">'
          +   '<div class="tools-browser-tool-main">'
          +     '<div class="tools-browser-tool-name">' + name
          +       (isSelected ? ' <span class="tools-browser-selected-badge">Added</span>' : '')
          +     '</div>'
          +     '<div class="tools-browser-tool-desc">' + desc + '</div>'
          +   '</div>'
          +   '<lex-btn'
          +     ' size="sm"'
          +     ' variant="' + btnVariant + '"'
          +     ' data-tool-action="toggle"'
          +     ' data-tool-name="' + name + '"'
          +   '>' + btnLabel + '</lex-btn>'
          + '</div>';
      }
      html += '</div>';
    }
    contentEl.innerHTML = html;
  }

  function findToolByName(state, name) {
    if (!name) return null;
    for (var i = 0; i < state.categories.length; i++) {
      var tools = state.categories[i].tools || [];
      for (var j = 0; j < tools.length; j++) {
        if (tools[j].name === name) return tools[j];
      }
    }
    return null;
  }

  function renderDetail(state) {
    var holder = el('toolsBrowserDetailContent');
    if (!holder) return;
    var t = findToolByName(state, state.selectedToolName);
    if (!t) {
      holder.innerHTML = '<p class="tools-browser-detail-empty">Select a tool to see its details, parameters, and example invocation.</p>';
      return;
    }

    var name = escHtml(t.name || '');
    var desc = escHtml(t.description || '');
    var category = escHtml(t.category_id || '');
    var schemaStr = '';
    try {
      schemaStr = JSON.stringify(t.parameters || {}, null, 2);
    } catch (_e) {
      schemaStr = '(unable to render schema)';
    }
    var example = buildExampleInvocation(t);

    var isSelected = !!state.selectedTools[t.name];
    var actionLabel = isSelected ? 'Remove from agent' : 'Add to agent';
    var actionVariant = isSelected ? 'ghost' : 'primary';

    holder.innerHTML = ''
      + '<div class="tools-browser-detail-head">'
      +   '<h3 class="tools-browser-detail-name">' + name + '</h3>'
      +   '<div class="tools-browser-detail-meta">'
      +     '<span class="tools-browser-detail-category">' + category + '</span>'
      +   '</div>'
      + '</div>'
      + '<p class="tools-browser-detail-description">' + desc + '</p>'
      + '<div class="tools-browser-detail-section">'
      +   '<h5 class="tools-browser-detail-section-label">Parameters</h5>'
      +   '<pre class="tools-browser-detail-pre">' + escHtml(schemaStr) + '</pre>'
      + '</div>'
      + '<div class="tools-browser-detail-section">'
      +   '<h5 class="tools-browser-detail-section-label">Example invocation</h5>'
      +   '<pre class="tools-browser-detail-pre">' + escHtml(example) + '</pre>'
      + '</div>'
      + '<div class="tools-browser-detail-actions">'
      +   '<lex-btn'
      +     ' variant="' + actionVariant + '"'
      +     ' icon="' + (isSelected ? 'minus' : 'plus') + '"'
      +     ' data-tool-action="toggle-detail"'
      +     ' data-tool-name="' + name + '"'
      +   '>' + actionLabel + '</lex-btn>'
      + '</div>';
  }

  function buildExampleInvocation(tool) {
    if (!tool || !tool.parameters || !tool.parameters.properties) {
      return JSON.stringify({ tool: tool && tool.name, params: {} }, null, 2);
    }
    var props = tool.parameters.properties || {};
    var required = tool.parameters.required || [];
    var example = {};
    // Fill required first, then a couple of optional fields, with placeholder values.
    for (var i = 0; i < required.length; i++) {
      var key = required[i];
      example[key] = sampleForProp(props[key]);
    }
    var keys = Object.keys(props);
    for (var j = 0; j < keys.length && Object.keys(example).length < 4; j++) {
      if (Object.prototype.hasOwnProperty.call(example, keys[j])) continue;
      example[keys[j]] = sampleForProp(props[keys[j]]);
    }
    return JSON.stringify({ tool: tool.name, params: example }, null, 2);
  }

  function sampleForProp(prop) {
    if (!prop || !prop.type) return '<value>';
    switch (prop.type) {
      case 'string':  return prop.description ? '<' + prop.description.split(' ').slice(0, 4).join(' ') + '>' : '<text>';
      case 'number':
      case 'integer': return 0;
      case 'boolean': return false;
      case 'array':   return [];
      case 'object':  return {};
      default:        return '<value>';
    }
  }

  // ---------------------------------------------------------------------------
  // Data load
  // ---------------------------------------------------------------------------

  function loadRegistry(state) {
    if (!window.api || typeof window.api.get !== 'function') {
      var onReady = function () { loadRegistry(state); };
      state._lexReadyHandler = onReady;
      document.addEventListener('lex-ready', onReady, { once: true });
      return;
    }
    window.api.get('/api/v1/tools/registry')
      .then(function (resp) {
        if (state.destroyed) return;
        var categories = (resp && resp.categories) ? resp.categories : [];
        state.categories = Array.isArray(categories) ? categories : [];
        // Default-select the first available tool so the detail panel
        // is informative on first paint.
        if (!state.selectedToolName) {
          for (var i = 0; i < state.categories.length; i++) {
            var tools = state.categories[i].tools || [];
            if (tools.length) { state.selectedToolName = tools[0].name; break; }
          }
        }
        renderCategoryList(state);
        renderToolList(state);
        renderDetail(state);
      })
      .catch(function (err) {
        if (state.destroyed) return;
        console.error('[agents] tools-browser: failed to load registry', err);
        var listLoading = el('toolsBrowserListLoading');
        if (listLoading) {
          listLoading.innerHTML = '<lex-empty icon="alert-circle" '
            + 'message="Tools registry unavailable" '
            + 'description="The tools registry endpoint is not available on this server."></lex-empty>';
        }
      });
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  function onSearchInput(state, evt) {
    var v = (evt && evt.detail && evt.detail.value);
    if (v == null) v = (el('toolsBrowserSearch') && el('toolsBrowserSearch').value) || '';
    state.query = String(v || '');
    renderToolList(state);
  }

  function onCategoryClick(state, evt) {
    var btn = evt.target.closest('[data-category-id]');
    if (!btn) return;
    state.activeCategoryId = btn.getAttribute('data-category-id') || '';
    renderCategoryList(state);
    renderToolList(state);
  }

  function onListClick(ctx, state, evt) {
    var actionBtn = evt.target.closest('[data-tool-action]');
    var row = evt.target.closest('[data-tool-name]');
    if (!row && !actionBtn) return;

    if (actionBtn) {
      evt.stopPropagation();
      var actionToolName = actionBtn.getAttribute('data-tool-name');
      toggleSelected(ctx, state, actionToolName);
      return;
    }

    var rowName = row.getAttribute('data-tool-name');
    if (rowName) {
      state.selectedToolName = rowName;
      renderToolList(state);
      renderDetail(state);
    }
  }

  function toggleSelected(ctx, state, name) {
    if (!name) return;
    if (state.selectedTools[name]) {
      delete state.selectedTools[name];
    } else {
      state.selectedTools[name] = true;
    }
    persistSelected(ctx.app, state);
    renderToolList(state);
    renderDetail(state);
  }

  function onDetailClick(ctx, state, evt) {
    var btn = evt.target.closest('[data-tool-action="toggle-detail"]');
    if (!btn) return;
    var name = btn.getAttribute('data-tool-name');
    toggleSelected(ctx, state, name);
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  function wire(ctx, state) {
    var search = el('toolsBrowserSearch');
    if (search) {
      var sHandler = function (e) { onSearchInput(state, e); };
      // lex-input emits 'lex-input' on every keystroke; 'lex-change' fires on blur.
      search.addEventListener('lex-input', sHandler);
      state._unbindFns.push(function () { search.removeEventListener('lex-input', sHandler); });
    }

    var categoryList = el('toolsBrowserCategoryList');
    if (categoryList) {
      var cHandler = function (e) { onCategoryClick(state, e); };
      categoryList.addEventListener('click', cHandler);
      state._unbindFns.push(function () { categoryList.removeEventListener('click', cHandler); });
    }

    var listContent = el('toolsBrowserListContent');
    if (listContent) {
      var lHandler = function (e) { onListClick(ctx, state, e); };
      listContent.addEventListener('click', lHandler);
      state._unbindFns.push(function () { listContent.removeEventListener('click', lHandler); });
    }

    var detail = el('toolsBrowserDetailContent');
    if (detail) {
      var dHandler = function (e) { onDetailClick(ctx, state, e); };
      detail.addEventListener('click', dHandler);
      state._unbindFns.push(function () { detail.removeEventListener('click', dHandler); });
    }

    var doneBtn = el('toolsBrowserDoneBtn');
    if (doneBtn) {
      var dnHandler = function () {
        // Persist before bouncing back so the create view picks up the
        // chip set on its very first render.
        persistSelected(ctx.app, state);
        ctx.app.setView('create', {});
      };
      doneBtn.addEventListener('click', dnHandler);
      state._unbindFns.push(function () { doneBtn.removeEventListener('click', dnHandler); });
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  function render(rootEl, ctx) {
    rootEl.innerHTML = TEMPLATE;

    var state = createState();
    rootEl._toolsBrowserState = state;

    // Hydrate selected-tool set from the pending-create snapshot.
    var pending = readPending(ctx.app);
    if (pending && Array.isArray(pending.selectedTools)) {
      for (var i = 0; i < pending.selectedTools.length; i++) {
        if (pending.selectedTools[i]) state.selectedTools[pending.selectedTools[i]] = true;
      }
    }

    wire(ctx, state);
    loadRegistry(state);
  }

  function destroy(rootEl) {
    var state = rootEl && rootEl._toolsBrowserState;
    if (!state) return;
    state.destroyed = true;
    if (state._lexReadyHandler) {
      document.removeEventListener('lex-ready', state._lexReadyHandler);
      state._lexReadyHandler = null;
    }
    if (Array.isArray(state._unbindFns)) {
      for (var i = 0; i < state._unbindFns.length; i++) {
        try { state._unbindFns[i](); } catch (_e) { /* ignore */ }
      }
    }
    state._unbindFns = [];
    rootEl._toolsBrowserState = null;
  }

  global.LanaAgentsApp.Views.toolsBrowse = {
    render: render,
    destroy: destroy,
    __test: {
      filterTools: filterTools,
      matchesQuery: matchesQuery,
      buildExampleInvocation: buildExampleInvocation
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
