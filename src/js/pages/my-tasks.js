(function () {
  'use strict';

  var state = {
    tasks: [],
    newMenuOpen: false,
    // Create/Edit Task modal selections
    editingTaskId: null,           // null when creating, set when editing
    viewingTask: null,             // currently open in the details modal
    detailStores: {},
    activityTabs: {},
    selectedMatterId: null,
    selectedMatterName: null,
    selectedTargetType: 'unassigned',  // unassigned | user | organization
    selectedAssigneeId: null,
    selectedAssigneeLabel: null,
    // Create Task Plan modal selection
    planSelectedMatterId: null,
    planSelectedMatterName: null
  };

  // The /api/v1/tasks/my endpoint caps `limit` at 100, so we page through
  // up to TASK_FETCH_MAX rows to gather the full set for lex-table's
  // client-side search/sort/filter/pagination. Past TASK_FETCH_MAX we stop
  // and accept truncation rather than spamming the API; a user with that
  // many open assignments warrants a different UX anyway.
  var TASK_PAGE_LIMIT = 100;
  var TASK_FETCH_MAX = 500;

  var TASK_PLAN_ROLES = ['system_admin', 'org_admin', 'admin', 'upper_leader', 'senior_leader', 'senior_user'];

  function el(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return Lex.Utils.escapeHtml(value === null || value === undefined ? '' : String(value));
  }

  function formatDate(value) {
    return value ? Lex.Utils.formatDate(value) : '';
  }

  function formatDateTime(value) {
    if (!value) return '';
    var d = new Date(value);
    if (isNaN(d.getTime())) return formatDate(value);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function normalizeTasks(response) {
    if (!response) return [];
    if (response.data) return normalizeTasks(response.data);
    if (Array.isArray(response)) return response;
    if (Array.isArray(response.tasks)) return response.tasks;
    if (Array.isArray(response.items)) return response.items;
    return [];
  }

  var STATUS_OPTIONS = [
    { value: 'pending', label: 'Pending' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'in_review', label: 'In Review' },
    { value: 'complete', label: 'Complete' },
    { value: 'cancelled', label: 'Cancelled' }
  ];

  function normalizeStatus(status) {
    var s = String(status || '').toLowerCase();
    if (s === 'completed') return 'complete';
    return s || 'pending';
  }

  function statusLabel(status) {
    if (status === 'in_progress') return 'In Progress';
    if (status === 'in_review') return 'In Review';
    if (status === 'complete' || status === 'completed') return 'Complete';
    return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Pending';
  }

  function statusSelectHtml(task) {
    var current = normalizeStatus(task.status);
    var options = STATUS_OPTIONS.map(function (opt) {
      var selected = opt.value === current ? ' selected' : '';
      return '<option value="' + opt.value + '"' + selected + '>' + esc(opt.label) + '</option>';
    }).join('');
    return [
      '<span class="my-task-status-control">',
      '  <select class="my-task-status-select" data-task-status-select aria-label="Update status">' + options + '</select>',
      '</span>'
    ].join('');
  }

  function statusColor(status) {
    if (status === 'complete' || status === 'completed') return 'green';
    if (status === 'in_review') return 'yellow';
    if (status === 'cancelled') return 'red';
    return 'gray';
  }

  function priorityLabel(priority) {
    var p = priority ? String(priority).toLowerCase() : 'normal';
    return p.charAt(0).toUpperCase() + p.slice(1);
  }

  function priorityColor(priority) {
    if (priority === 'high') return 'red';
    if (priority === 'medium' || priority === 'normal') return 'yellow';
    return 'gray';
  }

  function taskMatterLabel(task) {
    return taskMatterName(task) || 'Organization-level';
  }

  function taskMatterName(task) {
    if (!task) return '';
    return (
      task.matter_name ||
      task.matterName ||
      task.client_matter_name ||
      task.workspace_name ||
      task.workspaceName ||
      (task.matter && (task.matter.matter_name || task.matter.name)) ||
      (task.workspace && task.workspace.name) ||
      splitTaskTitle(task.title || task.name || task.task_title || '').matterName ||
      ''
    );
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

  function taskMetadata(task) {
    if (!task || !task.metadata) return {};
    if (typeof task.metadata === 'object') return task.metadata;
    try {
      return JSON.parse(task.metadata);
    } catch (error) {
      return {};
    }
  }

  function taskChecklistItems(task) {
    var metadata = taskMetadata(task);
    return Array.isArray(metadata.checklist_items) ? metadata.checklist_items : [];
  }

  function taskPlanLabel(task) {
    var metadata = taskMetadata(task);
    var planMetadata = metadata.task_plan || {};
    return task.task_plan_title || planMetadata.title || (task.task_plan_id ? 'Task plan' : '');
  }

  // Level pill in the detail panel — same <lex-badge> as the status/priority
  // pills, just a different color. The matter-open action lives on the matter
  // title hyperlink (see matterLinkHtml), not on this badge.
  function levelHtml(task) {
    if (!task.matter_id) {
      return '<lex-badge label="Org" color="green"></lex-badge>';
    }
    return '<lex-badge label="Workspace" color="blue"></lex-badge>';
  }

  // The matter title rendered as a hyperlink that opens the matter workspace.
  function matterLinkHtml(task) {
    if (!task.matter_id) {
      return esc('Organization-level');
    }
    return [
      '<button type="button" class="my-task-matter-link" data-matter-id="' + esc(task.matter_id) + '">',
      esc(taskMatterLabel(task)),
      '</button>'
    ].join('');
  }

  function detailKey(task) {
    return String((task && (task.id || task.task_id)) || 'draft-task');
  }

  function asArray(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [];
  }

  function firstDefined() {
    for (var i = 0; i < arguments.length; i += 1) {
      if (arguments[i] !== undefined && arguments[i] !== null && arguments[i] !== '') return arguments[i];
    }
    return '';
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

  function iconHtml(name, className) {
    if (!window.Lex || !Lex.Icons || !Lex.Icons.has(name)) return '';
    var icon = typeof Lex.Icons.get === 'function'
      ? Lex.Icons.get({ name: name, size: 'small' })
      : String(Lex.Icons[name] || '');
    return '<span class="' + esc(className || 'my-task-detail-icon') + '">' + icon + '</span>';
  }

  function safeHref(value) {
    var href = String(value || '').trim();
    if (!href) return '';
    if (/^(https?:|\/(?!\/)|#)/i.test(href)) return href;
    return '';
  }

  function cssEscape(value) {
    value = String(value || '');
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return value.split('\\').join('\\\\').split('"').join('\\"');
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
    return firstDefined(user.id, user.user_id, user.uuid, user.email, 'local-user');
  }

  function initialsFor(name) {
    var source = String(name || 'You').trim();
    if (!source) return 'Y';
    var parts = source.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  function taskAssigneeName(task) {
    return firstDefined(
      task.assigned_to_name,
      task.assignee_name,
      task.assignee,
      task.assigned_to_email,
      task.assigned_to_user_id,
      'Unassigned'
    );
  }

  function normalizeChecklistItem(item, index) {
    if (typeof item === 'string') {
      return { id: 'check-' + index, title: item, completed: false };
    }
    item = item || {};
    return {
      id: String(firstDefined(item.id, item.item_id, 'check-' + index)),
      title: firstDefined(item.title, item.label, item.description, item.text, 'Checklist item'),
      completed: !!(item.completed || item.checked || item.done || item.status === 'complete')
    };
  }

  function normalizeSubtask(item, index) {
    item = item || {};
    if (typeof item === 'string') item = { title: item };
    return {
      id: String(firstDefined(item.id, item.task_id, 'subtask-' + index)),
      title: firstDefined(item.title, item.name, item.description, 'Subtask'),
      status: normalizeStatus(firstDefined(item.status, 'pending')),
      assignee: firstDefined(item.assignee_name, item.assignee, item.assigned_to_name, ''),
      due_date: firstDefined(item.due_date, item.dueDate, '')
    };
  }

  function normalizeDocument(item, index) {
    item = item || {};
    if (typeof item === 'string') item = { name: item };
    return {
      id: String(firstDefined(item.id, item.document_id, item.file_id, 'doc-' + index)),
      name: firstDefined(item.name, item.filename, item.title, 'Document'),
      type: firstDefined(item.type, item.document_type, item.content_type, 'document'),
      url: firstDefined(item.url, item.href, item.link, ''),
      added_by: firstDefined(item.added_by, item.created_by_name, ''),
      added_at: firstDefined(item.added_at, item.created_at, '')
    };
  }

  function normalizeMatterDocument(item, index) {
    item = item || {};
    if (typeof item === 'string') item = { name: item };
    return {
      id: String(firstDefined(item.id, item.document_id, item.file_id, item.storage_file_id, 'matter-doc-' + index)),
      name: firstDefined(item.name, item.filename, item.original_filename, item.file_name, item.title, 'Document'),
      type: firstDefined(item.type, item.document_type, item.content_type, item.mime_type, 'document'),
      url: firstDefined(item.url, item.download_url, item.href, item.link, ''),
      status: firstDefined(item.status, item.processing_status, ''),
      added_by: firstDefined(item.added_by, item.created_by_name, item.uploaded_by_name, ''),
      added_at: firstDefined(item.added_at, item.created_at, item.uploaded_at, '')
    };
  }

  function normalizeMatterDocumentsResponse(response) {
    if (!response) return [];
    if (response.data && !Array.isArray(response.data)) return normalizeMatterDocumentsResponse(response.data);
    var rows = firstArray(
      response.documents,
      response.files,
      response.items,
      response.results,
      response.data,
      Array.isArray(response) ? response : []
    );
    return asArray(rows).map(normalizeMatterDocument);
  }

  function documentSearchText(doc) {
    return [
      doc.name,
      doc.type,
      doc.status,
      doc.added_by,
      doc.id
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function taskHasDocument(store, docId) {
    return asArray(store.documents).some(function (doc) {
      return String(doc.id) === String(docId);
    });
  }

  function normalizeMentionUser(item) {
    item = item || {};
    var name = firstDefined(
      item.name,
      item.full_name,
      item.display_name,
      [item.first_name, item.last_name].filter(Boolean).join(' '),
      item.email,
      'User'
    );
    return {
      id: String(firstDefined(item.id, item.user_id, item.uuid, item.email, name)),
      name: name,
      email: firstDefined(item.email, item.username, ''),
      role: firstDefined(item.role_name, item.role, '')
    };
  }

  function normalizeMentionUsersResponse(response) {
    if (!response) return [];
    if (response.data && !Array.isArray(response.data)) return normalizeMentionUsersResponse(response.data);
    var rows = firstArray(
      response.users,
      response.items,
      response.results,
      response.data,
      Array.isArray(response) ? response : []
    );
    return asArray(rows).map(normalizeMentionUser);
  }

  function findMatchingMatterDocument(store, value) {
    var query = String(value || '').trim().toLowerCase();
    if (!query) return null;
    return asArray(store.matterDocuments).find(function (doc) {
      return String(doc.id || '').toLowerCase() === query ||
        String(doc.name || '').toLowerCase() === query;
    }) || null;
  }

  function normalizeComment(item, index) {
    item = item || {};
    if (typeof item === 'string') item = { content: item };
    var reactions = firstArray(item.reactions, item.comment_reactions, []);
    var likes = firstDefined(item.like_count, item.likes_count, item.likes, item.upvotes, 0);
    var reactionCount = firstDefined(item.reaction_count, item.reactions_count, reactions.length, 0);
    return {
      id: String(firstDefined(item.id, item.comment_id, 'comment-' + index)),
      author: firstDefined(item.author_name, item.created_by_name, item.user_name, item.author_name_display, item.author, currentUserName()),
      author_id: String(firstDefined(item.author_id, item.created_by_id, item.user_id, item.created_by_user_id, '')),
      content: firstDefined(item.content, item.body, item.text, ''),
      created_at: firstDefined(item.created_at, item.timestamp, LanaTime.nowIso()),
      is_edited: !!(item.is_edited || item.edited),
      is_pinned: !!(item.is_pinned || item.pinned),
      liked: !!(item.liked || item.liked_by_me || item.user_liked),
      like_count: Number(likes) || 0,
      reaction_count: Number(reactionCount) || 0,
      replies: asArray(firstArray(item.replies, item.children, item.thread_replies, [])).map(normalizeComment)
    };
  }

  function getTaskDetailStore(task) {
    var metadata = taskMetadata(task);
    var key = detailKey(task);
    if (!state.detailStores[key]) {
      var checklist = asArray(firstArray(metadata.checklist_items, metadata.checklist, task.checklist_items))
        .map(normalizeChecklistItem);
      var subtasks = asArray(firstArray(metadata.subtasks, metadata.child_tasks, task.subtasks, task.children))
        .map(normalizeSubtask);
      var documents = asArray(firstArray(metadata.documents, metadata.attachments, metadata.linked_documents, task.documents, task.attachments))
        .map(normalizeDocument);
      var comments = asArray(firstArray(metadata.comments, metadata.task_comments, task.comments))
        .map(normalizeComment);

      state.detailStores[key] = {
        checklist: checklist,
        subtasks: subtasks,
        documents: documents,
        matterDocuments: [],
        documentsLoaded: false,
        documentsLoading: false,
        documentSearch: '',
        mentionUsers: [],
        mentionsLoaded: false,
        mentionsLoading: false,
        mentionFilter: '',
        comments: comments,
        activity: []
      };
    }
    return state.detailStores[key];
  }

  function addDetailActivity(task, type, label) {
    var store = getTaskDetailStore(task);
    store.activity.unshift({
      id: 'activity-' + LanaTime.nowMs(),
      type: type || 'history',
      label: label,
      author: currentUserName(),
      created_at: LanaTime.nowIso()
    });
  }

  function activeActivityTab(task) {
    return state.activityTabs[detailKey(task)] || 'comments';
  }

  function syncTaskActivityTabs(task) {
    var content = el('myTaskDetailsContent');
    if (!content || !task) return;
    var tabs = content.querySelector('.my-task-activity-tabs');
    if (!tabs) return;
    var active = activeActivityTab(task);
    tabs.active = active;
    tabs.setAttribute('active', active);
    var buttons = tabs.querySelectorAll('[data-tab-id]');
    buttons.forEach(function (button) {
      var selected = button.getAttribute('data-tab-id') === active;
      button.classList.toggle('lex-tab-btn--active', selected);
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.setAttribute('tabindex', selected ? '0' : '-1');
    });
  }

  function renderTaskHero(task, store) {
    var checklistDone = store.checklist.filter(function (item) { return item.completed; }).length;
    var subtasksDone = store.subtasks.filter(function (item) { return normalizeStatus(item.status) === 'complete'; }).length;
    return [
      '<header class="my-task-issue__hero">',
      '  <div class="my-task-issue__headline">',
      '    <div class="my-task-issue__eyebrow">',
      '      ' + levelHtml(task),
      planLabelBadge(task),
      '    </div>',
      '    <h2>' + esc(task.title || 'Untitled task') + '</h2>',
      '    <div class="my-task-issue__quick-meta">',
      '      <span>' + iconHtml('briefcase') + esc(taskMatterLabel(task)) + '</span>',
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

  function planLabelBadge(task) {
    var planLabel = taskPlanLabel(task);
    if (!planLabel) return '';
    return '<lex-badge label="' + esc(planLabel) + '" color="blue"></lex-badge>';
  }

  function sectionHeader(title, count, actionLabel, action) {
    return [
      '<div class="my-task-issue-section__header">',
      '  <h3>' + esc(title) + (typeof count === 'number' ? ' <span>' + count + '</span>' : '') + '</h3>',
      action ? '  <button type="button" class="my-task-icon-btn" data-task-focus="' + esc(action) + '" data-task-add-label="' + esc(actionLabel || 'Add') + '" title="' + esc(actionLabel || 'Add') + '" aria-label="' + esc(actionLabel || 'Add') + '" aria-expanded="false">' + iconHtml('plus') + '</button>' : '',
      '</div>'
    ].join('');
  }

  function renderDescription(task) {
    return [
      '<section class="my-task-issue-section">',
      sectionHeader('Description'),
      task.description
        ? '<p class="my-task-description">' + esc(task.description) + '</p>'
        : '<p class="my-task-detail__muted">No description added.</p>',
      '</section>'
    ].join('');
  }

  function renderChecklist(store) {
    var itemsHtml = store.checklist.length
      ? store.checklist.map(function (item) {
        return [
          '<div class="my-task-checklist-item">',
          '  <lex-checkbox data-checklist-id="' + esc(item.id) + '" label="' + esc(item.title) + '" ' + (item.completed ? 'checked="true"' : '') + '></lex-checkbox>',
          '</div>'
        ].join('');
      }).join('')
      : '<p class="my-task-detail__muted">No checklist items yet.</p>';

    return [
      '<section class="my-task-issue-section">',
      sectionHeader('Checklist', store.checklist.length, 'Add checklist item', 'checklist'),
      '  <div class="my-task-checklist-list">' + itemsHtml + '</div>',
      '  <div class="my-task-inline-add hidden" data-task-add-panel="checklist">',
      '    <input type="text" data-task-input="checklist" placeholder="Add checklist item" />',
      '    <lex-btn size="sm" variant="secondary" data-task-add="checklist" leading-icon="plus">Add</lex-btn>',
      '  </div>',
      '</section>'
    ].join('');
  }

  function renderSubtasks(store) {
    var itemsHtml = store.subtasks.length
      ? store.subtasks.map(function (item) {
        var isComplete = normalizeStatus(item.status) === 'complete';
        return [
          '<div class="my-task-subtask-row">',
          '  <button type="button" class="my-task-subtask-row__check" data-subtask-toggle="' + esc(item.id) + '" aria-label="Toggle subtask">' + iconHtml(isComplete ? 'check-circle' : 'circle') + '</button>',
          '  <div class="my-task-subtask-row__body">',
          '    <div class="my-task-subtask-row__title ' + (isComplete ? 'is-complete' : '') + '">' + esc(item.title) + '</div>',
          '    <div class="my-task-subtask-row__meta">',
          '      <lex-badge label="' + esc(statusLabel(item.status)) + '" color="' + esc(statusColor(item.status)) + '"></lex-badge>',
          item.assignee ? '      <span>' + esc(item.assignee) + '</span>' : '',
          item.due_date ? '      <span>' + esc(formatDate(item.due_date)) + '</span>' : '',
          '    </div>',
          '  </div>',
          '</div>'
        ].join('');
      }).join('')
      : '<p class="my-task-detail__muted">No subtasks yet.</p>';

    return [
      '<section class="my-task-issue-section">',
      sectionHeader('Subtasks', store.subtasks.length, 'Add subtask', 'subtask'),
      '  <div class="my-task-subtask-list">' + itemsHtml + '</div>',
      '  <div class="my-task-inline-add hidden" data-task-add-panel="subtask">',
      '    <input type="text" data-task-input="subtask" placeholder="Add subtask" />',
      '    <lex-btn size="sm" variant="secondary" data-task-add="subtask" leading-icon="plus">Add</lex-btn>',
      '  </div>',
      '</section>'
    ].join('');
  }

  function renderDocumentPickerResults(task, store) {
    if (!task.matter_id) {
      return '<div class="my-task-document-picker__empty">Select a workspace task with an associated matter to search or upload workspace documents.</div>';
    }
    if (store.documentsLoading) {
      return '<div class="my-task-document-picker__empty">Loading workspace documents...</div>';
    }
    if (!store.documentsLoaded) {
      return '<div class="my-task-document-picker__empty">Search existing workspace documents or upload a new file.</div>';
    }

    var query = String(store.documentSearch || '').trim().toLowerCase();
    var docs = asArray(store.matterDocuments).filter(function (doc) {
      return !query || documentSearchText(doc).indexOf(query) !== -1;
    }).slice(0, 8);

    if (!docs.length) {
      return '<div class="my-task-document-picker__empty">No matching workspace documents. Upload a new file or paste a link.</div>';
    }

    return docs.map(function (doc) {
      var disabled = taskHasDocument(store, doc.id);
      return [
        '<button type="button" class="my-task-document-candidate" data-task-document-id="' + esc(doc.id) + '"' + (disabled ? ' disabled' : '') + '>',
        '  <span class="my-task-document-candidate__icon">' + iconHtml('file-text') + '</span>',
        '  <span class="my-task-document-candidate__body">',
        '    <strong>' + esc(doc.name) + '</strong>',
        '    <span>' + esc([doc.type, doc.status, doc.added_at ? formatDate(doc.added_at) : ''].filter(Boolean).join(' - ')) + '</span>',
        '  </span>',
        disabled ? '  <span class="my-task-document-candidate__state">Associated</span>' : '  <span class="my-task-document-candidate__state">Associate</span>',
        '</button>'
      ].join('');
    }).join('');
  }

  function renderDocuments(task, store) {
    var docsHtml = store.documents.length
      ? store.documents.map(function (doc) {
        var body = [
          '<div class="my-task-document-row__icon">' + iconHtml('file-text') + '</div>',
          '<div class="my-task-document-row__body">',
          '  <div class="my-task-document-row__title">' + esc(doc.name) + '</div>',
          '  <div class="my-task-document-row__meta">' + esc(doc.type) + (doc.added_by ? ' - ' + esc(doc.added_by) : '') + '</div>',
          '</div>'
        ].join('');
        var href = safeHref(doc.url);
        if (href) {
          return '<a class="my-task-document-row" href="' + esc(href) + '" target="_blank" rel="noopener">' + body + iconHtml('external-link') + '</a>';
        }
        return '<div class="my-task-document-row">' + body + '</div>';
      }).join('')
      : '<p class="my-task-detail__muted">No documents associated with this task.</p>';

    return [
      '<section class="my-task-issue-section">',
      sectionHeader('Documents', store.documents.length, 'Add document', 'document'),
      '  <div class="my-task-document-list">' + docsHtml + '</div>',
      '  <div class="my-task-document-add hidden" data-task-add-panel="document">',
      '    <div class="my-task-document-picker">',
      '      <div class="my-task-document-picker__controls">',
      '        <input type="search" data-task-input="document-name" placeholder="' + (task.matter_id ? 'Search workspace documents by name or ID' : 'Document name or ID') + '" autocomplete="off" />',
      '        <input type="url" data-task-input="document-url" placeholder="Optional link" />',
      '        <button type="button" class="my-task-upload-btn" data-task-document-upload' + (task.matter_id ? '' : ' disabled') + '>' + iconHtml('upload') + '<span>Upload</span></button>',
      '        <lex-btn size="sm" variant="secondary" data-task-add="document" leading-icon="paperclip">Associate</lex-btn>',
      '        <input type="file" class="hidden" data-task-document-file multiple />',
      '      </div>',
      '      <div class="my-task-document-picker__results" data-task-document-results>' + renderDocumentPickerResults(task, store) + '</div>',
      '    </div>',
      '  </div>',
      '</section>'
    ].join('');
  }

  function renderCommentComposer(task) {
    return [
      '<div class="my-task-comment-composer">',
      '  <div class="my-task-avatar">' + esc(initialsFor(currentUserName())) + '</div>',
      '  <div class="my-task-comment-composer__body">',
      '    <div class="my-task-comment-composer__box">',
      '      <div class="my-task-comment-toolbar" aria-label="Comment editor tools">',
      '        <button type="button" class="my-task-comment-tool" data-task-comment-tool="text-style" title="Text style">T</button>',
      '        <button type="button" class="my-task-comment-tool" data-task-comment-tool="bold" title="Bold"><strong>B</strong></button>',
      '        <button type="button" class="my-task-comment-tool" data-task-comment-tool="list" title="Bulleted list">' + iconHtml('list') + '</button>',
      '        <button type="button" class="my-task-comment-tool" data-task-comment-tool="mention" title="Mention">@</button>',
      '        <button type="button" class="my-task-comment-tool" data-task-comment-tool="attach-document" title="Attach document">' + iconHtml('paperclip') + '</button>',
      '        <button type="button" class="my-task-comment-tool" data-task-comment-tool="link" title="Link">' + iconHtml('link') + '</button>',
      '      </div>',
      '      <lex-textarea data-task-input="comment" rows="3" auto-resize="true" max-rows="8" placeholder="Add a comment..."></lex-textarea>',
      '      <div class="my-task-mention-picker hidden" data-task-mention-picker></div>',
      '      <div class="my-task-comment-suggestions" aria-label="Comment suggestions">',
      '        <span>Suggestions:</span>',
      '        <button type="button" data-task-comment-template="Looks good!">Looks good</button>',
      '        <button type="button" data-task-comment-template="Need help?">Need help?</button>',
      '        <button type="button" data-task-comment-template="This is blocked.">Blocked</button>',
      '        <button type="button" data-task-comment-template="Can you clarify?">Clarify</button>',
      '        <button type="button" data-task-comment-template="This is on track.">On track</button>',
      '      </div>',
      '    </div>',
      '    <p class="my-task-comment-composer__hint">Pro tip: press <kbd>M</kbd> to comment</p>',
      '    <div class="my-task-comment-composer__actions">',
      '      <button type="button" class="my-task-comment-cancel" data-task-compose-cancel>Cancel</button>',
      '      <lex-btn size="sm" variant="primary" data-task-add="comment" leading-icon="send">Comment</lex-btn>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('');
  }

  function renderTaskCommentContent(content) {
    if (!content) return '';
    var result = '';
    var i = 0;
    var len = String(content).length;
    content = String(content);

    while (i < len) {
      var atIdx = content.indexOf('@[', i);
      var hashIdx = content.indexOf('#[', i);
      var triggerIdx = -1;
      var triggerChar = '';
      if (atIdx !== -1 && (hashIdx === -1 || atIdx <= hashIdx)) {
        triggerIdx = atIdx;
        triggerChar = '@';
      } else if (hashIdx !== -1) {
        triggerIdx = hashIdx;
        triggerChar = '#';
      }

      if (triggerIdx === -1) {
        result += esc(content.substring(i)).split('\n').join('<br>');
        break;
      }

      result += esc(content.substring(i, triggerIdx)).split('\n').join('<br>');
      var closeBracket = content.indexOf('](', triggerIdx);
      if (closeBracket === -1) {
        result += esc(content.substring(triggerIdx)).split('\n').join('<br>');
        break;
      }
      var closeParen = content.indexOf(')', closeBracket + 2);
      if (closeParen === -1) {
        result += esc(content.substring(triggerIdx)).split('\n').join('<br>');
        break;
      }

      var displayName = content.substring(triggerIdx + 2, closeBracket);
      if (triggerChar === '@') {
        result += '<span class="my-task-comment-token my-task-comment-token--mention">@' + esc(displayName) + '</span>';
      } else {
        result += '<span class="my-task-comment-token my-task-comment-token--document">' + iconHtml('file-text') + esc(displayName) + '</span>';
      }
      i = closeParen + 1;
    }

    return result;
  }

  function renderTaskCommentActions(comment, isReply) {
    var isAuthor = !!comment.author_id && String(comment.author_id) === String(currentUserId());
    return [
      '<div class="my-task-comment-actions">',
      !isReply ? '<button type="button" class="my-task-comment-action" data-task-comment-action="reply" data-comment-id="' + esc(comment.id) + '" title="Reply" aria-label="Reply">' + iconHtml('corner-up-left') + '</button>' : '',
      '<button type="button" class="my-task-comment-action' + (comment.liked ? ' is-active' : '') + '" data-task-comment-action="like" data-comment-id="' + esc(comment.id) + '" title="Like" aria-label="Like">' + iconHtml('thumbs-up') + (comment.like_count ? '<span>' + esc(comment.like_count) + '</span>' : '') + '</button>',
      '<button type="button" class="my-task-comment-action" data-task-comment-action="react" data-comment-id="' + esc(comment.id) + '" title="Add reaction" aria-label="Add reaction">' + iconHtml('message-circle') + (comment.reaction_count ? '<span>' + esc(comment.reaction_count) + '</span>' : '') + '</button>',
      isAuthor ? '<button type="button" class="my-task-comment-action" data-task-comment-action="edit" data-comment-id="' + esc(comment.id) + '" title="Edit" aria-label="Edit">' + iconHtml('edit-2') + '</button>' : '',
      '<button type="button" class="my-task-comment-action" data-task-comment-action="pin" data-comment-id="' + esc(comment.id) + '" title="' + (comment.is_pinned ? 'Unpin' : 'Pin') + '" aria-label="' + (comment.is_pinned ? 'Unpin' : 'Pin') + '">' + iconHtml('pin') + '</button>',
      isAuthor ? '<button type="button" class="my-task-comment-action" data-task-comment-action="delete" data-comment-id="' + esc(comment.id) + '" title="Delete" aria-label="Delete">' + iconHtml('trash') + '</button>' : '',
      '</div>'
    ].join('');
  }

  function renderTaskCommentReply(reply) {
    var edited = reply.is_edited ? '<span>edited</span>' : '';
    return [
      '<article class="my-task-comment-thread my-task-comment-thread--reply" data-comment-id="' + esc(reply.id) + '">',
      '  <div class="my-task-avatar my-task-avatar--sm">' + esc(initialsFor(reply.author)) + '</div>',
      '  <div class="my-task-comment-thread__body">',
      '    <div class="my-task-activity-item__meta"><strong>' + esc(reply.author || 'Unknown user') + '</strong><span>' + esc(formatDateTime(reply.created_at)) + '</span>' + edited + '</div>',
      '    <div class="my-task-comment-content" data-comment-content="' + esc(reply.id) + '">' + renderTaskCommentContent(reply.content) + '</div>',
      renderTaskCommentActions(reply, true),
      '  </div>',
      '</article>'
    ].join('');
  }

  function renderTaskCommentThread(comment) {
    var edited = comment.is_edited ? '<span>edited</span>' : '';
    var replies = asArray(comment.replies);
    return [
      '<article class="my-task-comment-thread' + (comment.is_pinned ? ' is-pinned' : '') + '" data-comment-id="' + esc(comment.id) + '">',
      comment.is_pinned ? '  <div class="my-task-comment-pinned">' + iconHtml('pin') + 'Pinned comment</div>' : '',
      '  <div class="my-task-comment-thread__row">',
      '    <div class="my-task-avatar">' + esc(initialsFor(comment.author)) + '</div>',
      '    <div class="my-task-comment-thread__body">',
      '      <div class="my-task-activity-item__meta"><strong>' + esc(comment.author || 'Unknown user') + '</strong><span>' + esc(formatDateTime(comment.created_at)) + '</span>' + edited + '</div>',
      '      <div class="my-task-comment-content" data-comment-content="' + esc(comment.id) + '">' + renderTaskCommentContent(comment.content) + '</div>',
      renderTaskCommentActions(comment, false),
      '      <div class="my-task-reply-editor hidden" data-reply-editor="' + esc(comment.id) + '">',
      '        <textarea rows="2" placeholder="Write a reply..."></textarea>',
      '        <div class="my-task-reply-editor__actions">',
      '          <button type="button" class="my-task-comment-action" data-task-comment-action="cancel-reply" data-comment-id="' + esc(comment.id) + '">Cancel</button>',
      '          <button type="button" class="my-task-comment-action my-task-comment-action--primary" data-task-comment-action="post-reply" data-comment-id="' + esc(comment.id) + '">' + iconHtml('send') + '<span>Reply</span></button>',
      '        </div>',
      '      </div>',
      replies.length ? '      <div class="my-task-comment-replies">' + replies.map(renderTaskCommentReply).join('') + '</div>' : '',
      '    </div>',
      '  </div>',
      '</article>'
    ].join('');
  }

  function renderTaskHistoryItem(item) {
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

  function renderActivity(task, store) {
    var tab = activeActivityTab(task);
    var comments = store.comments.slice();
    var history = [];
    if (task.created_at) history.push({ type: 'history', label: 'Task created', author: task.created_by_name || 'System', created_at: task.created_at });
    if (task.updated_at) history.push({ type: 'history', label: 'Task updated', author: 'System', created_at: task.updated_at });
    history = store.activity.concat(history);

    var rows = tab === 'history' ? history : comments;

    rows.sort(function (a, b) {
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    });

    var emptyLabel = tab === 'history' ? 'No history yet.' : 'No comments yet.';
    var rowsHtml = rows.length ? rows.map(function (item) {
      return item.content ? renderTaskCommentThread(item) : renderTaskHistoryItem(item);
    }).join('') : '<p class="my-task-detail__muted">' + emptyLabel + '</p>';

    return [
      '<section class="my-task-issue-section my-task-activity-section">',
      sectionHeader('Activity'),
      '  <lex-tabs class="my-task-activity-tabs" variant="pills" active="' + esc(tab) + '" tabs=\'' + JSON.stringify([
        { id: 'comments', label: 'Comments' },
        { id: 'history', label: 'History' }
      ]) + '\'></lex-tabs>',
      tab === 'comments' ? renderCommentComposer(task) : '',
      '  <div class="my-task-activity-list">' + rowsHtml + '</div>',
      '</section>'
    ].join('');
  }

  function renderAside(task, store) {
    return [
      '<aside class="my-task-issue__aside">',
      '  <section class="my-task-aside-card">',
      '    <div class="my-task-aside-card__title">' + iconHtml('settings') + '<h3>Details</h3></div>',
      '    <dl class="my-task-detail__meta">',
      '      <div class="my-task-detail__row"><dt>Status</dt><dd>' + statusSelectHtml(task) + '</dd></div>',
      '      <div class="my-task-detail__row"><dt>Assignee</dt><dd>' + esc(taskAssigneeName(task)) + '</dd></div>',
      '      <div class="my-task-detail__row"><dt>Priority</dt><dd><lex-badge label="' + esc(priorityLabel(task.priority || 'normal')) + '" color="' + esc(priorityColor(task.priority)) + '"></lex-badge></dd></div>',
      '      <div class="my-task-detail__row"><dt>' + (task.matter_id ? 'Workspace' : 'Level') + '</dt><dd>' + matterLinkHtml(task) + '</dd></div>',
      task.due_date ? '      <div class="my-task-detail__row"><dt>Due date</dt><dd>' + esc(formatDate(task.due_date)) + '</dd></div>' : '      <div class="my-task-detail__row"><dt>Due date</dt><dd class="my-task-detail__muted">None</dd></div>',
      task.created_by_name ? '      <div class="my-task-detail__row"><dt>Reporter</dt><dd>' + esc(task.created_by_name) + '</dd></div>' : '',
      task.created_at ? '      <div class="my-task-detail__row"><dt>Created</dt><dd>' + esc(formatDateTime(task.created_at)) + '</dd></div>' : '',
      task.updated_at ? '      <div class="my-task-detail__row"><dt>Updated</dt><dd>' + esc(formatDateTime(task.updated_at)) + '</dd></div>' : '',
      '    </dl>',
      '  </section>',
      '  <section class="my-task-aside-card">',
      '    <div class="my-task-aside-card__title">' + iconHtml('zap') + '<h3>Automation</h3></div>',
      '    <p class="my-task-detail__muted">Rules and agent runs associated with this task will appear here.</p>',
      '  </section>',
      '</aside>'
    ].join('');
  }

  function openTaskDetails(task) {
    var modal = el('myTaskDetailsModal');
    var content = el('myTaskDetailsContent');
    if (!modal || !content || !task) return;

    // Cache the task being viewed so action handlers (edit/complete/delete)
    // can read its id without re-querying the row list.
    state.viewingTask = task;

    var store = getTaskDetailStore(task);

    modal.heading = task.title || 'Task Details';
    content.innerHTML = [
      '<div class="my-task-issue">',
      renderTaskHero(task, store),
      '  <div class="my-task-issue__grid">',
      '    <div class="my-task-issue__main">',
      renderDescription(task),
      renderChecklist(store),
      renderSubtasks(store),
      renderDocuments(task, store),
      renderActivity(task, store),
      '    </div>',
      renderAside(task, store),
      '  </div>',
      '</div>'
    ].join('');

    renderHeaderActions(modal, task);
    modal.open = true;
    requestAnimationFrame(function () { syncTaskActivityTabs(task); });
  }

  function exposeTaskDetailsBridge() {
    window.LanaTaskDetails = window.LanaTaskDetails || {};
    window.LanaTaskDetails.open = function (task) {
      if (!task) return false;
      openTaskDetails(task);
      return true;
    };
    window.LanaTaskDetails.openById = function (taskId) {
      if (!taskId) return false;
      var task = state.tasks.find(function (item) {
        return String(item.id || item.task_id || '') === String(taskId);
      });
      if (!task) return false;
      openTaskDetails(task);
      return true;
    };
  }

  // Inject (or refresh) the "Actions" dropdown in the modal header, next to the
  // close button. Edit / Mark Complete (or Reopen) / Delete live here so they're
  // reachable from the header instead of a button row at the bottom of the body.
  function renderHeaderActions(modal, task) {
    var header = modal.querySelector('.lex-modal-header');
    if (!header) return;

    var isComplete = normalizeStatus(task.status) === 'complete';
    var completeLabel = isComplete ? 'Reopen' : 'Mark Complete';
    var completeAction = isComplete ? 'reopen' : 'complete';

    var wrap = header.querySelector('[data-task-actions-wrap]');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'my-task-header-actions';
      wrap.setAttribute('data-task-actions-wrap', '');
      var closeBtn = header.querySelector('.lex-modal-close');
      header.insertBefore(wrap, closeBtn);
    }

    var chevron = '<svg class="my-task-actions-btn__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    wrap.innerHTML = [
      '<button type="button" class="my-task-actions-btn" data-task-actions-toggle aria-haspopup="true" aria-expanded="false">',
      '  <span>Actions</span>' + chevron,
      '</button>',
      '<div class="my-task-actions-menu hidden" role="menu">',
      '  <button type="button" role="menuitem" data-task-action="edit">Edit</button>',
      '  <button type="button" role="menuitem" data-task-action="' + completeAction + '">' + completeLabel + '</button>',
      '  <button type="button" role="menuitem" class="my-task-actions-menu__danger" data-task-action="delete">Delete</button>',
      '</div>'
    ].join('');
  }

  function taskActionsEls() {
    var modal = el('myTaskDetailsModal');
    if (!modal) return {};
    return {
      menu: modal.querySelector('.my-task-actions-menu'),
      toggle: modal.querySelector('[data-task-actions-toggle]')
    };
  }

  function toggleTaskActionsMenu() {
    var refs = taskActionsEls();
    if (!refs.menu) return;
    if (refs.menu.classList.contains('hidden')) {
      refs.menu.classList.remove('hidden');
      if (refs.toggle) refs.toggle.setAttribute('aria-expanded', 'true');
    } else {
      closeTaskActionsMenu();
    }
  }

  function closeTaskActionsMenu() {
    var refs = taskActionsEls();
    if (refs.menu) refs.menu.classList.add('hidden');
    if (refs.toggle) refs.toggle.setAttribute('aria-expanded', 'false');
  }

  // Inline status change from the details list. Mirrors the Mark Complete /
  // Reopen endpoints so the 'complete' transition goes through completeTask.
  async function setTaskStatus(rawStatus) {
    var task = state.viewingTask;
    if (!task || !task.id) return;
    var next = normalizeStatus(rawStatus);
    if (next === normalizeStatus(task.status)) return;
    try {
      if (next === 'complete') {
        await api.completeTask(task.id);
      } else {
        await api.updateTask(task.id, { status: next });
      }
      task.status = next;
      Lex.Toast.success('Status updated');
      openTaskDetails(task);
      loadTasks();
    } catch (error) {
      Lex.Toast.error(error.message || 'Unable to update status');
    }
  }

  function closeTaskDetails() {
    var modal = el('myTaskDetailsModal');
    if (modal) modal.open = false;
    state.viewingTask = null;
  }

  // Map a raw task into the row shape lex-table sees. Keep humanized values
  // in the visible columns so the column-filter dropdowns show pretty labels
  // (e.g. "In Progress" rather than "in_progress") while preserving the
  // original task in `_raw` for row-click / action handlers.
  function mapTaskForTable(task) {
    return {
      id: task.id,
      title: task.title || 'Untitled task',
      workspace_matter: taskMatterLabel(task),
      status: statusLabel(task.status),
      priority: priorityLabel(task.priority || 'normal'),
      due_date: task.due_date || '',
      updated_at: task.updated_at || '',
      _raw: task
    };
  }

  function cellRenderers() {
    return {
      title: function (val) {
        return '<div class="my-task-table__title">' + esc(val || '') + '</div>';
      },
      workspace_matter: function (val, row) {
        var task = row && row._raw;
        var label = taskMatterLabel(task);
        if (!task || !task.matter_id) {
          return '<span class="my-task-workspace-text">' + esc(label) + '</span>';
        }
        return [
          '<button type="button" class="my-task-workspace-link" data-matter-id="' + esc(task.matter_id) + '" title="' + esc(label) + '">',
          esc(label),
          '</button>'
        ].join('');
      },
      status: function (val, row) {
        var task = row && row._raw;
        var raw = task ? task.status : '';
        return '<lex-badge label="' + esc(statusLabel(raw)) + '" color="' + esc(statusColor(raw)) + '"></lex-badge>';
      },
      priority: function (val, row) {
        var task = row && row._raw;
        var raw = task && task.priority ? task.priority : 'normal';
        return '<lex-badge label="' + esc(priorityLabel(raw)) + '" color="' + esc(priorityColor(raw)) + '"></lex-badge>';
      },
      due_date: function (val) {
        return val ? esc(formatDate(val)) : '<span class="my-task-detail__muted">—</span>';
      }
    };
  }

  async function loadTasks() {
    var table = el('myTasksTable');
    if (!table) return;
    try {
      var collected = [];
      var offset = 0;
      while (collected.length < TASK_FETCH_MAX) {
        var batch = normalizeTasks(await api.getMyTasks({
          limit: TASK_PAGE_LIMIT,
          offset: offset,
          sort_by: 'updated_at',
          sort_dir: 'DESC'
        }));
        if (!batch.length) break;
        collected = collected.concat(batch);
        if (batch.length < TASK_PAGE_LIMIT) break;
        offset += TASK_PAGE_LIMIT;
      }
      state.tasks = collected;
      table.setData(collected.map(mapTaskForTable));
      updateTaskCount();
      return collected;
    } catch (error) {
      Lex.Toast.error(error.message || 'Unable to load tasks');
      state.tasks = [];
      if (typeof table.setData === 'function') table.setData([]);
      updateTaskCount();
      return [];
    }
  }

  // Reflect the table's current (post-search/filter) row total in the toolbar
  // and the section header.
  function updateTaskCount() {
    var table = el('myTasksTable');
    if (!table) return;
    var total = table.dataSource && table.dataSource.pagination
      ? table.dataSource.pagination.total
      : 0;
    var label = (total || 0) + ' item' + (total === 1 ? '' : 's');
    var countEl = el('myTasksCount');
    if (countEl) countEl.textContent = label;
    var sectionEl = el('myTasksSectionCount');
    if (sectionEl) sectionEl.textContent = label;
  }

  // Apply a sort to the table and keep its header arrows in sync.
  function applyTaskSort(column, direction) {
    var table = el('myTasksTable');
    if (!table) return;
    table.sortBy = column;
    table.sortDir = direction;
    if (table.dataSource) table.dataSource.setSort(column, direction);
  }

  function userHasRole(roleName) {
    var user = Lex.Auth && Lex.Auth.user;
    if (!user || !roleName) return false;
    var target = String(roleName).toLowerCase();
    var roles = user.roles || user.role_names || [];
    var roleNameField = user.role_name || user.role;
    function matches(role) {
      if (!role) return false;
      if (typeof role === 'string') return role.toLowerCase() === target;
      if (role.name) return String(role.name).toLowerCase() === target;
      return false;
    }
    for (var i = 0; i < roles.length; i++) {
      if (matches(roles[i])) return true;
    }
    return matches(roleNameField);
  }

  function canCreateTaskPlans() {
    if (Lex.Auth && Lex.Auth.isAdmin && Lex.Auth.isAdmin()) return true;
    for (var i = 0; i < TASK_PLAN_ROLES.length; i++) {
      if (userHasRole(TASK_PLAN_ROLES[i])) return true;
    }
    return false;
  }

  function syncNewMenuVisibility() {
    var menu = el('myTasksNewMenu');
    var btn = el('myTasksNewBtn');
    if (!menu) return;
    if (state.newMenuOpen) {
      menu.classList.remove('hidden');
      if (btn) btn.setAttribute('aria-expanded', 'true');
    } else {
      menu.classList.add('hidden');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }
  }

  function toggleNewMenu(force) {
    state.newMenuOpen = typeof force === 'boolean' ? force : !state.newMenuOpen;
    syncNewMenuVisibility();
  }

  function hideNewMenu() {
    if (!state.newMenuOpen) return;
    state.newMenuOpen = false;
    syncNewMenuVisibility();
  }

  function applyTaskPlanRoleGate() {
    var menu = el('myTasksNewMenu');
    if (!menu) return;
    var canPlans = canCreateTaskPlans();
    var planItem = menu.querySelector('[data-new-action="task-plan"]');
    if (planItem) {
      if (canPlans) {
        planItem.classList.remove('hidden');
      } else {
        planItem.classList.add('hidden');
      }
    }
  }

  // --- Matter picker (Create Task modal) ----------------------------------
  // Reuses MatterPickerModal as a generic matter
  // browser. The user sees recent + pinned matters by default, can search,
  // and clicks a card to select. No more bare typeahead where the user
  // doesn't know what to type.

  function setSelectedMatter(matterId, matterName) {
    state.selectedMatterId = matterId || null;
    state.selectedMatterName = matterName || null;
    var hidden = el('myTaskMatterId');
    if (hidden) hidden.value = matterId || '';
    var label = el('myTaskMatterPickLabel');
    if (label) {
      if (matterId) {
        label.textContent = matterName ? (matterName + '  ·  ' + matterId) : matterId;
        label.classList.remove('is-placeholder');
      } else {
        label.textContent = 'Select a matter — or leave blank for a workspace task';
        label.classList.add('is-placeholder');
      }
    }
    // Show the clear (×) button only when something is selected.
    var clearBtn = el('myTaskMatterClearBtn');
    if (clearBtn) clearBtn.classList.toggle('hidden', !matterId);
    // The available "Assign to" options depend on whether the task is
    // scoped to a matter: matter-scoped tasks can only target users who
    // have access to that matter, plus a "everyone with matter access"
    // broadcast option. Workspace-only tasks target the org instead.
    applyTargetTypeOptions();
    // Selecting a new matter invalidates the prior assignee scope
    setSelectedAssignee(null, null);
  }

  // Two option sets for the "Assign to" select, swapped based on whether
  // a matter is currently selected. The lex-select component re-renders
  // on `options` attribute change.
  var WORKSPACE_TARGET_OPTIONS = [
    { value: 'unassigned',   label: 'Unassigned / Org-level' },
    { value: 'user',         label: 'Individual User' },
    { value: 'organization', label: 'Entire Organization' }
  ];
  var MATTER_TARGET_OPTIONS = [
    { value: 'unassigned',         label: 'Unassigned (matter ACL applies)' },
    { value: 'user',               label: 'A user with matter access' },
    { value: 'matter_organization', label: 'Everyone with matter access' }
  ];

  function applyTargetTypeOptions() {
    var select = el('myTaskTargetType');
    if (!select) return;
    var nextOptions = state.selectedMatterId ? MATTER_TARGET_OPTIONS : WORKSPACE_TARGET_OPTIONS;
    select.setAttribute('options', JSON.stringify(nextOptions));
    // Preserve current selection where the value still exists in the new
    // option set; otherwise fall back to 'unassigned'. Both option sets
    // share 'unassigned' and 'user' values, so the matter-toggle only
    // forces a fallback if the user had picked 'organization' /
    // 'matter_organization' (those don't translate cleanly across modes).
    var current = String(select.value || 'unassigned');
    var validValues = nextOptions.map(function (o) { return o.value; });
    if (validValues.indexOf(current) === -1) {
      select.value = 'unassigned';
    }
    // Re-run visibility sync since the value may have just been reset.
    syncTargetTypeVisibility();
  }

  function openMatterPicker() {
    if (typeof MatterPickerModal === 'undefined' || !MatterPickerModal.open) {
      Lex.Toast.error('Matter picker is unavailable on this page.');
      return;
    }
    MatterPickerModal.open({
      heading: 'Pick a matter for this task',
      footerHint: 'Select a matter — the task will be created under it.',
      hideCreateBtn: true,
      onSelect: function (matterId, matterName) {
        setSelectedMatter(matterId, matterName);
      }
    });
  }

  // --- Matter picker (Create Task Plan modal) -----------------------------

  function setPlanSelectedMatter(matterId, matterName) {
    state.planSelectedMatterId = matterId || null;
    state.planSelectedMatterName = matterName || null;
    var hidden = el('myTaskPlanMatterId');
    if (hidden) hidden.value = matterId || '';
    var label = el('myTaskPlanMatterPickLabel');
    if (label) {
      if (matterId) {
        label.textContent = matterName ? (matterName + '  ·  ' + matterId) : matterId;
        label.classList.remove('is-placeholder');
      } else {
        label.textContent = 'None — applies to your workspace';
        label.classList.add('is-placeholder');
      }
    }
  }

  function openPlanMatterPicker() {
    if (typeof MatterPickerModal === 'undefined' || !MatterPickerModal.open) {
      Lex.Toast.error('Matter picker is unavailable on this page.');
      return;
    }
    MatterPickerModal.open({
      heading: 'Pick a matter for this plan',
      footerHint: 'Optional — leave unselected to scope the plan to your workspace.',
      hideCreateBtn: true,
      onSelect: function (matterId, matterName) {
        setPlanSelectedMatter(matterId, matterName);
      }
    });
  }

  // --- User picker (Create Task modal, target_type='user') ----------------
  // Opens UserPickerModal — a sibling of MatterPickerModal that shows the
  // same Browse-trigger + modal flow for picking a user. Scoped to the
  // currently selected matter when set, so the picker shows shared
  // matter users first and "rest of org" after.

  function setSelectedAssignee(userId, label) {
    state.selectedAssigneeId = userId || null;
    state.selectedAssigneeLabel = label || null;
    var hidden = el('myTaskAssignee');
    if (hidden) hidden.value = userId || '';
    var pickLabel = el('myTaskUserPickLabel');
    if (pickLabel) {
      if (userId) {
        pickLabel.textContent = label || userId;
        pickLabel.classList.remove('is-placeholder');
      } else {
        pickLabel.textContent = 'Select a user…';
        pickLabel.classList.add('is-placeholder');
      }
    }
  }

  function openUserPicker() {
    if (typeof UserPickerModal === 'undefined' || !UserPickerModal.open) {
      Lex.Toast.error('User picker is unavailable on this page.');
      return;
    }
    UserPickerModal.open({
      heading: 'Pick a user to assign',
      footerHint: state.selectedMatterId
        ? 'Pick someone who has access to this matter.'
        : 'Pick a user in your organization.',
      matterId: state.selectedMatterId || null,
      onSelect: function (userId, label) {
        setSelectedAssignee(userId, label);
      }
    });
  }

  // Show/hide the per-user search field depending on the "Assign to"
  // selection. unassigned + organization both hide the user picker (they
  // don't target a specific user); only `user` mode reveals it.
  function syncTargetTypeVisibility() {
    var select = el('myTaskTargetType');
    var field = el('myTaskTargetUserField');
    var value = select ? String(select.value || 'unassigned') : 'unassigned';
    state.selectedTargetType = value;
    if (field) {
      field.classList.toggle('hidden', value !== 'user');
    }
    // Leaving "Individual User" mode clears any previously selected user
    // so a stale assignee can't sneak into the payload.
    if (value !== 'user') {
      setSelectedAssignee(null, null);
    }
  }

  function openNewTaskModal() {
    state.editingTaskId = null;
    fillTaskModal(null);
    var modal = el('myTaskCreateModal');
    if (modal) modal.heading = 'Create Task';
    // Use Lex.Utils.setLexButtonText — assigning textContent directly to a
    // <lex-btn> wipes its styled inner DOM (see lex.utils.js for details).
    Lex.Utils.setLexButtonText(el('myTaskSaveBtn'), 'Create Task');
    if (modal) modal.open = true;
  }

  function openEditTaskModal(task) {
    if (!task || !task.id) {
      Lex.Toast.error('Task missing — try refreshing the list.');
      return;
    }
    state.editingTaskId = task.id;
    fillTaskModal(task);
    var modal = el('myTaskCreateModal');
    if (modal) modal.heading = 'Edit Task';
    Lex.Utils.setLexButtonText(el('myTaskSaveBtn'), 'Save Changes');
    if (modal) modal.open = true;
  }

  function fillTaskModal(task) {
    var title = el('myTaskTitle');
    var priority = el('myTaskPriority');
    var description = el('myTaskDescription');
    var dueDate = el('myTaskDueDate');
    var targetType = el('myTaskTargetType');

    if (task) {
      if (title) title.value = task.title || '';
      if (priority) priority.value = task.priority || 'medium';
      if (description) description.value = task.description || '';
      // Show the LOCAL calendar day of the stored instant; slicing the UTC
      // string shifts evening-local due dates to the next day.
      if (dueDate) dueDate.value = task.due_date ? LanaTime.toLocalDateInputValue(task.due_date) : '';
      if (targetType) targetType.value = task.target_type || 'unassigned';
      // Pre-fill matter selection from task.matter_id / matter name.
      setSelectedMatter(task.matter_id || null, taskMatterName(task) || null);
      // Pre-fill assignee if this is a user-targeted task.
      setSelectedAssignee(
        task.assigned_to_user_id || null,
        task.assigned_to_name || null
      );
    } else {
      if (title) title.value = '';
      if (priority) priority.value = 'medium';
      if (description) description.value = '';
      if (dueDate) dueDate.value = '';
      if (targetType) targetType.value = 'unassigned';
      setSelectedMatter(null, null);
      setSelectedAssignee(null, null);
    }
  }

  function closeNewTaskModal() {
    var modal = el('myTaskCreateModal');
    if (modal) modal.open = false;
    state.editingTaskId = null;
  }

  async function submitNewTask(event) {
    if (event) event.preventDefault();
    if (event && event.detail && event.detail.valid === false) {
      Lex.Toast.error('Please fix the highlighted fields');
      return;
    }
    var saveBtn = el('myTaskSaveBtn');
    var titleInput = el('myTaskTitle');
    var priorityInput = el('myTaskPriority');
    var descriptionInput = el('myTaskDescription');
    var dueDateInput = el('myTaskDueDate');

    var title = titleInput ? String(titleInput.value || '').trim() : '';
    // Matter is optional. When unset, the API call routes through a
    // workspace-scoped sentinel ('_workspace') so the backend treats the
    // task as org-level instead of matter-pinned.
    var matterId = state.selectedMatterId || '_workspace';

    if (!title) {
      Lex.Toast.error('Title is required');
      return;
    }

    var payload = {
      title: title,
      description: descriptionInput && descriptionInput.value ? String(descriptionInput.value).trim() : null,
      priority: priorityInput && priorityInput.value ? priorityInput.value : 'medium',
      due_date: dueDateInput && dueDateInput.value ? LanaTime.toIsoInstant(dueDateInput.value + 'T12:00:00') : null,
      status: 'pending',
      // Assignment semantics:
      //   unassigned   -> no assignee; matter-level ACL grants access to everyone in the org
      //   user         -> single assignee; assigned_to_user_id set below
      //   organization -> broadcast to the org; no specific assignee
      target_type: state.selectedTargetType || 'unassigned'
    };
    if (state.selectedTargetType === 'user') {
      if (!state.selectedAssigneeId) {
        Lex.Toast.error('Pick a user from the search results, or change "Assign to" to Unassigned.');
        var assigneeInput = el('myTaskAssignee');
        if (assigneeInput && typeof assigneeInput.focus === 'function') assigneeInput.focus();
        return;
      }
      payload.assigned_to_user_id = state.selectedAssigneeId;
    }

    if (saveBtn) saveBtn.loading = true;
    try {
      if (state.editingTaskId) {
        // PATCH /api/v1/matters/tasks/:task_id — the update route is task-
        // scoped (no matter_id in URL). We don't pass `status` here; the
        // Mark Complete / Reopen action owns status transitions so the
        // edit modal can't accidentally flip-flop completed-ness.
        var updatePayload = {
          title: payload.title,
          description: payload.description,
          priority: payload.priority,
          due_date: payload.due_date,
          assigned_to_user_id: payload.assigned_to_user_id || null
        };
        await api.updateTask(state.editingTaskId, updatePayload);
        Lex.Toast.success('Task updated');
      } else {
        await api.createTask(matterId, payload);
        Lex.Toast.success(
          state.selectedAssigneeId && state.selectedAssigneeLabel
            ? ('Task created — assigned to ' + state.selectedAssigneeLabel)
            : 'Task created'
        );
      }
      closeNewTaskModal();
      loadTasks();
    } catch (error) {
      Lex.Toast.error(error.message || (state.editingTaskId ? 'Unable to update task' : 'Unable to create task'));
    } finally {
      if (saveBtn) saveBtn.loading = false;
    }
  }

  // --- Task actions (Edit / Complete / Reopen / Delete) -------------------

  async function handleTaskAction(action) {
    var task = state.viewingTask;
    if (!task || !task.id) return;

    if (action === 'edit') {
      closeTaskDetails();
      openEditTaskModal(task);
      return;
    }

    if (action === 'complete') {
      try {
        await api.completeTask(task.id);
        Lex.Toast.success('Task marked complete');
        closeTaskDetails();
        loadTasks();
      } catch (error) {
        Lex.Toast.error(error.message || 'Unable to mark task complete');
      }
      return;
    }

    if (action === 'reopen') {
      try {
        await api.updateTask(task.id, { status: 'pending' });
        Lex.Toast.success('Task reopened');
        closeTaskDetails();
        loadTasks();
      } catch (error) {
        Lex.Toast.error(error.message || 'Unable to reopen task');
      }
      return;
    }

    if (action === 'delete') {
      var confirmDelete = window.confirm('Delete this task? This cannot be undone.');
      if (!confirmDelete) return;
      try {
        await api.deleteTask(task.id);
        Lex.Toast.success('Task deleted');
        closeTaskDetails();
        loadTasks();
      } catch (error) {
        Lex.Toast.error(error.message || 'Unable to delete task');
      }
      return;
    }
  }

  function rerenderTaskDetails() {
    if (state.viewingTask) openTaskDetails(state.viewingTask);
  }

  function detailInputValue(name) {
    var content = el('myTaskDetailsContent');
    if (!content) return '';
    var input = content.querySelector('[data-task-input="' + name + '"]');
    if (!input) return '';
    return String(input.value || '').trim();
  }

  function setDetailInputValue(name, value) {
    var content = el('myTaskDetailsContent');
    if (!content) return;
    var input = content.querySelector('[data-task-input="' + name + '"]');
    if (!input) return;
    input.value = value || '';
    var native = input.querySelector && input.querySelector('textarea, input');
    if (native) native.value = value || '';
    if (name === 'comment') updateTaskCommentComposerState();
  }

  function clearDetailInput(name) {
    var content = el('myTaskDetailsContent');
    if (!content) return;
    var inputs = content.querySelectorAll('[data-task-input="' + name + '"], [data-task-input="' + name + '-name"], [data-task-input="' + name + '-url"]');
    inputs.forEach(function (input) {
      input.value = '';
      var native = input.querySelector && input.querySelector('textarea, input');
      if (native) native.value = '';
    });
  }

  function toggleDetailAddPanel(targetName, trigger) {
    var content = el('myTaskDetailsContent');
    if (!content || !targetName) return;
    var panel = content.querySelector('[data-task-add-panel="' + targetName + '"]');
    if (!panel) return;

    var shouldOpen = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !shouldOpen);
    if (trigger) {
      var addLabel = trigger.getAttribute('data-task-add-label') || 'Add';
      trigger.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
      trigger.setAttribute('title', shouldOpen ? 'Dismiss' : addLabel);
      trigger.setAttribute('aria-label', shouldOpen ? 'Dismiss' : addLabel);
    }

    if (!shouldOpen) {
      clearDetailInput(targetName);
      return;
    }

    var focusInput = content.querySelector('[data-task-input="' + targetName + '"], [data-task-input="' + targetName + '-name"]');
    if (focusInput && typeof focusInput.focus === 'function') focusInput.focus();
  }

  function focusTaskCommentComposer() {
    var content = el('myTaskDetailsContent');
    if (!content) return;
    var composer = content.querySelector('[data-task-input="comment"]');
    if (!composer && state.viewingTask) {
      state.activityTabs[detailKey(state.viewingTask)] = 'comments';
      rerenderTaskDetails();
      requestAnimationFrame(focusTaskCommentComposer);
      return;
    }
    if (!composer) return;
    var native = composer.querySelector && composer.querySelector('textarea');
    if (native && typeof native.focus === 'function') {
      native.focus();
      native.setSelectionRange(native.value.length, native.value.length);
      return;
    }
    if (typeof composer.focus === 'function') composer.focus();
  }

  function updateTaskCommentComposerState() {
    var content = el('myTaskDetailsContent');
    if (!content) return;
    var input = content.querySelector('[data-task-input="comment"]');
    var composer = content.querySelector('.my-task-comment-composer');
    if (!input || !composer) return;
    var value = String(input.value || '').trim();
    composer.classList.toggle('has-content', !!value);
  }

  function hideTaskMentionPicker() {
    var content = el('myTaskDetailsContent');
    var picker = content && content.querySelector('[data-task-mention-picker]');
    if (!picker) return;
    picker.classList.add('hidden');
    picker.innerHTML = '';
  }

  function cancelTaskCommentCompose() {
    setDetailInputValue('comment', '');
    var content = el('myTaskDetailsContent');
    if (!content) return;
    var native = content.querySelector('[data-task-input="comment"] textarea');
    if (native && typeof native.blur === 'function') native.blur();
    hideTaskMentionPicker();
    updateTaskCommentComposerState();
  }

  function commentTextarea() {
    var content = el('myTaskDetailsContent');
    var composer = content && content.querySelector('[data-task-input="comment"]');
    return composer && composer.querySelector ? composer.querySelector('textarea') : null;
  }

  function mentionSearchText(user) {
    return [
      user.name,
      user.email,
      user.role,
      user.id
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function taskMentionTrigger() {
    var textarea = commentTextarea();
    if (!textarea) return null;
    var caret = textarea.selectionStart || 0;
    var before = textarea.value.slice(0, caret);
    var start = before.lastIndexOf('@');
    if (start === -1) return null;
    if (start > 0 && !/\s|\(|\[/.test(before.charAt(start - 1))) return null;
    var filter = before.slice(start + 1);
    if (filter.indexOf('\n') !== -1 || /[^\w\s.'-]/.test(filter)) return null;
    return { start: start, end: caret, filter: filter.toLowerCase() };
  }

  function renderTaskMentionPickerRows(store) {
    if (store.mentionsLoading || !store.mentionsLoaded) {
      return '<div class="my-task-mention-picker__empty">Loading people...</div>';
    }

    var filter = String(store.mentionFilter || '').toLowerCase();
    var users = asArray(store.mentionUsers).filter(function (user) {
      return !filter || mentionSearchText(user).indexOf(filter) !== -1;
    }).slice(0, 8);

    if (!users.length) {
      return '<div class="my-task-mention-picker__empty">No matching people.</div>';
    }

    return users.map(function (user) {
      return [
        '<button type="button" class="my-task-mention-option" data-task-mention-id="' + esc(user.id) + '" data-task-mention-name="' + esc(user.name) + '">',
        '  <span class="my-task-mention-option__avatar">' + esc(initialsFor(user.name)) + '</span>',
        '  <span class="my-task-mention-option__body">',
        '    <strong>' + esc(user.name) + '</strong>',
        user.email || user.role ? '    <span>' + esc([user.email, user.role].filter(Boolean).join(' - ')) + '</span>' : '',
        '  </span>',
        '</button>'
      ].join('');
    }).join('');
  }

  function updateTaskMentionPicker(forceOpen) {
    var task = state.viewingTask;
    if (!task) return;
    var content = el('myTaskDetailsContent');
    var picker = content && content.querySelector('[data-task-mention-picker]');
    if (!picker) return;

    var trigger = taskMentionTrigger();
    if (!trigger && !forceOpen) {
      hideTaskMentionPicker();
      return;
    }

    var store = getTaskDetailStore(task);
    store.mentionFilter = trigger ? trigger.filter : '';
    picker.innerHTML = renderTaskMentionPickerRows(store);
    picker.classList.remove('hidden');

    if (!store.mentionsLoaded && !store.mentionsLoading) {
      loadTaskMentionUsers();
    }
  }

  async function loadTaskMentionUsers() {
    var task = state.viewingTask;
    if (!task) return;
    var store = getTaskDetailStore(task);
    if (store.mentionsLoaded || store.mentionsLoading) {
      updateTaskMentionPicker(true);
      return;
    }

    store.mentionsLoading = true;
    updateTaskMentionPicker(true);
    try {
      var response;
      if (task.matter_id && api.getMentionableUsers) {
        response = await api.getMentionableUsers(task.matter_id);
      } else if (api.getUsers) {
        response = await api.getUsers(1, 200, {});
      } else {
        response = await api.get('/api/v1/admin/users?page=1&page_size=200');
      }
      store.mentionUsers = normalizeMentionUsersResponse(response);
      store.mentionsLoaded = true;
    } catch (error) {
      console.error('[MyTasks] Failed to load mentionable users:', error);
      Lex.Toast.error(error.message || 'Unable to load mentionable users');
      store.mentionUsers = [];
      store.mentionsLoaded = true;
    } finally {
      store.mentionsLoading = false;
      updateTaskMentionPicker(true);
    }
  }

  function insertTaskMention(userId, userName) {
    var content = el('myTaskDetailsContent');
    var input = content && content.querySelector('[data-task-input="comment"]');
    var textarea = commentTextarea();
    if (!input || !textarea || !userId || !userName) return;

    var trigger = taskMentionTrigger();
    var start = trigger ? trigger.start : (textarea.selectionStart || textarea.value.length);
    var end = trigger ? trigger.end : (textarea.selectionEnd || start);
    var token = '@[' + userName + '](' + userId + ') ';

    if (typeof textarea.setRangeText === 'function') {
      textarea.setRangeText(token, start, end, 'end');
    } else {
      textarea.value = textarea.value.slice(0, start) + token + textarea.value.slice(end);
    }
    input.value = textarea.value;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    hideTaskMentionPicker();
    updateTaskCommentComposerState();
    textarea.focus();
  }

  function insertCommentText(prefix, suffix, placeholder) {
    focusTaskCommentComposer();
    requestAnimationFrame(function () {
      var content = el('myTaskDetailsContent');
      var input = content && content.querySelector('[data-task-input="comment"]');
      var textarea = commentTextarea();
      if (!input || !textarea) return;
      var start = textarea.selectionStart || 0;
      var end = textarea.selectionEnd || start;
      var selected = textarea.value.slice(start, end) || placeholder || '';
      var nextText = String(prefix || '') + selected + String(suffix || '');
      if (typeof textarea.setRangeText === 'function') {
        textarea.setRangeText(nextText, start, end, 'end');
      } else {
        textarea.value = textarea.value.slice(0, start) + nextText + textarea.value.slice(end);
      }
      input.value = textarea.value;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      updateTaskCommentComposerState();
    });
  }

  function handleTaskCommentTool(action) {
    if (action === 'assistant' || action === 'improve-writing' || action === 'text-style') {
      focusTaskCommentComposer();
      return;
    }
    if (action === 'bold') {
      insertCommentText('**', '**', 'bold text');
      return;
    }
    if (action === 'list') {
      insertCommentText('\n- ', '', 'list item');
      return;
    }
    if (action === 'mention') {
      focusTaskCommentComposer();
      requestAnimationFrame(function () {
        var textarea = commentTextarea();
        if (!textarea) return;
        var start = textarea.selectionStart || 0;
        var needsTrigger = start === 0 || textarea.value.charAt(start - 1) !== '@';
        if (needsTrigger) insertCommentText('@', '', '');
        loadTaskMentionUsers();
      });
      return;
    }
    if (action === 'link') {
      insertCommentText('[', '](https://)', 'link text');
      return;
    }
    if (action === 'attach-document') {
      var content = el('myTaskDetailsContent');
      var panel = content && content.querySelector('[data-task-add-panel="document"]');
      var trigger = content && content.querySelector('[data-task-focus="document"]');
      if (panel && panel.classList.contains('hidden')) toggleDetailAddPanel('document', trigger);
      loadTaskMatterDocuments(false);
      var documentInput = content && content.querySelector('[data-task-input="document-name"]');
      if (documentInput && typeof documentInput.focus === 'function') documentInput.focus();
    }
  }

  function updateTaskDocumentResults() {
    var task = state.viewingTask;
    if (!task) return;
    var content = el('myTaskDetailsContent');
    var results = content && content.querySelector('[data-task-document-results]');
    if (!results) return;
    results.innerHTML = renderDocumentPickerResults(task, getTaskDetailStore(task));
  }

  async function loadTaskMatterDocuments(force) {
    var task = state.viewingTask;
    if (!task || !task.matter_id) return;
    var store = getTaskDetailStore(task);
    if (store.documentsLoaded && !force) {
      updateTaskDocumentResults();
      return;
    }
    store.documentsLoading = true;
    updateTaskDocumentResults();
    try {
      var response;
      if (api.getMatterDocuments) {
        response = await api.getMatterDocuments(task.matter_id, 1, 100);
      } else {
        response = await api.get('/api/v1/matters/' + encodeURIComponent(task.matter_id) + '/documents?limit=100');
      }
      store.matterDocuments = normalizeMatterDocumentsResponse(response);
      store.documentsLoaded = true;
    } catch (error) {
      console.error('[MyTasks] Failed to load workspace documents:', error);
      Lex.Toast.error(error.message || 'Unable to load workspace documents');
      store.matterDocuments = [];
      store.documentsLoaded = true;
    } finally {
      store.documentsLoading = false;
      updateTaskDocumentResults();
    }
  }

  function handleTaskDocumentSearch(value) {
    var task = state.viewingTask;
    if (!task) return;
    var store = getTaskDetailStore(task);
    store.documentSearch = String(value || '');
    updateTaskDocumentResults();
    if (task.matter_id && !store.documentsLoaded && !store.documentsLoading) loadTaskMatterDocuments(false);
  }

  function associateTaskDocument(doc) {
    var task = state.viewingTask;
    if (!task || !doc) return;
    var store = getTaskDetailStore(task);
    if (taskHasDocument(store, doc.id)) {
      Lex.Toast.warning('Document already associated');
      return;
    }
    store.documents.push({
      id: doc.id,
      name: doc.name,
      type: doc.type || 'workspace document',
      url: doc.url || '',
      added_by: currentUserName(),
      added_at: LanaTime.nowIso()
    });
    addDetailActivity(task, 'history', 'Associated document "' + doc.name + '"');
    rerenderTaskDetails();
  }

  function handleTaskDocumentCandidate(documentId) {
    var task = state.viewingTask;
    if (!task || !documentId) return;
    var store = getTaskDetailStore(task);
    var doc = asArray(store.matterDocuments).find(function (item) {
      return String(item.id) === String(documentId);
    });
    if (!doc) return;
    associateTaskDocument(doc);
  }

  async function handleTaskDocumentUpload(files) {
    var task = state.viewingTask;
    if (!task || !task.matter_id) {
      Lex.Toast.warning('Document uploads require a task associated with a workspace.');
      return;
    }
    var fileArray = Array.prototype.slice.call(files || []).filter(Boolean);
    if (!fileArray.length) return;
    var store = getTaskDetailStore(task);
    try {
      for (var i = 0; i < fileArray.length; i += 1) {
        var file = fileArray[i];
        var result = await api.uploadDocument(file, task.matter_id);
        var doc = normalizeMatterDocument({
          id: firstDefined(result.document_id, result.file_id, result.id),
          filename: firstDefined(result.filename, file.name),
          content_type: file.type || 'document',
          status: firstDefined(result.status, 'uploaded'),
          created_at: LanaTime.nowIso()
        }, i);
        if (!taskHasDocument(store, doc.id)) {
          store.documents.push({
            id: doc.id,
            name: doc.name,
            type: doc.type || 'uploaded document',
            url: doc.url || '',
            added_by: currentUserName(),
            added_at: LanaTime.nowIso()
          });
        }
      }
      store.documentsLoaded = false;
      addDetailActivity(task, 'history', 'Uploaded and associated ' + fileArray.length + ' document' + (fileArray.length === 1 ? '' : 's'));
      Lex.Toast.success(fileArray.length === 1 ? 'Document uploaded' : 'Documents uploaded');
      rerenderTaskDetails();
      loadTaskMatterDocuments(true);
    } catch (error) {
      Lex.Toast.error(error.message || 'Unable to upload document');
    }
  }

  function applyTaskCommentTemplate(value) {
    var current = detailInputValue('comment');
    var next = current ? (current + '\n' + value) : value;
    setDetailInputValue('comment', next);
    focusTaskCommentComposer();
  }

  function findTaskComment(comments, commentId, parent) {
    comments = asArray(comments);
    for (var i = 0; i < comments.length; i += 1) {
      if (String(comments[i].id) === String(commentId)) {
        return { comment: comments[i], parent: parent || null, index: i };
      }
      var nested = findTaskComment(comments[i].replies, commentId, comments[i]);
      if (nested) return nested;
    }
    return null;
  }

  function removeTaskComment(comments, commentId) {
    comments = asArray(comments);
    for (var i = 0; i < comments.length; i += 1) {
      if (String(comments[i].id) === String(commentId)) {
        comments.splice(i, 1);
        return true;
      }
      if (removeTaskComment(comments[i].replies, commentId)) return true;
    }
    return false;
  }

  function startTaskCommentEdit(commentId) {
    var task = state.viewingTask;
    if (!task || !commentId) return;
    var found = findTaskComment(getTaskDetailStore(task).comments, commentId);
    if (!found || !found.comment) return;
    var content = el('myTaskDetailsContent');
    var contentEl = content && content.querySelector('[data-comment-content="' + cssEscape(commentId) + '"]');
    if (!contentEl) return;
    contentEl.innerHTML = [
      '<div class="my-task-comment-edit">',
      '  <textarea rows="3">' + esc(found.comment.content || '') + '</textarea>',
      '  <div class="my-task-reply-editor__actions">',
      '    <button type="button" class="my-task-comment-action" data-task-comment-action="cancel-edit" data-comment-id="' + esc(commentId) + '">Cancel</button>',
      '    <button type="button" class="my-task-comment-action my-task-comment-action--primary" data-task-comment-action="save-edit" data-comment-id="' + esc(commentId) + '">' + iconHtml('send') + '<span>Save</span></button>',
      '  </div>',
      '</div>'
    ].join('');
    var textarea = contentEl.querySelector('textarea');
    if (textarea) {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
  }

  function handleTaskCommentAction(action, commentId, actionEl) {
    var task = state.viewingTask;
    if (!task || !commentId) return;
    var store = getTaskDetailStore(task);
    var found = findTaskComment(store.comments, commentId);
    var comment = found && found.comment;
    if (!comment && action !== 'cancel-reply') return;

    if (action === 'reply') {
      var editor = el('myTaskDetailsContent').querySelector('[data-reply-editor="' + cssEscape(commentId) + '"]');
      if (editor) {
        editor.classList.toggle('hidden');
        var replyTextarea = editor.querySelector('textarea');
        if (!editor.classList.contains('hidden') && replyTextarea) replyTextarea.focus();
      }
      return;
    }

    if (action === 'cancel-reply') {
      var cancelEditor = actionEl.closest('.my-task-reply-editor');
      if (cancelEditor) {
        cancelEditor.classList.add('hidden');
        var cancelTextarea = cancelEditor.querySelector('textarea');
        if (cancelTextarea) cancelTextarea.value = '';
      }
      return;
    }

    if (action === 'post-reply') {
      var replyEditor = actionEl.closest('.my-task-reply-editor');
      var textarea = replyEditor && replyEditor.querySelector('textarea');
      var replyContent = textarea ? textarea.value.trim() : '';
      if (!replyContent) {
        Lex.Toast.warning('Please enter a reply');
        return;
      }
      if (!comment.replies) comment.replies = [];
      comment.replies.push({
        id: 'local-reply-' + LanaTime.nowMs(),
        author: currentUserName(),
        author_id: String(currentUserId()),
        content: replyContent,
        created_at: LanaTime.nowIso(),
        is_edited: false,
        is_pinned: false,
        liked: false,
        like_count: 0,
        reaction_count: 0,
        replies: []
      });
      addDetailActivity(task, 'history', 'Replied to a comment');
      rerenderTaskDetails();
      return;
    }

    if (action === 'like') {
      comment.liked = !comment.liked;
      comment.like_count = Math.max(0, Number(comment.like_count || 0) + (comment.liked ? 1 : -1));
      rerenderTaskDetails();
      return;
    }

    if (action === 'react') {
      comment.reaction_count = Number(comment.reaction_count || 0) + 1;
      rerenderTaskDetails();
      return;
    }

    if (action === 'pin') {
      comment.is_pinned = !comment.is_pinned;
      addDetailActivity(task, 'history', (comment.is_pinned ? 'Pinned' : 'Unpinned') + ' a comment');
      rerenderTaskDetails();
      return;
    }

    if (action === 'edit') {
      startTaskCommentEdit(commentId);
      return;
    }

    if (action === 'cancel-edit') {
      rerenderTaskDetails();
      return;
    }

    if (action === 'save-edit') {
      var editBox = actionEl.closest('.my-task-comment-edit');
      var editTextarea = editBox && editBox.querySelector('textarea');
      var editedContent = editTextarea ? editTextarea.value.trim() : '';
      if (!editedContent) {
        Lex.Toast.warning('Comment cannot be empty');
        return;
      }
      comment.content = editedContent;
      comment.is_edited = true;
      addDetailActivity(task, 'history', 'Edited a comment');
      rerenderTaskDetails();
      return;
    }

    if (action === 'delete') {
      Lex.Modal.confirm(
        'Delete Comment',
        'Are you sure you want to delete this comment? This action cannot be undone.',
        function () {
          if (removeTaskComment(store.comments, commentId)) {
            addDetailActivity(task, 'history', 'Deleted a comment');
            rerenderTaskDetails();
          }
        },
        { variant: 'danger', confirmText: 'Delete' }
      );
    }
  }

  function handleDetailAdd(kind) {
    var task = state.viewingTask;
    if (!task) return;
    var store = getTaskDetailStore(task);

    if (kind === 'checklist') {
      var checklistTitle = detailInputValue('checklist');
      if (!checklistTitle) return;
      store.checklist.push({
        id: 'local-check-' + LanaTime.nowMs(),
        title: checklistTitle,
        completed: false
      });
      addDetailActivity(task, 'history', 'Added checklist item "' + checklistTitle + '"');
      rerenderTaskDetails();
      return;
    }

    if (kind === 'subtask') {
      var subtaskTitle = detailInputValue('subtask');
      if (!subtaskTitle) return;
      store.subtasks.push({
        id: 'local-subtask-' + LanaTime.nowMs(),
        title: subtaskTitle,
        status: 'pending',
        assignee: '',
        due_date: ''
      });
      addDetailActivity(task, 'history', 'Added subtask "' + subtaskTitle + '"');
      rerenderTaskDetails();
      return;
    }

    if (kind === 'document') {
      var docName = detailInputValue('document-name');
      var docUrl = detailInputValue('document-url');
      if (!docName) return;
      var matchingDoc = findMatchingMatterDocument(store, docName);
      if (matchingDoc && !docUrl) {
        associateTaskDocument(matchingDoc);
        return;
      }
      store.documents.push({
        id: 'local-doc-' + LanaTime.nowMs(),
        name: docName,
        type: docUrl ? 'linked document' : 'document',
        url: docUrl,
        added_by: currentUserName(),
        added_at: LanaTime.nowIso()
      });
      addDetailActivity(task, 'history', 'Associated document "' + docName + '"');
      rerenderTaskDetails();
      return;
    }

    if (kind === 'comment') {
      var comment = detailInputValue('comment');
      if (!comment) return;
      store.comments.unshift({
        id: 'local-comment-' + LanaTime.nowMs(),
        author: currentUserName(),
        author_id: String(currentUserId()),
        content: comment,
        created_at: LanaTime.nowIso(),
        is_edited: false,
        is_pinned: false,
        liked: false,
        like_count: 0,
        reaction_count: 0,
        replies: []
      });
      state.activityTabs[detailKey(task)] = 'comments';
      rerenderTaskDetails();
    }
  }

  function handleChecklistToggle(itemId, checked) {
    var task = state.viewingTask;
    if (!task || !itemId) return;
    var store = getTaskDetailStore(task);
    var item = store.checklist.find(function (entry) {
      return String(entry.id) === String(itemId);
    });
    if (!item) return;
    item.completed = !!checked;
    addDetailActivity(task, 'history', (item.completed ? 'Completed' : 'Reopened') + ' checklist item "' + item.title + '"');
    rerenderTaskDetails();
  }

  function handleSubtaskToggle(itemId) {
    var task = state.viewingTask;
    if (!task || !itemId) return;
    var store = getTaskDetailStore(task);
    var item = store.subtasks.find(function (entry) {
      return String(entry.id) === String(itemId);
    });
    if (!item) return;
    item.status = normalizeStatus(item.status) === 'complete' ? 'pending' : 'complete';
    addDetailActivity(task, 'history', (item.status === 'complete' ? 'Completed' : 'Reopened') + ' subtask "' + item.title + '"');
    rerenderTaskDetails();
  }

  // --- Create Task Plan modal ---------------------------------------------

  function openNewTaskPlanModal() {
    var modal = el('myTaskPlanCreateModal');
    var title = el('myTaskPlanTitle');
    var description = el('myTaskPlanDescription');

    if (title) title.value = '';
    if (description) description.value = '';
    setPlanSelectedMatter(null, null);
    if (modal) modal.open = true;
  }

  function closeNewTaskPlanModal() {
    var modal = el('myTaskPlanCreateModal');
    if (modal) modal.open = false;
  }

  async function submitNewTaskPlan(event) {
    if (event) event.preventDefault();
    if (event && event.detail && event.detail.valid === false) {
      Lex.Toast.error('Please fix the highlighted fields');
      return;
    }
    var saveBtn = el('myTaskPlanSaveBtn');
    var titleInput = el('myTaskPlanTitle');
    var descriptionInput = el('myTaskPlanDescription');

    var title = titleInput ? String(titleInput.value || '').trim() : '';
    if (!title) {
      Lex.Toast.error('Title is required');
      if (titleInput && typeof titleInput.focus === 'function') titleInput.focus();
      return;
    }

    // Backend validator (task-plans.validators.js line 52) requires
    // `title` — historically the form labeled it "Name" which sent the
    // wrong key and rejected at the API boundary.
    var payload = {
      title: title,
      description: descriptionInput && descriptionInput.value
        ? String(descriptionInput.value).trim() : null,
      matter_id: state.planSelectedMatterId || null
    };

    if (saveBtn) saveBtn.loading = true;
    try {
      var result = await api.createTaskPlan(payload);
      var plan = (result && result.data) || result || {};
      var planId = plan.id || plan.plan_id;
      Lex.Toast.success('Plan created — opening editor');
      closeNewTaskPlanModal();
      // Hand off to the dedicated editor page for adding items + assignees.
      // The plan id query param is what admin/task-plans.html uses to load
      // the just-created plan into its editor view.
      if (planId) {
        Lex.Nav.go('admin/task-plans.html', { params: { id: planId } });
      } else {
        Lex.Nav.go('admin/task-plans.html');
      }
    } catch (error) {
      Lex.Toast.error(error.message || 'Unable to create task plan');
    } finally {
      if (saveBtn) saveBtn.loading = false;
    }
  }

  function handleNewMenuClick(action) {
    hideNewMenu();
    if (action === 'task') {
      openNewTaskModal();
      return;
    }
    if (action === 'task-plan') {
      if (!canCreateTaskPlans()) {
        Lex.Toast.error('You do not have permission to create task plans.');
        return;
      }
      openNewTaskPlanModal();
    }
  }

  function handleInitialAction() {
    var params;
    try {
      params = new URLSearchParams(window.location.search || '');
    } catch (_) {
      return;
    }
    if (params.get('action') === 'create') {
      requestAnimationFrame(openNewTaskModal);
    }
  }

  function handleInitialTask(tasks) {
    var params;
    try {
      params = new URLSearchParams(window.location.search || '');
    } catch (_) {
      return;
    }
    var taskId = params.get('task');
    if (!taskId || !Array.isArray(tasks)) return;
    var task = tasks.find(function (item) {
      return String(item.id || item.task_id || '') === String(taskId);
    });
    if (task) requestAnimationFrame(function () { openTaskDetails(task); });
  }

  function bindEvents() {
    var table = el('myTasksTable');
    if (table) {
      // Renderers must be registered before the first setData so they are
      // active for the initial render (lex-table caches them on the element).
      if (typeof table.setCellRenderers === 'function') {
        table.setCellRenderers(cellRenderers());
      }

      // lex-table emits `row-click` for any non-button/input/anchor click
      // inside a row. Use it to open the task details modal.
      table.addEventListener('row-click', function (event) {
        var row = event.detail && event.detail.row;
        var task = row && row._raw;
        if (task) openTaskDetails(task);
      });

      // Keep the toolbar count in sync as the client-side pipeline reprocesses.
      table.addEventListener('lex-filter-change', updateTaskCount);
      table.addEventListener('lex-data-loaded', updateTaskCount);

      // Empty-state CTA: "Create a task" on a genuine no-data state opens the new
      // task modal (same as the header "+ New" -> New task).
      table.addEventListener('empty-action', function () { openNewTaskModal(); });

      // --- Library-style toolbar: search / sort / order / status filter ---
      var searchInput = el('myTasksSearch');
      if (searchInput) {
        var runSearch = function (event) {
          if (table.dataSource) {
            table.dataSource.setSearch(event && event.detail ? event.detail.value : '');
          }
        };
        searchInput.addEventListener('lex-input', runSearch);
        searchInput.addEventListener('lex-change', runSearch);
      }

      var sortSelect = el('myTasksSort');
      var sortOrderBtn = el('myTasksSortOrder');
      var currentOrder = function () {
        return sortOrderBtn && sortOrderBtn.dataset.order === 'asc' ? 'asc' : 'desc';
      };
      if (sortSelect) {
        sortSelect.addEventListener('lex-change', function (event) {
          var col = event && event.detail ? event.detail.value : 'updated_at';
          applyTaskSort(col, currentOrder());
        });
      }
      if (sortOrderBtn) {
        sortOrderBtn.addEventListener('click', function () {
          var next = sortOrderBtn.dataset.order === 'asc' ? 'desc' : 'asc';
          sortOrderBtn.dataset.order = next;
          applyTaskSort(sortSelect ? sortSelect.value : 'updated_at', next);
        });
      }

      var statusFilter = el('myTasksStatusFilter');
      if (statusFilter) {
        statusFilter.addEventListener('lex-change', function (event) {
          var val = event && event.detail ? event.detail.value : 'all';
          if (val === 'all') {
            table.removeFilter('status');
          } else {
            table.addFilter('status', 'in', [val]);
          }
        });
      }

      // Workspace/Matter button lives inside the row, so lex-table's
      // row-click guard skips it. Catch it here via delegation — re-attached
      // automatically after every lex-table re-render since the listener
      // lives on the host element, not the inner table cells.
      table.addEventListener('click', function (event) {
        var matterButton = event.target.closest('[data-matter-id]');
        if (!matterButton) return;
        event.stopPropagation();
        Lex.Nav.go('workspace-details.html', {
          params: { id: matterButton.getAttribute('data-matter-id'), tab: 'tasks' }
        });
      });
    }

    var modalContent = el('myTaskDetailsContent');
    if (modalContent) {
      // Matter title hyperlink → open the matter workspace.
      modalContent.addEventListener('click', function (event) {
        var templateBtn = event.target.closest('[data-task-comment-template]');
        if (templateBtn) {
          event.preventDefault();
          applyTaskCommentTemplate(templateBtn.getAttribute('data-task-comment-template'));
          return;
        }

        var composeCancel = event.target.closest('[data-task-compose-cancel]');
        if (composeCancel) {
          event.preventDefault();
          cancelTaskCommentCompose();
          return;
        }

        var commentTool = event.target.closest('[data-task-comment-tool]');
        if (commentTool) {
          event.preventDefault();
          handleTaskCommentTool(commentTool.getAttribute('data-task-comment-tool'));
          return;
        }

        var mentionOption = event.target.closest('[data-task-mention-id]');
        if (mentionOption) {
          event.preventDefault();
          insertTaskMention(
            mentionOption.getAttribute('data-task-mention-id'),
            mentionOption.getAttribute('data-task-mention-name')
          );
          return;
        }

        var uploadBtn = event.target.closest('[data-task-document-upload]');
        if (uploadBtn) {
          event.preventDefault();
          var fileInput = modalContent.querySelector('[data-task-document-file]');
          if (fileInput && typeof fileInput.click === 'function') fileInput.click();
          return;
        }

        var documentCandidate = event.target.closest('[data-task-document-id]');
        if (documentCandidate) {
          event.preventDefault();
          handleTaskDocumentCandidate(documentCandidate.getAttribute('data-task-document-id'));
          return;
        }

        var commentAction = event.target.closest('[data-task-comment-action]');
        if (commentAction) {
          event.preventDefault();
          handleTaskCommentAction(
            commentAction.getAttribute('data-task-comment-action'),
            commentAction.getAttribute('data-comment-id'),
            commentAction
          );
          return;
        }

        var addBtn = event.target.closest('[data-task-add]');
        if (addBtn) {
          event.preventDefault();
          handleDetailAdd(addBtn.getAttribute('data-task-add'));
          return;
        }

        var focusBtn = event.target.closest('[data-task-focus]');
        if (focusBtn) {
          event.preventDefault();
          var targetName = focusBtn.getAttribute('data-task-focus');
          toggleDetailAddPanel(targetName, focusBtn);
          if (targetName === 'document') loadTaskMatterDocuments(false);
          return;
        }

        var subtaskToggle = event.target.closest('[data-subtask-toggle]');
        if (subtaskToggle) {
          event.preventDefault();
          handleSubtaskToggle(subtaskToggle.getAttribute('data-subtask-toggle'));
          return;
        }

        var matterButton = event.target.closest('[data-matter-id]');
        if (!matterButton) return;
        Lex.Nav.go('workspace-details.html', {
          params: { id: matterButton.getAttribute('data-matter-id'), tab: 'tasks' }
        });
      });

      // Inline status change from the details list.
      modalContent.addEventListener('change', function (event) {
        var select = event.target.closest('[data-task-status-select]');
        if (!select) return;
        setTaskStatus(select.value);
      });

      modalContent.addEventListener('lex-change', function (event) {
        var checkbox = event.target.closest('[data-checklist-id]');
        if (!checkbox) return;
        var value = event.detail && typeof event.detail.value === 'boolean'
          ? event.detail.value
          : !!checkbox.checked;
        handleChecklistToggle(checkbox.getAttribute('data-checklist-id'), value);
      });

      modalContent.addEventListener('tab-change', function (event) {
        var tabs = event.target.closest('.my-task-activity-tabs');
        if (!tabs || !state.viewingTask) return;
        state.activityTabs[detailKey(state.viewingTask)] = event.detail && event.detail.tab ? event.detail.tab : 'comments';
        rerenderTaskDetails();
      });

      modalContent.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
          var mentionTextarea = event.target.closest('[data-task-input="comment"] textarea');
          if (mentionTextarea) hideTaskMentionPicker();
        }
        if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
        var textarea = event.target.closest('[data-task-input="comment"] textarea');
        if (!textarea) return;
        event.preventDefault();
        handleDetailAdd('comment');
      });

      modalContent.addEventListener('input', function (event) {
        if (!event.target.closest('[data-task-input="comment"]')) return;
        updateTaskCommentComposerState();
        updateTaskMentionPicker(false);
      });

      modalContent.addEventListener('lex-input', function (event) {
        if (!event.target.closest('[data-task-input="comment"]')) return;
        updateTaskCommentComposerState();
        updateTaskMentionPicker(false);
      });

      modalContent.addEventListener('input', function (event) {
        var documentSearch = event.target.closest('[data-task-input="document-name"]');
        if (!documentSearch) return;
        handleTaskDocumentSearch(documentSearch.value);
      });

      modalContent.addEventListener('focusin', function (event) {
        if (!event.target.closest('[data-task-input="document-name"]')) return;
        handleTaskDocumentSearch(event.target.value);
      });

      modalContent.addEventListener('change', function (event) {
        var fileInput = event.target.closest('[data-task-document-file]');
        if (!fileInput) return;
        handleTaskDocumentUpload(fileInput.files);
        fileInput.value = '';
      });
    }

    // Header "Actions" dropdown (Edit / Mark Complete / Delete). The toggle
    // and menu live in the modal header, outside #myTaskDetailsContent.
    var detailsModal = el('myTaskDetailsModal');
    if (detailsModal) {
      detailsModal.addEventListener('click', function (event) {
        if (event.target.closest('[data-task-actions-toggle]')) {
          event.stopPropagation();
          toggleTaskActionsMenu();
          return;
        }
        var menuItem = event.target.closest('.my-task-actions-menu [data-task-action]');
        if (menuItem) {
          event.stopPropagation();
          closeTaskActionsMenu();
          handleTaskAction(menuItem.getAttribute('data-task-action'));
        }
      });
    }
    // Dismiss the actions menu on any outside click.
    document.addEventListener('click', function (event) {
      if (!event.target.closest('.my-task-header-actions')) closeTaskActionsMenu();
    });

    var newBtn = el('myTasksNewBtn');
    var newMenu = el('myTasksNewMenu');
    if (newBtn) {
      newBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        toggleNewMenu();
      });
    }
    if (newMenu) {
      newMenu.addEventListener('click', function (event) {
        var item = event.target.closest('[data-new-action]');
        if (!item) return;
        event.stopPropagation();
        handleNewMenuClick(item.getAttribute('data-new-action'));
      });
    }
    document.addEventListener('click', function (event) {
      if (!state.newMenuOpen) return;
      var wrapper = event.target.closest('.my-tasks-new-wrapper');
      if (!wrapper) hideNewMenu();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') hideNewMenu();
      if (event.key && event.key.toLowerCase() === 'm' && state.viewingTask) {
        var tag = event.target && event.target.tagName ? event.target.tagName.toLowerCase() : '';
        var editable = event.target && event.target.isContentEditable;
        if (tag !== 'input' && tag !== 'textarea' && tag !== 'select' && !editable) {
          event.preventDefault();
          focusTaskCommentComposer();
        }
      }
    });

    // --- Create Task modal ----
    var createForm = el('myTaskCreateForm');
    var cancelBtn = el('myTaskCancelBtn');
    var matterPickBtn = el('myTaskMatterPickBtn');
    var userPickBtn = el('myTaskUserPickBtn');

    if (createForm) {
      createForm.addEventListener('submit', submitNewTask);
      createForm.addEventListener('lex-submit', submitNewTask);
    }
    if (cancelBtn) cancelBtn.addEventListener('click', closeNewTaskModal);
    if (matterPickBtn) matterPickBtn.addEventListener('click', openMatterPicker);
    if (userPickBtn) userPickBtn.addEventListener('click', openUserPicker);

    // The clear (×) button is a child of the matter picker-trigger button.
    // Catch it here BEFORE the click bubbles to the trigger and re-opens
    // the picker; stopPropagation is essential.
    var matterClearBtn = el('myTaskMatterClearBtn');
    if (matterClearBtn) {
      matterClearBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        event.preventDefault();
        setSelectedMatter(null, null);
      });
    }

    var targetType = el('myTaskTargetType');
    if (targetType) {
      targetType.addEventListener('change', syncTargetTypeVisibility);
      targetType.addEventListener('lex-change', syncTargetTypeVisibility);
    }

    // --- Create Task Plan modal ----
    var planForm = el('myTaskPlanCreateForm');
    var planCancelBtn = el('myTaskPlanCancelBtn');
    var planMatterPickBtn = el('myTaskPlanMatterPickBtn');
    if (planForm) {
      planForm.addEventListener('submit', submitNewTaskPlan);
      planForm.addEventListener('lex-submit', submitNewTaskPlan);
    }
    if (planCancelBtn) planCancelBtn.addEventListener('click', closeNewTaskPlanModal);
    if (planMatterPickBtn) planMatterPickBtn.addEventListener('click', openPlanMatterPicker);
  }

  function init() {
    exposeTaskDetailsBridge();
    bindEvents();
    applyTaskPlanRoleGate();
    handleInitialAction();
    loadTasks().then(handleInitialTask);
  }

  init();
})();
