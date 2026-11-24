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
    'js/shared/metric-card-view.js', 'js/shared/mini-charts.js']) {
    new Function('window', fs.readFileSync(path.join(SRC, rel), 'utf8'))(window);
  }
  return window;
}

module.exports = { withDashboardScripts };
