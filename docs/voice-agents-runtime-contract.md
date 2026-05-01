# Voice Agents Runtime Contract

The client-side Voice Agents surface should treat the main Lana API as the authority for structured intake field capture.

## Capture Endpoint

- Method: `POST`
- Path: `/api/v1/voice/intake-fields`
- Auth: Lana bearer token
- Required body fields: `call_id`, `field_name`, and either `value` or `field_value`
- Optional body fields: `workflow`, `source`, `confidence`, `metadata`

The backend response includes the persisted field in `data` and accumulated per-call state in `state.captured_fields`.

## Local Voice Runtime Endpoints

The Voice Agents UI is configured for the self-hosted LANA voice stack:

- Runtime/orchestrator: `lana-voice`
- Realtime transport: `livekit`
- Speech-to-text: `whisper`
- Text-to-speech: `kokoro`

Those runtime services may power session simulation, transcripts, STT, and TTS endpoints. They should not replace structured field capture unless the backend adds an explicit compatibility route.

## Voice Preview

- Method: `POST`
- Path: `/api/v1/voice/preview`
- Auth: Lana bearer token
- Body: `text`, optional `voice`, optional `speed`, optional `format`
- Success: `data.available=true` with `data.audio.mime_type` and `data.audio.base64`
- Not ready: `503` with `data.available=false`, `data.reason`, `data.message`, and endpoint attempts

The browser calls the main Lana API, not the sidecar directly. The backend owns sidecar discovery and returns a typed not-ready response if Kokoro is healthy but no synthesis route returns audio.

## Knowledge Boundaries

Voice agent knowledge is scoped explicitly:

- System voice guidance: LANA safety and call-handling rules. This is not firm data.
- Firm knowledge base: organization-wide receptionist content such as office hours, routing, practice areas, and intake policy.
- Workspace knowledge: only attached when the agent is operating inside a specific workspace.
- Matter knowledge: only attached after the caller/session is associated with a specific matter.

Matter and workspace knowledge should not be copied into the firm knowledge base. The agent config supports separate bindings so retrieval can enforce the correct scope at runtime, but the editor currently keeps workspace and matter scopes disabled until there is a guarded search-and-attach flow with access checks.

## Tool Boundaries

Voice tools are allowlisted capability bindings, not arbitrary user-defined endpoints. The editor presents readable capabilities and saves their backend binding names:

- `capture_intake_field`: builtin intake capture.
- `create_callback_task`: workflow-backed follow-up task creation.
- `route_urgent_call`: handoff-backed urgent call routing.

Runtime execution must resolve these bindings through LANA builtin handlers, workflows, handoff policy, MCP tools, or vetted webhooks. The editor should not expose free-form tool endpoints to end users.

## Channel Boundaries

Channels are connector-backed delivery bindings:

- Twilio phone: inbound/outbound voice calls through the Twilio connector.
- WhatsApp: WhatsApp conversations through the WhatsApp connector.
- Web test console: internal QA only, not a production caller channel.

The backend stores these as channel bindings with provider metadata so runtime dispatch can require the matching connector before publishing a production route.

Backend verification lives in:

```bash
cd ../LANA-AI
npx jest tests/unit/voice/voice.runtime-flow.test.js --runInBand
node scripts/testing/voice-agent-runtime-smoke.js
```
