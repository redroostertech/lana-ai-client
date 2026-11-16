/**
 * matter-fields.js
 * View mapping and request building for typed custom matter fields.
 *
 * The server is the system of record (LANA-AI services/matter-fields):
 *   - definitions are org-level, shared by every matter in the organization:
 *       GET/POST /api/v1/matter-field-definitions, PATCH/DELETE .../:id
 *       (DELETE archives; field_key cannot change once created)
 *   - values belong to one matter:
 *       GET/PUT /api/v1/matters/:matter_id/field-values
 *       (bulk PUT { values: [{ field_key, value }] }; a null value clears)
 * PUT /matters/:id/settings refuses custom_fields and custom_field_definitions.
 *
 * The drawer works on a state { definitions, values }:
 *   definitions: [{ id?, key, display_name, type, required, options, default_value }]
 *                (no id = not saved yet)
 *   values:      [{ key, value }]
 * The server coerces and validates every value; this module only maps shapes,
 * diffs the drawer against what was loaded and words the server's refusals.
 *
 * Public API (window.LanaMatterFields, or module.exports in Node):
 *   - TYPE_OPTIONS / typeOptions(def)   -> lex-select options for the Type control
 *   - hasOptions(type)                  -> select and multiselect take an option list
 *   - isReadOnlyValue(type)             -> person/party values are not edited here
 *   - definitionsRequest()/valuesRequest(matterId) -> { method, path }
 *   - toDrawerState(defsResponse, valuesResponse)  -> drawer state
 *   - cloneState(state)
 *   - planSave(baseline, current)       -> { errors, creates, updates, archives, values }
 *   - buildSaveRequests(matterId, plan) -> [{ method, path, body? }] in send order
 *   - adoptIds(current, baseline)       -> stamps saved ids onto current definitions by key
 *   - displayFields(valuesResponse)     -> [{ key, displayName, value, type }] with a value
 *   - errorMessage(error)               -> the server's message, validation details included
 */
(function (global) {
  'use strict';

  var DEFINITIONS_PATH = '/api/v1/matter-field-definitions';

  // person and party hold structured values and are not offered for new fields.
  var TYPE_OPTIONS = [
    { value: 'text', label: 'Text' },
    { value: 'email', label: 'Email' },
    { value: 'phone', label: 'Phone' },
    { value: 'address', label: 'Address' },
    { value: 'number', label: 'Number' },
    { value: 'currency', label: 'Currency' },
    { value: 'date', label: 'Date' },
    { value: 'boolean', label: 'Yes/No' },
    { value: 'select', label: 'Dropdown' },
    { value: 'multiselect', label: 'Multiple choice' }
  ];
  var READ_ONLY_TYPES = { person: 'Person', party: 'Party' };

  function typeOptions(def) {
    var type = def && def.type;
    if (type && READ_ONLY_TYPES[type]) {
      return TYPE_OPTIONS.concat([{ value: type, label: READ_ONLY_TYPES[type] }]);
    }
    return TYPE_OPTIONS;
  }

  function hasOptions(type) {
    return type === 'select' || type === 'multiselect';
  }

  function isReadOnlyValue(type) {
    return !!READ_ONLY_TYPES[type];
  }

  function matterPath(matterId) {
    return '/api/v1/matters/' + encodeURIComponent(matterId) + '/field-values';
  }

  function definitionsRequest() {
    return { method: 'GET', path: DEFINITIONS_PATH + '?limit=500' };
  }

  function valuesRequest(matterId) {
    return { method: 'GET', path: matterPath(matterId) };
  }

  function dataOf(response) {
    return (response && response.data) || {};
  }

  function toDrawerState(definitionsResponse, valuesResponse) {
    var defs = dataOf(definitionsResponse).definitions || [];
    var rows = dataOf(valuesResponse).values || [];
    var byKey = {};
    rows.forEach(function (row) { byKey[row.field_key] = row.value; });

    var definitions = defs.map(function (d) {
      return {
        id: d.id,
        key: d.field_key,
        display_name: d.field_label || '',
        type: d.field_type || 'text',
        required: d.is_required === true,
        options: Array.isArray(d.options) ? d.options.slice() : [],
        default_value: d.default_value === undefined ? null : d.default_value
      };
    });
    var values = definitions.map(function (d) {
      var v = byKey[d.key];
      return { key: d.key, value: v === null || v === undefined ? '' : v };
    });
    return { definitions: definitions, values: values };
  }

  function cloneState(state) {
    return JSON.parse(JSON.stringify(state || { definitions: [], values: [] }));
  }

  /** The value as it is sent: null for blank, typed where the input is loose. */
  function normalizeValue(type, raw) {
    if (raw === null || raw === undefined) return null;
    if (type === 'multiselect') {
      var list = Array.isArray(raw) ? raw : String(raw).split(',');
      list = list.map(function (s) { return String(s).trim(); }).filter(function (s) { return s; });
      return list.length ? list : null;
    }
    if (type === 'boolean') {
      if (raw === true || raw === 'true') return true;
      if (raw === false || raw === 'false') return false;
      return null;
    }
    if (typeof raw === 'string') {
      var text = raw.trim();
      if (!text) return null;
      if (type === 'number' || type === 'currency') {
        var num = Number(text);
        return Number.isFinite(num) ? num : text; // the server words a bad number
      }
      return text;
    }
    return raw;
  }

  function sameValue(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function valueMap(values) {
    var map = {};
    (values || []).forEach(function (v) { map[v.key] = v.value; });
    return map;
  }

  function planSave(baseline, current) {
    var plan = { errors: [], creates: [], updates: [], archives: [], values: [] };
    var defs = (current && current.definitions) || [];
    var baseDefs = (baseline && baseline.definitions) || [];

    var missingName = defs.some(function (d) { return !d.display_name || !String(d.display_name).trim(); });
    var missingKey = defs.some(function (d) { return !d.key || !String(d.key).trim(); });
    if (missingName) plan.errors.push('Every field needs a display name.');
    if (missingKey) plan.errors.push('Every field needs a field key.');
    var keys = defs.map(function (d) { return String(d.key || '').toLowerCase().trim(); });
    var dups = keys.filter(function (k, i) { return k && keys.indexOf(k) !== i; });
    if (dups.length) plan.errors.push('Duplicate field keys: ' + dups.join(', '));
    if (plan.errors.length) return plan;

    var baseById = {};
    baseDefs.forEach(function (d) { if (d.id) baseById[d.id] = d; });
    var keptIds = {};

    defs.forEach(function (d) {
      var label = String(d.display_name).trim();
      var choice = hasOptions(d.type);
      var options = (d.options || []).map(function (o) { return String(o).trim(); }).filter(function (o) { return o; });
      if (!d.id || !baseById[d.id]) {
        var body = { field_key: String(d.key).trim(), field_label: label, field_type: d.type || 'text', is_required: d.required === true };
        if (choice) body.options = options;
        plan.creates.push(body);
        return;
      }
      keptIds[d.id] = true;
      var before = baseById[d.id];
      var patch = {};
      if (label !== before.display_name) patch.field_label = label;
      if (d.type !== before.type) patch.field_type = d.type;
      if ((d.required === true) !== (before.required === true)) patch.is_required = d.required === true;
      if (choice && (d.type !== before.type || !sameValue(options, before.options || []))) patch.options = options;
      if (Object.keys(patch).length) plan.updates.push({ id: d.id, body: patch });
    });

    baseDefs.forEach(function (d) {
      if (d.id && !keptIds[d.id]) plan.archives.push(d.id);
    });

    var now = valueMap(current.values);
    var then = valueMap(baseline && baseline.values);
    defs.forEach(function (d) {
      if (isReadOnlyValue(d.type)) return;
      var next = normalizeValue(d.type, now[d.key]);
      var prev = normalizeValue(d.type, then[d.key]);
      if (!sameValue(next, prev)) plan.values.push({ field_key: String(d.key).trim(), value: next });
    });
    return plan;
  }

  function buildSaveRequests(matterId, plan) {
    var requests = [];
    plan.creates.forEach(function (body) {
      requests.push({ method: 'POST', path: DEFINITIONS_PATH, body: body });
    });
    plan.updates.forEach(function (u) {
      requests.push({ method: 'PATCH', path: DEFINITIONS_PATH + '/' + encodeURIComponent(u.id), body: u.body });
    });
    plan.archives.forEach(function (id) {
      requests.push({ method: 'DELETE', path: DEFINITIONS_PATH + '/' + encodeURIComponent(id) });
    });
    if (plan.values.length) {
      requests.push({ method: 'PUT', path: matterPath(matterId), body: { values: plan.values } });
    }
    return requests;
  }

  /** After a partial save, give unsaved drawer fields the ids the server now has. */
  function adoptIds(current, baseline) {
    var idByKey = {};
    ((baseline && baseline.definitions) || []).forEach(function (d) { idByKey[d.key] = d.id; });
    ((current && current.definitions) || []).forEach(function (d) {
      if (!d.id && idByKey[d.key]) d.id = idByKey[d.key];
    });
    return current;
  }

  function hasValue(value) {
    if (value === null || value === undefined || value === '') return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
  }

  function displayFields(valuesResponse) {
    return (dataOf(valuesResponse).values || [])
      .filter(function (row) { return hasValue(row.value); })
      .map(function (row) {
        return { key: row.field_key, displayName: row.field_label || row.field_key, value: row.value, type: row.field_type || 'text' };
      });
  }

  function errorMessage(error) {
    if (!error) return 'Could not save custom fields';
    var body = error.data && error.data.error;
    var details = body && Array.isArray(body.details) ? body.details : [];
    var worded = details.map(function (item) {
      if (!item) return '';
      if (typeof item === 'string') return item;
      var path = Array.isArray(item.path) ? item.path.join('.') : (item.field || '');
      return path ? path + ': ' + item.message : (item.message || '');
    }).filter(function (s) { return s; });
    if (worded.length) return worded.join('; ');
    return (body && body.message) || error.message || 'Could not save custom fields';
  }

  var moduleApi = {
    TYPE_OPTIONS: TYPE_OPTIONS,
    typeOptions: typeOptions,
    hasOptions: hasOptions,
    isReadOnlyValue: isReadOnlyValue,
    definitionsRequest: definitionsRequest,
    valuesRequest: valuesRequest,
    toDrawerState: toDrawerState,
    cloneState: cloneState,
    planSave: planSave,
    buildSaveRequests: buildSaveRequests,
    adoptIds: adoptIds,
    displayFields: displayFields,
    errorMessage: errorMessage
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.LanaMatterFields = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);
