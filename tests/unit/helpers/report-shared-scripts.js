'use strict';

// Loads the shared scripts the Reports and Dashboards pages load before
// their page script (data-state.js, report-metric-card.js, report-builder.js, reports-list.js), into a test
// window, so page-script render tests run the real renderers.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', '..', 'src');

function withReportSharedScripts(window) {
  for (const rel of ['js/shared/data-state.js', 'js/admin/report-metric-card.js', 'js/admin/report-builder.js', 'js/admin/reports-list.js']) {
    new Function('window', fs.readFileSync(path.join(SRC, rel), 'utf8'))(window);
  }
  return window;
}

module.exports = { withReportSharedScripts };
