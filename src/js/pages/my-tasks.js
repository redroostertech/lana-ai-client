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
    matterSearchTimer: null,
    selectedMatterId: null
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

    var checklist = taskChecklistItems(task);
    var planLabel = taskPlanLabel(task);
    var matterAction = task.matter_id
      ? '<lex-btn variant="secondary" size="sm" data-matter-id="' + esc(task.matter_id) + '">Open Matter</lex-btn>'
      : '';

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
      matterAction ? '  <div class="my-task-detail__actions">' + matterAction + '</div>' : '',
      '</div>'
    ].join('');
    modal.open = true;
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

  function renderMatterResults(matters) {
    var container = el('myTaskMatterResults');
    if (!container) return;
    if (!matters.length) {
      container.innerHTML = '<div class="my-task-matter-result is-empty">No matching matters</div>';
      container.classList.remove('hidden');
      return;
    }
    container.innerHTML = matters.map(function (matter) {
      var id = matter.matter_id || matter.id || '';
      var name = matter.matter_name || matter.name || matter.title || id || 'Untitled matter';
      return [
        '<button type="button" class="my-task-matter-result" data-matter-id="' + esc(id) + '" data-matter-name="' + esc(name) + '">',
        '  <span class="my-task-matter-result__name">' + esc(name) + '</span>',
        '  <span class="my-task-matter-result__id">' + esc(id) + '</span>',
        '</button>'
      ].join('');
    }).join('');
    container.classList.remove('hidden');
  }

  function hideMatterResults() {
    var container = el('myTaskMatterResults');
    if (container) container.classList.add('hidden');
  }

  function normalizeMatters(response) {
    if (!response) return [];
    if (response.data) return normalizeMatters(response.data);
    if (Array.isArray(response)) return response;
    if (Array.isArray(response.matters)) return response.matters;
    if (Array.isArray(response.items)) return response.items;
    if (Array.isArray(response.results)) return response.results;
    return [];
  }

  async function searchMatterScope() {
    var input = el('myTaskMatterId');
    var query = input ? String(input.value || '').trim() : '';
    if (query.length < 2) {
      hideMatterResults();
      return;
    }
    try {
      var response = await api.searchMatters(query, 1, 8);
      renderMatterResults(normalizeMatters(response));
    } catch (error) {
      hideMatterResults();
    }
  }

  function queueMatterSearch() {
    clearTimeout(state.matterSearchTimer);
    state.matterSearchTimer = setTimeout(searchMatterScope, 250);
  }

  function selectMatterScope(matterId, matterName) {
    var input = el('myTaskMatterId');
    state.selectedMatterId = matterId || null;
    if (input) input.value = matterName || matterId || '';
    hideMatterResults();
  }

  function openNewTaskModal() {
    var modal = el('myTaskCreateModal');
    var title = el('myTaskTitle');
    var priority = el('myTaskPriority');
    var matterInput = el('myTaskMatterId');
    var description = el('myTaskDescription');
    var dueDate = el('myTaskDueDate');

    state.selectedMatterId = null;
    if (title) title.value = '';
    if (priority) priority.value = 'medium';
    if (matterInput) matterInput.value = '';
    if (description) description.value = '';
    if (dueDate) dueDate.value = '';
    hideMatterResults();
    if (modal) modal.open = true;
  }

  function closeNewTaskModal() {
    var modal = el('myTaskCreateModal');
    if (modal) modal.open = false;
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
    var matterInput = el('myTaskMatterId');
    var descriptionInput = el('myTaskDescription');
    var dueDateInput = el('myTaskDueDate');

    var title = titleInput ? String(titleInput.value || '').trim() : '';
    // Only accept a matter that the user explicitly picked from the
    // search results — never fall back to the typed input text, since
    // that could send a matter NAME to a route that expects an ID.
    var matterId = state.selectedMatterId;

    if (!title) {
      Lex.Toast.error('Title is required');
      return;
    }
    if (!matterId) {
      Lex.Toast.error('Pick a matter from the search results before saving.');
      if (matterInput && typeof matterInput.focus === 'function') matterInput.focus();
      return;
    }

    var payload = {
      title: title,
      description: descriptionInput && descriptionInput.value ? String(descriptionInput.value).trim() : null,
      priority: priorityInput && priorityInput.value ? priorityInput.value : 'medium',
      due_date: dueDateInput && dueDateInput.value ? new Date(dueDateInput.value + 'T12:00:00').toISOString() : null,
      status: 'pending'
    };

    if (saveBtn) saveBtn.loading = true;
    try {
      await api.createTask(matterId, payload);
      Lex.Toast.success('Task created');
      closeNewTaskModal();
      resetAndLoad();
    } catch (error) {
      Lex.Toast.error(error.message || 'Unable to create task');
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
      Lex.Nav.go('admin/task-plans.html', { params: { action: 'create' } });
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

    var createForm = el('myTaskCreateForm');
    var cancelBtn = el('myTaskCancelBtn');
    var matterInput = el('myTaskMatterId');
    var matterResults = el('myTaskMatterResults');
    if (createForm) {
      createForm.addEventListener('submit', submitNewTask);
      createForm.addEventListener('lex-submit', submitNewTask);
    }
    if (cancelBtn) cancelBtn.addEventListener('click', closeNewTaskModal);
    if (matterInput) {
      matterInput.addEventListener('input', function () {
        state.selectedMatterId = null;
        queueMatterSearch();
      });
      matterInput.addEventListener('focus', queueMatterSearch);
      matterInput.addEventListener('blur', function () {
        setTimeout(hideMatterResults, 150);
      });
    }
    if (matterResults) {
      matterResults.addEventListener('click', function (event) {
        var result = event.target.closest('[data-matter-id]');
        if (!result) return;
        selectMatterScope(result.getAttribute('data-matter-id'), result.getAttribute('data-matter-name'));
      });
    }
  }

  function init() {
    bindEvents();
    applyTaskPlanRoleGate();
    loadTasks();
  }

  init();
})();
