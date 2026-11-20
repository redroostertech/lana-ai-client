/* Reports: what the list page (admin/reports-list.html) and the report page
   (admin/report.html) share. Mapping from the backend's report catalog
   (GET /api/v1/modules: purpose, audience, lastRunAt) and saved reports
   (/api/v1/reporting/reports) to entries, the summary cell and side panel
   markup, the run periods, and the report page's URL (which report, which
   period). The pages name no report themselves. */

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
  var PREVIEW_LIMIT = 25;
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

  // "What it shows" cell: the summary cut short, then a "show more" button
  // that opens the report's side panel (data-report-about names the entry).
  // Screen readers get the full summary; the cut copy is for the eye only.
  // All server text goes through escape().
  function purposeCell(row, escape) {
    var full = row.purpose || '';
    var summary = full
      ? '<span class="reporting-list__summary" title="' + escape(full) + '">'
        + '<span aria-hidden="true">' + escape(previewText(full)) + '</span>'
        + '<span class="reporting-list__sr">' + escape(full) + '</span></span>'
      : '<span class="reporting-list__muted">No description</span>';
    return summary + ' <button type="button" class="reporting-list__more"'
      + ' data-report-about="' + escape(row.id) + '"'
      + ' aria-label="' + escape('Show more about ' + row.name) + '"'
      + ' aria-haspopup="dialog">show more</button>';
  }

  // The side panel body from the report's declared about, in reading order.
  // Each part is its own card with an icon and a heading; its text is a
  // short paragraph or a list of short lines. Parts a report does not
  // declare are left out.
  var ABOUT_PARTS = [
    { key: 'what', heading: 'What it is', icon: 'info' },
    { key: 'whatYouSee', heading: 'What you see', icon: 'bar-chart-2' },
    { key: 'howBuilt', heading: 'How it is put together', icon: 'layers' },
    { key: 'dataUsed', heading: 'Data it uses', icon: 'database' },
    { key: 'goal', heading: 'Goal', icon: 'target' },
    { key: 'howToUse', heading: 'How to use it', icon: 'list-checks' },
    { key: 'goodToKnow', heading: 'Good to know', icon: 'alert-circle' }
  ];

  function aboutPartHtml(value, escape) {
    if (Array.isArray(value)) {
      return '<ul class="report-about__list">' + value.map(function (line) {
        return '<li>' + escape(line) + '</li>';
      }).join('') + '</ul>';
    }
    return '<p class="report-about__text">' + escape(value) + '</p>';
  }

  function cardHeading(heading, iconName, icon) {
    return '<header class="report-about__head">'
      + '<span class="report-about__icon" aria-hidden="true">' + icon(iconName) + '</span>'
      + '<h4 class="report-about__heading">' + heading + '</h4></header>';
  }

  function aboutHtml(about, escape, icon) {
    var parts = ABOUT_PARTS.filter(function (part) { return about && about[part.key]; });
    if (!parts.length) return '<p class="reporting-list__muted">There are no details for this report yet.</p>';
    return '<div class="report-about">' + parts.map(function (part) {
      return '<section class="report-about__card">' + cardHeading(part.heading, part.icon, icon)
        + aboutPartHtml(about[part.key], escape) + '</section>';
    }).join('') + '</div>';
  }

  // Run from the side panel: quick periods (days from LanaTime.reportPresetDays)
  // or a custom range.
  var RUN_PRESETS = [
    { key: 'today', label: 'Today' },
    { key: 'todayAndYesterday', label: 'Today and yesterday' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: 'thisWeek', label: 'This week' },
    { key: 'lastWeek', label: 'Last week' },
    { key: 'lastMonth', label: 'Last month' },
    { key: 'custom', label: 'Custom' }
  ];

  // The side panel footer: the custom dates (shown for Custom), a problem
  // line, then the period dropdown and Run. The same for every report.
  function runFooterHtml(selected, escape) {
    return '<div class="report-run__custom" data-run-custom' + (selected === 'custom' ? '' : ' hidden') + '>'
      + '<lex-input data-run-start type="date" label="Start date" name="runStart"></lex-input>'
      + '<lex-input data-run-end type="date" label="End date" name="runEnd"></lex-input></div>'
      + '<p class="report-run__problem" data-run-problem role="alert" hidden></p>'
      + '<div class="report-run__row">'
      + '<lex-select data-run-period label="Period" name="runPeriod" value="' + escape(selected) + '"'
      + ' options="' + escape(JSON.stringify(RUN_PRESETS.map(function (preset) {
        return { value: preset.key, label: preset.label };
      }))) + '"></lex-select>'
      + '<lex-btn data-run-report variant="primary">Run report</lex-btn></div>';
  }

  // Compare By for a period of spanDays whole days: one or two days compare
  // by day, a year by month only; otherwise the current choice stays.
  var COMPARE_BY = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];

  function compareByFor(spanDays, preset, current) {
    if (preset === 'lastYear' || (spanDays >= 365 && spanDays <= 366)) return { options: ['monthly'], value: 'monthly' };
    if (spanDays <= 2) return { options: COMPARE_BY.slice(), value: 'daily' };
    return { options: COMPARE_BY.slice(), value: COMPARE_BY.indexOf(current) !== -1 ? current : 'monthly' };
  }

  // Why a custom range cannot run yet, or null. Days are 'YYYY-MM-DD', so
  // they compare as text.
  function customPeriodProblem(start, end) {
    if (!start || !end) return 'Pick a start date and an end date.';
    if (start > end) return 'The start date must be on or before the end date.';
    return null;
  }

  // The entry with this id ('module:<key>' or 'saved:<id>'), or undefined.
  function findEntry(modules, savedReports, id) {
    return buildReportEntries(modules, savedReports).find(function (entry) { return entry.id === id; });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // The report catalog and the firm's saved reports, for both pages. Saved
  // reports that fail to load leave the catalog usable.
  async function loadCatalog(api) {
    var results = await Promise.all([
      api.get('/api/v1/modules'),
      api.get('/api/v1/reporting/reports', { limit: 100, offset: 0, sort: 'name', order: 'asc', is_active: true })
        .catch(function (error) {
          console.error('[Reports] Failed to load saved reports:', error);
          return {};
        })
    ]);
    return {
      modules: (results[0] && results[0].modules) || [],
      saved: (results[1] && (results[1].data || results[1].reports)) || []
    };
  }

  // Periods a report page URL may name (LanaTime.reportPresetDays keys): the
  // side panel's quick periods and the page's own presets.
  var PERIOD_PRESETS = RUN_PRESETS.map(function (preset) { return preset.key; })
    .filter(function (key) { return key !== 'custom'; })
    .concat(['last7days', 'last30days', 'thisMonth', 'thisQuarter', 'thisYear', 'lastYear']);

  var REPORT_PAGE = 'admin/report.html';
  var LIST_PAGE = 'admin/reports-list.html';

  // The report page for an entry, with the period to run (a preset, or a
  // custom start and end), or none.
  function reportHref(entry, period) {
    var params = new URLSearchParams();
    params.set(entry.kind === 'saved' ? 'saved' : 'report', entry.key);
    if (period && period.preset) params.set('period', period.preset);
    else if (period && period.start && period.end) {
      params.set('start', period.start);
      params.set('end', period.end);
    }
    return REPORT_PAGE + '?' + params.toString();
  }

  // What a report page URL asks for: the entry id and the period to run, or
  // null for either. A period that is not one of ours, or a day that is not
  // on the calendar (LanaTime.isPlainDay), is ignored.
  function reportRequest(params) {
    var id = params.get('report') ? 'module:' + params.get('report')
      : (params.get('saved') ? 'saved:' + params.get('saved') : null);
    var preset = params.get('period');
    var start = params.get('start');
    var end = params.get('end');
    var period = null;
    if (preset && PERIOD_PRESETS.indexOf(preset) !== -1) period = { preset: preset };
    else if (global.LanaTime.isPlainDay(start) && global.LanaTime.isPlainDay(end) && !customPeriodProblem(start, end)) {
      period = { start: start, end: end };
    }
    return { id: id, period: period };
  }

  global.ReportsList = {
    escapeHtml: escapeHtml,
    findEntry: findEntry,
    loadCatalog: loadCatalog,
    REPORT_PAGE: REPORT_PAGE,
    LIST_PAGE: LIST_PAGE,
    reportHref: reportHref,
    reportRequest: reportRequest,
    buildReportEntries: buildReportEntries,
    previewText: previewText,
    purposeCell: purposeCell,
    aboutHtml: aboutHtml,
    RUN_PRESETS: RUN_PRESETS,
    runFooterHtml: runFooterHtml,
    compareByFor: compareByFor,
    customPeriodProblem: customPeriodProblem
  };
})(window);
