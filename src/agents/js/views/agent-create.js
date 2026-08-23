/* agent-create.js — Guided agent builder for the LanaAgents workspace.
   The builder keeps LANA's governed-template contract intact while presenting
   setup as four plain-language decisions: starting point, identity, access,
   and deployment. Claude Markdown/JSON imports are parsed locally and mapped
   onto a governed template; source instructions are never uploaded.

   Rules:
     - IIFE wrapper, no top-level const/class
     - Internal navigation goes through ctx.app.setView
     - All dynamic HTML is escaped with Lex.Utils.escapeHtml()
     - NO regex
*/

'use strict';

(function (global) {
  global.LanaAgentsApp = global.LanaAgentsApp || {};
  global.LanaAgentsApp.Views = global.LanaAgentsApp.Views || {};

  var PENDING_KEY = 'lana_agents_pending_create';
  var MAX_IMPORT_BYTES = 1024 * 1024;

  var COMMON_TZS = [
    { value: 'UTC',                 label: 'UTC' },
    { value: 'America/New_York',    label: 'Eastern time' },
    { value: 'America/Chicago',     label: 'Central time' },
    { value: 'America/Denver',      label: 'Mountain time' },
    { value: 'America/Los_Angeles', label: 'Pacific time' },
    { value: 'Europe/London',       label: 'London' },
    { value: 'Europe/Berlin',       label: 'Berlin' },
    { value: 'Asia/Singapore',      label: 'Singapore' },
    { value: 'Asia/Tokyo',          label: 'Tokyo' },
    { value: 'Australia/Sydney',    label: 'Sydney' }
  ];

  var SCHEDULE_PRESETS = [
    { value: 'weekday_morning', label: 'Weekday mornings' },
    { value: 'daily_morning',   label: 'Every morning' },
    { value: 'weekly_monday',   label: 'Every Monday' },
    { value: 'advanced',        label: 'Custom' }
  ];

  var STEP_META = [
    { number: 1, label: 'Starting point', hint: 'Choose or bring your own' },
    { number: 2, label: 'Purpose',        hint: 'Make the job clear' },
    { number: 3, label: 'Access',         hint: 'Choose what it can use' },
    { number: 4, label: 'Deploy',         hint: 'Decide when it works' }
  ];

  var escHtml = (typeof window !== 'undefined' && window.Lex && window.Lex.Utils && window.Lex.Utils.escapeHtml)
    ? window.Lex.Utils.escapeHtml
    : function (s) { var d = document.createElement('div'); d.textContent = (s == null ? '' : String(s)); return d.innerHTML; };

  var TEMPLATE = ''
    + '<main class="agent-create-page-container">'
    +   '<lex-banner id="agentCreateBanner" variant="light" heading="Build an agent"'
    +     ' subtitle="Tell us the outcome. LANA will guide the setup and keep the technical pieces out of your way."'
    +     ' lana lana-context-type="full_chat"></lex-banner>'

    +   '<div class="agent-builder-layout">'
    +     '<aside class="agent-builder-steps" aria-label="Agent setup progress">'
    +       '<div class="agent-builder-steps-eyebrow">Your setup</div>'
    +       '<ol id="agentBuilderStepList" class="agent-builder-step-list"></ol>'
    +       '<div class="agent-builder-assurance">'
    +         '<span class="agent-builder-assurance-mark">L</span>'
    +         '<div><strong>Governed by LANA</strong><span>Tools, access, and approvals remain visible to your team.</span></div>'
    +       '</div>'
    +     '</aside>'

    +     '<div class="agent-builder-workspace">'
    +       '<section id="agentBuilderStep1" class="agent-builder-panel" data-builder-step="1">'
    +         '<div class="agent-builder-panel-head">'
    +           '<span class="agent-builder-kicker">Step 1 of 4</span>'
    +           '<h2>What should your agent handle?</h2>'
    +           '<p>Describe the repeat work in your own words and LANA can recommend a starting point, or bring over an agent you already use with Claude.</p>'
    +         '</div>'
    +         '<div class="agent-builder-paths" role="group" aria-label="Choose a starting path">'
    +           '<button id="agentBuilderTemplatePath" class="agent-builder-path active" type="button" data-path="template">'
    +             '<span class="agent-builder-path-icon">L</span>'
    +             '<span><strong>Start with LANA</strong><small>Pick a trusted starting point and tailor it to your business.</small></span>'
    +             '<span class="agent-builder-path-check" aria-hidden="true">✓</span>'
    +           '</button>'
    +           '<button id="agentBuilderImportPath" class="agent-builder-path" type="button" data-path="import">'
    +             '<span class="agent-builder-path-icon agent-builder-path-icon--claude">C</span>'
    +             '<span><strong>Bring one from Claude</strong><small>Map a CLAUDE.md or JSON agent config into LANA.</small></span>'
    +             '<span class="agent-builder-path-check" aria-hidden="true">✓</span>'
    +           '</button>'
    +         '</div>'

    +         '<div id="agentBuilderTemplateArea" class="agent-builder-path-panel">'
    +           '<div class="agent-builder-goal-card">'
    +             '<div class="agent-builder-goal-copy"><span class="agent-builder-goal-mark">✦</span><div><strong>Start with the job</strong><p>No agent vocabulary needed. Tell LANA what keeps repeating or what result you want.</p></div></div>'
    +             '<lex-textarea id="agentBuilderGoalInput" label="What work should this agent take off your plate?" rows="3" auto-resize maxlength="500" placeholder="Example: Every Friday, review open client work and prepare a concise follow-up list for the team."></lex-textarea>'
    +             '<div class="agent-builder-goal-actions"><lex-btn id="agentBuilderRecommendBtn" variant="secondary" icon="sparkles">Recommend a starting point</lex-btn><span>You can compare or change it below.</span></div>'
    +             '<div id="agentBuilderGoalResult" class="agent-builder-goal-result hidden" aria-live="polite"></div>'
    +           '</div>'
    +           '<div class="agent-builder-section-heading"><h3>Choose what you want handled</h3><span>Everything can be renamed and adjusted next.</span></div>'
    +           '<div id="agentBuilderTemplateLoading" class="agent-builder-template-loading"><lex-spinner size="sm"></lex-spinner><span>Finding your starting points...</span></div>'
    +           '<div id="agentBuilderTemplateGrid" class="agent-builder-template-grid"></div>'
    +         '</div>'

    +         '<div id="agentBuilderImportArea" class="agent-builder-path-panel hidden">'
    +           '<input id="agentBuilderImportFile" class="agent-builder-file-input" type="file" accept=".md,.markdown,.json,text/markdown,text/plain,application/json">'
    +           '<button id="agentBuilderDropzone" class="agent-builder-dropzone" type="button">'
    +             '<span class="agent-builder-dropzone-icon">C → L</span>'
    +             '<strong>Choose a Claude agent file</strong>'
    +             '<span>CLAUDE.md, Markdown, or JSON · up to 1 MB</span>'
    +             '<small>The file is read locally. Its source instructions are not uploaded.</small>'
    +           '</button>'
    +           '<div id="agentBuilderImportResult" class="agent-builder-import-result hidden" aria-live="polite"></div>'
    +         '</div>'
    +       '</section>'

    +       '<section id="agentBuilderStep2" class="agent-builder-panel hidden" data-builder-step="2">'
    +         '<div class="agent-builder-panel-head">'
    +           '<span class="agent-builder-kicker">Step 2 of 4</span>'
    +           '<h2>Give your agent one clear job</h2>'
    +           '<p>A plain, specific purpose makes it easier for everyone to know when to use this agent.</p>'
    +         '</div>'
    +         '<div class="agent-builder-form-card">'
    +           '<lex-input id="agentCreateName" label="Agent name" placeholder="Example: Weekly client follow-up" required maxlength="80" show-count></lex-input>'
    +           '<lex-textarea id="agentCreateDescription" label="What outcome should it create?" rows="5" auto-resize maxlength="500" show-count'
    +             ' placeholder="Example: Review new client messages, identify anything that needs a response, and prepare a concise follow-up list for the team."></lex-textarea>'
    +           '<div class="agent-builder-writing-tip"><strong>A useful pattern</strong><span>When <em>this happens</em>, help <em>these people</em> achieve <em>this result</em>.</span></div>'
    +         '</div>'
    +         '<div id="agentBuilderIdentityPreview" class="agent-builder-identity-preview" aria-live="polite"></div>'
    +       '</section>'

    +       '<section id="agentBuilderStep3" class="agent-builder-panel hidden" data-builder-step="3">'
    +         '<div class="agent-builder-panel-head">'
    +           '<span class="agent-builder-kicker">Step 3 of 4</span>'
    +           '<h2>Choose what your agent can use</h2>'
    +           '<p>Access stays limited to the tools you choose. LANA will still pause for approval before sensitive changes.</p>'
    +         '</div>'
    +         '<div class="agent-builder-form-card">'
    +           '<div class="agent-builder-section-heading"><h3>Connected capabilities</h3><span id="agentCreateToolCount">0 selected</span></div>'
    +           '<div id="agentCreateChips" class="agent-create-chips" aria-live="polite"><span class="agent-create-empty-text">No tools selected yet.</span></div>'
    +           '<div class="agent-create-tools-controls">'
    +             '<lex-select id="agentCreateRecentTools" label="Add a capability" placeholder="Search available tools..." searchable></lex-select>'
    +             '<lex-btn id="agentCreateBrowseToolsBtn" variant="secondary" icon="search">Browse all tools</lex-btn>'
    +           '</div>'
    +         '</div>'
    +         '<div class="agent-builder-context-card">'
    +           '<div class="agent-builder-context-head"><div><span class="agent-builder-context-kicker">Working context</span><h3>What it can reference</h3></div><span class="agent-builder-context-lock">Set by starting point</span></div>'
    +           '<div id="agentBuilderContextList" class="agent-builder-context-list"><span class="agent-builder-context-empty">Choose a starting point to see its working context.</span></div>'
    +           '<p id="agentBuilderContextNote" class="agent-builder-context-note">Context is assembled for each run and stays scoped to the workspace you choose.</p>'
    +         '</div>'
    +         '<div class="agent-builder-control-map" aria-label="How control works">'
    +           '<div><span>01</span><strong>Read and prepare</strong><small>Your agent gathers context and creates drafts with the access above.</small></div>'
    +           '<div><span>02</span><strong>Pause before changing</strong><small>Sensitive actions stop at the approval policies set by your team.</small></div>'
    +           '<div><span>03</span><strong>Leave a clear record</strong><small>Runs, decisions, and finished work remain visible under Outcomes.</small></div>'
    +         '</div>'
    +         '<div class="agent-builder-safety-note">'
    +           '<span class="agent-builder-safety-icon">✓</span>'
    +           '<div><strong>You stay in control</strong><span>The starting point sets the safe maximum. Removing a capability here narrows access; it never grants more than your organization allows.</span></div>'
    +         '</div>'
    +       '</section>'

    +       '<section id="agentBuilderStep4" class="agent-builder-panel hidden" data-builder-step="4">'
    +         '<div class="agent-builder-panel-head">'
    +           '<span class="agent-builder-kicker">Step 4 of 4</span>'
    +           '<h2>Put your agent to work</h2>'
    +           '<p>Run it yourself whenever you need it, or give it a simple recurring rhythm.</p>'
    +         '</div>'
    +         '<div class="agent-builder-form-card">'
    +           '<div class="agent-builder-section-heading"><h3>When should it work?</h3><span>You can change this later</span></div>'
    +           '<input id="agentCreateRunMode" type="hidden" value="on_demand">'
    +           '<div class="agent-builder-run-choices" role="group" aria-label="Choose when the agent runs">'
    +             '<button type="button" class="agent-builder-run-choice active" data-run-choice="on_demand" aria-pressed="true">'
    +               '<span class="agent-builder-run-choice-mark">→</span><span><strong>When I ask</strong><small>Keep it ready and start each run yourself.</small></span><span class="agent-builder-run-choice-check">✓</span>'
    +             '</button>'
    +             '<button type="button" class="agent-builder-run-choice" data-run-choice="weekday_morning" aria-pressed="false">'
    +               '<span class="agent-builder-run-choice-mark">↻</span><span><strong>On a rhythm</strong><small>Let it begin repeat work on a schedule.</small></span><span class="agent-builder-run-choice-check">✓</span>'
    +             '</button>'
    +           '</div>'
    +           '<div id="agentCreateScheduleFields" class="agent-create-schedule-fields hidden">'
    +             '<lex-select id="agentCreateSchedulePreset" label="Repeat"></lex-select>'
    +             '<lex-select id="agentCreateScheduleTimezone" label="Timezone" searchable></lex-select>'
    +             '<lex-input id="agentCreateScheduleCron" class="hidden" label="Custom schedule" placeholder="0 9 * * 1-5" help="Advanced: standard 5-field cron expression"></lex-input>'
    +           '</div>'
    +           '<div class="agent-builder-visibility-row"><div><strong>Let teammates find it</strong><span>Show this agent in LANA chat so others can give it work.</span></div><lex-toggle id="agentCreateDiscoverable" label="Findable in chat" label-side="right"></lex-toggle></div>'
    +           '<div class="agent-builder-pilot-card">'
    +             '<div class="agent-builder-pilot-head"><div><span>Pilot run</span><strong>Try it on one real task</strong></div><span class="agent-builder-pilot-badge">Recommended</span></div>'
    +             '<p>This is an actual first run, not a simulation. It starts after deployment, stays inside your selected workspace, and still pauses for required approvals.</p>'
    +             '<lex-textarea id="agentCreateFirstTask" label="First task (optional)" rows="3" auto-resize maxlength="1200" show-count placeholder="Example: Review this week’s open work and prepare a prioritized follow-up list..."></lex-textarea>'
    +             '<div id="agentCreatePilotWorkspaceField" class="agent-builder-pilot-workspace hidden">'
    +               '<lex-select id="agentCreateFirstTaskMatter" label="Workspace for this task" placeholder="Choose a workspace..." searchable></lex-select>'
    +               '<span id="agentCreatePilotWorkspaceHint">This starting point needs a workspace so it can load the right context.</span>'
    +             '</div>'
    +             '<p class="agent-builder-first-task-note">Leave the task blank to deploy quietly and run it later.</p>'
    +           '</div>'
    +         '</div>'
    +         '<div id="agentBuilderReview" class="agent-builder-review" aria-live="polite"></div>'
    +       '</section>'

    +       '<section id="agentBuilderSuccess" class="agent-builder-panel agent-builder-success hidden">'
    +         '<div class="agent-builder-success-mark" aria-hidden="true">✓</div>'
    +         '<span class="agent-builder-kicker">Agent deployed</span>'
    +         '<h2 id="agentBuilderSuccessTitle">Your agent is ready.</h2>'
    +         '<p id="agentBuilderSuccessDescription">It now has a home in your workspace. Give it work when you are ready, then follow the result in Outcomes.</p>'
    +         '<div id="agentBuilderSuccessReceipt" class="agent-builder-success-receipt"></div>'
    +         '<div class="agent-builder-success-next">'
    +           '<span>What happens next</span>'
    +           '<ol><li><strong>Give it a task</strong><small>Describe the result you need in everyday language.</small></li><li><strong>Stay in control</strong><small>LANA pauses when your approval is required.</small></li><li><strong>Review the outcome</strong><small>Finished work and its record appear together.</small></li></ol>'
    +         '</div>'
    +         '<div class="agent-builder-success-actions">'
    +           '<lex-btn id="agentBuilderSuccessOpenBtn" variant="primary" icon-right="arrow-right">Give it a task</lex-btn>'
    +           '<lex-btn id="agentBuilderSuccessWorkspaceBtn" variant="secondary">Back to workspace</lex-btn>'
    +         '</div>'
    +       '</section>'
    +     '</div>'
    +   '</div>'

    +   '<div id="agentCreateStickyBar" class="agent-create-sticky-bar">'
    +     '<div id="agentBuilderAutosave" class="agent-builder-autosave">Setup stays here while you browse tools.</div>'
    +     '<div class="agent-builder-footer-actions">'
    +       '<lex-btn id="agentCreateCancelBtn" variant="ghost">Cancel</lex-btn>'
    +       '<lex-btn id="agentBuilderBackBtn" class="hidden" variant="secondary" icon="arrow-left">Back</lex-btn>'
    +       '<lex-btn id="agentBuilderNextBtn" variant="primary" icon-right="arrow-right">Continue</lex-btn>'
    +       '<lex-btn id="agentCreateSaveBtn" class="hidden" variant="primary" icon="rocket">Deploy agent</lex-btn>'
    +     '</div>'
    +   '</div>'
    + '</main>';

  function el(id) { return document.getElementById(id); }
  function show(node) { if (node) node.classList.remove('hidden'); }
  function hide(node) { if (node) node.classList.add('hidden'); }
  function setText(id, value) { var node = el(id); if (node) node.textContent = value == null ? '' : String(value); }
  function setVal(id, value) { var node = el(id); if (node) node.value = value == null ? '' : value; }
  function setChecked(id, value) { var node = el(id); if (node) node.checked = !!value; }

  function toolName(tool) {
    if (!tool) return '';
    if (typeof tool === 'string') return tool;
    return tool.name || tool.slug || '';
  }

  function getKind(agent) {
    if (!agent) return 'custom';
    if (agent.is_system === true || agent.kind === 'system') return 'system';
    if (agent.is_system === false || agent.kind === 'custom') return 'custom';
    if (agent.organization_id === null || agent.organization_id === undefined) return agent.org_id ? 'custom' : 'system';
    return 'custom';
  }

  function readPending(app) {
    if (app && app.state && app.state.pendingCreate) return app.state.pendingCreate;
    if (typeof sessionStorage !== 'undefined') {
      try {
        var raw = sessionStorage.getItem(PENDING_KEY);
        if (raw) return JSON.parse(raw);
      } catch (_err) { /* ignored */ }
    }
    return null;
  }

  function writePending(app, snapshot) {
    if (app && app.state) app.state.pendingCreate = snapshot;
    if (typeof sessionStorage !== 'undefined') {
      try {
        if (snapshot) sessionStorage.setItem(PENDING_KEY, JSON.stringify(snapshot));
        else sessionStorage.removeItem(PENDING_KEY);
      } catch (_err) { /* ignored */ }
    }
  }

  function clearPending(app) { writePending(app, null); }

  function createState(ctx) {
    return {
      allAgents: [],
      templates: [],
      selectedTpl: null,
      selectedTools: {},
      recentTools: [],
      workspaces: [],
      workspacesLoaded: false,
      currentStep: 1,
      furthestStep: 1,
      path: ctx && ctx.mode === 'import' ? 'import' : 'template',
      imported: null,
      pendingPilotMatterId: '',
      pendingSnapshot: readPending(ctx && ctx.app),
      requestedTemplateSlug: ctx && ctx.templateSlug ? ctx.templateSlug : '',
      destroyed: false,
      _unbindFns: []
    };
  }

  function selectedToolList(state) {
    var names = [];
    for (var key in state.selectedTools) {
      if (Object.prototype.hasOwnProperty.call(state.selectedTools, key) && state.selectedTools[key]) names.push(key);
    }
    names.sort();
    return names;
  }

  function renderChips(state) {
    var holder = el('agentCreateChips');
    if (!holder) return;
    var names = selectedToolList(state);
    setText('agentCreateToolCount', names.length + ' selected');
    if (!names.length) {
      holder.innerHTML = '<span class="agent-create-empty-text">No tools selected yet. You can still run a conversation-only agent.</span>';
      return;
    }
    var html = '';
    for (var i = 0; i < names.length; i++) {
      var safe = escHtml(names[i]);
      html += '<span class="agent-create-chip"><span class="agent-create-chip-name">' + escHtml(humanize(names[i])) + '</span>'
        + '<button type="button" class="agent-create-chip-remove" data-tool="' + safe + '" aria-label="Remove ' + safe + '">×</button></span>';
    }
    holder.innerHTML = html;
  }

  function refreshRecentDropdown(state) {
    var select = el('agentCreateRecentTools');
    if (!select) return;
    var options = [];
    for (var i = 0; i < state.recentTools.length; i++) {
      var name = state.recentTools[i];
      if (name && !state.selectedTools[name]) options.push({ value: name, label: humanize(name) });
    }
    select.options = options;
    select.value = '';
  }

  function addTool(state, name) {
    if (!name) return;
    state.selectedTools[name] = true;
    renderChips(state);
    refreshRecentDropdown(state);
    renderReview(state);
  }

  function removeTool(state, name) {
    if (!name) return;
    delete state.selectedTools[name];
    renderChips(state);
    refreshRecentDropdown(state);
    renderReview(state);
  }

  function humanize(value) {
    var parts = String(value || '').split('_').join(' ').split('-').join(' ').split(' ');
    var words = [];
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      words.push(parts[i].charAt(0).toUpperCase() + parts[i].slice(1));
    }
    return words.join(' ');
  }

  function contextProvidersFor(agent) {
    if (!agent) return [];
    if (Array.isArray(agent.context_providers)) return agent.context_providers;
    if (Array.isArray(agent.contextProviders)) return agent.contextProviders;
    return [];
  }

  function templateNeedsWorkspace(agent) {
    var providers = contextProvidersFor(agent);
    for (var i = 0; i < providers.length; i++) {
      if (providers[i] && providers[i].scope === 'matter') return true;
    }
    return false;
  }

  function contextProviderLabel(provider) {
    var slug = typeof provider === 'string' ? provider : (provider && (provider.name || provider.slug || provider.type || ''));
    var labels = {
      core: 'Workspace overview',
      tasks: 'Tasks and deadlines',
      contacts: 'People and contacts',
      'linked-matters': 'Linked workspaces',
      'custom-fields': 'Business fields',
      connector: 'Connected systems',
      connectors: 'Connected systems',
      workflow: 'Automations and workflow',
      insights: 'Insights data',
      analytics: 'Analytics',
      'recording-transcript': 'Recording transcript'
    };
    return labels[slug] || humanize(slug || 'Task briefing');
  }

  function renderBuilderContext(state) {
    var holder = el('agentBuilderContextList');
    if (!holder) return;
    var providers = contextProvidersFor(state.selectedTpl);
    if (!providers.length) {
      holder.innerHTML = '<span class="agent-builder-context-item"><span class="agent-builder-context-icon">→</span><span><strong>Task briefing</strong><small>Uses the instructions you provide with each run</small></span></span>';
      setText('agentBuilderContextNote', 'This agent does not pre-load workspace data. It works from the task and capabilities you provide.');
      return;
    }
    var html = '';
    for (var i = 0; i < providers.length; i++) {
      var provider = providers[i] || {};
      var scope = provider.scope === 'matter' ? 'Selected workspace' : 'Your organization';
      html += '<span class="agent-builder-context-item"><span class="agent-builder-context-icon">' + (provider.scope === 'matter' ? 'W' : 'L') + '</span><span><strong>' + escHtml(contextProviderLabel(provider)) + '</strong><small>' + escHtml(scope) + '</small></span></span>';
    }
    holder.innerHTML = html;
    setText('agentBuilderContextNote', templateNeedsWorkspace(state.selectedTpl)
      ? 'When you run this agent, choose a workspace so LANA loads only the relevant context.'
      : 'LANA assembles this organization context for each run.');
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

  function applyWorkspaceOptions(state) {
    var select = el('agentCreateFirstTaskMatter');
    if (!select) return;
    select.options = workspaceOptions(state.workspaces);
    if (state.pendingPilotMatterId) {
      select.value = state.pendingPilotMatterId;
      state.pendingPilotMatterId = '';
    }
  }

  function configurePilotWorkspace(state) {
    var field = el('agentCreatePilotWorkspaceField');
    if (templateNeedsWorkspace(state.selectedTpl)) show(field); else hide(field);
    applyWorkspaceOptions(state);
  }

  function computeFallbackRecentTools(state) {
    var bag = {};
    for (var i = 0; i < state.templates.length; i++) {
      var tools = state.templates[i].allowed_tools || [];
      for (var j = 0; j < tools.length; j++) {
        var name = toolName(tools[j]);
        if (name) bag[name] = true;
      }
    }
    var names = Object.keys(bag).sort();
    return names.length > 10 ? names.slice(0, 10) : names;
  }

  function applyTemplateDefaults(state, template, preserveIdentity) {
    state.selectedTpl = template || null;
    if (!template) return;
    if (!preserveIdentity) {
      setVal('agentCreateName', template.name || template.slug || '');
      setVal('agentCreateDescription', template.description || '');
    }
    state.selectedTools = {};
    var tools = template.allowed_tools || [];
    for (var i = 0; i < tools.length; i++) {
      var name = toolName(tools[i]);
      if (name) state.selectedTools[name] = true;
    }
    renderTemplateGrid(state);
    renderChips(state);
    refreshRecentDropdown(state);
    renderIdentityPreview(state);
    renderBuilderContext(state);
    configurePilotWorkspace(state);
    updateContinueState(state);
    renderReview(state);
  }

  function renderIdentityPreview(state) {
    var holder = el('agentBuilderIdentityPreview');
    if (!holder) return;
    var name = String((el('agentCreateName') && el('agentCreateName').value) || '').trim();
    var description = String((el('agentCreateDescription') && el('agentCreateDescription').value) || '').trim();
    var foundation = state.selectedTpl ? (state.selectedTpl.name || humanize(state.selectedTpl.slug)) : 'LANA starting point';
    holder.innerHTML = '<span class="agent-builder-identity-mark">' + escHtml((name || 'A').charAt(0).toUpperCase()) + '</span>'
      + '<div><span>How it will appear in your workspace</span><strong>' + escHtml(name || 'Your agent name') + '</strong><p>' + escHtml(description || 'Its outcome will appear here as you write.') + '</p></div>'
      + '<small>Built on ' + escHtml(foundation) + '</small>';
  }

  function updateContinueState(state) {
    var button = el('agentBuilderNextBtn');
    if (!button) return;
    var disabled = false;
    if (state.currentStep === 1) {
      disabled = state.path === 'import' ? !state.imported : !state.selectedTpl;
    } else if (state.currentStep === 2) {
      var name = String((el('agentCreateName') && el('agentCreateName').value) || '').trim();
      var description = String((el('agentCreateDescription') && el('agentCreateDescription').value) || '').trim();
      disabled = !name || !description;
    }
    button.disabled = disabled;
  }

  function templateIsInstalled(state, template) {
    for (var i = 0; i < state.allAgents.length; i++) {
      var agent = state.allAgents[i];
      if (getKind(agent) !== 'custom') continue;
      if (agent.template_slug === template.slug || agent.slug === template.slug) return agent;
    }
    return null;
  }

  function renderTemplateGrid(state) {
    var grid = el('agentBuilderTemplateGrid');
    if (!grid) return;
    hide(el('agentBuilderTemplateLoading'));
    if (!state.templates.length) {
      grid.innerHTML = '<div class="agent-builder-no-templates"><strong>No starting points are available.</strong><span>Ask an administrator to enable the LANA Agents app and seed its templates.</span></div>';
      return;
    }
    var html = '';
    for (var i = 0; i < state.templates.length; i++) {
      var template = state.templates[i];
      var slug = escHtml(template.slug || '');
      var name = escHtml(template.name || humanize(template.slug));
      var description = escHtml(template.description || 'A guided LANA agent starting point.');
      var toolCount = (template.allowed_tools || []).length;
      var selected = state.selectedTpl && state.selectedTpl.slug === template.slug;
      var installed = templateIsInstalled(state, template);
      html += '<button type="button" class="agent-builder-template-card' + (selected ? ' selected' : '') + '" data-template-slug="' + slug + '" aria-pressed="' + (selected ? 'true' : 'false') + '">'
        + '<span class="agent-builder-template-top"><span class="agent-builder-template-mark">' + escHtml((template.name || template.slug || 'A').charAt(0).toUpperCase()) + '</span>'
        + '<span class="agent-builder-template-choice">' + (selected ? 'Selected' : (installed ? 'In your workspace' : 'Choose')) + '</span></span>'
        + '<strong>' + name + '</strong><span class="agent-builder-template-description">' + description + '</span>'
        + '<span class="agent-builder-template-meta">' + toolCount + ' built-in capabilit' + (toolCount === 1 ? 'y' : 'ies') + '</span></button>';
    }
    grid.innerHTML = html;
  }

  function selectTemplateBySlug(state, slug, preserveIdentity) {
    for (var i = 0; i < state.templates.length; i++) {
      if (state.templates[i].slug === slug) {
        applyTemplateDefaults(state, state.templates[i], preserveIdentity);
        return state.templates[i];
      }
    }
    return null;
  }

  function renderStepList(state) {
    var list = el('agentBuilderStepList');
    if (!list) return;
    var html = '';
    for (var i = 0; i < STEP_META.length; i++) {
      var step = STEP_META[i];
      var active = step.number === state.currentStep;
      var complete = step.number < state.currentStep;
      var available = step.number <= state.furthestStep;
      html += '<li><button type="button" class="agent-builder-step' + (active ? ' active' : '') + (complete ? ' complete' : '') + '" data-step="' + step.number + '"' + (available ? '' : ' disabled') + '>'
        + '<span class="agent-builder-step-number">' + (complete ? '✓' : step.number) + '</span>'
        + '<span><strong>' + escHtml(step.label) + '</strong><small>' + escHtml(step.hint) + '</small></span></button></li>';
    }
    list.innerHTML = html;
  }

  function updateStep(state, nextStep) {
    var step = Math.max(1, Math.min(4, Number(nextStep) || 1));
    state.currentStep = step;
    if (step > state.furthestStep) state.furthestStep = step;
    for (var i = 1; i <= 4; i++) {
      var panel = el('agentBuilderStep' + i);
      if (i === step) show(panel); else hide(panel);
    }
    renderStepList(state);
    if (step > 1) show(el('agentBuilderBackBtn')); else hide(el('agentBuilderBackBtn'));
    if (step === 4) {
      hide(el('agentBuilderNextBtn'));
      show(el('agentCreateSaveBtn'));
      configurePilotWorkspace(state);
      renderReview(state);
    } else {
      show(el('agentBuilderNextBtn'));
      hide(el('agentCreateSaveBtn'));
    }
    updateContinueState(state);
    var workspace = document.querySelector('.agent-builder-workspace');
    if (workspace && typeof workspace.scrollIntoView === 'function') workspace.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function setPath(state, path) {
    state.path = path === 'import' ? 'import' : 'template';
    var templateButton = el('agentBuilderTemplatePath');
    var importButton = el('agentBuilderImportPath');
    if (templateButton) templateButton.classList.toggle('active', state.path === 'template');
    if (importButton) importButton.classList.toggle('active', state.path === 'import');
    if (state.path === 'template') {
      show(el('agentBuilderTemplateArea'));
      hide(el('agentBuilderImportArea'));
    } else {
      hide(el('agentBuilderTemplateArea'));
      show(el('agentBuilderImportArea'));
    }
    updateContinueState(state);
  }

  function validateCurrentStep(state) {
    if (state.currentStep === 1 && (state.path === 'import' ? !state.imported : !state.selectedTpl)) {
      notifyError(state.path === 'import' ? 'Choose a Claude agent file so LANA can map it.' : 'Choose a starting point first.');
      return false;
    }
    if (state.currentStep === 2) {
      var name = (el('agentCreateName') && el('agentCreateName').value) || '';
      var description = (el('agentCreateDescription') && el('agentCreateDescription').value) || '';
      if (!String(name).trim()) {
        notifyError('Give your agent a short, recognizable name.');
        return false;
      }
      if (!String(description).trim()) {
        notifyError('Describe the outcome this agent should create.');
        return false;
      }
    }
    return true;
  }

  function notifyError(message) {
    if (window.Lex && window.Lex.Toast) window.Lex.Toast.error(message);
  }

  function trimMarkdownLine(line) {
    var value = String(line || '').trim();
    while (value.charAt(0) === '#' || value.charAt(0) === '>' || value.charAt(0) === '*' || value.charAt(0) === '-' || value.charAt(0) === '+') {
      value = value.slice(1).trim();
    }
    value = value.split('**').join('').split('__').join('').split('`').join('');
    return value.trim();
  }

  function baseName(filename) {
    var name = String(filename || '').split('\\').join('/');
    var slash = name.lastIndexOf('/');
    if (slash !== -1) name = name.slice(slash + 1);
    var dot = name.lastIndexOf('.');
    if (dot > 0) name = name.slice(0, dot);
    if (!name || name.toLowerCase() === 'claude') return 'Imported agent';
    return humanize(name);
  }

  function firstUsefulParagraph(lines) {
    var parts = [];
    var inFence = false;
    var inFrontmatter = false;
    for (var i = 0; i < lines.length; i++) {
      var raw = String(lines[i] || '').trim();
      if (i === 0 && raw === '---') { inFrontmatter = true; continue; }
      if (inFrontmatter) { if (raw === '---') inFrontmatter = false; continue; }
      if (raw.indexOf('```') === 0) { inFence = !inFence; continue; }
      if (inFence || !raw) {
        if (parts.length) break;
        continue;
      }
      if (raw.charAt(0) === '#') continue;
      var clean = trimMarkdownLine(raw);
      if (!clean || clean.indexOf(':') === clean.length - 1) continue;
      parts.push(clean);
      if (parts.join(' ').length >= 220) break;
    }
    var result = parts.join(' ');
    return result.length > 420 ? result.slice(0, 417) + '...' : result;
  }

  function readJsonImport(parsed, fallbackName) {
    var instructions = parsed.instructions || parsed.system_prompt || parsed.systemPrompt || parsed.prompt || parsed.description || '';
    var requestedTools = [];
    var tools = parsed.tools || parsed.allowed_tools || parsed.allowedTools || [];
    if (Array.isArray(tools)) {
      for (var i = 0; i < tools.length; i++) {
        var name = toolName(tools[i]);
        if (name) requestedTools.push(name);
      }
    }
    var servers = parsed.mcpServers || parsed.mcp_servers || {};
    if (servers && typeof servers === 'object' && !Array.isArray(servers)) {
      var serverNames = Object.keys(servers);
      for (var j = 0; j < serverNames.length; j++) requestedTools.push(serverNames[j]);
    }
    return {
      name: String(parsed.name || parsed.title || fallbackName || 'Imported agent'),
      description: String(parsed.description || instructions || '').trim().slice(0, 500),
      instructions: String(instructions || ''),
      requestedTools: requestedTools,
      sourceKind: 'Claude JSON'
    };
  }

  function parseClaudeSource(text, filename) {
    var source = String(text || '').split('\r').join('').trim();
    var fallbackName = baseName(filename);
    if (!source) return { name: fallbackName, description: '', instructions: '', requestedTools: [], sourceKind: 'Claude file' };
    if (source.charAt(0) === '{') {
      try { return readJsonImport(JSON.parse(source), fallbackName); } catch (_err) { /* continue as markdown */ }
    }
    var lines = source.split('\n');
    var title = '';
    for (var i = 0; i < lines.length; i++) {
      var line = String(lines[i] || '').trim();
      if (line.charAt(0) === '#') { title = trimMarkdownLine(line); break; }
    }
    return {
      name: title || fallbackName,
      description: firstUsefulParagraph(lines),
      instructions: source,
      requestedTools: [],
      sourceKind: 'Claude Markdown'
    };
  }

  function tokenize(value) {
    var source = String(value || '').toLowerCase();
    var words = [];
    var current = '';
    for (var i = 0; i < source.length; i++) {
      var code = source.charCodeAt(i);
      var isNumber = code >= 48 && code <= 57;
      var isLetter = code >= 97 && code <= 122;
      if (isNumber || isLetter) current += source.charAt(i);
      else if (current) { words.push(current); current = ''; }
    }
    if (current) words.push(current);
    return words;
  }

  function uniqueMeaningfulTokens(value) {
    var stop = { this: true, that: true, with: true, from: true, your: true, into: true, agent: true, should: true, will: true, have: true, when: true, then: true, using: true, about: true };
    var tokens = tokenize(value);
    var bag = {};
    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i].length > 3 && !stop[tokens[i]]) bag[tokens[i]] = true;
    }
    return bag;
  }

  function allTemplateToolNames(templates) {
    var bag = {};
    for (var i = 0; i < templates.length; i++) {
      var tools = templates[i].allowed_tools || [];
      for (var j = 0; j < tools.length; j++) {
        var name = toolName(tools[j]);
        if (name) bag[name] = true;
      }
    }
    return Object.keys(bag);
  }

  function mapClaudeImport(imported, templates) {
    var haystack = [imported.name, imported.description, imported.instructions, (imported.requestedTools || []).join(' ')].join(' ').toLowerCase();
    var sourceTokens = uniqueMeaningfulTokens(haystack);
    var explicit = {};
    var requested = imported.requestedTools || [];
    for (var i = 0; i < requested.length; i++) explicit[String(requested[i]).toLowerCase()] = true;

    var knownTools = allTemplateToolNames(templates);
    var matchedTools = [];
    for (var k = 0; k < knownTools.length; k++) {
      var tool = knownTools[k];
      var lowerTool = tool.toLowerCase();
      var spacedTool = lowerTool.split('_').join(' ').split('-').join(' ');
      if (explicit[lowerTool] || haystack.indexOf(lowerTool) !== -1 || haystack.indexOf(spacedTool) !== -1) matchedTools.push(tool);
    }

    var best = null;
    var bestScore = -1;
    for (var j = 0; j < templates.length; j++) {
      var template = templates[j];
      var templateText = [template.slug, template.name, template.description, (template.allowed_tools || []).map(toolName).join(' ')].join(' ');
      var templateTokens = uniqueMeaningfulTokens(templateText);
      var score = 0;
      var keys = Object.keys(templateTokens);
      for (var n = 0; n < keys.length; n++) if (sourceTokens[keys[n]]) score += 1;
      var allowed = (template.allowed_tools || []).map(toolName);
      for (var m = 0; m < matchedTools.length; m++) if (allowed.indexOf(matchedTools[m]) !== -1) score += 4;
      if (score > bestScore) { best = template; bestScore = score; }
    }
    if (!best && templates.length) best = templates[0];
    var allowedTools = best ? (best.allowed_tools || []).map(toolName) : [];
    var mappedTools = [];
    for (var p = 0; p < matchedTools.length; p++) if (allowedTools.indexOf(matchedTools[p]) !== -1) mappedTools.push(matchedTools[p]);
    if (!mappedTools.length && best) mappedTools = allowedTools.slice();
    return { template: best, score: bestScore, mappedTools: mappedTools };
  }

  function recommendTemplateForGoal(goal, templates) {
    var description = String(goal || '').trim();
    if (!description || !Array.isArray(templates) || !templates.length) return null;
    var mapping = mapClaudeImport({
      name: '',
      description: description,
      instructions: description,
      requestedTools: []
    }, templates);
    return mapping && mapping.template ? mapping : null;
  }

  function showGoalRecommendation(state) {
    var input = el('agentBuilderGoalInput');
    var result = el('agentBuilderGoalResult');
    var goal = String((input && input.value) || '').trim();
    if (!goal) {
      notifyError('Describe the repeat work you want handled first.');
      return;
    }
    var mapping = recommendTemplateForGoal(goal, state.templates);
    if (!mapping || !mapping.template) {
      notifyError('Starting points are still loading. Try again in a moment.');
      return;
    }
    applyTemplateDefaults(state, mapping.template, false);
    setVal('agentCreateDescription', goal);
    renderIdentityPreview(state);
    renderReview(state);
    updateContinueState(state);
    if (result) {
      result.innerHTML = '<span class="agent-builder-goal-result-mark">✓</span><div><span>Closest starting point</span><strong>' + escHtml(mapping.template.name || humanize(mapping.template.slug)) + '</strong><p>Selected from your description. Review the match below or choose a different one.</p></div>';
      show(result);
    }
    var selected = document.querySelector('.agent-builder-template-card.selected');
    if (selected && typeof selected.scrollIntoView === 'function') selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function renderImportResult(state, imported, mapping, filename) {
    var holder = el('agentBuilderImportResult');
    if (!holder) return;
    var templateName = mapping.template ? (mapping.template.name || humanize(mapping.template.slug)) : 'No matching template';
    holder.innerHTML = '<div class="agent-builder-import-result-head"><span class="agent-builder-import-success">✓</span><div><strong>' + escHtml(filename || imported.sourceKind) + '</strong><span>Ready to review in LANA</span></div></div>'
      + '<div class="agent-builder-import-map">'
      + '<div><span>Name</span><strong>' + escHtml(imported.name || 'Imported agent') + '</strong></div>'
      + '<div><span>Closest LANA starting point</span><strong>' + escHtml(templateName) + '</strong></div>'
      + '<div><span>Capabilities mapped</span><strong>' + escHtml(String(mapping.mappedTools.length)) + '</strong></div>'
      + '</div><p><strong>What transfers:</strong> the agent name, purpose, and matching capability intent. LANA uses its governed runtime instructions so permissions and approvals stay enforceable.</p>';
    show(holder);
  }

  function handleImportText(state, text, filename) {
    if (!state.templates.length) {
      notifyError('Starting points are still loading. Try the file again in a moment.');
      return;
    }
    var imported = parseClaudeSource(text, filename);
    var mapping = mapClaudeImport(imported, state.templates);
    if (!mapping.template) {
      notifyError('LANA could not find a governed starting point for this file.');
      return;
    }
    state.imported = {
      sourceName: filename || imported.sourceKind,
      sourceKind: imported.sourceKind,
      templateSlug: mapping.template.slug,
      mappedTools: mapping.mappedTools.slice(),
      name: imported.name,
      description: imported.description
    };
    applyTemplateDefaults(state, mapping.template, true);
    setVal('agentCreateName', imported.name || mapping.template.name || 'Imported agent');
    setVal('agentCreateDescription', imported.description || mapping.template.description || '');
    state.selectedTools = {};
    for (var i = 0; i < mapping.mappedTools.length; i++) state.selectedTools[mapping.mappedTools[i]] = true;
    renderChips(state);
    refreshRecentDropdown(state);
    renderImportResult(state, imported, mapping, filename);
    updateContinueState(state);
    renderReview(state);
  }

  function handleImportFile(state, file) {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      notifyError('Choose a file smaller than 1 MB.');
      return;
    }
    if (typeof file.text !== 'function') {
      notifyError('This file cannot be read in the current app version.');
      return;
    }
    file.text().then(function (text) {
      if (!state.destroyed) handleImportText(state, text, file.name);
    }).catch(function () {
      if (!state.destroyed) notifyError('LANA could not read that file.');
    });
  }

  function runModeToSchedule(mode, timezone, customCron) {
    var cron = '';
    if (mode === 'weekday_morning') cron = '0 9 * * 1-5';
    if (mode === 'daily_morning') cron = '0 9 * * *';
    if (mode === 'weekly_monday') cron = '0 9 * * 1';
    if (mode === 'advanced') cron = String(customCron || '').trim();
    if (!cron) return null;
    return { enabled: true, cron: cron, timezone: timezone || 'UTC' };
  }

  function scheduleLabel(mode) {
    if (mode === 'weekday_morning') return 'Weekday mornings at 9:00';
    if (mode === 'daily_morning') return 'Every morning at 9:00';
    if (mode === 'weekly_monday') return 'Mondays at 9:00';
    if (mode === 'advanced') return 'Custom schedule';
    return 'On demand';
  }

  function captureFormSnapshot(state) {
    var runModeEl = el('agentCreateRunMode');
    var runMode = (runModeEl && runModeEl.value) || 'on_demand';
    var timezone = (el('agentCreateScheduleTimezone') && el('agentCreateScheduleTimezone').value) || 'UTC';
    var customCron = (el('agentCreateScheduleCron') && el('agentCreateScheduleCron').value) || '';
    var schedule = runModeToSchedule(runMode, timezone, customCron);
    return {
      templateSlug: state.selectedTpl ? state.selectedTpl.slug : '',
      name: String((el('agentCreateName') && el('agentCreateName').value) || ''),
      description: String((el('agentCreateDescription') && el('agentCreateDescription').value) || ''),
      modelSlot: '',
      runMode: runMode,
      scheduleEnabled: !!schedule,
      scheduleCron: schedule ? schedule.cron : '',
      scheduleTimezone: schedule ? schedule.timezone : timezone,
      discoverable: !!(el('agentCreateDiscoverable') && el('agentCreateDiscoverable').checked),
      selectedTools: selectedToolList(state),
      currentStep: state.currentStep,
      path: state.path,
      imported: state.imported,
      goal: String((el('agentBuilderGoalInput') && el('agentBuilderGoalInput').value) || ''),
      firstTask: String((el('agentCreateFirstTask') && el('agentCreateFirstTask').value) || ''),
      firstTaskMatterId: String((el('agentCreateFirstTaskMatter') && el('agentCreateFirstTaskMatter').value) || '')
    };
  }

  function restoreFromSnapshot(state, snapshot) {
    if (!snapshot) return;
    if (snapshot.templateSlug) selectTemplateBySlug(state, snapshot.templateSlug, true);
    if (snapshot.name) setVal('agentCreateName', snapshot.name);
    if (snapshot.description) setVal('agentCreateDescription', snapshot.description);
    var mode = snapshot.runMode || (snapshot.scheduleEnabled ? 'advanced' : 'on_demand');
    setVal('agentCreateRunMode', mode);
    if (mode !== 'on_demand') setVal('agentCreateSchedulePreset', mode);
    setVal('agentCreateScheduleTimezone', snapshot.scheduleTimezone || 'UTC');
    setVal('agentCreateScheduleCron', snapshot.scheduleCron || '');
    setChecked('agentCreateDiscoverable', !!snapshot.discoverable);
    if (snapshot.goal) setVal('agentBuilderGoalInput', snapshot.goal);
    if (snapshot.firstTask) setVal('agentCreateFirstTask', snapshot.firstTask);
    if (snapshot.firstTaskMatterId) {
      state.pendingPilotMatterId = snapshot.firstTaskMatterId;
      setVal('agentCreateFirstTaskMatter', snapshot.firstTaskMatterId);
    }
    updateScheduleFields(mode);
    state.selectedTools = {};
    if (Array.isArray(snapshot.selectedTools)) {
      for (var i = 0; i < snapshot.selectedTools.length; i++) if (snapshot.selectedTools[i]) state.selectedTools[snapshot.selectedTools[i]] = true;
    }
    state.imported = snapshot.imported || null;
    setPath(state, snapshot.path || state.path);
    renderChips(state);
    refreshRecentDropdown(state);
    renderIdentityPreview(state);
    renderBuilderContext(state);
    configurePilotWorkspace(state);
    if (state.imported && state.selectedTpl) {
      renderImportResult(state, {
        name: state.imported.name || snapshot.name,
        description: state.imported.description || snapshot.description,
        sourceKind: state.imported.sourceKind || 'Claude file'
      }, {
        template: state.selectedTpl,
        mappedTools: Array.isArray(state.imported.mappedTools) ? state.imported.mappedTools : selectedToolList(state)
      }, state.imported.sourceName || state.imported.sourceKind);
    }
    state.furthestStep = Math.max(1, Number(snapshot.currentStep) || 1);
    updateStep(state, state.furthestStep);
  }

  function buildCreateBody(state, formValues) {
    if (!state.selectedTpl) return null;
    var tools = formValues.selectedTools || [];
    var body = {
      template_slug: state.selectedTpl.slug,
      name: String(formValues.name || '').trim() || state.selectedTpl.name || state.selectedTpl.slug,
      description: String(formValues.description || '').trim(),
      allowed_tools: tools.slice(),
      discoverable: !!formValues.discoverable
    };
    if (formValues.modelSlot) body.model_slot = formValues.modelSlot;
    if (formValues.scheduleEnabled) {
      body.schedule = { enabled: true, cron: String(formValues.scheduleCron || '').trim(), timezone: formValues.scheduleTimezone || 'UTC' };
    }
    return body;
  }

  function formatMissingConnectorsMessage(missing) {
    if (!Array.isArray(missing) || !missing.length) return 'This starting point requires a connection that is not yet connected.';
    return 'Connect ' + missing.join(', ') + ' before deploying this agent.';
  }

  function renderReview(state) {
    var holder = el('agentBuilderReview');
    if (!holder || !state.selectedTpl) return;
    var snapshot = captureFormSnapshot(state);
    var name = snapshot.name.trim() || state.selectedTpl.name || 'Your agent';
    var source = state.imported ? 'Mapped from ' + state.imported.sourceKind : 'LANA starting point';
    var visibility = snapshot.discoverable ? 'Findable in LANA chat' : 'Only from Agent Studio';
    var purpose = snapshot.description.trim() || 'Add a clear outcome before deploying.';
    var contextCount = contextProvidersFor(state.selectedTpl).length;
    holder.innerHTML = '<div class="agent-builder-review-head"><span class="agent-builder-review-mark">' + escHtml(name.charAt(0).toUpperCase()) + '</span><div><span>Ready to deploy</span><strong>' + escHtml(name) + '</strong></div></div>'
      + '<p class="agent-builder-review-purpose">' + escHtml(purpose) + '</p>'
      + '<div class="agent-builder-review-grid">'
      + '<div><span>Foundation</span><strong>' + escHtml(state.selectedTpl.name || humanize(state.selectedTpl.slug)) + '</strong><small>' + escHtml(source) + '</small></div>'
      + '<div><span>Access</span><strong>' + snapshot.selectedTools.length + ' capabilit' + (snapshot.selectedTools.length === 1 ? 'y' : 'ies') + '</strong><small>' + contextCount + ' context source' + (contextCount === 1 ? '' : 's') + ' · approvals stay active</small></div>'
      + '<div><span>Runs</span><strong>' + escHtml(snapshot.firstTask && snapshot.firstTask.trim() ? 'First task starts on deploy' : scheduleLabel(snapshot.runMode)) + '</strong><small>' + escHtml(snapshot.firstTask && snapshot.firstTask.trim() ? scheduleLabel(snapshot.runMode) : (snapshot.scheduleTimezone || 'UTC')) + '</small></div>'
      + '<div><span>Team access</span><strong>' + escHtml(visibility) + '</strong><small>You can change this later</small></div>'
      + '</div>';
  }

  function showDeploySuccess(state, slug) {
    state.deployedSlug = slug;
    state.currentStep = 5;
    state.furthestStep = 4;
    for (var i = 1; i <= 4; i++) hide(el('agentBuilderStep' + i));
    renderStepList(state);
    hide(el('agentCreateStickyBar'));
    var name = String((el('agentCreateName') && el('agentCreateName').value) || '').trim() || 'Your agent';
    var snapshot = captureFormSnapshot(state);
    setText('agentBuilderSuccessTitle', name + ' is ready.');
    var receipt = el('agentBuilderSuccessReceipt');
    if (receipt) {
      receipt.innerHTML = '<div><span>Status</span><strong>Deployed</strong><small>Ready for work</small></div>'
        + '<div><span>Starts</span><strong>' + escHtml(scheduleLabel(snapshot.runMode)) + '</strong><small>' + escHtml(snapshot.runMode === 'on_demand' ? 'You decide when' : (snapshot.scheduleTimezone || 'UTC')) + '</small></div>'
        + '<div><span>Outcomes</span><strong>Recorded in one place</strong><small>Runs, approvals, and deliverables</small></div>';
    }
    show(el('agentBuilderSuccess'));
    var successPanel = el('agentBuilderSuccess');
    if (successPanel && typeof successPanel.scrollIntoView === 'function') successPanel.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function submitCreate(ctx, state) {
    var snapshot = captureFormSnapshot(state);
    var body = buildCreateBody(state, snapshot);
    if (!body) { notifyError('Choose a starting point first.'); updateStep(state, 1); return; }
    if (!body.name || !body.description) { notifyError('Add a name and a clear outcome before deploying.'); updateStep(state, 2); return; }
    if (snapshot.runMode === 'advanced' && (!body.schedule || !body.schedule.cron)) { notifyError('Enter a custom schedule or choose on demand.'); return; }
    if (snapshot.firstTask && snapshot.firstTask.trim() && templateNeedsWorkspace(state.selectedTpl) && !snapshot.firstTaskMatterId) {
      notifyError('Choose the workspace for this pilot task.');
      return;
    }
    if (!window.api || typeof window.api.post !== 'function') return;

    var saveButton = el('agentCreateSaveBtn');
    if (saveButton) saveButton.loading = true;
    window.api.post('/api/v1/agents', body).then(function (response) {
      if (state.destroyed) return;
      clearPending(ctx.app);
      var agent = (response && response.agent) || (response && response.data) || response || {};
      var slug = agent.slug || body.template_slug;
      if (snapshot.firstTask && snapshot.firstTask.trim()) {
        return startFirstRun(ctx, state, slug, snapshot.firstTask.trim(), snapshot.firstTaskMatterId);
      }
      if (window.Lex && window.Lex.Toast) window.Lex.Toast.success('Agent deployed and ready to run');
      if (saveButton) saveButton.loading = false;
      showDeploySuccess(state, slug);
    }).catch(function (err) {
      if (state.destroyed) return;
      if (saveButton) saveButton.loading = false;
      var status = err && (err.status || (err.response && err.response.status));
      var responseBody = err && (err.body || (err.response && err.response.data) || err.data);
      var nested = responseBody && responseBody.error;
      var message = 'LANA could not deploy this agent. Try again.';
      if (status === 422 && nested && nested.code === 'MISSING_REQUIRED_CONNECTORS') message = formatMissingConnectorsMessage(nested.missing);
      else if (status === 400) message = 'Review the agent name, capabilities, and schedule.';
      else if (status === 401) message = 'Your session expired. Sign in again.';
      else if (status === 403) message = 'You do not have permission to deploy agents.';
      else if (status === 404) message = 'Agent deployment is not available on this server.';
      else if (status === 409) message = 'This starting point is already in your workspace. Open that agent to configure it.';
      notifyError(message);
      if (status === 401 && window.Lex && window.Lex.Nav) window.Lex.Nav.go('login.html');
    });
  }

  function buildFirstRunBody(task, matterId) {
    var input = String(task || '').trim();
    var body = {
      input: { goal: input },
      title: input.slice(0, 100),
      scope: matterId ? 'workspace' : 'system'
    };
    if (matterId) body.matter_id = matterId;
    return body;
  }

  function startFirstRun(ctx, state, slug, task, matterId) {
    return window.api.post('/api/v1/agents/' + encodeURIComponent(slug) + '/runs', buildFirstRunBody(task, matterId)).then(function (response) {
      if (state.destroyed) return;
      var runId = (response && response.run && response.run.id)
        || (response && response.data && response.data.id)
        || (response && response.id)
        || (response && response.run_id);
      if (window.Lex && window.Lex.Toast) window.Lex.Toast.success('Agent deployed and first run started');
      if (runId) ctx.app.setView('agentRun', { runId: runId });
      else ctx.app.setView('agentDetail', { slug: slug });
    }).catch(function () {
      if (state.destroyed) return;
      if (window.Lex && window.Lex.Toast) window.Lex.Toast.warning('Agent deployed, but its first run did not start. You can run it from the agent page.');
      ctx.app.setView('agentDetail', { slug: slug });
    });
  }

  function updateScheduleFields(mode) {
    var selectedMode = mode || 'on_demand';
    setVal('agentCreateRunMode', selectedMode);
    var fields = el('agentCreateScheduleFields');
    var cron = el('agentCreateScheduleCron');
    var buttons = document.querySelectorAll('[data-run-choice]');
    for (var i = 0; i < buttons.length; i++) {
      var buttonMode = buttons[i].getAttribute('data-run-choice');
      var active = selectedMode === 'on_demand' ? buttonMode === 'on_demand' : buttonMode !== 'on_demand';
      buttons[i].classList.toggle('active', active);
      buttons[i].setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    if (selectedMode === 'on_demand') hide(fields); else show(fields);
    if (selectedMode === 'advanced') show(cron); else hide(cron);
  }

  function loadWorkspaces(state) {
    if (state.workspacesLoaded || !window.api || typeof window.api.getMatters !== 'function') return;
    state.workspacesLoaded = true;
    window.api.getMatters(1, 100, { status: 'active', sort_by: 'updated_at', sort_order: 'desc' }).then(function (response) {
      if (state.destroyed) return;
      var matters = Array.isArray(response) ? response : ((response && (response.matters || response.data)) || []);
      state.workspaces = Array.isArray(matters) ? matters : [];
      applyWorkspaceOptions(state);
      if (!state.workspaces.length) setText('agentCreatePilotWorkspaceHint', 'No active workspaces are available. Create or activate one before starting this pilot run.');
    }).catch(function () {
      if (state.destroyed) return;
      state.workspaces = [];
      applyWorkspaceOptions(state);
      setText('agentCreatePilotWorkspaceHint', 'Workspaces could not be loaded. You can deploy quietly and start the first run later.');
    });
  }

  function loadTemplates(state) {
    if (!window.api || typeof window.api.get !== 'function') {
      var ready = function () { loadTemplates(state); };
      state._lexReadyHandler = ready;
      document.addEventListener('lex-ready', ready, { once: true });
      return;
    }
    window.api.get('/api/v1/agents').then(function (response) {
      if (state.destroyed) return;
      var agents = Array.isArray(response) ? response : ((response && (response.data || response.agents)) || []);
      state.allAgents = Array.isArray(agents) ? agents : [];
      state.templates = state.allAgents.filter(function (agent) { return getKind(agent) === 'system'; });
      state.recentTools = computeFallbackRecentTools(state);
      renderTemplateGrid(state);
      refreshRecentDropdown(state);
      loadWorkspaces(state);

      if (state.pendingSnapshot) {
        restoreFromSnapshot(state, state.pendingSnapshot);
        state.pendingSnapshot = null;
      } else if (state.requestedTemplateSlug) {
        selectTemplateBySlug(state, state.requestedTemplateSlug, false);
      }
    }).catch(function (err) {
      if (state.destroyed) return;
      console.error('[agents] Guided builder failed to load templates', err);
      hide(el('agentBuilderTemplateLoading'));
      var grid = el('agentBuilderTemplateGrid');
      if (grid) grid.innerHTML = '<div class="agent-builder-no-templates"><strong>Starting points could not be loaded.</strong><span>Check the LANA Agents service and try again.</span></div>';
    });
  }

  function bind(state, node, eventName, handler) {
    if (!node) return;
    node.addEventListener(eventName, handler);
    state._unbindFns.push(function () { node.removeEventListener(eventName, handler); });
  }

  function wire(ctx, state) {
    var runMode = el('agentCreateRunMode');
    if (runMode) runMode.value = 'on_demand';
    var schedulePreset = el('agentCreateSchedulePreset');
    if (schedulePreset) { schedulePreset.options = SCHEDULE_PRESETS.slice(); schedulePreset.value = 'weekday_morning'; }
    var timezone = el('agentCreateScheduleTimezone');
    if (timezone) { timezone.options = COMMON_TZS.slice(); timezone.value = 'UTC'; }

    bind(state, el('agentBuilderTemplatePath'), 'click', function () { setPath(state, 'template'); });
    bind(state, el('agentBuilderImportPath'), 'click', function () { setPath(state, 'import'); });
    bind(state, el('agentBuilderTemplateGrid'), 'click', function (event) {
      var card = event.target.closest('[data-template-slug]');
      if (card) {
        hide(el('agentBuilderGoalResult'));
        selectTemplateBySlug(state, card.getAttribute('data-template-slug'), false);
      }
    });
    bind(state, el('agentBuilderRecommendBtn'), 'click', function () { showGoalRecommendation(state); });
    bind(state, el('agentBuilderStepList'), 'click', function (event) {
      var button = event.target.closest('[data-step]');
      if (button && !button.disabled) updateStep(state, Number(button.getAttribute('data-step')));
    });
    bind(state, el('agentBuilderNextBtn'), 'click', function () {
      if (validateCurrentStep(state)) updateStep(state, state.currentStep + 1);
    });
    bind(state, el('agentBuilderBackBtn'), 'click', function () { updateStep(state, state.currentStep - 1); });
    bind(state, el('agentCreateCancelBtn'), 'click', function () { clearPending(ctx.app); ctx.app.setView('catalog'); });
    bind(state, el('agentCreateSaveBtn'), 'click', function () { submitCreate(ctx, state); });
    bind(state, el('agentBuilderSuccessOpenBtn'), 'click', function () {
      if (state.deployedSlug) ctx.app.setView('agentDetail', { slug: state.deployedSlug });
    });
    bind(state, el('agentBuilderSuccessWorkspaceBtn'), 'click', function () { ctx.app.setView('catalog'); });

    var fileInput = el('agentBuilderImportFile');
    bind(state, el('agentBuilderDropzone'), 'click', function () { if (fileInput) fileInput.click(); });
    bind(state, fileInput, 'change', function () { handleImportFile(state, fileInput.files && fileInput.files[0]); });
    var dropzone = el('agentBuilderDropzone');
    bind(state, dropzone, 'dragover', function (event) { event.preventDefault(); dropzone.classList.add('dragging'); });
    bind(state, dropzone, 'dragleave', function () { dropzone.classList.remove('dragging'); });
    bind(state, dropzone, 'drop', function (event) {
      event.preventDefault();
      dropzone.classList.remove('dragging');
      handleImportFile(state, event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]);
    });

    bind(state, el('agentCreateChips'), 'click', function (event) {
      var button = event.target.closest('.agent-create-chip-remove');
      if (button) removeTool(state, button.getAttribute('data-tool'));
    });
    bind(state, el('agentCreateRecentTools'), 'lex-change', function (event) {
      var value = event && event.detail && event.detail.value;
      if (value) addTool(state, value);
    });
    bind(state, el('agentCreateBrowseToolsBtn'), 'click', function () {
      var snapshot = captureFormSnapshot(state);
      snapshot.currentStep = 3;
      writePending(ctx.app, snapshot);
      ctx.app.setView('toolsBrowse', {});
    });
    bind(state, document.querySelector('.agent-builder-run-choices'), 'click', function (event) {
      var button = event.target.closest('[data-run-choice]');
      if (!button) return;
      var value = button.getAttribute('data-run-choice') || 'on_demand';
      if (value !== 'on_demand') value = (schedulePreset && schedulePreset.value) || 'weekday_morning';
      updateScheduleFields(value);
      renderReview(state);
    });
    bind(state, schedulePreset, 'lex-change', function (event) {
      var value = (event && event.detail && event.detail.value) || schedulePreset.value || 'weekday_morning';
      updateScheduleFields(value);
      renderReview(state);
    });
    bind(state, timezone, 'lex-change', function () { renderReview(state); });
    bind(state, el('agentCreateScheduleCron'), 'lex-input', function () { renderReview(state); });
    bind(state, el('agentCreateName'), 'lex-input', function () { renderIdentityPreview(state); updateContinueState(state); renderReview(state); });
    bind(state, el('agentCreateDescription'), 'lex-input', function () { renderIdentityPreview(state); updateContinueState(state); renderReview(state); });
    bind(state, el('agentCreateFirstTask'), 'lex-input', function () { renderReview(state); });
    bind(state, el('agentCreateFirstTaskMatter'), 'lex-change', function () { renderReview(state); });
    bind(state, el('agentCreateDiscoverable'), 'lex-change', function () { renderReview(state); });
  }

  function render(rootEl, ctx) {
    rootEl.innerHTML = TEMPLATE;
    var state = createState(ctx || {});
    rootEl._createState = state;
    wire(ctx, state);
    setPath(state, state.path);
    renderStepList(state);
    renderIdentityPreview(state);
    updateStep(state, 1);
    loadTemplates(state);
  }

  function destroy(rootEl) {
    var state = rootEl && rootEl._createState;
    if (!state) return;
    state.destroyed = true;
    if (state._lexReadyHandler) document.removeEventListener('lex-ready', state._lexReadyHandler);
    for (var i = 0; i < state._unbindFns.length; i++) {
      try { state._unbindFns[i](); } catch (_err) { /* ignored */ }
    }
    state._unbindFns = [];
    rootEl._createState = null;
  }

  global.LanaAgentsApp.Views.create = {
    render: render,
    destroy: destroy,
    __test: {
      buildCreateBody: buildCreateBody,
      formatMissingConnectorsMessage: formatMissingConnectorsMessage,
      computeFallbackRecentTools: computeFallbackRecentTools,
      parseClaudeSource: parseClaudeSource,
      mapClaudeImport: mapClaudeImport,
      recommendTemplateForGoal: recommendTemplateForGoal,
      contextProvidersFor: contextProvidersFor,
      templateNeedsWorkspace: templateNeedsWorkspace,
      buildFirstRunBody: buildFirstRunBody,
      runModeToSchedule: runModeToSchedule
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
