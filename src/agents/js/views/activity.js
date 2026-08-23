/* activity.js — Outcome-first history for the Agent Studio.
   Uses the legacy-compatible agentic-tasks list endpoint while presenting
   status, required decisions, and finished work in plain language.
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
    + '<main class="agents-activity-page">'
    +   '<lex-banner id="outcomesBanner" variant="light" heading="Outcomes" subtitle="See what your agents produced, what is still underway, and where they need you." lana lana-context-type="full_chat">'
    +     '<lex-btn id="outcomesBuildBtn" variant="primary" icon="plus">Build an agent</lex-btn>'
    +   '</lex-banner>'

    +   '<section class="outcomes-pulse" aria-label="Outcome pulse">'
    +     '<lex-metric id="outcomesMetricTotal" label="All outcomes" value="–"></lex-metric>'
    +     '<lex-metric id="outcomesMetricWorking" label="Working now" value="–"></lex-metric>'
    +     '<lex-metric id="outcomesMetricAttention" label="Need you" value="–"></lex-metric>'
    +     '<lex-metric id="outcomesMetricReady" label="Ready to review" value="–"></lex-metric>'
    +   '</section>'

    +   '<section class="outcomes-workspace" aria-labelledby="outcomesListTitle">'
    +     '<div class="outcomes-workspace-head">'
    +       '<div><span class="outcomes-eyebrow">Agent history</span><h2 id="outcomesListTitle">Work and deliverables</h2></div>'
    +       '<div class="outcomes-filters">'
    +         '<lex-segmented id="atStatusFilter" value="all" options=\'[{"value":"all","label":"All"},{"value":"running","label":"Working"},{"value":"awaiting_input","label":"Needs input"},{"value":"awaiting_approval","label":"Approvals"},{"value":"completed","label":"Ready"}]\'></lex-segmented>'
    +         '<lex-select id="atPriorityFilter" placeholder="All priorities" options=\'[{"value":"","label":"All priorities"},{"value":"urgent","label":"Urgent"},{"value":"high","label":"High"},{"value":"medium","label":"Medium"},{"value":"low","label":"Low"}]\'></lex-select>'
    +       '</div>'
    +     '</div>'

    +     '<div id="atLoading" class="outcomes-loading" aria-hidden="true">'
    +       '<div class="outcomes-row-skeleton"><i></i><div><span></span><small></small></div></div>'
    +       '<div class="outcomes-row-skeleton"><i></i><div><span></span><small></small></div></div>'
    +       '<div class="outcomes-row-skeleton"><i></i><div><span></span><small></small></div></div>'
    +     '</div>'
    +     '<div id="atItems" class="outcomes-list hidden"></div>'
    +     '<div id="atEmpty" class="outcomes-empty hidden"></div>'
    +     '<lex-pagination id="atPagination" class="hidden" page="1" total-pages="1" total="0" limit="20"></lex-pagination>'
    +   '</section>'
    + '</main>';

  function el(id) { return document.getElementById(id); }
  function show(node) { if (node) node.classList.remove('hidden'); }
  function hide(node) { if (node) node.classList.add('hidden'); }

  function humanize(value) {
    var parts = String(value || '').split('_').join(' ').split('-').join(' ').split(' ');
    var words = [];
    for (var i = 0; i < parts.length; i++) if (parts[i]) words.push(parts[i].charAt(0).toUpperCase() + parts[i].slice(1));
    return words.join(' ');
  }

  function statusLabel(status) {
    if (status === 'compiling_context') return 'Getting ready';
    if (status === 'running') return 'Working now';
    if (status === 'queued') return 'Queued';
    if (status === 'awaiting_input') return 'Needs your input';
    if (status === 'awaiting_approval') return 'Ready for approval';
    if (status === 'approved') return 'Approved';
    if (status === 'completed') return 'Outcome ready';
    if (status === 'failed') return 'Needs attention';
    if (status === 'rejected') return 'Not approved';
    if (status === 'cancelled') return 'Cancelled';
    return humanize(status || 'pending');
  }

  function statusGroup(status) {
    if (status === 'completed' || status === 'approved') return 'ready';
    if (status === 'awaiting_input' || status === 'awaiting_approval') return 'attention';
    if (status === 'running' || status === 'queued' || status === 'compiling_context') return 'working';
    if (status === 'failed' || status === 'rejected') return 'issue';
    return 'neutral';
  }

  function statusMessage(status) {
    if (status === 'awaiting_input') return 'Open this outcome to answer the agent and keep the work moving.';
    if (status === 'awaiting_approval') return 'A proposed action is waiting for your review.';
    if (status === 'completed' || status === 'approved') return 'The work is finished and ready for you to review.';
    if (status === 'running' || status === 'compiling_context' || status === 'queued') return 'The agent is handling this now. Open it to follow along.';
    if (status === 'failed') return 'The run stopped before finishing. Open it to see what happened.';
    return 'Open the complete record for details and deliverables.';
  }

  function priorityLabel(priority) {
    if (!priority) return 'Normal';
    return humanize(priority);
  }

  function createState() {
    return { currentPage: 1, pageSize: 20, statusFilter: '', priorityFilter: '', totalItems: 0, tasks: [], destroyed: false, _unbindFns: [] };
  }

  function setMetric(id, value) { var metric = el(id); if (metric) metric.value = String(value); }

  function updateMetrics(state) {
    var working = 0;
    var attention = 0;
    var ready = 0;
    for (var i = 0; i < state.tasks.length; i++) {
      var status = state.tasks[i].execution_status || state.tasks[i].status || '';
      var group = statusGroup(status);
      if (group === 'working') working++;
      if (group === 'attention') attention++;
      if (group === 'ready') ready++;
    }
    setMetric('outcomesMetricTotal', state.totalItems);
    setMetric('outcomesMetricWorking', working);
    setMetric('outcomesMetricAttention', attention);
    setMetric('outcomesMetricReady', ready);
  }

  function renderOutcome(task) {
    var status = task.execution_status || task.status || 'pending';
    var group = statusGroup(status);
    var title = escHtml(task.name || task.title || 'Untitled outcome');
    var description = escHtml(task.task_description || task.description || statusMessage(status));
    var created = task.created_at ? escHtml(timeAgo(task.created_at)) : '';
    var priority = task.priority || 'medium';
    var action = group === 'attention' ? 'Respond now' : (group === 'ready' ? 'Review outcome' : 'Open details');
    return '<button type="button" class="outcome-card outcome-card--' + group + '" data-task-id="' + escHtml(task.id || '') + '">'
      + '<span class="outcome-card-status-icon"><i></i></span>'
      + '<span class="outcome-card-main"><span class="outcome-card-title-row"><strong>' + title + '</strong><span class="outcome-card-priority outcome-card-priority--' + escHtml(priority) + '">' + escHtml(priorityLabel(priority)) + '</span></span>'
      + '<span class="outcome-card-description">' + description + '</span><small>' + escHtml(statusMessage(status)) + '</small></span>'
      + '<span class="outcome-card-meta"><strong>' + escHtml(statusLabel(status)) + '</strong><small>' + created + '</small><span>' + escHtml(action) + ' →</span></span>'
      + '</button>';
  }

  function renderTasks(state) {
    var holder = el('atItems');
    if (!holder) return;
    var html = '';
    for (var i = 0; i < state.tasks.length; i++) html += renderOutcome(state.tasks[i]);
    holder.innerHTML = html;
    show(holder);
  }

  function renderEmpty(state) {
    var empty = el('atEmpty');
    if (!empty) return;
    var filtered = state.statusFilter || state.priorityFilter;
    if (filtered) empty.innerHTML = '<lex-empty icon="search" message="No outcomes match these filters" description="Try All or choose a different priority."></lex-empty>';
    else empty.innerHTML = '<div class="outcomes-first-empty"><span class="outcomes-first-mark">L</span><div><strong>Your agents’ work will collect here.</strong><p>Run an agent from the workspace and return here to review its result, decisions, and deliverables.</p></div><lex-btn id="outcomesEmptyBuildBtn" variant="primary" icon="plus">Build an agent</lex-btn></div>';
    show(empty);
  }

  function loadTasks(ctx, state) {
    hide(el('atItems'));
    hide(el('atEmpty'));
    hide(el('atPagination'));
    show(el('atLoading'));
    if (!window.api || typeof window.api.get !== 'function') {
      var ready = function () { loadTasks(ctx, state); };
      state._lexReadyHandler = ready;
      document.addEventListener('lex-ready', ready, { once: true });
      return;
    }
    var offset = (state.currentPage - 1) * state.pageSize;
    var url = '/api/v1/agentic-tasks?limit=' + state.pageSize + '&offset=' + offset;
    if (state.statusFilter) url += '&execution_status=' + encodeURIComponent(state.statusFilter);
    if (state.priorityFilter) url += '&priority=' + encodeURIComponent(state.priorityFilter);
    url += '&sort_by=created_at&sort_order=desc';
    window.api.get(url).then(function (response) {
      if (state.destroyed) return;
      hide(el('atLoading'));
      state.tasks = response && Array.isArray(response.data) ? response.data : (Array.isArray(response) ? response : []);
      var pagination = response && response.pagination ? response.pagination : {};
      state.totalItems = Number(pagination.total != null ? pagination.total : state.tasks.length);
      updateMetrics(state);
      if (!state.tasks.length) renderEmpty(state);
      else renderTasks(state);
      var totalPages = Math.max(1, Math.ceil(state.totalItems / state.pageSize));
      if (totalPages > 1) {
        var paginationEl = el('atPagination');
        if (paginationEl) {
          paginationEl.setAttribute('page', String(state.currentPage));
          paginationEl.setAttribute('total-pages', String(totalPages));
          paginationEl.setAttribute('total', String(state.totalItems));
          show(paginationEl);
        }
      }
    }).catch(function (err) {
      if (state.destroyed) return;
      console.error('[agents] Failed to load outcomes', err);
      hide(el('atLoading'));
      var empty = el('atEmpty');
      if (empty) empty.innerHTML = '<lex-empty icon="alert-circle" message="Outcomes are unavailable" description="Check the LANA Agents service and try again."></lex-empty>';
      show(empty);
    });
  }

  function bind(state, node, eventName, handler) {
    if (!node) return;
    node.addEventListener(eventName, handler);
    state._unbindFns.push(function () { node.removeEventListener(eventName, handler); });
  }

  function render(rootEl, ctx) {
    rootEl.innerHTML = TEMPLATE;
    var state = createState();
    rootEl._activityState = state;
    bind(state, el('outcomesBuildBtn'), 'click', function () { ctx.app.setView('create'); });
    bind(state, el('atStatusFilter'), 'lex-change', function (event) {
      var value = (event && event.detail && event.detail.value) || 'all';
      state.statusFilter = value === 'all' ? '' : value;
      state.currentPage = 1;
      loadTasks(ctx, state);
    });
    bind(state, el('atPriorityFilter'), 'lex-change', function (event) {
      state.priorityFilter = event && event.detail && event.detail.value !== undefined ? event.detail.value : '';
      state.currentPage = 1;
      loadTasks(ctx, state);
    });
    bind(state, el('atPagination'), 'page-change', function (event) {
      state.currentPage = event && event.detail && event.detail.page ? event.detail.page : 1;
      loadTasks(ctx, state);
    });
    bind(state, el('atItems'), 'click', function (event) {
      var card = event.target.closest('[data-task-id]');
      if (card && card.getAttribute('data-task-id')) ctx.app.setView('activityDetail', { id: card.getAttribute('data-task-id') });
    });
    bind(state, el('atEmpty'), 'click', function (event) {
      if (event.target.closest('#outcomesEmptyBuildBtn')) ctx.app.setView('create');
    });
    loadTasks(ctx, state);
  }

  function destroy(rootEl) {
    var state = rootEl && rootEl._activityState;
    if (!state) return;
    state.destroyed = true;
    if (state._lexReadyHandler) document.removeEventListener('lex-ready', state._lexReadyHandler);
    for (var i = 0; i < state._unbindFns.length; i++) {
      try { state._unbindFns[i](); } catch (_err) { /* ignored */ }
    }
    state._unbindFns = [];
    rootEl._activityState = null;
  }

  global.LanaAgentsApp.Views.activity = { render: render, destroy: destroy };
})(typeof window !== 'undefined' ? window : globalThis);
