# Review service consolidation plan

Branch: review-service-consolidation. Scope: consolidate annotation and review
UI logic that was written twice (once in src/js/file-viewer-page.js, once in
src/js/file-editor.js) into src/js/services/document-review-api.service.js,
which both pages already load. This file records what was actually found by
reading both page files in full, since the original audit's line numbers were
not trusted.

## Duplicated pairs: what was actually found

1. **annotationLabel** (CONFIRMED duplicated, fixed).
   file-viewer-page.js already calls the shared `LanaDocumentReview.annotationLabel(thread)`.
   file-editor.js instead recomputes the same three-way mapping locally as a
   `kindLabel` variable inside its comment-thread renderer:
   `kind === 'highlight' ? 'Highlight' : kind === 'redline' ? 'Suggested change' : 'Comment'`.
   This is an exact match for the service's existing `annotationLabel`.
   Fix: file-editor.js now calls `documentReviewService().annotationLabel(comment)`
   instead of keeping its own copy.
   Pinned by: tests/unit/file-editor-live-flow.test.js line 607 (source-contract
   string match on the old `kindLabel` line) - updated to match the new call.

2. **Locate/focus-and-pulse** (CONFIRMED duplicated, fixed).
   `focusReviewAnnotationCard` (file-viewer-page.js) and `focusServerReviewComment`
   (file-editor.js) do the identical thing: find the card by a data attribute,
   scroll it into view, add `is-located` for ~1.6s. They differ only in (a)
   which attribute identifies the card (`data-review-annotation-id` vs
   `data-comment-thread-id`) and (b) how the host page switches to the
   Comments tab first (`setReviewTab('comments')` vs `reviewRailTab = 'comments'; renderReviewDock(file)`).
   Both also sanitize the id with the same `.replace(/["\\]/g, '')`, which
   violates the project's no-regex rule.
   Fix: added `LanaDocumentReview.focusAnnotationCardInDom(options)` - a small
   DOM utility (`annotationId`, `attribute`, `activateTab` callback, optional
   injectable `document` for testing, optional `pulseMs`). Sanitizes the id
   without regex (`split('"').join('').split('\\').join('')`). Both page
   functions are now thin wrappers that pass their own attribute name and
   tab-activation callback.
   No existing test pinned the old function bodies by string match, so no
   page test needed updating for the call sites themselves; a real unit test
   was added in document-review-api.service.test.js.

3. **Annotation thread "Open/Resolved" status label and tone** (CONFIRMED
   duplicated, fixed). Both pages compute
   `String(thread.status || 'open').toLowerCase() === 'resolved' ? 'Resolved' : 'Open'`
   and map it to the same tone strings (`'release'` for Resolved, `'draft'`
   for Open) for their status badge. This is part of the "card markup...kind
   badge" duplication named in the task, scoped to the status half of the
   badge (the kind half is item 1, `annotationLabel`).
   Fix: added `LanaDocumentReview.annotationStatusLabel(thread)` returning
   `{ label, tone, resolved }`. Both pages now source the label/tone from it;
   the surrounding badge markup (`renderReviewStatusBadge` on the viewer, a
   raw `<span>` on the editor) is untouched since neither is duplicated with
   the other (different CSS class families, and `renderReviewStatusBadge` is
   also reused for unrelated change-history rows on the viewer, which must
   not change).

4. **Annotation author fallback** (CONFIRMED duplicated, small, fixed).
   Both pages inline `thread.author || 'Reviewer'` / `comment.author || 'Reviewer'`
   at their card's author line. Fix: added
   `LanaDocumentReview.annotationAuthorLabel(thread)`; both pages call it.
   This is also the function covered by the "a thread with no author" control
   arm requested for testing.

5. **reviewVersionSelectOptions** (CONFIRMED page-local, moved as requested).
   Was a file-viewer-page.js-only function reading `state` directly, tested
   only through source-contract string matches in
   tests/unit/file-viewer-review-ux.test.js and
   tests/unit/file-viewer-conversion-wait.test.js. Moved the pure
   option-building logic to `LanaDocumentReview.reviewVersionSelectOptions(input)`,
   taking explicit data (`conversionSource`, `editableCopies`,
   `hasCurrentDraftChanges`, `pendingRelease`, `releases`, and the two date
   formatter callbacks `formatCopyMoment`/`formatDate`, since those formatters
   themselves stay page-local - see divergence note below). file-viewer-page.js
   keeps a same-named wrapper `reviewVersionSelectOptions()` that gathers the
   inputs from `state` and delegates, so the several tests that assert
   `toContain('function reviewVersionSelectOptions')` (a legitimate,
   still-true assertion) keep passing.
   Test updates: the source-contract assertions that pinned the *contents* of
   the option list (the literal `value:`/`label:`/`group:` strings) moved from
   checking `pageJs` to checking the service source or, better, became real
   `LanaDocumentReview.reviewVersionSelectOptions(...)` unit tests including
   control arms: an empty `releases` list, no `conversionSource`, and the
   `pendingRelease` vs `hasCurrentDraftChanges` description branches.

6. **Highlight colour filter/list** - investigated, **NOT duplicated**.
   file-editor.js has `renderHighlightPicker()`, which builds a row of colour
   swatch buttons sourced from the already-shared `LanaDocumentReview.HIGHLIGHT_COLORS`.
   file-viewer-page.js has no colour picker at all - grepped for `HIGHLIGHT_COLORS`,
   `colors.map`, and any swatch-list construction; found none. The viewer only
   ever displays a single computed swatch colour per annotation, already via
   the shared `LanaDocumentReview.annotationColor`. Since the *data* is already
   shared and the *picker UI* exists in exactly one file, there is nothing to
   consolidate here. Left untouched.

7. **pollEnrichmentUntilDone and the PDF-conversion-wait polling loop** -
   investigated, **NOT duplicated, single-owner**. Grepped file-editor.js for
   `enrichment`/`Enrichment`/`waitForConvertedCopy`/`ConvertedCopy`/`conversion`:
   file-editor.js has no enrichment feature and no PDF-conversion-wait polling
   at all (Insights and PDF-to-DOCX conversion are File-Viewer-only features).
   Both loops live only in file-viewer-page.js. Left untouched, per the
   instruction to only touch what is actually duplicated.

8. **Annotation thread card markup as a whole** (author, date, body, kind
   badge, colour swatch, resolve/delete controls) - investigated in full.
   Genuinely-shared pieces (kind label, status label/tone, colour value,
   author fallback) are now sourced from the service (items 1, 3, 4 above).
   The rest is **not** safely mergeable without a behavior change:
   - The action buttons differ in capability, not just markup: file-editor.js
     supports Reply, Resolve/Reopen and Delete; file-viewer-page.js supports
     only Delete plus click-to-locate. Unifying them would mean either adding
     Resolve/Reply to the viewer or removing them from the editor - a feature
     change outside a consolidation pass.
   - The two cards use different CSS class families
     (`file-viewer-review-item*` vs `office-review-comment-thread*` /
     `office-review-history-row*`), each pinned by existing tests
     (tests/unit/file-viewer-review-ux.test.js and
     tests/unit/file-editor-live-flow.test.js check exact class/attribute
     strings such as `data-review-annotation-delete="`, `data-action="delete-review-comment"`,
     `.office-review-comment-thread.is-located`). Rebuilding both cards from
     one shared HTML template would require rewriting both stylesheets and
     both event-delegation contracts - a materially larger, riskier change
     than the task asked for.
   - The "quote/scope" line reads differently by design: the viewer shows the
     raw quote or "Page N"; the editor shows "Selection: "..."", "Page N", or
     "Document comment". This is an existing, intentional divergence, not
     something to silently merge.
   - The editor renders the *full reply list*; the viewer renders only a
     *reply count*. Different enough that a shared renderer would need a
     capability flag with no test coverage requested for it.
   Conclusion: the duplicated *logic* (what a kind badge says, what a status
   badge says, what colour a highlight is, what "no author" defaults to) is
   now single-owner in the service. The duplicated *markup shell* around that
   logic stays page-local because it is not actually identical between the
   two pages and forcing it to be identical is a larger redesign than asked.

## The three smaller fixes

### 1. Insights/Annotate raw HTML -> Lex elements

Grepped for the exact selectors named in the task
(`span.__badge`, `button.file-viewer-review-action`, `div.file-viewer-review-empty`)
across src/js. All three exist **only** in
src/js/services/document-enrichment.service.js (the Insights panel's
`renderPanelHtml`/`renderSuggestion`), never in
src/js/services/document-review-api.service.js. There is no separate
"Annotate controls" raw-HTML builder anywhere in the codebase to convert -
the annotation card markup that stayed page-local (see pair 8 above) is not
built by document-review-api.service.js and was deliberately left alone for
the reasons in pair 8. Given the concrete selectors the audit named all point
at document-enrichment.service.js, that is the file this fix targets.

Converted, keeping `viewModel()` (data) and `renderPanelHtml()` (markup)
exactly as separated as they already were:
- `span.file-viewer-insights__badge` (the suggestion's target-kind pill) ->
  `<lex-badge label="..." color="indigo" size="sm">`.
- `button.file-viewer-review-action` (Accept/Dismiss/Read again/Read this
  document) -> `<lex-btn type="button" variant="..." size="sm" data-enrichment-action="..." data-suggestion-id="...">`,
  keeping the exact `data-enrichment-action="X" data-suggestion-id="Y"`
  attribute adjacency the tests pin, and keeping the click-delegation
  contract in file-viewer-page.js untouched (`.closest('[data-enrichment-action]')`
  still matches, since Lex components are light-DOM).
- `div.file-viewer-review-empty` (three empty/off/no-results states) ->
  `<lex-empty size="compact" message="..." description="...">`. The
  "Read this document" rerun action stays as an adjacent `<lex-btn>` (not
  `lex-empty`'s own `action-label`/`action` event) so the existing
  `data-enrichment-action="rerun"` delegation keeps working unchanged.
- Added `<script src="js/lex/components/foundation/lex-badge.js">` to
  src/file-viewer.html (lex-btn.js and lex-empty.js were already loaded
  there). file-editor.html was not touched: enrichment/Insights is a
  File-Viewer-only feature (confirmed by pair 7's grep), so it never loads
  document-enrichment.service.js and needs no new script tag.
- The CSS classes (`.file-viewer-insights__badge`, `.file-viewer-review-action`,
  `.file-viewer-review-empty`) are left in src/css/file-viewer.css untouched
  even though the JS no longer emits them, because
  tests/unit/file-viewer-insights.test.js asserts the CSS source still
  defines `.file-viewer-insights__badge {` - that check is about the
  stylesheet's own text, not about what the JS renders, so leaving the rule
  in place (now unused) keeps that test meaningful and green without a
  stylesheet edit that wasn't asked for.
- `escapeHtml`/`confidenceLabel` in this file are covered under fix 3, not
  fix 1.

### 2. Dead branches

- **Bare `'editable-copy'` string branch** (file-viewer-page.js,
  `openReviewVersionFromSelect`): confirmed dead by grep. Before commit
  f7ff696 (same day, immediately preceding this branch's base) the Display
  picker's producer emitted a bare `'editable-copy'` value; that commit
  changed the producer to always emit `'editable-copy:' + id` but left the
  bare-string check in the consumer as a compatibility branch. Grepped the
  entire src/ and tests/ tree for `'editable-copy'` (no colon): the only
  two hits are the dead check itself and the test that pins its literal
  text. Traced every call site of `openReviewVersionFromSelect` (the select's
  own `lex-change` handler, and two hardcoded call sites passing `'original'`
  or `reviewVersionSelectValueForRelease(...)`) - none can produce a bare
  `'editable-copy'` value, and nothing persists/deep-links a stale value
  either. Removed the `value === 'editable-copy' ||` half of the condition
  and the now-unreachable `editableCopyForCurrentFile()` fallback inside that
  branch (the function itself stays, since it has two other live callers).
  Updated the pinned assertion in
  tests/unit/file-viewer-conversion-wait.test.js accordingly.

- **window.prompt fallback for the comment/redline composer**: confirmed
  dead. Both src/file-viewer.html and src/file-editor.html load
  `js/lex/components/foundation/lex-modal.js` unconditionally via a plain
  `<script>` tag, and in both files it loads *before* the page's own script
  (file-viewer-page.js / file-editor.js). `Lex.Modal.open` is a static method
  assigned unconditionally at module load (`window.Lex.Modal = LexModal`),
  with no feature gate. So every `if (window.Lex && Lex.Modal && typeof Lex.Modal.open === 'function') { ... } else { window.prompt(...) }`
  guard in both files is dead on the `else` side in the app's real runtime.
  Removed the dead `window.prompt` fallback (and the now-unnecessary
  guard, since the modal path is unconditional) from every comment/redline
  composer that had this exact pattern:
  - file-viewer-page.js: `promptViewerAnnotationText` (the comment/highlight/
    redline composer) and `confirmReviewHistoryChangeEdit` (the redline
    "Edit Draft Change" composer) - same pattern, same reachability proof.
  - file-editor.js: `promptAddServerReviewComment`, `promptReplyServerReviewComment`,
    and `promptEditServerReviewChange` - same pattern, same proof.
  Left untouched: the several *unguarded* `window.prompt ? window.prompt(...) : ''`
  call sites elsewhere in file-editor.js (collaborator search, signature
  consent, link URLs). Those aren't gated on `Lex.Modal` at all - they're a
  defensive check on `window.prompt` itself existing as a browser API, which
  is a different, still-live concern, and outside what this fix asked about.
  Also left `window.confirm` fallbacks alone (not part of the ask, and
  `window.confirm` isn't provided by Lex, so it isn't dead the same way).
  No test pinned the removed `window.prompt(...)` lines by their exact text
  (checked with a repo-wide grep first), so no page test needed updating for
  this fix beyond what pair 1/3/4 already touch in the same functions.

### 3. escapeHtml (and confidenceLabel/formatCopyMoment) duplication

- Added the module.exports guard to src/js/lex/lex.utils.js: after building
  `global.Lex.Utils = {...}`, added
  `if (typeof module !== 'undefined' && module.exports) module.exports = global.Lex.Utils;`
  - the smallest possible addition, nothing else in the file changed. (Note:
  this file still assumes `window`/`LanaTime` exist at load time, same as
  before; the guard only fixes the "no module.exports" half of the problem,
  which is what was asked. It does not make this file requireable standalone
  in a bare Node process with no globals set up, and nothing in this task
  needed that.)
- `document-enrichment.service.js`, `file-viewer-page.js`: their local
  `escapeHtml` now delegates to `Lex.Utils.escapeHtml` when it is present,
  falling back to the existing local character-loop implementation
  otherwise. file-viewer-page.js's fallback already matched
  `Lex.Utils.escapeHtml` byte-for-byte (`&#039;` for the apostrophe), so this
  is a pure behavior-preserving change there. document-enrichment.service.js's
  own fallback previously encoded the apostrophe as `&#39;` (no leading
  zero) instead of `Lex.Utils`'s `&#039;`; both render as the same character
  in a browser, but the exact escaped string differs when `Lex` is loaded.
  Grepped tests for `&#39;`/`&#039;` assertions tied to this file: none
  exist, so this is safe. document-enrichment.service.js is required and
  executed directly by tests with no `window`/`Lex` set up, so it keeps a
  Node-safe local fallback (guarded with `typeof Lex !== 'undefined'`, never
  a bare `window.Lex` reference, which would throw in Node).
  file-editor.js's `esc()` already did exactly this delegate-with-fallback
  pattern before this change (`if (window.Lex && Lex.Utils && Lex.Utils.escapeHtml) return Lex.Utils.escapeHtml(value);`),
  so it needed no change.
- `confidenceLabel` (document-enrichment.service.js only - no other file has
  its own copy): checked Lex.Utils for an equivalent. There isn't one
  (Lex.Utils has date/size/text formatters but nothing that buckets a 0-1
  confidence score into High/Medium/Low). Left as-is; documented here rather
  than forcing a delegation that doesn't exist.
- `formatCopyMoment` (file-viewer-page.js only - no other file has its own
  copy): compared against `Lex.Utils.formatDateTime`. These diverge in two
  ways: (1) format shape - `formatCopyMoment` renders
  `"Sep 25, 2026, 3:45 PM"` (`toLocaleString` with `month: 'short'`);
  `Lex.Utils.formatDateTime` renders `"9/25/2026 3:45 PM"` (numeric
  slash-separated date). (2) timezone - `formatCopyMoment` uses the
  browser's local timezone/locale; `Lex.Utils.formatDateTime` is
  organization-timezone-aware. Forcing this to delegate would visibly change
  the Display picker's date text and, for any org whose timezone differs
  from the reviewer's machine, would change which moment is displayed. Left
  as-is per the "do not force a merge that changes behavior" instruction;
  documented here.

## Explicitly out of scope (per the task)

- Server-side validation gaps (anchor validity, suggestion acceptability
  rules, converted-copy name derivation) - chef-side, not touched.
- rich-document-guard.js and matter-documents-grouping.js - not touched
  beyond what direct duplication with the service required (neither needed
  any change; no duplication with them was found).

## Test plan

- New/extended unit tests in tests/unit/document-review-api.service.test.js:
  `annotationStatusLabel` (open, resolved, control arm: missing status
  defaults to open), `annotationAuthorLabel` (present author, control arm:
  no author -> 'Reviewer'), `focusAnnotationCardInDom` (finds and pulses a
  card via an injected fake `document`, control arm: no matching card
  returns false and does not throw, control arm: empty id returns false
  without querying), `reviewVersionSelectOptions` (full lineage with a
  conversion source, multiple editable copies, a pending release, and
  releases; control arm: empty releases list; control arm: no
  conversionSource; control arm: hasCurrentDraftChanges false/true against
  the "current" option's description). Extended `annotationLabel` coverage
  for 'highlight' and the default/'comment' arms (only 'redline' was
  covered before).
- Updated source-contract tests:
  - tests/unit/file-editor-live-flow.test.js: the old `kindLabel` line
    replaced with the new delegating call.
  - tests/unit/file-viewer-review-ux.test.js: the reviewVersionSelectOptions
    content assertions (the literal `value:`/`label:`/`group:` strings) that
    moved out of the page removed/relocated, since that behavior now has
    real unit tests in document-review-api.service.test.js; the assertions
    that are still true of the page (the wrapper function's existence, and
    everything that stayed page-local: `currentReviewVersionSelectValue`,
    `openReviewVersionFromSelect`, `editableCopiesForCurrentFile`, etc.) are
    kept.
  - tests/unit/file-viewer-conversion-wait.test.js: same relocation for the
    duplicate assertions in the "File Viewer document halves" describe
    block, plus the dead-branch string updated to drop
    `value === 'editable-copy' ||`.
- Red-proof method: for each moved/changed behavior, temporarily revert the
  specific line(s) (or comment out the new delegation) to confirm the
  specific new/updated test fails for the expected reason, then restore.
- Run `npx jest tests/unit` in full at the end and report the exact
  before/after counts.
