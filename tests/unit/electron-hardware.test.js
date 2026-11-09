/**
 * Reading this computer for model sizing (electron-hardware.js). Every reader is faked, so these
 * run the same on Windows, macOS and Linux.
 */

const path = require('path');
const { readHardware, parseNvidiaSmi } = require('../../electron-hardware');

const GB = 1024 ** 3;
const fakeOs = (memoryGb = 16, cpus = 8, model = 'Apple M3 Pro') => ({
  totalmem: () => memoryGb * GB,
  freemem: () => 4 * GB,
  cpus: () => Array.from({ length: cpus }, () => ({ model }))
});
const disk = (freeGb) => jest.fn(() => ({ bavail: (freeGb * GB) / 4096, bsize: 4096 }));
const modelsDir = path.join(path.sep, 'data', 'lana', 'models');

test('an Apple silicon Mac: unified memory, no graphics card to ask', () => {
  const readNvidia = jest.fn(() => []);
  const hw = readHardware({ modelsDir }, { platform: 'darwin', arch: 'arm64', os: fakeOs(36, 12), statfsSync: disk(210), existsSync: () => true, readNvidia });
  expect(hw).toEqual({
    platform: 'darwin', arch: 'arm64', totalMemoryBytes: 36 * GB, freeMemoryBytes: 4 * GB,
    chip: 'Apple M3 Pro', cores: 12, accelerator: { backend: 'metal', vramBytes: null, gpus: [] }, freeDiskBytes: 210 * GB
  });
  expect(readNvidia).not.toHaveBeenCalled();
});

test('an Intel Mac runs models on the processor', () => {
  const hw = readHardware({ modelsDir }, { platform: 'darwin', arch: 'x64', os: fakeOs(), statfsSync: disk(10), existsSync: () => true });
  expect(hw.accelerator.backend).toBe('cpu');
});

test.each(['win32', 'linux'])('%s with an NVIDIA card: its memory is summed across cards', (platform) => {
  const gpus = [{ name: 'RTX 4070', vramBytes: 12 * GB }, { name: 'RTX 3060', vramBytes: 8 * GB }];
  const hw = readHardware({ modelsDir }, { platform, arch: 'x64', os: fakeOs(32, 16, 'AMD Ryzen 9'), statfsSync: disk(500), existsSync: () => true, readNvidia: () => gpus });
  expect(hw.accelerator).toEqual({ backend: 'cuda', vramBytes: 20 * GB, gpus });
  expect(hw.chip).toBe('AMD Ryzen 9');
});

test.each(['win32', 'linux'])('%s with no NVIDIA card runs models on the processor', (platform) => {
  const hw = readHardware({ modelsDir }, { platform, arch: 'x64', os: fakeOs(), statfsSync: disk(50), existsSync: () => true, readNvidia: () => [] });
  expect(hw.accelerator).toEqual({ backend: 'cpu', vramBytes: null, gpus: [] });
});

test('free space is read from the nearest folder that exists, before the models folder is made', () => {
  const statfsSync = disk(80);
  const parent = path.dirname(modelsDir);
  readHardware({ modelsDir }, { platform: 'darwin', arch: 'arm64', os: fakeOs(), statfsSync, existsSync: (p) => p === parent });
  expect(statfsSync).toHaveBeenCalledWith(parent);
});

test('unreadable free space is null, not zero, so it does not block downloads by mistake', () => {
  const hw = readHardware({ modelsDir }, { platform: 'darwin', arch: 'arm64', os: fakeOs(), statfsSync: () => { throw new Error('EACCES'); }, existsSync: () => true });
  expect(hw.freeDiskBytes).toBeNull();
});

test('nvidia-smi output: MiB per card, blank and bad lines skipped', () => {
  expect(parseNvidiaSmi('12282, NVIDIA GeForce RTX 4070\n\nN/A, broken\n8192, Tesla, T4\n')).toEqual([
    { name: 'NVIDIA GeForce RTX 4070', vramBytes: 12282 * 1024 * 1024 },
    { name: 'Tesla, T4', vramBytes: 8192 * 1024 * 1024 }
  ]);
  expect(parseNvidiaSmi('')).toEqual([]);
});

test('a missing nvidia-smi means no card, not an error', () => {
  const execFileSync = jest.fn(() => { throw Object.assign(new Error('not found'), { code: 'ENOENT' }); });
  const hw = readHardware({ modelsDir }, { platform: 'win32', arch: 'x64', os: fakeOs(), statfsSync: disk(50), existsSync: () => true, execFileSync });
  expect(execFileSync).toHaveBeenCalledWith('nvidia-smi', ['--query-gpu=memory.total,name', '--format=csv,noheader,nounits'], expect.objectContaining({ windowsHide: true }));
  expect(hw.accelerator.backend).toBe('cpu');
});
