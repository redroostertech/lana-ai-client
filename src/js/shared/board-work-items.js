/**
 * board-work-items.js
 * The cards a matter Board shows: each task, and each of its subtasks as its
 * own card linked to the task (Jira style). Board rows come from GET
 * /api/v1/matters/:id/tasks; a LANA task carries `item_key` (M17-4) and
 * `subtasks` ([{ id, item_key, title, status, order_index, due_date }]).
 *
 * Subtasks use pending / in_progress / completed / cancelled; the Board's
 * columns are pending / in_progress / in_review / complete / cancelled. A
 * subtask has no review step, so it cannot be dropped in In Review.
 *
 * Public API (window.LanaBoardWorkItems, or module.exports in Node):
 *   - boardItems(tasks)              -> tasks followed by their subtask cards
 *   - columnFor(item)                -> the Board column key for a task or subtask card
 *   - subtaskStatusForColumn(column) -> the subtask status for a column, or null when not allowed
 *   - cardTitle(text)                -> the title cut to CARD_TITLE_MAX characters on a word, with "..."
 *   - taskMenuItems(task)            -> the card's "..." menu: Complete Task, Close Task, Ask LANA
 *   - taskCloseoutStatus(action)     -> the task status a menu action sets ('complete' or 'cancelled')
 *   - taskChatContext(task, matter)  -> the card context the LANA dock attaches for "Ask LANA"
 *   - taskChatPrompt(task)           -> the prompt the dock composer starts with
 */

(function (global) {
  'use strict';

  var COLUMN_BY_STATUS = {
    pending: 'pending',
    todo: 'pending',
    in_progress: 'in_progress',
    in_review: 'in_review',
    complete: 'complete',
    completed: 'complete',
    done: 'complete',
    cancelled: 'cancelled'
  };

  var SUBTASK_STATUS_BY_COLUMN = {
    pending: 'pending',
    in_progress: 'in_progress',
    complete: 'completed',
    cancelled: 'cancelled'
  };

  var CARD_TITLE_MAX = 90;

  function cardTitle(text) {
    var value = String(text || '').trim();
    if (value.length <= CARD_TITLE_MAX) return value;
    var cut = value.slice(0, CARD_TITLE_MAX);
    var lastSpace = cut.lastIndexOf(' ');
    if (lastSpace > CARD_TITLE_MAX * 0.6) cut = cut.slice(0, lastSpace);
    return cut.trimEnd() + '...';
  }

  function normalizedStatus(status) {
    return String(status || '').trim().toLowerCase().split(' ').join('_');
  }

  function columnFor(item) {
    return COLUMN_BY_STATUS[normalizedStatus(item && item.status)] || 'pending';
  }

  function subtaskStatusForColumn(column) {
    return SUBTASK_STATUS_BY_COLUMN[column] || null;
  }

  // The "..." menu on a task card. Closing a task sets it to cancelled; a task
  // already in that column does not offer the same action again.
  var TASK_CLOSEOUT_STATUS = { complete: 'complete', close: 'cancelled' };

  function taskMenuItems(task) {
    var column = columnFor(task);
    var items = [];
    if (column !== 'complete') items.push({ value: 'complete', label: 'Complete Task', icon: 'check-circle' });
    if (column !== 'cancelled') items.push({ value: 'close', label: 'Close Task', icon: 'x-circle' });
    if (items.length) items.push({ divider: true });
    items.push({ value: 'lana', label: 'Ask LANA about this task', variant: 'lana' });
    return items;
  }

  function taskCloseoutStatus(action) {
    return TASK_CLOSEOUT_STATUS[action] || null;
  }

  function taskLabel(task) {
    var title = (task && (task.title || task.task_name)) || 'Untitled task';
    return task && task.item_key ? task.item_key + ' ' + title : title;
  }

  // Same ui_card shape as the matter Summary cards, so the dock and the chat
  // read it the same way.
  function taskChatContext(task, matter) {
    task = task || {};
    matter = matter || {};
    var subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
    return {
      type: 'ui_card',
      ui_label: taskLabel(task),
      source: 'workspace_details_board',
      card_key: 'task:' + String(task.id || ''),
      card_title: task.title || task.task_name || 'Untitled task',
      page: {
        route: 'workspace-details',
        tab: 'tasks',
        matter_id: matter.matter_id || matter.id || task.matter_id || '',
        matter_name: matter.matter_name || matter.name || matter.title || '',
        matter_type: matter.matter_type || matter.type || ''
      },
      details: {
        task_id: String(task.id || ''),
        item_key: task.item_key || null,
        title: task.title || task.task_name || '',
        status: task.status || null,
        priority: task.priority || null,
        assigned_to: task.assigned_to || null,
        due_date: task.due_date || null,
        description: task.description && task.description !== 'null' ? task.description : null,
        subtasks: subtasks.map(function (s) {
          return { item_key: s.item_key || null, title: s.title || s.name || '', status: s.status || 'pending' };
        })
      }
    };
  }

  function taskChatPrompt(task) {
    return 'Help me with ' + taskLabel(task) + '.';
  }

  function subtaskCard(task, subtask) {
    return {
      kind: 'subtask',
      id: String(subtask.id),
      item_key: subtask.item_key || null,
      title: subtask.title || subtask.name || 'Subtask',
      status: subtask.status || 'pending',
      priority: subtask.priority || null,
      due_date: subtask.due_date || null,
      parent_id: String(task.id),
      parent_key: task.item_key || null,
      parent_title: task.title || task.task_name || '',
      source: 'lana'
    };
  }

  function boardItems(tasks) {
    var items = [];
    (Array.isArray(tasks) ? tasks : []).forEach(function (task) {
      if (!task) return;
      items.push(task);
    });
    (Array.isArray(tasks) ? tasks : []).forEach(function (task) {
      if (!task || !Array.isArray(task.subtasks)) return;
      task.subtasks.forEach(function (subtask) {
        if (subtask && subtask.id) items.push(subtaskCard(task, subtask));
      });
    });
    return items;
  }

  var moduleApi = {
    boardItems: boardItems,
    columnFor: columnFor,
    subtaskStatusForColumn: subtaskStatusForColumn,
    cardTitle: cardTitle,
    CARD_TITLE_MAX: CARD_TITLE_MAX,
    taskMenuItems: taskMenuItems,
    taskCloseoutStatus: taskCloseoutStatus,
    taskChatContext: taskChatContext,
    taskChatPrompt: taskChatPrompt
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = moduleApi;
  if (global) global.LanaBoardWorkItems = moduleApi;
})(typeof window !== 'undefined' ? window : globalThis);
