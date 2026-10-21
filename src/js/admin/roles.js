/**
 * Roles & Permissions — Standalone page controller
 *
 * Handles role management and permission display for the admin panel.
 *
 * @requires api.js           - window.api — getRoles, getRole, createRole, updateRole,
 *                               deleteRole, getPermissions, getInheritedPermissions
 * @requires lex.utils.js     - Lex.Utils.escapeHtml
 * @requires lex.auth.js      - Lex.Auth.isAdmin
 * @requires lex-toast.js     - Lex.Toast.success, Lex.Toast.error
 * @requires lex-modal.js     - Lex.Modal.confirm
 */

(function () {
  'use strict';

  // =========================================================================
  // Module-level state (var to avoid re-declaration errors on SPA re-nav)
  // =========================================================================

  var _roles = [];
  var _permissions = [];
  var _editingRoleId = null; // null = create mode, string = edit mode

  // Generation counters per data stream to prevent race conditions
  // when loadRoles() and loadPermissions() run in parallel from init().
  var _rolesGen = 0;
  var _permsGen = 0;

  // =========================================================================
  // Entry point — called on every SPA navigation to this page
  // =========================================================================

  function init() {
    // Reset state for clean re-navigation
    _roles = [];
    _permissions = [];
    _editingRoleId = null;
    _rolesGen = 0;
    _permsGen = 0;
    _searchTerm = '';
    _filterCount = 0;

    _wireTabEvents();
    _wireModalEvents();
    _wireFormEvents();
    _wireCreateButton();

    // Show Create Role button only for admins
    var btnContainer = document.getElementById('createRoleBtnContainer');
    if (btnContainer) {
      if (Lex.Auth.isAdmin()) {
        btnContainer.classList.remove('hidden');
      } else {
        btnContainer.classList.add('hidden');
      }
    }

    // Kick off data loads in parallel
    loadRoles();
    loadPermissions();
  }

  // Generation counters are incremented by loadRoles/loadPermissions to
  // abandon stale renders — no explicit cleanup needed for standalone pages.

  // =========================================================================
  // Tab switching
  // =========================================================================

  function _wireTabEvents() {
    var tabs = document.getElementById('rolesTabs');
    if (!tabs) return;

    tabs.addEventListener('tab-change', function (e) {
      switchTab(e.detail.tab);
    });
  }

  function switchTab(tabId) {
    var panelRoles = document.getElementById('tabPanelRoles');
    var panelPerms = document.getElementById('tabPanelPermissions');
    if (!panelRoles || !panelPerms) return;

    if (tabId === 'roles') {
      panelRoles.classList.remove('hidden');
      panelPerms.classList.add('hidden');
    } else if (tabId === 'permissions') {
      panelPerms.classList.remove('hidden');
      panelRoles.classList.add('hidden');
    }
  }

  // =========================================================================
  // Load & render roles
  // =========================================================================

  // Roles per organization are a small set; GET /api/v1/rbac/roles defaults
  // to limit=50 and returns no total, so ask for the whole set and keep the
  // table client-side (docs/TABLE-STANDARD.md, section 4).
  var ROLES_FETCH_LIMIT = 500;

  var ROLE_STATUSES = ['active', 'inactive'];
  var STATUS_COLORS = { active: 'green', inactive: 'gray' };

  // Count ranges for the Permissions and Users columns (min inclusive, max exclusive).
  var PERMISSION_RANGES = [
    { value: '0-1', label: 'None', min: 0, max: 1 },
    { value: '1-10', label: '1 to 9', min: 1, max: 10 },
    { value: '10-25', label: '10 to 24', min: 10, max: 25 },
    { value: '25-', label: '25 or more', min: 25, max: Infinity }
  ];
  var USER_RANGES = [
    { value: '0-1', label: 'None', min: 0, max: 1 },
    { value: '1-5', label: '1 to 4', min: 1, max: 5 },
    { value: '5-20', label: '5 to 19', min: 5, max: 20 },
    { value: '20-', label: '20 or more', min: 20, max: Infinity }
  ];

  var _toolbar = null;
  var _searchTerm = '';
  var _filterCount = 0;

  function inRange(ranges, cell, value) {
    var range = null;
    for (var i = 0; i < ranges.length; i++) {
      if (ranges[i].value === value) range = ranges[i];
    }
    if (!range) return true;
    var n = Number(cell) || 0;
    return n >= range.min && n < range.max;
  }

  /** Level badge colour: higher levels carry more privilege. */
  function levelColor(level) {
    var n = Number(level) || 0;
    if (n >= 90) return 'red';
    if (n >= 50) return 'purple';
    if (n >= 20) return 'blue';
    return 'gray';
  }

  /**
   * One table row per role: raw values, the record as _raw.
   * @param {Object} role
   * @returns {Object}
   */
  function mapRole(role) {
    var r = role || {};
    var permissions = Array.isArray(r.permissions) ? r.permissions.length : Number(r.permission_count) || 0;
    return {
      id: String(r.id || ''),
      name: String(r.display_name || r.name || ''),
      description: String(r.description || ''),
      level: Number(r.level) || 1,
      permissions: permissions,
      users: Number(r.user_count) || 0,
      status: r.is_active === false ? 'inactive' : 'active',
      created_at: r.created_at || '',
      actions: '',
      _raw: r
    };
  }

  function cellRenderers(isAdmin) {
    var kit = window.AdminTableKit;
    return {
      name: function (val, row) { return kit.nameCell(val, row.description || 'No description'); },
      level: function (val) { return kit.badge('Level ' + val, levelColor(val)); },
      permissions: function (val) { return '<span class="admin-table-text">' + kit.esc(kit.countText(val, 'permission')) + '</span>'; },
      users: function (val) { return '<span class="admin-table-text">' + kit.esc(kit.countText(val, 'user')) + '</span>'; },
      status: function (val) { return kit.badge(Lex.Utils.humanizeLabel(val), STATUS_COLORS[val] || 'gray'); },
      created_at: function (val) { return kit.timeCell(val); },
      actions: function (val, row) {
        if (!isAdmin) return '';
        var id = kit.esc(row.id);
        var name = kit.esc(row.name);
        var html = '<div class="roles-row-actions">' +
          '<lex-btn size="sm" variant="secondary" data-action="edit-role" data-role-id="' + id + '" aria-label="Edit ' + name + '">Edit</lex-btn>';
        if (!row._raw || !row._raw.is_system) {
          html += '<lex-btn size="sm" variant="danger" data-action="delete-role" data-role-id="' + id + '" aria-label="Delete ' + name + '">Delete</lex-btn>';
        }
        return html + '</div>';
      }
    };
  }

  /**
   * Header filters for every data column. Levels come from the loaded roles.
   * @param {Array} rows - mapped rows
   */
  function filterOptions(rows) {
    var kit = window.AdminTableKit;
    var ranges = window.LanaLibraryColumnFilters;
    var levels = [];
    (rows || []).forEach(function (row) {
      if (levels.indexOf(row.level) === -1) levels.push(row.level);
    });
    levels.sort(function (a, b) { return b - a; });
    var created = kit.dateRangeFilter();
    created.match = function (cell, values) { return ranges ? ranges.inEditedRange(cell, values[0]) : true; };
    return {
      name: { text: true, placeholder: 'Name contains...' },
      level: { options: levels.map(function (l) { return { value: String(l), label: 'Level ' + l }; }) },
      permissions: {
        single: true,
        options: PERMISSION_RANGES.map(function (r) { return { value: r.value, label: r.label }; }),
        match: function (cell, values) { return inRange(PERMISSION_RANGES, cell, values[0]); }
      },
      users: {
        single: true,
        options: USER_RANGES.map(function (r) { return { value: r.value, label: r.label }; }),
        match: function (cell, values) { return inRange(USER_RANGES, cell, values[0]); }
      },
      status: { options: kit.labelOptions(ROLE_STATUSES) },
      created_at: created
    };
  }

  function _table() {
    return document.getElementById('rolesTable');
  }

  function _filteredCount(table) {
    if (Array.isArray(table.filteredRows)) return table.filteredRows.length;
    return null;
  }

  function _syncEmptyText(table) {
    table.emptyText = window.AdminTableKit.emptyText(Boolean(_searchTerm || _filterCount), 'roles');
  }

  function _initTable() {
    var table = _table();
    if (!table) return Promise.resolve(null);
    return window.AdminTableKit.whenTableReady().then(function () {
      if (_table() !== table) return null;
      if (table._rolesWired) return table;
      table._rolesWired = true;
      table.setCellRenderers(cellRenderers(Lex.Auth.isAdmin()));
      table.setColumnFilterOptions(filterOptions([]));
      _toolbar = window.AdminTableKit.bindToolbar({
        table: table,
        searchId: 'rolesSearch',
        sortId: 'rolesSort',
        orderId: 'rolesSortOrder',
        filterId: 'rolesStatusFilter',
        filterKey: 'status',
        countIds: ['rolesCount', 'rolesSectionCount'],
        noun: ['role', 'roles'],
        onSearch: function (term) {
          _searchTerm = term;
          if (table.dataSource) table.dataSource.setSearch(term);
        }
      });
      table.addEventListener('lex-filter-change', function (e) {
        if (e.target !== table) return;
        _filterCount = Object.keys((e.detail && e.detail.filters) || {}).length;
        _syncEmptyText(table);
        var n = _filteredCount(table);
        if (n !== null && _toolbar) _toolbar.setCount(n);
      });
      table.addEventListener('row-click', function (e) {
        var row = e.detail && e.detail.row;
        if (row && row.id) viewRole(row.id);
      });
      // Row actions (lex-table's row-click ignores buttons).
      table.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('[data-action][data-role-id]') : null;
        if (!btn) return;
        e.stopPropagation();
        var roleId = btn.getAttribute('data-role-id');
        if (btn.getAttribute('data-action') === 'edit-role') openEditModal(roleId);
        else if (btn.getAttribute('data-action') === 'delete-role') deleteRole(roleId, btn);
      });
      return table;
    });
  }

  function loadRoles() {
    var gen = ++_rolesGen;
    return _initTable().then(function (table) {
      if (!table || gen !== _rolesGen) return;
      return api.get('/api/v1/rbac/roles?limit=' + ROLES_FETCH_LIMIT)
        .then(function (result) {
          if (gen !== _rolesGen) return; // stale — navigated away
          _roles = (result && result.roles) ? result.roles : [];
          renderRoles(_roles);
        })
        .catch(function (err) {
          if (gen !== _rolesGen) return;
          console.error('[roles] loadRoles error:', err);
          if (_toolbar) _toolbar.setCount(null);
          var message = 'Roles could not be loaded. Check your connection and try again.';
          if (typeof table.setError === 'function') table.setError(message);
          else { table.emptyText = message; table.setData([]); }
        });
    });
  }

  function renderRoles(roles) {
    var table = _table();
    if (!table) return;
    var rows = (roles || []).map(mapRole);
    table.setColumnFilterOptions(filterOptions(rows));
    _syncEmptyText(table);
    table.setData(rows);
    if (_toolbar) {
      var n = _filteredCount(table);
      _toolbar.setCount(n !== null ? n : rows.length);
    }
  }

  // =========================================================================
  // Load & render permissions
  // =========================================================================

  function loadPermissions() {
    var gen = ++_permsGen;
    var grid = document.getElementById('permissionsGrid');
    var emptyEl = document.getElementById('permissionsEmpty');
    if (!grid) return;

    Lex.Redact.on(grid);

    api.getPermissions()
      .then(function (result) {
        if (gen !== _permsGen) return;
        _permissions = (result && result.permissions) ? result.permissions : [];
        Lex.Redact.off(grid);
        renderPermissionGrid(_permissions);
        _populatePermissionCheckboxes(_permissions);
      })
      .catch(function (err) {
        if (gen !== _permsGen) return;
        Lex.Redact.off(grid);
        if (emptyEl) emptyEl.classList.remove('hidden');
        Lex.Toast.error('Failed to load permissions');
        console.error('[roles] loadPermissions error:', err);
      });
  }

  function renderPermissionGrid(permissions) {
    var grid = document.getElementById('permissionsGrid');
    var emptyEl = document.getElementById('permissionsEmpty');
    if (!grid) return;

    if (!permissions || permissions.length === 0) {
      grid.innerHTML = '';
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');

    // Group by category (the part before the first ":")
    var grouped = {};
    for (var i = 0; i < permissions.length; i++) {
      var perm = permissions[i];
      var name = String(perm.name || '');
      var colonIdx = name.indexOf(':');
      var category = colonIdx >= 0 ? name.substring(0, colonIdx) : 'other';
      if (!grouped[category]) grouped[category] = [];
      grouped[category].push(perm);
    }

    var categories = Object.keys(grouped);
    var html = '';

    for (var c = 0; c < categories.length; c++) {
      var cat = categories[c];
      var perms = grouped[cat];
      var catLabel = Lex.Utils.escapeHtml(cat.charAt(0).toUpperCase() + cat.slice(1));

      html += '<div class="bg-white rounded-xl shadow-sm border p-4" style="border-color: var(--lex-border-default)">';
      html += '  <h4 class="font-medium mb-3" style="color: var(--lex-text-primary)">' + catLabel + '</h4>';
      html += '  <div class="space-y-2">';

      for (var p = 0; p < perms.length; p++) {
        var permName = Lex.Utils.escapeHtml(String(perms[p].name || ''));
        html += '    <div class="flex items-center gap-2 text-sm">';
        html += '      <div class="w-2 h-2 bg-green-500 rounded-full flex-shrink-0"></div>';
        html += '      <span style="color: var(--lex-text-secondary)">' + permName + '</span>';
        html += '    </div>';
      }

      html += '  </div>';
      html += '</div>';
    }

    grid.innerHTML = html;
  }

  /**
   * Populate the checkbox list inside the Create/Edit Role modal.
   * Called once after permissions load; checkboxes are reused for every open.
   */
  function _populatePermissionCheckboxes(permissions) {
    var container = document.getElementById('permissionCheckboxes');
    if (!container) return;

    var html = '';
    for (var i = 0; i < permissions.length; i++) {
      var name = Lex.Utils.escapeHtml(String(permissions[i].name || ''));
      var rawName = String(permissions[i].name || '');
      // Use a plain native checkbox inside a label — lex-checkbox fires lex-change
      // but collecting checked state via querySelectorAll is cleaner for bulk selection.
      // We use native <input type="checkbox"> here because we need to query all checked
      // values at form-submit time using a data attribute, not individual lex-change events.
      html += '<label class="flex items-center gap-2 text-sm cursor-pointer select-none">';
      html += '  <input type="checkbox" class="roles-perm-cb w-4 h-4 rounded" data-perm="' + name + '" value="' + name + '">';
      html += '  <span style="color: var(--lex-text-secondary)">' + name + '</span>';
      html += '</label>';
    }

    container.innerHTML = html;
  }

  // =========================================================================
  // Create / Edit modal
  // =========================================================================

  function _wireCreateButton() {
    var btn = document.getElementById('createRoleBtn');
    if (!btn) return;
    btn.addEventListener('click', openCreateModal);
  }

  function _wireModalEvents() {
    var cancelBtn = document.getElementById('cancelRoleBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        var modal = document.getElementById('roleModal');
        if (modal) modal.open = false;
      });
    }
  }

  function openCreateModal() {
    _editingRoleId = null;

    var modal = document.getElementById('roleModal');
    if (!modal) return;

    // Reset heading
    modal.heading = 'Create Role';

    // Reset hidden id field
    var idField = document.getElementById('roleId');
    if (idField) idField.value = '';

    // Reset lex form fields
    _setInputValue('roleNameInput', '');
    _setInputValue('roleDescriptionInput', '');
    _setInputValue('roleLevelInput', '1');

    // Uncheck all permission checkboxes
    _setCheckedPermissions([]);

    modal.open = true;
  }

  function openEditModal(roleId) {
    var gen = _rolesGen; // capture without incrementing — guard against navigation
    var modal = document.getElementById('roleModal');
    if (!modal) return;

    modal.heading = 'Edit Role';

    api.getRole(roleId)
      .then(function (result) {
        if (gen !== _rolesGen) return; // navigated away — discard
        var role = result && result.role ? result.role : null;
        if (!role) {
          Lex.Toast.error('Role not found');
          return;
        }

        _editingRoleId = String(role.id);

        var idField = document.getElementById('roleId');
        if (idField) idField.value = _editingRoleId;

        _setInputValue('roleNameInput', role.name || '');
        _setInputValue('roleDescriptionInput', role.description || '');
        _setInputValue('roleLevelInput', String(role.level || 1));

        var rolePerms = role.permissions || [];
        _setCheckedPermissions(rolePerms);

        modal.open = true;
      })
      .catch(function (err) {
        Lex.Toast.error('Failed to load role');
        console.error('[roles] openEditModal error:', err);
      });
  }

  // =========================================================================
  // Form submission
  // =========================================================================

  function _wireFormEvents() {
    var form = document.getElementById('roleForm');
    if (!form) return;

    form.addEventListener('lex-submit', function (e) {
      if (e.detail && !e.detail.valid) return; // respect lex-form validation
      handleFormSubmit(e.detail);
    });

    // Save sits in the modal footer, outside lex-form.
    var saveBtn = document.getElementById('saveRoleBtn');
    if (saveBtn) saveBtn.addEventListener('click', function () { _requestFormSubmit(form); });
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

  function handleFormSubmit(detail) {
    var nameInput = document.getElementById('roleNameInput');
    var descInput = document.getElementById('roleDescriptionInput');
    var levelInput = document.getElementById('roleLevelInput');

    var name = (nameInput && nameInput.value) ? String(nameInput.value).trim() : '';
    var description = (descInput && descInput.value) ? String(descInput.value).trim() : '';
    var level = levelInput ? parseInt(levelInput.value, 10) : 1;

    if (!name) {
      Lex.Toast.error('Role name is required');
      return;
    }

    if (!level || level < 1 || level > 100) level = 1;

    // Collect checked permissions
    var checkedBoxes = document.querySelectorAll('.roles-perm-cb:checked');
    var permissions = [];
    for (var i = 0; i < checkedBoxes.length; i++) {
      permissions.push(checkedBoxes[i].value);
    }

    var data = {
      name: name,
      description: description,
      level: level,
      permissions: permissions
    };

    var saveBtn = document.getElementById('saveRoleBtn');
    if (saveBtn) saveBtn.loading = true;

    var isEdit = !!_editingRoleId;
    var apiCall = isEdit
      ? api.updateRole(_editingRoleId, data)
      : api.createRole(data);

    apiCall
      .then(function () {
        if (saveBtn) saveBtn.loading = false;
        var modal = document.getElementById('roleModal');
        if (modal) modal.open = false;
        Lex.Toast.success(isEdit ? 'Role updated' : 'Role created');
        loadRoles();
      })
      .catch(function (err) {
        if (saveBtn) saveBtn.loading = false;
        Lex.Toast.error(err && err.message ? err.message : 'Failed to save role');
        console.error('[roles] handleFormSubmit error:', err);
      });
  }

  // =========================================================================
  // View role details
  // =========================================================================

  function viewRole(roleId) {
    var gen = _rolesGen; // capture without incrementing — guard against navigation
    var modal = document.getElementById('roleDetailsModal');
    var content = document.getElementById('roleDetailsContent');
    if (!modal || !content) return;

    // Show modal immediately with a spinner while loading
    content.innerHTML = '<div class="flex justify-center py-8"><lex-spinner size="md" label="Loading..."></lex-spinner></div>';
    modal.open = true;

    Promise.all([
      api.getRole(roleId),
      api.getInheritedPermissions(roleId).catch(function () {
        return { permissions: { direct: [], inherited: [] } };
      })
    ])
      .then(function (results) {
        if (gen !== _rolesGen) return; // navigated away — discard
        var roleResult = results[0];
        var inheritedResult = results[1];

        var role = roleResult && roleResult.role ? roleResult.role : null;
        if (!role) {
          content.innerHTML = '<p style="color: var(--lex-text-secondary)">Role not found.</p>';
          return;
        }

        var directPerms = (inheritedResult.permissions && inheritedResult.permissions.direct)
          ? inheritedResult.permissions.direct
          : (role.permissions || []);
        var inheritedPerms = (inheritedResult.permissions && inheritedResult.permissions.inherited)
          ? inheritedResult.permissions.inherited
          : [];

        var nameEsc = Lex.Utils.escapeHtml(String(role.name || ''));
        var descEsc = Lex.Utils.escapeHtml(String(role.description || 'No description'));
        var levelEsc = Lex.Utils.escapeHtml(String(role.level || 1));

        var directHtml = '';
        if (directPerms.length > 0) {
          for (var d = 0; d < directPerms.length; d++) {
            directHtml += '<span class="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">' + Lex.Utils.escapeHtml(String(directPerms[d])) + '</span>';
          }
        } else {
          directHtml = '<span class="text-sm" style="color: var(--lex-text-secondary)">None</span>';
        }

        var inheritedHtml = '';
        if (inheritedPerms.length > 0) {
          for (var ih = 0; ih < inheritedPerms.length; ih++) {
            inheritedHtml += '<span class="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded">' + Lex.Utils.escapeHtml(String(inheritedPerms[ih])) + '</span>';
          }
        } else {
          inheritedHtml = '<span class="text-sm" style="color: var(--lex-text-secondary)">None</span>';
        }

        var systemBadge = role.is_system
          ? '<span class="px-2 py-1 bg-gray-100 text-gray-700 text-xs font-medium rounded ml-2">System Role</span>'
          : '';

        content.innerHTML =
          '<div class="space-y-5">' +
            '<div>' +
              '<h4 class="text-xl font-semibold" style="color: var(--lex-text-primary)">' + nameEsc + '</h4>' +
              '<p class="text-sm mt-1" style="color: var(--lex-text-secondary)">' + descEsc + '</p>' +
              '<div class="flex flex-wrap items-center gap-2 mt-3">' +
                '<span class="px-2 py-1 bg-indigo-100 text-indigo-700 text-xs font-medium rounded">Level ' + levelEsc + '</span>' +
                systemBadge +
              '</div>' +
            '</div>' +
            '<div>' +
              '<h5 class="font-medium mb-2" style="color: var(--lex-text-primary)">Direct Permissions (' + directPerms.length + ')</h5>' +
              '<div class="flex flex-wrap gap-2">' + directHtml + '</div>' +
            '</div>' +
            '<div>' +
              '<h5 class="font-medium mb-2" style="color: var(--lex-text-primary)">Inherited Permissions (' + inheritedPerms.length + ')</h5>' +
              '<div class="flex flex-wrap gap-2">' + inheritedHtml + '</div>' +
            '</div>' +
          '</div>';
      })
      .catch(function (err) {
        content.innerHTML = '<p class="text-red-600 text-sm">Failed to load role details.</p>';
        console.error('[roles] viewRole error:', err);
      });
  }

  // =========================================================================
  // Delete role
  // =========================================================================

  function deleteRole(roleId, triggerEl) {
    // Find the role name for the confirmation message
    var roleName = 'this role';
    for (var i = 0; i < _roles.length; i++) {
      if (String(_roles[i].id) === String(roleId)) {
        roleName = '"' + String(_roles[i].name) + '"';
        break;
      }
    }

    // Lex.Modal.confirm(title, messageHtml, onConfirm, options): the message is HTML.
    var message = 'Are you sure you want to delete ' + Lex.Utils.escapeHtml(roleName) + '? This action cannot be undone.';
    Lex.Modal.confirm('Delete Role', message, function () {
      api.deleteRole(roleId)
        .then(function () {
          Lex.Toast.success('Role deleted');
          loadRoles();
        })
        .catch(function (err) {
          Lex.Toast.error(err && err.message ? err.message : 'Failed to delete role');
          console.error('[roles] deleteRole error:', err);
        });
    }, { variant: 'danger', confirmText: 'Delete' });
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  /**
   * Set value on a lex-input or lex-textarea component.
   * These are web components — set the .value property, not the attribute.
   */
  function _setInputValue(elId, value) {
    var el = document.getElementById(elId);
    if (!el) return;
    el.value = value;
  }

  /**
   * Check or uncheck permission checkboxes based on an array of permission names.
   * @param {string[]} permNames - Array of permission name strings to check.
   */
  function _setCheckedPermissions(permNames) {
    // Build O(1) lookup to avoid O(n*m) nested loop
    var lookup = {};
    for (var k = 0; k < permNames.length; k++) {
      lookup[permNames[k]] = true;
    }

    var checkboxes = document.querySelectorAll('.roles-perm-cb');
    for (var i = 0; i < checkboxes.length; i++) {
      checkboxes[i].checked = !!lookup[checkboxes[i].value];
    }
  }

  // =========================================================================
  // Boot
  // =========================================================================

  // Pure table logic, exposed for unit tests.
  window.RolesTable = {
    mapRole: mapRole,
    cellRenderers: cellRenderers,
    filterOptions: filterOptions,
    levelColor: levelColor,
    ROLES_FETCH_LIMIT: ROLES_FETCH_LIMIT
  };

  init();

})();
