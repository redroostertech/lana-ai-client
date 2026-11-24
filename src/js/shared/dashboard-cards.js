/**
 * Declared dashboard cards (pure, no DOM).
 *
 * A saved dashboard can list its cards in layout.cards (the approved trim
 * spec): an ordered list of { id, kind, title?, metric_key | metric_keys,
 * variants?, chart?, note? }. This module turns that into what the page
 * draws: full metric keys, the card each key's data comes from, whether a
 * card or one of its metrics is waiting, sizes by kind, the variant in view,
 * group and funnel rows, and where a goal ring comes from. Without
 * layout.cards the page keeps drawing layout.metric_keys as before.
 *
 * Keyed by shape and kind, never by a particular metric. No regex.
 */
(function (root, factory) {
  var view = (root && root.MetricCardView)
    || (typeof require === 'function' ? require('./metric-card-view.js') : null);
  var api = factory(view);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DashboardCards = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (MetricCardView) {
  'use strict';

  var PREFIX = 'legal_firm.';
  var SIZES = {
    headline: { role: 'hero', span: 2 },
    number: { role: 'kpi', span: 1 },
    goal: { role: 'kpi', span: 1 },
    pair: { role: 'wide', span: 2 },
    breakdown: { role: 'chart', span: 2 },
    group: { role: 'chart', span: 2 },
    worklist: { role: 'chart', span: 2 },
  };

  // The spec writes keys without the legal_firm. prefix ("finance.cash");
  // real keys have it. A two-part key gets the prefix; anything else is kept.
  function normalizeKey(key) {
    var text = key === null || key === undefined ? '' : String(key).trim();
    if (!text) return '';
    return text.split('.').length === 2 ? PREFIX + text : text;
  }

  function uniqueKeys(list) {
    var seen = {};
    var out = [];
    list.forEach(function (key) {
      var full = normalizeKey(key);
      if (full && !seen[full]) { seen[full] = true; out.push(full); }
    });
    return out;
  }

  function normalizeCard(raw) {
    if (!raw || typeof raw !== 'object' || !SIZES[raw.kind]) return null;
    var keys = uniqueKeys(Array.isArray(raw.metric_keys) ? raw.metric_keys : [raw.metric_key]);
    if (!keys.length) return null;
    var variants = (Array.isArray(raw.variants) ? raw.variants : []).map(function (variant) {
      return variant && { label: String(variant.label || ''), key: normalizeKey(variant.metric_key) };
    }).filter(function (variant) { return variant && variant.key; });
    return {
      id: String(raw.id || keys[0]),
      kind: raw.kind,
      title: raw.title ? String(raw.title) : '',
      keys: keys,
      variants: variants,
      chart: raw.chart === 'funnel' ? 'funnel' : 'bars',
      note: raw.note ? String(raw.note) : '',
    };
  }

  /** { mode: 'cards', cards } when layout.cards declares any usable card, else { mode: 'keys', cards: [] }. */
  function normalizeLayout(layout) {
    var cards = layout && Array.isArray(layout.cards) ? layout.cards.map(normalizeCard).filter(Boolean) : [];
    return cards.length ? { mode: 'cards', cards: cards } : { mode: 'keys', cards: [] };
  }

  /** The flat union of keys the card request sends. */
  function requestKeys(layout) {
    var keys = layout && Array.isArray(layout.metric_keys) ? layout.metric_keys.slice() : [];
    normalizeLayout(layout).cards.forEach(function (card) {
      keys = keys.concat(card.keys, card.variants.map(function (variant) { return variant.key; }));
    });
    return uniqueKeys(keys);
  }

  function lastPart(key) {
    var parts = String(key || '').split('.');
    return parts[parts.length - 1];
  }

  function indexMetrics(metrics) {
    var byKey = {};
    var byShort = {};
    (Array.isArray(metrics) ? metrics : []).forEach(function (metric) {
      var key = metric && (metric.metric_key || metric.key);
      if (!key) return;
      byKey[key] = metric;
      if (!byShort[lastPart(key)]) byShort[lastPart(key)] = metric;
    });
    return { byKey: byKey, byShort: byShort };
  }

  // By full key, or by the last part, the way older saved layouts matched.
  function metricFor(index, key) {
    if (!index || !key) return null;
    return index.byKey[key] || index.byShort[lastPart(key)] || null;
  }

  // Waiting: not in the response, or any state other than ok (setup, a goal,
  // a data source to connect, or a failure).
  function isWaiting(metric) {
    return !metric || (!!metric.data_state && metric.data_state !== 'ok');
  }

  function sizeFor(kind) {
    var size = SIZES[kind] || SIZES.number;
    return { role: size.role, span: size.span };
  }

  /** The variant in view: { index, key }. index -1 when the card has none. */
  function activeVariant(card, picked) {
    var variants = card && card.variants ? card.variants : [];
    if (!variants.length) return { index: -1, key: card.keys[0] };
    if (picked >= 0 && picked < variants.length) return { index: picked, key: variants[picked].key };
    for (var i = 0; i < variants.length; i += 1) {
      if (variants[i].key === card.keys[0]) return { index: i, key: variants[i].key };
    }
    return { index: 0, key: variants[0].key };
  }

  function toNumber(value) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    var n = Number(value);
    return isFinite(n) ? n : null;
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  /**
   * One row per metric of a group card: { key, label, value, waiting, pct,
   * conversionPct }. pct is against the largest value; conversionPct (funnel
   * only) is this step against the step before it.
   */
  function groupRows(card, index) {
    var rows = card.keys.map(function (key) {
      var metric = metricFor(index, key);
      var waiting = isWaiting(metric);
      return {
        key: key,
        metric: metric,
        label: (metric && (metric.title || metric.name)) || lastPart(key).split('_').join(' '),
        value: waiting ? null : toNumber(metric.value),
        waiting: waiting,
      };
    });
    var max = 0;
    rows.forEach(function (row) { if (row.value !== null && row.value > max) max = row.value; });
    return rows.map(function (row, i) {
      var before = i > 0 ? rows[i - 1].value : null;
      var conversion = card.chart === 'funnel' && i > 0 && before !== null && before > 0 && row.value !== null
        ? round1((row.value / before) * 100) : null;
      return {
        key: row.key,
        metric: row.metric,
        label: row.label,
        value: row.value,
        waiting: row.waiting,
        pct: row.value !== null && row.value > 0 && max > 0 ? round1((row.value / max) * 100) : 0,
        conversionPct: conversion,
      };
    });
  }

  /** Each declared card with its metrics: { def, metrics: [{ key, metric, waiting }], state: ok | mixed | waiting }. */
  function resolveCards(cards, index) {
    return (cards || []).map(function (def) {
      var metrics = def.keys.map(function (key) {
        var metric = metricFor(index, key);
        return { key: key, metric: metric, waiting: isWaiting(metric) };
      });
      var waitingCount = metrics.filter(function (m) { return m.waiting; }).length;
      return {
        def: def,
        metrics: metrics,
        state: waitingCount === 0 ? 'ok' : (waitingCount === metrics.length ? 'waiting' : 'mixed'),
      };
    });
  }

  /** Cards to draw ({ resolved, role, span }) in declared order, and the waiting ones for the strip. */
  function planDeclared(resolved) {
    var items = [];
    var waiting = [];
    (resolved || []).forEach(function (entry) {
      if (entry.state === 'waiting') { waiting.push(entry); return; }
      var size = sizeFor(entry.def.kind);
      items.push({ resolved: entry, role: size.role, span: size.span });
    });
    return { items: items, waiting: waiting };
  }

  /** For older layouts: stand-alone waiting cards go to the strip. */
  function splitWaiting(metrics) {
    var shown = [];
    var waiting = [];
    (metrics || []).forEach(function (metric) { (isWaiting(metric) ? waiting : shown).push(metric); });
    return { shown: shown, waiting: waiting };
  }

  /**
   * Where a goal card's ring comes from: { source, progress, details } or null.
   * card.goal first (the goals service); otherwise metadata that carries
   * attainmentPercent (with target and gap as detail lines).
   */
  function goalFor(metric) {
    if (!metric || isWaiting(metric)) return null;
    if (metric.goal && typeof metric.goal === 'object') {
      return { source: 'goal', progress: MetricCardView.goalProgress(metric.goal), details: [] };
    }
    var meta = metric.metadata && typeof metric.metadata === 'object' ? metric.metadata : null;
    var attainment = meta ? toNumber(meta.attainmentPercent) : null;
    if (attainment === null) return null;
    var met = attainment >= 100;
    var target = toNumber(meta.target);
    var gap = toNumber(meta.revenueGap !== undefined ? meta.revenueGap : meta.gap);
    var details = [];
    if (target !== null) details.push({ label: 'Target', value: target });
    if (gap !== null) details.push({ label: 'Gap to target', value: gap });
    return {
      source: 'metadata',
      progress: {
        available: true,
        fillPct: round1(Math.min(100, Math.max(0, attainment))),
        attainmentLabel: Math.round(attainment) + '%',
        band: met ? 'green' : 'neutral',
        statusLabel: met ? 'Target met' : 'Toward the target',
        target: target,
        paceMarkerPct: null,
        paceStatus: null,
        paceLabel: null,
        met: met,
      },
      details: details,
    };
  }

  // Worklist table columns: readable fields only (no ids or access flags),
  // columns with at least one value, at most four.
  function isHiddenColumn(key) {
    var k = String(key).toLowerCase();
    return k === 'id' || k === 'request_access' || k.slice(-4) === '_key' || k.slice(-3) === '_id' || k.charAt(0) === '_';
  }

  function isDateColumn(key) {
    var k = String(key).toLowerCase();
    return k === 'date' || k.slice(-3) === '_at' || k.slice(-5) === '_date';
  }

  function worklistColumns(rows) {
    var list = Array.isArray(rows) ? rows : [];
    var columns = [];
    list.forEach(function (row) {
      Object.keys(row || {}).forEach(function (key) {
        if (columns.indexOf(key) === -1 && !isHiddenColumn(key)) columns.push(key);
      });
    });
    return columns.filter(function (key) {
      return list.some(function (row) { return row && row[key] !== null && row[key] !== undefined && row[key] !== ''; });
    }).slice(0, 4);
  }

  return {
    worklistColumns: worklistColumns,
    isDateColumn: isDateColumn,
    normalizeKey: normalizeKey,
    normalizeLayout: normalizeLayout,
    requestKeys: requestKeys,
    indexMetrics: indexMetrics,
    metricFor: metricFor,
    isWaiting: isWaiting,
    sizeFor: sizeFor,
    activeVariant: activeVariant,
    groupRows: groupRows,
    resolveCards: resolveCards,
    planDeclared: planDeclared,
    splitWaiting: splitWaiting,
    goalFor: goalFor,
  };
});
