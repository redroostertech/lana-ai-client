'use strict';

/**
 * Reports show plain words to people. Timings, metric counts and module keys
 * are developer details: "Module executed successfully in 638ms. 2 metrics
 * calculated." once showed on the Matter Aging Analysis report.
 */

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', 'admin', 'reporting.js'), 'utf8');

// Every string the page passes to showInfo or showError.
function messages() {
  const out = [];
  const re = /show(?:Info|Error)\(([^;]*)\);/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    if (!/^message\)/.test(match[1])) out.push(match[1]);
  }
  return out;
}

describe('report status messages', () => {
  test('no message reports timings, metric counts, rows returned or module keys', () => {
    const bad = messages().filter((msg) => (
      /executed successfully|metrics calculated|rows returned|ms\b|'ms|executionTimeMs|selectedModuleKey|\(cached\)/i.test(msg)
    ));
    expect(bad).toEqual([]);
  });

  test('no message says execute or module', () => {
    const bad = messages().filter((msg) => /'[^']*\b(execut\w*|module)\b[^']*'/i.test(msg));
    expect(bad).toEqual([]);
  });
});

test('the result header and PDF show no run timing', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'admin', 'reporting.html'), 'utf8');
  expect(html).not.toMatch(/Execution Time|id="executionTime"/);
  expect(source).not.toMatch(/executionTime/);
});

test('the placeholder after picking a report says how to run it, not to pick a module', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'admin', 'reporting.html'), 'utf8');
  const empty = html.slice(html.indexOf('id="reportingPlaceholder"'), html.indexOf('</lex-empty>', html.indexOf('id="reportingPlaceholder"')));
  expect(empty).not.toMatch(/module|Choose a report/i);
  expect(empty).toContain('Run Report');
});
