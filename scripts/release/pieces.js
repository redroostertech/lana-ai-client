'use strict';

/**
 * What the parts bucket holds for each system and piece, compared with the
 * client's pins.
 *
 * An archive is <target>/<part>-<12-char id>.tar.gz with a .sha256 beside it.
 * Its id is the start of what the pin records for that build: Pip's sha256,
 * the engine's tree sha256, the redactor's lana-redactor commit. So the
 * archive that belongs to a pin entry can be found by name.
 */

const { TARGETS, PARTS } = require('./config');

const ARCHIVE = /^(macos-arm64|macos-x64|windows-x64|linux-x64)\/(pip|engine|redactor)-([0-9a-f]{12})\.tar\.gz$/;

/** The pin's record for one built piece, or null when the pin has none yet. */
function pinEntry(pins, target, part) {
  if (part === 'pip') {return (pins.pip.builds || {})[target] || null;}
  if (part === 'engine') {return (pins.engine.builds || {})[target] || null;}
  // The redactor pin records the commit only, the same for every system.
  return pins.redactor && pins.redactor.commit ? { commit: pins.redactor.commit } : null;
}

/** The archive id a pin entry points at, or null when the pin has no entry. */
function expectedId(pins, target, part) {
  const entry = pinEntry(pins, target, part);
  if (!entry) {return null;}
  const value = part === 'pip' ? entry.sha256 : part === 'engine' ? entry.treeSha256 : entry.commit;
  return value ? String(value).slice(0, 12) : null;
}

function archiveKey(target, part, id) {
  return `${target}/${part}-${id}.tar.gz`;
}

/** Archives in a bucket listing for one system and piece, newest first, with whether each has its .sha256. */
function archivesIn(listing, target, part) {
  const keys = new Set(listing.map((item) => item.key));
  return listing
    .map((item) => ({ item, match: ARCHIVE.exec(item.key) }))
    .filter(({ match }) => match && match[1] === target && match[2] === part)
    .map(({ item, match }) => ({ key: item.key, id: match[3], size: item.size, modified: item.modified, hasSha: keys.has(`${item.key}.sha256`) }))
    .sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
}

/**
 * One piece's state:
 *   ready       the pin has an entry and its archive and .sha256 are in the bucket
 *   unpinned    an archive is in the bucket but the pin has no entry for it yet
 *   missing     nothing usable in the bucket: it must be built
 */
function pieceStatus({ listing, pins, target, part }) {
  const archives = archivesIn(listing, target, part).filter((a) => a.hasSha);
  const want = expectedId(pins, target, part);
  if (want) {
    const archive = archives.find((a) => a.id === want);
    if (archive) {return { target, part, state: 'ready', archive };}
    return { target, part, state: 'missing', reason: `the pin's build (${want}) is not in the bucket` };
  }
  if (archives.length) {return { target, part, state: 'unpinned', archive: archives[0] };}
  return { target, part, state: 'missing', reason: 'not built yet' };
}

function allPieces({ listing, pins, targets = TARGETS }) {
  return targets.flatMap((target) => PARTS.map((part) => pieceStatus({ listing, pins, target, part })));
}

module.exports = { ARCHIVE, pinEntry, expectedId, archiveKey, archivesIn, pieceStatus, allPieces };
