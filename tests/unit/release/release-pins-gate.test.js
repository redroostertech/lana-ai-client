'use strict';

/**
 * Pins and version, and the production gate. The pins branch carries the new
 * entries, the version and the engine pin on production; the gate moves
 * client production only after review, with every piece ready on
 * development, and with Michael's yes.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { applyEntries, entryFromArchive, missingEntries, pins } = require('../../../scripts/release/phases/pins');
const { gate, handoffText } = require('../../../scripts/release/phases/gate');
const { pinsFixture, listingOf, readyKeys, fakeGit, fakeR2, fakeRun, makeCtx, allPip, allEngine, allKeys, SERVER, CLIENT_DEV } = require('./fakes');

const tmp = () => fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'lana-pins-'));
const sha = (file) => require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');

describe('pin entries', () => {
  test('entries go into the right file, and the engine pin follows production', () => {
    const entries = { 'macos-x64/pip': { sha256: 'f'.repeat(64), bytes: 9 }, 'linux-x64/engine': { files: 3, treeSha256: 'e'.repeat(64) } };
    const pip = JSON.parse(applyEntries(JSON.stringify(pinsFixture()['pip/pip-pin.json']), 'pip', entries));
    const engine = JSON.parse(applyEntries(JSON.stringify(pinsFixture()['engine/engine-pin.json']), 'engine', entries));
    expect(pip.builds['macos-x64']).toEqual({ sha256: 'f'.repeat(64), bytes: 9 });
    expect(pip.builds['linux-x64'].sha256).toBe('3'.repeat(64));
    expect(engine.builds['linux-x64']).toEqual({ files: 3, treeSha256: 'e'.repeat(64) });
    expect(engine.branch).toBe('production');
    expect(pip.branch).toBeUndefined();
  });

  test('a piece built earlier gets its entry from its archive in the bucket, in either archive shape', async () => {
    for (const shape of ['root', 'folder']) {
      const work = tmp();
      const inner = shape === 'root' ? work : path.join(work, 'pip');
      fs.mkdirSync(inner, { recursive: true });
      fs.writeFileSync(path.join(inner, 'lqe'), 'pip bytes');
      const archive = path.join(tmp(), 'a.tar.gz');
      execFileSync('tar', ['-czf', archive, '-C', work, shape === 'root' ? '.' : 'pip']);
      const r2 = fakeR2([], { downloadFrom: archive, shaText: `${sha(archive)}  pip-x.tar.gz\n` });
      const ctx = makeCtx({ r2, run: (cmd, args) => require('../../../scripts/release/exec').run(cmd, args) });
      // eslint-disable-next-line no-await-in-loop
      const entry = await entryFromArchive(ctx, { target: 'macos-x64', part: 'pip', archive: { key: 'macos-x64/pip-x.tar.gz' } }, { pip: { version: '3.1.0', build: '8ee218c47371' } });
      expect(entry).toMatchObject({ sha256: sha(path.join(inner, 'lqe')), bytes: 9 });
      expect(entry.source).toMatch(/kept in lana-build-parts at macos-x64\/pip-x\.tar\.gz/);
    }
  });

  test('an archive that does not match its .sha256 is refused', async () => {
    const work = tmp();
    fs.writeFileSync(path.join(work, 'lqe'), 'x');
    const archive = path.join(tmp(), 'a.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', work, '.']);
    const ctx = makeCtx({ r2: fakeR2([], { downloadFrom: archive, shaText: `${'0'.repeat(64)}  a\n` }) });
    await expect(entryFromArchive(ctx, { target: 'macos-x64', part: 'pip', archive: { key: 'k' } }, { pip: {} })).rejects.toThrow(/does not match its \.sha256/);
  });

  test('entries this run made win; a piece not in the bucket at all is reported, not invented', async () => {
    const ctx = makeCtx();
    ctx.state.newEntries['macos-x64/pip'] = { sha256: 'f'.repeat(64), bytes: 9 };
    const prodPins = { pip: pinsFixture()['pip/pip-pin.json'], engine: pinsFixture()['engine/engine-pin.json'], redactor: { commit: 'e4ea4861f9fc' } };
    const { found, missing } = await missingEntries(ctx, prodPins, listingOf(readyKeys()));
    expect(found).toEqual({ 'macos-x64/pip': { sha256: 'f'.repeat(64), bytes: 9 } });
    expect(missing.sort()).toEqual(['linux-x64/engine', 'macos-x64/engine', 'windows-x64/engine']);
  });

  test('the pins phase stops when a piece has no entry and no archive', async () => {
    const ctx = makeCtx({ r2: fakeR2(listingOf(readyKeys())) });
    await expect(pins(ctx)).rejects.toThrow(/not in the bucket yet.*Run the pieces phase first/);
  });

  test('a dry run says what the branch would hold and changes nothing', async () => {
    const run = fakeRun();
    const ctx = makeCtx({ r2: fakeR2(listingOf(allKeys())), git: fakeGit({ files: { ...pinsFixture(), 'pip/pip-pin.json': { ...pinsFixture()['pip/pip-pin.json'], builds: { ...allPip(), 'macos-x64': undefined } } } }), dryRun: true, run });
    ctx.state.newEntries = { 'macos-x64/pip': { sha256: '5'.repeat(64), bytes: 1 } };
    await pins(ctx);
    expect(ctx.lines.join('\n')).toMatch(/would make branch release\/4\.2\.0-pins off development with .*the version 4\.2\.0 \(now 4\.1\.0\), and the engine pin's branch set to production/);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('production gate', () => {
  const ready = () => pinsFixture({ version: '4.2.0', engineBranch: 'production', pipBuilds: allPip(), engineBuilds: allEngine() });

  test('refuses while development lacks the version or a pin entry', async () => {
    const ctx = makeCtx({ git: fakeGit({ files: pinsFixture(), devFiles: pinsFixture() }), r2: fakeR2(listingOf(allKeys())) });
    await expect(gate(ctx)).rejects.toThrow(/development says version 4\.1\.0, not 4\.2\.0; not ready on development: .*macos-x64\/pip/);
  });

  test('waits for the yes, then moves production forward only and prints the handoff', async () => {
    const git = fakeGit({ files: pinsFixture(), devFiles: ready() });
    const ctx = makeCtx({ git, r2: fakeR2(listingOf(allKeys())) });
    await expect(gate(ctx)).rejects.toMatchObject({ step: 'production' });
    const yes = makeCtx({ git, r2: fakeR2(listingOf(allKeys())), yes: ['production'] });
    const { handoff } = await gate(yes);
    expect(git.calls).toContainEqual(['-C', '/srv/client', 'push', 'origin', `${CLIENT_DEV}:refs/heads/production`]);
    expect(handoff).toMatch(new RegExp(`lana-ai-client production at ${CLIENT_DEV}`));
    expect(handoff).toMatch(/npm run release -- installers --version 4\.2\.0/);
  });

  test('never moves production when it is not behind development', async () => {
    const run = fakeRun({ git: { code: 1, stdout: '', stderr: '' } });
    const ctx = makeCtx({ git: fakeGit({ files: pinsFixture(), devFiles: ready() }), r2: fakeR2(listingOf(allKeys())), run, yes: ['production'] });
    await expect(gate(ctx)).rejects.toThrow(/not behind development/);
  });

  test('the handoff holds no link, key or password', () => {
    const text = handoffText({ version: '4.2.0', commit: SERVER });
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).toMatch(/Nothing secret is in this message/);
  });
});
