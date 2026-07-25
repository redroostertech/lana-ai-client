# Screen Voice Manager Breakdown

## High-Level Architecture

The screen-voice system is split into four layers:

1. **Main-process manager**: owns lifecycle, shortcuts, state, safety checks, API calls.
2. **Overlay renderer**: owns UI, microphone recording, meter, and local capture phases.
3. **Native macOS helper**: owns Accessibility, target context, mutation, and hold-key monitoring.
4. **Backend voice API client**: sends audio for transcription and asks the agent what to do.

## Main Manager

The core class is `ElectronScreenVoice` in `src/screen-voice/electron-screen-voice.js`.

It holds:

- `VoiceSessionController`
- desktop adapter
- settings store
- overlay window
- auth and entitlement flags
- shortcut state
- last target context
- preview decision
- conversation memory

Important areas:

- Overlay window creation: `createOverlay()`
- IPC registration: `registerIpc()`
- Auth and entitlement gating: `initialize()`, `setAuthenticated()`, `setEntitlementEnabled()`
- Shortcuts: `registerShortcuts()`
- Capture start path: `handleShortcutDown()`
- Voice session begin: `begin()`
- Audio handling: `handleAudio()`
- Agent decision and execution: `runAgent()`, `executeDecision()`

## Current Shortcut Flow

After the latest change:

### `Cmd+Shift+Space`

- Registered as an Electron `globalShortcut`.
- Calls `handleOverlayShortcut()`.
- Opens or reveals the overlay.
- Remembers the external target.
- Does **not** start recording.

### `Control+Option`

- Watched by the native macOS helper.
- Also handled directly by the focused overlay renderer as a fallback path.
- The native helper emits JSON events: `ready`, `down`, and `up`.
- The main manager receives those events through `startShortcutMonitor()`.
- `down` starts capture.
- `up` sends `screen-voice:stop-capture`.

The monitor handoff lives in `handleShortcutMonitorEvent()`.

## State Machine

`VoiceSessionController` in `src/screen-voice/voice-session-controller.js` enforces valid transitions.

Main flow:

```text
idle
  -> listening
  -> transcribing
  -> gathering_context
  -> thinking
  -> previewing or executing
  -> idle
```

It also owns:

- session id
- abort signal
- transcript
- target fingerprint
- decision
- execution idempotency tokens

## Overlay Renderer

The overlay UI lives in `src/screen-voice/overlay/app.js`.

It does not own agent logic. It owns:

- visible state rendering
- microphone capture via `getUserMedia`
- `MediaRecorder`
- start and release chimes
- level meter
- capture phases: `preparing`, `chiming`, `recording`, `releasing`
- sending final audio back to the main process

The preload bridge is `screen-voice-preload.js`. It exposes `window.screenVoice` APIs to the overlay without giving the renderer direct Node access.

## Native Helper

The JavaScript wrapper is `src/screen-voice/native-helper.js`.

It resolves and spawns:

```text
build/screen-voice/lana-screen-voice
```

It supports one-shot commands:

- `permission-status`
- `request-permission`
- `context`
- `target`
- `activate`
- `insert`
- `replace`
- `paste`
- `undo`
- `microphone-status`

It also starts the long-running shortcut monitor through `startShortcutMonitor()`.

The Objective-C source is:

```text
native/macos/LanaScreenVoice.m
```

## Desktop Adapter

The adapter is the safety boundary between the manager and the native helper. It lives in `src/screen-voice/desktop-adapter.js`.

It:

- asks the native helper for Accessibility permission status
- gets target/context
- activates the target app
- validates target fingerprint before mutation
- inserts or replaces text
- falls back to clipboard paste when Accessibility direct-set fails
- restores the clipboard after fallback

## Backend API

`VoiceApiClient` lives in `src/screen-voice/voice-api-client.js`.

Endpoints:

- `/api/v1/voice/transcribe`
- `/api/v1/voice/screen-agent/decide`
- `/api/v1/voice/preview`

The manager sends audio to transcribe, then sends transcript plus sanitized screen context to the agent decision endpoint.

## Safety Model

Main protections:

- Overlay IPC is sender-checked before handling commands.
- Native Accessibility context is sanitized before model use.
- Password and secure fields are blocked before capture/action.
- Target fingerprint is captured before recording and rechecked before mutation.
- Model output is schema-validated.
- Risky decisions go to preview instead of direct execution.
- Desktop mutation uses idempotency tokens to prevent duplicate execution.
