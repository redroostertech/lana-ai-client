# ADR 004: Constrained conversational desktop agent boundaries

- Status: Accepted
- Date: 2026-07-16

## Context

LANA's Electron client needs a system-wide voice agent that can understand the active application, continue a conversation, hand work into LANA, and help users move between a matter and external research. The repository already has authenticated voice routes, a local Whisper sidecar, shared LLM infrastructure, agentic chat with approvals, Electron IPC, Lex UI, and notarized desktop packaging. It does not have a safe general-purpose desktop automation framework.

## Decision

Ship one agent mode rather than separate dictation and agent modes. `CommandOrControl+Shift+Space` is a press-and-hold conversational turn anywhere on the desktop. A non-editable focused element is valid context; editability is required only for an insertion action.

Maintain one in-memory conversation for the authenticated desktop session. Send the latest bounded turns verbatim and move older user/assistant turns into a rolling `conversationMemory` archive in Electron main. The archive is derived only from spoken conversation; model output cannot copy screen content into it. Screen content is scoped to one turn and must never be copied into conversational memory.

Keep authority in Electron main and use a small native AX helper on macOS. The backend returns schema-validated decisions from a fixed action allowlist. Initial desktop actions are insert, replace selection, table insert, copy, approved Google/Bing search handoff, and approved navigation to allowlisted LANA pages. Browser search and LANA navigation always require confirmation. Actual text mutations retain strict target fingerprint validation immediately before execution.

Use LANA's existing chat/agentic and human-in-the-loop systems for legal research, connector-backed retrieval, and longer-running work. The desktop agent may navigate or hand the user into those surfaces; it does not duplicate their tool runtime or execute arbitrary desktop commands.

Detect macOS audio-input hardware through the signed native helper before capture. No input device is reported as unavailable rather than repeatedly starting silent sessions. Hardware is checked at each turn so a newly connected headset works without restarting.

Do not ship continuous listening, screenshots, OCR, arbitrary clicks, form submission, shell execution, or model-supplied automation.

## Rejected alternatives

- Separate literal dictation: rejected because the product is now one conversational agent and every utterance needs continuity and intent handling.
- LLM-driven AppleScript, PowerShell, selectors, or key sequences: rejected because it grants unbounded authority and weakens target safety.
- Continuous screenshots/OCR: rejected because it requires broader permission and creates unnecessary privacy/retention risk.
- A second desktop research runtime: rejected because LANA chat already owns retrieval, connectors, plans, approvals, and artifacts.
- Persisting raw screen context in conversation history: rejected because active-window content is ephemeral task data, not durable memory.

## Consequences

The agent feels continuous during an authenticated client session and understands follow-ups such as "yes, do that." Signing out or losing the capability clears local conversation memory. Long-running legal/connector work continues in LANA's existing agentic surfaces. macOS is the validated platform; Windows UI Automation and Linux AT-SPI remain future adapters.
