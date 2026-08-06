/* agent-run.js — Live agent run viewer SPA view (SSE stream + artifacts).
   Migrated from src/js/pages/agent-run.js. Reads ctx.runId. Subscribes to
   GET /api/v1/agent-runs/:id/stream via fetch+ReadableStream (SSE), renders
   incremental reasoning steps, tool calls, sub-agent delegations on the
   left, artifacts on the right with Approve / Reject / Apply controls.

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

  // Markup template — extracted from src/agents/agent-run.html (the
  // <main class="agent-run-page-container"> body, dropping the outer
  // <div id="lex-page-content"> wrapper). The Back link's text content is
  // preserved; the click handler is rewired to call ctx.app.setView.
  var TEMPLATE = ''
    + '<main class="agent-run-page-container">'

    + '<div class="agent-run-header">'
    +   '<div class="agent-run-header-row">'
    +     '<div class="agent-run-header-titles">'
    +       '<a id="agentRunBackLink" href="#catalog" class="agent-run-back-link">&larr; Back</a>'
    +       '<h1 id="agentRunAgentName" class="agent-run-agent-name">Agent</h1>'
    +       '<p id="agentRunTitle" class="agent-run-title">Loading run...</p>'
    +     '</div>'
    +     '<div class="agent-run-header-meta">'
    +       '<span id="agentRunStatusBadge" class="agent-run-badge">--</span>'
    +       '<span id="agentRunPriorityBadge" class="agent-run-badge agent-run-badge--priority">--</span>'
    +       '<span id="agentRunOutcomeBadge" class="agent-run-badge agent-run-badge--outcome hidden">--</span>'
    +       '<span id="agentRunTimer" class="agent-run-timer">--</span>'
    +     '</div>'
    +   '</div>'
    +   '<div class="agent-run-header-actions">'
    +     '<button type="button" class="lana-dock-trigger" data-lana-dock-trigger data-lana-context-type="full_chat" aria-label="Ask LANA" title="Ask LANA">'
    +       '<span class="lana-dock-trigger-icon" aria-hidden="true">'
    +         '<svg viewBox="0 0 12 12"><path d="M1 5V1h4"/><path d="M11 7v4H7"/></svg>'
    +         '<svg viewBox="0 0 12 12"><path d="M1 5V1h4"/><path d="M11 7v4H7"/></svg>'
    +       '</span>'
    +       '<span>LANA</span>'
    +     '</button>'
    +     '<lex-btn id="agentRunCancelBtn" variant="ghost" size="sm">Cancel Run</lex-btn>'
    +   '</div>'
    +   '<div id="agentRunLegalHarnessStrip" class="agent-run-legal-strip hidden"></div>'
    + '</div>'

    + '<div class="agent-run-body">'

    +   '<section class="agent-run-pane agent-run-pane--stream">'
    +     '<header class="agent-run-pane-header">'
    +       '<span class="agent-run-pane-title">Activity</span>'
    +       '<span id="agentRunStreamStatus" class="agent-run-pane-status">Connecting...</span>'
    +     '</header>'
    +     '<div id="agentRunStreamContent" class="agent-run-stream-content">'
    +       '<div class="agent-run-stream-empty">'
    +         '<lex-spinner size="sm"></lex-spinner>'
    +         '<span>Subscribing to event stream...</span>'
    +       '</div>'
    +     '</div>'
    +   '</section>'

    +   '<section class="agent-run-pane agent-run-pane--artifacts">'
    +     '<header class="agent-run-pane-header">'
    +       '<span class="agent-run-pane-title">Artifacts</span>'
    +       '<span id="agentRunArtifactsCount" class="agent-run-pane-status"></span>'
    +     '</header>'
    +     '<div id="agentRunArtifactsContent" class="agent-run-artifacts-content">'
    +       '<div class="agent-run-artifacts-empty">'
    +         '<lex-empty'
    +           ' icon="file-text"'
    +           ' message="No artifacts yet"'
    +           ' description="Artifacts produced by this run will appear here."'
    +         '></lex-empty>'
    +       '</div>'
    +     '</div>'
    +   '</section>'

    +   '<section id="agentRunWorkflowPane" class="agent-run-pane agent-run-pane--workflow hidden">'
    +     '<header class="agent-run-pane-header">'
    +       '<span class="agent-run-pane-title">Workflow Steps</span>'
    +       '<span id="agentRunWorkflowStepsCount" class="agent-run-pane-status"></span>'
    +     '</header>'
    +     '<ol id="agentRunWorkflowStepsList" class="agent-run-workflow-steps"></ol>'
    +   '</section>'

    + '</div>'

    + '<div id="agentRunApprovalBar" class="agent-run-approval-bar hidden">'
    +   '<span class="agent-run-approval-summary" id="agentRunApprovalSummary"></span>'
    +   '<div class="agent-run-approval-actions">'
    +     '<lex-btn id="agentRunRejectAllBtn" class="agent-run-bulk-btn hidden" data-action="bulk-reject" variant="ghost" size="sm">Reject all</lex-btn>'
    +     '<lex-btn id="agentRunApproveAllBtn" class="agent-run-bulk-btn hidden" data-action="bulk-approve" variant="secondary" size="sm">Approve all</lex-btn>'
    +     '<lex-btn id="agentRunApplyApprovedBtn" class="agent-run-bulk-btn hidden" data-action="bulk-apply" variant="primary" size="sm">Apply approved</lex-btn>'
    +   '</div>'
    + '</div>'

    + '</main>';

  var escHtml = (typeof window !== 'undefined' && window.Lex && window.Lex.Utils && window.Lex.Utils.escapeHtml)
    ? window.Lex.Utils.escapeHtml
    : function (s) { var d = document.createElement('div'); d.textContent = (s == null ? '' : String(s)); return d.innerHTML; };

  var BULK_CONCURRENCY = 3;
  var BULK_PROGRESS_EVERY = 3;

  // =========================================================================
  // Helpers
  // =========================================================================

  function el(id) { return document.getElementById(id); }
  function show(node) { if (node) node.classList.remove('hidden'); }
  function hide(node) { if (node) node.classList.add('hidden'); }

  function statusBadgeMods(status) {
    if (status === 'running' || status === 'compiling_context' || status === 'queued') return 'agent-run-badge--running';
    if (status === 'awaiting_input' || status === 'awaiting_approval')                 return 'agent-run-badge--awaiting';
    if (status === 'completed' || status === 'approved')                                return 'agent-run-badge--complete';
    if (status === 'failed' || status === 'rejected')                                   return 'agent-run-badge--failed';
    if (status === 'cancelled')                                                         return 'agent-run-badge--cancel';
    return '';
  }

  function priorityBadgeMod(priority) {
    if (priority === 'urgent') return 'agent-run-badge--priority-urgent';
    if (priority === 'high')   return 'agent-run-badge--priority-high';
    if (priority === 'medium') return 'agent-run-badge--priority-medium';
    if (priority === 'low')    return 'agent-run-badge--priority-low';
    return 'agent-run-badge--priority-medium';
  }

  function statusLabel(status) {
    if (!status) return '--';
    if (status === 'compiling_context') return 'Compiling';
    if (status === 'awaiting_input')    return 'Needs Input';
    if (status === 'awaiting_approval') return 'Awaiting Approval';
    return String(status).replace('_', ' ');
  }

  function isTerminal(status) {
    return status === 'completed' || status === 'failed'
        || status === 'rejected'  || status === 'cancelled';
  }

  function fmtMs(ms) {
    if (ms == null || ms < 0) return '--';
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    s = s - m * 60;
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return pad(m) + ':' + pad(s);
  }

  // =========================================================================
  // Per-render state
  // =========================================================================

  function createState(runId) {
    return {
      runId: runId || null,
      run: null,
      abortCtrl: null,
      streamConnected: false,
      timerInterval: null,
      startTimeMs: null,
      steps: [],
      artifacts: [],
      legalHarnessManifest: null,
      artifactStates: {},
      opInFlight: false,
      destroyed: false,
      _unbindFns: []
    };
  }

  // =========================================================================
  // Header
  // =========================================================================

  function renderHeader(state, run) {
    state.run = run || {};

    var nameEl = el('agentRunAgentName');
    if (nameEl) nameEl.textContent = run.agent_name || run.agent_slug || 'Agent';

    var titleEl = el('agentRunTitle');
    if (titleEl) titleEl.textContent = run.title || ('Run ' + (run.id || '').slice(0, 8));

    var statusBadge = el('agentRunStatusBadge');
    if (statusBadge) {
      statusBadge.className = 'agent-run-badge ' + statusBadgeMods(run.status);
      statusBadge.textContent = statusLabel(run.status);
    }

    var priBadge = el('agentRunPriorityBadge');
    if (priBadge) {
      priBadge.className = 'agent-run-badge agent-run-badge--priority ' + priorityBadgeMod(run.priority);
      priBadge.textContent = (run.priority || 'medium').toUpperCase();
    }

    if (run.started_at) {
      state.startTimeMs = new Date(run.started_at).getTime();
      startTimer(state);
    } else if (run.created_at) {
      state.startTimeMs = new Date(run.created_at).getTime();
      startTimer(state);
    }

    if (isTerminal(run.status)) {
      stopTimer(state);
      var cancelBtn = el('agentRunCancelBtn');
      if (cancelBtn) cancelBtn.disabled = true;
      var streamStatus = el('agentRunStreamStatus');
      if (streamStatus) streamStatus.textContent = 'Closed';
    }

    renderLegalHarnessStrip(state);

    document.title = (run.agent_name || run.agent_slug || 'Run') + ' - LANA AI';
  }

  function renderLegalHarnessStrip(state) {
    var strip = el('agentRunLegalHarnessStrip');
    if (!strip) return;
    var manifest = state && state.legalHarnessManifest;
    if (!manifest) {
      hide(strip);
      strip.innerHTML = '';
      return;
    }
    var data = manifest.manifest || manifest.output_jsonb || manifest.output || manifest;
    var policy = data.policy || {};
    var feature = data.feature_flag || data.featureFlag || {};
    var enabled = feature.enabled !== false;
    strip.innerHTML = ''
      + '<span class="agent-run-legal-strip-label">Legal harness</span>'
      + '<strong>' + escHtml(enabled ? 'Enabled' : 'Disabled') + '</strong>'
      + (policy.policy_version ? '<span>' + escHtml(policy.policy_version) + '</span>' : '')
      + (policy.fail_closed_unknown === true ? '<span>Fail-closed unknown tools</span>' : '');
    show(strip);
  }

  function startTimer(state) {
    if (state.timerInterval) return;
    var update = function () {
      var timerEl = el('agentRunTimer');
      if (!timerEl || state.startTimeMs == null) return;
      var elapsed = LanaTime.millisecondsSince(state.startTimeMs);
      timerEl.textContent = fmtMs(elapsed);
    };
    update();
    state.timerInterval = setInterval(update, 1000);
  }

  function stopTimer(state) {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
  }

  // =========================================================================
  // Stream pane rendering
  // =========================================================================

  function ensureStreamSections() {
    var content = el('agentRunStreamContent');
    if (!content) return null;

    var stepsContainer = content.querySelector('.agent-run-step-list');
    var eventsContainer = content.querySelector('.agent-run-event-list');

    if (!stepsContainer) {
      content.innerHTML = ''
        + '<div class="agent-run-step-list" data-role="steps"></div>'
        + '<div class="agent-run-event-list" data-role="events"></div>';
      stepsContainer = content.querySelector('.agent-run-step-list');
      eventsContainer = content.querySelector('.agent-run-event-list');
    }

    return { stepsContainer: stepsContainer, eventsContainer: eventsContainer };
  }

  function renderStepsBlock(state) {
    var sections = ensureStreamSections();
    if (!sections || !sections.stepsContainer) return;
    var BlockRenderer = window.Lex && window.Lex.BlockRenderer;
    if (!BlockRenderer) {
      var html = '';
      for (var i = 0; i < state.steps.length; i++) {
        var s = state.steps[i];
        html += '<div class="agent-run-event"><div class="agent-run-event-head">'
              + '<span class="agent-run-event-icon agent-run-event-icon--' + escHtml(s.status === 'complete' ? 'complete' : (s.status === 'error' ? 'error' : 'running')) + '"></span>'
              + '<span>' + escHtml(s.title) + '</span>'
              + '</div></div>';
      }
      sections.stepsContainer.innerHTML = html;
      return;
    }
    BlockRenderer.render(sections.stepsContainer, [{
      type: 'reasoning_steps',
      steps: state.steps
    }]);
  }

  function appendEventRow(html) {
    var sections = ensureStreamSections();
    if (!sections || !sections.eventsContainer) return;
    var div = document.createElement('div');
    div.innerHTML = html;
    while (div.firstChild) sections.eventsContainer.appendChild(div.firstChild);
    var content = el('agentRunStreamContent');
    if (content) content.scrollTop = content.scrollHeight;
  }

  function handleStepStart(state, data) {
    var stepNumber = data.step_number || data.number || (state.steps.length + 1);
    var title = data.title || data.description || ('Step ' + stepNumber);
    for (var i = 0; i < state.steps.length; i++) {
      if (state.steps[i].status === 'active') state.steps[i].status = 'complete';
    }
    state.steps.push({ number: stepNumber, title: title, status: 'active' });
    renderStepsBlock(state);
  }

  function handleStepComplete(state, data) {
    var stepNumber = data.step_number || data.number;
    var found = false;
    for (var i = 0; i < state.steps.length; i++) {
      if (state.steps[i].number === stepNumber || (!stepNumber && state.steps[i].status === 'active')) {
        state.steps[i].status = 'complete';
        found = true;
        break;
      }
    }
    if (!found && stepNumber) {
      state.steps.push({
        number: stepNumber,
        title: data.title || data.description || ('Step ' + stepNumber),
        status: 'complete'
      });
    }
    renderStepsBlock(state);
  }

  function handleStepError(state, data) {
    var stepNumber = data.step_number || data.number;
    for (var i = 0; i < state.steps.length; i++) {
      if (state.steps[i].number === stepNumber || (!stepNumber && state.steps[i].status === 'active')) {
        state.steps[i].status = 'error';
        if (data.message || data.error) {
          state.steps[i].title = (state.steps[i].title || '') + ' — ' + (data.message || data.error);
        }
        break;
      }
    }
    renderStepsBlock(state);
  }

  function handleToolCall(data) {
    var name = data.tool || data.tool_name || data.name || 'tool';
    var input = data.input != null ? data.input : data.args;
    var output = data.output != null ? data.output : data.result;

    var inputStr = '';
    var outputStr = '';
    try { inputStr = typeof input === 'string' ? input : JSON.stringify(input, null, 2); } catch (e) { inputStr = String(input); }
    try { outputStr = typeof output === 'string' ? output : JSON.stringify(output, null, 2); } catch (e) { outputStr = String(output); }

    var html = ''
      + '<details class="agent-run-tool">'
      +   '<summary class="agent-run-tool-summary">'
      +     '<span>Tool</span>'
      +     '<span class="agent-run-tool-name">' + escHtml(name) + '</span>'
      +     (data.duration_ms != null ? '<span class="agent-run-event-meta">' + escHtml(data.duration_ms) + 'ms</span>' : '')
      +   '</summary>'
      +   '<div class="agent-run-tool-detail">'
      +     (inputStr ? '<span class="agent-run-tool-section-label">Input</span>' + escHtml(inputStr) : '')
      +     (outputStr ? '<span class="agent-run-tool-section-label agent-run-tool-section-label--spaced">Output</span>' + escHtml(outputStr) : '')
      +   '</div>'
      + '</details>';
    appendEventRow(html);
  }

  function handleSubAgentDelegation(data) {
    var childRunId = data.child_run_id || data.run_id || data.id;
    var childAgent = data.agent_name || data.agent_slug || 'sub-agent';
    var childStatus = data.status || 'queued';

    var html = ''
      + '<details class="agent-run-subagent">'
      +   '<summary class="agent-run-subagent-summary">'
      +     '<span class="agent-run-event-icon agent-run-event-icon--running"></span>'
      +     '<span>Delegated to <strong>' + escHtml(childAgent) + '</strong></span>'
      +     '<span class="agent-run-event-meta">' + escHtml(statusLabel(childStatus)) + '</span>'
      +     (childRunId ? '<a href="#" class="agent-run-subagent-link" data-child-run="' + escHtml(childRunId) + '">View</a>' : '')
      +   '</summary>'
      +   '<div class="agent-run-tool-detail">'
      +     '<span class="agent-run-tool-section-label">Child run</span>'
      +     (childRunId ? escHtml(childRunId) : '(no id)')
      +   '</div>'
      + '</details>';
    appendEventRow(html);
  }

  function handleAgenticProgress(data) {
    if (window.AgenticUI && typeof window.AgenticUI.handleAgenticProgress === 'function') {
      try { window.AgenticUI.handleAgenticProgress(data); return; } catch (e) { /* fallthrough */ }
    }
    var msg = data && (data.stepDescription || data.message || data.description || 'Progress');
    appendEventRow(''
      + '<div class="agent-run-event">'
      +   '<div class="agent-run-event-head">'
      +     '<span class="agent-run-event-icon agent-run-event-icon--running"></span>'
      +     '<span>' + escHtml(msg) + '</span>'
      +   '</div>'
      + '</div>');
  }

  function handleAgenticComplete(data) {
    if (window.AgenticUI && typeof window.AgenticUI.handleAgenticComplete === 'function') {
      try { window.AgenticUI.handleAgenticComplete(data); return; } catch (e) { /* fallthrough */ }
    }
    appendEventRow(''
      + '<div class="agent-run-event">'
      +   '<div class="agent-run-event-head">'
      +     '<span class="agent-run-event-icon agent-run-event-icon--complete"></span>'
      +     '<span>Run complete</span>'
      +   '</div>'
      + '</div>');
  }

  function handleStatusChange(state, data) {
    if (data && data.status) {
      state.run.status = data.status;
      renderHeader(state, state.run);
    }
  }

  function handleArtifactCreated(state, data) {
    var artifact = (data && data.artifact) ? data.artifact : data;
    if (!artifact) return;
    for (var i = 0; i < state.artifacts.length; i++) {
      if (state.artifacts[i].id === artifact.id) {
        state.artifacts[i] = artifact;
        renderArtifacts(state);
        return;
      }
    }
    state.artifacts.push(artifact);
    renderArtifacts(state);
  }

  // =========================================================================
  // Artifact rendering
  // =========================================================================

  function getArtifactState(state, artifact) {
    return state.artifactStates[artifact.id] || artifact.state || artifact.status || 'pending';
  }

  function setArtifactState(state, id, value) {
    state.artifactStates[id] = value;
    renderArtifacts(state);
  }

  function renderArtifacts(state) {
    var container = el('agentRunArtifactsContent');
    if (!container) return;

    if (state.artifacts.length === 0) {
      container.innerHTML = ''
        + '<div class="agent-run-artifacts-empty">'
        +   '<lex-empty icon="file-text" message="No artifacts yet" description="Artifacts produced by this run will appear here."></lex-empty>'
        + '</div>';
      hide(el('agentRunApprovalBar'));
      var countElEmpty = el('agentRunArtifactsCount');
      if (countElEmpty) countElEmpty.textContent = '';
      return;
    }

    var countEl = el('agentRunArtifactsCount');
    if (countEl) countEl.textContent = state.artifacts.length + (state.artifacts.length === 1 ? ' artifact' : ' artifacts');

    container.innerHTML = '';
    for (var i = 0; i < state.artifacts.length; i++) {
      var card = buildArtifactCard(state, state.artifacts[i]);
      if (card) container.appendChild(card);
    }

    show(el('agentRunApprovalBar'));
    updateApprovalSummary(state);
    updateBulkButtonVisibility(state);
  }

  function updateApprovalSummary(state) {
    var pending = 0, approved = 0, rejected = 0;
    for (var i = 0; i < state.artifacts.length; i++) {
      var s = getArtifactState(state, state.artifacts[i]);
      if (s === 'approved') approved++;
      else if (s === 'rejected') rejected++;
      else pending++;
    }
    var summary = pending + ' pending · ' + approved + ' approved · ' + rejected + ' rejected';
    var sumEl = el('agentRunApprovalSummary');
    if (sumEl) sumEl.textContent = summary;
  }

  function buildArtifactCard(state, artifact) {
    var card = document.createElement('div');
    card.className = 'agent-run-artifact-card';
    card.dataset.artifactId = artifact.id || '';

    var kind = artifact.kind || artifact.type || 'unknown';
    var title = artifact.title || artifact.name || ('Artifact ' + (artifact.id || '').slice(0, 8));
    var artState = getArtifactState(state, artifact);
    var stateClass = '';
    if (artState === 'approved') stateClass = 'agent-run-artifact-state--approved';
    else if (artState === 'rejected') stateClass = 'agent-run-artifact-state--rejected';
    else if (artState === 'applied') stateClass = 'agent-run-artifact-state--applied';

    var head = document.createElement('div');
    head.className = 'agent-run-artifact-head';
    head.innerHTML = ''
      + '<span class="agent-run-artifact-kind">' + escHtml(kind) + '</span>'
      + '<span class="agent-run-artifact-title">' + escHtml(title) + '</span>'
      + '<span class="agent-run-artifact-state ' + stateClass + '">' + escHtml(artState) + '</span>'
      + renderValidationChip(artifact.validation)
      + renderLegalApprovalChip(artifact)
      + renderProvenanceChip(artifact);
    card.appendChild(head);

    // Phase 7: when validation failed, surface the zod errors directly under
    // the head so reviewers can see WHY the artifact got flipped to 'failed'.
    if (artifact.validation && artifact.validation.status === 'invalid') {
      card.appendChild(renderValidationErrorPanel(artifact.validation));
    }
    if (artifact.application_gate_failure) {
      card.appendChild(renderApplicationGateFailurePanel(artifact.application_gate_failure));
    }
    if (artifact.provenance_ref || artifact.approval_decision_history || artifact.approval_decisions) {
      card.appendChild(renderArtifactMetadataPanel(artifact));
    }

    var body = document.createElement('div');
    body.className = 'agent-run-artifact-body';
    renderArtifactBody(state, body, artifact, kind);
    card.appendChild(body);

    var actions = document.createElement('div');
    actions.className = 'agent-run-artifact-actions';
    var disableApprove = (artState === 'approved' || artState === 'applied');
    var disableReject  = (artState === 'rejected');
    actions.innerHTML = ''
      + '<lex-btn variant="ghost" size="sm" data-art-action="reject" data-artifact-id="' + escHtml(artifact.id || '') + '"' + (disableReject ? ' disabled' : '') + '>Reject</lex-btn>'
      + '<lex-btn variant="secondary" size="sm" data-art-action="approve" data-artifact-id="' + escHtml(artifact.id || '') + '"' + (disableApprove ? ' disabled' : '') + '>Approve</lex-btn>'
      + '<lex-btn variant="primary" size="sm" data-art-action="apply" data-artifact-id="' + escHtml(artifact.id || '') + '">Apply</lex-btn>';
    card.appendChild(actions);

    return card;
  }

  function renderArtifactBody(state, container, artifact, kind) {
    if (!container) return;
    var BlockRenderer = window.Lex && window.Lex.BlockRenderer;

    if (kind === 'epic' || kind === 'sprint' || kind === 'task' || kind === 'matter_plan') {
      var planEl = document.createElement('lex-agentic-plan-card');
      planEl.plan = artifact.payload || artifact.plan || artifact;
      planEl.status = getArtifactState(state, artifact);
      planEl.setAttribute('approval-id', artifact.id || '');
      container.appendChild(planEl);
      return;
    }

    if (kind === 'document_draft' || kind === 'redline') {
      if (BlockRenderer) {
        var redlineBlock;
        if (kind === 'redline' && artifact.payload && Array.isArray(artifact.payload.segments)) {
          redlineBlock = Object.assign({ type: 'redline' }, artifact.payload);
        } else if (artifact.payload && Array.isArray(artifact.payload.segments)) {
          redlineBlock = Object.assign({ type: 'redline' }, artifact.payload);
        } else {
          redlineBlock = {
            type: 'redline',
            title: artifact.title || 'Document draft',
            segments: [{ text: artifact.content || JSON.stringify(artifact.payload || {}, null, 2), type: 'unchanged' }]
          };
        }
        BlockRenderer.render(container, [redlineBlock]);
        return;
      }
    }

    if (kind === 'automation_rule') {
      if (BlockRenderer && artifact.payload && Array.isArray(artifact.payload.rows)) {
        BlockRenderer.render(container, [Object.assign({ type: 'compare' }, artifact.payload)]);
        return;
      }
    }

    var pre = document.createElement('pre');
    pre.className = 'agent-run-artifact-fallback';
    var raw;
    try {
      raw = JSON.stringify(artifact.payload || artifact, null, 2);
    } catch (e) {
      raw = String(artifact.payload || artifact);
    }
    pre.textContent = raw;
    container.appendChild(pre);
  }

  // =========================================================================
  // Artifact actions
  // =========================================================================

  function callArtifactEndpoint(state, artifactId, action, body) {
    if (!window.api || typeof window.api.post !== 'function' || !state.runId || !artifactId) {
      return Promise.reject(new Error('api unavailable'));
    }
    return window.api.post(
      '/api/v1/agent-runs/' + encodeURIComponent(state.runId) + '/artifacts/' + encodeURIComponent(artifactId) + '/' + action,
      body || {}
    );
  }

  function approveArtifact(state, id) {
    return callArtifactEndpoint(state, id, 'approve')
      .then(function () {
        if (state.destroyed) return;
        setArtifactState(state, id, 'approved');
        if (window.Lex && window.Lex.Toast) window.Lex.Toast.success('Artifact approved');
      })
      .catch(function (err) {
        console.error('[agent-run] approve failed:', err);
        if (window.Lex && window.Lex.Toast) window.Lex.Toast.error('Approve failed');
      });
  }

  function rejectArtifact(state, id) {
    return callArtifactEndpoint(state, id, 'reject')
      .then(function () {
        if (state.destroyed) return;
        setArtifactState(state, id, 'rejected');
        if (window.Lex && window.Lex.Toast) window.Lex.Toast.info('Artifact rejected');
      })
      .catch(function (err) {
        console.error('[agent-run] reject failed:', err);
        if (window.Lex && window.Lex.Toast) window.Lex.Toast.error('Reject failed');
      });
  }

  function applyArtifact(state, id) {
    return callArtifactEndpoint(state, id, 'apply')
      .then(function () {
        if (state.destroyed) return;
        setArtifactState(state, id, 'applied');
        if (window.Lex && window.Lex.Toast) window.Lex.Toast.success('Artifact applied');
      })
      .catch(function (err) {
        if (err && (err.status === 501 || (err.response && err.response.status === 501))) {
          var btn = document.querySelector('[data-art-action="apply"][data-artifact-id="' + (id || '').replace('"', '') + '"]');
          if (btn) btn.disabled = true;
          if (window.Lex && window.Lex.Toast) window.Lex.Toast.info('Apply not yet supported');
          return;
        }
        console.error('[agent-run] apply failed:', err);
        if (window.Lex && window.Lex.Toast) window.Lex.Toast.error('Apply failed');
      });
  }

  function wireArtifactActions(state) {
    var container = el('agentRunArtifactsContent');
    if (!container) return;

    var handler = function (evt) {
      var btn = evt.target.closest('[data-art-action]');
      if (!btn) return;
      if (state.opInFlight) return;
      var action = btn.getAttribute('data-art-action');
      var id = btn.getAttribute('data-artifact-id');
      if (!action || !id) return;

      state.opInFlight = true;
      setAllArtifactControlsDisabled(true);
      var p;
      if (action === 'approve') p = approveArtifact(state, id);
      else if (action === 'reject') p = rejectArtifact(state, id);
      else if (action === 'apply') p = applyArtifact(state, id);
      else p = Promise.resolve();

      Promise.resolve(p).then(function () {
        if (state.destroyed) return;
        state.opInFlight = false;
        setAllArtifactControlsDisabled(false);
        renderArtifacts(state);
      });
    };
    container.addEventListener('click', handler);
    state._unbindFns.push(function () { container.removeEventListener('click', handler); });
  }

  // =========================================================================
  // Bulk approve / reject / apply
  // =========================================================================

  function isPending(state, artifact) {
    var s = getArtifactState(state, artifact);
    return s === 'pending' || s === 'awaiting_approval' || s === 'proposed';
  }

  function isApproved(state, artifact) {
    return getArtifactState(state, artifact) === 'approved';
  }

  function pendingArtifacts(state) {
    return state.artifacts.filter(function (a) { return isPending(state, a); });
  }

  function approvedArtifacts(state) {
    return state.artifacts.filter(function (a) { return isApproved(state, a); });
  }

  function pMap(items, mapper, concurrency) {
    var limit = Math.max(1, concurrency || 1);
    var results = new Array(items.length);
    var nextIndex = 0;
    var active = 0;
    var done = 0;

    return new Promise(function (resolve) {
      if (items.length === 0) { resolve(results); return; }

      function launch() {
        while (active < limit && nextIndex < items.length) {
          (function (i) {
            active++;
            Promise.resolve()
              .then(function () { return mapper(items[i], i); })
              .then(function (value) { results[i] = { ok: true, value: value }; })
              .catch(function (error) { results[i] = { ok: false, error: error }; })
              .then(function () {
                active--;
                done++;
                if (done === items.length) { resolve(results); return; }
                launch();
              });
          })(nextIndex++);
        }
      }

      launch();
    });
  }

  function setBulkButtonsDisabled(disabled) {
    var ids = ['agentRunApproveAllBtn', 'agentRunRejectAllBtn', 'agentRunApplyApprovedBtn'];
    for (var i = 0; i < ids.length; i++) {
      var b = el(ids[i]);
      if (b) b.disabled = !!disabled;
    }
  }

  function setPerArtifactButtonsDisabled(disabled) {
    var perItem = document.querySelectorAll('[data-art-action]');
    for (var j = 0; j < perItem.length; j++) {
      perItem[j].disabled = !!disabled;
    }
  }

  function setAllArtifactControlsDisabled(disabled) {
    setBulkButtonsDisabled(disabled);
    setPerArtifactButtonsDisabled(disabled);
  }

  function bulkApproveOne(state, id) {
    return callArtifactEndpoint(state, id, 'approve');
  }
  function bulkRejectOne(state, id) {
    return callArtifactEndpoint(state, id, 'reject');
  }
  function bulkApplyOne(state, id) {
    return callArtifactEndpoint(state, id, 'apply');
  }

  function summarizeAndToast(verb, results) {
    var ok = 0, fail = 0;
    var failedIds = [];
    for (var i = 0; i < results.length; i++) {
      if (results[i] && results[i].ok) {
        ok++;
      } else {
        fail++;
        if (results[i] && results[i]._artifactId) {
          failedIds.push({ id: results[i]._artifactId, error: results[i].error });
        }
      }
    }
    if (failedIds.length) {
      console.error('[agent-run] bulk ' + verb + ' failures:', failedIds);
    }
    if (!(window.Lex && window.Lex.Toast)) return;
    if (fail === 0) {
      window.Lex.Toast.success(verb + ' ' + ok + ' of ' + results.length);
    } else if (ok === 0) {
      window.Lex.Toast.error(verb + ' failed for all ' + fail + ' items');
    } else {
      window.Lex.Toast.warning(verb + ' ' + ok + ' of ' + results.length + '; ' + fail + ' failed');
    }
  }

  function refreshRun(state) {
    if (!state.runId || !window.api || typeof window.api.get !== 'function') {
      return Promise.resolve({ refreshed: false, error: null });
    }
    return window.api.get('/api/v1/agent-runs/' + encodeURIComponent(state.runId))
      .then(function (resp) {
        if (state.destroyed) return { refreshed: false, error: null };
        var run = (resp && resp.run) ? resp.run
                : ((resp && resp.data) ? resp.data : resp);
        var steps = (resp && resp.steps) || (run && run.steps) || [];
        var artifacts = (resp && resp.artifacts) || (run && run.artifacts) || [];
        if (!run) return { refreshed: false, error: null };
        state.legalHarnessManifest = (resp && resp.legal_harness_manifest)
          || (run && run.legal_harness_manifest)
          || state.legalHarnessManifest
          || null;
        state.artifactStates = {};
        renderHeader(state, run);
        hydrateSteps(state, steps);
        hydrateArtifacts(state, artifacts);
        return { refreshed: true, error: null };
      })
      .catch(function (err) {
        console.warn('[agent-run] refresh after bulk op failed:', err);
        return { refreshed: false, error: err };
      });
  }

  function runBulk(state, action, targets, mapper, verb) {
    if (state.opInFlight) return Promise.resolve();
    if (!targets || targets.length === 0) return Promise.resolve();

    state.opInFlight = true;
    setAllArtifactControlsDisabled(true);
    var total = targets.length;
    var completed = 0;

    if (window.Lex && window.Lex.Toast) {
      window.Lex.Toast.info(verb + ' ' + total + ' artifact' + (total === 1 ? '' : 's') + '...');
    }

    var wrappedMapper = function (artifact) {
      var aid = artifact && artifact.id;
      return Promise.resolve()
        .then(function () { return mapper(state, aid); })
        .then(function (value) {
          completed++;
          if (window.Lex && window.Lex.Toast
              && completed % BULK_PROGRESS_EVERY === 0
              && completed < total) {
            window.Lex.Toast.info(verb + ' ' + completed + ' of ' + total + '...');
          }
          return value;
        })
        .catch(function (err) {
          completed++;
          var tagged;
          if (err && typeof err === 'object') {
            try { err._artifactId = aid; tagged = err; }
            catch (assignErr) { tagged = { _artifactId: aid, original: err }; }
          } else {
            tagged = { _artifactId: aid, original: err };
          }
          throw tagged;
        });
    };

    return pMap(targets, wrappedMapper, BULK_CONCURRENCY)
      .then(function (results) {
        for (var i = 0; i < results.length; i++) {
          if (!results[i].ok && results[i].error) {
            results[i]._artifactId = results[i].error._artifactId;
          }
        }
        summarizeAndToast(verb, results);
        return refreshRun(state);
      })
      .then(function (refreshResult) {
        if (state.destroyed) return;
        state.opInFlight = false;
        if (refreshResult && refreshResult.refreshed === false) {
          if (window.Lex && window.Lex.Toast) {
            window.Lex.Toast.warning(verb + ' completed, but failed to refresh — reload to see latest state.');
          }
          setPerArtifactButtonsDisabled(false);
          return;
        }
        setAllArtifactControlsDisabled(false);
      })
      .catch(function (err) {
        console.error('[agent-run] bulk ' + action + ' fatal:', err);
        if (state.destroyed) return;
        state.opInFlight = false;
        setAllArtifactControlsDisabled(false);
      });
  }

  function bulkApprove(state) { return runBulk(state, 'approve', pendingArtifacts(state), bulkApproveOne, 'Approved'); }
  function bulkReject(state)  { return runBulk(state, 'reject',  pendingArtifacts(state), bulkRejectOne,  'Rejected'); }
  function bulkApply(state)   { return runBulk(state, 'apply',   approvedArtifacts(state), bulkApplyOne,   'Applied'); }

  function updateBulkButtonVisibility(state) {
    var pending = pendingArtifacts(state).length;
    var approved = approvedArtifacts(state).length;

    var approveBtn = el('agentRunApproveAllBtn');
    var rejectBtn = el('agentRunRejectAllBtn');
    var applyBtn = el('agentRunApplyApprovedBtn');

    if (approveBtn) approveBtn.classList.toggle('hidden', pending === 0);
    if (rejectBtn) rejectBtn.classList.toggle('hidden', pending === 0);
    if (applyBtn) applyBtn.classList.toggle('hidden', approved === 0);
  }

  function wireApprovalBar(state) {
    var bar = el('agentRunApprovalBar');
    if (!bar) return;
    var handler = function (evt) {
      var btn = evt.target.closest('[data-action]');
      if (!btn) return;
      if (state.opInFlight) return;
      var action = btn.getAttribute('data-action');
      if (action === 'bulk-approve') bulkApprove(state);
      else if (action === 'bulk-reject') bulkReject(state);
      else if (action === 'bulk-apply') bulkApply(state);
    };
    bar.addEventListener('click', handler);
    state._unbindFns.push(function () { bar.removeEventListener('click', handler); });
  }

  // =========================================================================
  // SSE stream
  // =========================================================================

  function _resolveBaseUrl() {
    if (window.api && window.api.baseUrl) return window.api.baseUrl;
    try {
      var saved = localStorage.getItem('lana_saved_server');
      if (saved) {
        var info = JSON.parse(saved);
        if (info && info.url) return info.url;
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  function _getToken() {
    if (window.Lex && window.Lex.state && window.Lex.state.token) return window.Lex.state.token;
    return localStorage.getItem('token') || localStorage.getItem('access_token') || '';
  }

  function dispatchEvent(state, eventName, data) {
    if (eventName === 'snapshot') {
      var snapRun = (data && data.run) ? data.run : data;
      state.legalHarnessManifest = (data && data.legal_harness_manifest)
        || (snapRun && snapRun.legal_harness_manifest)
        || state.legalHarnessManifest
        || null;
      if (snapRun) {
        renderHeader(state, snapRun);
      }
      hydrateSteps(state, (data && data.steps) || (snapRun && snapRun.steps) || []);
      hydrateArtifacts(state, (data && data.artifacts) || (snapRun && snapRun.artifacts) || []);
      return;
    }
    if (eventName === 'end') {
      if (state.run && !isTerminal(state.run.status)) {
        handleStatusChange(state, { status: 'completed' });
      }
      var streamStatus = el('agentRunStreamStatus');
      if (streamStatus) streamStatus.textContent = 'Closed';
      stopStream(state);
      return;
    }
    if (eventName === 'agent_step_start')        return handleStepStart(state, data);
    if (eventName === 'agent_step_complete')     return handleStepComplete(state, data);
    if (eventName === 'agent_step_error')        return handleStepError(state, data);
    if (eventName === 'tool_call')                return handleToolCall(data);
    if (eventName === 'sub_agent_delegation')    return handleSubAgentDelegation(data);
    if (eventName === 'agentic_progress')        return handleAgenticProgress(data);
    if (eventName === 'agentic_complete')        return handleAgenticComplete(data);
    if (eventName === 'status_change' || eventName === 'run_status') return handleStatusChange(state, data);
    if (eventName === 'artifact_created' || eventName === 'artifact') return handleArtifactCreated(state, data);
    if (eventName === 'run_complete') {
      handleAgenticComplete(data);
      handleStatusChange(state, { status: 'completed' });
      stopStream(state);
      return;
    }
  }

  function startStream(state) {
    if (state.streamConnected) return;
    if (!state.runId) return;

    var baseUrl = _resolveBaseUrl();
    if (!baseUrl) {
      var statusEl = el('agentRunStreamStatus');
      if (statusEl) statusEl.textContent = 'Server unavailable';
      return;
    }

    state.abortCtrl = new AbortController();
    state.streamConnected = true;

    var streamStatus = el('agentRunStreamStatus');
    if (streamStatus) streamStatus.textContent = 'Streaming';

    setStreamingFlag(true);

    var url = baseUrl + '/api/v1/agent-runs/' + encodeURIComponent(state.runId) + '/stream';
    var token = _getToken();

    fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream',
        'Authorization': token ? 'Bearer ' + token : ''
      },
      signal: state.abortCtrl.signal
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('HTTP ' + response.status);
        }
        var reader = response.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';
        var currentEvent = null;

        function pump() {
          return reader.read().then(function (chunk) {
            if (state.destroyed) return;
            if (chunk.done) {
              if (streamStatus) streamStatus.textContent = 'Closed';
              return;
            }
            buffer += decoder.decode(chunk.value, { stream: true });
            var lines = buffer.split('\n');
            buffer = lines.pop();

            for (var i = 0; i < lines.length; i++) {
              var line = lines[i];
              if (line.indexOf('event:') === 0) {
                currentEvent = line.slice(6).trim();
                continue;
              }
              if (line.indexOf('data:') === 0) {
                var raw = line.slice(5).trim();
                if (!raw) continue;
                var parsed;
                try {
                  parsed = JSON.parse(raw);
                } catch (e) {
                  console.error('[agent-run] malformed SSE JSON:', e, raw);
                  if (window.Lex && window.Lex.Toast) {
                    window.Lex.Toast.error('Stream message could not be parsed');
                  }
                  if (streamStatus) streamStatus.textContent = 'Stream parse error';
                  continue;
                }
                dispatchEvent(state, currentEvent || 'message', parsed);
                currentEvent = null;
              }
            }
            return pump();
          });
        }
        return pump();
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') {
          if (streamStatus) streamStatus.textContent = 'Closed';
          return;
        }
        console.error('[agent-run] stream error:', err);
        if (streamStatus) streamStatus.textContent = 'Disconnected';
      })
      .then(function () {
        state.streamConnected = false;
        setStreamingFlag(false);
      });
  }

  function setStreamingFlag(active) {
    try {
      if (window.Lex && window.Lex.state) {
        window.Lex.state.isStreaming = !!active;
        return;
      }
    } catch (e) { /* fall through */ }
    if (window.api) {
      if (active && typeof window.api.setStreamingActive === 'function') {
        window.api.setStreamingActive();
      } else if (!active && typeof window.api.setStreamingInactive === 'function') {
        window.api.setStreamingInactive();
      }
    }
  }

  function stopStream(state) {
    if (state.abortCtrl) {
      try { state.abortCtrl.abort(); } catch (e) { /* ignore */ }
      state.abortCtrl = null;
    }
    state.streamConnected = false;
    setStreamingFlag(false);
  }

  // =========================================================================
  // Detail load (initial state + existing artifacts)
  // =========================================================================

  function loadRun(state) {
    if (!state.runId) return;
    if (!window.api || typeof window.api.get !== 'function') {
      var onReady = function () { loadRun(state); };
      state._lexReadyHandler = onReady;
      document.addEventListener('lex-ready', onReady, { once: true });
      return;
    }

    window.api.get('/api/v1/agent-runs/' + encodeURIComponent(state.runId))
      .then(function (resp) {
        if (state.destroyed) return;
        var run = (resp && resp.run) ? resp.run
                : ((resp && resp.data) ? resp.data : resp);
        var steps = (resp && resp.steps) || (run && run.steps) || [];
        var artifacts = (resp && resp.artifacts) || (run && run.artifacts) || [];
        // Phase 6: workflow state-machine ledger (separate from the
        // reasoning-step `steps` above — only present when the run was
        // workflow-driven).
        var runSteps = (resp && resp.run_steps) || [];
        // Phase 7: categorical outcome row from agent_run_outcomes.
        var outcome = resp && resp.outcome ? resp.outcome : null;
        if (!run) return;
        state.legalHarnessManifest = (resp && resp.legal_harness_manifest)
          || (run && run.legal_harness_manifest)
          || null;
        renderHeader(state, run);
        hydrateSteps(state, steps);
        hydrateArtifacts(state, artifacts);
        hydrateWorkflowSteps(state, runSteps);
        hydrateOutcome(state, outcome);

        if (!isTerminal(run.status)) {
          startStream(state);
        } else {
          var streamStatus = el('agentRunStreamStatus');
          if (streamStatus) streamStatus.textContent = 'Closed';
        }
      })
      .catch(function (err) {
        if (state.destroyed) return;
        console.error('[agent-run] failed to load run:', err);
        showLoadError(state, err);
      });
  }

  // =========================================================================
  // Phase 7: Per-artifact validation (agent_artifact_validations sidecar)
  // =========================================================================

  function renderValidationChip(validation) {
    if (!validation || !validation.status) return '';
    var status = String(validation.status);
    var label;
    var mod;
    switch (status) {
      case 'valid':   label = 'Schema OK';      mod = 'agent-run-artifact-validation--valid';   break;
      case 'invalid': label = 'Schema invalid'; mod = 'agent-run-artifact-validation--invalid'; break;
      case 'skipped': label = 'No schema';      mod = 'agent-run-artifact-validation--skipped'; break;
      default:        label = status;           mod = '';
    }
    return '<span class="agent-run-artifact-validation ' + mod + '">' + escHtml(label) + '</span>';
  }

  function renderValidationErrorPanel(validation) {
    var panel = document.createElement('div');
    panel.className = 'agent-run-artifact-validation-panel';
    var errors = validation && (validation.errors_jsonb || validation.errors);
    var list = '';
    if (Array.isArray(errors)) {
      for (var i = 0; i < errors.length; i++) {
        var e = errors[i] || {};
        var path = Array.isArray(e.path) ? e.path.join('.') : (e.path || '');
        var msg = e.message || (typeof e === 'string' ? e : JSON.stringify(e));
        list += '<li>'
          + (path ? '<code class="agent-run-artifact-validation-path">' + escHtml(path) + '</code> ' : '')
          + '<span class="agent-run-artifact-validation-msg">' + escHtml(msg) + '</span>'
          + '</li>';
      }
    } else if (errors) {
      try { list = '<li><pre>' + escHtml(JSON.stringify(errors, null, 2)) + '</pre></li>'; } catch (_) {}
    }
    panel.innerHTML = ''
      + '<div class="agent-run-artifact-validation-panel-head">Schema validation failed</div>'
      + '<ol class="agent-run-artifact-validation-errors">' + (list || '<li>(no error details)</li>') + '</ol>';
    return panel;
  }

  function renderLegalApprovalChip(artifact) {
    var legal = artifact && (artifact.legal_approval || (artifact.payload && artifact.payload.legal_approval));
    if (!legal && artifact && artifact.approval_decision_history && artifact.approval_decision_history.length) {
      for (var i = 0; i < artifact.approval_decision_history.length; i++) {
        var row = artifact.approval_decision_history[i] || {};
        var meta = row.metadata || {};
        var payload = meta.payload || meta;
        if (payload && payload.legal_approval) {
          legal = payload.legal_approval;
          break;
        }
      }
    }
    if (!legal) return '';
    var tier = String(legal.risk_tier || legal.riskTier || 'legal').toLowerCase();
    var mod = tier === 'critical' || tier === 'high'
      ? 'agent-run-artifact-legal-chip--high'
      : 'agent-run-artifact-legal-chip--normal';
    return '<span class="agent-run-artifact-legal-chip ' + mod + '">Legal ' + escHtml(tier) + '</span>';
  }

  function renderProvenanceChip(artifact) {
    var ref = artifact && artifact.provenance_ref;
    if (!ref) return '';
    var status = ref.lookup_status || ref.recording_mode || 'provenance';
    return '<span class="agent-run-artifact-provenance-chip">Provenance ' + escHtml(status) + '</span>';
  }

  function renderApplicationGateFailurePanel(failure) {
    var panel = document.createElement('div');
    panel.className = 'agent-run-artifact-legal-panel agent-run-artifact-legal-panel--blocked';
    var code = failure && failure.code ? String(failure.code) : 'legal_application_gate_blocked';
    var message = failure && failure.message ? String(failure.message) : legalFailureMessage(code);
    var checks = Array.isArray(failure && failure.checks) ? failure.checks : [];
    var checksHtml = '';
    for (var i = 0; i < checks.length; i++) {
      var c = checks[i] || {};
      checksHtml += '<li>'
        + '<span>' + escHtml(c.name || 'check') + '</span>'
        + '<strong>' + escHtml(c.ok === false ? 'blocked' : 'passed') + '</strong>'
        + (c.reason ? '<em>' + escHtml(c.reason) + '</em>' : '')
        + '</li>';
    }
    panel.innerHTML = ''
      + '<div class="agent-run-artifact-legal-panel-head">Legal application blocked</div>'
      + '<div class="agent-run-artifact-legal-panel-message">'
      +   escHtml(legalFailureMessage(code))
      + '</div>'
      + '<div class="agent-run-artifact-legal-panel-code">' + escHtml(code) + '</div>'
      + (message && message !== legalFailureMessage(code)
        ? '<div class="agent-run-artifact-legal-panel-detail">' + escHtml(message) + '</div>'
        : '')
      + (failure && failure.output_hash
        ? '<div class="agent-run-artifact-legal-panel-detail">Output hash: <code>' + escHtml(failure.output_hash) + '</code></div>'
        : '')
      + (checksHtml ? '<ul class="agent-run-artifact-legal-checks">' + checksHtml + '</ul>' : '');
    return panel;
  }

  function renderArtifactMetadataPanel(artifact) {
    var ref = artifact && artifact.provenance_ref;
    var history = artifact && (artifact.approval_decision_history || artifact.approval_decisions) || [];
    if (!ref && (!history || history.length === 0)) return document.createTextNode('');
    var panel = document.createElement('div');
    panel.className = 'agent-run-artifact-meta-panel';
    var rows = '';
    if (ref) {
      rows += '<div><span>Provenance</span><strong>' + escHtml(ref.lookup_status || ref.recording_mode || 'available') + '</strong></div>';
      if (ref.output_hash) rows += '<div><span>Output hash</span><code>' + escHtml(shortHash(ref.output_hash)) + '</code></div>';
    }
    if (history && history.length > 0) {
      rows += '<div><span>Approval decisions</span><strong>' + escHtml(String(history.length)) + '</strong></div>';
    }
    panel.innerHTML = rows;
    return panel;
  }

  function legalFailureMessage(code) {
    switch (code) {
      case 'privilege_review_required':
        return 'Privilege review is required before this artifact can be applied.';
      case 'disclosure_evidence_missing':
        return 'Disclosure-like output needs cited source documents before it can be applied.';
      case 'disclosure_gate_disabled':
        return 'The disclosure gate must be enabled before this disclosure-like artifact can be applied.';
      case 'disclosure_blocked':
        return 'A source document is blocked by the disclosure gate.';
      case 'unresolved_conflict':
        return 'A conflict marker is unresolved and must be cleared first.';
      default:
        return 'The legal application gate blocked this artifact.';
    }
  }

  function shortHash(value) {
    var s = String(value || '');
    return s.length > 16 ? s.slice(0, 12) + '...' : s;
  }

  // =========================================================================
  // Phase 7: Categorical outcome (agent_run_outcomes sidecar)
  // =========================================================================

  function hydrateOutcome(state, outcome) {
    var badge = el('agentRunOutcomeBadge');
    if (!badge) return;
    if (!outcome || !outcome.outcome) {
      hide(badge);
      return;
    }
    show(badge);
    badge.className = 'agent-run-badge agent-run-badge--outcome ' + outcomeBadgeMod(outcome.outcome);
    badge.textContent = outcomeLabel(outcome.outcome);
    badge.setAttribute('title', outcomeTooltip(outcome));
  }

  function outcomeBadgeMod(outcome) {
    switch (outcome) {
      case 'success':         return 'agent-run-badge--outcome-success';
      case 'output_invalid':  return 'agent-run-badge--outcome-invalid';
      case 'tool_error':      return 'agent-run-badge--outcome-tool-error';
      case 'model_error':     return 'agent-run-badge--outcome-model-error';
      case 'cancelled':       return 'agent-run-badge--outcome-cancelled';
      case 'human_rejected':  return 'agent-run-badge--outcome-rejected';
      default:                return '';
    }
  }

  function outcomeLabel(outcome) {
    switch (outcome) {
      case 'success':         return 'Success';
      case 'output_invalid':  return 'Output invalid';
      case 'tool_error':      return 'Tool error';
      case 'model_error':     return 'Model error';
      case 'cancelled':       return 'Cancelled';
      case 'human_rejected':  return 'Rejected';
      default:                return outcome;
    }
  }

  function outcomeTooltip(outcome) {
    var parts = ['Outcome: ' + outcomeLabel(outcome.outcome)];
    if (outcome.classified_at) parts.push('Classified ' + outcome.classified_at);
    var reason = outcome.reason_jsonb || outcome.reason;
    if (reason) {
      try { parts.push('Reason: ' + JSON.stringify(reason)); } catch (_) {}
    }
    return parts.join('\n');
  }

  // =========================================================================
  // Phase 6: Workflow step trace (run_steps from agent_run_steps sidecar)
  // =========================================================================

  function hydrateWorkflowSteps(state, runSteps) {
    var pane = el('agentRunWorkflowPane');
    var listEl = el('agentRunWorkflowStepsList');
    var countEl = el('agentRunWorkflowStepsCount');
    if (!pane || !listEl) return;

    if (!Array.isArray(runSteps) || runSteps.length === 0) {
      hide(pane);
      listEl.innerHTML = '';
      if (countEl) countEl.textContent = '';
      return;
    }
    show(pane);
    if (countEl) countEl.textContent = runSteps.length + ' step' + (runSteps.length === 1 ? '' : 's');

    var html = '';
    for (var i = 0; i < runSteps.length; i++) {
      var s = runSteps[i] || {};
      var status = String(s.status || 'pending');
      var statusMod = workflowStepStatusMod(status);
      var typeLabel = s.state_type || s.state || '';
      var startedRel = s.started_at ? LanaTime.timeAgo(s.started_at) : '';
      var dur = (s.started_at && s.completed_at)
        ? formatDurationMs(new Date(s.completed_at).getTime() - new Date(s.started_at).getTime())
        : '';
      html += ''
        + '<li class="agent-run-workflow-step ' + statusMod + '">'
        +   '<span class="agent-run-workflow-step-index">' + (i + 1) + '</span>'
        +   '<span class="agent-run-workflow-step-id">' + escHtml(String(s.step_id || '')) + '</span>'
        +   (typeLabel ? '<span class="agent-run-workflow-step-type">' + escHtml(String(typeLabel)) + '</span>' : '')
        +   '<span class="agent-run-workflow-step-status">' + escHtml(status) + '</span>'
        +   (dur ? '<span class="agent-run-workflow-step-dur">' + escHtml(dur) + '</span>' : '')
        +   (startedRel ? '<span class="agent-run-workflow-step-time">' + escHtml(startedRel) + '</span>' : '')
        + '</li>';
    }
    listEl.innerHTML = html;
  }

  function workflowStepStatusMod(status) {
    if (status === 'running') return 'agent-run-workflow-step--running';
    if (status === 'completed') return 'agent-run-workflow-step--complete';
    if (status === 'errored') return 'agent-run-workflow-step--error';
    if (status === 'skipped') return 'agent-run-workflow-step--skipped';
    return 'agent-run-workflow-step--pending';
  }

  function formatDurationMs(ms) {
    if (!ms || isNaN(ms) || ms < 0) return '';
    if (ms < 1000) return ms + 'ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
    if (ms < 3600000) return Math.floor(ms / 60000) + 'm ' + Math.floor((ms % 60000) / 1000) + 's';
    return Math.floor(ms / 3600000) + 'h';
  }

  function hydrateSteps(state, steps) {
    if (!Array.isArray(steps)) return;
    state.steps = [];
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i] || {};
      state.steps.push({
        number: s.step_number || s.number || (i + 1),
        title: s.title || s.description || ('Step ' + (i + 1)),
        status: s.status === 'complete' || s.status === 'completed' ? 'complete'
              : (s.status === 'error' || s.status === 'failed' ? 'error'
              : (s.status === 'active' || s.status === 'running' ? 'active' : 'pending'))
      });
    }
    renderStepsBlock(state);
  }

  function hydrateArtifacts(state, artifacts) {
    if (!Array.isArray(artifacts)) return;
    state.artifacts = artifacts.slice();
    renderArtifacts(state);
  }

  function showLoadError(state, err) {
    var streamStatus = el('agentRunStreamStatus');
    var status = err && (err.status || (err.response && err.response.status));
    var msg = 'Unable to load run';
    if (status === 401) {
      msg = 'Your session expired. Please sign in again.';
      if (window.Lex && window.Lex.Toast) window.Lex.Toast.error(msg);
      if (window.Lex && window.Lex.Nav) window.Lex.Nav.go('login.html');
    } else if (status === 404) {
      msg = 'This run no longer exists.';
    } else {
      msg = 'Something went wrong loading this run.';
    }
    if (streamStatus) streamStatus.textContent = msg;
    var titleEl = el('agentRunTitle');
    if (titleEl) titleEl.textContent = msg;
  }

  // =========================================================================
  // Header buttons
  // =========================================================================

  function wireHeaderButtons(ctx, state) {
    var cancelBtn = el('agentRunCancelBtn');
    if (cancelBtn) {
      var cancelHandler = function () {
        if (!state.runId || !window.api) return;
        window.api.post('/api/v1/agent-runs/' + encodeURIComponent(state.runId) + '/cancel', {})
          .then(function () {
            if (window.Lex && window.Lex.Toast) window.Lex.Toast.info('Cancellation requested');
          })
          .catch(function (err) {
            console.error('[agent-run] cancel failed:', err);
            if (window.Lex && window.Lex.Toast) window.Lex.Toast.error('Cancel failed');
          });
      };
      cancelBtn.addEventListener('click', cancelHandler);
      state._unbindFns.push(function () { cancelBtn.removeEventListener('click', cancelHandler); });
    }

    var back = el('agentRunBackLink');
    if (back) {
      var backHandler = function (e) {
        e.preventDefault();
        ctx.app.setView('catalog');
      };
      back.addEventListener('click', backHandler);
      state._unbindFns.push(function () { back.removeEventListener('click', backHandler); });
    }

    var streamEl = el('agentRunStreamContent');
    if (streamEl) {
      var subHandler = function (evt) {
        var link = evt.target.closest('[data-child-run]');
        if (!link) return;
        evt.preventDefault();
        var childId = link.getAttribute('data-child-run');
        if (childId) {
          ctx.app.setView('agentRun', { runId: childId });
        }
      };
      streamEl.addEventListener('click', subHandler);
      state._unbindFns.push(function () { streamEl.removeEventListener('click', subHandler); });
    }
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  function render(rootEl, ctx) {
    var activityDetail = global.LanaAgentsApp
      && global.LanaAgentsApp.Views
      && global.LanaAgentsApp.Views.activityDetail;
    if (activityDetail && typeof activityDetail.render === 'function') {
      rootEl._agentRunDelegatedToActivityDetail = true;
      activityDetail.render(rootEl, Object.assign({}, ctx || {}, {
        id: ctx && (ctx.runId || ctx.id)
      }));
      return;
    }

    rootEl.innerHTML = TEMPLATE;

    var runId = ctx && ctx.runId;
    var state = createState(runId);
    rootEl._agentRunState = state;

    wireHeaderButtons(ctx, state);
    wireArtifactActions(state);
    wireApprovalBar(state);

    if (!state.runId) {
      var streamStatus = el('agentRunStreamStatus');
      if (streamStatus) streamStatus.textContent = 'Missing run id';
      return;
    }

    loadRun(state);
  }

  function destroy(rootEl) {
    if (rootEl && rootEl._agentRunDelegatedToActivityDetail) {
      var activityDetail = global.LanaAgentsApp
        && global.LanaAgentsApp.Views
        && global.LanaAgentsApp.Views.activityDetail;
      if (activityDetail && typeof activityDetail.destroy === 'function') {
        activityDetail.destroy(rootEl);
      }
      rootEl._agentRunDelegatedToActivityDetail = false;
      return;
    }

    var state = rootEl && rootEl._agentRunState;
    if (!state) return;
    state.destroyed = true;
    stopStream(state);
    stopTimer(state);
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
    rootEl._agentRunState = null;
  }

  global.LanaAgentsApp.Views.agentRun = { render: render, destroy: destroy };
})(typeof window !== 'undefined' ? window : globalThis);
