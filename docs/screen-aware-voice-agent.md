# Screen-Aware Dictation and Voice Agent

## Architecture

The feature spans the existing Electron client and authenticated LANA API. It does not introduce a new service architecture.

```text
global shortcut / overlay
        │
        ▼
Electron main VoiceSessionController ──► overlay MediaRecorder
        │                                      │ final bounded audio
        │                                      ▼
        │                         POST /api/v1/voice/transcribe
        │                                      │ transcript
        ├── Dictation ─────────────────────────┘
        │        │ AX target revalidation → insert → undo record
        │
        └── Agent → scoped AX context → POST /api/v1/voice/screen-agent/decide
                                      → strict decision schema
                                      → preview/policy
                                      → AX target revalidation → typed action
```

Electron main owns the session state machine, global shortcuts, permissions, target fingerprint, clipboard fallback, idempotency, and execution. The context-isolated overlay owns microphone capture and presentation only. The authenticated backend owns Whisper proxying and structured model decisions. The model never receives a general desktop API.

States are `idle`, `listening`, `transcribing`, `awaiting_command`, `gathering_context`, `thinking`, `previewing`, `executing`, `speaking`, `canceled`, and `error`. Invalid transitions and overlapping sessions are rejected.

## Data and IPC boundaries

The overlay preload exposes only named `screen-voice:*` messages. Main rejects calls from any web contents other than the overlay. Audio is capped at 16 MiB base64 and recordings stop at 90 seconds. Backend request schemas cap the instruction, context, action text, and matrix dimensions.

Literal dictation performs only:

1. A minimal AX target/editability fingerprint (no selected, surrounding, or document text).
2. User-activated microphone capture.
3. Authenticated Whisper transcription.
4. Target restoration and revalidation.
5. AX selected-text insertion or clipboard-preserving paste fallback.

Agent mode explicitly shows when active-window context is read. It collects only the frontmost process/window and focused element. Context is truncated to 12,000 characters. No background windows are read.

## macOS accessibility adapter

`native/macos/LanaScreenVoice.m` is an AXUIElement helper invoked with a fixed command allowlist. It supports permission status/prompt, minimal target capture, bounded context capture, app restoration, insert/replace, fixed Command-V fallback, and fixed Command-Z undo. It accepts JSON data, never a command line supplied by a model.

The build compiles one universal arm64/x86_64 Mach-O. `electron-builder.client.json` places it at `Resources/screen-voice/lana-screen-voice`, outside ASAR, and declares it in the additional binary signing list. `NSMicrophoneUsageDescription` is included in the packaged Info.plist. Native npm rebuilding is disabled because the shipped host is the esbuild output and its only external production dependency (`electron-store`) is pure JavaScript; this also prevents unrelated server-only native modules from contaminating desktop packaging.

Windows and Linux packages remain functional, but the desktop adapter returns a clear unsupported error. UI Automation and AT-SPI adapters require platform validation before those platforms can be claimed.

## Permissions

- Microphone: requested when the user first invokes a voice session or chooses Enable Microphone.
- Accessibility (macOS): requested when the user invokes the feature or chooses Enable Accessibility. Needed to inspect the focused control and apply text safely.
- Screen Recording: not requested. This release does not capture screenshots or run OCR.
- Automation: no broad Apple Events permission is used.

If access is denied, the overlay shows an actionable error and performs no mutation. Plain screen context can be disabled while keeping dictation enabled.

## Privacy and security

- Audio exists in renderer memory for one utterance and is released after upload/cancel. It is not written to disk.
- Screenshots are never captured.
- Password/secure fields are identified by AX role/subrole/name, content is blanked, and mutation is refused.
- Clipboard fallback snapshots every available format, pastes, then restores the snapshot. Failures are surfaced.
- Logs include state/mode/error codes only; no transcript, screen text, selected text, audio, or generated content is logged.
- Context is enclosed as untrusted data. The centralized system prompt states that embedded screen instructions cannot change policy or request actions.
- The backend validates the model result and attaches the request’s target fingerprint server-side. Model-supplied scripts, selectors, keys, commands, or unsupported actions cannot cross the schema.
- Every mutation is revalidated against process, bundle identifier, window, role, element name, bounds, and—when replacing—selection hash.
- Execution tokens prevent duplicate inserts on retries.
- Send, Submit, Delete, Purchase, Publish, arbitrary clicks, process execution, and unrestricted keystrokes are not implemented.

## Interaction and confirmation

- Dictation shortcut: `CommandOrControl+Shift+Space`.
- Agent shortcut: `CommandOrControl+Shift+A`.
- Voice shortcuts and the overlay are unavailable until the main renderer has a
  valid authenticated session. Signing out cancels active capture, unregisters
  shortcuts, and destroys the overlay.
- `Open at Login` defaults off. When enabled, the Ready overlay opens after a
  successful sign-in; otherwise it stays hidden until a shortcut is pressed.
- The global shortcuts toggle capture because Electron does not expose a reliable global key-up event. The overlay microphone provides explicit start/stop. A native key-up monitor is intentionally not installed in this release.
- Escape cancels and discards active audio.
- Literal dictation into a verified editable field inserts without confirmation.
- Non-mutating answers/summaries display immediately.
- Selected-text replacements can be policy-approved directly, but generated replacements default to preview when the model marks them confirmation-required.
- Multi-cell/table actions always require preview.
- Target changes always stop execution.
- The latest supported mutation can be undone only while its target still matches.

## Supported and best-effort applications

Validated mechanisms:

- Native AppKit text controls exposed as AXTextField/AXTextArea.
- Chromium textarea and accessibility-exposed contenteditable controls.

Best-effort, pending release QA on specific versions: Gmail, Google Docs, Microsoft Word, Microsoft Excel, Apple Mail, Slack, and other rich editors. These applications may reject AX selected-text writes; the clipboard-preserving paste fallback is then used. Spreadsheet output is normalized to tab/newline-separated matrices.

Secure fields, canvas-only editors without accessible text, and applications that intentionally block AX are unsupported. Generated text remains copyable.

## Configuration and providers

No new client secret is required. The overlay reads the existing signed-in token through Electron main. The backend uses existing configuration:

The Electron host is discovery-gated. The organization must include the
`screen-diction` entry with `route.type: "capability"` and a compatible
`route.meta.platforms` value in `enabled_apps`. Capability entries are retained
as entitlements but are not rendered in the app switcher; see
`docs/CAPABILITY-APPS-SPEC.md`.

- `VOICE_STT_URL` / `WHISPER_URL` / `LANA_WHISPER_URL` (default `127.0.0.1:8091`)
- existing llama.cpp or Forge variables (`LLAMACPP_MAIN_URL`, optional `LLAMACPP_API_KEY`)
- optional Kokoro/TTS settings already used by `/api/v1/voice/preview`
- `SCREEN_VOICE_AGENT_TIMEOUT_MS` (optional, default 45 seconds)

To add a speech provider, preserve the authenticated `/api/v1/voice/transcribe` response contract. To add an agent provider, implement `generateJSON` compatibility behind the existing LLM service. To add an OS, implement `permissionStatus`, `requestPermission`, `getTarget`, `getContext`, `insert`, `replaceSelection`, and `undo` behind `createDesktopAdapter` and add race/privacy tests.

## Build and test

```bash
# Client
npm run bundle-electron
npm test -- tests/unit/screen-voice-core.test.js \
  tests/unit/screen-voice-desktop-adapter.test.js \
  tests/integration/screen-voice-workflows.test.js --runInBand
npm run build:mac-arm64

# Backend
npm test -- tests/unit/voice/screen-agent.service.test.js --runInBand
```

The client bundle step compiles and self-contains the universal helper before esbuild. A missing helper fails the macOS package build.

## Manual QA checklist

- [ ] Fresh install shows idle overlay without requesting permissions.
- [ ] First activation explains/reports missing Accessibility and Microphone access.
- [ ] Denying either permission produces a recoverable error and no mutation.
- [ ] Dictation into a native text field inserts once at the caret, including Unicode and multiline text.
- [ ] Dictation into Chromium textarea/contenteditable inserts once.
- [ ] Plain dictation sends no screen/document context and does not call the agent endpoint.
- [ ] Escape during listening, transcription, context, thinking, and preview leaves target unchanged.
- [ ] Changing application, window, field, or selected text before confirmation blocks mutation.
- [ ] Selecting text and asking for a professional rewrite previews and replaces only that selection.
- [ ] Asking for a screen summary displays/copies an answer without modifying the target.
- [ ] A spreadsheet matrix previews and pastes with tabs/newlines into predictable cells.
- [ ] Password fields expose no content and refuse insertion.
- [ ] Clipboard text, image, and rich formats survive fallback insertion.
- [ ] Undo reverses the latest supported insertion and refuses after target change.
- [ ] Disabling screen context retains dictation and removes content from agent requests.
- [ ] Voice output plays only when enabled and a TTS runtime is available.
- [ ] Shortcut conflicts produce a development log without leaking content.
- [ ] Packaged arm64 and x86_64 apps contain and sign `Resources/screen-voice/lana-screen-voice`.

## Known limitations

- Global activation is toggle-to-talk, not key-down/key-up push-to-talk, due Electron’s globalShortcut API.
- No OCR fallback is shipped; this deliberately avoids Screen Recording permission and silent capture.
- Windows UI Automation and Linux AT-SPI adapters are not yet implemented.
- AX and paste behavior varies across rich editors; third-party applications are best-effort until their pinned release versions pass QA.
- Undo delegates to the target application’s deterministic undo command and is limited to the latest voice mutation.
