(function () {
  'use strict';

  if (window.LanaTaskDetails && window.LanaTaskDetails.__sharedDrawer) return;

  var state = {
    provider: null,
    options: {},
    task: null,
    stores: {},
    activityTabs: {}
  };

  function esc(value) {
    if (window.Lex && Lex.Utils && Lex.Utils.escapeHtml) {
      return Lex.Utils.escapeHtml(value === null || value === undefined ? '' : String(value));
    }
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function iconHtml(name, className) {
    if (!window.Lex || !Lex.Icons || !Lex.Icons.has(name)) return '';
    return '<span class="' + esc(className || 'my-task-detail-icon') + '">' +
      Lex.Icons.get({ name: name, size: 'small' }) +
      '</span>';
  }

  function firstDefined() {
    for (var i = 0; i < arguments.length; i += 1) {
      if (arguments[i] !== undefined && arguments[i] !== null && arguments[i] !== '') return arguments[i];
    }
    return '';
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function firstArray() {
    var fallback = [];
    for (var i = 0; i < arguments.length; i += 1) {
      if (Array.isArray(arguments[i])) {
        if (arguments[i].length) return arguments[i];
        fallback = arguments[i];
      }
    }
    return fallback;
  }

  function taskId(task) {
    return String((task && (task.id || task.task_id)) || '');
  }

  function detailKey(task) {
    return taskId(task) || 'task-detail-draft';
  }

  function taskMetadata(task) {
    if (!task || !task.metadata) return {};
    if (typeof task.metadata === 'object') return task.metadata;
    try {
      return JSON.parse(task.metadata);
    } catch (_) {
      return {};
    }
  }

  function splitTaskTitle(title) {
    var value = String(title || '').trim();
    var separators = [' — ', ' – ', ' - '];
    for (var i = 0; i < separators.length; i += 1) {
      var separator = separators[i];
      var index = value.lastIndexOf(separator);
      if (index > 0 && index < value.length - separator.length) {
        return {
          taskTitle: value.slice(0, index).trim(),
          matterName: value.slice(index + separator.length).trim()
        };
      }
    }
    return { taskTitle: value, matterName: '' };
  }

  function taskTitle(task) {
    return firstDefined(task && task.title, task && task.task_name, task && task.name, task && task.task_title, 'Untitled task');
  }

  function taskMatterName(task) {
    if (!task) return '';
    return firstDefined(
      task.matter_name,
      task.matterName,
      task.client_matter_name,
      task.workspace_name,
      task.workspaceName,
      task.matter && (task.matter.matter_name || task.matter.name),
      task.workspace && task.workspace.name,
      splitTaskTitle(taskTitle(task)).matterName,
      ''
    );
  }

  function currentUserName() {
    var user = Lex.Auth && Lex.Auth.user ? Lex.Auth.user : {};
    return firstDefined(
      user.name,
      user.full_name,
      [user.first_name, user.last_name].filter(Boolean).join(' '),
      user.email,
      'You'
    );
  }

  function currentUserId() {
    var user = Lex.Auth && Lex.Auth.user ? Lex.Auth.user : {};
    return String(firstDefined(user.id, user.user_id, user.uuid, user.email, 'local-user'));
  }

  function initialsFor(name) {
    var source = String(name || 'You').trim();
    if (!source) return 'Y';
    var parts = source.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  function formatDate(value) {
    if (!value) return '';
    return window.Lex && Lex.Utils && Lex.Utils.formatDate ? Lex.Utils.formatDate(value) : String(value).slice(0, 10);
  }

  function formatDateTime(value) {
    if (!value) return '';
    var d = new Date(value);
    if (isNaN(d.getTime())) return formatDate(value);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function normalizeStatus(status) {
    var s = String(status || '').toLowerCase().split(' ').join('_');
    if (s === 'completed' || s === 'done') return 'complete';
    return s || 'pending';
  }

  function statusLabel(status) {
    var s = normalizeStatus(status);
    if (s === 'in_progress') return 'In Progress';
    if (s === 'in_review') return 'In Review';
    if (s === 'complete') return 'Complete';
    if (s === 'cancelled') return 'Cancelled';
    return 'Pending';
  }

  function statusColor(status) {
    var s = normalizeStatus(status);
    if (s === 'complete') return 'green';
    if (s === 'in_review') return 'yellow';
    if (s === 'cancelled') return 'red';
    return 'gray';
  }

  function priorityLabel(priority) {
    var p = String(priority || 'normal').toLowerCase();
    return p.charAt(0).toUpperCase() + p.slice(1);
  }

  function priorityColor(priority) {
    var p = String(priority || '').toLowerCase();
    if (p === 'high' || p === 'urgent' || p === 'critical') return 'red';
    if (p === 'medium' || p === 'normal') return 'yellow';
    return 'gray';
  }

  function assigneeName(task) {
    return firstDefined(
      task.assigned_to_name,
      task.assigned_to,
      task.assignee_name,
      task.assignee,
      task.assigned_to_email,
      task.assigned_to_user_id,
      'Unassigned'
    );
  }

  function normalizeChecklistItem(item, index) {
    if (typeof item === 'string') item = { title: item };
    item = item || {};
    return {
      id: String(firstDefined(item.id, item.item_id, 'check-' + index)),
      title: firstDefined(item.title, item.label, item.description, item.text, 'Checklist item'),
      completed: !!(item.completed || item.checked || item.done || normalizeStatus(item.status) === 'complete')
    };
  }

  function normalizeSubtask(item, index) {
    if (typeof item === 'string') item = { title: item };
    item = item || {};
    return {
      id: String(firstDefined(item.id, item.task_id, 'subtask-' + index)),
      title: firstDefined(item.title, item.name, item.description, 'Subtask'),
      status: normalizeStatus(firstDefined(item.status, 'pending')),
      assignee: firstDefined(item.assignee_name, item.assignee, item.assigned_to_name, ''),
      due_date: firstDefined(item.due_date, item.dueDate, '')
    };
  }

  function normalizeDocument(item, index) {
    if (typeof item === 'string') item = { name: item };
    item = item || {};
    return {
      id: String(firstDefined(item.id, item.document_id, item.file_id, 'doc-' + index)),
      name: firstDefined(item.name, item.filename, item.original_filename, item.title, 'Document'),
      type: firstDefined(item.type, item.document_type, item.content_type, item.mime_type, 'document'),
      url: firstDefined(item.url, item.href, item.link, ''),
      added_by: firstDefined(item.added_by, item.created_by_name, '')
    };
  }

  function normalizeComment(item, index) {
    if (typeof item === 'string') item = { content: item };
    item = item || {};
    return {
      id: String(firstDefined(item.id, item.comment_id, 'comment-' + index)),
      author: firstDefined(item.author_name, item.created_by_name, item.user_name, item.author, currentUserName()),
      author_id: String(firstDefined(item.author_id, item.created_by_id, item.user_id, '')),
      content: firstDefined(item.content, item.body, item.text, ''),
      created_at: firstDefined(item.created_at, item.timestamp, LanaTime.nowIso()),
      is_edited: !!(item.is_edited || item.edited),
      replies: asArray(firstArray(item.replies, item.children, [])).map(normalizeComment)
    };
  }

  function getStore(task) {
    var metadata = taskMetadata(task);
    var key = detailKey(task);
    if (!state.stores[key]) {
      state.stores[key] = {
        checklist: asArray(firstArray(metadata.checklist_items, metadata.checklist, task.checklist_items)).map(normalizeChecklistItem),
        subtasks: asArray(firstArray(metadata.subtasks, metadata.child_tasks, task.subtasks, task.children)).map(normalizeSubtask),
        documents: asArray(firstArray(metadata.documents, metadata.attachments, metadata.linked_documents, task.documents, task.attachments)).map(normalizeDocument),
        comments: asArray(firstArray(metadata.comments, metadata.task_comments, task.comments)).map(normalizeComment),
        activity: []
      };
    }
    return state.stores[key];
  }

  function ensureModal() {
    var modal = document.getElementById('sharedTaskDetailsModal');
    if (modal) return modal;

    modal = document.createElement('lex-modal');
    modal.id = 'sharedTaskDetailsModal';
    modal.className = 'my-task-details-modal';
    modal.heading = 'Task Details';
    modal.setAttribute('size', 'full');
    modal.setAttribute('hide-actions', '');
    modal.setAttribute('close-on-overlay', '');
    modal.innerHTML = '<div id="sharedTaskDetailsContent"></div>';
    document.body.appendChild(modal);
    bindModalEvents();
    return modal;
  }

  function contentEl() {
    return document.getElementById('sharedTaskDetailsContent');
  }

  function sectionHeader(title, count, actionLabel, action) {
    return [
      '<div class="my-task-issue-section__header">',
      '  <h3>' + esc(title) + (typeof count === 'number' ? ' <span>' + count + '</span>' : '') + '</h3>',
      action ? '  <button type="button" class="my-task-icon-btn" data-shared-task-focus="' + esc(action) + '" data-task-add-label="' + esc(actionLabel || 'Add') + '" title="' + esc(actionLabel || 'Add') + '" aria-label="' + esc(actionLabel || 'Add') + '" aria-expanded="false">' + iconHtml('plus') + '</button>' : '',
      '</div>'
    ].join('');
  }

  function renderHero(task, store) {
    var checklistDone = store.checklist.filter(function (item) { return item.completed; }).length;
    var subtasksDone = store.subtasks.filter(function (item) { return normalizeStatus(item.status) === 'complete'; }).length;
    return [
      '<header class="my-task-issue__hero">',
      '  <div class="my-task-issue__headline">',
      '    <div class="my-task-issue__eyebrow"><lex-badge label="' + (task.matter_id ? 'Workspace' : 'Organization') + '" color="blue"></lex-badge></div>',
      '    <h2>' + esc(taskTitle(task)) + '</h2>',
      '    <div class="my-task-issue__quick-meta">',
      '      <span>' + iconHtml('briefcase') + esc(taskMatterName(task) || 'Organization-level') + '</span>',
      task.due_date ? '      <span>' + iconHtml('calendar') + esc(formatDate(task.due_date)) + '</span>' : '',
      '      <span>' + iconHtml('message-square') + store.comments.length + ' comments</span>',
      '    </div>',
      '  </div>',
      '  <div class="my-task-issue__summary">',
      '    <div><strong>' + checklistDone + '/' + store.checklist.length + '</strong><span>Checklist</span></div>',
      '    <div><strong>' + subtasksDone + '/' + store.subtasks.length + '</strong><span>Subtasks</span></div>',
      '    <div><strong>' + store.documents.length + '</strong><span>Documents</span></div>',
      '  </div>',
      '</header>'
    ].join('');
  }

  function renderDescription(task) {
    return [
      '<section class="my-task-issue-section">',
      sectionHeader('Description'),
      task.description ? '<p class="my-task-description">' + esc(task.description) + '</p>' : '<p class="my-task-detail__muted">No description added.</p>',
      '</section>'
    ].join('');
  }

  function renderChecklist(store) {
    var rows = store.checklist.length
      ? store.checklist.map(function (item) {
        return '<div class="my-task-checklist-item"><label><input type="checkbox" data-shared-checklist-id="' + esc(item.id) + '"' + (item.completed ? ' checked' : '') + '> ' + esc(item.title) + '</label></div>';
      }).join('')
      : '<p class="my-task-detail__muted">No checklist items yet.</p>';
    return [
      '<section class="my-task-issue-section">',
      sectionHeader('Checklist', store.checklist.length, 'Add checklist item', 'checklist'),
      '<div class="my-task-checklist-list">' + rows + '</div>',
      '<div class="my-task-inline-add hidden" data-shared-task-add-panel="checklist">',
      '  <input type="text" data-shared-task-input="checklist" placeholder="Add checklist item" />',
      '  <lex-btn size="sm" variant="secondary" data-shared-task-add="checklist" leading-icon="plus">Add</lex-btn>',
      '</div>',
      '</section>'
    ].join('');
  }

  function renderSubtasks(store) {
    var rows = store.subtasks.length
      ? store.subtasks.map(function (item) {
        var complete = normalizeStatus(item.status) === 'complete';
        return [
          '<div class="my-task-subtask-row">',
          '  <button type="button" class="my-task-subtask-row__check" data-shared-subtask-toggle="' + esc(item.id) + '">' + iconHtml(complete ? 'check-circle' : 'circle') + '</button>',
          '  <div class="my-task-subtask-row__body">',
          '    <div class="my-task-subtask-row__title ' + (complete ? 'is-complete' : '') + '">' + esc(item.title) + '</div>',
          '    <div class="my-task-subtask-row__meta"><lex-badge label="' + esc(statusLabel(item.status)) + '" color="' + esc(statusColor(item.status)) + '"></lex-badge></div>',
          '  </div>',
          '</div>'
        ].join('');
      }).join('')
      : '<p class="my-task-detail__muted">No subtasks yet.</p>';
    return [
      '<section class="my-task-issue-section">',
      sectionHeader('Subtasks', store.subtasks.length, 'Add subtask', 'subtask'),
      '<div class="my-task-subtask-list">' + rows + '</div>',
      '<div class="my-task-inline-add hidden" data-shared-task-add-panel="subtask">',
      '  <input type="text" data-shared-task-input="subtask" placeholder="Add subtask" />',
      '  <lex-btn size="sm" variant="secondary" data-shared-task-add="subtask" leading-icon="plus">Add</lex-btn>',
      '</div>',
      '</section>'
    ].join('');
  }

  function renderDocuments(store) {
    var rows = store.documents.length
      ? store.documents.map(function (doc) {
        var body = '<div class="my-task-document-row__icon">' + iconHtml('file-text') + '</div><div class="my-task-document-row__body"><div class="my-task-document-row__title">' + esc(doc.name) + '</div><div class="my-task-document-row__meta">' + esc(doc.type) + '</div></div>';
        return doc.url ? '<a class="my-task-document-row" href="' + esc(doc.url) + '" target="_blank" rel="noopener">' + body + iconHtml('external-link') + '</a>' : '<div class="my-task-document-row">' + body + '</div>';
      }).join('')
      : '<p class="my-task-detail__muted">No documents associated with this task.</p>';
    return [
      '<section class="my-task-issue-section">',
      sectionHeader('Documents', store.documents.length, 'Add document', 'document'),
      '<div class="my-task-document-list">' + rows + '</div>',
      '<div class="my-task-inline-add hidden" data-shared-task-add-panel="document">',
      '  <input type="text" data-shared-task-input="document" placeholder="Document name or ID" />',
      '  <lex-btn size="sm" variant="secondary" data-shared-task-add="document" leading-icon="paperclip">Associate</lex-btn>',
      '</div>',
      '</section>'
    ].join('');
  }

  function renderCommentContent(content) {
    return esc(content).split('\n').join('<br>');
  }

  function renderComment(comment) {
    var isAuthor = comment.author_id && String(comment.author_id) === currentUserId();
    return [
      '<article class="my-task-comment-thread" data-shared-comment-id="' + esc(comment.id) + '">',
      '  <div class="my-task-comment-thread__row">',
      '    <div class="my-task-avatar">' + esc(initialsFor(comment.author)) + '</div>',
      '    <div class="my-task-comment-thread__body">',
      '      <div class="my-task-activity-item__meta"><strong>' + esc(comment.author) + '</strong><span>' + esc(formatDateTime(comment.created_at)) + '</span>' + (comment.is_edited ? '<span>edited</span>' : '') + '</div>',
      '      <div class="my-task-comment-content">' + renderCommentContent(comment.content) + '</div>',
      '      <div class="my-task-comment-actions">',
      '        <button type="button" class="my-task-comment-action" data-shared-comment-action="reply" data-comment-id="' + esc(comment.id) + '">' + iconHtml('corner-up-left') + '</button>',
      '        <button type="button" class="my-task-comment-action" data-shared-comment-action="like" data-comment-id="' + esc(comment.id) + '">' + iconHtml('thumbs-up') + '</button>',
      '        <button type="button" class="my-task-comment-action" data-shared-comment-action="react" data-comment-id="' + esc(comment.id) + '">' + iconHtml('message-circle') + '</button>',
      isAuthor ? '        <button type="button" class="my-task-comment-action" data-shared-comment-action="edit" data-comment-id="' + esc(comment.id) + '">' + iconHtml('edit-2') + '</button>' : '',
      '      </div>',
      '      <div class="my-task-reply-editor hidden" data-shared-reply-editor="' + esc(comment.id) + '"><textarea rows="2" placeholder="Write a reply..."></textarea><div class="my-task-reply-editor__actions"><button type="button" class="my-task-comment-action" data-shared-comment-action="cancel-reply" data-comment-id="' + esc(comment.id) + '">Cancel</button><button type="button" class="my-task-comment-action my-task-comment-action--primary" data-shared-comment-action="post-reply" data-comment-id="' + esc(comment.id) + '">' + iconHtml('send') + '<span>Reply</span></button></div></div>',
      '    </div>',
      '  </div>',
      '</article>'
    ].join('');
  }

  function renderHistoryItem(item) {
    return [
      '<article class="my-task-activity-item">',
      '  <div class="my-task-avatar my-task-avatar--system">' + esc(initialsFor(item.author || 'System')) + '</div>',
      '  <div class="my-task-activity-item__body">',
      '    <div class="my-task-activity-item__meta"><strong>' + esc(item.author || 'System') + '</strong><span>' + esc(formatDateTime(item.created_at)) + '</span></div>',
      '    <p>' + esc(item.label || 'Updated task') + '</p>',
      '  </div>',
      '</article>'
    ].join('');
  }

  function renderComposer() {
    return [
      '<div class="my-task-comment-composer">',
      '  <div class="my-task-avatar">' + esc(initialsFor(currentUserName())) + '</div>',
      '  <div class="my-task-comment-composer__body">',
      '    <div class="my-task-comment-composer__box">',
      '      <div class="my-task-comment-toolbar"><button type="button" class="my-task-comment-tool" title="Text style">T</button><button type="button" class="my-task-comment-tool" data-shared-comment-tool="bold"><strong>B</strong></button><button type="button" class="my-task-comment-tool" data-shared-comment-tool="list">' + iconHtml('list') + '</button><button type="button" class="my-task-comment-tool" data-shared-comment-tool="mention">@</button><button type="button" class="my-task-comment-tool" data-shared-comment-tool="link">' + iconHtml('link') + '</button></div>',
      '      <lex-textarea data-shared-task-input="comment" rows="3" auto-resize="true" max-rows="8" placeholder="Add a comment..."></lex-textarea>',
      '      <div class="my-task-comment-suggestions"><span>Suggestions:</span><button type="button" data-shared-comment-template="Looks good!">Looks good</button><button type="button" data-shared-comment-template="Need help?">Need help?</button><button type="button" data-shared-comment-template="This is blocked.">Blocked</button><button type="button" data-shared-comment-template="Can you clarify?">Clarify</button><button type="button" data-shared-comment-template="This is on track.">On track</button></div>',
      '    </div>',
      '    <p class="my-task-comment-composer__hint">Pro tip: press <kbd>M</kbd> to comment</p>',
      '    <div class="my-task-comment-composer__actions"><button type="button" class="my-task-comment-cancel" data-shared-compose-cancel>Cancel</button><lex-btn size="sm" variant="primary" data-shared-task-add="comment" leading-icon="send">Comment</lex-btn></div>',
      '  </div>',
      '</div>'
    ].join('');
  }

  function renderActivity(task, store) {
    var tab = state.activityTabs[detailKey(task)] || 'comments';
    var history = [];
    if (task.created_at) history.push({ label: 'Task created', author: task.created_by_name || 'System', created_at: task.created_at });
    if (task.updated_at) history.push({ label: 'Task updated', author: 'System', created_at: task.updated_at });
    history = store.activity.concat(history);
    var rows = tab === 'history' ? history : store.comments.slice();
    rows.sort(function (a, b) {
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    });
    var rowsHtml = rows.length
      ? rows.map(function (item) { return item.content ? renderComment(item) : renderHistoryItem(item); }).join('')
      : '<p class="my-task-detail__muted">' + (tab === 'history' ? 'No history yet.' : 'No comments yet.') + '</p>';
    return [
      '<section class="my-task-issue-section my-task-activity-section">',
      sectionHeader('Activity'),
      '<lex-tabs class="my-task-activity-tabs" variant="pills" active="' + esc(tab) + '" tabs=\'[{"id":"comments","label":"Comments"},{"id":"history","label":"History"}]\'></lex-tabs>',
      tab === 'comments' ? renderComposer() : '',
      '<div class="my-task-activity-list">' + rowsHtml + '</div>',
      '</section>'
    ].join('');
  }

  function renderAside(task) {
    return [
      '<aside class="my-task-issue__aside">',
      '  <section class="my-task-aside-card">',
      '    <div class="my-task-aside-card__title">' + iconHtml('settings') + '<h3>Details</h3></div>',
      '    <dl class="my-task-detail__meta">',
      '      <div class="my-task-detail__row"><dt>Status</dt><dd>' + statusSelectHtml(task) + '</dd></div>',
      '      <div class="my-task-detail__row"><dt>Assignee</dt><dd>' + esc(assigneeName(task)) + '</dd></div>',
      '      <div class="my-task-detail__row"><dt>Priority</dt><dd><lex-badge label="' + esc(priorityLabel(task.priority)) + '" color="' + esc(priorityColor(task.priority)) + '"></lex-badge></dd></div>',
      '      <div class="my-task-detail__row"><dt>' + (task.matter_id ? 'Workspace' : 'Level') + '</dt><dd>' + esc(taskMatterName(task) || 'Organization-level') + '</dd></div>',
      task.due_date ? '      <div class="my-task-detail__row"><dt>Due date</dt><dd>' + esc(formatDate(task.due_date)) + '</dd></div>' : '',
      task.created_by_name ? '      <div class="my-task-detail__row"><dt>Reporter</dt><dd>' + esc(task.created_by_name) + '</dd></div>' : '',
      task.created_at ? '      <div class="my-task-detail__row"><dt>Created</dt><dd>' + esc(formatDateTime(task.created_at)) + '</dd></div>' : '',
      task.updated_at ? '      <div class="my-task-detail__row"><dt>Updated</dt><dd>' + esc(formatDateTime(task.updated_at)) + '</dd></div>' : '',
      '    </dl>',
      '  </section>',
      '  <section class="my-task-aside-card"><div class="my-task-aside-card__title">' + iconHtml('zap') + '<h3>Automation</h3></div><p class="my-task-detail__muted">Rules and agent runs associated with this task will appear here.</p></section>',
      '</aside>'
    ].join('');
  }

  function statusSelectHtml(task) {
    var current = normalizeStatus(task.status);
    var options = [
      ['pending', 'Pending'],
      ['in_progress', 'In Progress'],
      ['in_review', 'In Review'],
      ['complete', 'Complete'],
      ['cancelled', 'Cancelled']
    ].map(function (opt) {
      return '<option value="' + opt[0] + '"' + (opt[0] === current ? ' selected' : '') + '>' + opt[1] + '</option>';
    }).join('');
    return '<span class="my-task-status-control"><select class="my-task-status-select" data-shared-status-select>' + options + '</select></span>';
  }

  function syncTabs(task) {
    var content = contentEl();
    var tabs = content && content.querySelector('.my-task-activity-tabs');
    if (!tabs) return;
    var active = state.activityTabs[detailKey(task)] || 'comments';
    tabs.active = active;
    tabs.setAttribute('active', active);
    tabs.querySelectorAll('[data-tab-id]').forEach(function (button) {
      var selected = button.getAttribute('data-tab-id') === active;
      button.classList.toggle('lex-tab-btn--active', selected);
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
  }

  function render() {
    var task = state.task;
    if (!task) return false;
    var modal = ensureModal();
    var content = contentEl();
    var store = getStore(task);
    modal.heading = taskTitle(task);
    content.innerHTML = [
      '<div class="my-task-issue">',
      renderHero(task, store),
      '<div class="my-task-issue__grid">',
      '<div class="my-task-issue__main">',
      renderDescription(task),
      renderChecklist(store),
      renderSubtasks(store),
      renderDocuments(store),
      renderActivity(task, store),
      '</div>',
      renderAside(task),
      '</div>',
      '</div>'
    ].join('');
    modal.open = true;
    requestAnimationFrame(function () { syncTabs(task); });
    return true;
  }

  function inputValue(name) {
    var content = contentEl();
    var input = content && content.querySelector('[data-shared-task-input="' + name + '"]');
    return input ? String(input.value || '').trim() : '';
  }

  function setInputValue(name, value) {
    var content = contentEl();
    var input = content && content.querySelector('[data-shared-task-input="' + name + '"]');
    if (!input) return;
    input.value = value || '';
    var native = input.querySelector && input.querySelector('textarea, input');
    if (native) native.value = value || '';
  }

  function togglePanel(name, trigger) {
    var content = contentEl();
    var panel = content && content.querySelector('[data-shared-task-add-panel="' + name + '"]');
    if (!panel) return;
    var shouldOpen = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !shouldOpen);
    if (trigger) {
      trigger.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
      trigger.setAttribute('title', shouldOpen ? 'Dismiss' : (trigger.getAttribute('data-task-add-label') || 'Add'));
    }
    if (shouldOpen) {
      var input = panel.querySelector('[data-shared-task-input]');
      if (input && input.focus) input.focus();
    } else {
      var clear = panel.querySelector('[data-shared-task-input]');
      if (clear) clear.value = '';
    }
  }

  function addActivity(store, label) {
    store.activity.unshift({
      label: label,
      author: currentUserName(),
      created_at: LanaTime.nowIso()
    });
  }

  function addItem(kind) {
    var task = state.task;
    if (!task) return;
    var store = getStore(task);
    if (kind === 'checklist') {
      var checklist = inputValue('checklist');
      if (!checklist) return;
      store.checklist.push({ id: 'local-check-' + LanaTime.nowMs(), title: checklist, completed: false });
      addActivity(store, 'Added checklist item "' + checklist + '"');
      render();
      return;
    }
    if (kind === 'subtask') {
      var subtask = inputValue('subtask');
      if (!subtask) return;
      store.subtasks.push({ id: 'local-subtask-' + LanaTime.nowMs(), title: subtask, status: 'pending' });
      addActivity(store, 'Added subtask "' + subtask + '"');
      render();
      return;
    }
    if (kind === 'document') {
      var doc = inputValue('document');
      if (!doc) return;
      store.documents.push({ id: 'local-doc-' + LanaTime.nowMs(), name: doc, type: 'document' });
      addActivity(store, 'Associated document "' + doc + '"');
      render();
      return;
    }
    if (kind === 'comment') {
      var comment = inputValue('comment');
      if (!comment) return;
      store.comments.unshift({
        id: 'local-comment-' + LanaTime.nowMs(),
        author: currentUserName(),
        author_id: currentUserId(),
        content: comment,
        created_at: LanaTime.nowIso(),
        replies: []
      });
      state.activityTabs[detailKey(task)] = 'comments';
      render();
    }
  }

  async function updateStatus(nextStatus) {
    var task = state.task;
    if (!task || !taskId(task) || !window.api) return;
    try {
      if (normalizeStatus(nextStatus) === 'complete' && api.completeTask) {
        await api.completeTask(taskId(task));
      } else if (api.updateTask) {
        await api.updateTask(taskId(task), { status: nextStatus });
      }
      task.status = nextStatus;
      if (window.Lex && Lex.Toast) Lex.Toast.success('Status updated');
      if (state.options && typeof state.options.onRefresh === 'function') state.options.onRefresh();
      render();
    } catch (error) {
      if (window.Lex && Lex.Toast) Lex.Toast.error(error.message || 'Unable to update status');
    }
  }

  function findComment(comments, commentId) {
    comments = asArray(comments);
    for (var i = 0; i < comments.length; i += 1) {
      if (String(comments[i].id) === String(commentId)) return comments[i];
      var nested = findComment(comments[i].replies, commentId);
      if (nested) return nested;
    }
    return null;
  }

  function handleCommentAction(action, commentId, actionEl) {
    var task = state.task;
    var store = task && getStore(task);
    var comment = store && findComment(store.comments, commentId);
    if (!task || !store || !comment) return;
    if (action === 'reply') {
      var editor = contentEl().querySelector('[data-shared-reply-editor="' + commentId + '"]');
      if (editor) {
        editor.classList.toggle('hidden');
        var textarea = editor.querySelector('textarea');
        if (!editor.classList.contains('hidden') && textarea) textarea.focus();
      }
      return;
    }
    if (action === 'cancel-reply') {
      var cancelEditor = actionEl.closest('.my-task-reply-editor');
      if (cancelEditor) cancelEditor.classList.add('hidden');
      return;
    }
    if (action === 'post-reply') {
      var replyEditor = actionEl.closest('.my-task-reply-editor');
      var textarea = replyEditor && replyEditor.querySelector('textarea');
      var text = textarea ? textarea.value.trim() : '';
      if (!text) return;
      comment.replies = comment.replies || [];
      comment.replies.push({ id: 'local-reply-' + LanaTime.nowMs(), author: currentUserName(), author_id: currentUserId(), content: text, created_at: LanaTime.nowIso(), replies: [] });
      addActivity(store, 'Replied to a comment');
      render();
    }
  }

  function bindModalEvents() {
    document.addEventListener('click', function (event) {
      if (!event.target.closest('#sharedTaskDetailsModal')) return;

      var template = event.target.closest('[data-shared-comment-template]');
      if (template) {
        event.preventDefault();
        var current = inputValue('comment');
        setInputValue('comment', current ? current + '\n' + template.getAttribute('data-shared-comment-template') : template.getAttribute('data-shared-comment-template'));
        return;
      }

      var cancel = event.target.closest('[data-shared-compose-cancel]');
      if (cancel) {
        event.preventDefault();
        setInputValue('comment', '');
        return;
      }

      var focus = event.target.closest('[data-shared-task-focus]');
      if (focus) {
        event.preventDefault();
        togglePanel(focus.getAttribute('data-shared-task-focus'), focus);
        return;
      }

      var add = event.target.closest('[data-shared-task-add]');
      if (add) {
        event.preventDefault();
        addItem(add.getAttribute('data-shared-task-add'));
        return;
      }

      var subtask = event.target.closest('[data-shared-subtask-toggle]');
      if (subtask && state.task) {
        event.preventDefault();
        var store = getStore(state.task);
        var item = store.subtasks.find(function (entry) { return String(entry.id) === String(subtask.getAttribute('data-shared-subtask-toggle')); });
        if (item) {
          item.status = normalizeStatus(item.status) === 'complete' ? 'pending' : 'complete';
          addActivity(store, (item.status === 'complete' ? 'Completed' : 'Reopened') + ' subtask "' + item.title + '"');
          render();
        }
        return;
      }

      var action = event.target.closest('[data-shared-comment-action]');
      if (action) {
        event.preventDefault();
        handleCommentAction(action.getAttribute('data-shared-comment-action'), action.getAttribute('data-comment-id'), action);
      }
    });

    document.addEventListener('change', function (event) {
      if (!event.target.closest('#sharedTaskDetailsModal')) return;
      var status = event.target.closest('[data-shared-status-select]');
      if (status) updateStatus(status.value);
      var check = event.target.closest('[data-shared-checklist-id]');
      if (check && state.task) {
        var store = getStore(state.task);
        var item = store.checklist.find(function (entry) { return String(entry.id) === String(check.getAttribute('data-shared-checklist-id')); });
        if (item) {
          item.completed = !!check.checked;
          addActivity(store, (item.completed ? 'Completed' : 'Reopened') + ' checklist item "' + item.title + '"');
          render();
        }
      }
    });

    document.addEventListener('tab-change', function (event) {
      if (!event.target.closest('#sharedTaskDetailsModal .my-task-activity-tabs') || !state.task) return;
      state.activityTabs[detailKey(state.task)] = event.detail && event.detail.tab ? event.detail.tab : 'comments';
      render();
    });

    document.addEventListener('keydown', function (event) {
      if (!event.target.closest || !event.target.closest('#sharedTaskDetailsModal')) return;
      if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
      if (!event.target.closest('[data-shared-task-input="comment"] textarea')) return;
      event.preventDefault();
      addItem('comment');
    });
  }

  function open(task, options) {
    if (!task) return false;
    state.task = task;
    state.options = options || state.options || {};
    return render();
  }

  function openById(id, options) {
    if (!id || typeof state.provider !== 'function') return false;
    var task = state.provider(String(id));
    return task ? open(task, options || state.options) : false;
  }

  function setProvider(provider, options) {
    state.provider = typeof provider === 'function' ? provider : null;
    state.options = options || {};
  }

  window.LanaTaskDetails = {
    __sharedDrawer: true,
    open: open,
    openById: openById,
    setProvider: setProvider,
    close: function () {
      var modal = document.getElementById('sharedTaskDetailsModal');
      if (modal) modal.open = false;
      state.task = null;
    }
  };
})();
