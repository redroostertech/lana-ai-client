'use strict';

/**
 * What the parts bucket holds for each system and piece, compared with the
 * client's pins.
 *
 * An archive is <target>/<part>-<12-char id>.tar.gz with a .sha256 beside it.
 * Its id is the first 12 characters of the commit the piece is built from:
 * LANA.cpp for Pip, LANA-AI for the engine, lana-redactor for the redactor
 * (the names in lana-build-parts for 4.2.0). Whether a build is pinned is the
 * pin's entry for that system; the content is checked against that entry when
 * it is unpacked (fetch-client-parts.js), and an archive is never overwritten.
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

/** The archive id for a piece: the first 12 characters of its source commit. */
function expectedId(pins, _target, part) {
  const commit = part === 'pip' ? pins.pip.commit : part === 'engine' ? pins.engine.commit : pins.redactor.commit;
  return commit ? String(commit).slice(0, 12) : null;
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
 *   ready       its archive and .sha256 are in the bucket and the pin has its entry
 *   unpinned    its archive is in the bucket but the pin has no entry for it yet
 *   missing     no archive for its commit: it must be built
 */
function pieceStatus({ listing, pins, target, part }) {
  const want = expectedId(pins, target, part);
  const archive = archivesIn(listing, target, part).find((a) => a.hasSha && a.id === want);
  if (!archive) {return { target, part, state: 'missing', reason: `no archive for ${want} in the bucket` };}
  return { target, part, state: pinEntry(pins, target, part) ? 'ready' : 'unpinned', archive };
}

function allPieces({ listing, pins, targets = TARGETS }) {
  return targets.flatMap((target) => PARTS.map((part) => pieceStatus({ listing, pins, target, part })));
}

module.exports = { ARCHIVE, pinEntry, expectedId, archiveKey, archivesIn, pieceStatus, allPieces };
