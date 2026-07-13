# Lana Redactor

Stateless HTTP service that turns text into `(redacted_text, token_map, entities)`.
`POST /redact` is the only redaction endpoint; `GET /healthz` reports which layers
are loaded. It is the security-critical boundary: the gateway sends it every
message before inference, and it must never silently degrade unnoticed.

## Redaction layers

Coverage is layered. Each layer is a separate recognizer; the union of their
spans is redacted, then de-duplicated. Layers degrade independently and loudly
(an absent layer logs an error and lowers coverage, it never crashes the
service), so the deployment you choose is a coverage/size trade-off.

| Layer | Catches | Dependency | Default |
|---|---|---|---|
| Regex floor | SSN, EIN, credit card, IBAN, case # | none (built in) | always |
| spaCy `en_core_web_lg` | names, orgs, locations | base install | always |
| Deterministic PHI floor | ICD-10, lab values, medical acronyms, condition phrases, MRN/badge/policy | none (built in) | always |
| scispaCy `en_ner_bc5cdr_md` | diagnoses, medications | `.[phi]` | when installed |
| De-id transformer `obi/deid_roberta_i2b2` | contextual IDs, addresses, names in shorthand | `.[deid]` + torch + `REDACTOR_DEID=1` | opt-in |

The regex floor and the deterministic PHI floor are always present, so even the
lean base install never leaks the fixed-format identifiers; the ML layers raise
recall on open-ended entities.

## Install

```bash
# Lean (cloud default): Presidio + spaCy names/orgs + the regex/PHI floor.
pip install -e .

# + biomedical PHI (diagnoses/medications):
pip install -e ".[phi]"

# Full ML stack (PHI + de-id transformer): use the install script. It installs
# the CORRECT torch wheel for your platform (CPU index on Linux; PyPI on macOS),
# then `.[ml]`, then verifies every model loads. One command, no flags to recall:
PYTHON=.venv/bin/python ./install-ml.sh
```

Why the script: `torch` is the one platform-specific dependency. On macOS the
PyPI wheel is already CPU/MPS (handled by a marker in the `[deid]` extra), but on
Linux the default PyPI wheel is the multi-GB CUDA build and the CPU wheel lives
on a separate index that pyproject markers can't express. The script (and
`Dockerfile.full`, which runs the same script) is the single place that quirk is
handled, so a fresh environment can't get it wrong. Do not hand-run
`pip install -e '.[ml]'` on Linux — you'd get no torch and the de-id layer would
stay off. `transformers` is pinned to `4.44.2` (5.x breaks against torch 2.2.x).

## Runtime env

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `18081` | listen port |
| `REDACTOR_STRICT` | `0` | `1` = fail-closed PROD posture (see below). `REDACTOR_REQUIRE_NER` is an accepted alias. |
| `INTERNAL_SERVICE_SECRET` | unset | shared secret for the `X-Lana-Service-Secret` hop auth. REQUIRED in strict mode. |
| `REDACTOR_DEID` | `0` | `1` enables the de-id transformer layer (requires `.[deid]` + torch) |
| `REDACTOR_DEID_MODEL` | `obi/deid_roberta_i2b2` | HF model id for the de-id layer |
| `REDACTOR_DEID_MIN_SCORE` | `0.5` | drop de-id spans below this confidence (precision guard) |

`GET /healthz` returns
`{strict, ready, analyzer_ready, medical_ready, deid_enabled, deid_ready}` so a
deploy can assert the layers it expects are actually loaded. In strict mode
`ready` is true only when the primary NER analyzer is loaded AND a service secret
is configured.

## STRICT mode (fail closed) — the production posture

The default (dev) posture degrades **loudly but gracefully**: if a NER layer is
missing or throws, the service logs an error and continues on the regex floor,
returning `200`. That keeps local dev and `make test-invariants` running without
the heavy models, but it means names/orgs/locations can leak — unacceptable for
the "safe for lawyers" guarantee in production.

Set `REDACTOR_STRICT=1` in prod. In strict mode:

- The primary NER layer (Presidio/spaCy) is **required**. If it is not loaded, or
  it — or any *loaded* PHI layer (scispaCy / de-id) — throws mid-request,
  `POST /redact` returns **`503 {"detail": {"degraded": true, "reason": ...}}`**
  instead of an under-redacted `200`. `reason` is one of `ner_unavailable`,
  `ner_analyzer_error`, `medical_ner_error`, `deid_ner_error`,
  `auth_required_unconfigured`.
- `POST /redact` **refuses to serve unauthenticated** — the rollout shim (serve
  without a secret) is disabled, so `INTERNAL_SERVICE_SECRET` must be set.
- `mode:"scoped"` is unaffected (it never runs NER, so there is no NER coverage
  to degrade).

**Gateway consumption (already fail closed).** The gateway's redactor client
(`apps/gateway/internal/redact/redact.go`) treats any non-2xx as a non-nil error;
`handlers/chat.go` turns that into `502 redaction_unavailable` and never forwards
the input to inference. A `503` is additionally mapped to the distinct
`ErrRedactorDegraded` sentinel so it is unmistakable in logs/metrics that the
gateway **withheld** the text (rather than hit a transport error). No caller ever
forwards under-redacted text on a degraded/fail-closed response.

## Docker

- `Dockerfile` — lean image (base install). Default for the cloud redactor.
  Build-verifies `en_core_web_lg`.
- `Dockerfile.full` — full ML image: installs `.[ml]` + CPU torch, build-verifies
  all three models, pre-bakes the de-id model into the HF cache (so the first
  request isn't blocked on a ~1.4GB download), and defaults `REDACTOR_DEID=1`.
  This is the build the desktop sidecar packages.

## Tests

```bash
pip install -e ".[dev]"
pytest -q
```

The engine tests stub the ML layers, so the full suite runs on the lean install.
