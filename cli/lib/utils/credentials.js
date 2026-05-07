'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const CREDS_DIR = path.join(os.homedir(), '.lana-client');
const CREDS_PATH = path.join(CREDS_DIR, 'credentials');

const KNOWN_KEYS = [
  'APPLE_TEAM_ID',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'GITHUB_TOKEN',
  'RELEASE_EMAIL_TO',
];

function load() {
  if (!fs.existsSync(CREDS_PATH)) {
    return { found: false, values: {}, path: CREDS_PATH };
  }
  const content = fs.readFileSync(CREDS_PATH, 'utf8');
  const values = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    values[key] = val;
  }
  return { found: true, values, path: CREDS_PATH };
}

function applyToEnv(values) {
  for (const key of KNOWN_KEYS) {
    if (values[key] && !process.env[key]) {
      process.env[key] = values[key];
    }
  }
}

function ensureExists() {
  if (!fs.existsSync(CREDS_DIR)) {
    fs.mkdirSync(CREDS_DIR, { recursive: true, mode: 0o700 });
  }
  if (!fs.existsSync(CREDS_PATH)) {
    const skeleton =
      '# lana-client credentials — chmod 600\n' +
      '# Apple Developer (required for mac signing/notarization)\n' +
      'APPLE_TEAM_ID=\n' +
      'APPLE_ID=\n' +
      'APPLE_APP_SPECIFIC_PASSWORD=\n' +
      '\n' +
      '# GitHub (optional — falls back to gh auth)\n' +
      'GITHUB_TOKEN=\n' +
      '\n' +
      '# Release email To: line (optional, may be left blank)\n' +
      'RELEASE_EMAIL_TO=\n';
    fs.writeFileSync(CREDS_PATH, skeleton, { mode: 0o600 });
  } else {
    try {
      fs.chmodSync(CREDS_PATH, 0o600);
    } catch (_) {
      // best-effort
    }
  }
  return CREDS_PATH;
}

module.exports = {
  CREDS_DIR,
  CREDS_PATH,
  KNOWN_KEYS,
  load,
  applyToEnv,
  ensureExists,
};
