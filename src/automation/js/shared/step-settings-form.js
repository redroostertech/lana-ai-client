/**
 * step-settings-form.js
 * Pure, DOM-free model for the generic step settings form. A step declares
 * its settings schema on the server (GET /api/v1/automations/:id/steps); this
 * turns the schema and the saved values into editable form state and back,
 * for any step. Nothing here names a step.
 *
 * Field types: text, number, boolean, select, multiselect, group_list (a
 * repeatable group of fields), condition (any-of groups of rows; each row is
 * a field, "is one of", and values). In form state a condition is
 * { groups: [{ rows: [{ field, values: [] }] }] }; in saved values it is the
 * step's own shape: { field: value | [values] } or { any: [those] }.
 *
 *   initialState(fields, values)   form state (defaults applied)
 *   toValues(fields, state)        saved values from form state
 *   getAt / setAt(state, path, v)  read or write one place (path: array of keys and indexes)
 *   addAt(fields, state, path)     add a group_list item, a condition group or a condition row
 *   removeAt(state, path)          remove one of them
 *   requiredErrors(fields, state)  what a person must still fill in (the server checks everything)
 *   optionRequests(fields, state)  the option lists the form needs: [{ key, source, depends }]
 *
 * Classic script (window.AutomationStepSettings) so Jest can require it.
 */
(function (global) {
  'use strict';

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function conditionToGroups(condition) {
    var clauses = !condition || typeof condition !== 'object' ? [] : (Array.isArray(condition.any) ? condition.any : [condition]);
    var groups = clauses.map(function (clause) {
      return {
        rows: Object.keys(clause || {}).map(function (field) {
          var value = clause[field];
          return { field: field, values: (Array.isArray(value) ? value : [value]).map(String) };
        })
      };
    }).filter(function (group) { return group.rows.length > 0; });
    return { groups: groups.length ? groups : [{ rows: [{ field: '', values: [] }] }] };
  }

  function groupsToCondition(model) {
    var clauses = ((model && model.groups) || []).map(function (group) {
      var clause = {};
      (group.rows || []).forEach(function (row) {
        var values = (row.values || []).map(String).filter(function (value) { return value !== ''; });
        if (!row.field || values.length === 0) return;
        clause[row.field] = values.length === 1 ? values[0] : values;
      });
      return clause;
    }).filter(function (clause) { return Object.keys(clause).length > 0; });
    if (clauses.length === 0) return {};
    return clauses.length === 1 ? clauses[0] : { any: clauses };
  }

  function fieldState(field, value) {
    switch (field.type) {
      case 'group_list':
        return (Array.isArray(value) ? value : []).map(function (item) { return itemState(field.fields || [], item || {}); });
      case 'condition':
        return conditionToGroups(value);
      case 'boolean':
        return value === undefined ? Boolean(field.default) : Boolean(value);
      case 'multiselect':
        return Array.isArray(value) ? value.map(String) : [];
      case 'number':
        return value === undefined || value === null ? '' : String(value);
      default:
        return value === undefined || value === null ? (field.default !== undefined ? String(field.default) : '') : String(value);
    }
  }

  function itemState(fields, values) {
    var state = {};
    fields.forEach(function (field) { state[field.key] = fieldState(field, values[field.key]); });
    return state;
  }

  function initialState(fields, values) {
    return itemState(fields || [], values || {});
  }

  function fieldValue(field, state) {
    switch (field.type) {
      case 'group_list':
        return (state || []).map(function (item) { return toValues(field.fields || [], item); });
      case 'condition':
        return groupsToCondition(state);
      case 'boolean':
        return Boolean(state);
      case 'multiselect':
        return (state || []).map(String);
      case 'number':
        return state === '' || state === null || state === undefined ? undefined : Number(state);
      default:
        return state === undefined || state === null ? '' : String(state);
    }
  }

  function toValues(fields, state) {
    var values = {};
    (fields || []).forEach(function (field) {
      var value = fieldValue(field, state ? state[field.key] : undefined);
      if (value !== undefined) values[field.key] = value;
    });
    return values;
  }

  function getAt(state, path) {
    return path.reduce(function (node, key) { return node === undefined || node === null ? undefined : node[key]; }, state);
  }

  function setAt(state, path, value) {
    var parent = getAt(state, path.slice(0, -1));
    if (parent === undefined || parent === null) return state;
    parent[path[path.length - 1]] = value;
    return state;
  }

  /** The declared field at a path (['rules', 0, 'when'] -> the when field). */
  function fieldAt(fields, path) {
    var list = fields;
    var found = null;
    for (var i = 0; i < path.length; i += 1) {
      var key = path[i];
      if (typeof key === 'number') continue;
      found = (list || []).find(function (field) { return field.key === key; }) || null;
      if (!found) return null;
      list = found.fields;
      if (found.type === 'condition') return found;
    }
    return found;
  }

  /**
   * Add at a path: a group_list's path adds an item (its declared new_item);
   * a condition's path adds a group; a condition group's path adds a row.
   */
  function addAt(fields, state, path) {
    var target = getAt(state, path);
    var last = path[path.length - 1];
    if (Array.isArray(target)) {
      var field = fieldAt(fields, path);
      if (field && field.type === 'group_list') {
        target.push(itemState(field.fields || [], clone(field.new_item) || {}));
      }
      return state;
    }
    if (target && Array.isArray(target.groups)) {
      target.groups.push({ rows: [{ field: '', values: [] }] });
      return state;
    }
    if (target && Array.isArray(target.rows) && typeof last === 'number') {
      target.rows.push({ field: '', values: [] });
    }
    return state;
  }

  function removeAt(state, path) {
    var parent = getAt(state, path.slice(0, -1));
    var index = path[path.length - 1];
    if (Array.isArray(parent) && typeof index === 'number') parent.splice(index, 1);
    return state;
  }

  function requiredErrors(fields, state, prefix) {
    var errors = [];
    (fields || []).forEach(function (field) {
      var value = state ? state[field.key] : undefined;
      var label = (prefix ? prefix + ': ' : '') + (field.label || field.key);
      if (field.type === 'group_list') {
        (value || []).forEach(function (item, index) {
          var name = field.item_label && item[field.item_label] ? item[field.item_label] : (field.label || field.key) + ' ' + (index + 1);
          errors.push.apply(errors, requiredErrors(field.fields, item, name));
        });
      } else if (field.type === 'condition') {
        if (Object.keys(groupsToCondition(value)).length === 0) errors.push(label + ' needs at least one row with a field and a value.');
      } else if (field.required && (value === '' || value === undefined || value === null || (Array.isArray(value) && value.length === 0))) {
        errors.push(label + ' is required.');
      }
    });
    return errors;
  }

  function requestKey(source, depends) {
    return source + '|' + JSON.stringify((depends || []).slice().sort());
  }

  /**
   * The option lists the form needs, one entry per (source, depends): a
   * select or multiselect's source; a condition's field sources, a row whose
   * field depends on another field of its group asking with that row's values.
   */
  function optionRequests(fields, state) {
    var seen = {};
    var requests = [];
    function want(source, depends) {
      if (!source) return;
      var key = requestKey(source, depends);
      if (seen[key]) return;
      seen[key] = true;
      requests.push({ key: key, source: source, depends: depends || [] });
    }
    function walk(list, node) {
      (list || []).forEach(function (field) {
        var value = node ? node[field.key] : undefined;
        if ((field.type === 'select' || field.type === 'multiselect') && field.options) want(field.options.source, []);
        if (field.type === 'group_list') (value || []).forEach(function (item) { walk(field.fields, item); });
        if (field.type === 'condition') {
          ((value && value.groups) || []).forEach(function (group) {
            (group.rows || []).forEach(function (row) {
              var declared = (field.fields || []).find(function (option) { return option.value === row.field; });
              if (!declared || !declared.options) return;
              want(declared.options.source, dependsFor(declared, group));
            });
          });
        }
      });
    }
    walk(fields, state);
    return requests;
  }

  /** The values a row's field depends on, from the other rows of its group. */
  function dependsFor(declared, group) {
    var on = declared && declared.options && declared.options.depends_on;
    if (!on) return [];
    var values = [];
    (group.rows || []).forEach(function (row) { if (row.field === on) values = values.concat(row.values || []); });
    return values;
  }

  var moduleApi = {
    initialState: initialState,
    toValues: toValues,
    getAt: getAt,
    setAt: setAt,
    addAt: addAt,
    removeAt: removeAt,
    fieldAt: fieldAt,
    requiredErrors: requiredErrors,
    optionRequests: optionRequests,
    requestKey: requestKey,
    dependsFor: dependsFor,
    conditionToGroups: conditionToGroups,
    groupsToCondition: groupsToCondition
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.AutomationStepSettings = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);
