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
  var _memoryRecords = [];
  var _memoryLoaded = false;
  var _memoryLoading = null;
  var _memoryModal = null;

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
    return formatReadableValue(value, 0);
  }

  function labelFromIdentifier(value) {
    if (!value) return '';
    var text = String(value).replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    var parts = text.split(' ');
    var acronyms = {
      ai: 'AI',
      api: 'API',
      id: 'ID',
      ip: 'IP',
      json: 'JSON',
      jsonb: 'JSON',
      lana: 'LANA',
      mfa: 'MFA',
      oauth: 'OAuth',
      sso: 'SSO',
      url: 'URL'
    };
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (!part) continue;
      var lower = part.toLowerCase();
      parts[i] = acronyms[lower] || (lower.charAt(0).toUpperCase() + lower.slice(1));
    }
    return parts.filter(Boolean).join(' ');
  }

  function looksLikeIdentifier(value) {
    if (!value || typeof value !== 'string') return false;
    if (value.length > 64) return false;
    if (value.indexOf(' ') !== -1) return false;
    if (value.indexOf('.') !== -1) return false;
    if (value.indexOf('_') === -1 && value.indexOf('-') === -1) return false;
    return true;
  }

  function parseJsonString(value) {
    if (typeof value !== 'string') return null;
    var trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.charAt(0) !== '{' && trimmed.charAt(0) !== '[') return null;
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      return null;
    }
  }

  function isEmptyReadableValue(value) {
    if (value == null) return true;
    if (typeof value === 'string' && value.trim() === '') return true;
    if (Array.isArray(value) && value.length === 0) return true;
    return false;
  }

  function shouldSkipValueKey(key) {
    var k = String(key || '').toLowerCase();
    return k === 'id' || k === 'uuid' || k === '_id';
  }

  function formatReadableValue(value, depth) {
    if (value == null) return '';
    if (depth > 5) return '';

    if (typeof value === 'string') {
      var parsed = parseJsonString(value);
      if (parsed !== null) return formatReadableValue(parsed, depth + 1);
      return looksLikeIdentifier(value) ? labelFromIdentifier(value) : value;
    }
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';

    if (Array.isArray(value)) {
      var items = [];
      for (var i = 0; i < value.length; i++) {
        var item = formatReadableValue(value[i], depth + 1);
        if (item) items.push(item);
      }
      if (items.length === 0) return '';
      var separator = items.join('').indexOf(':') !== -1 ? '; ' : ', ';
      return items.join(separator);
    }

    if (typeof value === 'object') {
      var singleValueKeys = ['display_name', 'label', 'title', 'name', 'text', 'summary', 'content', 'value'];
      var keys = Object.keys(value);
      var meaningfulKeys = [];
      for (var j = 0; j < keys.length; j++) {
        if (!isEmptyReadableValue(value[keys[j]]) && !shouldSkipValueKey(keys[j])) meaningfulKeys.push(keys[j]);
      }
      if (meaningfulKeys.length === 1 && singleValueKeys.indexOf(meaningfulKeys[0]) !== -1) {
        return formatReadableValue(value[meaningfulKeys[0]], depth + 1);
      }

      var parts = [];
      for (var k = 0; k < meaningfulKeys.length; k++) {
        var key = meaningfulKeys[k];
        var formatted = formatReadableValue(value[key], depth + 1);
        if (formatted) parts.push(labelFromIdentifier(key) + ': ' + formatted);
      }
      return parts.join('; ');
    }

    return String(value);
  }

  function memoryValueObject(record) {
    if (!record) return null;
    var candidates = [
      record.value_jsonb,
      record.value,
      record.content,
      record.summary
    ];
    for (var i = 0; i < candidates.length; i++) {
      var value = candidates[i];
      if (typeof value === 'string') value = parseJsonString(value) || value;
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    }
    return null;
  }

  function firstDisplayValue(value, keys) {
    if (!value || typeof value !== 'object') return '';
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var candidate = value[key];
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
    return '';
  }

  function formatDate(value, includeTime) {
    if (!value) return '';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    if (includeTime && window.Lex && Lex.Utils && typeof Lex.Utils.formatDateTime === 'function') {
      return Lex.Utils.formatDateTime(value);
    }
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function normalizeMemoryRecords(payload) {
    var root = payload && (payload.data || payload);
    var records = [];
    if (Array.isArray(root)) records = root;
    else if (Array.isArray(root && root.records)) records = root.records;
    else if (Array.isArray(root && root.memories)) records = root.memories;
    else if (Array.isArray(root && root.items)) records = root.items;
    return records;
  }

  function memoryRecordTitle(record) {
    if (!record) return 'Memory';
    var valueObject = memoryValueObject(record);
    var valueTitle = firstDisplayValue(valueObject, [
      'display_name',
      'displayName',
      'title',
      'name',
      'label',
      'alias',
      'target_entity',
      'targetEntity',
      'entity_name',
      'entityName'
    ]);
    if (valueTitle) return valueTitle;

    var candidates = [
      record.display_name,
      record.displayName,
      record.title,
      record.name,
      record.label,
      record.key,
      record.memory_key,
      record.memory_type,
      record.type
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (typeof candidates[i] === 'string' && candidates[i].trim()) {
        return looksLikeIdentifier(candidates[i]) ? labelFromIdentifier(candidates[i]) : candidates[i];
      }
    }
    return 'Memory';
  }

  function memoryRecordValue(record) {
    if (!record) return '';
    var candidates = [
      record.value_jsonb,
      record.value,
      record.content,
      record.text,
      record.summary
    ];
    for (var i = 0; i < candidates.length; i++) {
      var formatted = humanizeValue(candidates[i]);
      if (formatted) return formatted;
    }
    return '';
  }

  function memoryTypeLabel(record) {
    var value = record && (record.memory_type || record.type || record.category);
    return value ? labelFromIdentifier(value) : '';
  }

  function memoryScopeLabel(record) {
    if (!record) return '';
    var display = record.scope_display_name || record.scopeDisplayName || record.scope_name || record.scopeName;
    var type = record.scope_type || record.scopeType;
    if (display && type) return labelFromIdentifier(type) + ': ' + display;
    if (display) return display;
    if (type) return labelFromIdentifier(type);
    return '';
  }

  function memoryConfidenceLabel(record) {
    var value = record && record.confidence;
    if (value == null || value === '') return '';
    var number = Number(value);
    if (!Number.isFinite(number)) return '';
    if (number <= 1) number = Math.round(number * 100);
    else number = Math.round(number);
    return number + '% confidence';
  }

  function mapMemoryRecord(record, index) {
    var updated = record && (record.updated_at || record.updatedAt || record.last_used_at || record.lastUsedAt || record.created_at || record.createdAt);
    return {
      id: String((record && (record.id || record.record_id || record.key)) || index),
      memory: memoryRecordTitle(record),
      value: memoryRecordValue(record) || 'No value stored.',
      scope: memoryScopeLabel(record) || 'Account',
      updated: formatDate(updated, true) || '',
      _typeLabel: memoryTypeLabel(record),
      _confidenceLabel: memoryConfidenceLabel(record),
      _keyLabel: record && record.key ? labelFromIdentifier(record.key) : ''
    };
  }

  function memoryCountLabel(count) {
    if (count === 1) return '1 memory available.';
    return String(count || 0) + ' memories available.';
  }

  function renderMemorySummary() {
    if (!_memoryLoaded) return;
    setMemoryStatus(memoryCountLabel(_memoryRecords.length));
  }

  function renderMemoryNameCell(value, row) {
    var meta = [];
    if (row._typeLabel) meta.push(row._typeLabel);
    if (row._keyLabel && row._keyLabel !== value) meta.push(row._keyLabel);
    if (row._confidenceLabel) meta.push(row._confidenceLabel);
    return '<div class="sv2-memory-name-cell">' +
      '<span class="sv2-memory-name-cell-title">' + esc(value || 'Memory') + '</span>' +
      (meta.length ? '<span class="sv2-memory-name-cell-meta">' + esc(meta.join(' • ')) + '</span>' : '') +
    '</div>';
  }

  function renderMemoryValueCell(value) {
    return '<div class="sv2-memory-value-cell" title="' + esc(value || '') + '">' + esc(value || '') + '</div>';
  }

  function renderMemoryTable(records) {
    var table = el('sv2-memory-table');
    if (!table || typeof table.setData !== 'function') return;
    var rows = [];
    for (var i = 0; i < records.length; i++) rows.push(mapMemoryRecord(records[i], i));
    if (typeof table.setCellRenderers === 'function') {
      table.setCellRenderers({
        memory: renderMemoryNameCell,
        value: renderMemoryValueCell
      });
    }
    table.setData(rows);
  }

  function setMemoryModalStatus(message, isErr) {
    var status = el('sv2-memory-modal-status');
    if (!status) return;
    status.textContent = message || '';
    status.setAttribute('variant', isErr ? 'danger' : 'tertiary');
  }

  function setMemoryLoadingState(isLoading) {
    var section = el('sv2-personalization-memory');
    var refreshBtn = el('sv2-memory-modal-refresh-btn');
    if (section) section.setAttribute('aria-busy', isLoading ? 'true' : 'false');
    if (refreshBtn) refreshBtn.loading = isLoading;
  }

  function loadMemoryRecords(options) {
    options = options || {};
    var api = window.api;
    var section = el('sv2-personalization-memory');
    if (!section) return Promise.resolve([]);
    section.hidden = false;
    section.removeAttribute('aria-hidden');

    if (!api || typeof api.listMemoryRecords !== 'function') {
      _memoryRecords = [];
      _memoryLoaded = true;
      renderMemoryTable(_memoryRecords);
      setMemoryStatus('Memory is unavailable.');
      setMemoryModalStatus('Memory is unavailable.', true);
      setMemoryLoadingState(false);
      return Promise.resolve([]);
    }

    if (_memoryLoading && !options.force) return _memoryLoading;

    setMemoryStatus('Loading memory...');
    setMemoryModalStatus('Loading memories...');
    setMemoryLoadingState(true);

    _memoryLoading = api.listMemoryRecords({ limit: 200 }).then(function (res) {
      _memoryRecords = normalizeMemoryRecords(res);
      _memoryLoaded = true;
      renderMemorySummary();
      renderMemoryTable(_memoryRecords);
      setMemoryModalStatus(memoryCountLabel(_memoryRecords.length));
      return _memoryRecords;
    }).catch(function () {
      _memoryRecords = [];
      _memoryLoaded = true;
      renderMemoryTable(_memoryRecords);
      setMemoryStatus('Could not load memory.', true);
      setMemoryModalStatus('Could not load memories.', true);
      return [];
    }).finally(function () {
      setMemoryLoadingState(false);
      _memoryLoading = null;
    });
    return _memoryLoading;
  }

  function openMemoryModal() {
    if (_memoryModal && _memoryModal.open) return;

    var content = document.createElement('div');
    content.className = 'sv2-memory-modal';
    content.innerHTML =
      '<div class="sv2-memory-modal-toolbar">' +
        '<lex-text id="sv2-memory-modal-status" variant="tertiary" size="body-sm" tag="p">' +
          esc(_memoryLoaded ? memoryCountLabel(_memoryRecords.length) : 'Loading memories...') +
        '</lex-text>' +
        '<lex-btn id="sv2-memory-modal-refresh-btn" variant="ghost" size="sm" icon="refresh-cw">Refresh</lex-btn>' +
      '</div>' +
      '<lex-table ' +
        'id="sv2-memory-table" ' +
        'class="sv2-memory-table" ' +
        'columns="memory,value,scope,updated" ' +
        'labels="Memory,Value,Scope,Updated" ' +
        'empty-text="No active memories yet" ' +
        'sort-by="updated" ' +
        'sort-dir="desc" ' +
        'searchable ' +
        'compact ' +
        'aria-label="LANA memory records">' +
      '</lex-table>';

    _memoryModal = Lex.Modal.open({
      heading: 'Manage Memories',
      content: content,
      hideActions: true,
      size: 'xl',
      closeOnOverlay: true
    });

    _memoryModal.addEventListener('lex-close', function () {
      _memoryModal = null;
    });

    setTimeout(function () {
      var refreshBtn = el('sv2-memory-modal-refresh-btn');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', function () {
          loadMemoryRecords({ force: true });
        });
      }
      renderMemoryTable(_memoryRecords);
      if (_memoryLoading) setMemoryLoadingState(true);
      if (!_memoryLoaded) loadMemoryRecords();
    }, 0);
  }

  function bindMemory() {
    var btn = el('sv2-memory-manage-btn');
    if (btn && btn.getAttribute('data-memory-bound') !== 'true') {
      btn.setAttribute('data-memory-bound', 'true');
      btn.addEventListener('click', openMemoryModal);
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
