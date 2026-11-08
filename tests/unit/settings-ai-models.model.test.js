'use strict';

/** Settings > Capabilities > AI models wording (src/js/settings-ai-models.model.js). */
const M = require('../../src/js/settings-ai-models.model');

const TOPOLOGY = {
  pip: {
    pinned: { version: '3.0.0', build: 'ddedf87af419' },
    chat: { url: 'http://127.0.0.1:8081', state: 'running', model: 'Qwen3.5-9B-Q4_K_M.gguf', build: 'b3.0.0' },
    embedding: { url: null, state: 'not_set', model: null, build: null },
    models: [
      { id: 'embed', name: 'Nomic Embed Text v1.5 (F16)', role: 'embedding', sizeBytes: 274290560, downloaded: true },
      { id: 'chat', name: 'Qwen3.5 9B (Q4_K_M)', role: 'chat', sizeBytes: 5627044256, downloaded: false },
    ],
  },
  server: { url: 'http://127.0.0.1:8080' },
  forge: { url: 'https://forge-api.lanaai.io', reachable: true, sovereign: false },
};

test('Pip endpoints, pinned build and models', () => {
  expect(M.pinnedLine(TOPOLOGY)).toBe('LANA expects Pip 3.0.0 (build ddedf87af419).');
  expect(M.pipRows(TOPOLOGY)).toEqual([
    { name: 'Chat model server', badge: 'Running', tone: 'green', detail: 'http://127.0.0.1:8081 · Qwen3.5-9B-Q4_K_M.gguf · Build b3.0.0' },
    { name: 'Embedding model server', badge: 'Not set up', tone: 'gray', detail: 'No address given to LANA on this computer.' },
  ]);
  expect(M.modelRows(TOPOLOGY)).toEqual([
    { name: 'Nomic Embed Text v1.5 (F16)', detail: 'Search embeddings · 274 MB', badge: 'Downloaded', tone: 'green' },
    { name: 'Qwen3.5 9B (Q4_K_M)', detail: 'Chat · 5.6 GB', badge: 'Not downloaded', tone: 'gray' },
  ]);
});

test('the server and Forge', () => {
  expect(M.serverRows(TOPOLOGY, { version: '2.0.0', environment: 'development' })).toEqual([
    { label: 'Address', value: 'http://127.0.0.1:8080 (this computer)' },
    { label: 'Version', value: '2.0.0 (development)' },
    { label: 'AI', value: 'Forge' },
  ]);
  expect(M.serverRows({ server: { url: 'https://acme.lanaai.io' } }, null)[1].value).toBe('Unknown');
  expect(M.forgeRows(TOPOLOGY)).toEqual([
    { label: 'Address', value: 'https://forge-api.lanaai.io' },
    { label: 'Status', value: 'Reachable' },
    { label: 'Sovereign mode', value: 'Off' },
  ]);
  expect(M.forgeRows({ forge: { url: null, reachable: null } })[0].value).toBe('Not set for your organization');
});

test('where prompts go', () => {
  expect(M.routing({ inUse: false }, TOPOLOGY).current).toBe('Prompts go to the LANA server on this computer, which answers with Forge.');
  expect(M.routing({ inUse: false }, { server: { url: 'https://acme.lanaai.io' } }).current).toBe('Prompts go to your organization\'s server, which answers with Forge.');
  expect(M.routing({ inUse: true }, TOPOLOGY).current).toBe('Prompts go to the local AI engine on this computer.');
  expect(M.routing(null, TOPOLOGY).hybrid).toMatch(/not available yet/);
});
