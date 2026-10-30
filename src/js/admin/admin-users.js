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
 * @requires lex.utils.js    - Lex.Utils.escapeHtml, Lex.Utils.formatDateTime, Lex.Utils.humanizeLabel
 * @requires lex-toast.js    - Lex.Toast.success, Lex.Toast.error
 * @requires lex-table.js    - server-paged table (setServerData)
 * @requires admin-table-kit.js - AdminTableKit toolbar + cell helpers
 * @requires library-column-filters.js - date-range filter bounds
 * @requires lex-form.js     - form.getValues(), form.reset(), form.validate()
 * @requires lex-nav.js      - Lex.Nav.go
 */

(function () {
  'use strict';

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

  /** Toolbar search term (the table owns paging, sort and filters). */
  var _searchTerm = '';

  /** Toolbar handle from AdminTableKit.bindToolbar. */
  var _toolbar = null;

  var TABLE_ID = 'usersTable';

  // Table column -> admin users API sort_by.
  var SORT_BY_COLUMN = { email: 'email', username: 'username', status: 'status', created_at: 'created_at' };

  // Status values the user write paths accept.
  var USER_STATUSES = ['active', 'inactive', 'suspended', 'deactivated'];

  var STATUS_COLORS = { active: 'green', inactive: 'gray', deactivated: 'gray', suspended: 'red', pending: 'yellow', invited: 'yellow' };


  // =========================================================================
  // Entry point
  // =========================================================================

  /**
   * Initialise the page: wire events, load data.
   */
  function init() {
    _wireHeaderButtons();
    _wireUserModal();

    // ?action=create (e.g. "Invite your team" in the onboarding tour) opens the
    // Add User modal, mirroring workspaces.html?action=create.
    var search = (window.location && window.location.search) || '';
    if (new URLSearchParams(search).get('action') === 'create') {
      openUserModalCreate();
    }

    // Topbar refresh button
    document.addEventListener('lex-refresh', function (e) {
      e.preventDefault();
      loadUsers();
    });

    loadRoles();
    _initTable();
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
  // A. Users table — server-paged (docs/TABLE-STANDARD.md)
  // =========================================================================

  /**
   * The admin users API query for a lex-table server query.
   * Filters the API does not take yet (name/email/username contains, Created
   * range, several statuses or roles) are sent under the standard names so
   * they apply once the API reads them.
   * @param {Object} query - { page, limit, sortBy, sortDir, filters }
   * @param {string} search - toolbar search
   * @param {Date} [now]
   * @returns {URLSearchParams}
   */
  function toApiParams(query, search, now) {
    var kit = window.AdminTableKit;
    var q = query || {};
    var filters = q.filters || {};
    var params = new URLSearchParams();
    params.set('page', String(q.page || 1));
    params.set('page_size', String(q.limit || 20));
    params.set('sort_by', SORT_BY_COLUMN[q.sortBy] || 'created_at');
    params.set('sort_order', q.sortDir === 'asc' ? 'asc' : 'desc');
    if (search) params.set('search', search);
    ['name', 'email', 'username'].forEach(function (col) {
      var text = kit.firstFilterValue(filters, col);
      if (text) params.set(col, text);
    });
    var statuses = kit.filterValues(filters.status);
    if (statuses.length) params.set('status_filter', statuses.join(','));
    var roles = kit.filterValues(filters.role);
    if (roles.length) params.set('role_id_filter', roles.join(','));
    kit.setRange(params, filters, 'created_at', 'created_after', 'created_before', now);
    return params;
  }

  /**
   * One table row per user: raw values, the record as _raw.
   * @param {Object} u
   * @returns {Object}
   */
  function mapUser(u) {
    return {
      id:         String(u.id || u.user_id || ''),
      name:       userDisplayName(u),
      email:      String(u.email || ''),
      username:   String(u.username || ''),
      role:       String(u.role_id || ''),
      status:     String(u.status || (u.is_active ? 'active' : 'inactive')),
      created_at: u.created_at || '',
      _raw:       u
    };
  }

  function cellRenderers() {
    var kit = window.AdminTableKit;
    return {
      name: function (val, row) { return kit.nameCell(val || row.username || row.email); },
      email: function (val) { return val ? '<span class="admin-table-text" title="' + kit.esc(val) + '">' + kit.esc(val) + '</span>' : kit.muted(''); },
      username: function (val) { return val ? '<span class="admin-table-text">' + kit.esc(val) + '</span>' : kit.muted(''); },
      role: function (val, row) {
        var label = userRoleName(row._raw);
        return label ? '<span class="admin-table-text">' + kit.esc(Lex.Utils.humanizeLabel(label)) + '</span>' : kit.muted('No role');
      },
      status: function (val) {
        var key = String(val || '').toLowerCase();
        return kit.badge(Lex.Utils.humanizeLabel(key), STATUS_COLORS[key] || 'gray');
      },
      created_at: function (val) { return kit.timeCell(val); }
    };
  }

  /**
   * Header filters for every column. Roles come from the role list.
   * @param {Array} roles
   */
  function filterOptions(roles) {
    var kit = window.AdminTableKit;
    var map = {
      name:     { text: true, placeholder: 'Name contains...' },
      email:    { text: true, placeholder: 'Email contains...' },
      username: { text: true, placeholder: 'Username contains...' },
      status:   { options: kit.labelOptions(USER_STATUSES) },
      created_at: kit.dateRangeFilter()
    };
    var roleOptions = (roles || []).map(function (r) {
      return { value: String(r.id), label: Lex.Utils.humanizeLabel(r.display_name || r.name || r.role_name || r.id) };
    }).filter(function (o) { return o.value; });
    if (roleOptions.length) map.role = { options: roleOptions };
    return map;
  }

  function _table() {
    return el(TABLE_ID);
  }

  function _initTable() {
    var table = _table();
    if (!table) return;
    window.AdminTableKit.whenTableReady().then(function () {
      if (_table() !== table) return;
      // Renderers before the first page lands.
      table.setCellRenderers(cellRenderers());
      table.setColumnFilterOptions(filterOptions(_roles));
      _toolbar = window.AdminTableKit.bindToolbar({
        table: table,
        searchId: 'usersSearch',
        sortId: 'usersSort',
        orderId: 'usersSortOrder',
        filterId: 'usersStatusFilter',
        filterKey: 'status',
        countIds: ['usersCount', 'usersSectionCount'],
        noun: ['user', 'users'],
        onSearch: function (term) {
          _searchTerm = term;
          table.requestServerQuery({ resetPage: true });
        }
      });
      table.addEventListener('lex-query-change', function (e) {
        if (e.target !== table) return;
        _fetchUsers(e.detail);
      });
      table.addEventListener('row-click', function (e) {
        var row = e.detail && e.detail.row;
        if (row && row.id) {
          Lex.Nav.go('admin/user-details.html', { params: { userId: row.id } });
        }
      });
      table.requestServerQuery({ resetPage: true });
    });
  }

  /**
   * Reload the current page (after a create/edit or a topbar refresh).
   */
  function loadUsers() {
    var table = _table();
    if (table && typeof table.requestServerQuery === 'function') table.requestServerQuery();
  }

  /**
   * Answer the table's lex-query-change with one page of users.
   * A generation counter drops stale answers.
   * @param {Object} query
   */
  function _fetchUsers(query) {
    var gen = ++_gen;
    var table = _table();
    if (!table) return;
    query = query || table.serverQuery;
    var filters = query.filters || {};
    var filtered = Boolean(_searchTerm || Object.keys(filters).length);
    if (_toolbar) _toolbar.syncFilter(filters);

    api.get('/api/v1/admin/users?' + toApiParams(query, _searchTerm).toString())
      .then(function (result) {
        if (gen !== _gen) return; // stale response — discard
        var normalized = AdminUsersPagination.normalizeAdminUsersResponse(result);
        var pagination = (result && result.pagination) || {};
        table.emptyText = window.AdminTableKit.emptyText(filtered, 'users');
        table.setServerData(normalized.users.map(mapUser), {
          page: pagination.page || query.page,
          page_size: pagination.page_size || query.limit,
          total: normalized.total,
          total_pages: pagination.total_pages
        });
      })
      .catch(function (err) {
        if (gen !== _gen) return;
        console.error('[admin-users] loadUsers error:', err);
        if (_toolbar) _toolbar.setCount(null);
        table.setServerError('Users could not be loaded. Check your connection and try again.');
      });
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
        var table = _table();
        if (table && typeof table.setColumnFilterOptions === 'function') {
          table.setColumnFilterOptions(filterOptions(_roles));
        }
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

    // Save sits in the modal footer as <lex-btn type="submit" form="userForm">;
    // lex-form emits lex-submit for it.

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

    // Cancel button in the modal footer (footer-content)
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

  // Pure table logic, exposed for unit tests.
  window.AdminUsersTable = {
    toApiParams: toApiParams,
    mapUser: mapUser,
    cellRenderers: cellRenderers,
    filterOptions: filterOptions,
    SORT_BY_COLUMN: SORT_BY_COLUMN
  };

  // =========================================================================
  // Bootstrap
  // =========================================================================

  init();

})();
