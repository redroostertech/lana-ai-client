'use strict';

// Loads the shared scripts the Dashboards page loads before
// dashboard-detail.js (goal and comparison wording, period, load state,
// card view model, mini charts) into a test window, so render tests run the
// real modules.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', '..', 'src');

function withDashboardScripts(window) {
  for (const rel of ['js/dashboard/metric-goal-comparison.js', 'js/shared/dashboard-period.js', 'js/shared/load-state.js',
    'js/shared/metric-card-view.js', 'js/shared/mini-charts.js', 'js/shared/dashboard-layout.js', 'js/shared/dashboard-cards.js', 'js/shared/card-visuals.js', 'js/shared/lineage-view.js', 'js/shared/insights-breadcrumbs.js', 'js/settings-mappings.model.js', 'js/shared/metric-detail-view.js', 'js/shared/dashboard-tiles.js', 'js/shared/report-objects.js', 'js/shared/data-fixes.js']) {
    new Function('window', fs.readFileSync(path.join(SRC, rel), 'utf8'))(window);
  }
  return window;
}

module.exports = { withDashboardScripts };
