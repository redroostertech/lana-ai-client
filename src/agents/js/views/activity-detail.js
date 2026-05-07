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

    + '<div class="atd-header">'
    +   '<a href="#activity" class="atd-header-back" data-back-link>&larr; Back to Lana Tasks</a>'
    +   '<div class="atd-title" id="atdTitle">Loading...</div>'
    +   '<div class="atd-meta">'
    +     '<span><span class="atd-meta-dot" id="atdStatusDot"></span> <span id="atdStatusLabel">Loading</span></span>'
    +     '<span id="atdPriorityBadge"></span>'
    +     '<span id="atdMatterLink"></span>'
    +     '<span id="atdCreatedAt"></span>'
    +   '</div>'
    + '</div>'

    + '<lex-card padding="none">'
    +   '<div style="padding:12px 16px;border-bottom:1px solid var(--lex-border-subtle);font-size:0.75rem;font-weight:500;color:var(--lex-text-tertiary);text-transform:uppercase;letter-spacing:0.08em;">'
    +     'Execution Log'
    +   '</div>'
    +   '<div class="atd-log" id="atdLog">'
    +     '<div style="text-align:center;padding:24px;color:var(--lex-text-tertiary);font-size:0.8125rem;">'
    +       '<lex-spinner size="sm"></lex-spinner> Loading events...'
    +     '</div>'
    +   '</div>'
    + '</lex-card>'

    + '<div id="atdApprovalPanel" class="atd-approval hidden">'
    +   '<div class="atd-approval-title">Lana wants to make the following changes:</div>'
    +   '<div id="atdApprovalSummary" style="font-size:0.8125rem;color:var(--lex-text-secondary);margin-bottom:12px;"></div>'
    +   '<div class="atd-approval-toggle" id="atdDiffToggle">View detailed changes</div>'
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
  // Per-render state
  // =========================================================================

  function createState(taskId) {
    return {
      taskId: taskId || null,
      task: null,
      eventSource: null,
      currentStatus: 'pending',
      reconnectTimer: null,
      destroyed: false,
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
      return '';
    }

    return html;
  }

  function appendToLog(html) {
    if (!html) return;
    var log = el('atdLog');
    if (!log) return;
    log.insertAdjacentHTML('beforeend', html);
    log.scrollTop = log.scrollHeight;
  }

  // =========================================================================
  // UI state
  // =========================================================================

  function updateUIForStatus(state, status) {
    state.currentStatus = status;

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

        var titleEl = el('atdTitle');
        if (titleEl) titleEl.textContent = state.task.name || 'Task Detail';

        var priorityEl = el('atdPriorityBadge');
        if (priorityEl && state.task.priority) {
          priorityEl.innerHTML = '<span class="atd-priority-badge" style="background:' +
            priorityColor(state.task.priority) + ';">' + escHtml(state.task.priority) + '</span>';
        }

        var matterEl = el('atdMatterLink');
        if (matterEl && state.task.matter_id) {
          matterEl.innerHTML = '<a href="../workspace-details.html?id=' + escHtml(state.task.matter_id) +
            '" style="color:var(--lex-color-primary-600);font-size:0.75rem;text-decoration:none;">View Matter</a>';
        }

        var createdEl = el('atdCreatedAt');
        if (createdEl && state.task.created_at) {
          createdEl.textContent = timeAgo(state.task.created_at);
        }

        var log = el('atdLog');
        if (log) log.innerHTML = '';

        for (var i = 0; i < events.length; i++) {
          var html = renderEvent(events[i]);
          appendToLog(html);

          if (events[i].event_type === 'approval_request') {
            showApproval(events[i].content || {});
          }
        }

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
        var html = renderEvent(evt);
        appendToLog(html);

        if (evt.event_type === 'approval_request') {
          showApproval(evt.content || {});
        }

        if (evt.event_type === 'status_change' && evt.content) {
          updateUIForStatus(state, evt.content.to_status);
        }
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

    state.eventSource.addEventListener('catchup', function () {
      // Catchup events are sent as an array — we already loaded them via API.
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

        appendToLog(renderEvent({
          event_type: 'user_message',
          content: { message: message }
        }));

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
        appendToLog(renderEvent({
          event_type: 'approval_response',
          content: { approved: true }
        }));
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
        appendToLog(renderEvent({
          event_type: 'approval_response',
          content: { approved: false, reason: reason }
        }));
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
          diffToggle.textContent = 'Hide detailed changes';
        } else {
          hide('atdDiffContainer');
          diffToggle.textContent = 'View detailed changes';
        }
      };
      diffToggle.addEventListener('click', diffHandler);
      state._unbindFns.push(function () { diffToggle.removeEventListener('click', diffHandler); });
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
