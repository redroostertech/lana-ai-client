/**
 * Lineage view model (pure, no DOM): how a number is worked out, in plain
 * words. metric-detail data.lineage feeds the "Data used" section; the
 * card's shape and card.lineage feed the "How this card works" panel.
 * Null lineage draws nothing. No ids or raw expressions are shown by
 * default (the expression is kept for a Technical details disclosure).
 * No regex (per Lex rules).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LineageView = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var STALE_DAYS = 7;
  var MS_PER_DAY = 86400000;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // The operator in front of an input, by its role in the formula.
  var OPS = { numerator: '', part: '', denominator: '/', subtract: '-', goal: 'of' };
  var EQUATION_KINDS = { ratio: true, difference: true, goal: true };
  var FIELD_SENTENCES = {
    'date filter': ' decides which dates count.',
    filter: ' decides what is included.',
    'group by': ' splits the number into groups.',
    value: ' is the value we use.',
  };
  var FIELD_ORDER = ['date filter', 'filter', 'group by', 'value'];

  function count(n) {
    var v = Number(n);
    return isFinite(v) ? Math.round(v).toLocaleString('en-US') : null;
  }

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  function shortDay(iso) {
    var time = Date.parse(String(iso));
    if (!isFinite(time)) return '';
    var d = new Date(time);
    return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate();
  }

  // One system's share: "7,715 via ActionStep", "8 in LANA". These count
  // every record of the type in that system, not only the records this
  // number uses; the page labels them so.
  function systemPart(system) {
    var label = String((system && system.label) || '');
    var n = count(system && system.records);
    if (!label || n === null) return '';
    return n + (label.toUpperCase() === 'LANA' ? ' in LANA' : ' via ' + label);
  }

  function latestSync(source) {
    var best = source.last_synced_at ? String(source.last_synced_at) : null;
    list(source.systems).forEach(function (system) {
      if (system && system.last_synced_at && (!best || Date.parse(system.last_synced_at) > Date.parse(best))) best = String(system.last_synced_at);
    });
    return best;
  }

  // The entity leads: "7,723 matters on file, 36 counted in your dates".
  // records_in_period follows the metric's own date field (null for Right now
  // and whole-file numbers, and never shown for Right now numbers).
  // count_scope is the server's note on what the counts cover.
  function sourceLine(source, now, snapshot) {
    var noun = String(source.label || '').toLowerCase();
    var total = count(source.records_total);
    var added = snapshot || source.records_in_period === null || source.records_in_period === undefined ? null : count(source.records_in_period);
    var synced = latestSync(source);
    var time = synced ? Date.parse(synced) : NaN;
    var stale = isFinite(time) && (now - time) > STALE_DAYS * MS_PER_DAY;
    return {
      label: String(source.label || ''),
      line: total !== null ? total + ' ' + noun + ' on file' + (added !== null ? ', ' + added + ' counted in your dates' : '') : String(source.label || ''),
      systemsLabel: source.count_scope ? String(source.count_scope) : 'records of this type, by system',
      systemsText: list(source.systems).map(systemPart).filter(Boolean).join(', '),
      syncedAt: synced,
      stale: stale,
      staleText: stale ? 'last synced ' + shortDay(synced) : null,
    };
  }

  function equationOf(lineage) {
    var kind = lineage.formula && lineage.formula.kind;
    var inputs = list(lineage.inputs);
    if (!EQUATION_KINDS[kind] || inputs.length < 2) return null;
    return inputs.map(function (input, i) {
      return { op: i === 0 ? '' : (OPS[input.role] !== undefined ? OPS[input.role] : ''), title: String(input.title || ''), metric_key: input.metric_key || '' };
    });
  }

  /** metric-detail data.lineage -> the Data used view, or null. options.snapshot: a Right now number. */
  function detailModel(lineage, now, options) {
    var snapshot = !!(options && options.snapshot);
    if (!lineage || typeof lineage !== 'object') return null;
    var fields = list(lineage.fields).slice().sort(function (a, b) {
      return FIELD_ORDER.indexOf(a.role) - FIELD_ORDER.indexOf(b.role);
    });
    return {
      formula: lineage.formula && lineage.formula.plain ? String(lineage.formula.plain) : '',
      equation: equationOf(lineage),
      sources: list(lineage.sources).filter(function (source) { return Number(source.records_total) !== 0; })
        .map(function (source) { return sourceLine(source, now, snapshot); }),
      fieldSentences: fields.filter(function (f) { return FIELD_SENTENCES[f.role] && f.label; })
        .map(function (f) { return f.label + FIELD_SENTENCES[f.role]; }),
      filters: list(lineage.filters).map(function (f) { return { label: String(f.label || ''), detail: String(f.detail || '') }; }),
      periodRule: lineage.period_rule ? String(lineage.period_rule) : '',
      goal: lineage.goal_source ? { set: !!lineage.goal_source.set, metric_key: lineage.goal_source.metric_key || '' } : null,
      caveats: list(lineage.caveats).map(String),
      expression: lineage.formula && lineage.formula.expression ? String(lineage.formula.expression) : '',
    };
  }

  /** One sentence on how a card is put together, from its visual. */
  function cardSummary(visual, metricCount, firstTitle, isList) {
    if (isList) {
      if (visual === 'donut') return 'Each slice is one row of ' + firstTitle + ', as a share of the total.';
      return 'Each bar is one row of ' + firstTitle + '.';
    }
    if (visual === 'ring' || visual === 'bullet') return 'The ring shows progress toward the goal set on ' + firstTitle + '.';
    if (metricCount < 2) return null;
    if (visual === 'compare') return 'Shows these ' + metricCount + ' numbers side by side.';
    if (visual === 'donut') return 'Each slice is one number, as a share of the total.';
    if (visual === 'stacked_bar') return 'Each part of the bar is one number, as a share of the total.';
    if (visual === 'funnel') return 'Each step is one number; the percent shows how many moved on from the step before.';
    return 'Each bar is one number.';
  }

  /** card.lineage -> { formula, periodRule, sources } for the instant summary. */
  function cardLines(lineage) {
    if (!lineage || typeof lineage !== 'object') return null;
    return {
      formula: lineage.formula && lineage.formula.plain ? String(lineage.formula.plain) : '',
      periodRule: lineage.period_rule ? String(lineage.period_rule) : '',
      sources: list(lineage.sources).map(function (s) { return String(s.label || ''); }).filter(Boolean),
    };
  }

  // ── Helpers for the styled About this number section ──────────────
  var SYMBOLS = { '/': '÷', '-': '-', of: 'of' };
  var KIND_WORDS = { count: 'Count of', sum: 'Total of', average: 'Average of', age: 'Age of', list: 'List of' };
  var KIND_LABELS = { count: 'Count', sum: 'Total', average: 'Average', ratio: 'Ratio', difference: 'Difference', age: 'Age', list: 'List', goal: 'Progress to goal' };
  var FIELD_ICONS = { 'date filter': 'calendar', filter: 'funnel', 'group by': 'layers', value: 'sigma' };

  /**
   * The equation as pills: inputs (with their current values when known)
   * and the result; or, for a count/sum/average/age, a sentence of pills.
   * values: { metric_key: formatted value }.
   */
  function equationPills(lineage, values, result) {
    if (!lineage || typeof lineage !== 'object') return null;
    var equation = equationOf(lineage);
    if (equation) {
      return {
        type: 'equation',
        terms: equation.map(function (term) {
          return { op: term.op ? (SYMBOLS[term.op] || term.op) : '', label: term.title, value: (values && values[term.metric_key]) || '', metric_key: term.metric_key };
        }),
        result: result || '',
      };
    }
    var kind = lineage.formula && lineage.formula.kind;
    var words = KIND_WORDS[kind];
    var source = list(lineage.sources)[0];
    if (!words || !source || !source.label) return null;
    var parts = [{ text: words }, { pill: String(source.label) }];
    var filters = list(lineage.filters).map(function (f) { return String(f.label || ''); }).filter(Boolean);
    if (filters.length) {
      parts.push({ text: 'where' });
      filters.forEach(function (label, i) {
        if (i > 0) parts.push({ text: 'and' });
        parts.push({ pill: label });
      });
    }
    return { type: 'sentence', parts: parts, result: result || '' };
  }

  /** fresh (under a day), recent (up to a week), stale (older), unknown. */
  function syncStatus(syncedAt, now) {
    var time = syncedAt ? Date.parse(String(syncedAt)) : NaN;
    if (!isFinite(time)) return 'unknown';
    var age = now - time;
    if (age < MS_PER_DAY) return 'fresh';
    if (age <= STALE_DAYS * MS_PER_DAY) return 'recent';
    return 'stale';
  }

  function plainWords(text) {
    var out = String(text || '').toLowerCase().split(' ').filter(Boolean).join(' ');
    while (out.length && (out.charAt(out.length - 1) === '.' || out.charAt(out.length - 1) === ' ')) out = out.slice(0, -1);
    return out;
  }

  /** True when two sentences say the same thing (so one is hidden). */
  function sameText(a, b) {
    var x = plainWords(a);
    return !!x && x === plainWords(b);
  }

  /** The four steps: Data, Filters, Dates, Result. */
  function flowSteps(model, lineage) {
    var kind = lineage && lineage.formula && lineage.formula.kind;
    var sources = model ? model.sources.map(function (s) { return s.label; }).filter(Boolean) : [];
    var filters = model ? model.filters.map(function (f) { return f.label; }).filter(Boolean) : [];
    return [
      { key: 'data', icon: 'database', title: 'Data', lines: sources.length ? sources : ['No sources listed'] },
      { key: 'filters', icon: 'funnel', title: 'Filters', lines: filters.length ? filters : ['Everything counts'] },
      { key: 'dates', icon: 'calendar', title: 'Dates', lines: [model && model.periodRule ? model.periodRule : 'Follows the dates you pick'] },
      { key: 'result', icon: 'sigma', title: 'Result', lines: [KIND_LABELS[kind] || 'Number'] },
    ];
  }

  /** The details we read, each with its role icon. */
  function fieldRows(lineage) {
    return list(lineage && lineage.fields).slice().sort(function (a, b) {
      return FIELD_ORDER.indexOf(a.role) - FIELD_ORDER.indexOf(b.role);
    }).filter(function (f) { return FIELD_SENTENCES[f.role] && f.label; }).map(function (f) {
      return { role: f.role, icon: FIELD_ICONS[f.role], sentence: f.label + FIELD_SENTENCES[f.role] };
    });
  }

  /** Source cards: entity, big total, in-dates chip, via line with sync status, count_scope once. */
  function sourceCards(lineage, now, options) {
    var snapshot = !!(options && options.snapshot);
    return list(lineage && lineage.sources).filter(function (source) { return Number(source.records_total) !== 0; }).map(function (source) {
      var noun = String(source.label || '').toLowerCase();
      var total = count(source.records_total);
      var inDates = snapshot || source.records_in_period === null || source.records_in_period === undefined ? null : count(source.records_in_period);
      var via = list(source.systems).map(function (system) {
        var label = String((system && system.label) || '');
        if (!label) return '';
        if (label.toUpperCase() === 'LANA') return count(system.records) !== null ? count(system.records) + ' in LANA' : 'in LANA';
        return 'via ' + label;
      }).filter(Boolean).join(', ');
      var synced = latestSync(source);
      return {
        label: String(source.label || ''),
        entity: String(source.entity || ''),
        total: total !== null ? total + ' ' + noun : String(source.label || ''),
        inDates: inDates !== null ? inDates + ' in your dates' : null,
        via: via,
        syncedAt: synced,
        status: syncStatus(synced, now),
        scopeNote: source.count_scope ? String(source.count_scope) : '',
      };
    });
  }

  return {
    detailModel: detailModel, cardSummary: cardSummary, cardLines: cardLines,
    equationPills: equationPills, syncStatus: syncStatus, sameText: sameText, flowSteps: flowSteps,
    fieldRows: fieldRows, sourceCards: sourceCards,
  };
});
