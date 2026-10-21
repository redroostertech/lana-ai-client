/**
 * Admin User Details — standalone page controller.
 *
 * Shows full profile, active sessions, and management actions for a single
 * user. Reached via row-click on admin/users.html or direct deep link.
 *
 * URL param: ?userId=<uuid>
 *
 * @requires api.js          - window.api — getUser, updateUser, deleteUser,
 *                              activateUser, deactivateUser, setTemporaryPassword,
 *                              getUserSessions, revokeUserSessions,
 *                              regenerateActivationKey, getRoles, checkEmail,
 *                              checkUsername
 * @requires lex.utils.js    - Lex.Utils.escapeHtml,
 *                              Lex.Utils.formatDateTime
 * @requires lex-modal.js    - Lex.Modal.confirm, Lex.Modal.open
 * @requires lex-toast.js    - Lex.Toast.success, Lex.Toast.error
 * @requires lex-table.js    - server-paged sessions table (setServerData)
 * @requires admin-table-kit.js - AdminTableKit toolbar + cell helpers
 * @requires library-column-filters.js - date-range filter bounds
 * @requires lex-form.js     - form.getValues(), form.reset(), form.validate()
 * @requires lex-nav.js      - Lex.Nav.go, Lex.Nav.getParams
 */

(function () {
  'use strict';

  // =========================================================================
  // Lex aliases
  // =========================================================================

  var escHtml     = Lex.Utils.escapeHtml;
  var fmtDateTime = Lex.Utils.formatDateTime;

  // =========================================================================
  // Module-level state
  // =========================================================================

  /** The user ID from the URL param. */
  var _userId = null;

  /** Full user object after fetch. */
  var _user = null;

  /** Roles cache. */
  var _roles = [];

  /** Sessions table: search term, stale-answer counter, toolbar handle. */
  var _sessionsSearch = '';
  var _sessionsGen = 0;
  var _sessionsToolbar = null;

  var SESSIONS_TABLE_ID = 'userSessionsTable';

  // Table column -> user sessions API sort_by (the API's allow-list).
  var SESSION_SORT_BY_COLUMN = { created_at: 'created_at', last_activity: 'last_activity', expires_at: 'expires_at' };

  // =========================================================================
  // Helpers (duplicated from admin-users.js — module-scoped)
  // =========================================================================

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

  function setInputValue(elId, value) {
    var elem = el(elId);
    if (elem) elem.value = (value !== null && value !== undefined) ? String(value) : '';
  }

  function getInitials(name) {
    if (!name) return '?';
    var parts = name.split(' ');
    var first = parts[0] ? parts[0].charAt(0) : '';
    var last  = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
    return (first + last).toUpperCase() || '?';
  }

  function userDisplayName(user) {
    if (!user) return '';
    var first = String(user.first_name || user.firstName || '').trim();
    var last  = String(user.last_name  || user.lastName  || '').trim();
    if (first || last) return (first + ' ' + last).trim();
    return String(user.username || user.name || '').trim();
  }

  function userRoleName(user) {
    if (!user) return '';
    if (user.role_name) return String(user.role_name);
    if (user.role && user.role.name) return String(user.role.name);
    if (Array.isArray(user.roles) && user.roles.length > 0) {
      return String(user.roles[0].name || user.roles[0].role_name || '');
    }
    return '';
  }

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

  // =========================================================================
  // Entry point
  // =========================================================================

  function init() {
    var params = Lex.Nav.getParams();
    _userId = params.get('userId');

    if (!_userId) {
      Lex.Toast.error('No user ID specified');
      Lex.Nav.go('admin/users.html');
      return;
    }

    _wireDropdownActions();
    _wireEditModal();
    _wireResetPasswordModal();
    _wireRevokeAll();

    // Topbar refresh button
    document.addEventListener('lex-refresh', function (e) {
      e.preventDefault();
      _loadUser(_userId);
      _loadSessions();
    });

    _loadRoles();
    _loadUser(_userId);
    _initSessionsTable();
  }

  // =========================================================================
  // A. Load User
  // =========================================================================

  function _loadUser(userId) {
    var banner = el('userBanner');
    if (banner) Lex.Redact.on(banner);

    api.getUser(userId)
      .then(function (result) {
        var user = (result && result.user) ? result.user : result;
        _user = user;

        if (banner) Lex.Redact.off(banner);
        _populateProfile(user);
      })
      .catch(function (err) {
        if (banner) Lex.Redact.off(banner);
        console.error('[admin-user-details] loadUser error:', err);
        Lex.Toast.error('Failed to load user details');
      });
  }

  function _populateProfile(user) {
    if (!user) return;

    var name   = userDisplayName(user);
    var email  = String(user.email || '');
    var status = String(user.status || (user.is_active ? 'active' : 'inactive'));
    var isActive = status === 'active';

    // Banner
    var banner = el('userBanner');
    if (banner) {
      banner.heading  = name || 'Unknown User';
      banner.subtitle = email || '';
    }

    // Breadcrumb
    var breadcrumb = el('userBreadcrumb');
    if (breadcrumb) {
      breadcrumb.items = [
        { label: 'Administration', href: 'admin/index.html' },
        { label: 'User Management', href: 'admin/users.html' },
        { label: name || 'User Details' }
      ];
    }

    // Update dropdown toggle-status label.
    // Defer to next frame: the banner property changes above schedule a
    // microtask re-render that replaces children with clones of the originals.
    // We must wait for that re-render to finish before updating the cloned
    // dropdown's options, otherwise the update is overwritten.
    requestAnimationFrame(function () {
      _updateStatusAction(isActive);
    });

    // Avatar
    var avatarEl = el('userAvatar');
    if (avatarEl) avatarEl.textContent = getInitials(name);

    // Name + email
    var nameEl  = el('userDisplayName');
    var emailEl = el('userEmailDisplay');
    if (nameEl)  nameEl.textContent  = name;
    if (emailEl) emailEl.textContent = email;

    // KV pairs
    var kvUsername  = el('kvUsername');
    var kvRole      = el('kvRole');
    var kvStatus    = el('kvStatus');
    var kvCreated   = el('kvCreated');
    var kvLastLogin = el('kvLastLogin');
    var kvOrgId     = el('kvOrgId');

    if (kvUsername)  kvUsername.value  = String(user.username || '\u2014');
    if (kvRole)      kvRole.value     = userRoleName(user) || 'No role';
    if (kvStatus)    kvStatus.value   = status.charAt(0).toUpperCase() + status.substring(1);
    if (kvCreated)   kvCreated.value  = user.created_at ? fmtDateTime(user.created_at) : '\u2014';
    if (kvLastLogin) kvLastLogin.value = user.last_login_at ? fmtDateTime(user.last_login_at) : 'Never';
    if (kvOrgId)     kvOrgId.value    = String(user.organization_id || user.org_id || '\u2014');
  }

  /**
   * Update the toggle-status dropdown item label based on current status.
   */
  function _updateStatusAction(isActive) {
    var dropdown = el('userActionsDropdown');
    if (!dropdown) return;

    var opts = dropdown.options || [];
    var updated = [];
    for (var i = 0; i < opts.length; i++) {
      var opt = {};
      var keys = Object.keys(opts[i]);
      for (var k = 0; k < keys.length; k++) {
        opt[keys[k]] = opts[i][keys[k]];
      }
      if (opt.value === 'toggle-status') {
        opt.label = isActive ? 'Deactivate User' : 'Activate User';
        opt.icon  = isActive ? 'toggle-left' : 'toggle-right';
      }
      updated.push(opt);
    }
    dropdown.options = updated;
  }

  // =========================================================================
  // B. Sessions table — server-paged (docs/TABLE-STANDARD.md)
  // =========================================================================

  /**
   * The user sessions API query for a lex-table server query. Filters the
   * API does not read yet go under the standard names (see the report).
   */
  function sessionsApiParams(query, search, now) {
    var kit = window.AdminTableKit;
    var q = query || {};
    var filters = q.filters || {};
    var params = new URLSearchParams();
    params.set('page', String(q.page || 1));
    params.set('page_size', String(q.limit || 20));
    params.set('sort_by', SESSION_SORT_BY_COLUMN[q.sortBy] || 'created_at');
    params.set('sort_order', q.sortDir === 'asc' ? 'asc' : 'desc');
    if (search) params.set('search', search);
    var device = kit.firstFilterValue(filters, 'device');
    if (device) params.set('device', device);
    var ip = kit.firstFilterValue(filters, 'ip_address');
    if (ip) params.set('ip_address_filter', ip);
    kit.setRange(params, filters, 'created_at', 'created_after', 'created_before', now);
    kit.setRange(params, filters, 'last_activity', 'last_activity_after', 'last_activity_before', now);
    kit.setRange(params, filters, 'expires_at', 'expires_after', 'expires_before', now);
    return params;
  }

  function mapSession(s) {
    return {
      id:            String(s.session_id || s.id || ''),
      device:        String(s.device_info || s.user_agent || ''),
      ip_address:    String(s.ip_address || s.ip || ''),
      created_at:    s.created_at || '',
      last_activity: s.last_activity || '',
      expires_at:    s.expires_at || '',
      _raw:          s
    };
  }

  function sessionCellRenderers() {
    var kit = window.AdminTableKit;
    return {
      device: function (val, row) {
        if (!val) return kit.muted('Unknown device');
        var current = row._raw && row._raw.is_current ? '<span class="admin-table-sub">This session</span>' : '';
        return '<span class="admin-table-name" title="' + kit.esc(val) + '" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + kit.esc(val) + '</span>' + current;
      },
      ip_address: function (val) { return val ? '<span class="admin-table-text">' + kit.esc(val) + '</span>' : kit.muted(''); },
      created_at: function (val) { return kit.timeCell(val); },
      last_activity: function (val) { return kit.relativeCell(val); },
      expires_at: function (val) { return kit.timeCell(val); }
    };
  }

  function sessionFilterOptions() {
    var kit = window.AdminTableKit;
    return {
      device:        { text: true, placeholder: 'Device contains...' },
      ip_address:    { text: true, placeholder: 'IP address is...' },
      created_at:    kit.dateRangeFilter(),
      last_activity: kit.dateRangeFilter(),
      expires_at:    kit.dateRangeFilter()
    };
  }

  function _initSessionsTable() {
    var table = el(SESSIONS_TABLE_ID);
    if (!table) return;
    window.AdminTableKit.whenTableReady().then(function () {
      if (el(SESSIONS_TABLE_ID) !== table) return;
      table.setCellRenderers(sessionCellRenderers());
      table.setColumnFilterOptions(sessionFilterOptions());
      _sessionsToolbar = window.AdminTableKit.bindToolbar({
        table: table,
        searchId: 'userSessionsSearch',
        sortId: 'userSessionsSort',
        orderId: 'userSessionsSortOrder',
        countIds: ['userSessionsCount'],
        noun: ['session', 'sessions'],
        onSearch: function (term) {
          _sessionsSearch = term;
          table.requestServerQuery({ resetPage: true });
        }
      });
      table.addEventListener('lex-query-change', function (e) {
        if (e.target === table) _fetchSessions(e.detail);
      });
      table.requestServerQuery({ resetPage: true });
    });
  }

  /** Reload the sessions page (after Revoke All or a refresh). */
  function _loadSessions() {
    var table = el(SESSIONS_TABLE_ID);
    if (table && typeof table.requestServerQuery === 'function') table.requestServerQuery({ resetPage: true });
  }

  function _fetchSessions(query) {
    var gen = ++_sessionsGen;
    var table = el(SESSIONS_TABLE_ID);
    if (!table) return;
    query = query || table.serverQuery;
    var filters = query.filters || {};
    var filtered = Boolean(_sessionsSearch || Object.keys(filters).length);

    api.get('/api/v1/admin/users/' + encodeURIComponent(_userId) + '/sessions?' + sessionsApiParams(query, _sessionsSearch).toString())
      .then(function (result) {
        if (gen !== _sessionsGen) return;
        var sessions = Array.isArray(result) ? result : ((result && (result.sessions || result.data)) || []);
        var pagination = (result && result.pagination) || {};
        var total = pagination.total_count !== undefined ? pagination.total_count : (result && result.total);
        table.emptyText = filtered
          ? 'No matching sessions. Try a different search or clear the filters.'
          : 'No active sessions';
        table.setServerData(sessions.map(mapSession), {
          page: pagination.page || query.page,
          page_size: pagination.page_size || query.limit,
          total: Number.isFinite(Number(total)) ? Number(total) : sessions.length,
          total_pages: pagination.total_pages
        });
      })
      .catch(function (err) {
        if (gen !== _sessionsGen) return;
        console.error('[admin-user-details] loadSessions error:', err);
        if (_sessionsToolbar) _sessionsToolbar.setCount(null);
        table.setServerError('Sessions could not be loaded. Check your connection and try again.');
      });
  }

  // =========================================================================
  // C. Load Roles
  // =========================================================================

  function _loadRoles() {
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
        console.error('[admin-user-details] loadRoles error:', err);
      });
  }

  function _populateRoleSelect() {
    var select = el('userRole');
    if (!select) return;
    var opts = _roles.map(function (r) {
      return { value: String(r.id), label: String(r.name || r.role_name || r.id) };
    });
    select.options = opts;
  }

  // =========================================================================
  // D. Dropdown Actions
  // =========================================================================

  /**
   * Wire dropdown actions using event delegation on the banner.
   *
   * The dropdown lives inside <lex-banner> which uses Light DOM content
   * preservation (cloneNode). Every time a banner property changes (heading,
   * subtitle), the banner re-renders and replaces all children with fresh
   * clones — destroying any event listeners attached directly to the
   * dropdown element. Delegating from the banner avoids this because the
   * banner element itself is stable; bubbling lex-select events from
   * whichever dropdown clone is current will still reach it.
   */
  function _wireDropdownActions() {
    var banner = el('userBanner');
    if (!banner || banner._detailsActionsWired) return;
    banner._detailsActionsWired = true;

    banner.addEventListener('lex-select', function (e) {
      var action = e.detail && e.detail.value;

      if (action === 'edit') {
        _openEditModal();
      } else if (action === 'toggle-status') {
        _toggleUserStatus();
      } else if (action === 'reset-pw') {
        _openResetPasswordModal();
      } else if (action === 'regen-key') {
        _regenActivationKey();
      } else if (action === 'delete') {
        _deleteUser();
      }
    });
  }

  // =========================================================================
  // E. Edit User Modal
  // =========================================================================

  function _openEditModal() {
    var modal = el('userModal');
    if (!modal || !_user) return;

    modal.heading = 'Edit User';

    _populateRoleSelect();
    _populateUserForm(_user);

    modal.open = true;
  }

  function _populateUserForm(user) {
    if (!user) return;
    setInputValue('userFirstName', user.first_name || user.firstName || '');
    setInputValue('userLastName',  user.last_name  || user.lastName  || '');
    setInputValue('userEmail',     user.email    || '');
    setInputValue('userUsername',  user.username || '');

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

  function _wireEditModal() {
    var modal = el('userModal');
    var form  = el('userForm');
    if (!modal || !form) return;
    if (form._detailsWired) return;
    form._detailsWired = true;

    form.addEventListener('lex-submit', function (e) {
      if (!e.detail.valid) {
        Lex.Toast.error('Please fill in all required fields');
        return;
      }
      _handleEditSubmit(e.detail.values);
    });

    var cancelBtn = el('userModalCancelBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        modal.open = false;
      });
    }
  }

  function _handleEditSubmit(values) {
    var modal     = el('userModal');
    var submitBtn = modal ? modal.querySelector('lex-btn[type="submit"]') : null;

    if (submitBtn) submitBtn.loading = true;

    var payload = {
      first_name: (values.first_name || '').trim(),
      last_name:  (values.last_name  || '').trim(),
      email:      (values.email      || '').trim(),
      username:   (values.username   || '').trim(),
      role_id:    values.role_id || ''
    };

    api.updateUser(_userId, payload)
      .then(function () {
        if (submitBtn) submitBtn.loading = false;
        if (modal) modal.open = false;
        Lex.Toast.success('User updated successfully');
        _loadUser(_userId);
      })
      .catch(function (err) {
        if (submitBtn) submitBtn.loading = false;
        console.error('[admin-user-details] updateUser error:', err);
        var msg = (err && err.message) ? err.message : 'Failed to save user';
        Lex.Toast.error(msg);
      });
  }

  // =========================================================================
  // F. Toggle User Status
  // =========================================================================

  function _toggleUserStatus() {
    if (!_user) return;

    var status   = String(_user.status || (_user.is_active ? 'active' : 'inactive'));
    var isActive = status === 'active';
    var action     = isActive ? 'deactivate' : 'activate';
    var actionLabel = isActive ? 'Deactivate' : 'Activate';
    var name       = escHtml(userDisplayName(_user));

    Lex.Modal.confirm(
      actionLabel + ' User',
      'Are you sure you want to ' + action + ' ' + name + '?',
      function () {
        var apiCall = isActive ? api.deactivateUser(_userId) : api.activateUser(_userId);

        apiCall
          .then(function () {
            Lex.Toast.success('User ' + (isActive ? 'deactivated' : 'activated') + ' successfully');
            _loadUser(_userId);
          })
          .catch(function (err) {
            console.error('[admin-user-details] toggleUserStatus error:', err);
            var msg = (err && err.message) ? err.message : 'Failed to update user status';
            Lex.Toast.error(msg);
          });
      },
      { variant: isActive ? 'danger' : 'default', confirmText: actionLabel }
    );
  }

  // =========================================================================
  // G. Reset Password Modal
  // =========================================================================

  function _openResetPasswordModal() {
    var modal = el('resetPasswordModal');
    if (!modal) return;

    var name = _user ? userDisplayName(_user) : '';
    modal.heading = name ? 'Reset Password \u2014 ' + name : 'Reset Password';

    var form = el('resetPasswordForm');
    if (form) form.reset();

    var hintEl = el('resetPasswordHint');
    if (hintEl) hintEl.textContent = '';

    modal.open = true;
  }

  function _wireResetPasswordModal() {
    var modal = el('resetPasswordModal');
    var form  = el('resetPasswordForm');
    if (!modal || !form) return;
    if (form._detailsWired) return;
    form._detailsWired = true;

    // Password strength hint
    var pwInput = el('resetPasswordNew');
    var hintEl  = el('resetPasswordHint');
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

    // Cancel button
    var cancelBtn = el('resetPasswordCancelBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        modal.open = false;
      });
    }
  }

  function _handleResetPasswordSubmit(values) {
    var newPw     = values.new_password     || '';
    var confirmPw = values.confirm_password || '';

    var pwResult = validatePassword(newPw);
    if (!pwResult.valid) {
      var pwInput = el('resetPasswordNew');
      if (pwInput) pwInput.error = 'Password must have ' + pwResult.missing.join(', ') + '.';
      Lex.Toast.error('Password does not meet requirements');
      return;
    }

    if (newPw !== confirmPw) {
      var confirmInput = el('resetPasswordConfirm');
      if (confirmInput) confirmInput.error = 'Passwords do not match';
      Lex.Toast.error('Passwords do not match');
      return;
    }

    var modal     = el('resetPasswordModal');
    var submitBtn = modal ? modal.querySelector('lex-btn[type="submit"]') : null;
    if (submitBtn) submitBtn.loading = true;

    api.setTemporaryPassword(_userId, newPw)
      .then(function () {
        if (submitBtn) submitBtn.loading = false;
        if (modal) modal.open = false;
        Lex.Toast.success('Password reset successfully. The user will be prompted to change it on next login.');
      })
      .catch(function (err) {
        if (submitBtn) submitBtn.loading = false;
        console.error('[admin-user-details] setTemporaryPassword error:', err);
        var msg = (err && err.message) ? err.message : 'Failed to reset password';
        Lex.Toast.error(msg);
      });
  }

  // =========================================================================
  // H. Regenerate Activation Key
  // =========================================================================

  function _regenActivationKey() {
    Lex.Modal.confirm(
      'Regenerate Activation Key',
      'This will invalidate the existing key and generate a new one. Continue?',
      function () {
        api.regenerateActivationKey(_userId)
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
          })
          .catch(function (err) {
            console.error('[admin-user-details] regenerateActivationKey error:', err);
            var msg = (err && err.message) ? err.message : 'Failed to regenerate key';
            Lex.Toast.error(msg);
          });
      },
      { confirmText: 'Regenerate' }
    );
  }

  // =========================================================================
  // I. Delete User
  // =========================================================================

  function _deleteUser() {
    var name = _user ? escHtml(userDisplayName(_user)) : 'this user';

    Lex.Modal.confirm(
      'Delete User',
      'Are you sure you want to delete ' + name + '? This action cannot be undone.',
      function () {
        api.deleteUser(_userId)
          .then(function () {
            Lex.Toast.success('User deleted');
            Lex.Nav.go('admin/users.html');
          })
          .catch(function (err) {
            console.error('[admin-user-details] deleteUser error:', err);
            var msg = (err && err.message) ? err.message : 'Failed to delete user';
            Lex.Toast.error(msg);
          });
      },
      { variant: 'danger', confirmText: 'Delete User' }
    );
  }

  // =========================================================================
  // J. Revoke All Sessions
  // =========================================================================

  function _wireRevokeAll() {
    var btn = el('revokeAllBtn');
    if (!btn || btn._detailsWired) return;
    btn._detailsWired = true;

    btn.addEventListener('click', function () {
      Lex.Modal.confirm(
        'Revoke All Sessions',
        'Are you sure you want to revoke all sessions for this user? They will be signed out of all devices.',
        function () {
          api.revokeUserSessions(_userId)
            .then(function () {
              Lex.Toast.success('All sessions revoked');
              _loadSessions();
            })
            .catch(function (err) {
              console.error('[admin-user-details] revokeUserSessions error:', err);
              var msg = (err && err.message) ? err.message : 'Failed to revoke sessions';
              Lex.Toast.error(msg);
            });
        },
        { variant: 'danger', confirmText: 'Revoke All' }
      );
    });
  }

  // Pure sessions-table logic, exposed for unit tests.
  window.AdminUserSessionsTable = {
    toApiParams: sessionsApiParams,
    mapSession: mapSession,
    cellRenderers: sessionCellRenderers,
    filterOptions: sessionFilterOptions,
    SORT_BY_COLUMN: SESSION_SORT_BY_COLUMN
  };

  // =========================================================================
  // Bootstrap
  // =========================================================================

  init();

})();
