/**
 * Roles & Permissions — SPA page controller
 *
 * Handles role management and permission display for the admin panel.
 * Migrated from V1 legacy inline script to V2 Lex SPA architecture.
 *
 * @requires api.js           - window.api — getRoles, getRole, createRole, updateRole,
 *                               deleteRole, getPermissions, getInheritedPermissions
 * @requires lex-router.js    - LexRouter.registerPageInit, LexRouter.registerView
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

  // Generation counter: guards stale async renders after rapid re-navigation
  var _gen = 0;

  // =========================================================================
  // Entry point — called on every SPA navigation to this page
  // =========================================================================

  function init() {
    // Reset state for clean re-navigation
    _roles = [];
    _permissions = [];
    _editingRoleId = null;

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

  function onLeave() {
    // Increment generation to abandon any in-flight renders
    _gen++;
  }

  // =========================================================================
  // Tab switching
  // =========================================================================

  function _wireTabEvents() {
    var tabs = document.getElementById('rolesTabs');
    if (!tabs) return;

    tabs.addEventListener('tab-change', function (e) {
      switchTab(e.detail.id);
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

  function loadRoles() {
    var gen = ++_gen;
    var grid = document.getElementById('rolesGrid');
    var emptyEl = document.getElementById('rolesEmpty');
    if (!grid) return;

    // Show shimmer while loading
    Lex.Redact.on(grid);

    api.getRoles()
      .then(function (result) {
        if (gen !== _gen) return; // stale — navigated away
        _roles = (result && result.roles) ? result.roles : [];
        Lex.Redact.off(grid);
        renderRoleCards(_roles);
      })
      .catch(function (err) {
        if (gen !== _gen) return;
        Lex.Redact.off(grid);
        if (emptyEl) emptyEl.classList.remove('hidden');
        Lex.Toast.error('Failed to load roles');
        console.error('[roles] loadRoles error:', err);
      });
  }

  function renderRoleCards(roles) {
    var grid = document.getElementById('rolesGrid');
    var emptyEl = document.getElementById('rolesEmpty');
    if (!grid) return;

    if (!roles || roles.length === 0) {
      grid.innerHTML = '';
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');

    var html = '';
    for (var i = 0; i < roles.length; i++) {
      var role = roles[i];
      var roleId = Lex.Utils.escapeHtml(String(role.id || ''));
      var roleName = Lex.Utils.escapeHtml(String(role.name || ''));
      var roleDesc = Lex.Utils.escapeHtml(String(role.description || 'No description'));
      var roleLevel = Lex.Utils.escapeHtml(String(role.level || 1));
      var permCount = role.permissions ? role.permissions.length : (role.permission_count || 0);

      var deleteAction = '';
      if (!role.is_system) {
        deleteAction = '<button class="text-red-600 hover:text-red-800 text-sm" data-action="delete-role" data-role-id="' + roleId + '">Delete</button>';
      }

      html += '<div class="bg-white rounded-xl shadow-sm border p-6 hover:shadow-md transition-shadow" style="border-color: var(--lex-border-default)">';
      html += '  <div class="flex items-start justify-between mb-4">';
      html += '    <div class="flex-1 min-w-0">';
      html += '      <h3 class="text-lg font-semibold truncate" style="color: var(--lex-text-primary)">' + roleName + '</h3>';
      html += '      <p class="text-sm mt-1 line-clamp-2" style="color: var(--lex-text-secondary)">' + roleDesc + '</p>';
      html += '    </div>';
      html += '    <span class="ml-3 flex-shrink-0 px-2 py-1 bg-indigo-100 text-indigo-700 text-xs font-medium rounded">Level ' + roleLevel + '</span>';
      html += '  </div>';
      html += '  <div class="flex items-center justify-between text-sm">';
      html += '    <span style="color: var(--lex-text-secondary)">' + permCount + ' permission' + (permCount === 1 ? '' : 's') + '</span>';
      html += '    <div class="flex gap-3">';
      html += '      <button class="hover:opacity-70 text-sm font-medium" style="color: var(--lex-accent)" data-action="view-role" data-role-id="' + roleId + '">View</button>';
      if (Lex.Auth.isAdmin()) {
        html += '      <button class="hover:opacity-70 text-sm font-medium" style="color: var(--lex-accent)" data-action="edit-role" data-role-id="' + roleId + '">Edit</button>';
        html += '      ' + deleteAction;
      }
      html += '    </div>';
      html += '  </div>';
      html += '</div>';
    }

    grid.innerHTML = html;

    // Delegate click events on the grid
    grid.addEventListener('click', _handleGridClick);
  }

  function _handleGridClick(e) {
    var btn = e.target;
    if (btn.tagName !== 'BUTTON') return;

    var action = btn.getAttribute('data-action');
    var roleId = btn.getAttribute('data-role-id');
    if (!action || !roleId) return;

    if (action === 'view-role') {
      viewRole(roleId);
    } else if (action === 'edit-role') {
      openEditModal(roleId);
    } else if (action === 'delete-role') {
      deleteRole(roleId, btn);
    }
  }

  // =========================================================================
  // Load & render permissions
  // =========================================================================

  function loadPermissions() {
    var gen = ++_gen;
    var grid = document.getElementById('permissionsGrid');
    var emptyEl = document.getElementById('permissionsEmpty');
    if (!grid) return;

    Lex.Redact.on(grid);

    api.getPermissions()
      .then(function (result) {
        if (gen !== _gen) return;
        _permissions = (result && result.permissions) ? result.permissions : [];
        Lex.Redact.off(grid);
        renderPermissionGrid(_permissions);
        _populatePermissionCheckboxes(_permissions);
      })
      .catch(function (err) {
        if (gen !== _gen) return;
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
    var modal = document.getElementById('roleModal');
    if (!modal) return;

    modal.heading = 'Edit Role';

    api.getRole(roleId)
      .then(function (result) {
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
      handleFormSubmit(e.detail);
    });
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

    Lex.Modal.confirm({
      heading: 'Delete Role',
      body: 'Are you sure you want to delete ' + roleName + '? This action cannot be undone.',
      variant: 'danger',
      confirmText: 'Delete'
    }).then(function (confirmed) {
      if (!confirmed) return;

      api.deleteRole(roleId)
        .then(function () {
          Lex.Toast.success('Role deleted');
          loadRoles();
        })
        .catch(function (err) {
          Lex.Toast.error(err && err.message ? err.message : 'Failed to delete role');
          console.error('[roles] deleteRole error:', err);
        });
    });
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
    var checkboxes = document.querySelectorAll('.roles-perm-cb');
    for (var i = 0; i < checkboxes.length; i++) {
      var cb = checkboxes[i];
      cb.checked = _arrayIncludes(permNames, cb.value);
    }
  }

  /**
   * Array includes polyfill using indexOf (no regex, no Array.prototype.includes).
   */
  function _arrayIncludes(arr, value) {
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] === value) return true;
    }
    return false;
  }

  // =========================================================================
  // SPA lifecycle registration
  // =========================================================================

  // registerPageInit ensures init() is called on every navigation to this page
  // (first load + re-navigation from cached scripts).
  // registerView only carries onLeave for cleanup — onEnter is handled
  // by registerPageInit to avoid double-init.
  if (window.LexRouter) {
    LexRouter.registerPageInit('admin/roles.html', function () {
      LexRouter.registerView({ onLeave: onLeave });
      init();
    });
  } else {
    init();
  }

})();
