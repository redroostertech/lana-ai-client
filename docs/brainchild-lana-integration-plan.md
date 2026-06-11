# Brainchild ↔ Lana Integration — Build Plan

**Status:** Draft for review (joint review + `/codex`, then implementation)
**Last updated:** 2026-06-09
**Scope:** spans `lana-ai-client` (primary, near-term), `LANA-AI` (backend, protocol), `brainchild` (bridge source)

---

## 1. Goal & product shape (recap)

Brainchild stays a **separate app with its own surface**, going public, **not** enterprise. It integrates with Lana through a **compatible ecosystem contract**, not a shared runtime.

In the **Lana client**, a new **"Brainchild" app entry** in the app dropdown opens a **consolidated, shared-drive-style docs surface** with two scopes:

- **Org** — org/matter-scoped documents, **authored natively in the client** (this is existing doc-studio, re-framed — *not* a new wiki).
- **My** — the user's personal knowledge, **read over the loopback bridge from the separate, locally-running brainchild app** (authoring stays in brainchild).

A **My** doc can be **promoted to Org** — but only when lana-ai is present/linked.

### Principles
- **Lana stays the lean backbone.** Org authoring already lives in doc-studio; we consolidate, not rebuild.
- **Compatibility = interop, not shared UI.** The shared layer is (1) the auth protocol, (2) the knowledge data model + MCP vocabulary, (3) the promote/grounding protocol.
- **Private by default, opt-in promote.**
- Org knowledge is **authoritative in LANA-AI** (system of record).

---

## 2. Current foundations (verified 2026-06-09)

| Concern | Exists | File |
|---|---|---|
| App registry / dropdown | ✅ keyed catalog; apps gated on org `enabled_apps` → `lana_saved_server.enabledApps` → sidebar | `src/js/app-catalog.js`, `src/js/lex/components/layout/lex-sidebar.js` |
| Consolidated doc Library | ✅ merges deck-studio presentations + `/api/v1/storage/documents` into one table | `src/doc-studio/app.js` — `libraryItems()` (~L1965), `loadLibrary()` (~L2106) |
| Org doc authoring | ✅ doc-studio creates org/matter-scoped docs, decks, signatures (stored in LANA-AI) | `src/doc-studio/app.js` |
| File viewing | ✅ standalone viewer surface | `src/file-viewer.html`, `src/js/file-viewer-page.js` |
| Loopback bridge | ⚠️ reactive only — `lana-brain` in `KNOWN_APPS`, `/lana-bridge/companion/request-token`, `/lana-bridge/health` (port 7890). **No vault read.** | `electron-bridge.js`, `electron-main.js` (~L1255) |
| Brainchild vault read | ❌ none (doc-studio "brainchild" refs are demo prompt text only) | — |
| Protocol auth (`app` claim, route allowlist, audit) | ❌ drafted, unwired | `../brainchild/LANA-AI-PROTOCOL.md` |
| Org knowledge / RAG (server) | ✅ `documents` / `document_chunks` / pgvector, embedding worker, connectors | `../LANA-AI/src/...` |

**Takeaway:** the launcher + consolidation mechanics are largely built. The genuinely new work is (a) the client→brainchild **vault read**, and (b) the **promote + protocol auth** finish.

---

## 3. Phased slices

### Slice A — "Brainchild" surface + scope-aware Library *(client only; ships without brainchild)*

De-risks everything: shippable with zero brainchild dependency.

- **A1** Add `brainchild` entry to `src/js/app-catalog.js` (id, label, description, route, colors) + alias. Gate on org `enabled_apps`.
- **A2** Surface page. *Decision (§5.1):* dedicated `brainchild.html` + `brainchild.js` + `brainchild.css` (page hygiene), reusing doc-studio's Library **data layer** — vs. extending doc-studio in place.
- **A3** Lex **My / Org scope toggle**. Org → existing endpoints. My → stubbed "connect brainchild" empty state.
- **A4** Unit-test the row-mapper with the new scope dimension (pure JS).

**DoD:** Brainchild app appears in the dropdown (when enabled), opens the consolidated view, Org shows real docs, My shows the connect state.

### Slice B — Bridge to local brainchild vault *(client + brainchild)*

The real new integration.

- **B0** **Pin the brainchild HTTP port** — resolve 3737 (brainchild docs) vs 7891 (client preload) vs 7890 (bridge). Document the read contract.
- **B1** **Detection + degraded UX** — health-check the local brainchild instance (`LANA_BRAIN_READY`); show install/launch prompt when absent.
- **B2** **Read path** — client calls brainchild's loopback API (`list_notes` / `search` / `get_note`, per `MCP.md` / brainchild HTTP API) to list the user's notes.
- **B3** **Map** brainchild notes → Library row view-model (`_kind: 'brainchild'`, vault path, updated_at); merge as the third source under **My**.
- **B4** **Open** a note: read-only preview in file-viewer + **"Open in Brainchild"** deep-link for editing (authoring stays in brainchild). *(Decision §5.3.)*
- **B5** Tests: mapper unit tests; bridge integration test with a stubbed brainchild.

**DoD:** with brainchild running, My lists real vault notes; clicking previews / deep-links to brainchild. With it stopped, graceful degraded state.

### Slice C — Promote My → Org + protocol auth finish *(client + LANA-AI + brainchild)*

- **C1 (LANA-AI backend)** Finish protocol: auth middleware reads `app` claim; route-level `allowed_apps`; default-deny undeclared routes; audit `(user, app, route)`. Add the **receiving endpoint** for promoted knowledge, org-scoped, following route → controller → service → repository. Feed into existing RAG ingestion.
- **C2 (Lana client)** Token issuance with `app` claim + **revoke** endpoint in `electron-bridge.js`.
- **C3 (Promote action)** Library row action **"Promote to Org"** — pushes a brainchild note to the LANA-AI org-knowledge endpoint with **org ownership**; enabled only when linked. *(Ownership semantics — copy vs move, who may promote, approval — §5.4.)*
- **C4 (brainchild)** `[[lana:matter/<id>]]` wikilink resolver + push-to-matter UX. *(May defer — §5.5.)*
- **C5** Tests: backend **service + repository first**, plus a route/integration test for the new contract; client unit for the promote mapper.

**DoD:** a user promotes a personal note → it lands org-scoped, RAG-available, audited; undeclared apps are denied.

### Slice D — Org-doc grounding + connector ingestion *(later / complementary)*

- Ensure promoted + doc-studio org docs feed existing `document_chunks`/embedding RAG so they ground chat.
- Connector ingestion of existing Drive/SharePoint as a complementary org-doc source.

---

## 4. Sequencing & dependencies

```
A (independent — ship first)
└─> B (needs: pinned port + brainchild read API)
    └─> C (needs: B + LANA-AI protocol auth)
        └─> D (grounding/ingestion — later)
```

Cross-cutting (all slices): Lex UI + external CSS, **page hygiene** (.html/.js/.css triples); tests per layer (CLAUDE.md); backend restarts via `lana restart`; org knowledge authoritative in LANA-AI.

---

## 5. Open decisions to resolve in review

1. **Surface page:** dedicated `brainchild.*` page reusing the Library data layer, **vs.** extend doc-studio Library in place. *(Lean leans dedicated page, shared data layer.)*
2. **Brainchild port contract:** which port + which API surface (HTTP vs MCP-over-HTTP) the client reads.
3. **User-doc editing:** read-only preview + deep-link to brainchild **vs.** in-client editing. *(Lean: read-only + deep-link; keep authoring in brainchild.)*
4. **Promote semantics:** copy vs move; who may promote; approval/governance step; ownership transfer to org.
5. **Brainchild-side scope in C:** build the wikilink resolver / push-to-matter now, or defer to a later slice.

---

## 6. Notes for `/codex` review

Pressure-test specifically: the **A2/§5.1** page decision (reuse vs new), the **bridge security model** (client reading a loopback vault — consent, what's exposed), **promote governance** (§5.4), and whether **Slice A is truly independent** of brainchild. Flag any place we're duplicating an existing module rather than extending it.
