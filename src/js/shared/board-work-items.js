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
    CARD_TITLE_MAX: CARD_TITLE_MAX
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = moduleApi;
  if (global) global.LanaBoardWorkItems = moduleApi;
})(typeof window !== 'undefined' ? window : globalThis);
