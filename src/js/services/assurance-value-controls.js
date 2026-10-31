/* Typed reference controls. The application service owns eligibility and acceptance. */
(function (global) {
  'use strict';
  var supportedKinds = ['reference', 'reference_set', 'allocations', 'text'];
  function basisPoints(value) {
    var parts = String(value == null ? '' : value).trim().split('.');
    if (parts.length > 2 || !parts[0] || (parts[1] || '').length > 2 || parts.some(function (part) {
      return !part || Array.from(part).some(function (character) { return character < '0' || character > '9'; });
    })) throw new Error('Enter a percentage with at most two decimal places.');
    var result = Number(parts[0]) * 100 + Number((parts[1] || '').padEnd(2, '0'));
    if (!Number.isSafeInteger(result)) throw new Error('This percentage is too large.');
    return result;
  }
  function percent(value) { return (value / 100).toFixed(2); }
  function reference(id, contacts) {
    var item = contacts.find(function (contact) { return contact.id === id; });
    if (!item) throw new Error('Choose a contact from the available matter records.');
    return { kind: 'contact', id: item.id };
  }
  // Text values come from the rule's allowed list (for example a transfer mechanism).
  function textLabel(value) { var words = String(value).split('_').join(' '); return words.charAt(0).toUpperCase() + words.slice(1); }
  function valueFromFields(kind, fields, contacts, allowedValues) {
    if (!supportedKinds.includes(kind)) throw new Error('This value type is not available in the current application.');
    if (kind === 'text') {
      var text = String(fields.selected || '');
      if (!text || (allowedValues && allowedValues.length && !allowedValues.includes(text))) throw new Error('Choose one of the values this rule allows.');
      return { kind: kind, value: text };
    }
    if (kind === 'reference') return { kind: kind, value: reference(fields.selected, contacts) };
    if (kind === 'reference_set') return { kind: kind, value: (fields.selected || []).map(function (id) { return reference(id, contacts); }) };
    return { kind: kind, value: (fields.allocations || []).map(function (entry) {
      return { beneficiary: reference(entry.contactId, contacts), share_basis_points: basisPoints(entry.percent) };
    }) };
  }
  function createValueEditor(host, options) {
    var contacts = options.contacts || [];
    var kind = options.kind;
    var fields = [];
    var initial = options.value;
    host.replaceChildren();
    if (!supportedKinds.includes(kind)) {
      host.textContent = 'This rule requires a value type not supported by the current application.';
      return { value: function () { throw new Error('Unsupported value type.'); } };
    }
    function contactField(label, multiple) {
      var element = document.createElement('lex-select');
      element.label = label; element.placeholder = 'Choose a matter contact'; element.searchable = true;
      element.multiple = Boolean(multiple);
      element.options = contacts.map(function (contact) { return { value: contact.id, label: contact.label || contact.display_name || 'Matter contact', description: contact.description || '' }; });
      element.required = true;
      return element;
    }
    if (kind === 'text') {
      var allowed = options.allowedValues || [];
      var choice = document.createElement('lex-select');
      choice.label = options.observed ? 'Observed value' : 'Expected value'; choice.placeholder = 'Choose a value'; choice.required = true;
      choice.options = allowed.map(function (value) { return { value: value, label: textLabel(value) }; });
      if (initial && initial.kind === kind) choice.value = initial.value;
      host.appendChild(choice);
      return { value: function () { return valueFromFields(kind, { selected: choice.value }, contacts, allowed); } };
    }
    if (kind !== 'allocations') {
      var selected = contactField(options.observed ? (kind === 'reference_set' ? 'Observed contacts' : 'Observed contact') : (kind === 'reference_set' ? 'Expected contacts' : 'Expected contact'), kind === 'reference_set');
      if (initial && initial.kind === kind) selected.value = kind === 'reference_set' ? initial.value.map(function (entry) { return entry.id; }) : initial.value.id;
      host.appendChild(selected);
      return { value: function () { return valueFromFields(kind, { selected: selected.value }, contacts); } };
    }
    var rows = document.createElement('div'); rows.className = 'assurance-repeatable'; host.appendChild(rows);
    function addRow(entry) {
      var row = document.createElement('div'); row.className = 'assurance-allocation-row';
      var contact = contactField('Beneficiary', false);
      var share = document.createElement('lex-input'); share.label = 'Share (%)'; share.type = 'number'; share.placeholder = '50.00'; share.required = true;
      var remove = document.createElement('lex-btn'); remove.variant = 'ghost'; remove.label = 'Remove beneficiary';
      if (entry) { contact.value = entry.beneficiary.id; share.value = percent(entry.share_basis_points); }
      var record = { row: row, contact: contact, share: share };
      remove.addEventListener('click', function () { fields = fields.filter(function (item) { return item !== record; }); row.remove(); });
      row.append(contact, share, remove); rows.appendChild(row); fields.push(record);
    }
    if (initial && initial.kind === kind) initial.value.forEach(addRow); else addRow();
    var add = document.createElement('lex-btn'); add.variant = 'secondary'; add.label = 'Add beneficiary'; add.addEventListener('click', function () { addRow(); }); host.appendChild(add);
    return { value: function () { return valueFromFields(kind, { allocations: fields.map(function (entry) { return { contactId: entry.contact.value, percent: entry.share.value }; }) }, contacts); } };
  }
  var exports = { supportedKinds: supportedKinds.slice(), basisPoints: basisPoints, textLabel: textLabel, valueFromFields: valueFromFields, createValueEditor: createValueEditor };
  if (typeof module !== 'undefined' && module.exports) module.exports = exports;
  else global.AssuranceValueControls = exports;
})(typeof window !== 'undefined' ? window : globalThis);
