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
    dom.profileEmail     = document.getElementById('sv2-profile-email');
    dom.avatarInitials   = document.getElementById('sv2-avatar-initials');
    dom.profileNameEdit  = document.getElementById('sv2-profile-name-edit');
    dom.profileEmailEdit = document.getElementById('sv2-profile-email-edit');
    dom.avatarInitialsEdit = document.getElementById('sv2-avatar-initials-edit');
    dom.kvFirstName      = document.getElementById('sv2-kv-firstname');
    dom.kvLastName       = document.getElementById('sv2-kv-lastname');
    dom.kvRole           = document.getElementById('sv2-kv-role');
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

    // Preferences
    dom.prefEmail = document.getElementById('sv2-pref-email');
    dom.prefDark  = document.getElementById('sv2-pref-dark');

    // Sessions
    dom.sessionsCard = document.getElementById('sv2-sessions-card');
    dom.sessionsList = document.getElementById('sv2-sessions-list');
    dom.revokeAllBtn = document.getElementById('sv2-revoke-all-btn');

    // VPN
    dom.vpnContent = document.getElementById('sv2-vpn-content');
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

      var firstName = user.first_name || '';
      var lastName = user.last_name || '';
      var name = (firstName + ' ' + lastName).trim() || user.email || '';
      var initials = ((firstName.charAt(0) || '') + (lastName.charAt(0) || '')).toUpperCase() ||
                     (user.email ? user.email.charAt(0).toUpperCase() : 'U');

      // View mode
      if (dom.profileName) dom.profileName.textContent = name;
      if (dom.profileEmail) dom.profileEmail.textContent = user.email || '';
      if (dom.avatarInitials) dom.avatarInitials.textContent = initials;
      if (dom.kvFirstName) dom.kvFirstName.setAttribute('value', firstName || '--');
      if (dom.kvLastName) dom.kvLastName.setAttribute('value', lastName || '--');
      if (dom.kvRole) dom.kvRole.setAttribute('value', user.role_name || '--');
      if (dom.kvOrg) dom.kvOrg.setAttribute('value', user.organization_name || '--');

      // Edit mode pre-fill
      if (dom.profileNameEdit) dom.profileNameEdit.textContent = name;
      if (dom.profileEmailEdit) dom.profileEmailEdit.textContent = user.email || '';
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

  function loadSessions() {
    if (dom.sessionsList) Lex.Redact.on(dom.sessionsList);

    api.get('/api/v1/auth/session').then(function (result) {
      var data = result.data || result;
      var sessions = data.sessions || [];
      renderSessions(sessions);
      if (dom.sessionsList) Lex.Redact.off(dom.sessionsList);
    }).catch(function () {
      if (dom.sessionsList) {
        Lex.Redact.off(dom.sessionsList);
        dom.sessionsList.innerHTML = '<lex-empty message="Failed to load sessions" icon="inbox"></lex-empty>';
      }
    });
  }

  function renderSessions(sessions) {
    if (!dom.sessionsList) return;
    if (!sessions.length) {
      dom.sessionsList.innerHTML = '<lex-empty message="No active sessions" icon="monitor"></lex-empty>';
      return;
    }

    var html = '';
    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i];
      var ip = esc(s.ip_address || 'Unknown IP');
      var ua = s.user_agent ? esc(s.user_agent.substring(0, 60)) + '...' : 'Unknown device';
      var lastActive = Lex.Utils.timeAgo(s.last_accessed || s.created_at);

      html +=
        '<div class="sv2-session-row">' +
          '<div class="sv2-session-info">' +
            '<lex-text variant="primary" size="body-sm" weight="medium">' + ip + '</lex-text>' +
            '<lex-text variant="tertiary" size="body-xs">' + ua + '</lex-text>' +
            '<lex-text variant="tertiary" size="body-xs">Last active: ' + esc(lastActive) + '</lex-text>' +
          '</div>' +
          '<lex-btn variant="ghost" size="sm" data-action="revoke" data-session-id="' + esc(s.id) + '">Revoke</lex-btn>' +
        '</div>';
    }

    dom.sessionsList.innerHTML = html;
  }

  function revokeSession(sessionId) {
    api.delete('/api/v1/auth/session/' + sessionId).then(function () {
      Lex.Toast.success('Session revoked');
      loadSessions();
    }).catch(function (error) {
      Lex.Toast.error(error.message || 'Failed to revoke session');
    });
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

    // Session list — event delegation for individual revoke
    if (dom.sessionsList) {
      dom.sessionsList.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-action="revoke"]');
        if (btn) {
          revokeSession(btn.dataset.sessionId);
        }
      });
    }

    // Topbar refresh button
    document.addEventListener('lex-refresh', function (e) {
      e.preventDefault();
      loadProfile();
      loadMfaStatus();
      loadSessions();
    });

    // ── Load all data ──
    loadProfile();
    loadMfaStatus();
    loadSessions();
    showConditionalSections();
  }

  // Standalone page — init directly (no SPA router)
  init();

})();
