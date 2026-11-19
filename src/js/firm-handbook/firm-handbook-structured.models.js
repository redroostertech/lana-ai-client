/**
 * Firm Handbook structured item view models (pure, no DOM).
 *
 * Structured items (work hours, meeting follow-up rules) keep typed data the
 * backend validates and renders to plain words. The type declarations
 * (GET /api/v1/firm-handbook/types) drive what is offered; this module maps
 * that data to the forms the page draws and builds the `data` the API takes
 * back. Reading an item shows the server's rendered words, never a summary
 * rebuilt here. The backend is the authority for every rule
 * here; these checks only catch an obviously incomplete form and give the
 * person a plain message.
 *
 * Loaded as a plain script (window.LanaFirmHandbookStructuredModels) and
 * required by Jest (module.exports). No regex, per the Lex rules.
 */
(function (global) {
  'use strict';

  var KIND_TEXT = 'text';
  var KIND_WORK_HOURS = 'work_hours';
  var KIND_FOLLOWUP_RULE = 'followup_rule';

  var DAYS = [
    { day: 'monday', label: 'Monday' },
    { day: 'tuesday', label: 'Tuesday' },
    { day: 'wednesday', label: 'Wednesday' },
    { day: 'thursday', label: 'Thursday' },
    { day: 'friday', label: 'Friday' },
    { day: 'saturday', label: 'Saturday' },
    { day: 'sunday', label: 'Sunday' }
  ];

  var DEFAULT_START = '08:00';
  var DEFAULT_END = '18:00';

  var MESSAGES = {
    noWorkingDay: 'Choose at least one working day.',
    timeMissing: function (day) { return 'Add a start and an end time for ' + day + '.'; },
    endBeforeStart: function (day) { return 'On ' + day + ', the end time must be after the start time.'; },
    ruleValue: 'Say which event type, calendar or appointment type this rule is for.',
    ruleLabel: 'Give the meeting type a name people will recognize.',
    ruleTask: 'Give the follow-up task a title.',
    ruleSource: 'Choose the connected app the appointments come from.',
    amount: 'Enter the amount as a number, like 1500.',
    dueDays: 'Enter the due days as a whole number from 0 to 365.',
    exists: {
      work_hours: 'Your firm already has work hours. Open that item and save a new version instead.',
      followup_rule: 'There is already a follow-up rule for this meeting type. Open it and save a new version instead.'
    }
  };

  function text(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function trimmed(value) {
    return text(value).trim();
  }

  function isStructured(kind) {
    return !!kind && kind !== KIND_TEXT;
  }

  /** 'HH:MM' to minutes after midnight, or null. */
  function minutesOf(hhmm) {
    var value = trimmed(hhmm);
    if (value.length !== 5 || value.charAt(2) !== ':') return null;
    var hours = Number(value.substring(0, 2));
    var minutes = Number(value.substring(3));
    if (!isFinite(hours) || !isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  // ── Types ─────────────────────────────────────────────────────────

  /**
   * The "New item" choices from GET /types: { value, label, description,
   * disabled, reason }. A one-per-firm type that already exists is offered
   * disabled, with the reason.
   */
  function typeChoices(typesPayload, managedItems) {
    var types = typesPayload && Array.isArray(typesPayload.types) ? typesPayload.types : [];
    var existing = {};
    (managedItems || []).forEach(function (item) { if (item && item.kind) existing[item.kind] = true; });
    if (!types.length) {
      return [{ value: KIND_TEXT, label: 'Text', description: '', disabled: false, reason: '' }];
    }
    return types.map(function (type) {
      var taken = type.cardinality === 'one' && !!existing[type.kind];
      return {
        value: text(type.kind),
        label: text(type.label),
        description: text(type.description),
        disabled: taken,
        reason: taken ? (MESSAGES.exists[type.kind] || 'Your firm already has one.') : ''
      };
    });
  }

  function findType(typesPayload, kind) {
    var types = typesPayload && Array.isArray(typesPayload.types) ? typesPayload.types : [];
    for (var i = 0; i < types.length; i++) if (types[i].kind === kind) return types[i];
    return null;
  }

  // ── Work hours ────────────────────────────────────────────────────

  /** Rows for the days grid: { day, label, open, start, end }. */
  function toWorkHoursRows(data) {
    var days = data && data.days ? data.days : null;
    return DAYS.map(function (entry) {
      var hours = days ? days[entry.day] : (DAYS.indexOf(entry) < 5 ? { start: DEFAULT_START, end: DEFAULT_END } : null);
      return {
        day: entry.day,
        label: entry.label,
        open: !!hours,
        start: hours ? text(hours.start) : DEFAULT_START,
        end: hours ? text(hours.end) : DEFAULT_END
      };
    });
  }

  /** The API `data` from the grid's rows, or a message for the first problem. */
  function buildWorkHoursData(rows) {
    var days = {};
    var anyOpen = false;
    var list = Array.isArray(rows) ? rows : [];
    for (var i = 0; i < DAYS.length; i++) {
      var row = null;
      for (var j = 0; j < list.length; j++) if (list[j] && list[j].day === DAYS[i].day) row = list[j];
      if (!row || !row.open) { days[DAYS[i].day] = null; continue; }
      var start = minutesOf(row.start);
      var end = minutesOf(row.end);
      if (start === null || end === null) return { valid: false, message: MESSAGES.timeMissing(DAYS[i].label) };
      if (end <= start) return { valid: false, message: MESSAGES.endBeforeStart(DAYS[i].label) };
      days[DAYS[i].day] = { start: trimmed(row.start), end: trimmed(row.end) };
      anyOpen = true;
    }
    if (!anyOpen) return { valid: false, message: MESSAGES.noWorkingDay };
    return { valid: true, message: '', data: { days: days } };
  }

  // ── Follow-up rules ───────────────────────────────────────────────

  function matchFieldOptions(type) {
    var fields = type && type.options && Array.isArray(type.options.match_fields) ? type.options.match_fields : [];
    return fields.map(function (f) { return { value: text(f.value), label: text(f.label), source: text(f.source) }; });
  }

  /** Connected apps a rule may come from (LANA itself is the event type and calendar matches). */
  function sourceOptions(type, currentSource) {
    var sources = type && type.options && Array.isArray(type.options.sources) ? type.options.sources : [];
    var options = sources.filter(function (s) { return s && s.value !== 'lana'; })
      .map(function (s) { return { value: text(s.value), label: text(s.label || s.value) }; });
    var current = trimmed(currentSource);
    if (current && current !== 'lana' && !options.some(function (o) { return o.value === current; })) {
      options.push({ value: current, label: current });
    }
    return options;
  }

  /** The rule form's fields from data (or a blank rule). */
  function toRuleForm(data) {
    var d = data || {};
    var defaults = d.payment_defaults || {};
    return {
      matchField: text(d.match_field) || 'event_type',
      source: d.source && d.source !== 'lana' ? text(d.source) : '',
      matchValue: text(d.match_value),
      label: text(d.label),
      taskTitle: text(d.task_title),
      paymentReview: d.create_payment_proposal === true,
      paymentType: text(defaults.payment_type),
      amount: defaults.amount === undefined || defaults.amount === null ? '' : String(defaults.amount),
      dueInDays: defaults.due_in_days === undefined || defaults.due_in_days === null ? '' : String(defaults.due_in_days)
    };
  }

  /** The API `data` from the rule form, or a message for the first problem. */
  function buildRuleData(form) {
    var f = form || {};
    var matchField = trimmed(f.matchField) || 'event_type';
    var connector = matchField === 'appointment_type';
    var source = connector ? trimmed(f.source) : 'lana';
    if (connector && !source) return { valid: false, message: MESSAGES.ruleSource };
    if (!trimmed(f.matchValue)) return { valid: false, message: MESSAGES.ruleValue };
    if (!trimmed(f.label)) return { valid: false, message: MESSAGES.ruleLabel };
    if (!trimmed(f.taskTitle)) return { valid: false, message: MESSAGES.ruleTask };
    var data = {
      source: source,
      match_field: matchField,
      match_value: trimmed(f.matchValue),
      label: trimmed(f.label),
      task_title: trimmed(f.taskTitle),
      create_payment_proposal: !!f.paymentReview,
      payment_defaults: {}
    };
    if (data.create_payment_proposal) {
      if (trimmed(f.paymentType)) data.payment_defaults.payment_type = trimmed(f.paymentType);
      if (trimmed(f.amount)) {
        var amount = Number(trimmed(f.amount));
        if (!isFinite(amount) || amount < 0) return { valid: false, message: MESSAGES.amount };
        data.payment_defaults.amount = amount;
      }
      if (trimmed(f.dueInDays)) {
        var due = Number(trimmed(f.dueInDays));
        if (!isFinite(due) || due < 0 || due > 365 || Math.floor(due) !== due) return { valid: false, message: MESSAGES.dueDays };
        data.payment_defaults.due_in_days = due;
      }
    }
    return { valid: true, message: '', data: data };
  }

  /** A title to start from: "Follow-up rule: <label>". */
  function suggestedRuleTitle(label) {
    var value = trimmed(label);
    return value ? 'Follow-up rule: ' + value : '';
  }

  /** LANA's suggestion evidence as short lines for an admin. */
  function evidenceLines(notes) {
    var evidence = notes && notes.evidence;
    if (!evidence) return [];
    var lines = [];
    if (typeof evidence.meetings === 'number') {
      lines.push(evidence.meetings + (evidence.meetings === 1 ? ' meeting' : ' meetings') + ' of this type in the last ' + (evidence.window_days || 180) + ' days');
    }
    if (typeof evidence.followed_by_payment === 'number') {
      lines.push(evidence.followed_by_payment + ' followed by a payment on the same matter');
    }
    (evidence.handbook_items || []).forEach(function (item) {
      if (item && item.title) lines.push('Named in the handbook item "' + text(item.title) + '"');
    });
    return lines;
  }

  var api = {
    KIND_TEXT: KIND_TEXT,
    KIND_WORK_HOURS: KIND_WORK_HOURS,
    KIND_FOLLOWUP_RULE: KIND_FOLLOWUP_RULE,
    DAYS: DAYS,
    MESSAGES: MESSAGES,
    isStructured: isStructured,
    minutesOf: minutesOf,
    typeChoices: typeChoices,
    findType: findType,
    toWorkHoursRows: toWorkHoursRows,
    buildWorkHoursData: buildWorkHoursData,
    matchFieldOptions: matchFieldOptions,
    sourceOptions: sourceOptions,
    toRuleForm: toRuleForm,
    buildRuleData: buildRuleData,
    suggestedRuleTitle: suggestedRuleTitle,
    evidenceLines: evidenceLines
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LanaFirmHandbookStructuredModels = api;
})(typeof window !== 'undefined' ? window : globalThis);
