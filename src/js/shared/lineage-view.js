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

  function systemLine(system, now) {
    var synced = system && system.last_synced_at ? String(system.last_synced_at) : null;
    var time = synced ? Date.parse(synced) : NaN;
    var stale = isFinite(time) && (now - time) > STALE_DAYS * MS_PER_DAY;
    return {
      label: String((system && system.label) || ''),
      records: count(system && system.records),
      syncedAt: synced,
      stale: stale,
      staleText: stale ? 'Last synced ' + shortDay(synced) : null,
    };
  }

  function sourceLine(source, now) {
    var noun = String(source.label || '').toLowerCase();
    var total = count(source.records_total);
    var inPeriod = source.records_in_period === null || source.records_in_period === undefined ? null : count(source.records_in_period);
    return {
      label: String(source.label || ''),
      line: total !== null ? total + ' ' + noun + (inPeriod !== null ? ', ' + inPeriod + ' in your dates' : '') : String(source.label || ''),
      systems: list(source.systems).map(function (system) { return systemLine(system, now); }),
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

  /** metric-detail data.lineage -> the Data used view, or null. */
  function detailModel(lineage, now) {
    if (!lineage || typeof lineage !== 'object') return null;
    var fields = list(lineage.fields).slice().sort(function (a, b) {
      return FIELD_ORDER.indexOf(a.role) - FIELD_ORDER.indexOf(b.role);
    });
    return {
      formula: lineage.formula && lineage.formula.plain ? String(lineage.formula.plain) : '',
      equation: equationOf(lineage),
      sources: list(lineage.sources).map(function (source) { return sourceLine(source, now); }),
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

  return { detailModel: detailModel, cardSummary: cardSummary, cardLines: cardLines };
});
