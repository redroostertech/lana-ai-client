'use strict';

/**
 * The macos-x64 Pip check scripts/build-pip.sh runs in place of LANA.cpp's
 * scripts/verify_release_artifact.py, which at the pinned commit accepts only darwin-arm64.
 * Every refusal has a passing control.
 */

const check = require('../../scripts/verify-pip-macos-x64');

const OTOOL_L_OK = [
  '/tmp/lqe:',
  '\t/usr/lib/libc++.1.dylib (compatibility version 1.0.0, current version 1800.105.0)',
  '\t/System/Library/Frameworks/Accelerate.framework/Versions/A/Accelerate (compatibility version 1.0.0, current version 4.0.0)',
  '\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1351.0.0)'
].join('\n');

function buildVersion(minos) {
  return [
    'Load command 9',
    '      cmd LC_BUILD_VERSION',
    '  cmdsize 32',
    ' platform 1',
    `    minos ${minos}`,
    '      sdk 15.5',
    '   ntools 1'
  ].join('\n');
}

describe('architectures', () => {
  test('x86_64 alone passes', () => {
    expect(check.checkArchs('x86_64\n')).toEqual([]);
  });
  test('arm64 is refused', () => {
    expect(check.checkArchs('arm64')).toEqual([expect.stringContaining('x86_64 only')]);
  });
  test('a universal binary is refused', () => {
    expect(check.checkArchs('x86_64 arm64')).toEqual([expect.stringContaining('x86_64 only')]);
  });
});

describe('minimum macOS', () => {
  test('minos at the floor passes', () => {
    expect(check.checkMinos(buildVersion('13.3'), '13.3')).toEqual([]);
  });
  test('minos below the floor passes', () => {
    expect(check.checkMinos(buildVersion('12.0'), '13.3')).toEqual([]);
  });
  test('minos above the floor is refused', () => {
    expect(check.checkMinos(buildVersion('14.0'), '13.3')).toEqual([expect.stringContaining('14.0')]);
  });
  test('the older LC_VERSION_MIN_MACOSX form is read', () => {
    const out = 'Load command 8\n      cmd LC_VERSION_MIN_MACOSX\n  cmdsize 16\n  version 13.3\n      sdk 15.5';
    expect(check.checkMinos(out, '13.3')).toEqual([]);
  });
  test('a binary with no minimum is refused', () => {
    expect(check.checkMinos('Load command 0\n      cmd LC_SEGMENT_64', '13.3')).toEqual([expect.stringContaining('no minimum macOS')]);
  });
});

describe('version and build id', () => {
  test('the pinned version and build pass', () => {
    expect(check.checkVersion('lqe 3.0.0 (ff965d52d578, built Nov 10 2026)', '3.0.0', 'ff965d52d578')).toEqual([]);
  });
  test('a dirty build is refused', () => {
    expect(check.checkVersion('lqe 3.0.0 (ff965d52d578-dirty, built Nov 10 2026)', '3.0.0', 'ff965d52d578')).toHaveLength(1);
  });
  test('another version is refused', () => {
    expect(check.checkVersion('lqe 2.9.0 (ff965d52d578, built Nov 10 2026)', '3.0.0', 'ff965d52d578')).toHaveLength(1);
  });
});

describe('linked libraries', () => {
  test('only /usr/lib and /System passes', () => {
    expect(check.checkDylibs(OTOOL_L_OK)).toEqual([]);
  });
  test('a Homebrew library is refused', () => {
    const out = `${OTOOL_L_OK}\n\t/usr/local/opt/libomp/lib/libomp.dylib (compatibility version 5.0.0, current version 5.0.0)`;
    expect(check.checkDylibs(out)).toEqual([expect.stringContaining('/usr/local/opt/libomp/lib/libomp.dylib')]);
  });
  test('an @rpath library is refused', () => {
    const out = `${OTOOL_L_OK}\n\t@rpath/libggml.dylib (compatibility version 0.0.0, current version 0.0.0)`;
    expect(check.checkDylibs(out)).toEqual([expect.stringContaining('@rpath/libggml.dylib')]);
  });
});
