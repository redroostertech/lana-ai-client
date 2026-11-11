#!/usr/bin/env node
'use strict';

/**
 * Checks a macos-x64 Pip (lqe) build before scripts/build-pip.sh places it. LANA.cpp's own
 * scripts/verify_release_artifact.py at the pinned commit (ff965d52d578, v3.0.0) accepts only
 * darwin-arm64 for macOS, so build-pip.sh runs this check for macos-x64 instead of skipping
 * verification. macos-arm64 stays on LANA.cpp's checker.
 *
 *   the Mach-O holds x86_64 only                    (lipo -archs)
 *   its minimum macOS is at or below the floor      (otool -l: LC_BUILD_VERSION minos)
 *   lqe --version reports the pinned version/build  (never a -dirty build)
 *   it links nothing outside /usr/lib and /System   (otool -L)
 *
 * LANA.cpp's own tests (ctest) run in build-pip.sh before this, as for every platform.
 *
 *   node scripts/verify-pip-macos-x64.js <binary> <version> <build> <macos-floor>
 */

const { execFileSync } = require('child_process');

function checkArchs(lipoArchs) {
  const archs = lipoArchs.trim().split(/\s+/).filter(Boolean);
  if (archs.length === 1 && archs[0] === 'x86_64') {return [];}
  return [`The binary must be x86_64 only; lipo reports: ${archs.join(' ') || 'nothing'}.`];
}

function versionParts(text) {
  return text.split('.').map((part) => Number.parseInt(part, 10) || 0);
}

function atOrBelow(have, floor) {
  const a = versionParts(have);
  const b = versionParts(floor);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] || 0) !== (b[i] || 0)) {return (a[i] || 0) < (b[i] || 0);}
  }
  return true;
}

function minosOf(otoolL) {
  const lines = otoolL.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const cmd = lines[i].trim();
    if (cmd === 'cmd LC_BUILD_VERSION' || cmd === 'cmd LC_VERSION_MIN_MACOSX') {
      const field = cmd === 'cmd LC_BUILD_VERSION' ? 'minos' : 'version';
      for (let j = i + 1; j < lines.length && !lines[j].startsWith('Load command'); j += 1) {
        const match = lines[j].trim().match(new RegExp(`^${field}\\s+(\\S+)$`));
        if (match) {return match[1];}
      }
    }
  }
  return null;
}

function checkMinos(otoolL, floor) {
  const minos = minosOf(otoolL);
  if (!minos) {return ['The binary records no minimum macOS (no LC_BUILD_VERSION or LC_VERSION_MIN_MACOSX).'];}
  if (!atOrBelow(minos, floor)) {return [`The binary needs macOS ${minos}, above the ${floor} floor.`];}
  return [];
}

function checkVersion(reported, version, build) {
  const want = `lqe ${version} (${build}, built `;
  if (reported.trim().startsWith(want)) {return [];}
  return [`The build reports "${reported.trim()}", expected it to start with "${want}". A -dirty build is never packaged.`];
}

function checkDylibs(otoolCapitalL) {
  const problems = [];
  for (const line of otoolCapitalL.split('\n').slice(1)) {
    const lib = line.trim().split(' (')[0];
    if (!lib) {continue;}
    if (!lib.startsWith('/usr/lib/') && !lib.startsWith('/System/')) {
      problems.push(`The binary links ${lib}, outside /usr/lib and /System; a customer Mac may not have it.`);
    }
  }
  return problems;
}

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' });
}

function main(argv) {
  const [binary, version, build, floor] = argv;
  if (!binary || !version || !build || !floor) {
    throw new Error('Usage: verify-pip-macos-x64.js <binary> <version> <build> <macos-floor>');
  }
  const problems = [
    ...checkArchs(run('lipo', ['-archs', binary])),
    ...checkMinos(run('otool', ['-l', binary]), floor),
    ...checkVersion(run(binary, ['--version']), version, build),
    ...checkDylibs(run('otool', ['-L', binary]))
  ];
  if (problems.length) {throw new Error(problems.join(' '));}
  process.stdout.write(`${binary}: x86_64 only, macOS floor ${floor}, lqe ${version} (${build}), links only /usr/lib and /System.\n`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`verify-pip-macos-x64: ${error.message}\n`);
    process.exit(1);
  }
}

module.exports = { checkArchs, checkMinos, checkVersion, checkDylibs, minosOf };
