/**
 * scripts/postinstall-electron.js runs on every npm install / npm ci.
 * It must skip the Electron download when ELECTRON_SKIP_BINARY_DOWNLOAD is
 * set, and must not fail when electron (a devDependency) is not installed.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'postinstall-electron.js');
// Test-only CI installs with ELECTRON_SKIP_BINARY_DOWNLOAD=1, so the binary
// may be absent; only exercise the real installer when it would be a no-op.
const HAS_BINARY = fs.existsSync(path.join(ROOT, 'node_modules', 'electron', 'path.txt'));

function run(scriptPath, env) {
  const childEnv = { ...process.env, ...env };
  if (!('ELECTRON_SKIP_BINARY_DOWNLOAD' in env)) delete childEnv.ELECTRON_SKIP_BINARY_DOWNLOAD;
  return spawnSync(process.execPath, [scriptPath], { env: childEnv, encoding: 'utf8' });
}

describe('postinstall-electron', () => {
  it.each(['1', 'true'])('skips the download when ELECTRON_SKIP_BINARY_DOWNLOAD=%s', (value) => {
    const result = run(SCRIPT, { ELECTRON_SKIP_BINARY_DOWNLOAD: value });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/ELECTRON_SKIP_BINARY_DOWNLOAD is set, skipping/);
  });

  it('is a no-op when the electron package is not installed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'postinstall-electron-'));
    try {
      const copy = path.join(dir, 'postinstall-electron.js');
      fs.copyFileSync(SCRIPT, copy);
      const result = run(copy, {});
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/electron is not installed/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  (HAS_BINARY ? it : it.skip)('defers to Electron install.js when electron is present', () => {
    // With the pinned binary already in node_modules/electron/dist,
    // install.js exits 0 without downloading.
    const result = run(SCRIPT, { ELECTRON_SKIP_BINARY_DOWNLOAD: '0' });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toMatch(/skipping/);
  });
});
