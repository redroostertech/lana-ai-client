'use strict';

/** Settings > Capabilities > AI: Local and Cloud wording (src/js/settings-ai-models.model.js). */
const M = require('../../src/js/settings-ai-models.model');

const TOPOLOGY = {
  pip: {
    chat: { url: null, state: 'not_set' },
    embedding: { url: null, state: 'not_set' },
  },
  models: [
    { id: 'nomic', name: 'Nomic Embed Text v1.5 (F16)', role: 'embedding', sizeBytes: 274290560, downloaded: true },
    { id: 'qwen9', name: 'Qwen3.5 9B (Q4_K_M)', role: 'chat', sizeBytes: 5627044256, downloaded: false },
    { id: 'qwen08', name: 'Qwen3.5 0.8B (Q4_K_M)', role: 'draft', sizeBytes: 527502816, downloaded: false },
  ],
  speech: [
    { id: 'vad', name: 'Silero voice detection' },
    { id: 'parakeet', name: 'Parakeet TDT 0.6B v2 (int8), speech to text' },
    { id: 'kokoro', name: 'Kokoro multi-lang v1.0, the LANA voice' },
    { id: 'segmentation', name: 'Pyannote segmentation 3.0, who spoke when' },
    { id: 'embedding', name: 'TitaNet small, telling speakers apart' },
  ],
  server: { url: 'http://127.0.0.1:8080' },
  forge: { url: 'https://forge-api.lanaai.io', reachable: false, sovereign: false },
};
const REMOTE = { ...TOPOLOGY, server: { url: 'https://acme.lanaai.io' } };

// The dev server on this Mac: its own model servers on 8081 and 8082, the cloud off.
const SERVER_AI = {
  chat: { url: 'http://127.0.0.1:8081', state: 'running', model: 'Qwen3.8-9B-Q4_K_M', same_host: true },
  embedding: { url: 'http://127.0.0.1:8082', state: 'running', model: 'nomic-embed-text', same_host: true },
  relay: { enabled: false, url: null },
  routing: 'local_only',
};

const fact = (row, label) => (row.facts.find((f) => f.label === label) || {}).value;

test('served by the LANA server on this computer: the server\'s model, not the engine\'s undownloaded copy', () => {
  const [chat, embedding] = M.localRows(TOPOLOGY, SERVER_AI);
  expect(chat).toMatchObject({ id: 'chat', name: 'Chat', badge: 'Ready', tone: 'green', summary: '' });
  expect(fact(chat, 'Model')).toBe('Qwen3.8-9B-Q4_K_M');
  expect(fact(chat, 'Runs in')).toMatch(/LANA server on this computer, not the local AI engine/);
  expect(fact(embedding, 'Model')).toBe('nomic-embed-text');
  // The app's own copies belong to the local AI engine; they would contradict a running server.
  expect(fact(chat, 'Space on this computer')).toBe('Not reported by Pip');
  expect(JSON.stringify(chat)).not.toMatch(/draft model|Qwen3\.5/);
});

test('the engine\'s own model servers: facts from the app\'s models', () => {
  const own = { ...TOPOLOGY, pip: { chat: { url: 'http://127.0.0.1:9001', state: 'running', model: 'local-chat' }, embedding: { url: null, state: 'not_set' } } };
  const [chat, embedding] = M.localRows(own, SERVER_AI);
  expect(chat).toMatchObject({ badge: 'Ready', summary: '' });
  // What the running Pip server loaded, not the app's catalog copy.
  expect(fact(chat, 'Model')).toBe('local-chat');
  expect(fact(chat, 'Space on this computer')).toBe('Not reported by Pip');
  expect(fact(chat, 'Runs in')).toBe('The local AI engine on this computer, at http://127.0.0.1:9001');
  expect(fact(chat, 'Good for')).toMatch(/Answering questions/);
  // Embedding is not the engine's, so the server on this computer serves it.
  expect(fact(embedding, 'Runs in')).toMatch(/LANA server on this computer/);
});

test('the server\'s model servers count only when the server runs on this computer', () => {
  const [chat] = M.localRows(REMOTE, SERVER_AI);
  expect(chat).toMatchObject({ badge: 'Not set up', summary: 'Not running on this computer' });
  expect(fact(chat, 'Runs in')).toMatch(/^Nothing on this computer runs it yet/);
  // Nothing running: the app's catalog copy the engine will use, and its size.
  expect(fact(chat, 'Model')).toBe('Qwen3.5 9B (Q4_K_M), with Qwen3.5 0.8B (Q4_K_M)');
  expect(fact(chat, 'Space on this computer')).toBe('6.2 GB, not downloaded yet');
  const own = { ...REMOTE, pip: { ...REMOTE.pip, chat: { url: 'http://127.0.0.1:9001', state: 'running', model: 'local-chat' } } };
  expect(fact(M.localRows(own, null)[0], 'Runs in')).toBe('The local AI engine on this computer, at http://127.0.0.1:9001');
});

test('every model row has the same details in the same order', () => {
  const order = ['Model', 'Runs in', 'Good for', 'How it is used', 'Space on this computer'];
  const own = { ...TOPOLOGY, pip: { chat: { url: 'http://127.0.0.1:9001', state: 'running', model: 'x' }, embedding: { url: null, state: 'not_set' } } };
  const rows = [
    ...M.localRows(TOPOLOGY, SERVER_AI), ...M.localRows(own, SERVER_AI), ...M.localRows(REMOTE, null),
    M.speechRow('speech', TOPOLOGY, { sizeText: '704 MB', state: { kind: 'ready' } }),
    M.speechRow('voice', TOPOLOGY, null),
  ];
  rows.forEach((row) => expect(row.facts.map((f) => f.label)).toEqual(order));
});

test('Speech and Voice: their models, and size and state from Briefs', () => {
  const speech = M.speechRow('speech', TOPOLOGY, { id: 'transcription', sizeText: '704 MB', state: { kind: 'ready' } });
  expect(speech).toMatchObject({ id: 'speech', briefsId: 'transcription', name: 'Speech', summary: '' });
  expect(fact(speech, 'Model')).toBe('Silero voice detection; Parakeet TDT 0.6B v2 (int8), speech to text; Pyannote segmentation 3.0, who spoke when; TitaNet small, telling speakers apart');
  expect(fact(speech, 'Space on this computer')).toBe('About 704 MB');
  const voice = M.speechRow('voice', TOPOLOGY, { id: 'voice', sizeText: '310 MB', state: { kind: 'notDownloaded' } });
  expect(voice).toMatchObject({ briefsId: 'voice', name: 'Voice', summary: 'Not used in this app yet' });
  expect(fact(voice, 'Model')).toBe('Kokoro multi-lang v1.0, the LANA voice');
  expect(fact(voice, 'Space on this computer')).toBe('About 310 MB when downloaded');
});

test('the cloud, and whether the server uses it', () => {
  expect(M.cloudRows(TOPOLOGY, SERVER_AI)).toEqual([
    { label: 'Forge', value: 'Not reachable' },
    { label: 'Used by your server', value: 'No, turned off on your server' },
  ]);
  expect(M.cloudRows(TOPOLOGY, { ...SERVER_AI, relay: { enabled: true } })[1].value).toBe('Yes');
  expect(M.cloudRows(TOPOLOGY, null)[1].value).toBe('Unknown');
  expect(JSON.stringify(M.cloudRows(TOPOLOGY, SERVER_AI))).not.toContain('forge-api');
});
