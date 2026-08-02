/* activity-detail.js — Lana Task detail SPA view (interactive task execution).
   Migrated from src/js/pages/agentic-task-detail.js. Reads ctx.id. Shows
   real-time execution log via SSE, an input area when awaiting_input, and
   an approval panel when awaiting_approval.

   Rules:
     - NO regex anywhere — string methods only
     - All HTML escaping via Lex.Utils.escapeHtml()
     - All time/date formatting via Lex.Utils.timeAgo()
     - IIFE wrapper to keep scope clean
*/

'use strict';

(function (global) {
  global.LanaAgentsApp = global.LanaAgentsApp || {};
  global.LanaAgentsApp.Views = global.LanaAgentsApp.Views || {};

  // Markup template — extracted from src/agents/agentic-task-detail.html
  // (the <main> body inside <template id="page-content">). Cloned into
  // rootEl on render. Note: the page-specific <style> block in the
  // original HTML stays in the source HTML file as a global stylesheet
  // contribution (Agent 3 will decide whether to move it). We keep the
  // class names here matching the existing CSS so the view renders.
  var TEMPLATE = ''
    + '<main>'

    + '<lex-banner id="atdBanner" variant="light" heading="Loading..." subtitle="Loading run details" lana lana-context-type="full_chat">'
    +   '<a id="atdMatterLink" class="atd-banner-action hidden" href="#">View Matter</a>'
    + '</lex-banner>'
    + '<lex-breadcrumb id="atdBreadcrumb" style="margin:12px 0 16px;" items=\'[{"label":"LanaAgents","href":"#catalog"},{"label":"Activity","href":"#activity"},{"label":"Run detail"}]\'></lex-breadcrumb>'

    // Run-level actions. Kept OUTSIDE lex-banner because the banner clones its
    // action children on render, which would orphan our show/hide + click wiring.
    + '<div id="atdRunActions" class="atd-run-actions hidden">'
    +   '<button id="atdExportJson" class="atd-banner-action" type="button">Export JSON</button>'
    +   '<button id="atdExportHtml" class="atd-banner-action" type="button">Export HTML</button>'
    + '</div>'

    + '<div id="atdRunSummary" class="atd-run-summary hidden"></div>'

    + '<div class="atd-tabs" role="tablist" aria-label="Run details">'
    +   '<button id="atdExecutionTab" class="atd-tab active" type="button" role="tab" aria-selected="true" aria-controls="atdExecutionPane" data-atd-tab="execution">Trace</button>'
    +   '<button id="atdDeliverablesTab" class="atd-tab" type="button" role="tab" aria-selected="false" aria-controls="atdDeliverablesPane" data-atd-tab="deliverables">Deliverables <span id="atdDeliverablesCount" class="atd-tab-count hidden">0</span></button>'
    + '</div>'

    + '<section id="atdExecutionPane" class="atd-tab-pane" role="tabpanel" aria-labelledby="atdExecutionTab">'
    +   '<lex-card padding="none">'
    +     '<div class="atd-pane-head">'
    +       '<div>Step Trace</div>'
    +       '<div class="atd-pane-subtitle">Grouped by run phase</div>'
    +     '</div>'
    +     '<div class="atd-trace-tabs" role="tablist" aria-label="Trace sections">'
    +       '<button class="atd-trace-tab active" type="button" data-atd-trace="all">All</button>'
    +       '<button class="atd-trace-tab" type="button" data-atd-trace="context">Context</button>'
    +       '<button class="atd-trace-tab" type="button" data-atd-trace="runtime">Runtime</button>'
    +       '<button class="atd-trace-tab" type="button" data-atd-trace="hermes">Hermes</button>'
    +       '<button class="atd-trace-tab" type="button" data-atd-trace="tools">Tools</button>'
    +       '<button class="atd-trace-tab" type="button" data-atd-trace="approval">Approval</button>'
    +       '<button class="atd-trace-tab" type="button" data-atd-trace="deliverable">Deliverables</button>'
    +       '<button class="atd-trace-tab" type="button" data-atd-trace="trace">Other</button>'
    +     '</div>'
    +     '<div class="atd-log" id="atdLog">'
    +       '<div style="text-align:center;padding:24px;color:var(--lex-text-tertiary);font-size:0.8125rem;">'
    +         '<lex-spinner size="sm"></lex-spinner> Loading events...'
    +       '</div>'
    +     '</div>'
    +   '</lex-card>'
    + '</section>'

    + '<section id="atdDeliverablesPane" class="atd-tab-pane hidden" role="tabpanel" aria-labelledby="atdDeliverablesTab">'
    +   '<div id="atdDeliverables" class="atd-deliverables"></div>'
    + '</section>'

    + '<div id="atdApprovalPanel" class="atd-approval hidden">'
    +   '<div class="atd-approval-title">Lana wants to make the following changes:</div>'
    +   '<div id="atdApprovalSummary" style="font-size:0.8125rem;color:var(--lex-text-secondary);margin-bottom:12px;"></div>'
    +   '<div id="atdApprovalDescription" class="atd-approval-description"></div>'
    +   '<div class="atd-approval-toggle" id="atdDiffToggle">Show raw JSON</div>'
    +   '<div id="atdDiffContainer" class="atd-approval-diff hidden"></div>'
    +   '<div id="atdRejectReason" class="hidden" style="margin-top:12px;">'
    +     '<textarea id="atdRejectReasonInput" placeholder="Reason for rejection (optional)" style="width:100%;min-height:60px;border:1px solid var(--lex-border-default);border-radius:6px;padding:8px;font-size:0.8125rem;resize:vertical;font-family:inherit;"></textarea>'
    +   '</div>'
    +   '<div class="atd-approval-actions">'
    +     '<lex-btn id="atdRejectBtn" variant="outline" size="sm">Reject</lex-btn>'
    +     '<lex-btn id="atdApproveBtn" variant="primary" size="sm">Approve</lex-btn>'
    +   '</div>'
    + '</div>'

    + '<div id="atdInputArea" class="atd-input-area hidden">'
    +   '<textarea id="atdMessageInput" placeholder="Type a message to Lana..." rows="2"></textarea>'
    +   '<lex-btn id="atdSendBtn" variant="primary" size="sm">Send</lex-btn>'
    + '</div>'

    + '<div id="atdCancelArea" class="hidden" style="padding:16px 0;text-align:right;">'
    +   '<lex-btn id="atdCancelBtn" variant="outline" size="sm">Cancel Task</lex-btn>'
    + '</div>'

    + '<div id="atdRetryArea" class="hidden" style="padding:16px 0;text-align:right;">'
    +   '<lex-btn id="atdRetryBtn" variant="primary" size="sm">Retry Task</lex-btn>'
    + '</div>'

    + '</main>';

  var escHtml = (typeof window !== 'undefined' && window.Lex && window.Lex.Utils && window.Lex.Utils.escapeHtml)
    ? window.Lex.Utils.escapeHtml
    : function (s) { var d = document.createElement('div'); d.textContent = (s == null ? '' : String(s)); return d.innerHTML; };

  var timeAgo = (typeof window !== 'undefined' && window.Lex && window.Lex.Utils && window.Lex.Utils.timeAgo)
    ? window.Lex.Utils.timeAgo
    : function (s) { return s ? String(s) : ''; };

  // =========================================================================
  // Helpers
  // =========================================================================

  function el(id) { return document.getElementById(id); }
  function show(id) { var e = el(id); if (e) e.classList.remove('hidden'); }
  function hide(id) { var e = el(id); if (e) e.classList.add('hidden'); }

  function setBanner(task, status) {
    var banner = el('atdBanner');
    if (!banner) return;

    var taskStatus = status || (task && task.execution_status) || 'pending';
    var subtitleParts = [statusLabel(taskStatus)];
    if (task && task.priority) subtitleParts.push(String(task.priority).toUpperCase());
    if (task && task.created_at) subtitleParts.push(timeAgo(task.created_at));

    banner.setAttribute('heading', (task && task.name) || 'Run detail');
    banner.setAttribute('subtitle', subtitleParts.filter(Boolean).join(' · '));
    banner.setAttribute('status', isTerminal(taskStatus) ? (taskStatus === 'completed' ? 'connected' : 'offline') : 'warning');

    var breadcrumb = el('atdBreadcrumb');
    if (breadcrumb) {
      breadcrumb.setAttribute('items', JSON.stringify([
        { label: 'LanaAgents', href: '#catalog' },
        { label: 'Activity', href: '#activity' },
        { label: (task && task.name) || 'Run detail' }
      ]));
    }
  }

  function statusLabel(status) {
    if (!status) return 'Pending';
    if (status === 'compiling_context') return 'Compiling Context...';
    if (status === 'running')           return 'Running';
    if (status === 'awaiting_input')    return 'Needs Your Input';
    if (status === 'awaiting_approval') return 'Pending Approval';
    if (status === 'approved')          return 'Approved';
    if (status === 'completed')         return 'Completed';
    if (status === 'failed')            return 'Failed';
    if (status === 'rejected')          return 'Rejected';
    if (status === 'cancelled')         return 'Cancelled';
    return humanizeToken(status);
  }

  function statusColor(status) {
    if (status === 'running' || status === 'compiling_context') return '#3b82f6';
    if (status === 'awaiting_input')    return '#f59e0b';
    if (status === 'awaiting_approval') return '#f59e0b';
    if (status === 'completed')         return '#10b981';
    if (status === 'failed')            return '#ef4444';
    if (status === 'rejected')          return '#ef4444';
    if (status === 'cancelled')         return '#6b7280';
    return '#9ca3af';
  }

  function isTerminal(status) {
    return status === 'completed' || status === 'failed' ||
           status === 'rejected'  || status === 'cancelled';
  }

  function formatJson(value) {
    if (value == null || value === '') return '';
    try {
      return JSON.stringify(value, null, 2);
    } catch (_err) {
      return String(value);
    }
  }

  function compactObjectSummary(value) {
    if (!value || typeof value !== 'object') return '';
    var parts = [];
    Object.keys(value).slice(0, 4).forEach(function (key) {
      var item = value[key];
      if (item == null || typeof item === 'object') return;
      var rendered = renderSummaryValue(key, item);
      if (rendered) parts.push(rendered);
    });
    return parts.join(' · ');
  }

  function durationLabel(ms) {
    if (ms == null || ms === '') return '';
    var n = Number(ms);
    if (!Number.isFinite(n)) return '';
    if (n < 1000) return String(Math.round(n)) + 'ms';
    return String(Math.round(n / 100) / 10) + 's';
  }

  function humanizeToken(value) {
    if (value == null || value === '') return '';
    var words = String(value)
      .split('_')
      .join(' ')
      .split('-')
      .join(' ')
      .split(' ')
      .filter(Boolean);
    var text = words.join(' ');
    if (!text) return '';
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function humanizeKey(value) {
    return humanizeToken(value);
  }

  function humanizeValue(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') return String(value);
    if (typeof value !== 'string') return '';
    return humanizeToken(value);
  }

  function compactText(value, fallback) {
    if (value == null || value === '') return fallback || '';
    if (typeof value === 'string') return decodeText(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return fallback || '';
  }

  function compactLongText(value, limit) {
    var text = compactText(value, '');
    var max = limit || 220;
    if (text.length <= max) return text;
    return text.slice(0, max - 1) + '...';
  }

  function firstValue(values) {
    for (var i = 0; i < values.length; i++) {
      if (values[i] != null && values[i] !== '') return values[i];
    }
    return '';
  }

  function summarizeValue(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') return decodeText(value);
    if (Array.isArray(value)) return String(value.length) + ' item' + (value.length === 1 ? '' : 's');
    if (typeof value === 'object') return compactObjectSummary(value) || 'Structured data';
    return String(value);
  }

  function renderFactGrid(facts) {
    if (!Array.isArray(facts) || facts.length === 0) return '';
    var rows = [];
    for (var i = 0; i < facts.length; i++) {
      var fact = facts[i] || {};
      var value = summarizeValue(fact.value);
      if (!fact.label || !value) continue;
      rows.push('<div class="atd-step-fact">' +
        '<span>' + escHtml(humanizeKey(fact.label)) + '</span>' +
        '<strong>' + escHtml(value) + '</strong>' +
      '</div>');
    }
    if (rows.length === 0) return '';
    return '<div class="atd-step-facts">' + rows.join('') + '</div>';
  }

  function renderDetailsBlock(title, value) {
    if (value == null || value === '') return '';
    return '<details class="atd-step-details">' +
      '<summary>' + escHtml(humanizeKey(title)) + '</summary>' +
      '<pre>' + escHtml(formatJson(value)) + '</pre>' +
    '</details>';
  }

  function objectHasValues(value) {
    if (!value || typeof value !== 'object') return false;
    var keys = Object.keys(value);
    for (var i = 0; i < keys.length; i++) {
      var item = value[keys[i]];
      if (item != null && item !== '') return true;
    }
    return false;
  }

  function renderRawDetails(title, value) {
    if (value == null || value === '') return '';
    if (typeof value === 'object' && !objectHasValues(value)) return '';
    return renderDetailsBlock(title || 'Raw details', value);
  }

  function renderTargetLink(target) {
    if (!target || !target.id) return '';
    var labelParts = [];
    if (target.type) labelParts.push(humanizeValue(target.type));
    labelParts.push(String(target.id));
    var label = labelParts.join(' ');
    if (target.url) {
      return '<a class="atd-target-link" href="' + escHtml(target.url) + '">' + escHtml(label) + '</a>';
    }
    return '<span class="atd-target-id">' + escHtml(label) + '</span>';
  }

  function targetUrl(type, id) {
    if (!id) return '';
    var t = String(type || '').toLowerCase();
    if (t === 'matter' || t === 'workspace') {
      return '../workspace-details.html?id=' + encodeURIComponent(id);
    }
    return '';
  }

  function findAppliedTarget(task) {
    var artifacts = (task && task.artifacts) || [];
    for (var i = 0; i < artifacts.length; i++) {
      var artifact = artifacts[i] || {};
      var id = firstValue([
        artifact.apply_target_id,
        artifact.target_id,
        artifact.entity_id,
        artifact.record_id
      ]);
      if (!id) continue;
      var type = firstValue([
        artifact.apply_target_type,
        artifact.target_type,
        artifact.entity_type,
        artifact.kind
      ]);
      var url = firstValue([
        artifact.apply_target_url,
        artifact.target_url,
        artifact.url,
        targetUrl(type, id)
      ]);
      return { id: id, type: type, url: url };
    }
    return null;
  }

  function approvalStatusForTask(task) {
    var artifacts = (task && task.artifacts) || [];
    var sawApproval = false;
    for (var i = 0; i < artifacts.length; i++) {
      var artifact = artifacts[i] || {};
      var status = firstValue([
        artifact.approval_status,
        artifact.approval_state,
        artifact.decision,
        artifact.status
      ]);
      if (!status) continue;
      var normalized = String(status).toLowerCase();
      if (normalized === 'approved' || normalized === 'applied') sawApproval = true;
      if (normalized === 'rejected' || normalized === 'denied') return 'Rejected';
      if (normalized === 'awaiting_approval' || normalized === 'pending_approval' || normalized === 'pending') return 'Pending approval';
    }

    var events = (task && task.events) || [];
    for (var j = events.length - 1; j >= 0; j--) {
      var evt = events[j] || {};
      var content = evt.content || {};
      if (evt.event_type === 'approval_response') {
        return content.approved === false ? 'Rejected' : 'Approved';
      }
      if (evt.event_type === 'approval_request') sawApproval = true;
    }

    if (task && task.execution_status === 'awaiting_approval') return 'Pending approval';
    if (sawApproval) return 'Approved';
    return 'No approval required';
  }

  function findFinalDeliverable(task) {
    if (!task) return '';
    var direct = firstValue([
      task.final_deliverable,
      task.final_delivery,
      task.result_summary,
      task.completion_summary,
      task.summary,
      task.output_summary
    ]);
    if (direct) return compactLongText(direct, 520);

    var events = task.events || [];
    for (var i = events.length - 1; i >= 0; i--) {
      var evt = events[i] || {};
      var content = evt.content || {};
      if (evt.event_type === 'completion' || evt.event_type === 'outcome') {
        var eventSummary = firstValue([content.summary, content.message, content.outcome]);
        if (eventSummary) return compactLongText(eventSummary, 520);
      }
    }

    var artifacts = collectDeliverables(task);
    if (artifacts.length > 0) {
      var artifact = artifacts[0] || {};
      var payload = parseStructuredValue(artifact.content_jsonb || artifact.payload || artifact.content || {});
      var payloadSummary = '';
      if (payload && typeof payload === 'object') {
        payloadSummary = firstValue([
          payload.summary,
          payload.description,
          payload.final_deliverable,
          payload.title
        ]);
      }
      return compactLongText(payloadSummary || artifact.title || artifact.name || artifact.kind || 'Deliverable produced', 520);
    }

    if (task.execution_status === 'completed') return 'Run completed successfully.';
    return '';
  }

  function renderRunSummary(task) {
    var container = el('atdRunSummary');
    if (!container) return;
    if (!task || !isTerminal(task.execution_status || '') && task.execution_status !== 'awaiting_approval') {
      container.classList.add('hidden');
      container.innerHTML = '';
      return;
    }

    var deliverable = findFinalDeliverable(task);
    var target = findAppliedTarget(task);
    var approval = approvalStatusForTask(task);
    var status = task.execution_status || 'pending';
    var targetHtml = target ? renderTargetLink(target) : '<span class="atd-muted">No applied target recorded</span>';

    container.innerHTML = '<lex-card padding="none">' +
      '<div class="atd-summary-head">' +
        '<div>' +
          '<div class="atd-summary-eyebrow">Run summary</div>' +
          '<div class="atd-summary-title">' + escHtml(statusLabel(status)) + '</div>' +
        '</div>' +
        '<span class="atd-summary-status">' + escHtml(statusLabel(status)) + '</span>' +
      '</div>' +
      '<div class="atd-summary-grid">' +
        '<div class="atd-summary-block atd-summary-block--wide">' +
          '<span>Final deliverable</span>' +
          '<strong>' + escHtml(deliverable || 'No final deliverable recorded yet.') + '</strong>' +
        '</div>' +
        '<div class="atd-summary-block">' +
          '<span>Applied target</span>' +
          '<strong>' + targetHtml + '</strong>' +
        '</div>' +
        '<div class="atd-summary-block">' +
          '<span>Approval</span>' +
          '<strong>' + escHtml(approval) + '</strong>' +
        '</div>' +
      '</div>' +
    '</lex-card>';
    container.classList.remove('hidden');
  }

  function setActiveTab(tabName) {
    var executionTab = el('atdExecutionTab');
    var deliverablesTab = el('atdDeliverablesTab');
    var executionPane = el('atdExecutionPane');
    var deliverablesPane = el('atdDeliverablesPane');
    var showDeliverables = tabName === 'deliverables';

    if (executionTab) {
      executionTab.classList.toggle('active', !showDeliverables);
      executionTab.setAttribute('aria-selected', showDeliverables ? 'false' : 'true');
    }
    if (deliverablesTab) {
      deliverablesTab.classList.toggle('active', showDeliverables);
      deliverablesTab.setAttribute('aria-selected', showDeliverables ? 'true' : 'false');
    }
    if (executionPane) executionPane.classList.toggle('hidden', showDeliverables);
    if (deliverablesPane) deliverablesPane.classList.toggle('hidden', !showDeliverables);
  }

  function setActiveTraceSection(state, sectionName) {
    state.activeTraceSection = sectionName || 'all';
    var buttons = document.querySelectorAll('[data-atd-trace]');
    for (var i = 0; i < buttons.length; i++) {
      var isActive = buttons[i].getAttribute('data-atd-trace') === state.activeTraceSection;
      buttons[i].classList.toggle('active', isActive);
    }
    renderTrace(state);
  }

  function updateDeliverablesCount(count) {
    var countEl = el('atdDeliverablesCount');
    if (!countEl) return;
    countEl.textContent = String(count || 0);
    countEl.classList.toggle('hidden', !count);
  }

  function renderStepCard(options) {
    var title = options.title || 'Step';
    var subtitle = options.subtitle || '';
    var status = options.status || '';
    var source = options.source || '';
    var body = options.body || '';
    var details = options.details || [];
    var facts = options.facts || [];
    var tone = options.tone || '';
    var classes = 'atd-step-card' + (tone ? ' atd-step-card--' + tone : '');
    var html = '<div class="' + escHtml(classes) + '">';
    html += '<div class="atd-step-head">';
    html += '<div>';
    html += '<div class="atd-step-title">' + escHtml(humanizeKey(title)) + '</div>';
    if (subtitle) html += '<div class="atd-step-subtitle">' + escHtml(humanizeValue(subtitle)) + '</div>';
    html += '</div>';
    html += '<div class="atd-step-meta">';
    if (source) html += '<span>' + escHtml(humanizeValue(source)) + '</span>';
    if (status) html += '<span class="atd-step-status">' + escHtml(statusLabel(status) || humanizeValue(status)) + '</span>';
    html += '</div>';
    html += '</div>';
    if (body) html += '<div class="atd-step-body">' + escHtml(body) + '</div>';
    html += renderFactGrid(facts);
    for (var i = 0; i < details.length; i++) html += details[i];
    html += '</div>';
    return html;
  }

  function renderTrace(state) {
    var log = el('atdLog');
    if (!log) return;
    var events = state.events || [];
    var sectionFilter = state.activeTraceSection || 'all';
    var html = '';
    var lastSection = null;
    var visibleCount = 0;

    for (var i = 0; i < events.length; i++) {
      var evt = events[i];
      var section = classifyEvent(evt);
      if (sectionFilter !== 'all' && section !== sectionFilter) continue;
      var rendered = renderEvent(evt);
      if (!rendered) continue;
      if (section !== lastSection) {
        html += renderSectionDivider(section);
        lastSection = section;
      }
      html += rendered;
      visibleCount++;
    }

    if (visibleCount === 0) {
      html = '<div class="atd-log-empty">No trace events in this section yet.</div>';
    }

    log.innerHTML = html;
    log.scrollTop = log.scrollHeight;
  }

  function renderSummaryValue(key, value) {
    var rendered = humanizeValue(value);
    if (!rendered) return '';
    return humanizeKey(key) + ': ' + rendered;
  }

  function classifyEvent(evt) {
    var type = evt && evt.event_type || '';
    var content = evt && evt.content || {};
    var data = content.data || {};
    var family = String(content.family || data.family || '').toLowerCase();
    var source = String(content.source || content.source_type || '').toLowerCase();
    var sourceEventName = String(content.source_event_name || data.event || data.type || '').toLowerCase();
    var phase = String(content.phase || data.phase || '').toLowerCase();
    var runtimeType = String(content.runtime_type || data.runtime_type || '').toLowerCase();

    if (type === 'approval_request' || type === 'approval_response' || content.approval) return 'approval';
    if (type === 'artifact' || type === 'outcome' || content.artifact_ref) return 'deliverable';

    if (family === 'context' || source === 'context' || phase === 'context' || phase === 'compile_context') return 'context';
    if (sourceEventName === 'runtime_selection' || sourceEventName === 'runtime_selected' || sourceEventName === 'runtime_policy') return 'runtime';
    if (family === 'tool' || family === 'tools' || source === 'tool' || source === 'tools' || content.tool_call || content.tool_name) return 'tools';
    if (family === 'hermes' || source === 'hermes' || runtimeType === 'hermes') return 'hermes';
    if (type === 'runtime_event') return 'trace';
    if (type === 'progress') return 'hermes';
    if (type === 'status_change') return 'runtime';
    return 'trace';
  }

  function sectionLabel(section) {
    if (section === 'context') return 'Context';
    if (section === 'runtime') return 'Runtime Selection';
    if (section === 'hermes') return 'Hermes Loop';
    if (section === 'tools') return 'Lana Tool Calls';
    if (section === 'approval') return 'Approval';
    if (section === 'deliverable') return 'Deliverable';
    return 'Raw Trace';
  }

  function renderSectionDivider(section) {
    return '<div class="atd-log-section atd-log-section--' + escHtml(section) + '">' +
      '<span>' + escHtml(sectionLabel(section)) + '</span>' +
    '</div>';
  }

  function renderProgressEvent(content) {
    var msg = content.message || content.phase || 'Processing...';
    var pct = content.progress_pct ? ' (' + content.progress_pct + '%)' : '';
    var stepTitle = content.title || msg;
    var stepSubtitle = content.source_run_title || content.source_type || '';
    var stepBody = compactObjectSummary(content.output || content.metadata || {}) || compactText(content.message, '');
    var facts = [
      { label: 'state', value: content.state || content.phase },
      { label: 'tool', value: content.tool_name },
      { label: 'duration', value: durationLabel(content.duration_ms) },
      { label: 'source', value: content.source_type }
    ];
    return renderStepCard({
      title: stepTitle + pct,
      subtitle: stepSubtitle,
      status: content.status || '',
      source: content.source_type || '',
      body: stepBody,
      facts: facts,
      tone: classifyEvent({ event_type: 'progress', content: content }),
      details: [
        renderRawDetails('Input details', content.input),
        renderRawDetails('Output details', content.output),
        renderRawDetails('Metadata', content.metadata)
      ]
    });
  }

  function renderRuntimeEvent(content) {
    var runtimeTitle = content.source_event_name || content.type || 'Runtime event';
    var runtimeBody = firstValue([
      compactText(content.data && content.data.message, ''),
      compactText(content.data && content.data.summary, ''),
      compactText(content.error && content.error.message, ''),
      compactObjectSummary(content.data || {})
    ]);
    var section = classifyEvent({ event_type: 'runtime_event', content: content });
    var toolCall = content.tool_call || {};
    var approval = content.approval || {};
    var artifact = content.artifact_ref || {};
    return renderStepCard({
      title: runtimeTitle,
      subtitle: content.source_run_title || content.runtime_type || '',
      status: content.error ? 'failed' : 'completed',
      source: content.family || content.source || '',
      body: runtimeBody,
      tone: section,
      facts: [
        { label: 'runtime', value: content.runtime_type },
        { label: 'sequence', value: content.sequence },
        { label: 'tool', value: toolCall.name || toolCall.tool_name || toolCall.toolName },
        { label: 'approval', value: approval.status || approval.approval_state },
        { label: 'artifact', value: artifact.title || artifact.kind || artifact.id }
      ],
      details: [
        renderRawDetails('Data details', content.data),
        renderRawDetails('Tool call details', content.tool_call),
        renderRawDetails('Approval details', content.approval),
        renderRawDetails('Artifact details', content.artifact_ref),
        renderRawDetails('Raw trace', content.raw_json)
      ]
    });
  }

  // =========================================================================
  // Per-render state
  // =========================================================================

  function createState(taskId) {
    return {
      taskId: taskId || null,
      task: null,
      eventSource: null,
      currentStatus: 'pending',
      events: [],
      activeTraceSection: 'all',
      reconnectTimer: null,
      destroyed: false,
      seenEventIds: {},
      _unbindFns: []
    };
  }

  // =========================================================================
  // Event rendering
  // =========================================================================

  function renderEvent(evt) {
    var content = evt.content || {};
    var type = evt.event_type || '';
    var html = '';

    if (type === 'progress') {
      html = renderProgressEvent(content);
    } else if (type === 'agent_message') {
      html = '<div class="atd-log-entry atd-log-agent">' +
        '<strong style="color:var(--lex-color-primary-600);">Lana:</strong> ' +
        escHtml(content.message || '') +
      '</div>';
    } else if (type === 'user_message') {
      html = '<div class="atd-log-entry atd-log-user">' +
        '<strong>You:</strong> ' +
        escHtml(content.message || '') +
      '</div>';
    } else if (type === 'status_change') {
      html = renderStepCard({
        title: 'Status change',
        subtitle: 'Run lifecycle',
        status: content.to_status || '',
        source: 'runtime',
        body: (statusLabel(content.from_status || '') || 'New run') + ' to ' + statusLabel(content.to_status || ''),
        tone: 'runtime'
      });
    } else if (type === 'approval_request') {
      html = renderStepCard({
        title: 'Approval requested',
        subtitle: content.artifact_type || content.source_type || '',
        status: content.status || 'awaiting_approval',
        source: 'approval',
        body: content.summary || 'Requesting approval for proposed changes.',
        tone: 'approval',
        facts: [
          { label: 'artifact', value: content.title || content.artifact_type },
          { label: 'changes', value: Array.isArray(content.proposed_changes) ? content.proposed_changes.length : '' },
          { label: 'approval', value: content.approval_id }
        ],
        details: [
          renderRawDetails('Proposed change details', content.proposed_changes),
          renderRawDetails('Raw approval JSON', content.raw_json)
        ]
      });
    } else if (type === 'approval_response') {
      var approved = content.approved;
      html = renderStepCard({
        title: approved ? 'Approved' : 'Rejected',
        subtitle: 'Human decision',
        status: approved ? 'approved' : 'rejected',
        source: 'approval',
        body: content.reason || '',
        tone: 'approval'
      });
    } else if (type === 'error') {
      html = '<div class="atd-log-entry atd-log-error">' +
        '<strong>Error:</strong> ' + escHtml(content.message || 'Unknown error') +
      '</div>';
    } else if (type === 'completion') {
      html = renderStepCard({
        title: 'Completed',
        subtitle: 'Run complete',
        status: 'completed',
        source: 'runtime',
        body: content.summary || 'Task completed successfully.',
        tone: 'deliverable',
        details: [renderRawDetails('Completion details', content)]
      });
    } else if (type === 'runtime_event') {
      html = renderRuntimeEvent(content);
    } else if (type === 'artifact') {
      var artifactStatus = content.status || '';
      html = renderStepCard({
        title: content.title || 'Artifact',
        subtitle: content.artifact_type || '',
        status: artifactStatus,
        source: 'artifact',
        body: content.summary || 'Artifact produced by this run.',
        tone: 'deliverable',
        facts: [
          { label: 'artifact', value: content.artifact_type },
          { label: 'target', value: content.apply_target_type },
          { label: 'record', value: content.apply_target_id }
        ],
        details: [
          renderRawDetails('Proposed change details', content.proposed_changes),
          renderRawDetails('Raw artifact JSON', content.raw_json)
        ]
      });
    } else if (type === 'outcome') {
      html = renderStepCard({
        title: content.outcome || content.status || 'Outcome',
        subtitle: 'Run outcome',
        status: content.status || 'completed',
        source: 'outcome',
        body: content.summary || compactObjectSummary(content),
        tone: 'deliverable',
        details: [renderRawDetails('Outcome details', content)]
      });
    } else if (type === 'stream') {
      return '';
    }

    return html;
  }

  function appendEvent(state, evt) {
    if (!evt) return;
    var eventId = evt.id || null;
    if (eventId && state.seenEventIds[eventId]) return;
    if (eventId) state.seenEventIds[eventId] = true;
    state.events.push(evt);
    renderTrace(state);

    if (evt.event_type === 'approval_request') {
      showApproval(evt.content || {});
    }

    if (evt.event_type === 'status_change' && evt.content) {
      updateUIForStatus(state, evt.content.to_status);
    }
  }

  // =========================================================================
  // UI state
  // =========================================================================

  function updateUIForStatus(state, status) {
    state.currentStatus = status;
    setBanner(state.task, status);
    if (state.task) {
      state.task.execution_status = status;
      renderRunSummary(state.task);
    }

    var dot = el('atdStatusDot');
    var label = el('atdStatusLabel');
    if (dot) dot.style.background = statusColor(status);
    if (label) label.textContent = statusLabel(status);

    if (status === 'awaiting_input') show('atdInputArea');
    else hide('atdInputArea');

    if (status === 'awaiting_approval') show('atdApprovalPanel');
    else hide('atdApprovalPanel');

    if (!isTerminal(status)) show('atdCancelArea');
    else hide('atdCancelArea');

    if (status === 'failed' || status === 'cancelled') show('atdRetryArea');
    else hide('atdRetryArea');
  }

  function decodeText(value) {
    var text = value == null ? '' : String(value);
    if (text.indexOf('&') === -1) return text;
    var textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
  }

  function parseStructuredValue(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'object') return value;

    var text = decodeText(value).trim();
    if (!text) return '';
    if (text !== '(empty)' && (text.charAt(0) === '{' || text.charAt(0) === '[')) {
      try {
        return JSON.parse(text);
      } catch (_err) {
        return text;
      }
    }
    return text;
  }

  function readableValue(value) {
    var parsed = parseStructuredValue(value);
    if (parsed == null || parsed === '') return '(empty)';
    if (typeof parsed === 'object') return compactObjectSummary(parsed) || 'Structured data';
    return String(parsed);
  }

  function renderPrimitivePayloadValue(label, value) {
    var rendered = summarizeValue(value);
    if (!rendered) return '';
    return '<div class="atd-readable-row">' +
      '<span>' + escHtml(humanizeKey(label)) + '</span>' +
      '<strong>' + escHtml(rendered) + '</strong>' +
    '</div>';
  }

  function renderReadableObject(value, depth) {
    if (!value || typeof value !== 'object') return '';
    var keys = Object.keys(value);
    var rows = [];
    var nested = [];
    var currentDepth = depth || 0;

    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var item = value[key];
      if (item == null || item === '') continue;
      if (typeof item === 'object') {
        if (currentDepth < 1) {
          var child = renderReadablePayload(item, humanizeKey(key), currentDepth + 1);
          if (child) nested.push(child);
        } else {
          rows.push(renderPrimitivePayloadValue(key, summarizeValue(item)));
        }
      } else {
        rows.push(renderPrimitivePayloadValue(key, item));
      }
    }

    var html = '';
    if (rows.length) html += '<div class="atd-readable-grid">' + rows.join('') + '</div>';
    if (nested.length) html += '<div class="atd-readable-nested">' + nested.join('') + '</div>';
    return html;
  }

  function renderReadablePayload(value, title, depth) {
    var parsed = parseStructuredValue(value);
    if (parsed == null || parsed === '') return '';
    var heading = title ? '<div class="atd-readable-title">' + escHtml(humanizeKey(title)) + '</div>' : '';

    if (typeof parsed !== 'object') {
      return '<div class="atd-readable-payload">' +
        heading +
        '<div class="atd-readable-text">' + escHtml(String(parsed)) + '</div>' +
      '</div>';
    }

    if (Array.isArray(parsed)) {
      if (parsed.length === 0) return '';
      var listHtml = '';
      for (var i = 0; i < parsed.length; i++) {
        var item = parsed[i];
        var itemTitle = title ? title + ' ' + String(i + 1) : 'Item ' + String(i + 1);
        if (item && typeof item === 'object') {
          listHtml += '<div class="atd-readable-item">' + renderReadablePayload(item, itemTitle, (depth || 0) + 1) + '</div>';
        } else {
          listHtml += '<div class="atd-readable-item">' + escHtml(summarizeValue(item)) + '</div>';
        }
      }
      return '<div class="atd-readable-payload">' + heading + listHtml + '</div>';
    }

    if (Array.isArray(parsed.workstreams)) {
      return '<div class="atd-readable-payload">' +
        heading +
        renderWorkstreams(parsed.workstreams) +
        renderReadableObject(withoutKeys(parsed, ['workstreams']), depth || 0) +
      '</div>';
    }

    if (Array.isArray(parsed.proposed_changes)) {
      return '<div class="atd-readable-payload">' +
        heading +
        renderProposedChanges(parsed.proposed_changes) +
        renderReadableObject(withoutKeys(parsed, ['proposed_changes']), depth || 0) +
      '</div>';
    }

    return '<div class="atd-readable-payload">' +
      heading +
      renderReadableObject(parsed, depth || 0) +
    '</div>';
  }

  function withoutKeys(value, keysToDrop) {
    var out = {};
    if (!value || typeof value !== 'object') return out;
    var keys = Object.keys(value);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var drop = false;
      for (var j = 0; j < keysToDrop.length; j++) {
        if (key === keysToDrop[j]) drop = true;
      }
      if (!drop) out[key] = value[key];
    }
    return out;
  }

  function renderWorkstreams(workstreams) {
    if (!Array.isArray(workstreams) || workstreams.length === 0) return '';
    var html = '<div class="atd-readable-list">';
    for (var i = 0; i < workstreams.length; i++) {
      var workstream = workstreams[i] || {};
      var meta = [];
      if (workstream.owner_role) meta.push('Owner: ' + humanizeValue(workstream.owner_role));
      if (workstream.estimated_duration_days != null) meta.push('Duration: ' + workstream.estimated_duration_days + ' days');
      html += '<div class="atd-readable-card">' +
        '<div class="atd-readable-card-title">' + escHtml(workstream.name || ('Workstream ' + String(i + 1))) + '</div>' +
        '<div class="atd-readable-card-body">' + escHtml(workstream.scope || workstream.description || 'No scope provided.') + '</div>' +
        (meta.length ? '<div class="atd-deliverable-meta">' + escHtml(meta.join(' · ')) + '</div>' : '') +
      '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderProposedChanges(changes) {
    if (!Array.isArray(changes) || changes.length === 0) return '';
    var html = '<div class="atd-readable-list">';
    for (var i = 0; i < changes.length; i++) {
      var change = changes[i] || {};
      html += '<div class="atd-readable-card">' +
        '<div class="atd-readable-card-title">' + escHtml(humanizeKey(change.entity || 'Proposed change')) + '</div>' +
        (change.field ? '<div class="atd-approval-item-kind">' + escHtml(humanizeKey(change.field)) + '</div>' : '') +
        '<div class="atd-readable-card-body">' + escHtml(readableValue(change.new_value || change.description || 'No description provided.')) + '</div>' +
      '</div>';
    }
    html += '</div>';
    return html;
  }

  function showApproval(content) {
    var summaryEl = el('atdApprovalSummary');
    if (summaryEl) summaryEl.textContent = content.summary || 'Review proposed changes';

    var descriptionEl = el('atdApprovalDescription');
    if (descriptionEl) {
      var descriptionHtml = '';
      var proposed = content.proposed_changes || [];
      if (proposed.length > 0) {
        for (var i = 0; i < proposed.length; i++) {
          var change = proposed[i] || {};
          descriptionHtml += '<div class="atd-approval-item">';
          descriptionHtml += '<div class="atd-approval-item-title">' + escHtml(humanizeKey(decodeText(change.entity || 'Proposed change'))) + '</div>';
          if (change.field) {
            descriptionHtml += '<div class="atd-approval-item-kind">' + escHtml(humanizeKey(decodeText(change.field))) + '</div>';
          }
          descriptionHtml += '<div class="atd-approval-item-body">' + escHtml(readableValue(change.new_value || 'No description provided.')) + '</div>';
          descriptionHtml += '</div>';
        }
      } else {
        descriptionHtml = '<div class="atd-approval-item-body">No human-readable description was provided.</div>';
      }
      descriptionEl.innerHTML = descriptionHtml;
    }

    var diffContainer = el('atdDiffContainer');
    if (diffContainer) {
      var raw = content.raw_json || null;
      if (!raw && content.proposed_changes && content.proposed_changes.length > 0) {
        raw = content.proposed_changes.map(function (change) {
          return {
            entity: change.entity || null,
            field: change.field || null,
            raw_json: change.raw_json || null
          };
        });
      }
      var rawText = '';
      try {
        rawText = JSON.stringify(raw || {}, null, 2);
      } catch (err) {
        rawText = String(raw || '');
      }
      diffContainer.textContent = rawText;
    }

    show('atdApprovalPanel');
  }

  function collectDeliverables(task) {
    var artifacts = (task && task.artifacts) || [];
    var applied = artifacts.filter(function (artifact) {
      return artifact && (artifact.status === 'applied' || artifact.status === 'approved');
    });
    if (applied.length > 0) return applied;
    if (task && task.execution_status === 'completed') {
      return artifacts.filter(function (artifact) {
        return artifact && artifact.status !== 'rejected' && artifact.status !== 'failed';
      });
    }
    return [];
  }

  function renderDeliverables(task) {
    var panel = el('atdDeliverables');
    if (!panel) return;
    var deliverables = collectDeliverables(task);
    updateDeliverablesCount(deliverables.length);
    if (deliverables.length === 0) {
      panel.innerHTML = '<lex-card padding="none">' +
        '<div class="atd-deliverables-head">Deliverables</div>' +
        '<div class="atd-deliverables-empty">No deliverables have been produced for this run yet.</div>' +
      '</lex-card>';
      return;
    }

    var html = '<lex-card padding="none">';
    html += '<div class="atd-deliverables-head">Deliverables</div>';
    html += '<div class="atd-deliverables-list">';
    for (var i = 0; i < deliverables.length; i++) {
      var artifact = deliverables[i] || {};
      var changes = artifactToReadableItems(artifact);
      var target = artifactTarget(artifact);
      var payload = artifact.content_jsonb || artifact.payload || artifact.content;
      html += '<div class="atd-deliverable">';
      html += '<div class="atd-deliverable-title">' + escHtml(artifact.title || artifact.kind || 'Artifact') + '</div>';
      html += '<div class="atd-deliverable-meta">' + escHtml(humanizeValue(artifact.kind || 'artifact') + ' · ' + statusLabel(artifact.status || 'completed')) + '</div>';
      if (target) {
        html += '<div class="atd-deliverable-target"><span>Applied target</span>' + renderTargetLink(target) + '</div>';
      }
      if (artifact.approval_status || artifact.approval_state || artifact.decision) {
        html += '<div class="atd-deliverable-target"><span>Approval</span><strong>' + escHtml(humanizeValue(artifact.approval_status || artifact.approval_state || artifact.decision)) + '</strong></div>';
      }
      if (changes.length > 0) {
        html += '<div class="atd-deliverable-items">';
        for (var j = 0; j < changes.length; j++) html += changes[j];
        html += '</div>';
      } else {
        html += renderReadablePayload(payload, 'Artifact payload', 0);
      }
      html += renderRawDetails('Raw artifact JSON', artifact.content_jsonb || artifact.payload || artifact.content || artifact);
      html += '</div>';
    }
    html += '</div></lex-card>';
    panel.innerHTML = html;
  }

  function artifactTarget(artifact) {
    if (!artifact) return null;
    var id = firstValue([
      artifact.apply_target_id,
      artifact.target_id,
      artifact.entity_id,
      artifact.record_id
    ]);
    if (!id) return null;
    var type = firstValue([
      artifact.apply_target_type,
      artifact.target_type,
      artifact.entity_type,
      artifact.kind
    ]);
    var url = firstValue([
      artifact.apply_target_url,
      artifact.target_url,
      artifact.url,
      targetUrl(type, id)
    ]);
    return { id: id, type: type, url: url };
  }

  function artifactToReadableItems(artifact) {
    var content = parseStructuredValue(artifact && (artifact.content_jsonb || artifact.payload || artifact.content));
    var items = [];
    if (!content || typeof content !== 'object') return items;
    if (Array.isArray(content.workstreams)) {
      items.push(renderWorkstreams(content.workstreams));
    }
    if (Array.isArray(content.proposed_changes)) {
      items.push(renderProposedChanges(content.proposed_changes));
    }
    return items;
  }

  // =========================================================================
  // API interactions
  // =========================================================================

  // Download the full run history (JSON or HTML) via the agent-runs export
  // endpoint. Authenticated fetch -> blob -> anchor download keeps the JWT in a
  // header rather than the URL. The backend sets Content-Disposition; we set the
  // anchor filename to match so the saved file is named predictably. The run id
  // is the same id the legacy agentic-tasks alias uses, so it targets the
  // canonical /api/v1/agent-runs/:id/export route directly.
  function exportRunFile(state, format) {
    if (!state.taskId) return;
    var fmt = format === 'html' ? 'html' : 'json';
    var token = localStorage.getItem('token') || '';
    var baseUrl = (window.api && window.api.baseUrl) ? window.api.baseUrl : '';
    var url = baseUrl + '/api/v1/agent-runs/' + encodeURIComponent(state.taskId) + '/export?format=' + fmt;
    fetch(url, { headers: token ? { Authorization: 'Bearer ' + token } : {} })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.blob();
      })
      .then(function (blob) {
        var objectUrl = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = objectUrl;
        a.download = 'agent-run-' + state.taskId + '.' + fmt;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 1000);
        if (window.Lex && window.Lex.Toast) window.Lex.Toast.success('Run exported (' + fmt.toUpperCase() + ')');
      })
      .catch(function (err) {
        console.error('[AgenticTaskDetail] export failed:', err);
        if (window.Lex && window.Lex.Toast) {
          window.Lex.Toast.error('Export failed: ' + (err && err.message ? err.message : 'unknown error'));
        }
      });
  }

  function loadTask(state) {
    if (!window.api || typeof window.api.get !== 'function') {
      var onReady = function () { loadTask(state); };
      state._lexReadyHandler = onReady;
      document.addEventListener('lex-ready', onReady, { once: true });
      return;
    }

    window.api.get('/api/v1/agentic-tasks/' + state.taskId)
      .then(function (resp) {
        if (state.destroyed) return;
        state.task = resp.data || {};
        var events = state.task.events || [];

        var matterEl = el('atdMatterLink');
        if (matterEl && state.task.matter_id) {
          matterEl.href = '../workspace-details.html?id=' + encodeURIComponent(state.task.matter_id);
          matterEl.classList.remove('hidden');
        } else if (matterEl) {
          matterEl.classList.add('hidden');
        }

        // The run loaded, so it can be exported. Reveal the export actions row.
        var runActionsEl = el('atdRunActions');
        if (runActionsEl) runActionsEl.classList.remove('hidden');

        var log = el('atdLog');
        if (log) log.innerHTML = '';
        state.seenEventIds = {};
        state.events = [];

        for (var i = 0; i < events.length; i++) {
          appendEvent(state, events[i]);
        }

        renderDeliverables(state.task);
        updateUIForStatus(state, state.task.execution_status || 'pending');

        startSSE(state);
      })
      .catch(function (err) {
        if (state.destroyed) return;
        var log = el('atdLog');
        if (log) log.innerHTML = '<div style="padding:24px;text-align:center;color:var(--lex-color-danger-500);">Failed to load task</div>';
        console.error('[AgenticTaskDetail] Load error:', err);
      });
  }

  // =========================================================================
  // SSE streaming
  // =========================================================================

  function startSSE(state) {
    if (state.eventSource) {
      state.eventSource.close();
      state.eventSource = null;
    }

    if (isTerminal(state.currentStatus)) return;
    if (state.destroyed) return;

    var token = localStorage.getItem('token') || '';
    var baseUrl = (window.api && window.api.baseUrl) ? window.api.baseUrl : '';
    var url = baseUrl + '/api/v1/agentic-tasks/' + state.taskId + '/stream';
    if (token) url += '?token=' + encodeURIComponent(token);

    state.eventSource = new EventSource(url);

    state.eventSource.addEventListener('event', function (e) {
      if (state.destroyed) return;
      try {
        var evt = JSON.parse(e.data);
        appendEvent(state, evt);
      } catch (parseErr) {
        console.error('[AgenticTaskDetail] SSE parse error:', parseErr);
      }
    });

    state.eventSource.addEventListener('status', function (e) {
      if (state.destroyed) return;
      try {
        var data = JSON.parse(e.data);
        if (data.execution_status) {
          updateUIForStatus(state, data.execution_status);
        }
      } catch (err) { /* ignore */ }
    });

    state.eventSource.addEventListener('catchup', function (e) {
      if (state.destroyed) return;
      try {
        var events = JSON.parse(e.data);
        if (!Array.isArray(events)) return;
        for (var i = 0; i < events.length; i++) {
          appendEvent(state, events[i]);
        }
      } catch (err) {
        console.error('[AgenticTaskDetail] SSE catchup parse error:', err);
      }
    });

    state.eventSource.addEventListener('done', function (e) {
      if (state.destroyed) return;
      try {
        var data = JSON.parse(e.data);
        updateUIForStatus(state, data.execution_status || 'completed');
      } catch (err) { /* ignore */ }
      if (state.eventSource) { state.eventSource.close(); state.eventSource = null; }
    });

    state.eventSource.addEventListener('heartbeat', function () { /* keep-alive */ });

    state.eventSource.onerror = function () {
      if (state.eventSource) { state.eventSource.close(); state.eventSource = null; }
      if (!state.destroyed && !isTerminal(state.currentStatus)) {
        state.reconnectTimer = setTimeout(function () {
          state.reconnectTimer = null;
          if (!state.destroyed) startSSE(state);
        }, 5000);
      }
    };
  }

  function stopSSE(state) {
    if (state.eventSource) {
      try { state.eventSource.close(); } catch (e) { /* ignore */ }
      state.eventSource = null;
    }
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
  }

  // =========================================================================
  // User actions
  // =========================================================================

  function sendResponse(state) {
    var input = el('atdMessageInput');
    if (!input) return;
    var message = input.value.trim();
    if (!message) return;

    var sendBtn = el('atdSendBtn');
    if (sendBtn) sendBtn.setAttribute('disabled', '');

    window.api.post('/api/v1/agentic-tasks/' + state.taskId + '/respond', { message: message })
      .then(function (resp) {
        if (state.destroyed) return;
        input.value = '';
        if (sendBtn) sendBtn.removeAttribute('disabled');

        appendEvent(state, {
          event_type: 'user_message',
          content: { message: message }
        });

        if (resp.data && resp.data.status) {
          updateUIForStatus(state, resp.data.status);
        }
      })
      .catch(function (err) {
        if (sendBtn) sendBtn.removeAttribute('disabled');
        console.error('[AgenticTaskDetail] Respond error:', err);
        if (window.Lex && window.Lex.Toast) {
          window.Lex.Toast.show('Failed to send message', 'error');
        }
      });
  }

  function approveTask(state) {
    var approveBtn = el('atdApproveBtn');
    if (approveBtn) approveBtn.setAttribute('disabled', '');

    window.api.post('/api/v1/agentic-tasks/' + state.taskId + '/approve', {})
      .then(function () {
        if (state.destroyed) return;
        hide('atdApprovalPanel');
        appendEvent(state, {
          event_type: 'approval_response',
          content: { approved: true }
        });
        if (approveBtn) approveBtn.removeAttribute('disabled');
      })
      .catch(function (err) {
        if (approveBtn) approveBtn.removeAttribute('disabled');
        console.error('[AgenticTaskDetail] Approve error:', err);
        if (window.Lex && window.Lex.Toast) {
          window.Lex.Toast.show('Failed to approve', 'error');
        }
      });
  }

  function rejectTask(state) {
    var reasonInput = el('atdRejectReasonInput');
    var reason = reasonInput ? reasonInput.value.trim() : '';
    var rejectBtn = el('atdRejectBtn');
    if (rejectBtn) rejectBtn.setAttribute('disabled', '');

    window.api.post('/api/v1/agentic-tasks/' + state.taskId + '/reject', { reason: reason })
      .then(function () {
        if (state.destroyed) return;
        hide('atdApprovalPanel');
        updateUIForStatus(state, 'rejected');
        appendEvent(state, {
          event_type: 'approval_response',
          content: { approved: false, reason: reason }
        });
        if (rejectBtn) rejectBtn.removeAttribute('disabled');
      })
      .catch(function (err) {
        if (rejectBtn) rejectBtn.removeAttribute('disabled');
        console.error('[AgenticTaskDetail] Reject error:', err);
        if (window.Lex && window.Lex.Toast) {
          window.Lex.Toast.show('Failed to reject', 'error');
        }
      });
  }

  function cancelTask(state) {
    if (!confirm('Cancel this task? This cannot be undone.')) return;

    var cancelBtn = el('atdCancelBtn');
    if (cancelBtn) cancelBtn.setAttribute('disabled', '');

    window.api.post('/api/v1/agentic-tasks/' + state.taskId + '/cancel', {})
      .then(function () {
        if (state.destroyed) return;
        updateUIForStatus(state, 'cancelled');
        if (cancelBtn) cancelBtn.removeAttribute('disabled');
        if (window.Lex && window.Lex.Toast) {
          window.Lex.Toast.show('Task cancelled', 'info');
        }
      })
      .catch(function (err) {
        if (cancelBtn) cancelBtn.removeAttribute('disabled');
        console.error('[AgenticTaskDetail] Cancel error:', err);
        if (window.Lex && window.Lex.Toast) {
          window.Lex.Toast.show('Failed to cancel', 'error');
        }
      });
  }

  function retryTask(state) {
    var retryBtn = el('atdRetryBtn');
    if (retryBtn) retryBtn.setAttribute('disabled', '');

    window.api.post('/api/v1/agentic-tasks/' + state.taskId + '/retry', {})
      .then(function () {
        if (state.destroyed) return;
        updateUIForStatus(state, 'pending');
        if (retryBtn) retryBtn.removeAttribute('disabled');
        if (window.Lex && window.Lex.Toast) {
          window.Lex.Toast.show('Task scheduled for retry in ~2 minutes', 'success');
        }
        startSSE(state);
      })
      .catch(function (err) {
        if (retryBtn) retryBtn.removeAttribute('disabled');
        console.error('[AgenticTaskDetail] Retry error:', err);
        if (window.Lex && window.Lex.Toast) {
          window.Lex.Toast.show('Failed to retry: ' + (err && err.message ? err.message : 'Unknown error'), 'error');
        }
      });
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  function render(rootEl, ctx) {
    rootEl.innerHTML = TEMPLATE;

    var taskId = ctx && ctx.id;
    var state = createState(taskId);
    rootEl._activityDetailState = state;

    if (!state.taskId) {
      var log = el('atdLog');
      if (log) log.innerHTML = '<div style="padding:24px;text-align:center;color:var(--lex-text-tertiary);">No task ID provided</div>';
      return;
    }

    // Back link — internal SPA navigation.
    var back = rootEl.querySelector('[data-back-link]');
    if (back) {
      var backHandler = function (e) {
        e.preventDefault();
        ctx.app.setView('activity');
      };
      back.addEventListener('click', backHandler);
      state._unbindFns.push(function () { back.removeEventListener('click', backHandler); });
    }

    var exportJsonBtn = el('atdExportJson');
    if (exportJsonBtn) {
      var exportJsonHandler = function () { exportRunFile(state, 'json'); };
      exportJsonBtn.addEventListener('click', exportJsonHandler);
      state._unbindFns.push(function () { exportJsonBtn.removeEventListener('click', exportJsonHandler); });
    }

    var exportHtmlBtn = el('atdExportHtml');
    if (exportHtmlBtn) {
      var exportHtmlHandler = function () { exportRunFile(state, 'html'); };
      exportHtmlBtn.addEventListener('click', exportHtmlHandler);
      state._unbindFns.push(function () { exportHtmlBtn.removeEventListener('click', exportHtmlHandler); });
    }

    var sendBtn = el('atdSendBtn');
    if (sendBtn) {
      var sendHandler = function () { sendResponse(state); };
      sendBtn.addEventListener('click', sendHandler);
      state._unbindFns.push(function () { sendBtn.removeEventListener('click', sendHandler); });
    }

    var messageInput = el('atdMessageInput');
    if (messageInput) {
      var keyHandler = function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendResponse(state);
        }
      };
      messageInput.addEventListener('keydown', keyHandler);
      state._unbindFns.push(function () { messageInput.removeEventListener('keydown', keyHandler); });
    }

    var approveBtn = el('atdApproveBtn');
    if (approveBtn) {
      var approveHandler = function () { approveTask(state); };
      approveBtn.addEventListener('click', approveHandler);
      state._unbindFns.push(function () { approveBtn.removeEventListener('click', approveHandler); });
    }

    var rejectBtn = el('atdRejectBtn');
    if (rejectBtn) {
      var rejectHandler = function () {
        var reasonEl = el('atdRejectReason');
        if (reasonEl && reasonEl.classList.contains('hidden')) {
          show('atdRejectReason');
          var inputEl = el('atdRejectReasonInput');
          if (inputEl) inputEl.focus();
        } else {
          rejectTask(state);
        }
      };
      rejectBtn.addEventListener('click', rejectHandler);
      state._unbindFns.push(function () { rejectBtn.removeEventListener('click', rejectHandler); });
    }

    var cancelBtn = el('atdCancelBtn');
    if (cancelBtn) {
      var cancelHandler = function () { cancelTask(state); };
      cancelBtn.addEventListener('click', cancelHandler);
      state._unbindFns.push(function () { cancelBtn.removeEventListener('click', cancelHandler); });
    }

    var retryBtn = el('atdRetryBtn');
    if (retryBtn) {
      var retryHandler = function () { retryTask(state); };
      retryBtn.addEventListener('click', retryHandler);
      state._unbindFns.push(function () { retryBtn.removeEventListener('click', retryHandler); });
    }

    var diffToggle = el('atdDiffToggle');
    if (diffToggle) {
      var diffHandler = function () {
        var container = el('atdDiffContainer');
        if (!container) return;
        if (container.classList.contains('hidden')) {
          show('atdDiffContainer');
          diffToggle.textContent = 'Hide raw JSON';
        } else {
          hide('atdDiffContainer');
          diffToggle.textContent = 'Show raw JSON';
        }
      };
      diffToggle.addEventListener('click', diffHandler);
      state._unbindFns.push(function () { diffToggle.removeEventListener('click', diffHandler); });
    }

    var tabButtons = rootEl.querySelectorAll('[data-atd-tab]');
    for (var i = 0; i < tabButtons.length; i++) {
      (function (button) {
        var tabHandler = function () {
          setActiveTab(button.getAttribute('data-atd-tab') || 'execution');
        };
        button.addEventListener('click', tabHandler);
        state._unbindFns.push(function () { button.removeEventListener('click', tabHandler); });
      })(tabButtons[i]);
    }

    var traceButtons = rootEl.querySelectorAll('[data-atd-trace]');
    for (var k = 0; k < traceButtons.length; k++) {
      (function (button) {
        var traceHandler = function () {
          setActiveTraceSection(state, button.getAttribute('data-atd-trace') || 'all');
        };
        button.addEventListener('click', traceHandler);
        state._unbindFns.push(function () { button.removeEventListener('click', traceHandler); });
      })(traceButtons[k]);
    }

    loadTask(state);
  }

  function destroy(rootEl) {
    var state = rootEl && rootEl._activityDetailState;
    if (!state) return;
    state.destroyed = true;
    stopSSE(state);
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
    rootEl._activityDetailState = null;
  }

  global.LanaAgentsApp.Views.activityDetail = { render: render, destroy: destroy };
})(typeof window !== 'undefined' ? window : globalThis);
