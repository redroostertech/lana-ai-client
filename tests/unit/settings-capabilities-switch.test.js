/**
 * Changing the chat model from Settings > Capabilities, end to end in the main process:
 * electron-first-launch.js switchChat() saves the choice and downloads the new files, onReady
 * hands the new plan to the real Pip supervisor (electron-pip-supervisor.js), and only the chat
 * server restarts. The embedding server is never stopped or started again.
 *
 * The computer, the model list and the downloads are fakes; Pip's processes, fetch and ports
 * are test doubles; timers are Jest's fake timers.
 */

const path = require('path');
const { EventEmitter } = require('events');
const { createFirstLaunch } = require('../../electron-first-launch');
const { createPip, DEFAULTS } = require('../../electron-pip-supervisor');
const { BUILT_IN, parseCatalog } = require('../../electron-model-catalog');
const realModels = require('../../electron-local-models');
const { DownloadError } = require('../../electron-model-download');

const GB = 1024 ** 3;
const MODELS = path.join('/user', 'models');

function fakeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.stdout = { pipe: jest.fn() };
  child.stderr = { pipe: jest.fn() };
  child.signals = [];
  child.kill = (signal) => {
    child.signals.push(signal);
    Promise.resolve().then(() => { child.exitCode = 0; child.emit('exit', null, signal); });
    return true;
  };
  return child;
}

function harness({ hangOn = null } = {}) {
  // Pip doubles: each spawned server answers /health with the model in its settings file.
  const spawns = [];
  const files = {};
  const serving = {};
  const pip = createPip({
    binary: '/app/pip/lqe',
    dir: path.join('/user', 'pip'),
    spawn: jest.fn((command, args) => {
      const child = fakeChild(3000 + spawns.length);
      spawns.push({ config: args[2], child });
      return child;
    }),
    fetch: jest.fn(async (url) => {
      const port = Number(new URL(url).port);
      if (!serving[port]) {throw new Error('connect ECONNREFUSED');}
      return { ok: true, status: 200, json: async () => ({ status: 'ok', model_file: { name: serving[port] } }) };
    }),
    pickPort: jest.fn(async (preferred) => preferred),
    fsImpl: {
      mkdirSync: jest.fn(),
      writeFileSync: (file, text) => {
        const settings = JSON.parse(text);
        files[file] = settings;
        serving[settings.port] = path.basename(settings.model);
      },
      createWriteStream: jest.fn(() => ({ end: jest.fn() }))
    }
  });

  // First-launch doubles: downloads finish at once; files downloaded count as in place.
  let state = { chatId: null, acceptedAt: '2026-11-09T11:00:00Z', completedAt: null };
  const have = new Set();
  const downloads = [];
  const applied = [];
  const firstLaunch = createFirstLaunch({
    userDataDir: '/user',
    state: { read: () => ({ ...state }), write: (changes) => { state = { ...state, ...changes }; return { ...state }; } },
    onReady: (result) => { applied.push(pip.apply(result, MODELS)); },
    io: {
      readHardware: () => ({ totalMemoryBytes: 24 * GB, accelerator: { backend: 'metal' }, freeDiskBytes: 200 * GB, chip: 'Test', cores: 12, platform: 'darwin' }),
      loadModelCatalog: async () => ({ ...parseCatalog(BUILT_IN), source: 'built_in' }),
      localModels: {
        modelsDir: () => MODELS,
        embeddingModel: realModels.embeddingModel,
        speechSizes: realModels.speechSizes,
        isInstalled: async (entry) => have.has(entry.id),
        downloadModel: jest.fn(async (entry, _dir, { onProgress, signal }) => {
          if (signal.aborted) {throw new DownloadError('cancelled', 'paused');}
          downloads.push(entry.id);
          if (entry.id === hangOn) {
            // A big file still coming in: it ends only when paused.
            await new Promise((resolve) => signal.addEventListener('abort', resolve));
            throw new DownloadError('cancelled', 'paused');
          }
          onProgress({ received: entry.sizeBytes, total: entry.sizeBytes });
          have.add(entry.id);
        })
      },
      docling: { platformKey: () => null, sizes: () => null, isInstalled: () => false, install: jest.fn() },
      platformKey: null,
      now: () => new Date('2026-11-09T12:00:00Z')
    }
  });
  const settle = async () => {
    await Promise.all(applied);
    await jest.advanceTimersByTimeAsync(DEFAULTS.healthIntervalStartingMs);
  };
  return { pip, firstLaunch, spawns, files, downloads, settle, state: () => state };
}

const role = (spawn) => path.basename(spawn.config, '.json');

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

test('switching the chat model downloads its files and restarts only the chat server', async () => {
  const h = harness();
  await h.firstLaunch.start();
  await h.settle();
  expect(h.spawns.map(role)).toEqual(['chat', 'embedding']);
  const [firstChat, embedding] = h.spawns;
  expect(h.pip.getState().servers.embedding).toMatchObject({ process: 'running', healthy: true });
  expect(h.files[path.join('/user', 'pip', 'chat.json')].model).toBe(path.join(MODELS, 'Qwen3.5-9B-Q4_K_M.gguf'));

  await h.firstLaunch.switchChat('qwen3.5-4b-q4');
  await h.settle();

  // The new model and its image reading file were fetched; the embedding file was not again.
  expect(h.downloads.slice(3)).toEqual(['qwen3.5-4b-q4', 'mmproj-qwen3.5-4b']);
  expect(h.state()).toMatchObject({ chatId: 'qwen3.5-4b-q4', completedAt: '2026-11-09T12:00:00.000Z' });
  // Chat: the old server stopped and a new one started with the new model.
  expect(firstChat.child.signals).toEqual(['SIGTERM']);
  expect(h.spawns.map(role)).toEqual(['chat', 'embedding', 'chat']);
  expect(h.files[path.join('/user', 'pip', 'chat.json')]).toMatchObject({ model: path.join(MODELS, 'Qwen3.5-4B-Q4_K_M.gguf'), mmproj: path.join(MODELS, 'mmproj-Qwen3.5-4B-BF16.gguf') });
  expect(h.pip.getState().servers.chat).toMatchObject({ process: 'running', healthy: true });
  // Embedding: never stopped, never started again, still the same process and ready.
  expect(embedding.child.signals).toEqual([]);
  expect(h.pip.getState().servers.embedding).toMatchObject({ process: 'running', healthy: true, pid: embedding.child.pid });
});

test('a switch while the old model downloads stops that download, then sets up the new model', async () => {
  const h = harness({ hangOn: 'qwen3.5-9b-q4' });
  void h.firstLaunch.start();
  for (let i = 0; i < 20 && !h.downloads.includes('qwen3.5-9b-q4'); i += 1) {await Promise.resolve();}
  expect(h.downloads).toEqual(['nomic-embed-text-v1.5-f16', 'qwen3.5-9b-q4']);
  await h.firstLaunch.switchChat('qwen3.5-4b-q4');
  await h.settle();
  expect(h.downloads.slice(2)).toEqual(['qwen3.5-4b-q4', 'mmproj-qwen3.5-4b']);
  expect(h.files[path.join('/user', 'pip', 'chat.json')].model).toBe(path.join(MODELS, 'Qwen3.5-4B-Q4_K_M.gguf'));
  expect(h.firstLaunch.status().phase).toBe('ready');
});
