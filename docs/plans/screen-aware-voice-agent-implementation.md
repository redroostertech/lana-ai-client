# Conversational Desktop Agent — implementation plan

Status: working vertical slice implemented on `development` (2026-07-16).

## Repository map

- `lana-client` is Electron 32 with local HTML/JavaScript renderers, a context-isolated preload bridge, Electron main IPC, `electron-store`, Lex components, and `electron-builder` packaging.
- `lana-ai-chef` is the authenticated API/AI system of record. `/api/v1/voice` proxies the Whisper sidecar and uses the shared LLM provider. Existing chat/agentic services own retrieval, connectors, plans, approvals, and artifacts.

## Implemented decisions

1. One press-and-hold agent mode replaces literal dictation. Every spoken turn is contextual and part of one authenticated-session conversation.
2. Electron main owns state, shortcuts, permission/hardware checks, conversation continuity, native targets, confirmation, notifications, and action execution. The overlay owns capture and presentation only.
3. Recent spoken turns plus rolling spoken-only memory support long follow-ups. Active-window context remains untrusted, bounded, ephemeral turn data.
4. macOS AX is the primary adapter. Non-editable targets support answers and summaries; mutations remain fully fingerprint-revalidated.
5. The allowlist covers text edits/copy, confirmed Google/Bing search handoff, and confirmed navigation to selected LANA surfaces. No arbitrary browser control or desktop automation is introduced.
6. Existing LANA chat/agentic workflows remain the execution surface for legal research, connectors, durable tasks, and human approvals.
7. Native audio-device discovery reports Mac mini/no-microphone configurations as unavailable and rechecks on each turn for newly connected headsets.

## Next platform increments

1. Durable cross-device voice conversations backed by the existing conversation service.
2. First-class handoff into an existing matter chat with the approved research prompt and task progress mirrored in the overlay.
3. Windows UI Automation and Linux AT-SPI adapters after packaging and target-safety validation.
