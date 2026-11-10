/**
 * Account activation on the sign-in screen (login.html, #activationScreen).
 *
 * "Have an activation code?" opens this screen. The person enters the
 * Organization ID, their email and the code from their activation email, and
 * chooses a password. Then: find the organization (the same discovery as
 * Connect), POST /api/v1/auth/activate, and sign in with the new password
 * through the sign-in form's own path (window.LanaSignIn, set by login.html).
 *
 * The rules (code tidying, request shape, error words) live in
 * js/shared/activation-flow.js; this file draws and wires the screen.
 * Follows the computer's light or dark setting.
 */
(function () {
  'use strict';

  var flow = window.LanaActivationFlow;
  var discovery = window.LanaOrgDiscovery;
  if (!flow || !discovery) {
    console.error('[activation] a script is missing; activation is not available');
    return;
  }

  function $(id) { return document.getElementById(id); }

  var screen = $('activationScreen');
  var signInPanel = $('signInPanel');
  var form = $('activationForm');
  if (!screen || !signInPanel || !form) return;

  var fields = {
    orgId: $('actOrgId'),
    email: $('actEmail'),
    code: $('actCode'),
    password: $('actPassword'),
    confirm: $('actConfirm')
  };
  var rulesList = $('actPasswordRules');
  var errorBox = $('actError');
  var submitBtn = $('actSubmit');
  var SUBMIT_LABEL = 'Activate and sign in';

  // ---- Light or dark, as the computer is set -----------------------------------------

  var dark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function applyTheme() {
    screen.setAttribute('data-lex-theme', dark && dark.matches ? 'dark' : 'light');
  }
  applyTheme();
  if (dark && dark.addEventListener) dark.addEventListener('change', applyTheme);

  // ---- Password hints ------------------------------------------------------------------

  function renderRules() {
    rulesList.textContent = '';
    flow.PASSWORD_RULES.forEach(function (rule) {
      var item = document.createElement('li');
      item.className = 'act-rule';
      item.setAttribute('data-rule', rule.id);
      var dot = document.createElement('span');
      dot.className = 'act-rule-dot';
      dot.setAttribute('aria-hidden', 'true');
      item.appendChild(dot);
      item.appendChild(document.createTextNode(rule.label));
      rulesList.appendChild(item);
    });
  }

  function updateRules(password) {
    var checks = flow.checkPassword(password);
    flow.PASSWORD_RULES.forEach(function (rule) {
      var item = rulesList.querySelector('[data-rule="' + rule.id + '"]');
      if (item) item.classList.toggle('act-rule--met', !!checks[rule.id]);
    });
  }

  renderRules();

  // ---- Values and messages -------------------------------------------------------------

  function value(name) {
    var el = fields[name];
    return el ? String(el.value || '') : '';
  }

  function clearFieldErrors() {
    Object.keys(fields).forEach(function (name) {
      if (fields[name]) fields[name].error = '';
    });
  }

  function hideError() {
    errorBox.hidden = true;
  }

  function showError(title, detail, support) {
    $('actErrorTitle').textContent = title || '';
    $('actErrorTitle').hidden = !title;
    $('actErrorDetail').textContent = detail || '';
    $('actErrorSupport').textContent = support || '';
    $('actErrorSupport').hidden = !support;
    errorBox.hidden = false;
    if (typeof errorBox.scrollIntoView === 'function') errorBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function setBusy(label) {
    submitBtn.loading = !!label;
    submitBtn.disabled = !!label;
    submitBtn.label = label || SUBMIT_LABEL;
  }

  // ---- Open and close ------------------------------------------------------------------

  function rememberedOrgId() {
    try {
      var saved = JSON.parse(localStorage.getItem('lana_saved_server') || 'null');
      if (saved && saved.orgId) return saved.orgId;
    } catch (e) { /* no saved server */ }
    try { return localStorage.getItem('lana_remembered_org_id') || ''; } catch (e) { return ''; }
  }

  function open(prefill) {
    var p = prefill || {};
    var orgInput = $('orgId');
    var orgId = p.orgId || (orgInput && orgInput.value) || rememberedOrgId();
    if (orgId && !value('orgId')) fields.orgId.value = orgId;
    if (p.email) fields.email.value = p.email;
    hideError();
    clearFieldErrors();
    signInPanel.classList.add('hidden');
    screen.hidden = false;
    var first = ['orgId', 'email', 'code'].filter(function (n) { return !value(n); })[0] || 'password';
    var input = fields[first] && fields[first].querySelector('input');
    if (input) input.focus();
  }

  function close() {
    screen.hidden = true;
    signInPanel.classList.remove('hidden');
  }

  document.querySelectorAll('[data-open-activation]').forEach(function (link) {
    link.addEventListener('click', function () {
      var email = $('email');
      open({ email: email && email.value ? email.value.trim() : '' });
    });
  });
  $('actBack').addEventListener('click', close);

  fields.password.addEventListener('lex-input', function () { updateRules(value('password')); });
  fields.code.addEventListener('lex-change', function () {
    var formatted = flow.formatActivationCode(value('code'));
    if (formatted !== value('code')) fields.code.value = formatted;
  });

  // ---- Activate, then sign in ----------------------------------------------------------

  async function activate() {
    hideError();
    clearFieldErrors();
    var values = {
      orgId: value('orgId').trim().toLowerCase(),
      email: value('email').trim(),
      code: value('code'),
      password: value('password'),
      confirm: value('confirm')
    };
    updateRules(values.password);

    if (values.code && flow.formatActivationCode(values.code) !== values.code) {
      fields.code.value = flow.formatActivationCode(values.code);
    }

    var check = flow.validateForm(values);
    if (!check.ok) {
      var field = fields[check.field];
      field.error = check.message;
      if (typeof field.scrollIntoView === 'function') field.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    setBusy('Finding your organization...');
    var serverInfo;
    try {
      serverInfo = await window.LanaSignIn.connect(values.orgId);
    } catch (error) {
      var failure = discovery.describeFailure(error, values.orgId);
      showError(failure.title, failure.detail, failure.support);
      setBusy('');
      return;
    }

    setBusy('Activating...');
    try {
      await window.api.activateAccount(flow.buildActivateRequest(values).body);
    } catch (error) {
      showError('Activation did not go through', flow.activationErrorMessage(error), '');
      setBusy('');
      return;
    }

    if (window.Toast) window.Toast.success('Account activated. Signing you in...');
    setBusy('');
    close();
    fields.password.value = '';
    fields.confirm.value = '';
    await window.LanaSignIn.signInWith(serverInfo, values.email, values.password);
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    activate();
  });

  window.LanaActivation = { open: open, close: close };

  if (window.location.hash === '#activate') open();
})();
