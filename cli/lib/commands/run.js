'use strict';

const { spawn } = require('child_process');
const { getRepoRoot } = require('../utils/repo');
const { ensureDeps } = require('../utils/deps');

const ENVS = {
  dev: { script: 'electron:dev', NODE_ENV: 'development' },
  prod: { script: 'electron', NODE_ENV: 'production' },
};

module.exports = async function run(envArg) {
  const env = ENVS[envArg];
  if (!env) {
    throw new Error(`Unknown env "${envArg}". Use one of: dev, prod`);
  }

  const repoRoot = getRepoRoot();

  ensureDeps(repoRoot);

  console.log(`Launching Electron in ${envArg} mode (npm run ${env.script})…`);
  const child = spawn('npm', ['run', env.script], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: env.NODE_ENV },
  });

  return new Promise((resolve, reject) => {
    child.on('exit', (code, signal) => {
      if (code === 0 || signal === 'SIGINT' || signal === 'SIGTERM') {
        resolve();
      } else {
        reject(new Error(`npm run ${env.script} exited with code ${code}`));
      }
    });
    child.on('error', reject);
  });
};
