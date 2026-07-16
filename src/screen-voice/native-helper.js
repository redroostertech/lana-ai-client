'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class NativeHelperError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'NativeHelperError';
    this.code = code;
  }
}

function helperCandidates(options = {}) {
  const root = options.rootDir || path.resolve(__dirname, '..', '..');
  return [
    options.helperPath,
    process.resourcesPath && path.join(process.resourcesPath, 'screen-voice', 'lana-screen-voice'),
    path.join(root, 'build', 'screen-voice', 'lana-screen-voice')
  ].filter(Boolean);
}

function resolveHelper(options = {}) {
  return helperCandidates(options).find((candidate) => fs.existsSync(candidate)) || null;
}

function runHelper(command, payload = {}, options = {}) {
  const helper = resolveHelper(options);
  if (!helper) throw new NativeHelperError('native_helper_unavailable');
  const timeoutMs = Math.min(10000, Math.max(250, Number(options.timeoutMs) || 4000));
  return new Promise((resolve, reject) => {
    const child = spawn(helper, [command], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(new NativeHelperError('native_helper_timeout'));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk).slice(0, 500); });
    child.on('error', () => finish(new NativeHelperError('native_helper_unavailable')));
    child.on('close', (code) => {
      let parsed;
      try { parsed = JSON.parse(stdout.trim() || '{}'); } catch (_) {
        return finish(new NativeHelperError('native_helper_invalid_response'));
      }
      if (code !== 0 || (parsed.ok === false && !parsed.fallback)) {
        return finish(new NativeHelperError(parsed.error || 'native_helper_failed'));
      }
      finish(null, parsed);
    });
    child.stdin.end(JSON.stringify(payload || {}));
  });
}

module.exports = { NativeHelperError, helperCandidates, resolveHelper, runHelper };
