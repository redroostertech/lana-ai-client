/* ==========================================================================
   Settings V2 — Page Controller
   Single scrollable page with sections:

     Profile     — view/edit user name, email, role, org
     Security    — password change (live validation) + MFA (conditional)
     Preferences — desktop and in-app notification toggles (conditional)
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
  var _notificationPreferences = null;
  var _notificationTypes = [];
  var _inAppTypesExpanded = false;
  var MFA_SETTINGS_VISIBLE = false;
  var _sessions = [];
  var _sessionsLoaded = false;
  var _sessionsLoading = null;
  var _sessionsModal = null;

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
    dom.kvTitle          = document.getElementById('sv2-kv-title');
    dom.kvFirm           = document.getElementById('sv2-kv-firm');
    dom.kvLocation       = document.getElementById('sv2-kv-location');
    dom.kvPractice       = document.getElementById('sv2-kv-practice');
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
    dom.prefPush  = document.getElementById('sv2-pref-push');
    dom.prefInApp = document.getElementById('sv2-pref-in-app');
    dom.inAppTypesToggle = document.getElementById('sv2-in-app-types-toggle');
    dom.inAppTypes = document.getElementById('sv2-in-app-types');

    // Sessions
    dom.sessionsCard      = document.getElementById('sv2-sessions-card');
    dom.sessionsStatus    = document.getElementById('sv2-sessions-status');
    dom.sessionsManageBtn = document.getElementById('sv2-sessions-manage-btn');

    // VPN
    dom.vpnContent = document.getElementById('sv2-vpn-content');

    // Connected Apps (bridge consents)
    dom.connectedAppsSection = document.getElementById('sv2-section-connected-apps');
    dom.connectedAppsContent = document.getElementById('sv2-connected-apps-content');

    // Plugins / user connector connections
    dom.pluginsTab = document.getElementById('sv2-tab-plugins');
    dom.pluginsPanel = document.getElementById('sv2-panel-plugins');
    dom.userConnectionsSection = document.getElementById('sv2-section-user-connections');
    dom.userConnectionsContent = document.getElementById('sv2-user-connections-content');
    dom.userConnectionsStatus = document.getElementById('sv2-user-connections-status');
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
    // Preferences are server-gated by the notification preferences API.
    loadPreferences();
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
      if (dom.profileName) { dom.profileName.textContent = name; dom.profileName.setAttribute('title', name); }
      if (dom.profileRole) { dom.profileRole.textContent = roleName; dom.profileRole.setAttribute('title', roleName); }
      if (dom.profileEmail) { dom.profileEmail.textContent = user.email || ''; dom.profileEmail.setAttribute('title', user.email || ''); }
      if (dom.avatarInitials) dom.avatarInitials.textContent = initials;
      if (dom.kvFirstName) dom.kvFirstName.setAttribute('value', firstName || '--');
      if (dom.kvLastName) dom.kvLastName.setAttribute('value', lastName || '--');
      if (dom.kvEmail) dom.kvEmail.setAttribute('value', user.email || '--');
      if (dom.kvOrg) dom.kvOrg.setAttribute('value', user.organization_name || '--');
      if (dom.kvTitle) dom.kvTitle.setAttribute('value', user.title || '--');
      if (dom.kvFirm) dom.kvFirm.setAttribute('value', user.firm_name || '--');
      if (dom.kvLocation) dom.kvLocation.setAttribute('value', user.location || '--');
      if (dom.kvPractice) dom.kvPractice.setAttribute('value', user.practice_area || '--');

      // Edit mode pre-fill
      if (dom.profileNameEdit) { dom.profileNameEdit.textContent = name; dom.profileNameEdit.setAttribute('title', name); }
      if (dom.profileRoleEdit) { dom.profileRoleEdit.textContent = roleName; dom.profileRoleEdit.setAttribute('title', roleName); }
      if (dom.profileEmailEdit) { dom.profileEmailEdit.textContent = user.email || ''; dom.profileEmailEdit.setAttribute('title', user.email || ''); }
      if (dom.avatarInitialsEdit) dom.avatarInitialsEdit.textContent = initials;

      if (dom.profileForm) {
        var firstNameInput = dom.profileForm.querySelector('[name="first_name"]');
        var lastNameInput = dom.profileForm.querySelector('[name="last_name"]');
        var titleInput = dom.profileForm.querySelector('[name="title"]');
        var firmInput = dom.profileForm.querySelector('[name="firm_name"]');
        var locationInput = dom.profileForm.querySelector('[name="location"]');
        var practiceInput = dom.profileForm.querySelector('[name="practice_area"]');
        if (firstNameInput) firstNameInput.value = firstName;
        if (lastNameInput) lastNameInput.value = lastName;
        if (titleInput) titleInput.value = user.title || '';
        if (firmInput) firmInput.value = user.firm_name || '';
        if (locationInput) locationInput.value = user.location || '';
        if (practiceInput) practiceInput.value = user.practice_area || '';
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
      last_name: values.last_name,
      title: values.title,
      firm_name: values.firm_name,
      location: values.location,
      practice_area: values.practice_area
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

  function hideMfaSection() {
    if (!dom.mfaSection) return;
    dom.mfaSection.innerHTML = '';
    dom.mfaSection.classList.add('sv2-hidden');
    dom.mfaSection.setAttribute('hidden', '');
    dom.mfaSection.setAttribute('aria-hidden', 'true');
  }

  function loadMfaStatus() {
    if (!dom.mfaSection) return;
    if (MFA_SETTINGS_VISIBLE !== true || !api.isMfaEnabled()) {
      hideMfaSection();
      return;
    }

    dom.mfaSection.classList.remove('sv2-hidden');
    dom.mfaSection.removeAttribute('hidden');
    dom.mfaSection.removeAttribute('aria-hidden');

    api.getMfaStatus().then(function (result) {
      var enabled = result.mfa_enabled || result.enabled;
      renderMfaCard(enabled);
    }).catch(function () {
      renderMfaCard(null); // unknown state
    });
  }

  function renderMfaCard(enabled) {
    if (!dom.mfaSection) return;
    dom.mfaSection.classList.remove('sv2-hidden');
    dom.mfaSection.removeAttribute('hidden');
    dom.mfaSection.removeAttribute('aria-hidden');
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
      content.style.textAlign = 'center';
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
    var content = document.createElement('div');
    content.innerHTML =
      '<p class="sv2-modal-copy">Confirm your account password to disable two-factor authentication.</p>' +
      '<lex-input id="sv2-mfa-disable-password" label="Password" type="password" required="true"></lex-input>' +
      '<div class="sv2-form-actions">' +
        '<lex-btn id="sv2-mfa-disable-confirm-btn" variant="danger" size="sm">Disable MFA</lex-btn>' +
        '<lex-btn id="sv2-mfa-disable-cancel-btn" variant="ghost" size="sm">Cancel</lex-btn>' +
      '</div>';

    var modal = Lex.Modal.open({
      heading: 'Disable MFA',
      content: content,
      hideActions: true,
      size: 'sm',
      closeOnOverlay: true
    });

    setTimeout(function () {
      var passwordInput = document.getElementById('sv2-mfa-disable-password');
      var confirmBtn = document.getElementById('sv2-mfa-disable-confirm-btn');
      var cancelBtn = document.getElementById('sv2-mfa-disable-cancel-btn');

      if (cancelBtn) {
        cancelBtn.addEventListener('click', function () {
          if (modal) modal.open = false;
        });
      }

      if (!confirmBtn) return;
      confirmBtn.addEventListener('click', function () {
        var password = passwordInput ? passwordInput.value : '';
        if (!password) {
          if (passwordInput) passwordInput.error = 'Password is required';
          return;
        }

        confirmBtn.loading = true;
        api.disableMfa(password).then(function () {
          Lex.Toast.success('MFA disabled');
          if (modal) modal.open = false;
          loadMfaStatus();
        }).catch(function (error) {
          if (passwordInput && error && (error.status === 400 || error.status === 401)) {
            passwordInput.error = error.message || 'Invalid password';
          } else {
            Lex.Toast.error(error.message || 'Failed to disable MFA');
          }
          confirmBtn.loading = false;
        });
      });
    }, 100);
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

  function timezoneCityLabel(value) {
    if (!value) return '';
    var parts = String(value).split('/');
    var city = parts[parts.length - 1] || value;
    return city.replace(/_/g, ' ');
  }

  function timezoneDisplayName(value) {
    if (!value) return '';
    try {
      var parts = new Intl.DateTimeFormat('en-US', {
        timeZone: value,
        timeZoneName: 'longGeneric'
      }).formatToParts(new Date());
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type === 'timeZoneName' && parts[i].value) {
          return parts[i].value;
        }
      }
    } catch (e) {
      return timezoneCityLabel(value);
    }
    return timezoneCityLabel(value);
  }

  function timezoneOptionLabel(value) {
    var display = timezoneDisplayName(value);
    var city = timezoneCityLabel(value);
    if (!display) return city || value;
    if (!city || display === city) return display;
    return display + ' - ' + city;
  }

  function timezoneStatusLabel(value, isDefault) {
    var label = timezoneDisplayName(value) || timezoneCityLabel(value) || 'UTC';
    try {
      var time = new Intl.DateTimeFormat('en-US', {
        timeZone: value || 'UTC', hour: 'numeric', minute: '2-digit', hour12: true
      }).format(new Date());
      return (isDefault ? 'Browser default · ' : '') + label + ' · Local time ' + time;
    } catch (e) {
      return (isDefault ? 'Browser default · ' : '') + label;
    }
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
          label: timezoneOptionLabel(list[z]),
          group: region
        });
      }
    }
    return options;
  }

  function renderTimezoneCurrent(value) {
    if (!dom.tzCurrent) return;
    if (!value) {
      dom.tzCurrent.textContent = timezoneStatusLabel(browserTimezone() || 'UTC', true);
      return;
    }
    dom.tzCurrent.textContent = timezoneStatusLabel(value, false);
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
    if (!api || typeof api.getNotificationPreferences !== 'function') {
      if (dom.preferencesSection) dom.preferencesSection.classList.add('sv2-hidden');
      return;
    }

    api.getNotificationPreferences().then(function (result) {
      var prefs = result.preferences || {};
      _notificationPreferences = prefs;
      if (dom.preferencesSection) dom.preferencesSection.classList.remove('sv2-hidden');
      if (dom.prefPush) dom.prefPush.checked = prefs.push_enabled !== false;
      if (dom.prefInApp) dom.prefInApp.checked = prefs.in_app_enabled !== false;
      renderInAppNotificationTypes();

      if (api && typeof api.getNotificationTypes === 'function') {
        api.getNotificationTypes().then(function (typesResult) {
          _notificationTypes = normalizeNotificationTypes(typesResult);
          renderInAppNotificationTypes();
        }).catch(function (error) {
          _notificationTypes = [];
          renderInAppNotificationTypes();
          console.warn('[Settings V2] Failed to load notification types:', error);
        });
      }
      return null;
    }).catch(function (error) {
      if (dom.preferencesSection) dom.preferencesSection.classList.add('sv2-hidden');
      console.warn('[Settings V2] Failed to load notification preferences:', error);
    });
  }

  function normalizeNotificationTypes(result) {
    var root = result && (result.data || result);
    return Array.isArray(root && root.types) ? root.types : [];
  }

  function notificationTypeName(type) {
    return type && type.type ? String(type.type) : '';
  }

  function toggleableInAppNotificationTypes() {
    var rows = [];

    for (var i = 0; i < _notificationTypes.length; i++) {
      var type = _notificationTypes[i];
      var channels = type.channels || {};
      if (type.preference_gated === false || channels.in_app === false) continue;
      if (!notificationTypeName(type)) continue;
      rows.push(type);
    }

    return rows;
  }

  function humanizeNotificationType(type) {
    var parts = String(type || '').split('_');
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      parts[i] = parts[i].charAt(0).toUpperCase() + parts[i].slice(1);
    }
    return parts.join(' ');
  }

  function storedInAppTypeEnabled(typeName) {
    var prefs = _notificationPreferences || {};
    var perTypePrefs = prefs.notification_types || {};
    var typePrefs = perTypePrefs[typeName] || {};
    return typePrefs.in_app !== false;
  }

  function effectiveInAppTypeEnabled(typeName) {
    var prefs = _notificationPreferences || {};
    if (prefs.in_app_enabled === false) return false;
    return storedInAppTypeEnabled(typeName);
  }

  function inAppSelectionState(rows) {
    var prefs = _notificationPreferences || {};
    var typeRows = rows || toggleableInAppNotificationTypes();
    var enabledCount = 0;

    if (!typeRows.length) {
      return {
        checked: prefs.in_app_enabled !== false,
        mixed: false
      };
    }

    for (var i = 0; i < typeRows.length; i++) {
      if (effectiveInAppTypeEnabled(notificationTypeName(typeRows[i]))) enabledCount++;
    }

    return {
      checked: enabledCount === typeRows.length,
      mixed: enabledCount > 0 && enabledCount < typeRows.length
    };
  }

  function syncInAppParentToggle(rows) {
    if (!dom.prefInApp) return;
    var state = inAppSelectionState(rows);
    dom.prefInApp.checked = state.checked;
    dom.prefInApp.mixed = state.mixed;
  }

  function setInAppTypesExpanded(expanded, hasRows) {
    _inAppTypesExpanded = expanded === true && hasRows === true;

    if (dom.inAppTypes) {
      if (_inAppTypesExpanded) {
        dom.inAppTypes.classList.remove('sv2-hidden');
        dom.inAppTypes.removeAttribute('hidden');
      } else {
        dom.inAppTypes.classList.add('sv2-hidden');
        dom.inAppTypes.setAttribute('hidden', '');
      }
    }

    if (dom.inAppTypesToggle) {
      if (hasRows) dom.inAppTypesToggle.classList.remove('sv2-hidden');
      else dom.inAppTypesToggle.classList.add('sv2-hidden');
      dom.inAppTypesToggle.setAttribute('aria-expanded', _inAppTypesExpanded ? 'true' : 'false');
      dom.inAppTypesToggle.setAttribute('aria-label', (_inAppTypesExpanded ? 'Hide' : 'Show') + ' in-app notification types');
    }
  }

  function applyNotificationPreferencesPatch(body) {
    var key;
    _notificationPreferences = _notificationPreferences || {};

    for (key in body) {
      if (!Object.prototype.hasOwnProperty.call(body, key) || key === 'notification_types') continue;
      _notificationPreferences[key] = body[key] === true;
    }

    if (body.notification_types) {
      _notificationPreferences.notification_types = _notificationPreferences.notification_types || {};
      for (key in body.notification_types) {
        if (!Object.prototype.hasOwnProperty.call(body.notification_types, key)) continue;
        _notificationPreferences.notification_types[key] = Object.assign(
          {},
          _notificationPreferences.notification_types[key] || {},
          body.notification_types[key]
        );
      }
    }
  }

  function renderInAppNotificationTypes() {
    if (!dom.inAppTypes) return;
    var rows = toggleableInAppNotificationTypes();
    syncInAppParentToggle(rows);

    if (!rows.length) {
      dom.inAppTypes.innerHTML = '';
      setInAppTypesExpanded(false, false);
      return;
    }

    var html = '';
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var typeName = notificationTypeName(row);
      var checked = effectiveInAppTypeEnabled(typeName);
      html +=
        '<lex-stack class="sv2-notification-type-row" direction="horizontal" gap="4" justify="between" align="center">' +
          '<lex-stack class="sv2-notification-type-copy" direction="vertical" gap="1">' +
            '<lex-text variant="primary" size="body-sm" weight="medium">' + esc(humanizeNotificationType(typeName)) + '</lex-text>' +
            '<lex-text variant="tertiary" size="body-xs">' + esc(row.description || '') + '</lex-text>' +
          '</lex-stack>' +
          '<lex-toggle class="sv2-in-app-type-toggle" name="in_app_' + esc(typeName) + '" data-notification-type="' + esc(typeName) + '"' + (checked ? ' checked' : '') + '></lex-toggle>' +
        '</lex-stack>';
    }

    dom.inAppTypes.innerHTML = html;
    setInAppTypesExpanded(_inAppTypesExpanded, true);

    var toggles = dom.inAppTypes.querySelectorAll('.sv2-in-app-type-toggle');
    for (var j = 0; j < toggles.length; j++) {
      toggles[j].checked = toggles[j].hasAttribute('checked');
      toggles[j].addEventListener('lex-change', handleInAppTypePreferenceChange);
    }
  }

  function handleInAppTypesToggleClick() {
    setInAppTypesExpanded(!_inAppTypesExpanded, toggleableInAppNotificationTypes().length > 0);
  }

  function handleNotificationPreferenceChange(key, value) {
    var body = {};
    body[key] = value === true;
    api.updateNotificationPreferences(body).then(function () {
      applyNotificationPreferencesPatch(body);
      renderInAppNotificationTypes();
      Lex.Toast.success('Preference saved');
    }).catch(function (error) {
      Lex.Toast.error(error.message || 'Failed to save notification preference');
      loadPreferences();
    });
  }

  function handleInAppParentPreferenceChange(value) {
    var enabled = value === true;
    var rows = toggleableInAppNotificationTypes();
    var body = {
      in_app_enabled: enabled
    };

    if (rows.length) {
      body.notification_types = {};
      for (var i = 0; i < rows.length; i++) {
        body.notification_types[notificationTypeName(rows[i])] = { in_app: enabled };
      }
    }

    api.updateNotificationPreferences(body).then(function () {
      applyNotificationPreferencesPatch(body);
      renderInAppNotificationTypes();
      Lex.Toast.success('Preference saved');
    }).catch(function (error) {
      Lex.Toast.error(error.message || 'Failed to save notification preference');
      loadPreferences();
    });
  }

  function handleInAppTypePreferenceChange(e) {
    var toggle = e.currentTarget;
    var type = toggle && toggle.getAttribute('data-notification-type');
    if (!type) return;

    var rows = toggleableInAppNotificationTypes();
    var enabled = e.detail && e.detail.value === true;
    var anyEnabled = false;
    var body = {
      in_app_enabled: false,
      notification_types: {}
    };

    for (var i = 0; i < rows.length; i++) {
      var typeName = notificationTypeName(rows[i]);
      var typeEnabled = typeName === type ? enabled : effectiveInAppTypeEnabled(typeName);
      if (typeEnabled) anyEnabled = true;
      body.notification_types[typeName] = { in_app: typeEnabled };
    }

    body.in_app_enabled = anyEnabled;

    api.updateNotificationPreferences(body).then(function () {
      applyNotificationPreferencesPatch(body);
      renderInAppNotificationTypes();
      Lex.Toast.success('Preference saved');
    }).catch(function (error) {
      Lex.Toast.error(error.message || 'Failed to save notification type preference');
      loadPreferences();
    });
  }

  // =========================================================================
  // Sessions
  // =========================================================================

  var fmtDate     = Lex.Utils.formatDate;
  var fmtDateTime = Lex.Utils.formatDateTime;

  function sessionCountLabel(count) {
    if (!_sessionsLoaded) return 'Loading sessions...';
    if (count === 1) return '1 active session.';
    return String(count || 0) + ' active sessions.';
  }

  function setSessionsStatus(message, isErr) {
    if (!dom.sessionsStatus) return;
    dom.sessionsStatus.textContent = message || '';
    dom.sessionsStatus.setAttribute('variant', isErr ? 'danger' : 'tertiary');
  }

  function setSessionsModalStatus(message, isErr) {
    var status = document.getElementById('sv2-sessions-modal-status');
    if (!status) return;
    status.textContent = message || '';
    status.setAttribute('variant', isErr ? 'danger' : 'tertiary');
  }

  function sessionRows(sessions) {
    return (sessions || []).map(function (s) {
      return {
        id:         String(s.id || ''),
        device:     String(s.user_agent || s.device_info || 'Unknown device'),
        ip_address: String(s.ip_address || s.ip || '\u2014'),
        created_at: s.created_at ? fmtDateTime(s.created_at) : '\u2014',
        expires_at: s.expires_at ? fmtDate(s.expires_at)     : '\u2014'
      };
    });
  }

  function renderSessionsTable() {
    var table = document.getElementById('sv2-sessions-modal-table');
    if (!table || typeof table.setData !== 'function') return;
    Lex.Redact.on(table);
    table.setData(sessionRows(_sessions));
    Lex.Redact.off(table);
  }

  function setSessionsLoading(isLoading) {
    var refreshBtn = document.getElementById('sv2-sessions-modal-refresh-btn');
    var revokeBtn = document.getElementById('sv2-revoke-all-btn');
    if (refreshBtn) refreshBtn.loading = isLoading;
    if (revokeBtn) revokeBtn.disabled = isLoading;
  }

  function loadSessions(options) {
    options = options || {};
    if (_sessionsLoading && !options.force) return _sessionsLoading;

    setSessionsStatus('Loading sessions...');
    setSessionsModalStatus('Loading sessions...');
    setSessionsLoading(true);

    _sessionsLoading = api.get('/api/v1/auth/session').then(function (result) {
      var data = result.data || result;
      _sessions = Array.isArray(data) ? data : (data.sessions || []);
      _sessionsLoaded = true;
      setSessionsStatus(sessionCountLabel(_sessions.length));
      setSessionsModalStatus(sessionCountLabel(_sessions.length));
      renderSessionsTable();
      return _sessions;
    }).catch(function () {
      _sessions = [];
      _sessionsLoaded = true;
      setSessionsStatus('Could not load sessions.', true);
      setSessionsModalStatus('Could not load sessions.', true);
      renderSessionsTable();
      return [];
    }).finally(function () {
      setSessionsLoading(false);
      _sessionsLoading = null;
    });

    return _sessionsLoading;
  }

  function openSessionsModal() {
    if (_sessionsModal && _sessionsModal.open) return;

    var content = document.createElement('div');
    content.className = 'sv2-sessions-modal';
    content.innerHTML =
      '<div class="sv2-sessions-modal-toolbar">' +
        '<lex-text id="sv2-sessions-modal-status" variant="tertiary" size="body-sm" tag="p">' +
          esc(sessionCountLabel(_sessions.length)) +
        '</lex-text>' +
      '</div>' +
      '<lex-table ' +
        'id="sv2-sessions-modal-table" ' +
        'class="sv2-sessions-table" ' +
        'columns="device,ip_address,created_at,expires_at" ' +
        'labels="Device,IP Address,Created,Expires" ' +
        'empty-text="No active sessions" ' +
        'sort-by="created_at" ' +
        'sort-dir="desc" ' +
        'compact ' +
        'aria-label="Active sessions">' +
      '</lex-table>';

    _sessionsModal = Lex.Modal.open({
      heading: 'Active Sessions',
      content: content,
      hideActions: true,
      size: 'xl',
      closeOnOverlay: true,
      backButton: true,
      backLabel: 'Back to settings',
      headerActions: '<lex-btn id="sv2-sessions-modal-refresh-btn" variant="ghost" size="sm" icon="refresh-cw" aria-label="Refresh sessions">Refresh</lex-btn>',
      footerContent: '<lex-btn id="sv2-revoke-all-btn" variant="danger" size="sm" icon="log-out">Revoke All Other Sessions</lex-btn>'
    });

    _sessionsModal.addEventListener('lex-close', function () {
      _sessionsModal = null;
    });
    _sessionsModal.addEventListener('lex-back', function () {
      var modal = _sessionsModal;
      if (!modal) return;
      modal.emit('lex-close');
      modal.open = false;
    });

    setTimeout(function () {
      var refreshBtn = document.getElementById('sv2-sessions-modal-refresh-btn');
      var revokeBtn = document.getElementById('sv2-revoke-all-btn');
      if (refreshBtn) refreshBtn.addEventListener('click', function () { loadSessions({ force: true }); });
      if (revokeBtn) revokeBtn.addEventListener('click', revokeAllSessions);
      renderSessionsTable();
      if (!_sessionsLoaded) loadSessions();
      if (_sessionsLoading) setSessionsLoading(true);
    }, 0);
  }

  function revokeAllSessions() {
    Lex.Modal.confirm('Revoke All Sessions', 'This will log you out of all other devices. Continue?', function () {
      var currentToken = localStorage.getItem('token');
      api.delete('/api/v1/auth/session/', { revoke_all_except: currentToken }).then(function () {
        Lex.Toast.success('All other sessions revoked');
        loadSessions({ force: true });
      }).catch(function (error) {
        Lex.Toast.error(error.message || 'Failed to revoke sessions');
      });
    }, {
      variant: 'danger',
      confirmText: 'Revoke All'
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
        Lex.Modal.confirm('Reset VPN Configuration', 'This will remove your VPN keys. You will need to set up VPN again. Continue?', function () {
          vpnManager.clearKeys().then(function () {
            Lex.Toast.success('VPN configuration reset');
            loadVpnStatus();
          }).catch(function (error) {
            Lex.Toast.error(error.message || 'Failed to reset VPN');
          });
        }, {
          variant: 'danger',
          confirmText: 'Reset'
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
    var diff = Lex.Utils.millisecondsSince(then);
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

    Lex.Modal.confirm(
      'Revoke access for ' + appLabel + '?',
      appLabel + ' will need to ask for permission again the next time it tries to use this device\'s Lana session.',
      function () {
      revokeConnectedApp(btn, appKey, appLabel);
    }, {
      variant: 'danger',
      confirmText: 'Revoke'
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
  // Plugins / Connections (user-scoped connectors)
  // =========================================================================

  var USER_CONNECTION_REDIRECT_URI = 'lana-ai://oauth/callback';
  var _userConnectionsAvailable = false;
  var _oauthCallbackRegistered = false;
  var _pendingUserConnectionOAuth = null;
  var _userConnectionRows = [];
  var _userConnectionDataModal = null;
  var _userConnectionDataState = null;

  function notifySettingsNavVisibilityChanged() {
    try {
      window.dispatchEvent(new CustomEvent('settings-v2-section-visibility-changed'));
    } catch (e) { /* optional nav sync */ }
  }

  function showUserConnectionsSection() {
    if (dom.pluginsTab) dom.pluginsTab.classList.remove('sv2-hidden');
    if (dom.pluginsPanel) dom.pluginsPanel.classList.remove('sv2-hidden');
    if (dom.userConnectionsSection) dom.userConnectionsSection.classList.remove('sv2-hidden');
    notifySettingsNavVisibilityChanged();
  }

  function hideUserConnectionsSection() {
    if (dom.pluginsTab) dom.pluginsTab.classList.add('sv2-hidden');
    if (dom.pluginsPanel) {
      dom.pluginsPanel.classList.add('sv2-hidden');
      dom.pluginsPanel.classList.remove('is-active');
    }
    notifySettingsNavVisibilityChanged();
  }

  function setUserConnectionsStatus(text) {
    if (dom.userConnectionsStatus) dom.userConnectionsStatus.textContent = text || '';
  }

  function renderUserConnectionsLoading() {
    if (!dom.userConnectionsContent) return;
    dom.userConnectionsContent.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;padding:16px 0;">' +
        '<lex-spinner size="sm" label="Loading connections..."></lex-spinner>' +
      '</div>';
    setUserConnectionsStatus('Loading connections...');
  }

  function renderUserConnectionsEmpty() {
    if (!dom.userConnectionsContent) return;
    dom.userConnectionsContent.innerHTML =
      '<lex-empty ' +
        'icon="plug" ' +
        'message="No personal connectors are available." ' +
        'description="Your organization has not enabled any user-scoped connectors yet.">' +
      '</lex-empty>';
    setUserConnectionsStatus('');
  }

  function renderUserConnectionsError(message) {
    if (!dom.userConnectionsContent) return;
    dom.userConnectionsContent.innerHTML =
      '<lex-empty ' +
        'icon="plug" ' +
        'message="Connections could not be loaded." ' +
        'description="' + esc(message || 'Try refreshing this page.') + '">' +
      '</lex-empty>';
    setUserConnectionsStatus('');
  }

  function normalizeUserConnectionRows(payload) {
    var available = Array.isArray(payload && payload.available) ? payload.available : [];
    var connections = Array.isArray(payload && payload.connections) ? payload.connections : [];
    var rows = [];
    var byConnector = {};
    var i;

    for (i = 0; i < available.length; i++) {
      var item = available[i] || {};
      var connectorId = item.connector_id || item.connectorId || '';
      if (!connectorId) continue;
      var row = {
        source_id: item.source_id || item.id || null,
        connector_id: connectorId,
        name: item.name || item.connector_name || connectorId,
        description: (item.setup && item.setup.description) || item.description || '',
        provider: item.provider || '',
        account: item.account || '',
        status: item.status || 'available',
        auth_type: item.auth_type || '',
        last_synced_at: item.last_synced_at || item.last_sync_at || '',
        data_record_count: item.data_record_count || 0,
        sync_settings: item.sync_settings || {},
        tool_capabilities: item.tool_capabilities || {},
        supports_sync: item.supports_sync !== false,
        setup: item.setup || {}
      };
      byConnector[connectorId] = row;
      rows.push(row);
    }

    for (i = 0; i < connections.length; i++) {
      var connection = connections[i] || {};
      var id = connection.connector_id || connection.connectorId || '';
      if (!id) continue;
      var existing = byConnector[id];
      if (existing) {
        existing.source_id = existing.source_id || connection.id || null;
        existing.account = existing.account || connection.account || '';
        existing.last_synced_at = existing.last_synced_at || connection.last_sync_at || '';
        existing.data_record_count = connection.data_record_count || existing.data_record_count || 0;
        existing.sync_settings = connection.sync_settings || existing.sync_settings || {};
        existing.tool_capabilities = connection.tool_capabilities || existing.tool_capabilities || {};
        if (!existing.status || existing.status === 'available') {
          existing.status = connection.auth_status === 'connected'
            ? 'connected'
            : 'reauthorization_required';
        }
      } else {
        rows.push({
          source_id: connection.id || null,
          connector_id: id,
          name: connection.name || id,
          description: '',
          provider: '',
          account: connection.account || '',
          status: connection.auth_status === 'connected'
            ? 'connected'
            : 'reauthorization_required',
          auth_type: '',
          last_synced_at: connection.last_sync_at || '',
          data_record_count: connection.data_record_count || 0,
          sync_settings: connection.sync_settings || {},
          tool_capabilities: connection.tool_capabilities || {},
          supports_sync: true,
          setup: {}
        });
      }
    }

    rows.sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    return rows;
  }

  function statusBadgeMeta(status) {
    var value = String(status || 'available');
    if (value === 'connected') return { label: 'Connected', color: 'green' };
    if (value === 'reauthorization_required') return { label: 'Reconnect required', color: 'yellow' };
    if (value === 'awaiting_admin_configuration') return { label: 'Needs admin setup', color: 'yellow' };
    if (value === 'disabled_by_organization') return { label: 'Disabled', color: 'gray' };
    if (value === 'permission_denied') return { label: 'Permission denied', color: 'red' };
    if (value === 'available') return { label: 'Available', color: 'blue' };
    return { label: value.split('_').join(' '), color: 'gray' };
  }

  function actionsForUserConnection(row) {
    if (!row) return null;
    if (row.status === 'connected') {
      var connectedActions = [];
      if (row.source_id) connectedActions.push({ action: 'view-data', label: 'Data', variant: 'ghost', icon: 'database' });
      if (row.source_id && row.supports_sync !== false) connectedActions.push({ action: 'sync', label: 'Sync', variant: 'primary', icon: 'refresh-cw' });
      if (row.source_id) connectedActions.push({ action: 'disconnect', label: 'Disconnect', variant: 'danger', icon: 'unlink' });
      return connectedActions;
    }
    if (row.status === 'reauthorization_required') {
      return [{ action: 'connect', label: 'Reconnect', variant: 'primary', icon: 'refresh-cw' }];
    }
    if (row.status === 'available') {
      return [{ action: 'connect', label: (row.setup && row.setup.button_label) || 'Connect', variant: 'primary', icon: 'plug' }];
    }
    return [];
  }

  function formatConnectionMeta(row) {
    var parts = [];
    if (row.provider) parts.push(esc(row.provider));
    if (row.auth_type) parts.push(esc(String(row.auth_type).toUpperCase()));
    if (row.account) parts.push(esc(row.account));
    if (row.last_synced_at) {
      var times = formatGrantedAt(row.last_synced_at);
      parts.push(times.relative ? 'Synced ' + esc(times.relative) : 'Synced');
    }
    if (row.data_record_count) parts.push(String(row.data_record_count) + ' records');
    return parts.join(' • ');
  }

  function renderToolCapabilities(row) {
    var caps = row && row.tool_capabilities ? row.tool_capabilities : {};
    var tools = Array.isArray(caps.tools) ? caps.tools : [];
    if (!tools.length) {
      return '<div class="sv2-connection-tools"><span class="sv2-connection-tool-chip is-muted">Read-only</span></div>';
    }

    var html = '<div class="sv2-connection-tools">';
    for (var i = 0; i < tools.length; i++) {
      var tool = tools[i] || {};
      html += '<span class="sv2-connection-tool-chip" title="' + esc(tool.description || tool.key || '') + '">' +
        esc(tool.label || tool.key || 'Tool') +
      '</span>';
    }
    html += '</div>';
    return html;
  }

  function currentSyncFrequency(row) {
    var settings = row && row.sync_settings ? row.sync_settings : {};
    var frequency = settings.sync_frequency || 'manual';
    if (frequency === 'custom') {
      if (settings.sync_interval_minutes === 60) return 'hourly';
      if (settings.sync_interval_minutes === 10080) return 'weekly';
      return 'manual';
    }
    return ['manual', 'hourly', 'daily', 'weekly'].indexOf(frequency) !== -1 ? frequency : 'manual';
  }

  function renderSyncFrequencyControl(row) {
    if (!row || row.status !== 'connected' || !row.source_id || row.supports_sync === false) return '';
    var value = currentSyncFrequency(row);
    var options = [
      ['manual', 'Manual'],
      ['hourly', 'Hourly'],
      ['daily', 'Daily'],
      ['weekly', 'Weekly']
    ];
    var html =
      '<label class="sv2-connection-sync-control">' +
        '<span>Sync</span>' +
        '<select class="sv2-connection-sync-select" data-source-id="' + esc(row.source_id || '') + '" data-current-value="' + esc(value) + '">';
    for (var i = 0; i < options.length; i++) {
      html += '<option value="' + options[i][0] + '"' + (value === options[i][0] ? ' selected' : '') + '>' +
        options[i][1] +
      '</option>';
    }
    html += '</select></label>';
    return html;
  }

  function renderUserConnectionsRows(rows) {
    if (!dom.userConnectionsContent) return;
    if (!rows || rows.length === 0) {
      renderUserConnectionsEmpty();
      return;
    }
    _userConnectionRows = rows;

    var html = '<div class="sv2-connection-list">';
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var badge = statusBadgeMeta(row.status);
      var actions = actionsForUserConnection(row);
      var meta = formatConnectionMeta(row);
      var description = row.description || '';

      html +=
        '<div class="sv2-connection-row" ' +
          'data-connector-id="' + esc(row.connector_id) + '" ' +
          'data-source-id="' + esc(row.source_id || '') + '">' +
          '<div class="sv2-connection-info">' +
            '<div class="sv2-connection-heading">' +
              '<lex-text variant="primary" size="body" weight="medium">' + esc(row.name) + '</lex-text>' +
              '<lex-badge size="sm" color="' + esc(badge.color) + '" label="' + esc(badge.label) + '"></lex-badge>' +
            '</div>' +
            (description ? '<span class="sv2-connection-description">' + esc(description) + '</span>' : '') +
            (meta ? '<span class="sv2-connection-meta">' + meta + '</span>' : '') +
            renderToolCapabilities(row) +
          '</div>' +
          '<div class="sv2-connection-controls">' +
            renderSyncFrequencyControl(row);

      if (actions && actions.length) {
        for (var a = 0; a < actions.length; a++) {
          var action = actions[a];
          html +=
            '<lex-btn ' +
              'class="sv2-connection-action-btn" ' +
              'variant="' + esc(action.variant) + '" ' +
              'size="sm" ' +
              'icon="' + esc(action.icon) + '" ' +
              'data-action="' + esc(action.action) + '" ' +
              'data-connector-id="' + esc(row.connector_id) + '" ' +
              'data-source-id="' + esc(row.source_id || '') + '">' +
              esc(action.label) +
            '</lex-btn>';
        }
      } else {
        html += '<span class="sv2-connection-action-spacer" aria-hidden="true"></span>';
      }

      html += '</div></div>';
    }
    html += '</div>';

    dom.userConnectionsContent.innerHTML = html;
    wireUserConnectionButtons();
    setUserConnectionsStatus('');
  }

  function wireUserConnectionButtons() {
    if (!dom.userConnectionsContent) return;
    var buttons = dom.userConnectionsContent.querySelectorAll('.sv2-connection-action-btn');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', handleUserConnectionActionClick);
    }
    var selects = dom.userConnectionsContent.querySelectorAll('.sv2-connection-sync-select');
    for (var j = 0; j < selects.length; j++) {
      selects[j].addEventListener('change', handleUserConnectionSyncFrequencyChange);
    }
  }

  function getUserConnectionsPayload() {
    if (api && typeof api.getUserConnections === 'function') {
      return api.getUserConnections();
    }
    return api.get('/api/v1/me/connections');
  }

  function endpointMissing(error) {
    return error && (error.status === 404 || error.status === 405);
  }

  function loadUserConnections() {
    if (!dom.userConnectionsContent || !dom.pluginsPanel) return;
    renderUserConnectionsLoading();

    getUserConnectionsPayload().then(function (payload) {
      _userConnectionsAvailable = true;
      showUserConnectionsSection();
      renderUserConnectionsRows(normalizeUserConnectionRows(payload || {}));
      registerUserConnectionOAuthCallback();
    }).catch(function (error) {
      if (endpointMissing(error)) {
        _userConnectionsAvailable = false;
        hideUserConnectionsSection();
        return;
      }
      _userConnectionsAvailable = true;
      showUserConnectionsSection();
      renderUserConnectionsError((error && error.message) || 'Try refreshing this page.');
    });
  }

  function openExternalUrl(url) {
    if (!url) return;
    if (window.electronAPI && typeof window.electronAPI.openExternal === 'function') {
      window.electronAPI.openExternal(url);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function connectUserConnector(btn, connectorId) {
    if (!connectorId || !api) return;
    if (btn) btn.loading = true;

    api.connectUserConnection(connectorId, USER_CONNECTION_REDIRECT_URI).then(function (result) {
      var data = (result && result.data) || result || {};
      _pendingUserConnectionOAuth = {
        connectorId: connectorId,
        state: data.state || null
      };
      if (data.authorizationUrl) {
        openExternalUrl(data.authorizationUrl);
        Lex.Toast.info('Complete authorization in your browser.');
      } else {
        Lex.Toast.error('Authorization URL was not returned by the server.');
        if (btn) btn.loading = false;
      }
    }).catch(function (error) {
      Lex.Toast.error((error && error.message) || 'Failed to start authorization.');
      if (btn) btn.loading = false;
    });
  }

  function completeUserConnectorOAuth(data) {
    if (!_pendingUserConnectionOAuth || !data) return;
    if (data.error) {
      Lex.Toast.error(data.error_description || data.error);
      _pendingUserConnectionOAuth = null;
      loadUserConnections();
      return;
    }
    if (!data.code || !data.state) return;
    if (_pendingUserConnectionOAuth.state && data.state !== _pendingUserConnectionOAuth.state) return;

    var connectorId = _pendingUserConnectionOAuth.connectorId;
    api.completeUserConnection(connectorId, {
      code: data.code,
      state: data.state,
      redirect_uri: USER_CONNECTION_REDIRECT_URI
    }).then(function () {
      Lex.Toast.success('Connection authorized.');
      _pendingUserConnectionOAuth = null;
      loadUserConnections();
    }).catch(function (error) {
      Lex.Toast.error((error && error.message) || 'Failed to complete authorization.');
      _pendingUserConnectionOAuth = null;
      loadUserConnections();
    });
  }

  function registerUserConnectionOAuthCallback() {
    if (_oauthCallbackRegistered) return;
    if (!window.electronAPI || typeof window.electronAPI.onOAuthCallback !== 'function') return;
    window.electronAPI.onOAuthCallback(completeUserConnectorOAuth);
    _oauthCallbackRegistered = true;
  }

  function syncUserConnection(btn, sourceId) {
    if (!sourceId) return;
    if (btn) btn.loading = true;
    api.syncUserConnection(sourceId).then(function () {
      Lex.Toast.success('Sync queued.');
      loadUserConnections();
    }).catch(function (error) {
      Lex.Toast.error((error && error.message) || 'Failed to queue sync.');
      if (btn) btn.loading = false;
    });
  }

  function findUserConnectionRow(sourceId) {
    for (var i = 0; i < _userConnectionRows.length; i++) {
      if (String(_userConnectionRows[i].source_id || '') === String(sourceId || '')) return _userConnectionRows[i];
    }
    return null;
  }

  function getUserConnectionDataBody() {
    return _userConnectionDataModal ? _userConnectionDataModal.querySelector('[data-user-connection-data-body]') : null;
  }

  function renderDataLoading() {
    var body = getUserConnectionDataBody();
    if (!body) return;
    body.innerHTML =
      '<div class="sv2-connection-data-loading">' +
        '<lex-spinner size="sm" label="Loading data..."></lex-spinner>' +
      '</div>';
  }

  function formatRecordTimestamp(value) {
    if (!value) return '';
    var formatted = formatGrantedAt(value);
    return formatted.relative || value;
  }

  function renderEntityFilterOptions(counts, selected) {
    var html = '<option value="">All entities</option>';
    for (var i = 0; i < (counts || []).length; i++) {
      var count = counts[i] || {};
      var entity = count.entity_type || '';
      if (!entity) continue;
      html += '<option value="' + esc(entity) + '"' + (selected === entity ? ' selected' : '') + '>' +
        esc(entity) + ' (' + esc(String(count.count || 0)) + ')' +
      '</option>';
    }
    return html;
  }

  function renderConnectionDataRecords(payload) {
    var records = payload.records || [];
    if (!records.length) {
      return '<lex-empty icon="database" message="No synced records found."></lex-empty>';
    }

    var html = '<div class="sv2-connection-data-table" role="table">';
    html +=
      '<div class="sv2-connection-data-row sv2-connection-data-head" role="row">' +
        '<span role="columnheader">Type</span>' +
        '<span role="columnheader">Record</span>' +
        '<span role="columnheader">Synced</span>' +
        '<span role="columnheader">Payload</span>' +
      '</div>';

    for (var i = 0; i < records.length; i++) {
      var record = records[i] || {};
      var payloadText = '';
      try {
        payloadText = JSON.stringify(record.data || {}, null, 2);
      } catch (e) {
        payloadText = '{}';
      }

      html +=
        '<div class="sv2-connection-data-row" role="row">' +
          '<span role="cell">' + esc(record.entity_type || '') + '</span>' +
          '<span role="cell">' +
            '<strong>' + esc(record.title || record.external_id || 'Record') + '</strong>' +
            (record.external_id ? '<small>' + esc(record.external_id) + '</small>' : '') +
            (record.matter_name ? '<small>' + esc(record.matter_name) + '</small>' : '') +
          '</span>' +
          '<span role="cell">' + esc(formatRecordTimestamp(record.synced_at || record.updated_at)) + '</span>' +
          '<span role="cell">' +
            '<details class="sv2-connection-data-json">' +
              '<summary>JSON</summary>' +
              '<pre>' + esc(payloadText) + '</pre>' +
            '</details>' +
          '</span>' +
        '</div>';
    }

    html += '</div>';
    return html;
  }

  function renderConnectionData(payload) {
    var body = getUserConnectionDataBody();
    if (!body) return;
    var state = _userConnectionDataState || {};
    var pagination = payload.pagination || {};
    var source = payload.source || {};
    var total = pagination.total || 0;
    var page = pagination.page || state.page || 1;

    body.innerHTML =
      '<div class="sv2-connection-data-toolbar">' +
        '<select class="sv2-connection-data-entity" aria-label="Entity type">' +
          renderEntityFilterOptions(payload.entity_counts || [], state.entityType || '') +
        '</select>' +
        '<input class="sv2-connection-data-search" type="search" placeholder="Search records" value="' + esc(state.query || '') + '">' +
        '<lex-btn size="sm" variant="secondary" icon="search" data-action="filter-data">Search</lex-btn>' +
        '<lex-btn size="sm" variant="danger" icon="trash-2" data-action="delete-data">Delete data</lex-btn>' +
      '</div>' +
      '<div class="sv2-connection-data-summary">' +
        esc(source.name || source.connector_id || 'Connection') + ' • ' + esc(String(total)) + ' records' +
      '</div>' +
      renderConnectionDataRecords(payload) +
      '<div class="sv2-connection-data-pager">' +
        '<lex-btn size="sm" variant="ghost" icon="chevron-left" data-action="data-prev" ' + (page <= 1 ? 'disabled' : '') + '>Previous</lex-btn>' +
        '<span>Page ' + esc(String(page)) + '</span>' +
        '<lex-btn size="sm" variant="ghost" icon="chevron-right" data-action="data-next" ' + (!pagination.has_more ? 'disabled' : '') + '>Next</lex-btn>' +
      '</div>';

    wireConnectionDataModal();
  }

  function loadUserConnectionData() {
    var state = _userConnectionDataState;
    if (!state || !state.sourceId) return;
    renderDataLoading();
    api.getUserConnectionData(state.sourceId, {
      page: state.page || 1,
      limit: state.limit || 25,
      entity_type: state.entityType || '',
      q: state.query || ''
    }).then(function (payload) {
      renderConnectionData(payload || {});
    }).catch(function (error) {
      var body = getUserConnectionDataBody();
      if (body) {
        body.innerHTML =
          '<lex-empty icon="database" message="Data could not be loaded." description="' +
          esc((error && error.message) || 'Try again.') +
          '"></lex-empty>';
      }
    });
  }

  function wireConnectionDataModal() {
    var body = getUserConnectionDataBody();
    if (!body) return;
    var filterBtn = body.querySelector('[data-action="filter-data"]');
    var prevBtn = body.querySelector('[data-action="data-prev"]');
    var nextBtn = body.querySelector('[data-action="data-next"]');
    var deleteBtn = body.querySelector('[data-action="delete-data"]');

    if (filterBtn) {
      filterBtn.addEventListener('click', function () {
        var entity = body.querySelector('.sv2-connection-data-entity');
        var search = body.querySelector('.sv2-connection-data-search');
        _userConnectionDataState.entityType = entity ? entity.value : '';
        _userConnectionDataState.query = search ? search.value : '';
        _userConnectionDataState.page = 1;
        loadUserConnectionData();
      });
    }
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        _userConnectionDataState.page = Math.max(1, (_userConnectionDataState.page || 1) - 1);
        loadUserConnectionData();
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        _userConnectionDataState.page = (_userConnectionDataState.page || 1) + 1;
        loadUserConnectionData();
      });
    }
    if (deleteBtn) {
      deleteBtn.addEventListener('click', deleteUserConnectionData);
    }
  }

  function openUserConnectionData(sourceId) {
    var row = findUserConnectionRow(sourceId);
    if (!row || !sourceId) return;
    _userConnectionDataState = {
      sourceId: sourceId,
      page: 1,
      limit: 25,
      entityType: '',
      query: ''
    };
    _userConnectionDataModal = Lex.Modal.open({
      heading: (row.name || 'Connection') + ' Data',
      size: 'lg',
      hideActions: true,
      content: '<div class="sv2-connection-data-modal" data-user-connection-data-body></div>'
    });
    _userConnectionDataModal.addEventListener('lex-close', function () {
      _userConnectionDataModal = null;
      _userConnectionDataState = null;
    });
    loadUserConnectionData();
  }

  function deleteUserConnectionData() {
    var state = _userConnectionDataState;
    if (!state || !state.sourceId) return;
    Lex.Modal.confirm(
      'Delete synced data?',
      'This deletes records pulled from this personal connector in LANA. It does not delete data from the external account.',
      function () {
        api.deleteUserConnectionData(state.sourceId).then(function (result) {
          var deleted = result && result.deleted ? result.deleted.total : 0;
          Lex.Toast.success('Deleted ' + deleted + ' synced records.');
          loadUserConnections();
          if (_userConnectionDataModal) {
            _userConnectionDataState.page = 1;
            _userConnectionDataState.entityType = '';
            _userConnectionDataState.query = '';
            loadUserConnectionData();
          }
        }).catch(function (error) {
          Lex.Toast.error((error && error.message) || 'Failed to delete synced data.');
        });
      },
      {
        variant: 'danger',
        confirmText: 'Delete data'
      }
    );
  }

  function updateUserConnectionSyncFrequency(select, sourceId, frequency) {
    if (!sourceId || !frequency) return;
    var previous = select ? select.getAttribute('data-current-value') || select.value : '';
    if (select) select.disabled = true;
    api.updateUserConnectionSyncSettings(sourceId, {
      sync_frequency: frequency,
      scheduled_sync_time: frequency === 'daily' ? '08:00:00' : undefined
    }).then(function () {
      Lex.Toast.success('Sync frequency updated.');
      loadUserConnections();
    }).catch(function (error) {
      if (select) {
        select.value = previous || 'manual';
        select.disabled = false;
      }
      Lex.Toast.error((error && error.message) || 'Failed to update sync frequency.');
    });
  }

  function handleUserConnectionSyncFrequencyChange(e) {
    var select = e.currentTarget;
    if (!select) return;
    updateUserConnectionSyncFrequency(
      select,
      select.getAttribute('data-source-id'),
      select.value
    );
  }

  function disconnectUserConnection(btn, sourceId) {
    if (!sourceId) return;
    Lex.Modal.confirm('Disconnect this account?', 'LANA will stop syncing this personal connector and clear its stored credentials.', function () {
      if (btn) btn.loading = true;
      api.disconnectUserConnection(sourceId).then(function () {
        Lex.Toast.success('Connection disconnected.');
        loadUserConnections();
      }).catch(function (error) {
        Lex.Toast.error((error && error.message) || 'Failed to disconnect.');
        if (btn) btn.loading = false;
      });
    }, {
      variant: 'danger',
      confirmText: 'Disconnect'
    });
  }

  function handleUserConnectionActionClick(e) {
    var btn = e.currentTarget;
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    var connectorId = btn.getAttribute('data-connector-id');
    var sourceId = btn.getAttribute('data-source-id');

    if (action === 'connect') connectUserConnector(btn, connectorId);
    else if (action === 'sync') syncUserConnection(btn, sourceId);
    else if (action === 'view-data') openUserConnectionData(sourceId);
    else if (action === 'disconnect') disconnectUserConnection(btn, sourceId);
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
    if (dom.prefPush) {
      dom.prefPush.addEventListener('lex-change', function (e) {
        handleNotificationPreferenceChange('push_enabled', e.detail.value);
      });
    }
    if (dom.prefInApp) {
      dom.prefInApp.addEventListener('lex-change', function (e) {
        handleInAppParentPreferenceChange(e.detail.value);
      });
    }
    if (dom.inAppTypesToggle) {
      dom.inAppTypesToggle.addEventListener('click', handleInAppTypesToggleClick);
    }

    // ── Sessions ──
    if (dom.sessionsManageBtn) {
      dom.sessionsManageBtn.addEventListener('click', openSessionsModal);
    }

    // Session table — no per-row revoke in settings (user revokes all or none)

    // Topbar refresh button
    document.addEventListener('lex-refresh', function (e) {
      e.preventDefault();
      loadProfile();
      loadMfaStatus();
      loadSessions();
      loadConnectedApps();
      if (_userConnectionsAvailable) loadUserConnections();
    });

    // ── Load all data ──
    loadProfile();
    loadTimezone();
    if (api && typeof api.getSystemConfig === 'function') {
      api.getSystemConfig().then(function (result) {
        if (typeof api.applyRuntimeConfig === 'function') api.applyRuntimeConfig(result);
      }).catch(function () {
        if (window.LanaConfig) window.LanaConfig.MFA_ENABLED = false;
        if (api && api.config) api.config.MFA_ENABLED = false;
      }).finally(function () {
        loadMfaStatus();
      });
    } else {
      loadMfaStatus();
    }
    loadSessions();
    loadConnectedApps();
    loadUserConnections();
    showConditionalSections();
  }

  // Standalone page — init directly (no SPA router)
  init();

})();
