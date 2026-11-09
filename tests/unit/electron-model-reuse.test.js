/**
 * Model files already on this computer (electron-model-reuse.js): where to look, matching by name
 * and exact size, the pinned SHA-256 checked once, and placing a file without touching the
 * original. Real files in a temporary folder.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { searchFolders, findCandidates, verifyCandidates, placeFound } = require('../../electron-model-reuse');

const RIGHT = crypto.randomBytes(64 * 1024);
const SHA = crypto.createHash('sha256').update(RIGHT).digest('hex');
const entry = { id: 'chat-9b', name: 'Chat 9B', filename: 'Chat-9B.gguf', sizeBytes: RIGHT.length, sha256: SHA };

let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'lana-reuse-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

function put(rel, bytes) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return file;
}

describe('searchFolders', () => {
  test.each([
    ['darwin', {}, path.join('/h', 'Library', 'Application Support', 'LQE', 'models')],
    ['win32', { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' }, path.join('C:\\Users\\x\\AppData\\Roaming', 'Pip.cpp', 'runtime', 'models')],
    ['linux', {}, path.join('/h', '.config', 'Pip.cpp', 'runtime', 'models')],
    ['linux', { XDG_CONFIG_HOME: '/cfg' }, path.join('/cfg', 'Pip.cpp', 'runtime', 'models')]
  ])('Pip on %s %j', (platform, env, pip) => {
    const folders = searchFolders({ platform, home: '/h', env });
    expect(folders[0]).toEqual({ dir: pip, source: 'Pip' });
    expect(folders.map((f) => f.dir)).toEqual(expect.arrayContaining([path.join('/h', '.llama-models'), path.join('/h', '.lmstudio', 'models')]));
  });
});

describe('finding and checking', () => {
  test('a right file is found and checked; a wrong-size file is ignored; a same-size wrong file fails the check', async () => {
    put('pip/Chat-9B.gguf', Buffer.alloc(100));                                    // wrong size
    const wrong = Buffer.from(RIGHT); wrong[5] ^= 0xff;
    put('lm/publisher/repo/Chat-9B.gguf', wrong);                                   // same size, wrong bytes
    const folders = [{ dir: path.join(root, 'pip'), source: 'Pip' }, { dir: path.join(root, 'lm'), source: 'LM Studio' }];
    const candidates = await findCandidates({ entries: [entry], folders });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].source).toBe('LM Studio');
    const checksFile = path.join(root, 'lana', '.found-checks.json');
    expect(await verifyCandidates(candidates, { checksFile })).toEqual([]);

    put('llama/Chat-9B.gguf', RIGHT);                                               // the right one
    const again = await findCandidates({ entries: [entry], folders: [{ dir: path.join(root, 'llama'), source: 'another folder' }] });
    const verified = await verifyCandidates(again, { checksFile });
    expect(verified).toHaveLength(1);
    expect(verified[0].path).toBe(path.join(root, 'llama', 'Chat-9B.gguf'));
    // Nothing is written next to another app's file.
    expect(fs.readdirSync(path.join(root, 'llama'))).toEqual(['Chat-9B.gguf']);
  });

  test('a file is hashed once; a changed file is hashed again', async () => {
    const file = put('llama/Chat-9B.gguf', RIGHT);
    const checksFile = path.join(root, 'lana', '.found-checks.json');
    const candidates = await findCandidates({ entries: [entry], folders: [{ dir: path.join(root, 'llama'), source: 'x' }] });
    await verifyCandidates(candidates, { checksFile });
    const reads = jest.spyOn(fs, 'createReadStream');
    expect(await verifyCandidates(candidates, { checksFile })).toHaveLength(1);
    expect(reads).not.toHaveBeenCalled();
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(file, later, later);
    await verifyCandidates(candidates, { checksFile });
    expect(reads).toHaveBeenCalled();
    reads.mockRestore();
  });

  test('LANA\'s own models folder is skipped', async () => {
    put('lana/models/Chat-9B.gguf', RIGHT);
    const dir = path.join(root, 'lana', 'models');
    expect(await findCandidates({ entries: [entry], folders: [{ dir, source: 'x' }], skipDir: dir })).toEqual([]);
  });
});

describe('placeFound', () => {
  test('links on the same disk, checks the result, and leaves the original as it was', async () => {
    const source = put('llama/Chat-9B.gguf', RIGHT);
    const before = fs.statSync(source);
    const modelsDir = path.join(root, 'lana', 'models');
    await expect(placeFound({ entry, source, modelsDir })).resolves.toBe('linked');
    const target = path.join(modelsDir, 'Chat-9B.gguf');
    expect(fs.readFileSync(target).equals(RIGHT)).toBe(true);
    expect(fs.existsSync(`${target}.verified`)).toBe(true);
    expect(fs.readFileSync(source).equals(RIGHT)).toBe(true);
    expect(fs.statSync(source).mtimeMs).toBe(before.mtimeMs);
    expect(fs.readdirSync(path.join(root, 'llama'))).toEqual(['Chat-9B.gguf']);
    await expect(placeFound({ entry, source, modelsDir })).resolves.toBe('present');
  });

  test('copies when a link is not possible, and removes a copy that does not match', async () => {
    const source = put('llama/Chat-9B.gguf', RIGHT);
    const modelsDir = path.join(root, 'lana', 'models');
    const link = jest.spyOn(fs.promises, 'link').mockRejectedValueOnce(Object.assign(new Error('cross-device'), { code: 'EXDEV' }));
    await expect(placeFound({ entry, source, modelsDir })).resolves.toBe('copied');
    link.mockRestore();
    expect(fs.readFileSync(path.join(modelsDir, 'Chat-9B.gguf')).equals(RIGHT)).toBe(true);

    const bad = put('other/Chat-9B.gguf', Buffer.alloc(RIGHT.length, 1));
    const otherDir = path.join(root, 'lana2');
    await expect(placeFound({ entry, source: bad, modelsDir: otherDir })).rejects.toThrow(/did not match/);
    expect(fs.existsSync(path.join(otherDir, 'Chat-9B.gguf'))).toBe(false);
    expect(fs.existsSync(bad)).toBe(true);
  });
});
