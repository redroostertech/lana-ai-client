/**
 * settings-personalization.js
 *
 * Wires the visible "Personalization" section of settings-v2.html to
 * GET/PATCH /api/v1/users/me/personalization. The form remains available as a
 * screen when the endpoint has not shipped yet; saved values hydrate when it is
 * available.
 *
 */
(function () {
  'use strict';

  var TEXT_FIELDS = ['nickname', 'occupation', 'custom_instructions', 'role', 'represents', 'goals', 'about'];
  var LIST_FIELDS = ['practice_areas', 'jurisdictions', 'typical_tasks'];

  function el(id) { return document.getElementById(id); }
  // Field ids are sv2-pz-<name-with-dashes>, e.g. custom_instructions -> sv2-pz-custom-instructions.
  function fieldEl(name) { return el('sv2-pz-' + name.replace(/_/g, '-')); }

  function populate(p) {
    if (!p) return;
    var style = el('sv2-pz-base-style');
    if (style) style.value = p.base_style || 'default';
    TEXT_FIELDS.forEach(function (f) {
      var e = fieldEl(f);
      if (e) e.value = p[f] || '';
    });
    LIST_FIELDS.forEach(function (f) {
      var e = fieldEl(f);
      if (e) e.value = Array.isArray(p[f]) ? p[f].join(', ') : '';
    });
  }

  function collect() {
    var body = {};
    var style = el('sv2-pz-base-style');
    if (style) body.base_style = style.value || 'default';
    // Text and list fields are sent as-is; the backend trims, caps, and splits
    // comma-separated list fields into arrays.
    TEXT_FIELDS.concat(LIST_FIELDS).forEach(function (f) {
      var e = fieldEl(f);
      if (e) body[f] = e.value || '';
    });
    return body;
  }

  function setStatus(msg, isErr) {
    var s = el('sv2-pz-status');
    if (!s) return;
    s.textContent = msg || '';
    s.setAttribute('variant', isErr ? 'danger' : 'tertiary');
  }

  function setMemoryStatus(msg, isErr) {
    var s = el('sv2-memory-status');
    if (!s) return;
    s.textContent = msg || '';
    s.setAttribute('variant', isErr ? 'danger' : 'tertiary');
  }

  function esc(value) {
    var div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }

  function humanizeValue(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      return value.map(function (entry) {
        return humanizeValue(entry);
      }).filter(Boolean).join(', ');
    }
    if (typeof value === 'object') {
      if (typeof value.text === 'string') return value.text;
      if (typeof value.value === 'string') return value.value;
      if (typeof value.summary === 'string') return value.summary;
      if (typeof value.content === 'string') return value.content;
      return Object.keys(value).map(function (key) {
        return key + ': ' + humanizeValue(value[key]);
      }).filter(Boolean).join(' · ');
    }
    return String(value);
  }

  function formatDate(value) {
    if (!value) return '';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function renderMemoryRecords(records) {
    var list = el('sv2-memory-list');
    if (!list) return;

    if (!Array.isArray(records) || records.length === 0) {
      list.innerHTML = '<div class="sv2-memory-empty">No active memories yet.</div>';
      return;
    }

    list.innerHTML = records.map(function (record) {
      var title = record.key || record.memory_type || 'Memory';
      var body = humanizeValue(record.value_jsonb);
      var updated = formatDate(record.updated_at || record.created_at);
      return '<article class="sv2-memory-record">' +
        '<div class="sv2-memory-record-head">' +
          '<div class="sv2-memory-record-title">' + esc(title) + '</div>' +
          '<div class="sv2-memory-record-meta">' +
            '<span>' + esc(record.memory_type || 'memory') + '</span>' +
            '<span>' + esc(record.scope_type || 'scope') + '</span>' +
            (updated ? '<span>' + esc(updated) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="sv2-memory-record-body">' + esc(body || 'No value stored.') + '</div>' +
      '</article>';
    }).join('');
  }

  function loadMemoryRecords() {
    var section = el('sv2-personalization-memory');
    var api = window.api;
    if (!section) return;
    section.hidden = false;
    section.removeAttribute('aria-hidden');
    section.setAttribute('aria-busy', 'true');

    if (!api || typeof api.listMemoryRecords !== 'function') {
      renderMemoryRecords([]);
      setMemoryStatus('Memory is unavailable.');
      section.setAttribute('aria-busy', 'false');
      return;
    }

    setMemoryStatus('Loading memory...');
    api.listMemoryRecords({ limit: 50 }).then(function (res) {
      renderMemoryRecords(res && res.records);
      setMemoryStatus('');
    }).catch(function () {
      renderMemoryRecords([]);
      setMemoryStatus('Could not load memory.', true);
    }).finally(function () {
      section.setAttribute('aria-busy', 'false');
    });
  }

  function bindMemory() {
    var btn = el('sv2-memory-refresh-btn');
    if (btn && btn.getAttribute('data-memory-bound') !== 'true') {
      btn.setAttribute('data-memory-bound', 'true');
      btn.addEventListener('click', loadMemoryRecords);
    }
  }

  function save(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    var api = window.api;
    if (!api || typeof api.updatePersonalization !== 'function') return;
    setStatus('Saving...');
    api.updatePersonalization(collect()).then(function (res) {
      if (res && res.personalization) populate(res.personalization);
      setStatus('Saved');
      setTimeout(function () { setStatus(''); }, 2500);
    }).catch(function () {
      setStatus('Could not save. Please try again.', true);
    });
  }

  function bindForm() {
    var form = el('sv2-personalization-form');
    if (!form || form.getAttribute('data-personalization-bound') === 'true') return;
    form.setAttribute('data-personalization-bound', 'true');
    form.addEventListener('lex-submit', save);
  }

  function activate() {
    var section = el('sv2-section-personalization');
    var api = window.api;
    if (!section) return;

    // Rendering the screen does not depend on backend rollout state.
    section.classList.remove('sv2-hidden');
    populate({});
    bindForm();
    bindMemory();
    loadMemoryRecords();

    if (!api || typeof api.getPersonalization !== 'function') return;
    api.getPersonalization().then(function (res) {
      populate(res && res.personalization);
    }).catch(function () {
      // Endpoint unavailable: keep the blank form visible for the current UI.
    });
  }

  function boot() {
    activate();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
