(function () {
  'use strict';

  var state = {
    tasks: [],
    loading: false,
    statusFilter: 'open',
    priorityFilter: '',
    search: '',
    searchTimer: null,
    page: 1,
    limit: 20,
    total: 0,
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

  function normalizeTasks(response) {
    if (!response) return [];
    if (response.data) return normalizeTasks(response.data);
    if (Array.isArray(response)) return response;
    if (Array.isArray(response.tasks)) return response.tasks;
    if (Array.isArray(response.items)) return response.items;
    return [];
  }

  function normalizeTaskResult(response) {
    if (!response) return { tasks: [], hasMore: false, total: 0 };
    if (response.data) return normalizeTaskResult(response.data);
    var pagination = response.pagination || {};
    return {
      tasks: normalizeTasks(response),
      hasMore: !!response.hasMore,
      total: response.total || pagination.total || 0,
      pagination: pagination
    };
  }

  function statusLabel(status) {
    if (status === 'in_progress') return 'In Progress';
    if (status === 'in_review') return 'In Review';
    if (status === 'complete' || status === 'completed') return 'Complete';
    return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Pending';
  }

  function statusColor(status) {
    if (status === 'complete' || status === 'completed') return 'green';
    if (status === 'in_review') return 'yellow';
    if (status === 'cancelled') return 'red';
    return 'gray';
  }

  function priorityColor(priority) {
    if (priority === 'high') return 'red';
    if (priority === 'medium' || priority === 'normal') return 'yellow';
    return 'gray';
  }

  function statusQuery() {
    if (state.statusFilter === 'complete') return 'complete,completed';
    if (state.statusFilter === 'open') return 'pending,in_progress,in_review';
    return '';
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

  function levelHtml(task) {
    if (!task.matter_id) {
      return '<lex-badge label="Org" color="green"></lex-badge>';
    }
    return [
      '<button type="button" class="my-task-level-link" data-matter-id="' + esc(task.matter_id) + '" title="' + esc(taskMatterLabel(task)) + '">',
      'Matter',
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
    var isComplete = String(task.status || '').toLowerCase() === 'complete';
    var completeLabel = isComplete ? 'Reopen' : 'Mark Complete';
    var completeAction = isComplete ? 'reopen' : 'complete';

    var actionButtons = [
      '<lex-btn variant="primary" size="sm" data-task-action="edit">Edit</lex-btn>',
      '<lex-btn variant="secondary" size="sm" data-task-action="' + completeAction + '">' + completeLabel + '</lex-btn>',
      task.matter_id
        ? '<lex-btn variant="secondary" size="sm" data-matter-id="' + esc(task.matter_id) + '">Open Matter</lex-btn>'
        : '',
      '<lex-btn variant="danger" size="sm" data-task-action="delete">Delete</lex-btn>'
    ].filter(Boolean).join(' ');

    modal.heading = task.title || 'Task Details';
    content.innerHTML = [
      '<div class="my-task-detail">',
      '  <div class="my-task-detail__badges">',
      '    ' + levelHtml(task),
      '    <lex-badge label="' + esc(statusLabel(task.status)) + '" color="' + esc(statusColor(task.status)) + '"></lex-badge>',
      '    <lex-badge label="' + esc(task.priority || 'normal') + '" color="' + esc(priorityColor(task.priority)) + '"></lex-badge>',
      '  </div>',
      '  <dl class="my-task-detail__meta">',
      '    <div><dt>Level</dt><dd>' + esc(task.matter_id ? taskMatterLabel(task) : 'Organization-level') + '</dd></div>',
      task.created_by_name ? '    <div><dt>Created By</dt><dd>' + esc(task.created_by_name) + '</dd></div>' : '',
      task.due_date ? '    <div><dt>Due</dt><dd>' + esc(formatDate(task.due_date)) + '</dd></div>' : '',
      planLabel ? '    <div><dt>Task Group</dt><dd>' + esc(planLabel) + '</dd></div>' : '',
      '  </dl>',
      task.description ? '  <section class="my-task-detail__section"><h3>Description</h3><p>' + esc(task.description) + '</p></section>' : '',
      '  <section class="my-task-detail__section">',
      '    <h3>Checklist</h3>',
      checklist.length ? '    <ul class="my-task-detail__checklist">' + checklist.map(function (item) {
        var label = typeof item === 'string' ? item : (item.title || item.label || item.description || 'Checklist item');
        return '<li>' + esc(label) + '</li>';
      }).join('') + '</ul>' : '    <p class="my-task-detail__muted">No checklist items attached.</p>',
      '  </section>',
      '  <div class="my-task-detail__actions">' + actionButtons + '</div>',
      '</div>'
    ].join('');
    modal.open = true;
  }

  function closeTaskDetails() {
    var modal = el('myTaskDetailsModal');
    if (modal) modal.open = false;
    state.viewingTask = null;
  }

  function updatePagination() {
    var pagination = el('myTasksPagination');
    if (!pagination) return;
    var totalPages = Math.max(1, Math.ceil(state.total / state.limit));
    pagination.setAttribute('page', String(state.page));
    pagination.setAttribute('total-pages', String(totalPages));
    pagination.setAttribute('total', String(state.total));
    pagination.setAttribute('limit', String(state.limit));
  }

  function renderList() {
    var list = el('myTasksList');
    var count = el('myTasksCount');
    if (!list) return;

    if (state.loading) {
      list.innerHTML = '<lex-spinner label="Loading tasks"></lex-spinner>';
      if (count) count.textContent = 'Loading tasks...';
      updatePagination();
      return;
    }

    if (count) {
      count.textContent = state.total + ' task' + (state.total === 1 ? '' : 's') + ' found';
    }
    updatePagination();

    if (!state.tasks.length) {
      list.innerHTML = '<lex-empty icon="tasks" message="No tasks assigned to you" description="Assigned tasks will appear here."></lex-empty>';
      return;
    }

    var rowsHtml = state.tasks.map(function (task) {
      return [
        '<tr data-task-id="' + esc(task.id) + '">',
        '  <td>',
        '    <div class="my-task-table__title">' + esc(task.title || 'Untitled task') + '</div>',
        '  </td>',
        '  <td>' + levelHtml(task) + '</td>',
        '  <td><lex-badge label="' + esc(statusLabel(task.status)) + '" color="' + esc(statusColor(task.status)) + '"></lex-badge></td>',
        '  <td><lex-badge label="' + esc(task.priority || 'normal') + '" color="' + esc(priorityColor(task.priority)) + '"></lex-badge></td>',
        '</tr>'
      ].join('');
    }).join('');

    list.innerHTML = [
      '<div class="my-tasks-table-wrap">',
      '  <table class="my-tasks-table">',
      '    <thead>',
      '      <tr>',
      '        <th scope="col">Task</th>',
      '        <th scope="col">Level</th>',
      '        <th scope="col">Status</th>',
      '        <th scope="col">Priority</th>',
      '      </tr>',
      '    </thead>',
      '    <tbody>',
      rowsHtml,
      '    </tbody>',
      '  </table>',
      '</div>'
    ].join('');
  }

  async function loadTasks() {
    state.loading = true;
    renderList();

    try {
      var baseFilters = {
        limit: state.limit,
        offset: (state.page - 1) * state.limit,
        sort_by: 'updated_at',
        sort_dir: 'DESC'
      };
      var statuses = statusQuery();
      if (statuses) baseFilters.statuses = statuses;
      if (state.priorityFilter) baseFilters.priorities = state.priorityFilter;
      if (state.search) baseFilters.search = state.search;

      var result = normalizeTaskResult(await api.getMyTasks(baseFilters));
      state.tasks = result.tasks;
      state.total = result.total;
    } catch (error) {
      Lex.Toast.error(error.message || 'Unable to load tasks');
      state.tasks = [];
      state.total = 0;
    } finally {
      state.loading = false;
      renderList();
    }
  }

  function resetAndLoad() {
    state.page = 1;
    loadTasks();
  }

  function queueSearch() {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(resetAndLoad, 250);
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
      resetAndLoad();
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
        resetAndLoad();
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
        resetAndLoad();
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
        resetAndLoad();
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

  function bindEvents() {
    var status = el('myTasksStatusFilter');
    var priority = el('myTasksPriorityFilter');
    var search = el('myTasksSearch');
    var pagination = el('myTasksPagination');

    if (status) {
      status.addEventListener('change', function () {
        state.statusFilter = status.value || 'open';
        resetAndLoad();
      });
      status.addEventListener('lex-change', function (event) {
        state.statusFilter = event.detail && event.detail.value ? event.detail.value : status.value || 'open';
        resetAndLoad();
      });
    }

    if (priority) {
      priority.addEventListener('lex-change', function (event) {
        state.priorityFilter = event.detail && event.detail.value ? event.detail.value : '';
        resetAndLoad();
      });
    }

    if (search) {
      search.addEventListener('input', function () {
        state.search = String(search.value || '').trim();
        queueSearch();
      });
    }

    if (pagination) {
      pagination.addEventListener('page-change', function (event) {
        state.page = event.detail && event.detail.page ? event.detail.page : 1;
        loadTasks();
      });
    }

    var list = el('myTasksList');
    if (list) {
      list.addEventListener('click', function (event) {
        var matterButton = event.target.closest('[data-matter-id]');
        if (matterButton) {
          Lex.Nav.go('workspace-details.html', {
            params: { id: matterButton.getAttribute('data-matter-id'), tab: 'tasks' }
          });
          return;
        }

        var row = event.target.closest('[data-task-id]');
        if (!row) return;
        var taskId = row.getAttribute('data-task-id');
        var task = state.tasks.find(function (item) { return item.id === taskId; });
        openTaskDetails(task);
      });
    }

    var modalContent = el('myTaskDetailsContent');
    if (modalContent) {
      modalContent.addEventListener('click', function (event) {
        // Action buttons (edit / complete / reopen / delete) take
        // precedence — they share the same DOM region as the "Open
        // Matter" button and we don't want the matter-id click leak
        // when clicking, e.g., "Edit" on a matter-scoped task.
        var actionButton = event.target.closest('[data-task-action]');
        if (actionButton) {
          event.stopPropagation();
          handleTaskAction(actionButton.getAttribute('data-task-action'));
          return;
        }
        var matterButton = event.target.closest('[data-matter-id]');
        if (!matterButton) return;
        Lex.Nav.go('workspace-details.html', {
          params: { id: matterButton.getAttribute('data-matter-id'), tab: 'tasks' }
        });
      });
    }

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
    loadTasks();
  }

  init();
})();
