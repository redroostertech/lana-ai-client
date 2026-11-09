/**
 * Sizing for first launch (src/js/local-ai-fit.model.js): which chat models a computer can run,
 * the one LANA picks by default, and the models LANA adds by itself. The computers are made up;
 * the catalog is the app's built-in copy, so the sizes are the real files'.
 */

const fit = require('../../src/js/local-ai-fit.model');
const { BUILT_IN, parseCatalog } = require('../../electron-model-catalog');
const { embeddingModel, speechSizes } = require('../../electron-local-models');

const GB = 1024 ** 3;
const catalog = parseCatalog(BUILT_IN);
const embedding = embeddingModel();
const speech = speechSizes();

function computer(memoryGb, backend = 'metal', { vramGb = null, diskGb = 200 } = {}) {
  return {
    totalMemoryBytes: memoryGb * GB,
    accelerator: { backend, vramBytes: vramGb == null ? null : vramGb * GB, gpus: [] },
    freeDiskBytes: diskGb == null ? null : diskGb * GB,
    chip: 'Test chip'
  };
}

function plan(hardware, more = {}) {
  return fit.planLocalAi({ hardware, catalog, embedding, speech, ...more });
}

function choice(result, id) {
  return result.chatChoices.find((c) => c.id === id);
}

describe('the default chat model for a computer', () => {
  test.each([
    ['an 8 GB laptop', computer(8), 'qwen3.5-0.8b-q4', 32768, null],
    ['a 12 GB laptop', computer(12), 'qwen3.5-4b-q4', 32768, null],
    // A smaller model that holds 32768 tokens beats a bigger one that does not (decided 2026-11-09).
    ['a 16 GB Mac', computer(16), 'qwen3.5-4b-q4', 32768, 'mmproj-qwen3.5-4b'],
    ['a 24 GB Mac', computer(24), 'qwen3.5-9b-q4', 32768, 'mmproj-qwen3.5-9b'],
    ['a 36 GB Mac', computer(36), 'qwen3.5-9b-q4', 32768, 'mmproj-qwen3.5-9b'],
    ['a 64 GB Mac', computer(64), 'qwen3.5-35b-a3b-q4km', 32768, 'mmproj-qwen3.5-35b-a3b'],
    ['a 16 GB computer with a 12 GB NVIDIA card', computer(16, 'cuda', { vramGb: 12 }), 'qwen3.5-9b-q4', 32768, 'mmproj-qwen3.5-9b'],
    ['a 16 GB computer with no graphics chip', computer(16, 'cpu'), 'qwen3-1.7b-q4km', 32768, null]
  ])('%s', (_label, hardware, chatId, contextTokens, visionId) => {
    const result = plan(hardware);
    expect(result.defaultChatId).toBe(chatId);
    expect(result.plan.chat).toMatchObject({ id: chatId, where: 'local', contextTokens, parallel: 2 });
    expect(result.plan.vision.id).toBe(visionId);
    expect(result.plan.embedding).toMatchObject({ id: embedding.id, where: 'local' });
  });

  test('a computer too small for any chat model uses the cloud for chat, with nothing to choose', () => {
    const result = plan(computer(4, 'cpu'));
    expect(result.defaultChatId).toBeNull();
    expect(result.plan.chat).toMatchObject({ id: null, where: 'cloud' });
    expect(result.plan.chat.reason).toMatch(/too small/);
    expect(result.chatChoices.every((c) => c.fit === 'wont_fit' && c.reason)).toBe(true);
    // Search still runs on the computer: the embedding model is small.
    expect(result.plan.embedding.where).toBe('local');
  });
});

describe('the chat choices shown', () => {
  test('every LANA chat model is listed, largest first, with its fit, context and pages', () => {
    const result = plan(computer(36));
    expect(result.chatChoices.map((c) => c.id)).toEqual(catalog.chat.map((m) => m.id));
    expect(choice(result, 'qwen3.5-35b-a3b-q4km')).toMatchObject({ fit: 'tight', contextTokens: 32768, pages: 44 });
    expect(choice(result, 'qwen3.5-9b-q4')).toMatchObject({ fit: 'comfortable', contextTokens: 32768, reason: null });
  });

  test('a model that only fits with a smaller context is offered at that context, and can be picked', () => {
    const result = plan(computer(16), { chosenChatId: 'qwen3.5-9b-q4' });
    expect(choice(result, 'qwen3.5-9b-q4')).toMatchObject({ fit: 'comfortable', contextTokens: 16384 });
    expect(result.plan.chat).toMatchObject({ id: 'qwen3.5-9b-q4', contextTokens: 16384 });
    expect(result.plan.vision.id).toBeNull();
  });

  test('a model too big says how much memory it needs', () => {
    const big = choice(plan(computer(16)), 'qwen3.5-35b-a3b-q4km');
    expect(big.fit).toBe('wont_fit');
    expect(big.reason).toMatch(/^This model needs a computer with about [\d.]+ GB of memory\.$/);
  });

  test('without a graphics chip, big models are offered but marked slow and never the default', () => {
    const result = plan(computer(32, 'cpu'));
    expect(choice(result, 'qwen3.5-9b-q4')).toMatchObject({ fit: 'comfortable', slow: true });
    expect(choice(result, 'qwen3.5-9b-q4').reason).toMatch(/answers slowly/);
    expect(result.defaultChatId).toBe('qwen3-1.7b-q4km');
  });

  test('on an NVIDIA card, chat is sized against the card and a too-small card says so', () => {
    const result = plan(computer(16, 'cuda', { vramGb: 6 }));
    expect(choice(result, 'qwen3.5-9b-q4').fit).toBe('wont_fit');
    expect(choice(result, 'qwen3.5-9b-q4').reason).toMatch(/^This model needs a graphics card with about [\d.]+ GB of memory\.$/);
    expect(result.computer).toMatchObject({ backend: 'cuda', graphicsMemoryBytes: 6 * GB });
  });

  test('a model family LANA has not measured is never offered as fitting', () => {
    const other = { ...catalog.chat[1], id: 'other-9b', family: 'llama' };
    const result = fit.planLocalAi({ hardware: computer(64), catalog: { chat: [other], vision: [] }, embedding, speech });
    expect(result.chatChoices[0]).toMatchObject({ fit: 'wont_fit', reason: 'LANA has not measured this model yet.' });
    expect(result.plan.chat.where).toBe('cloud');
  });
});

describe('the person\'s choice', () => {
  test('a chat model the person picks is used, and vision follows it', () => {
    const result = plan(computer(36), { chosenChatId: 'qwen3.5-0.8b-q4' });
    expect(result.defaultChatId).toBe('qwen3.5-9b-q4');
    expect(result.plan.chat.id).toBe('qwen3.5-0.8b-q4');
    expect(result.plan.vision.id).toBe('mmproj-qwen3.5-0.8b');
  });

  test('a tight model can be picked; vision is added only if chat keeps its fit', () => {
    const result = plan(computer(36), { chosenChatId: 'qwen3.5-35b-a3b-q4km' });
    expect(result.plan.chat.id).toBe('qwen3.5-35b-a3b-q4km');
    expect(result.plan.vision.id).toBe('mmproj-qwen3.5-35b-a3b');
  });

  test('a choice that will not fit is ignored and the default is used', () => {
    expect(plan(computer(16), { chosenChatId: 'qwen3.5-35b-a3b-q4km' }).plan.chat.id).toBe('qwen3.5-4b-q4');
  });

  test('a chat model with no vision file says it cannot read images', () => {
    const result = plan(computer(36), { chosenChatId: 'qwen3-1.7b-q4km' });
    expect(result.plan.vision).toEqual({ id: null, reason: 'This chat model cannot read images.' });
  });
});

describe('the models LANA adds by itself', () => {
  test('speech and voice are installed when they fit, and the download lists every file in order', () => {
    const result = plan(computer(36));
    expect(result.plan.speech).toEqual({ install: true, reason: null });
    expect(result.plan.voice).toEqual({ install: true, reason: null });
    expect(result.download.files.map((f) => f.kind)).toEqual(['embedding', 'chat', 'vision', 'speech', 'voice']);
    expect(result.download.neededBytes).toBe(result.download.files.reduce((sum, f) => sum + f.bytes, 0));
  });

  test('speech memory is set aside before chat is priced', () => {
    const withSpeech = choice(plan(computer(16)), 'qwen3.5-9b-q4');
    const noSpeech = choice(fit.planLocalAi({ hardware: computer(16), catalog, embedding, speech: { ...speech, memoryBytes: 0 } }), 'qwen3.5-9b-q4');
    expect(noSpeech.contextTokens).toBeGreaterThan(withSpeech.contextTokens);
  });

  test('too little memory for speech: speech and voice are left out and chat gets the room', () => {
    const result = fit.planLocalAi({ hardware: computer(4), catalog, embedding, speech: { ...speech, memoryBytes: 3 * GB } });
    expect(result.plan.speech.install).toBe(false);
    expect(result.plan.voice.install).toBe(false);
    expect(result.plan.speech.reason).toMatch(/memory/);
  });

  test('the disk fills in order: embedding, chat, vision, speech, voice', () => {
    // Room for embedding and the 9B and nothing after it.
    const disk = (embedding.sizeBytes + catalog.chat[1].sizeBytes) / GB + 0.5 + 0.1;
    const result = plan(computer(36, 'metal', { diskGb: disk }));
    expect(result.plan.chat.id).toBe('qwen3.5-9b-q4');
    expect(result.plan.vision).toMatchObject({ id: null, reason: expect.stringMatching(/free space/) });
    expect(result.plan.speech).toMatchObject({ install: false, reason: expect.stringMatching(/free space/) });
    expect(result.plan.voice.install).toBe(false);
  });

  test('a chat model that does not fit on the disk is not offered and a smaller one is the default', () => {
    const result = plan(computer(36, 'metal', { diskGb: 4 }));
    expect(choice(result, 'qwen3.5-9b-q4')).toMatchObject({ fit: 'wont_fit', reason: expect.stringMatching(/not enough free space/) });
    expect(result.defaultChatId).toBe('qwen3.5-4b-q4');
  });

  test('files already on the computer need no space and are not downloaded again', () => {
    const installed = [embedding.id, 'qwen3.5-9b-q4', 'mmproj-qwen3.5-9b', 'speech', 'voice'];
    const result = plan(computer(36, 'metal', { diskGb: 1 }), { installed });
    expect(result.plan.chat.id).toBe('qwen3.5-9b-q4');
    expect(result.download).toMatchObject({ files: [], neededBytes: 0 });
  });

  test('free space that cannot be read does not block anything', () => {
    expect(plan(computer(36, 'metal', { diskGb: null })).plan.chat.id).toBe('qwen3.5-9b-q4');
  });
});

describe('plain words', () => {
  test('fit and context labels', () => {
    expect(fit.fitLabel('comfortable')).toBe('Good fit for this computer');
    expect(fit.fitLabel('tight')).toBe('Fits, with little left for other apps');
    expect(fit.fitLabel('wont_fit')).toBe('Too big for this computer');
    expect(fit.remembersLabel(32768)).toBe('About 44 pages at once');
    expect(fit.remembersLabel(null)).toBe('');
  });

  test('no reason uses a dash or an emoji', () => {
    const texts = [];
    [computer(4, 'cpu'), computer(16), computer(32, 'cpu'), computer(16, 'cuda', { vramGb: 6 }), computer(36, 'metal', { diskGb: 4 })].forEach((hw) => {
      const result = plan(hw);
      result.chatChoices.forEach((c) => texts.push(c.reason || ''));
      Object.values(result.plan).forEach((p) => texts.push(p.reason || ''));
    });
    expect(texts.join(' ')).not.toMatch(/[\u2013\u2014]|\p{Extended_Pictographic}/u);
  });
});

test('Docling never pushes chat to a smaller model: chat is chosen first, Docling only when it still fits', () => {
  const DOCLING = require('../../electron-docling').DOCLING_MEMORY_BYTES;
  for (const gb of [8, 12, 16, 24, 36]) {
    const input = (doclingBytes) => ({
      hardware: { totalMemoryBytes: gb * 1024 ** 3, accelerator: { backend: 'metal' }, freeDiskBytes: 1024 ** 4, cores: 12 },
      catalog: parseCatalog(BUILT_IN), embedding: embeddingModel(), speech: speechSizes(),
      docling: { memoryBytes: doclingBytes, provided: true }, installed: []
    });
    const without = fit.planLocalAi(input(0)).plan;
    const withDocling = fit.planLocalAi(input(DOCLING)).plan;
    expect([gb, withDocling.chat.id, withDocling.chat.contextTokens, withDocling.vision.id]).toEqual([gb, without.chat.id, without.chat.contextTokens, without.vision.id]);
  }
});

describe('Docling', () => {
  const DOCLING_MEMORY = require('../../electron-docling').DOCLING_MEMORY_BYTES;
  const sizes = require('../../electron-docling-install').sizes('macos-arm64');
  const docling = (more = {}) => ({ docling: { memoryBytes: DOCLING_MEMORY, provided: false, ...sizes, ...more } });

  test('installed after embedding, chat and vision and before speech, taking its unpacked size on the disk', () => {
    const result = plan(computer(36), docling());
    expect(result.plan.docling).toEqual({ install: true, reason: null });
    expect(result.download.files.map((f) => f.kind)).toEqual(['embedding', 'chat', 'vision', 'docling', 'speech', 'voice']);
    expect(result.download.files[3]).toEqual({ id: 'docling', kind: 'docling', bytes: sizes.diskBytes, downloadBytes: sizes.downloadBytes });
  });

  test('the disk: vision comes before it, and it comes before speech', () => {
    const base = embedding.sizeBytes + catalog.chat[1].sizeBytes + catalog.vision.find((v) => v.pairsWith === catalog.chat[1].id).sizeBytes;
    const reserve = 512 * 1024 ** 2;
    // Room for embedding, chat and vision, and a little less than Docling.
    const short = plan(computer(36, 'metal', { diskGb: (base + reserve + sizes.diskBytes - 1) / GB }), docling());
    expect(short.plan.vision.id).toBe('mmproj-qwen3.5-9b');
    expect(short.plan.docling).toMatchObject({ install: false, reason: expect.stringMatching(/not enough free space/) });
    // Room for Docling and not for speech after it.
    const exact = plan(computer(36, 'metal', { diskGb: (base + reserve + sizes.diskBytes + 1) / GB }), docling());
    expect(exact.plan.docling.install).toBe(true);
    expect(exact.plan.speech).toMatchObject({ install: false, reason: expect.stringMatching(/free space/) });
  });

  test('memory: installed when it fits under the tight line beside chat and vision', () => {
    expect(plan(computer(2, 'cpu'), docling()).plan.docling).toMatchObject({ install: false, reason: expect.stringMatching(/memory/) });
    const big = plan(computer(36), docling());
    const none = plan(computer(36));
    expect(big.plan.docling.install).toBe(true);
    expect(none.plan.docling).toEqual({ install: false, reason: null });
    // A 16 GB computer (the Mac mini running Docling today) keeps the 4B with image reading and
    // gets Docling too; an 8 GB one is past the tight line, so the server reads its documents.
    const sixteen = plan(computer(16), docling());
    expect(sixteen.plan.chat.id).toBe(plan(computer(16)).plan.chat.id);
    expect(sixteen.plan.vision.id).toBe(plan(computer(16)).plan.vision.id);
    expect(sixteen.plan.docling).toEqual({ install: true, reason: null });
    const eight = plan(computer(8), docling());
    expect(eight.plan.chat.id).toBe(plan(computer(8)).plan.chat.id);
    expect(eight.plan.docling).toMatchObject({ install: false, reason: expect.stringMatching(/server reads them/) });
  });

  test('nothing published for this kind of computer: no memory set aside, nothing downloaded', () => {
    const input = (d) => fit.planLocalAi({ hardware: computer(12), catalog, embedding, speech, ...d });
    const result = input(docling({ diskBytes: null, downloadBytes: null }));
    expect(result.plan.docling).toMatchObject({ install: false, reason: expect.stringMatching(/not ready for this kind of computer/) });
    expect(result.download.files.some((f) => f.kind === 'docling')).toBe(false);
    // The chat model is the same with or without Docling.
    expect(result.plan.chat.id).toBe(input({}).plan.chat.id);
    expect(input(docling()).plan.chat.id).toBe(result.plan.chat.id);
  });

  test('already installed, or a developer\'s Docling: no disk needed', () => {
    const installed = plan(computer(36, 'metal', { diskGb: 1 }), { ...docling(), installed: [embedding.id, 'qwen3.5-9b-q4', 'mmproj-qwen3.5-9b', 'docling', 'speech', 'voice'] });
    expect(installed.plan.docling.install).toBe(true);
    expect(installed.download.neededBytes).toBe(0);
    const provided = plan(computer(36, 'metal', { diskGb: 1 }), { ...docling({ provided: true, diskBytes: null }), installed: [embedding.id, 'qwen3.5-9b-q4', 'mmproj-qwen3.5-9b', 'speech', 'voice'] });
    expect(provided.plan.docling.install).toBe(true);
    expect(provided.download.neededBytes).toBe(0);
  });
});

test('the redactor is always set aside when it is on this computer, so a 12 GB computer drops from the 4B', () => {
  const input = (redactorBytes) => ({
    hardware: { totalMemoryBytes: 12 * 1024 ** 3, accelerator: { backend: 'metal' }, freeDiskBytes: 1024 ** 4, cores: 12 },
    catalog: parseCatalog(BUILT_IN), embedding: embeddingModel(), speech: speechSizes(),
    redactor: { memoryBytes: redactorBytes }, installed: []
  });
  expect(fit.planLocalAi(input(0)).plan.chat.id).toBe('qwen3.5-4b-q4');
  expect(fit.planLocalAi(input(0.5 * 1024 ** 3)).plan.chat.id).toBe('qwen3.5-0.8b-q4');
});
