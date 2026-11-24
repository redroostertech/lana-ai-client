'use strict';

/**
 * The release command (scripts/release.js): its options, its exit codes, the
 * state file, and stop-and-ask. Michael, 2026-11-23: one command per machine,
 * resumable, that stops at every outward step and never prints a secret.
 */

const fs = require('fs');
const path = require('path');
const { main, parseArgs } = require('../../../scripts/release');
const { requireYes, parseYes, WAITING_EXIT } = require('../../../scripts/release/approvals');
const { saveState, loadState, releaseDir } = require('../../../scripts/release/state');
const { summary } = require('../../../scripts/release/summary');
const { pinsFixture, listingOf, fakeGit, fakeR2, fakeRun, makeCtx, allPip, allEngine, allKeys } = require('./fakes');

describe('options', () => {
  test('a mode, a version, systems, a phase and yeses', () => {
    const options = parseArgs(['parts', '--version', '4.2.0', '--target', 'macos-x64', '--phase', 'pieces', '--yes', 'azure-vms,production', '--dry-run']);
    expect(options).toMatchObject({ mode: 'parts', version: '4.2.0', targets: ['macos-x64'], phase: 'pieces', dryRun: true });
    expect([...options.yes]).toEqual(['azure-vms', 'production']);
  });

  test.each([
    [['ship', '--version', '4.2.0'], /mode/],
    [['parts'], /--version/],
    [['parts', '--version', '4.2.0', '--target', 'macos-ppc'], /--target macos-ppc/],
    [['parts', '--version', '4.2.0', '--phase', 'publish'], /belongs to another mode/],
    [['parts', '--version', '4.2.0', '--yes', 'everything'], /not a step that needs a yes/],
    [['parts', '--version', '4.2.0', '--force'], /Unknown option/]
  ])('%j is refused', (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });
});

describe('stop and ask', () => {
  test('a step without its yes stops with what it waits for and how to go on', () => {
    expect(() => requireYes({ yes: new Set() }, 'production', 'client production')).toThrow(/Waiting on Michael: move client development to production \(client production\)\. After his yes, run again with --yes production\./);
    expect(requireYes({ yes: parseYes(['production']) }, 'production')).toBe(true);
  });

  test('the run ends with exit 10 and the summary names the step', async () => {
    const lines = [];
    const git = fakeGit({ files: pinsFixture({ version: '4.2.0', engineBranch: 'production' }), devFiles: pinsFixture({ version: '4.2.0', engineBranch: 'production', pipBuilds: allPip(), engineBuilds: allEngine() }) });
    const run = fakeRun({ git: { code: 0, stdout: '', stderr: '' } });
    const home = fs.mkdtempSync(path.join(process.env.TMPDIR || require('os').tmpdir(), 'lana-release-'));
    const code = await main(['parts', '--version', '4.2.0', '--phase', 'gate', '--client-root', '/srv/client'], {
      git, r2: fakeR2(listingOf(allKeys())), run, home, log: (line) => lines.push(line)
    });
    expect(code).toBe(WAITING_EXIT);
    expect(lines.join('\n')).toMatch(/Waiting on Michael: move client development to production/);
    expect(git.calls.some((args) => args.includes('push'))).toBe(false);
  });
});

describe('state', () => {
  test('lives in a private folder, survives a rerun, and refuses a version that is not x.y.z', () => {
    const home = fs.mkdtempSync(path.join(process.env.TMPDIR || require('os').tmpdir(), 'lana-release-'));
    const state = loadState('4.2.0', home);
    state.pieces['macos-x64/pip'] = { key: 'macos-x64/pip-abc.tar.gz' };
    const file = saveState(state, home);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    expect(loadState('4.2.0', home).pieces['macos-x64/pip'].key).toBe('macos-x64/pip-abc.tar.gz');
    expect(() => releaseDir('4.2.0-pre', home)).toThrow(/three numbers/);
  });
});

test('the summary says what was built and uploaded, the Desk keys, and what waits on Michael', () => {
  const ctx = makeCtx();
  ctx.report.built.push('macos-x64/pip');
  ctx.report.uploaded.push('lana-build-parts/macos-x64/pip-abc.tar.gz');
  ctx.desk('mac_x64.pip', 'gate.servercode');
  ctx.report.waiting.push('Review branch release/4.2.0-pins');
  const text = summary(ctx, 'done');
  expect(text).toMatch(/Built: macos-x64\/pip/);
  expect(text).toMatch(/Uploaded: lana-build-parts\/macos-x64\/pip-abc\.tar\.gz/);
  expect(text).toMatch(/Release Desk boxes to tick: mac_x64\.pip, gate\.servercode/);
  expect(text).toMatch(/- Review branch release\/4\.2\.0-pins/);
});
