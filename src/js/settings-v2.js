/* ==========================================================================
   Settings V2 — Page Controller
   Single scrollable page with sections:

     Profile     — view/edit user name, email, role, org
     Security    — password change (live validation) + MFA (conditional)
     Preferences — email notifications, dark mode toggles (conditional)
     Sessions    — active session list, revoke individual/all
     VPN         — VPN status, config download, setup/reset (Electron only)

   Conditional sections (Preferences, VPN) are shown/hidden based on config.

   No regex. No classes. No top-level const/let.
   ========================================================================== */

(function () {
  'use strict';

  // =========================================================================
  // State
  // =========================================================================

  var _profileData = null;

  // Password requirement special characters
  var PW_SPECIALS = '!@#$%^&*()_+-=[]{}|;:,.<>?';

  // Password requirement definitions
  var PW_REQS = [
    { id: 'length',  label: 'At least 8 characters' },
    { id: 'upper',   label: 'One uppercase letter' },
    { id: 'lower',   label: 'One lowercase letter' },
    { id: 'number',  label: 'One number' },
    { id: 'special', label: 'One special character' }
  ];


  // =========================================================================
  // DOM cache
  // =========================================================================

  var dom = {};

  function cacheDom() {
    // Profile
    dom.profileCard      = document.getElementById('sv2-profile-card');
    dom.profileView      = document.getElementById('sv2-profile-view');
    dom.profileEdit      = document.getElementById('sv2-profile-edit');
    dom.profileName      = document.getElementById('sv2-profile-name');
    dom.profileRole      = document.getElementById('sv2-profile-role');
    dom.avatarInitials   = document.getElementById('sv2-avatar-initials');
    dom.profileNameEdit  = document.getElementById('sv2-profile-name-edit');
    dom.profileRoleEdit  = document.getElementById('sv2-profile-role-edit');
    dom.avatarInitialsEdit = document.getElementById('sv2-avatar-initials-edit');
    dom.kvFirstName      = document.getElementById('sv2-kv-firstname');
    dom.kvLastName       = document.getElementById('sv2-kv-lastname');
    dom.kvEmail          = document.getElementById('sv2-kv-email');
    dom.kvOrg            = document.getElementById('sv2-kv-org');
    dom.cancelEditBtn    = document.getElementById('sv2-cancel-edit-btn');
    dom.profileForm      = document.getElementById('sv2-profile-form');

    // Password
    dom.passwordForm     = document.getElementById('sv2-password-form');
    dom.currentPassword  = document.getElementById('sv2-current-password');
    dom.newPassword      = document.getElementById('sv2-new-password');
    dom.confirmPassword  = document.getElementById('sv2-confirm-password');
    dom.pwRequirements   = document.getElementById('sv2-pw-requirements');
    dom.updatePasswordBtn = document.getElementById('sv2-update-password-btn');

    // MFA
    dom.mfaSection = document.getElementById('sv2-mfa-section');

    // Conditional sections
    dom.preferencesSection = document.getElementById('sv2-section-preferences');
    dom.vpnSection         = document.getElementById('sv2-section-vpn');

    // Regional / Time Zone
    dom.timezoneSelect = document.getElementById('sv2-timezone-select');
    dom.tzDetectBtn    = document.getElementById('sv2-tz-detect-btn');
    dom.tzCurrent      = document.getElementById('sv2-tz-current');

    // Preferences
    dom.prefEmail = document.getElementById('sv2-pref-email');
    dom.prefDark  = document.getElementById('sv2-pref-dark');

    // Sessions
    dom.sessionsCard      = document.getElementById('sv2-sessions-card');
    dom.sessionsTable     = document.getElementById('sv2-sessions-table');
    dom.sessionsPagination = document.getElementById('sv2-sessions-pagination');
    dom.revokeAllBtn      = document.getElementById('sv2-revoke-all-btn');

    // VPN
    dom.vpnContent = document.getElementById('sv2-vpn-content');

    // Connected Apps (bridge consents)
    dom.connectedAppsSection = document.getElementById('sv2-section-connected-apps');
    dom.connectedAppsContent = document.getElementById('sv2-connected-apps-content');
  }


  // =========================================================================
  // Utilities
  // =========================================================================

  function esc(str) {
    if (!str) return '';
    return Lex.Utils.escapeHtml(str);
  }


  // =========================================================================
  // Conditional Sections
  // =========================================================================

  function showConditionalSections() {
    // Preferences — only if enabled in config
    if (window.LanaConfig && window.LanaConfig.USER_PREFERENCES_EDIT_ENABLED === true) {
      if (dom.preferencesSection) dom.preferencesSection.classList.remove('sv2-hidden');
      loadPreferences();
    }
  }


  // =========================================================================
  // Profile
  // =========================================================================

  function loadProfile() {
    if (dom.profileView) Lex.Redact.on(dom.profileView);

    api.getProfile().then(function (result) {
      var user = result.profile || result.user || result;
      _profileData = user;

      if (user && user.timezone) {
        var stored = readStoredUser();
        if (stored.timezone !== user.timezone) {
          stored.timezone = user.timezone;
          writeStoredUser(stored);
          renderTimezoneCurrent(user.timezone);
          if (dom.timezoneSelect) dom.timezoneSelect.setAttribute('value', user.timezone);
        }
      }

      var firstName = user.first_name || '';
      var lastName = user.last_name || '';
      var name = (firstName + ' ' + lastName).trim() || user.email || '';
      var initials = ((firstName.charAt(0) || '') + (lastName.charAt(0) || '')).toUpperCase() ||
                     (user.email ? user.email.charAt(0).toUpperCase() : 'U');

      var roleName = user.role_name || '';

      // View mode
      if (dom.profileName) dom.profileName.textContent = name;
      if (dom.profileRole) dom.profileRole.textContent = roleName;
      if (dom.avatarInitials) dom.avatarInitials.textContent = initials;
      if (dom.kvFirstName) dom.kvFirstName.setAttribute('value', firstName || '--');
      if (dom.kvLastName) dom.kvLastName.setAttribute('value', lastName || '--');
      if (dom.kvEmail) dom.kvEmail.setAttribute('value', user.email || '--');
      if (dom.kvOrg) dom.kvOrg.setAttribute('value', user.organization_name || '--');

      // Edit mode pre-fill
      if (dom.profileNameEdit) dom.profileNameEdit.textContent = name;
      if (dom.profileRoleEdit) dom.profileRoleEdit.textContent = roleName;
      if (dom.avatarInitialsEdit) dom.avatarInitialsEdit.textContent = initials;

      if (dom.profileForm) {
        var firstNameInput = dom.profileForm.querySelector('[name="first_name"]');
        var lastNameInput = dom.profileForm.querySelector('[name="last_name"]');
        if (firstNameInput) firstNameInput.value = firstName;
        if (lastNameInput) lastNameInput.value = lastName;
      }

      if (dom.profileView) Lex.Redact.off(dom.profileView);
    }).catch(function () {
      if (dom.profileView) Lex.Redact.off(dom.profileView);
      Lex.Toast.error('Failed to load profile');
    });
  }

  function showEditMode() {
    if (dom.profileCard) dom.profileCard.classList.add('sv2-editing');
  }

  function showViewMode() {
    if (dom.profileCard) dom.profileCard.classList.remove('sv2-editing');
  }

  function handleProfileSubmit(e) {
    var values = e.detail.values;

    api.updateProfile({
      first_name: values.first_name,
      last_name: values.last_name
    }).then(function () {
      Lex.Toast.success('Profile updated');
      showViewMode();
      loadProfile();
    }).catch(function (error) {
      Lex.Toast.error(error.message || 'Failed to update profile');
    });
  }


  // =========================================================================
  // Password
  // =========================================================================

  function renderPasswordRequirements() {
    if (!dom.pwRequirements) return;
    var html = '';
    for (var i = 0; i < PW_REQS.length; i++) {
      html += '<div class="sv2-pw-req" data-req="' + PW_REQS[i].id + '">' +
              '<span class="sv2-pw-req-dot"></span>' +
              esc(PW_REQS[i].label) +
              '</div>';
    }
    dom.pwRequirements.innerHTML = html;
  }

  function checkPasswordRequirements(password) {
    var hasLength = password.length >= 8;
    var hasUpper = false;
    var hasLower = false;
    var hasNumber = false;
    var hasSpecial = false;

    for (var i = 0; i < password.length; i++) {
      var ch = password.charAt(i);
      if (ch >= 'A' && ch <= 'Z') hasUpper = true;
      if (ch >= 'a' && ch <= 'z') hasLower = true;
      if (ch >= '0' && ch <= '9') hasNumber = true;
      if (PW_SPECIALS.indexOf(ch) !== -1) hasSpecial = true;
    }

    return {
      length: hasLength,
      upper: hasUpper,
      lower: hasLower,
      number: hasNumber,
      special: hasSpecial
    };
  }

  function updatePasswordIndicators(reqs) {
    if (!dom.pwRequirements) return;
    var keys = ['length', 'upper', 'lower', 'number', 'special'];
    for (var i = 0; i < keys.length; i++) {
      var el = dom.pwRequirements.querySelector('[data-req="' + keys[i] + '"]');
      if (!el) continue;
      if (reqs[keys[i]]) {
        el.classList.add('sv2-pw-req--met');
      } else {
        el.classList.remove('sv2-pw-req--met');
      }
    }
  }

  function allPasswordRequirementsMet(reqs) {
    return reqs.length && reqs.upper && reqs.lower && reqs.number && reqs.special;
  }

  function validatePasswordForm() {
    var currentPass = (dom.currentPassword && dom.currentPassword.value) || '';
    var newPass = (dom.newPassword && dom.newPassword.value) || '';
    var confirmPass = (dom.confirmPassword && dom.confirmPassword.value) || '';

    var reqs = checkPasswordRequirements(newPass);
    updatePasswordIndicators(reqs);

    var allReqsMet = allPasswordRequirementsMet(reqs);
    var passwordsMatch = newPass === confirmPass && confirmPass.length > 0;
    var hasCurrentPass = currentPass.length > 0;

    // Update confirm password error
    if (dom.confirmPassword) {
      if (confirmPass.length > 0 && !passwordsMatch) {
        dom.confirmPassword.error = 'Passwords do not match';
      } else {
        dom.confirmPassword.error = '';
      }
    }

    // Enable/disable submit button
    if (dom.updatePasswordBtn) {
      dom.updatePasswordBtn.disabled = !(hasCurrentPass && allReqsMet && passwordsMatch);
    }
  }

  function handlePasswordSubmit(e) {
    var values = e.detail.values;

    // Clear previous errors
    if (dom.currentPassword) dom.currentPassword.error = '';
    if (dom.newPassword) dom.newPassword.error = '';
    if (dom.confirmPassword) dom.confirmPassword.error = '';

    // Client-side validation
    var currentPass = values.current_password || '';
    var newPass = values.new_password || '';
    var confirmPass = values.confirm_password || '';

    if (!currentPass) {
      if (dom.currentPassword) dom.currentPassword.error = 'Current password is required';
      return;
    }

    var reqs = checkPasswordRequirements(newPass);
    if (!allPasswordRequirementsMet(reqs)) {
      if (dom.newPassword) dom.newPassword.error = 'Password does not meet all requirements';
      return;
    }

    if (newPass !== confirmPass) {
      if (dom.confirmPassword) dom.confirmPassword.error = 'Passwords do not match';
      return;
    }

    api.request('PATCH', '/api/v1/users/me/security/password', {
      current_password: currentPass,
      new_password: newPass
    }).then(function () {
      showPasswordSuccessModal();
    }).catch(function (error) {
      var errorData = error.data || error;
      var errorField = errorData.field || (errorData.error ? errorData.error.field : null);
      var errorMessage = errorData.message || (errorData.error ? errorData.error.message : null) || error.message || 'Password update failed';

      if (errorField === 'current_password') {
        if (dom.currentPassword) dom.currentPassword.error = errorMessage;
      } else if (errorField === 'new_password') {
        if (dom.newPassword) dom.newPassword.error = errorMessage;
      } else if (errorMessage.toLowerCase().indexOf('current') !== -1 || errorMessage.toLowerCase().indexOf('incorrect') !== -1) {
        if (dom.currentPassword) dom.currentPassword.error = errorMessage;
      } else {
        Lex.Toast.error(errorMessage);
      }
    });
  }

  function showPasswordSuccessModal() {
    var seconds = 3;

    var content = document.createElement('div');
    content.style.textAlign = 'center';
    content.innerHTML =
      '<div style="width:64px;height:64px;border-radius:' + 'var(--lex-radius-full)' + ';background:var(--lex-status-success-bg);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">' +
        '<svg width="32" height="32" fill="none" stroke="var(--lex-status-success-text)" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"></path></svg>' +
      '</div>' +
      '<div style="font-size:var(--lex-h4-size);font-weight:var(--lex-weight-semibold);color:var(--lex-text-primary);margin-bottom:8px;">Password Changed Successfully</div>' +
      '<div style="font-size:var(--lex-body-sm-size);color:var(--lex-text-secondary);margin-bottom:16px;">For security, you will be redirected to login with your new password.</div>' +
      '<div class="sv2-countdown" id="sv2-countdown">' + seconds + '</div>' +
      '<div style="font-size:var(--lex-body-xs-size);color:var(--lex-text-tertiary);">Redirecting to login...</div>';

    Lex.Modal.open({
      heading: '',
      content: content,
      hideActions: true,
      size: 'sm',
      closeOnOverlay: false
    });

    var timerEl = document.getElementById('sv2-countdown');
    var countdown = setInterval(function () {
      seconds--;
      if (timerEl) timerEl.textContent = seconds;

      if (seconds <= 0) {
        clearInterval(countdown);
        api.logout().finally(function () {
          // Full page reload to clear all SPA state
          window.location.href = 'login.html';
        });
      }
    }, 1000);
  }


  // =========================================================================
  // MFA
  // =========================================================================

  function loadMfaStatus() {
    if (!dom.mfaSection) return;
    if (!api.isMfaEnabled()) {
      dom.mfaSection.innerHTML = '';
      return;
    }

    api.getMfaStatus().then(function (result) {
      var enabled = result.mfa_enabled || result.enabled;
      renderMfaCard(enabled);
    }).catch(function () {
      renderMfaCard(null); // unknown state
    });
  }

  function renderMfaCard(enabled) {
    if (!dom.mfaSection) return;
    var badgeHtml;
    var buttonLabel;
    var buttonAction;

    if (enabled === true) {
      badgeHtml = '<lex-badge label="Enabled" color="green" size="sm"></lex-badge>';
      buttonLabel = 'Disable MFA';
      buttonAction = 'disable';
    } else if (enabled === false) {
      badgeHtml = '<lex-badge label="Disabled" color="gray" size="sm"></lex-badge>';
      buttonLabel = 'Enable MFA';
      buttonAction = 'enable';
    } else {
      badgeHtml = '<lex-badge label="Unknown" color="gray" size="sm"></lex-badge>';
      buttonLabel = 'Check Status';
      buttonAction = 'check';
    }

    dom.mfaSection.innerHTML =
      '<lex-card heading="Two-Factor Authentication">' +
        '<div class="sv2-mfa-header">' +
          '<lex-text variant="secondary" size="body-sm">Add an extra layer of security to your account</lex-text>' +
          badgeHtml +
        '</div>' +
        '<lex-btn id="sv2-mfa-toggle-btn" variant="secondary" size="sm" data-mfa-action="' + buttonAction + '">' +
          esc(buttonLabel) +
        '</lex-btn>' +
      '</lex-card>';

    // Wire button
    var btn = document.getElementById('sv2-mfa-toggle-btn');
    if (btn) {
      btn.addEventListener('click', function () {
        var action = btn.dataset.mfaAction;
        if (action === 'enable') {
          enableMfa();
        } else if (action === 'disable') {
          disableMfa();
        } else {
          loadMfaStatus();
        }
      });
    }
  }

  function enableMfa() {
    api.setupMfa().then(function (result) {
      var content = document.createElement('div');
      content.style.textContent = 'center';
      content.innerHTML =
        '<p style="margin-bottom:16px;font-size:var(--lex-body-sm-size);color:var(--lex-text-secondary);">Scan this QR code with your authenticator app:</p>' +
        '<img src="' + esc(result.qr_code) + '" alt="MFA QR Code" style="display:block;margin:0 auto 16px;max-width:200px;">' +
        '<p style="font-size:var(--lex-body-xs-size);color:var(--lex-text-tertiary);margin-bottom:16px;">Or enter this key manually: <strong>' + esc(result.secret) + '</strong></p>' +
        '<lex-input id="sv2-mfa-verify-input" placeholder="Enter 6-digit code" maxlength="6"></lex-input>' +
        '<div style="margin-top:16px;">' +
          '<lex-btn id="sv2-mfa-verify-btn" variant="primary" size="sm">Verify &amp; Enable</lex-btn>' +
        '</div>';

      Lex.Modal.open({
        heading: 'Setup Two-Factor Authentication',
        content: content,
        hideActions: true,
        size: 'md'
      });

      // Wire verify button after modal opens
      setTimeout(function () {
        var verifyBtn = document.getElementById('sv2-mfa-verify-btn');
        if (verifyBtn) {
          verifyBtn.addEventListener('click', function () {
            var tokenInput = document.getElementById('sv2-mfa-verify-input');
            var token = tokenInput ? tokenInput.value : '';
            if (!token) {
              if (tokenInput) tokenInput.error = 'Please enter the 6-digit code';
              return;
            }

            verifyBtn.loading = true;
            api.verifyMfa(token).then(function () {
              Lex.Toast.success('MFA enabled successfully');
              // Close modal
              var modal = document.querySelector('lex-modal[open]');
              if (modal) modal.open = false;
              loadMfaStatus();
            }).catch(function () {
              if (tokenInput) tokenInput.error = 'Invalid code. Please try again.';
              verifyBtn.loading = false;
            });
          });
        }
      }, 100);
    }).catch(function (error) {
      Lex.Toast.error(error.message || 'Failed to setup MFA');
    });
  }

  function disableMfa() {
    Lex.Modal.confirm({
      heading: 'Disable MFA',
      body: 'Are you sure you want to disable two-factor authentication? This will make your account less secure.',
      variant: 'danger',
      confirmText: 'Disable MFA'
    }).then(function (confirmed) {
      if (!confirmed) return;
      api.disableMfa().then(function () {
        Lex.Toast.success('MFA disabled');
        loadMfaStatus();
      }).catch(function (error) {
        Lex.Toast.error(error.message || 'Failed to disable MFA');
      });
    });
  }


  // =========================================================================
  // Regional / Time Zone
  // =========================================================================

  function browserTimezone() {
    try {
      return new Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (e) { return ''; }
  }

  function readStoredUser() {
    try { return JSON.parse(localStorage.getItem('user') || 'null') || {}; }
    catch (e) { return {}; }
  }

  function writeStoredUser(user) {
    localStorage.setItem('user', JSON.stringify(user));
  }

  function buildTimezoneOptions(currentValue) {
    var zones = [];
    if (typeof Intl.supportedValuesOf === 'function') {
      try { zones = Intl.supportedValuesOf('timeZone'); } catch (e) { zones = []; }
    }
    if (!zones.length) {
      zones = [
        'UTC',
        'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
        'America/Anchorage', 'America/Phoenix', 'America/Toronto', 'America/Vancouver',
        'America/Mexico_City', 'America/Sao_Paulo', 'America/Buenos_Aires',
        'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
        'Europe/Rome', 'Europe/Amsterdam', 'Europe/Stockholm', 'Europe/Warsaw',
        'Africa/Johannesburg', 'Africa/Cairo',
        'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Hong_Kong',
        'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Seoul',
        'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland'
      ];
    }
    if (currentValue && zones.indexOf(currentValue) === -1) zones.push(currentValue);

    var groups = {};
    for (var i = 0; i < zones.length; i++) {
      var zone = zones[i];
      var slash = zone.indexOf('/');
      var region = slash === -1 ? 'Other' : zone.substring(0, slash);
      if (!groups[region]) groups[region] = [];
      groups[region].push(zone);
    }

    var regionOrder = ['America', 'Europe', 'Africa', 'Asia', 'Australia', 'Pacific', 'Atlantic', 'Indian', 'Antarctica', 'Arctic', 'Etc', 'Other'];
    var seen = {};
    var ordered = [];
    for (var j = 0; j < regionOrder.length; j++) {
      if (groups[regionOrder[j]]) { ordered.push(regionOrder[j]); seen[regionOrder[j]] = true; }
    }
    var keys = Object.keys(groups).sort();
    for (var k = 0; k < keys.length; k++) {
      if (!seen[keys[k]]) ordered.push(keys[k]);
    }

    var options = [];
    for (var r = 0; r < ordered.length; r++) {
      var region = ordered[r];
      var list = groups[region].sort();
      for (var z = 0; z < list.length; z++) {
        options.push({
          value: list[z],
          label: list[z].replace(/_/g, ' '),
          group: region
        });
      }
    }
    return options;
  }

  function renderTimezoneCurrent(value) {
    if (!dom.tzCurrent) return;
    if (!value) {
      dom.tzCurrent.textContent = 'Using browser default: ' + (browserTimezone() || 'UTC');
      return;
    }
    try {
      var time = new Intl.DateTimeFormat('en-US', {
        timeZone: value, hour: 'numeric', minute: '2-digit', hour12: true
      }).format(new Date());
      dom.tzCurrent.textContent = 'Current local time: ' + time;
    } catch (e) {
      dom.tzCurrent.textContent = '';
    }
  }

  function loadTimezone() {
    if (!dom.timezoneSelect) return;
    var user = readStoredUser();
    var current = user.timezone || '';
    var options = buildTimezoneOptions(current);
    dom.timezoneSelect.setAttribute('options', JSON.stringify(options));
    if (current) dom.timezoneSelect.setAttribute('value', current);
    renderTimezoneCurrent(current);
  }

  function handleTimezoneChange(value) {
    if (!value) return;
    api.updatePreferences({ regional: { timezone: value } }).then(function () {
      var user = readStoredUser();
      user.timezone = value;
      writeStoredUser(user);
      renderTimezoneCurrent(value);
      Lex.Toast.success('Time zone updated');
    }).catch(function (error) {
      Lex.Toast.error(error.message || 'Failed to update time zone');
    });
  }

  function handleTimezoneDetect() {
    var detected = browserTimezone();
    if (!detected) {
      Lex.Toast.error('Could not detect browser time zone');
      return;
    }
    if (dom.timezoneSelect) dom.timezoneSelect.setAttribute('value', detected);
    handleTimezoneChange(detected);
  }


  // =========================================================================
  // Preferences
  // =========================================================================

  function loadPreferences() {
    api.getPreferences().then(function (result) {
      var prefs = result.preferences || {};

      if (dom.prefEmail) dom.prefEmail.checked = prefs.email_notifications !== false;
      if (dom.prefDark) dom.prefDark.checked = prefs.dark_mode === true;
    }).catch(function (error) {
      // Silently fail — preferences will show default state
      console.warn('[Settings V2] Failed to load preferences:', error);
    });
  }

  function handlePreferenceChange(key, value) {
    api.updatePreference(key, value).then(function () {
      Lex.Toast.success('Preference saved');
    }).catch(function (error) {
      Lex.Toast.error(error.message || 'Failed to save preference');
    });
  }


  // =========================================================================
  // Sessions
  // =========================================================================

  var fmtDate     = Lex.Utils.formatDate;
  var fmtDateTime = Lex.Utils.formatDateTime;

  function loadSessions() {
    var table = dom.sessionsTable;
    if (!table) return;

    Lex.Redact.on(table);

    api.get('/api/v1/auth/session').then(function (result) {
      var data = result.data || result;
      var sessions = Array.isArray(data) ? data : (data.sessions || []);

      var rows = sessions.map(function (s) {
        return {
          id:         String(s.id || ''),
          device:     String(s.user_agent || s.device_info || 'Unknown device'),
          ip_address: String(s.ip_address || s.ip || '\u2014'),
          created_at: s.created_at ? fmtDateTime(s.created_at) : '\u2014',
          expires_at: s.expires_at ? fmtDate(s.expires_at)     : '\u2014'
        };
      });

      Lex.Redact.off(table);
      table.setData(rows);
      _updateSessionsPagination(sessions.length);
    }).catch(function () {
      Lex.Redact.off(table);
      table.setData([]);
    });
  }

  function _updateSessionsPagination(total) {
    var pager = dom.sessionsPagination;
    if (!pager) return;
    pager.page  = 1;
    pager.total = total || 0;
    pager.limit = 20;
  }

  function revokeAllSessions() {
    Lex.Modal.confirm({
      heading: 'Revoke All Sessions',
      body: 'This will log you out of all other devices. Continue?',
      variant: 'danger',
      confirmText: 'Revoke All'
    }).then(function (confirmed) {
      if (!confirmed) return;
      var currentToken = localStorage.getItem('token');
      api.delete('/api/v1/auth/session/', { revoke_all_except: currentToken }).then(function () {
        Lex.Toast.success('All other sessions revoked');
        loadSessions();
      }).catch(function (error) {
        Lex.Toast.error(error.message || 'Failed to revoke sessions');
      });
    });
  }


  // =========================================================================
  // VPN
  // =========================================================================

  function loadVpnStatus() {
    if (typeof vpnManager === 'undefined') return;

    vpnManager.isConfigured().then(function (isConfigured) {
      return vpnManager.isRegistered().then(function (isRegistered) {
        if (isConfigured) {
          return vpnManager._loadKeys().then(function (keys) {
            renderVpnConfigured(keys, isRegistered);
          });
        } else {
          renderVpnNotConfigured();
        }
      });
    }).catch(function (error) {
      console.error('[Settings V2] Failed to load VPN status:', error);
      if (dom.vpnContent) {
        dom.vpnContent.innerHTML =
          '<lex-card heading="VPN Status">' +
            '<lex-empty message="Failed to load VPN status" icon="inbox"></lex-empty>' +
          '</lex-card>';
      }
    });
  }

  function renderVpnConfigured(keys, isRegistered) {
    if (!dom.vpnContent) return;
    var statusBadge = isRegistered
      ? '<lex-badge label="Registered" color="green" size="sm"></lex-badge>'
      : '<lex-badge label="Pending Registration" color="yellow" size="sm"></lex-badge>';

    var deviceId = keys.deviceId ? keys.deviceId.substring(0, 8) + '...' : 'Unknown';
    var clientIp = keys.clientIp || 'Not assigned';
    var registration = isRegistered ? 'Registered' : 'Pending';
    var createdAt = keys.createdAt ? Lex.Utils.formatDate(keys.createdAt) : 'Unknown';

    dom.vpnContent.innerHTML =
      '<lex-card heading="VPN Status">' +
        '<div class="sv2-mfa-header">' +
          '<lex-text variant="secondary" size="body-sm">Secure remote access connection</lex-text>' +
          statusBadge +
        '</div>' +
        '<div class="sv2-vpn-banner sv2-vpn-banner--ok">' +
          '<svg width="20" height="20" fill="none" stroke="var(--lex-status-success-text)" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>' +
          '<div>' +
            '<lex-text variant="primary" size="body-sm" weight="medium">VPN Configured</lex-text>' +
            '<lex-text variant="secondary" size="body-xs">Your device is set up for secure remote access.</lex-text>' +
          '</div>' +
        '</div>' +
        '<div class="sv2-vpn-grid">' +
          '<lex-kv label="Device ID" value="' + esc(deviceId) + '"></lex-kv>' +
          '<lex-kv label="VPN IP Address" value="' + esc(clientIp) + '"></lex-kv>' +
          '<lex-kv label="Registration" value="' + esc(registration) + '"></lex-kv>' +
          '<lex-kv label="Created" value="' + esc(createdAt) + '"></lex-kv>' +
        '</div>' +
        '<div class="sv2-form-actions">' +
          '<lex-btn id="sv2-vpn-download-btn" variant="primary" size="sm" icon="download">Download Config</lex-btn>' +
          '<lex-btn id="sv2-vpn-reset-btn" variant="ghost" size="sm">Reset</lex-btn>' +
        '</div>' +
      '</lex-card>';

    wireVpnButtons();
  }

  function renderVpnNotConfigured() {
    if (!dom.vpnContent) return;
    dom.vpnContent.innerHTML =
      '<lex-card heading="VPN Status">' +
        '<div class="sv2-mfa-header">' +
          '<lex-text variant="secondary" size="body-sm">Secure remote access connection</lex-text>' +
          '<lex-badge label="Not Configured" color="gray" size="sm"></lex-badge>' +
        '</div>' +
        '<div class="sv2-vpn-banner sv2-vpn-banner--warn">' +
          '<svg width="20" height="20" fill="none" stroke="var(--lex-status-warning-text)" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>' +
          '<div>' +
            '<lex-text variant="primary" size="body-sm" weight="medium">VPN Not Configured</lex-text>' +
            '<lex-text variant="secondary" size="body-xs">Set up VPN to access LanaAI securely from outside your network.</lex-text>' +
          '</div>' +
        '</div>' +
        '<lex-btn id="sv2-vpn-setup-btn" variant="primary" size="sm" icon="plus">Set Up VPN</lex-btn>' +
      '</lex-card>';

    wireVpnButtons();
  }

  function wireVpnButtons() {
    var downloadBtn = document.getElementById('sv2-vpn-download-btn');
    var resetBtn = document.getElementById('sv2-vpn-reset-btn');
    var setupBtn = document.getElementById('sv2-vpn-setup-btn');

    if (downloadBtn) {
      downloadBtn.addEventListener('click', function () {
        var savedServerJson = localStorage.getItem('lana_saved_server');
        if (!savedServerJson) {
          Lex.Toast.error('No server connection found. Please log in again.');
          return;
        }

        var serverInfo;
        try { serverInfo = JSON.parse(savedServerJson); } catch (e) {
          Lex.Toast.error('Invalid server configuration.');
          return;
        }

        if (!serverInfo.vpn) {
          Lex.Toast.error('VPN configuration not available from server.');
          return;
        }

        downloadBtn.loading = true;
        vpnManager.getOrCreateConfig(serverInfo.vpn).then(function (config) {
          var filename = vpnManager.downloadConfigFile(config.configFile, serverInfo.orgName || serverInfo.orgId);
          Lex.Toast.success('Downloaded: ' + filename);
          downloadBtn.loading = false;
        }).catch(function (error) {
          Lex.Toast.error(error.message || 'Failed to download VPN configuration');
          downloadBtn.loading = false;
        });
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        Lex.Modal.confirm({
          heading: 'Reset VPN Configuration',
          body: 'This will remove your VPN keys. You will need to set up VPN again. Continue?',
          variant: 'danger',
          confirmText: 'Reset'
        }).then(function (confirmed) {
          if (!confirmed) return;
          vpnManager.clearKeys().then(function () {
            Lex.Toast.success('VPN configuration reset');
            loadVpnStatus();
          }).catch(function (error) {
            Lex.Toast.error(error.message || 'Failed to reset VPN');
          });
        });
      });
    }

    if (setupBtn) {
      setupBtn.addEventListener('click', function () {
        var savedServerJson = localStorage.getItem('lana_saved_server');
        if (!savedServerJson) {
          Lex.Toast.error('No server connection found. Please log out and reconnect.');
          return;
        }
        var serverInfo;
        try { serverInfo = JSON.parse(savedServerJson); } catch (e) {
          Lex.Toast.error('Invalid server configuration.');
          return;
        }
        var serverInfoEncoded = btoa(JSON.stringify(serverInfo));
        Lex.Nav.go('vpn-setup.html', { params: { server: serverInfoEncoded } });
      });
    }
  }


  // =========================================================================
  // Connected Apps (Companion Bridge consents)
  //
  // The bridge stores per-app consents in an electron-store named
  // `bridge-consents`. The renderer reads/writes that file via two IPC
  // handlers exposed on window.electronAPI:
  //   - listBridgeConsents()           → { [app]: { mode, granted_at, granted_user_id } }
  //   - revokeBridgeConsent(appName)   → { ok, removed?, message? }
  // The bridge re-checks consent on every request, so revocation here
  // takes effect on the next companion request without restart.
  //
  // granted_user_id is treated as semi-sensitive — never logged to console.
  // =========================================================================

  // Human-friendly labels for known sibling Lana apps. Keys are the wire
  // identifiers used by the loopback bridge (kept as `lana-companion` for
  // compat with already-granted device consents); values are user-visible.
  var CONNECTED_APP_LABELS = {
    'lana-companion': 'PAC'
  };

  function isConnectedAppsAvailable() {
    return Boolean(
      window.electronAPI &&
      typeof window.electronAPI.listBridgeConsents === 'function' &&
      typeof window.electronAPI.revokeBridgeConsent === 'function'
    );
  }

  function humanizeConnectedApp(key) {
    if (!key) return 'Unknown app';
    if (CONNECTED_APP_LABELS[key]) return CONNECTED_APP_LABELS[key];
    // Fallback: turn 'some-app-name' → 'Some App Name'
    var parts = String(key).split('-');
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].length > 0) {
        parts[i] = parts[i].charAt(0).toUpperCase() + parts[i].slice(1);
      }
    }
    return parts.join(' ');
  }

  // Compact relative time: "just now", "5m ago", "3h ago", "2d ago", "3w ago".
  // Anything older than ~6 weeks falls back to absolute date only (rendered
  // alongside via toLocaleString).
  function formatRelativeTime(iso) {
    if (!iso) return '';
    var then = new Date(iso).getTime();
    if (!then || isNaN(then)) return '';
    var diff = Date.now() - then;
    if (diff < 0) diff = 0;

    var sec = Math.floor(diff / 1000);
    if (sec < 45) return 'just now';
    var min = Math.floor(sec / 60);
    if (min < 60) return min + 'm ago';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    var day = Math.floor(hr / 24);
    if (day < 7) return day + 'd ago';
    var wk = Math.floor(day / 7);
    if (wk < 6) return wk + 'w ago';
    return '';
  }

  function formatGrantedAt(iso) {
    if (!iso) return { absolute: '', relative: '' };
    var d = new Date(iso);
    var absolute = '';
    try { absolute = d.toLocaleString(); } catch (e) { absolute = String(iso); }
    return {
      absolute: absolute,
      relative: formatRelativeTime(iso)
    };
  }

  function renderConnectedAppsLoading() {
    if (!dom.connectedAppsContent) return;
    dom.connectedAppsContent.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;padding:16px 0;">' +
        '<lex-spinner size="sm" label="Loading connected apps..."></lex-spinner>' +
      '</div>';
  }

  function renderConnectedAppsEmpty() {
    if (!dom.connectedAppsContent) return;
    dom.connectedAppsContent.innerHTML =
      '<lex-empty ' +
        'icon="inbox" ' +
        'message="No connected apps yet." ' +
        'description="When another Lana app asks to use this device\'s session and you choose &quot;Always allow&quot;, it will appear here.">' +
      '</lex-empty>';
  }

  function renderConnectedAppsError() {
    if (!dom.connectedAppsContent) return;
    dom.connectedAppsContent.innerHTML =
      '<lex-empty ' +
        'icon="inbox" ' +
        'message="Couldn\'t load connected apps." ' +
        'description="Try refreshing this page. If the problem persists, restart the app.">' +
      '</lex-empty>';
  }

  function renderConnectedApps(consents) {
    if (!dom.connectedAppsContent) return;

    var entries = [];
    if (consents && typeof consents === 'object') {
      var keys = Object.keys(consents);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var rec = consents[key] || {};
        entries.push({
          key: key,
          label: humanizeConnectedApp(key),
          mode: rec.mode || 'always-allow',
          granted_at: rec.granted_at || ''
        });
      }
    }

    if (entries.length === 0) {
      renderConnectedAppsEmpty();
      return;
    }

    // Sort newest-granted first.
    entries.sort(function (a, b) {
      var ta = a.granted_at ? new Date(a.granted_at).getTime() : 0;
      var tb = b.granted_at ? new Date(b.granted_at).getTime() : 0;
      return tb - ta;
    });

    var html = '';
    for (var j = 0; j < entries.length; j++) {
      var entry = entries[j];
      var times = formatGrantedAt(entry.granted_at);
      var metaText = '';
      if (times.relative && times.absolute) {
        metaText = 'Granted ' + esc(times.relative) + ' • ' + esc(times.absolute);
      } else if (times.absolute) {
        metaText = 'Granted ' + esc(times.absolute);
      } else if (times.relative) {
        metaText = 'Granted ' + esc(times.relative);
      } else {
        metaText = 'Granted';
      }

      html +=
        '<div class="sv2-connected-app-row" data-app="' + esc(entry.key) + '">' +
          '<div class="sv2-connected-app-info">' +
            '<lex-text variant="primary" size="body" weight="medium">' + esc(entry.label) + '</lex-text>' +
            '<span class="sv2-connected-app-meta">' + metaText + '</span>' +
          '</div>' +
          '<lex-btn ' +
            'class="sv2-connected-app-revoke-btn" ' +
            'variant="danger" ' +
            'size="sm" ' +
            'icon="trash" ' +
            'data-app="' + esc(entry.key) + '" ' +
            'data-label="' + esc(entry.label) + '">' +
            'Revoke' +
          '</lex-btn>' +
        '</div>';
    }

    dom.connectedAppsContent.innerHTML = html;
    wireConnectedAppsButtons();
  }

  function wireConnectedAppsButtons() {
    if (!dom.connectedAppsContent) return;
    var buttons = dom.connectedAppsContent.querySelectorAll('.sv2-connected-app-revoke-btn');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', handleConnectedAppRevokeClick);
    }
  }

  function handleConnectedAppRevokeClick(e) {
    var btn = e.currentTarget;
    if (!btn) return;
    var appKey = btn.getAttribute('data-app') || '';
    var appLabel = btn.getAttribute('data-label') || humanizeConnectedApp(appKey);
    if (!appKey) return;

    Lex.Modal.confirm({
      heading: 'Revoke access for ' + appLabel + '?',
      body: appLabel + ' will need to ask for permission again the next time it tries to use this device\'s Lana session.',
      variant: 'danger',
      confirmText: 'Revoke'
    }).then(function (confirmed) {
      if (!confirmed) return;
      revokeConnectedApp(btn, appKey, appLabel);
    });
  }

  function revokeConnectedApp(btn, appKey, appLabel) {
    if (!isConnectedAppsAvailable()) {
      Lex.Toast.error('Revoke is only available in the desktop app.');
      return;
    }

    // Avoid double-revoke races: lock the row's button while in-flight.
    if (btn) btn.loading = true;

    window.electronAPI.revokeBridgeConsent(appKey).then(function (result) {
      if (!result || result.ok !== true) {
        var msg = (result && result.message) || 'Failed to revoke access';
        Lex.Toast.error(msg);
        if (btn) btn.loading = false;
        return;
      }

      if (result.removed) {
        Lex.Toast.success('Revoked access for ' + appLabel);
      } else {
        // Already gone — still treat as success from the user's POV.
        Lex.Toast.info('Access for ' + appLabel + ' was already revoked');
      }
      loadConnectedApps();
    }).catch(function (error) {
      Lex.Toast.error((error && error.message) || 'Failed to revoke access');
      if (btn) btn.loading = false;
    });
  }

  function loadConnectedApps() {
    if (!dom.connectedAppsSection || !dom.connectedAppsContent) return;
    if (!isConnectedAppsAvailable()) {
      // Web build / no Electron bridge — keep the section hidden.
      dom.connectedAppsSection.classList.add('sv2-hidden');
      return;
    }

    dom.connectedAppsSection.classList.remove('sv2-hidden');
    renderConnectedAppsLoading();

    window.electronAPI.listBridgeConsents().then(function (consents) {
      renderConnectedApps(consents || {});
    }).catch(function () {
      renderConnectedAppsError();
    });
  }


  // =========================================================================
  // Page Lifecycle
  // =========================================================================

  function init() {
    cacheDom();
    renderPasswordRequirements();

    // ── Profile ──
    if (dom.profileCard) {
      dom.profileCard.addEventListener('card-action', function (e) {
        if (e.detail && e.detail.action === 'edit') showEditMode();
      });
    }
    if (dom.cancelEditBtn) {
      dom.cancelEditBtn.addEventListener('click', showViewMode);
    }
    if (dom.profileForm) {
      dom.profileForm.addEventListener('lex-submit', handleProfileSubmit);
    }

    // ── Password ──
    if (dom.passwordForm) {
      dom.passwordForm.addEventListener('lex-submit', handlePasswordSubmit);
    }
    if (dom.newPassword) {
      dom.newPassword.addEventListener('lex-input', validatePasswordForm);
    }
    if (dom.confirmPassword) {
      dom.confirmPassword.addEventListener('lex-input', validatePasswordForm);
    }
    if (dom.currentPassword) {
      dom.currentPassword.addEventListener('lex-input', validatePasswordForm);
    }
    if (dom.updatePasswordBtn) {
      dom.updatePasswordBtn.disabled = true;
    }

    // ── Time Zone ──
    if (dom.timezoneSelect) {
      dom.timezoneSelect.addEventListener('lex-change', function (e) {
        handleTimezoneChange(e.detail && e.detail.value);
      });
    }
    if (dom.tzDetectBtn) {
      dom.tzDetectBtn.addEventListener('click', handleTimezoneDetect);
    }

    // ── Preferences ──
    if (dom.prefEmail) {
      dom.prefEmail.addEventListener('lex-change', function (e) {
        handlePreferenceChange('email_notifications', e.detail.value);
      });
    }
    if (dom.prefDark) {
      dom.prefDark.addEventListener('lex-change', function (e) {
        handlePreferenceChange('dark_mode', e.detail.value);
      });
    }

    // ── Sessions ──
    if (dom.revokeAllBtn) {
      dom.revokeAllBtn.addEventListener('click', revokeAllSessions);
    }

    // Session table — no per-row revoke in settings (user revokes all or none)

    // Topbar refresh button
    document.addEventListener('lex-refresh', function (e) {
      e.preventDefault();
      loadProfile();
      loadMfaStatus();
      loadSessions();
      loadConnectedApps();
    });

    // ── Load all data ──
    loadProfile();
    loadTimezone();
    loadMfaStatus();
    loadSessions();
    loadConnectedApps();
    showConditionalSections();
  }

  // Standalone page — init directly (no SPA router)
  init();

})();
