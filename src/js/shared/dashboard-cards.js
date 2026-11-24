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
      visual: raw.visual ? String(raw.visual) : '',
      // Saved cards keep their options in visual_options; the spec wrote
      // them on the card itself. Both read the same.
      options: cardOptions(Object.assign({}, raw, raw.visual_options && typeof raw.visual_options === 'object' ? raw.visual_options : {})),
    };
  }

  // Visual options (card-visuals.js): keys come back in full, accents only
  // from the status tokens, everything else as plain values.
  var ACCENTS = { danger: true, warning: true, success: true };

  function keyList(value) {
    return Array.isArray(value) ? uniqueKeys(value) : [];
  }

  function cardOptions(raw) {
    return {
      detail: keyList(raw.detail),
      chips: keyList(raw.chips),
      metric_keys_override: keyList(raw.metric_keys_override),
      headline_keys: keyList(raw.headline_keys),
      centre_key: raw.centre_key ? normalizeKey(raw.centre_key) : '',
      badge_key: raw.badge_key ? normalizeKey(raw.badge_key) : '',
      series_labels: Array.isArray(raw.series_labels) ? raw.series_labels.map(String) : [],
      accent: ACCENTS[raw.accent] ? raw.accent : null,
      sort: raw.sort ? String(raw.sort) : '',
      unit: raw.unit ? String(raw.unit) : '',
      relation: raw.relation ? String(raw.relation) : '',
      ratio_bar: raw.ratio_bar === true,
      benchmark: raw.benchmark ? String(raw.benchmark) : '',
      fallback: raw.fallback ? String(raw.fallback) : '',
      inner: raw.inner ? String(raw.inner) : '',
      initials: raw.initials === true,
      style: raw.style ? String(raw.style) : '',
      sparkline: raw.sparkline === true,
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
      // (options already include visual_options)
      var o = card.options;
      keys = keys.concat(card.keys, card.variants.map(function (variant) { return variant.key; }),
        o.detail, o.chips, o.metric_keys_override, o.headline_keys, o.centre_key ? [o.centre_key] : [], o.badge_key ? [o.badge_key] : []);
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
    // The hero takes two of four columns: the next compact cards (span 1,
    // up to two) move up beside it so its row stays short.
    if (items.length && items[0].role === 'hero') {
      var beside = [];
      for (var i = 1; i < items.length && beside.length < 2; i += 1) {
        if (items[i].span === 1) beside.push(items[i]);
      }
      if (beside.length) {
        items = [items[0]].concat(beside, items.slice(1).filter(function (item) { return beside.indexOf(item) === -1; }));
      }
    }
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

  // A card title: the declared one, else the words every metric title shares
  // ("Medicaid Case Count" + "Medicaid Cases Won" -> "Medicaid Cases"), else
  // the first metric's title.
  function stem(word) {
    var w = word.toLowerCase();
    return w.length > 3 && w.charAt(w.length - 1) === 's' ? w.slice(0, -1) : w;
  }

  function titleOf(entry) {
    var metric = entry && entry.metric;
    if (metric && (metric.title || metric.name)) return String(metric.title || metric.name);
    var key = String((entry && entry.key) || '').split('.').pop().split('_').join(' ');
    return key ? key.charAt(0).toUpperCase() + key.slice(1) : '';
  }

  function compositeTitle(def, metrics) {
    if (def && def.title) return def.title;
    var titles = (metrics || []).map(titleOf).filter(Boolean);
    if (titles.length < 2) return titles[0] || '';
    var others = titles.slice(1).map(function (title) { return title.split(' ').filter(Boolean); });
    var shared = titles[0].split(' ').filter(Boolean).map(function (word) {
      var forms = [word];
      var everywhere = others.every(function (words) {
        var match = words.filter(function (w) { return stem(w) === stem(word); })[0];
        if (match) forms.push(match);
        return !!match;
      });
      if (!everywhere) return null;
      return forms.reduce(function (longest, form) { return form.length > longest.length ? form : longest; }, '');
    }).filter(Boolean);
    return shared.length ? shared.join(' ') : titles[0];
  }

  return {
    compositeTitle: compositeTitle,
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
