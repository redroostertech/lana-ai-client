/* Custom Objects: Page Controller (standalone page, admin/custom-objects.html)

   Zones:
     A  Object types  the organization's library: who created and last
                      changed each type; a row opens it in the editor
     B  Editor        a type's names, fields (kind, required, choices,
                      archive) and who may edit and delete its records

   The server decides everything: who may change types (admins), what a
   change may do (keys and kinds never change, fields and choices are
   archived, protected parts of a type that came with LANA stay), and the
   version a save is based on (a stale save is refused with its reason, shown
   here). Wire mapping: shared/custom-objects.js.
*/

(function () {
  'use strict';

  var shape = window.LanaCustomObjects;
  var client = new window.CustomObjectsAPIClient(window.api);

  var _types = [];
  var _draft = null;
  var _saving = false;

  function el(id) { return document.getElementById(id); }

  function notice(id, message, isError) {
    var node = el(id);
    if (!node) return;
    node.textContent = message || '';
    node.hidden = !message;
    node.classList.toggle('custom-objects__notice--error', Boolean(isError));
  }

  // -------------------------------------------------------------------------
  // Zone A: the library
  // -------------------------------------------------------------------------

  async function loadTypes() {
    notice('typesNotice', '');
    try {
      _types = await client.listTypes(el('typesShowArchived').checked);
      var rows = shape.typeRows(_types);
      el('typesTable').setData(rows);
      el('typesEmpty').hidden = rows.length > 0;
    } catch (error) {
      notice('typesNotice', shape.errorText(error), true);
    }
  }

  function onTypeRow(event) {
    var row = event.detail && event.detail.row;
    var type = row && _types.filter(function (t) { return t.id === row.id; })[0];
    if (type) openEditor(shape.draftFromType(type), type);
  }

  // -------------------------------------------------------------------------
  // Zone B: the editor
  // -------------------------------------------------------------------------

  function fieldRow(field, index) {
    var row = document.createElement('div');
    row.className = 'custom-objects__field';
    row.dataset.index = String(index);

    var label = document.createElement('lex-input');
    label.setAttribute('label', 'Field name');
    label.dataset.part = 'label';
    label.value = field.label;

    var kind = document.createElement('lex-select');
    kind.setAttribute('label', 'Kind');
    kind.dataset.part = 'kind';
    kind.options = shape.FIELD_KINDS;
    kind.value = field.kind;
    if (!field.isNew) { kind.setAttribute('disabled', ''); }

    var required = document.createElement('lex-toggle');
    required.setAttribute('label', 'Required');
    required.dataset.part = 'required';
    required.checked = field.required;

    var archived = document.createElement('lex-toggle');
    archived.setAttribute('label', 'Archived');
    archived.dataset.part = 'archived';
    archived.checked = field.archived;
    if (field.protected) { archived.setAttribute('disabled', ''); }

    // Choices: one input per choice, each carrying its key, so renaming a
    // label keeps the key (and every value recorded with it).
    var options = document.createElement('div');
    options.className = 'custom-objects__choices';
    options.dataset.part = 'options';
    var choiceList = document.createElement('div');
    choiceList.className = 'custom-objects__choice-list';
    function addChoice(choice) {
      var item = document.createElement('div');
      item.className = 'custom-objects__choice';
      var input = document.createElement('lex-input');
      input.setAttribute('label', 'Choice');
      input.dataset.part = 'choice';
      input.dataset.key = choice.key || '';
      input.value = choice.label || '';
      item.appendChild(input);
      if (!choice.protected) {
        var remove = document.createElement('lex-btn');
        remove.setAttribute('variant', 'ghost');
        remove.setAttribute('size', 'sm');
        remove.textContent = 'Remove';
        remove.addEventListener('click', function () { item.remove(); });
        item.appendChild(remove);
      }
      choiceList.appendChild(item);
    }
    (field.choices || []).forEach(addChoice);
    var addButton = document.createElement('lex-btn');
    addButton.setAttribute('variant', 'ghost');
    addButton.setAttribute('size', 'sm');
    addButton.textContent = 'Add choice';
    addButton.addEventListener('click', function () { addChoice({ key: '', label: '' }); });
    options.appendChild(choiceList);
    options.appendChild(addButton);
    options.hidden = shape.CHOICE_KINDS.indexOf(field.kind) === -1;
    kind.addEventListener('lex-change', function () {
      options.hidden = shape.CHOICE_KINDS.indexOf(kind.value) === -1;
    });

    row.appendChild(label);
    row.appendChild(kind);
    row.appendChild(required);
    row.appendChild(archived);
    row.appendChild(options);
    if (field.protected) {
      var badge = document.createElement('lex-badge');
      badge.setAttribute('label', 'Protected');
      badge.setAttribute('color', 'blue');
      row.appendChild(badge);
    }
    return row;
  }

  function renderFields() {
    var host = el('editorFields');
    host.textContent = '';
    _draft.fields.forEach(function (field, index) { host.appendChild(fieldRow(field, index)); });
  }

  /** Read what the person typed back into the draft (the server checks it). */
  function readEditor() {
    _draft.label = el('editorLabel').value || '';
    _draft.label_plural = el('editorPlural').value || '';
    _draft.description = el('editorDescription').value || '';
    if (_draft.isNew) { _draft.key = el('editorKey').value || ''; }
    _draft.policy = Object.assign({}, _draft.policy, {
      record_edit: el('editorRecordEdit').value || 'matter_write',
      record_delete: el('editorRecordDelete').value || 'matter_write'
    });
    Array.prototype.forEach.call(el('editorFields').children, function (row) {
      var field = _draft.fields[Number(row.dataset.index)];
      var part = function (name) { return row.querySelector('[data-part="' + name + '"]'); };
      field.label = part('label').value || '';
      field.kind = part('kind').value || field.kind;
      field.required = Boolean(part('required').checked);
      field.archived = Boolean(part('archived').checked);
      field.choices = Array.prototype.map.call(row.querySelectorAll('[data-part="choice"]'), function (input) {
        var stored = (field.choices || []).filter(function (c) { return c.key && c.key === input.dataset.key; })[0];
        return { key: input.dataset.key || '', label: input.value || '', protected: Boolean(stored && stored.protected) };
      });
    });
  }

  function openEditor(draft, type) {
    _draft = draft;
    notice('editorNotice', '');
    el('editorCard').hidden = false;
    // A title element, not the card's heading attribute: changing that
    // re-renders the card and rebuilds its body, dropping the values set below.
    el('editorTitle').textContent = draft.isNew ? 'New object type' : draft.label_plural;
    el('editorLabel').value = draft.label;
    el('editorPlural').value = draft.label_plural;
    el('editorKey').value = draft.key;
    if (draft.isNew) { el('editorKey').removeAttribute('disabled'); } else { el('editorKey').setAttribute('disabled', ''); }
    el('editorDescription').value = draft.description;
    el('editorRecordEdit').options = shape.POLICY_RULES;
    el('editorRecordDelete').options = shape.POLICY_RULES;
    el('editorRecordEdit').value = draft.policy.record_edit;
    el('editorRecordDelete').value = draft.policy.record_delete;
    el('editorProtected').hidden = !draft.isProtected;
    el('editorArchive').hidden = draft.isNew || draft.isProtected || (type && !type.is_active);
    var who = type ? [shape.attributionText('Created', type.created_by, type.created_at),
      type.version > 1 ? shape.attributionText('Last changed', type.updated_by, type.updated_at) : ''].filter(Boolean).join('. ') : '';
    el('editorAttribution').textContent = who;
    renderFields();
    el('editorCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function save() {
    if (_saving || !_draft) return;
    readEditor();
    _saving = true;
    el('editorSave').setAttribute('loading', '');
    notice('editorNotice', '');
    try {
      var saved = await client.saveDraft(_draft);
      await loadTypes();
      openEditor(shape.draftFromType(saved), saved);
      notice('editorNotice', 'Saved.');
    } catch (error) {
      notice('editorNotice', shape.errorText(error), true);
    } finally {
      _saving = false;
      el('editorSave').removeAttribute('loading');
    }
  }

  async function archive() {
    if (!_draft || _draft.isNew) return;
    try {
      await client.archiveType(_draft.id);
      el('editorCard').hidden = true;
      _draft = null;
      await loadTypes();
    } catch (error) {
      notice('editorNotice', shape.errorText(error), true);
    }
  }

  function addField() {
    if (!_draft) return;
    readEditor();
    _draft.fields.push(shape.blankField());
    renderFields();
  }

  function start() {
    el('typesShowArchived').addEventListener('lex-change', loadTypes);
    el('typesNew').addEventListener('click', function () { openEditor(shape.blankDraft(), null); });
    el('editorAddField').addEventListener('click', addField);
    el('editorSave').addEventListener('click', save);
    el('editorArchive').addEventListener('click', archive);
    el('editorCancel').addEventListener('click', function () { el('editorCard').hidden = true; _draft = null; });
    customElements.whenDefined('lex-table').then(function () {
      el('typesTable').addEventListener('row-click', onTypeRow);
      loadTypes();
    });
  }

  start();
})();
