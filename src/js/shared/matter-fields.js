/**
 * matter-fields.js
 * View mapping and request building for typed custom matter fields.
 *
 * The server is the system of record (LANA-AI services/matter-fields). A field
 * definition lives in the organization's library, but it applies only to the
 * matters (and workspaces, which are matters) that attached it:
 *   - this matter's fields:  GET  /api/v1/matters/:id/field-attachments
 *   - attach / detach:       POST /api/v1/matters/:id/field-attachments { field_definition_id }
 *                            DELETE /api/v1/matters/:id/field-attachments/:definition_id
 *                            (detach keeps the matter's value, hidden)
 *   - the library picker:    GET  /api/v1/matters/:id/field-library?q=  (each row has `attached`)
 *   - create / edit a field: POST /api/v1/matter-field-definitions, PATCH .../:id
 *   - values:                GET/PUT /api/v1/matters/:id/field-values (null clears)
 * A value for an unattached field is refused, so a new field is attached
 * before its value is written. PUT /matters/:id/settings refuses custom fields.
 *
 * The drawer works on a state { definitions, values, canManageLibrary }:
 *   definitions: [{ id?, key, display_name, type, required, options, default_value }]
 *                (no id = not created yet; an id not in the loaded state = picked
 *                from the library, to attach)
 *   values:      [{ key, value }]
 *   canManageLibrary: whether this person may change library fields (label,
 *                required, options). A change applies to every matter using
 *                the field, so the server allows it to admins only
 *                (matters:manage_field_library); others edit values only.
 * The server coerces and validates every value; this module maps shapes, diffs
 * the drawer against what was loaded, escapes values for display and words
 * the server's refusals.
 *
 * Public API (window.LanaMatterFields, or module.exports in Node):
 *   - TYPE_OPTIONS / typeOptions(def), typeLabel(type), hasOptions(type), isReadOnlyValue(type)
 *   - attachedRequest, valuesRequest, libraryRequest, createRequest, attachRequest,
 *     detachRequest, updateRequest, valuesWriteRequest -> { method, path, body? }
 *   - toDrawerState(attachedResponse, valuesResponse) -> drawer state
 *   - cloneState(state), addLibraryField(state, libraryDefinition)
 *   - libraryOptions(libraryResponse, state) -> lex-select options for the picker
 *   - findLibraryDefinition(libraryResponse, fieldKey) -> exact key match or null
 *   - planSave(baseline, current) -> { errors, creates, attaches, updates, detaches, values }
 *   - adoptIds(current, baseline)
 *   - displayFields(valuesResponse), displayHtml(field), placeholderFor(def)
 *   - createLibrarySearch({ search, onResults, delayMs }) -> { query(text) }, debounced, latest wins
 *   - errorMessage(error)
 */
(function (global) {
  'use strict';

  var DEFINITIONS_PATH = '/api/v1/matter-field-definitions';
  var LIBRARY_PAGE = 200;

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

  function typeLabel(type) {
    if (READ_ONLY_TYPES[type]) return READ_ONLY_TYPES[type];
    for (var i = 0; i < TYPE_OPTIONS.length; i++) {
      if (TYPE_OPTIONS[i].value === type) return TYPE_OPTIONS[i].label;
    }
    return type || 'Text';
  }

  function hasOptions(type) {
    return type === 'select' || type === 'multiselect';
  }

  function isReadOnlyValue(type) {
    return !!READ_ONLY_TYPES[type];
  }

  function matterBase(matterId) {
    return '/api/v1/matters/' + encodeURIComponent(matterId);
  }

  function attachedRequest(matterId) {
    return { method: 'GET', path: matterBase(matterId) + '/field-attachments' };
  }

  function valuesRequest(matterId) {
    return { method: 'GET', path: matterBase(matterId) + '/field-values' };
  }

  function libraryRequest(matterId, query) {
    var path = matterBase(matterId) + '/field-library?limit=' + LIBRARY_PAGE;
    if (query) path += '&q=' + encodeURIComponent(query);
    return { method: 'GET', path: path };
  }

  function createRequest(body) {
    return { method: 'POST', path: DEFINITIONS_PATH, body: body };
  }

  function attachRequest(matterId, definitionId) {
    return { method: 'POST', path: matterBase(matterId) + '/field-attachments', body: { field_definition_id: definitionId } };
  }

  function detachRequest(matterId, definitionId) {
    return { method: 'DELETE', path: matterBase(matterId) + '/field-attachments/' + encodeURIComponent(definitionId) };
  }

  function updateRequest(update) {
    return { method: 'PATCH', path: DEFINITIONS_PATH + '/' + encodeURIComponent(update.id), body: update.body };
  }

  function valuesWriteRequest(matterId, values) {
    return { method: 'PUT', path: matterBase(matterId) + '/field-values', body: { values: values } };
  }

  function dataOf(response) {
    return (response && response.data) || {};
  }

  function toDefinition(d) {
    return {
      id: d.id,
      key: d.field_key,
      display_name: d.field_label || '',
      type: d.field_type || 'text',
      required: d.is_required === true,
      options: Array.isArray(d.options) ? d.options.slice() : [],
      default_value: d.default_value === undefined ? null : d.default_value
    };
  }

  function toDrawerState(attachedResponse, valuesResponse) {
    var defs = dataOf(attachedResponse).fields || [];
    var rows = dataOf(valuesResponse).values || [];
    var byKey = {};
    rows.forEach(function (row) { byKey[row.field_key] = row.value; });

    var definitions = defs.map(toDefinition);
    var values = definitions.map(function (d) {
      var v = byKey[d.key];
      return { key: d.key, value: v === null || v === undefined ? '' : v };
    });
    return {
      definitions: definitions,
      values: values,
      canManageLibrary: dataOf(attachedResponse).can_manage_library === true
    };
  }

  function cloneState(state) {
    return JSON.parse(JSON.stringify(state || { definitions: [], values: [] }));
  }

  /** Add a library field picked in the drawer; it is attached on save. */
  function addLibraryField(state, libraryDefinition) {
    var next = cloneState(state);
    var def = toDefinition(libraryDefinition);
    // What the library holds now, so an admin's edit can be diffed after attach.
    def.original = { display_name: def.display_name, required: def.required, options: def.options.slice(), type: def.type };
    var already = next.definitions.some(function (d) { return d.id === def.id || d.key === def.key; });
    if (!already) {
      next.definitions.push(def);
      next.values.push({ key: def.key, value: '' });
    }
    return next;
  }

  function libraryOptions(libraryResponse, state) {
    var used = {};
    ((state && state.definitions) || []).forEach(function (d) { if (d.id) used[d.id] = true; });
    return (dataOf(libraryResponse).definitions || []).map(function (d) {
      var taken = d.attached === true || used[d.id] === true;
      return {
        value: d.id,
        label: (d.field_label || d.field_key) + ' (' + d.field_key + ')',
        description: taken ? 'Already on this matter' : typeLabel(d.field_type),
        disabled: taken
      };
    });
  }

  function findLibraryDefinition(libraryResponse, fieldKey) {
    var defs = dataOf(libraryResponse).definitions || [];
    for (var i = 0; i < defs.length; i++) {
      if (defs[i].field_key === fieldKey) return defs[i];
    }
    return null;
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
    var plan = { errors: [], creates: [], attaches: [], updates: [], detaches: [], values: [] };
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
    var canManage = !!(baseline && baseline.canManageLibrary);

    // A library field's own properties apply to every matter using it. Only
    // someone who may manage the library changes them, and never the type
    // (stored values would become unreadable in every matter).
    function libraryPatch(d, before, label, options) {
      var patch = {};
      if (label !== before.display_name) patch.field_label = label;
      if ((d.required === true) !== (before.required === true)) patch.is_required = d.required === true;
      if (hasOptions(before.type) && !sameValue(options, before.options || [])) patch.options = options;
      return patch;
    }

    defs.forEach(function (d) {
      var label = String(d.display_name).trim();
      var options = (d.options || []).map(function (o) { return String(o).trim(); }).filter(function (o) { return o; });
      if (!d.id) {
        var body = { field_key: String(d.key).trim(), field_label: label, field_type: d.type || 'text', is_required: d.required === true };
        if (hasOptions(d.type)) body.options = options;
        plan.creates.push({ key: body.field_key, body: body });
        return;
      }
      var before = baseById[d.id];
      if (!before) {
        plan.attaches.push(d.id); // picked from the library
        before = d.original;
      } else {
        keptIds[d.id] = true;
      }
      if (!canManage || !before) return;
      var patch = libraryPatch(d, before, label, options);
      if (Object.keys(patch).length) plan.updates.push({ id: d.id, body: patch });
    });

    baseDefs.forEach(function (d) {
      if (d.id && !keptIds[d.id]) plan.detaches.push(d.id);
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

  /** After a partial save, give drawer fields the ids the server now has. */
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

  function escapeHtml(text) {
    return String(text)
      .split('&').join('&amp;')
      .split('<').join('&lt;')
      .split('>').join('&gt;')
      .split('"').join('&quot;')
      .split("'").join('&#39;');
  }

  /** Plain text for a stored value; the caller decides how to show it. */
  function displayText(field) {
    var value = field && field.value;
    if (value === null || value === undefined || value === '') return 'Not set';
    if (field.type === 'currency') {
      var num = typeof value === 'number' ? value : parseFloat(value);
      if (Number.isFinite(num)) {
        return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
    }
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) return value.map(function (v) { return String(v); }).join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  /** A stored value, escaped for an HTML string. Values are untrusted. */
  function displayHtml(field) {
    return escapeHtml(displayText(field));
  }

  /** Input hint: the field's default when it has one (shown, never saved). */
  function placeholderFor(def) {
    if (def && def.default_value !== null && def.default_value !== undefined && String(def.default_value) !== '') {
      return 'Default: ' + def.default_value;
    }
    return 'Enter ' + ((def && (def.display_name || def.key)) || 'a value');
  }

  /**
   * Debounced, latest-wins search for the library picker: every keystroke
   * calls query(text); only the last text in a pause is sent, and an answer
   * that arrives after a newer one started is dropped.
   *
   * @param {Object} opts - { search(q) -> Promise, onResults(response, q), delayMs? }
   * @returns {{ query: function(string): void }}
   */
  function createLibrarySearch(opts) {
    var delay = opts.delayMs === undefined ? 250 : opts.delayMs;
    var timer = null;
    var latest = 0;
    return {
      query: function (text) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
          timer = null;
          var ticket = ++latest;
          Promise.resolve(opts.search(text)).then(function (response) {
            if (ticket === latest) opts.onResults(response, text);
          }, function () { /* a failed search keeps the current list */ });
        }, delay);
      }
    };
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
    typeLabel: typeLabel,
    hasOptions: hasOptions,
    isReadOnlyValue: isReadOnlyValue,
    attachedRequest: attachedRequest,
    valuesRequest: valuesRequest,
    libraryRequest: libraryRequest,
    createRequest: createRequest,
    attachRequest: attachRequest,
    detachRequest: detachRequest,
    updateRequest: updateRequest,
    valuesWriteRequest: valuesWriteRequest,
    toDrawerState: toDrawerState,
    cloneState: cloneState,
    addLibraryField: addLibraryField,
    libraryOptions: libraryOptions,
    findLibraryDefinition: findLibraryDefinition,
    planSave: planSave,
    adoptIds: adoptIds,
    displayFields: displayFields,
    displayText: displayText,
    displayHtml: displayHtml,
    placeholderFor: placeholderFor,
    createLibrarySearch: createLibrarySearch,
    errorMessage: errorMessage
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.LanaMatterFields = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);
