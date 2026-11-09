'use strict';

/** Settings > Capabilities > AI: Speech, Voice and Cloud wording (src/js/settings-ai-models.model.js). */
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

// The dev server on this Mac: its own model servers on 8081 and 8082, the cloud off.
const SERVER_AI = {
  chat: { url: 'http://127.0.0.1:8081', state: 'running', model: 'Qwen3.8-9B-Q4_K_M', same_host: true },
  embedding: { url: 'http://127.0.0.1:8082', state: 'running', model: 'nomic-embed-text', same_host: true },
  relay: { enabled: false, url: null },
  routing: 'local_only',
};

const fact = (row, label) => (row.facts.find((f) => f.label === label) || {}).value;

test('every model row has the same details in the same order', () => {
  const order = ['Model', 'Runs in', 'Good for', 'How it is used', 'Space on this computer'];
  const rows = [
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

test('Speech or Voice the plan left out says why, unless it is already here', () => {
  const planned = { install: false, reason: 'This computer does not have enough memory for listening.' };
  expect(M.speechRow('speech', TOPOLOGY, { sizeText: '704 MB', state: { kind: 'notDownloaded' } }, planned).summary).toBe(planned.reason);
  expect(M.speechRow('speech', TOPOLOGY, { sizeText: '704 MB', state: { kind: 'ready' } }, planned).summary).toBe('');
  expect(M.speechRow('speech', TOPOLOGY, { sizeText: '704 MB', state: { kind: 'notDownloaded' } }, { install: true, reason: null }).summary).toBe('Not downloaded');
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
