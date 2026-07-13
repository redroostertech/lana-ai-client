"""LLM-prompt-based PII/PHI detection layer (OPT-IN, high-recall frontier).

This module is the *recall* frontier of the redaction ensemble. Regex and
statistical NER (Presidio/spaCy/de-id transformer) miss whole classes of
context-dependent PII by construction:

  * aliases / initials ("C.D.", "J.R.", "Mr. R.")
  * unusual or non-Western names the NER never saw in training
  * quasi-identifiers ("a 41-year-old left-handed cardiologist in Boise")
  * novel / bespoke identifier formats (internal file numbers, custom refs)
  * relational identifiers ("the plaintiff's daughter", "his ex-wife's employer")

A language model reasons over the whole sentence and catches these. We run it
as an ADDITIONAL layer whose spans UNION with the deterministic/NER spans in
``engine.py`` (identical span shape), so it can only ADD coverage, never remove
it. Precision noise it introduces is bounded by the surrounding ensemble and by
human-in-the-loop review on the document path.

=============================================================================
CRITICAL TRUST CONSTRAINT — READ BEFORE WIRING THIS IN
=============================================================================
Prompt-based detection sends the RAW, UN-REDACTED CLEARTEXT to a model. That is
the one thing the redactor exists to prevent. Therefore this layer MUST target
Lana's OWN SOVEREIGN, SELF-HOSTED model (Forge, reached via ``GATEWAY_INFERENCE_URL``
or an equivalently sovereign, injected client) and MUST NEVER be pointed at a
third-party API (OpenAI, Anthropic, Google, ...). Sending cleartext to a third
party to detect PII would DEFEAT the redactor entirely and leak the exact data
we are trying to protect.

The client is INJECTED for exactly this reason: the caller owns the endpoint
choice, and the default adapter (:class:`ForgeChatClient`) marks requests
``x-sovereign: true`` and is meant to be constructed against the sovereign
endpoint only. There is deliberately no convenience constructor that reads an
arbitrary third-party URL.

This layer is OPT-IN behind a flag (see the module-level guidance and the
returned recommendation) and is intended for the HIGH-RECALL / document
redaction path, NOT the latency-sensitive synchronous chat hop.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Callable, Iterable

log = logging.getLogger("redactor.llm")

# A client is any callable that takes OpenAI-style chat ``messages`` and returns
# the assistant's raw text content. Injected so it is trivially stubbable and so
# the endpoint (which MUST be sovereign) is chosen by the caller, not hard-wired.
LlmClient = Callable[..., str]


class LlmRedactionError(Exception):
    """Raised (in ``strict`` mode only) when the LLM layer cannot produce a
    trustworthy result — a client/transport error or an unparseable response.

    In non-strict mode these conditions fail OPEN (return ``[]``): the LLM layer
    is additive, so losing it degrades recall but never correctness of the other
    layers. In strict mode the caller can fail CLOSED (withhold the text)."""

    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


# ---------------------------------------------------------------------------
# Type mapping: model label -> our canonical token TYPE (see engine.py).
# ---------------------------------------------------------------------------
# The model is instructed to use these labels, but models drift, so we normalize
# (uppercase, strip separators) and map generously. Anything unrecognized fails
# SAFE to OTHER_PHI: an unknown label still gets redacted, never dropped.
_CANONICAL_TYPES: frozenset[str] = frozenset(
    {
        "PERSON", "ORGANIZATION", "LOCATION", "STREET_ADDRESS", "NRP",
        "DATE_OF_BIRTH", "PERSONAL_DATE", "AGE",
        "EMAIL_ADDRESS", "PHONE_NUMBER", "URL", "IP_ADDRESS", "USERNAME",
        "US_SSN", "US_ITIN", "US_PASSPORT", "US_DRIVER_LICENSE",
        "US_BANK_NUMBER", "US_EIN", "CREDIT_CARD", "IBAN_CODE", "CRYPTO",
        "BANK_ACCOUNT", "BANK_ROUTING", "ID_NUMBER", "CASE_NUMBER",
        "POLICY_NUMBER", "VEHICLE_ID", "MEDICAL_LICENSE",
        "MEDICAL_RECORD_NUMBER", "MEDICAL_CONDITION", "MEDICATION",
        "PROFESSION", "OTHER_PHI",
    }
)

_TYPE_MAP: dict[str, str] = {
    # People / relational
    "PERSON": "PERSON", "NAME": "PERSON", "FULLNAME": "PERSON",
    "FIRSTNAME": "PERSON", "LASTNAME": "PERSON", "MIDDLENAME": "PERSON",
    "INITIALS": "PERSON", "ALIAS": "PERSON", "NICKNAME": "PERSON",
    "RELATIONALIDENTIFIER": "PERSON", "RELATIONAL": "PERSON",
    "RELATIVE": "PERSON", "PATIENT": "PERSON", "DOCTOR": "PERSON",
    # Groups / demographics (Presidio NRP = nationality/religion/political)
    "NRP": "NRP", "NATIONALITY": "NRP", "RELIGION": "NRP",
    "ETHNICITY": "NRP", "POLITICAL": "NRP",
    # Orgs
    "ORGANIZATION": "ORGANIZATION", "ORG": "ORGANIZATION",
    "COMPANY": "ORGANIZATION", "EMPLOYER": "ORGANIZATION",
    "HOSPITAL": "ORGANIZATION", "SCHOOL": "ORGANIZATION",
    # Places / addresses
    "LOCATION": "LOCATION", "LOC": "LOCATION", "CITY": "LOCATION",
    "STATE": "LOCATION", "COUNTRY": "LOCATION", "GPE": "LOCATION",
    "ADDRESS": "STREET_ADDRESS", "STREETADDRESS": "STREET_ADDRESS",
    "STREET": "STREET_ADDRESS", "ZIP": "STREET_ADDRESS",
    "ZIPCODE": "STREET_ADDRESS", "POSTALCODE": "STREET_ADDRESS",
    # Dates / age
    "DATEOFBIRTH": "DATE_OF_BIRTH", "DOB": "DATE_OF_BIRTH",
    "BIRTHDATE": "DATE_OF_BIRTH",
    "PERSONALDATE": "PERSONAL_DATE", "DATE": "PERSONAL_DATE",
    "AGE": "AGE",
    # Contact / online
    "EMAIL": "EMAIL_ADDRESS", "EMAILADDRESS": "EMAIL_ADDRESS",
    "PHONE": "PHONE_NUMBER", "PHONENUMBER": "PHONE_NUMBER",
    "FAX": "PHONE_NUMBER", "MOBILE": "PHONE_NUMBER",
    "URL": "URL", "WEBSITE": "URL",
    "IP": "IP_ADDRESS", "IPADDRESS": "IP_ADDRESS", "IPADDR": "IP_ADDRESS",
    "USERNAME": "USERNAME", "HANDLE": "USERNAME",
    # Government / financial identifiers
    "SSN": "US_SSN", "USSSN": "US_SSN", "SOCIALSECURITY": "US_SSN",
    "SOCIALSECURITYNUMBER": "US_SSN",
    "ITIN": "US_ITIN", "USITIN": "US_ITIN",
    "PASSPORT": "US_PASSPORT", "USPASSPORT": "US_PASSPORT",
    "DRIVERLICENSE": "US_DRIVER_LICENSE", "DL": "US_DRIVER_LICENSE",
    "USDRIVERLICENSE": "US_DRIVER_LICENSE",
    "EIN": "US_EIN", "USEIN": "US_EIN", "TIN": "US_EIN",
    "CREDITCARD": "CREDIT_CARD", "CARDNUMBER": "CREDIT_CARD",
    "IBAN": "IBAN_CODE", "IBANCODE": "IBAN_CODE",
    "CRYPTO": "CRYPTO", "WALLET": "CRYPTO",
    "BANKACCOUNT": "BANK_ACCOUNT", "ACCOUNT": "BANK_ACCOUNT",
    "ACCOUNTNUMBER": "BANK_ACCOUNT", "USBANKNUMBER": "US_BANK_NUMBER",
    "BANKROUTING": "BANK_ROUTING", "ROUTING": "BANK_ROUTING",
    "ROUTINGNUMBER": "BANK_ROUTING",
    "ID": "ID_NUMBER", "IDNUMBER": "ID_NUMBER", "IDNUM": "ID_NUMBER",
    "CASENUMBER": "CASE_NUMBER", "CASENO": "CASE_NUMBER",
    "DOCKET": "CASE_NUMBER", "DOCKETNUMBER": "CASE_NUMBER",
    "POLICYNUMBER": "POLICY_NUMBER", "POLICY": "POLICY_NUMBER",
    "VEHICLEID": "VEHICLE_ID", "VIN": "VEHICLE_ID",
    "LICENSEPLATE": "VEHICLE_ID", "PLATE": "VEHICLE_ID",
    # Medical / PHI
    "MEDICALLICENSE": "MEDICAL_LICENSE",
    "MEDICALRECORDNUMBER": "MEDICAL_RECORD_NUMBER",
    "MEDICALRECORD": "MEDICAL_RECORD_NUMBER", "MRN": "MEDICAL_RECORD_NUMBER",
    "MEDICALCONDITION": "MEDICAL_CONDITION", "CONDITION": "MEDICAL_CONDITION",
    "DIAGNOSIS": "MEDICAL_CONDITION", "DISEASE": "MEDICAL_CONDITION",
    "MEDICATION": "MEDICATION", "DRUG": "MEDICATION", "MEDICINE": "MEDICATION",
    # Employment / other quasi-identifiers
    "PROFESSION": "PROFESSION", "JOB": "PROFESSION", "OCCUPATION": "PROFESSION",
    "TITLE": "PROFESSION",
    # Fail-safe bucket
    "OTHERPHI": "OTHER_PHI", "PHI": "OTHER_PHI", "PII": "OTHER_PHI",
    "QUASIIDENTIFIER": "OTHER_PHI", "OTHER": "OTHER_PHI",
}


def _map_type(raw: Any) -> str:
    """Map a model-emitted label to a canonical type. Unknown -> OTHER_PHI.

    Fails SAFE: an unrecognized label still redacts (as OTHER_PHI) rather than
    being silently dropped, so a model that invents a label never leaks."""
    if not isinstance(raw, str):
        return "OTHER_PHI"
    norm = re.sub(r"[^A-Z0-9]", "", raw.upper())
    if norm in _TYPE_MAP:
        return _TYPE_MAP[norm]
    if norm in _CANONICAL_TYPES:  # already canonical (defensive)
        return norm
    return "OTHER_PHI"


# ---------------------------------------------------------------------------
# THE DETECTION PROMPT (the crux).
# ---------------------------------------------------------------------------
# Design choices baked in:
#   * We ask for EXACT SUBSTRINGS, never character offsets — LLMs miscount
#     offsets. We locate the substrings ourselves (see _locate_spans).
#   * Output is a bare JSON array of {"text","type"} objects for easy parsing.
#   * The instruction is legal-domain aware and explicitly EXCLUDES public legal
#     authorities (statutes, case citations, court names) which are NOT PII.
#   * Recall is prioritized: "when unsure, INCLUDE it" — precision is handled by
#     the surrounding ensemble + human review.
_SYSTEM_PROMPT = """\
You are a meticulous legal-redaction assistant. Your only job is to find every \
piece of personal, private, or health information (PII/PHI) that a professional \
legal redactor would black out of a document before it is shared or filed publicly.

Return ONLY a JSON array. Each element is an object with exactly two keys:
  "text": the EXACT substring copied verbatim from the input (character-for-character,
          including its original capitalization, punctuation, and spacing).
  "type": one of the allowed type labels below.

Do NOT return character positions or offsets. Do NOT wrap the array in another \
object. Do NOT add commentary. If there is no PII/PHI, return [].

FIND AND LABEL every occurrence of:
  - Names of people, including partial names, INITIALS and ALIASES ("C.D.", \
"J.R.", "Mr. R.", "Johnny"), nicknames, and unusual or non-English names. -> PERSON
  - RELATIONAL identifiers that point to a specific individual even without a \
name ("the plaintiff's daughter", "his ex-wife", "the victim's employer", \
"her treating physician"). -> PERSON
  - Organizations, companies, employers, schools, hospitals, insurers. -> ORGANIZATION
  - Nationality, ethnicity, religion, or political affiliation of a person. -> NRP
  - Locations and full or partial mailing addresses, street names, cities, \
states, ZIP/postal codes. -> STREET_ADDRESS for street-level addresses, LOCATION \
for cities/states/regions.
  - Dates of birth and death. -> DATE_OF_BIRTH
  - Other personal dates tied to an individual (admission, injury, marriage, \
appointment dates). -> PERSONAL_DATE
  - A person's age or age range. -> AGE
  - Email addresses -> EMAIL_ADDRESS; phone/fax numbers -> PHONE_NUMBER; URLs -> \
URL; IP addresses -> IP_ADDRESS; usernames/handles -> USERNAME.
  - Social Security numbers -> US_SSN; ITINs -> US_ITIN; passports -> US_PASSPORT; \
driver's licenses -> US_DRIVER_LICENSE; EIN/tax IDs -> US_EIN.
  - Credit-card numbers -> CREDIT_CARD; IBANs -> IBAN_CODE; crypto wallet \
addresses -> CRYPTO; bank account numbers -> BANK_ACCOUNT; routing numbers -> \
BANK_ROUTING.
  - Case/docket numbers -> CASE_NUMBER; insurance policy numbers -> POLICY_NUMBER; \
vehicle VIN / license plates -> VEHICLE_ID; any other reference, account, badge, \
or ID number (including novel or internal formats) -> ID_NUMBER.
  - Medical license numbers -> MEDICAL_LICENSE; medical record numbers -> \
MEDICAL_RECORD_NUMBER; diagnoses, conditions, injuries -> MEDICAL_CONDITION; \
drugs/medications -> MEDICATION.
  - A person's profession or job title when it helps identify them. -> PROFESSION
  - QUASI-IDENTIFIERS: any detail that, combined with others, could single out a \
person (rare job + city, distinctive physical trait, unusual event). -> OTHER_PHI
  - Anything else identifying that does not fit above. -> OTHER_PHI

DO NOT REDACT (these are NOT PII — leave them out entirely):
  - Public legal authorities: statute and regulation citations (e.g. "42 U.S.C. \
1983", "Fed. R. Civ. P. 12(b)(6)"), reported case citations, and the NAMES OF \
COURTS as institutions ("the Ninth Circuit", "Superior Court of California").
  - Generic legal role words on their own ("plaintiff", "defendant", "the Court", \
"counsel") — redact the person's NAME, not the role word.
  - Common dictionary words, generic products, and boilerplate contract language.

RULES:
  - Copy "text" EXACTLY as it appears. Never paraphrase, correct, complete, or \
invent text. If you cannot copy it verbatim from the input, do not include it.
  - List each distinct string once; the caller finds all of its occurrences.
  - When you are unsure whether something is identifying, INCLUDE it. Missing \
real PII is far worse than an extra candidate.
"""

_USER_TEMPLATE = "Redact this text. Return only the JSON array.\n\nTEXT:\n{text}\n\nJSON:"


def build_detection_messages(text: str) -> list[dict[str, str]]:
    """OpenAI-style ``messages`` for the detection call. Exposed for testing
    and for callers that want to inspect/log the prompt (PII-free system half)."""
    return [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": _USER_TEMPLATE.format(text=text)},
    ]


# ---------------------------------------------------------------------------
# Robust output parsing.
# ---------------------------------------------------------------------------
def _extract_json_array(content: str) -> list[Any] | None:
    """Pull a JSON array out of the model's raw text, tolerating markdown code
    fences, leading/trailing prose, and an accidental ``{"spans": [...]}`` wrap.

    Returns the parsed list, or ``None`` if nothing array-shaped is recoverable."""
    if not isinstance(content, str):
        return None
    text = content.strip()
    if not text:
        return None

    # Strip a ```json ... ``` (or bare ```) fence if present.
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL | re.IGNORECASE)
    if fence:
        text = fence.group(1).strip()

    # Preferred: a top-level array. Grab from the first '[' to the last ']'.
    lo, hi = text.find("["), text.rfind("]")
    if 0 <= lo < hi:
        try:
            parsed = json.loads(text[lo : hi + 1])
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            pass

    # Fallback: the model wrapped the array in an object, e.g. {"spans":[...]}.
    ob_lo, ob_hi = text.find("{"), text.rfind("}")
    if 0 <= ob_lo < ob_hi:
        try:
            obj = json.loads(text[ob_lo : ob_hi + 1])
        except json.JSONDecodeError:
            return None
        if isinstance(obj, dict):
            for val in obj.values():
                if isinstance(val, list):
                    return val
    return None


def _normalize_items(parsed: Iterable[Any]) -> list[tuple[str, str]]:
    """Coerce parsed elements into ``(text, canonical_type)`` pairs.

    Tolerates ``{"text","type"}`` objects, alternate key names, and bare
    strings. Silently skips malformed / empty elements — never fabricates."""
    items: list[tuple[str, str]] = []
    for el in parsed:
        if isinstance(el, dict):
            raw_text = (
                el.get("text")
                or el.get("value")
                or el.get("string")
                or el.get("entity")
            )
            raw_type = el.get("type") or el.get("label") or el.get("category")
        elif isinstance(el, str):
            raw_text, raw_type = el, None
        else:
            continue
        if not isinstance(raw_text, str):
            continue
        sub = raw_text.strip()
        if not sub:
            continue
        items.append((sub, _map_type(raw_type)))
    return items


# ---------------------------------------------------------------------------
# Over-redaction guard (D1).
# ---------------------------------------------------------------------------
# Because _locate_spans emits EVERY occurrence of every returned substring, a
# degraded or prompt-injected model that returns ultra-common short tokens
# ("a", "the") — or is coaxed into "mark every word" — would black out the whole
# document. This can NEVER cause a leak (the hallucination guard still holds),
# but it is an availability/usability risk on this opt-in layer. So we drop
# LLM-returned substrings under 3 chars or that are common English stopwords.
# EXCEPTION: structured identifiers (SSN/EIN/ID/account/phone/...) where a short
# token can be legitimate PII (e.g. a 4-digit account tail).
_STRUCTURED_ID_TYPES: frozenset[str] = frozenset(
    {
        "US_SSN", "US_ITIN", "US_PASSPORT", "US_DRIVER_LICENSE",
        "US_BANK_NUMBER", "US_EIN", "CREDIT_CARD", "IBAN_CODE", "CRYPTO",
        "BANK_ACCOUNT", "BANK_ROUTING", "ID_NUMBER", "CASE_NUMBER",
        "POLICY_NUMBER", "VEHICLE_ID", "MEDICAL_LICENSE",
        "MEDICAL_RECORD_NUMBER", "PHONE_NUMBER", "IP_ADDRESS",
    }
)

# Deliberately small: the handful of ultra-common words a degraded model tends
# to over-return. Not an exhaustive stopword corpus (that would risk dropping
# real short names/aliases the LLM layer exists to catch).
_STOPWORDS: frozenset[str] = frozenset(
    {
        "a", "an", "the", "and", "or", "but", "if", "of", "to", "in", "on",
        "at", "by", "for", "is", "was", "are", "were", "be", "been", "as",
        "it", "he", "she", "they", "we", "you", "that", "this", "with",
        "from", "not", "no", "his", "her", "its", "our", "their",
    }
)


def _passes_over_redaction_guard(sub: str, etype: str) -> bool:
    """Reject ultra-common short tokens (D1). Structured identifiers are exempt,
    since a short token can be a legitimate identifier fragment there."""
    if etype in _STRUCTURED_ID_TYPES:
        return True
    if len(sub) < 3:
        return False
    if sub.lower() in _STOPWORDS:
        return False
    return True


# ---------------------------------------------------------------------------
# Offset mapping + HALLUCINATION GUARD.
# ---------------------------------------------------------------------------
# The model returns substrings, not offsets. We find each substring in the
# ORIGINAL text ourselves. This is also the hallucination guard: a span is only
# ever emitted for text that literally exists in the input, so the model can
# never cause us to redact text it invented.
def _is_word_bounded(text: str, start: int, end: int) -> bool:
    """A match is word-bounded if it is not glued to an alphanumeric neighbor on
    a side that is itself alphanumeric. This stops "Ann" from matching inside
    "Announce"/"Anne", while still allowing punctuation-led/-trailed substrings
    like "C.D." or "742 Evergreen Terrace" to match naturally."""
    left_ok = (
        start == 0
        or not text[start - 1].isalnum()
        or not text[start].isalnum()
    )
    right_ok = (
        end >= len(text)
        or not text[end].isalnum()
        or not text[end - 1].isalnum()
    )
    return left_ok and right_ok


def _locate_spans(
    text: str, items: list[tuple[str, str]], *, default_score: float
) -> list[dict[str, Any]]:
    """Map ``(substring, type)`` pairs to concrete offset spans.

    Behavior (per the design contract):
      * ALL occurrences of each substring are emitted (repeated PII is common).
      * Substrings are placed LONGEST-FIRST and each claims its character range,
        so a short substring can never carve a partial span out of, or overlap,
        a longer one already claimed (the engine's _dedupe would otherwise have
        to untangle it; we keep the output clean).
      * Matches must be WORD-BOUNDED (see _is_word_bounded).
      * HALLUCINATION GUARD: a substring that does not appear verbatim in the
        text is DROPPED with a warning. We never fabricate a span.
    """
    spans: list[dict[str, Any]] = []
    claimed: list[tuple[int, int]] = []  # sorted, non-overlapping kept ranges

    def _overlaps(s: int, e: int) -> bool:
        for cs, ce in claimed:
            if s < ce and cs < e:
                return True
        return False

    # Longest-first so the most specific (longest) PII wins the characters.
    for sub, etype in sorted(items, key=lambda it: len(it[0]), reverse=True):
        if not _passes_over_redaction_guard(sub, etype):
            # Over-redaction guard tripped: common short token on a non-ID type.
            log.debug(
                "llm_pii_over_redaction_dropped type=%s len=%d", etype, len(sub)
            )
            continue
        found_any = False
        search_from = 0
        while True:
            idx = text.find(sub, search_from)
            if idx < 0:
                break
            end = idx + len(sub)
            search_from = idx + 1  # allow overlapping literal occurrences
            if not _is_word_bounded(text, idx, end):
                continue
            if _overlaps(idx, end):
                found_any = True  # already covered by a longer span; fine
                continue
            spans.append(
                {"type": etype, "start": idx, "end": end, "score": default_score}
            )
            claimed.append((idx, end))
            claimed.sort()
            found_any = True
        if not found_any:
            # Hallucination guard tripped: model returned text not in the input.
            log.warning(
                "llm_pii_substring_not_found type=%s len=%d", etype, len(sub)
            )
    spans.sort(key=lambda s: s["start"])
    return spans


# ---------------------------------------------------------------------------
# Public entry point.
# ---------------------------------------------------------------------------
def llm_pii_spans(
    text: str,
    *,
    client: LlmClient,
    model: str | None = None,
    strict: bool = False,
    timeout: float = 30.0,
    default_score: float = 0.6,
) -> list[dict[str, Any]]:
    """LLM-detected PII/PHI spans, in engine.py's span shape.

    Args:
        text: the CLEARTEXT to scan. Reminder: ``client`` MUST be sovereign
            (self-hosted Forge). Never pass a third-party-backed client here.
        client: injected callable ``client(messages, *, model, timeout) -> str``
            returning the assistant's raw text content (see :class:`ForgeChatClient`
            for the default sovereign adapter).
        model: model id passed through to the client (client may default it).
        strict: if True, a client/transport error or an unparseable response
            RAISES :class:`LlmRedactionError` so the caller can fail CLOSED.
            If False (default), those conditions FAIL OPEN (return ``[]``): the
            layer is additive, so its absence only reduces recall.
        timeout: per-call timeout (seconds) forwarded to the client.
        default_score: confidence stamped on emitted spans. 0.6 keeps LLM spans
            below the deterministic layers (score 0.9-1.0) so a declared/regex
            span wins ties in ``engine._dedupe``, while still redacting.

    Returns:
        list of ``{"type","start","end","score"}`` dicts, start-sorted and
        non-overlapping, ready to union with the other layers' spans.
    """
    if not text or not text.strip():
        return []

    messages = build_detection_messages(text)
    try:
        content = client(messages, model=model, timeout=timeout)
    except LlmRedactionError:
        # Transport/shape failure from the client (e.g. Forge unreachable). This is
        # an ADDITIVE layer: in non-strict it must FAIL OPEN (return []) so a Forge
        # blip never crashes an otherwise-successful redaction; only strict raises.
        if strict:
            raise
        log.error("llm_pii_client_error type=LlmRedactionError (fail-open)")
        return []
    except Exception as exc:  # any other transport / client failure
        log.error("llm_pii_client_error exc_type=%s", type(exc).__name__)
        if strict:
            raise LlmRedactionError("llm_client_error") from exc
        return []

    parsed = _extract_json_array(content)
    if parsed is None:
        log.error("llm_pii_unparseable_output")
        if strict:
            raise LlmRedactionError("llm_unparseable_output")
        return []

    items = _normalize_items(parsed)
    return _locate_spans(text, items, default_score=default_score)


# ---------------------------------------------------------------------------
# Default SOVEREIGN adapter (optional, thin, stdlib-only).
# ---------------------------------------------------------------------------
class ForgeChatClient:
    """Thin OpenAI-compatible chat/completions client for Lana's SOVEREIGN Forge.

    Injected into :func:`llm_pii_spans` as the ``client``. Deliberately minimal:
    it exists so callers do not hand-roll HTTP, NOT to make third-party targets
    convenient. It marks requests ``x-sovereign: true`` and should only ever be
    pointed at ``GATEWAY_INFERENCE_URL`` / the self-hosted Forge endpoint. Do not
    construct it with a third-party base_url — that would send cleartext PII off
    the sovereign boundary and defeat redaction.

    Uses stdlib ``urllib`` (no added runtime dependency). The ``post_json`` hook
    is injectable so this class itself stays unit-testable without a network.
    """

    def __init__(
        self,
        base_url: str,
        *,
        model: str,
        api_key: str = "",
        sovereign: bool = True,
        max_output_tokens: int = 1500,
        post_json: Callable[..., dict[str, Any]] | None = None,
    ) -> None:
        self._url = base_url
        self._model = model
        self._api_key = api_key
        self._sovereign = sovereign
        self._max_output_tokens = max_output_tokens
        self._post_json = post_json or _default_post_json

    def __call__(
        self,
        messages: list[dict[str, str]],
        *,
        model: str | None = None,
        timeout: float = 30.0,
    ) -> str:
        headers = {
            "Content-Type": "application/json",
            # Forge sits behind Cloudflare, which 403s the default urllib UA.
            "User-Agent": "lana-redactor/1.0",
        }
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        if self._sovereign:
            headers["x-sovereign"] = "true"
        payload = {
            "model": model or self._model,
            "temperature": 0,
            "max_tokens": self._max_output_tokens,
            "stream": False,
            "messages": messages,
        }
        response = self._post_json(self._url, headers, payload, timeout)
        try:
            content = response["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise LlmRedactionError("unexpected_completion_shape") from exc
        if not isinstance(content, str):
            raise LlmRedactionError("unexpected_completion_shape")
        return content


def _default_post_json(
    url: str, headers: dict[str, str], payload: dict[str, Any], timeout: float
) -> dict[str, Any]:
    """POST ``payload`` as JSON and return the parsed JSON response. stdlib-only.

    Raises :class:`LlmRedactionError` on any transport/decoding failure so the
    strict/non-strict policy in :func:`llm_pii_spans` applies uniformly."""
    import urllib.error
    import urllib.request

    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:  # pragma: no cover - thin wrapper
        raise LlmRedactionError(f"inference_http_{exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:  # pragma: no cover
        raise LlmRedactionError("inference_unreachable") from exc
    except json.JSONDecodeError as exc:  # pragma: no cover - thin wrapper
        raise LlmRedactionError("inference_non_json_body") from exc
