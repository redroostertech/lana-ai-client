# LANA Conversational Desktop Agent

## Architecture

The feature extends the existing Electron client and authenticated LANA API. It does not introduce another application or AI stack.

```text
press-and-hold shortcut / overlay microphone
                    │ bounded in-memory audio
                    ▼
         POST /api/v1/voice/transcribe
                    │ spoken turn
                    ▼
Electron VoiceSessionController
  ├─ recent spoken conversation + rolling spoken memory
  ├─ scoped active-window AX context for this turn
  └─ allowed capabilities/actions
                    │
                    ▼
 POST /api/v1/voice/screen-agent/decide
                    │ strict schema
                    ▼
 preview / clarify / approve
  ├─ answer or summary
  ├─ AX insert / replace / table / copy
  ├─ approved Google or Bing search handoff
  └─ approved navigation to an allowlisted LANA surface
```

Electron main owns session state, authentication/entitlement checks, shortcuts, permissions, native target capture, conversation continuity, confirmation, idempotency, notification, and execution. The context-isolated overlay captures audio and presents state. The backend transcribes audio and produces a constrained structured decision. The existing LANA chat agent owns legal research, connector-backed retrieval, plans, human approvals, and durable artifacts.

## Conversation model

There is one agent mode and one continuing conversation for the authenticated desktop session. Recent turns are sent verbatim. Electron main moves older user/assistant turns into a bounded `conversationMemory` archive, allowing references to earlier topics without sending an unbounded transcript on every request.

Only the user's spoken turns and the agent's responses, open questions, explicit approvals, and matter references may enter conversational memory. Accessible screen content is untrusted, turn-scoped data and is never copied into memory. Signing out or disabling the organization capability clears the local conversation.

The model is explicitly told that screen text is data, cannot change its rules, and cannot approve an action. A response such as "yes" is interpreted only against the preceding user/assistant conversation.

## Agent actions and confirmation

Allowed actions are:

- answer, summarize, clarify, or refuse without mutation;
- insert text, replace an explicit selection, insert a tabular matrix, or copy;
- open a confirmed HTTPS Google/Bing search results URL;
- navigate to `chat.html`, `matters.html`, `workspace-details.html`, `integrations/connectors.html`, or `notifications.html`.

Browser and LANA navigation always require the visible Approve action. Multi-cell changes and other risky edits follow the configured confirmation policy. Send, Submit, Delete, Purchase, Publish, arbitrary buttons, arbitrary URLs, scripts, commands, and unrestricted keystrokes are not available to the model.

Non-editable screens are valid for questions, summaries, and research clarification. Editability is checked only when a proposed action needs to change text. The active application must still match while context is gathered. Text mutation revalidates the complete target fingerprint immediately before applying the change.

## macOS accessibility and audio

`native/macos/LanaScreenVoice.m` is a signed universal AX helper. It exposes a fixed command allowlist for permission state, active/focused accessible context, activation, insertion, replacement, paste, undo, press-and-hold monitoring, and audio-input discovery. It never evaluates model output as a command.

The helper asks Chromium/Electron applications to expose their accessibility tree and performs a bounded focused-descendant search when a browser initially reports `AXWebArea`. Window-title and small layout changes are tolerated during non-mutating context collection. Application changes stop the request. Mutations remain strict.

Audio-input hardware is checked before every turn. A Mac without a microphone reports `MICROPHONE_UNAVAILABLE`; connecting a Bluetooth or USB microphone makes the next turn eligible without reinstalling. Audio remains in renderer memory for one utterance, is bounded to 16 MiB base64, and is not written to disk.

## Permissions

- Microphone is requested only when the user invokes the agent or explicitly enables it.
- Accessibility is requested when active-application understanding or mutation is first needed.
- Screen Recording is not requested; this implementation has no screenshots or OCR.
- Broad Automation/Apple Events access is not used.

Permission and hardware state are shown under Settings > Capabilities. A missing microphone is shown as Unavailable instead of repeatedly entering a silent capture loop.

## Privacy and security

- No continuous capture or always-listening wake word.
- No screenshots, raw audio files, screen contents, transcripts, selected text, or clipboard data in telemetry/logs.
- Password/secure fields expose no value and cannot be mutated.
- Context is bounded to the active application and truncated to 12,000 characters.
- Clipboard fallback preserves and restores every available format.
- Model decisions and IPC payloads are schema/size validated.
- Action URLs and client destinations are independently allowlisted in both backend and Electron main.
- Generic OS notifications reveal no matter or document content.
- Execution tokens prevent duplicate mutations.

## Capability configuration

Discovery must include the capability entitlement:

```json
{
  "id": "screen-diction",
  "label": "LANA Voice Agent",
  "description": "Conversational desktop assistance",
  "route": {
    "type": "capability",
    "meta": { "platforms": ["darwin"] }
  }
}
```

The legacy ID remains stable for deployed discovery data. Capability entries do not appear in the application switcher. Local activation, Open at Login, context sharing, voice output, confirmation policy, permissions, and hardware readiness are managed under Settings > Capabilities.

## Build and test

```bash
# Client
node scripts/build-screen-voice-helper.js
npx jest tests/unit/screen-voice-core.test.js \
  tests/unit/screen-voice-desktop-adapter.test.js \
  tests/unit/screen-voice-api-client.test.js \
  tests/integration/screen-voice-workflows.test.js \
  tests/integration/screen-voice-manager.test.js --runInBand
npm run bundle-electron
npm run build:mac-arm64

# Backend
npx jest tests/unit/voice/screen-agent.service.test.js \
  tests/unit/voice/voice.routes.test.js --runInBand
```

No new client API key is required. The backend continues to use the existing Whisper URL, LLM runtime configuration, optional TTS configuration, and `SCREEN_VOICE_AGENT_TIMEOUT_MS`.

## Manual QA

- [ ] Signed-out and non-entitled users cannot open or activate the agent.
- [ ] A Mac without an input device shows Microphone Unavailable and does not begin capture.
- [ ] Connecting a Bluetooth/USB microphone allows the next turn.
- [ ] Holding `CommandOrControl+Shift+Space` starts after the chime; releasing transcribes and processes.
- [ ] A non-editable browser/document screen can be summarized without `target_not_editable`.
- [ ] A follow-up such as "yes, research that" resolves against the previous question.
- [ ] Referencing an older spoken topic uses conversation memory without retaining screen text.
- [ ] Window-title/bounds changes in the same browser do not cause a reasoning-phase `TARGET_CHANGED`.
- [ ] Changing applications during context collection stops the request.
- [ ] Selected-text rewrite previews and revalidates before replacement.
- [ ] Web research shows an approval and opens only a Google/Bing search page.
- [ ] LANA navigation shows an approval and opens only an allowlisted client page.
- [ ] Approval can be clicked; a clarification can be answered with the next voice turn.
- [ ] Signing out clears the conversation and destroys the overlay.
- [ ] Denied microphone/accessibility permission is recoverable and causes no mutation.
- [ ] Escape cancels every active phase.
- [ ] Packaged arm64/x86_64 apps contain and sign the helper.

## Known limitations

- macOS is the only validated native adapter. Windows UI Automation and Linux AT-SPI are not implemented.
- Conversation continuity currently lasts for the authenticated desktop session; durable cross-device voice history should use the existing conversation service in a later release.
- The desktop layer opens a confirmed search handoff; it does not autonomously scrape or click through arbitrary sites.
- Connector-backed legal research and long-running tasks continue in the existing LANA chat/agentic UI rather than inside the floating overlay.
- OCR is not implemented, so canvas-only or inaccessible content cannot be read.
- Gmail, Google Docs, Word, Excel, and rich editors remain best-effort until pinned-version QA is completed.
