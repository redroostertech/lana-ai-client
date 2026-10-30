# Implementation assurance onboarding and review

**Status:** implementation candidate; validation results are recorded below
**Last updated:** 2026-10-30
**Applies to:** `lana-estate-assurance-ui` client and the implementation-assurance Core API

Open a matter's menu and choose **Implementation assurance**. The page guides the existing matter through seven sections. Navigation is presentation state; it does not mark the matter complete.

| Section | What a person can do | Authoritative owner |
|---|---|---|
| Inventory | Create or update a reported asset, including a masked account suffix and reported value | Matter asset service |
| Plan | Select exact retained document releases, inspect them, and explicitly accept a plan version | Assurance service and existing Document Review release owner |
| Targets | Select an accepted plan, published protocol, declared requirement, asset and contact value; accept the intended result | Assurance service |
| Evidence | Record a value with retained sources, dates, coverage and optional page/quote locators; revise or supersede an observation | Assurance service |
| Evidence review | Inspect the recorded value and source versions and record professional review | Assurance service and explicit professional grant |
| Decisions | Request an assessment and explicitly accept, reject or accept an exception against its exact binding | Assurance service |
| Closeout | Prepare and inspect a pinned manifest, acknowledge its recorded scope, accept it, and download the record | Assurance service |

The browser does not qualify evidence, resolve legal rules, infer missing contacts, decide whether implementation succeeded, or manufacture an acceptance. All references come from bounded authorized catalogs. The typed controls support contacts, sets of contacts, and beneficiary allocations without raw JSON fields. Exact sources open in the existing file viewer with page and quote context.

A saved observation is pending review. A system match is separate from a professional decision. An exception does not become a match. Closeout covers **recorded plan requirements only**; accepting it does not establish that every estate obligation was captured or completed. The acknowledgement is explicit and transmitted with the acceptance command.

## Firm prerequisites and existing owners

This is matter onboarding for an existing authenticated firm. A firm administrator must establish access grants and publish professionally approved protocol content through the documented backend/operator process. There are no default legal rules, wildcard professional grants, or grant-administration shortcuts in the client.

An uploaded file alone is not retained evidence. Use the existing Documents and Document Review flow to prepare and release a genuine document version. The assurance page selects and opens those retained versions; it does not create fake review batches or a second document editor. Missing protocol, source, or contact choices are shown explicitly. **Load more choices and records** continues bounded catalogs; an unloaded record is never silently substituted.

Optional agents and maintenance use their existing application owners. This Core page does not instantiate an agent runtime or depend on those optional apps being enabled. Configured agents produce advisory work; they cannot grant professional acceptance by completing a run.

## Exact save and recovery behavior

One pending-command mailbox is shared across authoring and professional review. Before dispatch, the client saves the exact operation, request identifier and payload to sessionStorage scoped to API server, organization, authenticated user and matter. It verifies the returned command identity and receipt before reporting a save. Decisions also verify the bound subject, assessment/closeout binding and decision value.

Same-tab refresh or SPA navigation restores a pending change as a recovery-only action. A different form cannot create another mutation while its outcome is unknown. Authentication loss, network failures, timeouts and rate limits preserve the request. Validation/conflict refusals require correction or a fresh assessment. No automatic new request is minted to replace an unknown write. Existing decision-only pending records remain recoverable after the upgrade.

Storage failure prevents dispatch. This is same-tab recovery, not cross-device or browser-close recovery. Tokens are not stored in this mailbox. The backend revalidates every replay's actor, scope and exact input.

Refreshing onboarding records invalidates any displayed assessment. Changing plan/target/review selections clears the corresponding professional acknowledgement. Stale versions and changed bindings are refused by Core. A saved change remains reported as saved even if a subsequent refresh fails.

## Verification

Focused transport, typed mapping and recovery tests:

```sh
npx jest tests/unit/assurance --runInBand --coverage=false
```

Existing reuse controls can be checked alongside them:

```sh
npx jest tests/unit/assurance tests/unit/document-review-api.service.test.js tests/unit/lex-select-dropdown-layout.contract.test.js --runInBand --coverage=false
```

The browser fixture runs the actual Lex controls and page controllers against a synthetic API. It covers all seven sections, an asset save whose response is lost followed by refresh recovery, unknown evidence before review, mismatched/stale decision controls, changed closeout, unavailable server behavior, and wide/narrow layout:

```sh
node tests/browser/assurance-onboarding.fixture.cjs
# If Playwright Chromium is not installed, use an installed Chrome binary:
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node tests/browser/assurance-onboarding.fixture.cjs
```

The former `implementation-assurance.fixture.cjs` entry delegates to this complete flow. Screenshots are written under `/tmp/lana-estate-onboarding-{wide,narrow}.png`. Synthetic browser results prove client wiring and presentation, not backend authorization, evidence integrity, live model behavior, or production readiness. Authenticated real API integration and packaging results must be reported separately.

Real HTTP/Core/PostgreSQL integration uses a separate isolated synthetic fixture. Start the backend's `tests/integration/implementation-assurance/persistence.node.js` with its documented browser-fixture mode, then run:

```sh
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node tests/browser/assurance-onboarding.http.cjs
```

The private fixture config defaults to `/tmp/lana-estate-browser-fixture.json`; do not commit it. The browser forwards API requests to the production router/controllers, real assurance/asset services and isolated PostgreSQL. Its scoped bearer, professional grants, contact, protocol and retained source bytes are synthetic. This does not verify production JWT, real storage infrastructure, or legal content. The completed flow checked invalid bearer and forged matter refusal, an actually committed asset with a dropped browser response followed by exact replay and one saved row, all seven sections, and an asset change making the accepted closeout stale. A subsequent real-API amendment flow updated the existing plan to version 2, explicitly rebound the same target, revised the same observation and required review again; current record counts stayed at one each, and the old closeout remained readable but stale. The first two harness runs also confirmed that future-dated evidence and a class not permitted by the selected protocol remain unknown.

Validation: 53 focused tests and 103 tests with existing reuse controls passed. The synthetic browser completed 14 scenarios with no page errors. The combined real HTTP browser completed 19 onboarding and amendment checks through 145 API requests with no page errors. Wide and 390px screenshots have no horizontal overflow. Re-run these checks on the final integrated build before production rollout.
