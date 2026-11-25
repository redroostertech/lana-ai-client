/* Report builder: the pure parts of making a saved report.
   Two paths. "From the metric catalog": pick a catalog metric and show its
   value (config.metric_keys) or the rows behind it (config.metric_rows, only
   for metrics the catalog marks has_rows). "Build your own": a custom report
   definition (config-driven tables), imported as today. The backend checks
   every catalog key; this module only shapes what the page sends and shows. */

(function (global) {
  'use strict';

  var KINDS = { value: 'value', rows: 'rows' };
  // Formats the results table knows (reporting-tables.js).
  var TABLE_FORMATS = { currency: true, percent: true, number: true, date: true };

  function metricLabel(metric) {
    return metric.display_name || metric.title || metric.name || metric.key;
  }

  function words(identifier) {
    return String(identifier || '').split(/[-_.\s]+/).filter(Boolean).map(function (word) {
      return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(' ');
  }

  // Where a metric comes from, for telling same-named metrics apart: its
  // report (module) when it has one, else its catalog group.
  function metricOrigin(metric) {
    var source = metric.source || {};
    if (source.moduleKey) return words(source.moduleKey);
    if (source.group) return words(String(source.group).split('.').pop());
    return metric.display_domain || '';
  }

  // Catalog metrics as select options; the rows path lists only has_rows.
  // Metrics that share a name carry where they come from in the label, and
  // the key when that is still not enough.
  function catalogMetricOptions(metrics, kind) {
    var listed = (metrics || []).filter(function (metric) {
      return metric && metric.key && (kind !== KINDS.rows || metric.has_rows === true);
    });
    var count = function (labels, label) { return labels.filter(function (l) { return l === label; }).length; };
    var names = listed.map(metricLabel);
    var labels = listed.map(function (metric, i) {
      if (count(names, names[i]) < 2) return names[i];
      var origin = metricOrigin(metric);
      return origin ? names[i] + ' (' + origin + ')' : names[i];
    });
    return listed.map(function (metric, i) {
      var label = count(labels, labels[i]) < 2 ? labels[i] : labels[i] + ' (' + metric.key + ')';
      return { value: metric.key, label: label, description: metric.display_domain || '' };
    }).sort(function (a, b) { return a.label.localeCompare(b.label); });
  }

  // The POST /api/v1/reporting/reports body for a catalog report. Returns
  // { body } or { problem }, a message for the person.
  function catalogReportDefinition(choice) {
    var name = String((choice && choice.name) || '').trim();
    var metricKey = choice && choice.metricKey;
    if (!metricKey) return { problem: 'Pick a metric.' };
    if (!name) return { problem: 'Give the report a name.' };
    var config = choice.kind === KINDS.rows
      ? { metric_rows: { metric_key: metricKey } }
      : { metric_keys: [metricKey] };
    return { body: { name: name.slice(0, 255), description: choice.description || '', config: config } };
  }

  // "YYYY-MM-DD" (no regex, per Lex rules).
  function isPlainDay(value) {
    if (typeof value !== 'string' || value.length !== 10) return false;
    var parts = value.split('-');
    if (parts.length !== 3 || parts[0].length !== 4 || parts[1].length !== 2 || parts[2].length !== 2) return false;
    return parts.every(function (part) {
      return part.split('').every(function (ch) { return ch >= '0' && ch <= '9'; });
    });
  }

  // The execute body for any saved report: the chosen period as plain firm
  // days (end inclusive, as in the picker), which the server maps to
  // periodStart/periodEnd. No period at all unless both days are set.
  function runReportBody(report, periodDays) {
    void report;
    var body = { filters: {}, bypass_cache: false };
    if (periodDays && isPlainDay(periodDays.start) && isPlainDay(periodDays.end)) {
      body.period = { start: periodDays.start, end: periodDays.end };
    }
    return body;
  }

  // The backend's declared columns ({ field, header, align?, format? }) as
  // results-table columns, or null when the result names no headers (its
  // columns are then just the row keys, and the table names them).
  function declaredTableColumns(result) {
    var columns = result && Array.isArray(result.columns) ? result.columns : null;
    if (!columns || !columns.some(function (column) { return column && column.header; })) return null;
    return columns.filter(function (column) { return column && column.field; }).map(function (column) {
      var type = column.format && typeof column.format === 'object' ? column.format.type : column.format;
      return {
        field: String(column.field),
        header: column.header ? String(column.header) : String(column.field),
        align: column.align || 'left',
        format: TABLE_FORMATS[type] ? type : ''
      };
    });
  }

  // ── Report data sources ─────────────────────────────────────────────
  // dataSources[] = { id, name, connectorType, entities[], lastSuccessfulSyncAt }.
  // A row leads with what the source holds (its entities), then its name
  // and when it last synced.
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function sourceWords(value) {
    var text = String(value === null || value === undefined ? '' : value).split('_').join(' ').trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
  }

  function dayText(value) {
    var text = String(value || '');
    if (text.length < 10 || text.charAt(4) !== '-' || text.charAt(7) !== '-') return '';
    var month = Number(text.substring(5, 7));
    var day = Number(text.substring(8, 10));
    if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return '';
    return MONTHS[month - 1] + ' ' + day + ', ' + text.substring(0, 4);
  }

  function entityText(entity) {
    if (entity && typeof entity === 'object') return sourceWords(entity.label || entity.name || entity.entity || entity.type || '');
    return sourceWords(entity);
  }

  function dataSourceView(source) {
    var s = source || {};
    var name = String(s.name || sourceWords(s.connectorType) || '');
    var entities = (Array.isArray(s.entities) ? s.entities : []).map(entityText).filter(Boolean);
    var day = dayText(s.lastSuccessfulSyncAt);
    return {
      lead: entities.length ? entities.join(', ') : name,
      name: entities.length ? name : '',
      lastSync: day ? 'Last synced ' + day : 'Not synced yet',
    };
  }

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('"').join('&quot;').split("'").join('&#39;');
  }

  function dataSourceHtml(source) {
    var v = dataSourceView(source);
    return '<div class="report-source">'
      + '<p class="report-source__lead">' + esc(v.lead) + '</p>'
      + '<p class="report-source__meta">' + (v.name ? esc(v.name) + ' · ' : '') + esc(v.lastSync) + '</p>'
      + '</div>';
  }

  var moduleApi = {
    dataSourceView: dataSourceView,
    dataSourceHtml: dataSourceHtml,
    KINDS: KINDS,
    catalogMetricOptions: catalogMetricOptions,
    catalogReportDefinition: catalogReportDefinition,
    runReportBody: runReportBody,
    declaredTableColumns: declaredTableColumns
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.ReportBuilder = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);
