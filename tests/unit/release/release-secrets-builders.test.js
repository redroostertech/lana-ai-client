'use strict';

/**
 * R2 keys from Heroku never reach a command line, a log or an error; links
 * are written only to the private links file; and the builders parse the
 * build scripts' new pin entries, pack the agreed archive shapes, and make
 * sources with no remote.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { readR2Keys, createR2 } = require('../../../scripts/release/r2');
const { scrub } = require('../../../scripts/release/exec');
const { parseNewEntry, packAndUpload, prepareSource } = require('../../../scripts/release/builders');
const { redactorSmoke, SAMPLE_SECRETS } = require('../../../scripts/release/smoke');
const { fakeR2, fakeRun, makeCtx } = require('./fakes');

const KEY = 'k'.repeat(32);
const SECRET = 's'.repeat(64);

describe('R2 keys', () => {
  test('are read from Heroku and handed to aws only in its environment', async () => {
    const values = { CLOUDFLARE_ACCOUNT_ID: 'acct123', R2_ACCESS_KEY: KEY, R2_SECRET_KEY: SECRET };
    const run = jest.fn(async (command, args, options = {}) => {
      if (command === 'heroku') {return { code: 0, stdout: `${values[args[1]]}\n`, stderr: '' };}
      return { code: 0, stdout: JSON.stringify({ Contents: [{ Key: 'a', Size: 1, LastModified: 't' }] }), stderr: '', options };
    });
    const keys = await readR2Keys(run, {});
    const r2 = createR2({ run, keys, env: {} });
    await r2.list('lana-build-parts', '');
    const awsCall = run.mock.calls.find(([command]) => command === 'aws');
    expect(awsCall[1].join(' ')).not.toMatch(new RegExp(`${KEY}|${SECRET}`));
    expect(awsCall[2].env).toMatchObject({ AWS_ACCESS_KEY_ID: KEY, AWS_SECRET_ACCESS_KEY: SECRET, AWS_DEFAULT_REGION: 'auto' });
  });

  test('an expired login or a broken heroku program is named, with no value in the message', async () => {
    const expired = jest.fn(async () => ({ code: 1, stdout: '', stderr: 'Error: OAuth token expired' }));
    await expect(readR2Keys(expired, {})).rejects.toThrow(/the Heroku login has expired; run heroku login/);
    const broken = jest.fn(async () => ({ code: 134, stdout: '', stderr: 'dyld: Library not loaded' }));
    await expect(readR2Keys(broken, {})).rejects.toThrow(/set LANA_HEROKU_BIN/);
    const viaNode = jest.fn(async () => ({ code: 0, stdout: 'v\n', stderr: '' }));
    await readR2Keys(viaNode, { LANA_HEROKU_BIN: '/opt/heroku/bin/heroku' });
    expect(viaNode.mock.calls[0][0]).toBe(process.execPath);
    expect(viaNode.mock.calls[0][1][0]).toBe('/opt/heroku/bin/heroku');
  });

  test('an aws error message keeps no link or key', () => {
    const text = scrub(`An error: https://acct.r2.cloudflarestorage.com/x?X-Amz-Signature=abc and key ${SECRET}`);
    expect(text).not.toMatch(/https?:|abc|s{64}/);
  });
});

describe('the build scripts\' new pin entries', () => {
  test('build-pip.sh: "Record: ..." on stderr', () => {
    const out = 'pip/pip-pin.json has no sha256 for macos-x64 yet. Record: "macos-x64": { "sha256": "' + 'a'.repeat(64) + '", "bytes": 79988968 }';
    expect(parseNewEntry('pip', out)).toEqual({ target: 'macos-x64', entry: { sha256: 'a'.repeat(64), bytes: 79988968 } });
  });

  test('build-engine.js: "(This build: ...)" in its error', () => {
    const out = 'build-engine: engine/engine-pin.json has no build for linux-x64. (This build: "linux-x64": { "files": 4986, "treeSha256": "' + 'b'.repeat(64) + '" }.)';
    expect(parseNewEntry('engine', out)).toEqual({ target: 'linux-x64', entry: { files: 4986, treeSha256: 'b'.repeat(64) } });
  });

  test('any other failure is not a new entry', () => {
    expect(parseNewEntry('pip', 'cmake failed')).toBeNull();
  });
});

describe('archives', () => {
  const realRun = (command, args, options) => require('../../../scripts/release/exec').run(command, args, options);

  test.each([
    ['pip', ['lqe'], './lqe'],
    ['redactor', ['lana-redactor/lana-redactor'], 'redactor/lana-redactor/lana-redactor']
  ])('%s: the agreed shape, a shasum-format .sha256, no ._ files, both uploaded', async (part, files, inside) => {
    const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'lana-pack-'));
    for (const file of files) {
      const full = path.join(root, 'build', part, file);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, 'bytes');
    }
    const r2 = fakeR2();
    const seen = [];
    const ctx = makeCtx({ r2, run: (command, args, options) => { seen.push({ command, options }); return realRun(command, args, options); } });
    const key = await packAndUpload(ctx, { target: 'linux-x64', part, root, id: 'abcdefabcdef' });
    expect(key).toBe(`linux-x64/${part}-abcdefabcdef.tar.gz`);
    const archive = path.join(ctx.dir, 'archives', 'linux-x64', `${part}-abcdefabcdef.tar.gz`);
    const listed = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).split('\n');
    expect(listed).toContain(inside);
    expect(listed.some((line) => path.basename(line).startsWith('._'))).toBe(false);
    // macOS adds ._ files for extended attributes unless tar is told not to.
    expect(seen.find((call) => call.command === 'tar').options.env.COPYFILE_DISABLE).toBe('1');
    expect(fs.readFileSync(`${archive}.sha256`, 'utf8')).toMatch(new RegExp(`^[0-9a-f]{64}  ${part}-abcdefabcdef\\.tar\\.gz\\n$`));
    expect(r2.upload.mock.calls.map((c) => c[2])).toEqual([key, `${key}.sha256`]);
  });
});

test('a source is one commit with no remote, so no token and no history go with it', async () => {
  const run = fakeRun({ git: (args) => ({ code: 0, stdout: args.includes('rev-parse') ? 'x' : '', stderr: '' }) });
  const ctx = makeCtx({ run });
  await prepareSource(ctx, 'redactor', 'e4ea4861f9fc3528f7fe6bfbcf058c9b4f0ef552');
  const gitCalls = run.mock.calls.filter(([command]) => command === 'git').map(([, args]) => args.slice(2));
  expect(gitCalls).toEqual([
    ['init', '--quiet'],
    ['fetch', '--quiet', '--depth', '1', 'https://github.com/redroostertech/lana-redactor.git', 'e4ea4861f9fc3528f7fe6bfbcf058c9b4f0ef552'],
    ['checkout', '--quiet', '--detach', 'FETCH_HEAD']
  ]);
  expect(gitCalls.some((args) => args[0] === 'remote')).toBe(false);
});

describe('redactor smoke test, the way the app runs it', () => {
  const binary = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'lana-red-')), 'lana-redactor');
  beforeAll(() => fs.writeFileSync(binary, ''));
  const spawned = [];
  const spawn = (command, args, options) => { spawned.push({ command, args, options }); return { kill: jest.fn() }; };
  const reply = (status, body) => ({ ok: status === 200, status, json: async () => body });

  test('passes when ready, a signed request hides the samples and an unsigned one gets 401', async () => {
    const fetchFn = jest.fn(async (url, init = {}) => {
      if (url.endsWith('/healthz')) {return reply(200, { ready: true, analyzer_ready: true });}
      if (init.headers && init.headers['X-Lana-Service-Secret']) {return reply(200, { redacted: '<PERSON_1> met <PERSON_2>. Her SSN is <SSN_1>.', token_map: { a: SAMPLE_SECRETS[0] } });}
      return reply(401, {});
    });
    expect(await redactorSmoke({ binary }, { fetch: fetchFn, spawn, freePort: async () => 4321, stepMs: 1 })).toEqual([]);
    expect(spawned[0].options.env).toMatchObject({ REDACTOR_STRICT: '1' });
    expect(spawned[0].options.env.INTERNAL_SERVICE_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(spawned[0].args).toEqual(['--host', '127.0.0.1', '--port', '4321']);
  });

  test('fails when a sample is left in place or an unsigned request is let in', async () => {
    const fetchFn = jest.fn(async (url, init = {}) => {
      if (url.endsWith('/healthz')) {return reply(200, { ready: true, analyzer_ready: true });}
      if (init.headers && init.headers['X-Lana-Service-Secret']) {return reply(200, { redacted: 'Jane Smith met <PERSON_2>.' });}
      return reply(200, {});
    });
    const problems = await redactorSmoke({ binary }, { fetch: fetchFn, spawn, freePort: async () => 4321, stepMs: 1 });
    expect(problems.join(' ')).toMatch(/left 1 of 3 sample values in place/);
    expect(problems.join(' ')).toMatch(/unsigned \/redact answered 200, not 401/);
  });
});
