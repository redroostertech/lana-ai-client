'use strict';

// build-client.sh asked for Apple signing credentials even for a Windows-only
// build, and a run with no terminal input stopped at once (build machine,
// 2026-11-11). It also left the Windows zip (LanaAI--genesis--<v>.zip, no
// "win" in the name) out of dist/windows.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const script = fs.readFileSync(path.join(__dirname, '../../scripts/build-client.sh'), 'utf8');

test('Apple credentials are asked for only when a mac target is built', () => {
  const main = script.slice(script.indexOf('main() {'));
  const prompt = main.indexOf('Apple Developer credentials required');
  const guard = main.lastIndexOf('needs_apple_credentials', prompt);
  expect(guard).toBeGreaterThan(-1);
  expect(script).toMatch(/needs_apple_credentials\(\)\s*\{[\s\S]*?(mac|all)[\s\S]*?\}/);
});

test('the arch-less Windows zip is moved into dist/windows', () => {
  const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'org-'));
  const dir = path.join(root, 'dist');
  fs.mkdirSync(dir);
  for (const f of ['LanaAI--genesis--4.1.0.zip', 'LanaAI--genesis--4.1.0-setup.exe', 'LanaAI--genesis--4.1.0-x64.zip', 'LanaAI--genesis--4.1.0-arm64.zip']) fs.writeFileSync(path.join(dir, f), '');
  const fn = script.slice(script.indexOf('organize_output() {'), script.indexOf('\n}\n', script.indexOf('organize_output() {')) + 3);
  execFileSync('bash', ['-c', 'PROJECT_ROOT="$1"; VERSION=4.1.0; print_step() { :; }; print_success() { :; }; ' + fn + '\norganize_output >/dev/null 2>&1 || true', 'x', root]);
  expect(fs.existsSync(path.join(dir, 'windows', 'LanaAI--genesis--4.1.0.zip'))).toBe(true);
  expect(fs.existsSync(path.join(dir, 'windows', 'LanaAI--genesis--4.1.0-x64.zip'))).toBe(false);
  fs.rmSync(root, { recursive: true, force: true });
});
