/**
 * The lana-editor build the client ships (scripts/fetch-lana-editor.js, editor/editor.lock.json):
 * the pin's shape, that the clone fetches exactly the pinned commit, and that a build from any
 * other commit, or missing a file or licence, is refused before packaging.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { readPin, checkEditorBuild, cloneCommands, REQUIRED_FILES, PIN_FILE, BUILD_MANIFEST } = require('../../scripts/fetch-lana-editor');

const pin = readPin();

function fakeBuild({ commit = pin.commit, skip = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-pin-test-'));
  const dir = path.join(root, 'build', 'lana-editor');
  for (const rel of REQUIRED_FILES) {
    if (skip.includes(rel)) {continue;}
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), 'x');
  }
  fs.writeFileSync(path.join(dir, BUILD_MANIFEST), JSON.stringify({ repo: pin.repo, commit }));
  return root;
}

test('the pin names the lana-editor repo and one full commit, in the backend lock file\'s shape', () => {
  expect(pin.repo).toBe('https://github.com/redroostertech/lana-editor.git');
  expect(pin.commit).toMatch(/^[0-9a-f]{40}$/);
  expect(path.relative(path.join(__dirname, '../..'), PIN_FILE)).toBe(path.join('editor', 'editor.lock.json'));
});

test('the clone fetches and checks out exactly the pinned commit', () => {
  const commands = cloneCommands(pin, '/tmp/e', 'git@github.com:redroostertech/lana-editor.git');
  expect(commands).toContainEqual(['git', ['-C', '/tmp/e', 'fetch', '-q', '--depth', '1', 'origin', pin.commit]]);
  expect(commands[commands.length - 1]).toEqual(['git', ['-C', '/tmp/e', 'checkout', '-q', '--detach', pin.commit]]);
  expect(commands).toContainEqual(['git', ['-C', '/tmp/e', 'remote', 'add', 'origin', 'git@github.com:redroostertech/lana-editor.git']]);
});

test('a build of the pinned commit with every file and licence passes', () => {
  expect(checkEditorBuild({ root: fakeBuild(), pin })).toEqual([]);
});

test('a build of another commit, a missing file or licence, or no build at all is refused', () => {
  expect(checkEditorBuild({ root: fakeBuild({ commit: 'f'.repeat(40) }), pin })[0]).toMatch(/the client pins/);
  expect(checkEditorBuild({ root: fakeBuild({ skip: ['packages/redline-service/dist/vendor/pdfjs/LICENSE'] }), pin })[0]).toMatch(/pdfjs\/LICENSE/);
  expect(checkEditorBuild({ root: fakeBuild({ skip: ['packages/redline-service/dist/THIRD_PARTY_LICENSES.txt'] }), pin })[0]).toMatch(/THIRD_PARTY_LICENSES/);
  expect(checkEditorBuild({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'editor-none-')), pin })[0]).toMatch(/is missing/);
});
