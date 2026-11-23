/**
 * The release docs and pins describe where things live now (2026-11-23):
 * installers and update feeds on Cloudflare R2 (releases.lanaai.io, bucket
 * lana-releases), build parts in the private R2 bucket lana-build-parts, code
 * on GitHub only. Nothing is published as a GitHub release, and nothing is
 * stored on Azure (Azure is only for build machines).
 */
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

test('the runbook publishes to releases.lanaai.io from dist/r2, not to GitHub releases', () => {
  const runbook = read('docs/RELEASE-RUNBOOK.md');
  expect(runbook).toMatch(/releases\.lanaai\.io/);
  expect(runbook).toMatch(/stage-client-release\.js/);
  expect(runbook).toMatch(/lana-build-parts/);
  expect(runbook).not.toMatch(/gh release (create|edit|upload)/);
  expect(runbook).not.toMatch(/"provider": "github"/);
});

test('the older release process doc points at the runbook instead of GitHub uploads', () => {
  expect(read('docs/RELEASE_PROCESS.md')).not.toMatch(/gh release upload/);
});

test('the Pip pin says its builds are kept in lana-build-parts, not on Azure', () => {
  const pin = read('pip/pip-pin.json');
  expect(pin).not.toMatch(/Azure parts store/);
  expect(pin).toMatch(/lana-build-parts/);
});
