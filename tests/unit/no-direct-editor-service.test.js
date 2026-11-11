'use strict';

// The app's own code never calls the lana-editor API itself: the editor embed
// does, against the service the main process runs on this computer
// (electron-editor-service.js), at the address the preload bridge gives it.
// Redline batches proposed on Chef still go through Chef
// (docs/plans/redline-agent-plan.md in LANA-AI, item 4). A fixed editor port
// or the /v1/redline API named anywhere under src/js fails here.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../src/js');
const FORBIDDEN = ['127.0.0.1:4710', 'localhost:4710', '/v1/redline'];

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(full);
    return /\.(m?js)$/.test(entry.name) ? [full] : [];
  });
}

test('no file under src/js names the editor service address or its redline API', () => {
  const files = jsFiles(ROOT);
  expect(files.length).toBeGreaterThan(50);
  const hits = [];
  files.forEach((file) => {
    const source = fs.readFileSync(file, 'utf8');
    FORBIDDEN.forEach((needle) => {
      if (source.includes(needle)) hits.push(path.relative(ROOT, file) + ': ' + needle);
    });
  });
  expect(hits).toEqual([]);
});

test('the direct editor setting is gone from config.js', () => {
  const config = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
  expect(config).not.toContain('LANA_EDITOR_SERVICE_URL');
});
