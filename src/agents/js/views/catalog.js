/* catalog.js — Agents catalog SPA view module.
   Migrated from src/js/pages/agents.js. Loads agent definitions from
   GET /api/v1/agents, renders a filterable grid of cards. The Run button
   opens a run modal; the Configure button opens the detail view. The
   "Create from template" modal calls POST /api/v1/agents.

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

  // Markup template — extracted verbatim from src/agents/index.html's
  // <template id="page-content"> block. Cloned into rootEl on render.
  var TEMPLATE = ''
    + '<main class="agents-page-container">'

    + '<lex-banner'
    +   ' id="agentsBanner"'
    +   ' variant="light"'
    +   ' heading="Agents"'
    +   ' subtitle="Browse and configure system and custom agents."'
    + '>'
    +   '<lex-btn id="agentsCreateBtn" variant="primary" icon="plus">Create agent</lex-btn>'
    + '</lex-banner>'

    + '<div class="agents-filter-bar">'
    +   '<lex-segmented'
    +     ' id="agentsFilterTabs"'
    +     ' value="all"'
    +     ' options=\'[{"value":"all","label":"All"},{"value":"system","label":"System"},{"value":"custom","label":"Custom"}]\''
    +   '></lex-segmented>'
    + '</div>'

    + '<div id="agentsLoading" class="agents-grid">'
    +   '<div class="agents-card-skeleton" aria-hidden="true">'
    +     '<div class="agents-skeleton-line agents-skeleton-line--avatar"></div>'
    +     '<div class="agents-skeleton-line agents-skeleton-line--title"></div>'
    +     '<div class="agents-skeleton-line agents-skeleton-line--text"></div>'
    +     '<div class="agents-skeleton-line agents-skeleton-line--text-short"></div>'
    +   '</div>'
    +   '<div class="agents-card-skeleton" aria-hidden="true">'
    +     '<div class="agents-skeleton-line agents-skeleton-line--avatar"></div>'
    +     '<div class="agents-skeleton-line agents-skeleton-line--title"></div>'
    +     '<div class="agents-skeleton-line agents-skeleton-line--text"></div>'
    +     '<div class="agents-skeleton-line agents-skeleton-line--text-short"></div>'
    +   '</div>'
    +   '<div class="agents-card-skeleton" aria-hidden="true">'
    +     '<div class="agents-skeleton-line agents-skeleton-line--avatar"></div>'
    +     '<div class="agents-skeleton-line agents-skeleton-line--title"></div>'
    +     '<div class="agents-skeleton-line agents-skeleton-line--text"></div>'
    +     '<div class="agents-skeleton-line agents-skeleton-line--text-short"></div>'
    +   '</div>'
    + '</div>'

    + '<div id="agentsGrid" class="agents-grid hidden"></div>'

    + '<div id="agentsEmpty" class="hidden">'
    +   '<lex-empty'
    +     ' icon="bot"'
    +     ' message="No agents yet"'
    +     ' description="Agent definitions will appear here once they are configured."'
    +   '></lex-empty>'
    + '</div>'

    + '<lex-modal id="agentsRunModal" heading="Run Agent" size="md" data-hoist>'
    +   '<div class="agents-run-modal-body">'
    +     '<p class="agents-run-modal-text">'
    +       'Provide a brief input describing what the agent should do.'
    +     '</p>'
    +     '<lex-textarea'
    +       ' id="agentsRunInput"'
    +       ' label="Input"'
    +       ' rows="4"'
    +       ' placeholder="Describe the task you want this agent to perform..."'
    +     '></lex-textarea>'
    +   '</div>'
    + '</lex-modal>'

    + '<lex-modal'
    +   ' id="agentsCreateModal"'
    +   ' heading="Create agent from template"'
    +   ' size="lg"'
    +   ' confirm-text="Create"'
    +   ' cancel-text="Cancel"'
    +   ' data-hoist'
    + '>'
    +   '<div class="agents-create-modal-body">'
    +     '<p class="agents-create-modal-help">'
    +       'Pick a template, adjust the name, description, and which tools the '
    +       'agent may call. Templates own the underlying prompt — those rules '
    +       'stay locked on the template.'
    +     '</p>'

    +     '<lex-select'
    +       ' id="agentsCreateTemplate"'
    +       ' label="Template"'
    +       ' placeholder="Choose a template..."'
    +       ' required'
    +       ' searchable'
    +     '></lex-select>'

    +     '<div id="agentsCreateTemplatePreview" class="agents-create-preview hidden">'
    +       '<div class="agents-create-preview-row">'
    +         '<span class="agents-create-preview-label">Template</span>'
    +         '<span id="agentsCreateTemplateSlug" class="agents-create-preview-value"></span>'
    +       '</div>'
    +       '<div class="agents-create-preview-row">'
    +         '<span class="agents-create-preview-label">Description</span>'
    +         '<span id="agentsCreateTemplateDescription" class="agents-create-preview-value"></span>'
    +       '</div>'
    +     '</div>'

    +     '<lex-input'
    +       ' id="agentsCreateName"'
    +       ' label="Display name"'
    +       ' placeholder="e.g. Contract Reviewer"'
    +       ' required'
    +     '></lex-input>'

    +     '<lex-textarea'
    +       ' id="agentsCreateDescription"'
    +       ' label="Description"'
    +       ' rows="3"'
    +       ' placeholder="What this agent will do for your team..."'
    +     '></lex-textarea>'

    +     '<div class="agents-create-section">'
    +       '<div class="agents-create-section-label">'
    +         'Allowed tools'
    +         '<span class="agents-create-section-hint">'
    +           "Uncheck tools you don\\'t want this agent to use. The template "
    +           'defines the maximum set — adding new tools is not supported here.'
    +         '</span>'
    +       '</div>'
    +       '<div id="agentsCreateToolsList" class="agents-create-tools-list">'
    +         "<span class=\"agents-create-empty-text\">Pick a template to see its tools.</span>"
    +       '</div>'
    +     '</div>'

    +     '<lex-select'
    +       ' id="agentsCreateModelSlot"'
    +       ' label="Model slot"'
    +       ' placeholder="Choose a model slot..."'
    +     '></lex-select>'

    +     '<div class="agents-create-section">'
    +       '<div class="agents-create-section-label">Schedule</div>'
    +       '<lex-toggle'
    +         ' id="agentsCreateScheduleEnabled"'
    +         ' label="Run this agent on a schedule"'
    +         ' label-side="right"'
    +       '></lex-toggle>'
    +       '<div id="agentsCreateScheduleFields" class="agents-create-schedule-fields hidden">'
    +         '<lex-input'
    +           ' id="agentsCreateScheduleCron"'
    +           ' label="Cron expression"'
    +           ' placeholder="0 9 * * 1-5"'
    +           ' help="Standard 5-field cron (minute hour dom month dow)"'
    +         '></lex-input>'
    +         '<lex-select'
    +           ' id="agentsCreateScheduleTimezone"'
    +           ' label="Timezone"'
    +           ' placeholder="UTC"'
    +         '></lex-select>'
    +       '</div>'
    +     '</div>'
    +   '</div>'
    + '</lex-modal>'

    + '</main>';

  // =========================================================================
  // Per-render state (closed over by the wired event handlers)
  // =========================================================================

  function createState() {
    return {
      allAgents: [],
      filter: 'all',
      selectedSlug: null,
      templates: [],
      selectedTpl: null,
      // Tools the user has unchecked relative to the chosen template's set.
      // Final allowed_tools = template.allowed_tools - this set.
      disabledTools: {},
      // AbortController for in-flight loadAgents, so destroy() can cancel it.
      loadAbort: null
    };
  }

  var COMMON_TZS = [
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

  var MODEL_SLOTS = [
    { value: 'agentic', label: 'Agentic (planning + tool use)' },
    { value: 'rag',     label: 'RAG (retrieval-augmented chat)' },
    { value: 'main',    label: 'Main (general-purpose chat)' }
  ];

  var escHtml = (typeof window !== 'undefined' && window.Lex && window.Lex.Utils && window.Lex.Utils.escapeHtml)
    ? window.Lex.Utils.escapeHtml
    : function (s) { var d = document.createElement('div'); d.textContent = (s == null ? '' : String(s)); return d.innerHTML; };

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
    if (agent.organization_id === null || agent.organization_id === undefined) {
      if (agent.org_id) return 'custom';
      return 'system';
    }
    return 'custom';
  }

  function toolName(t) {
    if (!t) return '';
    if (typeof t === 'string') return t;
    return t.name || t.slug || '';
  }

  function setVal(id, value) {
    var n = el(id);
    if (n) n.value = (value == null ? '' : value);
  }

  function setChecked(id, checked) {
    var n = el(id);
    if (n) n.checked = !!checked;
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

  function applyFilter(state, agents) {
    if (state.filter === 'all') return agents;
    return agents.filter(function (a) { return getKind(a) === state.filter; });
  }

  function renderGrid(state) {
    var grid = el('agentsGrid');
    var emptyEl = el('agentsEmpty');
    var loadingEl = el('agentsLoading');
    if (!grid) return;

    hide(loadingEl);

    var filtered = applyFilter(state, state.allAgents);

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

  function loadAgents(state) {
    var grid = el('agentsGrid');
    var loadingEl = el('agentsLoading');
    var emptyEl = el('agentsEmpty');
    hide(grid);
    hide(emptyEl);
    show(loadingEl);

    if (!window.api || typeof window.api.get !== 'function') {
      // Defer until api is ready. The destroy() hook removes this listener
      // by aborting via state.loadAbort below.
      var onReady = function () { loadAgents(state); };
      state._lexReadyHandler = onReady;
      document.addEventListener('lex-ready', onReady, { once: true });
      return;
    }

    window.api.get('/api/v1/agents')
      .then(function (resp) {
        if (state.destroyed) return;
        var agents = [];
        if (Array.isArray(resp)) agents = resp;
        else if (resp && Array.isArray(resp.data)) agents = resp.data;
        else if (resp && Array.isArray(resp.agents)) agents = resp.agents;
        state.allAgents = agents;
        renderGrid(state);
      })
      .catch(function (err) {
        if (state.destroyed) return;
        console.error('[agents] Failed to load agents:', err);
        state.allAgents = [];
        showLoadError(state, err);
      });
  }

  function showLoadError(state, err) {
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
      if (window.Lex && window.Lex.Nav) window.Lex.Nav.go('login.html');
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

  function navigateToDetail(ctx, slug) {
    if (!slug) return;
    ctx.app.setView('agentDetail', { slug: slug });
  }

  function openRunModal(state, slug) {
    state.selectedSlug = slug;
    var modal = el('agentsRunModal');
    var input = el('agentsRunInput');
    if (input && typeof input.value !== 'undefined') input.value = '';
    if (modal) {
      modal.heading = 'Run Agent: ' + slug;
      modal.open = true;
    }
  }

  function submitRun(ctx, state) {
    if (!state.selectedSlug) return;
    var input = el('agentsRunInput');
    var value = input && typeof input.value !== 'undefined' ? input.value : '';
    if (!value || !String(value).trim()) {
      if (window.Lex && window.Lex.Toast) window.Lex.Toast.error('Please describe what the agent should do.');
      return;
    }

    if (!window.api || typeof window.api.post !== 'function') return;

    window.api.post('/api/v1/agents/' + encodeURIComponent(state.selectedSlug) + '/runs', {
      input: String(value).trim()
    })
      .then(function (resp) {
        if (state.destroyed) return;
        var runId = (resp && resp.run && resp.run.id)
                 || (resp && resp.data && resp.data.id)
                 || (resp && resp.id)
                 || (resp && resp.run_id);
        var modal = el('agentsRunModal');
        if (modal) modal.open = false;
        if (window.Lex && window.Lex.Toast) window.Lex.Toast.success('Run started');
        if (runId) {
          ctx.app.setView('agentRun', { runId: runId });
        } else {
          console.warn('[agents] Run started but no id in response:', resp);
          if (window.Lex && window.Lex.Toast) {
            window.Lex.Toast.info('Run started, but we could not open the live view.');
          }
        }
      })
      .catch(function (err) {
        if (state.destroyed) return;
        console.error('[agents] Run start failed:', err);
        var status = err && (err.status || (err.response && err.response.status));
        var msg = 'Unable to start run';
        if (status === 401) msg = 'Your session expired. Please sign in again.';
        else if (status === 404) msg = 'This agent no longer exists.';
        if (window.Lex && window.Lex.Toast) window.Lex.Toast.error(msg);
      });
  }

  function wireGridDelegation(rootEl, ctx, state) {
    var grid = el('agentsGrid');
    if (!grid) return;
    var handler = function (evt) {
      var actionBtn = evt.target.closest('[data-action]');
      var card = evt.target.closest('[data-agent-slug]');
      if (!card) return;

      var slug = (actionBtn && actionBtn.getAttribute('data-agent-slug'))
        || card.getAttribute('data-agent-slug');

      if (actionBtn) {
        evt.stopPropagation();
        var action = actionBtn.getAttribute('data-action');
        if (action === 'run') {
          openRunModal(state, slug);
        } else if (action === 'configure') {
          navigateToDetail(ctx, slug);
        }
        return;
      }

      navigateToDetail(ctx, slug);
    };
    grid.addEventListener('click', handler);
    state._unbindFns.push(function () { grid.removeEventListener('click', handler); });
  }

  function wireFilters(state) {
    var filterEl = el('agentsFilterTabs');
    if (!filterEl) return;
    var handler = function (e) {
      var v = (e.detail && e.detail.value) || (filterEl.value) || 'all';
      state.filter = v;
      renderGrid(state);
    };
    filterEl.addEventListener('lex-change', handler);
    state._unbindFns.push(function () { filterEl.removeEventListener('lex-change', handler); });
  }

  function wireRunModal(ctx, state) {
    var modal = el('agentsRunModal');
    if (!modal) return;
    var handler = function () { submitRun(ctx, state); };
    modal.addEventListener('lex-confirm', handler);
    state._unbindFns.push(function () { modal.removeEventListener('lex-confirm', handler); });
  }

  // =========================================================================
  // Create-from-template modal
  // =========================================================================

  function openCreateModal(state) {
    var modal = el('agentsCreateModal');
    if (!modal) return;
    populateCreateModal(state);
    modal.open = true;
  }

  function populateCreateModal(state) {
    state.selectedTpl = null;
    state.disabledTools = {};

    state.templates = (state.allAgents || []).filter(function (a) {
      return getKind(a) === 'system';
    });

    var tplSelect = el('agentsCreateTemplate');
    if (tplSelect) {
      tplSelect.options = state.templates.map(function (t) {
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
      modelSelect.options = MODEL_SLOTS.slice();
      modelSelect.value = 'agentic';
    }

    var tzSelect = el('agentsCreateScheduleTimezone');
    if (tzSelect) {
      tzSelect.options = COMMON_TZS.slice();
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

  function onTemplateChange(state, evt) {
    var v = (evt && evt.detail && evt.detail.value) || (el('agentsCreateTemplate') && el('agentsCreateTemplate').value) || '';
    if (!v) {
      state.selectedTpl = null;
      hide(el('agentsCreateTemplatePreview'));
      return;
    }

    var tpl = null;
    for (var i = 0; i < state.templates.length; i++) {
      if (state.templates[i].slug === v) { tpl = state.templates[i]; break; }
    }
    state.selectedTpl = tpl;
    if (!tpl) return;

    setVal('agentsCreateName', tpl.name || tpl.slug || '');
    setVal('agentsCreateDescription', tpl.description || '');

    var slotEl = el('agentsCreateModelSlot');
    if (slotEl && tpl.model_slot) slotEl.value = tpl.model_slot;

    state.disabledTools = {};
    renderToolsCheckboxes(tpl.allowed_tools || []);

    var preview = el('agentsCreateTemplatePreview');
    if (preview) {
      var slugEl = el('agentsCreateTemplateSlug');
      var descEl = el('agentsCreateTemplateDescription');
      if (slugEl) slugEl.textContent = tpl.slug || '';
      if (descEl) descEl.textContent = tpl.description || '(no description)';
      show(preview);
    }
  }

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

  function onToolToggle(state, evt) {
    var input = evt.target.closest('.agents-create-tool-checkbox');
    if (!input) return;
    var name = input.getAttribute('data-tool');
    if (!name) return;
    if (input.checked) {
      delete state.disabledTools[name];
    } else {
      state.disabledTools[name] = true;
    }
  }

  function onScheduleEnabledChange(evt) {
    var checked = !!(evt && evt.detail && evt.detail.value);
    var fields = el('agentsCreateScheduleFields');
    if (!fields) return;
    if (checked) show(fields); else hide(fields);
  }

  function buildCreateBody(state) {
    if (!state.selectedTpl) return null;

    var name = (el('agentsCreateName') && el('agentsCreateName').value) || '';
    var description = (el('agentsCreateDescription') && el('agentsCreateDescription').value) || '';
    var modelSlot = (el('agentsCreateModelSlot') && el('agentsCreateModelSlot').value) || '';

    var tplTools = (state.selectedTpl.allowed_tools || []).map(toolName).filter(Boolean);
    var allowedTools = tplTools.filter(function (t) { return !state.disabledTools[t]; });

    var body = {
      template_slug: state.selectedTpl.slug,
      name: String(name).trim() || state.selectedTpl.name || state.selectedTpl.slug,
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

  function submitCreate(ctx, state) {
    var body = buildCreateBody(state);
    if (!body) {
      if (window.Lex && window.Lex.Toast) window.Lex.Toast.error('Please pick a template first.');
      return;
    }
    if (!body.name) {
      if (window.Lex && window.Lex.Toast) window.Lex.Toast.error('Display name is required.');
      return;
    }
    if (body.schedule && body.schedule.enabled && !body.schedule.cron) {
      if (window.Lex && window.Lex.Toast) window.Lex.Toast.error('Schedule is enabled but no cron expression was provided.');
      return;
    }

    if (!window.api || typeof window.api.post !== 'function') return;

    window.api.post('/api/v1/agents', body)
      .then(function (resp) {
        if (state.destroyed) return;
        var agent = (resp && resp.agent) ? resp.agent
                  : ((resp && resp.data) ? resp.data : resp);
        var slug = agent && agent.slug;

        var modal = el('agentsCreateModal');
        if (modal) modal.open = false;
        populateCreateModal(state);

        if (window.Lex && window.Lex.Toast) {
          window.Lex.Toast.success('Agent created');
        }

        loadAgents(state);

        if (slug) {
          ctx.app.setView('agentDetail', { slug: slug });
        }
      })
      .catch(function (err) {
        if (state.destroyed) return;
        console.error('[agents] Create failed:', err);
        var status = err && (err.status || (err.response && err.response.status));
        var msg = 'Unable to create agent';
        if (status === 400) msg = 'Some fields look invalid. Check name and tools.';
        else if (status === 401) msg = 'Your session expired. Please sign in again.';
        else if (status === 403) msg = 'You do not have permission to create agents.';
        else if (status === 404) msg = 'Agent creation is not available on this server.';
        else if (status === 409) msg = 'An agent with that name already exists.';
        if (window.Lex && window.Lex.Toast) window.Lex.Toast.error(msg);
        if (status === 401 && window.Lex && window.Lex.Nav) {
          window.Lex.Nav.go('login.html');
        }
      });
  }

  function wireCreateModal(ctx, state) {
    // PHASE 8 — full-screen create view supersedes this in-template modal.
    // The banner's Create button now navigates to '#create' rather than
    // opening agentsCreateModal.
    var btn = el('agentsCreateBtn');
    if (btn) {
      var openHandler = function () {
        if (ctx && ctx.app && typeof ctx.app.setView === 'function') {
          ctx.app.setView('create', {});
        } else {
          // LEGACY fallback — only hit if the SPA shell isn't wired,
          // which shouldn't happen in practice.
          openCreateModal(state);
        }
      };
      btn.addEventListener('click', openHandler);
      state._unbindFns.push(function () { btn.removeEventListener('click', openHandler); });
    }

    // LEGACY: Phase 8 follow-up — remove once #create view is canonical.
    var modal = el('agentsCreateModal');
    if (modal) {
      var confirmHandler = function () { submitCreate(ctx, state); };
      modal.addEventListener('lex-confirm', confirmHandler);
      state._unbindFns.push(function () { modal.removeEventListener('lex-confirm', confirmHandler); });
    }

    // LEGACY: Phase 8 follow-up — remove once #create view is canonical.
    var tplSelect = el('agentsCreateTemplate');
    if (tplSelect) {
      var tplHandler = function (e) { onTemplateChange(state, e); };
      tplSelect.addEventListener('lex-change', tplHandler);
      state._unbindFns.push(function () { tplSelect.removeEventListener('lex-change', tplHandler); });
    }

    // LEGACY: Phase 8 follow-up — remove once #create view is canonical.
    var toolsList = el('agentsCreateToolsList');
    if (toolsList) {
      var toolHandler = function (e) { onToolToggle(state, e); };
      toolsList.addEventListener('change', toolHandler);
      state._unbindFns.push(function () { toolsList.removeEventListener('change', toolHandler); });
    }

    // LEGACY: Phase 8 follow-up — remove once #create view is canonical.
    var schedToggle = el('agentsCreateScheduleEnabled');
    if (schedToggle) {
      schedToggle.addEventListener('lex-change', onScheduleEnabledChange);
      state._unbindFns.push(function () { schedToggle.removeEventListener('lex-change', onScheduleEnabledChange); });
    }
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  function render(rootEl, ctx) {
    rootEl.innerHTML = TEMPLATE;

    var state = createState();
    state._unbindFns = [];
    state.destroyed = false;
    rootEl._catalogState = state;

    wireFilters(state);
    wireGridDelegation(rootEl, ctx, state);
    wireRunModal(ctx, state);
    wireCreateModal(ctx, state);
    loadAgents(state);
  }

  function destroy(rootEl) {
    var state = rootEl && rootEl._catalogState;
    if (!state) return;
    state.destroyed = true;
    if (state._lexReadyHandler) {
      document.removeEventListener('lex-ready', state._lexReadyHandler);
      state._lexReadyHandler = null;
    }
    if (Array.isArray(state._unbindFns)) {
      for (var i = 0; i < state._unbindFns.length; i++) {
        try { state._unbindFns[i](); } catch (e) { /* ignore */ }
      }
    }
    state._unbindFns = [];
    rootEl._catalogState = null;
  }

  global.LanaAgentsApp.Views.catalog = { render: render, destroy: destroy };
})(typeof window !== 'undefined' ? window : globalThis);
