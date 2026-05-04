/* agent-detail.js — Agent profile page (Capabilities | Runs | Stats).
   Reads ?slug=<slug>, fetches agent profile + filtered run list. Configure
   drawer is a Phase-4 placeholder.

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

  var _slug      = null;
  var _agent     = null;
  var _activeTab = 'capabilities';

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
    if (_activeTab === 'runs') loadRuns();
  }

  // After the agent profile is loaded, refresh runs if that tab is active.
  // Recent Runs needs `agent_definition_id` (the loaded agent's id) — which we
  // only learn after `loadAgent()` resolves. Reset cache so the request fires
  // with the correct filter when the user lands on the Runs tab.
  function onAgentLoaded() {
    _runsLoaded = false;
    if (_activeTab === 'runs') loadRuns();
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
  // Buttons + drawer
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
      configBtn.addEventListener('click', function () {
        var drawer = el('agentDetailConfigDrawer');
        if (drawer) drawer.open = true;
      });
    }

    var drawer = el('agentDetailConfigDrawer');
    if (drawer && !drawer._agentWired) {
      drawer._agentWired = true;
      // Confirm currently does nothing — Phase 4 will wire submit logic.
      drawer.addEventListener('lex-confirm', function () {
        if (window.Lex && Lex.Toast) Lex.Toast.info('Configure form coming in Phase 4');
        drawer.open = false;
      });
    }

    var modal = el('agentDetailRunModal');
    if (modal && !modal._agentWired) {
      modal._agentWired = true;
      modal.addEventListener('lex-confirm', submitRun);
    }
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
