/* Fix data in LANA: correct a deal's amount, mark it won or lost, or settle
   a conflict between LANA and the connected system. Fixes stay in LANA, the
   CRM keeps its own value, and syncs never undo a fix.

   Driven only by the row's hints, never by the card:
     row.edit         { record_id, field_key, standard_key, current_value, editable }
     row.outcome_edit { status, decided_on, allowed }
     row.conflict     { flag_annotation_id, source_name, fields: [{ field_key, standard_key, lana_value, new_source_value, correction_id, ... }] }
     row.fixed_in_lana { fields: [{ field_key, standard_key, correction_id, ... }] }
   and the signed-in person's permissions { can_correct, can_resolve_conflicts }
   from the card or metric detail response. Amount and outcome controls need
   can_correct and an editable row; conflict actions need can_resolve_conflicts.

   API (api.js): createCorrection, updateCorrection, deleteCorrection,
   resolveConflict. Responses carry { record: { record_id, object, fields,
   decided_on, corrected_fields, conflict_fields, conflict? }, refresh:
   { queued, views, expected_within_seconds, basis } }: the row updates in
   place from record.fields right away and, when refresh.queued, the page
   refetches after expected_within_seconds (onSaved). A change or undo uses
   the field's correction_id.

   Usage: DataFixes.controlsHtml(row, permissions) in a row, then
   DataFixes.bind(container, { onSaved(info) }) once per container.
   No regex (Lex rules). */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DataFixes = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
  'use strict';

  var OUTCOMES = { won: 'Mark as won', lost: 'Mark as lost' };

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;')
      .split('"').join('&quot;').split("'").join('&#39;');
  }

  function str(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function firmCurrency() {
    var utils = root && root.Lex && root.Lex.Utils;
    return utils && typeof utils.getFirmCurrency === 'function' ? utils.getFirmCurrency() : 'USD';
  }

  function words(key) {
    var text = str(key).split('_').join(' ');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
  }

  // ── Who may do what ─────────────────────────────────────────────────
  function canCorrect(permissions, hint) {
    return !!(permissions && permissions.can_correct === true && hint && hint.editable === true);
  }

  function canResolve(permissions, conflict) {
    return !!(permissions && permissions.can_resolve_conflicts === true && conflict && typeof conflict === 'object' && conflict.flag_annotation_id);
  }

  // ── Request bodies ──────────────────────────────────────────────────
  function parseAmount(text) {
    var clean = str(text).split(',').join('').split(' ').join('');
    if (clean.charAt(0) === '$') clean = clean.slice(1);
    if (!clean) return null;
    var n = Number(clean);
    return isFinite(n) && n >= 0 ? n : null;
  }

  function fieldRef(edit) {
    var e = edit || {};
    return e.standard_key ? { standard_key: String(e.standard_key) } : (e.field_key ? { field_key: String(e.field_key) } : null);
  }

  function amountBody(edit, text) {
    var n = parseAmount(text);
    var ref = fieldRef(edit);
    if (n === null || !ref) return null;
    return { fields: [Object.assign(ref, { value: n })] };
  }

  function isPlainDay(text) {
    var t = str(text);
    if (t.length !== 10 || t.charAt(4) !== '-' || t.charAt(7) !== '-') return false;
    return isFinite(Date.parse(t + 'T00:00:00Z'));
  }

  // Outcome only: { outcome: { status, decided_on } }.
  function outcomeBody(outcomeEdit, status, day) {
    var allowed = outcomeEdit && Array.isArray(outcomeEdit.allowed) ? outcomeEdit.allowed : [];
    if (allowed.indexOf(status) === -1 || !isPlainDay(day)) return null;
    return { outcome: { status: status, decided_on: str(day) } };
  }

  // 400: { error: { message, code: 'VALIDATION_ERROR', details: { problems, allowed: { field: [values] } } } }
  function allowedText(err) {
    var data = (err && err.data) || {};
    var details = data.error && data.error.details && typeof data.error.details === 'object' ? data.error.details : {};
    var allowed = details.allowed && typeof details.allowed === 'object' ? details.allowed : {};
    return Object.keys(allowed).filter(function (field) { return Array.isArray(allowed[field]) && allowed[field].length; }).map(function (field) {
      return 'Allowed for ' + field.split('_').join(' ') + ': ' + allowed[field].map(str).join(', ') + '.';
    }).join(' ');
  }

  function errorText(err) {
    var status = err && (err.status || (err.response && err.response.status));
    if (status === 400) {
      var allowed = allowedText(err);
      return allowed ? 'That value is not allowed. ' + allowed : 'That value is not allowed.';
    }
    if (status === 403) return 'You don\'t have permission to fix this record.';
    if (status === 404) return 'This record was not found. It may have been removed.';
    if (status === 409) return 'Someone changed this record a moment ago. Refresh and try again.';
    return 'Could not save. Try again in a moment.';
  }

  // ── After a save ────────────────────────────────────────────────────
  /** Update a row in place from the server's record: record.fields, decided_on, corrected and conflict fields. */
  function applyRecord(row, record) {
    if (!row || !record || typeof record !== 'object') return row;
    var fields = record.fields && typeof record.fields === 'object' ? record.fields : {};
    Object.keys(fields).forEach(function (key) {
      if (fields[key] === null || typeof fields[key] !== 'object') row[key] = fields[key];
    });
    if (record.decided_on !== undefined) row.decided_on = record.decided_on;
    if (row.edit && row.edit.standard_key && Object.prototype.hasOwnProperty.call(fields, row.edit.standard_key)) {
      row.edit.current_value = fields[row.edit.standard_key];
    }
    if (Array.isArray(record.corrected_fields)) {
      if (record.corrected_fields.length) row.fixed_in_lana = { fields: record.corrected_fields.slice() };
      else delete row.fixed_in_lana;
    }
    if (Array.isArray(record.conflict_fields)) {
      if (!record.conflict_fields.length) delete row.conflict;
      else row.conflict = Object.assign({}, row.conflict || {}, record.conflict || {}, { fields: record.conflict_fields.slice() });
    }
    return row;
  }

  // Milliseconds until the refetch, or null when nothing was queued.
  function refreshDelayMs(response) {
    var refresh = response && response.refresh;
    if (!refresh || refresh.queued !== true) return null;
    var seconds = Number(refresh.expected_within_seconds);
    return isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : 0;
  }

  function savedText(response) {
    var refresh = response && response.refresh;
    if (!refresh || refresh.queued !== true) return 'Saved.';
    var seconds = Number(refresh.expected_within_seconds);
    if (!isFinite(seconds) || seconds <= 0) return 'Saved. Updating the numbers.';
    return 'Saved. Updating the numbers (about ' + Math.max(5, Math.round(seconds / 5) * 5) + ' seconds).';
  }

  // Who may fix: on editable cards under metadata.editable.permissions (or
  // metadata.permissions), on metric detail at the top level.
  function permissionsOf(item) {
    if (!item || typeof item !== 'object') return null;
    var meta = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
    var editable = meta.editable && typeof meta.editable === 'object' ? meta.editable : {};
    var found = editable.permissions || meta.permissions || item.permissions;
    return found && typeof found === 'object' ? found : null;
  }

  // The fix on this field already in LANA (fixed_in_lana.fields), for PUT and DELETE.
  function correctionIdFor(row, edit) {
    var fields = row && row.fixed_in_lana && Array.isArray(row.fixed_in_lana.fields) ? row.fixed_in_lana.fields : [];
    var match = fields.filter(function (f) {
      return f && typeof f === 'object' && f.correction_id && edit
        && ((edit.standard_key && f.standard_key === edit.standard_key) || (edit.field_key && f.field_key === edit.field_key));
    })[0];
    return match ? str(match.correction_id) : '';
  }

  function sourceName(row) {
    var c = (row && row.conflict) || {};
    return str(c.source_name);
  }

  function conflictLabels(row) {
    var name = sourceName(row);
    return { keep: 'Keep LANA\'s value', use: 'Use ' + (name || 'the source') + '\'s value' };
  }

  function valueText(field, value) {
    if (value === null || value === undefined || value === '') return 'blank';
    var key = str(field && (field.standard_key || field.field_key)).toLowerCase();
    var n = Number(value);
    if ((key === 'amount' || key.indexOf('amount') !== -1 || key.indexOf('value') !== -1) && isFinite(n)) {
      return n.toLocaleString('en-US', { style: 'currency', currency: firmCurrency(), maximumFractionDigits: 0 });
    }
    return typeof value === 'object' ? '' : String(value);
  }

  function conflictLines(row) {
    var c = row && row.conflict;
    var name = sourceName(row) || 'source';
    return (c && Array.isArray(c.fields) ? c.fields : []).filter(Boolean).map(function (f) {
      var label = f.standard_key === 'amount' ? 'Amount' : words(f.standard_key || f.field_key);
      return label + ': LANA ' + valueText(f, f.lana_value) + ', ' + name + ' ' + valueText(f, f.new_source_value);
    });
  }

  // ── Controls ────────────────────────────────────────────────────────
  function btn(action, label, variant) {
    return '<lex-btn size="sm" variant="' + (variant || 'secondary') + '" data-dfix-action="' + action + '" label="' + escapeHtml(label) + '"></lex-btn>';
  }

  /** The fix controls for one row, or '' when the person may do nothing here. */
  function controlsHtml(row, permissions) {
    var r = row || {};
    var edit = r.edit && typeof r.edit === 'object' ? r.edit : null;
    var outcome = r.outcome_edit && typeof r.outcome_edit === 'object' ? r.outcome_edit : null;
    var parts = [];
    var mayCorrect = canCorrect(permissions, edit);
    if (mayCorrect) {
      var current = edit.current_value === null || edit.current_value === undefined ? '' : String(edit.current_value);
      parts.push('<div class="dfix__line"><lex-input size="sm" type="number" min="0" data-dfix-input="amount" aria-label="Amount" placeholder="Amount" value="'
        + escapeHtml(current) + '"></lex-input>' + btn('amount', 'Save amount', 'primary') + '</div>');
      var allowed = outcome && Array.isArray(outcome.allowed) ? outcome.allowed.filter(function (s) { return OUTCOMES[s]; }) : [];
      if (allowed.length) {
        parts.push('<div class="dfix__line"><lex-input size="sm" type="date" data-dfix-input="decided_on" aria-label="Day it was decided" value="'
          + escapeHtml(str(outcome.decided_on)) + '"></lex-input>' + allowed.map(function (s) { return btn(s, OUTCOMES[s]); }).join('') + '</div>');
      }
      if (correctionIdFor(r, edit)) parts.push('<div class="dfix__line">' + btn('undo', 'Undo fix', 'ghost') + '</div>');
    }
    if (canResolve(permissions, r.conflict)) {
      var labels = conflictLabels(r);
      parts.push('<div class="dfix__conflict">' + conflictLines(r).map(function (line) { return '<p class="dfix__values">' + escapeHtml(line) + '</p>'; }).join('')
        + '<div class="dfix__line">' + btn('keep-lana', labels.keep, 'primary') + btn('use-source', labels.use) + '</div></div>');
    }
    if (!parts.length) return '';
    var dataId = str((edit && edit.record_id) || r.record_id);
    return '<div class="dfix" data-dfix-id="' + escapeHtml(dataId) + '"'
      + (edit && edit.standard_key ? ' data-dfix-standard="' + escapeHtml(edit.standard_key) + '"' : '')
      + (edit && edit.field_key ? ' data-dfix-field="' + escapeHtml(edit.field_key) + '"' : '')
      + (outcome && Array.isArray(outcome.allowed) ? ' data-dfix-allowed="' + escapeHtml(outcome.allowed.join(',')) + '"' : '')
      + (correctionIdFor(r, edit) ? ' data-dfix-correction="' + escapeHtml(correctionIdFor(r, edit)) + '"' : '')
      + (r.conflict && r.conflict.flag_annotation_id ? ' data-dfix-flag="' + escapeHtml(r.conflict.flag_annotation_id) + '"' : '')
      + '>' + parts.join('') + '<p class="dfix__status" data-dfix-status role="status" aria-live="polite"></p></div>';
  }

  function confirmAsk(title, message) {
    var modal = root && root.Lex && root.Lex.Modal;
    if (modal && typeof modal.confirmAsync === 'function') return modal.confirmAsync(title, message);
    return Promise.resolve(typeof root.confirm === 'function' ? root.confirm(message) : false);
  }

  function unwrap(response) {
    return response && response.data !== undefined && !(response.record || response.refresh) ? response.data : response;
  }

  /** Wire the fix controls inside a container (once). */
  function bind(container, options) {
    if (!container || container._dataFixesBound) return;
    container._dataFixesBound = true;
    var opts = options || {};
    container.addEventListener('click', function (event) {
      var target = event.target && event.target.closest ? event.target.closest('[data-dfix-action]') : null;
      if (!target) return;
      var box = target.closest('.dfix');
      if (!box || box._busy) return;
      event.preventDefault();
      event.stopPropagation();
      run(box, target.getAttribute('data-dfix-action'), opts);
    });
  }

  function setStatus(box, text) {
    var node = box.querySelector('[data-dfix-status]');
    if (node) node.textContent = text;
  }

  function inputValue(box, name) {
    var input = box.querySelector('[data-dfix-input="' + name + '"]');
    return input ? str(input.value) : '';
  }

  function run(box, action, opts) {
    var api = root.api || {};
    var dataId = box.getAttribute('data-dfix-id');
    var correction = box.getAttribute('data-dfix-correction');
    var flag = box.getAttribute('data-dfix-flag');
    var edit = { standard_key: box.getAttribute('data-dfix-standard'), field_key: box.getAttribute('data-dfix-field') };
    var allowed = (box.getAttribute('data-dfix-allowed') || '').split(',').filter(Boolean);
    var call = null;
    var ask = null;

    if (action === 'amount') {
      var body = amountBody(edit, inputValue(box, 'amount'));
      if (!body) { setStatus(box, 'Type an amount, like 4500.'); return; }
      call = function () { return correction ? api.updateCorrection(dataId, correction, body) : api.createCorrection(dataId, body); };
    } else if (action === 'won' || action === 'lost') {
      var day = inputValue(box, 'decided_on');
      if (!isPlainDay(day)) { setStatus(box, 'Pick the day it was decided.'); return; }
      var outcomeBodyValue = outcomeBody({ allowed: allowed }, action, day);
      if (!outcomeBodyValue) { setStatus(box, 'That outcome is not allowed here.'); return; }
      call = function () { return api.createCorrection(dataId, outcomeBodyValue); };
    } else if (action === 'undo' && correction) {
      ask = ['Undo this fix?', 'LANA will show the value from your connected system again.'];
      call = function () { return api.deleteCorrection(dataId, correction); };
    } else if (action === 'keep-lana' && flag) {
      call = function () { return api.resolveConflict(dataId, flag, 'lana'); };
    } else if (action === 'use-source' && flag) {
      ask = ['Use the connected system\'s value?', 'LANA will replace its value with the one from your connected system.'];
      call = function () { return api.resolveConflict(dataId, flag, 'source'); };
    }
    if (!call) return;

    var go = function () {
      box._busy = true;
      setStatus(box, 'Saving...');
      return call().then(function (response) {
        var result = unwrap(response) || {};
        setStatus(box, savedText(result));
        if (typeof opts.onSaved === 'function') {
          opts.onSaved({ dataId: dataId, action: action, record: result.record || null, delayMs: refreshDelayMs(result), text: savedText(result), box: box });
        }
      }, function (err) {
        setStatus(box, errorText(err));
      }).then(function () { box._busy = false; });
    };
    if (!ask) { go(); return; }
    confirmAsk(ask[0], ask[1]).then(function (yes) { if (yes) go(); });
  }

  return {
    canCorrect: canCorrect,
    canResolve: canResolve,
    amountBody: amountBody,
    outcomeBody: outcomeBody,
    errorText: errorText,
    applyRecord: applyRecord,
    refreshDelayMs: refreshDelayMs,
    savedText: savedText,
    permissionsOf: permissionsOf,
    conflictLabels: conflictLabels,
    controlsHtml: controlsHtml,
    bind: bind,
  };
});
