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
 *                  vulkan an AMD or Intel graphics chip on Windows or Linux (electron-gpu.js):
 *                         a card with its own memory (shared false, vramBytes; null when it
 *                         cannot be read), or the processor's chip on system memory (shared true)
 *                  cpu    no usable graphics chip: models use system memory, slowly
 *   disk         free bytes on the volume that holds the models folder
 *
 * Graphics detection follows the LANA One client (supervisor/hardware-accel.js):
 * NVIDIA through nvidia-smi on Windows and Linux. Without NVIDIA, AMD and Intel chips through
 * electron-gpu.js (Win32_VideoController and the display registry on Windows, /sys/class/drm on
 * Linux). Their speed is unmeasured, so local-ai-fit.model.js and electron-pip-levers.js run them
 * with careful settings, and electron-pip-supervisor.js falls back to the processor once when
 * Vulkan does not start or does not use the chip.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const gpu = require('./electron-gpu');

/**
 * nvidia-smi --query-gpu=memory.total,name --format=csv,noheader,nounits (MiB per line).
 * A DGX Spark (GB10) shares system memory and reports no card memory ("[N/A]"); it is kept with
 * vramBytes null, so models are sized against system memory and still run on the graphics chip.
 */
function parseNvidiaSmi(text) {
  const gpus = [];
  for (const line of String(text || '').split('\n')) {
    const parts = line.trim().split(',');
    const name = parts.slice(1).join(',').trim();
    const mib = Number.parseFloat(parts[0]);
    if (Number.isFinite(mib) && mib > 0) {
      gpus.push({ name, vramBytes: Math.round(mib * 1024 * 1024) });
    } else if (/\bGB10\b/i.test(name)) {
      gpus.push({ name, vramBytes: null });
    }
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

function accelerator({ platform, arch, gpus, readOtherGpus }) {
  if (platform === 'darwin') {
    return arch === 'arm64' ? { backend: 'metal', vramBytes: null, gpus: [] } : { backend: 'cpu', vramBytes: null, gpus: [] };
  }
  if (gpus.length) {
    const shared = gpus.some((card) => card.vramBytes === null);
    return { backend: 'cuda', vramBytes: shared ? null : gpus.reduce((sum, card) => sum + card.vramBytes, 0), gpus };
  }
  const other = (platform === 'win32' || platform === 'linux') ? gpu.vulkanAccelerator(readOtherGpus()) : null;
  return other || { backend: 'cpu', vramBytes: null, gpus: [] };
}

/** AMD and Intel chips (electron-gpu.js), read only on Windows and Linux without NVIDIA. */
function readOtherGpus(platform, io) {
  if (io.readOtherGpus) {return io.readOtherGpus();}
  if (platform === 'win32') {return gpu.readWindowsGpus(io.execFileSync || require('child_process').execFileSync);}
  if (platform === 'linux') {return gpu.readLinuxGpus(io.fs || fs);}
  return [];
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
 *   chip: string|null, cores: number, accelerator: { backend: 'metal'|'cuda'|'vulkan'|'cpu', vramBytes: number|null,
 *   gpus: Array, shared?: boolean },
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
    accelerator: accelerator({ platform, arch, gpus, readOtherGpus: () => readOtherGpus(platform, io) }),
    freeDiskBytes: freeDiskBytes(modelsDir, { statfsSync: io.statfsSync || fs.statfsSync, existsSync: io.existsSync || fs.existsSync })
  };
}

module.exports = { readHardware, parseNvidiaSmi };
