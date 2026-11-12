/**
 * AMD and Intel graphics on Windows and Linux (electron-gpu.js), read into the computer
 * (electron-hardware.js), sized (local-ai-fit.model.js) and turned into Pip's settings
 * (electron-pip-levers.js). PowerShell output and /sys/class/drm are made up from what those
 * sources print; nothing here runs on a real Windows or Linux computer.
 */

const path = require('path');
const gpu = require('../../electron-gpu');
const { readHardware } = require('../../electron-hardware');
const fit = require('../../src/js/local-ai-fit.model');
const levers = require('../../electron-pip-levers');
const { BUILT_IN, parseCatalog } = require('../../electron-model-catalog');
const { embeddingModel, speechSizes } = require('../../electron-local-models');

const GB = 1024 ** 3;
const NEW = levers.parseAccepts(Object.values(levers.NEW_FLAGS).join('\n'));
const catalog = parseCatalog(BUILT_IN);

/* ------------------------------ what each OS prints ------------------------------ */

const win = (controllers, registry = []) => JSON.stringify({ controllers, registry });
const controller = (Name, pnp, more = {}) => ({ Name, AdapterCompatibility: more.compat || 'Advanced Micro Devices, Inc.', AdapterRAM: more.adapterRam != null ? more.adapterRam : 4293918720, DriverVersion: more.driver || '32.0.11021.1011', PNPDeviceID: pnp });
const regEntry = (DriverDesc, match, qw) => ({ DriverDesc, MatchingDeviceId: match, qwMemorySize: qw });

const WINDOWS = {
  amdCard: win(
    [controller('AMD Radeon RX 7800 XT', 'PCI\\VEN_1002&DEV_747E&SUBSYS_E3211DA2&REV_C8\\6&2B2E3A3&0&00000019')],
    [regEntry('AMD Radeon RX 7800 XT', 'pci\\ven_1002&dev_747e&rev_c8', 16 * GB)]
  ),
  intelIntegrated: win(
    [controller('Intel(R) Iris(R) Xe Graphics', 'PCI\\VEN_8086&DEV_A7A0&SUBSYS_0B141028&REV_04\\3&11583659&0&10', { compat: 'Intel Corporation', adapterRam: 134217728 })],
    [regEntry('Intel(R) Iris(R) Xe Graphics', 'pci\\ven_8086&dev_a7a0', 128 * 1024 * 1024)]
  ),
  basicDisplay: win([controller('Microsoft Basic Display Adapter', 'PCI\\VEN_1002&DEV_747E&SUBSYS_E3211DA2&REV_C8\\6&2B2E3A3', { compat: '(Standard display types)' })]),
  hyperV: win([controller('Microsoft Hyper-V Video', 'VMBUS\\{DA0A7802-E377-4AAC-8E77-0558EB1073F8}', { compat: 'Microsoft Corporation' })]),
  smallCard: win(
    [controller('AMD Radeon RX 550', 'PCI\\VEN_1002&DEV_699F&SUBSYS_E3451DA2&REV_C7\\4&1', { adapterRam: 2 * GB })],
    [regEntry('AMD Radeon RX 550', 'pci\\ven_1002&dev_699f', 2 * GB)]
  )
};

/** A /sys/class/drm made of { cardN: { vendor, device, driver, files } }. */
function sysfs(cards) {
  const files = {};
  const links = {};
  const root = '/sys/class/drm';
  const names = [];
  for (const [card, info] of Object.entries(cards)) {
    names.push(card, `${card}-DP-1`);
    const device = `${root}/${card}/device`;
    files[`${device}/vendor`] = `0x${info.vendor}\n`;
    files[`${device}/device`] = `0x${info.device}\n`;
    links[`${device}/driver`] = `../../../bus/pci/drivers/${info.driver}`;
    links[device] = `../../../${info.address || `0000:0${names.length}:00.0`}`;
    for (const [name, value] of Object.entries(info.files || {})) {files[`${device}/${name}`] = `${value}\n`;}
  }
  names.push('renderD128', 'version');
  const missing = (file) => Object.assign(new Error(`ENOENT ${file}`), { code: 'ENOENT' });
  return {
    readdirSync: (dir) => { if (dir !== root) {throw missing(dir);} return names; },
    readFileSync: (file) => { if (!(file in files)) {throw missing(file);} return files[file]; },
    readlinkSync: (file) => { if (!(file in links)) {throw missing(file);} return links[file]; }
  };
}

const LINUX = {
  amdCard: sysfs({ card1: { vendor: '1002', device: '744c', driver: 'amdgpu', files: { mem_info_vram_total: 24 * GB, mem_info_vram_vendor: 'samsung' } } }),
  amdApu: sysfs({ card0: { vendor: '1002', device: '15bf', driver: 'amdgpu', files: { mem_info_vram_total: 512 * 1024 * 1024 } } }),
  intelIntegrated: sysfs({ card0: { vendor: '8086', device: '7d55', driver: 'i915' } }),
  intelArcUnknownMemory: sysfs({ card0: { vendor: '8086', device: '56a0', driver: 'i915' } }),
  virtio: sysfs({ card0: { vendor: '1af4', device: '1050', driver: 'virtio-pci' } }),
  amdOldDriver: sysfs({ card0: { vendor: '1002', device: '6798', driver: 'radeon' } })
};

describe('reading the chips', () => {
  test.each([
    ['Windows AMD card: true memory from the registry, not the 4 GB AdapterRAM cap', () => gpu.parseWindowsGpus(WINDOWS.amdCard),
      [{ name: 'AMD Radeon RX 7800 XT', vendor: 'amd', deviceId: '747e', integrated: false, vramBytes: 16 * GB, driverVersion: '32.0.11021.1011' }]],
    ['Windows Intel integrated: shares system memory', () => gpu.parseWindowsGpus(WINDOWS.intelIntegrated),
      [expect.objectContaining({ vendor: 'intel', integrated: true })]],
    ['Windows Microsoft Basic Display Adapter on an AMD card: not a chip', () => gpu.parseWindowsGpus(WINDOWS.basicDisplay), []],
    ['Windows Hyper-V video: not a chip', () => gpu.parseWindowsGpus(WINDOWS.hyperV), []],
    ['Windows unreadable output: nothing', () => gpu.parseWindowsGpus('not json'), []],
    ['Linux AMD card: amdgpu memory, has memory chips of its own', () => gpu.readLinuxGpus(LINUX.amdCard),
      [{ name: 'AMD 744c (amdgpu)', vendor: 'amd', deviceId: '744c', integrated: false, vramBytes: 24 * GB, driverVersion: null }]],
    ['Linux AMD APU: no memory vendor, shares system memory', () => gpu.readLinuxGpus(LINUX.amdApu),
      [expect.objectContaining({ vendor: 'amd', integrated: true })]],
    ['Linux Intel integrated', () => gpu.readLinuxGpus(LINUX.intelIntegrated), [expect.objectContaining({ vendor: 'intel', integrated: true, vramBytes: null })]],
    ['Linux Intel Arc card: discrete, memory unknown', () => gpu.readLinuxGpus(LINUX.intelArcUnknownMemory), [expect.objectContaining({ vendor: 'intel', integrated: false, vramBytes: null })]],
    ['Linux virtio display: not a chip', () => gpu.readLinuxGpus(LINUX.virtio), []],
    ['Linux AMD on the old radeon driver (no Vulkan): not a chip', () => gpu.readLinuxGpus(LINUX.amdOldDriver), []]
  ])('%s', (_label, read, expected) => {
    expect(read()).toEqual(expected);
  });

  test.each([
    ['intel', 'Intel(R) Arc(TM) A770 Graphics', '56a0', false],
    ['intel', 'Intel(R) Arc(TM) B580 Graphics', 'e20b', false],
    ['intel', 'Intel(R) Arc(TM) 140V GPU (16GB)', '64a0', true],
    ['intel', 'Intel(R) Arc(TM) Graphics', '7d55', true],
    ['intel', 'Intel(R) UHD Graphics 770', '4680', true],
    ['amd', 'AMD Radeon(TM) Graphics', '1638', true],
    ['amd', 'AMD Radeon 780M Graphics', '15bf', true],
    ['amd', 'AMD Radeon RX Vega 11 Graphics', '15dd', true],
    ['amd', 'AMD Radeon RX 7900 XTX', '744c', false],
    ['amd', 'AMD Radeon PRO W7800', '7448', false]
  ])('%s %s: integrated %s', (vendor, name, deviceId, integrated) => {
    expect(gpu.isIntegrated(vendor, name, deviceId)).toBe(integrated);
  });

  test('a card beside the processor\'s chip wins, sized by the smallest card', () => {
    const accel = gpu.vulkanAccelerator([
      { vendor: 'intel', integrated: true, vramBytes: null },
      { vendor: 'amd', integrated: false, vramBytes: 16 * GB },
      { vendor: 'amd', integrated: false, vramBytes: 8 * GB }
    ]);
    expect(accel).toMatchObject({ backend: 'vulkan', shared: false, vramBytes: 8 * GB });
  });
});

/* ------------------------------- the whole chain ------------------------------- */

const fakeOs = (memoryGb) => ({ totalmem: () => memoryGb * GB, freemem: () => 4 * GB, cpus: () => Array.from({ length: 16 }, () => ({ model: 'Test CPU' })) });
const disk = () => ({ bavail: (500 * GB) / 4096, bsize: 4096 });

function computer({ platform, arch = 'x64', memoryGb, nvidia = [], windows = null, linux = null }) {
  return readHardware({ modelsDir: path.join(path.sep, 'm') }, {
    platform, arch, os: fakeOs(memoryGb), statfsSync: disk, existsSync: () => true,
    readNvidia: () => nvidia,
    execFileSync: (command) => {
      if (command !== 'powershell.exe' || !windows) {throw new Error('not here');}
      return windows;
    },
    fs: linux || sysfs({})
  });
}

function settingsFor(hardware) {
  const result = fit.planLocalAi({ hardware, catalog, embedding: embeddingModel(), speech: speechSizes() });
  const chat = result.plan.chat;
  const model = catalog.chat.find((m) => m.id === chat.id);
  const backendHw = result.computer.backend === hardware.accelerator.backend ? hardware : { ...hardware, accelerator: { ...hardware.accelerator, backend: result.computer.backend } };
  const chosen = levers.chatLevers({ hardware: backendHw, contextTokens: chat.contextTokens, slots: chat.parallel, poolTokens: chat.poolTokens, modelFile: `/m/${model.filename || model.id}.gguf`, accepts: NEW });
  return { result, model, chosen };
}

const CAREFUL_VULKAN = { gpu_layers: 99, parallel: 1, kv_type: 'f16' };

describe('the settings each computer gets', () => {
  test.each([
    ['Windows, AMD Radeon RX 7800 XT (16 GB)', { platform: 'win32', memoryGb: 32, windows: WINDOWS.amdCard }, 'vulkan'],
    ['Windows, Intel Iris Xe (shared memory)', { platform: 'win32', memoryGb: 16, windows: WINDOWS.intelIntegrated }, 'vulkan'],
    ['Linux, AMD Radeon RX 7900 XTX (24 GB)', { platform: 'linux', memoryGb: 64, linux: LINUX.amdCard }, 'vulkan'],
    ['Linux, Intel Meteor Lake (shared memory)', { platform: 'linux', memoryGb: 32, linux: LINUX.intelIntegrated }, 'vulkan'],
    ['Linux, AMD Phoenix APU (shared memory)', { platform: 'linux', memoryGb: 32, linux: LINUX.amdApu }, 'vulkan']
  ])('%s: the careful Vulkan profile', (_label, input, backend) => {
    const hardware = computer(input);
    expect(hardware.accelerator.backend).toBe(backend);
    const { result, model, chosen } = settingsFor(hardware);
    expect(result.computer.backend).toBe('vulkan');
    expect(result.plan.chat).toMatchObject({ where: 'local', parallel: 1, poolTokens: null });
    expect(chosen.config).toMatchObject(CAREFUL_VULKAN);
    for (const key of ['gpu_inexact', 'batch_decode', 'adaptive_prefill', 'ctx_pool', 'prefix_share_mb']) {expect(chosen.config).not.toHaveProperty(key);}
    expect(chosen.args).toEqual(['--flash-attn']);
    expect(chosen.expect.gpuPlacement).toBe(true);
    // Model plus pool fits where the chip can reach.
    const bytes = fit.chatBytes(model, result.plan.chat.contextTokens, 1);
    if (hardware.accelerator.shared) {
      expect(bytes).toBeLessThanOrEqual(hardware.totalMemoryBytes * fit.INTEGRATED_GPU_SHARE);
    } else {
      expect(bytes).toBeLessThanOrEqual(hardware.accelerator.vramBytes - GB);
    }
  });

  test('control: an NVIDIA card keeps CUDA and its settings, and no AMD or Intel chip is read', () => {
    const execFileSync = jest.fn(() => { throw new Error('must not run'); });
    const hardware = readHardware({ modelsDir: '/m' }, { platform: 'win32', arch: 'x64', os: fakeOs(32), statfsSync: disk, existsSync: () => true, readNvidia: () => [{ name: 'RTX 4070', vramBytes: 12 * GB }], execFileSync });
    expect(hardware.accelerator).toEqual({ backend: 'cuda', vramBytes: 12 * GB, gpus: [{ name: 'RTX 4070', vramBytes: 12 * GB }] });
    expect(execFileSync).not.toHaveBeenCalled();
    const { result, chosen } = settingsFor(hardware);
    expect(result.plan.chat.parallel).toBe(2);
    expect(chosen.config).toMatchObject({ gpu_layers: 99, parallel: 2, ctx_pool: 65536 });
    expect(chosen.expect.gpuPlacement).toBe(false);
  });

  test.each([
    ['Microsoft Basic Display Adapter (the VM case)', { platform: 'win32', memoryGb: 16, windows: WINDOWS.basicDisplay }],
    ['Hyper-V video', { platform: 'win32', memoryGb: 16, windows: WINDOWS.hyperV }],
    ['Linux virtio display', { platform: 'linux', memoryGb: 16, linux: LINUX.virtio }]
  ])('%s: processor only', (_label, input) => {
    const hardware = computer(input);
    expect(hardware.accelerator).toEqual({ backend: 'cpu', vramBytes: null, gpus: [] });
    const { chosen } = settingsFor(hardware);
    expect(chosen.config.gpu_layers).toBe(0);
    expect(chosen.args).toEqual(['--repack']);
  });

  test('control: macOS is unchanged and reads no other chip', () => {
    const execFileSync = jest.fn();
    const fsApi = { readdirSync: jest.fn(() => []) };
    const mac = readHardware({ modelsDir: '/m' }, { platform: 'darwin', arch: 'arm64', os: fakeOs(36), statfsSync: disk, existsSync: () => true, execFileSync, fs: fsApi });
    expect(mac.accelerator).toEqual({ backend: 'metal', vramBytes: null, gpus: [] });
    const intelMac = readHardware({ modelsDir: '/m' }, { platform: 'darwin', arch: 'x64', os: fakeOs(16), statfsSync: disk, existsSync: () => true, execFileSync, fs: fsApi });
    expect(intelMac.accelerator.backend).toBe('cpu');
    expect(execFileSync).not.toHaveBeenCalled();
    expect(fsApi.readdirSync).not.toHaveBeenCalled();
  });

  test('a card too small for any chat model: the processor-only plan and settings', () => {
    const hardware = computer({ platform: 'win32', memoryGb: 16, windows: WINDOWS.smallCard });
    expect(hardware.accelerator).toMatchObject({ backend: 'vulkan', shared: false, vramBytes: 2 * GB });
    const { result, chosen } = settingsFor(hardware);
    expect(result.computer.backend).toBe('cpu');
    expect(result.plan.chat.where).toBe('local');
    expect(chosen.backend).toBe('cpu');
    expect(chosen.config.gpu_layers).toBe(0);
  });

  test('a card whose memory cannot be read is not sized against: processor only', () => {
    const hardware = computer({ platform: 'linux', memoryGb: 32, linux: LINUX.intelArcUnknownMemory });
    expect(hardware.accelerator).toMatchObject({ backend: 'vulkan', shared: false, vramBytes: null });
    expect(settingsFor(hardware).result.computer.backend).toBe('cpu');
  });

  test('on a card, the model is sized for the card: a 6 GB card gets a model that fits 5 GB', () => {
    const six = { controllers: [controller('AMD Radeon RX 7600', 'PCI\\VEN_1002&DEV_7480&SUBSYS_1&REV_C0\\4&1')], registry: [regEntry('AMD Radeon RX 7600', 'pci\\ven_1002&dev_7480', 6 * GB)] };
    const big = { controllers: [controller('AMD Radeon RX 7900 XTX', 'PCI\\VEN_1002&DEV_744C&SUBSYS_1&REV_C8\\4&1')], registry: [regEntry('AMD Radeon RX 7900 XTX', 'pci\\ven_1002&dev_744c', 24 * GB)] };
    const small = settingsFor(computer({ platform: 'win32', memoryGb: 64, windows: JSON.stringify(six) }));
    const large = settingsFor(computer({ platform: 'win32', memoryGb: 64, windows: JSON.stringify(big) }));
    expect(fit.chatBytes(small.model, small.result.plan.chat.contextTokens, 1)).toBeLessThanOrEqual(5 * GB);
    expect(large.model.sizeBytes).toBeGreaterThan(small.model.sizeBytes);
    expect(small.result.computer.graphicsMemoryBytes).toBe(6 * GB);
  });

  test('a chip that shares memory must also fit in the share it may address: the 35B-A3B on 32 GB', () => {
    const plan = (accelerator) => fit.planLocalAi({ hardware: { totalMemoryBytes: 32 * GB, freeDiskBytes: 500 * GB, accelerator }, catalog, embedding: embeddingModel(), speech: speechSizes() });
    const moe = (result) => result.chatChoices.find((c) => c.id === 'qwen3.5-35b-a3b-q4km');
    // Tight in system memory (as on a 32 GB Mac), but more than half of it: not on a shared chip.
    expect(moe(plan({ backend: 'metal' })).fit).toBe('tight');
    expect(moe(plan({ backend: 'vulkan', shared: true, vramBytes: null, gpus: [] })).fit).toBe('wont_fit');
  });
});

describe('after start: was the chip used?', () => {
  const vulkan = levers.chatLevers({ hardware: { totalMemoryBytes: 32 * GB, accelerator: { backend: 'vulkan' } }, contextTokens: 32768, slots: 1, modelFile: '/m/q.gguf', accepts: NEW });
  test.each([
    [['[lqe INF] model: placement 5321.0 MiB GPU + 0.0 MiB CPU-mapped (32 layers from layer 0)'], null],
    [['[lqe WRN] no GPU backend available; running on CPU', '[lqe INF] model: placement 5321.0 MiB CPU-mapped'], /no Vulkan device/],
    [['[lqe INF] model: placement 5321.0 MiB CPU-mapped'], /on the processor/],
    [['[lqe INF] serve: listening'], null]
  ])('%j', (lines, expected) => {
    const reason = levers.gpuUnused(lines, vulkan);
    if (expected) {expect(reason).toMatch(expected);} else {expect(reason).toBeNull();}
  });

  test('a missing placement line is a warning, not a fallback; other backends are never asked', () => {
    expect(levers.verifyStartup(['[lqe INF] serve: listening'], vulkan).join('\n')).toMatch(/did not log where it placed the model/);
    const cuda = levers.chatLevers({ hardware: { accelerator: { backend: 'cuda' } }, contextTokens: 32768, slots: 2, modelFile: '/m/q.gguf', accepts: NEW });
    expect(levers.gpuUnused(['[lqe INF] model: placement 1.0 MiB CPU-mapped'], cuda)).toBeNull();
    expect(levers.verifyStartup([], cuda)).toEqual([]);
  });
});
