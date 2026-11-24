'use strict';

/**
 * The release command's Azure builds go through LANA-AI's azure-verify.sh
 * (Michael, 2026-11-23: its own service account, inside lana-verify, cleaned
 * up by run tag; the command has no Azure code of its own). It hands the
 * suite one-commit sources and, when Pip is not built there, the pinned Pip
 * checked against the pin. The registry push password comes from Heroku into
 * a private file that is removed after the push.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const builders = require('../../../scripts/release/builders');
const { registryPasswordFile } = require('../../../scripts/release/phases/server');
const { fakeRun, fakeR2, makeCtx, SERVER, PIP_COMMIT, REDACTOR } = require('./fakes');

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const PINS = {
  pip: { build: '8ee218c47371', commit: PIP_COMMIT, builds: { 'windows-x64': { sha256: sha('windows pip') } } },
  engine: { commit: SERVER, builds: {} },
  redactor: { commit: REDACTOR }
};

test('Windows engine and redactor: client-parts with one-commit sources and the checked pinned Pip; results read from <out>/<part>', async () => {
  const r2 = fakeR2();
  r2.download.mockImplementation(async (_b, _k, file) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'windows pip'); });
  const run = fakeRun({
    git: (args) => ({ code: 0, stdout: args.includes('rev-parse') ? 'x' : '', stderr: '' }),
    bash: (args) => {
      const out = args[args.indexOf('--out') + 1];
      for (const part of ['engine', 'redactor']) {
        fs.mkdirSync(path.join(out, part), { recursive: true });
        fs.writeFileSync(path.join(out, part, `${part}.tar.gz`), part);
        fs.writeFileSync(path.join(out, part, `${part}.tar.gz.sha256`), `${sha(part)}  ${part}.tar.gz\n`);
        fs.writeFileSync(path.join(out, part, 'result.json'), JSON.stringify({ id: `${part.slice(0, 3)}000000000`.slice(0, 12), newEntry: part === 'engine' ? { files: 1, treeSha256: 'e'.repeat(64) } : null, checks: [] }));
      }
      return { code: 0, stdout: '', stderr: '' };
    }
  });
  const ctx = makeCtx({ run, r2 });
  ctx.clientCommit = 'c'.repeat(40);
  const done = await builders.buildAzure(ctx, 'windows-x64', ['engine', 'redactor'], PINS);
  const call = run.mock.calls.find(([command]) => command === 'bash')[1];
  expect(call[1]).toBe('client-parts');
  expect(call).toEqual(expect.arrayContaining(['--target', 'windows-x64', '--parts', 'engine,redactor', '--client', '--engine', '--redactor', '--pip-binary']));
  expect(call).not.toContain('--lana-cpp');
  expect(r2.download.mock.calls[0][1]).toBe('windows-x64/lqe-8ee218c47371/lqe-win32-x64.exe');
  expect(done.map((d) => d.key)).toEqual(['windows-x64/engine-eng000000000.tar.gz', 'windows-x64/redactor-red000000000.tar.gz']);
  expect(done[0].newEntry).toEqual({ files: 1, treeSha256: 'e'.repeat(64) });
});

test('a pinned Pip that does not match the pin is refused', async () => {
  const r2 = fakeR2();
  r2.download.mockImplementation(async (_b, _k, file) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'something else'); });
  const ctx = makeCtx({ r2 });
  await expect(builders.pinnedPipBinary(ctx, 'windows-x64', PINS.pip)).rejects.toThrow(/is not the pinned Pip/);
});

test('the registry password comes from Heroku into a private file and is never in the error', async () => {
  const run = fakeRun({ heroku: { code: 0, stdout: 'p4ss-w0rd\n', stderr: '' } });
  const ctx = makeCtx({ run });
  const file = await registryPasswordFile(ctx);
  expect(fs.readFileSync(file, 'utf8')).toBe('p4ss-w0rd');
  expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  expect(run.mock.calls[0][1]).toEqual(['config:get', 'LANA_REGISTRY_PUSH_PASSWORD', '-a', 'redroostertec-prod']);
  const missing = makeCtx({ run: fakeRun({ heroku: { code: 0, stdout: '\n', stderr: '' } }) });
  await expect(registryPasswordFile(missing)).rejects.toThrow(/has no LANA_REGISTRY_PUSH_PASSWORD/);
});
