'use strict';

/**
 * AMD and Intel graphics chips on Windows and Linux, for Pip's Vulkan build (electron-hardware.js
 * accelerator). Main process. Plain CommonJS; the PowerShell run and the file reads are injected,
 * so every computer is tested on any computer. NVIDIA is not read here: it keeps nvidia-smi.
 *
 * Each chip found is { name, vendor: 'amd'|'intel', deviceId, integrated, vramBytes, driverVersion }:
 *   integrated  true for a chip that shares system memory (Intel UHD, Iris and Arc 140V, AMD Radeon
 *               ... Graphics), false for a card with its own memory (Radeon RX and PRO, Arc A and B).
 *   vramBytes   the card's own memory, or null when it cannot be read (then it is not sized against).
 *
 * Windows: Win32_VideoController (Get-CimInstance) for name, PCI id and driver version, and the
 * display class registry key's HardwareInformation.qwMemorySize for the true card memory.
 * Win32_VideoController's AdapterRAM is a 32-bit field that stops at 4 GB, so it is used only when
 * the registry has no figure: it is then a lower bound, never more than the card has.
 *
 * Linux: /sys/class/drm/card<N>/device (vendor, device, the driver bound to it). AMD cards with the
 * amdgpu driver report mem_info_vram_total; a card with its own memory chips also reports
 * mem_info_vram_vendor, which an APU (shared memory) does not. Intel discrete cards are known by
 * their PCI device ids; Intel's driver files show no card memory here, so their memory is unknown.
 *
 * Never a chip: Microsoft Basic Display Adapter and Basic Render Driver, Hyper-V and remote display
 * adapters, VMware, VirtualBox, Parallels, QXL, virtio, llvmpipe and every other software or virtual
 * adapter (none of them is an AMD or Intel PCI device bound to its real driver).
 */

const path = require('path');

const VENDOR = Object.freeze({ '1002': 'amd', '8086': 'intel', '10de': 'nvidia' });

/** Names of adapters that are not a graphics chip Pip can use, whatever PCI id they sit on. */
const NOT_A_GPU = /basic display|basic render|hyper-v|remote display|remotefx|vmware|virtualbox|parallels|qxl|virtio|citrix|standard vga|virtual|llvmpipe|swiftshader|indirect display|displaylink|mirror driver/i;

/** Intel discrete cards: DG1 (Iris Xe MAX), Alchemist and Flex (Arc A, Pro A), Battlemage (Arc B). */
function intelDiscreteId(deviceId) {
  const id = Number.parseInt(deviceId, 16);
  if (!Number.isFinite(id)) {return false;}
  return (id >= 0x4905 && id <= 0x4909) || (id >= 0x5690 && id <= 0x56cf) || (id >= 0xe200 && id <= 0xe2ff);
}

/**
 * Whether a chip shares system memory. Intel: everything but Arc A and B cards and Iris Xe MAX
 * ("Arc 140V GPU" and "Arc Graphics" are the processor's own). AMD: the processor's chip is always
 * named "... Graphics" (Radeon Graphics, Radeon 780M Graphics, Radeon RX Vega 11 Graphics);
 * cards are not (Radeon RX 7900 XTX, Radeon PRO W7800).
 */
function isIntegrated(vendor, name, deviceId) {
  const text = String(name || '');
  if (vendor === 'intel') {
    if (intelDiscreteId(deviceId)) {return false;}
    return !/\bArc\S*\s+(Pro\s+)?[AB]\d{2,3}\b|Xe\s+MAX/i.test(text);
  }
  return /Graphics\s*$/i.test(text.replace(/\(TM\)|\(R\)/gi, '').trim());
}

/* ---------------------------------- Windows ---------------------------------- */

const DISPLAY_CLASS_KEY = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}';

/** One PowerShell run: the video controllers and the display class registry entries, as JSON. */
const WINDOWS_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$vc = @(Get-CimInstance -ClassName Win32_VideoController | Select-Object Name, AdapterCompatibility, AdapterRAM, DriverVersion, PNPDeviceID)',
  `$reg = @(Get-ChildItem -Path '${DISPLAY_CLASS_KEY}' | ForEach-Object { $p = Get-ItemProperty -Path $_.PSPath; if ($p.DriverDesc) { [pscustomobject]@{ DriverDesc = $p.DriverDesc; MatchingDeviceId = $p.MatchingDeviceId; DriverVersion = $p.DriverVersion; qwMemorySize = $p.'HardwareInformation.qwMemorySize' } } })`,
  '[pscustomobject]@{ controllers = $vc; registry = $reg } | ConvertTo-Json -Depth 3 -Compress'
].join('; ');

function pciIds(text) {
  const match = /VEN_([0-9A-F]{4})&DEV_([0-9A-F]{4})/i.exec(String(text || ''));
  return match ? { vendorId: match[1].toLowerCase(), deviceId: match[2].toLowerCase() } : null;
}

const list = (value) => (Array.isArray(value) ? value : value ? [value] : []);
const positive = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * The AMD and Intel chips in the PowerShell output (WINDOWS_SCRIPT). A registry entry belongs to a
 * controller with the same PCI vendor and device and, where several match, the same name.
 */
function parseWindowsGpus(jsonText) {
  let data;
  try { data = JSON.parse(String(jsonText || '').trim() || 'null'); } catch (_error) { return []; }
  if (!data) {return [];}
  const registry = list(data.registry).map((entry) => ({ ...entry, ids: pciIds(entry.MatchingDeviceId) }));
  const gpus = [];
  for (const controller of list(data.controllers)) {
    const name = String(controller.Name || '').trim();
    const ids = pciIds(controller.PNPDeviceID);
    if (!ids || !/^PCI\\/i.test(String(controller.PNPDeviceID)) || NOT_A_GPU.test(name)) {continue;}
    if (/^\(standard display types\)$|^microsoft/i.test(String(controller.AdapterCompatibility || '').trim())) {continue;}
    const vendor = VENDOR[ids.vendorId];
    if (vendor !== 'amd' && vendor !== 'intel') {continue;}
    const same = registry.filter((entry) => entry.ids && entry.ids.vendorId === ids.vendorId && entry.ids.deviceId === ids.deviceId);
    const entry = same.find((item) => String(item.DriverDesc || '').trim() === name) || same[0] || null;
    const vramBytes = positive(entry && entry.qwMemorySize) || positive(controller.AdapterRAM);
    gpus.push({
      name,
      vendor,
      deviceId: ids.deviceId,
      integrated: isIntegrated(vendor, name, ids.deviceId),
      vramBytes,
      driverVersion: String(controller.DriverVersion || (entry && entry.DriverVersion) || '').trim() || null
    });
  }
  return gpus;
}

function readWindowsGpus(execFileSync) {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_SCRIPT], {
      timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', windowsHide: true
    });
    return parseWindowsGpus(out);
  } catch (_error) {
    return [];
  }
}

/* ----------------------------------- Linux ----------------------------------- */

const DRM_DIR = '/sys/class/drm';
/** The kernel drivers that have a Vulkan driver beside them (RADV or AMDVLK; ANV). */
const LINUX_DRIVERS = Object.freeze({ amd: ['amdgpu'], intel: ['i915', 'xe'] });

/**
 * The AMD and Intel chips under /sys/class/drm. `fsApi` is { readdirSync, readFileSync,
 * readlinkSync }; anything unreadable is skipped.
 */
function readLinuxGpus(fsApi, root = DRM_DIR) {
  let names;
  try { names = fsApi.readdirSync(root); } catch (_error) { return []; }
  const read = (file) => {
    try { return String(fsApi.readFileSync(file, 'utf8')).trim(); } catch (_error) { return null; }
  };
  const gpus = [];
  const seen = new Set();
  for (const card of names.filter((name) => /^card\d+$/.test(name)).sort()) {
    const device = path.posix.join(root, card, 'device');
    const vendorId = (read(path.posix.join(device, 'vendor')) || '').replace(/^0x/i, '').toLowerCase();
    const deviceId = (read(path.posix.join(device, 'device')) || '').replace(/^0x/i, '').toLowerCase();
    const vendor = VENDOR[vendorId];
    if (vendor !== 'amd' && vendor !== 'intel') {continue;}
    let driver = null;
    try { driver = path.posix.basename(String(fsApi.readlinkSync(path.posix.join(device, 'driver')))); } catch (_error) { driver = null; }
    if (!LINUX_DRIVERS[vendor].includes(driver)) {continue;}
    // The same PCI device can show up as more than one card (a render node alias); count it once.
    let address = card;
    try { address = path.posix.basename(String(fsApi.readlinkSync(device))); } catch (_error) { /* keep the card name */ }
    if (seen.has(address)) {continue;}
    seen.add(address);
    let integrated;
    let vramBytes = null;
    if (vendor === 'amd') {
      vramBytes = positive(read(path.posix.join(device, 'mem_info_vram_total')));
      integrated = !read(path.posix.join(device, 'mem_info_vram_vendor'));
    } else {
      integrated = !intelDiscreteId(deviceId);
      vramBytes = integrated ? null : positive(read(path.posix.join(root, card, 'lmem_total_bytes')));
    }
    gpus.push({ name: `${vendor === 'amd' ? 'AMD' : 'Intel'} ${deviceId} (${driver})`, vendor, deviceId, integrated, vramBytes, driverVersion: null });
  }
  return gpus;
}

/**
 * What Pip's Vulkan build would run on, from the chips found: a card with its own memory when
 * there is one (Vulkan prefers it), sized by the smallest such card's memory, since which card it
 * takes first is not ours to choose; otherwise the processor's chip, on shared memory.
 * Null when there is no AMD or Intel chip.
 * @returns {null|{ backend: 'vulkan', shared: boolean, vramBytes: number|null, gpus: Array }}
 */
function vulkanAccelerator(gpus) {
  const usable = (gpus || []).filter((gpu) => gpu.vendor === 'amd' || gpu.vendor === 'intel');
  if (!usable.length) {return null;}
  const cards = usable.filter((gpu) => !gpu.integrated);
  if (cards.length) {
    const known = cards.every((gpu) => gpu.vramBytes);
    return { backend: 'vulkan', shared: false, vramBytes: known ? Math.min(...cards.map((gpu) => gpu.vramBytes)) : null, gpus: usable };
  }
  return { backend: 'vulkan', shared: true, vramBytes: null, gpus: usable };
}

module.exports = {
  parseWindowsGpus,
  readWindowsGpus,
  readLinuxGpus,
  vulkanAccelerator,
  isIntegrated,
  WINDOWS_SCRIPT
};
