# First Launch: Local AI Setup Plan

- **Status:** Plan. Nothing built yet.
- **Branch:** `development-new` (client), `covo-intake-receiver` (backend, small changes only)
- **Date:** 2026-11-09
- **Owner:** Michael Westbrooks
- **Repos touched:** `lana-ai-client` (most of the work), `LANA-AI` (tier and routing reads), `LANA.cpp` (release binaries only)
- **Sources read:** root `Claude.md`, `lana-ai-client/Claude.md`, Pip Desktop v2.0.0 (`lqe-desktop` tag `v2.0.0`), LANA One client (`origin/lana-one` in this repo), LANA.cpp `docs/API.md`, this repo's `electron-local-models.js`, `electron-local-engine.js`, `electron-ai-topology.js`, `src/js/settings-ai-models.model.js`
- **Related:** `onboarding-experience-plan.md` is the product tour after login. This plan is the setup that happens before the tour and does not change it.

---

## 1. Goal

The first time someone opens LANA on a computer, LANA should:

1. Look at the computer: memory, graphics chip and its memory, free disk space, processor.
2. Show which AI models this computer can run, which ones run comfortably, and how much each one can remember at once (its context window).
3. Pick a good setup for this computer, and let the person change it.
4. Download the chosen models, checking every file, and keep going if the app is closed and opened again.
5. Start Pip (LANA's AI server) for chat and embedding on this computer, plus vision when it fits.
6. Use Forge in the cloud for anything this computer cannot run, unless the firm's admin has set up their own cloud provider. Then it uses that provider instead.

After the first launch, the same facts live in **Settings > Capabilities**, so the person can see them and change models later.

### The fallback rule

| This computer can run... | Chat goes to | Embedding goes to |
|---|---|---|
| Chat and embedding | Pip on this computer | Pip on this computer |
| Embedding only | The firm's cloud provider if set, else Forge | Pip on this computer |
| Neither | The firm's cloud provider if set, else Forge | Forge |

The embedding model is small (about 0.27 GB, needs about 2 GB of memory), so in practice almost every computer runs embedding locally. Embeddings made anywhere must carry the same identity (the pinned nomic file), which the server and engine now read from Pip's `/health` (backend commit `5aab6728a`).

---

## 2. What exists today

### In this client

| Piece | Where | State |
|---|---|---|
| Model list | `electron-local-models.js` `CATALOG` | Three fixed models: Qwen3.5 9B (chat), Qwen3.5 0.8B (draft), nomic embed f16 |
| Downloader | `electron-local-models.js` `downloadModel` | Checks size and SHA-256, no resume. **Nothing calls it.** |
| Starting Pip | none | The client never starts Pip. It only reads `LANA_ENGINE_CHAT_URL` and `LANA_ENGINE_EMBEDDING_URL`. |
| Local engine | `electron-local-engine.js`, `electron-engine-supervisor.js` | Starts only when `LANA_ENGINE_ROOT` or `prefs.root` is set. **Nothing sets `prefs.root`, so an installed app never starts the engine.** |
| Hardware facts | none | Not read anywhere |
| Settings > Capabilities | `settings-v2.html` AI card, `settings-ai-models.model.js` | Shows Local rows (Chat, Embedding, Speech, Voice) and Cloud (Forge or own provider). No computer facts, no fit, no context window. |
| Speech downloads | Briefs `SpeechModelStore` | Works, with resume. Only on request in Settings. |

### Pip Desktop v2.0.0 (what to copy)

- **Catalog:** published at `https://models.lanaai.io/llm/catalog.json` (`schemaVersion: 1`). Each model has `role` (chat, embedding, vision, verifier, stt, tts, voice-pack), `sizeBytes`, `minRamGb`, `contextWindow`, `sha256`, `pairsWith` (a vision file names the chat model it belongs to) and `tier`. A bundled copy is the offline fallback. Code: `src/main/catalog.ts` `publishedCatalogEntries`, `mergeModelCatalogs`.
- **Memory estimate:** `src/shared/presets.ts` `estimateImpact`. Model size + conversation memory (KV cache) + working memory + vision add-on. Divided by total memory:
  - under 0.55: **comfortable** ("Plenty left for other apps")
  - under 0.75: **tight** ("Little left for other apps")
  - otherwise: **unsafe** ("May slow down your computer")
  - Everything running together must stay under 0.88 of total memory (`fleet-manager.ts`).
- **Server settings:** `src/main/config.ts`. Chat: 16384 tokens per slot, 2 slots, `q8_0` conversation memory, `ubatch` 512. Embedding: context and `ubatch` 2048, 1 slot (`embedModelSettings`). Two slots only when both stay comfortable (`splitIntoTwoSlots`).
- **Disk check:** `assertModelDownloadSpace` needs the model size plus 512 MiB free.
- **Plain fit words:** "Good fit for this computer", "Can run with shorter memory", "Needs at least N GB of memory".
- **Ports:** Pip Desktop uses chat 8092 to 8094, embedding 8096 to 8099, voice 8200 to 8209.

What not to use from Pip Desktop:
- Its account and lease. Pip Desktop needs a Pip account sign-in before it starts any server, and its background service uses an account slot. LANA customers must not need a Pip account. LANA starts `lqe` itself **without** `--lease-file`, which Pip does not enforce (`docs/SERVICES-AND-CLI.md`).
- Its "LANA capability adapter". It is an unwired scaffold for health and rollback only. It has no models, servers or hardware.
- Its hardware detection. It only reads total and free memory and guesses "Apple Metal" on a Mac.

### LANA One client (`origin/lana-one`, what to copy)

- `supervisor/model-downloader.js`: resumes a partial download with HTTP Range, checks SHA-256, renames into place, can be cancelled.
- `supervisor/model-catalog.js` `validateCatalogEntry`: https only, a real 64-character SHA-256, a bare file name, a positive size.
- `supervisor/model-selector.js` `estimateTierFit`: sets aside memory for the system and the app first, then checks model + context memory. Returns a list of tiers, each with `fits` and the context it can hold, plus a plain reason when nothing fits.
- `supervisor/hardware-accel.js`: reads graphics memory on NVIDIA computers with `nvidia-smi`.
- `supervisor/process-supervisor.js` and `probes.js`: start services in order, wait for health, restart with backoff, stop everything on quit.
- `src/splash.html` and `electron-splash-preload.js`: a startup window with a progress bar.
- `src/js/pages/settings-local-models.js`: the Settings page with hardware facts, the tier list, download progress and an Activate button.

What not to use from LANA One: Postgres, MinIO, the bundled backend, its secrets store, and `llama-server`. This client uses the firm's server and runs Pip.

---

## 3. Decisions

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | Who starts Pip | **The LANA client**, as a child process it supervises | No Pip account needed. Works the same on every platform. Pip Desktop's supervisor is untested on macOS. |
| D2 | Where `lqe` comes from | **Bundled in the installer** per platform, from the LANA.cpp `v3.0.0` release, checked by SHA-256 | Works offline on first launch. Same build the backend pins. |
| D3 | Which model list | **The published Pip catalog** (`models.lanaai.io/llm/catalog.json`), filtered to the models LANA supports, with a bundled copy as fallback | One list for Pip Desktop and LANA. New models show up without a client release. |
| D4 | Who chooses models | **LANA picks a recommended setup and the person can change it** on the first-launch screen and in Settings | Most people should just press Continue. |
| D5 | Context window | **The largest step that stays comfortable**: 32768, then 16384, then 8192 tokens. Below 8192, chat uses the cloud. | LANA answers from documents and needs room. 8192 is LANA One's floor. |
| D6 | Ports | **A LANA band**: chat 8081, embedding 8082, vision on the chat server. Use the next free port if one is taken, and pass the real address to the engine. | Matches today's dev setup and LANA One, and avoids Pip Desktop's bands. |
| D7 | When setup runs | **Before sign-in**, in its own window. Downloads keep going in the background after the person moves on. | Models do not need an account. Sign-in should not wait on a 5 GB download. |
| D8 | Where state is kept | electron-store key `firstLaunch` (plan, versions, step done), model files in `<userData>/models` | Survives restarts. One place to reset. |

Open questions for Michael:
- **Q1.** Can a regular user change models, or only an admin? (Recommended: anyone, because it only affects their own computer.)
- **Q2.** Should first launch also offer the speech and voice downloads (about 1 GB more), or leave them in Settings as today? (Recommended: offer them as a checkbox, off by default.)
- **Q3.** Does each firm's admin want to lock a model per firm (for example, always Qwen3.5 9B)? (Recommended: not now.)

---

## 4. How sizing works

### 4.1 Read the computer

New module `electron-hardware.js` (main process, pure functions with injected readers so it can be unit tested):

| Fact | macOS | Windows | Linux |
|---|---|---|---|
| Total and free memory | `os.totalmem`, `os.freemem` | same | same |
| Chip and graphics | `sysctl machdep.cpu.brand_string`; Apple Silicon means unified memory | `nvidia-smi --query-gpu=name,memory.total` (from LANA One `hardware-accel.js`), else none | same as Windows |
| Memory the AI can use | Unified memory: total memory | NVIDIA: graphics memory minus 2 GB. No usable graphics chip: system memory, CPU only | same as Windows |
| Free disk | `fs.statfsSync(<userData>/models)` | same | same |
| Processor cores | `os.cpus().length`, used for Pip `threads` | same | same |

### 4.2 Price each model

New module `src/js/local-ai-fit.model.js` (pure, shared by the main process and Settings):

1. Set aside memory first: system 3 GB and the LANA app 2 GB (from LANA One).
2. For each chat model and each context step (32768, 16384, 8192), estimate with Pip Desktop's `estimateImpact`: model + conversation memory + working memory, plus vision if a vision file pairs with it.
3. Call it **comfortable** if the estimate is under 55% of usable memory, **tight** under 75%, otherwise **won't fit**.
4. Add embedding (always 2048 tokens, 1 slot) and check the total stays under 88%.
5. Check free disk: all chosen files plus 512 MiB.

The result for each model: `{ id, name, role, sizeBytes, fit: comfortable | tight | wont_fit, contextTokens, reason }`. Reasons are plain sentences, for example "This computer needs at least 16 GB of memory for this model."

### 4.3 Pick the recommended setup

- **Chat:** the biggest model the client supports that is comfortable at 16384 tokens or more. If none, the biggest one comfortable at 8192. If none, chat uses the cloud.
- **Vision:** add the paired vision file only if the chat model stays comfortable with it.
- **Embedding:** nomic f16 (the pinned file) whenever it fits, which is almost always.
- **Engine tier:** set `LANA_TIER` from the plan (the engine refuses to start without it). The mapping goes in one table next to the fit code, using the backend's tier names.

The pinned embedding file must stay exactly the pin (`deploy/railway/embed/embed-pin.json`). The catalog is never allowed to change it.

---

## 5. The first-launch screen

One window, built with Lex components, with its own `first-launch.html`, `.js` and `.css` (page hygiene rule). It is not a modal.

1. **Checking this computer.** A short progress line while hardware is read. Under a second.
2. **Your AI setup.** A card per job (Chat, Search and memory, Images), each showing:
   - the recommended model, its size, and the fit word ("Good fit for this computer")
   - how much it can remember: "About 24 pages at once" next to "32,768 tokens"
   - where it runs: "On this computer" or "In the cloud (Forge)"
   - a "Change" link that lists every model with its fit word, and greys out the ones that won't fit, with the reason
   - a line at the bottom with space needed and space free: "Needs 6.1 GB. This computer has 210 GB free."
   - When nothing fits: "This computer is too small to run LANA's AI. LANA will use the cloud instead." No error styling. It is a normal outcome.
3. **Continue.** Downloads start in the background and the person goes to sign-in. A small status chip in the app shows download progress until it is done. Closing the app pauses the download, and opening it again picks up where it stopped.
4. **Ready.** When the files are checked, the client starts Pip and the engine and shows a one-line notification: "LANA's AI is ready on this computer."

Copy rules: plain words a 6th grader can follow, "computer" not a brand name, no emojis or dashes.

---

## 6. Starting Pip

New module `electron-pip-supervisor.js`, built from LANA One `process-supervisor.js`:

- Binary: the bundled `lqe` for this platform. Dev builds can point at `LANA.cpp/build/src/lqe` with `LANA_PIP_BINARY`.
- Chat server: `lqe serve --config <userData>/pip/chat.json`, with `serve.json` written from the plan: model path, `ctx` per slot, `parallel`, `kv_type q8_0`, `ubatch 512`, `gpu_layers` (99 with a graphics chip, 0 without), `threads` from the core count, `host 127.0.0.1`, and the vision file when chosen.
- Embedding server: the same, with Pip Desktop's `embedModelSettings` (`ctx` and `ubatch` 2048, `parallel 1`, `role embed`).
- Health: poll `/health` until `status: ok`, then check the model file name matches the plan. Bound to 127.0.0.1, so no token is needed.
- Restarts: backoff from 1 second up to 60 seconds. Stop with SIGTERM on quit, wait, then kill.
- When both are healthy, the client passes `LANA_ENGINE_CHAT_URL` and `LANA_ENGINE_EMBEDDING_URL` to the engine (already supported) and sets the engine root so the installed app actually starts the engine. That fixes the "always off" gap.
- If chat is planned for the cloud, the client leaves `LANA_ENGINE_CHAT_URL` unset and the engine routes chat to Forge or the firm's provider. The routing rule itself lives in the backend (Phase 3 of the custom cloud endpoint plan), not in the client.

---

## 7. Settings > Capabilities

Add to the AI card that is there today (no new page):

- **This computer** row: memory, chip and graphics memory, free disk. Example: "36 GB memory, Apple M3 Pro, 210 GB free."
- **Each local model row** keeps today's facts in today's order and adds two: **Fits this computer** (the fit word) and **Remembers** (context window, in pages and tokens). Model size already shows; Pip's `/health` `model_file.bytes` replaces "Not reported by Pip".
- **Change model** button on Chat and Images rows. It opens the same chooser as first launch, downloads the new file, then restarts that one Pip server.
- Rows for jobs running in the cloud say why: "This computer is too small for chat, so LANA uses Forge."

Removing models stays off (decision from 2026-11-08).

---

## 8. Speech and voice (stay on sherpa, get ready for Squeak)

Squeak is not ready for LANA yet: Pip Desktop v2.0.0 runs it on Windows only (`docs/VOICE-API.md`: "macOS and Linux builds of Squeak do not exist yet"), and its pack has no speaker labeling, which Briefs needs. So speech stays on `sherpa-onnx` for now. The work here is to make the swap a one-file change later.

What Squeak will offer, from `VOICE-API.md`: speech-to-text `POST /v1/audio/transcriptions` (16-bit PCM WAV, 16 kHz), voice `POST /v1/audio/speech` (WAV or PCM, 24 kHz), voice activity, turn detection, on a port in 8200 to 8209 with a Bearer token. No timestamps, no streaming, no speaker labels yet.

Steps:

1. **One speech port.** In `briefs/packages/core`, add a `SpeechEngine` interface with `listen` (voice activity plus partial and final text), `transcribe` (a recording to text segments with times), `labelSpeakers`, and `speak` (text to audio with its sample rate). Today's sherpa classes become the one implementation, `SherpaSpeechEngine`. Talk and meeting transcription call the interface, not the classes.
2. **Split the meeting logic from the engine.** `MeetingTranscriber` keeps trimming, merging and timing, and calls the speech port for voice activity, text and speaker labels.
3. **Our own result shapes.** Speaker turns, text segments and audio become LANA types. Sherpa's shapes stay inside `SherpaSpeechEngine`.
4. **Voice by name.** Kokoro's numeric voice `0` becomes a named voice (`af_heart`, the same name the backend uses).
5. **Sample rates in one place.** The 16 kHz input and the speaker's output rate come from the engine, not constants spread over files.
6. **Folder names in one place.** The speech folder names live only in `SPEECH_CATALOG` and are passed in, instead of being typed three times.
7. **Model names from the engine.** `ASR_MODEL_ID` and `DIARIZATION_MODEL_ID` in meeting records come from the engine in use.
8. **Settings rows.** Speech and Voice keep today's look. They read the model names and sizes from the speech engine's status, so a Squeak engine fills them the same way.

The backend `@voice` app already goes through one adapter (`voice.service.js` with `VOICE_STT_URL` and `VOICE_TTS_URL`) and its routes are already OpenAI-shaped, like Squeak's. When Squeak is ready, pointing those two URLs at Squeak is most of the backend change. The hard-coded `stt_provider: 'whisper'` and `tts_provider: 'kokoro'` in `src/voice/app.js` should read from the server instead.

---

## 9. Phases

| Phase | Work | Proof |
|---|---|---|
| A | `electron-hardware.js` and `local-ai-fit.model.js`, with the catalog fetch and bundled fallback | Unit tests with fake computers: 8 GB laptop, 16 GB, 36 GB Mac, NVIDIA 12 GB, no graphics chip |
| B | Resumable downloader (from LANA One) and the disk check, wired to the plan | Unit tests: resume after a cut, bad SHA-256 deletes the file, not enough disk refuses |
| C | `electron-pip-supervisor.js`; engine root set in installed builds | Packaged app on a clean computer starts Pip and the engine with no settings typed |
| D | First-launch screen | Screenshots in light and dark; a run on this Mac from an empty `userData` |
| E | Settings > Capabilities additions and Change model | Screenshots; changing chat model restarts only the chat server |
| F | Speech port (section 8) | Briefs and Talk tests pass unchanged; a fake speech engine can replace sherpa in tests |
| G | Bundle `lqe` per platform in the installer, signed | Signed macOS build launches Pip from inside the app |

Phase 3 of the custom cloud endpoint plan (backend routing) must land before cloud fallback for chat is done end to end. Chat end-to-end runs are Michael's call.

---

## 10. Risks

- **Signing:** a bundled `lqe` must be signed and notarized with the app (LANA One `docs/specs/PACKAGING_SIGNING.md` covers the order).
- **Memory estimates are only for Qwen families.** The conversation-memory numbers in `estimateImpact` are measured for Qwen3 and Qwen3.5. A new model family needs its own number before it is offered.
- **The embed pin is stale.** `embed-pin.json` still names Pip build `ddedf87`. A deployment with no Pip of its own would expect that build. The pin should be restaged for `v3.0.0` before installed clients ship.
- **Slow downloads.** A 5.6 GB chat model can take a long time. The cloud is used until local files are ready, so the app works from the first minute.
