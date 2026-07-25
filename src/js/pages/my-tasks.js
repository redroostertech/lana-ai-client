(function () {
  'use strict';

  var state = {
    tasks: [],
    newMenuOpen: false,
    // Create/Edit Task modal selections
    editingTaskId: null,           // null when creating, set when editing
    viewingTask: null,             // currently open in the details modal
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
    var matterName = task.matter_name || '';
    var matterId = task.matter_id || '';
    if (matterName && matterId) return matterName + ' (' + matterId + ')';
    return matterName || matterId || 'Organization-level';
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
    return '<lex-badge label="Matter" color="blue"></lex-badge>';
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

  function openTaskDetails(task) {
    var modal = el('myTaskDetailsModal');
    var content = el('myTaskDetailsContent');
    if (!modal || !content || !task) return;

    // Cache the task being viewed so action handlers (edit/complete/delete)
    // can read its id without re-querying the row list.
    state.viewingTask = task;

    var checklist = taskChecklistItems(task);
    var planLabel = taskPlanLabel(task);

    modal.heading = task.title || 'Task Details';
    content.innerHTML = [
      '<div class="my-task-detail">',
      '  <div class="my-task-detail__badges">',
      '    ' + levelHtml(task),
      '    <lex-badge label="' + esc(statusLabel(task.status)) + '" color="' + esc(statusColor(task.status)) + '"></lex-badge>',
      '    <lex-badge label="' + esc(priorityLabel(task.priority || 'normal')) + '" color="' + esc(priorityColor(task.priority)) + '"></lex-badge>',
      '  </div>',
      '  <dl class="my-task-detail__meta">',
      '    <div class="my-task-detail__row"><dt>Status</dt><dd>' + statusSelectHtml(task) + '</dd></div>',
      '    <div class="my-task-detail__row"><dt>Priority</dt><dd>' + esc(priorityLabel(task.priority || 'normal')) + '</dd></div>',
      '    <div class="my-task-detail__row"><dt>' + (task.matter_id ? 'Matter' : 'Level') + '</dt><dd>' + matterLinkHtml(task) + '</dd></div>',
      task.created_by_name ? '    <div class="my-task-detail__row"><dt>Created By</dt><dd>' + esc(task.created_by_name) + '</dd></div>' : '',
      task.created_at ? '    <div class="my-task-detail__row"><dt>Created</dt><dd>' + esc(formatDateTime(task.created_at)) + '</dd></div>' : '',
      task.updated_at ? '    <div class="my-task-detail__row"><dt>Updated</dt><dd>' + esc(formatDateTime(task.updated_at)) + '</dd></div>' : '',
      task.due_date ? '    <div class="my-task-detail__row"><dt>Due</dt><dd>' + esc(formatDate(task.due_date)) + '</dd></div>' : '',
      planLabel ? '    <div class="my-task-detail__row"><dt>Task Group</dt><dd>' + esc(planLabel) + '</dd></div>' : '',
      '  </dl>',
      task.description ? '  <section class="my-task-detail__section"><h3>Description</h3><p>' + esc(task.description) + '</p></section>' : '',
      '  <section class="my-task-detail__section">',
      '    <h3>Checklist</h3>',
      checklist.length ? '    <ul class="my-task-detail__checklist">' + checklist.map(function (item) {
        var label = typeof item === 'string' ? item : (item.title || item.label || item.description || 'Checklist item');
        return '<li>' + esc(label) + '</li>';
      }).join('') + '</ul>' : '    <p class="my-task-detail__muted">No checklist items attached.</p>',
      '  </section>',
      '</div>'
    ].join('');

    renderHeaderActions(modal, task);
    modal.open = true;
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
      level: task.matter_id ? 'Matter' : 'Org',
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
      level: function (val, row) {
        var task = row && row._raw;
        if (!task || !task.matter_id) {
          return '<lex-badge label="Org" color="green"></lex-badge>';
        }
        return [
          '<button type="button" class="my-task-level-link" data-matter-id="' + esc(task.matter_id) + '" title="' + esc(taskMatterLabel(task)) + '">',
          'Matter',
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
  // Reuses the NewProjectModal "Start New Chat" picker as a generic matter
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
    if (typeof NewProjectModal === 'undefined' || !NewProjectModal.open) {
      Lex.Toast.error('Matter picker is unavailable on this page.');
      return;
    }
    NewProjectModal.open({
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
    if (typeof NewProjectModal === 'undefined' || !NewProjectModal.open) {
      Lex.Toast.error('Matter picker is unavailable on this page.');
      return;
    }
    NewProjectModal.open({
      heading: 'Pick a matter for this plan',
      footerHint: 'Optional — leave unselected to scope the plan to your workspace.',
      hideCreateBtn: true,
      onSelect: function (matterId, matterName) {
        setPlanSelectedMatter(matterId, matterName);
      }
    });
  }

  // --- User picker (Create Task modal, target_type='user') ----------------
  // Opens UserPickerModal — a sibling of NewProjectModal that shows the
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
      if (dueDate) dueDate.value = task.due_date ? task.due_date.substring(0, 10) : '';
      if (targetType) targetType.value = task.target_type || 'unassigned';
      // Pre-fill matter selection from task.matter_id / matter name.
      setSelectedMatter(task.matter_id || null, task.matter_name || task.matter_id || null);
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
      due_date: dueDateInput && dueDateInput.value ? new Date(dueDateInput.value + 'T12:00:00').toISOString() : null,
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

      // Level-column "Matter" button lives inside the row, so lex-table's
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
    bindEvents();
    applyTaskPlanRoleGate();
    handleInitialAction();
    loadTasks().then(handleInitialTask);
  }

  init();
})();
