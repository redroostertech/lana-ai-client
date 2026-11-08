'use strict';

/** Settings > Capabilities > AI models wording (src/js/settings-ai-models.model.js). */
const M = require('../../src/js/settings-ai-models.model');

const TOPOLOGY = {
  pip: {
    pinned: { version: '3.0.0', build: 'ddedf87af419' },
    chat: { url: null, state: 'not_set' },
    embedding: { url: null, state: 'not_set' },
    models: [
      { id: 'embed', name: 'Nomic Embed Text v1.5 (F16)', role: 'embedding', sizeBytes: 274290560, downloaded: true },
      { id: 'chat', name: 'Qwen3.5 9B (Q4_K_M)', role: 'chat', sizeBytes: 5627044256, downloaded: false },
    ],
  },
  server: { url: 'http://127.0.0.1:8080' },
  forge: { url: 'https://forge-api.lanaai.io', reachable: false, sovereign: false },
};
const REMOTE = { ...TOPOLOGY, server: { url: 'https://acme.lanaai.io' } };

// The dev server on this Mac: its own Pip on 8081 and 8082, relay off.
const SERVER_AI = {
  backend: 'lqe',
  chat: { url: 'http://127.0.0.1:8081', state: 'running', version: '3.0.0', build: 'ddedf87af419', model: 'Qwen3.8-9B-Q4_K_M', same_host: true },
  embedding: { url: 'http://127.0.0.1:8082', state: 'running', version: '3.0.0', build: 'ddedf87af419', model: 'nomic-embed-text', same_host: true },
  relay: { enabled: false, url: null },
  routing: 'local_only',
};

test('the server\'s Pip counts as this computer\'s only when the server runs here', () => {
  expect(M.pipRows(TOPOLOGY, SERVER_AI)).toEqual([
    { name: 'Chat model server', badge: 'Running', tone: 'green', detail: 'http://127.0.0.1:8081 · Qwen3.8-9B-Q4_K_M · Pip 3.0.0 · build ddedf87af419' },
    { name: 'Embedding model server', badge: 'Running', tone: 'green', detail: 'http://127.0.0.1:8082 · nomic-embed-text · Pip 3.0.0 · build ddedf87af419' },
  ]);
  expect(M.pipRows(REMOTE, SERVER_AI)[0]).toMatchObject({ badge: 'Not set up', detail: 'Not running on this computer.' });
  const own = { ...TOPOLOGY, pip: { ...TOPOLOGY.pip, chat: { url: 'http://127.0.0.1:9001', state: 'not_running' } } };
  expect(M.pipRows(own, SERVER_AI)[0].badge).toBe('Not running');
});

test('pinned build and catalog models', () => {
  expect(M.pinnedLine(TOPOLOGY)).toBe('LANA expects Pip 3.0.0 (build ddedf87af419).');
  expect(M.modelRows(TOPOLOGY)).toEqual([
    { name: 'Nomic Embed Text v1.5 (F16)', detail: 'Search embeddings · 274 MB', badge: 'Downloaded', tone: 'green' },
    { name: 'Qwen3.5 9B (Q4_K_M)', detail: 'Chat · 5.6 GB', badge: 'Not downloaded', tone: 'gray' },
  ]);
});

test('the server\'s AI comes from its own report, never assumed', () => {
  const ai = (topology, serverAi) => M.serverRows(topology, { version: '2.0.0', environment: 'development' }, serverAi)[2].value;
  expect(ai(TOPOLOGY, SERVER_AI)).toBe('Pip · Qwen3.8-9B-Q4_K_M, on this computer');
  expect(ai(REMOTE, SERVER_AI)).toBe('Pip · Qwen3.8-9B-Q4_K_M, on the server\'s computer');
  expect(ai(TOPOLOGY, { ...SERVER_AI, routing: 'hybrid' })).toBe('Pip · Qwen3.8-9B-Q4_K_M, on this computer, or Forge when a prompt needs it');
  expect(ai(TOPOLOGY, { ...SERVER_AI, routing: 'relay_only' })).toBe('Forge');
  expect(ai(TOPOLOGY, null)).toBe('Unknown (this server does not report it)');
  expect(M.serverRows(TOPOLOGY, { version: '2.0.0', environment: 'development' }, SERVER_AI).slice(0, 2)).toEqual([
    { label: 'Address', value: 'http://127.0.0.1:8080 (this computer)' },
    { label: 'Version', value: '2.0.0 (development)' },
  ]);
});

test('Forge, and whether the server uses it', () => {
  expect(M.forgeRows(TOPOLOGY, SERVER_AI)).toEqual([
    { label: 'Address', value: 'https://forge-api.lanaai.io' },
    { label: 'Status', value: 'Not reachable' },
    { label: 'Used by your server', value: 'No, turned off on your server' },
    { label: 'Sovereign mode', value: 'Off' },
  ]);
  expect(M.forgeRows(TOPOLOGY, { ...SERVER_AI, relay: { enabled: true } })[2].value).toBe('Yes');
  expect(M.forgeRows(TOPOLOGY, null)[2].value).toBe('Unknown');
});

test('where prompts go follows the server\'s routing', () => {
  expect(M.routing({ inUse: false }, TOPOLOGY, SERVER_AI)).toEqual(['The LANA server on this computer answers every prompt with Pip. Forge is turned off on it, so no prompt leaves it.']);
  expect(M.routing({ inUse: false }, REMOTE, { ...SERVER_AI, routing: 'relay_only' })).toEqual(['Your organization\'s server sends every prompt to Forge.']);
  expect(M.routing({ inUse: true }, REMOTE, { ...SERVER_AI, routing: 'hybrid' })[0]).toBe('Prompts go to the local AI engine on this computer first.');
  expect(M.routing(null, REMOTE, null)).toEqual(['Your organization\'s server answers prompts. It does not report how it routes them.']);
});
