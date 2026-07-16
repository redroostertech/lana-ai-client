'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function discoveryPath({ platform = process.platform, env = process.env, namespace }) {
  if (platform === 'win32') {
    if (!env.LOCALAPPDATA) throw discoveryError();
    return path.join(env.LOCALAPPDATA, 'Lana', namespace, 'relay.json');
  }
  const base = platform === 'darwin' ? '/tmp' : env.XDG_RUNTIME_DIR;
  if (!base) throw discoveryError();
  const user = typeof process.getuid === 'function' ? process.getuid() : 'user';
  const leaf = `lana-mcp-${user}-${crypto.createHash('sha256').update(namespace).digest('hex').slice(0, 12)}`;
  return path.join(base, leaf, 'relay.json');
}

function readDiscovery(options) {
  const filename = discoveryPath(options); const parent = path.dirname(filename);
  const parentStat = fs.lstatSync(parent); const fileStat = fs.lstatSync(filename);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || fileStat.isSymbolicLink() || !fileStat.isFile()) throw discoveryError();
  if (process.platform !== 'win32' && ((parentStat.mode & 0o077) !== 0 || (fileStat.mode & 0o077) !== 0)) throw discoveryError();
  const metadata = JSON.parse(fs.readFileSync(filename, 'utf8'));
  const allowed = ['formatVersion', 'profileId', 'instanceId', 'endpointType', 'endpointName', 'appPid', 'appBuild', 'createdAt', 'expiresAt', 'discoveryNonce', 'trustNamespace'];
  if (!metadata || Object.keys(metadata).some((key) => !allowed.includes(key)) || metadata.formatVersion !== 1 || metadata.trustNamespace !== options.namespace ||
      !['unix', 'named-pipe'].includes(metadata.endpointType) || typeof metadata.endpointName !== 'string' || metadata.expiresAt <= Date.now()) throw discoveryError();
  return Object.freeze(metadata);
}
function discoveryError() { const error = new Error('Desktop relay discovery failed'); error.code = 'APP_NOT_RUNNING'; return error; }
module.exports = { discoveryPath, readDiscovery };
