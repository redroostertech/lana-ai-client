'use strict';

/**
 * Cloudflare R2, through the aws command. The keys are read from Heroku
 * inside this process and handed only to the aws program's environment. They
 * are never printed, never written to a file, and never put on a command
 * line. Error messages name the bucket and key only.
 */

const fs = require('fs');
const path = require('path');
const { HEROKU_APP } = require('./config');
const { scrub } = require('./exec');

const KEY_NAMES = ['CLOUDFLARE_ACCOUNT_ID', 'R2_ACCESS_KEY', 'R2_SECRET_KEY'];

/**
 * Where the heroku program lives. On some Macs `heroku` starts a Homebrew Node
 * that no longer runs; LANA_HEROKU_BIN can then name the CLI's script, and it
 * is run with this Node instead.
 */
function herokuCommand(env = process.env) {
  if (env.LANA_HEROKU_BIN) {return { command: process.execPath, prefix: [env.LANA_HEROKU_BIN] };}
  return { command: 'heroku', prefix: [] };
}

/** Reads the three R2 values from Heroku. Throws a message with no value in it. */
async function readR2Keys(run, env = process.env) {
  const { command, prefix } = herokuCommand(env);
  const keys = {};
  for (const name of KEY_NAMES) {
    // eslint-disable-next-line no-await-in-loop -- three small reads, in order
    const result = await run(command, [...prefix, 'config:get', name, '-a', HEROKU_APP], { env });
    const value = String(result.stdout || '').trim();
    if (result.code !== 0 || !value) {
      const why = /expired|login|unauthorized/i.test(result.stderr) ? 'the Heroku login has expired; run heroku login'
        : /Library not loaded|dyld/i.test(result.stderr) ? 'the heroku program does not start; set LANA_HEROKU_BIN to its script'
          : 'heroku config:get failed';
      throw new Error(`Could not read ${name} from Heroku app ${HEROKU_APP}: ${why}.`);
    }
    keys[name] = value;
  }
  return keys;
}

/**
 * @param {Object} deps
 * @param {Function} deps.run - exec.run
 * @param {Object} deps.keys - from readR2Keys
 */
function createR2({ run, keys, env = process.env }) {
  const endpoint = `https://${keys.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const awsEnv = {
    ...env,
    AWS_ACCESS_KEY_ID: keys.R2_ACCESS_KEY,
    AWS_SECRET_ACCESS_KEY: keys.R2_SECRET_KEY,
    AWS_DEFAULT_REGION: 'auto',
    AWS_PAGER: ''
  };

  async function aws(args, what, options = {}) {
    const result = await run('aws', [...args, '--endpoint-url', endpoint], { env: awsEnv, ...options });
    if (result.code !== 0) {throw new Error(`R2: could not ${what} (${scrub(result.stderr)}).`);}
    return result;
  }

  return {
    /** [{ key, size, modified }] under a prefix. */
    async list(bucket, prefix) {
      const items = [];
      let token = null;
      do {
        const args = ['s3api', 'list-objects-v2', '--bucket', bucket, '--prefix', prefix, '--output', 'json'];
        if (token) {args.push('--continuation-token', token);}
        // eslint-disable-next-line no-await-in-loop -- pages come one after another
        const { stdout } = await aws(args, `list ${bucket}/${prefix}`);
        const page = stdout.trim() ? JSON.parse(stdout) : {};
        for (const item of page.Contents || []) {items.push({ key: item.Key, size: item.Size, modified: item.LastModified });}
        token = page.IsTruncated ? page.NextContinuationToken : null;
      } while (token);
      return items;
    },
    async getText(bucket, key) {
      const { stdout } = await aws(['s3', 'cp', `s3://${bucket}/${key}`, '-'], `read ${bucket}/${key}`);
      return stdout;
    },
    async download(bucket, key, file) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await aws(['s3', 'cp', `s3://${bucket}/${key}`, file, '--only-show-errors'], `download ${bucket}/${key}`);
    },
    async upload(file, bucket, key, contentType) {
      const args = ['s3', 'cp', file, `s3://${bucket}/${key}`, '--only-show-errors'];
      if (contentType) {args.push('--content-type', contentType);}
      await aws(args, `upload ${bucket}/${key}`);
    },
    /** A read-only link. The caller writes it to a private file and never prints it. */
    async presign(bucket, key, seconds) {
      const { stdout } = await aws(['s3', 'presign', `s3://${bucket}/${key}`, '--expires-in', String(seconds)], `make a link for ${bucket}/${key}`);
      return stdout.trim();
    }
  };
}

module.exports = { KEY_NAMES, herokuCommand, readR2Keys, createR2 };
