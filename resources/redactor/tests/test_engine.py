"""Engine tests that work without the heavy Presidio model.

A stub analyzer returns a fixed entity list — that lets us exercise tokenization
logic deterministically, independent of spaCy's NER quality.
"""

from dataclasses import dataclass

import pytest

from redactor.engine import (
    _PRESIDIO_ENTITY_ALLOWLIST,
    RESEARCH_READABLE_TYPES,
    RedactionUnavailable,
    detect,
    redact,
    redact_scoped,
)


@dataclass
class FakeSpan:
    entity_type: str
    start: int
    end: int
    score: float


class FakeAnalyzer:
    def __init__(self, spans):
        self._spans = spans

    def analyze(self, text, language):
        return self._spans


class RecordingAnalyzer:
    """Records the kwargs passed to analyze and accepts the entities filter,
    like the real Presidio AnalyzerEngine."""

    def __init__(self, spans=None):
        self._spans = spans or []
        self.last_entities = "UNSET"

    def analyze(self, text, language, entities=None):
        self.last_entities = entities
        return self._spans


def test_case_number_redacted_by_regex_without_analyzer():
    result = redact("Case 24-CV-1234 is unresolved.", analyzer=None)
    assert "24-CV-1234" not in result.redacted
    assert any(e["type"] == "CASE_NUMBER" for e in result.entities)
    assert any(v == "24-CV-1234" for v in result.token_map.values())


def test_person_redacted_with_fake_analyzer():
    analyzer = FakeAnalyzer([FakeSpan("PERSON", 0, 10, 0.95)])
    result = redact("John Smith called the firm.", analyzer=analyzer)
    assert "John Smith" not in result.redacted
    assert "[REDACTED_PERSON_001]" in result.redacted
    assert result.token_map["REDACTED_PERSON_001"] == "John Smith"


def test_overlapping_spans_dedupe():
    analyzer = FakeAnalyzer(
        [FakeSpan("PERSON", 0, 10, 0.9), FakeSpan("EMAIL", 5, 9, 0.8)]
    )
    result = redact("John Smith called.", analyzer=analyzer)
    assert "John Smith" not in result.redacted
    # Only one token emitted because the EMAIL span lives inside PERSON.
    assert result.redacted.count("REDACTED_") == 1


def test_empty_text_passes_through():
    result = redact("", analyzer=None)
    assert result.redacted == ""
    assert result.token_map == {}
    assert result.entities == []


def test_case_number_does_not_match_agency_tokens():
    # Reviewer A8: the prior regex matched IRS-1040, OK-2024, etc. and
    # scrambled normal legal/agency prose. These must NOT be redacted now.
    for benign in (
        "Per IRS-1040 line 12",
        "Filing OK-2024 guidance",
        "Issued by FBI-9999",
        "U.S. citizen",
    ):
        result = redact(benign, analyzer=None)
        assert result.redacted == benign, (
            f"benign token wrongly redacted: input={benign!r} got={result.redacted!r}"
        )
        assert result.entities == [], (
            f"benign token produced entities: {result.entities}"
        )


def test_case_number_still_matches_docket_style():
    for docket in (
        "see 24-CV-1234 for details",
        "Case 1:23-cv-04567 is unresolved",
        "Docket 2024-CR-0017 dismissed",
    ):
        result = redact(docket, analyzer=None)
        assert "24-CV-1234" not in result.redacted or "1:23-cv-04567" in docket
        # At least one CASE_NUMBER entity should be produced
        assert any(e["type"] == "CASE_NUMBER" for e in result.entities), (
            f"docket missed: {docket!r}"
        )


# --- full mode + protected_terms (matter full-protect) -------------------------


def test_full_mode_redacts_detected_entity_and_declared_term():
    # Full-protect for matter context: a detected PERSON (via NER) AND a
    # non-entity declared codename ("Project Zephyr", which NER won't flag) are
    # BOTH redacted, and both are restorable from the token map.
    text = "John Smith leads Project Zephyr."
    analyzer = FakeAnalyzer([FakeSpan("PERSON", 0, 10, 0.95)])
    result = redact(text, analyzer=analyzer, protected_terms=["Project Zephyr"])
    assert "John Smith" not in result.redacted
    assert "Project Zephyr" not in result.redacted
    assert result.token_map["REDACTED_PERSON_001"] == "John Smith"
    assert any(
        v == "Project Zephyr" and k.startswith("REDACTED_PROTECTED_")
        for k, v in result.token_map.items()
    )


def test_full_mode_without_terms_is_plain_ner():
    # Back-compat: full mode with no protected_terms behaves exactly as before
    # (NER + backstops only; no PROTECTED spans).
    analyzer = FakeAnalyzer([FakeSpan("PERSON", 0, 10, 0.95)])
    result = redact("John Smith called.", analyzer=analyzer)
    assert "John Smith" not in result.redacted
    assert not any(e["type"] == "PROTECTED" for e in result.entities)


def test_full_mode_declared_term_caught_without_analyzer():
    # Even with NER unavailable (analyzer=None), a declared codename is still
    # redacted by the shared protected-term span builder.
    result = redact(
        "Codename Project Zephyr active.",
        analyzer=None,
        protected_terms=[{"term": "Project Zephyr", "category": "CLIENT"}],
    )
    assert "Project Zephyr" not in result.redacted
    assert "[REDACTED_CLIENT_001]" in result.redacted


# --- baseline mode (research tier) ---------------------------------------------


def test_baseline_keeps_reference_types_and_redacts_high_risk():
    # Research tier: names/orgs (research-readable) stay in the clear while
    # high-risk PII (SSN, email) is stripped before inference. SSN + email are
    # caught by the regex backstops; the readable_types filter keeps PERSON.
    text = "John Smith, SSN 123-45-6789, jane@example.com"
    analyzer = FakeAnalyzer([FakeSpan("PERSON", 0, 10, 0.95)])
    result = redact(text, analyzer=analyzer, readable_types=RESEARCH_READABLE_TYPES)
    assert "John Smith" in result.redacted  # PERSON kept readable
    assert "123-45-6789" not in result.redacted  # SSN stripped
    assert "jane@example.com" not in result.redacted  # email stripped
    assert "123-45-6789" in result.token_map.values()
    assert "jane@example.com" in result.token_map.values()


def test_baseline_keeps_person_that_full_mode_redacts():
    # The SAME name is redacted in full mode but kept in baseline -- proving the
    # tier is a real, deliberate difference and not a no-op.
    analyzer = FakeAnalyzer([FakeSpan("PERSON", 0, 10, 0.95)])
    full = redact("John Smith called.", analyzer=analyzer)
    base = redact(
        "John Smith called.", analyzer=analyzer, readable_types=RESEARCH_READABLE_TYPES
    )
    assert "John Smith" not in full.redacted  # full-protect hides the name
    assert "John Smith" in base.redacted  # baseline keeps it readable


def test_baseline_redacts_non_readable_type():
    # A detected type NOT on the keep-list (here a medical condition) is stripped
    # in baseline even though the name stays readable. Fail-safe by construction:
    # anything not explicitly research-readable is redacted.
    text = "John Smith has hepatitis."
    analyzer = FakeAnalyzer(
        [FakeSpan("PERSON", 0, 10, 0.95), FakeSpan("MEDICAL_CONDITION", 15, 24, 0.9)]
    )
    result = redact(text, analyzer=analyzer, readable_types=RESEARCH_READABLE_TYPES)
    assert "John Smith" in result.redacted
    assert "hepatitis" not in result.redacted


def test_baseline_redacts_url_and_nrp():
    # URL (can embed tokens/opaque IDs) and NRP (nationality/religion/political,
    # GDPR special-category) are NOT in the keep-set -- redacted in baseline.
    text = "See https://x.com/reset?token=abc9f as he is Canadian."
    url, nrp = "https://x.com/reset?token=abc9f", "Canadian"
    analyzer = FakeAnalyzer(
        [
            FakeSpan("URL", text.index(url), text.index(url) + len(url), 0.9),
            FakeSpan("NRP", text.index(nrp), text.index(nrp) + len(nrp), 0.85),
        ]
    )
    result = redact(text, analyzer=analyzer, readable_types=RESEARCH_READABLE_TYPES)
    assert url not in result.redacted
    assert "Canadian" not in result.redacted


def test_baseline_redacts_street_address_keeps_city():
    # Carve-out: a street-level LOCATION (leading house number) is a residence and
    # is redacted, but a bare city LOCATION stays readable. "42 Rue de Rivoli" has
    # no US street suffix, so it reaches the filter as a LOCATION, not a regex hit.
    text = "Meeting at 42 Rue de Rivoli then Denver."
    street, city = "42 Rue de Rivoli", "Denver"
    analyzer = FakeAnalyzer(
        [
            FakeSpan(
                "LOCATION", text.index(street), text.index(street) + len(street), 0.9
            ),
            FakeSpan("LOCATION", text.index(city), text.index(city) + len(city), 0.9),
        ]
    )
    result = redact(text, analyzer=analyzer, readable_types=RESEARCH_READABLE_TYPES)
    assert "42 Rue de Rivoli" not in result.redacted  # street-level -> redacted
    assert "Denver" in result.redacted  # city -> readable


def test_baseline_overlapping_readable_span_does_not_shield_high_risk():
    # A readable PERSON span OVERLAPPING an SSN must not shield it: the keep-set
    # filter runs BEFORE _dedupe, so the PERSON span is dropped and dedupe then
    # redacts the SSN. If the order were reversed the PERSON could evict the SSN
    # span in dedupe and both would leak -- this pins the ordering.
    text = "Ref 123-45-6789 end"
    ssn = "123-45-6789"
    analyzer = FakeAnalyzer([FakeSpan("PERSON", 0, text.index(ssn) + len(ssn), 0.95)])
    result = redact(text, analyzer=analyzer, readable_types=RESEARCH_READABLE_TYPES)
    assert ssn not in result.redacted


def test_baseline_keeps_bare_country_location_readable():
    # Live-QA regression: "What is the SSN format used in the United States?" had
    # "United States" (a bare country -> LOCATION) tokenized, so the model refused
    # ("cannot confirm the location [redacted]") and invented citations. A bare
    # place reference MUST stay readable in the open-research baseline tier.
    text = "What is the SSN format used in the United States?"
    loc = "United States"
    analyzer = FakeAnalyzer(
        [FakeSpan("LOCATION", text.index(loc), text.index(loc) + len(loc), 0.9)]
    )
    result = redact(text, analyzer=analyzer, readable_types=RESEARCH_READABLE_TYPES)
    assert "United States" in result.redacted  # place reference stays readable
    assert "REDACTED_LOCATION" not in result.redacted


def test_full_mode_still_redacts_country_location():
    # The MOAT guard for the same span: full-protect / matter mode (readable_types
    # is None) MUST still tokenize the LOCATION. This pins that the QA fix lives in
    # the baseline tier ONLY and does not weaken full-protect.
    text = "What is the SSN format used in the United States?"
    loc = "United States"
    analyzer = FakeAnalyzer(
        [FakeSpan("LOCATION", text.index(loc), text.index(loc) + len(loc), 0.9)]
    )
    result = redact(text, analyzer=analyzer, readable_types=None)
    assert "United States" not in result.redacted
    assert "[REDACTED_LOCATION_001]" in result.redacted


def test_baseline_keeps_person_org_location_but_strips_high_risk():
    # End-to-end research scenario: a real person, org, and country all stay
    # readable, while a real SSN, credit card, and US street address are stripped
    # (SSN/CC/street come from the regex backstops, independent of readable_types).
    text = (
        "Jane Roe at Acme Corporation in the United States; SSN 123-45-6789, "
        "card 4111 1111 1111 1111, home 1900 Halsted Street."
    )
    analyzer = FakeAnalyzer(
        [
            FakeSpan("PERSON", text.index("Jane Roe"),
                     text.index("Jane Roe") + len("Jane Roe"), 0.95),
            FakeSpan("ORGANIZATION", text.index("Acme Corporation"),
                     text.index("Acme Corporation") + len("Acme Corporation"), 0.9),
            FakeSpan("LOCATION", text.index("United States"),
                     text.index("United States") + len("United States"), 0.9),
        ]
    )
    result = redact(text, analyzer=analyzer, readable_types=RESEARCH_READABLE_TYPES)
    # Kept readable (research stays useful):
    assert "Jane Roe" in result.redacted
    assert "Acme Corporation" in result.redacted
    assert "United States" in result.redacted
    # Stripped (high-risk structured PII + residential address):
    assert "123-45-6789" not in result.redacted
    assert "4111 1111 1111 1111" not in result.redacted
    assert "1900 Halsted Street" not in result.redacted


def test_full_mode_redacts_person_org_location_no_regression():
    # MOAT regression guard: full mode (readable_types=None) tokenizes PERSON,
    # ORGANIZATION, and LOCATION, i.e. the baseline carve-out changed nothing on
    # the full-protect path.
    text = "Jane Roe at Acme Corporation in the United States."
    analyzer = FakeAnalyzer(
        [
            FakeSpan("PERSON", text.index("Jane Roe"),
                     text.index("Jane Roe") + len("Jane Roe"), 0.95),
            FakeSpan("ORGANIZATION", text.index("Acme Corporation"),
                     text.index("Acme Corporation") + len("Acme Corporation"), 0.9),
            FakeSpan("LOCATION", text.index("United States"),
                     text.index("United States") + len("United States"), 0.9),
        ]
    )
    result = redact(text, analyzer=analyzer, readable_types=None)
    for original in ("Jane Roe", "Acme Corporation", "United States"):
        assert original not in result.redacted
    assert "[REDACTED_PERSON_001]" in result.redacted
    assert "[REDACTED_ORGANIZATION_001]" in result.redacted
    assert "[REDACTED_LOCATION_001]" in result.redacted


# --- scoped mode (matter vault) ------------------------------------------------


def test_scoped_redacts_only_protected_terms():
    # The core win: the matter's client is hidden, public case law is kept.
    text = "John Smith should cite Miranda v. Arizona in the brief."
    result = redact_scoped(text, ["John Smith"])
    assert "John Smith" not in result.redacted
    assert "Miranda v. Arizona" in result.redacted
    assert "[REDACTED_PROTECTED_001]" in result.redacted
    assert result.token_map["REDACTED_PROTECTED_001"] == "John Smith"


def test_scoped_is_case_insensitive_and_preserves_original_casing():
    result = redact_scoped("Contact JOHN smith now.", ["John Smith"])
    assert "JOHN smith" not in result.redacted
    # Token map keeps the ACTUAL text span so un-redaction restores it verbatim.
    assert result.token_map["REDACTED_PROTECTED_001"] == "JOHN smith"


def test_scoped_whole_token_only():
    # "France" must not redact inside "Frances"; matching is word-bounded.
    result = redact_scoped("Frances visited France.", ["France"])
    assert "Frances" in result.redacted
    assert result.redacted.count("REDACTED_") == 1


def test_scoped_longest_first_no_prefix_eating():
    result = redact_scoped("Acme Corp sued Acme.", ["Acme", "Acme Corp"])
    # "Acme Corp" matched as one unit; standalone "Acme" matched separately.
    assert "Acme Corp" not in result.redacted
    assert result.redacted.count("REDACTED_") == 2


def test_scoped_uses_declared_category_as_token_type():
    result = redact_scoped(
        "Case 24-CV-1234 belongs to Globex.",
        [
            {"term": "24-CV-1234", "category": "CASE_NUMBER"},
            {"term": "Globex", "category": "CLIENT"},
        ],
    )
    assert "[REDACTED_CASE_NUMBER_001]" in result.redacted
    assert "[REDACTED_CLIENT_001]" in result.redacted


def test_scoped_empty_terms_passes_through():
    result = redact_scoped("Nothing to hide here.", [])
    assert result.redacted == "Nothing to hide here."
    assert result.token_map == {}
    assert result.entities == []


def test_scoped_token_format_matches_full_mode():
    # Gateway un-redaction relies on identical [REDACTED_TYPE_NNN] formatting.
    result = redact_scoped("alpha beta alpha", ["alpha"])
    assert "[REDACTED_PROTECTED_001]" in result.redacted
    assert "[REDACTED_PROTECTED_002]" in result.redacted


# --- entity allowlist: misclassification + over-redaction fixes ----------------


def test_allowlist_excludes_foreign_and_datetime_entities():
    # 51-scenario UAT regression: country-specific recognizers misclassified US
    # data (a US card matched IN_PAN), and DATE_TIME over-redacted ordinary dates.
    # Neither may be in the default Presidio allowlist.
    for forbidden in ("IN_PAN", "IN_AADHAAR", "AU_ABN", "UK_NHS", "SG_NRIC",
                      "DATE_TIME"):
        assert forbidden not in _PRESIDIO_ENTITY_ALLOWLIST, (
            f"{forbidden} must not be an allowed Presidio entity"
        )
    # The genuinely sensitive identifiers MUST be present.
    for required in ("PERSON", "EMAIL_ADDRESS", "PHONE_NUMBER", "US_SSN",
                     "US_BANK_NUMBER", "CREDIT_CARD", "ORGANIZATION", "LOCATION"):
        assert required in _PRESIDIO_ENTITY_ALLOWLIST, (
            f"{required} must be an allowed Presidio entity"
        )


def test_default_entity_filter_passed_to_analyzer():
    # The engine must constrain Presidio to the allowlist by default, so foreign
    # recognizers never run even if the default AnalyzerEngine is built.
    analyzer = RecordingAnalyzer()
    redact("nothing sensitive here", analyzer=analyzer)
    assert analyzer.last_entities is not None
    assert "IN_PAN" not in analyzer.last_entities
    assert "DATE_TIME" not in analyzer.last_entities
    assert "CREDIT_CARD" in analyzer.last_entities


def test_explicit_entities_override_is_honored():
    analyzer = RecordingAnalyzer()
    redact("text", analyzer=analyzer, entities=["PERSON", "US_SSN"])
    assert analyzer.last_entities == ["PERSON", "US_SSN"]


def test_us_credit_card_is_credit_card_not_in_pan():
    # The card number must be redacted as CREDIT_CARD (financial), never IN_PAN.
    # Uses the regex backstop alone (analyzer=None) so this is deterministic.
    result = redact("Card 4111 1111 1111 1111 on file.", analyzer=None)
    assert "4111 1111 1111 1111" not in result.redacted
    types = {e["type"] for e in result.entities}
    assert "CREDIT_CARD" in types
    assert "IN_PAN" not in types
    # The captured original digits are restorable from the CREDIT_CARD token.
    assert any(
        "4111 1111 1111 1111" in v
        for k, v in result.token_map.items()
        if k.startswith("REDACTED_CREDIT_CARD_")
    )


def test_ordinary_date_not_over_redacted_by_regex_path():
    # With analyzer=None the regex backstops must not touch a plain date.
    result = redact("The hearing is on March 3, 2024 at noon.", analyzer=None)
    assert result.redacted == "The hearing is on March 3, 2024 at noon."
    assert result.entities == []


def test_ssn_email_phone_still_caught_via_backstops_and_stub():
    # SSN is guaranteed by regex backstop even without Presidio.
    result = redact("SSN 123-45-6789 belongs to the client.", analyzer=None)
    assert "123-45-6789" not in result.redacted
    assert any(e["type"] == "US_SSN" for e in result.entities)


def test_email_caught_by_regex_backstop_without_presidio():
    # Email is a deterministic identifier; it must be redacted even in the
    # degraded (regex-only, analyzer=None) posture, not left to leak because
    # Presidio's EMAIL_ADDRESS recognizer is the only thing that catches it.
    result = redact(
        "Contact counsel at jane.doe+legal@example.co.uk regarding the matter.",
        analyzer=None,
    )
    assert "jane.doe+legal@example.co.uk" not in result.redacted
    assert any(e["type"] == "EMAIL_ADDRESS" for e in result.entities)
    # The full address is covered (no trailing domain fragment left in the clear).
    assert "example.co.uk" not in result.redacted


def test_email_backstop_collapses_with_presidio_span_no_double_redaction():
    # Neutrality guarantee for the FULL stack: when Presidio ALSO flags the email
    # (EMAIL_ADDRESS span over the same chars), the regex backstop's identical-type
    # span must _dedupe away — exactly ONE token, no double redaction and no span
    # boundary drift. This is why adding the floor cannot change full-stack (ML)
    # eval precision/F1: the detected-span set over the email is unchanged.
    text = "Reach me at jane.doe@example.com please."
    start = text.index("jane.doe@example.com")
    end = start + len("jane.doe@example.com")
    analyzer = FakeAnalyzer([FakeSpan("EMAIL_ADDRESS", start, end, 0.99)])
    result = redact(text, analyzer=analyzer)
    assert "jane.doe@example.com" not in result.redacted
    email_tokens = [k for k in result.token_map if k.startswith("REDACTED_EMAIL_ADDRESS_")]
    assert len(email_tokens) == 1, result.token_map
    email_spans = [e for e in result.entities if e["type"] == "EMAIL_ADDRESS"]
    assert len(email_spans) == 1, email_spans


def test_email_backstop_precision_leaves_ordinary_at_prose_alone():
    # The "@" + dotted-domain structure is required, so an "@" used in ordinary
    # prose (a Twitter-style handle, "see item @ page 5") is NOT redacted — the
    # backstop must not scramble non-email text (precision guard).
    text = "Escalate to @counsel and bill @ the standard rate per section 5."
    result = redact(text, analyzer=None)
    assert result.redacted == text
    assert not any(e["type"] == "EMAIL_ADDRESS" for e in result.entities)


def test_fake_analyzer_without_entities_kwarg_still_works():
    # Back-compat: a stub analyzer whose analyze() ignores the entities kwarg must
    # not trip the degrade-to-regex path. PERSON spans must still be redacted.
    analyzer = FakeAnalyzer([FakeSpan("PERSON", 0, 10, 0.95)])
    result = redact("John Smith called the firm.", analyzer=analyzer)
    assert "John Smith" not in result.redacted
    assert "[REDACTED_PERSON_001]" in result.redacted


# --- PHI: biomedical NER + medical/identifier backstops ------------------------


@dataclass
class FakeEnt:
    label_: str
    start_char: int
    end_char: int
    text: str = ""


class FakeMedDoc:
    def __init__(self, ents):
        self.ents = ents


class FakeMedicalNlp:
    """Stub for the scispaCy biomedical model: callable returning a doc whose
    .ents have label_/start_char/end_char/text, like a real spaCy Doc."""

    def __init__(self, ents):
        self._ents = ents

    def __call__(self, text):
        # Populate .text from the real string, exactly as spaCy does, so the
        # engine's stopword check (ent.text) has something to read.
        for e in self._ents:
            e.text = text[e.start_char:e.end_char]
        return FakeMedDoc(self._ents)


def test_disease_and_chemical_mapped_to_phi_tokens():
    # DISEASE -> MEDICAL_CONDITION, CHEMICAL -> MEDICATION, via the stub model.
    text = "Dx schizophrenia, rx lithium."
    nlp = FakeMedicalNlp(
        [FakeEnt("DISEASE", 3, 16), FakeEnt("CHEMICAL", 21, 28)]
    )
    result = redact(text, analyzer=None, medical_nlp=nlp)
    assert "schizophrenia" not in result.redacted
    assert "lithium" not in result.redacted
    assert "[REDACTED_MEDICAL_CONDITION_001]" in result.redacted
    assert "[REDACTED_MEDICATION_001]" in result.redacted


def test_unmapped_biomedical_label_ignored():
    # Labels we don't map (e.g. a hypothetical "SPECIES") must not redact.
    text = "observed sample here"
    nlp = FakeMedicalNlp([FakeEnt("SPECIES", 9, 15)])
    result = redact(text, analyzer=None, medical_nlp=nlp)
    assert result.redacted == text
    assert result.entities == []


def test_medical_model_failure_degrades_without_crashing():
    # A model that raises must not take down redaction; backstops still run.
    class BoomNlp:
        def __call__(self, text):
            raise RuntimeError("model exploded")

    result = redact("MRN 88812345 on file.", analyzer=None, medical_nlp=BoomNlp())
    assert "88812345" not in result.redacted
    assert any(e["type"] == "MEDICAL_RECORD_NUMBER" for e in result.entities)


def test_medical_record_number_context_backstop():
    result = redact("MRN 88812345 admitted today.", analyzer=None)
    assert "88812345" not in result.redacted
    # The label word stays; only the value is redacted.
    assert result.redacted.startswith("MRN [REDACTED_MEDICAL_RECORD_NUMBER_001]")
    assert any(
        v == "88812345"
        for k, v in result.token_map.items()
        if k.startswith("REDACTED_MEDICAL_RECORD_NUMBER_")
    )


def test_badge_number_context_backstop():
    result = redact("Badge number 4471 reported.", analyzer=None)
    assert "4471" not in result.redacted
    assert "[REDACTED_BADGE_NUMBER_001]" in result.redacted


def test_policy_number_context_backstop():
    result = redact("See policy number BX-9981234 attached.", analyzer=None)
    assert "BX-9981234" not in result.redacted
    assert "[REDACTED_POLICY_NUMBER_001]" in result.redacted


def test_bare_number_not_over_redacted():
    # Without a medical/badge/policy anchor a short number is NOT PII and must
    # pass through untouched (the whole point of context-anchoring).
    result = redact("The room number is 4471 down the hall.", analyzer=None)
    assert result.redacted == "The room number is 4471 down the hall."
    assert result.entities == []


def test_medical_acronym_case_sensitive():
    # Canonical uppercase acronym is redacted...
    result = redact("History of HIV noted.", analyzer=None)
    assert "[REDACTED_MEDICAL_CONDITION_001]" in result.redacted
    assert "HIV" not in result.redacted


def test_medical_acronym_lowercase_not_over_redacted():
    # ...but the lowercase verb "aids" must NOT be redacted as the condition.
    result = redact("This aids the investigation.", analyzer=None)
    assert result.redacted == "This aids the investigation."
    assert result.entities == []


# --- adversarial-review regressions --------------------------------------------


def test_partial_overlap_span_tail_does_not_leak():
    # Reviewer CRITICAL-1: a shorter PERSON span overlapping the START of a
    # longer medical span must NOT drop the medical tail. Merge => fully redacted.
    text = "AAAAAAAAAABBBBBBBBBBCCCCCCCCCC"  # 30 chars
    analyzer = FakeAnalyzer([FakeSpan("PERSON", 0, 20, 0.95)])
    nlp = FakeMedicalNlp([FakeEnt("DISEASE", 10, 30)])
    result = redact(text, analyzer=analyzer, medical_nlp=nlp)
    # The medical tail [20,30) must NOT survive (the bug leaked "CCCCCCCCCC").
    assert "CCCCCCCCCC" not in result.redacted
    assert "BBBBBBBBBB" not in result.redacted
    # And it round-trips: the merged token restores the full original span.
    restored = result.redacted
    for k, v in result.token_map.items():
        restored = restored.replace(f"[{k}]", v)
    assert restored == text


def test_preexisting_token_literal_is_neutralized():
    # Reviewer CRITICAL-2: a [REDACTED_*]-shaped literal already in the input is
    # the collision vector. After neutralization the LLM-facing redacted text
    # must (a) contain NO duplicate token names and (b) contain no real PII, so a
    # minted token can never silently alias the injected literal.
    text = "Memo [REDACTED_PERSON_001] re Sarah Klein dispute."
    start = text.index("Sarah Klein")
    analyzer = FakeAnalyzer([FakeSpan("PERSON", start, start + len("Sarah Klein"), 0.95)])
    result = redact(text, analyzer=analyzer)
    import re as _re

    toks = _re.findall(r"\[REDACTED_[A-Za-z0-9_]+\]", result.redacted)
    assert len(toks) == len(set(toks)), f"duplicate tokens in LLM text: {toks}"
    assert "Sarah Klein" not in result.redacted
    # The pre-existing literal was captured (so it does not masquerade as a live
    # PERSON token) and is restorable from its own ESCAPED_TOKEN entry.
    assert any(
        v == "[REDACTED_PERSON_001]"
        for k, v in result.token_map.items()
        if k.startswith("REDACTED_ESCAPED_TOKEN_")
    )


def test_policy_bare_word_plus_number_not_over_redacted():
    # Reviewer HIGH-1: ordinary prose must survive; only a qualified policy
    # NUMBER is redacted.
    for benign in (
        "The new policy 12345 reduces costs.",
        "claim 9999 was filed in court.",
        "Group 5 students enrolled.",
    ):
        result = redact(benign, analyzer=None)
        assert result.redacted == benign, f"over-redacted: {benign!r} -> {result.redacted!r}"


def test_policy_with_qualifier_is_redacted():
    result = redact("See policy number BX-9981234 attached.", analyzer=None)
    assert "BX-9981234" not in result.redacted
    assert "[REDACTED_POLICY_NUMBER_001]" in result.redacted


def test_chemical_stopword_not_over_redacted():
    # Reviewer HIGH-2: a ubiquitous non-drug chemical must not redact.
    text = "Alcohol use is heavy in the area."
    nlp = FakeMedicalNlp([FakeEnt("CHEMICAL", 0, 7)])  # "Alcohol"
    result = redact(text, analyzer=None, medical_nlp=nlp)
    assert result.redacted == text


def test_icd_code_redacted_including_subtype():
    # Reviewer CRITICAL-3: the ICD code AND its post-dot subtype must redact.
    result = redact("Dx ICD-10 code F20.0 confirmed.", analyzer=None)
    assert "F20.0" not in result.redacted
    assert any(e["type"] == "ICD_CODE" for e in result.entities)


def test_medical_phrase_caught_without_model():
    # Reviewer CRITICAL-3: SUD/condition phrases the model misses are caught by
    # the deterministic phrase list even with NO biomedical model loaded.
    result = redact("History of opioid use disorder and hepatitis C.", analyzer=None)
    assert "opioid use disorder" not in result.redacted
    assert "hepatitis C" not in result.redacted


def test_mrn_with_filler_word():
    # Reviewer HIGH-3: "MRN is 88812345" (filler) must still redact.
    result = redact("Patient MRN is 88812345 today.", analyzer=None)
    assert "88812345" not in result.redacted
    assert any(e["type"] == "MEDICAL_RECORD_NUMBER" for e in result.entities)


def test_lab_value_redacted():
    result = redact("Labs: A1c 9.2% and CD4 count 210.", analyzer=None)
    assert "9.2%" not in result.redacted
    assert "210" not in result.redacted


def test_lab_value_multiword_filler():
    # "CD4 count is 210" has two filler words before the value; 210 must redact.
    result = redact("Her CD4 count is 210 today.", analyzer=None)
    assert "210" not in result.redacted


def test_ner_label_word_not_redacted_as_name():
    # spaCy tagging the bare word "MRN" as PERSON must be dropped; the VALUE is
    # still caught by the MRN backstop.
    text = "Patient MRN is 88812345 today."
    analyzer = FakeAnalyzer([FakeSpan("PERSON", 8, 11, 0.9)])  # "MRN"
    result = redact(text, analyzer=analyzer)
    assert "MRN" in result.redacted  # label word preserved
    assert "88812345" not in result.redacted  # value redacted
    assert any(e["type"] == "MEDICAL_RECORD_NUMBER" for e in result.entities)


class FakeDeid:
    """Stub for the HF de-id token-classification pipeline: callable returning a
    list of {entity_group,start,end,score} dicts."""

    def __init__(self, ents):
        self._ents = ents

    def __call__(self, text):
        return self._ents


def test_deid_maps_patient_and_id():
    text = "Marcus is 88812345 ok"
    stub = FakeDeid([
        {"entity_group": "PATIENT", "start": 0, "end": 6, "score": 0.9},
        {"entity_group": "ID", "start": 10, "end": 18, "score": 0.9},
    ])
    result = redact(text, analyzer=None, deid_ner=stub)
    assert "Marcus" not in result.redacted
    assert "88812345" not in result.redacted
    types = {e["type"] for e in result.entities}
    assert "PERSON" in types and "ID_NUMBER" in types


def test_deid_skips_bare_date_but_redacts_age():
    # Bare DATE from the model is intentionally NOT redacted (no date
    # over-redaction of benign legal dates; the identifying date, DOB, is caught
    # by the labeled recognizer instead). AGE IS now redacted — a quasi-identifier
    # the i2b2 model tags with a low false-positive rate.
    text = "Filed 2020 at age 45"
    stub = FakeDeid([
        {"entity_group": "DATE", "start": 6, "end": 10, "score": 0.9},
        {"entity_group": "AGE", "start": 18, "end": 20, "score": 0.9},
    ])
    result = redact(text, analyzer=None, deid_ner=stub)
    assert "2020" in result.redacted  # bare date preserved
    assert "45" not in result.redacted  # age redacted
    assert any(e["type"] == "AGE" for e in result.entities)


def test_labeled_dob_redacted_but_filing_date_preserved():
    # The date-of-birth recognizer catches the identifying date via its label,
    # while an ordinary filing date with no DOB label is left readable. No de-id
    # model needed — this is deterministic, label-anchored coverage.
    text = "DOB: 06/30/1968. Complaint filed on 03/15/2024."
    result = redact(text, analyzer=None, deid_ner=None)
    assert "06/30/1968" not in result.redacted  # DOB caught
    assert "03/15/2024" in result.redacted  # filing date preserved
    assert any(e["type"] == "DATE_OF_BIRTH" for e in result.entities)


def test_vin_redacted_as_deterministic_backstop():
    # 17-char VIN with a letter is caught; a 17-DIGIT run (no letter) is not a VIN.
    r = redact("Vehicle VIN 1HGCV1F30LA012345 impounded.", analyzer=None, deid_ner=None)
    assert "1HGCV1F30LA012345" not in r.redacted
    assert any(e["type"] == "VEHICLE_ID" for e in r.entities)


def test_bank_account_routing_and_last4():
    r = redact(
        "Account number 12345678, routing number 021000021, card ending in 7788.",
        analyzer=None, deid_ner=None,
    )
    for leaked in ("12345678", "021000021", "7788"):
        assert leaked not in r.redacted, leaked
    types = {e["type"] for e in r.entities}
    assert {"BANK_ACCOUNT", "BANK_ROUTING", "ACCOUNT_LAST4"} <= types


def test_username_requires_separator_or_handle_shape():
    # A handle after a separator, or a handle-SHAPED token (has a digit / . _ -),
    # is redacted...
    r = redact("Portal login: reincif was used.", analyzer=None, deid_ner=None)
    assert "reincif" not in r.redacted
    assert any(e["type"] == "USERNAME" for e in r.entities)
    r2 = redact("Account login jdoe_92 active.", analyzer=None, deid_ner=None)
    assert "jdoe_92" not in r2.redacted
    # ...but ordinary words after the VERBS "handle"/"login" are NOT over-redacted.
    for prose in (
        "Click the login page to continue.",
        "Counsel will handle discovery next week.",
        "Her login was reset by IT.",
    ):
        rr = redact(prose, analyzer=None, deid_ner=None)
        assert not any(e["type"] == "USERNAME" for e in rr.entities), prose


def test_ending_in_year_not_redacted_as_account():
    # "ending in <year>" is period phrasing, not a card fragment.
    r = redact("The lease term, ending in 2027, renews.", analyzer=None, deid_ner=None)
    assert "2027" in r.redacted
    assert not any(e["type"] == "ACCOUNT_LAST4" for e in r.entities)


def test_unlabeled_dob_appositive_to_name_redacted():
    # A date in apposition to a name (no DOB label) is an identifying birthdate;
    # a standalone date with no adjacent name is a benign filing date. Uses a stub
    # analyzer so a PERSON span exists without loading spaCy.
    text = "The victim, Jane Doe, 05/22/1990, filed on 03/15/2024."
    person_at = text.index("Jane Doe")

    class _A:
        def analyze(self, text, language, entities=None):
            class _R:
                entity_type = "PERSON"
                start = person_at
                end = person_at + len("Jane Doe")
                score = 0.99
            return [_R()]

    # de-id stub tags both dates as DATE candidates
    d1 = text.index("05/22/1990")
    d2 = text.index("03/15/2024")
    stub = FakeDeid([
        {"entity_group": "DATE", "start": d1, "end": d1 + 10, "score": 0.9},
        {"entity_group": "DATE", "start": d2, "end": d2 + 10, "score": 0.9},
    ])
    r = redact(text, analyzer=_A(), deid_ner=stub)
    assert "05/22/1990" not in r.redacted  # appositive to name -> DOB, redacted
    assert "03/15/2024" in r.redacted  # standalone filing date -> preserved
    assert any(e["type"] == "DATE_OF_BIRTH" for e in r.entities)
    # the provisional candidate type must never survive to output
    assert "_DATE_CANDIDATE" not in r.redacted


def _person_analyzer(text, name):
    """Stub analyzer that tags a single PERSON span at ``name``'s position."""
    at = text.index(name)

    class _A:
        def analyze(self, text, language, entities=None):
            class _R:
                entity_type = "PERSON"
                start = at
                end = at + len(name)
                score = 0.99
            return [_R()]

    return _A()


def _date_stub(text, date):
    """FakeDeid tagging ``date`` in ``text`` as a bare DATE candidate."""
    at = text.index(date)
    return FakeDeid([{"entity_group": "DATE", "start": at, "end": at + len(date), "score": 0.9}])


def test_personal_dates_on_redacts_person_linked_treatment_date():
    # HIPAA Safe-Harbor: a treatment date anchored to a clinician/person is PHI.
    # "seen by Dr. Reyes on 11/15/2019" leaks with mode OFF; mode ON scrubs it as
    # a distinct PERSONAL_DATE (not DATE_OF_BIRTH — it is not a birthdate).
    text = "Patient was seen by Dr. Reyes on 11/15/2019 for evaluation."
    r = redact(
        text,
        analyzer=_person_analyzer(text, "Reyes"),
        deid_ner=_date_stub(text, "11/15/2019"),
        personal_dates=True,
    )
    assert "11/15/2019" not in r.redacted
    assert any(e["type"] == "PERSONAL_DATE" for e in r.entities)
    assert "_DATE_CANDIDATE" not in r.redacted


def test_personal_dates_on_redacts_death_date_near_name():
    text = "Jane Doe died on 01/02/2020 at the hospital."
    r = redact(
        text,
        analyzer=_person_analyzer(text, "Jane Doe"),
        deid_ner=_date_stub(text, "01/02/2020"),
        personal_dates=True,
    )
    assert "01/02/2020" not in r.redacted
    assert any(e["type"] == "PERSONAL_DATE" for e in r.entities)


def test_personal_dates_on_preserves_filing_date():
    # Institutional/case date must stay readable even in personal-date mode.
    text = "Complaint filed on 03/15/2024 in county court."
    r = redact(
        text,
        analyzer=None,
        deid_ner=_date_stub(text, "03/15/2024"),
        personal_dates=True,
    )
    assert "03/15/2024" in r.redacted
    assert not any(e["type"] in ("PERSONAL_DATE", "DATE_OF_BIRTH") for e in r.entities)


def test_personal_dates_on_preserves_hearing_date():
    text = "A hearing set for 04/01/2025 before the judge."
    r = redact(
        text,
        analyzer=None,
        deid_ner=_date_stub(text, "04/01/2025"),
        personal_dates=True,
    )
    assert "04/01/2025" in r.redacted
    assert not any(e["type"] in ("PERSONAL_DATE", "DATE_OF_BIRTH") for e in r.entities)


def test_personal_dates_on_signing_date_near_name_stays_readable():
    # Conflict guard: a name next to a signing/execution date must NOT be
    # over-redacted; "signed" is an institutional-event verb that wins.
    text = "Jane Doe signed the release on 03/15/2024."
    r = redact(
        text,
        analyzer=_person_analyzer(text, "Jane Doe"),
        deid_ner=_date_stub(text, "03/15/2024"),
        personal_dates=True,
    )
    assert "03/15/2024" in r.redacted
    assert not any(e["type"] == "PERSONAL_DATE" for e in r.entities)


def test_personal_dates_off_preserves_treatment_date():
    # Mode OFF (default): current behavior. A person-linked treatment date that
    # is NOT in strict apposition is dropped (left readable); only an appositive
    # DOB is scrubbed. This proves general legal redaction is unchanged.
    text = "Patient was seen by Dr. Reyes on 11/15/2019 for evaluation."
    r = redact(
        text,
        analyzer=_person_analyzer(text, "Reyes"),
        deid_ner=_date_stub(text, "11/15/2019"),
    )
    assert "11/15/2019" in r.redacted  # not redacted with mode OFF
    assert not any(e["type"] in ("PERSONAL_DATE", "DATE_OF_BIRTH") for e in r.entities)


def test_personal_dates_off_still_redacts_appositive_dob():
    # Mode OFF must still catch the strict-apposition DOB (unchanged behavior).
    text = "The victim, Jane Doe, 05/22/1990, testified."
    r = redact(
        text,
        analyzer=_person_analyzer(text, "Jane Doe"),
        deid_ner=_date_stub(text, "05/22/1990"),
    )
    assert "05/22/1990" not in r.redacted
    assert any(e["type"] == "DATE_OF_BIRTH" for e in r.entities)


def test_deid_unknown_label_fails_closed_to_other_phi():
    text = "xx secret yy"
    stub = FakeDeid([{"entity_group": "MYSTERY", "start": 3, "end": 9, "score": 0.9}])
    result = redact(text, analyzer=None, deid_ner=stub)
    assert "secret" not in result.redacted
    assert any(e["type"] == "OTHER_PHI" for e in result.entities)


def test_deid_failure_degrades_without_crashing():
    class BoomDeid:
        def __call__(self, text):
            raise RuntimeError("pipeline exploded")

    result = redact("MRN 88812345 on file.", analyzer=None, deid_ner=BoomDeid())
    assert "88812345" not in result.redacted  # regex floor still catches it
    assert any(e["type"] == "MEDICAL_RECORD_NUMBER" for e in result.entities)


def test_deid_low_confidence_span_dropped():
    # The "policy 12345"->PHONE@0.44 false positive must be dropped by threshold.
    text = "The new policy 12345 reduces costs."
    stub = FakeDeid([{"entity_group": "PHONE", "start": 15, "end": 18, "score": 0.44}])
    result = redact(text, analyzer=None, deid_ner=stub)
    assert result.redacted == text


def test_deid_phone_without_digit_dropped():
    # "Call"->PHONE@0.72 (no digit) must be dropped.
    text = "Call Marcus now."
    stub = FakeDeid([{"entity_group": "PHONE", "start": 0, "end": 4, "score": 0.72}])
    result = redact(text, analyzer=None, deid_ner=stub)
    assert result.redacted == text


def test_deid_partial_number_span_snapped_to_full_token():
    # Model tags only "123" of "12345"; snapping must redact the WHOLE number so
    # no digits are left in the clear.
    text = "ref 12345 end"
    stub = FakeDeid([{"entity_group": "ID", "start": 4, "end": 7, "score": 0.9}])
    result = redact(text, analyzer=None, deid_ner=stub)
    assert "12345" not in result.redacted
    assert "45 end" not in result.redacted  # no leftover tail
    assert "[REDACTED_ID_NUMBER_001]" in result.redacted


def test_protected_term_category_sanitized():
    # Reviewer MEDIUM-1: a malicious vault category can't inject brackets into
    # the token; the map key stays well-formed and the value is restorable.
    result = redact_scoped("redact zzz now", [{"term": "zzz", "category": "[EVIL]"}])
    assert "zzz" not in result.redacted
    # Token type sanitized to EVIL (brackets stripped), key has no stray bracket.
    assert "[REDACTED_EVIL_001]" in result.redacted
    assert all("[" not in k and "]" not in k for k in result.token_map)


# --- STRICT / fail-closed mode -------------------------------------------------
#
# The "safe for lawyers" guarantee: rather than silently degrade to regex-only
# coverage (which misses names/orgs/locations/conditions), strict mode raises
# RedactionUnavailable so the caller WITHHOLDS the text. The gateway turns the
# resulting 503 into a fail-closed error; it never forwards under-redacted text.


class _ThrowingAnalyzer:
    """Analyzer whose analyze() raises, simulating a model that failed to load
    or blew up mid-request. Accepts the entities kwarg like real Presidio so the
    engine's TypeError-retry shim does not mask the error."""

    def analyze(self, text, language, entities=None):
        raise RuntimeError("presidio model unavailable")


class _ThrowingMedical:
    def __call__(self, text):
        raise RuntimeError("scispacy model unavailable")


class _ThrowingDeid:
    def __call__(self, text):
        raise RuntimeError("deid pipeline unavailable")


def test_strict_analyzer_none_fails_closed():
    # Required NER layer not loaded + strict => refuse (no regex-only 200).
    with pytest.raises(RedactionUnavailable) as ei:
        redact("John Smith SSN 123-45-6789", analyzer=None, strict=True)
    assert ei.value.reason == "ner_unavailable"


def test_strict_analyzer_none_non_strict_degrades_not_raises():
    # Non-strict (dev default): analyzer=None degrades to regex backstops and
    # returns 200. The SSN is still caught, but a NAME leaks — exactly the silent
    # degradation strict mode exists to forbid.
    result = redact("John Smith SSN 123-45-6789", analyzer=None, strict=False)
    assert "123-45-6789" not in result.redacted  # regex backstop still fires
    assert "John Smith" in result.redacted  # NER-only entity leaks (degraded)


def test_strict_analyzer_mid_request_error_fails_closed():
    with pytest.raises(RedactionUnavailable) as ei:
        redact("John Smith", analyzer=_ThrowingAnalyzer(), strict=True)
    assert ei.value.reason == "ner_analyzer_error"


def test_non_strict_analyzer_mid_request_error_degrades_to_regex():
    # Current behavior preserved when strict is OFF: analyzer throws => continue
    # on regex backstops, return 200, do NOT raise.
    result = redact(
        "John Smith SSN 123-45-6789", analyzer=_ThrowingAnalyzer(), strict=False
    )
    assert "123-45-6789" not in result.redacted
    assert "John Smith" in result.redacted  # leaked, but no exception (degraded)


def test_strict_medical_mid_request_error_fails_closed():
    # A LOADED biomedical layer that throws must not be silently dropped in strict.
    with pytest.raises(RedactionUnavailable) as ei:
        redact(
            "patient text",
            analyzer=FakeAnalyzer([]),
            medical_nlp=_ThrowingMedical(),
            strict=True,
        )
    assert ei.value.reason == "medical_ner_error"


def test_strict_deid_mid_request_error_fails_closed():
    with pytest.raises(RedactionUnavailable) as ei:
        redact(
            "patient text",
            analyzer=FakeAnalyzer([]),
            deid_ner=_ThrowingDeid(),
            strict=True,
        )
    assert ei.value.reason == "deid_ner_error"


def test_strict_happy_path_returns_result():
    # Strict + analyzer present + no errors => normal redaction, no exception.
    analyzer = FakeAnalyzer([FakeSpan("PERSON", 0, 10, 0.95)])
    result = redact("John Smith called.", analyzer=analyzer, strict=True)
    assert "John Smith" not in result.redacted
    assert "[REDACTED_PERSON_001]" in result.redacted


# --- US street-address + ZIP recognizers ----------------------------------
# These are deterministic regex backstops (no analyzer needed): spaCy/de-id
# reliably tag the city/state as LOCATION but leave the house number, street
# line and unit in the clear. A human redactor blacks out the WHOLE address.


def test_full_street_address_is_fully_redacted_including_number_and_unit():
    # The whole street line — house number + name + suffix + unit — is one span;
    # nothing (esp. the leading number, previously leaked) survives.
    result = redact(
        "He resides at 4471 Sequoia Lane, Apt 3B, Sacramento, CA 95815.",
        analyzer=None,
    )
    assert "4471" not in result.redacted
    assert "Sequoia Lane" not in result.redacted
    assert "Apt 3B" not in result.redacted
    assert any(e["type"] == "STREET_ADDRESS" for e in result.entities)
    assert any(
        v == "4471 Sequoia Lane, Apt 3B" for v in result.token_map.values()
    )


def test_street_address_number_not_left_in_clear():
    # Regression for the 0.69 ADDRESS coverage: "1900 Halsted Street" used to
    # come back with only "Halsted Street" redacted and "1900" leaking.
    result = redact("detained at 1900 Halsted Street.", analyzer=None)
    assert "1900" not in result.redacted
    assert "Halsted" not in result.redacted
    assert any(
        v == "1900 Halsted Street" for v in result.token_map.values()
    )


def test_bare_street_name_in_prose_without_number_not_redacted():
    # Anchored on a house number, so a street NAME in ordinary prose (no number
    # in front) is NOT over-caught. Favors precision.
    result = redact("He walked down Main Street to the store.", analyzer=None)
    assert result.redacted == "He walked down Main Street to the store."
    assert not any(e["type"] == "STREET_ADDRESS" for e in result.entities)


def test_zip_after_state_is_redacted():
    result = redact("Boston, MA 02116 is the mailing address.", analyzer=None)
    assert "02116" not in result.redacted
    assert any(e["type"] == "ZIP" for e in result.entities)
    assert any(v == "02116" for v in result.token_map.values())


def test_zip_after_full_state_name_is_redacted():
    # A ZIP can trail a spelled-out state ("Naples, Florida 34102").
    result = redact("residing in Naples, Florida 34102, was defrauded.",
                    analyzer=None)
    assert "34102" not in result.redacted
    assert any(e["type"] == "ZIP" for e in result.entities)


def test_bare_five_digit_number_in_prose_not_redacted():
    # A 5-digit number with no state/ZIP context is not PII and stays readable.
    result = redact("The invoice total was 34102 dollars this quarter.",
                    analyzer=None)
    assert result.redacted == "The invoice total was 34102 dollars this quarter."
    assert not any(e["type"] == "ZIP" for e in result.entities)


# --- adversarial-review fixes: L2 unit address, L3 DOB span, O1 authorities, F1 ---


def test_l2_unit_designator_number_redacted_but_not_prose():
    r = redact("send resume to Suite 886.", analyzer=None, deid_ner=None)
    assert "886" not in r.redacted
    assert any(e["type"] == "UNIT_DESIGNATOR" for e in r.entities)
    for prose in ("Unit tests passed.", "Room service arrived.", "on the ground floor here."):
        rr = redact(prose, analyzer=None, deid_ner=None)
        assert rr.redacted == prose, prose


def test_l3_appositive_dob_full_date_covered_no_day_leak():
    text = "Maria Cruz (1952-08-19) is here."
    p = text.index("Maria Cruz")
    d = text.index("1952-08-19")
    # de-id UNDER-tags the date as '1952-08' (truncated); the day must not leak.
    stub = FakeDeid([{"entity_group": "DATE", "start": d, "end": d + len("1952-08"), "score": 0.9}])
    r = redact(text, analyzer=FakeAnalyzer([FakeSpan("PERSON", p, p + len("Maria Cruz"), 0.99)]),
               deid_ner=stub)
    assert "1952-08-19" not in r.redacted
    assert "-19" not in r.redacted  # the day-of-month did not survive
    assert any(e["type"] == "DATE_OF_BIRTH" for e in r.entities)


def test_o1_public_authority_citations_kept_readable():
    text = "Claim under 42 U.S.C. 1983 in the Superior Court of California."
    spans = [
        FakeSpan("ID_NUMBER", text.index("42"), text.index("42") + 2, 0.9),
        FakeSpan("ID_NUMBER", text.index("1983"), text.index("1983") + 4, 0.9),
        FakeSpan("ORGANIZATION", text.index("Superior"),
                 text.index("Superior") + len("Superior Court of California"), 0.9),
    ]
    r = redact(text, analyzer=FakeAnalyzer(spans), deid_ner=None)
    assert "42 U.S.C. 1983" in r.redacted  # statute cite readable
    assert "Superior Court of California" in r.redacted  # court name readable


def test_f1_llm_layer_fails_open_even_in_strict():
    from redactor.llm_redact import LlmRedactionError

    def boom(messages, *, model=None, timeout=30.0):
        raise LlmRedactionError("inference_unreachable")

    # strict + LLM client down must NOT raise: the LLM booster fails open, the
    # Presidio/de-id floor (which strict gates) still completes the redaction.
    r = redact("John Smith called.", analyzer=FakeAnalyzer([FakeSpan("PERSON", 0, 10, 0.95)]),
               strict=True, llm_client=boom)
    assert "John Smith" not in r.redacted


# --- provenance (source) + confidence on spans (human-in-the-loop propose) ---
def test_regex_backstop_spans_tagged_source_regex():
    r = redact("SSN 123-45-6789 and case 24-CV-1234.", analyzer=None)
    ssn = next(e for e in r.entities if e["type"] == "US_SSN")
    case = next(e for e in r.entities if e["type"] == "CASE_NUMBER")
    assert ssn["source"] == "regex"
    assert case["source"] == "regex"
    # confidence rides as the span score (deterministic backstops ~1.0).
    assert 0.0 <= ssn["score"] <= 1.0


def test_presidio_spans_tagged_source_presidio():
    r = redact("John Smith called.", analyzer=FakeAnalyzer([FakeSpan("PERSON", 0, 10, 0.9)]))
    person = next(e for e in r.entities if e["type"] == "PERSON")
    assert person["source"] == "presidio"
    assert person["score"] == 0.9


def test_protected_term_spans_tagged_source_term():
    r = redact("Project Zephyr is secret.", analyzer=None,
               protected_terms=[{"term": "Project Zephyr", "category": "CODENAME"}])
    term = next(e for e in r.entities if e["type"] == "CODENAME")
    assert term["source"] == "term"


def test_medical_backstop_spans_tagged_source_medical():
    r = redact("Patient has HIV and hepatitis C.", analyzer=None)
    med = next(e for e in r.entities if e["type"] in ("MEDICAL_CONDITION",))
    assert med["source"] == "medical"


def test_deid_spans_tagged_source_deid():
    class FakeDeid:
        def __call__(self, text):
            i = text.index("5551234567")
            return [{"entity_group": "PHONE", "start": i, "end": i + 10, "score": 0.95}]

    r = redact("Call 5551234567 now.", analyzer=None, deid_ner=FakeDeid())
    phone = next(e for e in r.entities if e["type"] == "PHONE_NUMBER")
    assert phone["source"] == "deid"


def test_llm_spans_tagged_source_llm(monkeypatch):
    import redactor.llm_redact as llm_mod

    def fake_llm_pii_spans(text, *, client, strict=False):
        i = text.index("Cee")
        return [{"type": "PERSON", "start": i, "end": i + 3, "score": 0.7}]

    monkeypatch.setattr(llm_mod, "llm_pii_spans", fake_llm_pii_spans)
    r = redact("Alias Cee appears.", analyzer=None, llm_client=object())
    person = next(e for e in r.entities if e["type"] == "PERSON")
    assert person["source"] == "llm"


def test_detect_returns_spans_without_emitting_tokens():
    text = "SSN 123-45-6789 here."
    spans = detect(text, analyzer=None)
    ssn = next(s for s in spans if s["type"] == "US_SSN")
    # Detect-only carries the shared metadata: type/start/end/score/source/text.
    assert ssn["source"] == "regex"
    assert ssn["text"] == "123-45-6789"
    assert text[ssn["start"]:ssn["end"]] == "123-45-6789"
    # No token emission side effects: detect returns spans, not redacted text.
    assert isinstance(spans, list)


def test_detect_strict_fails_closed_like_redact():
    with pytest.raises(RedactionUnavailable):
        detect("anything", analyzer=None, strict=True)
