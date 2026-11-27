/**
 * Card visuals (pure, no DOM).
 *
 * The 15-visual vocabulary for declared dashboard cards. A saved card names
 * its visual (card.visual); without one the card's kind decides, so the
 * server can add visuals later without breaking anything. This module maps
 * data to each visual's geometry and labels, and picks the fallback when a
 * card's rows cannot carry its visual (no dates for a timeline, no ages for
 * aging). Drawing lives in mini-charts.js. Never keyed by metric_key.
 * No regex (per Lex rules).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CardVisuals = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var VOCABULARY = ['hero', 'stat', 'gauge', 'ring', 'bullet', 'columns', 'ranked_bars', 'paired_columns', 'donut',
    'stacked_bar', 'funnel', 'compare', 'worklist', 'timeline', 'aging'];
  var BY_KIND = { headline: 'hero', number: 'stat', goal: 'ring', breakdown: 'columns', pair: 'compare', worklist: 'worklist' };
  var MS_PER_DAY = 86400000;
  var TIMELINE_DAYS = 14;
  var AGING_BUCKETS = [
    { label: '0 to 30 days', max: 30 }, { label: '31 to 60 days', max: 60 },
    { label: '61 to 90 days', max: 90 }, { label: 'Over 90 days', max: Infinity },
  ];

  function toNumber(value) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    var n = Number(value);
    return isFinite(n) ? n : null;
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function clamp(n, low, high) {
    return Math.min(high, Math.max(low, n));
  }

  function visualFor(def) {
    if (def && VOCABULARY.indexOf(def.visual) !== -1) return def.visual;
    if (def && def.kind === 'group') return def.chart === 'funnel' ? 'funnel' : 'ranked_bars';
    return (def && BY_KIND[def.kind]) || 'stat';
  }

  function endsWith(text, tail) {
    return text.length >= tail.length && text.slice(-tail.length) === tail;
  }

  function hasValue(rows, key) {
    return rows.some(function (row) { return row && row[key] !== null && row[key] !== undefined && row[key] !== ''; });
  }

  function keysOf(rows) {
    var keys = [];
    rows.forEach(function (row) {
      Object.keys(row || {}).forEach(function (key) { if (keys.indexOf(key) === -1) keys.push(key); });
    });
    return keys;
  }

  // The first field that names a date: ends in _at, _date, date, scheduled or hearing.
  function dateField(rows) {
    var list = Array.isArray(rows) ? rows : [];
    var keys = keysOf(list);
    for (var i = 0; i < keys.length; i += 1) {
      var k = keys[i].toLowerCase();
      var named = endsWith(k, '_at') || endsWith(k, 'date') || endsWith(k, 'scheduled') || endsWith(k, 'hearing');
      if (named && hasValue(list, keys[i])) return keys[i];
    }
    return null;
  }

  // A numeric field that holds an age in days.
  function ageField(rows) {
    var list = Array.isArray(rows) ? rows : [];
    var keys = keysOf(list);
    for (var i = 0; i < keys.length; i += 1) {
      var k = keys[i].toLowerCase();
      if ((k.indexOf('days') !== -1 || k === 'age' || endsWith(k, '_age')) && list.some(function (row) { return toNumber(row && row[keys[i]]) !== null; })) {
        return keys[i];
      }
    }
    return null;
  }

  function dayNumber(value) {
    if (!value) return null;
    var text = String(value).substring(0, 10);
    var time = Date.parse(text + 'T00:00:00Z');
    return isFinite(time) ? Math.floor(time / MS_PER_DAY) : null;
  }

  function rowLabel(row) {
    var keys = ['name', 'title', 'label', 'matter_name', 'client_name', 'type', 'meeting_type', 'event_type'];
    for (var i = 0; i < keys.length; i += 1) {
      if (row && row[keys[i]]) return String(row[keys[i]]);
    }
    return 'Item';
  }

  function timelineModel(rows, field, today) {
    var start = dayNumber(today);
    var dots = [];
    rows.forEach(function (row) {
      var day = dayNumber(row[field]);
      if (day === null || start === null) return;
      var index = day - start;
      if (index < 0 || index >= TIMELINE_DAYS) return;
      dots.push({ dayIndex: index, pct: round1(((index + 0.5) / TIMELINE_DAYS) * 100), label: rowLabel(row), row: row });
    });
    dots.sort(function (a, b) { return a.dayIndex - b.dayIndex; });
    return dots.length ? { days: TIMELINE_DAYS, dots: dots, field: field } : null;
  }

  function agingModel(rows, today) {
    var field = ageField(rows);
    var dated = field ? null : dateField(rows);
    if (!field && !dated) return null;
    var start = dayNumber(today);
    var counts = AGING_BUCKETS.map(function () { return 0; });
    var total = 0;
    rows.forEach(function (row) {
      var age = field ? toNumber(row[field]) : (dayNumber(row[dated]) === null || start === null ? null : start - dayNumber(row[dated]));
      if (age === null || age < 0) return;
      for (var i = 0; i < AGING_BUCKETS.length; i += 1) {
        if (age <= AGING_BUCKETS[i].max) { counts[i] += 1; total += 1; break; }
      }
    });
    if (!total) return null;
    var max = Math.max.apply(null, counts);
    return {
      total: total,
      buckets: AGING_BUCKETS.map(function (bucket, i) {
        return { label: bucket.label, count: counts[i], pct: max ? round1((counts[i] / max) * 100) : 0 };
      }),
    };
  }

  /** { visual, model, sort? }: the visual a rows-based card can draw, or its fallback. */
  function chooseRowsVisual(visual, rows, fallback, today) {
    var list = Array.isArray(rows) ? rows : [];
    var other = fallback && VOCABULARY.indexOf(fallback) !== -1 ? fallback : 'worklist';
    if (visual === 'timeline') {
      var field = dateField(list);
      var timeline = field ? timelineModel(list, field, today) : null;
      return timeline ? { visual: 'timeline', model: timeline } : { visual: other, model: null };
    }
    if (visual === 'aging') {
      var aging = agingModel(list, today);
      return aging ? { visual: 'aging', model: aging } : { visual: other, model: null, sort: 'oldest_first' };
    }
    return { visual: visual, model: null };
  }

  function gaugeModel(value) {
    var n = toNumber(value);
    if (n === null) return null;
    var pct = round1(clamp(n, 0, 100));
    return { pct: pct, angle: round1(-90 + pct * 1.8) };
  }

  function donutModel(rows) {
    var parts = (rows || []).filter(function (row) { return toNumber(row.value) !== null && toNumber(row.value) > 0; });
    var total = parts.reduce(function (sum, row) { return sum + toNumber(row.value); }, 0);
    if (!(total > 0)) return null;
    var offset = 0;
    return {
      total: total,
      slices: parts.map(function (row) {
        var pct = round1((toNumber(row.value) / total) * 100);
        var slice = { label: row.label, value: toNumber(row.value), key: row.key || null, pct: pct, offset: round1(offset) };
        offset += pct;
        return slice;
      }),
    };
  }

  function rankedModel(rows) {
    var list = (rows || []).slice();
    var max = 0;
    list.forEach(function (row) { var n = toNumber(row.value); if (n !== null && n > max) max = n; });
    list.sort(function (a, b) {
      var av = a.waiting ? -Infinity : (toNumber(a.value) === null ? -Infinity : toNumber(a.value));
      var bv = b.waiting ? -Infinity : (toNumber(b.value) === null ? -Infinity : toNumber(b.value));
      return bv - av;
    });
    return list.map(function (row) {
      var n = toNumber(row.value);
      return Object.assign({}, row, { pct: !row.waiting && n !== null && n > 0 && max > 0 ? round1((n / max) * 100) : 0 });
    });
  }

  function stackedModel(rows) {
    var model = donutModel(rows);
    if (!model) return null;
    return { total: model.total, parts: model.slices };
  }

  function bulletModel(actual, goal) {
    var a = toNumber(actual);
    var g = toNumber(goal);
    if (a === null || g === null || g <= 0) return null;
    var scale = Math.max(a, g);
    return { actualPct: round1((a / scale) * 100), goalPct: round1((g / scale) * 100), gap: round1(g - a), over: a >= g };
  }

  // The same generic row label as list cards (MetricCardView.rowLabel).
  function listLabel(row) {
    var view = (typeof window !== 'undefined' && window.MetricCardView)
      || (typeof require === 'function' ? require('./metric-card-view.js') : null);
    if (view && typeof view.rowLabel === 'function') return view.rowLabel(row, 0);
    var keys = ['service_label', 'label', 'name', 'title', 'service_key', 'key'];
    for (var i = 0; i < keys.length; i += 1) {
      if (row && row[keys[i]] !== null && row[keys[i]] !== undefined && row[keys[i]] !== '') return String(row[keys[i]]);
    }
    return '';
  }

  // Two lists side by side (new and closed by service offering), paired by
  // service_key when the rows carry it, otherwise by label.
  function pairKey(row) {
    return row && row.service_key ? 'key:' + row.service_key : 'label:' + listLabel(row);
  }

  function pairedSeries(first, second) {
    var rows = [];
    var at = {};
    (first || []).forEach(function (row) {
      at[pairKey(row)] = rows.length;
      rows.push({ label: listLabel(row), value: toNumber(row && row.value), second: null });
      if (row && row.partial === true) rows[rows.length - 1].partial = true;
    });
    (second || []).forEach(function (row) {
      var key = pairKey(row);
      if (at[key] === undefined) { at[key] = rows.length; rows.push({ label: listLabel(row), value: null, second: null }); }
      rows[at[key]].second = toNumber(row && row.value);
      // A bucket the picked dates cut short on either side is partial.
      if (row && row.partial === true) rows[at[key]].partial = true;
    });
    return rows;
  }

  function compareModel(first, second) {
    var a = toNumber(first);
    var b = toNumber(second);
    return { ratioPct: a !== null && a > 0 && b !== null ? round1(clamp((b / a) * 100, 0, 100)) : null };
  }

  function sortRows(rows, sort) {
    var list = (rows || []).slice();
    if (sort !== 'oldest_first' && sort !== 'oldest_due_first') return list;
    var field = dateField(list);
    if (!field) return list;
    return list.map(function (row, i) { return { row: row, i: i, day: dayNumber(row[field]) }; })
      .sort(function (x, y) {
        if (x.day === null && y.day === null) return x.i - y.i;
        if (x.day === null) return 1;
        if (y.day === null) return -1;
        return x.day - y.day || x.i - y.i;
      })
      .map(function (entry) { return entry.row; });
  }

  function initials(label) {
    var words = String(label || '').trim().split(' ').filter(Boolean);
    if (!words.length) return '';
    if (words.length === 1) return words[0].charAt(0).toUpperCase();
    return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
  }

  // Visual options that name more metrics; the card request asks for them too.
  function extraKeys(raw) {
    var keys = [];
    ['detail', 'chips', 'metric_keys_override', 'headline_keys'].forEach(function (field) {
      if (raw && Array.isArray(raw[field])) keys = keys.concat(raw[field]);
    });
    ['centre_key', 'badge_key'].forEach(function (field) {
      if (raw && raw[field]) keys.push(raw[field]);
    });
    return keys.filter(Boolean).map(String);
  }

  // Drop the words every label starts or ends with ("Upcoming ... Meetings"),
  // so the bars of one card read apart. Never leaves a label empty.
  function shortLabels(labels) {
    var list = (labels || []).map(function (label) { return String(label || '').split(' ').filter(Boolean); });
    if (list.length < 2) return (labels || []).map(String);
    var shortest = Math.min.apply(null, list.map(function (words) { return words.length; }));
    var lead = 0;
    while (lead < shortest - 1 && list.every(function (words) { return words[lead].toLowerCase() === list[0][lead].toLowerCase(); })) lead += 1;
    var tail = 0;
    while (tail < shortest - 1 - lead && list.every(function (words) {
      return words[words.length - 1 - tail].toLowerCase() === list[0][list[0].length - 1 - tail].toLowerCase();
    })) tail += 1;
    return list.map(function (words, i) {
      var kept = words.slice(lead, words.length - tail);
      return kept.length ? kept.join(' ') : String(labels[i]);
    });
  }

  return {
    shortLabels: shortLabels,
    VOCABULARY: VOCABULARY,
    visualFor: visualFor,
    dateField: dateField,
    ageField: ageField,
    chooseRowsVisual: chooseRowsVisual,
    gaugeModel: gaugeModel,
    donutModel: donutModel,
    rankedModel: rankedModel,
    stackedModel: stackedModel,
    bulletModel: bulletModel,
    pairedSeries: pairedSeries,
    compareModel: compareModel,
    sortRows: sortRows,
    initials: initials,
    extraKeys: extraKeys,
  };
});
