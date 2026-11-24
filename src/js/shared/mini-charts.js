/**
 * Mini charts: the small marks inside dashboard tiles (sparkline, bars, goal
 * ring) plus the count-up on a tile's number.
 *
 * Shared chart module for tile-sized charts. It takes models from
 * metric-card-view.js and returns SVG/HTML strings. Colours come from the
 * same Lex chart tokens the Reports charts use (--lex-chart-color-*,
 * --lex-status-*; see visualizations/chart-theme.js), so light and dark match.
 * Every size is an SVG attribute in a 0 to 100 box; CSS sizes the box and
 * runs the short ease-out entrance (css/shared/mini-charts.css), which
 * Reduce Motion turns off. No inline styles, no regex.
 */
(function (root, factory) {
  var view = (root && root.MetricCardView)
    || (typeof require === 'function' ? require('./metric-card-view.js') : null);
  var api = factory(view);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MiniCharts = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (MetricCardView) {
  'use strict';

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .split('&').join('&amp;')
      .split('<').join('&lt;')
      .split('>').join('&gt;')
      .split('"').join('&quot;')
      .split("'").join('&#39;');
  }

  // ── Sparkline ─────────────────────────────────────────────────
  // line: MetricCardView.sparkline(snapshots, 100, 24)
  var gradientCount = 0;

  function sparklineSvg(line) {
    if (!line || !line.points) return '';
    gradientCount += 1;
    var id = 'mini-spark-fade-' + gradientCount;
    return '<svg class="mini-spark mini-spark--' + escapeHtml(line.trend) + '" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true" focusable="false">'
      + '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">'
      + '<stop class="mini-spark__stop" offset="0"></stop><stop class="mini-spark__stop mini-spark__stop--end" offset="1"></stop>'
      + '</linearGradient></defs>'
      + '<polygon class="mini-spark__area" fill="url(#' + id + ')" points="' + escapeHtml(line.points + ' 100,24 0,24') + '"></polygon>'
      + '<polyline class="mini-spark__line" pathLength="100" points="' + escapeHtml(line.points) + '" vector-effect="non-scaling-stroke"></polyline>'
      + '</svg>';
  }

  // ── Bars ──────────────────────────────────────────────────────
  // model: MetricCardView.listBars(card.value); formatValue(number|null) -> text
  function barsHtml(model, formatValue) {
    if (!model || model.empty) return '';
    var format = typeof formatValue === 'function' ? formatValue : function (n) { return String(n); };
    var height = model.paired ? 14 : 6;
    var legend = model.paired
      ? '<div class="mini-bars__legend" aria-hidden="true">'
        + '<span class="mini-bars__key">' + escapeHtml(model.seriesLabels[0]) + '</span>'
        + '<span class="mini-bars__key mini-bars__key--second">' + escapeHtml(model.seriesLabels[1]) + '</span>'
        + '</div>'
      : '';
    var rows = model.rows.map(function (row) {
      var valueText = row.second !== null
        ? format(row.value) + ' of ' + format(row.second)
        : format(row.value);
      var bars = '<rect class="mini-bars__fill" x="0" y="0" width="' + row.pct + '" height="6"></rect>';
      if (row.second !== null) {
        bars += '<rect class="mini-bars__fill mini-bars__fill--second" x="0" y="8" width="' + row.secondPct + '" height="6"></rect>';
      }
      return '<li class="mini-bars__row">'
        + '<div class="mini-bars__head"><span class="mini-bars__label">' + escapeHtml(row.label) + '</span>'
        + '<span class="mini-bars__value">' + escapeHtml(valueText) + '</span></div>'
        + '<svg class="mini-bars__track' + (model.paired ? ' mini-bars__track--paired' : '') + '" viewBox="0 0 100 ' + height + '" preserveAspectRatio="none" aria-hidden="true" focusable="false">'
        + bars + '</svg></li>';
    }).join('');
    var more = model.hiddenCount > 0
      ? '<p class="mini-bars__more">And ' + model.hiddenCount + ' more in the details</p>'
      : '';
    return '<div class="mini-bars' + (model.paired ? ' mini-bars--paired' : '') + '">' + legend
      + '<ul class="mini-bars__list">' + rows + '</ul>' + more + '</div>';
  }

  // ── Columns ───────────────────────────────────────────────────
  // A breakdown of up to COLUMN_LIMIT rows as rounded columns in a 300 x 120
  // box (value above each column, a short label below, light gridlines).
  // More rows than that read better as horizontal bars.
  var COLUMN_LIMIT = 12;
  var BOX_W = 300;
  var PLOT_TOP = 14;
  var PLOT_BOTTOM = 100;
  var PLOT_H = PLOT_BOTTOM - PLOT_TOP;

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function shortLabel(text, maxChars) {
    var label = String(text);
    return label.length > maxChars ? label.substring(0, Math.max(1, maxChars - 3)) + '...' : label;
  }

  function legendHtml(model) {
    return model.paired
      ? '<div class="mini-bars__legend" aria-hidden="true">'
        + '<span class="mini-bars__key">' + escapeHtml(model.seriesLabels[0]) + '</span>'
        + '<span class="mini-bars__key mini-bars__key--second">' + escapeHtml(model.seriesLabels[1]) + '</span>'
        + '</div>'
      : '';
  }

  function column(cls, x, width, pct) {
    var height = round1((pct / 100) * PLOT_H);
    if (height <= 0) return '';
    var radius = round1(Math.min(6, width / 2, height));
    return '<rect class="' + cls + '" x="' + round1(x) + '" y="' + round1(PLOT_BOTTOM - height) + '" width="' + round1(width)
      + '" height="' + height + '" rx="' + radius + '"></rect>';
  }

  function columnsHtml(model, format) {
    var n = model.rows.length;
    var slot = BOX_W / n;
    var maxChars = Math.max(4, Math.floor(slot / 4.8));
    var grid = '<g class="mini-cols__grid">'
      + '<line x1="0" x2="' + BOX_W + '" y1="' + PLOT_TOP + '" y2="' + PLOT_TOP + '"></line>'
      + '<line x1="0" x2="' + BOX_W + '" y1="' + (PLOT_TOP + PLOT_H / 2) + '" y2="' + (PLOT_TOP + PLOT_H / 2) + '"></line>'
      + '<line class="mini-cols__base" x1="0" x2="' + BOX_W + '" y1="' + PLOT_BOTTOM + '" y2="' + PLOT_BOTTOM + '"></line>'
      + '</g>';
    var groups = model.rows.map(function (row, i) {
      var center = slot * (i + 0.5);
      var hasSecond = row.second !== null;
      var bars;
      var valueText = hasSecond ? format(row.value) + ' of ' + format(row.second) : format(row.value);
      var top = Math.max(row.pct, hasSecond ? row.secondPct : 0);
      if (hasSecond) {
        var w = Math.min(slot * 0.3, 22);
        bars = column('mini-cols__bar', center - w - 1.5, w, row.pct)
          + column('mini-cols__bar mini-cols__bar--second', center + 1.5, w, row.secondPct);
      } else {
        var width = Math.min(slot * 0.5, 36);
        bars = column('mini-cols__bar', center - width / 2, width, row.pct);
      }
      var valueY = round1(PLOT_BOTTOM - (top / 100) * PLOT_H - 4);
      return '<g class="mini-cols__group"><title>' + escapeHtml(row.label + ': ' + valueText) + '</title>'
        + bars
        + '<text class="mini-cols__value" x="' + round1(center) + '" y="' + valueY + '" text-anchor="middle">' + escapeHtml(format(row.value)) + '</text>'
        + '<text class="mini-cols__label" x="' + round1(center) + '" y="114" text-anchor="middle">' + escapeHtml(shortLabel(row.label, maxChars)) + '</text>'
        + '</g>';
    }).join('');
    return '<div class="mini-cols">' + legendHtml(model)
      + '<svg class="mini-cols__svg" viewBox="0 0 ' + BOX_W + ' 120" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Breakdown chart" focusable="false">'
      + grid + groups + '</svg></div>';
  }

  /**
   * A list breakdown: columns for up to 12 rows, horizontal bars beyond.
   * model: MetricCardView.listBars(card.value, 12)
   */
  function breakdownHtml(model, formatValue) {
    if (!model || model.empty) return '';
    var format = typeof formatValue === 'function' ? formatValue : function (n) { return String(n); };
    if (model.hiddenCount > 0 || model.rows.length > COLUMN_LIMIT) return barsHtml(model, format);
    return columnsHtml(model, format);
  }

  // ── Delta chip ────────────────────────────────────────────────
  // arrow: MetricCardView.comparisonArrow(card.comparison)
  function deltaChip(arrow, words) {
    if (!arrow) return '';
    var icon = arrow.direction === 'flat' ? ''
      : '<svg class="mini-delta__arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        + (arrow.direction === 'up' ? '<path d="M12 19V5M5 12l7-7 7 7"/>' : '<path d="M12 5v14M5 12l7 7 7-7"/>') + '</svg>';
    return '<div class="mini-delta-row">'
      + '<span class="mini-delta mini-delta--' + escapeHtml(arrow.direction) + '" title="' + escapeHtml(arrow.spoken) + '">' + icon + escapeHtml(arrow.text) + '</span>'
      + (words ? '<span class="mini-delta__words">' + escapeHtml(words) + '</span>' : '')
      + '</div>';
  }

  // ── Goal ring ─────────────────────────────────────────────────
  // progress: MetricCardView.goalProgress(card.goal); text: { value, target }
  function ringHtml(progress, text) {
    if (!progress || !progress.available) return '';
    var labels = text || {};
    var offset = Math.round((100 - progress.fillPct) * 10) / 10;
    var pace = progress.paceMarkerPct === null ? ''
      : '<line class="mini-ring__pace" x1="18" y1="0.6" x2="18" y2="5.4" transform="rotate('
        + (Math.round(progress.paceMarkerPct * 36) / 10) + ' 18 18)"></line>';
    var chip = progress.paceLabel
      ? '<span class="mini-ring__chip mini-ring__chip--' + escapeHtml(progress.paceStatus) + '">' + escapeHtml(progress.paceLabel) + '</span>'
      : '';
    return '<div class="mini-ring mini-ring--' + escapeHtml(progress.band) + '">'
      + '<div class="mini-ring__dial">'
      + '<svg class="mini-ring__svg" viewBox="0 0 36 36" aria-hidden="true" focusable="false">'
      + '<circle class="mini-ring__track" cx="18" cy="18" r="15" pathLength="100"></circle>'
      + '<circle class="mini-ring__fill" cx="18" cy="18" r="15" pathLength="100" stroke-dasharray="100" stroke-dashoffset="' + offset + '" transform="rotate(-90 18 18)"></circle>'
      + pace
      + '</svg>'
      + '<span class="mini-ring__pct">' + escapeHtml(progress.attainmentLabel || '') + '</span>'
      + '</div>'
      + '<div class="mini-ring__text">'
      + '<strong class="mini-ring__value">' + escapeHtml(labels.value || '') + '</strong>'
      + (labels.target ? '<span class="mini-ring__target">of ' + escapeHtml(labels.target) + '</span>' : '')
      + '<span class="mini-ring__status">' + escapeHtml(progress.statusLabel) + chip + '</span>'
      + '</div>'
      + '</div>';
  }

  // ── Count-up ──────────────────────────────────────────────────
  function prefersReducedMotion() {
    return typeof window !== 'undefined' && !!window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * Counts el's text up from 0 to finalText, keeping its prefix, suffix,
   * decimals and grouping. Reduce Motion (or text with no number) sets the
   * final text at once. options.from is the text shown before (a period
   * change counts from the old number when it is in the same unit).
   * options: { from, duration, reduceMotion, raf, now } (the last three are
   * for tests).
   */
  function countUp(el, finalText, options) {
    if (!el) return;
    var opts = options || {};
    var reduce = opts.reduceMotion !== undefined ? opts.reduceMotion : prefersReducedMotion();
    var parts = MetricCardView.splitFormatted(String(finalText === null || finalText === undefined ? '' : finalText));
    var raf = opts.raf || (typeof window !== 'undefined' && window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : null);
    if (reduce || !parts || !raf) {
      el.textContent = finalText;
      return;
    }
    var now = opts.now || function () { return Date.now(); };
    var duration = opts.duration || 600;
    var before = opts.from ? MetricCardView.splitFormatted(String(opts.from)) : null;
    var start = before && before.prefix === parts.prefix && before.suffix === parts.suffix ? before.number : 0;
    if (start === parts.number) {
      el.textContent = finalText;
      return;
    }
    var started = now();
    el.textContent = MetricCardView.formatTween(parts, start);
    function frame() {
      var t = (now() - started) / duration;
      if (t >= 1) {
        el.textContent = finalText;
        return;
      }
      el.textContent = MetricCardView.formatTween(parts, start + (parts.number - start) * MetricCardView.easeOut(t));
      raf(frame);
    }
    raf(frame);
  }

  return {
    sparklineSvg: sparklineSvg,
    barsHtml: barsHtml,
    breakdownHtml: breakdownHtml,
    deltaChip: deltaChip,
    ringHtml: ringHtml,
    countUp: countUp,
    prefersReducedMotion: prefersReducedMotion,
  };
});
