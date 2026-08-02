/* activity.js — Lana Tasks list SPA view (the "Activity" sidebar item).
   Migrated from src/js/pages/agentic-tasks-list.js. Provides filtering by
   status and priority, pagination, and click-to-detail routing.

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

  // Markup template — extracted from src/agents/agentic-tasks.html
  // (the <main> body inside <template id="page-content">). Cloned into
  // rootEl on render.
  var TEMPLATE = ''
    + '<main>'

    + '<lex-banner variant="light" heading="Lana Tasks" subtitle="Interactive tasks assigned to Lana" lana lana-context-type="full_chat"></lex-banner>'
    + '<lex-breadcrumb style="margin:12px 0 16px;" items=\'[{"label":"LanaAgents","href":"#catalog"},{"label":"Activity"}]\'></lex-breadcrumb>'

    + '<div style="display:flex;gap:12px;align-items:center;margin-bottom:16px;">'
    +   '<lex-segmented'
    +     ' id="atStatusFilter"'
    +     ' value="all"'
    +     ' options=\'[{"value":"all","label":"All"},{"value":"running","label":"Running"},{"value":"awaiting_input","label":"Needs Input"},{"value":"awaiting_approval","label":"Pending Approval"},{"value":"completed","label":"Completed"}]\''
    +   '></lex-segmented>'
    +   '<lex-select'
    +     ' id="atPriorityFilter"'
    +     ' placeholder="All priorities"'
    +     ' options=\'[{"value":"","label":"All priorities"},{"value":"urgent","label":"Urgent"},{"value":"high","label":"High"},{"value":"medium","label":"Medium"},{"value":"low","label":"Low"}]\''
    +   '></lex-select>'
    + '</div>'

    + '<div id="atLoading">'
    +   '<lex-card padding="compact">'
    +     '<div style="padding:16px;" aria-hidden="true">'
    +       '<div style="height:20px;background:var(--lex-bg-tertiary);border-radius:4px;width:60%;margin-bottom:12px;"></div>'
    +       '<div style="height:14px;background:var(--lex-bg-tertiary);border-radius:4px;width:80%;margin-bottom:8px;"></div>'
    +       '<div style="height:14px;background:var(--lex-bg-tertiary);border-radius:4px;width:40%;"></div>'
    +     '</div>'
    +     '<div style="padding:16px;border-top:1px solid var(--lex-border-subtle);" aria-hidden="true">'
    +       '<div style="height:20px;background:var(--lex-bg-tertiary);border-radius:4px;width:55%;margin-bottom:12px;"></div>'
    +       '<div style="height:14px;background:var(--lex-bg-tertiary);border-radius:4px;width:70%;"></div>'
    +     '</div>'
    +   '</lex-card>'
    + '</div>'

    + '<div id="atItems" class="hidden"></div>'

    + '<div id="atEmpty" class="hidden">'
    +   '<lex-empty icon="inbox" message="No Lana tasks" description="Tasks assigned to Lana will appear here"></lex-empty>'
    + '</div>'

    + '<lex-pagination id="atPagination" class="hidden" page="1" total-pages="1" total="0" limit="20"></lex-pagination>'

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
    return status;
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

  function priorityColor(priority) {
    if (priority === 'urgent')  return '#ef4444';
    if (priority === 'high')    return '#f59e0b';
    if (priority === 'medium')  return '#3b82f6';
    if (priority === 'low')     return '#6b7280';
    return '#9ca3af';
  }

  // =========================================================================
  // Per-render state
  // =========================================================================

  function createState() {
    return {
      currentPage: 1,
      pageSize: 20,
      statusFilter: '',
      priorityFilter: '',
      totalItems: 0,
      destroyed: false,
      _unbindFns: []
    };
  }

  // =========================================================================
  // Rendering
  // =========================================================================

  function renderTaskCard(task) {
    var title = escHtml(task.name || 'Untitled task');
    var desc  = escHtml(task.task_description || '').slice(0, 200);
    var status = task.execution_status || 'pending';
    var priority = task.priority || 'medium';
    var sColor = statusColor(status);
    var pColor = priorityColor(priority);

    return '<div class="at-task-card" data-task-id="' + escHtml(task.id) + '" ' +
      'style="padding:16px;border-bottom:1px solid var(--lex-border-subtle);cursor:pointer;transition:background 0.15s ease;"' +
      ' onmouseenter="this.style.background=\'var(--lex-bg-secondary)\'" onmouseleave="this.style.background=\'transparent\'">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + sColor + ';flex-shrink:0;"></span>' +
            '<span style="font-size:0.8125rem;font-weight:500;color:var(--lex-text-primary);">' + title + '</span>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<span style="font-size:0.625rem;text-transform:uppercase;letter-spacing:0.08em;padding:2px 6px;border-radius:3px;background:' + pColor + ';color:#fff;font-weight:600;">' +
              escHtml(priority) +
            '</span>' +
            '<span style="font-size:0.6875rem;color:var(--lex-text-tertiary);">' + escHtml(statusLabel(status)) + '</span>' +
          '</div>' +
        '</div>' +
        (desc ? '<div style="font-size:0.75rem;color:var(--lex-text-secondary);line-height:1.4;margin-bottom:6px;">' + desc + '</div>' : '') +
        '<div style="font-size:0.6875rem;color:var(--lex-text-tertiary);">' +
          (task.created_at ? escHtml(timeAgo(task.created_at)) : '') +
        '</div>' +
      '</div>';
  }

  // =========================================================================
  // Data fetching
  // =========================================================================

  function loadTasks(ctx, state) {
    hide('atItems');
    hide('atEmpty');
    hide('atPagination');
    show('atLoading');

    if (!window.api || typeof window.api.get !== 'function') {
      var onReady = function () { loadTasks(ctx, state); };
      state._lexReadyHandler = onReady;
      document.addEventListener('lex-ready', onReady, { once: true });
      return;
    }

    var offset = (state.currentPage - 1) * state.pageSize;
    var url = '/api/v1/agentic-tasks?limit=' + state.pageSize + '&offset=' + offset;
    if (state.statusFilter) url += '&execution_status=' + encodeURIComponent(state.statusFilter);
    if (state.priorityFilter) url += '&priority=' + encodeURIComponent(state.priorityFilter);
    url += '&sort_by=created_at&sort_order=desc';

    window.api.get(url)
      .then(function (resp) {
        if (state.destroyed) return;
        hide('atLoading');
        var tasks = resp.data || [];
        var pagination = resp.pagination || {};
        state.totalItems = pagination.total || 0;

        if (tasks.length === 0) {
          show('atEmpty');
          return;
        }

        var container = el('atItems');
        if (!container) return;

        var html = '<lex-card padding="compact">';
        for (var i = 0; i < tasks.length; i++) {
          html += renderTaskCard(tasks[i]);
        }
        html += '</lex-card>';
        container.innerHTML = html;
        show('atItems');

        // Click handlers — delegated via container, so cleanup uses one listener.
        var cards = container.querySelectorAll('.at-task-card');
        for (var j = 0; j < cards.length; j++) {
          (function (card) {
            var cardHandler = function () {
              var taskId = card.getAttribute('data-task-id');
              if (taskId) {
                ctx.app.setView('activityDetail', { id: taskId });
              }
            };
            card.addEventListener('click', cardHandler);
            state._unbindFns.push(function () { card.removeEventListener('click', cardHandler); });
          })(cards[j]);
        }

        var totalPages = Math.ceil(state.totalItems / state.pageSize);
        if (totalPages > 1) {
          var pagEl = el('atPagination');
          if (pagEl) {
            pagEl.setAttribute('page', String(state.currentPage));
            pagEl.setAttribute('total-pages', String(totalPages));
            pagEl.setAttribute('total', String(state.totalItems));
            show('atPagination');
          }
        }
      })
      .catch(function (err) {
        if (state.destroyed) return;
        hide('atLoading');
        show('atEmpty');
        console.error('[AgenticTasksList] Failed to load tasks:', err);
      });
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  function render(rootEl, ctx) {
    rootEl.innerHTML = TEMPLATE;

    var state = createState();
    rootEl._activityState = state;

    var statusFilterEl = el('atStatusFilter');
    if (statusFilterEl) {
      var sHandler = function (e) {
        var val = (e.detail && e.detail.value) || statusFilterEl.value || '';
        state.statusFilter = (val === 'all') ? '' : val;
        state.currentPage = 1;
        loadTasks(ctx, state);
      };
      statusFilterEl.addEventListener('lex-change', sHandler);
      state._unbindFns.push(function () { statusFilterEl.removeEventListener('lex-change', sHandler); });
    }

    var priorityFilterEl = el('atPriorityFilter');
    if (priorityFilterEl) {
      var pHandler = function (e) {
        state.priorityFilter = (e.detail && e.detail.value !== undefined) ? e.detail.value : '';
        state.currentPage = 1;
        loadTasks(ctx, state);
      };
      priorityFilterEl.addEventListener('lex-change', pHandler);
      state._unbindFns.push(function () { priorityFilterEl.removeEventListener('lex-change', pHandler); });
    }

    var paginationEl = el('atPagination');
    if (paginationEl) {
      var pageHandler = function (e) {
        state.currentPage = e.detail && e.detail.page ? e.detail.page : 1;
        loadTasks(ctx, state);
      };
      paginationEl.addEventListener('page-change', pageHandler);
      state._unbindFns.push(function () { paginationEl.removeEventListener('page-change', pageHandler); });
    }

    loadTasks(ctx, state);
  }

  function destroy(rootEl) {
    var state = rootEl && rootEl._activityState;
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
    rootEl._activityState = null;
  }

  global.LanaAgentsApp.Views.activity = { render: render, destroy: destroy };
})(typeof window !== 'undefined' ? window : globalThis);
