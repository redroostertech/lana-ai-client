# ADR 004: Constrained screen-aware voice boundaries

- Status: Accepted
- Date: 2026-07-15

## Context

LANA’s Electron client needs low-latency system-wide dictation and contextual voice assistance. The repository already has authenticated voice routes, a local Whisper sidecar, shared llama.cpp/Forge inference, Electron IPC, Lex styling, and notarized desktop packaging. It does not have a safe general-purpose desktop automation framework.

## Decision

Keep control in Electron main and use a small native AX helper on macOS. Literal dictation bypasses the agent. Agent output is strict JSON and can propose only insert, replace-selection, table insert, copy, clarify, or non-mutating answer behavior. Every mutation carries a captured target fingerprint and is revalidated immediately before execution.

Collect accessibility context only after explicit Agent activation. Use a minimal content-free target query for Dictation. Do not ship OCR/screenshot capture in the initial version. Preserve the clipboard only as a fallback. Do not add an always-listening wake word or consequential UI actions.

Use the existing Core `/api/v1/voice` route for authentication/orchestration and the existing optional `@voice` Whisper/Kokoro deployment. Add no database, daemon, port, client API key, or alternate AI stack.

## Rejected alternatives

- LLM-driven AppleScript/PowerShell/keyboard automation: rejected because model output would have unbounded authority and poor target safety.
- Continuous screenshots/OCR: rejected because it requires broader permission, raises retention/privacy risk, and adds latency to plain dictation.
- Clipboard-only insertion: rejected as the primary path because it disrupts user state and cannot reliably bind a replacement to the captured selection.
- Renderer-owned desktop control: rejected because compromised renderer content would cross the native authority boundary.
- A new local voice daemon: rejected because `@voice` already provides the deployment and provider boundary.
- Browser extension: rejected because AX supports the first vertical slice and an extension would add a second distribution/authentication surface.
- Immediate cross-platform native modules: rejected until Windows UI Automation and Linux AT-SPI can be tested in their packaging/CI environments. Explicit unsupported behavior is safer than unvalidated typing.

## Consequences

macOS receives the reliable production adapter first. Global shortcuts use toggle-to-talk until a signed native key-up monitor is justified. Gmail/Docs/Word/Excel remain best-effort pending versioned QA. The native helper becomes a signed release artifact, so the Electron bundle/package checks must remain part of CI.
