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

test('Chat and Embedding: status from what runs here, facts from the app\'s models', () => {
  const [chat, embedding] = M.localRows(TOPOLOGY, SERVER_AI);
  expect(chat).toMatchObject({ id: 'chat', name: 'Chat', badge: 'Running', tone: 'green', summary: '' });
  expect(fact(chat, 'Model')).toBe('Qwen3.5 9B (Q4_K_M), with Qwen3.5 0.8B (Q4_K_M)');
  expect(fact(chat, 'Space on this computer')).toBe('6.2 GB, not downloaded yet');
  expect(fact(chat, 'Running now')).toBe('Qwen3.8-9B-Q4_K_M, served by the LANA server on this computer');
  expect(fact(chat, 'Good for')).toMatch(/Answering questions/);
  expect(fact(embedding, 'Space on this computer')).toBe('274 MB, downloaded');
});

test('the server\'s model servers count only when the server runs on this computer', () => {
  const [chat] = M.localRows(REMOTE, SERVER_AI);
  expect(chat).toMatchObject({ badge: 'Not set up', summary: 'Not running on this computer' });
  expect(fact(chat, 'Running now')).toBeUndefined();
  const own = { ...REMOTE, pip: { ...REMOTE.pip, chat: { url: 'http://127.0.0.1:9001', state: 'running', model: 'local-chat' } } };
  expect(fact(M.localRows(own, null)[0], 'Running now')).toBe('local-chat, at http://127.0.0.1:9001');
});

test('Speech and Voice: their models, and size and state from Briefs', () => {
  const speech = M.speechRow('speech', TOPOLOGY, { id: 'transcription', sizeText: '704 MB', state: { kind: 'ready' } });
  expect(speech).toMatchObject({ id: 'speech', briefsId: 'transcription', name: 'Speech', summary: '' });
  expect(fact(speech, 'Models')).toBe('Silero voice detection; Parakeet TDT 0.6B v2 (int8), speech to text; Pyannote segmentation 3.0, who spoke when; TitaNet small, telling speakers apart');
  expect(fact(speech, 'Space on this computer')).toBe('About 704 MB');
  const voice = M.speechRow('voice', TOPOLOGY, { id: 'voice', sizeText: '310 MB', state: { kind: 'notDownloaded' } });
  expect(voice).toMatchObject({ briefsId: 'voice', name: 'Voice', summary: 'Not used in this app yet' });
  expect(fact(voice, 'Models')).toBe('Kokoro multi-lang v1.0, the LANA voice');
  expect(fact(voice, 'Space on this computer')).toBe('About 310 MB when downloaded');
});

test('the cloud, and whether the server uses it', () => {
  expect(M.cloudRows(TOPOLOGY, SERVER_AI)).toEqual([
    { label: 'Address', value: 'https://forge-api.lanaai.io' },
    { label: 'Status', value: 'Not reachable' },
    { label: 'Used by your server', value: 'No, turned off on your server' },
    { label: 'Sovereign mode', value: 'Off' },
  ]);
  expect(M.cloudRows(TOPOLOGY, { ...SERVER_AI, relay: { enabled: true } })[2].value).toBe('Yes');
  expect(M.cloudRows(TOPOLOGY, null)[2].value).toBe('Unknown');
});
