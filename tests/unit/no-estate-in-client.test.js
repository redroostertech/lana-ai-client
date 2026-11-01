'use strict';

// Design 7.1: the client renders generic tab kinds and server-described
// forms and never branches on a makeup. The word "estate" must not appear in
// client code. Test fixtures live under tests/, outside this scan.

const fs = require('fs');
const path = require('path');

const SRC_JS = path.join(__dirname, '..', '..', 'src', 'js');

// No file is exempt: phase 7 deleted the Implementation Assurance page, the
// last client code that named it.
const ALLOWED = [];

// The page files phase 7 deleted; none may come back.
const DELETED_PAGE_FILES = [
  'implementation-assurance.js',
  'assurance-onboarding.js',
  'services/implementation-assurance-client.js',
  'services/assurance-onboarding-client.js',
  'services/assurance-rulebook-view.js',
  'services/assurance-value-controls.js',
  'services/assurance-evidence-controls.js',
];

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

function offenders(root, allowed) {
  return jsFiles(root)
    .map((file) => path.relative(root, file).split(path.sep).join('/'))
    .filter((rel) => !allowed.includes(rel))
    .filter((rel) => fs.readFileSync(path.join(root, rel), 'utf8').includes('estate'));
}

describe('no estate in client code', () => {
  test('src/js has no "estate" anywhere', () => {
    expect(ALLOWED).toEqual([]);
    expect(offenders(SRC_JS, ALLOWED)).toEqual([]);
  });

  test('the Implementation Assurance page is gone', () => {
    DELETED_PAGE_FILES.forEach((rel) => expect(fs.existsSync(path.join(SRC_JS, rel))).toBe(false));
    expect(fs.existsSync(path.join(SRC_JS, '..', 'implementation-assurance.html'))).toBe(false);
  });

  test('the scan reports a file that names it (control arm)', () => {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'no-estate-'));
    try {
      fs.mkdirSync(path.join(dir, 'shared'));
      fs.writeFileSync(path.join(dir, 'shared', 'bad.js'), "if (makeup.key === 'estate') {}\n");
      fs.writeFileSync(path.join(dir, 'ok.js'), "var likeState = 1;\n");
      fs.writeFileSync(path.join(dir, 'allowed.js'), "// estate\n");
      expect(offenders(dir, ['allowed.js'])).toEqual(['shared/bad.js']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
