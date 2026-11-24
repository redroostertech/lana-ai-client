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
  function sparklineSvg(line) {
    if (!line || !line.points) return '';
    return '<svg class="mini-spark mini-spark--' + escapeHtml(line.trend) + '" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true" focusable="false">'
      + '<polygon class="mini-spark__area" points="' + escapeHtml(line.points + ' 100,24 0,24') + '"></polygon>'
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
      var valueText = model.paired
        ? format(row.value) + ' of ' + format(row.second)
        : format(row.value);
      var bars = '<rect class="mini-bars__fill" x="0" y="0" width="' + row.pct + '" height="6"></rect>';
      if (model.paired) {
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
    ringHtml: ringHtml,
    countUp: countUp,
    prefersReducedMotion: prefersReducedMotion,
  };
});
