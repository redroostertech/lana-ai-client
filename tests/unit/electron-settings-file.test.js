'use strict';

/**
 * The client's settings file (electron-settings-file.js). On 2026-11-05 a network name
 * change made the file unreadable, and the old code deleted it twice. Now the key is built
 * from the hardware id, an older file is moved to it once, and an unreadable file is set
 * aside, never deleted.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { openSettingsStore, stableKey, legacyKey, machineId } = require('../../electron-settings-file');

/** An electron-store stand-in: the file holds `<key>:<json>`; a wrong key throws, as the real one does. */
class KeyedStore {
  constructor({ name, cwd, encryptionKey, defaults }) {
    this.file = path.join(cwd, `${name}.json`);
    this.key = encryptionKey;
    if (fs.existsSync(this.file)) {
      const raw = fs.readFileSync(this.file, 'utf8');
      const sep = raw.indexOf(':');
      if (raw.slice(0, sep) !== encryptionKey) throw new SyntaxError('Unexpected token');
      this._data = JSON.parse(raw.slice(sep + 1));
    } else {
      this._data = { ...defaults };
      this.write();
    }
  }
  write() { fs.writeFileSync(this.file, `${this.key}:${JSON.stringify(this._data)}`); }
  get store() { return this._data; }
  set store(value) { this._data = { ...value }; this.write(); }
  get(key) { return this._data[key]; }
}

let dir;
const log = { info: jest.fn(), error: jest.fn() };
const options = { name: 'server-config', defaults: { server: null } };
const open = (key, legacy) => openSettingsStore({ Store: class extends KeyedStore { constructor(o) { super({ ...o, cwd: dir }); } }, options, directory: dir, key, legacy, log, now: () => new Date(1700000000000) });
const write = (key, data) => fs.writeFileSync(path.join(dir, 'server-config.json'), `${key}:${JSON.stringify(data)}`);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-file-'));
  log.info.mockClear();
  log.error.mockClear();
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('the client settings file', () => {
  test('opens with the stable key (control)', () => {
    write('stable', { server: { orgId: 'harlow' } });
    const { store, outcome } = open('stable', 'legacy');
    expect(outcome).toBe('opened');
    expect(store.get('server')).toEqual({ orgId: 'harlow' });
  });

  test('a file written with the old host-name key is read once and rewritten with the stable key, nothing lost', () => {
    write('legacy', { server: { orgId: 'harlow' }, authTokenEncrypted: 'cipher' });
    const { store, outcome } = open('stable', 'legacy');
    expect(outcome).toBe('migrated');
    expect(store.store).toEqual({ server: { orgId: 'harlow' }, authTokenEncrypted: 'cipher' });
    expect(fs.readFileSync(path.join(dir, 'server-config.json'), 'utf8').startsWith('stable:')).toBe(true);
    expect(fs.readdirSync(dir)).toEqual(['server-config.json']);
    expect(open('stable', 'something-else').outcome).toBe('opened');
  });

  test('a file neither key opens is set aside, never deleted, and the app starts fresh', () => {
    write('a-key-from-another-name', { server: { orgId: 'harlow' } });
    const { store, outcome } = open('stable', 'legacy');
    expect(outcome).toBe('setAside');
    expect(store.get('server')).toBeNull();
    const aside = path.join(dir, 'server-config.unreadable-1700000000000.json');
    expect(fs.readFileSync(aside, 'utf8')).toBe('a-key-from-another-name:{"server":{"orgId":"harlow"}}');
    expect(log.error.mock.calls[0][0]).toContain('set aside');
  });

  test('no file: fresh settings, nothing set aside', () => {
    const { outcome } = open('stable', 'legacy');
    expect(outcome).toBe('opened');
    expect(fs.readdirSync(dir)).toEqual(['server-config.json']);
  });
});

describe('the settings key', () => {
  test('does not change with the network name; the legacy key does', () => {
    const key = (hostname) => stableKey({ id: 'ABCD-1234', homedir: '/Users/x', legacy: legacyKey({ hostname, homedir: '/Users/x' }) });
    expect(key('MBP-5066.local')).toBe(key('MBP-5117.local'));
    expect(legacyKey({ hostname: 'MBP-5066.local', homedir: '/Users/x' })).not.toBe(legacyKey({ hostname: 'MBP-5117.local', homedir: '/Users/x' }));
    expect(legacyKey({ hostname: 'h', homedir: '/Users/x' })).toBe(crypto.createHash('sha256').update('h-/Users/x-lana-ai-client-stable').digest('hex'));
  });

  test('falls back to the legacy key only when the hardware id cannot be read', () => {
    expect(stableKey({ id: null, homedir: '/Users/x', legacy: 'legacy' })).toBe('legacy');
  });

  test('reads the hardware id on macOS, Windows and Linux; anything else is null', () => {
    const mac = machineId({ platform: 'darwin', run: () => '  "IOPlatformUUID" = "564d1a2b-0000-4000-8000-00000000abcd"\n' });
    expect(mac).toBe('564D1A2B-0000-4000-8000-00000000ABCD');
    const win = machineId({ platform: 'win32', run: () => '    MachineGuid    REG_SZ    A1B2C3D4-0000-4000-8000-000000000001\r\n' });
    expect(win).toBe('a1b2c3d4-0000-4000-8000-000000000001');
    expect(machineId({ platform: 'linux', read: () => '0123456789abcdef0123456789abcdef\n' })).toBe('0123456789abcdef0123456789abcdef');
    expect(machineId({ platform: 'darwin', run: () => { throw new Error('no ioreg'); } })).toBeNull();
    expect(machineId({ platform: 'linux', read: () => 'not-an-id' })).toBeNull();
  });

  test('this computer has a hardware id', () => {
    if (process.platform === 'darwin') expect(machineId()).toMatch(/^[0-9A-F-]{36}$/);
  });
});
