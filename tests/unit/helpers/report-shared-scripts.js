'use strict';

// Loads the shared scripts the Reports and Dashboards pages load before
// their page script (data-state.js, report-metric-card.js, report-builder.js, reports-list.model.js, title-switcher.js), into a test
// window, so page-script render tests run the real renderers.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', '..', 'src');

function withReportSharedScripts(window) {
  // The Dashboards page script also needs its own shared modules.
  require('./dashboard-shared-scripts').withDashboardScripts(window);
  for (const rel of ['js/shared/data-state.js', 'js/admin/report-metric-card.js', 'js/admin/report-builder.js', 'js/admin/reports-list.model.js', 'js/shared/title-switcher.js']) {
    new Function('window', fs.readFileSync(path.join(SRC, rel), 'utf8'))(window);
  }
  return window;
}

module.exports = { withReportSharedScripts };
