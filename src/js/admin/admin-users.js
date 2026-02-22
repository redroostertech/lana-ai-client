/**
 * Admin User Management — standalone page controller.
 *
 * Handles user listing, creation, editing, deletion, password reset,
 * session management, and activation-key regeneration for the admin panel.
 *
 * @requires api.js          - window.api — getUsers, getUser, createUser, updateUser,
 *                              deleteUser, activateUser, deactivateUser,
 *                              setTemporaryPassword, checkEmail, checkUsername,
 *                              getUserSessions, revokeUserSessions,
 *                              regenerateActivationKey, getRoles
 * @requires lex.utils.js    - Lex.Utils.escapeHtml, Lex.Utils.formatDate,
 *                              Lex.Utils.formatDateTime
 * @requires lex-modal.js    - Lex.Modal.confirm, Lex.Modal.open
 * @requires lex-toast.js    - Lex.Toast.success, Lex.Toast.error
 * @requires lex-table.js    - table.setData()
 * @requires lex-form.js     - form.getValues(), form.reset(), form.validate()
 */

(function () {
  'use strict';

  // =========================================================================
  // Lex aliases (shell singletons — set once, never re-declared)
  // =========================================================================

  var escHtml    = Lex.Utils.escapeHtml;
  var fmtDate    = Lex.Utils.formatDate;
  var fmtDateTime = Lex.Utils.formatDateTime;

  // =========================================================================
  // Module-level state
  // =========================================================================

  /** Generation counter — incremented on every loadUsers() call.
   *  Guards against stale async responses. */
  var _gen = 0;

  /** Roles cache — populated once on first navigation, reused on re-nav. */
  var _roles = [];

  /** null = create mode, string ID = edit mode. */
  var _editingUserId = null;

  /** User ID whose drawer is currently showing (for quick-action buttons). */
  var _drawerUserId = null;

  /** Full user object for the currently open drawer (refreshed on every open). */
  var _drawerUser = null;


  // =========================================================================
  // Entry point
  // =========================================================================

  /**
   * Initialise the page: wire events, load data.
   */
  function init() {
    _wireHeaderButtons();
    _wireUserModal();
    _wireResetPasswordModal();
    _wireDrawerActions();
    _wireSessionsModal();

    loadRoles();
    loadUsers();
  }


  // =========================================================================
  // Helpers
  // =========================================================================

  /**
   * Safely retrieve a DOM element by ID.
   * @param {string} id
   * @returns {Element|null}
   */
  function el(id) {
    return document.getElementById(id);
  }

  /**
   * Show element by removing 'hidden' class.
   * @param {string|Element} target
   */
  function show(target) {
    var elem = typeof target === 'string' ? el(target) : target;
    if (elem) elem.classList.remove('hidden');
  }

  /**
   * Hide element by adding 'hidden' class.
   * @param {string|Element} target
   */
  function hide(target) {
    var elem = typeof target === 'string' ? el(target) : target;
    if (elem) elem.classList.add('hidden');
  }

  /**
   * Set a lex-input or lex-select component's value property safely.
   * These are web components — .value must be set on the element, not
   * via setAttribute.
   * @param {string} elId
   * @param {string|number} value
   */
  function setInputValue(elId, value) {
    var elem = el(elId);
    if (elem) elem.value = (value !== null && value !== undefined) ? String(value) : '';
  }

  /**
   * Get initials from a name string.
   * Takes the first char of the first word and the first char of the last word.
   * Uses charAt() and indexOf() — no regex.
   * @param {string} name
   * @returns {string} Up to two uppercase initials.
   */
  function getInitials(name) {
    if (!name) return '?';
    var parts = name.split(' ');
    var first = parts[0] ? parts[0].charAt(0) : '';
    var last  = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
    return (first + last).toUpperCase() || '?';
  }

  /**
   * Build an HTML pill for a user's status (active, inactive, pending, etc.).
   * Uses inline style rather than Lex.Utils.statusBadge so we control colors.
   * @param {string} status
   * @returns {string} Safe HTML string.
   */
  function statusPill(status) {
    var s = status ? String(status).toLowerCase() : '';
    var color;
    var label;
    if (s === 'active') {
      color = 'var(--lex-status-success-bg,#ECFDF3)';
      label = 'Active';
    } else if (s === 'inactive' || s === 'deactivated') {
      color = 'var(--lex-status-neutral-bg,#F2F4F7)';
      label = 'Inactive';
    } else if (s === 'pending' || s === 'invited') {
      color = 'var(--lex-status-warning-bg,#FFFAEB)';
      label = s.charAt(0).toUpperCase() + s.substring(1);
    } else {
      color = 'var(--lex-status-neutral-bg,#F2F4F7)';
      label = s ? s.charAt(0).toUpperCase() + s.substring(1) : 'Unknown';
    }
    return (
      '<span style="' +
        'display:inline-flex;align-items:center;' +
        'padding:2px 8px;border-radius:9999px;' +
        'font-size:var(--lex-body-xs-size,0.75rem);' +
        'font-weight:500;background:' + color + ';' +
      '">' + escHtml(label) + '</span>'
    );
  }

  /**
   * Validate a password string without any regex.
   * Checks each character using charCodeAt() against known ranges.
   *
   * Rules: min 8 chars, at least one uppercase, one lowercase, one digit,
   * one special character.
   *
   * @param {string} pw
   * @returns {{ valid: boolean, missing: string[] }}
   */
  function validatePassword(pw) {
    var missing = [];
    if (!pw || pw.length < 8) {
      missing.push('at least 8 characters');
    }
    var hasUpper   = false;
    var hasLower   = false;
    var hasDigit   = false;
    var hasSpecial = false;
    var specials = '!@#$%^&*()_+-=[]{}|;:,.<>?/\\~`\'"';
    for (var i = 0; i < pw.length; i++) {
      var c = pw.charCodeAt(i);
      if (c >= 65 && c <= 90)  hasUpper = true;
      if (c >= 97 && c <= 122) hasLower = true;
      if (c >= 48 && c <= 57)  hasDigit = true;
      if (specials.indexOf(pw.charAt(i)) !== -1) hasSpecial = true;
    }
    if (!hasUpper)   missing.push('one uppercase letter');
    if (!hasLower)   missing.push('one lowercase letter');
    if (!hasDigit)   missing.push('one number');
    if (!hasSpecial) missing.push('one special character');
    return { valid: missing.length === 0, missing: missing };
  }

  /**
   * Derive a display name string from a user object.
   * Handles multiple API response shapes.
   * @param {Object} user
   * @returns {string}
   */
  function userDisplayName(user) {
    if (!user) return '';
    var first = String(user.first_name || user.firstName || '').trim();
    var last  = String(user.last_name  || user.lastName  || '').trim();
    if (first || last) return (first + ' ' + last).trim();
    return String(user.username || user.name || '').trim();
  }

  /**
   * Derive a role name string from a user object.
   * Handles multiple API response shapes (role_name, role.name, roles[0].name).
   * @param {Object} user
   * @returns {string}
   */
  function userRoleName(user) {
    if (!user) return '';
    if (user.role_name) return String(user.role_name);
    if (user.role && user.role.name) return String(user.role.name);
    if (Array.isArray(user.roles) && user.roles.length > 0) {
      return String(user.roles[0].name || user.roles[0].role_name || '');
    }
    return '';
  }

  // =========================================================================
  // A. loadUsers — Fetch and render table
  // =========================================================================

  /**
   * Fetch the user list from the API and populate the lex-table.
   * Uses a generation counter to discard stale responses.
   */
  function loadUsers() {
    var gen = ++_gen;
    var table = el('usersTable');
    if (!table) return;

    // Apply redacted shimmer while loading
    Lex.Redact.on(table);

    // Fetches up to 100 users — sufficient for current ICP (small-mid law firms).
    // TODO: Add server-side pagination when platform serves larger enterprise customers.
    api.getUsers(1, 100, {})
      .then(function (result) {
        if (gen !== _gen) return; // stale response — discard

        var users = [];
        if (Array.isArray(result)) {
          users = result;
        } else if (result && Array.isArray(result.users)) {
          users = result.users;
        } else if (result && Array.isArray(result.data)) {
          users = result.data;
        }

        var rows = users.map(function (u) {
          return {
            _id:         String(u.id || u.user_id || ''),
            user_display: userDisplayName(u),
            _email:      String(u.email || ''),
            username:    String(u.username || ''),
            role_name:   userRoleName(u) || 'No role',
            status:      String(u.status || (u.is_active ? 'active' : 'inactive')),
            created_at:  u.created_at ? fmtDate(u.created_at) : '—',
            _raw:        u
          };
        });

        Lex.Redact.off(table);
        _ensureTableObserver(table);
        table.setData(rows);
      })
      .catch(function (err) {
        if (gen !== _gen) return;
        Lex.Redact.off(table);
        console.error('[admin-users] loadUsers error:', err);
        Lex.Toast.error('Failed to load users');
      });
  }

  /**
   * One-time setup: attach row-click listener and a MutationObserver that
   * re-applies custom cell renderers whenever lex-table re-renders
   * (search, sort, paginate).  Must be called BEFORE the first setData().
   *
   * The observer watches direct childList only (not subtree), so the
   * td.innerHTML changes inside _applyTableRenderers do NOT re-trigger it.
   *
   * @param {Element} table
   */
  function _ensureTableObserver(table) {
    if (table._usersRendererAttached) return;
    table._usersRendererAttached = true;

    table.addEventListener('row-click', function (e) {
      var row = e.detail && e.detail.row;
      if (row) openDrawer(row._id || row.id, row._raw);
    });

    new MutationObserver(function () {
      requestAnimationFrame(function () { _applyTableRenderers(table); });
    }).observe(table, { childList: true });
  }

  /**
   * Apply custom cell renderers to the lex-table.
   * Overrides the user_display column to show avatar+name+email,
   * the status column to show a coloured pill, and appends an
   * Actions dropdown to each row.
   *
   * Reads the currently displayed rows from table.dataSource.data
   * so it works correctly after search/sort/paginate re-renders.
   *
   * @param {Element} table
   */
  function _applyTableRenderers(table) {
    var rows = (table.dataSource && table.dataSource.data) || [];

    var tbody = table.querySelector('tbody');
    if (!tbody) return;

    var trs = tbody.querySelectorAll('tr');
    for (var i = 0; i < trs.length; i++) {
      var tr   = trs[i];
      var row  = rows[i];
      if (!row) continue;

      var tds = tr.querySelectorAll('td');
      if (tds.length === 0) continue;

      // Column order: user_display, username, role_name, status, created_at
      // User display cell (index 0): avatar circle + name + email
      var nameVal  = row.user_display || '';
      var emailVal = row._email || '';
      var initials = getInitials(nameVal);
      if (tds[0]) {
        tds[0].innerHTML =
          '<div style="display:flex;align-items:center;gap:0.625rem;">' +
            '<div style="' +
              'flex-shrink:0;width:2rem;height:2rem;border-radius:9999px;' +
              'background:var(--lex-bg-accent,#8B7355);' +
              'color:var(--lex-text-on-accent,#fff);' +
              'display:flex;align-items:center;justify-content:center;' +
              'font-size:0.6875rem;font-weight:600;' +
            '">' +
              escHtml(initials) +
            '</div>' +
            '<div style="min-width:0;">' +
              '<div style="font-weight:500;color:var(--lex-text-primary);' +
                'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
                escHtml(nameVal) +
              '</div>' +
              '<div style="font-size:var(--lex-body-xs-size,0.75rem);' +
                'color:var(--lex-text-tertiary);' +
                'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
                escHtml(emailVal) +
              '</div>' +
            '</div>' +
          '</div>';
      }

      // Status cell — coloured pill
      var statusVal = row.status || '';
      var statusIndex = 3; // 0:user_display, 1:username, 2:role_name, 3:status, 4:created_at
      if (tds[statusIndex]) {
        tds[statusIndex].innerHTML = statusPill(statusVal);
      }

      // Actions cell — append if not already there (last column)
      var userId = escHtml(row._id || '');
      var actionsCell = tr.querySelector('td.users-actions-cell');
      if (!actionsCell) {
        actionsCell = document.createElement('td');
        actionsCell.className = 'users-actions-cell';
        actionsCell.style.cssText = 'white-space:nowrap;text-align:right;padding-right:0.5rem;';
        tr.appendChild(actionsCell);
      }
      actionsCell.innerHTML =
        '<lex-dropdown-btn ' +
          'data-user-id="' + userId + '" ' +
          'label="Actions" ' +
          'size="sm" ' +
          'variant="secondary" ' +
          'items=\'[' +
            '{"value":"edit","label":"Edit"},' +
            '{"value":"view","label":"View Details"},' +
            '{"value":"reset-pw","label":"Reset Password"},' +
            '{"value":"sessions","label":"View Sessions"},' +
            '{"value":"regen-key","label":"Regenerate Key"},' +
            '{"value":"delete","label":"Delete","variant":"danger"}' +
          ']\'' +
        '></lex-dropdown-btn>';

      // Wire the dropdown items (event delegation on the tr)
      (function (rowRef) {
        var ddBtn = tr.querySelector('lex-dropdown-btn');
        if (ddBtn && !ddBtn._usersWired) {
          ddBtn._usersWired = true;
          ddBtn.addEventListener('item-click', function (e) {
            var action = e.detail && e.detail.value;
            var uid = ddBtn.getAttribute('data-user-id');
            if (action === 'edit')      openUserModalEdit(uid, rowRef._raw);
            if (action === 'view')      openDrawer(uid, rowRef._raw);
            if (action === 'reset-pw')  openResetPasswordModal(uid, rowRef._raw);
            if (action === 'sessions')  openSessionsModal(uid, rowRef._raw);
            if (action === 'regen-key') regenActivationKey(uid);
            if (action === 'delete')    deleteUser(uid, rowRef._raw);
          });
        }
      })(row);
    }
  }

  // =========================================================================
  // B. loadRoles — Fetch roles for the role dropdown
  // =========================================================================

  /**
   * Fetch all RBAC roles and cache them.
   * Populates the lex-select#userRole dropdown.
   * If roles are already cached, repopulates only (no network call).
   */
  function loadRoles() {
    if (_roles.length > 0) {
      _populateRoleSelect();
      return;
    }

    api.getRoles()
      .then(function (result) {
        var list = [];
        if (Array.isArray(result)) {
          list = result;
        } else if (result && Array.isArray(result.roles)) {
          list = result.roles;
        } else if (result && Array.isArray(result.data)) {
          list = result.data;
        }
        _roles = list;
        _populateRoleSelect();
      })
      .catch(function (err) {
        console.error('[admin-users] loadRoles error:', err);
      });
  }

  /**
   * Push the cached _roles array into the lex-select#userRole component.
   * Sets the `options` property as an array of { value, label } objects.
   */
  function _populateRoleSelect() {
    var select = el('userRole');
    if (!select) return;
    var opts = _roles.map(function (r) {
      return { value: String(r.id), label: String(r.name || r.role_name || r.id) };
    });
    select.options = opts;
  }

  // =========================================================================
  // C. Header buttons
  // =========================================================================

  /**
   * Wire the "Add User" button to open the create modal.
   */
  function _wireHeaderButtons() {
    var addBtn = el('addUserBtn');
    if (!addBtn || addBtn._usersWired) return;
    addBtn._usersWired = true;
    addBtn.addEventListener('click', function () {
      openUserModalCreate();
    });
  }

  // =========================================================================
  // D. Create / Edit User Modal
  // =========================================================================

  /**
   * Open the user modal in "create" mode.
   * Resets the form, shows the password field, sets the heading.
   */
  function openUserModalCreate() {
    _editingUserId = null;

    var modal = el('userModal');
    if (!modal) return;

    modal.heading = 'Add User';

    var form = el('userForm');
    if (form) form.reset();

    // Show password field for new users
    show('userPasswordGroup');
    var pwInput = el('userPassword');
    if (pwInput) pwInput.required = true;

    // Re-populate roles in case they loaded after initial mount
    _populateRoleSelect();

    // Clear availability hints
    _clearAvailabilityHint('userEmail');
    _clearAvailabilityHint('userUsername');

    modal.open = true;
  }

  /**
   * Open the user modal in "edit" mode for an existing user.
   * Fetches full user details, populates the form, hides the password field.
   * @param {string} userId
   * @param {Object} [knownData] - Optional pre-fetched user data to use immediately.
   */
  function openUserModalEdit(userId, knownData) {
    _editingUserId = userId;

    var modal = el('userModal');
    if (!modal) return;

    modal.heading = 'Edit User';

    // Hide password field — admins use "Reset Password" separately
    hide('userPasswordGroup');
    var pwInput = el('userPassword');
    if (pwInput) pwInput.required = false;

    _populateRoleSelect();

    // If we already have the data, populate immediately then open
    if (knownData) {
      _populateUserForm(knownData);
      modal.open = true;
      return;
    }

    // Otherwise fetch the latest
    modal.open = true;
    api.getUser(userId)
      .then(function (result) {
        var user = (result && result.user) ? result.user : result;
        _populateUserForm(user);
      })
      .catch(function (err) {
        console.error('[admin-users] getUser error:', err);
        Lex.Toast.error('Failed to load user details');
      });
  }

  /**
   * Populate the user form fields from a user object.
   * @param {Object} user
   */
  function _populateUserForm(user) {
    if (!user) return;
    setInputValue('userFirstName', user.first_name || user.firstName || '');
    setInputValue('userLastName',  user.last_name  || user.lastName  || '');
    setInputValue('userEmail',     user.email    || '');
    setInputValue('userUsername',  user.username || '');
    setInputValue('userPassword',  '');

    // Set role — find matching ID
    var roleId = '';
    if (user.role_id) {
      roleId = String(user.role_id);
    } else if (user.role && user.role.id) {
      roleId = String(user.role.id);
    } else if (Array.isArray(user.roles) && user.roles.length > 0) {
      roleId = String(user.roles[0].id || user.roles[0].role_id || '');
    }
    setInputValue('userRole', roleId);
  }

  /**
   * Wire the user modal's form submission (lex-submit event).
   * Also wires email/username availability checks on input blur.
   */
  function _wireUserModal() {
    var modal = el('userModal');
    var form  = el('userForm');
    if (!modal || !form) return;
    if (form._usersWired) return;
    form._usersWired = true;

    // Form submit
    form.addEventListener('lex-submit', function (e) {
      if (!e.detail.valid) {
        Lex.Toast.error('Please fill in all required fields');
        return;
      }
      _handleUserFormSubmit(e.detail.values);
    });

    // Email availability check on blur (create mode only)
    var emailInput = el('userEmail');
    if (emailInput) {
      emailInput.addEventListener('blur', function () {
        if (_editingUserId) return; // skip in edit mode
        var email = (emailInput.value || '').trim();
        if (!email) return;
        _checkEmailAvailability(email, emailInput);
      });
    }

    // Username availability check on blur (create mode only)
    var usernameInput = el('userUsername');
    if (usernameInput) {
      usernameInput.addEventListener('blur', function () {
        if (_editingUserId) return; // skip in edit mode
        var username = (usernameInput.value || '').trim();
        if (!username) return;
        _checkUsernameAvailability(username, usernameInput);
      });
    }

    // Password strength hint while typing
    var passwordInput = el('userPassword');
    var pwHint        = el('userPasswordHint');
    if (passwordInput && pwHint) {
      passwordInput.addEventListener('lex-input', function () {
        var pw = passwordInput.value || '';
        if (!pw) {
          pwHint.textContent = '';
          return;
        }
        var result = validatePassword(pw);
        if (result.valid) {
          pwHint.textContent = 'Password meets all requirements.';
          pwHint.style.color = 'var(--lex-status-success-text,#027A48)';
        } else {
          pwHint.textContent = 'Missing: ' + result.missing.join(', ') + '.';
          pwHint.style.color = 'var(--lex-status-danger-text,#B42318)';
        }
      });
    }

    // Cancel button inside the form (since modal uses hide-actions)
    var cancelBtn = el('userModalCancelBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        modal.open = false;
        _editingUserId = null;
      });
    }

    // Modal close event — clean up state
    modal.addEventListener('lex-close', function () {
      _editingUserId = null;
    });
  }

  /**
   * Handle user form submission for both create and edit modes.
   * @param {Object} values - Form field values from lex-form.getValues()
   */
  function _handleUserFormSubmit(values) {
    var modal  = el('userModal');
    var submitBtn = modal ? modal.querySelector('lex-btn[type="submit"]') : null;

    // Extra validation: password required in create mode
    if (!_editingUserId) {
      var pwResult = validatePassword(values.password || '');
      if (!pwResult.valid) {
        var pwInput = el('userPassword');
        if (pwInput) pwInput.error = 'Password must have ' + pwResult.missing.join(', ') + '.';
        Lex.Toast.error('Password does not meet requirements');
        return;
      }
    }

    if (submitBtn) submitBtn.loading = true;

    var payload = {
      first_name: (values.first_name || '').trim(),
      last_name:  (values.last_name  || '').trim(),
      email:      (values.email      || '').trim(),
      username:   (values.username   || '').trim(),
      role_id:    values.role_id || ''
    };

    if (!_editingUserId && values.password) {
      payload.password = values.password;
    }

    var apiCall = _editingUserId
      ? api.updateUser(_editingUserId, payload)
      : api.createUser(payload);

    var isCreate = !_editingUserId;

    apiCall
      .then(function () {
        if (submitBtn) submitBtn.loading = false;
        if (modal) modal.open = false;
        _editingUserId = null;
        loadUsers();
        Lex.Toast.success(isCreate ? 'User created successfully' : 'User updated successfully');
      })
      .catch(function (err) {
        if (submitBtn) submitBtn.loading = false;
        console.error('[admin-users] save user error:', err);
        var msg = (err && err.message) ? err.message : 'Failed to save user';
        Lex.Toast.error(msg);
      });
  }

  // =========================================================================
  // Email / Username availability checks
  // =========================================================================

  /**
   * Check whether an email address is available and set error on the input.
   * @param {string} email
   * @param {Element} inputEl
   */
  function _checkEmailAvailability(email, inputEl) {
    api.checkEmail(email)
      .then(function (result) {
        var available = result && (result.available === true || result.is_available === true);
        if (!available) {
          inputEl.error = 'Email address is already in use';
        } else {
          inputEl.error = '';
        }
      })
      .catch(function () {
        // Silently ignore availability check errors
      });
  }

  /**
   * Check whether a username is available and set error on the input.
   * @param {string} username
   * @param {Element} inputEl
   */
  function _checkUsernameAvailability(username, inputEl) {
    api.checkUsername(username)
      .then(function (result) {
        var available = result && (result.available === true || result.is_available === true);
        if (!available) {
          inputEl.error = 'Username is already taken';
        } else {
          inputEl.error = '';
        }
      })
      .catch(function () {
        // Silently ignore availability check errors
      });
  }

  /**
   * Clear any error state on an availability-checked input.
   * @param {string} elId
   */
  function _clearAvailabilityHint(elId) {
    var elem = el(elId);
    if (elem) elem.error = '';
  }

  // =========================================================================
  // F. Delete User
  // =========================================================================

  /**
   * Prompt to confirm deletion, then call the API.
   * @param {string} userId
   * @param {Object} [user] - User data for display name in prompt.
   */
  function deleteUser(userId, user) {
    var name = user ? escHtml(userDisplayName(user)) : 'this user';

    Lex.Modal.confirm(
      'Delete User',
      'Are you sure you want to delete ' + name + '? This action cannot be undone.',
      function () {
        api.deleteUser(userId)
          .then(function () {
            loadUsers();
            // Close drawer if it was showing this user
            if (_drawerUserId === userId) {
              var drawer = el('userDrawer');
              if (drawer) drawer.open = false;
              _drawerUserId = null;
            }
            Lex.Toast.success('User deleted');
          })
          .catch(function (err) {
            console.error('[admin-users] deleteUser error:', err);
            var msg = (err && err.message) ? err.message : 'Failed to delete user';
            Lex.Toast.error(msg);
          });
      },
      { variant: 'danger', confirmText: 'Delete User' }
    );
  }

  // =========================================================================
  // G. User Details Drawer
  // =========================================================================

  /**
   * Open the user details drawer, showing a loading state first.
   * If `knownData` is provided it renders immediately and then fetches fresh data.
   * @param {string} userId
   * @param {Object} [knownData] - Optional pre-fetched user data.
   */
  function openDrawer(userId, knownData) {
    var drawer = el('userDrawer');
    if (!drawer) return;

    _drawerUserId = userId;

    // Show drawer in loading state
    show('userDrawerLoading');
    hide('userDrawerBody');
    drawer.open = true;

    // If we have data, render it immediately (better UX)
    if (knownData) {
      _renderDrawerBody(userId, knownData);
    }

    // Always re-fetch for freshest data
    api.getUser(userId)
      .then(function (result) {
        var user = (result && result.user) ? result.user : result;
        _renderDrawerBody(userId, user);
      })
      .catch(function (err) {
        console.error('[admin-users] getUser (drawer) error:', err);
        hide('userDrawerLoading');
        Lex.Toast.error('Failed to load user details');
      });
  }

  /**
   * Render the drawer body fields for the given user.
   * @param {string} userId
   * @param {Object} user
   */
  function _renderDrawerBody(userId, user) {
    if (!user) return;

    var drawer = el('userDrawer');
    if (!drawer) return;

    // Update module-level user reference so drawer action buttons use latest data
    _drawerUser   = user;
    _drawerUserId = userId;

    var name    = userDisplayName(user);
    var email   = String(user.email || '');
    var status  = String(user.status || (user.is_active ? 'active' : 'inactive'));
    var isActive = status === 'active';

    // Avatar
    var avatarEl = el('userDrawerAvatar');
    if (avatarEl) avatarEl.textContent = getInitials(name);

    // Name + email header
    var nameEl  = el('userDrawerName');
    var emailEl = el('userDrawerEmail');
    if (nameEl)  nameEl.textContent  = name;
    if (emailEl) emailEl.textContent = email;

    // KV pairs — set the .value property on lex-kv elements
    // lex-kv.value is set as textContent internally, so do NOT escHtml
    var kvUsername  = el('drawerKvUsername');
    var kvRole      = el('drawerKvRole');
    var kvStatus    = el('drawerKvStatus');
    var kvCreated   = el('drawerKvCreated');
    var kvLastLogin = el('drawerKvLastLogin');
    var kvOrgId     = el('drawerKvOrgId');

    if (kvUsername)  kvUsername.value  = String(user.username || '\u2014');
    if (kvRole)      kvRole.value     = userRoleName(user) || 'No role';
    if (kvStatus)    kvStatus.value   = status.charAt(0).toUpperCase() + status.substring(1);
    if (kvCreated)   kvCreated.value  = user.created_at ? fmtDateTime(user.created_at) : '\u2014';
    if (kvLastLogin) kvLastLogin.value = user.last_login_at ? fmtDateTime(user.last_login_at) : 'Never';
    if (kvOrgId)     kvOrgId.value    = String(user.organization_id || user.org_id || '\u2014');

    // Activate/Deactivate button label
    var statusBtn = el('drawerStatusBtn');
    if (statusBtn) {
      if (isActive) {
        statusBtn.textContent = 'Deactivate User';
        statusBtn.icon = 'toggle-left';
        statusBtn.variant = 'secondary';
      } else {
        statusBtn.textContent = 'Activate User';
        statusBtn.icon = 'toggle-right';
        statusBtn.variant = 'secondary';
      }
    }

    // Wire quick action buttons (idempotent — check flag before wiring)
    if (!drawer._drawerActionsWired) {
      _wireDrawerActionButtons(userId);
    }

    hide('userDrawerLoading');
    show('userDrawerBody');
  }

  /**
   * Lazy-wire the quick-action buttons inside the drawer.
   * Uses a flag to prevent duplicate listener attachment.
   * All handlers read _drawerUserId and _drawerUser at call time
   * so they always reference the currently-displayed user.
   * @param {string} userId - Initial user ID (fallback only).
   */
  function _wireDrawerActionButtons(userId) {
    var drawer = el('userDrawer');
    if (!drawer || drawer._drawerActionsWired) return;
    drawer._drawerActionsWired = true;

    var editBtn    = el('drawerEditBtn');
    var statusBtn  = el('drawerStatusBtn');
    var resetPwBtn = el('drawerResetPwBtn');
    var sessionsBtn= el('drawerSessionsBtn');
    var regenBtn   = el('drawerRegenKeyBtn');
    var deleteBtn  = el('drawerDeleteBtn');

    if (editBtn) {
      editBtn.addEventListener('click', function () {
        var uid = _drawerUserId || userId;
        drawer.open = false;
        _drawerUserId = null;
        _drawerUser   = null;
        openUserModalEdit(uid, null); // fetch fresh user data from API
      });
    }

    if (statusBtn) {
      statusBtn.addEventListener('click', function () {
        _toggleUserStatus(_drawerUserId || userId, _drawerUser);
      });
    }

    if (resetPwBtn) {
      resetPwBtn.addEventListener('click', function () {
        var uid = _drawerUserId || userId;
        openResetPasswordModal(uid, _drawerUser);
      });
    }

    if (sessionsBtn) {
      sessionsBtn.addEventListener('click', function () {
        var uid = _drawerUserId || userId;
        openSessionsModal(uid, _drawerUser);
      });
    }

    if (regenBtn) {
      regenBtn.addEventListener('click', function () {
        var uid = _drawerUserId || userId;
        regenActivationKey(uid);
      });
    }

    if (deleteBtn) {
      deleteBtn.addEventListener('click', function () {
        var uid = _drawerUserId || userId;
        deleteUser(uid, _drawerUser);
      });
    }
  }

  /**
   * Wire the drawer close event to clear state.
   */
  function _wireDrawerActions() {
    var drawer = el('userDrawer');
    if (!drawer || drawer._usersCloseWired) return;
    drawer._usersCloseWired = true;
    drawer.addEventListener('lex-close', function () {
      _drawerUserId = null;
      _drawerUser   = null;
    });
  }

  // =========================================================================
  // H. Reset Password Modal
  // =========================================================================

  /** User ID associated with the currently open reset-password modal. */
  var _resetPasswordUserId = null;

  /**
   * Open the reset password modal for a user.
   * @param {string} userId
   * @param {Object} [user] - User data for the modal heading.
   */
  function openResetPasswordModal(userId, user) {
    _resetPasswordUserId = userId;

    var modal = el('resetPasswordModal');
    if (!modal) return;

    var name = user ? userDisplayName(user) : '';
    // lex-modal.heading is set as textContent internally — do NOT escHtml
    modal.heading = name ? 'Reset Password \u2014 ' + name : 'Reset Password';

    var form = el('resetPasswordForm');
    if (form) form.reset();

    var hintEl = el('resetPasswordHint');
    if (hintEl) hintEl.textContent = '';

    modal.open = true;
  }

  /**
   * Wire the reset-password modal's form and confirm button.
   */
  function _wireResetPasswordModal() {
    var modal = el('resetPasswordModal');
    var form  = el('resetPasswordForm');
    if (!modal || !form) return;
    if (form._usersWired) return;
    form._usersWired = true;

    // Password strength hint
    var pwInput  = el('resetPasswordNew');
    var hintEl   = el('resetPasswordHint');
    if (pwInput && hintEl) {
      pwInput.addEventListener('lex-input', function () {
        var pw = pwInput.value || '';
        if (!pw) { hintEl.textContent = ''; return; }
        var result = validatePassword(pw);
        if (result.valid) {
          hintEl.textContent = 'Password meets all requirements.';
          hintEl.style.color = 'var(--lex-status-success-text,#027A48)';
        } else {
          hintEl.textContent = 'Missing: ' + result.missing.join(', ') + '.';
          hintEl.style.color = 'var(--lex-status-danger-text,#B42318)';
        }
      });
    }

    // Form submit
    form.addEventListener('lex-submit', function (e) {
      if (!e.detail.valid) {
        Lex.Toast.error('Please fill in both password fields');
        return;
      }
      _handleResetPasswordSubmit(e.detail.values);
    });

    // Cancel button inside the form (modal uses hide-actions)
    var cancelBtn = el('resetPasswordCancelBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        modal.open = false;
        _resetPasswordUserId = null;
      });
    }

    // Modal close event — clear state
    modal.addEventListener('lex-close', function () { _resetPasswordUserId = null; });
  }

  /**
   * Validate and submit the reset-password form.
   * @param {Object} values - { new_password, confirm_password }
   */
  function _handleResetPasswordSubmit(values) {
    var newPw     = values.new_password     || '';
    var confirmPw = values.confirm_password || '';

    // Validate password strength without regex
    var pwResult = validatePassword(newPw);
    if (!pwResult.valid) {
      var pwInput = el('resetPasswordNew');
      if (pwInput) pwInput.error = 'Password must have ' + pwResult.missing.join(', ') + '.';
      Lex.Toast.error('Password does not meet requirements');
      return;
    }

    // Cross-field match check
    if (newPw !== confirmPw) {
      var confirmInput = el('resetPasswordConfirm');
      if (confirmInput) confirmInput.error = 'Passwords do not match';
      Lex.Toast.error('Passwords do not match');
      return;
    }

    var modal     = el('resetPasswordModal');
    var submitBtn = modal ? modal.querySelector('lex-btn[type="submit"]') : null;
    if (submitBtn) submitBtn.loading = true;

    var uid = _resetPasswordUserId;

    api.setTemporaryPassword(uid, newPw)
      .then(function () {
        if (submitBtn) submitBtn.loading = false;
        if (modal) modal.open = false;
        _resetPasswordUserId = null;
        Lex.Toast.success('Password reset successfully. The user will be prompted to change it on next login.');
      })
      .catch(function (err) {
        if (submitBtn) submitBtn.loading = false;
        console.error('[admin-users] setTemporaryPassword error:', err);
        var msg = (err && err.message) ? err.message : 'Failed to reset password';
        Lex.Toast.error(msg);
      });
  }

  // =========================================================================
  // I. Activate / Deactivate User
  // =========================================================================

  /**
   * Toggle the active state of a user.
   * @param {string} userId
   * @param {Object} [user] - User object to determine current status.
   */
  function _toggleUserStatus(userId, user) {
    var status   = user ? String(user.status || (user.is_active ? 'active' : 'inactive')) : '';
    var isActive = status === 'active';

    var action     = isActive ? 'deactivate' : 'activate';
    var actionLabel = isActive ? 'Deactivate' : 'Activate';
    var name       = user ? escHtml(userDisplayName(user)) : 'this user';

    Lex.Modal.confirm(
      actionLabel + ' User',
      'Are you sure you want to ' + action + ' ' + name + '?',
      function () {
        var apiCall = isActive ? api.deactivateUser(userId) : api.activateUser(userId);

        apiCall
          .then(function () {
            loadUsers();
            var drawer = el('userDrawer');
            if (drawer && drawer.open) {
              drawer.open = false;
              _drawerUserId = null;
            }
            Lex.Toast.success('User ' + (isActive ? 'deactivated' : 'activated') + ' successfully');
          })
          .catch(function (err) {
            console.error('[admin-users] toggleUserStatus error:', err);
            var msg = (err && err.message) ? err.message : 'Failed to update user status';
            Lex.Toast.error(msg);
          });
      },
      { variant: isActive ? 'danger' : 'default', confirmText: actionLabel }
    );
  }

  // =========================================================================
  // J. Sessions Modal
  // =========================================================================

  /** User ID associated with the currently open sessions modal. */
  var _sessionsUserId = null;

  /**
   * Open the sessions modal and load sessions for the given user.
   * @param {string} userId
   * @param {Object} [user]
   */
  function openSessionsModal(userId, user) {
    _sessionsUserId = userId;

    var modal   = el('sessionsModal');
    var loading = el('sessionsLoading');
    var listEl  = el('sessionsListContainer');

    if (!modal) return;

    // lex-modal.heading is set as textContent internally — do NOT escHtml
    var name = user ? userDisplayName(user) : '';
    modal.heading = name ? 'Sessions \u2014 ' + name : 'User Sessions';

    if (loading)  show(loading);
    if (listEl)   { hide(listEl); listEl.innerHTML = ''; }

    modal.open = true;

    api.getUserSessions(userId)
      .then(function (result) {
        var sessions = [];
        if (Array.isArray(result)) {
          sessions = result;
        } else if (result && Array.isArray(result.sessions)) {
          sessions = result.sessions;
        } else if (result && Array.isArray(result.data)) {
          sessions = result.data;
        }

        if (loading) hide(loading);
        if (!listEl) return;

        if (sessions.length === 0) {
          listEl.innerHTML =
            '<lex-empty icon="monitor-off" message="No active sessions" ' +
            'description="This user has no active sessions"></lex-empty>';
          show(listEl);
          return;
        }

        var html = '<div style="display:flex;flex-direction:column;gap:0.5rem;">';
        for (var i = 0; i < sessions.length; i++) {
          var s = sessions[i];
          var device  = escHtml(String(s.device_info || s.user_agent || 'Unknown device'));
          var ip      = escHtml(String(s.ip_address || s.ip || ''));
          var created = s.created_at ? escHtml(fmtDateTime(s.created_at)) : '—';
          var expires = s.expires_at ? escHtml(fmtDate(s.expires_at)) : '—';

          html +=
            '<div style="padding:0.75rem;border-radius:var(--lex-radius-md,6px);' +
              'background:var(--lex-bg-secondary,#F5F5F0);border:1px solid var(--lex-border-default);">' +
              '<div style="font-size:var(--lex-body-sm-size,0.875rem);font-weight:500;' +
                'color:var(--lex-text-primary);margin-bottom:0.25rem;">' + device + '</div>' +
              '<div style="font-size:var(--lex-body-xs-size,0.75rem);color:var(--lex-text-tertiary);' +
                'display:flex;flex-wrap:wrap;gap:0.5rem 1rem;">' +
                (ip ? '<span>IP: ' + ip + '</span>' : '') +
                '<span>Created: ' + created + '</span>' +
                '<span>Expires: ' + expires + '</span>' +
              '</div>' +
            '</div>';
        }
        html += '</div>';
        listEl.innerHTML = html;
        show(listEl);
      })
      .catch(function (err) {
        console.error('[admin-users] getUserSessions error:', err);
        if (loading) hide(loading);
        if (listEl) {
          listEl.innerHTML =
            '<lex-empty icon="alert-circle" message="Failed to load sessions" ' +
            'description="' + escHtml((err && err.message) || 'Unknown error') + '"></lex-empty>';
          show(listEl);
        }
      });
  }

  /**
   * Wire the sessions modal's "Revoke All" and "Close" buttons.
   */
  function _wireSessionsModal() {
    var revokeBtn = el('revokeAllSessionsBtn');
    var closeBtn  = el('closeSessionsModalBtn');
    var modal     = el('sessionsModal');
    if (modal && modal._usersWired) return;
    if (modal) modal._usersWired = true;

    if (revokeBtn) {
      revokeBtn.addEventListener('click', function () {
        var uid = _sessionsUserId;
        if (!uid) return;

        Lex.Modal.confirm(
          'Revoke All Sessions',
          'Are you sure you want to revoke all sessions for this user? They will be signed out of all devices.',
          function () {
            api.revokeUserSessions(uid)
              .then(function () {
                if (modal) modal.open = false;
                _sessionsUserId = null;
                Lex.Toast.success('All sessions revoked');
                loadUsers();
              })
              .catch(function (err) {
                console.error('[admin-users] revokeUserSessions error:', err);
                var msg = (err && err.message) ? err.message : 'Failed to revoke sessions';
                Lex.Toast.error(msg);
              });
          },
          { variant: 'danger', confirmText: 'Revoke All' }
        );
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        var m = el('sessionsModal');
        if (m) m.open = false;
        _sessionsUserId = null;
      });
    }

    if (modal) {
      modal.addEventListener('lex-close', function () {
        _sessionsUserId = null;
      });
    }
  }

  // =========================================================================
  // K. Regenerate Activation Key
  // =========================================================================

  /**
   * Regenerate the activation key for a user and show the result.
   * @param {string} userId
   */
  function regenActivationKey(userId) {
    Lex.Modal.confirm(
      'Regenerate Activation Key',
      'This will invalidate the existing key and generate a new one. Continue?',
      function () {
        api.regenerateActivationKey(userId)
          .then(function (result) {
            var key = (result && (result.activation_key || result.key || result.token)) || null;
            if (key) {
              Lex.Modal.open({
                heading:     'New Activation Key',
                content:     '<p style="font-size:var(--lex-body-sm-size,0.875rem);color:var(--lex-text-secondary);margin:0 0 1rem;">' +
                               'Share this key with the user to activate their account. ' +
                               'It will only be shown once.' +
                             '</p>' +
                             '<div style="' +
                               'background:var(--lex-bg-secondary,#F5F5F0);' +
                               'border:1px solid var(--lex-border-default);' +
                               'border-radius:var(--lex-radius-md,6px);' +
                               'padding:0.75rem 1rem;' +
                               'font-family:monospace;' +
                               'font-size:var(--lex-body-sm-size,0.875rem);' +
                               'word-break:break-all;' +
                             '">' +
                               escHtml(String(key)) +
                             '</div>',
                size:        'sm',
                hideActions: true
              });
            } else {
              Lex.Toast.success('Activation key regenerated successfully');
            }
            loadUsers();
          })
          .catch(function (err) {
            console.error('[admin-users] regenerateActivationKey error:', err);
            var msg = (err && err.message) ? err.message : 'Failed to regenerate key';
            Lex.Toast.error(msg);
          });
      },
      { confirmText: 'Regenerate' }
    );
  }

  // =========================================================================
  // Bootstrap
  // =========================================================================

  init();

})();
