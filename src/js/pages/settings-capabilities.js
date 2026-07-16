/**
 * Settings V2 capability activation.
 *
 * Discovery decides which capabilities the organization is entitled to use.
 * This page only controls the local activation preference exposed by the
 * Electron main process; it cannot add entitlements or override `required`.
 */
(function () {
  'use strict';

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text === 'string') node.textContent = text;
    return node;
  }

  function appendHintValue(container, value) {
    if (typeof value === 'string') {
      container.appendChild(element('p', 'sv2-capability-hint-text', value));
      return;
    }
    if (Array.isArray(value)) {
      var list = element('ul', 'sv2-capability-hint-list');
      value.forEach(function (item) {
        if (typeof item === 'string') list.appendChild(element('li', '', item));
      });
      if (list.children.length) container.appendChild(list);
      return;
    }
    if (value && typeof value === 'object') {
      var details = element('dl', 'sv2-capability-hint-details');
      Object.keys(value).forEach(function (key) {
        if (typeof value[key] !== 'string') return;
        details.appendChild(element('dt', '', key));
        details.appendChild(element('dd', '', value[key]));
      });
      if (details.children.length) container.appendChild(details);
    }
  }

  function renderHints(parent, hints) {
    if (!hints || typeof hints !== 'object' || !Object.keys(hints).length) return;
    var wrapper = element('div', 'sv2-capability-hints');
    wrapper.appendChild(element('h4', 'sv2-capability-hints-title', 'Helpful tips'));
    Object.keys(hints).forEach(function (key) {
      var group = element('section', 'sv2-capability-hint-group');
      group.appendChild(element('h5', '', key));
      appendHintValue(group, hints[key]);
      if (group.children.length > 1) wrapper.appendChild(group);
    });
    if (wrapper.children.length > 1) parent.appendChild(wrapper);
  }

  function availabilityText(capability) {
    if (!capability.available) return 'Unavailable on this platform';
    if (capability.required) return 'Required by your organization';
    return capability.active ? 'Active on this device' : 'Off on this device';
  }

  function platformText(platforms) {
    if (!Array.isArray(platforms) || !platforms.length) return 'All supported platforms';
    var labels = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };
    return platforms.map(function (platform) { return labels[platform] || platform; }).join(', ');
  }

  function createToggleOption(name, description, field, checked, disabled) {
    var option = element('div', 'sv2-capability-option');
    var copy = element('div', 'sv2-capability-option-copy');
    copy.appendChild(element('span', 'sv2-capability-option-name', name));
    copy.appendChild(element('span', 'sv2-capability-option-description', description));
    var toggleLabel = element('label', 'sv2-capability-toggle');
    var toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.name = field;
    toggle.checked = Boolean(checked);
    toggle.disabled = Boolean(disabled);
    toggle.setAttribute('aria-label', name);
    toggleLabel.appendChild(toggle);
    toggleLabel.appendChild(element('span', 'sv2-capability-toggle-track'));
    option.appendChild(copy);
    option.appendChild(toggleLabel);
    return option;
  }

  function createVoiceField(labelText, field, value, options) {
    var label = element('label', 'sv2-capability-field');
    label.appendChild(element('span', 'sv2-capability-select-label', labelText));
    var control;
    if (Array.isArray(options)) {
      control = element('select', 'sv2-capability-select');
      options.forEach(function (option) { control.appendChild(new Option(option.label, option.value)); });
    } else {
      control = document.createElement('input');
      control.className = 'sv2-capability-input';
      control.type = 'text';
      control.autocomplete = 'off';
    }
    control.name = field;
    control.value = value || '';
    label.appendChild(control);
    return label;
  }

  function permissionLabel(type, permissions) {
    if (!permissions) return { label: 'Checking', color: 'gray' };
    if (type === 'microphone') {
      if (permissions.microphone === true) return { label: 'Allowed', color: 'green' };
      if (permissions.microphoneStatus === 'unavailable') return { label: 'Unavailable', color: 'gray' };
      if (['denied', 'restricted'].indexOf(permissions.microphoneStatus) !== -1) return { label: 'Denied', color: 'red' };
      return { label: 'Required', color: 'yellow' };
    }
    if (permissions.accessibility === true) return { label: 'Allowed', color: 'green' };
    if (permissions.supported === false) return { label: 'Unavailable', color: 'gray' };
    return { label: 'Required', color: 'yellow' };
  }

  function createPermissionRow(type, labelText, permissions, onRequest, disabled) {
    var row = element('div', 'sv2-capability-permission');
    var copy = element('div', 'sv2-capability-option-copy');
    copy.appendChild(element('span', 'sv2-capability-option-name', labelText));
    copy.appendChild(element('span', 'sv2-capability-option-description',
      type === 'microphone' ? 'Required to hear your dictation.' : 'Required to identify and update the focused field safely.'));
    var actions = element('div', 'sv2-capability-permission-actions');
    var state = permissionLabel(type, permissions);
    var badge = document.createElement('lex-badge');
    badge.id = 'sv2-voice-permission-' + type;
    badge.setAttribute('label', state.label);
    badge.setAttribute('color', state.color);
    badge.setAttribute('size', 'sm');
    var button = document.createElement('lex-btn');
    button.id = 'sv2-voice-permission-button-' + type;
    button.setAttribute('variant', 'secondary');
    button.setAttribute('size', 'sm');
    button.textContent = 'Enable';
    button.dataset.capabilityDisabled = disabled ? 'true' : 'false';
    button.disabled = Boolean(disabled) || state.label === 'Allowed' || state.label === 'Unavailable';
    button.addEventListener('click', function () { onRequest(type, button); });
    actions.appendChild(badge);
    if (state.label !== 'Allowed') actions.appendChild(button);
    row.appendChild(copy);
    row.appendChild(actions);
    return row;
  }

  function renderVoiceSettings(parent, capability, onSave, onPermissionRequest) {
    var settings = capability.voiceSettings || {};
    var disabled = !capability.active || !capability.available;
    var form = element('form', 'sv2-capability-voice-settings');
    form.appendChild(element('h4', 'sv2-capability-subheading', 'Voice settings'));
    var fields = element('div', 'sv2-capability-field-grid');
    var dictationShortcut = createVoiceField('Dictation shortcut', 'dictationShortcut',
      settings.dictationShortcut || 'CommandOrControl+Shift+Space');
    var agentShortcut = createVoiceField('Agent shortcut', 'agentShortcut',
      settings.agentShortcut || 'CommandOrControl+Shift+A');
    dictationShortcut.querySelector('input').disabled = true;
    agentShortcut.querySelector('input').disabled = true;
    fields.appendChild(dictationShortcut);
    fields.appendChild(agentShortcut);
    fields.appendChild(createVoiceField('Default mode', 'defaultMode', settings.defaultMode || 'dictation', [
      { label: 'Dictation', value: 'dictation' }, { label: 'Agent', value: 'agent' }
    ]));
    fields.appendChild(createVoiceField('Confirmation', 'confirmationPolicy', settings.confirmationPolicy || 'risk_based', [
      { label: 'Risk based', value: 'risk_based' }, { label: 'Always preview', value: 'always' },
      { label: 'Skip for safe inserts', value: 'never_safe_only' }
    ]));
    Array.prototype.forEach.call(fields.querySelectorAll('input, select'), function (control) { control.disabled = disabled; });
    dictationShortcut.querySelector('input').disabled = true;
    agentShortcut.querySelector('input').disabled = true;
    form.appendChild(fields);
    form.appendChild(createToggleOption('Open at Login',
      'Show Screen Dictation after you sign in. When off, use a configured shortcut to open it.',
      'openAtLogin', settings.openAtLogin, disabled));
    form.appendChild(createToggleOption('Use active-window context in Agent mode',
      'Share only scoped accessible content from the active window when an agent request needs it.',
      'screenContextEnabled', settings.screenContextEnabled !== false, disabled));
    form.appendChild(createToggleOption('Speak agent answers',
      'Play a spoken response when the voice provider supports it.',
      'voiceOutputEnabled', settings.voiceOutputEnabled, disabled));

    var permissions = element('section', 'sv2-capability-permissions');
    permissions.appendChild(element('h4', 'sv2-capability-subheading', 'Permissions'));
    permissions.appendChild(createPermissionRow('microphone', 'Microphone', capability.voicePermissions, onPermissionRequest, disabled));
    permissions.appendChild(createPermissionRow('accessibility', 'Accessibility', capability.voicePermissions, onPermissionRequest, disabled));
    form.appendChild(permissions);

    var save = document.createElement('lex-btn');
    save.setAttribute('variant', 'primary');
    save.setAttribute('size', 'sm');
    save.setAttribute('type', 'submit');
    save.textContent = 'Save voice settings';
    save.disabled = disabled;
    form.appendChild(save);
    function submitSettings() {
      onSave(capability, {
        enabled: settings.enabled !== false,
        openAtLogin: form.elements.openAtLogin.checked,
        dictationShortcut: form.elements.dictationShortcut.value.trim(),
        agentShortcut: form.elements.agentShortcut.value.trim(),
        defaultMode: form.elements.defaultMode.value,
        screenContextEnabled: form.elements.screenContextEnabled.checked,
        voiceOutputEnabled: form.elements.voiceOutputEnabled.checked,
        confirmationPolicy: form.elements.confirmationPolicy.value,
        language: settings.language || 'en'
      }, save);
    }
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      submitSettings();
    });
    save.addEventListener('click', submitSettings);
    parent.appendChild(form);
  }

  function renderCapability(capability, onChange, onVoiceSettingsSave, onPermissionRequest, isExpanded, onExpandedChange) {
    var row = element('article', 'sv2-capability');
    var heading = element('div', 'sv2-capability-heading');
    var bodyId = 'sv2-capability-body-' + String(capability.id).replace(/[^a-zA-Z0-9_-]/g, '-');
    var expand = element('button', 'sv2-capability-expand');
    expand.type = 'button';
    expand.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    expand.setAttribute('aria-controls', bodyId);
    var chevron = element('span', 'sv2-capability-chevron');
    chevron.setAttribute('aria-hidden', 'true');
    var copy = element('span', 'sv2-capability-copy');
    copy.appendChild(element('span', 'sv2-capability-name', capability.label || capability.id));
    if (capability.description) copy.appendChild(element('span', 'sv2-capability-description', capability.description));
    copy.appendChild(element('span', 'sv2-capability-availability', availabilityText(capability)));
    expand.appendChild(copy);
    expand.appendChild(chevron);

    var selectWrap = element('div', 'sv2-capability-select-wrap');
    var selectId = 'sv2-capability-' + String(capability.id).replace(/[^a-zA-Z0-9_-]/g, '-');
    var label = element('label', 'sv2-capability-select-label', 'Activation');
    label.setAttribute('for', selectId);
    var select = element('select', 'sv2-capability-select');
    select.id = selectId;
    select.dataset.capabilityId = capability.id;
    select.appendChild(new Option('Activated', 'active'));
    select.appendChild(new Option('Off', 'off'));
    select.value = capability.active ? 'active' : 'off';
    select.disabled = capability.required || !capability.available;
    if (capability.required) select.title = 'Required by your organization';
    if (!capability.available) select.title = 'Unavailable on this platform';
    select.addEventListener('change', function () { onChange(capability, select); });
    selectWrap.appendChild(label);
    selectWrap.appendChild(select);
    heading.appendChild(expand);
    heading.appendChild(selectWrap);
    row.appendChild(heading);

    var body = element('div', 'sv2-capability-body');
    body.id = bodyId;
    body.hidden = !isExpanded;
    expand.addEventListener('click', function () {
      var next = expand.getAttribute('aria-expanded') !== 'true';
      expand.setAttribute('aria-expanded', next ? 'true' : 'false');
      body.hidden = !next;
      onExpandedChange(capability.id, next);
    });

    var platform = element('p', 'sv2-capability-platforms');
    platform.appendChild(element('strong', '', 'Supported platforms: '));
    platform.appendChild(document.createTextNode(platformText(capability.platforms)));
    body.appendChild(platform);

    if (capability.id === 'screen-diction') {
      renderVoiceSettings(body, capability, onVoiceSettingsSave, onPermissionRequest);
    }

    renderHints(body, capability.hints);
    row.appendChild(body);
    return row;
  }

  function notify(kind, message) {
    if (window.Lex && Lex.Toast && typeof Lex.Toast[kind] === 'function') Lex.Toast[kind](message);
  }

  function boot() {
    var section = document.getElementById('sv2-section-capabilities');
    var list = document.getElementById('sv2-capabilities-list');
    var status = document.getElementById('sv2-capabilities-status');
    var expandedCapabilities = Object.create(null);
    var voiceSettings = null;
    var voicePermissions = null;
    var requestedCapability = new URLSearchParams(window.location.search).get('capability');
    if (requestedCapability) expandedCapabilities[requestedCapability] = true;
    if (!section || !list || !status) return;

    function withVoiceState(capabilities) {
      return capabilities.map(function (capability) {
        return capability.id === 'screen-diction'
          ? Object.assign({}, capability, { voiceSettings: voiceSettings, voicePermissions: voicePermissions })
          : capability;
      });
    }

    function render(capabilities) {
      list.replaceChildren();
      if (!capabilities.length) {
        var empty = element('div', 'sv2-capabilities-empty');
        empty.appendChild(element('h3', '', 'No capabilities connected'));
        empty.appendChild(element('p', '', 'Your organization has not enabled any desktop capabilities.'));
        list.appendChild(empty);
        return;
      }
      withVoiceState(capabilities).forEach(function (capability) {
        list.appendChild(renderCapability(
          capability,
          update,
          saveVoiceSettings,
          requestPermission,
          expandedCapabilities[capability.id] === true,
          function (id, expanded) { expandedCapabilities[id] = expanded; }
        ));
      });
    }

    function update(capability, select) {
      var requestedActive = select.value === 'active';
      select.disabled = true;
      status.textContent = 'Saving ' + capability.label + '...';
      window.electronAPI.capabilities.setActive(capability.id, requestedActive).then(function (result) {
        if (!result || result.success !== true) throw new Error(result && result.error ? result.error : 'Setting could not be saved.');
        render(Array.isArray(result.capabilities) ? result.capabilities : []);
        status.textContent = '';
        notify('success', capability.label + (requestedActive ? ' activated' : ' turned off'));
      }).catch(function (error) {
        select.value = capability.active ? 'active' : 'off';
        select.disabled = capability.required || !capability.available;
        status.textContent = error.message || 'The capability setting could not be saved.';
        notify('error', status.textContent);
      });
    }

    function saveVoiceSettings(capability, settings, button) {
      button.disabled = true;
      status.textContent = 'Saving Screen Dictation settings...';
      window.electronAPI.capabilities.setVoiceSettings(settings).then(function (result) {
        if (!result || result.success !== true) throw new Error(result && result.error ? result.error : 'Settings could not be saved.');
        voiceSettings = result.settings;
        render(Array.isArray(result.capabilities) ? result.capabilities : []);
        status.textContent = '';
        notify('success', 'Screen Dictation settings saved');
      }).catch(function (error) {
        button.disabled = !capability.active || !capability.available;
        status.textContent = error.message || 'Screen Dictation settings could not be saved.';
        notify('error', status.textContent);
      });
    }

    function applyPermissionStatus(permissions) {
      voicePermissions = permissions || voicePermissions;
      ['microphone', 'accessibility'].forEach(function (type) {
        var state = permissionLabel(type, voicePermissions);
        var badge = document.getElementById('sv2-voice-permission-' + type);
        var button = document.getElementById('sv2-voice-permission-button-' + type);
        if (badge) { badge.label = state.label; badge.color = state.color; }
        if (button) {
          button.textContent = state.label === 'Allowed' ? 'Enabled' : 'Enable';
          button.disabled = button.dataset.capabilityDisabled === 'true'
            || state.label === 'Allowed' || state.label === 'Unavailable';
        }
      });
    }

    function refreshPermissions() {
      return window.electronAPI.capabilities.getVoicePermissions().then(function (result) {
        if (result && result.success === true) applyPermissionStatus(result.permissions);
      }).catch(function () {});
    }

    function requestPermission(type, button) {
      button.disabled = true;
      status.textContent = 'Requesting ' + type + ' permission...';
      window.electronAPI.capabilities.requestVoicePermission(type).then(function (result) {
        if (!result || result.success !== true) throw new Error(result && result.error ? result.error : 'Permission could not be requested.');
        applyPermissionStatus(result.permissions);
        status.textContent = '';
      }).catch(function (error) {
        button.disabled = false;
        status.textContent = error.message || 'Permission could not be requested.';
        notify('error', status.textContent);
      });
    }

    if (!window.electronAPI || !window.electronAPI.capabilities) {
      section.setAttribute('aria-busy', 'false');
      status.textContent = 'Capability activation is available in the desktop app.';
      render([]);
      return;
    }

    Promise.all([
      window.electronAPI.capabilities.list(),
      window.electronAPI.capabilities.getVoiceSettings(),
      window.electronAPI.capabilities.getVoicePermissions()
    ]).then(function (results) {
      var result = results[0];
      if (!result || result.success !== true) throw new Error(result && result.error ? result.error : 'Capabilities could not be loaded.');
      if (results[1] && results[1].success === true) voiceSettings = results[1].settings;
      if (results[2] && results[2].success === true) voicePermissions = results[2].permissions;
      render(Array.isArray(result.capabilities) ? result.capabilities : []);
      status.textContent = '';
    }).catch(function (error) {
      render([]);
      status.textContent = error.message || 'Capabilities could not be loaded.';
    }).finally(function () {
      section.setAttribute('aria-busy', 'false');
    });

    window.addEventListener('focus', refreshPermissions);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) refreshPermissions();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
