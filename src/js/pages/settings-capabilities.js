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

  function renderCapability(capability, onChange) {
    var row = element('article', 'sv2-capability');
    var heading = element('div', 'sv2-capability-heading');
    var copy = element('div', 'sv2-capability-copy');
    copy.appendChild(element('h3', 'sv2-capability-name', capability.label || capability.id));
    if (capability.description) copy.appendChild(element('p', 'sv2-capability-description', capability.description));
    copy.appendChild(element('p', 'sv2-capability-availability', availabilityText(capability)));

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
    heading.appendChild(copy);
    heading.appendChild(selectWrap);
    row.appendChild(heading);
    renderHints(row, capability.hints);
    return row;
  }

  function notify(kind, message) {
    if (window.Lex && Lex.Toast && typeof Lex.Toast[kind] === 'function') Lex.Toast[kind](message);
  }

  function boot() {
    var section = document.getElementById('sv2-section-capabilities');
    var list = document.getElementById('sv2-capabilities-list');
    var status = document.getElementById('sv2-capabilities-status');
    if (!section || !list || !status) return;

    function render(capabilities) {
      list.replaceChildren();
      if (!capabilities.length) {
        var empty = element('div', 'sv2-capabilities-empty');
        empty.appendChild(element('h3', '', 'No capabilities connected'));
        empty.appendChild(element('p', '', 'Your organization has not enabled any desktop capabilities.'));
        list.appendChild(empty);
        return;
      }
      capabilities.forEach(function (capability) {
        list.appendChild(renderCapability(capability, update));
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

    if (!window.electronAPI || !window.electronAPI.capabilities) {
      section.setAttribute('aria-busy', 'false');
      status.textContent = 'Capability activation is available in the desktop app.';
      render([]);
      return;
    }

    window.electronAPI.capabilities.list().then(function (result) {
      if (!result || result.success !== true) throw new Error(result && result.error ? result.error : 'Capabilities could not be loaded.');
      render(Array.isArray(result.capabilities) ? result.capabilities : []);
      status.textContent = '';
    }).catch(function (error) {
      render([]);
      status.textContent = error.message || 'Capabilities could not be loaded.';
    }).finally(function () {
      section.setAttribute('aria-busy', 'false');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
