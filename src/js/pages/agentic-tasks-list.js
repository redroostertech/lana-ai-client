/* Agentic Tasks List — Full page view of all Lana interactive tasks.
   Provides filtering by status and priority, pagination, and click-to-detail routing.

   Rules:
     - NO regex anywhere — string methods only (includes, indexOf, split, etc.)
     - All HTML escaping via Lex.Utils.escapeHtml()
     - All time/date formatting via Lex.Utils.timeAgo()
     - IIFE wrapper to keep scope clean
*/

(function () {
  'use strict';

  var escHtml = Lex.Utils.escapeHtml;
  var timeAgo = Lex.Utils.timeAgo;

  // =========================================================================
  // State
  // =========================================================================

  var _currentPage     = 1;
  var _pageSize        = 20;
  var _statusFilter    = '';
  var _priorityFilter  = '';
  var _totalItems      = 0;

  // =========================================================================
  // Helpers
  // =========================================================================

  function el(id) { return document.getElementById(id); }
  function show(id) { var e = el(id); if (e) e.classList.remove('hidden'); }
  function hide(id) { var e = el(id); if (e) e.classList.add('hidden'); }

  /**
   * Get a human-readable status label.
   */
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

  /**
   * Get a status dot color.
   */
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

  /**
   * Get a priority badge color.
   */
  function priorityColor(priority) {
    if (priority === 'urgent')  return '#ef4444';
    if (priority === 'high')    return '#f59e0b';
    if (priority === 'medium')  return '#3b82f6';
    if (priority === 'low')     return '#6b7280';
    return '#9ca3af';
  }

  // =========================================================================
  // Rendering
  // =========================================================================

  /**
   * Render a single task card.
   */
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

  function loadTasks() {
    hide('atItems');
    hide('atEmpty');
    hide('atPagination');
    show('atLoading');

    var offset = (_currentPage - 1) * _pageSize;
    var url = '/api/v1/agentic-tasks?limit=' + _pageSize + '&offset=' + offset;
    if (_statusFilter) url += '&execution_status=' + encodeURIComponent(_statusFilter);
    if (_priorityFilter) url += '&priority=' + encodeURIComponent(_priorityFilter);
    url += '&sort_by=created_at&sort_order=desc';

    api.get(url)
      .then(function (resp) {
        hide('atLoading');
        var tasks = resp.data || [];
        var pagination = resp.pagination || {};
        _totalItems = pagination.total || 0;

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

        // Attach click handlers
        var cards = container.querySelectorAll('.at-task-card');
        for (var j = 0; j < cards.length; j++) {
          cards[j].addEventListener('click', function () {
            var taskId = this.getAttribute('data-task-id');
            if (taskId) {
              window.location.href = 'agentic-task-detail.html?id=' + taskId;
            }
          });
        }

        // Update pagination
        var totalPages = Math.ceil(_totalItems / _pageSize);
        if (totalPages > 1) {
          var pagEl = el('atPagination');
          if (pagEl) {
            pagEl.setAttribute('page', String(_currentPage));
            pagEl.setAttribute('total-pages', String(totalPages));
            pagEl.setAttribute('total', String(_totalItems));
            show('atPagination');
          }
        }
      })
      .catch(function (err) {
        hide('atLoading');
        show('atEmpty');
        console.error('[AgenticTasksList] Failed to load tasks:', err);
      });
  }

  // =========================================================================
  // Event listeners
  // =========================================================================

  function init() {
    // Status filter
    var statusFilterEl = el('atStatusFilter');
    if (statusFilterEl) {
      statusFilterEl.addEventListener('lex-change', function (e) {
        var val = (e.detail && e.detail.value) || statusFilterEl.value || '';
        _statusFilter = (val === 'all') ? '' : val;
        _currentPage = 1;
        loadTasks();
      });
    }

    // Priority filter
    var priorityFilterEl = el('atPriorityFilter');
    if (priorityFilterEl) {
      priorityFilterEl.addEventListener('lex-change', function (e) {
        _priorityFilter = (e.detail && e.detail.value !== undefined) ? e.detail.value : '';
        _currentPage = 1;
        loadTasks();
      });
    }

    // Pagination
    var paginationEl = el('atPagination');
    if (paginationEl) {
      paginationEl.addEventListener('page-change', function (e) {
        _currentPage = e.detail && e.detail.page ? e.detail.page : 1;
        loadTasks();
      });
    }

    // Initial load
    loadTasks();
  }

  // Wait for api to be available
  if (window.api) {
    init();
  } else {
    document.addEventListener('lex-ready', init);
  }

})();
