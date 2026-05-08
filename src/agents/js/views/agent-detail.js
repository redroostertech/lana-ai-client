/* agent-detail.js — Agent profile SPA view (Capabilities | Runs | Stats).
   Migrated from src/js/pages/agent-detail.js. Reads ctx.slug, fetches agent
   profile + filtered run list. Includes the Configure edit drawer, Stats
   tab, and the header enable/disable toggle.

   Rules:
     - IIFE, no top-level const/class
     - Internal navigation goes through ctx.app.setView
     - All HTML escaping via Lex.Utils.escapeHtml()
     - NO regex
*/

'use strict';

(function (global) {
  global.LanaAgentsApp = global.LanaAgentsApp || {};
  global.LanaAgentsApp.Views = global.LanaAgentsApp.Views || {};

  // Markup template — extracted from src/agents/agent-detail.html (the
  // <main class="agent-detail-page-container"> body, dropping the outer
  // <div id="lex-page-content"> wrapper). Cloned into rootEl on render.
  var TEMPLATE = ''
    + '<main class="agent-detail-page-container">'

    + '<lex-banner'
    +   ' id="agentDetailBanner"'
    +   ' variant="light"'
    +   ' heading="Agent"'
    +   ' subtitle="Loading agent profile..."'
    + '>'
    +   '<div id="agentDetailEnabledBlock" class="agent-detail-enabled-block hidden">'
    +     '<lex-toggle'
    +       ' id="agentDetailEnabledToggle"'
    +       ' class="hidden"'
    +       ' label="Enabled"'
    +       ' label-side="right"'
    +       ' size="sm"'
    +     '></lex-toggle>'
    +     '<span'
    +       ' id="agentDetailEnabledStatus"'
    +       ' class="agent-detail-enabled-status hidden"'
    +       ' role="status"'
    +       ' aria-disabled="true"'
    +       ' tabindex="-1"'
    +       " title=\"System agents can't be disabled per-org from this UI. Use the org kill switch in admin.\""
    +     '>System (always on)</span>'
    +   '</div>'
    +   '<lex-btn id="agentDetailRunBtn" variant="primary" icon="play">Run</lex-btn>'
    +   '<lex-btn id="agentDetailConfigBtn" variant="secondary" icon="settings">Configure</lex-btn>'
    + '</lex-banner>'

    + '<div class="agent-detail-tabs-bar">'
    +   '<lex-tabs'
    +     ' id="agentDetailTabs"'
    +     ' active="capabilities"'
    +     ' variant="underline"'
    +     ' tabs=\'[{"id":"capabilities","label":"Capabilities","icon":"layers"},{"id":"runs","label":"Runs","icon":"workflow"},{"id":"stats","label":"Stats","icon":"bar-chart-2"}]\''
    +   '></lex-tabs>'
    + '</div>'

    + '<section id="agentPanelCapabilities" class="agent-detail-panel">'
    +   '<div id="agentPanelCapabilitiesLoading" class="agent-detail-loading">'
    +     '<lex-spinner size="sm"></lex-spinner>'
    +     '<span>Loading capabilities...</span>'
    +   '</div>'
    +   '<div id="agentPanelCapabilitiesContent" class="hidden">'
    +     '<lex-card heading="About" padding="normal">'
    +       '<p id="agentDetailDescription" class="agent-detail-description">(description)</p>'
    +     '</lex-card>'
    +     '<lex-card heading="Allowed Tools" padding="normal">'
    +       '<div id="agentDetailToolsList" class="agent-detail-chip-list">'
    +         '<span class="agent-detail-empty-text">No tools configured.</span>'
    +       '</div>'
    +     '</lex-card>'
    +     '<lex-card heading="Delegation" padding="normal">'
    +       '<div id="agentDetailDelegationList" class="agent-detail-chip-list">'
    +         '<span class="agent-detail-empty-text">No sub-agents.</span>'
    +       '</div>'
    +     '</lex-card>'
    +     '<lex-card heading="Model" padding="normal">'
    +       '<lex-kv id="agentDetailModelKv" label="Model slot" value="-"></lex-kv>'
    +     '</lex-card>'
    +     '<lex-card heading="Approval Policy" padding="normal">'
    +       '<p id="agentDetailApprovalPolicy" class="agent-detail-description">-</p>'
    +     '</lex-card>'
    +     '<lex-card heading="Workflow" padding="normal">'
    +       '<div id="agentDetailWorkflowEmpty" class="agent-detail-empty-text">'
    +         'No workflow attached. This agent runs the prompt-driven loop.'
    +       '</div>'
    +       '<div id="agentDetailWorkflowMeta" class="agent-detail-workflow-meta hidden">'
    +         '<span class="agent-detail-chip">v<span id="agentDetailWorkflowVersion">-</span></span>'
    +         '<span class="agent-detail-chip agent-detail-chip--accent">'
    +           '<span id="agentDetailWorkflowStateCount">0</span> states'
    +         '</span>'
    +         '<span class="agent-detail-workflow-initial">'
    +           'starts at <code id="agentDetailWorkflowInitial">-</code>'
    +         '</span>'
    +       '</div>'
    +       '<ol id="agentDetailWorkflowStates" class="agent-detail-workflow-states hidden"></ol>'
    +     '</lex-card>'
    +   '</div>'
    + '</section>'

    + '<section id="agentPanelRuns" class="agent-detail-panel hidden">'
    +   '<lex-card padding="none">'
    +     '<div class="agent-detail-runs-header">'
    +       '<span class="agent-detail-runs-title">Recent Runs</span>'
    +       '<span id="agentDetailRunsCount" class="agent-detail-runs-count"></span>'
    +     '</div>'
    +     '<div id="agentDetailRunsLoading" class="agent-detail-loading">'
    +       '<lex-spinner size="sm"></lex-spinner>'
    +       '<span>Loading runs...</span>'
    +     '</div>'
    +     '<div id="agentDetailRunsList"></div>'
    +     '<div id="agentDetailRunsEmpty" class="hidden agent-detail-runs-empty">'
    +       '<lex-empty'
    +         ' icon="workflow"'
    +         ' message="No runs yet"'
    +         ' description="Runs of this agent will appear here."'
    +       '></lex-empty>'
    +     '</div>'
    +   '</lex-card>'
    + '</section>'

    + '<section id="agentPanelStats" class="agent-detail-panel hidden">'
    +   '<div class="agent-detail-stats-toolbar">'
    +     '<span class="agent-detail-stats-toolbar-label">Range</span>'
    +     '<lex-segmented'
    +       ' id="agentDetailStatsRange"'
    +       ' value="30d"'
    +       ' options=\'[{"value":"7d","label":"Last 7 days"},{"value":"30d","label":"Last 30 days"},{"value":"90d","label":"Last 90 days"}]\''
    +     '></lex-segmented>'
    +   '</div>'
    +   '<div id="agentDetailStatsLoading" class="agent-detail-loading hidden">'
    +     '<lex-spinner size="sm"></lex-spinner>'
    +     '<span>Loading stats...</span>'
    +   '</div>'
    +   '<div id="agentDetailStatsUnavailable" class="hidden">'
    +     '<lex-card padding="normal">'
    +       '<lex-empty'
    +         ' icon="bar-chart-2"'
    +         ' message="Stats not yet available"'
    +         ' description="The stats service is not available on this server."'
    +       '></lex-empty>'
    +     '</lex-card>'
    +   '</div>'
    +   '<div id="agentDetailStatsContent" class="hidden">'
    +     '<div id="agentDetailStatsSparklineWrap" class="agent-detail-stats-sparkline-wrap hidden">'
    +       '<div class="agent-detail-stats-sparkline-header">'
    +         '<span class="agent-detail-stats-sparkline-title">Runs over time</span>'
    +         '<span class="agent-detail-stats-sparkline-legend">'
    +           '<span class="agent-detail-stats-sparkline-legend-item">'
    +             '<span class="agent-detail-stats-sparkline-swatch agent-detail-stats-sparkline-swatch--total"></span>'
    +             'Total'
    +           '</span>'
    +           '<span class="agent-detail-stats-sparkline-legend-item">'
    +             '<span class="agent-detail-stats-sparkline-swatch agent-detail-stats-sparkline-swatch--completed"></span>'
    +             'Completed'
    +           '</span>'
    +         '</span>'
    +       '</div>'
    +       '<svg'
    +         ' id="agentDetailStatsSparkline"'
    +         ' class="agent-detail-stats-sparkline"'
    +         ' viewBox="0 0 200 40"'
    +         ' preserveAspectRatio="none"'
    +         ' role="img"'
    +         ' aria-label="Runs over time"'
    +       '></svg>'
    +     '</div>'
    +     '<div id="agentDetailStatsCards" class="agent-detail-stats-cards">'
    +       '<lex-metric id="agentDetailStatTotalRuns"     label="Total runs"        value="0" size="md"></lex-metric>'
    +       '<lex-metric id="agentDetailStatSuccessRate"   label="Success rate"      value="0%" size="md"></lex-metric>'
    +       '<lex-metric id="agentDetailStatMedianDuration" label="Median duration"  value="0s" size="md"></lex-metric>'
    +       '<lex-metric id="agentDetailStatTotalTokens"   label="Total tokens"      value="0" size="md"></lex-metric>'
    +       '<lex-metric id="agentDetailStatEstCost"       label="Est. cost"         value="-" size="md"></lex-metric>'
    +     '</div>'
    +     '<div class="agent-detail-stats-grid">'
    +       '<lex-card heading="Runs by status" padding="compact">'
    +         '<div id="agentDetailStatsByStatus" class="agent-detail-stats-list">'
    +           '<span class="agent-detail-empty-text">No runs yet.</span>'
    +         '</div>'
    +       '</lex-card>'
    +       '<lex-card heading="Runs by trigger" padding="compact">'
    +         '<div id="agentDetailStatsByTrigger" class="agent-detail-stats-list">'
    +           '<span class="agent-detail-empty-text">No runs yet.</span>'
    +         '</div>'
    +       '</lex-card>'
    +       '<lex-card heading="Artifacts" padding="compact">'
    +         '<div id="agentDetailStatsArtifacts" class="agent-detail-stats-list">'
    +           '<span class="agent-detail-empty-text">No artifacts yet.</span>'
    +         '</div>'
    +       '</lex-card>'
    +     '</div>'
    +   '</div>'
    + '</section>'

    + '<lex-drawer'
    +   ' id="agentDetailConfigDrawer"'
    +   ' heading="Configure Agent"'
    +   ' side="right"'
    +   ' width="lg"'
    +   ' show-footer'
    +   ' confirm-text="Save"'
    +   ' cancel-text="Cancel"'
    +   ' data-hoist'
    + '>'
    +   '<div class="agent-detail-drawer-body">'
    +     '<p id="agentDetailDrawerSystemNotice" class="agent-detail-drawer-system-notice hidden">'
    +       'This is a system agent. Some fields are managed centrally and '
    +       'cannot be edited per-organization here.'
    +     '</p>'
    +     '<lex-input id="agentDetailEditName" label="Display name" required></lex-input>'
    +     '<lex-textarea id="agentDetailEditDescription" label="Description" rows="3"></lex-textarea>'
    +     '<div class="agent-detail-drawer-section">'
    +       '<div class="agent-detail-drawer-section-label">'
    +         'Allowed tools'
    +         '<span class="agent-detail-drawer-section-hint">'
    +           'Uncheck tools you want this agent to skip. The template '
    +           'defines the maximum set — adding new tools is not supported.'
    +         '</span>'
    +       '</div>'
    +       '<div id="agentDetailEditToolsList" class="agent-detail-drawer-tools-list">'
    +         '<span class="agent-detail-empty-text">No tools configured.</span>'
    +       '</div>'
    +     '</div>'
    +     '<lex-select'
    +       ' id="agentDetailEditModelSlot"'
    +       ' label="Model slot"'
    +       ' placeholder="Choose a model slot..."'
    +     '></lex-select>'
    +     '<lex-select'
    +       ' id="agentDetailEditApprovalPolicy"'
    +       ' label="Approval policy"'
    +       ' options=\'[{"value":"none","label":"No approval required"},{"value":"sensitive","label":"Required for sensitive actions"},{"value":"all","label":"Required for every action"}]\''
    +     '></lex-select>'
    +     '<div class="agent-detail-drawer-section">'
    +       '<div class="agent-detail-drawer-section-label">Schedule</div>'
    +       '<lex-toggle'
    +         ' id="agentDetailEditScheduleEnabled"'
    +         ' label="Run on a schedule"'
    +         ' label-side="right"'
    +       '></lex-toggle>'
    +       '<div id="agentDetailEditScheduleFields" class="agent-detail-drawer-schedule-fields hidden">'
    +         '<lex-input'
    +           ' id="agentDetailEditScheduleCron"'
    +           ' label="Cron expression"'
    +           ' placeholder="0 9 * * 1-5"'
    +           ' help="Standard 5-field cron"'
    +         '></lex-input>'
    +         '<lex-select'
    +           ' id="agentDetailEditScheduleTimezone"'
    +           ' label="Timezone"'
    +           ' placeholder="UTC"'
    +         '></lex-select>'
    +       '</div>'
    +     '</div>'
    +     '<div class="agent-detail-drawer-section">'
    +       '<div class="agent-detail-drawer-section-label">'
    +         'Budget'
    +         '<span class="agent-detail-drawer-section-hint">'
    +           'Optional caps for each run. Leave a field blank to use the '
    +           'org-level default. Positive integers only.'
    +         '</span>'
    +       '</div>'
    +       '<div class="agent-detail-drawer-budget-grid">'
    +         '<lex-input id="agentDetailEditBudgetSteps" label="Max total steps" type="number" placeholder="e.g. 50" title="Hard cap on the number of agent steps (tool calls + reasoning + sub-agent turns) per run."></lex-input>'
    +         '<lex-input id="agentDetailEditBudgetSubagents" label="Max sub-agents" type="number" placeholder="e.g. 3" title="Maximum number of sub-agents the orchestrator may spawn during a run."></lex-input>'
    +         '<lex-input id="agentDetailEditBudgetDurationSec" label="Max duration (seconds)" type="number" placeholder="e.g. 600" title="Wall-clock cap on a single run, in seconds. Stored as max_duration_ms server-side."></lex-input>'
    +         '<lex-input id="agentDetailEditBudgetInputTokens" label="Max input tokens" type="number" placeholder="e.g. 200000" title="Cumulative input-token cap across all model calls in a single run."></lex-input>'
    +         '<lex-input id="agentDetailEditBudgetOutputTokens" label="Max output tokens" type="number" placeholder="e.g. 50000" title="Cumulative output-token cap across all model calls in a single run."></lex-input>'
    +         '<lex-input id="agentDetailEditBudgetToolCalls" label="Max tool calls" type="number" placeholder="e.g. 25" title="Maximum number of tool invocations during a single run."></lex-input>'
    +       '</div>'
    +     '</div>'
    +     '<div class="agent-detail-drawer-danger-zone">'
    +       '<div class="agent-detail-drawer-section-label agent-detail-drawer-danger-label">Danger zone</div>'
    +       '<p class="agent-detail-drawer-danger-text">'
    +         'Deleting an agent soft-disables it for your organization. Past '
    +         'runs are kept for audit but the agent will no longer accept '
    +         'new runs.'
    +       '</p>'
    +       '<lex-btn id="agentDetailEditDeleteBtn" variant="danger" icon="trash-2">Delete agent</lex-btn>'
    +     '</div>'
    +   '</div>'
    + '</lex-drawer>'

    + '<lex-modal id="agentDetailRunModal" heading="Run Agent" size="md" data-hoist>'
    +   '<div class="agent-detail-run-modal-body">'
    +     '<p class="agent-detail-config-notice">'
    +       'Provide a brief input describing what the agent should do.'
    +     '</p>'
    +     '<lex-textarea'
    +       ' id="agentDetailRunInput"'
    +       ' label="Input"'
    +       ' rows="4"'
    +       ' placeholder="Describe the task..."'
    +     '></lex-textarea>'
    +   '</div>'
    + '</lex-modal>'

    + '</main>';

  var escHtml = (typeof window !== 'undefined' && window.Lex && window.Lex.Utils && window.Lex.Utils.escapeHtml)
    ? window.Lex.Utils.escapeHtml
    : function (s) { var d = document.createElement('div'); d.textContent = (s == null ? '' : String(s)); return d.innerHTML; };

  var timeAgo = (typeof window !== 'undefined' && window.Lex && window.Lex.Utils && window.Lex.Utils.timeAgo)
    ? window.Lex.Utils.timeAgo
    : function (s) { return s ? String(s) : ''; };

  var MODEL_SLOTS = [
    { value: 'agentic', label: 'Agentic (planning + tool use)' },
    { value: 'rag',     label: 'RAG (retrieval-augmented chat)' },
    { value: 'main',    label: 'Main (general-purpose chat)' }
  ];

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

  var BUDGET_FIELDS = [
    { id: 'agentDetailEditBudgetSteps',         key: 'max_total_steps',   units: 'count' },
    { id: 'agentDetailEditBudgetSubagents',     key: 'max_subagents',     units: 'count' },
    { id: 'agentDetailEditBudgetDurationSec',   key: 'max_duration_ms',   units: 'ms_from_seconds' },
    { id: 'agentDetailEditBudgetInputTokens',   key: 'max_input_tokens',  units: 'count' },
    { id: 'agentDetailEditBudgetOutputTokens',  key: 'max_output_tokens', units: 'count' },
    { id: 'agentDetailEditBudgetToolCalls',     key: 'max_tool_calls',    units: 'count' }
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

  function formatMicroDollars(micro) {
    if (micro == null || isNaN(micro)) return null;
    var dollars = Number(micro) / 1e6;
    if (dollars < 0.01) return '<$0.01';
    if (dollars < 1)    return '$' + dollars.toFixed(2);
    if (dollars < 10)   return '$' + dollars.toFixed(2);
    return '$' + dollars.toFixed(0);
  }

  function budgetValueToInput(field, raw) {
    if (raw == null || raw === '') return '';
    var n = Number(raw);
    if (isNaN(n)) return '';
    if (field.units === 'ms_from_seconds') {
      var sec = n / 1000;
      if (sec === Math.floor(sec)) return String(Math.round(sec));
      return String(sec);
    }
    return String(Math.round(n));
  }

  function budgetInputToValue(field, raw) {
    if (raw == null) return null;
    var trimmed = String(raw).trim();
    if (trimmed === '') return null;
    var n = Number(trimmed);
    if (isNaN(n)) return { _invalid: 'Budget values must be numbers.' };
    if (n < 0) return { _invalid: 'Budget values must be zero or positive.' };
    if (field.units === 'ms_from_seconds') {
      return Math.round(n * 1000);
    }
    if (n !== Math.floor(n)) {
      return { _invalid: 'Budget counts must be whole numbers.' };
    }
    return Math.round(n);
  }

  function readBudgetFromForm() {
    var out = {};
    for (var i = 0; i < BUDGET_FIELDS.length; i++) {
      var f = BUDGET_FIELDS[i];
      var node = el(f.id);
      var raw = node && typeof node.value !== 'undefined' ? node.value : '';
      var v = budgetInputToValue(f, raw);
      if (v == null) continue;
      if (v && typeof v === 'object' && v._invalid) {
        return { _invalid: v._invalid };
      }
      out[f.key] = v;
    }
    return out;
  }

  function populateBudgetForm(budget) {
    var src = (budget && typeof budget === 'object') ? budget : {};
    for (var i = 0; i < BUDGET_FIELDS.length; i++) {
      var f = BUDGET_FIELDS[i];
      var value = budgetValueToInput(f, src[f.key]);
      setVal(f.id, value);
    }
  }

  function budgetsEqual(a, b) {
    var ka = a ? Object.keys(a) : [];
    var kb = b ? Object.keys(b) : [];
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++) {
      var k = ka[i];
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      if (Number(a[k]) !== Number(b[k])) return false;
    }
    return true;
  }

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

  function statsRangeToWindow(range) {
    var days = 30;
    if (range === '7d')  days = 7;
    if (range === '30d') days = 30;
    if (range === '90d') days = 90;
    var until = new Date();
    var since = new Date(until.getTime() - days * 24 * 3600 * 1000);
    return { since: since.toISOString(), until: until.toISOString() };
  }

  // =========================================================================
  // Per-render state
  // =========================================================================

  function createState(slug) {
    return {
      slug: slug || null,
      agent: null,
      activeTab: 'capabilities',
      statsRange: '30d',
      statsLoaded: false,
      runsLoaded: false,
      editDisabledTools: {},
      editSnapshot: null,
      destroyed: false,
      _unbindFns: []
    };
  }

  // =========================================================================
  // Tab management
  // =========================================================================

  function switchTab(state, id) {
    state.activeTab = id || 'capabilities';
    var panels = {
      capabilities: el('agentPanelCapabilities'),
      runs:         el('agentPanelRuns'),
      stats:        el('agentPanelStats')
    };
    Object.keys(panels).forEach(function (k) {
      if (panels[k]) {
        if (k === state.activeTab) show(panels[k]);
        else hide(panels[k]);
      }
    });
    if (state.activeTab === 'runs')  loadRuns(state);
    if (state.activeTab === 'stats') loadStats(state);
  }

  function onAgentLoaded(state) {
    state.runsLoaded = false;
    state.statsLoaded = false;
    syncEnabledToggle(state);
    if (state.activeTab === 'runs')  loadRuns(state);
    if (state.activeTab === 'stats') loadStats(state);
  }

  function wireTabs(state) {
    var tabsEl = el('agentDetailTabs');
    if (!tabsEl) return;
    var handler = function (e) {
      // lex-tabs emits { tab, previous } on tab-change (see
      // src/js/lex/components/foundation/lex-tabs.js:266). Earlier wiring
      // read e.detail.id, which is undefined — so switchTab never fired
      // and the panel never swapped.
      var id = e.detail && (e.detail.tab || e.detail.id);
      if (id) switchTab(state, id);
    };
    tabsEl.addEventListener('tab-change', handler);
    state._unbindFns.push(function () { tabsEl.removeEventListener('tab-change', handler); });
  }

  // =========================================================================
  // Profile rendering
  // =========================================================================

  function renderProfile(state, agent) {
    state.agent = agent || {};

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

    var modelKv = el('agentDetailModelKv');
    if (modelKv) {
      modelKv.value = agent.model_slot || agent.model || 'default';
    }

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

  function loadRuns(state) {
    if (state.runsLoaded) return;
    if (!window.api || typeof window.api.get !== 'function') return;

    var loadingEl = el('agentDetailRunsLoading');
    var listEl = el('agentDetailRunsList');
    var emptyEl = el('agentDetailRunsEmpty');
    var countEl = el('agentDetailRunsCount');

    var agentDefinitionId = state.agent && state.agent.id;
    if (!agentDefinitionId) {
      show(loadingEl);
      if (listEl) listEl.innerHTML = '';
      hide(emptyEl);
      return;
    }

    state.runsLoaded = true;

    show(loadingEl);
    if (listEl) listEl.innerHTML = '';
    hide(emptyEl);

    var url = '/api/v1/agent-runs?agent_definition_id=' + encodeURIComponent(agentDefinitionId)
            + '&limit=20&sort_by=created_at&sort_order=desc';

    window.api.get(url)
      .then(function (resp) {
        if (state.destroyed) return;
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
        if (state.destroyed) return;
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

  function wireRunsList(ctx, state) {
    var listEl = el('agentDetailRunsList');
    if (!listEl) return;
    var handler = function (evt) {
      var row = evt.target.closest('.agent-detail-run-row');
      if (!row) return;
      var runId = row.getAttribute('data-run-id');
      if (runId) {
        ctx.app.setView('agentRun', { runId: runId });
      }
    };
    listEl.addEventListener('click', handler);
    state._unbindFns.push(function () { listEl.removeEventListener('click', handler); });
  }

  // =========================================================================
  // Banner buttons + drawer + enable toggle
  // =========================================================================

  function wireBannerButtons(ctx, state) {
    // lex-banner and lex-btn both clone their children during render (see
    // lex.core.js _captureContent + _restoreContent), so any listener
    // attached directly to el('agentDetailRunBtn') runs against a node
    // that's been replaced by a clone before the user can click it. Use
    // root-level click delegation against the stable view container so we
    // catch the click on whichever clone is live in the DOM.
    var rootForBanner = state._rootEl || document;
    var bannerClickHandler = function (e) {
      if (!e || !e.target || typeof e.target.closest !== 'function') return;
      if (e.target.closest('#agentDetailRunBtn')) {
        var modal = el('agentDetailRunModal');
        var input = el('agentDetailRunInput');
        if (input && typeof input.value !== 'undefined') input.value = '';
        if (modal) {
          modal.heading = 'Run: ' + (state.agent && (state.agent.name || state.agent.slug) || state.slug || '');
          modal.open = true;
        }
        return;
      }
      if (e.target.closest('#agentDetailConfigBtn')) {
        openEditDrawer(state);
        return;
      }
    };
    rootForBanner.addEventListener('click', bannerClickHandler);
    state._unbindFns.push(function () { rootForBanner.removeEventListener('click', bannerClickHandler); });

    var drawer = el('agentDetailConfigDrawer');
    if (drawer) {
      var saveHandler = function () { submitEdit(state); };
      drawer.addEventListener('lex-confirm', saveHandler);
      state._unbindFns.push(function () { drawer.removeEventListener('lex-confirm', saveHandler); });
    }

    var deleteBtn = el('agentDetailEditDeleteBtn');
    if (deleteBtn) {
      var deleteHandler = function () { confirmDelete(ctx, state); };
      deleteBtn.addEventListener('click', deleteHandler);
      state._unbindFns.push(function () { deleteBtn.removeEventListener('click', deleteHandler); });
    }

    var schedToggle = el('agentDetailEditScheduleEnabled');
    if (schedToggle) {
      var schedHandler = function (evt) {
        var checked = !!(evt && evt.detail && evt.detail.value);
        var fields = el('agentDetailEditScheduleFields');
        if (!fields) return;
        if (checked) show(fields); else hide(fields);
      };
      schedToggle.addEventListener('lex-change', schedHandler);
      state._unbindFns.push(function () { schedToggle.removeEventListener('lex-change', schedHandler); });
    }

    var toolsList = el('agentDetailEditToolsList');
    if (toolsList) {
      var toolHandler = function (evt) {
        var input = evt.target.closest('.agent-detail-edit-tool-checkbox');
        if (!input) return;
        var name = input.getAttribute('data-tool');
        if (!name) return;
        if (input.checked) delete state.editDisabledTools[name];
        else state.editDisabledTools[name] = true;
      };
      toolsList.addEventListener('change', toolHandler);
      state._unbindFns.push(function () { toolsList.removeEventListener('change', toolHandler); });
    }

    var enabledToggle = el('agentDetailEnabledToggle');
    if (enabledToggle) {
      var enabledHandler = function (evt) { onEnabledToggleChange(state, evt); };
      enabledToggle.addEventListener('lex-change', enabledHandler);
      state._unbindFns.push(function () { enabledToggle.removeEventListener('lex-change', enabledHandler); });
    }

    var modal = el('agentDetailRunModal');
    if (modal) {
      var modalHandler = function () { submitRun(ctx, state); };
      modal.addEventListener('lex-confirm', modalHandler);
      state._unbindFns.push(function () { modal.removeEventListener('lex-confirm', modalHandler); });
    }

    var statsRange = el('agentDetailStatsRange');
    if (statsRange) {
      var rangeHandler = function (evt) {
        var v = (evt && evt.detail && evt.detail.value) || (statsRange.value) || '30d';
        if (v === state.statsRange) return;
        state.statsRange = v;
        state.statsLoaded = false;
        if (state.activeTab === 'stats') loadStats(state);
      };
      statsRange.addEventListener('lex-change', rangeHandler);
      state._unbindFns.push(function () { statsRange.removeEventListener('lex-change', rangeHandler); });
    }
  }

  // -------------------------------------------------------------------------
  // Enable / disable toggle
  // -------------------------------------------------------------------------

  function syncEnabledToggle(state) {
    var toggle = el('agentDetailEnabledToggle');
    var status = el('agentDetailEnabledStatus');
    var block = el('agentDetailEnabledBlock');
    if (!block) return;

    if (!state.agent) {
      hide(block);
      if (toggle) hide(toggle);
      if (status) hide(status);
      return;
    }

    var system = isSystemAgent(state.agent);
    var active = (state.agent.is_active !== false);

    if (system) {
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

  function onEnabledToggleChange(state, evt) {
    if (!state.agent || !state.slug) return;
    if (isSystemAgent(state.agent)) {
      syncEnabledToggle(state);
      if (window.Lex && window.Lex.Toast) {
        window.Lex.Toast.info("System agents can't be disabled per-org from this UI; use the org kill switch in admin.");
      }
      return;
    }

    var desired = !!(evt && evt.detail && evt.detail.value);
    var path = desired ? 'enable' : 'disable';
    if (!window.api || typeof window.api.put !== 'function') return;

    window.api.put('/api/v1/agents/' + encodeURIComponent(state.slug) + '/' + path, {})
      .then(function (resp) {
        if (state.destroyed) return;
        var agent = (resp && resp.agent) ? resp.agent
                  : ((resp && resp.data) ? resp.data : resp);
        if (agent) {
          state.agent = agent;
          syncEnabledToggle(state);
        } else {
          if (state.agent) state.agent.is_active = desired;
        }
        if (window.Lex && window.Lex.Toast) {
          window.Lex.Toast.success(desired ? 'Agent enabled' : 'Agent disabled');
        }
        loadAgent(state);
      })
      .catch(function (err) {
        if (state.destroyed) return;
        console.error('[agent-detail] Toggle failed:', err);
        syncEnabledToggle(state);
        var status = err && (err.status || (err.response && err.response.status));
        var msg = desired ? 'Unable to enable agent' : 'Unable to disable agent';
        if (status === 401) msg = 'Your session expired. Please sign in again.';
        else if (status === 403) msg = 'You do not have permission to change this.';
        else if (status === 404) msg = 'This agent no longer exists.';
        if (window.Lex && window.Lex.Toast) window.Lex.Toast.error(msg);
      });
  }

  // -------------------------------------------------------------------------
  // Edit drawer
  // -------------------------------------------------------------------------

  function openEditDrawer(state) {
    var drawer = el('agentDetailConfigDrawer');
    if (!drawer) return;
    populateEditForm(state);
    state.editSnapshot = captureEditFormState(state);
    drawer.open = true;
  }

  function captureEditFormState(state) {
    var budget = readBudgetFromForm();
    if (budget && budget._invalid) budget = {};

    return {
      name: ((el('agentDetailEditName') && el('agentDetailEditName').value) || '').trim(),
      description: ((el('agentDetailEditDescription') && el('agentDetailEditDescription').value) || '').trim(),
      model_slot: (el('agentDetailEditModelSlot') && el('agentDetailEditModelSlot').value) || '',
      approval_policy: (el('agentDetailEditApprovalPolicy') && el('agentDetailEditApprovalPolicy').value) || 'none',
      disabled_tools: Object.assign({}, state.editDisabledTools || {}),
      schedule_enabled: !!(el('agentDetailEditScheduleEnabled') && el('agentDetailEditScheduleEnabled').checked),
      schedule_cron: ((el('agentDetailEditScheduleCron') && el('agentDetailEditScheduleCron').value) || '').trim(),
      schedule_timezone: (el('agentDetailEditScheduleTimezone') && el('agentDetailEditScheduleTimezone').value) || 'UTC',
      budget: budget
    };
  }

  function populateEditForm(state) {
    state.editDisabledTools = {};
    var a = state.agent || {};
    var system = isSystemAgent(a);

    setVal('agentDetailEditName', a.name || '');
    setVal('agentDetailEditDescription', a.description || '');

    var slotEl = el('agentDetailEditModelSlot');
    if (slotEl) {
      slotEl.options = MODEL_SLOTS.slice();
      slotEl.value = a.model_slot || 'agentic';
    }

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

    renderEditToolsCheckboxes(a.allowed_tools || []);

    var schedule = a.schedule || {};
    var scheduleEnabled = !!schedule.enabled;
    setChecked('agentDetailEditScheduleEnabled', scheduleEnabled);
    setVal('agentDetailEditScheduleCron', schedule.cron || '');

    var tzEl = el('agentDetailEditScheduleTimezone');
    if (tzEl) {
      tzEl.options = COMMON_TZS.slice();
      tzEl.value = schedule.timezone || 'UTC';
    }

    var schedFields = el('agentDetailEditScheduleFields');
    if (schedFields) {
      if (scheduleEnabled) show(schedFields); else hide(schedFields);
    }

    populateBudgetForm(a.budget || {});

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

  function buildEditBody(state) {
    var cur = captureEditFormState(state);
    var snap = state.editSnapshot || {};
    var body = {};

    if (cur.name !== (snap.name || '')) body.name = cur.name;
    if (cur.description !== (snap.description || '')) body.description = cur.description;
    if (cur.model_slot && cur.model_slot !== (snap.model_slot || '')) body.model_slot = cur.model_slot;
    if (cur.approval_policy !== (snap.approval_policy || 'none')) body.approval_policy = cur.approval_policy;

    var snapDisabled = snap.disabled_tools || {};
    var curDisabled = cur.disabled_tools || {};
    var toolsChanged = false;
    var seenKeys = {};
    var k;
    for (k in snapDisabled) { if (Object.prototype.hasOwnProperty.call(snapDisabled, k)) seenKeys[k] = true; }
    for (k in curDisabled) { if (Object.prototype.hasOwnProperty.call(curDisabled, k)) seenKeys[k] = true; }
    for (k in seenKeys) {
      if (!!snapDisabled[k] !== !!curDisabled[k]) { toolsChanged = true; break; }
    }
    if (toolsChanged) {
      var currentTools = ((state.agent && state.agent.allowed_tools) || []).map(toolName).filter(Boolean);
      body.allowed_tools = currentTools.filter(function (t) { return !curDisabled[t]; });
    }

    if (cur.schedule_enabled !== !!snap.schedule_enabled
        || cur.schedule_cron !== (snap.schedule_cron || '')
        || cur.schedule_timezone !== (snap.schedule_timezone || 'UTC')) {
      body.schedule = {
        enabled: cur.schedule_enabled,
        cron: cur.schedule_cron,
        timezone: cur.schedule_timezone
      };
    }

    var curBudget = (cur.budget && !cur.budget._invalid) ? cur.budget : {};
    var snapBudget = (snap.budget && !snap.budget._invalid) ? snap.budget : {};
    if (!budgetsEqual(curBudget, snapBudget)) {
      body.budget = curBudget;
    }

    return body;
  }

  function submitEdit(state) {
    var drawer = el('agentDetailConfigDrawer');
    if (!state.slug || !state.agent) {
      if (drawer) drawer.open = false;
      return;
    }
    if (isSystemAgent(state.agent)) {
      if (window.Lex && window.Lex.Toast) {
        window.Lex.Toast.info('System agents are managed centrally and cannot be edited here.');
      }
      if (drawer) drawer.open = false;
      return;
    }

    var body = buildEditBody(state);

    var curState = captureEditFormState(state);
    if (!curState.name) {
      if (window.Lex && window.Lex.Toast) window.Lex.Toast.error('Display name is required.');
      return;
    }
    if (curState.schedule_enabled && !curState.schedule_cron) {
      if (window.Lex && window.Lex.Toast) window.Lex.Toast.error('Schedule is enabled but no cron expression was provided.');
      return;
    }
    var rawBudget = readBudgetFromForm();
    if (rawBudget && rawBudget._invalid) {
      if (window.Lex && window.Lex.Toast) window.Lex.Toast.error(rawBudget._invalid);
      return;
    }
    if (Object.keys(body).length === 0) {
      if (drawer) drawer.open = false;
      if (window.Lex && window.Lex.Toast) window.Lex.Toast.info('No changes to save.');
      return;
    }

    if (!window.api || typeof window.api.put !== 'function') return;

    window.api.put('/api/v1/agents/' + encodeURIComponent(state.slug), body)
      .then(function (resp) {
        if (state.destroyed) return;
        var agent = (resp && resp.agent) ? resp.agent
                  : ((resp && resp.data) ? resp.data : resp);
        if (agent) {
          renderProfile(state, agent);
        }
        if (drawer) drawer.open = false;
        if (window.Lex && window.Lex.Toast) window.Lex.Toast.success('Agent updated');
      })
      .catch(function (err) {
        if (state.destroyed) return;
        console.error('[agent-detail] Save failed:', err);
        var status = err && (err.status || (err.response && err.response.status));
        var msg = 'Unable to save changes';
        if (status === 400) {
          msg = 'Some fields look invalid. Check name, tools, and schedule.';
        } else if (status === 401) {
          msg = 'Your session expired. Please sign in again.';
        } else if (status === 403) {
          msg = 'You do not have permission to edit this agent.';
        } else if (status === 404) {
          msg = 'This agent no longer exists.';
        }
        if (window.Lex && window.Lex.Toast) window.Lex.Toast.error(msg);
      });
  }

  // -------------------------------------------------------------------------
  // Delete confirm
  // -------------------------------------------------------------------------

  function confirmDelete(ctx, state) {
    if (!state.agent || !state.slug) return;
    if (isSystemAgent(state.agent)) {
      if (window.Lex && window.Lex.Toast) {
        window.Lex.Toast.info('System agents cannot be deleted from this UI.');
      }
      return;
    }
    if (!window.Lex || !window.Lex.Modal || typeof window.Lex.Modal.confirm !== 'function') {
      if (window.confirm('Delete this agent? This soft-disables it for your org.')) {
        performDelete(ctx, state);
      }
      return;
    }

    window.Lex.Modal.confirm(
      'Delete agent?',
      'This soft-disables "' + (state.agent.name || state.slug) + '" for your organization. Past runs are kept for audit but the agent will no longer accept new runs.',
      function () { performDelete(ctx, state); },
      { variant: 'danger', confirmText: 'Delete', cancelText: 'Cancel' }
    );
  }

  function performDelete(ctx, state) {
    if (!state.slug) return;
    if (!window.api || typeof window.api.delete !== 'function') return;

    window.api.delete('/api/v1/agents/' + encodeURIComponent(state.slug))
      .then(function (resp) {
        if (state.destroyed) return;
        var agent = (resp && resp.agent) ? resp.agent
                  : ((resp && resp.data) ? resp.data : resp);
        if (agent) {
          state.agent = agent;
          syncEnabledToggle(state);
        }
        var drawer = el('agentDetailConfigDrawer');
        if (drawer) drawer.open = false;
        if (window.Lex && window.Lex.Toast) window.Lex.Toast.success('Agent deleted');
        ctx.app.setView('catalog');
      })
      .catch(function (err) {
        if (state.destroyed) return;
        console.error('[agent-detail] Delete failed:', err);
        var status = err && (err.status || (err.response && err.response.status));
        var msg = 'Unable to delete agent';
        if (status === 401) msg = 'Your session expired. Please sign in again.';
        else if (status === 403) msg = 'You do not have permission to delete this agent.';
        else if (status === 404) msg = 'This agent no longer exists.';
        if (window.Lex && window.Lex.Toast) window.Lex.Toast.error(msg);
      });
  }

  // -------------------------------------------------------------------------
  // Stats tab
  // -------------------------------------------------------------------------

  function loadStats(state) {
    if (state.statsLoaded) return;
    if (!state.slug) return;
    if (!window.api || typeof window.api.get !== 'function') return;

    var loading      = el('agentDetailStatsLoading');
    var content      = el('agentDetailStatsContent');
    var unavailable  = el('agentDetailStatsUnavailable');

    show(loading);
    hide(content);
    hide(unavailable);

    var w = statsRangeToWindow(state.statsRange);
    var url = '/api/v1/agents/' + encodeURIComponent(state.slug) + '/stats'
            + '?since=' + encodeURIComponent(w.since)
            + '&until=' + encodeURIComponent(w.until);

    loadStatsTrends(state, w);

    window.api.get(url)
      .then(function (resp) {
        if (state.destroyed) return;
        state.statsLoaded = true;
        hide(loading);
        var stats = (resp && resp.data) ? resp.data : resp;
        if (!stats || typeof stats !== 'object') {
          show(unavailable);
          return;
        }
        renderStats(stats);
        show(content);
      })
      .catch(function (err) {
        if (state.destroyed) return;
        hide(loading);
        var status = err && (err.status || (err.response && err.response.status));
        if (status === 404 || status === 501) {
          show(unavailable);
          return;
        }
        console.error('[agent-detail] Stats fetch failed:', err);
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

    var totalRuns = Number(runs.total || 0);
    var totalRunsEl = el('agentDetailStatTotalRuns');
    if (totalRunsEl) totalRunsEl.value = formatInt(totalRuns);

    var byStatus = runs.by_status || {};
    var completed = Number(byStatus.completed || byStatus.approved || 0);
    var rate = totalRuns > 0 ? (completed / totalRuns * 100) : 0;
    var successEl = el('agentDetailStatSuccessRate');
    if (successEl) successEl.value = (totalRuns === 0 ? '-' : rate.toFixed(0) + '%');

    var medEl = el('agentDetailStatMedianDuration');
    if (medEl) medEl.value = formatDurationMs(duration.median_ms);

    var inTokens  = Number(cost.input_tokens || 0);
    var outTokens = Number(cost.output_tokens || 0);
    var totalTokens = Number(cost.total_tokens != null ? cost.total_tokens : (inTokens + outTokens));
    var tokensEl = el('agentDetailStatTotalTokens');
    if (tokensEl) tokensEl.value = formatInt(totalTokens);

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

  function loadStatsTrends(state, w) {
    var wrap = el('agentDetailStatsSparklineWrap');
    if (!wrap) return;
    hide(wrap);

    if (!state.slug) return;
    if (!window.api || typeof window.api.get !== 'function') return;

    var url = '/api/v1/agents/' + encodeURIComponent(state.slug) + '/stats/trends'
            + '?since=' + encodeURIComponent(w.since)
            + '&until=' + encodeURIComponent(w.until)
            + '&bucket=day';

    window.api.get(url)
      .then(function (resp) {
        if (state.destroyed) return;
        var payload = (resp && resp.data) ? resp.data : resp;
        var series = (payload && Array.isArray(payload.series)) ? payload.series
                   : (Array.isArray(payload) ? payload : []);
        if (!series || series.length === 0) {
          hide(wrap);
          return;
        }
        renderSparkline(series);
        show(wrap);
      })
      .catch(function (err) {
        if (state.destroyed) return;
        var status = err && (err.status || (err.response && err.response.status));
        if (status === 404 || status === 501) {
          hide(wrap);
          return;
        }
        console.warn('[agent-detail] Trends fetch failed:', err);
        hide(wrap);
      });
  }

  function renderSparkline(series) {
    var svg = el('agentDetailStatsSparkline');
    if (!svg) return;

    var points = [];
    for (var i = 0; i < series.length; i++) {
      var p = series[i];
      if (!p || typeof p !== 'object') continue;
      var ts = p.ts || p.bucket || p.timestamp || '';
      var total = Number(p.total != null ? p.total : 0);
      var completed = Number(p.completed != null ? p.completed : 0);
      if (isNaN(total)) total = 0;
      if (isNaN(completed)) completed = 0;
      points.push({ ts: ts, total: total, completed: completed });
    }

    if (points.length === 0) {
      svg.innerHTML = '';
      return;
    }

    var maxV = 0;
    for (var j = 0; j < points.length; j++) {
      if (points[j].total > maxV) maxV = points[j].total;
      if (points[j].completed > maxV) maxV = points[j].completed;
    }
    if (maxV <= 0) maxV = 1;

    var W = 200;
    var H = 40;
    var pad = 2;
    var xStep = points.length > 1 ? (W / (points.length - 1)) : 0;

    function xFor(idx) {
      if (points.length === 1) return W / 2;
      return idx * xStep;
    }
    function yFor(v) {
      var ratio = v / maxV;
      return (H - pad) - ratio * (H - pad * 2);
    }

    function buildPath(field) {
      var parts = [];
      for (var k = 0; k < points.length; k++) {
        parts.push(xFor(k).toFixed(2) + ',' + yFor(points[k][field]).toFixed(2));
      }
      return parts.join(' ');
    }

    var totalPts = buildPath('total');
    var completedPts = buildPath('completed');

    var hoverHtml = '';
    for (var m = 0; m < points.length; m++) {
      var hx = xFor(m).toFixed(2);
      var titleText = formatBucketTooltip(points[m]);
      var bandW = (xStep > 0 ? Math.max(xStep, 6) : 24);
      var bandX = (Number(hx) - bandW / 2).toFixed(2);
      hoverHtml += ''
        + '<rect class="agent-detail-stats-sparkline-hit" '
        + 'x="' + bandX + '" y="0" '
        + 'width="' + bandW.toFixed(2) + '" height="' + H + '" '
        + 'fill="transparent">'
        + '<title>' + escHtml(titleText) + '</title>'
        + '</rect>';
      hoverHtml += ''
        + '<circle class="agent-detail-stats-sparkline-dot agent-detail-stats-sparkline-dot--completed" '
        + 'cx="' + hx + '" cy="' + yFor(points[m].completed).toFixed(2) + '" r="1.5" />';
    }

    svg.innerHTML = ''
      + '<polyline class="agent-detail-stats-sparkline-line agent-detail-stats-sparkline-line--total" '
      +   'points="' + totalPts + '" fill="none" />'
      + '<polyline class="agent-detail-stats-sparkline-line agent-detail-stats-sparkline-line--completed" '
      +   'points="' + completedPts + '" fill="none" />'
      + hoverHtml;
  }

  function formatBucketTooltip(p) {
    if (!p) return '';
    var date = '';
    if (p.ts) {
      if (window.Lex && window.Lex.Utils && window.Lex.Utils.formatDate) {
        date = window.Lex.Utils.formatDate(p.ts);
      } else {
        var s = String(p.ts);
        date = s.length >= 10 ? s.substring(0, 10) : s;
      }
    }
    var line1 = date ? date : 'Bucket';
    return line1
      + ' — Total: ' + (p.total != null ? p.total : 0)
      + ', Completed: ' + (p.completed != null ? p.completed : 0);
  }

  function submitRun(ctx, state) {
    var input = el('agentDetailRunInput');
    var value = input && typeof input.value !== 'undefined' ? input.value : '';
    if (!value || !String(value).trim()) {
      if (window.Lex && window.Lex.Toast) window.Lex.Toast.error('Please describe what the agent should do.');
      return;
    }
    if (!window.api || typeof window.api.post !== 'function' || !state.slug) return;

    window.api.post('/api/v1/agents/' + encodeURIComponent(state.slug) + '/runs', {
      input: String(value).trim()
    })
      .then(function (resp) {
        if (state.destroyed) return;
        var runId = (resp && resp.run && resp.run.id)
                 || (resp && resp.data && resp.data.id)
                 || (resp && resp.id)
                 || (resp && resp.run_id);
        var modal = el('agentDetailRunModal');
        if (modal) modal.open = false;
        if (window.Lex && window.Lex.Toast) window.Lex.Toast.success('Run started');
        if (runId) {
          ctx.app.setView('agentRun', { runId: runId });
        } else {
          console.warn('[agent-detail] Run started but no id in response:', resp);
          if (window.Lex && window.Lex.Toast) {
            window.Lex.Toast.info('Run started, but we could not open the live view. Check the Runs tab.');
          }
        }
      })
      .catch(function (err) {
        if (state.destroyed) return;
        console.error('[agent-detail] Run start failed:', err);
        var status = err && (err.status || (err.response && err.response.status));
        var msg = 'Unable to start run';
        if (status === 401) msg = 'Your session expired. Please sign in again.';
        else if (status === 404) msg = 'This agent no longer exists.';
        if (window.Lex && window.Lex.Toast) window.Lex.Toast.error(msg);
      });
  }

  // =========================================================================
  // Data
  // =========================================================================

  function loadAgent(state) {
    if (!state.slug) return;
    if (!window.api || typeof window.api.get !== 'function') {
      var onReady = function () { loadAgent(state); };
      state._lexReadyHandler = onReady;
      document.addEventListener('lex-ready', onReady, { once: true });
      return;
    }

    window.api.get('/api/v1/agents/' + encodeURIComponent(state.slug))
      .then(function (resp) {
        if (state.destroyed) return;
        var agent = (resp && resp.agent) ? resp.agent
                  : ((resp && resp.data) ? resp.data : resp);
        if (!agent) {
          renderProfile(state, { slug: state.slug, name: state.slug, description: 'Agent not found.' });
          return;
        }
        renderProfile(state, agent);
        onAgentLoaded(state);
        loadWorkflow(state);
      })
      .catch(function (err) {
        if (state.destroyed) return;
        console.error('[agent-detail] Failed to load agent:', err);
        showLoadError(state, err);
      });
  }

  // =========================================================================
  // Workflow viewer (Phase 6) — read-only state-machine display
  // =========================================================================

  function loadWorkflow(state) {
    if (state.destroyed || !state.slug) return;
    if (!window.api || typeof window.api.get !== 'function') return;
    window.api.get('/api/v1/agents/' + encodeURIComponent(state.slug) + '/workflows')
      .then(function (resp) {
        if (state.destroyed) return;
        var workflow = resp && resp.workflow ? resp.workflow : null;
        renderWorkflow(workflow);
      })
      .catch(function (err) {
        if (state.destroyed) return;
        // Non-fatal: capability tab still renders without the workflow card.
        console.warn('[agent-detail] Failed to load workflow:', err && err.message);
      });
  }

  function renderWorkflow(workflow) {
    var emptyEl = el('agentDetailWorkflowEmpty');
    var metaEl = el('agentDetailWorkflowMeta');
    var listEl = el('agentDetailWorkflowStates');
    if (!emptyEl || !metaEl || !listEl) return;

    var def = workflow && workflow.definition;
    var states = def && Array.isArray(def.states) ? def.states : [];
    if (!workflow || states.length === 0) {
      show(emptyEl);
      hide(metaEl);
      hide(listEl);
      listEl.innerHTML = '';
      return;
    }

    hide(emptyEl);
    show(metaEl);
    show(listEl);

    var versionEl = el('agentDetailWorkflowVersion');
    var countEl = el('agentDetailWorkflowStateCount');
    var initialEl = el('agentDetailWorkflowInitial');
    if (versionEl) versionEl.textContent = String(workflow.version != null ? workflow.version : '-');
    if (countEl) countEl.textContent = String(states.length);
    if (initialEl) initialEl.textContent = String(def.initial_state || '-');

    var html = '';
    for (var i = 0; i < states.length; i++) {
      var s = states[i] || {};
      var typeLabel = String(s.type || 'state');
      var typeMod = workflowTypeModifier(typeLabel);
      var nextHint = renderWorkflowNextHint(s);
      html += ''
        + '<li class="agent-detail-workflow-state">'
        +   '<div class="agent-detail-workflow-state-head">'
        +     '<span class="agent-detail-workflow-state-id">' + escHtml(String(s.id || '')) + '</span>'
        +     '<span class="agent-detail-chip agent-detail-workflow-type ' + typeMod + '">' + escHtml(typeLabel) + '</span>'
        +   '</div>'
        +   (nextHint ? '<div class="agent-detail-workflow-state-next">' + nextHint + '</div>' : '')
        + '</li>';
    }
    listEl.innerHTML = html;
  }

  function workflowTypeModifier(type) {
    switch (type) {
      case 'tool_call':       return 'agent-detail-workflow-type--tool';
      case 'llm_call':        return 'agent-detail-workflow-type--llm';
      case 'human_approval':  return 'agent-detail-workflow-type--approval';
      case 'branch':          return 'agent-detail-workflow-type--branch';
      case 'terminal':        return 'agent-detail-workflow-type--terminal';
      default:                return '';
    }
  }

  function renderWorkflowNextHint(s) {
    if (s && s.type === 'terminal') return '&rarr; (end)';
    if (s && s.type === 'branch') {
      return '&rarr; ' + escHtml(String(s.true_state || '?')) + ' / ' + escHtml(String(s.false_state || '?'));
    }
    if (s && s.next) return '&rarr; ' + escHtml(String(s.next));
    if (s && Array.isArray(s.transitions) && s.transitions.length > 0 && s.transitions[0].to) {
      return '&rarr; ' + escHtml(String(s.transitions[0].to));
    }
    return '';
  }

  function showLoadError(state, err) {
    var status = err && (err.status || (err.response && err.response.status));
    var descEl = el('agentDetailDescription');
    var loading = el('agentPanelCapabilitiesLoading');
    var content = el('agentPanelCapabilitiesContent');
    hide(loading);
    show(content);

    var message;
    if (status === 401) {
      message = 'Your session expired. Please sign in again.';
      if (window.Lex && window.Lex.Toast) window.Lex.Toast.error(message);
      if (window.Lex && window.Lex.Nav) window.Lex.Nav.go('login.html');
    } else if (status === 404) {
      message = 'This agent no longer exists.';
    } else {
      message = 'Something went wrong loading this agent. Try again.';
    }
    if (descEl) descEl.textContent = message;

    var banner = el('agentDetailBanner');
    if (banner) {
      banner.heading = state.slug || 'Agent';
      banner.subtitle = message;
    }
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  function render(rootEl, ctx) {
    rootEl.innerHTML = TEMPLATE;

    var slug = ctx && ctx.slug;
    var state = createState(slug);
    state._rootEl = rootEl;
    rootEl._agentDetailState = state;

    wireTabs(state);
    wireRunsList(ctx, state);
    wireBannerButtons(ctx, state);
    switchTab(state, state.activeTab);
    loadAgent(state);
  }

  function destroy(rootEl) {
    var state = rootEl && rootEl._agentDetailState;
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
    rootEl._agentDetailState = null;
  }

  global.LanaAgentsApp.Views.agentDetail = { render: render, destroy: destroy };
})(typeof window !== 'undefined' ? window : globalThis);
