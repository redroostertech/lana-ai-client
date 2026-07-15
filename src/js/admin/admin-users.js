/**
 * Admin User Management — standalone page controller.
 *
 * Handles user listing and creation for the admin panel.
 * Row-click navigates to admin/user-details.html for full profile,
 * sessions, and management actions.
 *
 * @requires api.js          - window.api — getUsers, getUser, createUser, updateUser,
 *                              checkEmail, checkUsername, getRoles
 * @requires admin-users.pagination.js - API pagination response normalization
 * @requires lex.utils.js    - Lex.Utils.escapeHtml, Lex.Utils.formatDate
 * @requires lex-toast.js    - Lex.Toast.success, Lex.Toast.error
 * @requires lex-table.js    - table.setData()
 * @requires lex-form.js     - form.getValues(), form.reset(), form.validate()
 * @requires lex-nav.js      - Lex.Nav.go
 */

(function () {
  'use strict';

  // =========================================================================
  // Lex aliases (shell singletons — set once, never re-declared)
  // =========================================================================

  var escHtml    = Lex.Utils.escapeHtml;
  var fmtDate    = Lex.Utils.formatDate;

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

  /** Pagination state */
  var _currentPage = 1;
  var _pageSize    = 20;


  // =========================================================================
  // Entry point
  // =========================================================================

  /**
   * Initialise the page: wire events, load data.
   */
  function init() {
    _wireHeaderButtons();
    _wireUserModal();
    _wirePagination();

    // Topbar refresh button
    document.addEventListener('lex-refresh', function (e) {
      e.preventDefault();
      _currentPage = 1;
      loadUsers();
    });

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

    api.getUsers(_currentPage, _pageSize, {})
      .then(function (result) {
        if (gen !== _gen) return; // stale response — discard

        var normalized = AdminUsersPagination.normalizeAdminUsersResponse(result);
        var users = normalized.users;
        var total = normalized.total;

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
        _updatePagination(total);
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
      if (row) {
        Lex.Nav.go('admin/user-details.html', { params: { userId: row._id } });
      }
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
  // Pagination
  // =========================================================================

  /**
   * Update the lex-pagination component with current state.
   * @param {number} total - Total number of users from the API.
   */
  function _updatePagination(total) {
    var pager = el('pagination');
    if (!pager) return;

    var totalPages = Math.ceil(total / _pageSize) || 1;
    pager.page       = _currentPage;
    pager.totalPages = totalPages;
    pager.total      = total;
    pager.limit      = _pageSize;
  }

  /**
   * Wire the page-change event from lex-pagination.
   */
  function _wirePagination() {
    var pager = el('pagination');
    if (!pager || pager._usersWired) return;
    pager._usersWired = true;

    pager.addEventListener('page-change', function (e) {
      var page = e.detail && e.detail.page;
      if (page && page !== _currentPage) {
        _currentPage = page;
        loadUsers();
      }
    });
  }

  // =========================================================================
  // Bootstrap
  // =========================================================================

  init();

})();
