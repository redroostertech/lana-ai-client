/* Agentic Task Detail — Interactive task execution view with SSE streaming.
   Shows real-time execution log, input area when awaiting_input, and approval
   panel when awaiting_approval.

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

  var _taskId        = null;
  var _task          = null;
  var _eventSource   = null;
  var _currentStatus = 'pending';

  // =========================================================================
  // Helpers
  // =========================================================================

  function el(id) { return document.getElementById(id); }
  function show(id) { var e = el(id); if (e) e.classList.remove('hidden'); }
  function hide(id) { var e = el(id); if (e) e.classList.add('hidden'); }

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

  function isTerminal(status) {
    return status === 'completed' || status === 'failed' ||
           status === 'rejected'  || status === 'cancelled';
  }

  // =========================================================================
  // Rendering helpers
  // =========================================================================

  /**
   * Render a single event as an execution log entry.
   */
  function renderEvent(evt) {
    var content = evt.content || {};
    var type = evt.event_type || '';
    var html = '';

    if (type === 'progress') {
      var msg = content.message || content.phase || 'Processing...';
      var pct = content.progress_pct ? ' (' + content.progress_pct + '%)' : '';
      html = '<div class="atd-log-entry atd-log-progress">' +
        '<span style="color:var(--lex-color-primary-500);">&#9679;</span> ' +
        escHtml(msg) + escHtml(pct) +
      '</div>';
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
      html = '<div class="atd-log-entry atd-log-progress">' +
        '<span style="color:var(--lex-text-tertiary);">Status:</span> ' +
        escHtml(statusLabel(content.from_status || '')) + ' &rarr; ' +
        escHtml(statusLabel(content.to_status || '')) +
      '</div>';
    } else if (type === 'approval_request') {
      html = '<div class="atd-log-entry atd-log-agent">' +
        '<strong style="color:var(--lex-color-warning-500);">Lana:</strong> ' +
        escHtml(content.summary || 'Requesting approval for proposed changes.') +
      '</div>';
    } else if (type === 'approval_response') {
      var approved = content.approved;
      html = '<div class="atd-log-entry">' +
        '<strong>' + (approved ? 'Approved' : 'Rejected') + '</strong>' +
        (content.reason ? ': ' + escHtml(content.reason) : '') +
      '</div>';
    } else if (type === 'error') {
      html = '<div class="atd-log-entry atd-log-error">' +
        '<strong>Error:</strong> ' + escHtml(content.message || 'Unknown error') +
      '</div>';
    } else if (type === 'completion') {
      html = '<div class="atd-log-entry" style="color:var(--lex-color-success-500, #10b981);">' +
        '<strong>Completed:</strong> ' + escHtml(content.summary || 'Task completed successfully.') +
      '</div>';
    } else if (type === 'stream') {
      // Stream chunks appended inline — handled separately
      return '';
    }

    return html;
  }

  /**
   * Append rendered event to the log container.
   */
  function appendToLog(html) {
    if (!html) return;
    var log = el('atdLog');
    if (!log) return;
    log.insertAdjacentHTML('beforeend', html);
    log.scrollTop = log.scrollHeight;
  }

  // =========================================================================
  // UI state management
  // =========================================================================

  function updateUIForStatus(status) {
    _currentStatus = status;

    // Status display
    var dot = el('atdStatusDot');
    var label = el('atdStatusLabel');
    if (dot) dot.style.background = statusColor(status);
    if (label) label.textContent = statusLabel(status);

    // Input area — only show when awaiting_input
    if (status === 'awaiting_input') {
      show('atdInputArea');
    } else {
      hide('atdInputArea');
    }

    // Approval panel — only show when awaiting_approval
    if (status === 'awaiting_approval') {
      show('atdApprovalPanel');
    } else {
      hide('atdApprovalPanel');
    }

    // Cancel button — show for non-terminal states
    if (!isTerminal(status)) {
      show('atdCancelArea');
    } else {
      hide('atdCancelArea');
    }
  }

  /**
   * Show the approval panel with proposed changes.
   */
  function showApproval(content) {
    var summaryEl = el('atdApprovalSummary');
    if (summaryEl) summaryEl.textContent = content.summary || 'Review proposed changes';

    var diffContainer = el('atdDiffContainer');
    if (diffContainer && content.proposed_changes && content.proposed_changes.length > 0) {
      var diffHtml = '';
      for (var i = 0; i < content.proposed_changes.length; i++) {
        var change = content.proposed_changes[i];
        diffHtml += escHtml(change.entity || 'Entity') + '\n';
        diffHtml += '  ' + escHtml(change.field || '') + ': ';
        diffHtml += escHtml(change.old_value || '(empty)') + ' -> ' + escHtml(change.new_value || '(empty)') + '\n';
      }
      diffContainer.textContent = diffHtml;
    }

    show('atdApprovalPanel');
  }

  // =========================================================================
  // API interactions
  // =========================================================================

  /**
   * Load the task detail and existing events.
   */
  function loadTask() {
    api.get('/api/v1/agentic-tasks/' + _taskId)
      .then(function (resp) {
        _task = resp.data || {};
        var events = _task.events || [];

        // Update header
        var titleEl = el('atdTitle');
        if (titleEl) titleEl.textContent = _task.name || 'Task Detail';

        // Priority badge
        var priorityEl = el('atdPriorityBadge');
        if (priorityEl && _task.priority) {
          priorityEl.innerHTML = '<span class="atd-priority-badge" style="background:' +
            priorityColor(_task.priority) + ';">' + escHtml(_task.priority) + '</span>';
        }

        // Matter link
        var matterEl = el('atdMatterLink');
        if (matterEl && _task.matter_id) {
          matterEl.innerHTML = '<a href="workspace-details.html?id=' + escHtml(_task.matter_id) +
            '" style="color:var(--lex-color-primary-600);font-size:0.75rem;text-decoration:none;">View Matter</a>';
        }

        // Created at
        var createdEl = el('atdCreatedAt');
        if (createdEl && _task.created_at) {
          createdEl.textContent = timeAgo(_task.created_at);
        }

        // Render existing events
        var log = el('atdLog');
        if (log) log.innerHTML = '';

        for (var i = 0; i < events.length; i++) {
          var html = renderEvent(events[i]);
          appendToLog(html);

          // If last event is approval_request, show approval panel
          if (events[i].event_type === 'approval_request') {
            showApproval(events[i].content || {});
          }
        }

        // Update UI for current status
        updateUIForStatus(_task.execution_status || 'pending');

        // Start SSE stream
        startSSE();
      })
      .catch(function (err) {
        var log = el('atdLog');
        if (log) log.innerHTML = '<div style="padding:24px;text-align:center;color:var(--lex-color-danger-500);">Failed to load task</div>';
        console.error('[AgenticTaskDetail] Load error:', err);
      });
  }

  // =========================================================================
  // SSE streaming
  // =========================================================================

  function startSSE() {
    if (_eventSource) {
      _eventSource.close();
      _eventSource = null;
    }

    // Don't start SSE for terminal states
    if (isTerminal(_currentStatus)) return;

    var token = localStorage.getItem('token') || '';
    var baseUrl = (window.api && api.baseUrl) ? api.baseUrl : '';
    var url = baseUrl + '/api/v1/agentic-tasks/' + _taskId + '/stream';
    if (token) url += '?token=' + encodeURIComponent(token);

    _eventSource = new EventSource(url);

    _eventSource.addEventListener('event', function (e) {
      try {
        var evt = JSON.parse(e.data);
        var html = renderEvent(evt);
        appendToLog(html);

        // If this is an approval_request, show the panel
        if (evt.event_type === 'approval_request') {
          showApproval(evt.content || {});
        }

        // If status_change, update UI
        if (evt.event_type === 'status_change' && evt.content) {
          updateUIForStatus(evt.content.to_status);
        }
      } catch (parseErr) {
        console.error('[AgenticTaskDetail] SSE parse error:', parseErr);
      }
    });

    _eventSource.addEventListener('status', function (e) {
      try {
        var data = JSON.parse(e.data);
        if (data.execution_status) {
          updateUIForStatus(data.execution_status);
        }
      } catch (err) { /* ignore */ }
    });

    _eventSource.addEventListener('catchup', function (e) {
      // Catchup events are sent as an array — we already loaded them via API, skip
    });

    _eventSource.addEventListener('done', function (e) {
      try {
        var data = JSON.parse(e.data);
        updateUIForStatus(data.execution_status || 'completed');
      } catch (err) { /* ignore */ }
      if (_eventSource) { _eventSource.close(); _eventSource = null; }
    });

    _eventSource.addEventListener('heartbeat', function () {
      // Keep-alive — no action needed
    });

    _eventSource.onerror = function () {
      // SSE disconnected — retry after delay
      if (_eventSource) { _eventSource.close(); _eventSource = null; }
      if (!isTerminal(_currentStatus)) {
        setTimeout(startSSE, 5000);
      }
    };
  }

  // =========================================================================
  // User actions
  // =========================================================================

  /**
   * Send a user response for awaiting_input tasks.
   */
  function sendResponse() {
    var input = el('atdMessageInput');
    if (!input) return;
    var message = input.value.trim();
    if (!message) return;

    var sendBtn = el('atdSendBtn');
    if (sendBtn) sendBtn.setAttribute('disabled', '');

    api.post('/api/v1/agentic-tasks/' + _taskId + '/respond', { message: message })
      .then(function (resp) {
        input.value = '';
        if (sendBtn) sendBtn.removeAttribute('disabled');

        // Append user message to log immediately
        appendToLog(renderEvent({
          event_type: 'user_message',
          content: { message: message },
        }));

        // Update status if returned
        if (resp.data && resp.data.status) {
          updateUIForStatus(resp.data.status);
        }
      })
      .catch(function (err) {
        if (sendBtn) sendBtn.removeAttribute('disabled');
        console.error('[AgenticTaskDetail] Respond error:', err);
        if (window.Lex && Lex.Toast) {
          Lex.Toast.show('Failed to send message', 'error');
        }
      });
  }

  /**
   * Approve proposed changes.
   */
  function approveTask() {
    var approveBtn = el('atdApproveBtn');
    if (approveBtn) approveBtn.setAttribute('disabled', '');

    api.post('/api/v1/agentic-tasks/' + _taskId + '/approve', {})
      .then(function () {
        hide('atdApprovalPanel');
        appendToLog(renderEvent({
          event_type: 'approval_response',
          content: { approved: true },
        }));
        if (approveBtn) approveBtn.removeAttribute('disabled');
      })
      .catch(function (err) {
        if (approveBtn) approveBtn.removeAttribute('disabled');
        console.error('[AgenticTaskDetail] Approve error:', err);
        if (window.Lex && Lex.Toast) {
          Lex.Toast.show('Failed to approve', 'error');
        }
      });
  }

  /**
   * Reject proposed changes.
   */
  function rejectTask() {
    var reasonInput = el('atdRejectReasonInput');
    var reason = reasonInput ? reasonInput.value.trim() : '';
    var rejectBtn = el('atdRejectBtn');
    if (rejectBtn) rejectBtn.setAttribute('disabled', '');

    api.post('/api/v1/agentic-tasks/' + _taskId + '/reject', { reason: reason })
      .then(function () {
        hide('atdApprovalPanel');
        updateUIForStatus('rejected');
        appendToLog(renderEvent({
          event_type: 'approval_response',
          content: { approved: false, reason: reason },
        }));
        if (rejectBtn) rejectBtn.removeAttribute('disabled');
      })
      .catch(function (err) {
        if (rejectBtn) rejectBtn.removeAttribute('disabled');
        console.error('[AgenticTaskDetail] Reject error:', err);
        if (window.Lex && Lex.Toast) {
          Lex.Toast.show('Failed to reject', 'error');
        }
      });
  }

  /**
   * Cancel the task.
   */
  function cancelTask() {
    if (!confirm('Cancel this task? This cannot be undone.')) return;

    var cancelBtn = el('atdCancelBtn');
    if (cancelBtn) cancelBtn.setAttribute('disabled', '');

    api.post('/api/v1/agentic-tasks/' + _taskId + '/cancel', {})
      .then(function () {
        updateUIForStatus('cancelled');
        if (cancelBtn) cancelBtn.removeAttribute('disabled');
        if (window.Lex && Lex.Toast) {
          Lex.Toast.show('Task cancelled', 'info');
        }
      })
      .catch(function (err) {
        if (cancelBtn) cancelBtn.removeAttribute('disabled');
        console.error('[AgenticTaskDetail] Cancel error:', err);
        if (window.Lex && Lex.Toast) {
          Lex.Toast.show('Failed to cancel', 'error');
        }
      });
  }

  // =========================================================================
  // Initialization
  // =========================================================================

  function init() {
    // Extract taskId from URL query params
    var search = window.location.search || '';
    var params = search.slice(1).split('&');
    for (var i = 0; i < params.length; i++) {
      var pair = params[i].split('=');
      if (pair[0] === 'id' && pair[1]) {
        _taskId = decodeURIComponent(pair[1]);
        break;
      }
    }

    if (!_taskId) {
      var log = el('atdLog');
      if (log) log.innerHTML = '<div style="padding:24px;text-align:center;color:var(--lex-text-tertiary);">No task ID provided</div>';
      return;
    }

    // Bind event listeners
    var sendBtn = el('atdSendBtn');
    if (sendBtn) sendBtn.addEventListener('click', sendResponse);

    var messageInput = el('atdMessageInput');
    if (messageInput) {
      messageInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendResponse();
        }
      });
    }

    var approveBtn = el('atdApproveBtn');
    if (approveBtn) approveBtn.addEventListener('click', approveTask);

    var rejectBtn = el('atdRejectBtn');
    if (rejectBtn) {
      rejectBtn.addEventListener('click', function () {
        // Show reject reason input if hidden, or submit if visible
        var reasonEl = el('atdRejectReason');
        if (reasonEl && reasonEl.classList.contains('hidden')) {
          show('atdRejectReason');
          var inputEl = el('atdRejectReasonInput');
          if (inputEl) inputEl.focus();
        } else {
          rejectTask();
        }
      });
    }

    var cancelBtn = el('atdCancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', cancelTask);

    var diffToggle = el('atdDiffToggle');
    if (diffToggle) {
      diffToggle.addEventListener('click', function () {
        var container = el('atdDiffContainer');
        if (!container) return;
        if (container.classList.contains('hidden')) {
          show('atdDiffContainer');
          diffToggle.textContent = 'Hide detailed changes';
        } else {
          hide('atdDiffContainer');
          diffToggle.textContent = 'View detailed changes';
        }
      });
    }

    // Load task data
    loadTask();

    // Cleanup SSE on page unload
    window.addEventListener('beforeunload', function () {
      if (_eventSource) { _eventSource.close(); _eventSource = null; }
    });
  }

  // Wait for api to be available
  if (window.api) {
    init();
  } else {
    document.addEventListener('lex-ready', init);
  }

})();
