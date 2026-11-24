'use strict';

/**
 * Review of 5866c7cc: each finding as a test that failed before its fix.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { VERSION_FILES, pins } = require('../../../scripts/release/phases/pins');
const builders = require('../../../scripts/release/builders');
const { checkBuilds, EXPECTED_NAMES } = require('../../../scripts/release/phases/installers');
const { server } = require('../../../scripts/release/phases/server');
const { scrub } = require('../../../scripts/release/exec');
const { pinsFixture, listingOf, fakeGit, fakeR2, fakeRun, makeCtx, allPip, allEngine, allKeys, SERVER } = require('./fakes');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const tmp = (name) => fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), name));

test('1. the version files staged are the tracked ones (public_html is a symbolic link to src)', () => {
  for (const file of VERSION_FILES) {
    expect(fs.lstatSync(path.join(ROOT, path.dirname(file))).isSymbolicLink()).toBe(false);
    expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
  }
  expect(VERSION_FILES).toContain('src/js/version.js');
});

test('2. each Mac system gets its own source folders, so the two parallel builds never share one', async () => {
  const ctx = makeCtx({ run: fakeRun() });
  const a = await builders.prepareSource(ctx, 'server', SERVER, 'macos-arm64');
  const b = await builders.prepareSource(ctx, 'server', SERVER, 'macos-x64');
  expect(a).not.toBe(b);
});

describe('3. the engine build runs the Node on the build\'s PATH (the x64 one under Rosetta), not this process\'s', () => {
  test('engineNode', () => {
    expect(builders.engineCommand()).toBe('node');
  });
});

describe('4. installer checks look where electron-builder writes the Mac apps, and name each file exactly', () => {
  test('apps under dist/mac-arm64 and dist/mac are found; a Mac zip is not taken for the Windows zip', async () => {
    const dist = tmp('lana-dist-');
    const v = '4.2.0';
    for (const name of [`LanaAI--genesis--${v}-arm64.dmg`, `LanaAI--genesis--${v}-x64.zip`]) {fs.writeFileSync(path.join(dist, name), 'x');}
    fs.mkdirSync(path.join(dist, 'mac-arm64', 'LANA AI.app'), { recursive: true });
    fs.mkdirSync(path.join(dist, 'mac', 'LANA AI.app'), { recursive: true });
    const ctx = makeCtx({ mode: 'installers', run: fakeRun() });
    const problems = (await checkBuilds(ctx, dist)).join('\n');
    expect(problems).not.toMatch(/no \.app/);
    expect(problems).toMatch(new RegExp(`windows-x64: no LanaAI--genesis--${v.replace(/\./g, '\\.')}\\.zip`));
    expect(EXPECTED_NAMES('4.2.0')['windows-x64']).toContain('LanaAI--genesis--4.2.0.zip');
  });
});

describe('5. a build script\'s printed entry is a new build only when the pin has none for that very system', () => {
  test.each([
    ['the pin already has an entry (a mismatch, not a new build)', { 'linux-x64': { files: 1, treeSha256: 'a'.repeat(64) } }, 'linux-x64', false],
    ['the printed system is another one', {}, 'macos-x64', false],
    ['no entry for this system', {}, 'linux-x64', true]
  ])('%s', (_label, builds, target, accepted) => {
    const out = `(This build: "linux-x64": { "files": 3, "treeSha256": "${'b'.repeat(64)}" }.)`;
    expect(Boolean(builders.acceptNewEntry({ part: 'engine', output: out, target, pin: { builds } }))).toBe(accepted);
  });
});

describe('6. a rerun after the pins branch is pushed or merged does not commit again', () => {
  const readyDev = () => pinsFixture({ version: '4.2.0', engineBranch: 'production', pipBuilds: allPip(), engineBuilds: allEngine() });

  test('development already has every entry and the version: nothing to do, go on to the gate', async () => {
    const run = fakeRun();
    const ctx = makeCtx({ git: fakeGit({ files: pinsFixture(), devFiles: readyDev() }), r2: fakeR2(listingOf(allKeys())), run });
    const result = await pins(ctx);
    expect(result.stop).toBeFalsy();
    expect(run).not.toHaveBeenCalled();
    expect(ctx.lines.join('\n')).toMatch(/development already has/);
  });

  test('the branch was pushed but not merged yet: wait for the review, commit nothing', async () => {
    const run = fakeRun();
    const git = fakeGit({ files: pinsFixture(), devFiles: pinsFixture() });
    const ctx = makeCtx({ git, r2: fakeR2(listingOf(allKeys())), run });
    ctx.state.pinsBranch = 'release/4.2.0-pins';
    ctx.state.newEntries = { 'macos-x64/pip': { sha256: '5'.repeat(64) } };
    const result = await pins(ctx);
    expect(result.stop).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(git.calls.some((args) => args.includes('commit') || args.includes('push'))).toBe(false);
  });
});

test('7. a server release waiting for its attestation is never run again from the top', async () => {
  const files = tmp('lana-srv-');
  const out = path.join(files, 'pw');
  fs.writeFileSync(out, 'x');
  const run = fakeRun();
  const ctx = makeCtx({ mode: 'server', run, serverVersion: '3.1.0', git: fakeGit({ files: pinsFixture(), head: SERVER }), yes: ['azure-vms', 'railway-images', 'server-release'] });
  ctx.state.imagesPushed = { vars: {} };
  ctx.state.serverStaged = { version: '3.1.0', commit: SERVER };
  const envDir = path.join(ctx.dir, 'railway-images', SERVER.slice(0, 12));
  fs.mkdirSync(envDir, { recursive: true });
  fs.writeFileSync(path.join(envDir, 'railway-images.env'), ['CHEF', 'EMBED', 'REDACTOR', 'MINIO'].map((n) => `RAILWAY_IMAGE_${n}=r/lana-${n.toLowerCase()}@sha256:${'a'.repeat(64)}`).join('\n'));
  await expect(server(ctx, { railwayRedactorCommit: 'f'.repeat(40), registryPasswordFile: out, signingKeyFile: out })).rejects.toThrow(/waiting for its attestation/);
  const releaseRuns = run.mock.calls.filter(([command, args]) => command === 'bash' && String(args[0]).endsWith('release.sh') && !args.includes('--pins-only'));
  expect(releaseRuns).toHaveLength(0);
});

test('9. a server dry run runs and writes nothing', async () => {
  const run = fakeRun();
  const ctx = makeCtx({ mode: 'server', run, serverVersion: '3.1.0', git: fakeGit({ files: pinsFixture(), head: SERVER }), dryRun: true });
  await server(ctx, { railwayRedactorCommit: 'f'.repeat(40) });
  expect(run).not.toHaveBeenCalled();
  expect(fs.existsSync(ctx.dir)).toBe(false);
});

test('10. scrub hides a SAS or presigned signature even without its link', () => {
  const text = scrub('failed: sv=2024-01-01&se=2026-12-01&sp=r&sig=abc%2Bdef%3D and X-Amz-Signature=0123abcd');
  expect(text).not.toMatch(/abc%2Bdef|0123abcd/);
});

test('8. a client checkout made by an earlier run is moved to this run\'s production commit', async () => {
  const run = fakeRun();
  const ctx = makeCtx({ run });
  ctx.clientCommit = 'c'.repeat(40);
  fs.mkdirSync(path.join(ctx.dir, 'client', 'macos-x64'), { recursive: true });
  await builders.clientCheckout(ctx, 'macos-x64');
  expect(run.mock.calls[0][1]).toEqual(['-C', path.join(ctx.dir, 'client', 'macos-x64'), 'checkout', '--quiet', '--detach', 'c'.repeat(40)]);
});
