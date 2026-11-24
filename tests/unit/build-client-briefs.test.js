'use strict';

// build-client.sh packaged whatever briefs/dist the build machine happened to hold:
// it never ran the Briefs build, so an installer could ship stale Briefs code, or none
// (then Briefs never starts and the page says "not available"). Seen 2026-11-24 on a
// dev launch that skipped the pre-start build.

const fs = require('fs');
const path = require('path');

const script = fs.readFileSync(path.join(__dirname, '../../scripts/build-client.sh'), 'utf8');
const live = script.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

test('the release build rebuilds Briefs before bundling', () => {
  const briefs = live.indexOf('node scripts/build-briefs.js');
  const bundle = live.indexOf('node scripts/bundle-electron.js');
  expect(briefs).toBeGreaterThan(-1);
  expect(bundle).toBeGreaterThan(briefs);
});
