/* agents.js — Agents catalog page controller.
   Loads agent definitions from GET /api/v1/agents, renders a filterable
   grid of agent cards. Click "Run" to start a run; click the card to open
   the agent detail page.

   Rules (LEX-COMPONENT-RULES.md):
     - IIFE wrapper, no top-level const/class
     - Lex.Nav.go() for all navigation (no window.location.href)
     - All HTML escaping via Lex.Utils.escapeHtml()
     - NO regex — string methods only
*/

(function () {
  'use strict';

  var escHtml = (window.Lex && Lex.Utils && Lex.Utils.escapeHtml)
    ? Lex.Utils.escapeHtml
    : function (s) { var d = document.createElement('div'); d.textContent = (s == null ? '' : String(s)); return d.innerHTML; };

  // =========================================================================
  // State
  // =========================================================================

  var _allAgents      = [];
  var _filter         = 'all'; // 'all' | 'system' | 'custom'
  var _selectedSlug   = null;

  // =========================================================================
  // Helpers
  // =========================================================================

  function el(id) { return document.getElementById(id); }
  function show(node) { if (node) node.classList.remove('hidden'); }
  function hide(node) { if (node) node.classList.add('hidden'); }

  function getAvatarLetter(agent) {
    var name = (agent && (agent.name || agent.slug)) || '';
    if (!name) return 'A';
    return String(name).charAt(0).toUpperCase();
  }

  function getKind(agent) {
    if (!agent) return 'custom';
    if (agent.is_system === true) return 'system';
    if (agent.is_system === false) return 'custom';
    if (agent.kind === 'system') return 'system';
    if (agent.kind === 'custom') return 'custom';
    // Fallback: org-scoped agents are usually custom
    if (agent.org_id) return 'custom';
    return 'system';
  }

  // =========================================================================
  // Rendering
  // =========================================================================

  function renderCard(agent) {
    var slug = escHtml(agent.slug || '');
    var name = escHtml(agent.name || agent.slug || 'Untitled agent');
    var description = escHtml(agent.description || agent.summary || '');
    var avatarLetter = escHtml(getAvatarLetter(agent));
    var kind = getKind(agent);
    var kindLabel = kind === 'system' ? 'System' : 'Custom';

    return ''
      + '<lex-card class="agents-card" data-agent-slug="' + slug + '" padding="normal">'
      +   '<div class="agents-card-header">'
      +     '<div class="agents-card-avatar" aria-hidden="true">' + avatarLetter + '</div>'
      +     '<div class="agents-card-title-block">'
      +       '<div class="agents-card-title">' + name + '</div>'
      +       (slug ? '<div class="agents-card-slug">' + slug + '</div>' : '')
      +     '</div>'
      +     '<span class="agents-card-kind-badge agents-card-kind-badge--' + escHtml(kind) + '">' + kindLabel + '</span>'
      +   '</div>'
      +   (description ? '<div class="agents-card-description">' + description + '</div>' : '')
      +   '<div class="agents-card-actions">'
      +     '<lex-btn variant="primary" size="sm" data-action="run" data-agent-slug="' + slug + '">Run</lex-btn>'
      +     '<lex-btn variant="ghost" size="sm" data-action="configure" data-agent-slug="' + slug + '">Configure</lex-btn>'
      +   '</div>'
      + '</lex-card>';
  }

  function applyFilter(agents) {
    if (_filter === 'all') return agents;
    return agents.filter(function (a) { return getKind(a) === _filter; });
  }

  function renderGrid() {
    var grid = el('agentsGrid');
    var emptyEl = el('agentsEmpty');
    var loadingEl = el('agentsLoading');
    if (!grid) return;

    hide(loadingEl);

    var filtered = applyFilter(_allAgents);

    if (filtered.length === 0) {
      hide(grid);
      show(emptyEl);
      return;
    }

    var html = '';
    for (var i = 0; i < filtered.length; i++) {
      html += renderCard(filtered[i]);
    }
    grid.innerHTML = html;
    hide(emptyEl);
    show(grid);
  }

  // =========================================================================
  // Data
  // =========================================================================

  function loadAgents() {
    var grid = el('agentsGrid');
    var loadingEl = el('agentsLoading');
    var emptyEl = el('agentsEmpty');
    hide(grid);
    hide(emptyEl);
    show(loadingEl);

    if (!window.api || typeof window.api.get !== 'function') {
      // Defer until api is ready
      document.addEventListener('lex-ready', loadAgents, { once: true });
      return;
    }

    window.api.get('/api/v1/agents')
      .then(function (resp) {
        var agents = [];
        if (Array.isArray(resp)) agents = resp;
        else if (resp && Array.isArray(resp.data)) agents = resp.data;
        else if (resp && Array.isArray(resp.agents)) agents = resp.agents;
        _allAgents = agents;
        renderGrid();
      })
      .catch(function (err) {
        console.error('[agents] Failed to load agents:', err);
        _allAgents = [];
        renderGrid();
      });
  }

  // =========================================================================
  // Event handlers
  // =========================================================================

  function navigateToDetail(slug) {
    if (!slug) return;
    if (window.Lex && Lex.Nav && typeof Lex.Nav.go === 'function') {
      Lex.Nav.go('agent-detail.html', { params: { slug: slug } });
    }
  }

  function openRunModal(slug) {
    _selectedSlug = slug;
    var modal = el('agentsRunModal');
    var input = el('agentsRunInput');
    if (input && typeof input.value !== 'undefined') input.value = '';
    if (modal) {
      modal.heading = 'Run Agent: ' + slug;
      modal.open = true;
    }
  }

  function submitRun() {
    if (!_selectedSlug) return;
    var input = el('agentsRunInput');
    var value = input && typeof input.value !== 'undefined' ? input.value : '';
    if (!value || !String(value).trim()) {
      if (window.Lex && Lex.Toast) Lex.Toast.error('Please describe what the agent should do.');
      return;
    }

    if (!window.api || typeof window.api.post !== 'function') return;

    window.api.post('/api/v1/agents/' + encodeURIComponent(_selectedSlug) + '/runs', {
      input: String(value).trim()
    })
      .then(function (resp) {
        var runId = resp && (resp.id || (resp.data && resp.data.id) || resp.run_id);
        var modal = el('agentsRunModal');
        if (modal) modal.open = false;
        if (window.Lex && Lex.Toast) Lex.Toast.success('Run started');
        if (runId && window.Lex && Lex.Nav) {
          Lex.Nav.go('agent-run.html', { params: { id: runId } });
        }
      })
      .catch(function (err) {
        console.error('[agents] Run start failed:', err);
        if (window.Lex && Lex.Toast) Lex.Toast.error('Unable to start run');
      });
  }

  function wireGridDelegation() {
    var grid = el('agentsGrid');
    if (!grid || grid._agentsWired) return;
    grid._agentsWired = true;

    grid.addEventListener('click', function (evt) {
      var actionBtn = evt.target.closest('[data-action]');
      var card = evt.target.closest('[data-agent-slug]');
      if (!card) return;

      var slug = (actionBtn && actionBtn.getAttribute('data-agent-slug'))
        || card.getAttribute('data-agent-slug');

      if (actionBtn) {
        evt.stopPropagation();
        var action = actionBtn.getAttribute('data-action');
        if (action === 'run') {
          openRunModal(slug);
        } else if (action === 'configure') {
          // Phase 4: opens a config drawer on agent-detail
          navigateToDetail(slug);
        }
        return;
      }

      // Plain card click
      navigateToDetail(slug);
    });
  }

  function wireFilters() {
    var filterEl = el('agentsFilterTabs');
    if (filterEl && !filterEl._agentsWired) {
      filterEl._agentsWired = true;
      filterEl.addEventListener('lex-change', function (e) {
        var v = (e.detail && e.detail.value) || (filterEl.value) || 'all';
        _filter = v;
        renderGrid();
      });
    }
  }

  function wireRunModal() {
    var modal = el('agentsRunModal');
    if (modal && !modal._agentsWired) {
      modal._agentsWired = true;
      modal.addEventListener('lex-confirm', submitRun);
    }
  }

  // =========================================================================
  // Init
  // =========================================================================

  function init() {
    wireFilters();
    wireGridDelegation();
    wireRunModal();
    loadAgents();
  }

  if (window.LexRouter) {
    LexRouter.registerPageInit('agents.html', init);
  }
  init();
})();
