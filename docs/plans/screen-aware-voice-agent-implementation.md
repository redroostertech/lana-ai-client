# Screen-Aware Dictation and Voice Agent — implementation plan

Status: implementation in progress on `screen-diction-agent` (2026-07-15).

## Repository map

- `lana-client` is an Electron 32 desktop shell with local HTML/JavaScript renderers, a context-isolated preload bridge, Electron main-process IPC, `electron-store`, and Lex light-DOM components. It packages macOS, Windows, and Linux builds with `electron-builder`.
- `lana-ai-chef` is the authenticated API and AI system of record. Its existing `/api/v1/voice` controller already proxies the local Whisper sidecar and uses the shared llama.cpp/Forge provider. `@voice` owns the optional local Whisper/Kokoro/runtime processes.
- Existing microphone code in `lana-client/src/voice/app.js` proves the supported browser capture format and backend authentication convention, but that page is an administrator voice-agent editor. The desktop interaction is implemented as a separate, small overlay rather than coupling it to that editor.

## Decisions

1. Electron main owns the voice session controller, global shortcuts, target state, permissions, clipboard preservation, and mutations. The overlay only captures audio and renders state. This prevents renderer or model output from gaining general desktop-control authority.
2. Literal dictation calls authenticated transcription only and then immediately inserts the final transcript. It never calls the agent model and never gathers screen context beyond the minimum target/editability fingerprint.
3. Agent mode gathers a bounded accessibility snapshot of the active application and sends it with the spoken instruction to a new schema-validated voice endpoint. On-screen content is delimited and treated as untrusted data.
4. Model output is restricted to typed `answer`, `insert_text`, `replace_selection`, `insert_table`, `copy`, or `clarify` proposals. It cannot emit selectors, scripts, keystroke sequences, process commands, or consequential clicks.
5. macOS is the first production adapter, using AXUIElement in a signed/bundled Swift helper. Clipboard paste is a preserved-and-restored fallback. Windows UI Automation and Linux AT-SPI remain explicit unsupported adapters until native implementations are validated; the packaged app continues to run and plain generated output can be copied.
6. OCR/screenshot capture is not part of the initial path. Accessibility context is sufficient for the reliable vertical slice and avoids requesting Screen Recording permission. The provider contract leaves room for an explicit, ephemeral OCR fallback later.
7. The overlay does not focus itself while listening or thinking. Preview controls may take focus; every mutation first restores and revalidates the captured target fingerprint.

## Vertical slice

1. Configurable global Dictation and Agent activation shortcuts plus overlay controls.
2. Buffered microphone capture with cancellation and authenticated Whisper transcription.
3. AX permission/status, focused editable target, selected text, bounded active-window context, and secure-field refusal.
4. Literal insert, selected-text rewrite, active-window summary, structured tabular insertion, preview/confirmation, clipboard copy fallback, and undo.
5. Idempotency guard, target-change revalidation, risk-based confirmation, bounded payloads, abort timeouts, and content-safe logs.
6. Unit/integration tests for the state machine, contracts, context minimization, policy, fingerprints, duplicate prevention, cancellation, and mocked end-to-end flows.

## Validation target

- Jest unit and integration suites in both repositories.
- Client Electron bundle build and backend lint/test of touched modules.
- macOS helper compile and self-test.
- Manual harness validation against a native text field and Chromium textarea/contenteditable; Gmail, Google Docs, Word, and Excel are documented as best-effort until explicitly exercised.
