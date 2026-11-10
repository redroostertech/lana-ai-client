'use strict';

// electron-chef-pin.js: the box Chef's self-signed certificate is trusted only
// by the control plane's SHA-256 pin, for that one host and port; every other
// server keeps the default certificate checks.

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const axios = require('axios');
const pin = require('../../electron-chef-pin');

// Certificates are made for the run with openssl (a box's own, an impostor's,
// and a leaf signed by a test CA standing in for a public CA), in a temp folder.
// Without openssl the TLS tests are skipped; the pure ones still run.
function makeCertificates() {
  const { execFileSync } = require('node:child_process');
  const os = require('node:os');
  try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); } catch (_) { return null; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chef-pin-'));
  const at = (name) => path.join(dir, name);
  fs.writeFileSync(at('ext.cnf'), [
    '[req]', 'distinguished_name = dn', 'prompt = no', '[dn]', 'CN = 127.0.0.1',
    '[box]', 'subjectAltName = IP:127.0.0.1, DNS:localhost', 'keyUsage = critical, digitalSignature, keyEncipherment',
    'extendedKeyUsage = serverAuth', 'basicConstraints = critical, CA:FALSE',
    '[ca]', 'basicConstraints = critical, CA:TRUE', 'keyUsage = critical, keyCertSign, cRLSign', ''
  ].join('\n'));
  const run = (args) => execFileSync('openssl', args, { stdio: 'ignore' });
  const key = (name) => run(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', at(name + '-key.pem')]);
  for (const name of ['box', 'other']) {
    key(name);
    run(['req', '-new', '-x509', '-sha256', '-days', '2', '-key', at(name + '-key.pem'), '-out', at(name + '-cert.pem'), '-config', at('ext.cnf'), '-extensions', 'box', '-subj', '/CN=127.0.0.1/O=LANA test ' + name]);
  }
  key('ca');
  run(['req', '-new', '-x509', '-sha256', '-days', '2', '-key', at('ca-key.pem'), '-out', at('ca-cert.pem'), '-config', at('ext.cnf'), '-extensions', 'ca', '-subj', '/CN=LANA test CA']);
  key('public');
  run(['req', '-new', '-key', at('public-key.pem'), '-out', at('public.csr'), '-subj', '/CN=localhost/O=LANA test public']);
  run(['x509', '-req', '-in', at('public.csr'), '-CA', at('ca-cert.pem'), '-CAkey', at('ca-key.pem'), '-CAcreateserial', '-days', '2', '-sha256', '-extfile', at('ext.cnf'), '-extensions', 'box', '-out', at('public-cert.pem')]);
  const read = (name) => fs.readFileSync(at(name), 'utf8');
  const made = {
    BOX: { cert: read('box-cert.pem'), key: read('box-key.pem') },
    OTHER: { cert: read('other-cert.pem'), key: read('other-key.pem') },
    PUBLIC: { cert: read('public-cert.pem'), key: read('public-key.pem') },
    CA: read('ca-cert.pem')
  };
  fs.rmSync(dir, { recursive: true, force: true });
  return made;
}

const CERTS = makeCertificates();
const tlsDescribe = CERTS ? describe : describe.skip;
const { BOX, OTHER, PUBLIC, CA } = CERTS || { BOX: {}, OTHER: {}, PUBLIC: {}, CA: '' };
const hexOf = (pem) => new crypto.X509Certificate(pem).fingerprint256.replace(/:/g, '').toLowerCase();
// A fixed pin for the pure tests; the box's real one for the TLS tests.
const BOX_PIN = CERTS ? hexOf(BOX.cert) : 'b4d61211abd564e980f543eafd6839070726e1c8b86473fff3cc3728580301c8';

function serve(credentials) {
  return new Promise((resolve) => {
    const seen = [];
    const server = https.createServer(credentials, (req, res) => {
      seen.push({ url: req.url, authorization: req.headers.authorization || null });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'healthy' }));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, seen }));
  });
}

const servers = {};
beforeAll(async () => {
  if (!CERTS) return;
  servers.box = await serve(BOX);
  servers.impostor = await serve(OTHER);
  servers.unpinned = await serve(OTHER);
  servers.publicCa = await serve(PUBLIC);
});
afterAll(async () => {
  if (!CERTS) return;
  await Promise.all(Object.values(servers).map((s) => new Promise((resolve) => { s.server.closeAllConnections(); s.server.close(resolve); })));
});

const pinFor = (port, sha256 = BOX_PIN) => ({ host: '127.0.0.1', port, sha256 });

describe('pin format', () => {
  test('hex pin to the base64 fingerprint Electron reports', () => {
    // Electron's fingerprint is base64 of the same SHA-256 digest the hex pin spells.
    const expected = 'sha256/' + Buffer.from(BOX_PIN, 'hex').toString('base64');
    if (CERTS) {
      const der = new crypto.X509Certificate(BOX.cert).raw;
      expect('sha256/' + crypto.createHash('sha256').update(der).digest('base64')).toBe(expected);
    }
    expect(pin.hexPinToElectronFingerprint(BOX_PIN)).toBe(expected);
    // Colons and case are ignored; anything that is not 64 hex characters is no pin.
    expect(pin.hexPinToElectronFingerprint(BOX_PIN.toUpperCase().match(/../g).join(':'))).toBe(expected);
    expect(pin.hexPinToElectronFingerprint('abc')).toBe(null);
    expect(pin.hexPinToElectronFingerprint(null)).toBe(null);
  });

  test('the pin is read from the control plane answer, never from the box', () => {
    expect(pin.pinFromDiscoveryAnswer({ chef_cert_sha256: BOX_PIN })).toBe(BOX_PIN);
    expect(pin.pinFromDiscoveryAnswer({ discovery: { chef_cert_sha256: BOX_PIN.toUpperCase() } })).toBe(BOX_PIN);
    expect(pin.pinFromDiscoveryAnswer({ discovery: { certSha256: BOX_PIN } })).toBe(null);
    expect(pin.pinFromDiscoveryAnswer({ discovery: {} })).toBe(null);
  });

  test('a pinned server is reached over https; an unpinned one as given', () => {
    expect(pin.chefUrlFor({ host: '10.0.0.5', port: 8080, chefCertSha256: BOX_PIN })).toBe('https://10.0.0.5:8080');
    expect(pin.chefUrlFor({ url: 'http://10.0.0.5:8080', chefCertSha256: BOX_PIN })).toBe('https://10.0.0.5:8080');
    expect(pin.chefUrlFor({ host: '10.0.0.5', port: 8080 })).toBe('http://10.0.0.5:8080');
    expect(pin.chefUrlFor({ url: 'https://firm.lanaai.io' })).toBe('https://firm.lanaai.io');
    expect(pin.pinFromServer({ url: 'https://10.0.0.5:8080', chefCertSha256: BOX_PIN })).toEqual({ host: '10.0.0.5', port: 8080, sha256: BOX_PIN });
    expect(pin.pinFromServer({ url: 'http://10.0.0.5:8080', chefCertSha256: BOX_PIN })).toBe(null);
    expect(pin.pinFromServer({ url: 'https://firm.lanaai.io' })).toBe(null);
  });
});

describe('renderer: certificate verify proc', () => {
  const p = pinFor(8080);
  const request = (hostname, fingerprint, verificationResult = 'net::ERR_CERT_AUTHORITY_INVALID') => ({ hostname, certificate: { fingerprint }, verificationResult });

  test('the pinned host with the pinned certificate is accepted', () => {
    expect(pin.verifyCertificate(request('127.0.0.1', pin.hexPinToElectronFingerprint(BOX_PIN)), p)).toBe(0);
  });

  test('the pinned host with any other certificate is refused', () => {
    expect(pin.verifyCertificate(request('127.0.0.1', pin.hexPinToElectronFingerprint('cd'.repeat(32))), p)).toBe(-2);
    expect(pin.refusalFor(request('127.0.0.1', 'x'), p, -2)).toBe('mismatch');
  });

  test('every other host gets Chromium\'s own checks (a self-signed one is refused there)', () => {
    expect(pin.verifyCertificate(request('10.9.9.9', pin.hexPinToElectronFingerprint(BOX_PIN)), p)).toBe(-3);
    expect(pin.verifyCertificate(request('firm.lanaai.io', 'sha256/x', 'net::OK'), p)).toBe(-3);
    expect(pin.verifyCertificate(request('10.0.0.5', 'sha256/x'), null)).toBe(-3);
    expect(pin.refusalFor(request('10.0.0.5', 'sha256/x'), null, -3)).toBe('untrusted');
    expect(pin.refusalFor(request('firm.lanaai.io', 'sha256/x', 'net::OK'), p, -3)).toBe(null);
  });
});

tlsDescribe('main process: undici dispatcher (fetch)', () => {
  // Under Jest the error crosses realms and Node's fetch keeps only its message.
  const causeCode = (promise) => promise.then(() => 'answered', (error) => (error.cause && (error.cause.code || String(error.cause.message))) || '');
  const get = (port, dispatcher) => fetch(`https://127.0.0.1:${port}/api/health/discovery`, { dispatcher, headers: { Authorization: 'Bearer secret' } });

  test('a pin match is accepted', async () => {
    const d = pin.createPinnedDispatcher(() => pinFor(servers.box.port));
    const res = await get(servers.box.port, d);
    expect(await res.json()).toEqual({ status: 'healthy' });
    await d.close();
  });

  test('a mismatch is refused before anything is sent', async () => {
    const d = pin.createPinnedDispatcher(() => pinFor(servers.impostor.port));
    expect(await causeCode(get(servers.impostor.port, d))).toMatch(/CHEF_CERT_PIN_MISMATCH|PinMismatchError/);
    expect(servers.impostor.seen).toEqual([]);
    await d.close();
  });

  test('an unpinned self-signed server is refused', async () => {
    const d = pin.createPinnedDispatcher(() => pinFor(servers.box.port));
    expect(await causeCode(get(servers.unpinned.port, d))).toBe('DEPTH_ZERO_SELF_SIGNED_CERT');
    expect(servers.unpinned.seen).toEqual([]);
    await d.close();
  });

  test('a CA-signed host is unaffected by the pin', async () => {
    const d = pin.createPinnedDispatcher(() => pinFor(servers.box.port), { defaultTls: { ca: CA } });
    const res = await fetch(`https://localhost:${servers.publicCa.port}/x`, { dispatcher: d });
    expect(res.status).toBe(200);
    await d.close();
  });
});

tlsDescribe('main process: https agent (axios, http(s).request)', () => {
  const get = (port, httpsAgent, host = '127.0.0.1') => axios.get(`https://${host}:${port}/api/health/discovery`, { httpsAgent, timeout: 5000, headers: { Authorization: 'Bearer secret' } });

  test('a pin match is accepted', async () => {
    const agent = pin.createPinnedHttpsAgent(() => pinFor(servers.box.port));
    const res = await get(servers.box.port, agent);
    expect(res.data).toEqual({ status: 'healthy' });
    agent.destroy();
  });

  test('a mismatch is refused before anything is sent', async () => {
    const agent = pin.createPinnedHttpsAgent(() => pinFor(servers.impostor.port));
    await expect(get(servers.impostor.port, agent)).rejects.toMatchObject({ code: 'CHEF_CERT_PIN_MISMATCH' });
    expect(servers.impostor.seen).toEqual([]);
    agent.destroy();
  });

  test('an unpinned self-signed server is refused', async () => {
    const agent = pin.createPinnedHttpsAgent(() => pinFor(servers.box.port));
    await expect(get(servers.unpinned.port, agent)).rejects.toMatchObject({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
    agent.destroy();
  });

  test('a CA-signed host is unaffected by the pin', async () => {
    const agent = pin.createPinnedHttpsAgent(() => pinFor(servers.box.port), { ca: CA });
    const res = await get(servers.publicCa.port, agent, 'localhost');
    expect(res.status).toBe(200);
    agent.destroy();
  });

  test('the same pin on another port of the host is not trusted', async () => {
    const agent = pin.createPinnedHttpsAgent(() => pinFor(servers.box.port + 1 === servers.unpinned.port ? servers.box.port + 2 : servers.box.port + 1));
    await expect(get(servers.box.port, agent)).rejects.toMatchObject({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
    agent.destroy();
  });
});

describe('the app\'s one pin', () => {
  afterEach(() => { pin.settle(); pin.configure({ getSavedServer: () => null }); });

  test('the saved server\'s pin applies, and a prepared one wins until settled', () => {
    pin.configure({ getSavedServer: () => ({ url: 'https://10.0.0.5:8080', chefCertSha256: BOX_PIN }) });
    expect(pin.activePin()).toEqual({ host: '10.0.0.5', port: 8080, sha256: BOX_PIN });
    pin.prepare({ url: 'https://10.0.0.9:8443', chefCertSha256: 'cd'.repeat(32) });
    expect(pin.activePin().host).toBe('10.0.0.9');
    pin.settle();
    expect(pin.activePin().host).toBe('10.0.0.5');
  });

  test('fetch gets the dispatcher only for the pinned Chef', () => {
    pin.configure({ getSavedServer: () => ({ url: 'https://10.0.0.5:8080', chefCertSha256: BOX_PIN }) });
    expect(pin.fetchInit('https://10.0.0.5:8080/api/v1/x', { method: 'POST' })).toMatchObject({ method: 'POST', dispatcher: expect.anything() });
    expect(pin.fetchInit('https://www.redroostertec.com/lana-ai/v1/discovery', { method: 'POST' })).toEqual({ method: 'POST' });
    expect(pin.fetchInit('https://10.0.0.5:9443/health')).toEqual({});
  });

  test('the verify proc records why a host was refused', () => {
    let proc;
    pin.installCertificateVerifyProc({ setCertificateVerifyProc: (fn) => { proc = fn; } });
    const results = [];
    proc({ hostname: '10.0.0.7', certificate: { fingerprint: 'sha256/x' }, verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID' }, (r) => results.push(r));
    expect(results).toEqual([-3]);
    expect(pin.refusalForUrl('https://10.0.0.7:8080')).toBe('untrusted');
    expect(pin.refusalForUrl('https://10.0.0.8:8080')).toBe(null);
  });
});
