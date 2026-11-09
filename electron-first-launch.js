'use strict';

/**
 * First-launch local AI setup (docs/plans/first-launch-local-ai-plan.md, phase B). Main process.
 *
 *   plan()           reads this computer and the model list and returns the setup
 *                    (src/js/local-ai-fit.model.js): the chat choices, the default, and what LANA
 *                    adds by itself. The first-launch screen and Settings show this.
 *   choose(chatId)   keeps the person's chat choice (null goes back to LANA's default).
 *   accept()         the person pressed Continue: notes it and starts. Nothing is downloaded
 *                    before this.
 *   resume()         at launch: runs start() whenever setup was accepted. Files in place are
 *                    skipped, so a finished setup goes straight to onReady and Pip starts.
 *   start()          downloads this computer's model files in order (embedding, chat, image
 *                    reading), one at a time, in the background. Progress goes to onStatus.
 *   pause()          stops after the bytes already received are on disk.
 *   speechModels()   the Briefs speech models to fetch once a person signs in: Briefs keeps them
 *                    in each person's own folder, so they cannot be fetched before sign-in.
 *
 * Every launch can call start(): a file already in place is checked from its note and skipped,
 * and a file cut off last time resumes. When every file is in place, `completedAt` is saved and
 * onReady fires with the plan, and Pip starts from it (electron-pip-supervisor.js).
 *
 * The plan is worked out again on each launch from the computer as it is now, so more memory or
 * a fuller disk is taken into account. The person's chat choice is kept, and used whenever it
 * still fits.
 */

const path = require('path');

const fit = require('./src/js/local-ai-fit.model');
const { readHardware } = require('./electron-hardware');
const { loadModelCatalog } = require('./electron-model-catalog');
const localModels = require('./electron-local-models');

const LOCAL_KINDS = new Set(['embedding', 'chat', 'vision']);

/**
 * @param {Object} deps
 * @param {string} deps.userDataDir
 * @param {{ read(): Object, write(changes: Object): Object }} deps.state - electron-storage.js firstLaunchPersistence
 * @param {Object} [deps.env]
 * @param {number} [deps.redactorMemoryBytes] - set aside when the redactor runs on this computer
 * @param {number} [deps.doclingMemoryBytes] - set aside when Docling runs on this computer
 * @param {(status: Object) => void} [deps.onStatus]
 * @param {(plan: Object) => void} [deps.onReady] - every local file is in place
 * @param {Object} [deps.io] - { readHardware, loadModelCatalog, localModels, now } for tests
 */
function createFirstLaunch({ userDataDir, state, env = process.env, redactorMemoryBytes = 0, doclingMemoryBytes = 0, onStatus = () => {}, onReady = () => {}, io = {} }) {
  const read = io.readHardware || readHardware;
  const loadCatalog = io.loadModelCatalog || loadModelCatalog;
  const models = io.localModels || localModels;
  const now = io.now || (() => new Date());
  const modelsDir = models.modelsDir(env, userDataDir);
  const cacheFile = path.join(userDataDir, 'model-catalog.json');

  let status = { phase: 'idle', current: null, receivedBytes: 0, totalBytes: 0, error: null };
  let running = null;
  let controller = null;

  function publish(changes) {
    status = { ...status, ...changes };
    onStatus(status);
  }

  /** Every entry the plan can name, by id. */
  function entries(catalog) {
    const embedding = models.embeddingModel();
    const byId = new Map([[embedding.id, embedding]]);
    for (const entry of [...catalog.chat, ...catalog.vision]) {byId.set(entry.id, entry);}
    return byId;
  }

  async function installedIds(byId) {
    const ids = [];
    for (const [id, entry] of byId) {
      if (await models.isInstalled(entry, modelsDir)) {ids.push(id);}
    }
    return ids;
  }

  /** The setup for this computer as it is now. */
  async function plan() {
    const [hardware, catalog] = await Promise.all([
      Promise.resolve(read({ modelsDir })),
      loadCatalog({ cacheFile })
    ]);
    const byId = entries(catalog);
    const result = fit.planLocalAi({
      hardware,
      catalog,
      embedding: models.embeddingModel(),
      speech: models.speechSizes(),
      redactor: { memoryBytes: redactorMemoryBytes },
      docling: { memoryBytes: doclingMemoryBytes },
      installed: await installedIds(byId),
      chosenChatId: state.read().chatId
    });
    return { ...result, catalogSource: catalog.source, entries: byId, hardware };
  }

  /** The plan as the page sees it: no file entries or URLs. */
  function view(result) {
    const { entries: _entries, hardware: _hardware, ...rest } = result;
    const saved = state.read();
    return { ...rest, status, chosenChatId: saved.chatId, acceptedAt: saved.acceptedAt, completedAt: saved.completedAt };
  }

  function choose(chatId) {
    // A new choice means new files: setup is not complete until they are in place.
    state.write({ chatId: chatId || null, completedAt: null });
  }

  async function run() {
    controller = new AbortController();
    const result = await plan();
    const local = result.download.files.filter((file) => LOCAL_KINDS.has(file.kind));
    const totalBytes = local.reduce((sum, file) => sum + file.bytes, 0);
    let doneBytes = 0;
    publish({ phase: local.length ? 'downloading' : 'checking', current: null, receivedBytes: 0, totalBytes, error: null });
    for (const file of local) {
      const entry = result.entries.get(file.id);
      // Free space now, not at plan time: another file may have just used it.
      const freeBytes = read({ modelsDir }).freeDiskBytes;
      const startAt = doneBytes;
      publish({ current: { id: entry.id, kind: file.kind, name: entry.name } });
      await models.downloadModel(entry, modelsDir, {
        signal: controller.signal,
        freeBytes,
        onProgress: ({ received }) => publish({ receivedBytes: startAt + Math.min(received, file.bytes) })
      });
      doneBytes += file.bytes;
      publish({ receivedBytes: doneBytes });
    }
    state.write({ completedAt: now().toISOString() });
    publish({ phase: 'ready', current: null, receivedBytes: totalBytes });
    onReady(result);
    return result;
  }

  /** Download what this computer still needs. Calling it while it runs returns the same run. */
  function start() {
    if (!running) {
      running = run()
        .catch((error) => {
          const paused = error && error.code === 'cancelled';
          publish({ phase: paused ? 'paused' : 'failed', error: paused ? null : { code: error.code || 'failed', message: error.message } });
          return null;
        })
        .finally(() => { running = null; controller = null; });
    }
    return running;
  }

  function pause() {
    if (controller) {controller.abort();}
    return running || Promise.resolve(null);
  }

  function accept() {
    state.write({ acceptedAt: now().toISOString() });
    return start();
  }

  function resume() {
    return state.read().acceptedAt ? start() : Promise.resolve(null);
  }

  /** The Briefs speech models (ModelService ids) the plan says to install; none before Continue. */
  async function speechModels() {
    if (!state.read().acceptedAt) {return [];}
    const result = await plan();
    const ids = [];
    if (result.plan.speech.install) {ids.push('transcription');}
    if (result.plan.voice.install) {ids.push('voice');}
    return ids;
  }

  return { plan: async () => view(await plan()), choose, accept, resume, start, pause, speechModels, status: () => status };
}

module.exports = { createFirstLaunch };
