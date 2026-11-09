/**
 * First-launch setup (electron-first-launch.js): the plan for this computer, the person's chat
 * choice, the downloads in order, pausing and picking up again, and the speech models handed to
 * Briefs after sign-in. The computer, the model list and the downloads are fakes.
 */

const { createFirstLaunch } = require('../../electron-first-launch');
const { BUILT_IN, parseCatalog } = require('../../electron-model-catalog');
const realModels = require('../../electron-local-models');
const { DownloadError } = require('../../electron-model-download');

const GB = 1024 ** 3;

function memoryState(initial = {}) {
  let value = { chatId: null, acceptedAt: null, completedAt: null, ...initial };
  return { read: () => ({ ...value }), write: (changes) => { value = { ...value, ...changes }; return { ...value }; } };
}

// Docling's sizes are the pinned archive's and models' (electron-docling-install.js).
const DOCLING_SIZES = require('../../electron-docling-install').sizes('macos-arm64');

function setup({ memoryGb = 24, diskGb = 200, installed = [], failOn = null, state = memoryState(), reuse = undefined, doclingKey = null, doclingProvided = false, doclingMemoryBytes = 0 } = {}) {
  const have = new Set(installed);
  const doclingReady = jest.fn();
  const downloads = [];
  const statuses = [];
  const ready = jest.fn();
  const localModels = {
    modelsDir: () => '/models',
    embeddingModel: realModels.embeddingModel,
    speechSizes: realModels.speechSizes,
    isInstalled: jest.fn(async (entry) => have.has(entry.id)),
    downloadModel: jest.fn(async (entry, _dir, { onProgress, signal }) => {
      downloads.push(entry.id);
      if (failOn && failOn.id === entry.id) {throw failOn.error;}
      if (signal.aborted) {throw new DownloadError('cancelled', 'paused');}
      onProgress({ received: entry.sizeBytes / 2, total: entry.sizeBytes });
      onProgress({ received: entry.sizeBytes, total: entry.sizeBytes });
      have.add(entry.id);
    })
  };
  const docling = {
    platformKey: () => doclingKey,
    sizes: (key) => (key === 'macos-arm64' ? DOCLING_SIZES : null),
    isInstalled: jest.fn(() => have.has('docling')),
    install: jest.fn(async ({ userDataDir, key, signal, onProgress }) => {
      downloads.push('docling');
      if (failOn && failOn.id === 'docling') {throw failOn.error;}
      if (signal.aborted) {throw new DownloadError('cancelled', 'paused');}
      expect({ userDataDir, key }).toEqual({ userDataDir: '/user', key: 'macos-arm64' });
      onProgress({ received: DOCLING_SIZES.downloadBytes / 2, total: DOCLING_SIZES.downloadBytes, step: 'runtime' });
      onProgress({ received: DOCLING_SIZES.downloadBytes, total: DOCLING_SIZES.downloadBytes, step: 'models' });
      have.add('docling');
    })
  };
  const firstLaunch = createFirstLaunch({
    userDataDir: '/user',
    state,
    doclingMemoryBytes,
    doclingProvided: () => doclingProvided,
    onDoclingReady: doclingReady,
    onStatus: (s) => statuses.push(s),
    onReady: ready,
    io: {
      readHardware: () => ({ totalMemoryBytes: memoryGb * GB, accelerator: { backend: 'metal' }, freeDiskBytes: diskGb * GB, chip: 'Test' }),
      loadModelCatalog: async () => ({ ...parseCatalog(BUILT_IN), source: 'built_in' }),
      localModels,
      reuse: typeof reuse === 'function' ? reuse(have) : reuse,
      docling,
      platformKey: doclingKey,
      now: () => new Date('2026-11-09T12:00:00Z')
    }
  });
  return { firstLaunch, downloads, statuses, ready, state, localModels, have, docling, doclingReady };
}

test('the plan for the page: chat choices, the default, what LANA adds, and no file addresses', async () => {
  const { firstLaunch } = setup({ memoryGb: 16 });
  const view = await firstLaunch.plan();
  expect(view.defaultChatId).toBe('qwen3.5-4b-q4');
  expect(view.plan.chat.id).toBe('qwen3.5-4b-q4');
  expect(view.catalogSource).toBe('built_in');
  expect(view.chosenChatId).toBeNull();
  expect(view).not.toHaveProperty('entries');
  expect(JSON.stringify(view)).not.toMatch(/https?:/);
});

test('start downloads embedding, chat and image reading in that order, then says it is ready', async () => {
  const { firstLaunch, downloads, statuses, ready, state } = setup({ memoryGb: 24 });
  await firstLaunch.start();
  expect(downloads).toEqual(['nomic-embed-text-v1.5-f16', 'qwen3.5-9b-q4', 'mmproj-qwen3.5-9b']);
  expect(state.read().completedAt).toBe('2026-11-09T12:00:00.000Z');
  expect(ready).toHaveBeenCalledTimes(1);
  const last = statuses[statuses.length - 1];
  expect(last).toMatchObject({ phase: 'ready', current: null, error: null });
  expect(last.receivedBytes).toBe(last.totalBytes);
  // Progress only goes forward across files.
  const received = statuses.map((s) => s.receivedBytes);
  expect(received).toEqual([...received].sort((a, b) => a - b));
});

test('files already in place are not downloaded again; with nothing left it is ready at once', async () => {
  const { firstLaunch, downloads, ready } = setup({ installed: ['nomic-embed-text-v1.5-f16', 'qwen3.5-9b-q4', 'mmproj-qwen3.5-9b'] });
  await firstLaunch.start();
  expect(downloads).toEqual([]);
  expect(ready).toHaveBeenCalledTimes(1);
});

test('the person\'s chat choice is kept and used, and a new choice means setup is not complete', async () => {
  const state = memoryState({ completedAt: '2026-11-01T00:00:00Z' });
  const { firstLaunch, downloads } = setup({ memoryGb: 24, state });
  firstLaunch.choose('qwen3.5-0.8b-q4');
  expect(state.read()).toMatchObject({ chatId: 'qwen3.5-0.8b-q4', completedAt: null });
  expect((await firstLaunch.plan()).plan.chat.id).toBe('qwen3.5-0.8b-q4');
  await firstLaunch.start();
  expect(downloads).toEqual(['nomic-embed-text-v1.5-f16', 'qwen3.5-0.8b-q4', 'mmproj-qwen3.5-0.8b']);
  firstLaunch.choose(null);
  expect((await firstLaunch.plan()).plan.chat.id).toBe('qwen3.5-9b-q4');
});

test('a computer too small for chat downloads only embedding; chat uses the cloud', async () => {
  const { firstLaunch, downloads } = setup({ memoryGb: 4 });
  await firstLaunch.start();
  expect(downloads).toEqual(['nomic-embed-text-v1.5-f16']);
});

test('a failed download stops setup, says why, and the next start picks up again', async () => {
  const error = new DownloadError('no_space', 'This download needs 6.1 GB free, and this computer has 1.0 GB. Free some space and try again.');
  const run = setup({ failOn: { id: 'qwen3.5-9b-q4', error } });
  await run.firstLaunch.start();
  expect(run.firstLaunch.status()).toMatchObject({ phase: 'failed', error: { code: 'no_space', message: error.message } });
  expect(run.ready).not.toHaveBeenCalled();
  expect(run.state.read().completedAt).toBeNull();
  run.localModels.downloadModel.mockClear();
  run.downloads.length = 0;
  // Fixed (space freed): the same object starts again and skips what is done.
  const again = setup({ installed: ['nomic-embed-text-v1.5-f16'], state: run.state });
  await again.firstLaunch.start();
  expect(again.downloads).toEqual(['qwen3.5-9b-q4', 'mmproj-qwen3.5-9b']);
  expect(again.ready).toHaveBeenCalledTimes(1);
});

test('pause stops the run as paused, not failed', async () => {
  const run = setup();
  const started = run.firstLaunch.start();
  await run.firstLaunch.pause();
  await started;
  expect(run.firstLaunch.status()).toMatchObject({ phase: 'paused', error: null });
  expect(run.ready).not.toHaveBeenCalled();
});

test('start while running returns the same run, so files are never fetched twice at once', async () => {
  const { firstLaunch, downloads } = setup();
  const a = firstLaunch.start();
  const b = firstLaunch.start();
  expect(a).toBe(b);
  await a;
  expect(downloads).toHaveLength(3);
});

test('Continue notes the acceptance and starts; resume runs setup on every launch after Continue', async () => {
  const fresh = setup();
  await fresh.firstLaunch.resume();
  expect(fresh.downloads).toEqual([]);
  await fresh.firstLaunch.accept();
  expect(fresh.state.read().acceptedAt).toBe('2026-11-09T12:00:00.000Z');
  expect(fresh.downloads).toHaveLength(3);

  const cutOff = setup({ state: memoryState({ acceptedAt: '2026-11-08T00:00:00Z' }), installed: ['nomic-embed-text-v1.5-f16'] });
  await cutOff.firstLaunch.resume();
  expect(cutOff.downloads).toEqual(['qwen3.5-9b-q4', 'mmproj-qwen3.5-9b']);

  // Finished last time: nothing to fetch, and ready fires again so Pip starts on this launch.
  const done = setup({ state: memoryState({ acceptedAt: '2026-11-08T00:00:00Z', completedAt: '2026-11-08T01:00:00Z' }), installed: ['nomic-embed-text-v1.5-f16', 'qwen3.5-9b-q4', 'mmproj-qwen3.5-9b'] });
  await done.firstLaunch.resume();
  expect(done.downloads).toEqual([]);
  expect(done.ready).toHaveBeenCalledTimes(1);

  // A file removed since: fetched again.
  const missing = setup({ state: memoryState({ acceptedAt: '2026-11-08T00:00:00Z', completedAt: '2026-11-08T01:00:00Z' }), installed: ['nomic-embed-text-v1.5-f16', 'qwen3.5-9b-q4'] });
  await missing.firstLaunch.resume();
  expect(missing.downloads).toEqual(['mmproj-qwen3.5-9b']);
});

test('speech models for Briefs follow the plan, and none before Continue', async () => {
  const accepted = () => memoryState({ acceptedAt: '2026-11-09T00:00:00Z' });
  expect(await setup().firstLaunch.speechModels()).toEqual([]);
  expect(await setup({ memoryGb: 24, state: accepted() }).firstLaunch.speechModels()).toEqual(['transcription', 'voice']);
  // Room for speech but not the voice after it.
  const speech = realModels.speechSizes();
  const embedding = realModels.embeddingModel();
  const tight = (embedding.sizeBytes + speech.transcriptionBytes) / GB + 0.5 + 0.05;
  expect(await setup({ memoryGb: 4, diskGb: tight, state: accepted() }).firstLaunch.speechModels()).toEqual(['transcription']);
});

describe('model files already on this computer', () => {
  function fakeReuse(have, foundIds) {
    return {
      searchFolders: jest.fn(() => [{ dir: '/pip', source: 'Pip' }]),
      findCandidates: jest.fn(async ({ entries }) => entries.filter((e) => foundIds.includes(e.id)).map((entry) => ({ entry, path: `/pip/${entry.filename}`, source: 'Pip' }))),
      verifyCandidates: jest.fn(async (candidates) => candidates),
      placeFound: jest.fn(async ({ entry }) => { have.add(entry.id); return 'linked'; })
    };
  }

  test('findExisting offers only files this plan would download, and says where they are', async () => {
    const have = new Set();
    const reuse = fakeReuse(have, ['qwen3.5-9b-q4', 'nomic-embed-text-v1.5-f16', 'qwen3.5-4b-q4']);
    const { firstLaunch } = setup({ memoryGb: 24, reuse });
    const found = await firstLaunch.findExisting();
    // The 4B is not in a 24 GB plan, so it is not offered.
    expect(found.map((f) => f.id).sort()).toEqual(['nomic-embed-text-v1.5-f16', 'qwen3.5-9b-q4']);
    expect(found.find((f) => f.id === 'qwen3.5-9b-q4')).toMatchObject({ kind: 'chat', source: 'Pip', bytes: expect.any(Number) });
    expect(JSON.stringify(found)).not.toMatch(/\/pip\//);
  });

  test('saying yes puts them in place and downloads only the rest', async () => {
    let reuse;
    const { firstLaunch, downloads } = setup({ memoryGb: 24, reuse: (have) => (reuse = fakeReuse(have, ['qwen3.5-9b-q4', 'nomic-embed-text-v1.5-f16'])) });
    await firstLaunch.findExisting();
    await firstLaunch.accept({ useExisting: true });
    expect(reuse.placeFound).toHaveBeenCalledTimes(2);
    expect(downloads).toEqual(['mmproj-qwen3.5-9b']);
  });

  test('saying no downloads everything and places nothing', async () => {
    const have = new Set();
    const reuse = fakeReuse(have, ['qwen3.5-9b-q4']);
    const { firstLaunch, downloads } = setup({ memoryGb: 24, reuse });
    await firstLaunch.findExisting();
    await firstLaunch.accept({ useExisting: false });
    expect(reuse.placeFound).not.toHaveBeenCalled();
    expect(downloads).toContain('qwen3.5-9b-q4');
  });
});

describe('Docling', () => {
  const DOCLING_MEMORY = require('../../electron-docling').DOCLING_MEMORY_BYTES;

  test('comes after embedding, chat and image reading, counts its download (not its unpacked size) in progress, and is announced', async () => {
    const { firstLaunch, downloads, statuses, ready, doclingReady } = setup({ memoryGb: 24, doclingKey: 'macos-arm64' });
    const view = await firstLaunch.plan();
    expect(view.plan.docling).toEqual({ install: true, reason: null });
    expect(view.download.files.map((f) => f.kind)).toEqual(['embedding', 'chat', 'vision', 'docling', 'speech', 'voice']);
    expect(view.download.files[3]).toMatchObject({ bytes: DOCLING_SIZES.diskBytes, downloadBytes: DOCLING_SIZES.downloadBytes });
    await firstLaunch.start();
    expect(downloads).toEqual(['nomic-embed-text-v1.5-f16', 'qwen3.5-9b-q4', 'mmproj-qwen3.5-9b', 'docling']);
    expect(doclingReady).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenCalledTimes(1);
    const last = statuses[statuses.length - 1];
    expect(last).toMatchObject({ phase: 'ready' });
    expect(last.receivedBytes).toBe(last.totalBytes);
    const others = view.download.files.slice(0, 3).reduce((sum, f) => sum + f.bytes, 0);
    expect(last.totalBytes).toBe(others + DOCLING_SIZES.downloadBytes);
    expect(statuses.some((s) => s.current && s.current.kind === 'docling')).toBe(true);
    const received = statuses.map((s) => s.receivedBytes);
    expect(received).toEqual([...received].sort((a, b) => a - b));
  });

  test('installed already, or another Docling here (a developer\'s): nothing to download', async () => {
    const installed = setup({ doclingKey: 'macos-arm64', installed: ['nomic-embed-text-v1.5-f16', 'qwen3.5-9b-q4', 'mmproj-qwen3.5-9b', 'docling'] });
    await installed.firstLaunch.start();
    expect(installed.downloads).toEqual([]);
    const provided = setup({ doclingKey: 'macos-arm64', doclingProvided: true, installed: ['nomic-embed-text-v1.5-f16', 'qwen3.5-9b-q4', 'mmproj-qwen3.5-9b'] });
    expect((await provided.firstLaunch.plan()).plan.docling).toEqual({ install: true, reason: null });
    await provided.firstLaunch.start();
    expect(provided.downloads).toEqual([]);
    expect(provided.docling.install).not.toHaveBeenCalled();
  });

  test('no runtime built for this kind of computer: not downloaded, and said plainly', async () => {
    const { firstLaunch, downloads } = setup({ doclingKey: 'windows-x64' });
    expect((await firstLaunch.plan()).plan.docling).toMatchObject({ install: false, reason: expect.stringMatching(/not ready for this kind of computer/) });
    await firstLaunch.start();
    expect(downloads).not.toContain('docling');
  });

  test('a computer too small to set aside its memory does not get it', async () => {
    const { firstLaunch, downloads } = setup({ memoryGb: 2, doclingKey: 'macos-arm64', doclingMemoryBytes: DOCLING_MEMORY });
    expect((await firstLaunch.plan()).plan.docling).toMatchObject({ install: false, reason: expect.stringMatching(/memory/) });
    await firstLaunch.start();
    expect(downloads).toEqual(['nomic-embed-text-v1.5-f16']);
  });

  test('a cut-off Docling install fails the run, and the next start installs only Docling', async () => {
    const error = new DownloadError('stalled', 'The model download stopped moving. It will pick up where it stopped.');
    const run = setup({ doclingKey: 'macos-arm64', failOn: { id: 'docling', error } });
    await run.firstLaunch.start();
    expect(run.firstLaunch.status()).toMatchObject({ phase: 'failed', error: { code: 'stalled' } });
    expect(run.ready).not.toHaveBeenCalled();
    const again = setup({ doclingKey: 'macos-arm64', state: run.state, installed: ['nomic-embed-text-v1.5-f16', 'qwen3.5-9b-q4', 'mmproj-qwen3.5-9b'] });
    await again.firstLaunch.start();
    expect(again.downloads).toEqual(['docling']);
    expect(again.ready).toHaveBeenCalledTimes(1);
  });
});
