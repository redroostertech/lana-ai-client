# Claude.md

Guidance for agents working in **`lana-ai-client`**, the **Electron** desktop app (renderer + shell). For full-stack or cross-package context, read the workspace root **`../Claude.md`**. Backend-only rules live in **`../LANA-AI/CLAUDE.md`** and **`../LANA-AI/ARCHITECTURE.md`**.

---

## Relationship to `LANA-AI`

| Package | Role |
|---------|------|
| **`LANA-AI/`** | Backend and platform: authoritative business logic, auth, APIs, persistence. **System of record.** |
| **`lana-ai-client/`** (this repo) | Client: UI, local integration, and thin application wiring. **Not** the place for complex domain rules that belong on the server. |

The client is built for **multi-platform** distribution like the backend; keep configuration env-driven and paths portable.

When a workflow needs the **backend API or workers recycled** after server-side changes, prefer telling operators to run **`lana restart`** from the **Lana CLI** ([`../LANA-AI/infra/lana-ctl.js`](../LANA-AI/infra/lana-ctl.js)) rather than ad-hoc **`pm2`** commands. See **`../LANA-AI/CLAUDE.md`** for context.

---

## Thin client, clean payloads

- Treat the renderer as **presentation-first**. The backend API is the **first line of defense**; the client should receive **stable, purpose-shaped** payloads and focus on rendering and light adaptation.
- The **application layer** here is for orchestration, **mapping** DTOs to view needs, and combining data when **multiple** services or sources are involved—not for re-implementing backend validation or business rules.
- Security- and business-critical rules must be enforced in **`LANA-AI`**, not only in the client.

---

## Lex UI and front-end structure

- **All product UI should use the Lex UI framework** under `src/js/lex/`. Authoritative reference: **`src/js/lex/LEX-COMPONENT-RULES.md`**.
- **No inline styles** for product UI; use **dedicated CSS files** (alongside the feature or page, following existing layout conventions).
- **Page hygiene:** each standalone HTML page should have a **corresponding `.js` and `.css` file** so HTML stays structural only—markup, behavior, and presentation stay separated.

---

## Reuse before adding code

1. Search **`src/js/lex/`**, **`src/js/`**, and existing HTML/CSS pairs for the same pattern or component.
2. If the change depends on new server behavior or contracts, check **`../LANA-AI`** for an existing route, service, or DTO before inventing parallel client-only logic.
3. Prefer **extending** shared client modules and Lex primitives over duplicating markup or helpers.

---

## Testing

Stack: **Jest** (see `package.json` scripts). Typical commands from the client root:

- `npm run test:unit` — `tests/unit/`
- `npm run test:integration` — `tests/integration/`
- `npm run test:validation` — `tests/validation/`
- `npm run test:coverage` / `npm run test:ci` — coverage and CI-style runs

**Strategy**

- Prefer **unit tests** for pure JS: validators, token/citation helpers, mappers, security-sensitive string handling, and anything extracted from the renderer.
- Use **integration** tests when several modules or async flows must work together without spinning the full Electron UI.
- **Lex / Web Components / large DOM** — avoid duplicating the whole UI in Jest; keep components thin, move logic into **plain modules** under `src/js/`, and test those modules directly (see existing tests under `tests/unit/` for patterns).

**Hitting the LANA API (contract smoke)**

- When verifying endpoints against **`LANA-AI`**, follow that repo’s preference: **`curl`** plus **`../LANA-AI/scripts/dev/get-token.sh`** for JWT-backed routes (`Authorization: Bearer $TOKEN`). Details: **`../LANA-AI/CLAUDE.md`**.
- This package may still ship **Newman** helpers under **`tests/run-api-tests.sh`** / **`tests/README.md`** for optional scripted suites; they do not replace **`LANA-AI`**’s **`curl`** + **`get-token.sh`** workflow for day-to-day API checks in the backend repo.

When fixing a bug, add a **regression test** at the lowest layer that would have caught it.

---

## Quick checklist

- [ ] Could this logic live in **`LANA-AI`** instead? If yes, put it there.
- [ ] UI built with **Lex** and **external CSS** (no inline styling)?
- [ ] New page has matching **`.js` + `.css`**?
- [ ] Confirmed no existing Lex component or module already covers this?
- [ ] **Tests** added or updated (`test:unit` / `test:integration` / `test:validation` as appropriate)?
