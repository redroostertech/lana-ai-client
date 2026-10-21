/**
 * predictions-tables.js
 * The Case Duration Predictions table on insights/predictions.html, as a
 * client-side lex-table built by LanaRecordTableKit (docs/TABLE-STANDARD.md).
 *
 * The data source is unchanged: Insights.getPredictions() (js/insights.js)
 * still returns an empty stub (its API call and demo data are commented out),
 * so the table shows its empty state until that endpoint exists. A
 * prediction has no creation time, so the table has no Created column.
 *
 * Public API (window.LanaPredictionsTables, or module.exports in Node):
 *   - caseDurationRow(prediction, index)  -> row (raw values)
 *   - CONFIDENCE_RANGES
 *   - caseDurationSpec()                  -> kit spec
 */

(function (global) {
  'use strict';

  function kit() {
    if (global && global.LanaRecordTableKit) return global.LanaRecordTableKit;
    if (typeof require === 'function') {
      try { return require('./record-table-kit.js'); } catch (_error) { return null; }
    }
    return null;
  }

  // Confidence is stored as a 0-1 fraction; rows hold it as a percentage.
  var CONFIDENCE_RANGES = [
    { value: 'high', label: '80% and above', min: 80, max: null },
    { value: 'medium', label: '60% – 79%', min: 60, max: 80 },
    { value: 'low', label: 'Under 60%', min: null, max: 60 }
  ];

  function caseDurationRow(prediction, index) {
    var p = prediction || {};
    var confidence = Number(p.confidence);
    return {
      id: p.matterId != null ? String(p.matterId) : 'prediction-' + index,
      matter: p.matterName || '',
      matter_id: p.matterId || '',
      estimated_completion: p.estimatedCompletion || '',
      confidence: Number.isFinite(confidence) ? Math.round(confidence * 1000) / 10 : null,
      factors: Array.isArray(p.factors) ? p.factors.filter(Boolean).map(String) : [],
      _raw: p
    };
  }

  function factorOptions(rows) {
    var seen = {};
    var options = [];
    (rows || []).forEach(function (row) {
      (row.factors || []).forEach(function (factor) {
        if (seen[factor]) return;
        seen[factor] = true;
        options.push({ value: factor, label: factor.charAt(0).toUpperCase() + factor.slice(1) });
      });
    });
    return options.sort(function (a, b) { return a.label.localeCompare(b.label); });
  }

  function caseDurationSpec(rows) {
    var k = kit();
    return {
      id: 'caseDurationTable',
      title: 'Predictions',
      noun: ['prediction', 'predictions'],
      ariaLabel: 'Case duration predictions',
      light: true,
      searchPlaceholder: 'Search matters...',
      emptyText: 'No case duration predictions available',
      sortBy: 'estimated_completion',
      sortDir: 'asc',
      minWidth: 760,
      searchKeys: 'matter',
      columns: [
        { key: 'matter', label: 'Matter', kind: 'matter', matterKey: 'matter_id' },
        { key: 'estimated_completion', label: 'Est. completion', kind: 'date', width: '150px' },
        {
          key: 'confidence', label: 'Confidence', kind: 'percent', width: '150px', ranges: CONFIDENCE_RANGES,
          render: function (value) {
            if (value === null || value === undefined) return k ? k.muted('') : '—';
            var width = Math.max(0, Math.min(100, Number(value)));
            return '<span class="flex items-center gap-2"><span class="w-16 h-2 bg-gray-200 rounded-full inline-block">' +
              '<span class="h-full bg-purple-500 rounded-full block" style="width: ' + width + '%"></span></span>' +
              '<span class="rtk-num text-xs">' + Math.round(width) + '%</span></span>';
          }
        },
        {
          key: 'factors', label: 'Factors', kind: 'html', width: '34%', sortable: false,
          render: function (value) {
            var factors = Array.isArray(value) ? value : [];
            if (!factors.length) return k ? k.muted('') : '—';
            return '<span class="flex flex-wrap gap-1">' + factors.map(function (f) {
              return '<span class="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">' + (k ? k.esc(f) : f) + '</span>';
            }).join('') + '</span>';
          },
          filter: {
            options: factorOptions(rows),
            match: function (cell, values) {
              var list = Array.isArray(cell) ? cell : [];
              return values.some(function (v) { return list.indexOf(v) !== -1; });
            }
          }
        }
      ]
    };
  }

  var moduleApi = {
    CONFIDENCE_RANGES: CONFIDENCE_RANGES,
    caseDurationRow: caseDurationRow,
    factorOptions: factorOptions,
    caseDurationSpec: caseDurationSpec
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.LanaPredictionsTables = moduleApi;
  }
})(typeof window !== 'undefined' ? window : globalThis);
