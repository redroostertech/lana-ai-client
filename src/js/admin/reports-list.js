/* Reports list: the entries the Reports page opens on.
   Pure mapping from the backend's report catalog (GET /api/v1/modules:
   purpose, audience, lastRunAt) and saved reports (/api/v1/reporting/reports)
   to table rows. The page names no report itself. */

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

  global.ReportsList = { buildReportEntries: buildReportEntries };
})(window);
