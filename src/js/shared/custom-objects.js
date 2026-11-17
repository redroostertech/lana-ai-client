/**
 * Custom objects: wire requests and view mapping (plain module, no DOM).
 *
 * The backend owns every rule (lana backend custom-object-type.models.js and
 * the records service): keys never change, fields and options are archived or
 * retired, the record edit and delete policy, protected seeded types. This
 * module builds requests, turns a type into an editable draft and back, and
 * words what the server returns. Field kinds are the matter field kinds.
 *
 *   GET    /api/v1/custom-object-types?include_archived=true
 *   POST   /api/v1/custom-object-types                       create (admins)
 *   PATCH  /api/v1/custom-object-types/:id                   change, carries expected_version
 *   DELETE /api/v1/custom-object-types/:id                   archive
 *   GET    /api/v1/matters/:id/object-types?q=               applied + attachable + can_attach
 *   POST   /api/v1/matters/:id/object-types                  attach { type_id }
 *   DELETE /api/v1/matters/:id/object-types/:type_id         detach
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (root) { root.LanaCustomObjects = api; }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var FIELD_KINDS = [
    { value: 'text', label: 'Text' }, { value: 'email', label: 'Email' }, { value: 'phone', label: 'Phone' },
    { value: 'date', label: 'Date' }, { value: 'number', label: 'Number' }, { value: 'currency', label: 'Money' },
    { value: 'address', label: 'Address' }, { value: 'person', label: 'Person' }, { value: 'party', label: 'Party' },
    { value: 'boolean', label: 'Yes or no' }, { value: 'select', label: 'Choice' }, { value: 'multiselect', label: 'Several choices' }
  ];
  var CHOICE_KINDS = ['select', 'multiselect'];
  var POLICY_RULES = [
    { value: 'matter_write', label: 'Anyone who can edit the matter' },
    { value: 'creator', label: 'Only the person who created it, or an admin' },
    { value: 'admins', label: 'Only admins' },
    { value: 'none', label: 'No one after it is created' }
  ];

  function enc(value) { return encodeURIComponent(String(value)); }

  /** snake_case from a label: our own key format, deterministic. */
  function keyFrom(label, max) {
    var key = String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!/^[a-z]/.test(key)) { key = 'f_' + key; }
    return key.slice(0, max || 40).replace(/_+$/, '');
  }

  var requests = {
    listTypes: function (includeArchived) {
      return { method: 'GET', path: '/api/v1/custom-object-types' + (includeArchived ? '?include_archived=true' : '') };
    },
    createType: function (body) { return { method: 'POST', path: '/api/v1/custom-object-types', body: body }; },
    updateType: function (id, body) { return { method: 'PATCH', path: '/api/v1/custom-object-types/' + enc(id), body: body }; },
    archiveType: function (id) { return { method: 'DELETE', path: '/api/v1/custom-object-types/' + enc(id) }; },
    matterTypes: function (matterId, q) {
      return { method: 'GET', path: '/api/v1/matters/' + enc(matterId) + '/object-types' + (q ? '?q=' + enc(q) : '') };
    },
    attach: function (matterId, typeId) {
      return { method: 'POST', path: '/api/v1/matters/' + enc(matterId) + '/object-types', body: { type_id: typeId } };
    },
    detach: function (matterId, typeId) {
      return { method: 'DELETE', path: '/api/v1/matters/' + enc(matterId) + '/object-types/' + enc(typeId) };
    }
  };

  function blankField() {
    return { key: '', label: '', kind: 'text', required: false, choices: [], currency: 'USD', help: '', archived: false, isNew: true };
  }

  function blankDraft() {
    return {
      id: null, version: null, key: '', label: '', label_plural: '', description: '', isProtected: false,
      fields: [blankField()], policy: { record_edit: 'matter_write', record_delete: 'matter_write', field_locks: [] }, isNew: true
    };
  }

  /** A stored type as the editor's draft. Each live option is a choice that carries its key. */
  function draftFromType(type) {
    return {
      id: type.id, version: type.version, key: type.key, label: type.label, label_plural: type.label_plural,
      description: type.description || '', isProtected: type.is_protected === true, isNew: false,
      policy: type.policy || { record_edit: 'matter_write', record_delete: 'matter_write', field_locks: [] },
      fields: (type.fields || []).map(function (field) {
        return {
          key: field.key, label: field.label, kind: field.kind, required: field.required === true, help: field.help || '',
          currency: field.currency || 'USD', archived: field.archived === true, protected: field.protected === true, isNew: false,
          options: (field.options || []).slice(),
          choices: (field.options || []).filter(function (o) { return !o.retired; }).map(function (o) {
            return { key: o.key, label: o.label, protected: o.protected === true };
          })
        };
      })
    };
  }

  /**
   * The editor's choices merged into the stored options, matched by key (a
   * label is editable, so a rename keeps the key and the values recorded
   * with it): a choice with a key keeps it; a new choice gets a new key; a
   * stored option whose choice was removed is retired (kept, so recorded
   * values stay readable). Protected options cannot be retired by the
   * server, so they are kept even when their choice is gone.
   */
  function mergeOptions(field) {
    var existing = field.options || [];
    var byKey = {};
    existing.forEach(function (o) { byKey[o.key] = o; });
    var used = {};
    var out = [];
    (field.choices || []).forEach(function (choice) {
      var label = String(choice.label || '').trim();
      if (!label) { return; }
      var match = choice.key && byKey[choice.key] ? byKey[choice.key] : null;
      var key = match ? match.key : keyFrom(label);
      while (!match && (used[key] || byKey[key])) { key = key + '_2'; }
      used[key] = true;
      var option = { key: key, label: label };
      if (match && match.protected) { option.protected = true; }
      out.push(option);
    });
    existing.forEach(function (o) {
      if (used[o.key]) { return; }
      out.push(o.protected ? { key: o.key, label: o.label, protected: true } : { key: o.key, label: o.label, retired: true });
    });
    return out;
  }

  /** The request body for a draft: create (with key) or change (with expected_version). */
  function bodyFromDraft(draft) {
    var fields = draft.fields.filter(function (f) { return f.label.trim(); }).map(function (field) {
      var out = { key: field.key || keyFrom(field.label, 64), label: field.label.trim(), kind: field.kind, required: field.required === true };
      if (field.help) { out.help = field.help; }
      if (field.kind === 'currency') { out.currency = field.currency || 'USD'; }
      if (CHOICE_KINDS.indexOf(field.kind) !== -1) { out.options = mergeOptions(field); }
      if (field.protected) { out.protected = true; }
      if (field.archived) { out.archived = true; }
      return out;
    });
    var body = {
      label: draft.label.trim(), label_plural: draft.label_plural.trim(), description: draft.description ? draft.description.trim() : null,
      fields: fields, policy: draft.policy
    };
    if (draft.isNew) { body.key = draft.key || keyFrom(draft.label); } else { body.expected_version = draft.version; }
    return body;
  }

  function dateText(value) {
    if (!value) { return ''; }
    var d = new Date(value);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }

  /** "Created by Jane Doe on 2026-11-01" (names survive the person's deletion). */
  function attributionText(verb, who, at) {
    if (!who || !who.name) { return ''; }
    return verb + ' by ' + who.name + (at ? ' on ' + dateText(at) : '');
  }

  /** Rows for the admin type table. */
  function typeRows(types) {
    return (types || []).map(function (type) {
      return {
        id: type.id, label: type.label_plural, key: type.key,
        fields: String((type.fields || []).filter(function (f) { return !f.archived; }).length),
        status: type.is_active ? (type.is_protected ? 'Comes with LANA' : 'Active') : 'Archived',
        // Not named created/changed: lex-table formats columns with date-like
        // names as dates, which would drop who made the change.
        author: attributionText('Created', type.created_by, type.created_at),
        editor: type.version > 1 ? attributionText('Changed', type.updated_by, type.updated_at) : ''
      };
    });
  }

  /**
   * The matter drawer: the types on this matter (from the makeup or
   * attached; only an attached one can be removed, and only by a person the
   * server says may attach) and the library types that could be added.
   */
  function matterTypesView(answer) {
    var canAttach = Boolean(answer && answer.can_attach);
    return {
      canAttach: canAttach,
      applied: ((answer && answer.applied) || []).map(function (type) {
        var fromMakeup = type.applies_by === 'makeup';
        return {
          id: type.id, label: type.label_plural, key: type.key,
          source: fromMakeup ? 'Comes with this matter\'s makeup' : 'Added to this matter',
          canRemove: canAttach && !fromMakeup
        };
      }),
      available: ((answer && answer.available) || []).map(function (type) {
        return { id: type.id, label: type.label_plural, key: type.key, canAdd: canAttach };
      })
    };
  }

  /** The server's sentence for a refusal, or a plain fallback. */
  function errorText(error) {
    var data = error && (error.data || error.response || error.body);
    var message = (data && (data.message || (data.error && data.error.message) || (typeof data.error === 'string' && data.error)))
      || (error && error.message);
    return message || 'That did not work. Try again.';
  }

  return {
    FIELD_KINDS: FIELD_KINDS, CHOICE_KINDS: CHOICE_KINDS, POLICY_RULES: POLICY_RULES,
    requests: requests, keyFrom: keyFrom, blankField: blankField, blankDraft: blankDraft,
    draftFromType: draftFromType, mergeOptions: mergeOptions, bodyFromDraft: bodyFromDraft,
    attributionText: attributionText, typeRows: typeRows, matterTypesView: matterTypesView, errorText: errorText
  };
});
