/**
 * server-form-fields.js
 * Value mapping for server-described forms (design 4.1 form descriptor).
 *
 * Field kinds are a closed, generic set. For each kind this module maps
 * between the raw input a Lex control holds and the wire value the server
 * receives, and refuses input it cannot represent exactly. Eligibility and
 * acceptance stay on the server: options come from the descriptor and the
 * client only checks a choice is one of them.
 *
 * Raw inputs by kind:
 *   text, textarea, number, money, date, select, reference: string
 *   datetime: 'YYYY-MM-DDTHH:mm' (datetime-local)
 *   multiselect, reference_set, document_versions: string[]
 *   allocation: [{ ref, percent }] (descriptor may carry total_basis_points; default 10000)
 *   evidence_sources: [{ source, evidence_class, coverage, observed_at, page, quote }]
 *   confirm: boolean
 *
 * Public API (window.LanaServerFormFields, or module.exports in Node):
 *   - FIELD_KINDS, SCHEMA_VERSION
 *   - normalizeDescriptor(descriptor) -> { ok, descriptor?, reason?, message? }
 *   - emptyRaw(field)                 -> raw value for an empty control
 *   - toWire(field, raw)              -> wire value | undefined (empty, optional); throws on invalid
 *   - fromWire(field, wire)           -> raw value (for defaults and recovery)
 *   - collect(fields, raws)           -> { values, errors: { [fieldId]: message } }
 */

(function (global) {
  'use strict';

  var values = typeof module !== 'undefined' && module.exports ? require('./form-values.js') : global.LanaFormValues;

  var SCHEMA_VERSION = 1;
  var FIELD_KINDS = ['text', 'textarea', 'number', 'money', 'date', 'datetime', 'select', 'multiselect',
    'reference', 'reference_set', 'allocation', 'document_versions', 'evidence_sources', 'confirm'];
  var LIST_KINDS = ['multiselect', 'reference_set', 'allocation', 'document_versions', 'evidence_sources'];

  function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
  function text(raw) { return String(raw == null ? '' : raw).trim(); }
  function list(raw) { return Array.isArray(raw) ? raw : []; }
  function options(field, key) { return Array.isArray(field[key || 'options']) ? field[key || 'options'] : []; }
  function findOption(field, value, key) {
    var wanted = String(value);
    return options(field, key).find(function (option) { return option && String(option.value) === wanted; }) || null;
  }
  // JSON with object keys sorted (the backend's canonicalJson), so a stored
  // reference matches its option whatever order its keys come in.
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort().filter(function (key) { return value[key] !== undefined; })
        .map(function (key) { return JSON.stringify(key) + ':' + canonical(value[key]); }).join(',') + '}';
    }
    return JSON.stringify(value === undefined ? null : value);
  }
  function sameJson(a, b) { return canonical(a) === canonical(b); }

  function normalizeDescriptor(descriptor) {
    if (!descriptor || typeof descriptor !== 'object' || !Array.isArray(descriptor.fields)) {
      return { ok: false, reason: 'invalid', message: 'The server did not return a form.' };
    }
    if (descriptor.schema_version !== SCHEMA_VERSION) {
      return { ok: false, reason: 'unsupported', message: 'This form needs a newer app version.' };
    }
    var ids = {};
    for (var i = 0; i < descriptor.fields.length; i++) {
      var field = descriptor.fields[i];
      if (!field || typeof field.id !== 'string' || !field.id || ids[field.id]) {
        return { ok: false, reason: 'invalid', message: 'The server returned a form with an unnamed or repeated field.' };
      }
      if (FIELD_KINDS.indexOf(field.kind) === -1) {
        return { ok: false, reason: 'unsupported', message: 'This form needs a newer app version.' };
      }
      ids[field.id] = true;
    }
    return { ok: true, descriptor: descriptor };
  }

  function emptyRaw(field) {
    if (field.kind === 'confirm') return false;
    if (LIST_KINDS.indexOf(field.kind) !== -1) return [];
    return '';
  }

  function required(field) { return field.required === true; }
  function label(field) { return field.label || field.id; }

  function choose(field, value, key, message) {
    var option = findOption(field, value, key);
    if (!option || option.disabled) throw new Error(message || 'Choose one of the listed options for ' + label(field) + '.');
    return option;
  }

  function referenceOf(field, value) {
    var option = choose(field, value, 'options', 'Choose a record from the list for ' + label(field) + '.');
    return { kind: option.kind || field.reference_kind, id: String(option.value) };
  }

  function documentReference(field, value) {
    var option = choose(field, value, 'options', 'Choose an available document version.');
    if (!option.reference || option.retained === false) throw new Error('Choose an available document version.');
    return clone(option.reference);
  }

  function evidenceSource(field, row) {
    var result = {
      artifact: documentReference(field, row.source),
      evidence_class: String(choose(field, row.evidence_class, 'evidence_classes', 'Choose what this source establishes.').value),
      observed_at: values.instant(row.observed_at),
      coverage: String(choose(field, row.coverage, 'coverage_options', 'Choose how much this source covers.').value)
    };
    var locator = {};
    if (row.page !== '' && row.page !== null && row.page !== undefined) {
      locator.page = values.wholeNumber(row.page, 'A source page must be a positive whole number.');
    }
    if (text(row.quote)) locator.quote = text(row.quote);
    if (Object.keys(locator).length) result.locator = locator;
    return result;
  }

  function checkLength(field, value) {
    if (field.max_length && value.length > field.max_length) {
      throw new Error(label(field) + ' must be at most ' + field.max_length + ' characters.');
    }
    return value;
  }

  function checkRange(field, value) {
    if (typeof field.min === 'number' && value < field.min) throw new Error(label(field) + ' must be at least ' + field.min + '.');
    if (typeof field.max === 'number' && value > field.max) throw new Error(label(field) + ' must be at most ' + field.max + '.');
    return value;
  }

  function parseNumber(field, raw) {
    var value = text(raw);
    var negative = value.charAt(0) === '-';
    var digits = negative ? value.substring(1) : value;
    var parts = digits.split('.');
    var valid = parts.length <= 2 && parts.every(function (part) {
      return part !== '' && Array.from(part).every(function (c) { return c >= '0' && c <= '9'; });
    });
    var number = Number(value);
    if (!valid || !Number.isFinite(number)) throw new Error('Enter a number for ' + label(field) + '.');
    if (field.integer === true && !Number.isInteger(number)) throw new Error(label(field) + ' must be a whole number.');
    return checkRange(field, number);
  }

  var WIRE = {
    text: function (field, raw) { return checkLength(field, text(raw)); },
    textarea: function (field, raw) { return checkLength(field, text(raw)); },
    number: parseNumber,
    money: function (field, raw) {
      if (!field.currency) throw new Error('This form does not name a currency for ' + label(field) + '.');
      return { amount_minor: values.minorUnits(raw), currency: field.currency };
    },
    date: function (field, raw) { return values.calendarDate(text(raw)); },
    datetime: function (field, raw) { return values.instant(text(raw)); },
    select: function (field, raw) { return String(choose(field, raw).value); },
    multiselect: function (field, raw) { return list(raw).map(function (value) { return String(choose(field, value).value); }); },
    reference: referenceOf,
    reference_set: function (field, raw) { return list(raw).map(function (value) { return referenceOf(field, value); }); },
    // Every share positive, the shares adding up to exactly the total: all
    // of it, or the descriptor's total_basis_points when it declares a part.
    allocation: function (field, raw) {
      var total = typeof field.total_basis_points === 'number' ? field.total_basis_points : values.BASIS_POINTS_TOTAL;
      var rows = list(raw).map(function (row) {
        var share = values.basisPoints(row && row.percent);
        if (!(share > 0)) throw new Error('Each share in ' + label(field) + ' must be more than 0%.');
        return { ref: referenceOf(field, row && row.ref), share_basis_points: share };
      });
      var sum = rows.reduce(function (acc, row) { return acc + row.share_basis_points; }, 0);
      if (sum !== total) throw new Error(label(field) + ' shares must add up to ' + values.percentText(total) + '%.');
      return rows;
    },
    document_versions: function (field, raw) { return list(raw).map(function (value) { return documentReference(field, value); }); },
    evidence_sources: function (field, raw) { return list(raw).map(function (row) { return evidenceSource(field, row || {}); }); },
    confirm: function (field, raw) {
      if (raw !== true) throw new Error('Confirm this before submitting.');
      return true;
    }
  };

  function isEmpty(field, raw) {
    if (field.kind === 'confirm') return false;
    if (LIST_KINDS.indexOf(field.kind) !== -1) return list(raw).length === 0;
    return text(raw) === '';
  }

  function toWire(field, raw) {
    if (FIELD_KINDS.indexOf(field.kind) === -1) throw new Error('This form needs a newer app version.');
    if (isEmpty(field, raw)) {
      if (required(field)) throw new Error(label(field) + ' is required.');
      return undefined;
    }
    return WIRE[field.kind](field, raw);
  }

  function optionValueFor(field, predicate, key) {
    var option = options(field, key).find(predicate);
    return option ? String(option.value) : '';
  }

  function fromWire(field, wire) {
    if (wire === undefined || wire === null) return emptyRaw(field);
    switch (field.kind) {
      case 'text':
      case 'textarea':
      case 'date':
      case 'select':
        return String(wire);
      case 'number':
        return String(wire);
      case 'money':
        return wire && typeof wire.amount_minor === 'number' ? values.amountText(wire.amount_minor) : '';
      case 'datetime':
        return values.localInput(wire);
      case 'multiselect':
        return list(wire).map(String);
      case 'reference':
        return wire && wire.id !== undefined ? String(wire.id) : '';
      case 'reference_set':
        return list(wire).map(function (ref) { return ref && ref.id !== undefined ? String(ref.id) : ''; });
      case 'allocation':
        return list(wire).map(function (entry) {
          return { ref: entry && entry.ref ? String(entry.ref.id) : '', percent: entry && typeof entry.share_basis_points === 'number' ? values.percentText(entry.share_basis_points) : '' };
        });
      case 'document_versions':
        return list(wire).map(function (reference) {
          return optionValueFor(field, function (option) { return option && sameJson(option.reference, reference); });
        });
      case 'evidence_sources':
        return list(wire).map(function (entry) {
          var item = entry || {};
          return {
            source: optionValueFor(field, function (option) { return option && sameJson(option.reference, item.artifact); }),
            evidence_class: item.evidence_class || '',
            coverage: item.coverage || '',
            observed_at: values.localInput(item.observed_at),
            page: item.locator && item.locator.page ? String(item.locator.page) : '',
            quote: item.locator && item.locator.quote ? item.locator.quote : ''
          };
        });
      case 'confirm':
        return wire === true;
      default:
        return emptyRaw(field);
    }
  }

  function collect(fields, raws) {
    var result = { values: {}, errors: {} };
    (fields || []).forEach(function (field) {
      try {
        var wire = toWire(field, raws ? raws[field.id] : undefined);
        if (wire !== undefined) result.values[field.id] = wire;
      } catch (error) {
        result.errors[field.id] = error.message;
      }
    });
    return result;
  }

  var moduleApi = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    FIELD_KINDS: FIELD_KINDS.slice(),
    normalizeDescriptor: normalizeDescriptor,
    emptyRaw: emptyRaw,
    toWire: toWire,
    fromWire: fromWire,
    collect: collect
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = moduleApi;
  if (global) global.LanaServerFormFields = moduleApi;
})(typeof window !== 'undefined' ? window : globalThis);
