'use strict';

/**
 * Preflight, installers, publish, verify, server and firms: what each one
 * refuses, what it asks for, and the order it does things in.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { preflight } = require('../../../scripts/release/phases/preflight');
const { installers, makeLinksFile, checkResources, BUILDS } = require('../../../scripts/release/phases/installers');
const { publish, verify, uploadOrder, feedFiles } = require('../../../scripts/release/phases/publish');
const { server, readImageVars } = require('../../../scripts/release/phases/server');
const { firms } = require('../../../scripts/release/phases/firms');
const { allPieces } = require('../../../scripts/release/pieces');
const { pinsFixture, listingOf, readyKeys, fakeGit, fakeR2, fakeRun, makeCtx, allPip, allEngine, allKeys, SERVER } = require('./fakes');

const tmp = (name) => fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), name));
const df = { code: 0, stdout: 'Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/disk 1 1 209715200 1% /\n', stderr: '' };

describe('preflight', () => {
  test('parts machine: every check runs and every failure is listed, not just the first', async () => {
    const git = fakeGit({ files: pinsFixture(), tips: { 'redroostertech/LANA-AI:production': 'b'.repeat(40) }, reachable: false, editorServer: 'f'.repeat(40) });
    const run = fakeRun({ df, az: { code: 1, stdout: '', stderr: 'Please run az login' } });
    const ctx = makeCtx({ git, run, r2: fakeR2(listingOf(readyKeys())) });
    const error = await preflight(ctx).catch((e) => e);
    const failed = error.checks.filter((c) => !c.ok).map((c) => c.name);
    expect(failed).toEqual(expect.arrayContaining(['Engine pin is the server production commit', 'Redactor pin is on lana-redactor main', 'Editor locks match', 'Editor commit is on lana-editor production', 'Azure login']));
    expect(ctx.report.desk).not.toContain('gate.servercode');
  });

  test('installer machine: the version, the 12 pieces, signing and notarization', async () => {
    const run = fakeRun({ df, security: { code: 0, stdout: '0 valid identities found', stderr: '' } });
    const ctx = makeCtx({ mode: 'installers', git: fakeGit({ files: pinsFixture() }), run, r2: fakeR2(listingOf(readyKeys())), env: { APPLE_ID: 'x' } });
    const error = await preflight(ctx).catch((e) => e);
    const byName = Object.fromEntries(error.checks.map((c) => [c.name, c]));
    expect(byName['Version set']).toMatchObject({ ok: false, detail: 'client production says 4.1.0, this release is 4.2.0' });
    expect(byName['All 12 pieces in R2 with pin entries'].detail).toMatch(/macos-x64\/pip \(missing\)/);
    expect(byName['Apple signing identity'].ok).toBe(false);
    expect(byName['Notarization settings'].detail).toBe('not set: APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID');
  });
});

describe('installers', () => {
  const readyPins = () => pinsFixture({ version: '4.2.0', engineBranch: 'production', pipBuilds: allPip(), engineBuilds: allEngine() });

  test('refuses to build anything unless all 12 pieces are ready', async () => {
    const run = fakeRun();
    const ctx = makeCtx({ mode: 'installers', git: fakeGit({ files: pinsFixture() }), r2: fakeR2(listingOf(readyKeys())), run });
    await expect(installers(ctx)).rejects.toThrow(/not every piece is ready: macos-x64\/pip/);
    expect(run).not.toHaveBeenCalled();
  });

  test('the links file: 24 lines of links, private (600), and no link is ever logged', async () => {
    const pins = { pip: readyPins()['pip/pip-pin.json'], engine: readyPins()['engine/engine-pin.json'], redactor: readyPins()['redactor/redactor-pin.json'] };
    const statuses = allPieces({ listing: listingOf(allKeys()), pins });
    const ctx = makeCtx({ mode: 'installers', r2: fakeR2() });
    const { file } = await makeLinksFile(ctx, statuses);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(lines.filter((l) => !l.startsWith('#'))).toHaveLength(24);
    expect(lines).toContain(`linux-x64/engine https://secret.example/linux-x64/engine-999999999999.tar.gz?X-Amz-Signature=${'f'.repeat(64)}`);
    expect(ctx.lines.join('\n')).not.toMatch(/secret\.example/);
  });

  test('all four builds in one session, Mac Apple chip first and --publish only on the last', async () => {
    const ctx = makeCtx({ mode: 'installers', git: fakeGit({ files: readyPins() }), r2: fakeR2(listingOf(allKeys())), dryRun: true });
    ctx.clientRoot = tmp('lana-client-');
    fs.mkdirSync(path.join(ctx.clientRoot, 'node_modules'));
    await installers(ctx);
    const builds = ctx.lines.filter((l) => l.includes('build-client.sh'));
    expect(builds.map((l) => l.trim())).toEqual(BUILDS.map((b, i) => `build-client.sh --auto-discovery ${b.args.join(' ')} --skip-install${i === 3 ? ' --publish' : ''}`));
    expect(BUILDS.map((b) => b.target)).toEqual(['macos-arm64', 'macos-x64', 'windows-x64', 'linux-x64']);
  });

  test('the packed app keeps the data folder name "Lana AI" and carries the editor and Briefs speech', () => {
    const resources = tmp('lana-res-');
    const asar = (productName) => ({ extractFile: () => Buffer.from(JSON.stringify({ productName })) });
    expect(checkResources('linux-x64', resources, { asar: asar('LANA AI') })).toEqual([
      'linux-x64: the document editor is not packed',
      'linux-x64: Briefs speech (sherpa-onnx for this system) is not packed',
      'linux-x64: app.asar says productName "LANA AI"; it must stay "Lana AI" so people keep their data'
    ]);
    fs.mkdirSync(path.join(resources, 'lana-editor'));
    fs.mkdirSync(path.join(resources, 'app.asar.unpacked', 'node_modules', 'sherpa-onnx-linux-x64'), { recursive: true });
    expect(checkResources('linux-x64', resources, { asar: asar('Lana AI') })).toEqual([]);
  });
});

describe('publish and verify', () => {
  const staged = () => {
    const root = tmp('lana-pub-');
    for (const key of ['client/latest-mac.yml', 'client/latest.yml', 'client/4.2.0/LanaAI--genesis--4.2.0-arm64.dmg', 'client/latest/LANA-mac-arm64.dmg', 'client/latest-linux.yml']) {
      const file = path.join(root, 'dist', 'r2', key);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'x');
    }
    return root;
  };

  test('feeds go last', () => {
    expect(uploadOrder(['client/latest-mac.yml', 'client/4.2.0/a.dmg', 'client/latest/LANA-mac-arm64.dmg', 'client/latest.yml']))
      .toEqual(['client/4.2.0/a.dmg', 'client/latest/LANA-mac-arm64.dmg', 'client/latest-mac.yml', 'client/latest.yml']);
  });

  test('nothing is uploaded without the yes; with it, the feeds land last', async () => {
    const r2 = fakeR2();
    const ctx = makeCtx({ mode: 'publish', r2 });
    ctx.clientRoot = staged();
    await expect(publish(ctx)).rejects.toMatchObject({ step: 'upload-installers' });
    expect(r2.upload).not.toHaveBeenCalled();
    const yes = makeCtx({ mode: 'publish', r2, yes: ['upload-installers'] });
    yes.clientRoot = ctx.clientRoot;
    await publish(yes);
    const keys = r2.upload.mock.calls.map((c) => c[2]);
    expect(keys.slice(-3).every((k) => /^client\/latest[^/]*\.yml$/.test(k))).toBe(true);
    expect(yes.report.desk).toEqual(['day.uploaded', 'inst.feeds']);
  });

  test('verify checks every link and every file a feed names', async () => {
    expect(feedFiles('version: 4.2.0\nfiles:\n  - url: 4.2.0/a-arm64.zip\n    sha512: x\npath: 4.2.0/a-arm64.zip\n')).toEqual(['client/4.2.0/a-arm64.zip']);
    const ctx = makeCtx({ mode: 'publish' });
    ctx.state.published = { keys: ['client/4.2.0/a-arm64.zip', 'client/latest-mac.yml'] };
    const fetchFn = jest.fn(async (url, init = {}) => {
      if (init.method === 'HEAD') {return { status: url.endsWith('b-x64.zip') ? 404 : 200 };}
      return { text: async () => 'version: 4.2.0\nfiles:\n  - url: 4.2.0/a-arm64.zip\n  - url: 4.2.0/b-x64.zip\n' };
    });
    await expect(verify(ctx, { fetch: fetchFn })).rejects.toThrow(/client\/4\.2\.0\/b-x64\.zip answered 404/);
  });
});

describe('server and firms', () => {
  test('the four Railway images, by digest', () => {
    const file = path.join(tmp('lana-img-'), 'railway-images.env');
    const digest = 'a'.repeat(64);
    fs.writeFileSync(file, ['CHEF', 'EMBED', 'REDACTOR'].map((n) => `RAILWAY_IMAGE_${n}=registry.example/lana-${n.toLowerCase()}@sha256:${digest}`).join('\n'));
    expect(() => readImageVars(file)).toThrow(/lacks RAILWAY_IMAGE_MINIO/);
    fs.appendFileSync(file, `\nRAILWAY_IMAGE_MINIO=registry.example/lana-minio@sha256:${digest}\n`);
    expect(Object.keys(readImageVars(file))).toHaveLength(4);
  });

  test('a classifier archive missing from the model bucket stops the server release before anything is built', async () => {
    const run = fakeRun({ bash: (args) => ({ code: args.includes('--pins-only') ? 1 : 0, stdout: '', stderr: '' }) });
    const ctx = makeCtx({ mode: 'server', run, serverVersion: '3.1.0', git: fakeGit({ files: pinsFixture(), head: SERVER }) });
    await expect(server(ctx, { railwayRedactorCommit: 'f'.repeat(40) })).rejects.toThrow(/step 0/);
    expect(run.mock.calls.filter(([command]) => command === 'bash')).toHaveLength(1);
    expect(ctx.report.waiting.join(' ')).toMatch(/publish it first/);
  });

  test('the Railway images need the Azure yes, then the push yes', async () => {
    const run = fakeRun();
    const ctx = makeCtx({ mode: 'server', run, serverVersion: '3.1.0', git: fakeGit({ files: pinsFixture(), head: SERVER }) });
    await expect(server(ctx, { railwayRedactorCommit: 'f'.repeat(40) })).rejects.toMatchObject({ step: 'azure-vms' });
  });

  test('firms: nothing is promoted; the run prints what to check for boxes and cloud firms and waits', async () => {
    const ctx = makeCtx({ mode: 'firms', serverVersion: '3.1.0' });
    const result = await firms(ctx);
    expect(result.stop).toBe(true);
    const text = ctx.lines.join('\n');
    expect(text).toMatch(/Hardware boxes \(on-prem\): the box's server version must be 3\.1\.0 or newer/);
    expect(text).toMatch(/Cloud firms \(Railway\)/);
    expect(ctx.report.waiting.join(' ')).toMatch(/Norton first/);
  });
});
