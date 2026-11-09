# First Launch: Local AI Setup Plan

- **Status:** Phases A to D built (sizing, the model list, the downloads, Pip, and the first-launch screen; section 11). Phases E to G not started.
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
2. Show which chat models this computer can run, which ones run comfortably, and how much each one can remember at once (its context window).
3. Pick a chat model for this computer by default. The person can keep it or choose another chat model. That is the only choice they make.
4. Choose everything else itself: the vision file that goes with the chat model, the embedding model, and the speech and voice models. LANA decides these, and installs each one only if it fits this computer and there is room on the disk.
5. Download the models, checking every file, and keep going if the app is closed and opened again.
6. Start Pip (LANA's AI server) for chat and embedding on this computer, plus vision when it fits.
7. Use Forge in the cloud for chat and embedding when this computer cannot run them, unless the firm's admin has set up their own cloud provider. Then it uses that provider instead.

The whole flow must be simple enough for anyone. Someone who does not know what a model is should be able to press one button and be done.

After the first launch, the same facts live in **Settings > Capabilities**, so the person can see them and change the chat model later.

### Who chooses what

| Model | Who chooses | How |
|---|---|---|
| Chat | **The person**, with a default already picked | Default is the best chat model that fits comfortably |
| Vision (images) | LANA | The vision file paired with the chosen chat model, added only if it still fits |
| Embedding (search and memory) | LANA | Always the pinned nomic file. Never offered as a choice. |
| Speech (listening) | LANA | The Briefs speech models, installed if there is room |
| Voice (speaking) | LANA | The Briefs voice model, installed if there is room |

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
| D4 | Who chooses models | **The person chooses only the chat model, with a default already selected.** LANA chooses vision, embedding, speech and voice. Any user can change the chat model, on the first-launch screen and in Settings. (Decided 2026-11-09.) | Most people should just press Continue. LANA controls the models it depends on, so they are always the ones it requires. |
| D5 | Context window | **The largest step that stays comfortable**: 32768, then 16384, then 8192 tokens. Below 8192, chat uses the cloud. | LANA answers from documents and needs room. 8192 is LANA One's floor. |
| D6 | Ports | **A LANA band**: chat 8081, embedding 8082, vision on the chat server. Use the next free port if one is taken, and pass the real address to the engine. | Matches today's dev setup and LANA One, and avoids Pip Desktop's bands. |
| D7 | When setup runs | **Before sign-in**, in its own window. Downloads keep going in the background after the person moves on. | Models do not need an account. Sign-in should not wait on a 5 GB download. |
| D8 | Where state is kept | electron-store key `firstLaunch` (plan, versions, step done), model files in `<userData>/models` | Survives restarts. One place to reset. |

Answered by Michael on 2026-11-09:
- Any user can change the chat model, because it only affects their own computer. Nothing else is a choice.
- Speech and voice are not a checkbox. LANA installs them itself when they fit and there is room.
- A firm cannot lock a chat model for now.

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

The models LANA requires are priced first, so the chat choices shown are only ones that leave room for them.

1. Set aside the required models:
   - **Embedding** runs all the time (2048 tokens, 1 slot), so its memory is always set aside.
   - **Speech and voice** run inside the app only while someone is recording or talking. Their peak was measured on this Mac on 2026-11-09 with the models loaded and running: meeting transcription with speaker labels 1.26 GB, Talk (listening and speaking) 1.34 GB. 1.4 GB is set aside, so a chat model is never chosen that leaves no room to record. The number lives next to the speech catalog (`electron-local-models.js` `speechSizes`) and must be measured again when the speech engine changes.
2. For each chat model and each context step (32768, 16384, 8192), estimate with Pip Desktop's `estimateImpact`: model + conversation memory + working memory, plus vision if a vision file pairs with it. Two conversations are kept ready (Pip Desktop's default) and the context is per conversation.
3. Against total memory, call it **comfortable** under 55%, **tight** under 75%, otherwise **won't fit**. The 45% left is what keeps the system and other apps running, so no separate amount is set aside for them. (An earlier draft also set aside 3 GB for the system and 2 GB for the app, as LANA One does. Together with the 55% rule that counted the same room twice, and it pushed a 16 GB Mac down to the 1.7B model.)
4. **NVIDIA card:** chat and vision use the card's memory, less 1 GB for its driver: comfortable under 85%, tight up to 100%, because nothing else shares the card. Embedding and speech stay in system memory.
5. **No graphics chip:** the same math as a Mac, but a model over 2 GB is marked "answers slowly" and is never the default. It can still be chosen.
6. Check free disk, in this order, and stop adding when the disk runs out (keeping 512 MiB free): embedding, the chosen chat model, its vision file, speech, voice. Files already on the computer need no space.

The result for each chat model: `{ id, name, sizeBytes, fit: comfortable | tight | wont_fit, contextTokens, pages, slow, reason }`. Reasons are plain sentences, for example "This model needs a computer with about 30 GB of memory."

What it picks today (built-in catalog, measured speech memory):

| Computer | Default chat | Remembers | Image reading |
|---|---|---|---|
| 4 GB, no graphics chip | Cloud | | Cloud |
| 8 GB | Qwen3.5 0.8B | 32,768 tokens | No |
| 12 GB | Qwen3.5 4B | 32,768 tokens | No |
| 16 GB Mac | Qwen3.5 4B (9B offered at 16,384 tokens) | 32,768 tokens | Yes |
| 24 GB Mac (this one, M4 Pro) | Qwen3.5 9B | 32,768 tokens | Yes |
| 36 GB Mac | Qwen3.5 9B (35B offered as tight) | 32,768 tokens | Yes |
| 48 GB Mac and up | Qwen3.5 35B | 32,768 tokens | Yes |
| 16 GB with an 8 GB NVIDIA card | Qwen3.5 4B | 32,768 tokens | Yes |
| 16 GB with a 12 GB NVIDIA card | Qwen3.5 9B | 32,768 tokens | Yes |
| 16 GB, no graphics chip | Qwen3 1.7B (9B offered as slow) | 32,768 tokens | No |

### 4.3 Pick the setup

- **Chat (the default the person sees):** the biggest model the client supports that is comfortable at 32768 tokens (about 44 pages). A smaller model that holds 32768 beats a bigger one that does not, so a 16 GB computer gets the 4B with image reading, not the 9B at 16384 with none (decided 2026-11-09). If none holds 32768, the biggest comfortable at 16384, then at 8192. If none, chat uses the cloud and there is nothing to choose. Bigger models are still choices.
- **Vision:** added by LANA only if the chosen chat model stays comfortable with it. If the person picks a different chat model, LANA decides again.
- **Embedding:** nomic f16 (the pinned file) whenever it fits, which is almost always. Otherwise embedding uses the cloud.
- **Speech and voice:** installed by LANA when they fit and there is room. If they do not, the Briefs features that need them say so plainly and point to Settings (the existing rule).
- **Engine tier:** set `LANA_TIER` from the plan (the engine refuses to start without it). This is done in phase C, where the engine is started. The backend's tiers (`infra/lib/config/tier.config.js`) start at the 9B (`demo`), so the smaller chat models need a decision there.

The pinned embedding file must stay exactly the pin (`deploy/railway/embed/embed-pin.json`). The catalog is never allowed to change it.

---

## 5. The first-launch screen

One window, built with Lex components, with its own `first-launch.html`, `.js` and `.css` (page hygiene rule). It is not a modal.

1. **Checking this computer.** A short progress line while hardware is read. Under a second.
2. **Your AI setup.** One card, for chat, with the default already selected:
   - the chat model, its size, and the fit word ("Good fit for this computer")
   - how much it can remember: "About 44 pages at once" (a page is about 500 words, or 750 tokens)
   - where it runs: "On this computer" or "In the cloud (Forge)"
   - a "Choose a different model" link that lists the chat models with their fit words and how much each remembers. Models that won't fit are greyed out with the reason.
   - Below the card, one short line lists what LANA adds by itself, with no controls: "LANA also sets up search, image reading, listening and speaking for you." Anything that does not fit is left out of that line.
   - A line with space needed and space free: "Needs 7.4 GB. This computer has 210 GB free."
   - When no chat model fits: "This computer is too small to run LANA's chat. LANA will use the cloud instead." No error styling and no choice to make. It is a normal outcome.
3. **Continue.** One button. Downloads start in the background and the person goes to sign-in. A small status chip in the app shows download progress until it is done. Closing the app pauses the download, and opening it again picks up where it stopped.
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
- **Change model** button on the Chat row only. It opens the same chooser as first launch, downloads the new file (and its vision file when it fits), then restarts the chat Pip server. Embedding, Images, Speech and Voice rows show facts only.
- Rows for jobs running in the cloud say why: "This computer is too small for chat, so LANA uses Forge."

Removing models stays off (decision from 2026-11-08).

---

## 8. Speech and voice (stay on sherpa, get ready for Squeak)

Squeak is not ready for LANA yet: Pip Desktop v2.0.0 runs it on Windows only (`docs/VOICE-API.md`: "macOS and Linux builds of Squeak do not exist yet"), and its pack has no speaker labeling, which Briefs needs. So speech stays on `sherpa-onnx` for now. The work here is to make the swap a one-file change later.

**It must work the same on Windows, macOS and Linux.** `sherpa-onnx-node` already ships native packages for all three (`sherpa-onnx-win-x64`, `sherpa-onnx-darwin-arm64`, `sherpa-onnx-linux-x64` and others), and `scripts/briefs-before-pack.js` refuses to build an installer that is missing the one for its platform. The speech port below adds nothing tied to one platform: no platform audio APIs, paths built with `path.join` under `userData`, and the speech engine chosen by what is installed, not by the operating system. Tests run the fake engine, so they pass on all three. The swap waits until Squeak runs on all three as well.

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
| F | Speech port (section 8) | Briefs and Talk tests pass unchanged; a fake speech engine can replace sherpa in tests; no code tied to one operating system |
| G | Bundle `lqe` per platform in the installer, signed | Signed macOS build launches Pip from inside the app |

Phase 3 of the custom cloud endpoint plan (backend routing) must land before cloud fallback for chat is done end to end. Chat end-to-end runs are Michael's call.

---

## 10. Risks

- **Signing:** a bundled `lqe` must be signed and notarized with the app (LANA One `docs/specs/PACKAGING_SIGNING.md` covers the order).
- **Memory estimates are only for Qwen families.** The conversation-memory numbers in `estimateImpact` are measured for Qwen3 and Qwen3.5. A new model family needs its own number before it is offered.
- **The embed pin is stale.** `embed-pin.json` still names Pip build `ddedf87`. A deployment with no Pip of its own would expect that build. The pin should be restaged for `v3.0.0` before installed clients ship.
- **Slow downloads.** A 5.6 GB chat model can take a long time. The cloud is used until local files are ready, so the app works from the first minute.

---

## 11. Progress

### Phase A: done 2026-11-09

- `electron-hardware.js`: memory, chip, cores, graphics (Apple silicon, NVIDIA through `nvidia-smi` on Windows and Linux, else processor only) and free disk at the models folder. Every reader is injectable, so the tests run on any operating system.
- `electron-model-catalog.js`: the published Pip catalog (`models.lanaai.io/llm/catalog.json`, or `LANA_MODEL_CATALOG_URL`) cut down to LANA's five chat models and their four vision files. Rows must have a full SHA-256, a bare `.gguf` file name and a size; downloads always point at our bucket. The last good copy is saved, and a built-in copy (the published entries as of 2026-11-09) is used offline.
- `src/js/local-ai-fit.model.js`: the sizing in sections 4.2 and 4.3, plus `fitLabel` and `remembersLabel`. Works in the main process and the page.
- `electron-local-models.js`: `speechSizes()` and `SPEECH_FEATURES`, with the measured speech memory.
- Tests: `tests/unit/local-ai-fit.model.test.js`, `electron-model-catalog.test.js`, `electron-hardware.test.js`, and a speech sizes test in `electron-local-models.test.js`. 60 pass. Breaking the speech reservation failed 5 tests; letting a row choose its own download address failed 1.
- Checked live on this Mac: the published catalog loads (`source: published`), the computer reads as Apple M4 Pro, 24 GB, 14 cores, 60 GB free, and the plan is Qwen3.5 9B with image reading at 32,768 tokens, with speech and voice, 7.3 GB to download.
- Nothing calls these yet. Phase B (downloads) and phase D (the first-launch screen) use them.

### Qwen3.5 4B: added 2026-11-09

- Added to LANA's chat models and the built-in copy. Files: `lmstudio-community/Qwen3.5-4B-GGUF`, the same publisher as our 9B (our 9B on the bucket matches theirs byte for byte). `Qwen3.5-4B-Q4_K_M.gguf` 2,707,513,696 bytes, SHA-256 `25082a7d...a1418c`; `mmproj-Qwen3.5-4B-BF16.gguf` 675,568,768 bytes, SHA-256 `ae08d9d7...454b91`.
- Checked on Pip 3.0.0 (`ff965d5`) on this Mac: loads with in-engine image reading, answers, and its conversation memory is 594.2 MiB per conversation at 32768 tokens. The Qwen3.5 estimate predicts 594.9 MiB, so no new number is needed.
- **Published 2026-11-09.** Both files are on the bucket (`models.lanaai.io/llm/`) and in the published catalog, from `lmstudio-community/Qwen3.5-4B-GGUF` at revision `f9f88ac3e234be915e23811a6d28ea287bdb927e` (apache-2.0). The public copies were downloaded again and match the fingerprints above. The catalog before the change is saved in the bucket as `llm/backups/catalog-2026-11-09T14-27-31-069Z.json` (24 entries; now 26). With the live catalog, 12 and 16 GB computers get the 4B at 32,768 tokens, 16 GB with image reading.
- Qwen publishes the 4B itself only as full-size weights (`Qwen/Qwen3.5-4B`), with no GGUF for any Qwen3.5 model.

### Phase B: done 2026-11-09

- `electron-model-download.js`: one file at a time into `<file>.part`, resumed with HTTP Range after a restart (a server that answers 200 starts the part again), cut off past the pinned size, the whole part hashed at the end, renamed only when size and SHA-256 match, deleted when they do not. Pausing and a 30 second stall end the stream cleanly, so every byte received is on disk first. Only https on `models.lanaai.io`, every redirect checked. The disk must hold what is left plus 512 MiB before anything is fetched. A checked file gets a `<file>.verified` note (size, change time, SHA-256), so later launches do not hash gigabytes again; a changed file is hashed again.
- `electron-local-models.js` `downloadModel` and `isInstalled` now use it. The old downloader is gone.
- `electron-first-launch.js`: works out the plan for the computer as it is now, keeps the person's chat choice, and downloads embedding, chat and image reading in that order with progress. Nothing is downloaded before the person presses Continue (`accept()`, phase D). After that every launch resumes setup that is not finished (`resume()`, called at app start). When every file is in place it saves `completedAt` and calls `onReady`, which phase C uses to start Pip.
- Speech and voice: Briefs keeps its speech models in each person's own folder (`briefs/people/<person>/Models/speech`), so they cannot be fetched before sign-in. When a person's Briefs starts, the client asks it for the ones the plan chose (`downloadModels`, new on the Briefs host), and Briefs fetches them with its own resuming store. A second person on the same computer gets their own copy; sharing one copy is a later change in Briefs.
- `electron-storage.js` `firstLaunchPersistence`: `chatId`, `acceptedAt`, `completedAt`.
- Tests: `electron-model-download.test.js` (15), `electron-first-launch.test.js` (10), `electron-storage-first-launch.test.js` (3), two new in `electron-briefs.test.js`, the downloader tests in `electron-local-models.test.js` moved to the new one. 140 pass across the related client suites. Breaking the Continue rule failed 2.
- Checked live against `models.lanaai.io`: the embedding model paused at 60.0 MB with 60.0 MB on disk, resumed from 60.0 MB, finished, and its SHA-256 matches the pin; the second check read the note in under 1 ms. The real plan on this Mac, from the published catalog: Qwen3.5 9B with image reading, then speech and voice.
- Not done here: the first-launch screen that calls `accept()` (phase D), and starting Pip when it is ready (phase C).

### Phase C: done 2026-11-09

- `electron-pip-supervisor.js`: runs up to two Pip servers from the plan. Chat: the chosen model, its image file, `ctx` per slot and `parallel` from the plan, `kv_type q8_0`, `ubatch 512`, `fair_chunk 64`, graphics on Apple and NVIDIA (`gpu_layers 99`) and the processor otherwise, threads from the core count (two left for the computer, at most 10), the Apple-only residency setting only on Apple. No session folder, so conversations are never written to disk. Embedding: the same settings the server's own Pip uses for nomic (`role embed`, alias `nomic-embed-text`, `ctx` and `ubatch` 2048, one slot). Settings files and logs are in `<userData>/pip`.
- Each server listens on 127.0.0.1 (chat prefers 8081, embedding 8082, any free port when taken) and counts as ready only when `/health` says `ok` with the planned model file. It restarts after an exit, three failed checks, or no answer within 3 minutes, waiting 1, 2, 4 ... up to 60 seconds. Changing the chat model restarts only the chat server. Quit: SIGTERM, then SIGKILL after 5 seconds, after the engine has handed its jobs off.
- `lqe` comes from `LANA_PIP_BINARY` (a developer's build) or `<resources>/pip/lqe` (`lqe.exe` on Windows) in an installed app. Without it nothing starts and chat and embedding use the cloud. A role whose address the environment already names (`LANA_ENGINE_CHAT_URL`, `LANA_ENGINE_EMBEDDING_URL`) is left to that server.
- `electron-first-launch.js` `resume()` now runs setup on every launch after Continue: files in place are skipped by their notes, a missing one is fetched again, and `onReady` starts Pip.
- `electron-local-engine.js`: once every server Pip started has answered, its addresses and the chat model file go to the engine as `LANA_ENGINE_CHAT_URL`, `LANA_ENGINE_EMBEDDING_URL` and `LANA_TOKENIZER_GGUF` (so the engine counts tokens with the chat model's own vocabulary instead of guessing). A running engine restarts once when they change. The environment wins over Pip's values.
- The engine refuses to start without an engine level (`LANA_TIER must be configured`), so the client always gives one: `demo` unless the environment names another. Demo budgets 8192 tokens, which never exceeds a planned Pip slot or a cloud model's window, so it is safe for every chat model. **Open (backend):** a level tuned for local chat models under 9B (the 4B and 0.8B).
- `electron-api-base.js` `resolveEngineConfig`: an installed app with `<resources>/engine` starts that engine with nothing typed. A typed or saved root still wins.
- Tests: `electron-pip-supervisor.test.js` (17), `electron-local-engine-pip.test.js` (8), two cases added in `electron-first-launch.test.js`. Breaking the model-file check, the backoff, the "wait for every server" rule and the "keep an unchanged server" rule each failed a test.
- Checked live on this Mac with the app's own modules and Pip 3.0.0: setup downloaded the 9B's image file (921,705,024 bytes, SHA-256 matches), started chat and embedding, both answered `/health` with the planned files (chat ready in 15 to 19 seconds), the engine restarted once with their addresses, connected to the server, and loaded the exact vocabulary from the chat file. Chat answered "Pip is ready" and embedding returned 768 numbers. On stop nothing was left running. With no Pip, the engine ran 15 seconds healthy with no restarts. The Electron app starts with the new wiring.
- Not done here: putting `lqe` and the engine inside the installer and signing them (phase G; today's installer has neither, so an installed app still uses the cloud), and the first-launch screen (phase D).
- Seen, not from this change: at app start the screen calls the engine for a few seconds before it is listening (about 40 "Failed to fetch" errors in the log, the same before and after this change).

### The redactor on this computer: added 2026-11-09

Why: the engine redacts every turn it sends to the cloud (Forge or the firm's provider) before it leaves the computer, and refuses to send one it cannot redact (backend `src/shared/relay/relay-client.js:198`, `src/shared/redaction/egress-gate.js:91-95`). It finds the redactor from `REDACTOR_URL` and `INTERNAL_SERVICE_SECRET` (`src/config/redaction.config.js`), read once at start. The client passed neither, so cloud turns from a person's computer could not be sent.

Models inventory (two read-only reviews of the backend, the engine, the client, Briefs, BLOT, LANA One and Pip Desktop, 2026-11-09): besides chat, vision, embedding and the Briefs speech models, the only models the person's computer needs are the redactor's. The engine's classifiers (about 7 MB of JSON and ONNX) ship inside the engine's code, so they need no download, but the engine bundle in phase G must include `src/data/ml`, `data/ml/onnx-baseline` and `onnxruntime-node`. Docling, Unstructured, TimesFM, @voice speech and Stable Diffusion run only on the organization's server.

- `electron-redactor.js`: runs lana-redactor the way BLOT does (`blot-framework/src/main/embedded-redactor.ts`). A free loopback port and a new 32-byte secret each launch, strict mode, and only the OS basics from the client's environment. It counts as ready when `/healthz` says `ready` and `analyzer_ready` and one signed test request with fixed text succeeds. Then the engine is given `REDACTOR_URL` and `INTERNAL_SERVICE_SECRET` and restarts once. Restarts keep the port and secret. It is started at launch, before sign-in (it holds no data), and stopped on quit after the engine. A redactor the environment names wins, address and secret together; a secret alone is never passed.
- Where it comes from: `LANA_REDACTOR_BIN`, else `<resources>/redactor/lana-redactor` (`.exe` on Windows) in an installed app, else (development) `LANA_REDACTOR_SRC`, a lana-redactor checkout run with the uvicorn of `LANA_REDACTOR_VENV` or `~/.lananode/redactor/venv`, checkout first on `PYTHONPATH`. None: no redactor, and turns stay on the computer.
- Layers: the lighter ones first. These are the pattern rules (SSN, EIN, card, IBAN, case numbers), the health record rules, and spaCy `en_core_web_lg` 3.7.1 for names, organisations and places. Not yet: Tesseract for scanned pages (the program reads `LANA_TESSERACT_PATH` and `LANA_TESSDATA_DIR` when an OCR runtime is placed at `<resources>/redactor/ocr`, built like BLOT's `build-ocr-runtime.sh`), scispaCy health terms (120 MB, pinned), and the de-identification transformer (about 1.4 GB, no pin yet).
- Memory: measured on this Mac, 427 MB after the first request and 458 MB at the peak while redacting a 54,265-character text (about 5 seconds each). Sizing sets aside 0.5 GiB whenever the redactor is on the computer (`REDACTOR_MEMORY_BYTES`). That changes three defaults: 12 GB now gets the 0.8B with image reading instead of the 4B, 8 GB gets the 0.8B at 16,384 tokens instead of 32,768, and 4 GB no longer fits speech.
- Packaging: `scripts/build-redactor.sh` builds `build/redactor/lana-redactor` with PyInstaller from the lana-redactor commit pinned in `redactor/redactor-pin.json` (e4ea486, v0.2.0), refusing a different commit, local changes, a build Python missing the names layer or PyInstaller, or a different spaCy model version. The entry point is `redactor/lana_redactor.py`. The installers put it at `resources/redactor`; the Mac build signs it. `scripts/before-pack.js` now refuses to package without it, as it already does without the Briefs speech engine.
- `electron-process-keeper.js`: the keep-it-running logic Pip used, now shared by Pip and the redactor (health check passed in). Pip's tests pass unchanged.
- Tests: `electron-redactor.test.js` (14). Engine pairing and the sizing reserve added to `electron-local-engine-pip.test.js` and `local-ai-fit.model.test.js`. Breaking the `analyzer_ready` check, the `ready` check, the signed test request, the address-and-secret pairing, the environment-wins rule and the memory reserve each failed a test.
- Checked live on this Mac: the client started the redactor from the lana-redactor checkout (ready in 2.5 seconds), the engine restarted with `REDACTOR_URL` and the matching secret in its environment, the engine's own `RedactorClient` redacted a name, company, city, SSN and email through it, and a wrong secret was refused. In the Electron app, the redactor started before sign-in, the engine restarted once with it, and quitting closed all three.
- Built on this Mac (Apple M4 Pro, macOS arm64), 2026-11-09, with Michael's go-ahead. A separate Python 3.11 build environment (not `~/.lananode/redactor/venv`) with lana-redactor 0.2.0 from the clean pinned checkout, PyInstaller 6.22.3, and `en_core_web_lg` 3.7.1 from `models.lanaai.io` with its sha256 checked. `scripts/build-redactor.sh` ran unchanged in about 2 minutes 15 seconds and made `build/redactor/lana-redactor`, one 669 MB program. No script changes were needed.
- The program, checked live: `/healthz` answered `ready` and `analyzer_ready` true with `spacy_model` `en_core_web_lg`; a signed `/redact` replaced the name, company, city, SSN and email; no secret and a wrong secret were each refused with 401. Ready in 30 to 47 seconds, almost all of it unpacking the one-file program into the temporary folder on every launch (the checkout starts in 2.5 seconds); the start limit is 90 seconds. Memory at the peak, redacting the same 54,265-character text three times (about 6 seconds each): 533 MB, a little above the 0.5 GiB set aside; 163 MB once idle. The unpacked copy is removed when the program stops normally.
- In the client: `LANA_REDACTOR_BIN` pointing at the program, the client's redactor became ready, the engine restarted with `REDACTOR_URL` and the matching 64-character secret in its own environment, the backend's `RedactorClient` redacted a name, company, city, SSN and email through it, and a wrong secret got 401. Every process stopped afterwards.
- Packaging: `scripts/before-pack.js` passes for the Mac. An unsigned `electron-builder --mac dir --arm64` (no signing, notarizing or publishing) put the program at `Contents/Resources/redactor/lana-redactor`, and the client's installed-app lookup started it from there, ready in 40 seconds, and it redacted a signed request.
- Still to do: build the program on a Windows x64 machine (`lana-redactor.exe`) and on a Linux x64 machine, each with its own Python 3.11 build environment prepared the same way; PyInstaller cannot build for another system. The package step checks only that a file with the right name exists, not which system it was built for, so a Linux package must not be made from a tree holding the Mac program. Signing and notarizing the Mac program happen in the signed release build. Worth deciding: a one-folder build would start in seconds instead of 30 to 47, and the reserve may need to rise to about 0.55 GiB.

### Phase D: done 2026-11-09

- **The screen** (`src/first-launch.html`, `src/js/first-launch.js`, `src/css/first-launch.css`) is a `<lex-walkthrough>` tour with the app walkthroughs' look: the same layout, type, green accent, staggered entrance and LANA brand animations (idle on welcome, sync on the found step, spinner while downloading, success when ready), light and dark from the computer's setting. Pages: Welcome (this computer's memory, chip and free space), Files you have (only when some were found), Chat (the default preselected with its fit, pages remembered, size; "Choose a different model" lists every chat model, too big ones disabled with their reason; what LANA adds by itself, one line each; space needed against free space), Setting up (progress with the current file and bytes, Pause, Resume, Try again, and Go to sign in). A computer too small for chat gets "Runs in the cloud" and still Continue.
- **It cannot be skipped** (Michael): no Skip, and no Escape, arrow or Return keys; every move is a button. `lex-walkthrough` gained options for this (`skippable`, `keyboardNav`, a page's `content`, `nextLabel`, `nextVariant`, `back`, `next`, and a cancelable `lex-walkthrough-next`); the app walkthroughs keep their Skip and keys. `lex-radio` options can be disabled one by one.
- **When it shows:** the window that shows sign-in today loads `first-launch.html` instead of `login.html` until the person has pressed Continue once (`firstLaunchPersistence.acceptedAt`). After that it goes straight to sign in. Downloads keep running in the main process after the person moves on.
- **Files already on this computer** (`electron-model-reuse.js`): before downloading, LANA looks in Pip Desktop's models folder (macOS `~/Library/Application Support/LQE/models`, Windows `%APPDATA%/Pip.cpp/runtime/models`, Linux `$XDG_CONFIG_HOME` or `~/.config` `/Pip.cpp/runtime/models`), `~/.llama-models` and LM Studio (`~/.lmstudio/models`, `~/.cache/lm-studio/models`) for files with a planned file's name and exact size, then checks each SHA-256 against the pin once. The check is remembered in LANA's own models folder (`.found-checks.json`), never next to the other app's file. Only checked files are offered ("Found Qwen3.5 9B and the search model already on this computer. Use them? Saves 5.5 GB."). Yes puts them in place with a hard link on the same disk, else a copy that is checked again; the original is never moved or changed. The welcome page says "Found AI files you already have." with a "See what LANA found" button.
- **IPC** (`electron-first-launch-ipc.js`, preload `electronAPI.firstLaunch`): plan, find existing, choose (refuses a model that does not fit), continue (with use existing or not), pause, resume, status, and a status push to every window. The page never sees file addresses or paths. `LANA_DEV_HARDWARE` (JSON) pretends the computer is another size, only with `NODE_ENV=development` in an unpackaged app.
- **The words** come from `src/js/first-launch.model.js` and `src/js/first-launch.pages.js` (plain modules). A stopped download never says it "keeps going"; the downloader's own messages are shown as they are, anything else gets a plain sentence.
- **Bug fixed** (`electron-model-download.js`): pausing a real download showed "Setup stopped: This operation was aborted" (Michael saw it at 66 MB of 6.4 GB). Real `fetch` errors the body read in flight with an AbortError when its signal fires, before the downloader's clean stop. The pause signal now reaches `fetch` only until the server answers; after that a pause cancels the reader, so every byte received is kept and the next run resumes. A test with a fetch that behaves like the real one failed before the fix.
- Tests: `first-launch.model.test.js` (30), `first-launch.pages.test.js` (6), `electron-first-launch-ipc.test.js` (13), `electron-model-reuse.test.js` (9), three added in `electron-first-launch.test.js` (13), four in `lex-walkthrough.test.js` (8), two in `electron-model-download.test.js` (17). 301 pass across 24 related suites. Breaking the too big rule, the choose call, the cloud check, the IPC fit check, the placing of found files, the pin check on found files, the Skip option and the keyboard option each failed a test.
- Checked live on this Mac with separate user data folders in development: the 9B and search model in `~/.llama-models` were found and checked; using them made hard links (same file, original unchanged) and only the 9B's image file downloaded; a pretend 4 GB computer showed the cloud page, reused the search model and reached ready with nothing downloaded; a pause mid-download kept the part file and showed Paused; a models folder that could not be made showed the failed state with Try again.
- Not done here: a status chip in the app while downloads finish, and Settings > Capabilities (phase E). Existing installs that are already signed in skip this screen; they get the chooser in Settings.


### Docling on this computer: added 2026-11-09

Decision (made for Michael, "the best thing for our deployment model"; backend plan `local-document-parsing.md`, "Docling runtime"): each computer gets a self-contained Python runtime, one archive per platform, downloaded by this setup. Not in the installer, no PyInstaller (torch makes it fragile), never the person's own Python.

- **Pins** (`docling/docling-runtime-pin.json`): runtime version `1.15.1-1`; python-build-standalone CPython 3.11.17 (release 20261021) with a sha256 for each of macos-arm64, macos-x64, windows-x64 and linux-x64; the lock per platform (`docling/locks/macos-arm64.txt`, every file hash checked, from `docling/requirements.in`: docling 2.100.0, docling-serve 1.15.1 without the web UI, docling-jobkit 1.12.1, torch 2.14.1 CPU, onnxruntime 1.30.0, the versions of the docling venv that serves today); the macOS arm64 archive (`models.lanaai.io/docling/runtime/1.15.1-1/macos-arm64.tar.gz`, 603,726,142 bytes, sha256 `c671cca8979dd2484c09e474369d4bbf272c61d1c9da54ac1c974312d6771e2c`, 1,961,490,430 bytes unpacked, macOS 14 or later); and the 21 models docling-serve loads for LANA's requests (layout heron, TableFormer accurate and fast, RapidOCR: 627,737,927 bytes) with the same URLs and sha256s as the backend's `scripts/download-docling-models.sh`. The enrichment-only models there (picture classifier, CodeFormulaV2) are left out: LANA never asks for them.
- **Build** (`scripts/build-docling-runtime.sh`, helpers in `scripts/docling-runtime-pack.py`): refuses any platform but this computer's; downloads the pinned Python and checks it; `pip install --require-hashes --no-deps` from the lock (kfp-server-api, which has no wheel, is built from its hashed source); strips headers, tests, pip and console scripts; compiles byte code with unchecked hashes and stops if any is left that would be rewritten after unpacking; proves a copy in another folder imports docling-serve, torch (CPU) and onnxruntime; writes `lana-runtime.json` (versions and the start command); packs a deterministic `.tar.gz`. Two builds in different folders gave the same sha256. About 5 minutes on an M4 Pro.
- **Install** (`electron-docling-install.js`): the archive through `electron-model-download.js` (resume, https on models.lanaai.io only, whole-file sha256, notes, disk check), unpacked by `electron-safe-untar.js` into `<userData>/docling/runtime-1.15.1-1/` (through `.partial`, renamed only when complete), a `.lana-installed` note naming the archive's sha256, then the archive deleted and older `runtime-*` folders removed; the models into `<userData>/docling/models/` with a `.lana-complete` note naming the set. Installed only when both notes match the pin. A cut download resumes; a cut unpack unpacks again from the kept archive.
- **The unpacker** refuses absolute and drive paths, any `..`, backslashes, links whose target is absolute or climbs, anything written through a link, hard links, devices and FIFOs, the same path twice, more bytes than the pinned unpacked size, damaged headers, and archives cut off in the gzip stream or before the tar end. Modes are only 0755 or 0644.
- **Sizing** (`planLocalAi`): Docling's 1 GiB is set aside (before chat is priced, as before) only when it is here or can be installed for this kind of computer and fits beside embedding comfortably. On the disk it comes after embedding, chat and vision and before speech, and takes the archive plus its unpacked copy plus the models (3.0 GiB at the busiest moment) while progress counts only the 1.15 GiB it downloads. No runtime for this kind of computer yet: nothing set aside, nothing downloaded, and the screen says so.
- **Setup and starting it**: first launch installs it with progress ("Now getting the document reader, Docling."), then starts it at once (`createDocling` now re-reads where Docling is on every start). `resolveDoclingCommand` order: `LANA_DOCLING_URL`, `LANA_DOCLING_BIN`, the installed runtime (with `HF_HUB_OFFLINE=1` and its own models), then the development venv. A developer's Docling means nothing to download.
- **The screen**: "Document reading: Reads your documents on this computer. 1.1 GB download." after image reading, or the plan's plain reason when it does not fit.
- Tests: `electron-safe-untar.test.js` (19), `electron-docling-install.test.js` (12), Docling cases in `local-ai-fit.model.test.js` (5), `electron-first-launch.test.js` (5), `electron-docling.test.js` (1 changed, 1 added) and `first-launch.model.test.js` (1). 176 pass across 11 related suites. 22 breaks (each unpacker refusal, the size cap, the end check, both install notes, the unpack space check, old runtime removal, archive removal, the disk order, the memory rule, the download size in progress, the runtime lookup, the offline flag, re-reading on start, the setup step, the installed check, the screen line) each failed a test.
- **Checked live on this Mac** (Apple M4 Pro, macOS 26): the Electron app itself ran the client's install code into a fresh user data folder (archive copied in place of the download because it is not published; it passed the size and sha256 check), unpacked 43,506 files in about 19 seconds and downloaded the 21 models from models.lanaai.io with every sha256 matching in about 20 seconds. Disk: 1.94 GiB runtime and 0.61 GiB models. No quarantine attribute on any file the app wrote. Started as the keeper starts it: `/health` ok in 68 seconds on the first start after install (cold disk cache) and 7 seconds after that. Converted with the backend's request options: a 68-page text PDF (12.5 seconds, 1,091 text items), a 5-page scanned closing disclosure with RapidOCR (16 seconds, 81 text items, 6 tables) and a 2-page motion (2 seconds), all `success`, nothing fetched from Hugging Face, no file written into the runtime folder.
- **Memory, a decision for Michael**: the 1 GiB reserve matches text PDFs (1,013 MB peak resident on the 68-page PDF, the same as the 1,047 MB measured with the venv). The scanned PDF with OCR peaked at 1,749 MB resident. macOS's peak footprint figure was higher still (3.7 GB and 4.8 GB), which includes memory macOS compressed; resident is the better guide. Raising the reserve to 2 GiB would move some computers to a smaller chat model, so it is left at 1 GiB here.
- **Signing**: every Mach-O in the runtime is ad-hoc signed (python-build-standalone and the wheels are linker signed), which Apple silicon requires and which is enough to run. Files LANA downloads with its own code carry no quarantine attribute (unless the app's Info.plist sets `LSFileQuarantineEnabled`, which it must not), so Gatekeeper never assesses them and notarization does not apply to them; `spctl` rejects them as not notarized, which only matters if they were quarantined. Hardened runtime and library validation apply to the app's own process, not to a separate program it starts. For defense in depth the release build can re-sign every Mach-O with the Developer ID (`codesign --force --options runtime --timestamp`) before packing and notarize a zip of the folder (notarytool takes zip, not tar.gz); signing changes the bytes, so it must happen before the sha256 is pinned.
- **Upload (not done)**: `scripts/upload-docling-runtime.sh <archive>` checks the archive against the pin, refuses an existing key, uploads to `lana-models/docling/runtime/1.15.1-1/macos-arm64.tar.gz` as `application/gzip` through the backend's `scripts/release/r2.sh`, and reads it back through the bucket and through `https://models.lanaai.io` (size and sha256). The models are already on the bucket.
- Still to do: build and upload macos-x64 (onnxruntime 1.30.0 has no Intel Mac wheel: lock the newest onnxruntime that has one), windows-x64 and linux-x64, each on a matching machine with a lock compiled for it (Linux and Windows against the PyTorch CPU index so no CUDA wheels come in; the build script needs bash, Git Bash on Windows). Possible trims: mlx (210 MB unpacked) comes in only through docling-jobkit's vlm extra and is never used on this path.
