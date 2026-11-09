/**
 * Settings > Capabilities (src/js/settings-capabilities.model.js): the words for every state of
 * the section, and the steps of changing the chat model. The plan views are real plans from
 * local-ai-fit.model.js for made-up computers, shaped as electron-first-launch.js plan() returns
 * them.
 */

const M = require('../../src/js/settings-capabilities.model');
const fit = require('../../src/js/local-ai-fit.model');
const { BUILT_IN, parseCatalog } = require('../../electron-model-catalog');
const { embeddingModel, speechSizes } = require('../../electron-local-models');
const { sizes: doclingSizes } = require('../../electron-docling-install');
const { DOCLING_MEMORY_BYTES } = require('../../electron-docling');
const { REDACTOR_MEMORY_BYTES } = require('../../electron-redactor');

const GB = 1024 ** 3;
const catalog = parseCatalog(BUILT_IN);
const DOCLING = { memoryBytes: DOCLING_MEMORY_BYTES, provided: false, diskBytes: doclingSizes('macos-arm64').diskBytes, downloadBytes: doclingSizes('macos-arm64').downloadBytes };
const IDLE = { phase: 'ready', current: null, receivedBytes: 0, totalBytes: 0, error: null };
const ALL_READY = { pipInstalled: true, chat: 'ready', embedding: 'ready', redactor: 'ready', docling: 'ready' };

function planView(memoryGb, { chosenChatId = null, completedAt = '2026-11-09T12:00:00Z', status = IDLE, docling = DOCLING } = {}) {
  const result = fit.planLocalAi({
    hardware: { totalMemoryBytes: memoryGb * GB, accelerator: { backend: 'metal' }, freeDiskBytes: 200 * GB, chip: 'Test chip' },
    catalog,
    embedding: embeddingModel(),
    speech: speechSizes(),
    redactor: { memoryBytes: REDACTOR_MEMORY_BYTES },
    docling,
    chosenChatId
  });
  return { ...result, status, chosenChatId, acceptedAt: '2026-11-09T11:00:00Z', completedAt };
}

const rowOf = (view, id) => view.rows.find((r) => r.id === id);
const fact = (facts, label) => (facts.find((f) => f.label === label) || {}).value;

describe('the section', () => {
  test('everything local on a 24 GB computer: facts, the chat model, and every row ready', () => {
    const view = M.buildCapabilitiesView({ planView: planView(24), servers: ALL_READY, includeSpeech: true });
    expect(fact(view.computerFacts, 'Memory')).toBe('24 GB');
    expect(fact(view.computerFacts, 'Chip')).toBe('Test chip');
    expect(fact(view.computerFacts, 'Free space')).toBe('200 GB');
    expect(fact(view.computerFacts, 'Chat runs')).toBe('On this computer');
    expect(view.chat).toMatchObject({ cloud: false, name: 'Qwen3.5 9B', detail: 'Good fit for this computer. About 44 pages at once.', badge: 'Ready', tone: 'green', note: '', canChange: true });
    expect(view.rows.map((r) => [r.id, r.badge])).toEqual([
      ['search', 'Ready'], ['images', 'Ready'], ['documents', 'Ready'], ['privacy', 'Ready'], ['speech', 'Ready'], ['voice', 'Ready']
    ]);
    expect(rowOf(view, 'privacy').facts[0].value).toBe('Keeps names and private details out of cloud requests.');
    expect(rowOf(view, 'documents').facts[0].value).toBe('Reads your documents on this computer.');
    expect(view.progress).toBeNull();
    expect(view.currentChatId).toBe('qwen3.5-9b-q4');
  });

  test('no ids, addresses or paths reach the screen', () => {
    const view = M.buildCapabilitiesView({ planView: planView(24), servers: ALL_READY, includeSpeech: true });
    const shown = JSON.stringify({ ...view, currentChatId: null, choices: view.choices.map((c) => ({ ...c, value: null })) });
    expect(shown).not.toMatch(/qwen3\.5-|nomic|https?:|\/models|127\.0\.0\.1|\.gguf/);
  });

  test('the chat choices are the first-launch ones: the current one listed, too big ones disabled with their reason', () => {
    const view = M.buildCapabilitiesView({ planView: planView(24), servers: ALL_READY });
    const big = view.choices.find((c) => c.disabled);
    expect(big.description).toMatch(/^This model needs a computer with about \d+ GB of memory\.$/);
    const nine = view.choices.find((c) => c.value === 'qwen3.5-9b-q4');
    expect(nine).toMatchObject({ label: 'Qwen3.5 9B (recommended)', disabled: false });
    expect(nine.description).toMatch(/^Good fit for this computer\. About 44 pages at once\. [\d.]+ GB file\.$/);
  });

  test('chat in the cloud: no model, no change button, nothing to choose, image reading says why', () => {
    const view = M.buildCapabilitiesView({ planView: planView(4), servers: { ...ALL_READY, chat: 'not_running' }, includeSpeech: true });
    expect(fact(view.computerFacts, 'Chat runs')).toBe('In the cloud');
    expect(view.chat).toMatchObject({ cloud: true, name: 'None on this computer', badge: null, canChange: false });
    expect(view.choices).toEqual([]);
    expect(rowOf(view, 'images')).toMatchObject({ badge: 'Off', summary: 'Uses the cloud, with chat.' });
    // No row's line repeats its own name.
    view.rows.forEach((r) => expect(r.summary.startsWith(r.name)).toBe(false));
  });

  test('Docling left out for memory: Off with the plan\'s reason, and no "where it runs"', () => {
    const view = M.buildCapabilitiesView({ planView: planView(8), servers: { ...ALL_READY, docling: 'not_installed' } });
    const documents = rowOf(view, 'documents');
    expect(documents).toMatchObject({ badge: 'Off', tone: 'gray', summary: 'This computer does not have enough memory to read documents here, so your organization\'s server reads them.' });
    expect(documents.facts.map((f) => f.label)).toEqual(['What it does']);
  });

  test('a Docling that failed to install says LANA tries again; one waiting to install says so', () => {
    const failed = M.buildCapabilitiesView({ planView: planView(24), servers: { ...ALL_READY, docling: 'not_installed' }, status: { ...IDLE, docling: { installed: false, error: { code: 'http' } } } });
    expect(rowOf(failed, 'documents')).toMatchObject({ badge: 'Not installed', summary: 'It could not be installed. LANA tries again the next time it opens.' });
    const waiting = M.buildCapabilitiesView({ planView: planView(24), servers: { ...ALL_READY, docling: 'not_installed' } });
    expect(rowOf(waiting, 'documents').summary).toBe('LANA installs it with the other files.');
  });

  test('no privacy filter: Off, and chats stay off the cloud', () => {
    const view = M.buildCapabilitiesView({ planView: planView(24), servers: { ...ALL_READY, redactor: 'not_installed' } });
    expect(rowOf(view, 'privacy')).toMatchObject({ badge: 'Off', summary: 'Not on this computer yet. Until it is, LANA does not send chats to the cloud.' });
  });

  test('a server starting or not answering shows it on the chat model and the rows it carries', () => {
    const view = M.buildCapabilitiesView({ planView: planView(24), servers: { ...ALL_READY, chat: 'starting', embedding: 'not_running' } });
    expect(view.chat).toMatchObject({ badge: 'Starting', tone: 'blue', note: 'Getting ready. This can take a minute.' });
    expect(rowOf(view, 'images')).toMatchObject({ badge: 'Starting' });
    expect(rowOf(view, 'search')).toMatchObject({ badge: 'Not running', tone: 'yellow', summary: 'Set up, but not answering. LANA keeps trying.' });
  });

  test('no AI server on this computer: chat uses the cloud for now, and says why', () => {
    const view = M.buildCapabilitiesView({ planView: planView(24), servers: { ...ALL_READY, pipInstalled: false, chat: 'not_running' } });
    expect(fact(view.computerFacts, 'Chat runs')).toBe('In the cloud for now');
    expect(view.chat).toMatchObject({ badge: null, note: 'LANA\'s AI server is not on this computer yet, so chat uses the cloud.' });
  });

  test('a download in progress: the progress words, the cloud until setup finishes, and no change button', () => {
    const status = { phase: 'downloading', current: { id: 'qwen3.5-4b-q4', kind: 'chat', name: 'Qwen3.5 4B' }, receivedBytes: 1 * GB, totalBytes: 4 * GB, error: null };
    const view = M.buildCapabilitiesView({ planView: planView(24, { chosenChatId: 'qwen3.5-4b-q4', completedAt: null, status }), servers: ALL_READY });
    expect(view.progress).toMatchObject({ heading: 'Downloading', current: 'Now getting the chat model.', bytes: '1 GB of 4 GB', percent: 25, canPause: true, canResume: false, canRetry: false });
    // The old chat server keeps answering until the new files are in place.
    expect(fact(view.computerFacts, 'Chat runs')).toBe('On this computer');
    expect(view.chat).toMatchObject({ name: 'Qwen3.5 4B', badge: null, note: 'Until this model is ready, chat keeps using the one it has now.' });
    // On first setup no chat server runs yet, so chat uses the cloud meanwhile.
    const first = M.buildCapabilitiesView({ planView: planView(24, { completedAt: null, status }), servers: { ...ALL_READY, chat: 'not_running' } });
    expect(fact(first.computerFacts, 'Chat runs')).toBe('In the cloud until setup finishes');
    expect(first.chat.note).toBe('');
  });

  test('a failed download: the error, Try again, and nothing else to press', () => {
    const status = { phase: 'failed', current: null, receivedBytes: 1 * GB, totalBytes: 4 * GB, error: { code: 'no_space', message: 'There is not enough free space for this file.' } };
    const view = M.buildCapabilitiesView({ planView: planView(24, { completedAt: null, status }), servers: ALL_READY });
    expect(view.progress).toMatchObject({ heading: 'The download stopped', error: 'There is not enough free space for this file.', canRetry: true, canPause: false, canResume: false, tone: 'danger' });
  });

  test('paused: Resume only', () => {
    const view = M.buildCapabilitiesView({ planView: planView(24, { completedAt: null, status: { ...IDLE, phase: 'paused', receivedBytes: GB, totalBytes: 2 * GB } }), servers: ALL_READY });
    expect(view.progress).toMatchObject({ heading: 'Paused', canResume: true, canPause: false, canRetry: false });
  });

  test('speech and voice rows only when Briefs is not showing its own', () => {
    const view = M.buildCapabilitiesView({ planView: planView(24), servers: ALL_READY, includeSpeech: false });
    expect(view.rows.map((r) => r.id)).toEqual(['search', 'images', 'documents', 'privacy']);
  });
});

describe('changing the chat model', () => {
  function fakeApi(view) {
    let current = view;
    return {
      getCapabilities: jest.fn(async () => ({ success: true, plan: current, servers: ALL_READY })),
      getServers: jest.fn(async () => ({ success: true, servers: { ...ALL_READY, chat: 'starting' } })),
      switchChat: jest.fn(async (chatId) => {
        current = planView(24, { chosenChatId: chatId, completedAt: null, status: IDLE });
        return { success: true, plan: current, status: { ...IDLE, phase: 'idle' } };
      }),
      pause: jest.fn(async () => ({ success: true, status: { ...IDLE, phase: 'paused' } })),
      resume: jest.fn(async () => ({ success: true, status: { ...IDLE, phase: 'downloading', totalBytes: GB } })),
      finish: () => { current = { ...current, completedAt: '2026-11-09T13:00:00Z' }; }
    };
  }

  async function loaded() {
    const api = fakeApi(planView(24));
    const frames = [];
    const c = M.createCapabilitiesController({ api, render: (f) => frames.push(f) });
    await c.load();
    return { api, frames, c, last: () => frames[frames.length - 1] };
  }

  test('the chooser opens on the current model and cannot switch to it', async () => {
    const { c, last } = await loaded();
    c.openChooser();
    expect(last()).toMatchObject({ chooserOpen: true, selectedId: 'qwen3.5-9b-q4', canSwitch: false });
    c.select('qwen3.5-4b-q4');
    expect(last().canSwitch).toBe(true);
    c.closeChooser();
    expect(last()).toMatchObject({ chooserOpen: false, selectedId: null });
  });

  test('switching saves the new model, closes the chooser, and says when it is in use', async () => {
    const { api, c, last } = await loaded();
    c.openChooser();
    c.select('qwen3.5-4b-q4');
    await c.confirm();
    expect(api.switchChat).toHaveBeenCalledWith('qwen3.5-4b-q4');
    expect(last()).toMatchObject({ chooserOpen: false, busy: false });
    expect(last().view.chat.name).toBe('Qwen3.5 4B');
    await c.onStatus({ ...IDLE, phase: 'downloading', receivedBytes: GB, totalBytes: 3 * GB, current: { kind: 'chat', name: 'Qwen3.5 4B' } });
    expect(last().view.progress).toMatchObject({ heading: 'Downloading', canPause: true });
    api.finish();
    await c.onStatus({ ...IDLE, phase: 'ready' });
    expect(api.getCapabilities).toHaveBeenCalledTimes(2);
    expect(last().notice).toBe('Now using Qwen3.5 4B.');
    expect(last().view.progress).toBeNull();
  });

  test('with every file already here, setup can finish before the call answers: still says it is in use', async () => {
    const { api, c, last } = await loaded();
    const answer = api.switchChat;
    api.switchChat = jest.fn(async (chatId) => {
      const result = await answer(chatId);
      api.finish();
      await c.onStatus({ ...IDLE, phase: 'checking' });
      await c.onStatus({ ...IDLE, phase: 'ready' });
      return { ...result, status: { ...IDLE, phase: 'ready' } };
    });
    c.openChooser();
    c.select('qwen3.5-4b-q4');
    await c.confirm();
    expect(last()).toMatchObject({ notice: 'Now using Qwen3.5 4B.', busy: false, chooserOpen: false });
    expect(last().view.chat.name).toBe('Qwen3.5 4B');
  });

  test('switching back to LANA\'s recommended model saves "no choice", as first launch does', async () => {
    const api = fakeApi(planView(24, { chosenChatId: 'qwen3.5-4b-q4' }));
    const c = M.createCapabilitiesController({ api, render: () => {} });
    await c.load();
    c.openChooser();
    c.select('qwen3.5-9b-q4');
    await c.confirm();
    expect(api.switchChat).toHaveBeenCalledWith(null);
  });

  test('a refused switch shows the reason and keeps the model', async () => {
    const { api, c, last } = await loaded();
    api.switchChat.mockResolvedValueOnce({ success: false, error: 'That chat model does not fit this computer.' });
    c.openChooser();
    c.select('qwen3.5-35b-a3b-q4');
    await c.confirm();
    expect(last()).toMatchObject({ error: 'That chat model does not fit this computer.', busy: false });
    expect(last().view.chat.name).toBe('Qwen3.5 9B');
  });

  test('pause, resume, and the live server states', async () => {
    const { api, c, last } = await loaded();
    await c.pause();
    expect(api.pause).toHaveBeenCalled();
    expect(last().view.progress.heading).toBe('Paused');
    await c.resume();
    expect(last().view.progress.heading).toBe('Downloading');
    await c.refreshServers();
    expect(last().view.chat.badge).toBe('Starting');
  });
});

test('every capsule that means working says Ready: no row uses a second word for it', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/js/settings-capabilities.model.js'), 'utf8');
  expect(src).not.toMatch(/label: 'On'/);
});
