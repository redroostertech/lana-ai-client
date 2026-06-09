/*
 * brainchild-promote-builder.js
 *
 * Pure, side-effect-free helpers for the Phase C "Promote to Org" flow.
 *
 * The renderer is presentation-only: the only place domain shape is decided on
 * the client is this single pure module, kept testable in isolation (no fetch,
 * no DOM, no localStorage). It turns a normalized brainchild row + the full note
 * body fetched over the MCP bridge + the authenticated user into:
 *
 *   - the org_id that scopes the request URL
 *     POST /api/v1/organizations/:org_id/promoted-knowledge
 *   - the request body the backend validates (matches the backend zod contract
 *     exactly: note_id 1-255, note_title 1-500, note_content 1-100000,
 *     vault optional <=255).
 *
 * AUTHORITY NOTE: org isolation, embedding, chunking, audit, and de-dup are all
 * enforced by the backend (org comes from req.user, NOT this body). The client
 * org_id here is a convenience gate only — the server re-derives it from the JWT.
 *
 * Contract:
 *   resolveOrgId(user)                 -> org id string (throws if absent)
 *   canPromote({ authenticated, user, bridge }) -> bool (gate predicate)
 *   buildPromotePayload(row, note, user) -> { orgId, body } ready for apiFetch
 */
(function (global) {
  'use strict';

  // Backend zod limits (mirror LANA-AI organizations.routes.js promoted-knowledge).
  var LIMITS = {
    NOTE_ID_MAX: 255,
    NOTE_TITLE_MAX: 500,
    NOTE_CONTENT_MAX: 100000,
    VAULT_MAX: 255
  };

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  // Accept either the loadUserProfile shape (organizationId) or a raw API DTO
  // (org_id / organization_id). Pure lookup, no normalization side effects.
  function resolveOrgId(user) {
    if (!user) throw new Error('Missing user');
    var orgId = user.organizationId || user.organization_id || user.org_id || '';
    orgId = typeof orgId === 'string' ? orgId.trim() : String(orgId || '');
    if (!orgId) throw new Error('User not in an organization');
    return orgId;
  }

  function resolveUserId(user) {
    if (!user) return '';
    var id = user.id || user.user_id || '';
    return typeof id === 'string' ? id : String(id || '');
  }

  // Clamp PROVENANCE fields (note_id / note_title / vault) without throwing: a
  // path or title slightly over the backend max is a cosmetic concern and the
  // backend remains the authoritative size guard. The note BODY is handled
  // separately (see assertContentWithinLimit) — it must NEVER be silently
  // truncated, because losing legal content is worse than a clear error.
  function clamp(value, max) {
    var str = value == null ? '' : String(value);
    return str.length > max ? str.slice(0, max) : str;
  }

  // Hard-fail on an over-long note body. The backend zod contract REJECTS
  // note_content over NOTE_CONTENT_MAX with a 400; silently truncating here
  // would embed a partial legal note into org RAG with the user none the wiser.
  // Fail fast with a clear, surfaceable message instead.
  function assertContentWithinLimit(content) {
    if (content.length > LIMITS.NOTE_CONTENT_MAX) {
      throw new Error(
        'Note is too long to promote (max ' + LIMITS.NOTE_CONTENT_MAX +
        ' characters).'
      );
    }
    return content;
  }

  /*
   * buildPromotePayload(row, note, user)
   *
   * row  : normalized brainchild row from DocumentLibraryMapper.normalizeBrainchildRow
   *        (provides _vaultPath, filename).
   * note : full note object from the MCP bridge getNote() ({ body, frontmatter, ... }).
   * user : the authenticated user (organizationId + id).
   *
   * Returns { orgId, body } where body matches the backend contract. Throws on
   * missing inputs, missing org (org-isolation gate), or empty content (the
   * backend also rejects these — fail fast on the client for clean UX).
   */
  function buildPromotePayload(row, note, user) {
    if (!row) throw new Error('Missing note row');
    if (!note) throw new Error('Missing note body');
    if (!user) throw new Error('Missing user');

    var orgId = resolveOrgId(user);

    var vaultPath = row._vaultPath || '';
    var title = isNonEmptyString(row.filename) ? row.filename.trim() : 'Untitled Note';
    var content = note.body || '';

    if (!isNonEmptyString(content)) {
      throw new Error('Note has no content to promote');
    }

    // note_id identifies the source note for backend de-dup / provenance. The
    // vault path is the stable per-note key; fall back to the title slug only if
    // a path is somehow absent (browser/degraded paths never reach here).
    var noteId = isNonEmptyString(vaultPath) ? vaultPath.trim() : title;

    var body = {
      note_id: clamp(noteId, LIMITS.NOTE_ID_MAX),
      note_title: clamp(title, LIMITS.NOTE_TITLE_MAX),
      note_content: assertContentWithinLimit(content)
    };

    // vault is optional in the contract — only send it when we actually have a
    // path, so we never bind an empty string the backend would have to reject.
    if (isNonEmptyString(vaultPath)) {
      body.vault = clamp(vaultPath.trim(), LIMITS.VAULT_MAX);
    }

    return { orgId: orgId, userId: resolveUserId(user), body: body };
  }

  /*
   * canPromote({ authenticated, user, bridge })
   *
   * Pure gate predicate for whether the "Promote to Org" action should be
   * offered. Promotion requires ALL of:
   *   - an authenticated lana-ai session (authenticated === true)
   *   - a user who belongs to an organization (org isolation precondition)
   *   - the brainchild MCP bridge present (we must read the note body from the
   *     vault; in a plain browser the bridge is null and the action degrades).
   *
   * Kept pure (no window, no api) so the gate is unit-tested directly.
   *
   * NON-AUTHORITATIVE: this gate is CONVENIENCE ONLY. It controls whether the
   * UI offers the action; it does NOT and MUST NOT enforce access. The values
   * it reads (authenticated / user / bridge presence) all originate client-side
   * and are fully attacker-bypassable. The LANA-AI backend is the sole
   * authority: it re-derives organization_id from the JWT, requires the
   * knowledge:promote permission, and rejects cross-org requests. Do NOT start
   * trusting this gate for authorization — keep all enforcement server-side.
   */
  function canPromote(context) {
    var ctx = context || {};
    if (ctx.authenticated !== true) return false;
    if (!ctx.bridge) return false;
    try {
      resolveOrgId(ctx.user);
    } catch (_error) {
      return false;
    }
    return true;
  }

  var api = {
    LIMITS: LIMITS,
    resolveOrgId: resolveOrgId,
    canPromote: canPromote,
    buildPromotePayload: buildPromotePayload
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.BrainchildPromoteBuilder = api;
  }
})(typeof window !== 'undefined' ? window : this);
