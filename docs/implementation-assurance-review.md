# Implementation assurance review surface

**Status:** bounded review candidate; live application validation pending
**Last updated:** 2026-10-30
**Applies to:** lana-estate-assurance-ui client; implementation-assurance backend API

This bounded client page consumes the implementation-assurance API. Open a matter's menu and choose **Implementation assurance**. It lists reported assets and existing accepted targets, requests a server assessment, and records a qualified professional's explicit decision with rationale. The server owns access, evidence eligibility, conclusions, immutable references, acceptance, and idempotency.

The client shows unknown, conflict, difference, and match separately. Only a match offers acceptance of the conclusion; other outcomes offer exception acceptance or rejection. An exception does not become a match. A stale assessment returns 409 and requires a fresh review. Missing/disabled APIs return an unavailable view rather than implying an empty inventory.

Pending decision commands are saved before dispatch to sessionStorage, scoped to API server, organization, authenticated user, and matter. Refresh or SPA navigation in the same tab restores the exact request ID and a retry-only form. Network failures, authentication loss, timeouts, and rate limits preserve it. No automatic retry or new decision occurs. Storage failure makes decision submission unavailable. This is same-tab recovery, not cross-device or browser-close recovery. The server still verifies every replay's access and exact request binding.

## Bounded scope

This is a review surface for records already created through the backend service. It does not provide plan onboarding, protocol publication, target authoring, evidence observation/review, grant administration, or a document-selection viewer. Source references are displayed as IDs, versions, and hashes; the existing matter documents view is linked for inspection. A complete firm onboarding and evidence-review workflow remains separate work. The menu is discoverable on older servers but the page reports unavailable there.

## Verification

Run the focused transport/state tests:

```sh
npx jest tests/unit/assurance/implementation-assurance-client.test.js --runInBand --coverage=false
```

A synthetic browser fixture runs the actual Lex controls and page controller without a live API. It checks stale rejection, mismatch decision options, repeated timeout recovery across refresh, and disabled-server behavior, and writes wide/narrow screenshots under `/tmp`:

```sh
node tests/browser/implementation-assurance.fixture.cjs
# If Playwright Chromium is not installed, provide an installed Chrome binary:
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node tests/browser/implementation-assurance.fixture.cjs
```

These checks do not establish authenticated live API, Electron packaging, or complete estate workflow sign-off.
