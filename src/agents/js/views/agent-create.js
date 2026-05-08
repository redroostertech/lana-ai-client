/* agent-create.js — Full-screen agent-create SPA view module.
   Replaces the legacy create modal in catalog.js. Reads templates from
   GET /api/v1/agents (filtered to system templates), renders a sectioned
   form, and POSTs to /api/v1/agents on save.

   Hash route: '#create' (registered in src/agents/app.js).
   Sidebar parent: 'create' (so the sidebar Create button stays highlighted).

   Form sections:
     1. Template picker (lex-select, searchable)
     2. Display name (lex-input, required)
     3. Description (lex-textarea)
     4. Allowed tools — chip list + "Recent tools" lex-select + Browse all tools
     5. Model slot (lex-select)
     6. Schedule (lex-toggle + cron lex-input + timezone lex-select)
     7. Discoverable toggle (lex-toggle, default off)

   Pending state across navigation to '#tools/browse' is persisted via
   window.LanaAgentsApp.state.pendingCreate (and a sessionStorage backup
   so a reload + return doesn't blow it up).

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

  // Storage key for the pending-create form snapshot when the user bounces
  // out to the tools browser. We keep this on window.LanaAgentsApp.state
  // (in-memory primary) AND mirror to sessionStorage so a hard reload
  // doesn't lose chip selections.
  var PENDING_KEY = 'lana_agents_pending_create';

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

  // ---------------------------------------------------------------------------
  // Markup template
  // ---------------------------------------------------------------------------
  var TEMPLATE = ''
    + '<main class="agent-create-page-container">'

    + '<lex-banner'
    +   ' id="agentCreateBanner"'
    +   ' variant="light"'
    +   ' heading="Create agent"'
    +   ' subtitle="Pick a template, give the agent a name, and choose what tools it can call."'
    + '></lex-banner>'

    + '<div class="agent-create-form-shell">'

    +   '<section class="agent-create-section">'
    +     '<h3 class="agent-create-section-title">Template</h3>'
    +     '<p class="agent-create-section-hint">'
    +       'Templates own the underlying prompt — those rules stay locked '
    +       'on the template.'
    +     '</p>'
    +     '<lex-select'
    +       ' id="agentCreateTemplate"'
    +       ' label="Template"'
    +       ' placeholder="Choose a template..."'
    +       ' required'
    +       ' searchable'
    +     '></lex-select>'
    +     '<div id="agentCreateTemplatePreview" class="agent-create-template-preview hidden">'
    +       '<div class="agent-create-template-preview-row">'
    +         '<span class="agent-create-template-preview-label">Slug</span>'
    +         '<span id="agentCreateTemplateSlug" class="agent-create-template-preview-value"></span>'
    +       '</div>'
    +       '<div class="agent-create-template-preview-row">'
    +         '<span class="agent-create-template-preview-label">Description</span>'
    +         '<span id="agentCreateTemplateDescription" class="agent-create-template-preview-value"></span>'
    +       '</div>'
    +     '</div>'
    +   '</section>'

    +   '<section class="agent-create-section">'
    +     '<h3 class="agent-create-section-title">Identity</h3>'
    +     '<lex-input'
    +       ' id="agentCreateName"'
    +       ' label="Display name"'
    +       ' placeholder="e.g. Contract Reviewer"'
    +       ' required'
    +     '></lex-input>'
    +     '<lex-textarea'
    +       ' id="agentCreateDescription"'
    +       ' label="Description"'
    +       ' rows="3"'
    +       ' placeholder="What this agent will do for your team..."'
    +     '></lex-textarea>'
    +   '</section>'

    +   '<section class="agent-create-section">'
    +     '<h3 class="agent-create-section-title">Allowed tools</h3>'
    +     '<p class="agent-create-section-hint">'
    +       'Pick the tools this agent may call. Use the dropdown for recent '
    +       'tools, or browse the full library.'
    +     '</p>'
    +     '<div id="agentCreateChips" class="agent-create-chips" aria-live="polite">'
    +       '<span class="agent-create-empty-text">No tools selected yet.</span>'
    +     '</div>'
    +     '<div class="agent-create-tools-controls">'
    +       '<lex-select'
    +         ' id="agentCreateRecentTools"'
    +         ' label="Recent tools"'
    +         ' placeholder="Add a recently used tool..."'
    +         ' searchable'
    +       '></lex-select>'
    +       '<lex-btn'
    +         ' id="agentCreateBrowseToolsBtn"'
    +         ' variant="secondary"'
    +         ' icon="search"'
    +       '>Browse all tools</lex-btn>'
    +     '</div>'
    +   '</section>'

    +   '<section class="agent-create-section">'
    +     '<h3 class="agent-create-section-title">Model</h3>'
    +     '<lex-select'
    +       ' id="agentCreateModelSlot"'
    +       ' label="Model slot"'
    +       ' placeholder="Choose a model slot..."'
    +     '></lex-select>'
    +   '</section>'

    +   '<section class="agent-create-section">'
    +     '<h3 class="agent-create-section-title">Schedule</h3>'
    +     '<lex-toggle'
    +       ' id="agentCreateScheduleEnabled"'
    +       ' label="Run this agent on a schedule"'
    +       ' label-side="right"'
    +     '></lex-toggle>'
    +     '<div id="agentCreateScheduleFields" class="agent-create-schedule-fields hidden">'
    +       '<lex-input'
    +         ' id="agentCreateScheduleCron"'
    +         ' label="Cron expression"'
    +         ' placeholder="0 9 * * 1-5"'
    +         ' help="Standard 5-field cron (minute hour dom month dow)"'
    +       '></lex-input>'
    +       '<lex-select'
    +         ' id="agentCreateScheduleTimezone"'
    +         ' label="Timezone"'
    +         ' placeholder="UTC"'
    +       '></lex-select>'
    +     '</div>'
    +   '</section>'

    +   '<section class="agent-create-section">'
    +     '<h3 class="agent-create-section-title">Discoverability</h3>'
    +     '<lex-toggle'
    +       ' id="agentCreateDiscoverable"'
    +       ' label="Make this agent discoverable in chat (@-mention support)"'
    +       ' label-side="right"'
    +     '></lex-toggle>'
    // NOTE: backend column for `discoverable` lands via Agent B's parallel
    // task; until the column exists, the field is ignored server-side and
    // creation still succeeds. Sending the flag now keeps the contract
    // stable for when the column does land.
    +   '</section>'

    + '</div>'

    + '<div class="agent-create-sticky-bar">'
    +   '<lex-btn id="agentCreateCancelBtn" variant="ghost">Cancel</lex-btn>'
    +   '<lex-btn id="agentCreateSaveBtn" variant="primary" icon="check">Save Agent</lex-btn>'
    + '</div>'

    + '</main>';

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function el(id) { return document.getElementById(id); }
  function show(node) { if (node) node.classList.remove('hidden'); }
  function hide(node) { if (node) node.classList.add('hidden'); }

  function setVal(id, value) {
    var n = el(id);
    if (n) n.value = (value == null ? '' : value);
  }

  function setChecked(id, checked) {
    var n = el(id);
    if (n) n.checked = !!checked;
  }

  function toolName(t) {
    if (!t) return '';
    if (typeof t === 'string') return t;
    return t.name || t.slug || '';
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

  function clearPending(app) {
    writePending(app, null);
  }

  // ---------------------------------------------------------------------------
  // Per-render state
  // ---------------------------------------------------------------------------

  function createState() {
    return {
      allAgents: [],          // raw response from GET /api/v1/agents
      templates: [],          // filtered to system templates
      selectedTpl: null,      // currently chosen template object
      // Free-form set of selected tool names (object map for O(1)
      // add/remove). Sourced from template default + tools-browser
      // selections + recent-tool dropdown picks.
      selectedTools: {},
      // Cached "recent" tools from /api/v1/tools/registry (or fallback
      // alphabetical first 10 from the union of template tools).
      recentTools: [],
      destroyed: false,
      _unbindFns: []
    };
  }

  // ---------------------------------------------------------------------------
  // Tools-section rendering
  // ---------------------------------------------------------------------------

  function selectedToolList(state) {
    var out = [];
    for (var k in state.selectedTools) {
      if (Object.prototype.hasOwnProperty.call(state.selectedTools, k) && state.selectedTools[k]) {
        out.push(k);
      }
    }
    out.sort();
    return out;
  }

  function renderChips(state) {
    var holder = el('agentCreateChips');
    if (!holder) return;
    var names = selectedToolList(state);
    if (!names.length) {
      holder.innerHTML = '<span class="agent-create-empty-text">No tools selected yet.</span>';
      return;
    }
    var html = '';
    for (var i = 0; i < names.length; i++) {
      var safe = escHtml(names[i]);
      html += '<span class="agent-create-chip">'
            + '<span class="agent-create-chip-name">' + safe + '</span>'
            + '<button type="button" class="agent-create-chip-remove" '
            + 'data-tool="' + safe + '" aria-label="Remove ' + safe + '">×</button>'
            + '</span>';
    }
    holder.innerHTML = html;
  }

  function refreshRecentDropdown(state) {
    var sel = el('agentCreateRecentTools');
    if (!sel) return;
    var options = [];
    for (var i = 0; i < state.recentTools.length; i++) {
      var name = state.recentTools[i];
      if (!name) continue;
      // Skip already-selected tools so the dropdown is "add another".
      if (state.selectedTools[name]) continue;
      options.push({ value: name, label: name });
    }
    sel.options = options;
    sel.value = '';
  }

  function addTool(state, name) {
    if (!name) return;
    state.selectedTools[name] = true;
    renderChips(state);
    refreshRecentDropdown(state);
  }

  function removeTool(state, name) {
    if (!name) return;
    delete state.selectedTools[name];
    renderChips(state);
    refreshRecentDropdown(state);
  }

  // ---------------------------------------------------------------------------
  // Template-driven defaults
  // ---------------------------------------------------------------------------

  function applyTemplateDefaults(state, tpl) {
    state.selectedTpl = tpl;
    if (!tpl) {
      hide(el('agentCreateTemplatePreview'));
      return;
    }

    // Pre-fill name + description from the template (only if the user
    // hasn't typed anything yet). The simple heuristic here: if the
    // current value is empty, fill; otherwise leave alone.
    var nameInput = el('agentCreateName');
    if (nameInput && !String(nameInput.value || '').trim()) {
      nameInput.value = tpl.name || tpl.slug || '';
    }
    var descInput = el('agentCreateDescription');
    if (descInput && !String(descInput.value || '').trim()) {
      descInput.value = tpl.description || '';
    }

    // Pre-select the template's allowed_tools as the initial chip set.
    state.selectedTools = {};
    var tools = tpl.allowed_tools || [];
    for (var i = 0; i < tools.length; i++) {
      var n = toolName(tools[i]);
      if (n) state.selectedTools[n] = true;
    }
    renderChips(state);
    refreshRecentDropdown(state);

    // Default model slot from template.
    var slotEl = el('agentCreateModelSlot');
    if (slotEl && tpl.model_slot) slotEl.value = tpl.model_slot;

    // Preview block.
    var preview = el('agentCreateTemplatePreview');
    if (preview) {
      var slugEl = el('agentCreateTemplateSlug');
      var dEl = el('agentCreateTemplateDescription');
      if (slugEl) slugEl.textContent = tpl.slug || '';
      if (dEl) dEl.textContent = tpl.description || '(no description)';
      show(preview);
    }
  }

  // ---------------------------------------------------------------------------
  // Recent-tools sourcing
  //
  // Phase 8 default: if backend exposes /api/v1/tools/registry, build a
  // recent list as the alphabetical first 10 of the union of all
  // template tools (which is the closest stand-in for "tools the org
  // touches" until usage telemetry lands).
  // ---------------------------------------------------------------------------

  function computeFallbackRecentTools(state) {
    var bag = {};
    for (var i = 0; i < state.templates.length; i++) {
      var tools = state.templates[i].allowed_tools || [];
      for (var j = 0; j < tools.length; j++) {
        var n = toolName(tools[j]);
        if (n) bag[n] = true;
      }
    }
    var names = [];
    for (var k in bag) {
      if (Object.prototype.hasOwnProperty.call(bag, k)) names.push(k);
    }
    names.sort();
    if (names.length > 10) names = names.slice(0, 10);
    return names;
  }

  // ---------------------------------------------------------------------------
  // Data load
  // ---------------------------------------------------------------------------

  function loadTemplates(state) {
    if (!window.api || typeof window.api.get !== 'function') {
      var onReady = function () { loadTemplates(state); };
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
        state.templates = agents.filter(function (a) { return getKind(a) === 'system'; });

        var tplSelect = el('agentCreateTemplate');
        if (tplSelect) {
          tplSelect.options = state.templates.map(function (t) {
            return {
              value: t.slug,
              label: t.name || t.slug,
              description: t.description || ''
            };
          });
        }

        // Compute fallback recent tools (alphabetical first 10 across
        // template tools). When the backend usage-data endpoint exists
        // it can replace this slice without changing the rest of the UI.
        state.recentTools = computeFallbackRecentTools(state);
        refreshRecentDropdown(state);
      })
      .catch(function (err) {
        if (state.destroyed) return;
        console.error('[agents] Create view: failed to load templates', err);
        if (window.Lex && window.Lex.Toast) {
          window.Lex.Toast.error('Unable to load agent templates.');
        }
      });
  }

  // ---------------------------------------------------------------------------
  // Event wiring
  // ---------------------------------------------------------------------------

  function onTemplateChange(state, evt) {
    var v = (evt && evt.detail && evt.detail.value)
            || (el('agentCreateTemplate') && el('agentCreateTemplate').value)
            || '';
    if (!v) {
      applyTemplateDefaults(state, null);
      return;
    }
    var tpl = null;
    for (var i = 0; i < state.templates.length; i++) {
      if (state.templates[i].slug === v) { tpl = state.templates[i]; break; }
    }
    applyTemplateDefaults(state, tpl);
  }

  function onScheduleEnabledChange(evt) {
    var checked = !!(evt && evt.detail && evt.detail.value);
    var fields = el('agentCreateScheduleFields');
    if (!fields) return;
    if (checked) show(fields); else hide(fields);
  }

  function onChipsClick(state, evt) {
    var btn = evt.target.closest('.agent-create-chip-remove');
    if (!btn) return;
    evt.preventDefault();
    var name = btn.getAttribute('data-tool');
    removeTool(state, name);
  }

  function onRecentToolPick(state, evt) {
    var v = (evt && evt.detail && evt.detail.value) || '';
    if (!v) return;
    addTool(state, v);
  }

  function captureFormSnapshot(state) {
    var name = (el('agentCreateName') && el('agentCreateName').value) || '';
    var description = (el('agentCreateDescription') && el('agentCreateDescription').value) || '';
    var modelSlot = (el('agentCreateModelSlot') && el('agentCreateModelSlot').value) || '';
    var schedEnabled = !!(el('agentCreateScheduleEnabled') && el('agentCreateScheduleEnabled').checked);
    var cron = (el('agentCreateScheduleCron') && el('agentCreateScheduleCron').value) || '';
    var tz = (el('agentCreateScheduleTimezone') && el('agentCreateScheduleTimezone').value) || 'UTC';
    var discoverable = !!(el('agentCreateDiscoverable') && el('agentCreateDiscoverable').checked);

    return {
      templateSlug: state.selectedTpl ? state.selectedTpl.slug : '',
      name: String(name),
      description: String(description),
      modelSlot: String(modelSlot),
      scheduleEnabled: schedEnabled,
      scheduleCron: String(cron),
      scheduleTimezone: String(tz),
      discoverable: discoverable,
      selectedTools: Object.keys(state.selectedTools).filter(function (k) { return !!state.selectedTools[k]; })
    };
  }

  function restoreFromSnapshot(state, snapshot) {
    if (!snapshot) return;
    if (snapshot.templateSlug) {
      var sel = el('agentCreateTemplate');
      if (sel) sel.value = snapshot.templateSlug;
      var tpl = null;
      for (var i = 0; i < state.templates.length; i++) {
        if (state.templates[i].slug === snapshot.templateSlug) { tpl = state.templates[i]; break; }
      }
      // Don't blow away user's selectedTools — manually set selectedTpl.
      state.selectedTpl = tpl;
      var preview = el('agentCreateTemplatePreview');
      if (preview && tpl) {
        var slugEl = el('agentCreateTemplateSlug');
        var dEl = el('agentCreateTemplateDescription');
        if (slugEl) slugEl.textContent = tpl.slug || '';
        if (dEl) dEl.textContent = tpl.description || '(no description)';
        show(preview);
      }
    }
    if (snapshot.name) setVal('agentCreateName', snapshot.name);
    if (snapshot.description) setVal('agentCreateDescription', snapshot.description);
    if (snapshot.modelSlot) setVal('agentCreateModelSlot', snapshot.modelSlot);
    setChecked('agentCreateScheduleEnabled', !!snapshot.scheduleEnabled);
    if (snapshot.scheduleEnabled) show(el('agentCreateScheduleFields'));
    if (snapshot.scheduleCron) setVal('agentCreateScheduleCron', snapshot.scheduleCron);
    if (snapshot.scheduleTimezone) setVal('agentCreateScheduleTimezone', snapshot.scheduleTimezone);
    setChecked('agentCreateDiscoverable', !!snapshot.discoverable);

    // Restore tool chips.
    state.selectedTools = {};
    if (Array.isArray(snapshot.selectedTools)) {
      for (var j = 0; j < snapshot.selectedTools.length; j++) {
        if (snapshot.selectedTools[j]) state.selectedTools[snapshot.selectedTools[j]] = true;
      }
    }
    renderChips(state);
    refreshRecentDropdown(state);
  }

  // ---------------------------------------------------------------------------
  // Submit / payload builder
  //
  // Exposed for unit tests via window.LanaAgentsApp.Views.create.__test.
  // ---------------------------------------------------------------------------

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
      body.schedule = {
        enabled: true,
        cron: String(formValues.scheduleCron || '').trim(),
        timezone: formValues.scheduleTimezone || 'UTC'
      };
    }
    return body;
  }

  function formatMissingConnectorsMessage(missing) {
    if (!Array.isArray(missing) || !missing.length) {
      return 'This template requires connectors that are not yet connected.';
    }
    return 'This template requires connectors not yet connected: ' + missing.join(', ') + '.';
  }

  function submitCreate(ctx, state) {
    var snapshot = captureFormSnapshot(state);
    var body = buildCreateBody(state, snapshot);

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
      .then(function () {
        if (state.destroyed) return;
        clearPending(ctx.app);
        if (window.Lex && window.Lex.Toast) {
          window.Lex.Toast.success('Agent created');
        }
        ctx.app.setView('catalog');
      })
      .catch(function (err) {
        if (state.destroyed) return;
        console.error('[agents] Create failed:', err);
        var status = err && (err.status || (err.response && err.response.status));
        var msg = 'Unable to create agent';

        // Phase 5A 422 MISSING_REQUIRED_CONNECTORS shape:
        //   { error: { code: 'MISSING_REQUIRED_CONNECTORS', message, missing: [...] } }
        var body422 = err && (err.body || (err.response && err.response.data) || err.data);
        var nested = body422 && body422.error;
        if (status === 422 && nested && nested.code === 'MISSING_REQUIRED_CONNECTORS') {
          msg = formatMissingConnectorsMessage(nested.missing);
        } else if (status === 400) {
          msg = 'Some fields look invalid. Check name and tools.';
        } else if (status === 401) {
          msg = 'Your session expired. Please sign in again.';
        } else if (status === 403) {
          msg = 'You do not have permission to create agents.';
        } else if (status === 404) {
          msg = 'Agent creation is not available on this server.';
        } else if (status === 409) {
          msg = 'An agent with that name already exists.';
        }

        if (window.Lex && window.Lex.Toast) window.Lex.Toast.error(msg);
        if (status === 401 && window.Lex && window.Lex.Nav) {
          window.Lex.Nav.go('login.html');
        }
      });
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  function wire(ctx, state) {
    var modelSelect = el('agentCreateModelSlot');
    if (modelSelect) {
      modelSelect.options = MODEL_SLOTS.slice();
      modelSelect.value = 'agentic';
    }
    var tzSelect = el('agentCreateScheduleTimezone');
    if (tzSelect) {
      tzSelect.options = COMMON_TZS.slice();
      tzSelect.value = 'UTC';
    }

    var tplSelect = el('agentCreateTemplate');
    if (tplSelect) {
      var tplHandler = function (e) { onTemplateChange(state, e); };
      tplSelect.addEventListener('lex-change', tplHandler);
      state._unbindFns.push(function () { tplSelect.removeEventListener('lex-change', tplHandler); });
    }

    var schedToggle = el('agentCreateScheduleEnabled');
    if (schedToggle) {
      schedToggle.addEventListener('lex-change', onScheduleEnabledChange);
      state._unbindFns.push(function () { schedToggle.removeEventListener('lex-change', onScheduleEnabledChange); });
    }

    var chips = el('agentCreateChips');
    if (chips) {
      var chipsHandler = function (e) { onChipsClick(state, e); };
      chips.addEventListener('click', chipsHandler);
      state._unbindFns.push(function () { chips.removeEventListener('click', chipsHandler); });
    }

    var recent = el('agentCreateRecentTools');
    if (recent) {
      var recentHandler = function (e) { onRecentToolPick(state, e); };
      recent.addEventListener('lex-change', recentHandler);
      state._unbindFns.push(function () { recent.removeEventListener('lex-change', recentHandler); });
    }

    var browseBtn = el('agentCreateBrowseToolsBtn');
    if (browseBtn) {
      var browseHandler = function () {
        // Snapshot the form before navigating away so the tools-browser
        // view (and the return trip) preserves what the user typed.
        writePending(ctx.app, captureFormSnapshot(state));
        ctx.app.setView('toolsBrowse', {});
      };
      browseBtn.addEventListener('click', browseHandler);
      state._unbindFns.push(function () { browseBtn.removeEventListener('click', browseHandler); });
    }

    var saveBtn = el('agentCreateSaveBtn');
    if (saveBtn) {
      var saveHandler = function () { submitCreate(ctx, state); };
      saveBtn.addEventListener('click', saveHandler);
      state._unbindFns.push(function () { saveBtn.removeEventListener('click', saveHandler); });
    }

    var cancelBtn = el('agentCreateCancelBtn');
    if (cancelBtn) {
      var cancelHandler = function () {
        clearPending(ctx.app);
        ctx.app.setView('catalog');
      };
      cancelBtn.addEventListener('click', cancelHandler);
      state._unbindFns.push(function () { cancelBtn.removeEventListener('click', cancelHandler); });
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  function render(rootEl, ctx) {
    rootEl.innerHTML = TEMPLATE;

    var state = createState();
    rootEl._createState = state;

    wire(ctx, state);

    // Load templates first, then once they're in, restore any pending
    // snapshot. This ordering matters because restoreFromSnapshot maps
    // a templateSlug -> object using state.templates.
    loadTemplates(state);

    var pending = readPending(ctx.app);
    if (pending) {
      // Wait one frame for loadTemplates to populate (it may be async).
      // We poll briefly: most cases finish on the next microtask, but if
      // the API is slow we still re-apply once loadTemplates resolves.
      var tries = 0;
      var tick = function () {
        if (state.destroyed) return;
        if (state.templates.length || tries >= 20) {
          restoreFromSnapshot(state, pending);
          return;
        }
        tries += 1;
        setTimeout(tick, 50);
      };
      tick();
    }
  }

  function destroy(rootEl) {
    var state = rootEl && rootEl._createState;
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
    rootEl._createState = null;
  }

  global.LanaAgentsApp.Views.create = {
    render: render,
    destroy: destroy,
    // Pure-JS surface exposed for unit tests. Non-pure helpers (DOM,
    // network) deliberately stay private.
    __test: {
      buildCreateBody: buildCreateBody,
      formatMissingConnectorsMessage: formatMissingConnectorsMessage,
      computeFallbackRecentTools: computeFallbackRecentTools
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
