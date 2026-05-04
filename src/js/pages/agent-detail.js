/* agent-detail.js — Agent profile page (Capabilities | Runs | Stats).
   Reads ?slug=<slug>, fetches agent profile + filtered run list. Phase 4
   adds the Configure edit drawer, the populated Stats tab, and the
   header enable/disable toggle.

   Rules:
     - IIFE, no top-level const/class
     - Lex.Nav.go() for navigation, NEVER window.location.href
     - All HTML escaping via Lex.Utils.escapeHtml()
     - NO regex
*/

(function () {
  'use strict';

  var escHtml = (window.Lex && Lex.Utils && Lex.Utils.escapeHtml)
    ? Lex.Utils.escapeHtml
    : function (s) { var d = document.createElement('div'); d.textContent = (s == null ? '' : String(s)); return d.innerHTML; };

  var timeAgo = (window.Lex && Lex.Utils && Lex.Utils.timeAgo)
    ? Lex.Utils.timeAgo
    : function (s) { return s ? String(s) : ''; };

  // =========================================================================
  // State
  // =========================================================================

  var _slug          = null;
  var _agent         = null;
  var _activeTab     = 'capabilities';
  var _statsRange    = '30d';
  var _statsLoaded   = false;
  // Tools the user has unchecked relative to the agent's existing
  // allowed_tools. Final allowed_tools = current set - this set.
  var _editDisabledTools = {};

  var _MODEL_SLOTS = [
    { value: 'agentic', label: 'Agentic (planning + tool use)' },
    { value: 'rag',     label: 'RAG (retrieval-augmented chat)' },
    { value: 'main',    label: 'Main (general-purpose chat)' }
  ];

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

  // =========================================================================
  // Helpers
  // =========================================================================

  function el(id) { return document.getElementById(id); }
  function show(node) { if (node) node.classList.remove('hidden'); }
  function hide(node) { if (node) node.classList.add('hidden'); }

  function statusLabel(status) {
    if (!status) return 'Pending';
    if (status === 'compiling_context') return 'Compiling...';
    if (status === 'running')           return 'Running';
    if (status === 'awaiting_input')    return 'Needs Input';
    if (status === 'awaiting_approval') return 'Pending Approval';
    if (status === 'approved')          return 'Approved';
    if (status === 'completed')         return 'Completed';
    if (status === 'failed')            return 'Failed';
    if (status === 'rejected')          return 'Rejected';
    if (status === 'cancelled')         return 'Cancelled';
    if (status === 'queued')            return 'Queued';
    return status;
  }

  function statusDotModifier(status) {
    if (status === 'running' || status === 'compiling_context' || status === 'queued') return 'agent-detail-run-status-dot--running';
    if (status === 'awaiting_input' || status === 'awaiting_approval') return 'agent-detail-run-status-dot--awaiting';
    if (status === 'completed' || status === 'approved') return 'agent-detail-run-status-dot--complete';
    if (status === 'failed' || status === 'rejected')   return 'agent-detail-run-status-dot--failed';
    if (status === 'cancelled') return 'agent-detail-run-status-dot--cancelled';
    return 'agent-detail-run-status-dot--pending';
  }

  function priorityClass(priority) {
    if (priority === 'urgent') return 'agent-detail-run-priority--urgent';
    if (priority === 'high')   return 'agent-detail-run-priority--high';
    if (priority === 'medium') return 'agent-detail-run-priority--medium';
    if (priority === 'low')    return 'agent-detail-run-priority--low';
    return 'agent-detail-run-priority--medium';
  }

  function toolName(t) {
    if (!t) return '';
    if (typeof t === 'string') return t;
    return t.name || t.slug || '';
  }

  // System agents are owned by no organization. Disabling/editing them
  // here is read-only — admins must use the org kill switch.
  function isSystemAgent(agent) {
    if (!agent) return false;
    if (agent.is_system === true) return true;
    if (agent.organization_id === null || agent.organization_id === undefined) return true;
    if (agent.kind === 'system') return true;
    return false;
  }

  function setVal(id, value) {
    var n = el(id);
    if (n) n.value = (value == null ? '' : value);
  }

  function setChecked(id, checked) {
    var n = el(id);
    if (n) n.checked = !!checked;
  }

  // Format a millisecond duration into a human-readable string.
  // < 1s   → "245ms"
  // < 60s  → "1.2s"
  // < 1h   → "12m 03s"
  // else   → "1h 02m"
  function formatDurationMs(ms) {
    if (ms == null || isNaN(ms)) return '-';
    var n = Number(ms);
    if (n < 1000) return Math.round(n) + 'ms';
    if (n < 60000) return (n / 1000).toFixed(1) + 's';
    if (n < 3600000) {
      var m = Math.floor(n / 60000);
      var s = Math.floor((n % 60000) / 1000);
      return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
    }
    var h = Math.floor(n / 3600000);
    var rm = Math.floor((n % 3600000) / 60000);
    return h + 'h ' + (rm < 10 ? '0' : '') + rm + 'm';
  }

  // Format an integer with thousand separators. Avoids regex per
  // project rules — uses a simple loop to insert commas.
  function formatInt(n) {
    if (n == null || isNaN(n)) return '-';
    var s = String(Math.round(Number(n)));
    var negative = s.charAt(0) === '-';
    if (negative) s = s.substring(1);
    var out = '';
    var count = 0;
    for (var i = s.length - 1; i >= 0; i--) {
      if (count > 0 && count % 3 === 0) out = ',' + out;
      out = s.charAt(i) + out;
      count++;
    }
    return (negative ? '-' : '') + out;
  }

  // microdollars → human dollars. 1_000_000 microdollars = $1.
  function formatMicroDollars(micro) {
    if (micro == null || isNaN(micro)) return null;
    var dollars = Number(micro) / 1e6;
    if (dollars < 0.01) return '<$0.01';
    if (dollars < 1)    return '$' + dollars.toFixed(2);
    if (dollars < 10)   return '$' + dollars.toFixed(2);
    return '$' + dollars.toFixed(0);
  }

  // =========================================================================
  // Tab management
  // =========================================================================

  function switchTab(id) {
    _activeTab = id || 'capabilities';
    var panels = {
      capabilities: el('agentPanelCapabilities'),
      runs:         el('agentPanelRuns'),
      stats:        el('agentPanelStats')
    };
    Object.keys(panels).forEach(function (k) {
      if (panels[k]) {
        if (k === _activeTab) show(panels[k]);
        else hide(panels[k]);
      }
    });
    if (_activeTab === 'runs')  loadRuns();
    if (_activeTab === 'stats') loadStats();
  }

  // After the agent profile is loaded, refresh dependent panels.
  // Recent Runs needs `agent_definition_id` (the loaded agent's id) — which
  // we only learn after `loadAgent()` resolves. Stats also needs the slug
  // (already known) but should be re-fetched if the user hits this tab.
  function onAgentLoaded() {
    _runsLoaded = false;
    _statsLoaded = false;
    syncEnabledToggle();
    if (_activeTab === 'runs')  loadRuns();
    if (_activeTab === 'stats') loadStats();
  }

  function wireTabs() {
    var tabsEl = el('agentDetailTabs');
    if (!tabsEl || tabsEl._agentWired) return;
    tabsEl._agentWired = true;
    tabsEl.addEventListener('tab-change', function (e) {
      var id = e.detail && e.detail.id;
      if (id) switchTab(id);
    });
  }

  // =========================================================================
  // Profile rendering
  // =========================================================================

  function renderProfile(agent) {
    _agent = agent || {};

    var banner = el('agentDetailBanner');
    if (banner) {
      banner.heading = agent.name || agent.slug || 'Agent';
      banner.subtitle = agent.summary || agent.description || '';
      var letter = (agent.name || agent.slug || 'A').charAt(0).toUpperCase();
      banner.icon = letter;
    }

    document.title = (agent.name || 'Agent') + ' - LANA AI';

    var loading = el('agentPanelCapabilitiesLoading');
    var content = el('agentPanelCapabilitiesContent');
    hide(loading);
    show(content);

    var descEl = el('agentDetailDescription');
    if (descEl) descEl.textContent = agent.description || agent.summary || 'No description provided.';

    // Tools
    var toolsEl = el('agentDetailToolsList');
    if (toolsEl) {
      var tools = Array.isArray(agent.allowed_tools) ? agent.allowed_tools : [];
      if (tools.length === 0) {
        toolsEl.innerHTML = '<span class="agent-detail-empty-text">No tools configured.</span>';
      } else {
        var toolsHtml = '';
        for (var i = 0; i < tools.length; i++) {
          var label = typeof tools[i] === 'string' ? tools[i] : (tools[i] && (tools[i].name || tools[i].slug || ''));
          toolsHtml += '<span class="agent-detail-chip">' + escHtml(label) + '</span>';
        }
        toolsEl.innerHTML = toolsHtml;
      }
    }

    // Delegation
    var delegEl = el('agentDetailDelegationList');
    if (delegEl) {
      var deleg = Array.isArray(agent.delegatable_to) ? agent.delegatable_to : [];
      if (deleg.length === 0) {
        delegEl.innerHTML = '<span class="agent-detail-empty-text">No sub-agents.</span>';
      } else {
        var delegHtml = '';
        for (var j = 0; j < deleg.length; j++) {
          var d = deleg[j];
          var dLabel = typeof d === 'string' ? d : (d && (d.name || d.slug || ''));
          delegHtml += '<span class="agent-detail-chip agent-detail-chip--accent">' + escHtml(dLabel) + '</span>';
        }
        delegEl.innerHTML = delegHtml;
      }
    }

    // Model slot
    var modelKv = el('agentDetailModelKv');
    if (modelKv) {
      modelKv.value = agent.model_slot || agent.model || 'default';
    }

    // Approval policy
    var policyEl = el('agentDetailApprovalPolicy');
    if (policyEl) {
      var policy = agent.approval_policy;
      if (!policy) {
        policyEl.textContent = 'No approval required.';
      } else if (typeof policy === 'string') {
        policyEl.textContent = policy;
      } else if (typeof policy === 'object') {
        var summary = policy.summary
          || (policy.required ? 'Approval required for ' + (policy.required_for || 'sensitive actions') + '.' : 'No approval required.');
        policyEl.textContent = summary;
      }
    }
  }

  // =========================================================================
  // Runs list
  // =========================================================================

  function renderRunRow(run) {
    var status = run.status || 'queued';
    var priority = run.priority || 'medium';
    var dotMod = statusDotModifier(status);
    var pCls = priorityClass(priority);
    var label = statusLabel(status);
    var title = run.title || ('Run ' + (run.id || '').slice(0, 8));

    return ''
      + '<div class="agent-detail-run-row" data-run-id="' + escHtml(run.id || '') + '">'
      +   '<span class="agent-detail-run-status-dot ' + dotMod + '"></span>'
      +   '<span class="agent-detail-run-title">' + escHtml(title) + '</span>'
      +   '<span class="agent-detail-run-status">' + escHtml(label) + '</span>'
      +   '<span class="agent-detail-run-priority ' + pCls + '">' + escHtml(priority) + '</span>'
      +   '<span class="agent-detail-run-time">' + escHtml(run.created_at ? timeAgo(run.created_at) : '') + '</span>'
      + '</div>';
  }

  var _runsLoaded = false;
  function loadRuns() {
    if (_runsLoaded) return;
    if (!window.api || typeof window.api.get !== 'function') return;

    var loadingEl = el('agentDetailRunsLoading');
    var listEl = el('agentDetailRunsList');
    var emptyEl = el('agentDetailRunsEmpty');
    var countEl = el('agentDetailRunsCount');

    // Backend list endpoint filters by `agent_definition_id`, NOT `agent_slug`.
    // We can only build the correct query once the agent profile has loaded.
    // Until then, hold off (the list will rerun via onAgentLoaded()).
    var agentDefinitionId = _agent && _agent.id;
    if (!agentDefinitionId) {
      // Show loading until agent resolves.
      show(loadingEl);
      if (listEl) listEl.innerHTML = '';
      hide(emptyEl);
      return;
    }

    _runsLoaded = true;

    show(loadingEl);
    if (listEl) listEl.innerHTML = '';
    hide(emptyEl);

    var url = '/api/v1/agent-runs?agent_definition_id=' + encodeURIComponent(agentDefinitionId)
            + '&limit=20&sort_by=created_at&sort_order=desc';

    window.api.get(url)
      .then(function (resp) {
        hide(loadingEl);
        var runs = [];
        if (Array.isArray(resp)) runs = resp;
        else if (resp && Array.isArray(resp.data)) runs = resp.data;
        else if (resp && Array.isArray(resp.runs)) runs = resp.runs;

        if (countEl) countEl.textContent = runs.length + (runs.length === 1 ? ' run' : ' runs');

        if (runs.length === 0) {
          show(emptyEl);
          return;
        }

        var html = '';
        for (var i = 0; i < runs.length; i++) html += renderRunRow(runs[i]);
        if (listEl) listEl.innerHTML = html;
      })
      .catch(function (err) {
        hide(loadingEl);
        console.error('[agent-detail] Failed to load runs:', err);
        if (countEl) countEl.textContent = '';
        var status = err && (err.status || (err.response && err.response.status));
        if (emptyEl) {
          var msg = 'Unable to load runs.';
          if (status === 401) msg = 'Your session expired. Please sign in again.';
          else if (status === 404) msg = 'This agent no longer exists.';
          emptyEl.innerHTML = '<lex-empty icon="alert-circle" message="Unable to load runs" description="' + escHtml(msg) + '"></lex-empty>';
        }
        show(emptyEl);
      });
  }

  function wireRunsList() {
    var listEl = el('agentDetailRunsList');
    if (!listEl || listEl._agentWired) return;
    listEl._agentWired = true;
    listEl.addEventListener('click', function (evt) {
      var row = evt.target.closest('.agent-detail-run-row');
      if (!row) return;
      var runId = row.getAttribute('data-run-id');
      if (runId && window.Lex && Lex.Nav) {
        Lex.Nav.go('agent-run.html', { params: { id: runId } });
      }
    });
  }

  // =========================================================================
  // Buttons + drawer + enable toggle
  // =========================================================================

  function wireBannerButtons() {
    var runBtn = el('agentDetailRunBtn');
    if (runBtn && !runBtn._agentWired) {
      runBtn._agentWired = true;
      runBtn.addEventListener('click', function () {
        var modal = el('agentDetailRunModal');
        var input = el('agentDetailRunInput');
        if (input && typeof input.value !== 'undefined') input.value = '';
        if (modal) {
          modal.heading = 'Run: ' + (_agent && (_agent.name || _agent.slug) || _slug || '');
          modal.open = true;
        }
      });
    }

    var configBtn = el('agentDetailConfigBtn');
    if (configBtn && !configBtn._agentWired) {
      configBtn._agentWired = true;
      configBtn.addEventListener('click', openEditDrawer);
    }

    var drawer = el('agentDetailConfigDrawer');
    if (drawer && !drawer._agentWired) {
      drawer._agentWired = true;
      drawer.addEventListener('lex-confirm', submitEdit);
      // Drawer cancel just closes — no API call. Default behavior.
    }

    var deleteBtn = el('agentDetailEditDeleteBtn');
    if (deleteBtn && !deleteBtn._agentWired) {
      deleteBtn._agentWired = true;
      deleteBtn.addEventListener('click', confirmDelete);
    }

    var schedToggle = el('agentDetailEditScheduleEnabled');
    if (schedToggle && !schedToggle._agentWired) {
      schedToggle._agentWired = true;
      schedToggle.addEventListener('lex-change', function (evt) {
        var checked = !!(evt && evt.detail && evt.detail.value);
        var fields = el('agentDetailEditScheduleFields');
        if (!fields) return;
        if (checked) show(fields); else hide(fields);
      });
    }

    var toolsList = el('agentDetailEditToolsList');
    if (toolsList && !toolsList._agentWired) {
      toolsList._agentWired = true;
      toolsList.addEventListener('change', function (evt) {
        var input = evt.target.closest('.agent-detail-edit-tool-checkbox');
        if (!input) return;
        var name = input.getAttribute('data-tool');
        if (!name) return;
        if (input.checked) delete _editDisabledTools[name];
        else _editDisabledTools[name] = true;
      });
    }

    var enabledToggle = el('agentDetailEnabledToggle');
    if (enabledToggle && !enabledToggle._agentWired) {
      enabledToggle._agentWired = true;
      enabledToggle.addEventListener('lex-change', onEnabledToggleChange);
    }

    var modal = el('agentDetailRunModal');
    if (modal && !modal._agentWired) {
      modal._agentWired = true;
      modal.addEventListener('lex-confirm', submitRun);
    }

    var statsRange = el('agentDetailStatsRange');
    if (statsRange && !statsRange._agentWired) {
      statsRange._agentWired = true;
      statsRange.addEventListener('lex-change', function (evt) {
        var v = (evt && evt.detail && evt.detail.value) || (statsRange.value) || '30d';
        if (v === _statsRange) return;
        _statsRange = v;
        _statsLoaded = false;
        if (_activeTab === 'stats') loadStats();
      });
    }
  }

  // -------------------------------------------------------------------------
  // Enable / disable toggle
  // -------------------------------------------------------------------------

  function syncEnabledToggle() {
    var toggle = el('agentDetailEnabledToggle');
    var status = el('agentDetailEnabledStatus');
    var block = el('agentDetailEnabledBlock');
    if (!block) return;

    if (!_agent) {
      hide(block);
      if (toggle) hide(toggle);
      if (status) hide(status);
      return;
    }

    var system = isSystemAgent(_agent);
    // is_active defaults to true if absent; explicit false disables.
    var active = (_agent.is_active !== false);

    if (system) {
      // System agents render as a read-only status pill — never as an
      // interactive toggle — so a click cannot register a state flip and
      // there is no flicker to revert.
      if (toggle) {
        hide(toggle);
        toggle.checked = active;
        toggle.disabled = true;
      }
      if (status) show(status);
    } else {
      if (status) hide(status);
      if (toggle) {
        toggle.checked = active;
        toggle.disabled = false;
        toggle.title = '';
        show(toggle);
      }
    }
    show(block);
  }

  function onEnabledToggleChange(evt) {
    if (!_agent || !_slug) return;
    if (isSystemAgent(_agent)) {
      // Defense in depth — system agents render the read-only status pill
      // instead of the toggle, so this listener should not be reachable.
      // Re-sync just in case to keep the UI consistent and surface a hint.
      syncEnabledToggle();
      if (window.Lex && Lex.Toast) {
        Lex.Toast.info("System agents can't be disabled per-org from this UI; use the org kill switch in admin.");
      }
      return;
    }

    var desired = !!(evt && evt.detail && evt.detail.value);
    var path = desired ? 'enable' : 'disable';
    if (!window.api || typeof window.api.put !== 'function') return;

    window.api.put('/api/v1/agents/' + encodeURIComponent(_slug) + '/' + path, {})
      .then(function (resp) {
        var agent = (resp && resp.agent) ? resp.agent
                  : ((resp && resp.data) ? resp.data : resp);
        if (agent) {
          _agent = agent;
          syncEnabledToggle();
        } else {
          // Trust the toggle reflects the new state.
          if (_agent) _agent.is_active = desired;
        }
        if (window.Lex && Lex.Toast) {
          Lex.Toast.success(desired ? 'Agent enabled' : 'Agent disabled');
        }
      })
      .catch(function (err) {
        console.error('[agent-detail] Toggle failed:', err);
        // Revert toggle to last known state.
        syncEnabledToggle();
        var status = err && (err.status || (err.response && err.response.status));
        var msg = desired ? 'Unable to enable agent' : 'Unable to disable agent';
        if (status === 401) msg = 'Your session expired. Please sign in again.';
        else if (status === 403) msg = 'You do not have permission to change this.';
        else if (status === 404) msg = 'This agent no longer exists.';
        if (window.Lex && Lex.Toast) Lex.Toast.error(msg);
      });
  }

  // -------------------------------------------------------------------------
  // Edit drawer
  // -------------------------------------------------------------------------

  function openEditDrawer() {
    var drawer = el('agentDetailConfigDrawer');
    if (!drawer) return;
    populateEditForm();
    drawer.open = true;
  }

  function populateEditForm() {
    _editDisabledTools = {};
    var a = _agent || {};
    var system = isSystemAgent(a);

    setVal('agentDetailEditName', a.name || '');
    setVal('agentDetailEditDescription', a.description || '');

    // Model slot select
    var slotEl = el('agentDetailEditModelSlot');
    if (slotEl) {
      slotEl.options = _MODEL_SLOTS.slice();
      slotEl.value = a.model_slot || 'agentic';
    }

    // Approval policy select — server may emit string or object.
    var policyEl = el('agentDetailEditApprovalPolicy');
    if (policyEl) {
      var policyValue = 'none';
      if (typeof a.approval_policy === 'string') {
        policyValue = a.approval_policy;
      } else if (a.approval_policy && typeof a.approval_policy === 'object') {
        if (a.approval_policy.required === false) policyValue = 'none';
        else if (a.approval_policy.required_for === 'all') policyValue = 'all';
        else if (a.approval_policy.required) policyValue = 'sensitive';
      }
      policyEl.value = policyValue;
    }

    // Tools list — render checkboxes. Existing allowed_tools are checked.
    renderEditToolsCheckboxes(a.allowed_tools || []);

    // Schedule fields
    var schedule = a.schedule || {};
    var scheduleEnabled = !!schedule.enabled;
    setChecked('agentDetailEditScheduleEnabled', scheduleEnabled);
    setVal('agentDetailEditScheduleCron', schedule.cron || '');

    var tzEl = el('agentDetailEditScheduleTimezone');
    if (tzEl) {
      tzEl.options = _COMMON_TZS.slice();
      tzEl.value = schedule.timezone || 'UTC';
    }

    var schedFields = el('agentDetailEditScheduleFields');
    if (schedFields) {
      if (scheduleEnabled) show(schedFields); else hide(schedFields);
    }

    // System notice + readonly hints. Disable form fields for system agents.
    var notice = el('agentDetailDrawerSystemNotice');
    if (notice) {
      if (system) show(notice); else hide(notice);
    }
    var deleteBtn = el('agentDetailEditDeleteBtn');
    if (deleteBtn) deleteBtn.disabled = system;
  }

  function renderEditToolsCheckboxes(tools) {
    var toolsList = el('agentDetailEditToolsList');
    if (!toolsList) return;

    if (!tools || tools.length === 0) {
      toolsList.innerHTML = '<span class="agent-detail-empty-text">This agent has no tools configured.</span>';
      return;
    }

    var html = '';
    for (var i = 0; i < tools.length; i++) {
      var name = toolName(tools[i]);
      if (!name) continue;
      var safe = escHtml(name);
      html += '<label class="agent-detail-edit-tool-row">'
            + '<input type="checkbox" class="agent-detail-edit-tool-checkbox" data-tool="' + safe + '" checked />'
            + '<span class="agent-detail-edit-tool-name">' + safe + '</span>'
            + '</label>';
    }
    toolsList.innerHTML = html;
  }

  // Assemble the PUT body. We send the full editable surface — the
  // backend will diff against the stored agent. system_prompt is
  // intentionally absent (templates only).
  function buildEditBody() {
    var name = (el('agentDetailEditName') && el('agentDetailEditName').value) || '';
    var description = (el('agentDetailEditDescription') && el('agentDetailEditDescription').value) || '';
    var modelSlot = (el('agentDetailEditModelSlot') && el('agentDetailEditModelSlot').value) || '';
    var approvalPolicy = (el('agentDetailEditApprovalPolicy') && el('agentDetailEditApprovalPolicy').value) || 'none';

    var currentTools = ((_agent && _agent.allowed_tools) || []).map(toolName).filter(Boolean);
    var allowedTools = currentTools.filter(function (t) { return !_editDisabledTools[t]; });

    var body = {
      name: String(name).trim(),
      description: String(description).trim(),
      allowed_tools: allowedTools,
      approval_policy: approvalPolicy
    };
    if (modelSlot) body.model_slot = modelSlot;

    var schedOn = !!(el('agentDetailEditScheduleEnabled') && el('agentDetailEditScheduleEnabled').checked);
    var cron = (el('agentDetailEditScheduleCron') && el('agentDetailEditScheduleCron').value) || '';
    var tz = (el('agentDetailEditScheduleTimezone') && el('agentDetailEditScheduleTimezone').value) || 'UTC';
    body.schedule = {
      enabled: schedOn,
      cron: String(cron).trim(),
      timezone: tz
    };

    return body;
  }

  function submitEdit() {
    var drawer = el('agentDetailConfigDrawer');
    if (!_slug || !_agent) {
      if (drawer) drawer.open = false;
      return;
    }
    if (isSystemAgent(_agent)) {
      if (window.Lex && Lex.Toast) {
        Lex.Toast.info('System agents are managed centrally and cannot be edited here.');
      }
      if (drawer) drawer.open = false;
      return;
    }

    var body = buildEditBody();
    if (!body.name) {
      if (window.Lex && Lex.Toast) Lex.Toast.error('Display name is required.');
      return;
    }
    if (body.schedule && body.schedule.enabled && !body.schedule.cron) {
      if (window.Lex && Lex.Toast) Lex.Toast.error('Schedule is enabled but no cron expression was provided.');
      return;
    }

    if (!window.api || typeof window.api.put !== 'function') return;

    window.api.put('/api/v1/agents/' + encodeURIComponent(_slug), body)
      .then(function (resp) {
        var agent = (resp && resp.agent) ? resp.agent
                  : ((resp && resp.data) ? resp.data : resp);
        if (agent) {
          renderProfile(agent);
        }
        if (drawer) drawer.open = false;
        if (window.Lex && Lex.Toast) Lex.Toast.success('Agent updated');
      })
      .catch(function (err) {
        console.error('[agent-detail] Save failed:', err);
        var status = err && (err.status || (err.response && err.response.status));
        var msg = 'Unable to save changes';
        if (status === 400) {
          // 400 also covers the "system_prompt rejected" case from the contract.
          msg = 'Some fields look invalid. Check name, tools, and schedule.';
        } else if (status === 401) {
          msg = 'Your session expired. Please sign in again.';
        } else if (status === 403) {
          msg = 'You do not have permission to edit this agent.';
        } else if (status === 404) {
          msg = 'This agent no longer exists.';
        }
        if (window.Lex && Lex.Toast) Lex.Toast.error(msg);
      });
  }

  // -------------------------------------------------------------------------
  // Delete confirm
  // -------------------------------------------------------------------------

  function confirmDelete() {
    if (!_agent || !_slug) return;
    if (isSystemAgent(_agent)) {
      if (window.Lex && Lex.Toast) {
        Lex.Toast.info('System agents cannot be deleted from this UI.');
      }
      return;
    }
    if (!window.Lex || !Lex.Modal || typeof Lex.Modal.confirm !== 'function') {
      // Fallback to native confirm so the action still works without
      // the static Lex.Modal helper.
      if (window.confirm('Delete this agent? This soft-disables it for your org.')) {
        performDelete();
      }
      return;
    }

    Lex.Modal.confirm(
      'Delete agent?',
      'This soft-disables "' + (_agent.name || _slug) + '" for your organization. Past runs are kept for audit but the agent will no longer accept new runs.',
      performDelete,
      { variant: 'danger', confirmText: 'Delete', cancelText: 'Cancel' }
    );
  }

  function performDelete() {
    if (!_slug) return;
    if (!window.api || typeof window.api.delete !== 'function') return;

    window.api.delete('/api/v1/agents/' + encodeURIComponent(_slug))
      .then(function (resp) {
        var agent = (resp && resp.agent) ? resp.agent
                  : ((resp && resp.data) ? resp.data : resp);
        if (agent) {
          _agent = agent;
          syncEnabledToggle();
        }
        var drawer = el('agentDetailConfigDrawer');
        if (drawer) drawer.open = false;
        if (window.Lex && Lex.Toast) Lex.Toast.success('Agent deleted');
        // Drop the user back to the catalog so they can pick another.
        if (window.Lex && Lex.Nav) Lex.Nav.go('agents.html');
      })
      .catch(function (err) {
        console.error('[agent-detail] Delete failed:', err);
        var status = err && (err.status || (err.response && err.response.status));
        var msg = 'Unable to delete agent';
        if (status === 401) msg = 'Your session expired. Please sign in again.';
        else if (status === 403) msg = 'You do not have permission to delete this agent.';
        else if (status === 404) msg = 'This agent no longer exists.';
        if (window.Lex && Lex.Toast) Lex.Toast.error(msg);
      });
  }

  // -------------------------------------------------------------------------
  // Stats tab
  // -------------------------------------------------------------------------

  function statsRangeToWindow(range) {
    var days = 30;
    if (range === '7d')  days = 7;
    if (range === '30d') days = 30;
    if (range === '90d') days = 90;
    var until = new Date();
    var since = new Date(until.getTime() - days * 24 * 3600 * 1000);
    return { since: since.toISOString(), until: until.toISOString() };
  }

  function loadStats() {
    if (_statsLoaded) return;
    if (!_slug) return;
    if (!window.api || typeof window.api.get !== 'function') return;

    var loading      = el('agentDetailStatsLoading');
    var content      = el('agentDetailStatsContent');
    var unavailable  = el('agentDetailStatsUnavailable');

    show(loading);
    hide(content);
    hide(unavailable);

    var w = statsRangeToWindow(_statsRange);
    var url = '/api/v1/agents/' + encodeURIComponent(_slug) + '/stats'
            + '?since=' + encodeURIComponent(w.since)
            + '&until=' + encodeURIComponent(w.until);

    window.api.get(url)
      .then(function (resp) {
        _statsLoaded = true;
        hide(loading);
        // Backend returns the stats object directly; tolerate { data } too.
        var stats = (resp && resp.data) ? resp.data : resp;
        if (!stats || typeof stats !== 'object') {
          show(unavailable);
          return;
        }
        renderStats(stats);
        show(content);
      })
      .catch(function (err) {
        hide(loading);
        var status = err && (err.status || (err.response && err.response.status));
        if (status === 404 || status === 501) {
          // Endpoint not yet shipped — show the gentle placeholder.
          show(unavailable);
          return;
        }
        console.error('[agent-detail] Stats fetch failed:', err);
        // For other errors, also degrade to placeholder rather than crash.
        var msg = 'Stats are temporarily unavailable.';
        if (status === 401) msg = 'Your session expired. Please sign in again.';
        var card = unavailable && unavailable.querySelector('lex-empty');
        if (card) {
          card.setAttribute('message', 'Unable to load stats');
          card.setAttribute('description', msg);
        }
        show(unavailable);
      });
  }

  function renderStats(stats) {
    var runs = (stats && stats.runs) || {};
    var cost = (stats && stats.cost) || {};
    var duration = (stats && stats.duration) || {};
    var artifacts = (stats && stats.artifacts) || {};

    // Total runs
    var totalRuns = Number(runs.total || 0);
    var totalRunsEl = el('agentDetailStatTotalRuns');
    if (totalRunsEl) totalRunsEl.value = formatInt(totalRuns);

    // Success rate (completed / total)
    var byStatus = runs.by_status || {};
    var completed = Number(byStatus.completed || byStatus.approved || 0);
    var rate = totalRuns > 0 ? (completed / totalRuns * 100) : 0;
    var successEl = el('agentDetailStatSuccessRate');
    if (successEl) successEl.value = (totalRuns === 0 ? '-' : rate.toFixed(0) + '%');

    // Median duration
    var medEl = el('agentDetailStatMedianDuration');
    if (medEl) medEl.value = formatDurationMs(duration.median_ms);

    // Total tokens
    var inTokens  = Number(cost.input_tokens || 0);
    var outTokens = Number(cost.output_tokens || 0);
    var totalTokens = Number(cost.total_tokens != null ? cost.total_tokens : (inTokens + outTokens));
    var tokensEl = el('agentDetailStatTotalTokens');
    if (tokensEl) tokensEl.value = formatInt(totalTokens);

    // Estimated cost — hide card if unavailable
    var costEl = el('agentDetailStatEstCost');
    var costFormatted = formatMicroDollars(cost.estimated_cost_microdollars);
    if (costEl) {
      if (costFormatted) {
        costEl.value = costFormatted;
        costEl.classList.remove('hidden');
      } else {
        costEl.value = '-';
        costEl.classList.add('hidden');
      }
    }

    renderBreakdown('agentDetailStatsByStatus', runs.by_status, 'No runs yet.');
    renderBreakdown('agentDetailStatsByTrigger', runs.by_trigger_type, 'No runs yet.');
    renderArtifactBreakdown('agentDetailStatsArtifacts', artifacts);
  }

  function renderBreakdown(targetId, obj, emptyText) {
    var node = el(targetId);
    if (!node) return;
    var keys = obj ? Object.keys(obj) : [];
    if (keys.length === 0) {
      node.innerHTML = '<span class="agent-detail-empty-text">' + escHtml(emptyText || 'No data.') + '</span>';
      return;
    }
    keys.sort();
    var html = '';
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      html += '<div class="agent-detail-stats-row">'
            + '<span class="agent-detail-stats-row-label">' + escHtml(prettyKey(k)) + '</span>'
            + '<span class="agent-detail-stats-row-value">' + escHtml(formatInt(obj[k])) + '</span>'
            + '</div>';
    }
    node.innerHTML = html;
  }

  // The artifact breakdown follows a known sequence so we render
  // it in lifecycle order rather than alphabetical.
  function renderArtifactBreakdown(targetId, artifacts) {
    var node = el(targetId);
    if (!node) return;
    var fields = [
      ['proposed',          'Proposed'],
      ['approved',          'Approved'],
      ['applied',           'Applied'],
      ['failed',            'Failed'],
      ['failed_to_apply',   'Failed to apply']
    ];
    var hasAny = false;
    var html = '';
    for (var i = 0; i < fields.length; i++) {
      var key = fields[i][0];
      var label = fields[i][1];
      var v = artifacts && artifacts[key];
      if (v != null) hasAny = true;
      html += '<div class="agent-detail-stats-row">'
            + '<span class="agent-detail-stats-row-label">' + escHtml(label) + '</span>'
            + '<span class="agent-detail-stats-row-value">' + escHtml(v == null ? '-' : formatInt(v)) + '</span>'
            + '</div>';
    }
    if (!hasAny) {
      node.innerHTML = '<span class="agent-detail-empty-text">No artifacts yet.</span>';
      return;
    }
    node.innerHTML = html;
  }

  // Render snake_case keys as Title Case for display.
  function prettyKey(k) {
    if (!k) return '';
    var parts = String(k).split('_');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p) continue;
      out.push(p.charAt(0).toUpperCase() + p.substring(1));
    }
    return out.join(' ');
  }

  function submitRun() {
    var input = el('agentDetailRunInput');
    var value = input && typeof input.value !== 'undefined' ? input.value : '';
    if (!value || !String(value).trim()) {
      if (window.Lex && Lex.Toast) Lex.Toast.error('Please describe what the agent should do.');
      return;
    }
    if (!window.api || typeof window.api.post !== 'function' || !_slug) return;

    window.api.post('/api/v1/agents/' + encodeURIComponent(_slug) + '/runs', {
      input: String(value).trim()
    })
      .then(function (resp) {
        // Backend returns 202 { run, queue }; tolerate { data } or bare object.
        var runId = (resp && resp.run && resp.run.id)
                 || (resp && resp.data && resp.data.id)
                 || (resp && resp.id)
                 || (resp && resp.run_id);
        var modal = el('agentDetailRunModal');
        if (modal) modal.open = false;
        if (window.Lex && Lex.Toast) Lex.Toast.success('Run started');
        if (runId && window.Lex && Lex.Nav) {
          Lex.Nav.go('agent-run.html', { params: { id: runId } });
        } else {
          console.warn('[agent-detail] Run started but no id in response:', resp);
          if (window.Lex && Lex.Toast) {
            Lex.Toast.info('Run started, but we could not open the live view. Check the Runs tab.');
          }
        }
      })
      .catch(function (err) {
        console.error('[agent-detail] Run start failed:', err);
        var status = err && (err.status || (err.response && err.response.status));
        var msg = 'Unable to start run';
        if (status === 401) msg = 'Your session expired. Please sign in again.';
        else if (status === 404) msg = 'This agent no longer exists.';
        if (window.Lex && Lex.Toast) Lex.Toast.error(msg);
      });
  }

  // =========================================================================
  // Data
  // =========================================================================

  function loadAgent() {
    if (!_slug) return;
    if (!window.api || typeof window.api.get !== 'function') {
      document.addEventListener('lex-ready', loadAgent, { once: true });
      return;
    }

    window.api.get('/api/v1/agents/' + encodeURIComponent(_slug))
      .then(function (resp) {
        // Backend returns { agent: {...} }; tolerate { data } / bare object
        var agent = (resp && resp.agent) ? resp.agent
                  : ((resp && resp.data) ? resp.data : resp);
        if (!agent) {
          renderProfile({ slug: _slug, name: _slug, description: 'Agent not found.' });
          return;
        }
        renderProfile(agent);
        onAgentLoaded();
      })
      .catch(function (err) {
        console.error('[agent-detail] Failed to load agent:', err);
        showLoadError(err);
      });
  }

  // Differentiated error message for load failures.
  function showLoadError(err) {
    var status = err && (err.status || (err.response && err.response.status));
    var descEl = el('agentDetailDescription');
    var loading = el('agentPanelCapabilitiesLoading');
    var content = el('agentPanelCapabilitiesContent');
    hide(loading);
    show(content);

    var message;
    if (status === 401) {
      message = 'Your session expired. Please sign in again.';
      if (window.Lex && Lex.Toast) Lex.Toast.error(message);
      if (window.Lex && Lex.Nav) Lex.Nav.go('login.html');
    } else if (status === 404) {
      message = 'This agent no longer exists.';
    } else {
      message = 'Something went wrong loading this agent. Try again.';
    }
    if (descEl) descEl.textContent = message;

    var banner = el('agentDetailBanner');
    if (banner) {
      banner.heading = _slug || 'Agent';
      banner.subtitle = message;
    }
  }

  // =========================================================================
  // Init
  // =========================================================================

  function init() {
    var params = (window.Lex && Lex.Nav && typeof Lex.Nav.getParams === 'function')
      ? Lex.Nav.getParams()
      : new URLSearchParams(window.location.search);
    _slug = params && (params.get ? params.get('slug') : params.slug);
    _agent = null;
    _runsLoaded = false;
    _activeTab = 'capabilities';

    wireTabs();
    wireRunsList();
    wireBannerButtons();
    switchTab(_activeTab);
    loadAgent();
  }

  if (window.LexRouter) {
    LexRouter.registerPageInit('agent-detail.html', init);
  }
  init();
})();
