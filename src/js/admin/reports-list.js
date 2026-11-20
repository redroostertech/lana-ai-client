/* Reports list: the entries the Reports page opens on.
   Pure mapping from the backend's report catalog (GET /api/v1/modules:
   purpose, audience, lastRunAt) and saved reports (/api/v1/reporting/reports)
   to table rows, plus the summary cell and side panel markup. The page names
   no report itself. */

(function (global) {
  'use strict';

  function reportEntry(module) {
    return {
      row_id: 'module:' + module.moduleKey,
      id: 'module:' + module.moduleKey,
      kind: 'report',
      key: module.moduleKey,
      name: module.name || module.moduleKey,
      purpose: module.purpose || '',
      audience: Array.isArray(module.audience) ? module.audience.join(', ') : '',
      last_run_at: module.lastRunAt || null,
      saved: false
    };
  }

  function savedEntry(report) {
    return {
      row_id: 'saved:' + report.report_id,
      id: 'saved:' + report.report_id,
      kind: 'saved',
      key: report.report_id,
      name: report.name || 'Saved report',
      purpose: report.description || '',
      audience: '',
      last_run_at: report.last_run_at || null,
      saved: true,
      deletable: !report.is_template
    };
  }

  // Reports once per key (the backend dedupes too), then saved reports. A
  // seeded template converted to reference a module (module_key) is that
  // module, so it is not listed a second time; a firm's own report always is.
  function buildReportEntries(modules, savedReports) {
    var seen = {};
    var reports = (modules || []).filter(function (module) {
      if (!module || !module.moduleKey || seen[module.moduleKey]) return false;
      seen[module.moduleKey] = true;
      return true;
    }).map(reportEntry);
    return reports.concat((savedReports || []).filter(function (report) {
      return report && !(report.module_key && report.is_template);
    }).map(savedEntry));
  }

  // The list shows at most this many characters of a report's summary.
  var PREVIEW_LIMIT = 50;
  var ELLIPSIS = '\u2026';

  // Characters as people see them (graphemes), so an emoji or an accented
  // letter is never cut in half. Code points when Intl.Segmenter is missing.
  function characters(value) {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value), function (part) {
        return part.segment;
      });
    }
    return Array.from(value);
  }

  function previewText(text) {
    var value = String(text == null ? '' : text);
    var chars = characters(value);
    if (chars.length <= PREVIEW_LIMIT) return value;
    return chars.slice(0, PREVIEW_LIMIT - 1).join('').replace(/\s+$/, '') + ELLIPSIS;
  }

  // "What it shows" cell. A report's summary is a button that opens its side
  // panel (data-report-about names the report); the full text stays in the
  // title and the accessible name. All server text goes through escape().
  function purposeCell(row, escape) {
    var full = row.purpose || '';
    if (!full) return '<span class="reporting-list__muted">No description</span>';
    var shown = escape(previewText(full));
    if (row.kind !== 'report') return '<span title="' + escape(full) + '">' + shown + '</span>';
    return '<button type="button" class="reporting-list__about"'
      + ' data-report-about="' + escape(row.key) + '"'
      + ' title="' + escape(full) + '"'
      + ' aria-label="' + escape('About ' + row.name + ': ' + full) + '"'
      + ' aria-haspopup="dialog">' + shown + '</button>';
  }

  // The side panel body from the report's declared about: each part is a
  // short paragraph or a list of short lines.
  var ABOUT_PARTS = [
    { key: 'what', heading: 'What it is' },
    { key: 'howBuilt', heading: 'How it is put together' },
    { key: 'goal', heading: 'Goal' },
    { key: 'howToUse', heading: 'How to use it' }
  ];

  function aboutPartHtml(value, escape) {
    if (Array.isArray(value)) {
      return '<ul class="reporting-about__list">' + value.map(function (line) {
        return '<li>' + escape(line) + '</li>';
      }).join('') + '</ul>';
    }
    return '<p class="reporting-about__text">' + escape(value) + '</p>';
  }

  function aboutHtml(about, escape) {
    var parts = ABOUT_PARTS.filter(function (part) { return about && about[part.key]; });
    if (!parts.length) return '<p class="reporting-list__muted">There are no details for this report yet.</p>';
    return '<div class="reporting-about">' + parts.map(function (part) {
      return '<section class="reporting-about__section">'
        + '<h4 class="reporting-about__heading">' + part.heading + '</h4>'
        + aboutPartHtml(about[part.key], escape) + '</section>';
    }).join('') + '</div>';
  }

  global.ReportsList = {
    buildReportEntries: buildReportEntries,
    previewText: previewText,
    purposeCell: purposeCell,
    aboutHtml: aboutHtml
  };
})(window);
