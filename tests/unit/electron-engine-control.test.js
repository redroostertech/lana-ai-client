/**
 * The control channel to the local engine (electron-engine-control.js,
 * phase 8d): requests carry the engine process's secret, a wrong secret is
 * refused by an engine that checks it (a stand-in with the engine's rule),
 * and the secret is never sent anywhere but a loopback address.
 */

const http = require('http');
const crypto = require('crypto');
const { createEngineControlClient, generateControlSecret, isLoopback, SECRET_HEADER } = require('../../electron-engine-control');

function standInEngine(secret) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, secret: req.headers[SECRET_HEADER.toLowerCase()], body: raw ? JSON.parse(raw) : null });
      const supplied = req.headers[SECRET_HEADER.toLowerCase()] || '';
      const ok = crypto.timingSafeEqual(crypto.createHash('sha256').update(secret).digest(), crypto.createHash('sha256').update(supplied).digest());
      if (!ok) {
        res.writeHead(403, { 'Content-Type': 'application/problem+json' }).end(JSON.stringify({ code: 'ENGINE_CONTROL_REFUSED' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ handed_off: 0, signed_in: true, running: [] }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}

const fetchWithTimeout = (url, { timeoutMs, ...init }) => fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs || 3000) });

describe('engine control client', () => {
  let engine;
  const secret = generateControlSecret();
  beforeAll(async () => { engine = await standInEngine(secret); });
  afterAll(() => new Promise((resolve) => engine.server.close(resolve)));

  test('secrets are 32 random bytes, different every time', () => {
    const a = generateControlSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(generateControlSecret()).not.toBe(a);
  });

  test('a wrong secret is refused by the engine (control: the right secret is accepted and carried on every call)', async () => {
    const wrong = createEngineControlClient({ fetch: fetchWithTimeout, getBaseUrl: () => engine.url, getSecret: () => generateControlSecret() });
    expect(await wrong.setSession('tok')).toEqual({ ok: false, error: 'ENGINE_CONTROL_REFUSED' });
    expect(await wrong.sendSignals({ about_to_sleep: true })).toEqual({ ok: false, error: 'ENGINE_CONTROL_REFUSED' });
    const right = createEngineControlClient({ fetch: fetchWithTimeout, getBaseUrl: () => engine.url, getSecret: () => secret });
    expect((await right.setSession('tok')).ok).toBe(true);
    expect((await right.sendSignals({ about_to_sleep: true })).ok).toBe(true);
    expect((await right.backgroundJobs()).body).toMatchObject({ running: [] });
    const accepted = engine.seen.filter((r) => r.secret === secret);
    expect(accepted.map((r) => `${r.method} ${r.url}`)).toEqual([
      'PUT /api/engine/v1/control/session', 'PUT /api/engine/v1/control/signals', 'GET /api/engine/v1/control/background-jobs'
    ]);
    expect(accepted[0].body).toEqual({ session_token: 'tok' });
  });

  test('the secret is never sent off this computer, and nothing is sent without a running engine', async () => {
    const calls = [];
    const spy = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({}) }; };
    for (const base of ['https://chef.example.test', 'http://10.0.0.146:8079', 'http://127.0.0.1.evil.test:8079']) {
      const client = createEngineControlClient({ fetch: spy, getBaseUrl: () => base, getSecret: () => secret });
      expect(await client.setSession('tok')).toEqual({ ok: false, error: 'not_loopback' });
    }
    const none = createEngineControlClient({ fetch: spy, getBaseUrl: () => 'http://127.0.0.1:8079', getSecret: () => null });
    expect(await none.sendSignals({})).toEqual({ ok: false, error: 'not_running' });
    expect(calls).toEqual([]);
    expect(isLoopback('http://127.0.0.1:1')).toBe(true);
    expect(isLoopback('http://localhost:1')).toBe(true);
  });
});
