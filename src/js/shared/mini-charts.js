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
      // The server's words instead of a number: no bar.
      if (row.valueLabel) {
        return '<li class="mini-bars__row mini-bars__row--note">'
          + '<div class="mini-bars__head"><span class="mini-bars__label">' + escapeHtml(row.label) + '</span>'
          + '<span class="mini-bars__value mini-bars__value--note">' + escapeHtml(row.valueLabel) + '</span></div></li>';
      }
      var valueText = row.second !== null
        ? format(row.value) + ' of ' + format(row.second)
        : format(row.value);
      // A bucket the picked dates cut short: a lighter bar and "(partial)".
      var partialCls = row.partial ? ' mini-bars__fill--partial' : '';
      var bars = '<rect class="mini-bars__fill' + partialCls + '" x="0" y="0" width="' + row.pct + '" height="6"></rect>';
      if (row.second !== null) {
        bars += '<rect class="mini-bars__fill mini-bars__fill--second' + partialCls + '" x="0" y="8" width="' + row.secondPct + '" height="6"></rect>';
      }
      return '<li class="mini-bars__row' + (row.partial ? ' mini-bars__row--partial' : '') + '"' + recordAttr(row.ref) + '>'
        + '<div class="mini-bars__head"><span class="mini-bars__label">' + escapeHtml(row.label)
        + (row.partial ? ' <span class="mini-bars__partial">(partial)</span>' : '') + '</span>'
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
  var SERIES_COLUMN_LIMIT = 62;
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
    if (model.grouped) {
      return '<div class="mini-bars__legend" aria-hidden="true">' + (model.seriesLabels || []).map(function (label, i) {
        return '<span class="mini-bars__key mini-bars__key--s' + i + '">' + escapeHtml(label) + '</span>';
      }).join('') + '</div>';
    }
    return model.paired
      ? '<div class="mini-bars__legend" aria-hidden="true">'
        + '<span class="mini-bars__key">' + escapeHtml(model.seriesLabels[0]) + '</span>'
        + '<span class="mini-bars__key mini-bars__key--second">' + escapeHtml(model.seriesLabels[1]) + '</span>'
        + '</div>'
      : '';
  }

  // A date tick on compact columns: "Oct 29, 2026" reads "Oct 29", never
  // cut with an ellipsis.
  function dayTick(label) {
    var text = String(label || '');
    var comma = text.indexOf(', ');
    return comma > 0 && comma <= 6 ? text.substring(0, comma) : text;
  }

  var MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  var MONTH_TICKS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function isYear(text) {
    return text.length === 4 && !isNaN(Number(text));
  }

  /**
   * A date axis tick, or null when the label is not a date: a month
   * ("October 2026", "Oct 2026", "2026-10") reads "Oct"; a day ("Oct 29,
   * 2026") reads "Oct 29". Never cut with an ellipsis.
   */
  function dateTick(label) {
    var text = String(label || '').trim();
    var dash = text.split('-');
    if (text.length === 7 && dash.length === 2 && isYear(dash[0])) {
      var n = Number(dash[1]);
      return n >= 1 && n <= 12 ? MONTH_TICKS[n - 1] : null;
    }
    var words = text.split(' ');
    var month = words.length ? MONTH_ABBR.indexOf(words[0].substring(0, 3).toLowerCase()) : -1;
    if (month === -1) return null;
    if (words.length === 2 && isYear(words[1])) return MONTH_TICKS[month];
    var comma = text.indexOf(', ');
    if (words.length === 3 && comma > 0 && comma <= 9 && isYear(words[2])) return text.substring(0, comma);
    return null;
  }

  function column(cls, x, width, pct) {
    var height = round1((pct / 100) * PLOT_H);
    if (height <= 0) return '';
    var radius = round1(Math.min(6, width / 2, height));
    return '<rect class="' + cls + '" x="' + round1(x) + '" y="' + round1(PLOT_BOTTOM - height) + '" width="' + round1(width)
      + '" height="' + height + '" rx="' + radius + '"></rect>';
  }

  // ── Axis ──────────────────────────────────────────────────────
  var AXIS_W = 40;
  var VALUE_CHAR_W = 5.2;
  var DOT = ' · ';

  function firmCurrency() {
    var utils = typeof window !== 'undefined' && window.Lex && window.Lex.Utils;
    var code = utils && typeof utils.getFirmCurrency === 'function' ? utils.getFirmCurrency() : '';
    return code ? String(code) : 'USD';
  }

  // A step of 1, 2, 2.5 or 5 times a power of ten: about three steps to the top.
  function niceStep(max) {
    var raw = max / 3;
    var power = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var steps = [1, 2, 2.5, 5, 10];
    for (var k = 0; k < steps.length; k += 1) {
      if (steps[k] * power >= raw) return steps[k] * power;
    }
    return 10 * power;
  }

  /** Ticks from 0 to the first step at or above max: [0, s, 2s, 3s(, 4s)]. */
  function axisTicks(max, wholeNumbers) {
    if (!(max > 0)) return [];
    var step = niceStep(max);
    if (wholeNumbers && step < 1) step = 1;
    var top = Math.ceil(max / step - 1e-9) * step;
    var out = [];
    for (var v = 0; v <= top + step / 1000; v += step) out.push(Math.round(v * 1000) / 1000);
    return out;
  }

  /**
   * A tick's words: money in short form ("$2M", "$500K"), percent, counts
   * ("1,000"), or a number with its unit ("20 days").
   */
  function axisTickText(value, kind) {
    var k = String(kind || 'number').toLowerCase();
    // The base reads "0" on every axis.
    if (value === 0) return '0';
    if (k === 'currency' || k === 'currency_breakdown') {
      try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: firmCurrency(), notation: 'compact', maximumFractionDigits: 1 }).format(value);
      } catch (_) {
        return firmCurrency() + ' ' + value;
      }
    }
    if (k === 'percent' || k === 'percentage') return round1(value) + '%';
    var number = value >= 100000
      ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
      : value.toLocaleString('en-US', { maximumFractionDigits: 1 });
    if (k === 'number' || k === 'integer' || k === 'count' || k === 'table') return number;
    return number + ' ' + k;
  }

  function dataMaxOf(rows) {
    var max = 0;
    var take = function (v) { var n = Number(v); if (v !== null && v !== undefined && isFinite(n) && n > max) max = n; };
    rows.forEach(function (row) {
      if (Array.isArray(row.values)) row.values.forEach(take);
      else { take(row.value); take(row.second); }
    });
    return max;
  }

  // The bars' own scale (pct of the largest bar) against the axis top.
  function axisScale(rows, axisTop) {
    var max = 0;
    var pctMax = 0;
    rows.forEach(function (row) {
      if (Array.isArray(row.values)) {
        row.values.forEach(function (v, k) { if (Number(v) > max) { max = Number(v); pctMax = (row.pcts || [])[k] || 0; } });
      } else {
        if (Number(row.value) > max) { max = Number(row.value); pctMax = row.pct; }
        if (row.second !== null && Number(row.second) > max) { max = Number(row.second); pctMax = row.secondPct; }
      }
    });
    // pct 100 stands for the largest value; the axis top may be higher.
    return max > 0 && pctMax > 0 && axisTop > 0 ? (max / axisTop) * (100 / pctMax) : 1;
  }

  // The tooltip words for a column: the full label, then its value(s).
  function tipText(row, model, format) {
    if (row.tip) return row.tip;
    var labels = model.seriesLabels || [];
    if (model.grouped && Array.isArray(row.values)) {
      return row.label + DOT + row.values.map(function (v, k) { return (labels[k] ? labels[k] + ' ' : '') + format(v); }).join(DOT);
    }
    if (row.valueLabel) return row.label + DOT + row.valueLabel;
    var name = row.label + (row.partial ? ' (partial)' : '');
    if (row.second !== null && row.second !== undefined) {
      if (labels.length > 1) return name + DOT + labels[0] + ' ' + format(row.value) + DOT + labels[1] + ' ' + format(row.second);
      return name + DOT + format(row.value) + ' of ' + format(row.second);
    }
    return name + DOT + (row.valueText !== undefined ? row.valueText : format(row.value));
  }

  // A column's hover and focus attributes; tabindex once only.
  function tipAttrs(text, link) {
    return ' data-tip="' + escapeHtml(text) + '" aria-label="' + escapeHtml(text) + '"' + (link.indexOf('tabindex') === -1 ? ' tabindex="0"' : '');
  }

  function columnsHtml(model, format, opts) {
    var linkFor = function (row) {
      if (row.ref) return recordAttr(row.ref);
      // A "Not mapped" column opens its own page (Settings > Mappings).
      if (row.linkHref) return ' data-metric-detail-link="' + escapeHtml(row.linkHref) + '"';
      return opts && typeof opts.href === 'function' && row.key ? ' data-metric-detail-link="' + escapeHtml(opts.href(row.key)) + '"' : '';
    };
    var n = model.rows.length;
    // The y axis: opts.axis names the value kind ('currency', 'number',
    // 'percent' or a unit such as 'days'); false turns it off.
    var axisKind = opts && opts.axis !== undefined ? opts.axis : 'number';
    var ticks = axisKind === false ? [] : axisTicks(dataMaxOf(model.rows), ['number', 'integer', 'count', 'table'].indexOf(String(axisKind)) !== -1);
    var axisOn = ticks.length > 1;
    var axisTop = axisOn ? ticks[ticks.length - 1] : 0;
    var scale = axisOn ? axisScale(model.rows, axisTop) : 1;
    var left = axisOn ? AXIS_W : 0;
    var slot = (BOX_W - left) / n;
    var maxChars = Math.max(4, Math.floor(slot / 4.8));
    // A long series over days: no value text over each column (the tooltip
    // keeps it), and a date label on every few columns only.
    var dense = n > COLUMN_LIMIT;
    // model.allLabels (month bars): each column's short tick (row.tick),
    // never cut; only when even those do not fit is every few shown.
    // More than 12 month bars use smaller ticks (mini-cols__svg--small-ticks).
    var smallTicks = !!model.allLabels && n > COLUMN_LIMIT;
    var TICK_CHAR_W = smallTicks ? 3.6 : 4.4;
    var sparseLabels = dense && !model.allLabels;
    var labelEvery = sparseLabels ? Math.ceil(n / 6) : 1;
    if (model.allLabels) {
      var widest = model.rows.reduce(function (w, row) { return Math.max(w, String(row.tick || row.label).length); }, 1);
      labelEvery = Math.max(1, Math.ceil((widest * TICK_CHAR_W + 1) / slot));
    }
    var yOf = function (v) { return round1(PLOT_BOTTOM - (v / axisTop) * PLOT_H); };
    var grid = axisOn
      ? '<g class="mini-cols__axis">'
        + ticks.map(function (t) {
          var y = yOf(t);
          return (t > 0 ? '<line class="mini-cols__gridline" x1="' + left + '" x2="' + BOX_W + '" y1="' + y + '" y2="' + y + '"></line>' : '')
            + '<text class="mini-cols__tick" x="' + (left - 4) + '" y="' + round1(y + 2.5) + '" text-anchor="end">' + escapeHtml(axisTickText(t, axisKind)) + '</text>';
        }).join('')
        + '<line class="mini-cols__yline" x1="' + left + '" x2="' + left + '" y1="' + PLOT_TOP + '" y2="' + PLOT_BOTTOM + '"></line>'
        + '<line class="mini-cols__baseline" x1="' + left + '" x2="' + BOX_W + '" y1="' + PLOT_BOTTOM + '" y2="' + PLOT_BOTTOM + '"></line>'
        + '</g>'
      : '<g class="mini-cols__grid">'
        + '<line class="mini-cols__baseline" x1="0" x2="' + BOX_W + '" y1="' + PLOT_BOTTOM + '" y2="' + PLOT_BOTTOM + '"></line>'
        + '</g>';
    var tickFor = function (row) {
      return model.allLabels ? String(row.tick || row.label) : (dateTick(row.label) || (sparseLabels ? dayTick(row.label) : shortLabel(row.label, maxChars)));
    };
    // An invisible column the full plot height: a 1 px bar can still be hovered.
    var hit = function (center) {
      return '<rect class="mini-cols__hit" x="' + round1(center - slot / 2) + '" y="' + (PLOT_TOP - 4) + '" width="' + round1(slot) + '" height="' + (PLOT_BOTTOM - PLOT_TOP + 4) + '"></rect>';
    };
    var groups = model.rows.map(function (row, i) {
      var center = left + slot * (i + 0.5);
      var link = linkFor(row);
      var attrs = link + tipAttrs(tipText(row, model, format), link);
      // Grouped columns: up to 3 series side by side.
      if (model.grouped && Array.isArray(row.values)) {
        var count = row.values.length;
        var bw = Math.min((slot * 0.8) / count, 14);
        var start = center - (count * bw + (count - 1) * 2) / 2;
        return '<g class="mini-cols__group"' + attrs + '>' + hit(center)
          + row.values.map(function (v, k) { return column('mini-cols__bar mini-cols__bar--s' + k, start + k * (bw + 2), bw, ((row.pcts || [])[k] || 0) * scale); }).join('')
          + '<text class="mini-cols__label" x="' + round1(center) + '" y="114" text-anchor="middle">' + escapeHtml(shortLabel(row.label, maxChars)) + '</text>'
          + '</g>';
      }
      // The server's words instead of a number ("Too few to rate"): no column.
      if (row.valueLabel) {
        return '<g class="mini-cols__group mini-cols__group--note"' + attrs + '>' + hit(center)
          + '<text class="mini-cols__value mini-cols__value--note" x="' + round1(center) + '" y="' + (PLOT_BOTTOM - 4) + '" text-anchor="middle">' + escapeHtml(shortLabel(row.valueLabel, maxChars)) + '</text>'
          + '<text class="mini-cols__label" x="' + round1(center) + '" y="114" text-anchor="middle">' + escapeHtml(shortLabel(row.label, maxChars)) + '</text>'
          + '</g>';
      }
      var hasSecond = row.second !== null && row.second !== undefined;
      var bars;
      var barCls = 'mini-cols__bar' + (row.partial ? ' mini-cols__bar--partial' : '');
      var pct = row.pct * scale;
      var secondPct = hasSecond ? row.secondPct * scale : 0;
      var top = Math.max(pct, secondPct);
      if (hasSecond) {
        var w = Math.min(slot * 0.3, 22);
        bars = column(barCls, center - w - 1.5, w, pct)
          + column(barCls + ' mini-cols__bar--second', center + 1.5, w, secondPct);
      } else {
        var width = Math.min(slot * 0.5, 36);
        bars = column(barCls, center - width / 2, width, pct);
      }
      var valueY = round1(PLOT_BOTTOM - (top / 100) * PLOT_H - 4);
      // The value over the column only when it fits its slot; hover keeps it.
      var shown = row.valueText !== undefined ? row.valueText : format(row.value === null && hasSecond ? row.second : row.value);
      var fits = !dense && String(shown).length * VALUE_CHAR_W <= slot;
      return '<g class="mini-cols__group' + (row.partial ? ' mini-cols__group--partial' : '') + (row.muted ? ' mini-cols__group--muted' : '') + '"' + attrs + '>'
        + hit(center)
        + bars
        + (fits ? '<text class="mini-cols__value" x="' + round1(center) + '" y="' + valueY + '" text-anchor="middle">' + escapeHtml(shown) + '</text>' : '')
        + (i % labelEvery === 0 ? '<text class="mini-cols__label" x="' + round1(center) + '" y="114" text-anchor="middle">' + escapeHtml(tickFor(row)) + '</text>' : '')
        + '</g>';
    }).join('');
    return '<div class="mini-cols">' + legendHtml(model)
      + '<svg class="mini-cols__svg' + (smallTicks ? ' mini-cols__svg--small-ticks' : '') + '" viewBox="0 0 ' + BOX_W + ' 120" preserveAspectRatio="xMidYMid meet" role="group" aria-label="Breakdown chart" focusable="false">'
      + grid + groups + '</svg></div>';
  }

  // ── Hover and focus tooltip ────────────────────────────────────
  // One small box per chart (.mini-tip) shows a column's data-tip on
  // hover or keyboard focus. Bound once per root (delegated).
  function bindTips(root) {
    if (!root || root._miniTipsBound || typeof root.addEventListener !== 'function') return;
    root._miniTipsBound = true;
    var targetOf = function (event) {
      return event.target && event.target.closest ? event.target.closest('[data-tip]') : null;
    };
    var tipFor = function (wrap) {
      var holder = wrap || root;
      var tip = holder.querySelector('.mini-tip');
      if (!tip) {
        tip = holder.ownerDocument.createElement('div');
        tip.className = 'mini-tip';
        tip.setAttribute('role', 'tooltip');
        tip.hidden = true;
        holder.appendChild(tip);
      }
      return tip;
    };
    var show = function (event) {
      var target = targetOf(event);
      if (!target) return;
      var wrap = target.closest('.mini-cols');
      var tip = tipFor(wrap);
      tip.textContent = target.getAttribute('data-tip');
      tip.hidden = false;
      if (wrap && typeof target.getBoundingClientRect === 'function') {
        var box = target.getBoundingClientRect();
        var frame = wrap.getBoundingClientRect();
        var width = tip.offsetWidth || 0;
        var x = box.left + box.width / 2 - frame.left;
        var half = width / 2;
        x = Math.max(half, Math.min(frame.width - half, x));
        tip.style.setProperty('--mini-tip-x', round1(x) + 'px');
        tip.style.setProperty('--mini-tip-y', round1(Math.max(0, box.top - frame.top)) + 'px');
      }
    };
    var hide = function (event) {
      var target = targetOf(event);
      if (!target) return;
      var wrap = target.closest('.mini-cols');
      var tip = (wrap || root).querySelector('.mini-tip');
      if (tip) tip.hidden = true;
    };
    root.addEventListener('mouseover', show);
    root.addEventListener('focusin', show);
    root.addEventListener('mouseout', hide);
    root.addEventListener('focusout', hide);
  }

  /**
   * A list breakdown: columns for up to 12 rows, horizontal bars beyond.
   * model: MetricCardView.listBars(card.value, 12)
   */
  function breakdownHtml(model, formatValue, opts) {
    if (!model || model.empty) return '';
    var format = typeof formatValue === 'function' ? formatValue : function (n) { return String(n); };
    if (model.grouped) return columnsHtml(model, format, opts);
    // A series over dates (model.series) stays columns up to two months of days.
    if (model.series && !model.hiddenCount && model.rows.length <= SERIES_COLUMN_LIMIT) return columnsHtml(model, format, opts);
    if (model.hiddenCount > 0 || model.rows.length > COLUMN_LIMIT) return barsHtml(model, format);
    return columnsHtml(model, format, opts);
  }

  // A row that is a data object (row.ref) opens the record panel
  // (js/shared/report-object-panel.js) instead of the metric.
  function recordAttr(ref) {
    if (!ref || !ref.object || ref.id === undefined || ref.id === null) return '';
    var value = [ref.object, ref.id, ref.user_id || ''].map(function (part) { return encodeURIComponent(String(part)); }).join('|');
    return ' data-record-ref="' + escapeHtml(value) + '" tabindex="0" role="button"';
  }

  function linkAttr(href) {
    return href ? ' data-metric-detail-link="' + escapeHtml(href) + '"' : '';
  }

  // Series colours cycle through the Lex chart tokens (mini-charts.css).
  function tone(i) {
    return (i % 8) + 1;
  }

  // ── Gauge: a semicircle dial for a percent ────────────────────
  // model: CardVisuals.gaugeModel(value); label: the formatted value.
  function gaugeHtml(model, label) {
    if (!model) return '';
    var arc = 'M10 50 A40 40 0 0 1 90 50';
    return '<div class="mini-gauge">'
      + '<svg class="mini-gauge__svg" viewBox="0 0 100 60" aria-hidden="true" focusable="false">'
      + '<path class="mini-gauge__track" d="' + arc + '" pathLength="100"></path>'
      + '<path class="mini-gauge__fill" d="' + arc + '" pathLength="100" stroke-dasharray="100" stroke-dashoffset="' + round1(100 - model.pct) + '"></path>'
      + '<g class="mini-gauge__needle"><line x1="50" y1="50" x2="50" y2="18" transform="rotate(' + model.angle + ' 50 50)"></line><circle cx="50" cy="50" r="3"></circle></g>'
      + '</svg>'
      + '<span class="mini-gauge__label">' + escapeHtml(label) + '</span>'
      + '</div>';
  }

  // ── Donut: share of the total ─────────────────────────────────
  // model: CardVisuals.donutModel(rows); opts: { centre, centreLabel, format(value), href(key) }.
  function donutHtml(model, opts) {
    if (!model) return '';
    var o = opts || {};
    var format = o.format || function (v) { return String(v); };
    var slices = model.slices.map(function (slice, i) {
      return '<circle class="mini-donut__slice mini-donut__slice--' + tone(i) + '" cx="21" cy="21" r="15.9155" pathLength="100"'
        + ' stroke-dasharray="' + slice.pct + ' ' + round1(100 - slice.pct) + '" stroke-dashoffset="' + (slice.offset ? -slice.offset : 0) + '"'
        + ' transform="rotate(-90 21 21)"' + linkAttr(slice.key && o.href ? o.href(slice.key) : '') + '><title>'
        + escapeHtml(slice.label + ': ' + format(slice.value) + ' (' + slice.pct + '%)') + '</title></circle>';
    }).join('');
    var legend = model.slices.map(function (slice, i) {
      return '<li class="mini-donut__item"><button type="button" class="mini-donut__key mini-donut__key--' + tone(i) + '"'
        + linkAttr(slice.key && o.href ? o.href(slice.key) : '') + '>' + escapeHtml(slice.label) + '</button>'
        + '<span class="mini-donut__value">' + escapeHtml(format(slice.value)) + '</span>'
        + '<span class="mini-donut__pct">' + escapeHtml(slice.pct + '%') + '</span></li>';
    }).join('');
    return '<div class="mini-donut">'
      + '<svg class="mini-donut__svg" viewBox="0 0 42 42" role="img" aria-label="Share of the total" focusable="false">'
      + '<circle class="mini-donut__hole" cx="21" cy="21" r="15.9155"></circle>' + slices
      + '<text class="mini-donut__centre" x="21" y="21" text-anchor="middle">' + escapeHtml(o.centre === undefined ? format(model.total) : o.centre) + '</text>'
      + '<text class="mini-donut__centre-label" x="21" y="26.5" text-anchor="middle">' + escapeHtml(o.centreLabel || 'Total') + '</text>'
      + '</svg><ul class="mini-donut__legend">' + legend + '</ul></div>';
  }

  // ── Ranked bars: a leaderboard ────────────────────────────────
  // rows: CardVisuals.rankedModel(rows); opts: { format(row), href(key), initials, waitingLabel(row) }.
  function rankedHtml(rows, opts) {
    if (!rows || !rows.length) return '';
    var o = opts || {};
    var items = rows.map(function (row) {
      var avatar = o.initials ? '<span class="mini-rank__avatar" aria-hidden="true">' + escapeHtml(initialsOf(row.label)) + '</span>' : '';
      var value = row.waiting
        ? '<span class="mini-group__waiting">' + escapeHtml(o.waitingLabel ? o.waitingLabel(row) : 'Waiting') + '</span>'
        : '<span class="mini-rank__value">' + escapeHtml(o.format ? o.format(row) : String(row.value)) + '</span>';
      return '<li class="mini-rank__row">' + avatar
        + '<div class="mini-rank__body"><div class="mini-rank__head">'
        + (row.ref
          ? '<button type="button" class="mini-rank__label"' + recordAttr(row.ref).split(' tabindex="0" role="button"').join('') + '>' + escapeHtml(row.label) + '</button>'
          : '<button type="button" class="mini-rank__label"' + linkAttr(row.key && o.href ? o.href(row.key) : '') + ' title="See the records">' + escapeHtml(row.label) + '</button>')
        // A role or status (row.status) as a muted suffix; initials come from the name only.
        + (row.status ? ' <span class="mini-rank__status">' + escapeHtml(row.status) + '</span>' : '')
        + value + '</div>'
        + (row.waiting ? '' : '<svg class="mini-rank__track" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect class="mini-rank__fill" x="0" y="0" width="' + row.pct + '" height="6"></rect></svg>')
        + '</div></li>';
    }).join('');
    return '<ol class="mini-rank">' + items + '</ol>';
  }

  function initialsOf(label) {
    var words = String(label || '').trim().split(' ').filter(Boolean);
    if (!words.length) return '';
    if (words.length === 1) return words[0].charAt(0).toUpperCase();
    return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
  }

  // ── Stacked bar: one bar split into its parts ─────────────────
  function stackedHtml(model, opts) {
    if (!model) return '';
    var o = opts || {};
    var format = o.format || function (v) { return String(v); };
    var rects = model.parts.map(function (part, i) {
      return '<rect class="mini-stack__part mini-stack__part--' + tone(i) + '" x="' + part.offset + '" y="0" width="' + part.pct + '" height="12"'
        + linkAttr(part.key && o.href ? o.href(part.key) : '') + '><title>' + escapeHtml(part.label + ': ' + format(part.value)) + '</title></rect>';
    }).join('');
    var legend = model.parts.map(function (part, i) {
      return '<li class="mini-stack__item"><button type="button" class="mini-donut__key mini-donut__key--' + tone(i) + '"'
        + linkAttr(part.key && o.href ? o.href(part.key) : '') + '>' + escapeHtml(part.label) + '</button>'
        + '<span class="mini-donut__value">' + escapeHtml(format(part.value)) + '</span>'
        + '<span class="mini-donut__pct">' + escapeHtml(Math.round(part.pct) + '%') + '</span></li>';
    }).join('');
    return '<div class="mini-stack"><svg class="mini-stack__svg" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true" focusable="false">'
      + rects + '</svg><ul class="mini-stack__legend">' + legend + '</ul></div>';
  }

  // ── Bullet: actual against a goal ─────────────────────────────
  // model: CardVisuals.bulletModel(actual, goal); text: { actual, goal, gap } formatted.
  function bulletHtml(model, text) {
    if (!model) return '';
    var t = text || {};
    return '<div class="mini-bullet' + (model.over ? ' mini-bullet--met' : '') + '">'
      + '<svg class="mini-bullet__svg" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true" focusable="false">'
      + '<rect class="mini-bullet__track" x="0" y="2" width="100" height="8"></rect>'
      + '<rect class="mini-bullet__fill" x="0" y="2" width="' + model.actualPct + '" height="8"></rect>'
      + '<line class="mini-bullet__goal" x1="' + model.goalPct + '" x2="' + model.goalPct + '" y1="0" y2="12" vector-effect="non-scaling-stroke"></line>'
      + '</svg>'
      + '<div class="mini-bullet__words"><span>' + escapeHtml(t.actual || '') + ' of ' + escapeHtml(t.goal || '') + '</span>'
      + '<strong>' + escapeHtml(model.over ? 'Goal met' : (t.gap || '') + ' to go') + '</strong></div>'
      + '</div>';
  }

  // ── Timeline: the next 14 days with a dot per item ────────────
  // model: CardVisuals.chooseRowsVisual('timeline', ...).model; opts: { href, dayLabel(i) }.
  function timelineHtml(model, opts) {
    if (!model || !model.dots.length) return '';
    var o = opts || {};
    var W = 280;
    var perDay = {};
    var ticks = '';
    for (var i = 0; i < model.days; i += 1) {
      var x = round1(((i + 0.5) / model.days) * W);
      ticks += '<line class="mini-timeline__tick" x1="' + x + '" x2="' + x + '" y1="30" y2="34"></line>';
      if (o.dayLabel && (i === 0 || i === 7 || i === model.days - 1)) {
        // The first and last labels hug the ends so they are never cut off.
        var anchor = i === 0 ? 'start' : (i === model.days - 1 ? 'end' : 'middle');
        var lx = i === 0 ? 0 : (i === model.days - 1 ? W : x);
        ticks += '<text class="mini-timeline__day" x="' + lx + '" y="46" text-anchor="' + anchor + '">' + escapeHtml(o.dayLabel(i)) + '</text>';
      }
    }
    var dots = model.dots.map(function (dot, n) {
      var stack = perDay[dot.dayIndex] || 0;
      perDay[dot.dayIndex] = stack + 1;
      return '<g class="mini-timeline__dot mini-timeline__dot--' + tone(n) + '"' + linkAttr(o.href) + '><title>' + escapeHtml(dot.label) + '</title>'
        + '<circle cx="' + round1((dot.pct / 100) * W) + '" cy="' + (22 - stack * 9) + '" r="4"></circle></g>';
    }).join('');
    return '<div class="mini-timeline"><svg class="mini-timeline__svg" viewBox="0 0 ' + W + ' 50" preserveAspectRatio="xMidYMid meet" role="img" aria-label="The next 14 days" focusable="false">'
      + '<line class="mini-timeline__axis" x1="0" x2="' + W + '" y1="30" y2="30"></line>' + ticks + dots + '</svg>'
      + '<p class="mini-timeline__count">' + escapeHtml(model.dots.length === 1 ? '1 in the next 14 days' : model.dots.length + ' in the next 14 days') + '</p></div>';
  }

  // ── Aging: records by age bucket ──────────────────────────────
  function agingHtml(model, opts) {
    if (!model) return '';
    var rows = model.buckets.map(function (bucket) {
      return { label: bucket.label, value: bucket.count, second: null, pct: bucket.pct, secondPct: null, key: 'records' };
    });
    var href = opts && opts.href;
    return columnsHtml({ rows: rows, paired: false, seriesLabels: [] }, function (n) { return String(n); },
      { href: function () { return href; } });
  }

  // ── Group (one bar per metric) and funnel ─────────────────────
  // rows: DashboardCards.groupRows(card, index). opts: { funnel, format(row),
  // href(key), waitingLabel(row) }. Every label opens that metric's records.
  function groupHtml(rows, opts) {
    if (!rows || !rows.length) return '';
    var o = opts || {};
    var funnel = !!o.funnel;
    var items = rows.map(function (row, i) {
      var step = funnel && row.conversionPct !== null && row.conversionPct !== undefined
        ? '<li class="mini-group__step" aria-hidden="false">' + escapeHtml(row.conversionPct + '% of the step before') + '</li>'
        : '';
      var value = row.waiting
        ? '<span class="mini-group__waiting">' + escapeHtml(o.waitingLabel ? o.waitingLabel(row) : 'Waiting') + '</span>'
        : '<span class="mini-group__value">' + escapeHtml(o.format ? o.format(row) : String(row.value)) + '</span>';
      var x = funnel ? round1((100 - row.pct) / 2) : 0;
      var bar = row.waiting ? ''
        : '<svg class="mini-group__track" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true" focusable="false">'
          + '<rect class="mini-group__fill" x="' + x + '" y="0" width="' + row.pct + '" height="8"></rect></svg>';
      return step + '<li class="mini-group__row' + (row.waiting ? ' mini-group__row--waiting' : '') + '">'
        + '<div class="mini-group__head">'
        + '<button type="button" class="mini-group__label" data-metric-detail-link="' + escapeHtml(o.href ? o.href(row.key) : '') + '" title="See the records">' + escapeHtml(row.label) + '</button>'
        + value + '</div>' + bar + '</li>';
    }).join('');
    return '<ul class="mini-group' + (funnel ? ' mini-group--funnel' : '') + '">' + items + '</ul>';
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
    columnsHtml: columnsHtml,
    bindTips: bindTips,
    axisTicks: axisTicks,
    axisTickText: axisTickText,
    dateTick: dateTick,
    gaugeHtml: gaugeHtml,
    donutHtml: donutHtml,
    rankedHtml: rankedHtml,
    stackedHtml: stackedHtml,
    bulletHtml: bulletHtml,
    timelineHtml: timelineHtml,
    agingHtml: agingHtml,
    groupHtml: groupHtml,
    deltaChip: deltaChip,
    ringHtml: ringHtml,
    countUp: countUp,
    prefersReducedMotion: prefersReducedMotion,
  };
});
