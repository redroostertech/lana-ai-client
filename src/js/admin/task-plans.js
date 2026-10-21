/* Task Plans admin page controller.
   Thin client: backend owns authorization, workflow states, validation,
   draft assistance, and publish behavior.
*/

(function () {
  'use strict';

  var state = {
    plans: [],
    users: [],
    selectedId: null,
    matterId: null,
    matterName: null,
    editingPlanId: null,
    editingItemIndex: null,
    unavailable: false,
    loading: false,
    reopenDrawer: false,
    loadGen: 0
  };

  var TABLE_ID = 'taskPlansTable';

  // GET /api/v1/task-plans caps one request at 100 rows and pages by an
  // updated_at cursor (no total, no offset), so the page walks the cursor
  // until hasMore is false and gives the table the whole set (client mode).
  var PAGE_SIZE = 100;

  var PLAN_STATUSES = ['draft', 'published', 'archived'];

  var SOURCE_TYPE_LABELS = { manual: 'Manual', lana_draft: 'Lana draft' };

  var toolbar = null;

  function el(id) {
    return document.getElementById(id);
  }

  function show(target) {
    var elem = typeof target === 'string' ? el(target) : target;
    if (elem) elem.classList.remove('hidden');
  }

  function hide(target) {
    var elem = typeof target === 'string' ? el(target) : target;
    if (elem) elem.classList.add('hidden');
  }

  function esc(value) {
    return Lex.Utils.escapeHtml(value === null || value === undefined ? '' : String(value));
  }

  function normalizePlans(response) {
    if (!response) return [];
    if (response.data) return normalizePlans(response.data);
    if (Array.isArray(response)) return response;
    if (Array.isArray(response.task_plans)) return response.task_plans;
    if (Array.isArray(response.plans)) return response.plans;
    if (Array.isArray(response.items)) return response.items;
    if (response.task_plan) return [response.task_plan];
    if (response.plan) return [response.plan];
    return [];
  }

  function normalizePlan(response) {
    if (!response) return null;
    if (response.data) return normalizePlan(response.data);
    if (response.task_plan && response.tasks) return { ...response.task_plan, tasks: response.tasks };
    return response.task_plan || response.plan || response;
  }

  function normalizeUsers(response) {
    if (!response) return [];
    if (response.data) return normalizeUsers(response.data);
    if (Array.isArray(response)) return response;
    if (Array.isArray(response.users)) return response.users;
    if (Array.isArray(response.items)) return response.items;
    return [];
  }

  function getPlanId(plan) {
    return plan && (plan.id || plan.task_plan_id || plan.plan_id);
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

  function getPlanStatus(plan) {
    return String((plan && (plan.status || plan.state)) || 'draft').toLowerCase();
  }

  function statusBadgeColor(status) {
    if (status === 'published') return 'green';
    if (status === 'review' || status === 'in_review') return 'yellow';
    if (status === 'failed' || status === 'rejected') return 'red';
    return 'gray';
  }

  function statusLabel(status) {
    return status ? Lex.Utils.humanizeLabel(status) : 'Draft';
  }

  function planTitle(plan) {
    return plan.title || plan.name || 'Untitled plan';
  }

  function planItems(plan) {
    if (!plan) return [];
    if (Array.isArray(plan.items)) return plan.items;
    if (Array.isArray(plan.checklist_items)) return plan.checklist_items;
    return [];
  }

  function normalizeItem(item, index) {
    var matterId = item.matter_id || state.matterId || null;
    return {
      matter_id: matterId,
      title: item.title || item.name || item.task_title || item.item_text || '',
      description: item.description || '',
      status: item.status || 'pending',
      priority: item.priority || 'medium',
      assigned_to_user_id: item.assigned_to_user_id || null,
      due_date: item.due_date || null,
      checklist_items: Array.isArray(item.checklist_items) ? item.checklist_items : [],
      metadata: item.metadata || {},
      is_active: item.is_active !== false,
      sort_order: item.sort_order !== undefined ? item.sort_order : index
    };
  }

  function getUrlMatterId() {
    try {
      var params = new URLSearchParams(window.location.search || '');
      return params.get('matter_id') || params.get('matterId') || '';
    } catch (error) {
      return '';
    }
  }

  function getUrlAction() {
    try {
      var params = new URLSearchParams(window.location.search || '');
      return params.get('action') || '';
    } catch (error) {
      return '';
    }
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

  function matterLabel(matter) {
    return matter.matter_name || matter.name || matter.title || matter.matter_id || matter.id || 'Untitled matter';
  }

  function matterIdValue(matter) {
    return matter.matter_id || matter.id || '';
  }

  function userLabel(user) {
    if (!user) return '';
    var name = [user.first_name || user.firstName, user.last_name || user.lastName].filter(Boolean).join(' ');
    return name || user.name || user.email || user.username || user.id || 'User';
  }

  function userLabelById(userId) {
    if (!userId) return '';
    for (var i = 0; i < state.users.length; i++) {
      if (state.users[i].id === userId) return userLabel(state.users[i]);
    }
    return userId;
  }

  function userOptions(includeEmpty) {
    var options = state.users.map(function (user) {
      return { value: user.id, label: userLabel(user) };
    });
    return includeEmpty ? [{ value: '', label: 'Unassigned' }].concat(options) : options;
  }

  function setSelectOptions(select, options) {
    if (!select) return;
    select.options = options;
    select.setAttribute('options', JSON.stringify(options));
  }

  function syncUserSelectOptions() {
    setSelectOptions(el('taskPlanTargetUserId'), userOptions(false));
    setSelectOptions(el('taskPlanItemAssignee'), userOptions(true));
  }

  function planTarget(plan) {
    return plan && plan.metadata && plan.metadata.target ? plan.metadata.target : { type: 'unassigned', user_id: null };
  }

  function targetLabel(plan) {
    var target = planTarget(plan);
    if (target.type === 'organization') return 'Assigned to entire organization';
    if (target.type === 'user' && target.user_id) return 'Assigned to ' + userLabelById(target.user_id);
    return 'Unassigned / organization-level';
  }

  function setLexButtonText(button, label) {
    if (!button) return;
    button._originalChildren = [document.createTextNode(label)];
    var slot = button.querySelector('slot-content');
    if (slot) {
      slot.textContent = label;
    } else {
      button.textContent = label;
    }
  }

  // --- Matter picker (Create/Edit Task Plan modal) ----------------------
  // Reuses MatterPickerModal as a generic matter picker, giving the user the
  // same recent-matters + search experience as the shared matter picker instead
  // of a bare typeahead where they wouldn't know what to type.

  function setPlanMatterScope(matterId, matterName) {
    state.matterId = matterId || null;
    state.matterName = matterName || null;
    var hidden = el('taskPlanMatterId');
    if (hidden) hidden.value = matterId || '';
    var label = el('taskPlanMatterPickLabel');
    if (label) {
      if (matterId) {
        label.textContent = matterName ? (matterName + '  ·  ' + matterId) : matterId;
        label.classList.remove('is-placeholder');
      } else {
        label.textContent = 'None — applies to your organization';
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
      footerHint: 'Optional — leave unselected for organization-level work.',
      hideCreateBtn: true,
      onSelect: function (matterId, matterName) {
        setPlanMatterScope(matterId, matterName);
      }
    });
  }

  function setUnavailable(error) {
    state.unavailable = true;
    hide('taskPlansWorkspace');
    show('taskPlansUnavailable');
    if (error && error.status && error.status !== 404) {
      Lex.Toast.error(error.message || 'Unable to load task plans');
    }
    console.warn('[TaskPlans] Service unavailable:', error && error.message);
  }

  // --- Plans table (docs/TABLE-STANDARD.md) ------------------------------

  function kit() {
    return window.AdminTableKit;
  }

  function planMatterId(plan) {
    return (plan && (plan.matter_id || (plan.metadata && plan.metadata.source_matter_id))) || '';
  }

  // Assigned to: 'organization', 'unassigned' or the target user's id.
  function planAssignedValue(plan) {
    var target = planTarget(plan);
    if (target.type === 'organization') return 'organization';
    if (target.type === 'user' && target.user_id) return String(target.user_id);
    return 'unassigned';
  }

  function assignedLabel(value) {
    if (!value || value === 'unassigned') return 'Unassigned';
    if (value === 'organization') return 'Entire organization';
    return userLabelById(value);
  }

  function sourceTypeLabel(value) {
    if (!value) return '';
    return SOURCE_TYPE_LABELS[value] || Lex.Utils.humanizeLabel(value);
  }

  /** One table row per plan: raw values, the record as _raw. */
  function mapPlan(plan) {
    var itemCount = plan.item_count !== undefined && plan.item_count !== null
      ? Number(plan.item_count)
      : planItems(plan).length;
    return {
      id: String(getPlanId(plan) || ''),
      title: planTitle(plan),
      description: plan.description || '',
      status: getPlanStatus(plan),
      source_type: String(plan.source_type || ''),
      workspace: String(planMatterId(plan)),
      item_count: Number.isFinite(itemCount) ? itemCount : 0,
      assigned: planAssignedValue(plan),
      created_at: plan.created_at || '',
      updated_at: plan.updated_at || '',
      _raw: plan
    };
  }

  function cellRenderers() {
    var k = kit();
    return {
      title: function (val) { return k.nameCell(val); },
      status: function (val) { return k.badge(statusLabel(val), statusBadgeColor(val)); },
      source_type: function (val) {
        return val ? '<span class="admin-table-text">' + esc(sourceTypeLabel(val)) + '</span>' : k.muted('');
      },
      // The list API returns the scope's matter id only (no name).
      workspace: function (val) { return val ? k.matterLink(val, val) : k.muted(''); },
      item_count: function (val) { return '<span class="admin-table-text">' + esc(Number(val) || 0) + '</span>'; },
      assigned: function (val) {
        return '<span class="admin-table-text" title="' + esc(assignedLabel(val)) + '">' + esc(assignedLabel(val)) + '</span>';
      },
      created_at: function (val) { return k.timeCell(val); },
      updated_at: function (val) { return k.relativeCell(val); }
    };
  }

  var ITEM_COUNT_RANGES = [
    { value: '0', label: 'No items', min: 0, max: 1 },
    { value: '1-5', label: '1 to 5', min: 1, max: 6 },
    { value: '6-20', label: '6 to 20', min: 6, max: 21 },
    { value: '21+', label: 'More than 20', min: 21, max: Infinity }
  ];

  function inCountRange(cell, value) {
    var range = ITEM_COUNT_RANGES.filter(function (r) { return r.value === value; })[0];
    var n = Number(cell);
    if (!range || !Number.isFinite(n)) return false;
    return n >= range.min && n < range.max;
  }

  function dateRange() {
    var shared = window.LanaLibraryColumnFilters;
    return {
      single: true,
      options: kit().dateRangeFilter().options,
      match: function (cell, values) { return shared ? shared.inEditedRange(cell, values[0]) : true; }
    };
  }

  function uniqueValues(rows, key) {
    var seen = [];
    (rows || []).forEach(function (row) {
      var value = row[key];
      if (value !== '' && value !== null && value !== undefined && seen.indexOf(value) === -1) seen.push(value);
    });
    return seen;
  }

  /** Header filters for every column. */
  function filterOptions(rows) {
    var statuses = PLAN_STATUSES.slice();
    uniqueValues(rows, 'status').forEach(function (s) { if (statuses.indexOf(s) === -1) statuses.push(s); });
    var types = ['manual', 'lana_draft'];
    uniqueValues(rows, 'source_type').forEach(function (t) { if (types.indexOf(t) === -1) types.push(t); });
    var assigned = ['unassigned', 'organization'];
    uniqueValues(rows, 'assigned').forEach(function (a) { if (assigned.indexOf(a) === -1) assigned.push(a); });
    var map = {
      title: { text: true, placeholder: 'Plan name contains...' },
      status: { options: kit().labelOptions(statuses) },
      source_type: { options: types.map(function (t) { return { value: t, label: sourceTypeLabel(t) }; }) },
      item_count: {
        single: true,
        options: ITEM_COUNT_RANGES.map(function (r) { return { value: r.value, label: r.label }; }),
        match: function (cell, values) { return inCountRange(cell, values[0]); }
      },
      assigned: { options: assigned.map(function (a) { return { value: a, label: assignedLabel(a) }; }) },
      created_at: dateRange(),
      updated_at: dateRange()
    };
    var workspaces = uniqueValues(rows, 'workspace');
    if (workspaces.length) map.workspace = { options: workspaces.map(function (w) { return { value: w, label: w }; }) };
    return map;
  }

  function table() {
    return el(TABLE_ID);
  }

  function updateCount() {
    var t = table();
    if (!t || !toolbar) return;
    if (Array.isArray(t.filteredRows)) toolbar.setCount(t.filteredRows.length);
    else toolbar.refreshCount();
  }

  function renderList() {
    var t = table();
    if (!t || typeof t.setData !== 'function') return;
    var rows = state.plans.map(mapPlan);
    t.setColumnFilterOptions(filterOptions(rows));
    t.setData(rows);
    updateCount();
  }

  function initTable() {
    var t = table();
    if (!t) return Promise.resolve();
    return kit().whenTableReady().then(function () {
      if (table() !== t) return;
      t.setCellRenderers(cellRenderers());
      t.setColumnFilterOptions(filterOptions([]));
      toolbar = kit().bindToolbar({
        table: t,
        searchId: 'taskPlansSearch',
        sortId: 'taskPlansSort',
        orderId: 'taskPlansSortOrder',
        filterId: 'taskPlansStatusFilter',
        filterKey: 'status',
        countIds: ['taskPlansCount', 'taskPlansSectionCount'],
        noun: ['plan', 'plans']
      });
      ['lex-data-loaded', 'lex-filter-change'].forEach(function (name) {
        t.addEventListener(name, function (e) { if (e.target === t) updateCount(); });
      });
      t.addEventListener('lex-filter-change', function (e) {
        if (e.target !== t) return;
        var filters = (e.detail && e.detail.filters) || {};
        t.emptyText = kit().emptyText(Object.keys(filters).length > 0 || Boolean(t.searchText), 'task plans');
      });
      t.addEventListener('row-click', function (e) {
        var row = e.detail && e.detail.row;
        if (row && row.id) openPlan(row.id);
      });
      t.addEventListener('empty-action', openCreateModal);
    });
  }

  /** Every plan, walking the list API's updated_at cursor. */
  async function fetchAllPlans() {
    var plans = [];
    var seen = {};
    var cursor = null;
    for (;;) {
      var params = { limit: PAGE_SIZE };
      if (cursor) params.cursor = cursor;
      var response = await api.getTaskPlans(params);
      var page = normalizePlans(response);
      page.forEach(function (plan) {
        var id = getPlanId(plan);
        if (id && !seen[id]) {
          seen[id] = true;
          plans.push(plan);
        }
      });
      var data = response && response.data ? response.data : response;
      var hasMore = data && data.hasMore !== undefined ? Boolean(data.hasMore) : page.length === PAGE_SIZE;
      var last = page.length ? page[page.length - 1].updated_at : null;
      // Stop when the server says so or the cursor would not move.
      if (!hasMore || !last || last === cursor) break;
      cursor = new Date(last).toISOString();
    }
    return plans;
  }

  function drawer() {
    return el('taskPlanDrawer');
  }

  function openPlan(planId) {
    var d = drawer();
    selectPlan(planId);
    if (d) d.open = true;
  }

  // A lex-modal opened from the drawer: close the drawer while it is up (the
  // drawer's focus trap would hold Tab), reopen it when the modal closes.
  function suspendDrawer() {
    var d = drawer();
    if (d && d.open) {
      state.reopenDrawer = true;
      d.open = false;
    }
  }

  function resumeDrawer() {
    var d = drawer();
    if (!state.reopenDrawer) return;
    state.reopenDrawer = false;
    if (d && selectedPlan()) {
      renderDetail(selectedPlan());
      d.open = true;
    }
  }

  function renderDetail(plan) {
    var container = el('taskPlanDetail');
    if (!container) return;

    if (!plan) {
      container.innerHTML =
        '<lex-empty icon="document" message="No plan selected" description="Choose a task plan from the list."></lex-empty>';
      return;
    }

    var status = getPlanStatus(plan);
    var items = planItems(plan);
    var description = plan.description || plan.summary || 'No description provided.';
    var published = status === 'published';
    var canPublish = !published;
    var targetMeta = targetLabel(plan);

    var draftItemsHtml = items.length ? items.map(function (item, index) {
      var title = item.title || item.name || item.task_title || item.item_text || item.description || ('Item ' + (index + 1));
      var meta = [
        item.matter_id,
        item.priority,
        item.due_date,
        item.assignee_name || item.assignee || userLabelById(item.assigned_to_user_id)
      ].filter(Boolean).join(' · ');
      return [
        '<div class="task-plan-item">',
        '  <div class="task-plan-item__body">',
        '    <div class="task-plan-item__title">' + esc(index + 1) + '. ' + esc(title) + '</div>',
        meta ? '    <div class="task-plan-item__meta">' + esc(meta) + '</div>' : '',
        item.description ? '    <div class="task-plan-item__meta">' + esc(item.description) + '</div>' : '',
        '  </div>',
        !published ? [
          '  <div class="task-plan-item__actions">',
          '    <button class="task-plan-icon-btn" type="button" data-edit-item="' + esc(index) + '">Edit</button>',
          '    <button class="task-plan-icon-btn task-plan-icon-btn--danger" type="button" data-remove-item="' + esc(index) + '">Remove</button>',
          '  </div>'
        ].join('') : '',
        '</div>'
      ].join('');
    }).join('') :
      '<lex-empty icon="document" message="No draft items yet" description="Add an item or generate a Lana draft."></lex-empty>';

    container.innerHTML = [
      '<div class="task-plan-detail__header">',
      '  <div>',
      '    <h2 class="task-plan-detail__title">' + esc(planTitle(plan)) + '</h2>',
      '    <div class="task-plan-detail__meta">Created ' + esc(plan.created_at ? Lex.Utils.formatDateTime(plan.created_at) : '-') + ' &middot; Updated ' + esc(plan.updated_at ? Lex.Utils.timeAgo(plan.updated_at) : '-') + '</div>',
      '    <div class="task-plan-detail__meta">' + esc(targetMeta) + '</div>',
      '  </div>',
      '  <lex-badge label="' + esc(statusLabel(status)) + '" color="' + esc(statusBadgeColor(status)) + '"></lex-badge>',
      '</div>',
      '<p class="task-plan-detail__description">' + esc(description) + '</p>',
      published ? '<p class="task-plan-detail__hint">Published plans are read-only. Assignees were notified when this plan was published.</p>' : '<p class="task-plan-detail__hint">Assignees are notified now and again when the plan is published.</p>',
      '<div class="task-plan-items">' + draftItemsHtml + '</div>',
      '<div class="task-plan-detail__actions">',
      !published ? '<lex-btn id="editTaskPlanBtn" variant="secondary" leading-icon="pencil">Edit Plan</lex-btn>' : '',
      !published ? '<lex-btn id="addTaskPlanItemBtn" variant="secondary" leading-icon="plus">Add Item</lex-btn>' : '',
      canPublish ? '<lex-btn id="publishTaskPlanBtn" variant="success" leading-icon="send">Publish</lex-btn>' : '',
      '<lex-btn id="deleteTaskPlanBtn" variant="danger" leading-icon="trash">Delete Plan</lex-btn>',
      '</div>'
    ].join('');
  }

  function selectedPlan() {
    for (var i = 0; i < state.plans.length; i++) {
      if (getPlanId(state.plans[i]) === state.selectedId) return state.plans[i];
    }
    return null;
  }

  async function loadPlans() {
    var workspace = el('taskPlansWorkspace');
    var gen = ++state.loadGen;
    state.loading = true;
    state.unavailable = false;
    hide('taskPlansUnavailable');
    show(workspace);

    try {
      var plans = await fetchAllPlans();
      if (gen !== state.loadGen) return;
      state.plans = plans;
      if (state.selectedId && !selectedPlan()) {
        state.selectedId = null;
        var d = drawer();
        if (d) d.open = false;
      }
      renderList();
      if (state.selectedId) renderDetail(selectedPlan());
    } catch (error) {
      if (gen !== state.loadGen) return;
      setUnavailable(error);
    } finally {
      if (gen === state.loadGen) state.loading = false;
    }
  }

  async function loadUsers() {
    try {
      var response = await api.getUsers(1, 100, { status: 'active' });
      state.users = normalizeUsers(response).filter(function (user) {
        return user && user.id && user.is_active !== false;
      });
    } catch (error) {
      console.warn('[TaskPlans] Active users unavailable:', error && error.message);
      state.users = [];
    }
    syncUserSelectOptions();
    if (state.plans.length) renderList();
    if (state.selectedId) renderDetail(selectedPlan());
  }

  async function selectPlan(planId) {
    state.selectedId = planId;
    renderDetail(selectedPlan());

    try {
      var response = await api.getTaskPlan(planId);
      var detailed = normalizePlan(response);
      if (!detailed || typeof detailed !== 'object') return;
      for (var i = 0; i < state.plans.length; i++) {
        if (getPlanId(state.plans[i]) === planId) {
          state.plans[i] = detailed;
          break;
        }
      }
      if (state.selectedId === planId) renderDetail(detailed);
    } catch (error) {
      console.warn('[TaskPlans] Detail unavailable:', error && error.message);
    }
  }

  function openCreateModal() {
    var modal = el('taskPlanModal');
    var title = el('taskPlanTitle');
    var type = el('taskPlanType');
    var description = el('taskPlanDescription');
    var instructions = el('taskPlanInstructions');
    var targetType = el('taskPlanTargetType');
    var targetUser = el('taskPlanTargetUserId');
    state.editingPlanId = null;
    if (modal) {
      modal.heading = 'Create Task Plan';
      modal.setAttribute('heading', 'Create Task Plan');
    }
    if (title) title.value = '';
    if (type) type.value = 'manual';
    if (description) description.value = '';
    if (instructions) instructions.value = '';
    // Carry forward state.matterId (set from URL ?matter_id=... or prior
    // selection) so a plan started from a matter context pre-populates the
    // picker; otherwise default to "no matter".
    setPlanMatterScope(state.matterId || null, state.matterName || null);
    if (targetType) targetType.value = 'unassigned';
    if (targetUser) targetUser.value = '';
    syncTargetUserVisibility();
    syncDraftMode();
    if (modal) modal.open = true;
  }

  function openEditPlanModal() {
    var plan = selectedPlan();
    if (!plan || getPlanStatus(plan) === 'published') return;
    suspendDrawer();

    var modal = el('taskPlanModal');
    var title = el('taskPlanTitle');
    var type = el('taskPlanType');
    var description = el('taskPlanDescription');
    var instructions = el('taskPlanInstructions');
    var targetType = el('taskPlanTargetType');
    var targetUser = el('taskPlanTargetUserId');
    var target = planTarget(plan);

    state.editingPlanId = getPlanId(plan);
    if (modal) {
      modal.heading = 'Edit Task Plan';
      modal.setAttribute('heading', 'Edit Task Plan');
    }
    if (title) title.value = plan.title || '';
    if (type) type.value = plan.source_type || plan.metadata?.plan_type || 'manual';
    if (description) description.value = plan.description || '';
    if (instructions) instructions.value = plan.metadata?.draft_instructions || '';
    var planMatterId = plan.matter_id || plan.metadata?.source_matter_id || state.matterId || null;
    setPlanMatterScope(
      planMatterId,
      planMatterId === state.matterId ? state.matterName : null
    );
    if (targetType) targetType.value = target.type || 'unassigned';
    if (targetUser) targetUser.value = target.user_id || '';
    syncTargetUserVisibility();
    syncDraftMode();
    if (modal) modal.open = true;
  }

  function closeCreateModal() {
    var modal = el('taskPlanModal');
    state.editingPlanId = null;
    if (modal) modal.open = false;
    resumeDrawer();
  }

  function isLanaDraftMode() {
    var type = el('taskPlanType');
    return type && type.value === 'lana_draft';
  }

  function syncDraftMode() {
    var saveBtn = el('taskPlanSaveBtn');
    var instructions = el('taskPlanInstructions');
    setLexButtonText(saveBtn, state.editingPlanId ? 'Save Plan' : (isLanaDraftMode() ? 'Generate Draft' : 'Create Draft'));
    if (instructions) {
      instructions.label = isLanaDraftMode() ? 'Draft Instructions' : 'Draft Notes';
      instructions.placeholder = isLanaDraftMode()
        ? 'Describe the desired outcomes, constraints, cadence, and any checklist sections Lana should draft'
        : 'Optional notes for the backend draft/review workflow';
    }
  }

  function syncTargetUserVisibility() {
    var targetType = el('taskPlanTargetType');
    var targetUser = el('taskPlanTargetUserId');
    if (!targetUser) return;

    if (targetType && targetType.value === 'user') {
      show(targetUser);
    } else {
      targetUser.value = '';
      hide(targetUser);
    }
  }

  function readFormPayload() {
    var title = el('taskPlanTitle');
    var type = el('taskPlanType');
    var description = el('taskPlanDescription');
    var instructions = el('taskPlanInstructions');
    var matterId = el('taskPlanMatterId');
    var targetType = el('taskPlanTargetType');
    var targetUser = el('taskPlanTargetUserId');
    var planType = type && type.value ? type.value : 'manual';
    var draftInstructions = instructions ? instructions.value : '';
    var scopedMatterId = matterId && matterId.value ? String(matterId.value).trim() : null;
    var targetTypeValue = targetType && targetType.value ? targetType.value : 'unassigned';
    var targetUserId = targetUser && targetUser.value ? targetUser.value : null;
    return {
      title: title ? title.value : '',
      plan_type: planType,
      source_type: planType,
      description: description ? description.value : '',
      matter_id: scopedMatterId,
      target_type: targetTypeValue,
      target_user_id: targetUserId,
      draft_instructions: draftInstructions,
      metadata: {
        draft_instructions: draftInstructions,
        source_matter_id: scopedMatterId,
        target: {
          type: targetTypeValue,
          user_id: targetUserId
        }
      }
    };
  }

  async function createPlan(event) {
    if (event) event.preventDefault();
    if (event && event.detail && event.detail.valid === false) {
      Lex.Toast.error('Please fix the highlighted fields');
      return;
    }
    var saveBtn = el('taskPlanSaveBtn');
    var payload = readFormPayload();
    var editingPlanId = state.editingPlanId;
    if (saveBtn) saveBtn.loading = true;

    try {
      var response = editingPlanId
        ? await api.updateTaskPlan(editingPlanId, payload)
        : (isLanaDraftMode()
          ? await api.generateTaskPlanDraft(payload)
          : await api.createTaskPlan(payload));
      var plan = normalizePlan(response);
      if (plan && typeof plan === 'object') {
        state.selectedId = getPlanId(plan);
      }
      closeCreateModal();
      Lex.Toast.success(editingPlanId ? 'Task plan updated' : (isLanaDraftMode() ? 'Lana draft generated' : 'Task plan draft created'));
      await loadPlans();
      // loadPlans() refreshes the list rows which omit per-plan items.
      // Re-fetch the selected plan's detail so items render immediately
      // after create/update, and show it in the drawer.
      if (state.selectedId) {
        state.reopenDrawer = true;
        await selectPlan(state.selectedId);
        resumeDrawer();
      }
    } catch (error) {
      Lex.Toast.error(error.message || (isLanaDraftMode() ? 'Unable to generate Lana draft' : 'Unable to create task plan'));
    } finally {
      if (saveBtn) saveBtn.loading = false;
    }
  }

  function openItemModal(index) {
    suspendDrawer();
    var plan = selectedPlan();
    var items = planItems(plan).map(normalizeItem);
    var item = index !== null && index !== undefined ? items[index] : {};
    state.editingItemIndex = index !== undefined ? index : null;

    var modal = el('taskPlanItemModal');
    var heading = el('taskPlanItemHeading');
    var matterId = el('taskPlanItemMatterId');
    var title = el('taskPlanItemTitle');
    var description = el('taskPlanItemDescription');
    var priority = el('taskPlanItemPriority');
    var dueDate = el('taskPlanItemDueDate');
    var assignee = el('taskPlanItemAssignee');

    if (heading) heading.textContent = state.editingItemIndex === null ? 'Add Plan Item' : 'Edit Plan Item';
    if (matterId) matterId.value = item.matter_id || state.matterId || '';
    if (title) title.value = item.title || '';
    if (description) description.value = item.description || '';
    if (priority) priority.value = item.priority || 'medium';
    // Show the LOCAL calendar day of the stored instant; slicing the UTC
    // string shifts evening-local due dates to the next day.
    if (dueDate) dueDate.value = item.due_date ? LanaTime.toLocalDateInputValue(item.due_date) : '';
    if (assignee) assignee.value = item.assigned_to_user_id || '';
    if (modal) modal.open = true;
  }

  function closeItemModal() {
    var modal = el('taskPlanItemModal');
    state.editingItemIndex = null;
    if (modal) modal.open = false;
    resumeDrawer();
  }

  function readItemPayload() {
    var dueDate = el('taskPlanItemDueDate');
    var matterInput = el('taskPlanItemMatterId');
    var assignee = el('taskPlanItemAssignee');
    var matterId = matterInput && matterInput.value ? String(matterInput.value).trim() : null;
    return {
      matter_id: matterId,
      title: el('taskPlanItemTitle') ? el('taskPlanItemTitle').value : '',
      description: el('taskPlanItemDescription') ? el('taskPlanItemDescription').value : '',
      priority: el('taskPlanItemPriority') ? el('taskPlanItemPriority').value : 'medium',
      status: 'pending',
      assigned_to_user_id: assignee && assignee.value ? assignee.value : null,
      due_date: dueDate && dueDate.value ? LanaTime.toIsoInstant(dueDate.value + 'T12:00:00') : null,
      checklist_items: [],
      metadata: { edited_in_admin: true },
      is_active: true
    };
  }

  async function saveItem(event) {
    if (event) event.preventDefault();
    if (event && event.detail && event.detail.valid === false) {
      Lex.Toast.error('Please fix the highlighted fields');
      return;
    }
    var plan = selectedPlan();
    var planId = getPlanId(plan);
    if (!planId) return;

    var item = readItemPayload();
    if (!item.title) {
      Lex.Toast.error('Title is required');
      return;
    }

    var items = planItems(plan).map(normalizeItem);
    if (state.editingItemIndex === null || state.editingItemIndex === undefined) {
      items.push(item);
    } else {
      items[state.editingItemIndex] = item;
    }
    items = items.map(function (entry, index) {
      return { ...entry, sort_order: index };
    });

    await updateSelectedPlanItems(planId, items);
    closeItemModal();
  }

  async function removeItem(index) {
    var plan = selectedPlan();
    var planId = getPlanId(plan);
    if (!planId) return;

    var items = planItems(plan).map(normalizeItem);
    items.splice(index, 1);
    items = items.map(function (entry, itemIndex) {
      return { ...entry, sort_order: itemIndex };
    });
    await updateSelectedPlanItems(planId, items);
  }

  async function updateSelectedPlanItems(planId, items) {
    var response = await api.updateTaskPlan(planId, { items: items });
    var updated = normalizePlan(response);
    for (var i = 0; i < state.plans.length; i++) {
      if (getPlanId(state.plans[i]) === planId) {
        state.plans[i] = updated;
        break;
      }
    }
    renderList();
    renderDetail(updated);
    Lex.Toast.success('Task plan items updated');
  }

  function deletePlan() {
    var plan = selectedPlan();
    var planId = getPlanId(plan);
    if (!planId) return;

    suspendDrawer();
    var modal = Lex.Modal.confirm(
      'Delete task plan',
      'Delete this task plan? Draft plans will be archived; published plans remain in audit history.',
      function () {
        state.reopenDrawer = false;
        confirmDeletePlan(planId);
      },
      { variant: 'danger', confirmText: 'Delete' }
    );
    if (modal && modal.addEventListener) {
      modal.addEventListener('lex-cancel', resumeDrawer);
      modal.addEventListener('lex-close', resumeDrawer);
    }
  }

  async function confirmDeletePlan(planId) {
    try {
      await api.deleteTaskPlan(planId);
      Lex.Toast.success('Task plan deleted');
      state.plans = state.plans.filter(function (entry) { return getPlanId(entry) !== planId; });
      state.selectedId = null;
      var d = drawer();
      if (d) d.open = false;
      renderList();
    } catch (error) {
      Lex.Toast.error(error.message || 'Unable to delete task plan');
    }
  }

  async function publishPlan() {
    var plan = selectedPlan();
    var planId = getPlanId(plan);
    var publishBtn = el('publishTaskPlanBtn');
    if (!planId) return;
    if (publishBtn) publishBtn.loading = true;

    try {
      var response = await api.publishTaskPlan(planId);
      var updated = normalizePlan(response);
      if (updated && typeof updated === 'object') {
        for (var i = 0; i < state.plans.length; i++) {
          if (getPlanId(state.plans[i]) === planId) {
            state.plans[i] = updated;
            break;
          }
        }
      }
      Lex.Toast.success('Task plan published');
      await loadPlans();
    } catch (error) {
      Lex.Toast.error(error.message || 'Unable to publish task plan');
    } finally {
      if (publishBtn) publishBtn.loading = false;
    }
  }

  /**
   * The modal's Save button lives in the lex-modal footer (footer-content),
   * outside lex-form, so lex-form's submit-button delegation never sees the
   * click. Re-emit lex-submit with the same detail lex-form produces so the
   * existing submit handler runs unchanged.
   */
  function _requestFormSubmit(form) {
    if (!form || typeof form.getValues !== 'function') return;
    var result = (form.novalidate || typeof form.validate !== 'function')
      ? { valid: true, errors: [] }
      : form.validate();
    form.dispatchEvent(new CustomEvent('lex-submit', {
      detail: { values: form.getValues(), valid: result.valid, errors: result.errors }
    }));
  }

  function bindEvents() {
    var createBtn = el('createTaskPlanBtn');
    var cancelBtn = el('taskPlanCancelBtn');
    var form = el('taskPlanForm');
    var itemForm = el('taskPlanItemForm');
    var itemCancelBtn = el('taskPlanItemCancelBtn');
    var type = el('taskPlanType');
    var targetType = el('taskPlanTargetType');
    var detail = el('taskPlanDetail');
    var matterPickBtn = el('taskPlanMatterPickBtn');

    if (createBtn) createBtn.addEventListener('click', openCreateModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeCreateModal);
    if (form) {
      form.addEventListener('submit', createPlan);
      form.addEventListener('lex-submit', createPlan);
    }
    if (itemForm) {
      itemForm.addEventListener('submit', saveItem);
      itemForm.addEventListener('lex-submit', saveItem);
    }
    if (itemCancelBtn) itemCancelBtn.addEventListener('click', closeItemModal);
    // Save buttons sit in the modal footers, outside their lex-forms.
    var saveBtn = el('taskPlanSaveBtn');
    var itemSaveBtn = el('taskPlanItemSaveBtn');
    if (saveBtn && form) saveBtn.addEventListener('click', function () { _requestFormSubmit(form); });
    if (itemSaveBtn && itemForm) itemSaveBtn.addEventListener('click', function () { _requestFormSubmit(itemForm); });
    if (type) {
      type.addEventListener('change', syncDraftMode);
      type.addEventListener('lex-change', syncDraftMode);
    }
    if (targetType) {
      targetType.addEventListener('change', syncTargetUserVisibility);
      targetType.addEventListener('lex-change', syncTargetUserVisibility);
    }
    if (matterPickBtn) matterPickBtn.addEventListener('click', openPlanMatterPicker);

    ['taskPlanModal', 'taskPlanItemModal'].forEach(function (id) {
      var modal = el(id);
      if (modal) {
        modal.addEventListener('lex-close', function (e) {
          if (e.target === modal) resumeDrawer();
        });
      }
    });

    if (detail) {
      detail.addEventListener('click', function (event) {
        var editBtn = event.target.closest('[data-edit-item]');
        var removeBtn = event.target.closest('[data-remove-item]');
        if (event.target.closest('#editTaskPlanBtn')) openEditPlanModal();
        if (event.target.closest('#addTaskPlanItemBtn')) openItemModal(null);
        if (editBtn) openItemModal(parseInt(editBtn.getAttribute('data-edit-item'), 10));
        if (removeBtn) removeItem(parseInt(removeBtn.getAttribute('data-remove-item'), 10));
        if (event.target.closest('#publishTaskPlanBtn')) publishPlan();
        if (event.target.closest('#deleteTaskPlanBtn')) deletePlan();
      });
    }

    syncDraftMode();
    syncTargetUserVisibility();
  }

  function init() {
    state.matterId = getUrlMatterId() || null;
    var canOpenPage = Lex.Auth && (
      Lex.Auth.isAdmin() ||
      userHasRole('system_admin') ||
      userHasRole('org_admin') ||
      userHasRole('admin') ||
      userHasRole('upper_leader') ||
      userHasRole('senior_leader') ||
      userHasRole('senior_user')
    );
    if (!canOpenPage) {
      Lex.Nav.go('dashboard.html', { replace: true });
      return;
    }
    bindEvents();
    initTable().then(function () {
      loadUsers();
      loadPlans();
    });

    if (getUrlAction() === 'create') {
      openCreateModal();
    }
  }

  // Pure table logic, exposed for unit tests.
  window.TaskPlansTable = {
    mapPlan: mapPlan,
    cellRenderers: cellRenderers,
    filterOptions: filterOptions,
    fetchAllPlans: fetchAllPlans,
    inCountRange: inCountRange,
    assignedLabel: assignedLabel,
    statusLabel: statusLabel,
    sourceTypeLabel: sourceTypeLabel,
    _state: state
  };

  init();
})();
