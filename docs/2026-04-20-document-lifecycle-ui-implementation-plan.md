# LANA Client Document Lifecycle UI Implementation Plan

## Objective

Align `lana-client` with the new canonical document lifecycle in `LANA-AI` so the client:

- treats upload, parse, index, summary, and ready as distinct states
- stops relying on the old extraction-only / JIT processing mental model
- keeps chat, matter documents, metadata, and file viewing behavior consistent
- is ready to surface the new backend lifecycle events cleanly

## Backend Reality Now

`LANA-AI` now has a single canonical ingestion pipeline centered on `document-processing`, with lifecycle events emitted at these points:

- `document.uploaded`
- `document.parsed`
- `document.indexed`
- `document.summarized`
- `document.ready`

This means the frontend should think in two layers:

1. Base document readiness
   - upload accepted
   - parsed
   - indexed
   - ready

2. Derived enrichment readiness
   - summary pending
   - summarized

The important product distinction is:

- `document.ready` means the document is usable in the platform
- `document.summarized` can land later and should not block core usage

## Current Client State

### What already works

- Matter documents page already derives reasonable coarse states from `status`, `processing_status`, `processed_at`, `chunk_count`, and `vector_count` in `src/js/workspace-details.js`.
- Chat V2 file drawer uses a similar readiness heuristic in `src/js/chat_v2.file-drawer.js`.
- File viewer already knows how to show `summary` and `summary_generated_at` in `src/js/file-viewer-page.js`.
- Metadata display already has formatting utilities for processing metadata and summary method in `src/js/utils/metadata-formatter.js`.

### What is stale

- The client still thinks in coarse states like `uploaded`, `processing`, `ready`, and `needs_attention`, not explicit lifecycle stages.
- Chat still includes a JIT processing model through:
  - `src/js/services/document-processing.service.js`
  - `src/js/chat_v2.js`
  - `src/js/lex/chat/lex-chat.js`
  - `src/js/file-drawer.js`
- The API client still exposes and depends on old on-demand processing endpoints:
  - `triggerDocumentProcessing`
  - `getDocumentProcessingStatus`
  - `pollDocumentProcessing`
- Metadata components still auto-refresh only while `processing_status === 'processing'`, which is now too narrow.
- Skill-builder and matter-skills event pickers expose `document.uploaded` and `document.indexed`, but not the full new document lifecycle set.

### Biggest mismatch

The frontend is currently compatible by inference, but not lifecycle-aware by design.

That is acceptable short-term, but it will keep drifting unless the client gets one shared lifecycle model and updates all document surfaces to use it.

## Target UX Model

The client should present the document lifecycle as:

- `Uploaded`
- `Parsed`
- `Indexed`
- `Ready`
- `Summary Pending`
- `Summarized`
- `Needs Attention`

Recommended behavior:

- `Uploaded`: file stored, automation may already have triggered, base ingestion not complete
- `Parsed`: text/layout available
- `Indexed`: searchable / vectorized
- `Ready`: safe for normal platform use
- `Summary Pending`: document is ready, summary still running
- `Summarized`: ready plus AI summary available
- `Needs Attention`: lifecycle failed or needs intervention

This should be modeled once and reused everywhere.

## Plan Of Attack

### Phase 1: Introduce a shared lifecycle model

Create one shared frontend lifecycle adapter and stop duplicating readiness heuristics.

Recommended new module:

- `src/js/utils/document-lifecycle.js`

Responsibilities:

- derive a canonical client-side lifecycle from document fields
- expose:
  - `getDocumentLifecycle(doc)`
  - `getDocumentLifecycleDisplay(doc)`
  - `isDocumentReady(doc)`
  - `isSummaryPending(doc)`
  - `isDocumentActionableInChat(doc)`
- normalize labels, badge classes, and progress copy

Suggested derivation inputs:

- `status`
- `processing_status`
- `processed_at`
- `chunk_count`
- `vector_count`
- `ai_indexed_at`
- `summary`
- `summary_generated_at`
- `summary_method`
- `metadata.ingestion_stage`
- `metadata.parser_provenance`

Why first:

- this prevents more one-off lifecycle logic from being added in different surfaces
- every UI phase below becomes much smaller if this is done first

### Phase 2: Upgrade matter/workspace document surfaces

Primary files:

- `src/js/workspace-details.js`
- any related document list partials / helpers

Changes:

- replace local lifecycle helpers with the shared lifecycle module
- show richer badges and progress copy
- explicitly show when a document is `Ready` but `Summary Pending`
- allow document actions based on readiness, not just coarse status
- preserve current upload and paging behavior

Recommended UX:

- list row badge: lifecycle state
- sublabel: short explanation like:
  - `Text and layout extracted`
  - `Indexed for AI search`
  - `Ready, summary still generating`
  - `Summary available`

### Phase 3: Upgrade file viewer and metadata surfaces

Primary files:

- `src/js/file-viewer-page.js`
- `src/js/components/document-metadata-viewer.js`
- `src/js/utils/metadata-formatter.js`

Changes:

- show lifecycle explicitly in metadata
- add fields for:
  - parser provenance
  - indexed timestamp
  - summary status
  - summary method
  - ingestion stage
- stop hiding summary entirely when it is not present; instead show:
  - `Summary pending`
  - `Summary unavailable`
  - `Summary ready`
- widen auto-refresh logic so it refreshes while lifecycle is not terminal, not only while `processing_status === 'processing'`

Recommended viewer behavior:

- top-level status chip
- “AI Readiness” section
- “Summary” section with three states:
  - pending
  - generated
  - failed/unavailable

### Phase 4: Replace the old JIT processing mental model in chat

Primary files:

- `src/js/services/document-processing.service.js`
- `src/js/lex/chat/lex-chat.js`
- `src/js/chat_v2.js`
- `src/js/file-drawer.js`
- `src/js/chat_v2.file-drawer.js`
- `src/js/api.js`

Current issue:

Chat still assumes documents may need to be explicitly “processed” on mention or activation. That is the wrong primary model now that ingestion is canonical and automatic.

Recommended direction:

- keep a compatibility layer initially
- rename the client service from “processing” semantics to “lifecycle readiness” semantics
- phase out user-facing JIT messaging like:
  - `Document "X" processed and ready`

Replace with:

- `Document "X" is still being prepared`
- `Document "X" is ready for AI`
- `Document "X" is ready; summary is still generating`

Implementation approach:

1. Introduce a new service wrapper:
   - `document-lifecycle.service.js`
2. Let it read readiness from the canonical processing-status endpoint initially
3. Update chat callers to use readiness semantics instead of extraction semantics
4. Deprecate `DocumentProcessingService`
5. After backend cleanup, either:
   - replace the old endpoints with lifecycle-aware ones, or
   - change the existing endpoint payload to lifecycle language

Important product rule:

Chat should only require `Ready`, not `Summarized`.

### Phase 5: Update event-picking and automation UI

Primary files:

- `src/js/skills.js`
- `src/js/matter-skills.js`
- `src/js/skill-builder.js`

Changes:

- add the new document lifecycle events everywhere they are user-selectable:
  - `document.parsed`
  - `document.indexed`
  - `document.summarized`
  - `document.ready`
- update descriptions so they reflect the new pipeline
- keep `document.processed` temporarily only if still needed for backward compatibility

Recommendation:

- mark `document.processed` as legacy/deprecated in the UI once the rest of the ecosystem is updated

## API / Contract Work Needed

### Immediate client-safe path

The client can ship Phase 1-3 without waiting on new APIs by deriving lifecycle from fields already returned on document payloads.

### Near-term backend follow-up

These endpoints are now semantically stale and should be aligned:

- `GET /api/v1/storage/:id/extraction-status`
- `POST /api/v1/storage/:id/trigger-processing`
- `GET /api/v1/storage/:id/processing-status`

Why:

- they still describe the world as extraction-only or on-demand processing
- the canonical backend pipeline is now lifecycle-based

Recommended backend contract target:

- `GET /api/v1/storage/:id/lifecycle-status`

Suggested payload:

- `stage`
- `ready`
- `summary_pending`
- `summary_available`
- `failed`
- `parser_provenance`
- `chunk_count`
- `vector_count`
- `ai_indexed_at`
- `summary_generated_at`

The client can begin without this endpoint, but it should be the target state.

## Implementation Order

Recommended execution order:

1. Build shared lifecycle utility
2. Wire workspace document list to it
3. Wire file viewer and metadata viewer to it
4. Update Chat V2 drawer to readiness semantics
5. Update legacy file drawer and legacy chat
6. Update API/service naming and compatibility wrappers
7. Update skill-builder / matter-skills event pickers
8. Remove duplicated lifecycle helpers and dead JIT messaging

## Testing Plan

### Unit / local UI tests

- lifecycle derivation tests for:
  - uploaded only
  - parsed only
  - indexed only
  - ready without summary
  - summarized
  - failed
- formatter tests for lifecycle labels and metadata display

### Manual product validation

1. Upload a document and verify:
   - workspace row shows `Uploaded`
2. After parse/index:
   - row progresses to `Ready` or `Summary Pending`
3. Open file viewer before summary completes:
   - file is usable
   - summary section says `pending`
4. After summary completes:
   - summary section updates
   - lifecycle reflects summarized state where appropriate
5. In chat:
   - ready docs are attachable
   - non-ready docs show clear pending language
6. In skills/matter-skills:
   - new lifecycle events are selectable

### Regression checks

- matter document uploads still work
- file download/view still works
- chat document activation still works
- no UI depends on `text_extracted` as a special user-facing state

## Risks

- There are multiple old chat/document surfaces in the client, not one.
- If only one surface is updated, lifecycle language will diverge again.
- If the client keeps exposing “process document” language while the backend auto-ingests everything, users will get contradictory mental models.
- If `document.processed` remains first-class everywhere, teams will keep building against the legacy event instead of the new lifecycle events.

## Recommendation

Do this as a focused lifecycle-standardization pass, not as scattered UI tweaks.

The right implementation shape is:

- one shared lifecycle model
- one pass across document surfaces
- one cleanup of chat/document readiness semantics
- one event-picker update for skills/automations

That keeps `lana-client` aligned with the backend architecture you just established instead of preserving the old split-pipeline assumptions in the UI.

## Proposed Deliverable Breakdown

### Wave 1

- shared lifecycle utility
- workspace details document list
- file viewer summary/lifecycle display
- metadata viewer lifecycle refresh

### Wave 2

- chat file drawer
- legacy file drawer
- `DocumentProcessingService` replacement / compatibility wrapper
- readiness messaging cleanup

### Wave 3

- skill-builder event catalog update
- matter-skills event catalog update
- legacy event deprecation copy

## Success Criteria

The client is done when:

- every document surface shows the same lifecycle language
- `Ready` and `Summary Pending` are distinct in the UI
- chat uses readiness semantics, not extraction semantics
- skill/automation builders expose the new lifecycle events
- the frontend no longer depends conceptually on multiple document pipelines
