'use strict';

/**
 * Runs a program and collects its output. Every outside program the release
 * command uses goes through here, so tests replace this one function.
 *
 * Long builds write their output to a log file instead of the screen: four
 * systems build at once, and their lines would mix.
 */

const fs = require('fs');
const { spawn } = require('child_process');

/**
 * @param {string} command
 * @param {string[]} args
 * @param {Object} [options]
 * @param {string} [options.cwd]
 * @param {Object} [options.env] - the whole environment for the program
 * @param {string} [options.input] - written to its stdin
 * @param {string} [options.logFile] - append its output here instead of keeping it
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
function run(command, args = [], options = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { cwd: options.cwd, env: options.env || process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ code: 127, stdout: '', stderr: error.message });
      return;
    }
    const log = options.logFile ? fs.createWriteStream(options.logFile, { flags: 'a', mode: 0o600 }) : null;
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { if (log) {log.write(chunk);} else {stdout += chunk;} });
    child.stderr.on('data', (chunk) => {
      if (log) {log.write(chunk);}
      // Keep the end of stderr even when logging, for the error message.
      stderr = (stderr + chunk).slice(-8000);
    });
    child.on('error', (error) => { stderr += error.message; });
    child.on('close', (code) => {
      if (log) {log.end();}
      resolve({ code: code === null ? 1 : code, stdout, stderr });
    });
    if (options.input) {child.stdin.write(options.input);}
    child.stdin.end();
  });
}

/** Text that may hold a link or a key, cut down to something safe to print. */
function scrub(text) {
  return String(text || '')
    .replace(/https?:\/\/\S+/g, '<link>')
    .replace(/\b[A-Za-z0-9+/=_-]{32,}\b/g, '<hidden>')
    .trim()
    .slice(-400);
}

module.exports = { run, scrub };
