/**
 * The first-launch screen's words and steps (src/js/first-launch.model.js). The plan views are
 * real plans from local-ai-fit.model.js for made-up computers, shaped as electron-first-launch.js
 * plan() returns them.
 */

const fl = require('../../src/js/first-launch.model');
const fit = require('../../src/js/local-ai-fit.model');
const { BUILT_IN, parseCatalog } = require('../../electron-model-catalog');
const { embeddingModel, speechSizes } = require('../../electron-local-models');

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const catalog = parseCatalog(BUILT_IN);

function planView(memoryGb, { backend = 'metal', diskGb = 200, chosenChatId = null, acceptedAt = null, docling = undefined } = {}) {
  const result = fit.planLocalAi({
    hardware: { totalMemoryBytes: memoryGb * GB, accelerator: { backend }, freeDiskBytes: diskGb * GB, chip: 'Test chip' },
    catalog,
    embedding: embeddingModel(),
    speech: speechSizes(),
    docling,
    chosenChatId
  });
  return { ...result, status: { phase: 'idle', current: null, receivedBytes: 0, totalBytes: 0, error: null }, chosenChatId, acceptedAt, completedAt: null };
}

describe('formatBytes', () => {
  test.each([
    [0, '0 MB'],
    [null, '0 MB'],
    [512, '1 KB'],
    [274 * MB, '274 MB'],
    [1.25 * GB, '1.3 GB'],
    [5.6 * GB, '5.6 GB'],
    [24 * GB, '24 GB'],
    [210.4 * GB, '210 GB']
  ])('%p reads %p', (bytes, words) => {
    expect(fl.formatBytes(bytes)).toBe(words);
  });
});

describe('the choice screen', () => {
  test('shows this computer, the recommended chat model preselected, and what it remembers', () => {
    const view = fl.buildChoiceView(planView(24));
    expect(view.computer).toBe('24 GB memory, Test chip, 200 GB free');
    expect(view.selectedId).toBe('qwen3.5-9b-q4');
    expect(view.chat).toMatchObject({
      cloud: false,
      name: expect.stringContaining('9B'),
      fitText: 'Good fit for this computer',
      fitTone: 'good',
      remembers: 'About 44 pages at once',
      where: 'Runs on this computer',
      recommended: true
    });
    expect(view.continueLabel).toBe('Continue');
    expect(view.disk).toMatch(/^Needs \d+(\.\d)? GB\. This computer has 200 GB free\.$/);
  });

  test('a model too big for this computer is listed, disabled, with its reason', () => {
    const view = fl.buildChoiceView(planView(16));
    const big = view.choices.find((c) => c.value === 'qwen3.5-35b-a3b-q4' || /35B/.test(c.label));
    expect(big).toBeDefined();
    expect(big.disabled).toBe(true);
    expect(big.description).toMatch(/needs a computer with about \d+ GB of memory/);
    const recommended = view.choices.find((c) => c.value === view.selectedId);
    expect(recommended.disabled).toBe(false);
    expect(recommended.label).toMatch(/\(recommended\)$/);
    expect(view.canChoose).toBe(true);
  });

  test('a slow model on a computer with no graphics chip says so but can still be chosen', () => {
    const view = fl.buildChoiceView(planView(16, { backend: 'cpu' }));
    const slow = view.choices.find((c) => /slowly/.test(c.description));
    expect(slow).toBeDefined();
    expect(slow.disabled).toBe(false);
  });

  test('what LANA adds by itself: one line each for search, image reading, listening and speaking', () => {
    const view = fl.buildChoiceView(planView(24));
    expect(view.extras.map((e) => e.id)).toEqual(['search', 'images', 'speech', 'voice']);
    expect(view.extras.every((e) => e.included)).toBe(true);
    expect(view.extras.find((e) => e.id === 'speech').text).toMatch(/after you sign in/);
  });

  test('document reading: one line in plain words with its download size, after image reading', () => {
    const sizes = require('../../electron-docling-install').sizes('macos-arm64');
    const memoryBytes = require('../../electron-docling').DOCLING_MEMORY_BYTES;
    const view = fl.buildChoiceView(planView(24, { docling: { memoryBytes, provided: false, ...sizes } }));
    expect(view.extras.map((e) => e.id)).toEqual(['search', 'images', 'documents', 'speech', 'voice']);
    expect(view.extras.find((e) => e.id === 'documents')).toEqual({
      id: 'documents', title: 'Document reading', included: true,
      text: `Reads your documents on this computer. ${fl.formatBytes(sizes.downloadBytes)} download.`
    });
    // Already here: no size.
    const here = fl.buildChoiceView(planView(24, { docling: { memoryBytes, provided: true } }));
    expect(here.extras.find((e) => e.id === 'documents').text).toBe('Reads your documents on this computer.');
    // Not for this computer: the plan's plain reason, not included.
    const none = fl.buildChoiceView(planView(24, { docling: { memoryBytes, provided: false, diskBytes: null } }));
    expect(none.extras.find((e) => e.id === 'documents')).toMatchObject({ included: false, text: expect.stringMatching(/not ready for this kind of computer/) });
    expect(JSON.stringify([view, here, none])).not.toMatch(/[\u2013\u2014]/);
    // While it downloads, the progress line names it plainly.
    expect(fl.buildProgressView({ phase: 'downloading', current: { kind: 'docling', name: 'Docling' }, receivedBytes: 1, totalBytes: 2 }).current).toBe('Now getting the document reader, Docling.');
  });

  test('the cloud state: chat uses the cloud, nothing to choose, Continue still offered', () => {
    const view = fl.buildChoiceView(planView(4, { backend: 'cpu' }));
    expect(view.chat.cloud).toBe(true);
    expect(view.chat.heading).toBe('Chat uses the cloud');
    expect(view.chat.text).toMatch(/too small to run LANA's chat/);
    expect(view.choices).toEqual([]);
    expect(view.canChoose).toBe(false);
    expect(view.selectedId).toBeNull();
    expect(view.continueLabel).toBe('Continue');
    expect(view.extras.find((e) => e.id === 'images')).toMatchObject({ included: false, text: 'Uses the cloud, with chat.' });
  });

  test('nothing to download says so', () => {
    const view = planView(24);
    view.download = { files: [], neededBytes: 0, freeBytes: 200 * GB };
    expect(fl.buildChoiceView(view).disk).toMatch(/^Nothing to download/);
  });
});

describe('the progress part', () => {
  test('only downloading and checking say the download keeps going; ready plays the success mark', () => {
    expect(fl.buildProgressView({ phase: 'downloading', totalBytes: 1 }).note).toMatch(/keeps going in the background/);
    expect(fl.buildProgressView({ phase: 'paused', totalBytes: 1 }).note).not.toMatch(/keeps going/);
    expect(fl.buildProgressView({ phase: 'ready', totalBytes: 1 }).mark).toBe('success');
    // Ready: the Go to sign in button says it; no line repeating it.
    expect(fl.buildProgressView({ phase: 'ready', totalBytes: 1 }).note).toBe('');
    expect(fl.buildProgressView({ phase: 'downloading', totalBytes: 1 }).mark).toBe('spinner');
  });

  test('downloading: the current file, bytes, and Pause', () => {
    const view = fl.buildProgressView({ phase: 'downloading', current: { id: 'x', kind: 'chat', name: 'Qwen3.5 9B' }, receivedBytes: 1.5 * GB, totalBytes: 6 * GB, error: null });
    expect(view).toMatchObject({ current: 'Now getting the chat model, Qwen3.5 9B.', bytes: '1.5 GB of 6 GB', percent: 25, canPause: true, canResume: false, canRetry: false });
  });

  test('paused offers Resume', () => {
    const view = fl.buildProgressView({ phase: 'paused', current: null, receivedBytes: 60 * MB, totalBytes: 274 * MB, error: null });
    expect(view).toMatchObject({ heading: 'Paused', bytes: '60 MB of 274 MB', canPause: false, canResume: true });
  });

  test('the failed state shows the error message and Try again', () => {
    const view = fl.buildProgressView({ phase: 'failed', current: null, receivedBytes: 0, totalBytes: 6 * GB, error: { code: 'no_space', message: 'This download needs 6 GB free, and this computer has 2 GB. Free some space and try again.' } });
    expect(view).toMatchObject({ heading: 'The download stopped', tone: 'danger', canRetry: true, canPause: false, mark: 'idle' });
    // A stopped download must not claim it keeps going.
    expect(view.note).not.toMatch(/keeps going/);
    expect(view.error).toBe('This download needs 6 GB free, and this computer has 2 GB. Free some space and try again.');
  });

  test('a failure without a plain message gets a plain sentence, never a system error', () => {
    const view = fl.buildProgressView({ phase: 'failed', error: { code: 'ENOTDIR', message: 'ENOTDIR: not a directory, mkdir /x/models' } });
    expect(view.error).toMatch(/^LANA could not save the files on this computer/);
    expect(view.error).not.toMatch(/ENOTDIR/);
  });

  test('ready is full', () => {
    expect(fl.buildProgressView({ phase: 'ready', receivedBytes: 10, totalBytes: 10 })).toMatchObject({ percent: 100, tone: 'good' });
  });
});

describe('files already on this computer', () => {
  test('one file: named, with the space it saves', () => {
    const view = fl.buildFoundView([{ id: 'qwen3.5-9b-q4', kind: 'chat', name: 'Qwen3.5 9B', bytes: 5627044256, source: 'Pip' }]);
    expect(view.text).toBe('Found Qwen3.5 9B already on this computer. Use it? Saves 5.2 GB.');
    expect(view.options.map((o) => o.value)).toEqual(['use', 'download']);
  });

  test('several files: listed together, sizes added', () => {
    const view = fl.buildFoundView([
      { id: 'a', kind: 'embedding', name: 'Nomic', bytes: 274290560 },
      { id: 'b', kind: 'chat', name: 'Qwen3.5 9B', bytes: 5627044256 }
    ]);
    expect(view.text).toBe('Found the search model and Qwen3.5 9B already on this computer. Use them? Saves 5.5 GB.');
  });

  test('nothing found: no choice', () => {
    expect(fl.buildFoundView([])).toBeNull();
  });
});

describe('the controller', () => {
  function fakeApi(view) {
    let current = view;
    return {
      getPlan: jest.fn(async () => ({ success: true, plan: current })),
      choose: jest.fn(async (chatId) => { current = planView(16, { chosenChatId: chatId }); return { success: true, plan: current }; }),
      findExisting: jest.fn(async () => ({ success: true, found: [] })),
      continue: jest.fn(async () => ({ success: true, status: { phase: 'downloading', current: null, receivedBytes: 0, totalBytes: 100, error: null } })),
      pause: jest.fn(async () => ({ success: true, status: { phase: 'paused', receivedBytes: 10, totalBytes: 100 } })),
      resume: jest.fn(async () => ({ success: true, status: { phase: 'downloading', receivedBytes: 10, totalBytes: 100 } }))
    };
  }

  test('loads the plan and shows the choice', async () => {
    const render = jest.fn();
    const controller = fl.createFirstLaunchController({ api: fakeApi(planView(16)), render });
    await controller.load();
    const last = render.mock.calls[render.mock.calls.length - 1][0];
    expect(last.mode).toBe('choose');
    expect(last.choice.selectedId).toBe('qwen3.5-4b-q4');
  });

  test('choosing a model calls choose with it and redraws with the new plan', async () => {
    const render = jest.fn();
    const api = fakeApi(planView(16));
    const controller = fl.createFirstLaunchController({ api, render });
    await controller.load();
    await controller.pick('qwen3.5-0.8b-q4');
    expect(api.choose).toHaveBeenCalledWith('qwen3.5-0.8b-q4');
    const last = render.mock.calls[render.mock.calls.length - 1][0];
    expect(last.choice.selectedId).toBe('qwen3.5-0.8b-q4');
  });

  test('choosing LANA\'s default again saves no choice, and the current model is not saved twice', async () => {
    const api = fakeApi(planView(16, { chosenChatId: 'qwen3.5-0.8b-q4' }));
    const controller = fl.createFirstLaunchController({ api, render: () => {} });
    await controller.load();
    await controller.pick('qwen3.5-0.8b-q4');
    expect(api.choose).not.toHaveBeenCalled();
    await controller.pick('qwen3.5-4b-q4');
    expect(api.choose).toHaveBeenCalledWith(null);
  });

  test('Continue moves to progress and follows status pushes; pause and resume call through', async () => {
    const render = jest.fn();
    const api = fakeApi(planView(24));
    const controller = fl.createFirstLaunchController({ api, render });
    await controller.load();
    await controller.proceed();
    expect(api.continue).toHaveBeenCalledWith({ useExisting: false });
    controller.onStatus({ phase: 'downloading', current: { kind: 'embedding', name: 'nomic' }, receivedBytes: 50, totalBytes: 100 });
    let last = render.mock.calls[render.mock.calls.length - 1][0];
    expect(last.mode).toBe('progress');
    expect(last.progress.percent).toBe(50);
    await controller.pause();
    expect(api.pause).toHaveBeenCalled();
    last = render.mock.calls[render.mock.calls.length - 1][0];
    expect(last.progress.canResume).toBe(true);
    await controller.resume();
    expect(api.resume).toHaveBeenCalled();
  });

  test('a plan already accepted opens on progress', async () => {
    const render = jest.fn();
    const controller = fl.createFirstLaunchController({ api: fakeApi(planView(24, { acceptedAt: '2026-11-09T00:00:00Z' })), render });
    await controller.load();
    expect(render.mock.calls[render.mock.calls.length - 1][0].mode).toBe('progress');
  });

  test('a plan that cannot be read shows the error', async () => {
    const render = jest.fn();
    const controller = fl.createFirstLaunchController({ api: { getPlan: async () => ({ success: false, error: 'no' }) }, render });
    await controller.load();
    expect(render.mock.calls[render.mock.calls.length - 1][0]).toMatchObject({ mode: 'loading', error: 'no' });
  });

  test('found files: Continue uses them unless the person says to download', async () => {
    const api = fakeApi(planView(24));
    api.findExisting = jest.fn(async () => ({ success: true, found: [{ id: 'qwen3.5-9b-q4', kind: 'chat', name: 'Qwen3.5 9B', bytes: 5 }] }));
    const render = jest.fn();
    const controller = fl.createFirstLaunchController({ api, render });
    await controller.load();
    await controller.findExisting();
    expect(render.mock.calls[render.mock.calls.length - 1][0].found.text).toMatch(/^Found Qwen3.5 9B/);
    await controller.proceed();
    expect(api.continue).toHaveBeenLastCalledWith({ useExisting: true });
    controller.setUseExisting(false);
    controller.state().busy = false;
    await controller.proceed();
    expect(api.continue).toHaveBeenLastCalledWith({ useExisting: false });
  });
});

test('a finished setup says LANA is ready, not that it is getting ready, and does not repeat itself', () => {
  const working = fl.buildProgressView({ phase: 'downloading', totalBytes: 1 });
  expect(working.header).toMatchObject({ eyebrow: 'Setting up', accent: 'ready' });
  expect(working.header.title).toMatch(/Getting/);
  const done = fl.buildProgressView({ phase: 'ready', totalBytes: 1 });
  expect(done.header.title).not.toMatch(/Getting/);
  expect(done.header).toMatchObject({ eyebrow: 'All set', title: 'LANA is ', accent: 'ready', detail: '' });
  expect(done.header.eyebrow.toLowerCase()).not.toContain(done.header.accent);
  // The card does not say the same thing again.
  expect(done.current).toBe('');
  expect(done.heading).not.toMatch(/ready|all set/i);
});

test('a signed-in install is not told to sign in: the notes speak of opening LANA', () => {
  ['downloading', 'checking', 'paused', 'failed', 'idle'].forEach((phase) => {
    const note = fl.buildProgressView({ phase, totalBytes: 1 }, { signedIn: true }).note;
    expect(note).not.toMatch(/sign in/);
  });
  expect(fl.buildProgressView({ phase: 'downloading', totalBytes: 1 }, { signedIn: true }).note).toMatch(/keeps going in the background/);
  expect(fl.buildProgressView({ phase: 'paused', totalBytes: 1 }, { signedIn: true }).note).toMatch(/picks up again/);
});
