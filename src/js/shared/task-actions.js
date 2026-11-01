/**
 * task-actions.js
 * Buttons for the actions a task carries (design 3.6, 4.3, 7.3).
 *
 * Task payloads list `actions: [{ id, kind, label, status, last_run }]`.
 * `start_automation` and `start_agent` call POST .../start with a request_id
 * (kept until the server answers, so a retry after a dropped connection is
 * the same request); `form` opens the server form in a Lex modal. Whether an
 * action may run is the server's decision: the status it sends decides
 * whether the button is enabled, and the start answer's `action` replaces
 * the pressed one.
 *
 * Start answers (backend task-actions.routes.js):
 *   202 { outcome: 'started'|'queued', action, run: { kind, id } | null }
 *   200 { outcome: 'replayed', action, run }            the same request_id again
 *   409 ACTIVE_RUN_EXISTS (error.details.active_run_id), TASK_ACTION_START_FAILED
 *       (a resend of a press that failed), TASK_ACTION_NOT_STARTABLE, a gate
 *       outcome as code; 404 AGENT_NOT_FOUND, AUTOMATION_NOT_FOUND. A resent
 *       refused press answers the same refusal (error.details.replayed).
 *
 * Public API (window.LanaTaskActions, or module.exports in Node):
 *   - START_KINDS, STORE_PREFIX
 *   - actionViews(task)                   -> view models for the buttons
 *   - lastRunText(lastRun, formatAgo?)    -> 'Last run 2 hours ago' | ''
 *   - startAction(task, action, deps)     -> Promise of the server answer
 *   - START_OUTCOMES
 *   - startAnswerView(response, label)    -> { kind, text, action } for an answer
 *   - startErrorView(error, label)        -> { kind, text } for a refusal or failure
 *   - mount(host, task, deps)             -> renders the buttons
 *       deps: { client: MatterMakeupAPIClient, openForm(task, action),
 *               onChanged(), scope(taskId, actionId) -> parts | null, storage?, notify? }
 */

(function (global) {
  'use strict';

  var inNode = typeof module !== 'undefined' && module.exports;
  var START_KINDS = ['start_automation', 'start_agent'];
  var KINDS = START_KINDS.concat(['form']);
  var STORE_PREFIX = 'lana:task-action:pending';
  var START_OUTCOMES = ['started', 'queued', 'replayed'];
  var STATUS = {
    available: { label: '', tone: null, pressable: true },
    failed: { label: 'Failed', tone: 'red', pressable: true },
    running: { label: 'Running', tone: 'blue', pressable: false },
    done: { label: 'Done', tone: 'green', pressable: false }
  };

  function pendingSubmit() { return global.LanaPendingSubmit || (inNode && require('./pending-submit.js')); }
  function runHistory() { return global.LanaRunHistory || (inNode && require('./run-history.js')); }

  function startAnswerView(response, label) {
    var name = label || 'This action';
    var outcome = response && response.outcome;
    var action = response && response.action && response.action.id ? response.action : null;
    if (outcome === 'queued') return { kind: 'success', text: name + ' will start shortly', action: action };
    if (outcome === 'replayed') return { kind: 'info', text: name + ' was already started', action: action };
    return { kind: 'success', text: name + ' started', action: action };
  }

  function startErrorView(error, label) {
    var body = (error && error.data && error.data.error) || {};
    var code = (error && error.code) || body.code || '';
    var message = (error && error.message) || '';
    if (code === 'ACTIVE_RUN_EXISTS') return { kind: 'info', text: 'This agent is already running on this matter.' };
    if (code === 'TASK_ACTION_START_FAILED') return { kind: 'error', text: (label || 'This action') + ' failed. Press it again to retry.' };
    if (runHistory().OUTCOME_KEYS.indexOf(code) !== -1) return { kind: 'warning', text: runHistory().outcomeView(code).detail };
    var text = message || 'Could not start this action.';
    if (error && error.submitOutcome === 'retryable') text += ' Press it again to retry the same request.';
    return { kind: 'error', text: text };
  }

  function lastRunText(lastRun, formatAgo) {
    if (!lastRun) return '';
    var when = lastRun.started_at || lastRun.finished_at || lastRun.created_at;
    if (!when) return '';
    var utils = global.Lex && global.Lex.Utils;
    var format = formatAgo || (utils && utils.timeAgo) || function (value) { return String(value); };
    return 'Last run ' + format(when);
  }

  // Withdrawn actions and kinds this app does not know are not shown.
  function actionViews(task) {
    var actions = task && Array.isArray(task.actions) ? task.actions : [];
    return actions.filter(function (action) {
      return action && action.id && KINDS.indexOf(action.kind) !== -1 && STATUS[action.status || 'available'];
    }).map(function (action) {
      var status = STATUS[action.status || 'available'];
      return {
        id: String(action.id),
        kind: action.kind,
        label: action.label || 'Run',
        status: action.status || 'available',
        statusLabel: status.label,
        tone: status.tone,
        pressable: status.pressable,
        lastRun: lastRunText(action.last_run)
      };
    });
  }

  var sessions = {};

  function sessionFor(taskId, actionId, deps) {
    var key = taskId + ':' + actionId;
    if (sessions[key]) return sessions[key];
    var store = null;
    var parts = deps.scope ? deps.scope(taskId, actionId) : null;
    if (parts) {
      try { store = pendingSubmit().scopedStore(deps.storage || global.sessionStorage, STORE_PREFIX, parts); } catch (error) { store = null; }
    }
    sessions[key] = pendingSubmit().createSubmitSession({
      store: store,
      makeId: deps.makeId,
      isConfirmed: function (result) { return Boolean(result) && START_OUTCOMES.indexOf(result.outcome) !== -1; }
    });
    return sessions[key];
  }

  function startAction(task, action, deps) {
    var taskId = String(task.id);
    var session = sessionFor(taskId, String(action.id), deps);
    var send = function (body) { return deps.client.startTaskAction(taskId, action.id, body.request_id); };
    return session.pending() ? session.resend(send) : session.submit({ values: {} }, send);
  }

  function mount(host, task, deps) {
    if (!host) return;
    var doc = host.ownerDocument;
    var views = actionViews(task);
    host.replaceChildren();
    if (!views.length) { host.hidden = true; return; }
    host.hidden = false;
    host.classList.add('task-actions');
    views.forEach(function (view) {
      var item = doc.createElement('div');
      item.className = 'task-actions__item';
      var button = doc.createElement('lex-btn');
      button.setAttribute('size', 'sm');
      button.setAttribute('variant', view.kind === 'form' ? 'primary' : 'secondary');
      button.setAttribute('data-task-action-id', view.id);
      if (!view.pressable) button.setAttribute('disabled', '');
      button.textContent = view.label;
      item.appendChild(button);
      if (view.statusLabel) {
        var badge = doc.createElement('lex-badge');
        badge.setAttribute('label', view.statusLabel);
        badge.setAttribute('color', view.tone);
        badge.setAttribute('size', 'sm');
        item.appendChild(badge);
      }
      if (view.lastRun) {
        var last = doc.createElement('span');
        last.className = 'task-actions__last-run';
        last.textContent = view.lastRun;
        item.appendChild(last);
      }
      host.appendChild(item);
    });

    // The Board card opens the task on click and is draggable; action
    // presses must not do either.
    host.onclick = function (event) {
      event.stopPropagation();
      var target = event.target && event.target.closest && event.target.closest('[data-task-action-id]');
      if (!target || target.hasAttribute('disabled')) return;
      var action = (task.actions || []).find(function (entry) { return String(entry.id) === target.getAttribute('data-task-action-id'); });
      if (!action) return;
      if (action.kind === 'form') { deps.openForm(task, action); return; }
      target.loading = true;
      startAction(task, action, deps).then(function (result) {
        var view = startAnswerView(result.response, action.label);
        if (view.action) {
          task.actions = (task.actions || []).map(function (entry) { return String(entry.id) === String(view.action.id) ? view.action : entry; });
          mount(host, task, deps);
        }
        if (deps.notify) deps.notify(view.kind, view.text);
        if (deps.onChanged) deps.onChanged();
      }).catch(function (error) {
        target.loading = false;
        var view = startErrorView(error, action.label);
        if (deps.notify) deps.notify(view.kind, view.text);
        // The server answered: its current status decides the button.
        if (error && error.status && deps.onChanged) deps.onChanged();
      });
    };
    host.onmousedown = function (event) { event.stopPropagation(); };
    host.setAttribute('draggable', 'false');
  }

  var moduleApi = {
    START_KINDS: START_KINDS.slice(),
    START_OUTCOMES: START_OUTCOMES.slice(),
    startAnswerView: startAnswerView,
    startErrorView: startErrorView,
    STORE_PREFIX: STORE_PREFIX,
    actionViews: actionViews,
    lastRunText: lastRunText,
    startAction: startAction,
    mount: mount,
    _resetSessions: function () { sessions = {}; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = moduleApi;
  if (global) global.LanaTaskActions = moduleApi;
})(typeof window !== 'undefined' ? window : globalThis);
