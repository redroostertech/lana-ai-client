/* agent-run.js — Live agent run viewer (SSE stream + artifacts pane).

   Reads ?id=<runId>. Subscribes to GET /api/v1/agent-runs/:id/stream via
   fetch+ReadableStream (SSE). Renders incremental reasoning steps,
   tool-call rows, sub-agent delegation expansions, and artifacts.

   Rules:
     - IIFE, no top-level const/class
     - Lex.Nav.go() for all navigation
     - All HTML escaping via Lex.Utils.escapeHtml()
     - NO regex
*/

(function () {
  'use strict';

  var escHtml = (window.Lex && Lex.Utils && Lex.Utils.escapeHtml)
    ? Lex.Utils.escapeHtml
    : function (s) { var d = document.createElement('div'); d.textContent = (s == null ? '' : String(s)); return d.innerHTML; };

  var BlockRenderer = window.Lex && window.Lex.BlockRenderer;

  // =========================================================================
  // State
  // =========================================================================

  var _runId           = null;
  var _run             = null;
  var _abortCtrl       = null;
  var _streamConnected = false;
  var _timerInterval   = null;
  var _startTimeMs     = null;
  var _steps           = []; // for reasoning_steps block
  var _artifacts       = []; // current artifact list
  var _artifactStates  = {}; // id -> 'pending' | 'approved' | 'rejected' | 'applied'
  var _opInFlight      = false; // single-gate to prevent racing bulk + per-artifact ops

  // Bulk op concurrency. Three keeps the UI responsive without hammering
  // the backend (tested values: 1 too slow on 20+ artifacts, 5 caused
  // perceptible jank in the activity pane).
  var BULK_CONCURRENCY = 3;
  // Emit a progress toast every N completed items so users get feedback
  // on long bulk runs without a flood of notifications.
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
  // Header
  // =========================================================================

  function renderHeader(run) {
    _run = run || {};

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

    // Timer
    if (run.started_at) {
      _startTimeMs = new Date(run.started_at).getTime();
      startTimer();
    } else if (run.created_at) {
      _startTimeMs = new Date(run.created_at).getTime();
      startTimer();
    }

    if (isTerminal(run.status)) {
      stopTimer();
      var cancelBtn = el('agentRunCancelBtn');
      if (cancelBtn) cancelBtn.disabled = true;
      var streamStatus = el('agentRunStreamStatus');
      if (streamStatus) streamStatus.textContent = 'Closed';
    }

    document.title = (run.agent_name || run.agent_slug || 'Run') + ' - LANA AI';
  }

  function startTimer() {
    if (_timerInterval) return;
    var timerEl = el('agentRunTimer');
    var update = function () {
      if (!timerEl || _startTimeMs == null) return;
      var elapsed = Date.now() - _startTimeMs;
      timerEl.textContent = fmtMs(elapsed);
    };
    update();
    _timerInterval = setInterval(update, 1000);
  }

  function stopTimer() {
    if (_timerInterval) {
      clearInterval(_timerInterval);
      _timerInterval = null;
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
      // Replace placeholder with two containers
      content.innerHTML = ''
        + '<div class="agent-run-step-list" data-role="steps"></div>'
        + '<div class="agent-run-event-list" data-role="events"></div>';
      stepsContainer = content.querySelector('.agent-run-step-list');
      eventsContainer = content.querySelector('.agent-run-event-list');
    }

    return { stepsContainer: stepsContainer, eventsContainer: eventsContainer };
  }

  function renderStepsBlock() {
    var sections = ensureStreamSections();
    if (!sections || !sections.stepsContainer) return;
    if (!BlockRenderer) {
      // Fallback: simple render
      var html = '';
      for (var i = 0; i < _steps.length; i++) {
        var s = _steps[i];
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
      steps: _steps
    }]);
  }

  function appendEventRow(html) {
    var sections = ensureStreamSections();
    if (!sections || !sections.eventsContainer) return;
    var div = document.createElement('div');
    div.innerHTML = html;
    while (div.firstChild) sections.eventsContainer.appendChild(div.firstChild);
    // Auto-scroll to bottom
    var content = el('agentRunStreamContent');
    if (content) content.scrollTop = content.scrollHeight;
  }

  function handleStepStart(data) {
    var stepNumber = data.step_number || data.number || (_steps.length + 1);
    var title = data.title || data.description || ('Step ' + stepNumber);
    // Mark previous active steps as complete
    for (var i = 0; i < _steps.length; i++) {
      if (_steps[i].status === 'active') _steps[i].status = 'complete';
    }
    _steps.push({ number: stepNumber, title: title, status: 'active' });
    renderStepsBlock();
  }

  function handleStepComplete(data) {
    var stepNumber = data.step_number || data.number;
    var found = false;
    for (var i = 0; i < _steps.length; i++) {
      if (_steps[i].number === stepNumber || (!stepNumber && _steps[i].status === 'active')) {
        _steps[i].status = 'complete';
        found = true;
        break;
      }
    }
    if (!found && stepNumber) {
      _steps.push({
        number: stepNumber,
        title: data.title || data.description || ('Step ' + stepNumber),
        status: 'complete'
      });
    }
    renderStepsBlock();
  }

  function handleStepError(data) {
    var stepNumber = data.step_number || data.number;
    for (var i = 0; i < _steps.length; i++) {
      if (_steps[i].number === stepNumber || (!stepNumber && _steps[i].status === 'active')) {
        _steps[i].status = 'error';
        if (data.message || data.error) {
          _steps[i].title = (_steps[i].title || '') + ' — ' + (data.message || data.error);
        }
        break;
      }
    }
    renderStepsBlock();
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
      +     (childRunId ? '<a href="agent-run.html?id=' + escHtml(childRunId) + '" class="agent-run-subagent-link" data-child-run="' + escHtml(childRunId) + '">View</a>' : '')
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
    // Fallback: append a simple event row
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

  function handleStatusChange(data) {
    if (data && data.status) {
      _run.status = data.status;
      renderHeader(_run);
    }
  }

  function handleArtifactCreated(data) {
    var artifact = (data && data.artifact) ? data.artifact : data;
    if (!artifact) return;
    // De-duplicate by id
    for (var i = 0; i < _artifacts.length; i++) {
      if (_artifacts[i].id === artifact.id) {
        _artifacts[i] = artifact;
        renderArtifacts();
        return;
      }
    }
    _artifacts.push(artifact);
    renderArtifacts();
  }

  // =========================================================================
  // Artifact rendering
  // =========================================================================

  function getArtifactState(artifact) {
    return _artifactStates[artifact.id] || artifact.state || artifact.status || 'pending';
  }

  function setArtifactState(id, state) {
    _artifactStates[id] = state;
    renderArtifacts();
  }

  function renderArtifacts() {
    var container = el('agentRunArtifactsContent');
    if (!container) return;

    if (_artifacts.length === 0) {
      container.innerHTML = ''
        + '<div class="agent-run-artifacts-empty">'
        +   '<lex-empty icon="file-text" message="No artifacts yet" description="Artifacts produced by this run will appear here."></lex-empty>'
        + '</div>';
      hide(el('agentRunApprovalBar'));
      var countEl = el('agentRunArtifactsCount');
      if (countEl) countEl.textContent = '';
      return;
    }

    var countEl = el('agentRunArtifactsCount');
    if (countEl) countEl.textContent = _artifacts.length + (_artifacts.length === 1 ? ' artifact' : ' artifacts');

    container.innerHTML = '';
    for (var i = 0; i < _artifacts.length; i++) {
      var card = buildArtifactCard(_artifacts[i]);
      if (card) container.appendChild(card);
    }

    // Show approval bar
    show(el('agentRunApprovalBar'));
    updateApprovalSummary();
    updateBulkButtonVisibility();
  }

  function updateApprovalSummary() {
    var pending = 0, approved = 0, rejected = 0;
    for (var i = 0; i < _artifacts.length; i++) {
      var s = getArtifactState(_artifacts[i]);
      if (s === 'approved') approved++;
      else if (s === 'rejected') rejected++;
      else pending++;
    }
    var summary = pending + ' pending · ' + approved + ' approved · ' + rejected + ' rejected';
    var sumEl = el('agentRunApprovalSummary');
    if (sumEl) sumEl.textContent = summary;
  }

  function buildArtifactCard(artifact) {
    var card = document.createElement('div');
    card.className = 'agent-run-artifact-card';
    card.dataset.artifactId = artifact.id || '';

    var kind = artifact.kind || artifact.type || 'unknown';
    var title = artifact.title || artifact.name || ('Artifact ' + (artifact.id || '').slice(0, 8));
    var state = getArtifactState(artifact);
    var stateClass = '';
    if (state === 'approved') stateClass = 'agent-run-artifact-state--approved';
    else if (state === 'rejected') stateClass = 'agent-run-artifact-state--rejected';
    else if (state === 'applied') stateClass = 'agent-run-artifact-state--applied';

    var head = document.createElement('div');
    head.className = 'agent-run-artifact-head';
    head.innerHTML = ''
      + '<span class="agent-run-artifact-kind">' + escHtml(kind) + '</span>'
      + '<span class="agent-run-artifact-title">' + escHtml(title) + '</span>'
      + '<span class="agent-run-artifact-state ' + stateClass + '">' + escHtml(state) + '</span>';
    card.appendChild(head);

    // Body — pick rendering strategy by kind
    var body = document.createElement('div');
    body.className = 'agent-run-artifact-body';
    renderArtifactBody(body, artifact, kind);
    card.appendChild(body);

    // Actions
    var actions = document.createElement('div');
    actions.className = 'agent-run-artifact-actions';
    var disableApprove = (state === 'approved' || state === 'applied');
    var disableReject  = (state === 'rejected');
    actions.innerHTML = ''
      + '<lex-btn variant="ghost" size="sm" data-art-action="reject" data-artifact-id="' + escHtml(artifact.id || '') + '"' + (disableReject ? ' disabled' : '') + '>Reject</lex-btn>'
      + '<lex-btn variant="secondary" size="sm" data-art-action="approve" data-artifact-id="' + escHtml(artifact.id || '') + '"' + (disableApprove ? ' disabled' : '') + '>Approve</lex-btn>'
      + '<lex-btn variant="primary" size="sm" data-art-action="apply" data-artifact-id="' + escHtml(artifact.id || '') + '">Apply</lex-btn>';
    card.appendChild(actions);

    return card;
  }

  function renderArtifactBody(container, artifact, kind) {
    if (!container) return;

    // Plan-card kinds
    if (kind === 'epic' || kind === 'sprint' || kind === 'task' || kind === 'matter_plan') {
      var planEl = document.createElement('lex-agentic-plan-card');
      planEl.plan = artifact.payload || artifact.plan || artifact;
      planEl.status = getArtifactState(artifact);
      // Reuse default action descriptors so the card renders its own buttons
      planEl.setAttribute('approval-id', artifact.id || '');
      container.appendChild(planEl);
      return;
    }

    // Diff blocks
    if (kind === 'document_draft' || kind === 'redline') {
      if (BlockRenderer) {
        var redlineBlock;
        if (kind === 'redline' && artifact.payload && Array.isArray(artifact.payload.segments)) {
          redlineBlock = Object.assign({ type: 'redline' }, artifact.payload);
        } else if (artifact.payload && Array.isArray(artifact.payload.segments)) {
          redlineBlock = Object.assign({ type: 'redline' }, artifact.payload);
        } else {
          // Fallback: treat content as a single text segment
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

    // Fallback: pretty-printed JSON
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

  function callArtifactEndpoint(artifactId, action, body) {
    if (!window.api || typeof window.api.post !== 'function' || !_runId || !artifactId) {
      return Promise.reject(new Error('api unavailable'));
    }
    return window.api.post(
      '/api/v1/agent-runs/' + encodeURIComponent(_runId) + '/artifacts/' + encodeURIComponent(artifactId) + '/' + action,
      body || {}
    );
  }

  function approveArtifact(id) {
    return callArtifactEndpoint(id, 'approve')
      .then(function () {
        setArtifactState(id, 'approved');
        if (window.Lex && Lex.Toast) Lex.Toast.success('Artifact approved');
      })
      .catch(function (err) {
        console.error('[agent-run] approve failed:', err);
        if (window.Lex && Lex.Toast) Lex.Toast.error('Approve failed');
      });
  }

  function rejectArtifact(id) {
    return callArtifactEndpoint(id, 'reject')
      .then(function () {
        setArtifactState(id, 'rejected');
        if (window.Lex && Lex.Toast) Lex.Toast.info('Artifact rejected');
      })
      .catch(function (err) {
        console.error('[agent-run] reject failed:', err);
        if (window.Lex && Lex.Toast) Lex.Toast.error('Reject failed');
      });
  }

  function applyArtifact(id) {
    return callArtifactEndpoint(id, 'apply')
      .then(function () {
        setArtifactState(id, 'applied');
        if (window.Lex && Lex.Toast) Lex.Toast.success('Artifact applied');
      })
      .catch(function (err) {
        // 501 = backend says apply not implemented. Show notice and disable.
        if (err && (err.status === 501 || (err.response && err.response.status === 501))) {
          var btn = document.querySelector('[data-art-action="apply"][data-artifact-id="' + (id || '').replace('"', '') + '"]');
          if (btn) btn.disabled = true;
          if (window.Lex && Lex.Toast) Lex.Toast.info('Apply not yet supported');
          return;
        }
        console.error('[agent-run] apply failed:', err);
        if (window.Lex && Lex.Toast) Lex.Toast.error('Apply failed');
      });
  }

  function wireArtifactActions() {
    var container = el('agentRunArtifactsContent');
    if (!container || container._wired) return;
    container._wired = true;

    container.addEventListener('click', function (evt) {
      var btn = evt.target.closest('[data-art-action]');
      if (!btn) return;
      // Gate: don't allow per-artifact ops while a bulk op is running.
      if (_opInFlight) return;
      var action = btn.getAttribute('data-art-action');
      var id = btn.getAttribute('data-artifact-id');
      if (!action || !id) return;

      _opInFlight = true;
      setBulkButtonsDisabled(true);
      var p;
      if (action === 'approve') p = approveArtifact(id);
      else if (action === 'reject') p = rejectArtifact(id);
      else if (action === 'apply') p = applyArtifact(id);
      else p = Promise.resolve();

      Promise.resolve(p).then(function () {
        _opInFlight = false;
        setBulkButtonsDisabled(false);
        // Re-render so the bulk-button visibility reflects the new state.
        renderArtifacts();
      });
    });
  }

  // =========================================================================
  // Bulk approve / reject / apply
  // =========================================================================

  // Treat any of these server-side states as "needs review" for bulk
  // approve/reject. The backend has surfaced both 'awaiting_approval' and
  // 'proposed' depending on artifact kind; the client also mints a local
  // 'pending' state when nothing is set yet.
  function isPending(artifact) {
    var s = getArtifactState(artifact);
    return s === 'pending' || s === 'awaiting_approval' || s === 'proposed';
  }

  function isApproved(artifact) {
    return getArtifactState(artifact) === 'approved';
  }

  function pendingArtifacts() {
    return _artifacts.filter(isPending);
  }

  function approvedArtifacts() {
    return _artifacts.filter(isApproved);
  }

  /**
   * Bounded-concurrency map. Resolves once every item has been mapped,
   * preserving input order in the result array. Errors are caught per item
   * and surfaced as { ok: false, error }; success is { ok: true, value }.
   */
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
          var i = nextIndex++;
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
    // Also disable per-artifact buttons so users can't race a per-item op
    // into the middle of a bulk loop.
    var perItem = document.querySelectorAll('[data-art-action]');
    for (var j = 0; j < perItem.length; j++) {
      perItem[j].disabled = !!disabled;
    }
  }

  // Returns the api-call promise WITHOUT updating local artifact state on
  // success. State updates are applied after the bulk loop completes via a
  // single refreshRun() so the UI sees the canonical server view.
  function bulkApproveOne(id) {
    return callArtifactEndpoint(id, 'approve');
  }
  function bulkRejectOne(id) {
    return callArtifactEndpoint(id, 'reject');
  }
  function bulkApplyOne(id) {
    return callArtifactEndpoint(id, 'apply');
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
    if (!(window.Lex && Lex.Toast)) return;
    if (fail === 0) {
      Lex.Toast.success(verb + ' ' + ok + ' of ' + results.length);
    } else if (ok === 0) {
      Lex.Toast.error(verb + ' failed for all ' + fail + ' items');
    } else {
      Lex.Toast.warning(verb + ' ' + ok + ' of ' + results.length + '; ' + fail + ' failed');
    }
  }

  function refreshRun() {
    if (!_runId || !window.api || typeof window.api.get !== 'function') return Promise.resolve();
    return window.api.get('/api/v1/agent-runs/' + encodeURIComponent(_runId))
      .then(function (resp) {
        var run = (resp && resp.run) ? resp.run
                : ((resp && resp.data) ? resp.data : resp);
        var steps = (resp && resp.steps) || (run && run.steps) || [];
        var artifacts = (resp && resp.artifacts) || (run && run.artifacts) || [];
        if (!run) return;
        // Reset local optimistic state so server state takes precedence.
        _artifactStates = {};
        renderHeader(run);
        hydrateSteps(steps);
        hydrateArtifacts(artifacts);
      })
      .catch(function (err) {
        console.warn('[agent-run] refresh after bulk op failed:', err);
      });
  }

  function runBulk(action, targets, mapper, verb) {
    if (_opInFlight) return Promise.resolve();
    if (!targets || targets.length === 0) return Promise.resolve();

    _opInFlight = true;
    setBulkButtonsDisabled(true);
    var total = targets.length;
    var completed = 0;

    if (window.Lex && Lex.Toast) {
      Lex.Toast.info(verb + ' ' + total + ' artifact' + (total === 1 ? '' : 's') + '...');
    }

    var wrappedMapper = function (artifact) {
      var aid = artifact && artifact.id;
      return Promise.resolve()
        .then(function () { return mapper(aid); })
        .then(function (value) {
          completed++;
          if (window.Lex && Lex.Toast
              && completed % BULK_PROGRESS_EVERY === 0
              && completed < total) {
            Lex.Toast.info(verb + ' ' + completed + ' of ' + total + '...');
          }
          return value;
        })
        .catch(function (err) {
          completed++;
          // Tag the failure with the artifact id so summarizeAndToast can
          // log a useful diagnostic in the dev console. Some rejections are
          // plain strings or frozen objects, so wrap defensively.
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
        // Annotate failures with the artifact id (pMap stores the rejection
        // verbatim; the wrapper above attached _artifactId to the error).
        for (var i = 0; i < results.length; i++) {
          if (!results[i].ok && results[i].error) {
            results[i]._artifactId = results[i].error._artifactId;
          }
        }
        summarizeAndToast(verb, results);
        return refreshRun();
      })
      .then(function () {
        _opInFlight = false;
        setBulkButtonsDisabled(false);
      })
      .catch(function (err) {
        // Defensive: pMap shouldn't reject (it captures per-item errors),
        // but if anything else above throws, restore button state.
        console.error('[agent-run] bulk ' + action + ' fatal:', err);
        _opInFlight = false;
        setBulkButtonsDisabled(false);
      });
  }

  function bulkApprove() {
    return runBulk('approve', pendingArtifacts(), bulkApproveOne, 'Approved');
  }
  function bulkReject() {
    return runBulk('reject', pendingArtifacts(), bulkRejectOne, 'Rejected');
  }
  function bulkApply() {
    // Some kinds (e.g. matter_plan) return 501 from the apply endpoint —
    // those count as failures and the summary toast will reflect that.
    return runBulk('apply', approvedArtifacts(), bulkApplyOne, 'Applied');
  }

  // Recompute bulk-button visibility based on current artifact states.
  // Hidden (not just disabled) when a target set is empty so the bar
  // doesn't show no-op buttons.
  function updateBulkButtonVisibility() {
    var pending = pendingArtifacts().length;
    var approved = approvedArtifacts().length;

    var approveBtn = el('agentRunApproveAllBtn');
    var rejectBtn = el('agentRunRejectAllBtn');
    var applyBtn = el('agentRunApplyApprovedBtn');

    if (approveBtn) approveBtn.classList.toggle('hidden', pending === 0);
    if (rejectBtn) rejectBtn.classList.toggle('hidden', pending === 0);
    if (applyBtn) applyBtn.classList.toggle('hidden', approved === 0);
  }

  function wireApprovalBar() {
    var bar = el('agentRunApprovalBar');
    if (!bar || bar._wired) return;
    bar._wired = true;

    bar.addEventListener('click', function (evt) {
      var btn = evt.target.closest('[data-action]');
      if (!btn) return;
      if (_opInFlight) return;
      var action = btn.getAttribute('data-action');
      if (action === 'bulk-approve') bulkApprove();
      else if (action === 'bulk-reject') bulkReject();
      else if (action === 'bulk-apply') bulkApply();
    });
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
    if (window.Lex && Lex.state && Lex.state.token) return Lex.state.token;
    return localStorage.getItem('token') || localStorage.getItem('access_token') || '';
  }

  function dispatchEvent(eventName, data) {
    // Map SSE event types to handlers
    if (eventName === 'snapshot') {
      // Initial replay burst: { run, steps, artifacts }. Hydrate local state
      // so a viewer joining mid-execution sees prior history immediately.
      var snapRun = (data && data.run) ? data.run : data;
      if (snapRun) {
        renderHeader(snapRun);
      }
      hydrateSteps((data && data.steps) || (snapRun && snapRun.steps) || []);
      hydrateArtifacts((data && data.artifacts) || (snapRun && snapRun.artifacts) || []);
      return;
    }
    if (eventName === 'end') {
      // Clean stream close. If the server didn't already emit a status_change,
      // make sure the header is no longer "running".
      if (_run && !isTerminal(_run.status)) {
        handleStatusChange({ status: 'completed' });
      }
      var streamStatus = el('agentRunStreamStatus');
      if (streamStatus) streamStatus.textContent = 'Closed';
      stopStream();
      return;
    }
    if (eventName === 'agent_step_start')        return handleStepStart(data);
    if (eventName === 'agent_step_complete')     return handleStepComplete(data);
    if (eventName === 'agent_step_error')        return handleStepError(data);
    if (eventName === 'tool_call')                return handleToolCall(data);
    if (eventName === 'sub_agent_delegation')    return handleSubAgentDelegation(data);
    if (eventName === 'agentic_progress')        return handleAgenticProgress(data);
    if (eventName === 'agentic_complete')        return handleAgenticComplete(data);
    if (eventName === 'status_change' || eventName === 'run_status') return handleStatusChange(data);
    if (eventName === 'artifact_created' || eventName === 'artifact') return handleArtifactCreated(data);
    if (eventName === 'run_complete') {
      handleAgenticComplete(data);
      handleStatusChange({ status: 'completed' });
      stopStream();
      return;
    }
    // Unknown — log
    // console.log('[agent-run] unknown event:', eventName, data);
  }

  function startStream() {
    if (_streamConnected) return;
    if (!_runId) return;

    var baseUrl = _resolveBaseUrl();
    if (!baseUrl) {
      var statusEl = el('agentRunStreamStatus');
      if (statusEl) statusEl.textContent = 'Server unavailable';
      return;
    }

    _abortCtrl = new AbortController();
    _streamConnected = true;

    var streamStatus = el('agentRunStreamStatus');
    if (streamStatus) streamStatus.textContent = 'Streaming';

    setStreamingFlag(true);

    var url = baseUrl + '/api/v1/agent-runs/' + encodeURIComponent(_runId) + '/stream';
    var token = _getToken();

    fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream',
        'Authorization': token ? 'Bearer ' + token : ''
      },
      signal: _abortCtrl.signal
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
                  // Surface malformed payloads instead of silently dropping
                  // them — this used to make stream bugs invisible.
                  console.error('[agent-run] malformed SSE JSON:', e, raw);
                  if (window.Lex && Lex.Toast) {
                    Lex.Toast.error('Stream message could not be parsed');
                  }
                  if (streamStatus) streamStatus.textContent = 'Stream parse error';
                  continue;
                }
                dispatchEvent(currentEvent || 'message', parsed);
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
        _streamConnected = false;
        setStreamingFlag(false);
      });
  }

  // LexRouter reads Lex.state.isStreaming to gate navigation. The setter
  // on lex.state.js mirrors to window.api._streamingActive (and calls
  // setStreamingActive()/setStreamingInactive() so api.js can run its
  // session-expiry follow-up), so writing here is enough.
  function setStreamingFlag(active) {
    try {
      if (window.Lex && window.Lex.state) {
        window.Lex.state.isStreaming = !!active;
        return;
      }
    } catch (e) { /* fall through to legacy api fallback below */ }
    // Fallback for tests / pages that boot before lex.state.js loads.
    if (window.api) {
      if (active && typeof window.api.setStreamingActive === 'function') {
        window.api.setStreamingActive();
      } else if (!active && typeof window.api.setStreamingInactive === 'function') {
        window.api.setStreamingInactive();
      }
    }
  }

  function stopStream() {
    if (_abortCtrl) {
      try { _abortCtrl.abort(); } catch (e) { /* ignore */ }
      _abortCtrl = null;
    }
    _streamConnected = false;
    setStreamingFlag(false);
  }

  // =========================================================================
  // Detail load (initial state + existing artifacts)
  // =========================================================================

  function loadRun() {
    if (!_runId) return;
    if (!window.api || typeof window.api.get !== 'function') {
      document.addEventListener('lex-ready', loadRun, { once: true });
      return;
    }

    window.api.get('/api/v1/agent-runs/' + encodeURIComponent(_runId))
      .then(function (resp) {
        // Backend returns { run, steps, artifacts } — normalize so the
        // UI doesn't treat the envelope as the run.
        var run = (resp && resp.run) ? resp.run
                : ((resp && resp.data) ? resp.data : resp);
        var steps = (resp && resp.steps) || (run && run.steps) || [];
        var artifacts = (resp && resp.artifacts) || (run && run.artifacts) || [];
        if (!run) return;
        renderHeader(run);
        hydrateSteps(steps);
        hydrateArtifacts(artifacts);

        // Open the SSE stream unless terminal
        if (!isTerminal(run.status)) {
          startStream();
        } else {
          var streamStatus = el('agentRunStreamStatus');
          if (streamStatus) streamStatus.textContent = 'Closed';
        }
      })
      .catch(function (err) {
        console.error('[agent-run] failed to load run:', err);
        showLoadError(err);
      });
  }

  // Map an array of step records into the local _steps shape and re-render.
  function hydrateSteps(steps) {
    if (!Array.isArray(steps)) return;
    _steps = [];
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i] || {};
      _steps.push({
        number: s.step_number || s.number || (i + 1),
        title: s.title || s.description || ('Step ' + (i + 1)),
        status: s.status === 'complete' || s.status === 'completed' ? 'complete'
              : (s.status === 'error' || s.status === 'failed' ? 'error'
              : (s.status === 'active' || s.status === 'running' ? 'active' : 'pending'))
      });
    }
    renderStepsBlock();
  }

  function hydrateArtifacts(artifacts) {
    if (!Array.isArray(artifacts)) return;
    _artifacts = artifacts.slice();
    renderArtifacts();
  }

  // Differentiated error message for run load failures.
  function showLoadError(err) {
    var streamStatus = el('agentRunStreamStatus');
    var status = err && (err.status || (err.response && err.response.status));
    var msg = 'Unable to load run';
    if (status === 401) {
      msg = 'Your session expired. Please sign in again.';
      if (window.Lex && Lex.Toast) Lex.Toast.error(msg);
      if (window.Lex && Lex.Nav) Lex.Nav.go('login.html');
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

  function wireHeaderButtons() {
    var cancelBtn = el('agentRunCancelBtn');
    if (cancelBtn && !cancelBtn._wired) {
      cancelBtn._wired = true;
      cancelBtn.addEventListener('click', function () {
        if (!_runId || !window.api) return;
        window.api.post('/api/v1/agent-runs/' + encodeURIComponent(_runId) + '/cancel', {})
          .then(function () {
            if (window.Lex && Lex.Toast) Lex.Toast.info('Cancellation requested');
          })
          .catch(function (err) {
            console.error('[agent-run] cancel failed:', err);
            if (window.Lex && Lex.Toast) Lex.Toast.error('Cancel failed');
          });
      });
    }

    var back = el('agentRunBackLink');
    if (back && !back._wired) {
      back._wired = true;
      back.addEventListener('click', function (e) {
        e.preventDefault();
        if (window.Lex && Lex.Nav) Lex.Nav.go('agents.html');
      });
    }

    // Sub-agent links inside stream content delegate via Lex.Nav.go
    var streamEl = el('agentRunStreamContent');
    if (streamEl && !streamEl._wired) {
      streamEl._wired = true;
      streamEl.addEventListener('click', function (evt) {
        var link = evt.target.closest('[data-child-run]');
        if (!link) return;
        evt.preventDefault();
        var childId = link.getAttribute('data-child-run');
        if (childId && window.Lex && Lex.Nav) {
          Lex.Nav.go('agent-run.html', { params: { id: childId } });
        }
      });
    }
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  function onLeave() {
    stopStream();
    stopTimer();
  }

  function init() {
    var params = (window.Lex && Lex.Nav && typeof Lex.Nav.getParams === 'function')
      ? Lex.Nav.getParams()
      : new URLSearchParams(window.location.search);
    _runId = params && (params.get ? params.get('id') : params.id);

    // Reset state
    stopStream();
    stopTimer();
    _steps = [];
    _artifacts = [];
    _artifactStates = {};
    _run = null;
    _streamConnected = false;
    _startTimeMs = null;

    wireHeaderButtons();
    wireArtifactActions();
    wireApprovalBar();

    if (!_runId) {
      var streamStatus = el('agentRunStreamStatus');
      if (streamStatus) streamStatus.textContent = 'Missing run id';
      return;
    }

    loadRun();
  }

  if (window.LexRouter) {
    LexRouter.registerPageInit('agent-run.html', function () {
      LexRouter.registerView({ onLeave: onLeave });
      init();
    });
  }
  init();
})();
