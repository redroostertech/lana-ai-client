'use strict';

/**
 * Reports and Dashboards read failures only from data_state and
 * data_state_reason (through DataState). Tiles, cards and runs no longer
 * carry error, message, unavailable_reason, executable or a failure status;
 * status keeps only its goal color (green, yellow, red, gray).
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');
const FILES = ['js/admin/report.js', 'js/admin/report-metric-card.js', 'js/admin/reports-list.js',
  'js/admin/dashboard-detail.js', 'js/admin/dashboard-library.js', 'js/shared/dashboard-tiles.js'];

// Caught exceptions (error / err / e) may still read .message. The data
// state a failed API call carries is read by DataState.fromApiError
// (shared/data-state.js), so no page reads an error envelope itself.
const OLD_READS = [
  /\b(?!error\b|err\b|e\b)\w+\.(error|message)\b(?!\s*\()/,
  /\bunavailable_reason\b/,
  /\.executable\b/,
  /status\s*===?\s*'(error|unavailable|planned)'/,
];

test.each(FILES)('%s reads no old failure field', (rel) => {
  const lines = fs.readFileSync(path.join(SRC, rel), 'utf8').split('\n')
    .filter(line => !/^\s*(\/\/|\*)/.test(line) && !/console\.|Lex\.Toast|Lex\.Modal/.test(line));
  expect(lines.filter(line => OLD_READS.some(re => re.test(line))).map(l => l.trim())).toEqual([]);
});
