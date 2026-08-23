/* catalog.js — Agent Studio workspace home.
   Combines a plain-language launchpad, deployed-agent roster, governed
   starting points, and a small outcomes pulse. All durable state remains in
   the @agents backend; this module only maps DTOs into the workspace view.

   Rules: IIFE, no regex, escaped dynamic HTML, hash navigation through ctx.app.
*/

'use strict';

(function (global) {
  global.LanaAgentsApp = global.LanaAgentsApp || {};
  global.LanaAgentsApp.Views = global.LanaAgentsApp.Views || {};

  var escHtml = (typeof window !== 'undefined' && window.Lex && window.Lex.Utils && window.Lex.Utils.escapeHtml)
    ? window.Lex.Utils.escapeHtml
    : function (s) { var d = document.createElement('div'); d.textContent = (s == null ? '' : String(s)); return d.innerHTML; };

  var timeAgo = (typeof window !== 'undefined' && window.Lex && window.Lex.Utils && window.Lex.Utils.timeAgo)
    ? window.Lex.Utils.timeAgo
    : function (s) { return s ? String(s) : ''; };

  var TEMPLATE = ''
    + '<main class="agents-page-container">'
    +   '<section class="agents-studio-hero">'
    +     '<div class="agents-studio-hero-copy">'
    +       '<span class="agents-studio-eyebrow">LANA Agent Studio</span>'
    +       '<h1>Turn repeat work into<br><em>reliable outcomes.</em></h1>'
    +       '<p>Build an agent in a few guided steps, run it when you need it, and see exactly what it produced.</p>'
    +       '<div class="agents-studio-hero-actions">'
    +         '<lex-btn id="agentsCreateBtn" variant="primary" size="lg" icon="plus">Build an agent</lex-btn>'
    +         '<lex-btn id="agentsImportBtn" variant="secondary" size="lg" icon="upload">Bring one from Claude</lex-btn>'
    +       '</div>'
    +     '</div>'
    +     '<div class="agents-studio-orbit" aria-hidden="true">'
    +       '<div class="agents-studio-orbit-ring agents-studio-orbit-ring--outer"></div>'
    +       '<div class="agents-studio-orbit-ring agents-studio-orbit-ring--inner"></div>'
    +       '<div class="agents-studio-orbit-core">L</div>'
    +       '<span class="agents-studio-orbit-node agents-studio-orbit-node--one">Build</span>'
    +       '<span class="agents-studio-orbit-node agents-studio-orbit-node--two">Run</span>'
    +       '<span class="agents-studio-orbit-node agents-studio-orbit-node--three">Review</span>'
    +     '</div>'
    +   '</section>'

    +   '<section class="agents-studio-metrics" aria-label="Workspace pulse">'
    +     '<lex-metric id="agentsMetricDeployed" label="Deployed agents" value="–"></lex-metric>'
    +     '<lex-metric id="agentsMetricRunning" label="Working now" value="–"></lex-metric>'
    +     '<lex-metric id="agentsMetricAttention" label="Need your input" value="–"></lex-metric>'
    +     '<lex-metric id="agentsMetricCompleted" label="Outcomes ready" value="–"></lex-metric>'
    +   '</section>'

    +   '<section class="agents-studio-journey" aria-labelledby="agentsJourneyTitle">'
    +     '<div class="agents-studio-section-head">'
    +       '<div><span class="agents-studio-section-kicker">A simple loop</span><h2 id="agentsJourneyTitle">You always know what happens next.</h2></div>'
    +     '</div>'
    +     '<div class="agents-studio-journey-grid">'
    +       '<button type="button" class="agents-studio-journey-step" data-journey="build"><span class="agents-studio-journey-number">01</span><div><strong>Build</strong><span>Start with the outcome and choose what your agent may use.</span></div><span class="agents-studio-journey-arrow">→</span></button>'
    +       '<button type="button" class="agents-studio-journey-step" data-journey="run"><span class="agents-studio-journey-number">02</span><div><strong>Run</strong><span>Give it a task yourself or put recurring work on a schedule.</span></div><span class="agents-studio-journey-arrow">→</span></button>'
    +       '<button type="button" class="agents-studio-journey-step" data-journey="review"><span class="agents-studio-journey-number">03</span><div><strong>Review outcomes</strong><span>Open deliverables, approvals, and a clear record of the work.</span></div><span class="agents-studio-journey-arrow">→</span></button>'
    +     '</div>'
    +   '</section>'

    +   '<section class="agents-studio-roster" aria-labelledby="agentsRosterTitle">'
    +     '<div class="agents-studio-section-head agents-studio-section-head--roster">'
    +       '<div><span class="agents-studio-section-kicker">Your workspace</span><h2 id="agentsRosterTitle">Agents</h2></div>'
    +       '<div class="agents-studio-roster-tools">'
    +         '<lex-input id="agentsSearch" type="search" placeholder="Find an agent..." leading-icon="search" clearable></lex-input>'
    +         '<lex-segmented id="agentsFilterTabs" value="mine" options=\'[{"value":"mine","label":"My agents"},{"value":"templates","label":"Starting points"}]\'></lex-segmented>'
    +       '</div>'
    +     '</div>'
    +     '<div id="agentsLoading" class="agents-grid">'
    +       '<div class="agents-card-skeleton" aria-hidden="true"><div class="agents-skeleton-line agents-skeleton-line--avatar"></div><div class="agents-skeleton-line agents-skeleton-line--title"></div><div class="agents-skeleton-line agents-skeleton-line--text"></div><div class="agents-skeleton-line agents-skeleton-line--text-short"></div></div>'
    +       '<div class="agents-card-skeleton" aria-hidden="true"><div class="agents-skeleton-line agents-skeleton-line--avatar"></div><div class="agents-skeleton-line agents-skeleton-line--title"></div><div class="agents-skeleton-line agents-skeleton-line--text"></div><div class="agents-skeleton-line agents-skeleton-line--text-short"></div></div>'
    +       '<div class="agents-card-skeleton" aria-hidden="true"><div class="agents-skeleton-line agents-skeleton-line--avatar"></div><div class="agents-skeleton-line agents-skeleton-line--title"></div><div class="agents-skeleton-line agents-skeleton-line--text"></div><div class="agents-skeleton-line agents-skeleton-line--text-short"></div></div>'
    +     '</div>'
    +     '<div id="agentsGrid" class="agents-grid hidden"></div>'
    +     '<div id="agentsEmpty" class="agents-studio-empty hidden"></div>'
    +   '</section>'

    +   '<section class="agents-studio-recent" aria-labelledby="agentsRecentTitle">'
    +     '<div class="agents-studio-section-head">'
    +       '<div><span class="agents-studio-section-kicker">Recent work</span><h2 id="agentsRecentTitle">Outcomes</h2></div>'
    +       '<lex-btn id="agentsViewOutcomesBtn" variant="ghost" icon-right="arrow-right">See all outcomes</lex-btn>'
    +     '</div>'
    +     '<div id="agentsRecentOutcomes" class="agents-studio-outcome-list"><div class="agents-studio-outcome-loading"><lex-spinner size="sm"></lex-spinner><span>Loading recent outcomes...</span></div></div>'
    +   '</section>'

    +   '<lex-modal id="agentsRunModal" heading="Give this agent a task" size="md" confirm-text="Start run" cancel-text="Cancel" data-hoist>'
    +     '<div class="agents-run-modal-body"><p id="agentsRunModalText" class="agents-run-modal-text">Describe the outcome you need. You will be able to follow the work live.</p>'
    +       '<lex-textarea id="agentsRunInput" label="What should it do?" rows="5" auto-resize maxlength="1200" show-count placeholder="Example: Review this week’s open items and prepare a prioritized follow-up list..."></lex-textarea>'
    +       '<div class="agents-run-scope-field"><lex-select id="agentsRunScope" label="Run scope"></lex-select><span id="agentsRunScopeHint">Choose whether this run should use organization-wide data or one workspace.</span></div>'
    +       '<div id="agentsRunWorkspaceField" class="agents-run-workspace-field hidden"><lex-select id="agentsRunWorkspace" label="Where should it work?" placeholder="Choose a workspace..." searchable></lex-select><span id="agentsRunWorkspaceHint">This agent uses the selected workspace’s documents, tasks, and business context.</span></div>'
    +       '<div class="agents-run-safety"><span>✓</span><p><strong>You stay in control.</strong> This is a real run. Sensitive changes still pause for approval, and its work will appear in Outcomes.</p></div>'
    +     '</div>'
    +   '</lex-modal>'
    + '</main>';

  function el(id) { return document.getElementById(id); }
  function show(node) { if (node) node.classList.remove('hidden'); }
  function hide(node) { if (node) node.classList.add('hidden'); }

  function getKind(agent) {
    if (!agent) return 'custom';
    if (agent.is_system === true || agent.kind === 'system') return 'system';
    if (agent.is_system === false || agent.kind === 'custom') return 'custom';
    if (agent.organization_id === null || agent.organization_id === undefined) return agent.org_id ? 'custom' : 'system';
    return 'custom';
  }

  function humanize(value) {
    var parts = String(value || '').split('_').join(' ').split('-').join(' ').split(' ');
    var words = [];
    for (var i = 0; i < parts.length; i++) if (parts[i]) words.push(parts[i].charAt(0).toUpperCase() + parts[i].slice(1));
    return words.join(' ');
  }

  function scheduleLabel(schedule) {
    if (!schedule || schedule.enabled === false || !schedule.cron) return 'On demand';
    if (schedule.cron === '0 9 * * 1-5') return 'Weekday mornings';
    if (schedule.cron === '0 9 * * *') return 'Every morning';
    if (schedule.cron === '0 9 * * 1') return 'Every Monday';
    return 'Scheduled';
  }

  function contextProvidersFor(agent) {
    if (!agent) return [];
    if (Array.isArray(agent.context_providers)) return agent.context_providers;
    if (Array.isArray(agent.contextProviders)) return agent.contextProviders;
    return [];
  }

  function agentNeedsWorkspace(agent) {
    var providers = contextProvidersFor(agent);
    for (var i = 0; i < providers.length; i++) if (providers[i] && providers[i].scope === 'matter') return true;
    return false;
  }

  function runScopesFor(agent) {
    var configured = agent && (agent.run_scopes || agent.runScopes);
    var scopes = [];
    if (Array.isArray(configured)) {
      for (var i = 0; i < configured.length; i++) {
        var scope = String(configured[i] || '').toLowerCase();
        if ((scope === 'system' || scope === 'workspace') && scopes.indexOf(scope) === -1) scopes.push(scope);
      }
    }
    if (scopes.length) return scopes;
    return agentNeedsWorkspace(agent) ? ['workspace'] : ['system', 'workspace'];
  }

  function defaultRunScope(agent) {
    var scopes = runScopesFor(agent);
    if (scopes.length === 1) return scopes[0];
    return agentNeedsWorkspace(agent) ? 'workspace' : 'system';
  }

  function runScopeOptions(agent) {
    var scopes = runScopesFor(agent);
    var options = [];
    if (scopes.indexOf('system') !== -1) options.push({ value: 'system', label: 'System · Across the organization' });
    if (scopes.indexOf('workspace') !== -1) options.push({ value: 'workspace', label: 'Workspace · One workspace' });
    return options;
  }

  function workspaceOptions(workspaces) {
    var options = [];
    for (var i = 0; i < workspaces.length; i++) {
      var workspace = workspaces[i] || {};
      var value = workspace.matter_id || workspace.id;
      if (!value) continue;
      var name = workspace.name || workspace.matter_name || workspace.title || String(value);
      var client = workspace.client_name || (workspace.client && workspace.client.name) || '';
      options.push({ value: String(value), label: client ? name + ' · ' + client : name });
    }
    return options;
  }

  function buildRunPayload(input, matterId, scope) {
    var value = String(input || '').trim();
    var resolvedScope = scope || (matterId ? 'workspace' : 'system');
    var payload = { input: { goal: value }, title: value.slice(0, 100), scope: resolvedScope };
    if (resolvedScope === 'workspace' && matterId) payload.matter_id = matterId;
    return payload;
  }

  function createState() {
    return {
      allAgents: [],
      customAgents: [],
      templates: [],
      tasks: [],
      filter: 'mine',
      query: '',
      selectedAgent: null,
      workspaces: [],
      workspacesLoaded: false,
      workspacesLoading: false,
      destroyed: false,
      _unbindFns: []
    };
  }

  function setMetric(id, value) {
    var metric = el(id);
    if (metric) metric.value = String(value);
  }

  function updateMetrics(state) {
    var running = 0;
    var attention = 0;
    var completed = 0;
    for (var i = 0; i < state.tasks.length; i++) {
      var status = state.tasks[i].execution_status || state.tasks[i].status || '';
      if (status === 'running' || status === 'queued' || status === 'compiling_context') running++;
      if (status === 'awaiting_input' || status === 'awaiting_approval') attention++;
      if (status === 'completed' || status === 'approved') completed++;
    }
    setMetric('agentsMetricDeployed', state.customAgents.filter(function (agent) { return agent.is_active !== false; }).length);
    setMetric('agentsMetricRunning', running);
    setMetric('agentsMetricAttention', attention);
    setMetric('agentsMetricCompleted', completed);
  }

  function findInstalledAgent(state, template) {
    for (var i = 0; i < state.customAgents.length; i++) {
      var agent = state.customAgents[i];
      if (agent.template_slug === template.slug || agent.slug === template.slug) return agent;
    }
    return null;
  }

  function renderCustomCard(agent) {
    var slug = escHtml(agent.slug || '');
    var name = escHtml(agent.name || humanize(agent.slug) || 'Untitled agent');
    var description = escHtml(agent.description || agent.summary || 'Ready for your next task.');
    var active = agent.is_active !== false;
    var tools = Array.isArray(agent.allowed_tools) ? agent.allowed_tools.length : 0;
    return '<article class="agents-card agents-card--deployed" data-agent-slug="' + slug + '">'
      + '<div class="agents-card-top"><span class="agents-card-avatar">' + escHtml((agent.name || agent.slug || 'A').charAt(0).toUpperCase()) + '</span>'
      + '<span class="agents-card-status ' + (active ? 'agents-card-status--live' : 'agents-card-status--paused') + '"><i></i>' + (active ? 'Deployed' : 'Paused') + '</span></div>'
      + '<div class="agents-card-body"><h3>' + name + '</h3><p>' + description + '</p></div>'
      + '<div class="agents-card-facts"><span>' + tools + ' capabilit' + (tools === 1 ? 'y' : 'ies') + '</span><span>' + escHtml(scheduleLabel(agent.schedule)) + '</span></div>'
      + '<div class="agents-card-actions"><lex-btn variant="primary" size="sm" icon="play" data-action="run" data-agent-slug="' + slug + '"' + (active ? '' : ' disabled') + '>Run agent</lex-btn>'
      + '<lex-btn variant="ghost" size="sm" data-action="open" data-agent-slug="' + slug + '">Open</lex-btn></div></article>';
  }

  function renderTemplateCard(state, template) {
    var slug = escHtml(template.slug || '');
    var name = escHtml(template.name || humanize(template.slug));
    var description = escHtml(template.description || 'A governed LANA starting point.');
    var tools = Array.isArray(template.allowed_tools) ? template.allowed_tools.length : 0;
    var installed = findInstalledAgent(state, template);
    return '<article class="agents-card agents-card--template" data-agent-slug="' + slug + '">'
      + '<div class="agents-card-top"><span class="agents-card-avatar agents-card-avatar--template">' + escHtml((template.name || template.slug || 'A').charAt(0).toUpperCase()) + '</span>'
      + '<span class="agents-card-status agents-card-status--starter">' + (installed ? 'Already added' : 'Starting point') + '</span></div>'
      + '<div class="agents-card-body"><h3>' + name + '</h3><p>' + description + '</p></div>'
      + '<div class="agents-card-facts"><span>' + tools + ' built-in capabilit' + (tools === 1 ? 'y' : 'ies') + '</span><span>Governed template</span></div>'
      + '<div class="agents-card-actions">'
      + (installed
        ? '<lex-btn variant="secondary" size="sm" data-action="open" data-agent-slug="' + escHtml(installed.slug) + '">Open agent</lex-btn>'
        : '<lex-btn variant="primary" size="sm" icon="plus" data-action="use-template" data-agent-slug="' + slug + '">Use this starting point</lex-btn>')
      + '<lex-btn variant="ghost" size="sm" data-action="preview" data-agent-slug="' + slug + '">Preview</lex-btn></div></article>';
  }

  function matchesSearch(agent, query) {
    if (!query) return true;
    var haystack = [agent.name, agent.slug, agent.description, agent.summary].join(' ').toLowerCase();
    return haystack.indexOf(query.toLowerCase()) !== -1;
  }

  function renderGrid(state) {
    var grid = el('agentsGrid');
    var empty = el('agentsEmpty');
    if (!grid || !empty) return;
    hide(el('agentsLoading'));
    var source = state.filter === 'templates' ? state.templates : state.customAgents;
    var filtered = source.filter(function (agent) { return matchesSearch(agent, state.query); });
    if (!filtered.length) {
      grid.innerHTML = '';
      hide(grid);
      if (state.query) {
        empty.innerHTML = '<lex-empty icon="search" message="No agents match that search" description="Try a different name or clear the search."></lex-empty>';
      } else if (state.filter === 'mine') {
        empty.innerHTML = '<div class="agents-studio-first-agent"><span class="agents-studio-first-mark">01</span><div><strong>Your first agent starts with one repeatable outcome.</strong><p>Choose a starting point, describe the job in your own words, and deploy it when everything looks right.</p></div><lex-btn id="agentsEmptyCreateBtn" variant="primary" icon="plus">Build your first agent</lex-btn></div>';
      } else {
        empty.innerHTML = '<lex-empty icon="bot" message="No starting points available" description="Ask an administrator to seed the LANA agent catalog."></lex-empty>';
      }
      show(empty);
      return;
    }
    var html = '';
    for (var i = 0; i < filtered.length; i++) html += state.filter === 'templates' ? renderTemplateCard(state, filtered[i]) : renderCustomCard(filtered[i]);
    grid.innerHTML = html;
    hide(empty);
    show(grid);
  }

  function statusLabel(status) {
    if (status === 'awaiting_input') return 'Needs your input';
    if (status === 'awaiting_approval') return 'Ready for approval';
    if (status === 'compiling_context') return 'Getting ready';
    if (status === 'running') return 'Working now';
    if (status === 'queued') return 'Queued';
    if (status === 'completed' || status === 'approved') return 'Outcome ready';
    if (status === 'failed') return 'Needs attention';
    if (status === 'cancelled') return 'Cancelled';
    return humanize(status || 'pending');
  }

  function statusClass(status) {
    if (status === 'completed' || status === 'approved') return 'ready';
    if (status === 'awaiting_input' || status === 'awaiting_approval') return 'attention';
    if (status === 'running' || status === 'queued' || status === 'compiling_context') return 'working';
    if (status === 'failed' || status === 'rejected') return 'issue';
    return 'neutral';
  }

  function renderRecentOutcomes(state) {
    var holder = el('agentsRecentOutcomes');
    if (!holder) return;
    if (!state.tasks.length) {
      holder.innerHTML = '<div class="agents-studio-outcomes-empty"><span>No outcomes yet.</span><strong>Run an agent and its work will appear here.</strong></div>';
      return;
    }
    var html = '';
    var limit = Math.min(4, state.tasks.length);
    for (var i = 0; i < limit; i++) {
      var task = state.tasks[i];
      var status = task.execution_status || task.status || 'pending';
      var title = escHtml(task.name || task.title || 'Agent outcome');
      var description = escHtml(task.task_description || task.description || 'Open this outcome to review the work.');
      html += '<button type="button" class="agents-studio-outcome" data-outcome-id="' + escHtml(task.id || '') + '">'
        + '<span class="agents-studio-outcome-dot agents-studio-outcome-dot--' + statusClass(status) + '"></span>'
        + '<span class="agents-studio-outcome-copy"><strong>' + title + '</strong><small>' + description + '</small></span>'
        + '<span class="agents-studio-outcome-meta"><strong>' + escHtml(statusLabel(status)) + '</strong><small>' + escHtml(task.created_at ? timeAgo(task.created_at) : '') + '</small></span>'
        + '<span class="agents-studio-outcome-arrow">→</span></button>';
    }
    holder.innerHTML = html;
  }

  function loadAgents(state) {
    if (!window.api || typeof window.api.get !== 'function') {
      var ready = function () { loadAgents(state); };
      state._lexReadyHandler = ready;
      document.addEventListener('lex-ready', ready, { once: true });
      return;
    }
    window.api.get('/api/v1/agents').then(function (response) {
      if (state.destroyed) return;
      var agents = Array.isArray(response) ? response : ((response && (response.data || response.agents)) || []);
      state.allAgents = Array.isArray(agents) ? agents : [];
      state.customAgents = state.allAgents.filter(function (agent) { return getKind(agent) === 'custom'; });
      state.templates = state.allAgents.filter(function (agent) { return getKind(agent) === 'system'; });
      if (!state.customAgents.length) {
        state.filter = 'templates';
        var filter = el('agentsFilterTabs');
        if (filter) filter.value = 'templates';
      }
      updateMetrics(state);
      renderGrid(state);
    }).catch(function (err) {
      if (state.destroyed) return;
      console.error('[agents] Failed to load workspace agents', err);
      hide(el('agentsLoading'));
      var empty = el('agentsEmpty');
      if (empty) empty.innerHTML = '<lex-empty icon="alert-circle" message="Agent workspace unavailable" description="Check the LANA Agents service and try again."></lex-empty>';
      show(empty);
    });
  }

  function loadRecentOutcomes(state) {
    if (!window.api || typeof window.api.get !== 'function') return;
    window.api.get('/api/v1/agentic-tasks?limit=50&offset=0&sort_by=created_at&sort_order=desc').then(function (response) {
      if (state.destroyed) return;
      state.tasks = response && Array.isArray(response.data) ? response.data : (Array.isArray(response) ? response : []);
      updateMetrics(state);
      renderRecentOutcomes(state);
    }).catch(function (err) {
      if (state.destroyed) return;
      console.warn('[agents] Recent outcomes unavailable', err);
      state.tasks = [];
      updateMetrics(state);
      renderRecentOutcomes(state);
    });
  }

  function findAgent(state, slug) {
    for (var i = 0; i < state.allAgents.length; i++) if (state.allAgents[i].slug === slug) return state.allAgents[i];
    return null;
  }

  function openRunModal(state, slug) {
    var agent = findAgent(state, slug);
    state.selectedAgent = agent || { slug: slug };
    var modal = el('agentsRunModal');
    var input = el('agentsRunInput');
    var workspace = el('agentsRunWorkspace');
    var scope = el('agentsRunScope');
    if (input) input.value = '';
    if (workspace) workspace.value = '';
    if (scope) {
      var scopes = runScopesFor(state.selectedAgent);
      scope.options = runScopeOptions(state.selectedAgent);
      scope.value = defaultRunScope(state.selectedAgent);
      scope.disabled = scopes.length === 1;
    }
    syncRunScope(state);
    if (modal) {
      modal.heading = 'Run ' + (state.selectedAgent.name || humanize(slug));
      modal.open = true;
    }
  }

  function populateRunWorkspaces(state) {
    var select = el('agentsRunWorkspace');
    if (!select) return;
    select.options = workspaceOptions(state.workspaces);
    select.disabled = false;
    if (!state.workspaces.length) setText('agentsRunWorkspaceHint', 'No active workspaces are available. Create or activate one before starting this agent.');
    else setText('agentsRunWorkspaceHint', 'This agent uses the selected workspace’s documents, tasks, and business context.');
  }

  function syncRunScope(state) {
    var scopeSelect = el('agentsRunScope');
    var workspace = el('agentsRunWorkspace');
    var workspaceField = el('agentsRunWorkspaceField');
    var scope = scopeSelect && scopeSelect.value ? String(scopeSelect.value) : defaultRunScope(state.selectedAgent);
    if (scope === 'workspace') {
      show(workspaceField);
      setText('agentsRunScopeHint', 'This run is isolated to one workspace and its documents, tasks, contacts, and connected data.');
      loadRunWorkspaces(state);
      return;
    }
    if (workspace) workspace.value = '';
    hide(workspaceField);
    setText('agentsRunScopeHint', 'This run can work across organization-level analytics, tables, and connected data.');
  }

  function setText(id, value) {
    var node = el(id);
    if (node) node.textContent = value == null ? '' : String(value);
  }

  function loadRunWorkspaces(state) {
    if (state.workspacesLoaded) { populateRunWorkspaces(state); return; }
    if (state.workspacesLoading || !window.api || typeof window.api.getMatters !== 'function') return;
    state.workspacesLoading = true;
    var select = el('agentsRunWorkspace');
    if (select) select.disabled = true;
    setText('agentsRunWorkspaceHint', 'Loading active workspaces...');
    window.api.getMatters(1, 100, { status: 'active', sort_by: 'updated_at', sort_order: 'desc' }).then(function (response) {
      if (state.destroyed) return;
      var matters = Array.isArray(response) ? response : ((response && (response.matters || response.data)) || []);
      state.workspaces = Array.isArray(matters) ? matters : [];
      state.workspacesLoaded = true;
      state.workspacesLoading = false;
      populateRunWorkspaces(state);
    }).catch(function () {
      if (state.destroyed) return;
      state.workspaces = [];
      state.workspacesLoading = false;
      if (select) select.disabled = false;
      setText('agentsRunWorkspaceHint', 'Workspaces could not be loaded. Close this window and try again.');
    });
  }

  function submitRun(ctx, state) {
    if (!state.selectedAgent || !state.selectedAgent.slug) return;
    var input = el('agentsRunInput');
    var value = input && input.value != null ? String(input.value).trim() : '';
    if (!value) { if (window.Lex && window.Lex.Toast) window.Lex.Toast.error('Describe the outcome you need first.'); return; }
    var workspace = el('agentsRunWorkspace');
    var scopeSelect = el('agentsRunScope');
    var scope = scopeSelect && scopeSelect.value ? String(scopeSelect.value) : defaultRunScope(state.selectedAgent);
    var matterId = workspace && workspace.value ? String(workspace.value) : '';
    if (scope === 'workspace' && !matterId) { if (window.Lex && window.Lex.Toast) window.Lex.Toast.error('Choose the workspace where this agent should work.'); return; }
    var modal = el('agentsRunModal');
    if (modal) modal.loading = true;
    window.api.post('/api/v1/agents/' + encodeURIComponent(state.selectedAgent.slug) + '/runs', buildRunPayload(value, matterId, scope)).then(function (response) {
      if (state.destroyed) return;
      var runId = (response && response.run && response.run.id) || (response && response.data && response.data.id) || (response && response.id) || (response && response.run_id);
      if (modal) { modal.loading = false; modal.open = false; }
      if (window.Lex && window.Lex.Toast) window.Lex.Toast.success('Agent started');
      if (runId) ctx.app.setView('agentRun', { runId: runId });
      else ctx.app.setView('activity');
    }).catch(function (err) {
      if (state.destroyed) return;
      if (modal) modal.loading = false;
      var status = err && (err.status || (err.response && err.response.status));
      var message = status === 403 ? 'You do not have permission to run this agent.' : 'LANA could not start this agent.';
      if (window.Lex && window.Lex.Toast) window.Lex.Toast.error(message);
    });
  }

  function bind(state, node, eventName, handler) {
    if (!node) return;
    node.addEventListener(eventName, handler);
    state._unbindFns.push(function () { node.removeEventListener(eventName, handler); });
  }

  function wire(rootEl, ctx, state) {
    bind(state, el('agentsCreateBtn'), 'click', function () { ctx.app.setView('create'); });
    bind(state, el('agentsImportBtn'), 'click', function () { ctx.app.setView('create', { mode: 'import' }); });
    bind(state, el('agentsViewOutcomesBtn'), 'click', function () { ctx.app.setView('activity'); });
    bind(state, el('agentsFilterTabs'), 'lex-change', function (event) {
      state.filter = (event && event.detail && event.detail.value) || 'mine';
      renderGrid(state);
    });
    bind(state, el('agentsSearch'), 'lex-input', function (event) {
      state.query = (event && event.detail && event.detail.value) || '';
      renderGrid(state);
    });
    bind(state, el('agentsEmpty'), 'click', function (event) {
      if (event.target.closest('#agentsEmptyCreateBtn')) ctx.app.setView('create');
    });
    bind(state, document.querySelector('.agents-studio-journey-grid'), 'click', function (event) {
      var step = event.target.closest('[data-journey]');
      if (!step) return;
      var action = step.getAttribute('data-journey');
      if (action === 'build') ctx.app.setView('create');
      else if (action === 'review') ctx.app.setView('activity');
      else {
        state.filter = 'mine';
        var filter = el('agentsFilterTabs');
        if (filter) filter.value = 'mine';
        renderGrid(state);
        var roster = document.querySelector('.agents-studio-roster');
        if (roster) roster.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    bind(state, el('agentsGrid'), 'click', function (event) {
      var button = event.target.closest('[data-action]');
      var card = event.target.closest('[data-agent-slug]');
      if (!button && !card) return;
      var slug = (button && button.getAttribute('data-agent-slug')) || (card && card.getAttribute('data-agent-slug'));
      var action = button && button.getAttribute('data-action');
      if (!button) { ctx.app.setView('agentDetail', { slug: slug }); return; }
      event.stopPropagation();
      if (action === 'run') openRunModal(state, slug);
      if (action === 'open' || action === 'preview') ctx.app.setView('agentDetail', { slug: slug });
      if (action === 'use-template') ctx.app.setView('create', { templateSlug: slug });
    });
    bind(state, el('agentsRecentOutcomes'), 'click', function (event) {
      var row = event.target.closest('[data-outcome-id]');
      if (row && row.getAttribute('data-outcome-id')) ctx.app.setView('activityDetail', { id: row.getAttribute('data-outcome-id') });
    });
    bind(state, el('agentsRunModal'), 'lex-confirm', function () { submitRun(ctx, state); });
    bind(state, el('agentsRunScope'), 'lex-change', function () { syncRunScope(state); });
  }

  function render(rootEl, ctx) {
    rootEl.innerHTML = TEMPLATE;
    var state = createState();
    rootEl._catalogState = state;
    wire(rootEl, ctx, state);
    loadAgents(state);
    loadRecentOutcomes(state);
  }

  function destroy(rootEl) {
    var state = rootEl && rootEl._catalogState;
    if (!state) return;
    state.destroyed = true;
    if (state._lexReadyHandler) document.removeEventListener('lex-ready', state._lexReadyHandler);
    for (var i = 0; i < state._unbindFns.length; i++) {
      try { state._unbindFns[i](); } catch (_err) { /* ignored */ }
    }
    state._unbindFns = [];
    rootEl._catalogState = null;
  }

  global.LanaAgentsApp.Views.catalog = {
    render: render,
    destroy: destroy,
    __test: {
      agentNeedsWorkspace: agentNeedsWorkspace,
      runScopesFor: runScopesFor,
      defaultRunScope: defaultRunScope,
      buildRunPayload: buildRunPayload
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
