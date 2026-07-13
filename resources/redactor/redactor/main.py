"""Redactor HTTP service. POST /redact returns {redacted, token_map, entities}."""

from __future__ import annotations

import base64
import hmac
import logging
import os
from contextlib import asynccontextmanager

from typing import Literal, Union

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from . import document_redact
from .engine import (
    RESEARCH_READABLE_TYPES,
    RedactionUnavailable,
    detect,
    redact,
    redact_scoped,
)

_log = logging.getLogger("redactor")


# STRICT / fail-closed mode (the "safe for lawyers" PROD posture). Default OFF so
# local dev + `make test-invariants` keep running on whatever models are present.
# Turn ON per-environment (Railway prod) with REDACTOR_STRICT=1. In strict mode:
#   * the primary NER layer (Presidio/spaCy) is REQUIRED — if it isn't loaded, or
#     it/any loaded PHI layer throws mid-request, /redact returns 503
#     {degraded: true, reason} instead of under-redacted 200 text, so the gateway
#     WITHHOLDS rather than forwarding to the model;
#   * /redact refuses to serve UNAUTHENTICATED — the rollout shim (serve without a
#     secret) is disabled, because a cleartext-seeing hop must be authenticated
#     before we trust it in production.
# REDACTOR_REQUIRE_NER is accepted as an alias for the same switch.
def _strict_enabled() -> bool:
    val = os.getenv("REDACTOR_STRICT", "") or os.getenv("REDACTOR_REQUIRE_NER", "")
    return val.strip().lower() in ("1", "true", "yes", "on")


_STRICT = _strict_enabled()

# Redaction-behavior VERSION. This is NOT the HTTP app version — it is a tag that
# the API stores alongside a pre-computed redacted-text copy so it can tell, at
# serve time, whether that stored copy was produced by the SAME redactor it is
# talking to now. Bump ``REDACTOR_VERSION`` (env override) whenever the redaction
# BEHAVIOR changes (model/config/rule change) so every stored copy is treated as
# stale and lazily re-redacted. Exposed on /healthz (cheap currency check) and in
# each /redact response (so the producer of a given redaction is unambiguous).
REDACTOR_VERSION = os.getenv("REDACTOR_VERSION", "2026.07-r1")

# Internal-service auth (security-posture-audit G6). The redactor sees CLEARTEXT
# (pre-redaction PII), so it is the most sensitive internal hop. We require the
# same header convention already used for API<->gateway:
#   X-Lana-Service-Secret: <INTERNAL_SERVICE_SECRET>  (+ X-Lana-Service: api|gateway)
#
# SAFE ROLLOUT (fail-closed-WHEN-configured): enforcement is keyed off whether
# INTERNAL_SERVICE_SECRET is set+non-empty in THIS service's env. When it is
# UNSET we log a loud startup warning and ALLOW every request, so the enforcing
# build can ship BEFORE the env var is set; setting the env var later turns
# enforcement on with no code change. When it IS set, a missing/wrong header is
# rejected 401 with a CONSTANT-TIME compare (hmac.compare_digest), mirroring the
# gateway's subtle.ConstantTimeCompare check.
# G6 whitespace symmetry: do NOT .strip() the configured baseline. The senders
# (gateway env, api pydantic settings) transmit the RAW env value un-stripped, so
# stripping only here would make a secret with a trailing newline/space compare
# UNEQUAL to the identical value the sender presents -> a permanent, silent 401.
# Compare byte-identically (we strip NEITHER side); keep the constant-time check.
_INTERNAL_SERVICE_SECRET = os.getenv("INTERNAL_SERVICE_SECRET", "")


def require_service_secret(
    x_lana_service_secret: str | None = Header(default=None),
) -> None:
    """FastAPI dependency: enforce the internal-service secret on non-health
    endpoints. No-op (allow) when no secret is configured (rollout shim), UNLESS
    strict mode is on — then an unconfigured secret fails CLOSED (503)."""
    if not _INTERNAL_SERVICE_SECRET:
        if _STRICT:
            # STRICT: the rollout shim is disabled. A cleartext-seeing hop must be
            # authenticated in prod; serving unauthenticated would defeat the
            # fail-closed guarantee. 503 (not 401) so the caller treats it as
            # "service degraded / withhold", consistent with the NER-degraded path.
            _log.error(
                "redactor.strict_no_secret INTERNAL_SERVICE_SECRET unset while "
                "REDACTOR_STRICT is on; refusing /redact (fail closed)."
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={"degraded": True, "reason": "auth_required_unconfigured"},
            )
        # Rollout shim: secret not yet provisioned on this service -> allow.
        return
    # Compare the presented header byte-identically to the configured secret (do
    # NOT strip): the sender transmits the raw secret, so stripping here would
    # reject a secret that legitimately carries trailing whitespace.
    presented = x_lana_service_secret or ""
    if not presented or not hmac.compare_digest(presented, _INTERNAL_SERVICE_SECRET):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_or_missing_service_secret",
        )

# Presidio analyzer is heavy; build once at startup.
_analyzer = None
_anonymizer = None
# Which spaCy base NER model actually loaded (for /healthz + observability). None
# until _build_analyzer runs; a bare "default" means we fell all the way back to
# Presidio's built-in engine.
_spacy_model_loaded: str | None = None


# Base spaCy NER model is CONFIGURABLE per deployment via REDACTOR_SPACY_MODEL.
# The two options are the CNN en_core_web_lg (default) and the TRANSFORMER
# en_core_web_trf (opt-in: `pip install -e '.[trf]'` then set the env var).
#
# DEFAULT = en_core_web_lg, chosen from the eval harness (eval/lg.json vs
# eval/trf.json), NOT by assumption. The transformer was expected to lift
# PERSON/ORG/LOCATION recall, but the redactor is an ENSEMBLE — the de-id
# transformer + regex/heuristic floor already saturate PERSON/LOCATION any-overlap
# recall at 100%, so trf added almost no learned recall (only ORG full-coverage
# 95%->100%) while REGRESSING the safety metric: overall recall_full 0.881->0.845
# and ADDRESS full-coverage 0.69->0.08 (its LOCATION spans drop the house number),
# plus it missed a codename lg caught, at ~5x the CPU NER cost (~15ms->~74ms;
# spaCy runs on NumpyOps/CPU here, no GPU wired). Keep lg for the latency-sensitive
# sync hop; flip to trf only where a deployment's own eval justifies it.
#
# If the requested model can't be loaded (package or its backend, e.g. curated-
# transformers, missing) we fall back to en_core_web_lg and log LOUDLY — UNLESS
# strict mode is on, in which case the missing REQUESTED model surfaces (we do NOT
# silently downgrade; the analyzer stays unbuilt so /redact fails closed, matching
# the posture where an under-configured redactor withholds rather than under-redacts).
def _requested_spacy_model() -> str:
    return (os.getenv("REDACTOR_SPACY_MODEL", "en_core_web_lg").strip()
            or "en_core_web_lg")


_SPACY_FALLBACK_MODEL = "en_core_web_lg"
# Biomedical NER model (scispaCy en_ner_bc5cdr_md) for PHI: diagnoses and
# medications. Built once, separately, so a failure to load it degrades PHI
# coverage to the acronym/regex backstops without taking down core redaction.
_medical_nlp = None


def _build_medical():
    """Lazy-build the biomedical NER model. Absence degrades PHI coverage but
    never crashes the service (matches the Presidio graceful-degrade posture)."""
    global _medical_nlp
    if _medical_nlp is not None:
        return
    try:
        import spacy

        _medical_nlp = spacy.load("en_ner_bc5cdr_md")
    except Exception:
        _medical_nlp = None


# De-identification transformer (obi/deid_roberta_i2b2). HEAVY (~1.4GB model +
# torch), so it is OPT-IN via REDACTOR_DEID=1. When disabled or unavailable the
# service falls back to Presidio + biomedical NER + the regex/heuristic floor +
# human review, exactly as before. Set REDACTOR_DEID_MODEL to override the model.
_deid_ner = None


def _deid_enabled() -> bool:
    return os.getenv("REDACTOR_DEID", "0").strip().lower() in ("1", "true", "yes", "on")


def _personal_dates_enabled() -> bool:
    """HIPAA-Safe-Harbor personal-date mode: redact dates tied to an individual
    (treatment/admission/death dates near a name) while keeping institutional/case
    dates readable. Default OFF (general legal); ON is the medical-legal /
    full-protect posture. See engine.redact(personal_dates=...)."""
    return os.getenv("REDACTOR_PERSONAL_DATES", "0").strip().lower() in (
        "1", "true", "yes", "on"
    )


def _llm_enabled() -> bool:
    """Opt-in LLM-prompt PII layer (redactor/llm_redact.py). Sends CLEARTEXT to a
    model, so it is SOVEREIGN-ONLY (Forge). Default OFF."""
    return os.getenv("REDACTOR_LLM_PII", "0").strip().lower() in (
        "1", "true", "yes", "on"
    )


def _llm_sync_enabled() -> bool:
    """Whether to also run the LLM layer on the SYNC /redact hop. A Forge round-trip
    per chat message is slow, so this is a SEPARATE opt-in; default OFF even when the
    layer is enabled for the document path."""
    return os.getenv("REDACTOR_LLM_PII_SYNC", "0").strip().lower() in (
        "1", "true", "yes", "on"
    )


_llm_client = None


def _build_llm():
    """Lazily construct the SOVEREIGN Forge client for the LLM PII layer, only when
    REDACTOR_LLM_PII=1 and an inference endpoint + model are configured. Points at
    GATEWAY_INFERENCE_URL (self-hosted) — NEVER a third-party API, or cleartext PII
    would leave the trust boundary."""
    global _llm_client
    if _llm_client is not None or not _llm_enabled():
        return
    base = os.getenv("REDACTOR_LLM_URL", "") or os.getenv("GATEWAY_INFERENCE_URL", "")
    # Accept a bare inference base (e.g. https://forge-api.lanaai.io) and append the
    # OpenAI-compatible chat path the gateway uses (route/inference.go: base +
    # /v1/chat/completions). If a full completions URL is already given, keep it.
    if base and "/chat/completions" not in base:
        base = base.rstrip("/") + "/v1/chat/completions"
    model = os.getenv("REDACTOR_LLM_MODEL", "") or os.getenv("GATEWAY_INFERENCE_MODEL", "")
    if not base or not model:
        _log.error(
            "redactor.llm_pii_enabled_but_unconfigured base_or_model_missing; "
            "LLM layer disabled"
        )
        return
    try:
        from .llm_redact import ForgeChatClient

        _llm_client = ForgeChatClient(
            base, model=model, api_key=os.getenv("GATEWAY_INFERENCE_API_KEY", "")
        )
    except Exception:
        _log.exception("redactor.llm_client_build_failed")
        _llm_client = None


def _build_deid():
    global _deid_ner
    if _deid_ner is not None or not _deid_enabled():
        return
    try:
        from transformers import pipeline

        model = os.getenv("REDACTOR_DEID_MODEL", "obi/deid_roberta_i2b2")
        _deid_ner = pipeline(
            "token-classification", model=model, aggregation_strategy="simple"
        )
    except Exception:
        _deid_ner = None


def _build_analyzer():
    """Lazy-build to keep imports out of unit-test load path."""
    global _analyzer, _anonymizer, _spacy_model_loaded
    if _analyzer is not None:
        return
    try:
        from presidio_analyzer import AnalyzerEngine
        from presidio_analyzer.nlp_engine import NlpEngineProvider
        from presidio_anonymizer import AnonymizerEngine

        # spaCy label → Presidio entity mapping.
        #
        # DATE/TIME are deliberately NOT mapped (51-scenario UAT, 2026-06): an
        # ordinary date is not PII on its own, and mapping it to DATE_TIME caused
        # heavy over-redaction that scrambled normal legal prose. We drop them at
        # the source AND omit DATE_TIME from the engine's entity allowlist, so
        # dates flow through untouched. ORG is surfaced as ORGANIZATION so company
        # and law-firm names don't leak. This mapping is model-independent (both
        # en_core_web_lg and the transformer en_core_web_trf emit the same OntoNotes
        # label set), so switching the base model needs no mapping change.
        def _nlp_config(model_name: str) -> dict:
            return {
                "nlp_engine_name": "spacy",
                "models": [{"lang_code": "en", "model_name": model_name}],
                "ner_model_configuration": {
                    "model_to_presidio_entity_mapping": {
                        "PERSON": "PERSON",
                        "ORG": "ORGANIZATION",
                        "GPE": "LOCATION",
                        "LOC": "LOCATION",
                        "FAC": "LOCATION",
                        "NORP": "NRP",
                    },
                    "labels_to_ignore": [
                        "CARDINAL", "ORDINAL", "QUANTITY", "PERCENT",
                        "MONEY", "PRODUCT", "EVENT", "WORK_OF_ART",
                        "LAW", "LANGUAGE",
                        # Over-redaction fix: ignore date/time labels at the NLP layer.
                        "DATE", "TIME",
                    ],
                },
            }

        def _build_with(model_name: str):
            engine = NlpEngineProvider(
                nlp_configuration=_nlp_config(model_name)
            ).create_engine()
            return AnalyzerEngine(nlp_engine=engine)

        # Pre-check package presence: a missing spaCy model makes Presidio's loader
        # call sys.exit(1) (raises SystemExit, a BaseException that a plain
        # `except Exception` would NOT catch), which would crash startup instead of
        # falling back. is_package() lets us route to the fallback / strict path
        # deterministically without triggering that exit.
        import spacy.util as _spacy_util

        requested = _requested_spacy_model()
        try:
            if not _spacy_util.is_package(requested):
                raise ModuleNotFoundError(f"spaCy model not installed: {requested}")
            _analyzer = _build_with(requested)
            _spacy_model_loaded = requested
            _log.info("redactor.spacy_model loaded=%s (requested)", requested)
        except BaseException as exc:  # noqa: BLE001 - also catch SystemExit from loader
            # The requested base model (or its runtime backend, e.g. the
            # transformer weights / spacy-*-transformers) could not be loaded.
            if _STRICT and requested != _SPACY_FALLBACK_MODEL:
                # Fail-closed: do NOT silently downgrade the REQUESTED model in a
                # prod (strict) deployment. Leave the analyzer unbuilt so /redact
                # returns 503 (withhold) rather than serving results from a model
                # the operator did not ask for.
                _log.critical(
                    "redactor.spacy_model_load_failed requested=%s strict=on "
                    "err=%s: refusing to fall back; /redact will fail closed.",
                    requested, exc,
                )
                _analyzer = None
                _anonymizer = None
                return
            # Non-strict (dev / degrade-gracefully): fall back to en_core_web_lg,
            # then to Presidio's default engine, rather than dropping to regex-only.
            if requested != _SPACY_FALLBACK_MODEL:
                _log.warning(
                    "redactor.spacy_model_fallback requested=%s not loadable "
                    "(%s); falling back to %s. Install it with "
                    "`python -m spacy download %s` for higher NER recall.",
                    requested, exc, _SPACY_FALLBACK_MODEL, requested,
                )
                try:
                    if not _spacy_util.is_package(_SPACY_FALLBACK_MODEL):
                        raise ModuleNotFoundError(_SPACY_FALLBACK_MODEL)
                    _analyzer = _build_with(_SPACY_FALLBACK_MODEL)
                    _spacy_model_loaded = _SPACY_FALLBACK_MODEL
                except BaseException:  # noqa: BLE001
                    _analyzer = AnalyzerEngine()
                    _spacy_model_loaded = "default"
                    _log.warning("redactor.spacy_model loaded=default (built-in)")
            else:
                _analyzer = AnalyzerEngine()
                _spacy_model_loaded = "default"
                _log.warning("redactor.spacy_model loaded=default (built-in)")
        _anonymizer = AnonymizerEngine()
    except Exception:
        _analyzer = None
        _anonymizer = None
        _spacy_model_loaded = None


class ProtectedTerm(BaseModel):
    """A single matter-vault term. ``category`` becomes the redaction token TYPE
    (e.g. CLIENT, OPPOSING_PARTY, CASE_NUMBER); defaults to PROTECTED."""

    term: str = Field(min_length=1, max_length=512)
    category: str | None = None


class RedactBody(BaseModel):
    text: str = Field(min_length=0, max_length=200_000)
    # "full" = entity-based NER (today's behavior, default — back-compat for the
    # gateway's existing {"text": ...} calls). "scoped" = redact ONLY the
    # supplied protected_terms (matter vault), leaving public references intact.
    # "baseline" = the research tier: full NER, but the research-safe reference
    # entities (names/orgs/places/nationality/links — RESEARCH_READABLE_TYPES)
    # stay readable while everything else (SSN, financial + government IDs,
    # medical, DOB, contact identifiers, and any unlisted type) is redacted.
    mode: Literal["full", "scoped", "baseline"] = "full"
    # Scoped-mode vocabulary. Accepts bare strings or {term, category} objects.
    protected_terms: list[Union[str, ProtectedTerm]] = Field(default_factory=list)


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    if not _INTERNAL_SERVICE_SECRET and not _STRICT:
        # Loud, greppable warning so the rollout shim is never silently permanent.
        _log.warning(
            "redactor.auth_disabled_no_secret INTERNAL_SERVICE_SECRET is unset; "
            "/redact is UNAUTHENTICATED. Set INTERNAL_SERVICE_SECRET to enforce "
            "internal-service auth (security-posture-audit G6)."
        )
    _build_analyzer()
    _build_medical()
    _build_deid()
    _build_llm()
    if _STRICT:
        # In strict mode the primary NER layer is REQUIRED. We do not refuse to
        # start (that would defeat health probing), but every /redact fails closed
        # with 503 until it loads — so surface the condition LOUDLY at boot.
        if _analyzer is None:
            _log.critical(
                "redactor.strict_ner_unavailable Presidio/spaCy analyzer failed to "
                "load while REDACTOR_STRICT is on; /redact will fail closed (503) "
                "until it is available. Refusing to serve under-redacted results."
            )
        if not _INTERNAL_SERVICE_SECRET:
            _log.critical(
                "redactor.strict_no_secret INTERNAL_SERVICE_SECRET is unset while "
                "REDACTOR_STRICT is on; /redact will fail closed (503)."
            )
    yield


app = FastAPI(title="Lana Redactor", version="0.1.0", lifespan=_lifespan)


@app.get("/healthz")
def healthz():
    analyzer_ready = _analyzer is not None
    # In strict mode "ready" means we can actually serve fully-redacted, authed
    # results; orchestrators can gate traffic on this. When strict is off, the
    # service is always considered ready (dev/degrade-gracefully posture).
    ready = (not _STRICT) or (analyzer_ready and bool(_INTERNAL_SERVICE_SECRET))
    return {
        "ok": True,
        "version": REDACTOR_VERSION,
        "strict": _STRICT,
        "ready": ready,
        "analyzer_ready": analyzer_ready,
        "spacy_model": _spacy_model_loaded,
        "medical_ready": _medical_nlp is not None,
        "deid_enabled": _deid_enabled(),
        "personal_dates_enabled": _personal_dates_enabled(),
        "llm_pii_enabled": _llm_enabled(),
        "llm_pii_ready": _llm_client is not None,
        "deid_ready": _deid_ner is not None,
    }


@app.post("/redact", dependencies=[Depends(require_service_secret)])
def do_redact(body: RedactBody):
    terms: list = [
        t if isinstance(t, str) else {"term": t.term, "category": t.category}
        for t in body.protected_terms
    ]
    if body.mode == "scoped":
        # Scoped mode redacts ONLY the declared terms and never runs NER, so the
        # strict NER-readiness gate does not apply to it (there is no NER coverage
        # to degrade). It is unaffected by strict mode.
        result = redact_scoped(body.text, terms)
    else:
        # Full mode = NER + backstops + any declared protected_terms. For matter
        # context the gateway sends the vault terms here so a non-entity codename
        # (e.g. "Project Zephyr") is redacted alongside detected PII; callers that
        # send no terms get plain full NER (back-compat).
        try:
            result = redact(
                body.text,
                analyzer=_analyzer,
                anonymizer=_anonymizer,
                medical_nlp=_medical_nlp,
                deid_ner=_deid_ner,
                deid_min_score=float(os.getenv("REDACTOR_DEID_MIN_SCORE", "0.5")),
                # Baseline (research) tier: keep research-safe reference entities
                # readable, redact the rest. None for full mode (redact all).
                readable_types=(
                    RESEARCH_READABLE_TYPES if body.mode == "baseline" else None
                ),
                protected_terms=terms or None,
                strict=_STRICT,
                personal_dates=_personal_dates_enabled(),
                # LLM layer on the sync hop only if explicitly opted in (latency).
                llm_client=(_llm_client if _llm_sync_enabled() else None),
            )
        except RedactionUnavailable as exc:
            # STRICT fail-closed: the required NER layer is unavailable or threw.
            # Return 503 with a structured, PII-free reason so the gateway
            # WITHHOLDS the text (does not forward under-redacted content to the
            # model) instead of receiving a silently-degraded 200.
            _log.error("redactor.fail_closed reason=%s", exc.reason)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={"degraded": True, "reason": exc.reason},
            ) from exc
    # Expose readiness on the /redact response too (mirrors /healthz) so callers
    # that PERSIST a redacted copy can refuse to cache a silently-degraded,
    # regex-only result. In strict mode a degraded full-mode redaction already
    # 503s above; in non-strict mode the analyzer can be missing yet still return
    # a 200 (regex backstop only), and analyzer_ready lets the API skip storing it.
    # Scoped mode carries no NER, so it is always considered ready.
    analyzer_ready = _analyzer is not None
    if body.mode == "scoped":
        ready = True
    elif not _STRICT:
        ready = analyzer_ready
    else:
        ready = analyzer_ready and bool(_INTERNAL_SERVICE_SECRET)
    return {
        "redacted": result.redacted,
        "token_map": result.token_map,
        "entities": result.entities,
        "redactor_version": REDACTOR_VERSION,
        "ready": bool(ready),
        "analyzer_ready": analyzer_ready,
    }


# Max document upload size. Documents are heavier than the /redact text cap; a
# scanned PDF at OCR zoom can be large, so allow more but still bound it.
_MAX_DOC_BYTES = int(os.getenv("REDACTOR_MAX_DOC_BYTES", str(50 * 1024 * 1024)))


def _bound_redact_fn(terms: list | None):
    """Bind engine.redact with the loaded analyzer/PHI models + current config.

    Returned callable takes a single ``text`` arg (what document_redact needs)
    and, in strict mode, raises RedactionUnavailable exactly like /redact — so a
    document is NEVER partially redacted when the NER layer is down (fail closed).
    """

    def _fn(text: str):
        return redact(
            text,
            analyzer=_analyzer,
            anonymizer=_anonymizer,
            medical_nlp=_medical_nlp,
            deid_ner=_deid_ner,
            deid_min_score=float(os.getenv("REDACTOR_DEID_MIN_SCORE", "0.5")),
            protected_terms=terms or None,
            strict=_STRICT,
            personal_dates=_personal_dates_enabled(),
            # Document path is the high-recall path: use the LLM layer whenever it
            # is enabled (latency is acceptable for offline document redaction).
            llm_client=_llm_client,
        )

    return _fn


def _bound_detect_fn(terms: list | None):
    """Bind engine.detect (DETECT-ONLY, no token emission) with the loaded
    analyzer/PHI models + current config, for the PROPOSE hop.

    Same models, same strict fail-closed posture as ``_bound_redact_fn`` — a
    proposal is NEVER computed from an under-detected ensemble; in strict mode a
    required-layer outage raises RedactionUnavailable and no proposals are shown.
    Returns the resolved spans (type/start/end/score/source/text) for the
    document layer to enrich into the full span contract."""

    def _fn(text: str):
        return detect(
            text,
            analyzer=_analyzer,
            anonymizer=_anonymizer,
            medical_nlp=_medical_nlp,
            deid_ner=_deid_ner,
            deid_min_score=float(os.getenv("REDACTOR_DEID_MIN_SCORE", "0.5")),
            protected_terms=terms or None,
            strict=_STRICT,
            personal_dates=_personal_dates_enabled(),
            llm_client=_llm_client,
        )

    return _fn


@app.post("/redact-document", dependencies=[Depends(require_service_secret)])
async def do_redact_document(file: UploadFile = File(...)):
    """TRUE document redaction: ingest a PDF/DOCX, redact detected PII, and emit
    a redacted document with the sensitive text ACTUALLY REMOVED (PDF burn-in) or
    REPLACED (DOCX), plus a per-entity redaction report.

    Response: ``{format, filename, content_base64, report}``. The document bytes
    are base64-encoded so the report rides alongside in one JSON body.
    """
    data = await file.read()
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="empty_document")
    if len(data) > _MAX_DOC_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="document_too_large",
        )
    try:
        result = document_redact.redact_document(
            data,
            _bound_redact_fn(None),
            filename=file.filename,
            content_type=file.content_type,
        )
    except document_redact.UnsupportedDocument:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="unsupported_document_type",
        )
    except RedactionUnavailable as exc:
        # STRICT fail-closed: the required NER layer is down. Do NOT emit a
        # partially-redacted document — withhold entirely.
        _log.error("redactor.doc.fail_closed reason=%s", exc.reason)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"degraded": True, "reason": exc.reason},
        ) from exc
    except (ValueError, RuntimeError) as exc:
        # Corrupt/unreadable document bytes. PII-free error, never the content.
        _log.error("redactor.doc.parse_error exc_type=%s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="document_parse_error",
        ) from exc

    out_name = _redacted_filename(file.filename, result.fmt)
    return {
        "format": result.fmt,
        "filename": out_name,
        "content_base64": base64.b64encode(result.content).decode("ascii"),
        "report": result.report,
    }


# --- Human-in-the-loop: PROPOSE / APPLY ------------------------------------
# The one-shot /redact-document detects AND burns in one pass. These two split
# it so a reviewer can inspect proposed redactions, override them (remove a false
# positive, add a missed span), then finalize. Same auth + strict + fail-closed
# posture as /redact-document.
class ReviewSpan(BaseModel):
    """One span in the shared span contract the API + web build to:
    ``{id, type, start, end, text, confidence, source, page, rects}``. Only the
    fields APPLY needs are required (type + offsets, plus optional rects for a
    reviewed/added PDF span); the rest ride along for provenance."""

    id: str | None = None
    type: str = Field(min_length=1, max_length=128)
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    text: str | None = None
    confidence: float | None = None
    source: str | None = None
    page: int | None = None
    rects: list[list[float]] | None = None


class ApplyBody(BaseModel):
    """APPLY request: the original document (base64) + the human-approved spans
    to burn in. Only these spans are redacted (removed spans are omitted; added
    spans are included)."""

    file_b64: str = Field(min_length=1)
    approved_spans: list[ReviewSpan] = Field(default_factory=list)
    filename: str | None = None
    content_type: str | None = None


@app.post("/redact-document/propose",
          dependencies=[Depends(require_service_secret)])
async def do_propose_document(file: UploadFile = File(...)):
    """PROPOSE: ingest a PDF/DOCX, detect PII, and return the proposed redactions
    WITHOUT altering the document. The reviewer approves/overrides these, then
    calls /redact-document/apply to finalize.

    Response: ``{format, page_count, proposed_spans}`` where each proposed span is
    the full shared contract dict (id/type/start/end/text/confidence/source/page/
    rects). Same fail-closed posture as /redact-document: a strict NER outage
    returns 503 and proposes nothing."""
    data = await file.read()
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="empty_document")
    if len(data) > _MAX_DOC_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="document_too_large",
        )
    try:
        proposal = document_redact.propose_document(
            data,
            _bound_detect_fn(None),
            filename=file.filename,
            content_type=file.content_type,
        )
    except document_redact.UnsupportedDocument:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="unsupported_document_type",
        )
    except RedactionUnavailable as exc:
        _log.error("redactor.doc.propose_fail_closed reason=%s", exc.reason)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"degraded": True, "reason": exc.reason},
        ) from exc
    except (ValueError, RuntimeError) as exc:
        _log.error("redactor.doc.propose_parse_error exc_type=%s",
                   type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="document_parse_error",
        ) from exc
    return proposal


@app.post("/redact-document/apply",
          dependencies=[Depends(require_service_secret)])
async def do_apply_document(body: ApplyBody):
    """APPLY: burn in EXACTLY the approved spans and return the finalized
    document. Honors human overrides (a removed span is not redacted; an added
    span is). No detection re-runs here — the approved spans are the source of
    truth.

    Response: ``{format, filename, redacted_document_b64, report}``."""
    try:
        data = base64.b64decode(body.file_b64, validate=True)
    except Exception as exc:  # noqa: BLE001 - malformed base64 payload
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="invalid_file_b64") from exc
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="empty_document")
    if len(data) > _MAX_DOC_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="document_too_large",
        )
    approved = [s.model_dump() for s in body.approved_spans]
    try:
        result = document_redact.apply_document(
            data,
            approved,
            filename=body.filename,
            content_type=body.content_type,
        )
    except document_redact.UnsupportedDocument:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="unsupported_document_type",
        )
    except RedactionUnavailable as exc:
        # Defensive: apply does not re-detect, but keep the fail-closed contract.
        _log.error("redactor.doc.apply_fail_closed reason=%s", exc.reason)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"degraded": True, "reason": exc.reason},
        ) from exc
    except (ValueError, RuntimeError) as exc:
        _log.error("redactor.doc.apply_error exc_type=%s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="document_parse_error",
        ) from exc

    out_name = _redacted_filename(body.filename, result["format"])
    return {
        "format": result["format"],
        "filename": out_name,
        "redacted_document_b64": base64.b64encode(
            result["redacted_document"]
        ).decode("ascii"),
        "report": result["report"],
    }


def _redacted_filename(name: str | None, fmt: str) -> str:
    """``report.pdf`` -> ``report.redacted.pdf`` (PII-free, extension-normalized)."""
    stem = (name or "document").rsplit("/", 1)[-1]
    if "." in stem:
        stem = stem.rsplit(".", 1)[0]
    return f"{stem}.redacted.{fmt}"
