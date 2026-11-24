'use strict';

/**
 * Fixed facts the release command works from: the four systems, the three
 * pieces, the repos, the buckets, and the Release Desk's check keys.
 */

const { PARTS } = require('../client-parts');

const TARGETS = Object.freeze(['macos-arm64', 'macos-x64', 'windows-x64', 'linux-x64']);

// The Release Desk names each system differently from the pin files.
const DESK_SYSTEM = Object.freeze({
  'macos-arm64': 'mac_arm64',
  'macos-x64': 'mac_x64',
  'windows-x64': 'windows',
  'linux-x64': 'linux'
});

const REPOS = Object.freeze({
  server: 'redroostertech/LANA-AI',
  client: 'redroostertech/lana-ai-client',
  pip: 'redroostertech/LANA.cpp',
  redactor: 'redroostertech/lana-redactor',
  editor: 'redroostertech/lana-editor'
});

const PARTS_BUCKET = 'lana-build-parts';
const RELEASES_BUCKET = 'lana-releases';
const HEROKU_APP = 'redroostertec-prod';
const LINK_SECONDS = 7 * 24 * 60 * 60;

// Where each system's pieces are built.
const BUILT_ON = Object.freeze({
  'macos-arm64': 'mac',
  'macos-x64': 'mac-rosetta',
  'windows-x64': 'azure',
  'linux-x64': 'azure'
});

// The modes, the phases each one runs, and the machine it belongs on.
const MODES = Object.freeze({
  status: { machine: 'either', phases: [] },
  parts: { machine: 'parts', phases: ['preflight', 'pieces', 'pins', 'gate'] },
  server: { machine: 'parts', phases: ['server'] },
  installers: { machine: 'installer', phases: ['preflight', 'installers'] },
  publish: { machine: 'installer', phases: ['publish', 'verify'] },
  firms: { machine: 'parts', phases: ['firms'] }
});

const PHASES = Object.freeze(['preflight', 'pieces', 'pins', 'gate', 'server', 'installers', 'publish', 'firms', 'verify']);

// The steps that need Michael's yes. The key is what goes after --yes.
const APPROVALS = Object.freeze({
  'azure-vms': 'create Azure VMs for this run (each one is deleted when it is done)',
  production: 'move client development to production',
  'server-release': 'publish the signed server update and stamp it in the portal',
  'railway-images': 'push the Railway images and set the control plane image variables and update policy',
  'upload-installers': 'upload the installers and update feeds to releases.lanaai.io',
  'firm-update': 'update a firm\'s server',
  promote: 'promote the app to a firm'
});

function deskKey(target, part) {
  return `${DESK_SYSTEM[target]}.${part}`;
}

module.exports = {
  TARGETS, PARTS, DESK_SYSTEM, REPOS, PARTS_BUCKET, RELEASES_BUCKET, HEROKU_APP, LINK_SECONDS,
  BUILT_ON, MODES, PHASES, APPROVALS, deskKey
};
