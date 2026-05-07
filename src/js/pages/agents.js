/* agents.js — Agents catalog page controller.
   Loads agent definitions from GET /api/v1/agents, renders a filterable
   grid of agent cards. Click "Run" to start a run; click the card to open
   the agent detail page. Phase 4 adds a "Create from template" modal
   wired to POST /api/v1/agents.

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

  var _allAgents       = [];
  var _filter          = 'all'; // 'all' | 'system' | 'custom'
  var _selectedSlug    = null;

  // Create-from-template modal state
  var _templates       = [];
  var _selectedTpl     = null;
  // Tools the user has unchecked relative to the chosen template's set.
  // Final allowed_tools = template.allowed_tools - this set.
  var _disabledTools   = {};

  // Common cron timezones — kept short so the dropdown stays scannable.
  // The backend ultimately validates IANA tz names, so this list is just
  // a discovery aid; users can also enter a free-form value via the cron
  // field if their zone is missing (we may extend the list later).
  var _COMMON_TZS = [
    { value: 'UTC',                 label: 'UTC' },
    { value: 'America/New_York',    label: 'America/New York (Eastern)' },
    { value: 'America/Chicago',     label: 'America/Chicago (Central)' },
    { value: 'America/Denver',      label: 'America/Denver (Mountain)' },
    { value: 'America/Los_Angeles', label: 'America/Los Angeles (Pacific)' },
    { value: 'Europe/London',       label: 'Europe/London' },
    { value: 'Europe/Berlin',       label: 'Europe/Berlin' },
    { value: 'Asia/Singapore',      label: 'Asia/Singapore' },
    { value: 'Asia/Tokyo',          label: 'Asia/Tokyo' },
    { value: 'Australia/Sydney',    label: 'Australia/Sydney' }
  ];

  var _MODEL_SLOTS = [
    { value: 'agentic', label: 'Agentic (planning + tool use)' },
    { value: 'rag',     label: 'RAG (retrieval-augmented chat)' },
    { value: 'main',    label: 'Main (general-purpose chat)' }
  ];

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
    // System templates are owned by no organization. Use organization_id as
    // the discriminator when explicit kind/is_system flags are missing —
    // this matches the agents-platform server contract.
    if (agent.organization_id === null || agent.organization_id === undefined) {
      // Both system and "system templates" come back without an org_id.
      // Most clients treat them as "system" for filter purposes.
      if (agent.org_id) return 'custom';
      return 'system';
    }
    return 'custom';
  }

  // Pull the toolname out of a tool entry which may be a string or
  // a small object ({ name, slug, description }).
  function toolName(t) {
    if (!t) return '';
    if (typeof t === 'string') return t;
    return t.name || t.slug || '';
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
        showLoadError(err);
      });
  }

  // Render a banner-style error in the empty container so the user can
  // distinguish "no agents" from "load failed".
  function showLoadError(err) {
    var grid = el('agentsGrid');
    var loadingEl = el('agentsLoading');
    var emptyEl = el('agentsEmpty');
    hide(loadingEl);
    hide(grid);
    if (!emptyEl) return;

    var status = err && (err.status || (err.response && err.response.status));
    var icon = 'alert-circle';
    var title = 'Unable to load agents';
    var description = 'Something went wrong. Try again.';

    if (status === 401) {
      title = 'Session expired';
      description = 'Your session expired. Please sign in again.';
      if (window.Lex && Lex.Nav) Lex.Nav.go('login.html');
    } else if (status === 404) {
      title = 'Agents unavailable';
      description = 'The agents service is not available on this server.';
    }

    emptyEl.innerHTML = '<lex-empty icon="' + escHtml(icon)
      + '" message="' + escHtml(title)
      + '" description="' + escHtml(description) + '"></lex-empty>';
    show(emptyEl);
  }

  // =========================================================================
  // Event handlers
  // =========================================================================

  function navigateToDetail(slug) {
    if (!slug) return;
    if (window.Lex && Lex.Nav && typeof Lex.Nav.go === 'function') {
      Lex.Nav.go('agents/agent-detail.html', { params: { slug: slug } });
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
        // Backend returns 202 { run, queue }; tolerate { data } or bare object.
        var runId = (resp && resp.run && resp.run.id)
                 || (resp && resp.data && resp.data.id)
                 || (resp && resp.id)
                 || (resp && resp.run_id);
        var modal = el('agentsRunModal');
        if (modal) modal.open = false;
        if (window.Lex && Lex.Toast) Lex.Toast.success('Run started');
        if (runId && window.Lex && Lex.Nav) {
          Lex.Nav.go('agents/agent-run.html', { params: { id: runId } });
        } else {
          console.warn('[agents] Run started but no id in response:', resp);
          if (window.Lex && Lex.Toast) {
            Lex.Toast.info('Run started, but we could not open the live view.');
          }
        }
      })
      .catch(function (err) {
        console.error('[agents] Run start failed:', err);
        var status = err && (err.status || (err.response && err.response.status));
        var msg = 'Unable to start run';
        if (status === 401) msg = 'Your session expired. Please sign in again.';
        else if (status === 404) msg = 'This agent no longer exists.';
        if (window.Lex && Lex.Toast) Lex.Toast.error(msg);
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
  // Create-from-template modal
  // =========================================================================

  // Open the modal. Builds the template select on demand using the agent
  // list we already loaded — system definitions act as the template set.
  function openCreateModal() {
    var modal = el('agentsCreateModal');
    if (!modal) return;

    populateCreateModal();
    modal.open = true;
  }

  // Push fresh defaults into every form field. Called both on open and
  // immediately after a successful create so the next open starts clean.
  function populateCreateModal() {
    _selectedTpl = null;
    _disabledTools = {};

    // Build the template list from the system agents we already have.
    // Optional: in future, hit GET /api/v1/agents?include_templates=1
    // for a dedicated template endpoint.
    _templates = (_allAgents || []).filter(function (a) {
      return getKind(a) === 'system';
    });

    var tplSelect = el('agentsCreateTemplate');
    if (tplSelect) {
      tplSelect.options = _templates.map(function (t) {
        return {
          value: t.slug,
          label: t.name || t.slug,
          description: t.description || ''
        };
      });
      tplSelect.value = '';
    }

    var modelSelect = el('agentsCreateModelSlot');
    if (modelSelect) {
      modelSelect.options = _MODEL_SLOTS.slice();
      modelSelect.value = 'agentic';
    }

    var tzSelect = el('agentsCreateScheduleTimezone');
    if (tzSelect) {
      tzSelect.options = _COMMON_TZS.slice();
      tzSelect.value = 'UTC';
    }

    setVal('agentsCreateName', '');
    setVal('agentsCreateDescription', '');
    setVal('agentsCreateScheduleCron', '');
    setChecked('agentsCreateScheduleEnabled', false);

    hide(el('agentsCreateScheduleFields'));
    hide(el('agentsCreateTemplatePreview'));

    var toolsList = el('agentsCreateToolsList');
    if (toolsList) {
      toolsList.innerHTML = '<span class="agents-create-empty-text">Pick a template to see its tools.</span>';
    }
  }

  function setVal(id, value) {
    var n = el(id);
    if (n) n.value = (value == null ? '' : value);
  }

  function setChecked(id, checked) {
    var n = el(id);
    if (n) n.checked = !!checked;
  }

  function onTemplateChange(evt) {
    var v = (evt && evt.detail && evt.detail.value) || (el('agentsCreateTemplate') && el('agentsCreateTemplate').value) || '';
    if (!v) {
      _selectedTpl = null;
      hide(el('agentsCreateTemplatePreview'));
      return;
    }

    var tpl = null;
    for (var i = 0; i < _templates.length; i++) {
      if (_templates[i].slug === v) { tpl = _templates[i]; break; }
    }
    _selectedTpl = tpl;
    if (!tpl) return;

    // Prefill name/description from template.
    setVal('agentsCreateName', tpl.name || tpl.slug || '');
    setVal('agentsCreateDescription', tpl.description || '');

    // Default model_slot from template (if present).
    var slotEl = el('agentsCreateModelSlot');
    if (slotEl && tpl.model_slot) slotEl.value = tpl.model_slot;

    // Reset disabled-tools for the new template.
    _disabledTools = {};
    renderToolsCheckboxes(tpl.allowed_tools || []);

    // Show preview block.
    var preview = el('agentsCreateTemplatePreview');
    if (preview) {
      var slugEl = el('agentsCreateTemplateSlug');
      var descEl = el('agentsCreateTemplateDescription');
      if (slugEl) slugEl.textContent = tpl.slug || '';
      if (descEl) descEl.textContent = tpl.description || '(no description)';
      show(preview);
    }
  }

  // Render tool checkboxes — one row per template tool. The user can
  // uncheck tools to drop them from this agent. They cannot add tools
  // beyond the template's set (that's enforced server-side too).
  function renderToolsCheckboxes(tools) {
    var toolsList = el('agentsCreateToolsList');
    if (!toolsList) return;

    if (!tools || tools.length === 0) {
      toolsList.innerHTML = '<span class="agents-create-empty-text">This template doesn\'t expose any tools.</span>';
      return;
    }

    var html = '';
    for (var i = 0; i < tools.length; i++) {
      var name = toolName(tools[i]);
      if (!name) continue;
      var safe = escHtml(name);
      html += '<label class="agents-create-tool-row">'
            + '<input type="checkbox" class="agents-create-tool-checkbox" data-tool="' + safe + '" checked />'
            + '<span class="agents-create-tool-name">' + safe + '</span>'
            + '</label>';
    }
    toolsList.innerHTML = html;
  }

  function onToolToggle(evt) {
    var input = evt.target.closest('.agents-create-tool-checkbox');
    if (!input) return;
    var name = input.getAttribute('data-tool');
    if (!name) return;
    if (input.checked) {
      delete _disabledTools[name];
    } else {
      _disabledTools[name] = true;
    }
  }

  function onScheduleEnabledChange(evt) {
    var checked = !!(evt && evt.detail && evt.detail.value);
    var fields = el('agentsCreateScheduleFields');
    if (!fields) return;
    if (checked) show(fields); else hide(fields);
  }

  // Build the request body. Missing/empty fields are dropped so the
  // server can apply its own defaults.
  function buildCreateBody() {
    if (!_selectedTpl) return null;

    var name = (el('agentsCreateName') && el('agentsCreateName').value) || '';
    var description = (el('agentsCreateDescription') && el('agentsCreateDescription').value) || '';
    var modelSlot = (el('agentsCreateModelSlot') && el('agentsCreateModelSlot').value) || '';

    // allowed_tools = template tools minus the user's unchecked set.
    var tplTools = (_selectedTpl.allowed_tools || []).map(toolName).filter(Boolean);
    var allowedTools = tplTools.filter(function (t) { return !_disabledTools[t]; });

    var body = {
      template_slug: _selectedTpl.slug,
      name: String(name).trim() || _selectedTpl.name || _selectedTpl.slug,
      description: String(description).trim(),
      allowed_tools: allowedTools
    };
    if (modelSlot) body.model_slot = modelSlot;

    var scheduleOn = !!(el('agentsCreateScheduleEnabled') && el('agentsCreateScheduleEnabled').checked);
    if (scheduleOn) {
      var cron = (el('agentsCreateScheduleCron') && el('agentsCreateScheduleCron').value) || '';
      var tz = (el('agentsCreateScheduleTimezone') && el('agentsCreateScheduleTimezone').value) || 'UTC';
      body.schedule = {
        enabled: true,
        cron: String(cron).trim(),
        timezone: tz
      };
    }

    return body;
  }

  function submitCreate() {
    var body = buildCreateBody();
    if (!body) {
      if (window.Lex && Lex.Toast) Lex.Toast.error('Please pick a template first.');
      return;
    }
    if (!body.name) {
      if (window.Lex && Lex.Toast) Lex.Toast.error('Display name is required.');
      return;
    }
    if (body.schedule && body.schedule.enabled && !body.schedule.cron) {
      if (window.Lex && Lex.Toast) Lex.Toast.error('Schedule is enabled but no cron expression was provided.');
      return;
    }

    if (!window.api || typeof window.api.post !== 'function') return;

    window.api.post('/api/v1/agents', body)
      .then(function (resp) {
        var agent = (resp && resp.agent) ? resp.agent
                  : ((resp && resp.data) ? resp.data : resp);
        var slug = agent && agent.slug;

        var modal = el('agentsCreateModal');
        if (modal) modal.open = false;
        populateCreateModal();

        if (window.Lex && Lex.Toast) {
          Lex.Toast.success('Agent created');
        }

        // Refresh the catalog so the new agent shows up if the user
        // returns. Then navigate to the detail page for immediate config.
        loadAgents();

        if (slug && window.Lex && Lex.Nav) {
          Lex.Nav.go('agents/agent-detail.html', { params: { slug: slug } });
        }
      })
      .catch(function (err) {
        console.error('[agents] Create failed:', err);
        var status = err && (err.status || (err.response && err.response.status));
        var msg = 'Unable to create agent';
        if (status === 400) msg = 'Some fields look invalid. Check name and tools.';
        else if (status === 401) msg = 'Your session expired. Please sign in again.';
        else if (status === 403) msg = 'You do not have permission to create agents.';
        else if (status === 404) msg = 'Agent creation is not available on this server.';
        else if (status === 409) msg = 'An agent with that name already exists.';
        if (window.Lex && Lex.Toast) Lex.Toast.error(msg);
        // Mirror the load-time 401 path: route to login so the user can
        // re-auth instead of being stranded with a vague error.
        if (status === 401 && window.Lex && Lex.Nav) {
          Lex.Nav.go('login.html');
        }
      });
  }

  function wireCreateModal() {
    var btn = el('agentsCreateBtn');
    if (btn && !btn._agentsWired) {
      btn._agentsWired = true;
      btn.addEventListener('click', openCreateModal);
    }

    var modal = el('agentsCreateModal');
    if (modal && !modal._agentsCreateWired) {
      modal._agentsCreateWired = true;
      modal.addEventListener('lex-confirm', submitCreate);
    }

    var tplSelect = el('agentsCreateTemplate');
    if (tplSelect && !tplSelect._agentsWired) {
      tplSelect._agentsWired = true;
      tplSelect.addEventListener('lex-change', onTemplateChange);
    }

    var toolsList = el('agentsCreateToolsList');
    if (toolsList && !toolsList._agentsWired) {
      toolsList._agentsWired = true;
      toolsList.addEventListener('change', onToolToggle);
    }

    var schedToggle = el('agentsCreateScheduleEnabled');
    if (schedToggle && !schedToggle._agentsWired) {
      schedToggle._agentsWired = true;
      schedToggle.addEventListener('lex-change', onScheduleEnabledChange);
    }
  }

  // =========================================================================
  // Sidebar wiring
  // =========================================================================

  // Push the LanaAgents app sidebar nav into the shared <lex-app> shell so
  // every agents page renders the same sidebar (Catalog / Activity). The
  // catalog, detail, and run pages all share `activeId: 'catalog'` because
  // detail and run are sub-routes of the catalog.
  function wireAgentsSidebar() {
    var agentsApp = window.LanaAgentsApp;
    if (!agentsApp || typeof agentsApp.getAgentsAppSections !== 'function') return;
    var shell = document.querySelector('lex-app');
    if (!shell) return;
    var sections = agentsApp.getAgentsAppSections({ activeId: 'catalog' });
    if (typeof shell.setSections === 'function') {
      shell.setSections(sections);
    } else {
      var sidebar = shell.querySelector('lex-sidebar') || document.querySelector('lex-sidebar');
      if (sidebar) sidebar.sections = sections;
    }
    if ('activeNavId' in shell) shell.activeNavId = 'catalog';
  }

  // =========================================================================
  // Init
  // =========================================================================

  function init() {
    wireAgentsSidebar();
    wireFilters();
    wireGridDelegation();
    wireRunModal();
    wireCreateModal();
    loadAgents();
  }

  if (window.LexRouter) {
    LexRouter.registerPageInit('agents/index.html', init);
  }
  init();
})();
