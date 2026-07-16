const fs = require('fs');
const os = require('os');
const path = require('path');
const { secureRuntimeDirectory, atomicMetadataWrite } = require('../../../src/main/mcp-relay/endpoint-server');

describe('private relay endpoint discovery', () => {
  const before = process.env.TMPDIR;
  let temp;
  beforeEach(() => { temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lana-relay-test-')); fs.chmodSync(temp, 0o700); process.env.TMPDIR = temp; });
  afterEach(() => { process.env.TMPDIR = before; fs.rmSync(temp, { recursive: true, force: true }); });

  it('creates a per-user 0700 namespace and atomically writes 0600 metadata', () => {
    const runtime = secureRuntimeDirectory(`lana-mcp-development-test-${process.pid}`);
    expect(fs.lstatSync(runtime).mode & 0o077).toBe(0);
    atomicMetadataWrite(runtime, { formatVersion: 1 });
    const filename = path.join(runtime, 'relay.json'); expect(fs.lstatSync(filename).mode & 0o077).toBe(0); expect(JSON.parse(fs.readFileSync(filename))).toEqual({ formatVersion: 1 });
    fs.rmSync(runtime, { recursive: true, force: true });
  });

  it('rejects a symlink namespace', () => {
    const namespace = `evil-${process.pid}`;
    const runtime = secureRuntimeDirectory(namespace); fs.rmSync(runtime, { recursive: true, force: true });
    const target = path.join(temp, 'target'); fs.mkdirSync(target, { mode: 0o700 }); fs.symlinkSync(target, runtime);
    expect(() => secureRuntimeDirectory(namespace)).toThrow('FEATURE_DISABLED'); fs.unlinkSync(runtime);
  });
});
