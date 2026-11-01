/**
 * server-form.js
 * Renders a server-described form (design 4.1, 7.2) with Lex inputs, one
 * renderer per field kind, and submits it with pending-submit recovery.
 *
 * Value mapping and validation live in shared/server-form-fields.js and
 * recovery in shared/pending-submit.js; this module only builds controls
 * and runs the modal flow. Styles: css/server-form.css.
 *
 * Public API (window.LanaServerForm):
 *   - RENDERERS                                -> { [kind]: (field, raw, doc) => control }
 *   - renderForm(host, descriptor, initialRaw) -> { read(), showErrors(errors), setDisabled(bool), blocked }
 *       blocked: a required choice field has no options (nothing left to
 *       choose, for example every rulebook already adopted): the form shows
 *       its text and an empty state, and cannot be submitted.
 *   An option may carry a pinned `starter` { id, version }: it reads under
 *   the option, and the binding that pins it goes back unchanged.
 *   - open(options)                            -> lex-modal element
 *       options: { load(subject), submit(body), subject?, chooseSubject?(error), scope?,
 *                  onRecorded?(result), storage?, retryDelays?, wait?(ms) }
 *       load()   resolves with a form descriptor (the bare response body) for
 *                the current subject
 *       submit() sends { request_id, subject?, binding?, values } and resolves
 *                with { status: 'recorded' | 'replayed', record_ref, message }
 *                (the bare response body, 201 recorded or 200 replayed). A
 *                record_ref of any kind is accepted; the runner only shows
 *                the message.
 *       chooseSubject(error) is asked once when the form refuses to open; it
 *                resolves with { heading?, message, label?, choices: [{ value: subject, label }] }
 *                to let the person pick the subject the form is for (then the
 *                form loads for it), or null to show the refusal.
 *       scope    recovery key parts from LanaPendingSubmit.formScope()
 *   A form that cannot open shows the server's message: 403 reads "Not
 *   permitted", 404 "Not found", anything else "Form unavailable".
 */

(function (global) {
  'use strict';

  var STORE_PREFIX = 'lana:server-form:pending';
  var MESSAGES = {
    recovery: 'A change you sent earlier did not get an answer. Send it again to finish, or discard it.',
    stale: 'This record changed while the form was open. The form now shows the current version. Review it and submit again.',
    replayed: 'This change was already recorded. Showing the saved result.',
    recorded: 'Recorded.',
    inProgress: 'This change is still being recorded. Send again in a moment to see the result.',
    reused: 'This saved change did not match the one sent before under the same request, so nothing was recorded. Review the entries and submit again.',
    kept: 'Your entries are saved. Send again to finish.',
    keptMemory: 'Your entries are kept while this window stays open. Send again to finish.',
    choose: 'Choose one to continue.'
  };
  var LOAD_HEADINGS = { 403: 'Not permitted', 404: 'Not found' };

  var inNode = typeof module !== 'undefined' && module.exports;
  function fields() { return global.LanaServerFormFields || (inNode && require('./server-form-fields.js')); }
  function pendingSubmit() { return global.LanaPendingSubmit || (inNode && require('./pending-submit.js')); }

  // Relabels a lex-btn without dropping its rendered button.
  function buttonText(button, label) {
    var utils = global.Lex && global.Lex.Utils;
    if (utils && typeof utils.setLexButtonText === 'function') { utils.setLexButtonText(button, label); return; }
    button._originalChildren = [button.ownerDocument.createTextNode(label)];
    var slot = button.querySelector('slot-content');
    if (slot) slot.textContent = label; else button.textContent = label;
  }

  function create(doc, tag, props) {
    var element = doc.createElement(tag);
    Object.keys(props || {}).forEach(function (key) {
      if (props[key] !== undefined && props[key] !== null) element[key] = props[key];
    });
    return element;
  }

  function textEl(doc, tag, text, className) {
    var element = doc.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  // The pinned starter an option offers, as the line under it.
  function starterText(starter) {
    if (!starter || !starter.id) return '';
    return 'Starter ' + starter.id + (starter.version !== undefined && starter.version !== null ? ', version ' + starter.version : '');
  }

  function selectOptions(list) {
    return (Array.isArray(list) ? list : []).map(function (option) {
      return { value: String(option.value), label: option.label || String(option.value), description: option.description || starterText(option.starter), disabled: option.disabled === true };
    });
  }

  // Text up to the server's default field limit is prose; a field that
  // raises max_length past it (up to 400000, a pasted document such as a
  // rulebook definition) gets a tall monospace box with a character count.
  var DEFAULT_TEXT_LIMIT = 20000;
  function isLongText(field) { return Number(field.max_length) > DEFAULT_TEXT_LIMIT; }

  function textareaExtra(field) {
    var long = isLongText(field);
    return { rows: field.rows || (long ? 14 : 4), maxlength: field.max_length, showCount: long };
  }

  var CHOICE_KINDS = { select: true, multiselect: true, reference: true, reference_set: true, document_versions: true };

  // A required field that must pick from options the server sent none of.
  function nothingToChoose(field) {
    return CHOICE_KINDS[field.kind] === true && field.required === true && !(Array.isArray(field.options) && field.options.length);
  }

  function common(field) {
    return { label: field.label || field.id, help: field.help || '', required: field.required === true, name: field.id };
  }

  // One Lex control whose value is the raw input.
  function single(tag, extra) {
    return function (field, raw, doc) {
      var element = create(doc, tag, Object.assign(common(field), extra ? extra(field) : {}));
      element.value = raw;
      return {
        element: element,
        read: function () { return element.value; },
        setError: function (message) { element.error = message || ''; },
        setDisabled: function (disabled) { element.disabled = disabled; }
      };
    };
  }

  function selectExtra(multiple, searchable) {
    return function (field) {
      return { options: selectOptions(field.options), multiple: multiple, searchable: searchable || (field.options || []).length > 8, placeholder: field.placeholder || 'Choose...' };
    };
  }

  // Rows of controls with add and remove, for list-valued kinds.
  function repeatable(buildRow, addLabel, removeLabel) {
    return function (field, raw, doc) {
      var wrap = doc.createElement('div');
      wrap.className = 'server-form__group';
      wrap.appendChild(textEl(doc, 'p', (field.label || field.id) + (field.required ? ' *' : ''), 'server-form__group-label'));
      var rowsEl = doc.createElement('div');
      rowsEl.className = 'server-form__rows';
      var errorEl = textEl(doc, 'p', '', 'server-form__field-error');
      errorEl.hidden = true;
      var add = create(doc, 'lex-btn', { variant: 'secondary', size: 'sm', label: addLabel });
      var rows = [];
      var disabled = false;
      function addRow(initial) {
        var rowEl = doc.createElement('div');
        rowEl.className = 'server-form__row';
        var row = buildRow(field, initial || {}, doc);
        var remove = create(doc, 'lex-btn', { variant: 'ghost', size: 'sm', label: removeLabel });
        var record = { row: row, element: rowEl, remove: remove };
        remove.addEventListener('click', function () {
          if (disabled) return;
          rows = rows.filter(function (entry) { return entry !== record; });
          rowEl.remove();
        });
        row.controls.forEach(function (control) { rowEl.appendChild(control); });
        rowEl.appendChild(remove);
        rowsEl.appendChild(rowEl);
        rows.push(record);
      }
      add.addEventListener('click', function () { if (!disabled) addRow(); });
      var initialRows = Array.isArray(raw) ? raw : [];
      if (initialRows.length) initialRows.forEach(addRow); else if (field.required) addRow();
      wrap.append(rowsEl, add, errorEl);
      return {
        element: wrap,
        read: function () { return rows.map(function (entry) { return entry.row.read(); }); },
        setError: function (message) { errorEl.textContent = message || ''; errorEl.hidden = !message; },
        setDisabled: function (value) {
          disabled = value;
          add.disabled = value;
          rows.forEach(function (entry) {
            entry.remove.disabled = value;
            entry.row.controls.forEach(function (control) { control.disabled = value; });
          });
        }
      };
    };
  }

  function allocationRow(field, initial, doc) {
    var ref = create(doc, 'lex-select', { label: field.item_label || 'Record', options: selectOptions(field.options), searchable: true, required: true, placeholder: 'Choose...' });
    var share = create(doc, 'lex-input', { label: 'Share (%)', type: 'number', placeholder: '50.00', required: true });
    ref.value = initial.ref || '';
    share.value = initial.percent || '';
    return { controls: [ref, share], read: function () { return { ref: ref.value, percent: share.value }; } };
  }

  function evidenceRow(field, initial, doc) {
    var source = create(doc, 'lex-select', { label: 'Document version', options: selectOptions(field.options), searchable: true, required: true, placeholder: 'Choose...' });
    var evidenceClass = create(doc, 'lex-select', { label: 'What this source establishes', options: selectOptions(field.evidence_classes), required: true });
    var coverage = create(doc, 'lex-select', { label: 'Coverage', options: selectOptions(field.coverage_options), required: true });
    var observedAt = create(doc, 'lex-input', { label: 'Observed at (your local time)', type: 'datetime-local', required: true });
    var page = create(doc, 'lex-input', { label: 'Page (optional)', type: 'number' });
    var quote = create(doc, 'lex-textarea', { label: 'Exact source passage (optional)', rows: 3 });
    source.value = initial.source || '';
    evidenceClass.value = initial.evidence_class || '';
    coverage.value = initial.coverage || '';
    observedAt.value = initial.observed_at || '';
    page.value = initial.page || '';
    quote.value = initial.quote || '';
    return {
      controls: [source, evidenceClass, coverage, observedAt, page, quote],
      read: function () {
        return { source: source.value, evidence_class: evidenceClass.value, coverage: coverage.value, observed_at: observedAt.value, page: page.value, quote: quote.value };
      }
    };
  }

  function confirmControl(field, raw, doc) {
    var element = create(doc, 'lex-checkbox', { label: field.label || field.id, name: field.id, required: true });
    element.checked = raw === true;
    return {
      element: element,
      read: function () { return element.checked === true; },
      setError: function (message) { element.error = message || ''; },
      setDisabled: function (disabled) { element.disabled = disabled; }
    };
  }

  var RENDERERS = {
    text: single('lex-input', function (field) { return { type: 'text', placeholder: field.placeholder || '', maxlength: field.max_length }; }),
    textarea: single('lex-textarea', textareaExtra),
    number: single('lex-input', function (field) { return { type: 'number', placeholder: field.placeholder || '' }; }),
    money: single('lex-input', function (field) { return { type: 'text', placeholder: '0.00', help: field.help || (field.currency ? 'Amount in ' + field.currency : '') }; }),
    date: single('lex-input', function () { return { type: 'date' }; }),
    datetime: single('lex-input', function () { return { type: 'datetime-local' }; }),
    select: single('lex-select', selectExtra(false, false)),
    multiselect: single('lex-select', selectExtra(true, false)),
    reference: single('lex-select', selectExtra(false, true)),
    reference_set: single('lex-select', selectExtra(true, true)),
    allocation: repeatable(allocationRow, 'Add a share', 'Remove'),
    document_versions: single('lex-select', selectExtra(true, true)),
    evidence_sources: repeatable(evidenceRow, 'Add a source', 'Remove source'),
    confirm: confirmControl
  };

  // A context value that is a whole ISO instant (a "Checked at") reads as a
  // local date and time; every other value is shown as the server sent it.
  var ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
  function contextValue(value) {
    var text = value == null ? '' : String(value);
    var utils = global.Lex && global.Lex.Utils;
    if (!ISO_INSTANT.test(text) || !utils || typeof utils.formatDateTime !== 'function') return text;
    return Number.isFinite(Date.parse(text)) ? utils.formatDateTime(text) : text;
  }

  function renderContext(doc, descriptor) {
    var context = Array.isArray(descriptor.context) ? descriptor.context : [];
    if (!context.length) return null;
    var list = doc.createElement('dl');
    list.className = 'server-form__context';
    context.forEach(function (item) {
      list.appendChild(textEl(doc, 'dt', item.label || ''));
      list.appendChild(textEl(doc, 'dd', contextValue(item.value)));
    });
    return list;
  }

  function renderForm(host, descriptor, initialRaw) {
    var doc = host.ownerDocument;
    var controls = {};
    host.replaceChildren();
    if (descriptor.description) host.appendChild(textEl(doc, 'p', descriptor.description, 'server-form__description'));
    var context = renderContext(doc, descriptor);
    if (context) host.appendChild(context);
    var empty = descriptor.fields.filter(nothingToChoose)[0];
    if (empty) {
      var none = doc.createElement('lex-empty');
      none.setAttribute('icon', 'check-circle');
      none.setAttribute('message', 'Nothing left to choose');
      none.setAttribute('description', 'No ' + String(empty.label || empty.id).toLowerCase() + ' to choose right now.');
      host.appendChild(none);
      return { read: function () { return {}; }, showErrors: function () {}, setDisabled: function () {}, blocked: true };
    }
    var list = doc.createElement('div');
    list.className = 'server-form__fields';
    // A form with no fields (a check the server runs) shows only its text.
    descriptor.fields.forEach(function (field) {
      var raw = initialRaw && Object.prototype.hasOwnProperty.call(initialRaw, field.id)
        ? initialRaw[field.id]
        : fields().fromWire(field, field.value);
      var control = RENDERERS[field.kind](field, raw, doc);
      control.element.classList.add('server-form__field');
      if (field.kind === 'textarea' && isLongText(field)) control.element.classList.add('server-form__field--document');
      control.element.setAttribute('data-field-id', field.id);
      controls[field.id] = control;
      list.appendChild(control.element);
    });
    if (descriptor.fields.length) host.appendChild(list);
    return {
      read: function () {
        var raws = {};
        Object.keys(controls).forEach(function (id) { raws[id] = controls[id].read(); });
        return raws;
      },
      showErrors: function (errors) {
        Object.keys(controls).forEach(function (id) { controls[id].setError((errors && errors[id]) || ''); });
      },
      setDisabled: function (disabled) {
        Object.keys(controls).forEach(function (id) { controls[id].setDisabled(disabled); });
      },
      blocked: false
    };
  }

  function recoveryStore(options) {
    if (!options.scope) return null;
    try {
      var storage = options.storage || global.sessionStorage;
      return pendingSubmit().scopedStore(storage, STORE_PREFIX, options.scope);
    } catch (error) {
      return null; // storage blocked: recovery falls back to memory
    }
  }

  function rawFromWireValues(descriptor, wireValues) {
    var raws = {};
    descriptor.fields.forEach(function (field) { raws[field.id] = fields().fromWire(field, wireValues ? wireValues[field.id] : undefined); });
    return raws;
  }

  function open(options) {
    var opts = options || {};
    var Lex = global.Lex;
    var modal = Lex.Modal.open({
      heading: 'Loading...',
      size: 'lg',
      content: '<div class="server-form">' +
        '<p class="server-form__notice" data-server-form-notice hidden></p>' +
        '<div class="server-form__body" data-server-form-body><lex-spinner label="Loading form"></lex-spinner></div>' +
        '</div>' +
        '<lex-btn data-slot="footer" variant="ghost" data-server-form-action="discard" hidden>Discard saved change</lex-btn>' +
        '<lex-btn data-slot="footer" variant="secondary" data-server-form-action="close">Cancel</lex-btn>' +
        '<lex-btn data-slot="footer" variant="primary" data-server-form-action="submit" disabled>Submit</lex-btn>'
    });
    var session = pendingSubmit().createSubmitSession({ store: recoveryStore(opts), retryDelays: opts.retryDelays, wait: opts.wait });
    var state = { descriptor: null, form: null, done: false, subject: opts.subject || null, choice: null, chose: false };

    function q(selector) { return modal.querySelector(selector); }
    function button(action) { return q('[data-server-form-action="' + action + '"]'); }

    function notice(message, tone) {
      var el = q('[data-server-form-notice]');
      if (!el) return;
      el.textContent = message || '';
      el.hidden = !message;
      el.className = 'server-form__notice' + (tone ? ' server-form__notice--' + tone : '');
    }

    function showBodyMessage(message) {
      var body = q('[data-server-form-body]');
      if (!body) return;
      var empty = modal.ownerDocument.createElement('lex-empty');
      empty.setAttribute('icon', 'alert');
      empty.setAttribute('message', message);
      body.replaceChildren(empty);
    }

    function syncButtons() {
      var pending = session.pending();
      var submit = button('submit');
      var discard = button('discard');
      if (submit) {
        submit.disabled = !(state.form || state.choice) || Boolean(state.form && state.form.blocked && !state.choice) || state.done || session.busy();
        submit.loading = session.busy();
        buttonText(submit, state.choice ? 'Continue' : pending ? 'Send again' : ((state.descriptor && state.descriptor.submit_label) || 'Submit'));
        submit.hidden = state.done || Boolean(state.form && state.form.blocked && !state.choice);
      }
      if (discard) discard.hidden = !pending || state.done || Boolean(state.choice);
      var close = button('close');
      if (close) buttonText(close, state.done || (state.form && state.form.blocked) ? 'Close' : 'Cancel');
    }

    // The person picks which subject the form is for (the server asked for one).
    function showChoice(choice) {
      state.choice = choice;
      modal.heading = choice.heading || 'Choose one';
      var body = q('[data-server-form-body]');
      var doc = modal.ownerDocument;
      var wrap = doc.createElement('div');
      wrap.className = 'server-form__choice';
      if (choice.message) wrap.appendChild(textEl(doc, 'p', choice.message, 'server-form__description'));
      var select = create(doc, 'lex-select', { label: choice.label || 'Choose', options: selectOptions(choice.choices), searchable: choice.choices.length > 8, required: true, placeholder: 'Choose...' });
      select.setAttribute('data-server-form-choice', '');
      wrap.appendChild(select);
      body.replaceChildren(wrap);
      syncButtons();
    }

    async function refusalChoice(error) {
      if (state.chose || typeof opts.chooseSubject !== 'function') return null;
      try {
        var choice = await opts.chooseSubject(error);
        return choice && Array.isArray(choice.choices) && choice.choices.length ? choice : null;
      } catch (chooseError) {
        return null;
      }
    }

    async function load(message, tone) {
      state.form = null;
      syncButtons();
      var descriptor;
      try {
        descriptor = await opts.load(state.subject);
      } catch (error) {
        var choice = await refusalChoice(error);
        if (choice) { showChoice(choice); return; }
        modal.heading = LOAD_HEADINGS[error && error.status] || 'Form unavailable';
        showBodyMessage((error && error.message) || 'The form could not be loaded.');
        return;
      }
      var checked = fields().normalizeDescriptor(descriptor);
      if (!checked.ok) {
        modal.heading = (descriptor && descriptor.title) || 'Form unavailable';
        showBodyMessage(checked.message);
        return;
      }
      state.descriptor = descriptor;
      modal.heading = descriptor.title || 'Form';
      var pending = session.pending();
      var body = q('[data-server-form-body]');
      state.form = renderForm(body, descriptor, pending ? rawFromWireValues(descriptor, pending.values) : null);
      if (pending) {
        state.form.setDisabled(true);
        notice(MESSAGES.recovery, 'warning');
      } else {
        notice(message || '', tone);
      }
      syncButtons();
    }

    function showResult(result) {
      state.done = true;
      if (state.form) state.form.setDisabled(true);
      notice((result.replayed ? MESSAGES.replayed + ' ' : '') + (result.message || MESSAGES.recorded), 'success');
      syncButtons();
      if (typeof opts.onRecorded === 'function') opts.onRecorded(result);
    }

    async function onSubmit() {
      if (state.choice) {
        var picked = q('[data-server-form-choice]');
        if (!picked || !picked.value) { notice(MESSAGES.choose, 'error'); return; }
        state.subject = String(picked.value);
        state.choice = null;
        state.chose = true;
        notice('', null);
        q('[data-server-form-body]').replaceChildren(modal.ownerDocument.createElement('lex-spinner'));
        load();
        return;
      }
      if (!state.form || session.busy() || state.done) return;
      var send = function (body) { return opts.submit(body); };
      var attempt;
      if (session.pending()) {
        attempt = session.resend(send);
      } else {
        var collected = fields().collect(state.descriptor.fields, state.form.read());
        state.form.showErrors(collected.errors);
        if (Object.keys(collected.errors).length) {
          notice('Check the highlighted fields.', 'error');
          return;
        }
        var binding = state.descriptor.binding || null;
        attempt = session.submit({ subject: state.subject || (binding && binding.subject) || null, binding: binding, values: collected.values }, send);
      }
      state.form.setDisabled(true);
      notice('', null);
      syncButtons();
      try {
        showResult(await attempt);
      } catch (error) {
        var outcome = (error && error.submitOutcome) || 'retryable';
        if (outcome === 'stale') {
          await load(MESSAGES.stale, 'warning');
          return;
        }
        if (outcome === 'refused' || outcome === 'reused') {
          state.form.setDisabled(false);
          var field = outcome === 'refused' && error && error.data && error.data.error && error.data.error.field;
          if (field) { var errors = {}; errors[field] = error.message; state.form.showErrors(errors); }
          notice(outcome === 'reused' ? MESSAGES.reused : ((error && error.message) || 'The server refused this change.'), 'error');
        } else if (outcome === 'in_progress') {
          notice(MESSAGES.inProgress, 'warning');
        } else {
          notice(((error && error.message) || 'The change was not confirmed.') + ' ' + (session.persisted() ? MESSAGES.kept : MESSAGES.keptMemory), 'warning');
        }
        syncButtons();
      }
    }

    modal.addEventListener('click', function (event) {
      var target = event.target && event.target.closest && event.target.closest('[data-server-form-action]');
      if (!target || target.disabled) return;
      var action = target.getAttribute('data-server-form-action');
      if (action === 'close') { modal.removeAfterClose(); return; }
      if (action === 'discard') {
        session.discard();
        state.form = null;
        load('', null);
        return;
      }
      if (action === 'submit') onSubmit();
    });

    load();
    return modal;
  }

  var moduleApi = { RENDERERS: RENDERERS, MESSAGES: MESSAGES, LOAD_HEADINGS: LOAD_HEADINGS, STORE_PREFIX: STORE_PREFIX, renderForm: renderForm, open: open };
  if (typeof module !== 'undefined' && module.exports) module.exports = moduleApi;
  if (global) global.LanaServerForm = moduleApi;
})(typeof window !== 'undefined' ? window : globalThis);
