'use strict';

/**
 * Pieces: which of the 12 are in the bucket and pinned, which are built,
 * where, and when a build needs Michael's yes. Builds are faked; the real
 * phase code runs.
 */

const { pieceStatus, allPieces, expectedId, archivesIn } = require('../../../scripts/release/pieces');
const { pieces, planPieces } = require('../../../scripts/release/phases/pieces');
const { pinsFixture, listingOf, readyKeys, fakeGit, fakeR2, makeCtx } = require('./fakes');

const PINS = {
  pip: pinsFixture()['pip/pip-pin.json'], engine: pinsFixture()['engine/engine-pin.json'],
  redactor: pinsFixture()['redactor/redactor-pin.json'], editor: pinsFixture()['editor/editor.lock.json']
};

describe('the bucket against the pins', () => {
  test('an archive is named by the first 12 characters of its source commit (the names in lana-build-parts)', () => {
    expect(expectedId(PINS, 'linux-x64', 'pip')).toBe('8ee218c47371');
    expect(expectedId(PINS, 'macos-arm64', 'engine')).toBe('aaaaaaaaaaaa');
    expect(expectedId(PINS, 'windows-x64', 'redactor')).toBe('e4ea4861f9fc');
    expect(expectedId(PINS, 'macos-x64', 'pip')).toBe('8ee218c47371');
  });

  test('ready, unpinned and missing', () => {
    const listing = listingOf([...readyKeys(), 'macos-x64/pip-8ee218c47371.tar.gz']);
    expect(pieceStatus({ listing, pins: PINS, target: 'linux-x64', part: 'pip' }).state).toBe('ready');
    expect(pieceStatus({ listing, pins: PINS, target: 'macos-x64', part: 'pip' })).toMatchObject({ state: 'unpinned', archive: { key: 'macos-x64/pip-8ee218c47371.tar.gz' } });
    expect(pieceStatus({ listing, pins: PINS, target: 'windows-x64', part: 'engine' }).state).toBe('missing');
  });

  test('an archive without its .sha256 does not count', () => {
    const listing = [{ key: 'linux-x64/pip-8ee218c47371.tar.gz', size: 1, modified: 'x' }];
    expect(archivesIn(listing, 'linux-x64', 'pip')[0].hasSha).toBe(false);
    expect(pieceStatus({ listing, pins: PINS, target: 'linux-x64', part: 'pip' }).state).toBe('missing');
  });

  test('an archive from another commit does not count', () => {
    const listing = listingOf(['linux-x64/pip-999999999999.tar.gz']);
    expect(pieceStatus({ listing, pins: PINS, target: 'linux-x64', part: 'pip' })).toMatchObject({ state: 'missing', reason: expect.stringMatching(/8ee218c47371/) });
  });

  test('12 pieces: 4 systems by 3 parts', () => {
    expect(allPieces({ listing: [], pins: PINS })).toHaveLength(12);
    expect(planPieces(allPieces({ listing: listingOf(readyKeys()), pins: PINS }))).toEqual({
      'macos-x64': ['pip', 'engine'], 'windows-x64': ['engine'], 'linux-x64': ['engine']
    });
  });
});

describe('the pieces phase', () => {
  const ctxWith = (keys, extra = {}) => makeCtx({ git: fakeGit({ files: pinsFixture() }), r2: fakeR2(listingOf(keys)), ...extra });

  test('skips what is in the bucket and builds nothing when all 12 are there', async () => {
    const buildMac = jest.fn();
    const ctx = ctxWith([...readyKeys(), 'macos-x64/pip-8ee218c47371.tar.gz', ...['macos-x64', 'windows-x64', 'linux-x64'].map((t) => `${t}/engine-aaaaaaaaaaaa.tar.gz`)]);
    await pieces(ctx, { buildMac, buildAzure: buildMac });
    expect(buildMac).not.toHaveBeenCalled();
    expect(ctx.lines.join('\n')).toMatch(/Every piece is in the bucket/);
    expect(ctx.report.desk).toEqual(expect.arrayContaining(['mac_x64.pip', 'windows.engine', 'linux.redactor']));
  });

  test('a dry run lists what it would build and where, and builds nothing', async () => {
    const build = jest.fn();
    const ctx = ctxWith(readyKeys(), { dryRun: true });
    await pieces(ctx, { buildMac: build, buildAzure: build });
    expect(build).not.toHaveBeenCalled();
    expect(ctx.lines.join('\n')).toMatch(/would build pip, engine for macos-x64 \(mac-rosetta\)/);
    expect(ctx.lines.join('\n')).toMatch(/would build engine for windows-x64 \(azure\)/);
  });

  test('Windows and Linux need the Azure yes before anything is built', async () => {
    const build = jest.fn(async () => []);
    const ctx = ctxWith(readyKeys());
    await expect(pieces(ctx, { buildMac: build, buildAzure: build })).rejects.toMatchObject({ code: 'APPROVAL_NEEDED', step: 'azure-vms' });
    expect(build).not.toHaveBeenCalled();
  });

  test('with the yes, every system builds at once; one failing does not stop the others; new entries are kept', async () => {
    const started = [];
    const buildMac = jest.fn(async (_ctx, target, parts) => { started.push(target); return parts.map((part) => ({ part, key: `${target}/${part}-x.tar.gz`, newEntry: part === 'pip' ? { sha256: 'f'.repeat(64), bytes: 9 } : null })); });
    const buildAzure = jest.fn(async (_ctx, target) => { started.push(target); if (target === 'windows-x64') {throw new Error('the VM did not start');} return [{ part: 'engine', key: `${target}/engine-x.tar.gz`, newEntry: { files: 3, treeSha256: 'e'.repeat(64) } }]; });
    const ctx = ctxWith(readyKeys(), { yes: ['azure-vms'] });
    await expect(pieces(ctx, { buildMac, buildAzure })).rejects.toThrow(/1 system\(s\) failed\. windows-x64: the VM did not start/);
    expect(started.sort()).toEqual(['linux-x64', 'macos-x64', 'windows-x64']);
    expect(ctx.state.newEntries).toEqual({
      'macos-x64/pip': { sha256: 'f'.repeat(64), bytes: 9 },
      'linux-x64/engine': { files: 3, treeSha256: 'e'.repeat(64) }
    });
    expect(ctx.report.built).toEqual(expect.arrayContaining(['macos-x64/pip', 'macos-x64/engine', 'linux-x64/engine']));
  });

  test('--target limits the run to one system', async () => {
    const build = jest.fn(async (_ctx, target, parts) => parts.map((part) => ({ part, key: `${target}/${part}-x.tar.gz` })));
    const ctx = ctxWith(readyKeys(), { targets: ['macos-x64'] });
    await pieces(ctx, { buildMac: build, buildAzure: build });
    expect(build).toHaveBeenCalledTimes(1);
    expect(build.mock.calls[0][1]).toBe('macos-x64');
  });
});
