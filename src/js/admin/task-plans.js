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
    loading: false
  };

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

  function formatDate(value) {
    return value ? Lex.Utils.formatDate(value) : '-';
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
    if (status === 'in_review') return 'In Review';
    return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Draft';
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

  function renderList() {
    var container = el('taskPlansList');
    if (!container) return;

    if (state.loading) {
      container.innerHTML = '<lex-spinner label="Loading task plans"></lex-spinner>';
      return;
    }

    if (!state.plans.length) {
      container.innerHTML =
        '<lex-empty icon="document" message="No task plans" description="Create a draft plan to get started."></lex-empty>';
      return;
    }

    container.innerHTML = state.plans.map(function (plan) {
      var id = getPlanId(plan);
      var status = getPlanStatus(plan);
      var selectedClass = id === state.selectedId ? ' is-selected' : '';
      var created = plan.updated_at || plan.created_at;
      return [
        '<button class="task-plan-row' + selectedClass + '" type="button" data-plan-id="' + esc(id) + '">',
        '  <span>',
        '    <span class="task-plan-row__title">' + esc(planTitle(plan)) + '</span>',
        '    <span class="task-plan-row__meta">Updated ' + esc(formatDate(created)) + '</span>',
        '  </span>',
        '  <lex-badge label="' + esc(statusLabel(status)) + '" color="' + esc(statusBadgeColor(status)) + '"></lex-badge>',
        '</button>'
      ].join('');
    }).join('');
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
      '    <div class="task-plan-detail__meta">Created ' + esc(formatDate(plan.created_at)) + ' &middot; Updated ' + esc(formatDate(plan.updated_at)) + '</div>',
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
    state.loading = true;
    state.unavailable = false;
    hide('taskPlansUnavailable');
    show(workspace);
    if (workspace) Lex.Redact.on(workspace);
    renderList();

    try {
      var response = await api.getTaskPlans({ limit: 50 });
      state.plans = normalizePlans(response);
      if (!state.selectedId && state.plans.length) {
        state.selectedId = getPlanId(state.plans[0]);
      }
      if (state.selectedId && state.plans.length) {
        var exists = state.plans.some(function (plan) { return getPlanId(plan) === state.selectedId; });
        if (!exists) state.selectedId = getPlanId(state.plans[0]);
      }
      renderList();
      renderDetail(selectedPlan());
    } catch (error) {
      setUnavailable(error);
    } finally {
      state.loading = false;
      if (workspace) Lex.Redact.off(workspace);
      if (!state.unavailable) renderList();
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
    renderDetail(selectedPlan());
  }

  async function selectPlan(planId) {
    state.selectedId = planId;
    renderList();
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
      renderList();
      renderDetail(detailed);
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
      // after create/update.
      if (state.selectedId) await selectPlan(state.selectedId);
    } catch (error) {
      Lex.Toast.error(error.message || (isLanaDraftMode() ? 'Unable to generate Lana draft' : 'Unable to create task plan'));
    } finally {
      if (saveBtn) saveBtn.loading = false;
    }
  }

  function openItemModal(index) {
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
    if (dueDate) dueDate.value = item.due_date ? String(item.due_date).slice(0, 10) : '';
    if (assignee) assignee.value = item.assigned_to_user_id || '';
    if (modal) modal.open = true;
  }

  function closeItemModal() {
    var modal = el('taskPlanItemModal');
    state.editingItemIndex = null;
    if (modal) modal.open = false;
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
      due_date: dueDate && dueDate.value ? new Date(dueDate.value + 'T12:00:00').toISOString() : null,
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

  async function deletePlan() {
    var plan = selectedPlan();
    var planId = getPlanId(plan);
    if (!planId) return;

    var confirmed = window.confirm('Delete this task plan? Draft plans will be archived; published plans remain in audit history.');
    if (!confirmed) return;

    var deleteBtn = el('deleteTaskPlanBtn');
    if (deleteBtn) deleteBtn.loading = true;

    try {
      await api.deleteTaskPlan(planId);
      Lex.Toast.success('Task plan deleted');
      state.plans = state.plans.filter(function (entry) { return getPlanId(entry) !== planId; });
      state.selectedId = state.plans.length ? getPlanId(state.plans[0]) : null;
      renderList();
      renderDetail(selectedPlan());
      if (state.selectedId) await selectPlan(state.selectedId);
    } catch (error) {
      Lex.Toast.error(error.message || 'Unable to delete task plan');
    } finally {
      if (deleteBtn) deleteBtn.loading = false;
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

  function bindEvents() {
    var createBtn = el('createTaskPlanBtn');
    var cancelBtn = el('taskPlanCancelBtn');
    var form = el('taskPlanForm');
    var itemForm = el('taskPlanItemForm');
    var itemCancelBtn = el('taskPlanItemCancelBtn');
    var type = el('taskPlanType');
    var targetType = el('taskPlanTargetType');
    var list = el('taskPlansList');
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
    if (type) {
      type.addEventListener('change', syncDraftMode);
      type.addEventListener('lex-change', syncDraftMode);
    }
    if (targetType) {
      targetType.addEventListener('change', syncTargetUserVisibility);
      targetType.addEventListener('lex-change', syncTargetUserVisibility);
    }
    if (matterPickBtn) matterPickBtn.addEventListener('click', openPlanMatterPicker);

    if (list) {
      list.addEventListener('click', function (event) {
        var row = event.target.closest('.task-plan-row');
        if (row && row.dataset.planId) selectPlan(row.dataset.planId);
      });
    }

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
    loadUsers();
    loadPlans();

    if (getUrlAction() === 'create') {
      openCreateModal();
    }
  }

  init();
})();
