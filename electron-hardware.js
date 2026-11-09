'use strict';

/**
 * What this computer has, for choosing local AI models (first-launch plan,
 * docs/plans/first-launch-local-ai-plan.md, section 4.1). Main process only.
 *
 * Every reader is injectable so the result can be tested for any computer on
 * any computer. Nothing here decides anything: local-ai-fit.model.js does.
 *
 *   memory       total and free system memory (bytes)
 *   chip         the processor's name as the operating system reports it
 *   cores        logical processor count (Pip's `threads`)
 *   accelerator  how Pip would run models here:
 *                  metal  Apple silicon, unified memory: models use system memory
 *                  cuda   an NVIDIA graphics card: models use its memory (vramBytes)
 *                  cpu    no usable graphics chip: models use system memory, slowly
 *   disk         free bytes on the volume that holds the models folder
 *
 * Graphics detection follows the LANA One client (supervisor/hardware-accel.js):
 * NVIDIA through nvidia-smi on Windows and Linux. Other graphics chips count as
 * cpu until Pip is measured on them.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

/** nvidia-smi --query-gpu=memory.total,name --format=csv,noheader,nounits (MiB per line). */
function parseNvidiaSmi(text) {
  const gpus = [];
  for (const line of String(text || '').split('\n')) {
    const parts = line.trim().split(',');
    const mib = Number.parseFloat(parts[0]);
    if (!Number.isFinite(mib) || mib <= 0) {continue;}
    gpus.push({ name: parts.slice(1).join(',').trim(), vramBytes: Math.round(mib * 1024 * 1024) });
  }
  return gpus;
}

function readNvidia(execFileSync) {
  try {
    const out = execFileSync('nvidia-smi', ['--query-gpu=memory.total,name', '--format=csv,noheader,nounits'], {
      timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', windowsHide: true
    });
    return parseNvidiaSmi(out);
  } catch (_error) {
    return [];
  }
}

function accelerator({ platform, arch, gpus }) {
  if (platform === 'darwin') {
    return arch === 'arm64' ? { backend: 'metal', vramBytes: null, gpus: [] } : { backend: 'cpu', vramBytes: null, gpus: [] };
  }
  if (gpus.length) {
    return { backend: 'cuda', vramBytes: gpus.reduce((sum, gpu) => sum + gpu.vramBytes, 0), gpus };
  }
  return { backend: 'cpu', vramBytes: null, gpus: [] };
}

/** The nearest folder that exists, so free space can be read before the models folder is made. */
function existingAncestor(dir, existsSync) {
  let current = path.resolve(dir);
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {return current;}
    current = parent;
  }
  return current;
}

function freeDiskBytes(dir, { statfsSync, existsSync }) {
  try {
    const stat = statfsSync(existingAncestor(dir, existsSync));
    const bytes = Number(stat.bavail) * Number(stat.bsize);
    return Number.isFinite(bytes) && bytes >= 0 ? bytes : null;
  } catch (_error) {
    return null;
  }
}

/**
 * Read this computer.
 * @param {Object} options
 * @param {string} options.modelsDir - where models are (or will be) stored
 * @param {Object} [io] - injectable readers for tests
 * @returns {{ platform: string, arch: string, totalMemoryBytes: number, freeMemoryBytes: number,
 *   chip: string|null, cores: number, accelerator: { backend: 'metal'|'cuda'|'cpu', vramBytes: number|null, gpus: Array },
 *   freeDiskBytes: number|null }}
 */
function readHardware({ modelsDir }, io = {}) {
  const platform = io.platform || process.platform;
  const arch = io.arch || process.arch;
  const osApi = io.os || os;
  const cpus = osApi.cpus() || [];
  const gpus = platform === 'darwin' ? [] : (io.readNvidia || (() => readNvidia(io.execFileSync || require('child_process').execFileSync)))();
  return {
    platform,
    arch,
    totalMemoryBytes: osApi.totalmem(),
    freeMemoryBytes: osApi.freemem(),
    chip: (cpus[0] && typeof cpus[0].model === 'string' && cpus[0].model.trim()) || null,
    cores: Math.max(1, cpus.length),
    accelerator: accelerator({ platform, arch, gpus }),
    freeDiskBytes: freeDiskBytes(modelsDir, { statfsSync: io.statfsSync || fs.statfsSync, existsSync: io.existsSync || fs.existsSync })
  };
}

module.exports = { readHardware, parseNvidiaSmi };
