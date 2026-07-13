"""Presidio + regex backstop redaction.

Thin wrapper because the gateway is the security-critical caller; this module's
job is to turn user text into (redacted_text, token_map, entities) and nothing
else. The token map is held in the caller's process memory for one request only
— this service is stateless.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


class RedactionUnavailable(RuntimeError):
    """Raised in STRICT mode when a required/loaded NER layer cannot run.

    The whole point of strict mode is the "safe for lawyers" guarantee: we would
    rather refuse to answer than hand back UNDER-redacted text (regex-only
    coverage misses names/orgs/locations/conditions). When the primary NER layer
    is unavailable at request time, or throws MID-REQUEST, we raise this instead
    of silently continuing on the regex backstops. main.py maps it to a 503
    ``{degraded: true, reason}`` response so the gateway fails CLOSED (withholds
    the text) rather than forwarding it to the model.

    ``reason`` is a short, greppable, PII-free code (e.g. ``ner_unavailable``,
    ``ner_analyzer_error``, ``medical_ner_error``, ``deid_ner_error``).
    """

    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


# Custom regex backstops for legal-domain identifiers that Presidio does not
# always catch. Reviewer A8: the previous pattern matched IRS-1040, OK-2024,
# FBI-9999 etc. — generic agency-and-number tokens that are not case numbers
# would get silently redacted, scrambling normal prose. Real case/docket
# numbers ALWAYS lead with a year/division prefix; we require it now.
# Matches: 24-CV-1234, 1:23-cv-04567, 2024-CR-0017.
_CASE_NUMBER_RE = re.compile(
    r"\b\d{1,4}(?::\d{1,4})?-(?:[A-Z]{1,4}|[a-z]{1,4})-\d{2,7}\b"
)

# Neutralize any [REDACTED_...]-shaped substring ALREADY present in the input
# (Reviewer CRITICAL-2). Left alone, such a literal survives into the redacted
# text and collides with a freshly-minted token of the same name; the gateway
# un-redacts by string-replace, so the injected slot gets filled with a
# DIFFERENT entity's real value (PII cross-contamination) or the round-trip
# corrupts. We redact each pre-existing token-shaped literal to its own fresh
# ESCAPED_TOKEN so no two identical tokens ever reach the gateway.
_EXISTING_TOKEN_RE = re.compile(r"\[REDACTED_[A-Za-z0-9_]+\]")


def _existing_token_spans(text: str) -> list[dict[str, Any]]:
    return [
        {"type": "ESCAPED_TOKEN", "start": m.start(), "end": m.end(),
         "score": 1.0, "source": "regex"}
        for m in _EXISTING_TOKEN_RE.finditer(text)
    ]

# US street-address recognizer. spaCy/de-id reliably tag the CITY/STATE of an
# address as LOCATION but routinely LEAVE the house number (and the street line
# itself, or a unit) in the clear — e.g. "1900 Halsted Street" came back with
# only "Halsted Street" redacted, "1900" leaking; "4471 Sequoia Lane, Apt 3B"
# left the number and unit exposed. A human redactor blacks out the WHOLE
# address. A street address has a recognizable FORMAT (house number + name +
# street suffix), so a dedicated deterministic recognizer is legitimate here,
# exactly like the SSN/VIN backstops — NOT a brittle name heuristic.
#
# It is ANCHORED on the number+suffix structure: a leading house number is
# REQUIRED, so a bare street NAME in prose ("he walked down Main Street") is not
# over-caught. This favors precision (measured on the eval). Captures the full
# street line as ONE span: house number, 1-3 street-name words (which also
# absorb an optional pre-directional like "N"/"North"), the street-type suffix,
# an optional post-directional, and an optional unit (Apt/Suite/Ste/Unit/#/...).
# City/State/ZIP that trail the street line are left to the LOCATION (spaCy/de-id)
# and ZIP recognizers so this pattern stays tight and high-precision.
_STREET_SUFFIX = (
    r"Street|St|Avenue|Ave|Av|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Way|"
    r"Court|Ct|Place|Pl|Terrace|Ter|Circle|Cir|Highway|Hwy|Parkway|Pkwy|"
    r"Trail|Trl|Square|Sq|Loop|Alley|Aly|Plaza|Plz|Row|Path|Pike|Crossing|"
    r"Xing|Commons|Cove|Run|Bend|Pass|Point|Pt|Walk|Turnpike|Tpke|Route|Rte"
)
_STREET_ADDRESS_RE = re.compile(
    r"\b\d{1,6}\s+"                                   # house number (digits only)
    r"(?:[A-Z][A-Za-z'.-]*\s+){1,3}"                  # 1-3 name words (abs. directional)
    r"(?:" + _STREET_SUFFIX + r")\b"                  # street-type suffix (whole token)
    r"(?:\s+(?:NE|NW|SE|SW|N|S|E|W)\b)?"              # optional post-directional
    r"(?:,?\s+(?:Apt|Apartment|Suite|Ste|Unit|Rm|Room|Fl|Floor|Bldg|Building|#)"
    r"\.?\s*#?\s*[A-Za-z0-9-]+)?"                     # optional unit / secondary designator
)

# US 2-letter state abbreviations (case-SENSITIVE uppercase) and full state
# names (capitalized). Used only to give the standalone ZIP recognizer a STRONG
# context so it does not redact every 5-digit number in prose.
_STATE_ABBR = (
    r"AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|"
    r"MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|"
    r"WI|WY|DC"
)
_STATE_NAME = (
    r"Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|"
    r"Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|"
    r"Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|"
    r"Missouri|Montana|Nebraska|Nevada|New\s+Hampshire|New\s+Jersey|New\s+Mexico|"
    r"New\s+York|North\s+Carolina|North\s+Dakota|Ohio|Oklahoma|Oregon|"
    r"Pennsylvania|Rhode\s+Island|South\s+Carolina|South\s+Dakota|Tennessee|"
    r"Texas|Utah|Vermont|Virginia|Washington|West\s+Virginia|Wisconsin|Wyoming"
)
# Standalone ZIP, only in a strong context: immediately after a state (abbrev or
# full name) or a "ZIP/postal[ code]" label. Capture GROUP 1 is the ZIP; this
# avoids redacting arbitrary 5-digit numbers (years, quantities, docket digits).
_ZIP_STATE_RE = re.compile(
    r"\b(?:" + _STATE_ABBR + r"|" + _STATE_NAME + r")\.?,?\s+(\d{5}(?:-\d{4})?)\b"
)
_ZIP_LABEL_RE = re.compile(
    r"(?i)\b(?:zip|postal)(?:\s+code)?\s*[:#=]?\s*(\d{5}(?:-\d{4})?)\b"
)


# Deterministic structured-identifier backstops. Presidio's statistical
# recognizers miss these inconsistently (the US_SSN recognizer in particular
# is context-sensitive and silently dropped "SSN 123-45-6789" in testing), so
# we guarantee them with regex — they are high-confidence, low-false-positive
# formats that must NEVER reach inference for a legal-grade product.
_BACKSTOPS: list[tuple[str, "re.Pattern[str]"]] = [
    # Email address: a deterministic, near-zero-false-positive identifier that was
    # previously covered ONLY by Presidio's EMAIL_ADDRESS recognizer — so in the
    # documented degraded (regex-only, no Presidio/spaCy) posture an email leaked
    # to inference. This floor guarantees it, exactly like the SSN/VIN backstops.
    # The local-part + "@" + dotted-domain + TLD structure is unambiguous, so it
    # does not scramble ordinary prose; when Presidio IS loaded it emits the same
    # EMAIL_ADDRESS span and _dedupe collapses the overlap, leaving full-stack
    # output (and the eval) unchanged. Same TYPE as Presidio so tokens/coarse-map
    # stay identical.
    ("EMAIL_ADDRESS",
     re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}\b")),
    # Full US street address (house number + name + street suffix [+ unit]) as a
    # single span, so the number/unit the NER layers leave in the clear are
    # blacked out with the street name. See _STREET_ADDRESS_RE.
    ("STREET_ADDRESS", _STREET_ADDRESS_RE),
    # US SSN / ITIN: 3-2-4 grouping. ITINs start with 9; both share the shape.
    ("US_SSN", re.compile(r"\b\d{3}-\d{2}-\d{4}\b")),
    # US EIN (employer ID): 2-7 grouping.
    ("US_EIN", re.compile(r"\b\d{2}-\d{7}\b")),
    # Credit-card-like: 13-16 digits in 4-digit groups (space or dash).
    ("CREDIT_CARD", re.compile(r"\b(?:\d[ -]?){13,16}\b")),
    # IBAN: country code + 2 check digits + up to 30 alnum.
    ("IBAN_CODE", re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b")),
    # VIN: exactly 17 chars, excludes I/O/Q by standard, and always contains at
    # least one letter (WMI) so a 17-digit account/phone run is not caught. A
    # fixed-format identifier, not a heuristic.
    ("VEHICLE_ID", re.compile(r"\b(?=[0-9]*[A-HJ-NPR-Z])[A-HJ-NPR-Z0-9]{17}\b")),
]


# Context-anchored identifier backstops. A bare short digit run (e.g. "4471")
# is usually NOT PII, so we deliberately do NOT redact bare numbers. We only
# redact when a medical / law-enforcement / insurance label immediately
# precedes the value. This keeps false positives low while catching the
# record/badge/policy numbers that NER either misses ("Badge number 4471") or
# misclassifies (an MRN tagged US_BANK_NUMBER). Capture GROUP 1 is the value to
# redact; the label word itself is left in place so prose stays readable.
# Optional "is/was/of"-style filler so a value that does not sit flush against
# its label ("MRN is 88812345", "Badge no. 4471") is still caught (Reviewer
# HIGH-3) without opening the pattern up to arbitrary distance.
_FILLER = r"(?:\s+(?:is|was|of|reads?))?"
_CONTEXT_BACKSTOPS: list[tuple[str, "re.Pattern[str]"]] = [
    # US ZIP code, only in a strong context (after a state, or a ZIP label) so a
    # bare 5-digit number in prose is not redacted. Captures group 1 (the ZIP).
    ("ZIP", _ZIP_STATE_RE),
    ("ZIP", _ZIP_LABEL_RE),
    (
        "MEDICAL_RECORD_NUMBER",
        re.compile(
            r"(?i)\b(?:MRN|medical\s+record(?:\s+(?:number|no\.?|#|id))?)"
            + _FILLER + r"\s*[:#=]?\s*([A-Z]{0,3}-?\d{3,12})\b"
        ),
    ),
    (
        "BADGE_NUMBER",
        re.compile(
            r"(?i)\b(?:badge|shield)\s*(?:number|no\.?|#|id)?"
            + _FILLER + r"\s*[:#=]?\s*(\d{2,7})\b"
        ),
    ),
    (
        # Reviewer HIGH-1: REQUIRE a real qualifier (number/no/#/id/:), so
        # ordinary prose like "the new policy 12345" or "claim 9999" is NOT
        # redacted; only an actual policy/claim NUMBER is. "group" dropped (too
        # common), min length raised to 4.
        "POLICY_NUMBER",
        re.compile(
            r"(?i)\b(?:policy|member|insurance|claim|subscriber)"
            r"(?:\s*(?:number|no\.?|id)\b|\s*[:#])"
            + _FILLER + r"\s*([A-Z]{0,4}-?\d{4,12})\b"
        ),
    ),
    (
        # Context-anchored ICD diagnosis codes (Reviewer CRITICAL-3). Anchored on
        # the "ICD" prefix so we never redact bare alphanumerics that merely look
        # like a code. Captures the full code incl. the subtype after the dot.
        "ICD_CODE",
        re.compile(
            r"(?i)\bICD[-\s]?(?:10|9)?(?:[-\s]?CM)?\s*(?:code)?\s*[:#]?\s*"
            r"([A-TV-Z]\d{2}(?:\.\d{1,4})?)\b"
        ),
    ),
    (
        # Common diagnostic lab values tied to a person (Reviewer CRITICAL-3:
        # "A1c 9.2%", "CD4 count 210"). Anchored on the test name; captures the
        # numeric result, which is the PHI.
        "LAB_VALUE",
        re.compile(
            r"(?i)\b(?:A1c|HbA1c|LDL|HDL|CD4|viral\s+load|cholesterol|"
            r"triglycerides|INR|PSA)\b"
            # Allow a few filler words ("count is", "level was") between the test
            # name and its value so "CD4 count is 210" still captures 210.
            r"(?:\s+(?:of|is|was|count|level|value|results?|at|reads?)){0,3}"
            r"\s*[:=]?\s*([<>]?\d+(?:\.\d+)?%?)"
        ),
    ),
    (
        # Date of birth: the date that actually IDENTIFIES a person, vs a benign
        # filing/contract/incident date. Anchored on a DOB label so ordinary legal
        # dates are left readable; captures the date value only. The de-id model's
        # bare DATE label is deliberately NOT used (it flags every date, tanking
        # precision on legal prose) — this precise labeled recognizer replaces it.
        "DATE_OF_BIRTH",
        re.compile(
            r"(?i)\b(?:DOB|D\.O\.B\.?|date\s+of\s+birth|birth\s*date|born(?:\s+(?:on|in))?)"
            + _FILLER + r"\s*[:#=]?\s*("
            r"\d{1,2}[/-]\d{1,2}[/-]\d{2,4}"  # 06/30/1968, 3-8-77
            r"|\d{4}-\d{1,2}-\d{1,2}"  # 1968-06-30
            # Month name with numeric day, incl. Mon-DD-YY dashed (Jun-30-68):
            r"|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?[\s/-]+\d{1,2}(?:st|nd|rd|th)?,?[\s/-]+\d{2,4}"
            # Numeric (optionally ordinal) day then month name: 9 June 2025, 3rd of May 1990:
            r"|\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}"
            r"|\d{4}"  # bare year, only reachable via the DOB label above
            r")\b"
        ),
    ),
    (
        # Bank/financial account number, label-anchored so bare digit runs are not
        # touched. Captures the account value; the label stays readable.
        "BANK_ACCOUNT",
        re.compile(
            r"(?i)\b(?:account|acct\.?|a/c)\s*(?:number|no\.?|#|id)?"
            + _FILLER + r"\s*[:#=]?\s*(\d{4,17})\b"
        ),
    ),
    (
        # Masked card/account fragment ("ending in 7788", "ending 3021"). The
        # "ending [in]" anchor is a strong financial-fragment signal; capture the
        # trailing group only.
        "ACCOUNT_LAST4",
        # "ending in 7788" is a card/account fragment; "ending in 2027" is a year,
        # not PII -- reject 19xx/20xx so period phrasing is not over-redacted.
        re.compile(r"(?i)\bending\s+(?:in\s+)?(?!(?:19|20)\d{2}\b)(\d{3,6})\b"),
    ),
    (
        # ABA/routing number: exactly 9 digits, label-anchored.
        "BANK_ROUTING",
        re.compile(
            r"(?i)\b(?:routing(?:\s+(?:number|no\.?|transit))?|ABA(?:\s+number)?|RTN)"
            + _FILLER + r"\s*[:#=]?\s*(\d{9})\b"
        ),
    ),
    (
        # Account username / login handle, label-anchored. Captures the handle
        # token (starts with a letter) after an explicit credential label so
        # ordinary prose ("login page") is unlikely to match a real-looking handle.
        "USERNAME",
        re.compile(
            r"(?i)\b(?:username|user\s*name|user\s*id|user\s*login|login\s*(?:id|name)?"
            r"|screen\s*name|handle)"
            # "handle"/"login" are also ordinary verbs ("will handle discovery",
            # "login page"). Only match a handle when it is EITHER introduced by an
            # explicit separator OR the following token is handle-SHAPED (contains a
            # digit or . _ -). A bare English word after the verb is left alone.
            r"(?:\s*[:#=]\s*|\s+(?=[A-Za-z0-9._-]*[0-9._-]))"
            r"([A-Za-z0-9][A-Za-z0-9._-]{2,31})\b"
        ),
    ),
    (
        # Standalone unit / secondary-address designator ("Suite 886", "Apt. 3B",
        # "Unit 502") that has NO preceding street line, so _STREET_ADDRESS_RE and
        # NER miss the number (L2). Anchored on the designator word; the captured
        # value must contain a DIGIT so ordinary prose ("Unit tests", "Room service",
        # "ground floor") is left alone. Redacts the value; the label stays readable.
        "UNIT_DESIGNATOR",
        re.compile(
            r"(?i)\b(?:Apt|Apartment|Suite|Ste|Unit|Rm|Room|Fl|Floor|Bldg|Building)"
            r"\.?\s*#?\s*([A-Za-z]?\d+[A-Za-z0-9-]*)\b"
        ),
    ),
]


# Multi-word conditions/diagnoses the statistical model misses wholesale
# (Reviewer CRITICAL-3: "opioid use disorder", "hepatitis C" leaked). Matched
# whole-token, case-insensitive, longest-first via the shared term matcher.
_MEDICAL_PHRASES: tuple[str, ...] = (
    "opioid use disorder", "alcohol use disorder", "substance use disorder",
    "alcohol dependence", "drug dependence", "alcohol abuse", "substance abuse",
    "major depressive disorder", "bipolar disorder", "panic disorder",
    "hepatitis a", "hepatitis b", "hepatitis c", "hepatitis",
    "herniated disc", "herniated disk", "herniated nucleus pulposus",
    # Unambiguous, high-sensitivity conditions the statistical model can miss in
    # terse shorthand ("Dx paranoid schizophrenia"). Whole-token, low false
    # positive. Not a substitute for human review, just a deterministic floor.
    "paranoid schizophrenia", "schizophrenia", "schizoaffective", "psychosis",
    "psychotic", "dementia", "epilepsy", "seizure disorder",
)


# bc5cdr tags CHEMICAL on ubiquitous non-drug nouns; redacting these scrambles
# ordinary prose (Reviewer HIGH-2: "alcohol", "water"). Skip them as MEDICATION
# (the diagnosis phrases above still cover the clinical use, e.g. "alcohol use
# disorder"). True drugs (aspirin, clozapine, ...) are intentionally NOT here.
_CHEMICAL_STOPWORDS: frozenset[str] = frozenset(
    {"alcohol", "water", "oxygen", "air", "salt", "sugar", "caffeine",
     "nicotine", "ethanol", "sodium", "saline"}
)


# spaCy sometimes tags a bare identifier-LABEL word ("SSN", "EIN", "DOB",
# "MRN") as PERSON/ORGANIZATION, which redacts the label itself and scrambles
# prose. These are never names: drop a PERSON/ORG span whose ENTIRE text is one
# of them. The VALUE beside the label is still caught by the structured/context
# backstops, so no identifier leaks.
_NER_LABEL_STOPWORDS: frozenset[str] = frozenset(
    {"SSN", "EIN", "ITIN", "TIN", "DOB", "MRN", "DL", "VIN", "NPI", "ID",
     "DX", "RX", "PII", "PHI",
     # Legal-role words a model mislabels as PERSON/ORG (over-redaction the eval
     # flagged). These are roles, not identities; the party's real name is
     # redacted separately by NER.
     "PLAINTIFF", "PLAINTIFFS", "DEFENDANT", "DEFENDANTS", "CLAIMANT",
     "RESPONDENT", "PETITIONER", "APPELLANT", "APPELLEE", "RELEASEE",
     "RELEASOR", "RELEASOR/RELEASEE", "LESSEE", "LESSOR", "GRANTOR", "GRANTEE",
     "DECLARANT", "AFFIANT", "DEPONENT", "WITNESS", "MOVANT", "CROSS-DEFENDANT",
     "COUNSEL", "ATTORNEY", "THE COURT", "COURT",
     # Form-label words (already partly covered) that read as medical/ID.
     "CD4", "AGE", "SEX", "RACE", "DOD"}
)


# Biomedical NER label -> our token TYPE. Source model is scispaCy
# ``en_ner_bc5cdr_md`` (built once in main.py, passed in like the Presidio
# analyzer so the engine stays a pure, stubbable function).
_MEDICAL_LABEL_MAP: dict[str, str] = {
    "DISEASE": "MEDICAL_CONDITION",
    "CHEMICAL": "MEDICATION",
}


# De-identification transformer (obi/deid_roberta_i2b2) label -> our token TYPE.
# This model learns CONTEXT, so it catches the identifiers the hand-written
# context-regex backstops are brittle about (medical record / ID / phone /
# location in free text). Keys are normalized (uppercased, '-'/'_' stripped) to
# survive label-name variation across model revisions.
_DEID_TYPE_MAP: dict[str, str] = {
    # obi/deid_roberta_i2b2 aggregated labels (verified from id2label).
    "PATIENT": "PERSON", "STAFF": "PERSON",
    "ID": "ID_NUMBER",
    "PHONE": "PHONE_NUMBER",
    "EMAIL": "EMAIL_ADDRESS",
    "HOSP": "ORGANIZATION", "PATORG": "ORGANIZATION",
    "LOC": "LOCATION",
    "OTHERPHI": "OTHER_PHI",
    # Extra aliases tolerated so a swapped-in de-id model (REDACTOR_DEID_MODEL)
    # with richer labels still maps cleanly instead of defaulting to OTHER_PHI.
    "DOCTOR": "PERSON", "NAME": "PERSON", "USERNAME": "USERNAME",
    "MEDICALRECORD": "MEDICAL_RECORD_NUMBER",
    "IDNUM": "ID_NUMBER", "BIOID": "ID_NUMBER",
    "DEVICE": "ID_NUMBER", "HEALTHPLAN": "ID_NUMBER", "FAX": "PHONE_NUMBER",
    "URL": "URL", "IPADDR": "IP_ADDRESS",
    "HOSPITAL": "ORGANIZATION", "ORGANIZATION": "ORGANIZATION",
    "ORG": "ORGANIZATION", "DEPARTMENT": "ORGANIZATION",
    "STREET": "LOCATION", "CITY": "LOCATION", "STATE": "LOCATION",
    "COUNTRY": "LOCATION", "ZIP": "LOCATION", "ROOM": "LOCATION",
    "LOCATION": "LOCATION", "LOCATIONOTHER": "LOCATION",
    # AGE is a quasi-identifier a human redactor catches, and the i2b2 model tags
    # it with low false-positive rate. DATE becomes a CANDIDATE (not redacted
    # outright): a bare date is not PII and flagging every one over-redacts benign
    # filing/contract dates, but a date in APPOSITION to a name ("John Smith,
    # 05/22/1990") is an identifying DOB a human blacks out. redact() keeps only
    # the appositive candidates (see _DATE_CANDIDATE_TYPE handling); the rest drop.
    "AGE": "AGE", "DATE": "_DATE_CANDIDATE",
}

# Provisional type for model-tagged dates, resolved in redact(): appositive-to-a-
# name candidates become DATE_OF_BIRTH, standalone dates are dropped. It must NEVER
# survive to output.
_DATE_CANDIDATE_TYPE = "_DATE_CANDIDATE"

# Deliberately NOT redacted from the de-id model: PROFESSION (high over-redaction
# with little identifying value). "O" is the non-entity tag. AGE is taken and DATE
# is taken as a candidate (see _DEID_TYPE_MAP). Regressions are caught by the eval.
_DEID_SKIP_LABELS: frozenset[str] = frozenset(
    {"PROFESSION", "O"}
)

# Max separator-only gap between a name and a date for the date to count as an
# appositive DOB. Only whitespace/punctuation may sit in the gap (no verbs like
# "signed on"), so an action date near a name is not mistaken for a birthdate.
_APPOSITION_GAP_RE = re.compile(r"^[\s,;:.()\[\]/-]{0,4}$")


# --- Personal-date mode (HIPAA Safe-Harbor) -------------------------------
# Config-gated broadening of _DATE_CANDIDATE resolution. Under 18 HIPAA Safe-
# Harbor identifiers, a date that IDENTIFIES an individual (birth, admission,
# discharge, treatment, injury, death) must be scrubbed, while a purely
# INSTITUTIONAL/case date (filing, hearing, service, execution) is not PHI and
# scrubbing it wrecks legal prose. We distinguish the two with the SMALLEST
# viable event-context verb sets plus the model's own DATE + PERSON proximity —
# NOT a big keyword list. The verb sets are deliberately tight; the primary
# signal is "a name anchors this date in the same clause". Over-broad verb lists
# are brittle and drift, so we lean on the model and comment the tradeoff.
#
# Personal-event context: the date attaches to something that happened TO a
# person (clinical/vital events). Kept minimal and unambiguous.
_PERSONAL_EVENT_RE = re.compile(
    r"(?i)\b(?:seen|treated|examined|admitted|discharged|diagnosed|"
    r"injured|died|deceased|born|hospitalized)\b"
)
# Institutional/case context: the date attaches to a filing/court/document
# event and stays readable even in personal-date mode. "signed" is included as
# the plain-English synonym of "executed": a signing/execution date is an
# institutional date, and without it a name sitting next to a signing date
# ("Jane Doe signed on 03/15/2024") would be over-redacted by pure proximity.
_INSTITUTIONAL_EVENT_RE = re.compile(
    r"(?i)\b(?:filed|served|hearing|entered|executed|signed|dated|"
    r"recorded|docketed|notarized)\b"
)

# Common title/abbreviation stems whose trailing period is NOT a sentence end.
# Fixes clause detection for "seen by Dr. Reyes on 11/15/2019" (without this the
# "Dr." period would split the clause and orphan the "seen" personal-event verb).
_ABBREV_RE = re.compile(r"(?:Dr|Mr|Mrs|Ms|Prof|Rev|Hon|Jr|Sr|St|Inc|Ltd|Co|No)$")
# Sentence/clause boundary candidates: end punctuation before whitespace, or a
# newline. Abbreviation periods are filtered out by _ABBREV_RE in the scanners.
_CLAUSE_BOUNDARY_RE = re.compile(r"[.!?](?=\s)|\n")
# Widest gap (chars) between a name and a date for them to count as "same-clause
# proximity" — deliberately wider than the strict separator-only apposition gap
# so "seen by Dr. Reyes on <date>" resolves, but still bounded so a name three
# sentences away does not drag an unrelated date into redaction.
_PERSONAL_PROXIMITY = 48
# How far back to look for an event-context verb governing the date.
_PERSONAL_CLAUSE_LOOKBACK = 80


def _crosses_clause(gap: str) -> bool:
    """True if ``gap`` contains a real sentence/clause boundary (ignoring
    abbreviation periods like ``Dr.``)."""
    for m in _CLAUSE_BOUNDARY_RE.finditer(gap):
        if _ABBREV_RE.search(gap[: m.start()]):
            continue  # abbreviation period, not a boundary
        return True
    return False


def _preceding_clause(text: str, pos: int) -> str:
    """Text of the clause immediately preceding ``pos`` (bounded lookback).

    Trims at the last real sentence boundary so a personal-event verb from an
    EARLIER sentence ("Patient was discharged. The invoice on <date>...") does
    not bleed onto an unrelated date, while an abbreviation period inside the
    same clause ("Dr.") is preserved."""
    lo = max(0, pos - _PERSONAL_CLAUSE_LOOKBACK)
    window = text[lo:pos]
    boundary_end = 0
    for m in _CLAUSE_BOUNDARY_RE.finditer(window):
        if _ABBREV_RE.search(window[: m.start()]):
            continue
        boundary_end = m.end()
    return window[boundary_end:]


def _person_in_same_clause(
    date_span: dict[str, Any], person_spans: list[dict[str, Any]], text: str
) -> bool:
    """True if a PERSON span sits within the same clause as the date, within a
    bounded proximity window (wider than strict apposition). This is the primary
    personal-date signal: a name anchoring the date, verb or no verb."""
    ds, de = date_span["start"], date_span["end"]
    for p in person_spans:
        if p["end"] <= ds:
            gap = text[p["end"]:ds]
        elif de <= p["start"]:
            gap = text[de:p["start"]]
        else:
            continue  # overlapping spans are not proximity
        if len(gap) <= _PERSONAL_PROXIMITY and not _crosses_clause(gap):
            return True
    return False


def _resolve_date_candidate(
    date_span: dict[str, Any],
    person_spans: list[dict[str, Any]],
    text: str,
    personal_dates: bool,
) -> str | None:
    """Resolve a model DATE candidate to a token TYPE, or ``None`` to drop it.

    * A date in strict apposition to a name is an identifying DOB in BOTH modes.
    * With ``personal_dates`` OFF (default, general legal posture), every other
      DATE candidate is dropped — no date over-redaction of filing/contract dates.
    * With ``personal_dates`` ON (medical-legal / full-protect posture), a date
      is kept as PERSONAL_DATE when it is associated with a person (a personal-
      event verb governs it, or a name anchors it in the same clause). An
      institutional/case date stays readable; a true personal-vs-institutional
      conflict resolves toward safety ONLY when a name clearly anchors the date.
    """
    if _date_appositive_to_name(date_span, person_spans, text):
        return "DATE_OF_BIRTH"
    if not personal_dates:
        return None
    clause = _preceding_clause(text, date_span["start"])
    institutional = bool(_INSTITUTIONAL_EVENT_RE.search(clause))
    personal = bool(_PERSONAL_EVENT_RE.search(clause))
    person_near = _person_in_same_clause(date_span, person_spans, text)
    if institutional:
        # Institutional/case dates stay readable. Resolve a genuine conflict
        # (a personal-event verb AND a name anchoring the date) toward safety;
        # otherwise keep the date readable (prefer precision on legal prose).
        return "PERSONAL_DATE" if (personal and person_near) else None
    if personal or person_near:
        return "PERSONAL_DATE"
    return None


_DEID_DIGIT_REQUIRED: frozenset[str] = frozenset({"PHONE_NUMBER", "ID_NUMBER"})


def _snap_to_token(text: str, start: int, end: int) -> tuple[int, int]:
    """Expand [start,end) to whole alphanumeric-token boundaries so the model
    can never redact only PART of a number (the "123"+"45" split that left
    digits in the clear). Mirrors how the regex backstops capture whole tokens."""
    while start > 0 and text[start - 1].isalnum():
        start -= 1
    while end < len(text) and text[end].isalnum():
        end += 1
    return start, end


_DATE_SEP = "-/."


def _expand_date_span(text: str, start: int, end: int) -> tuple[int, int]:
    """Expand a resolved date span across date separators ('-', '/', '.') that sit
    BETWEEN digits, so an under-tagged date is fully covered (e.g. the de-id model
    returns '1952-08' of '1952-08-19' -> we extend over '-19' too). A separator is
    only crossed when it is flanked by digits, so trailing punctuation/prose is not
    swallowed."""
    while start > 0:
        c = text[start - 1]
        if c.isalnum():
            start -= 1
        elif (c in _DATE_SEP and start - 2 >= 0 and text[start - 2].isdigit()
              and start < len(text) and text[start].isdigit()):
            start -= 1
        else:
            break
    while end < len(text):
        c = text[end]
        if c.isalnum():
            end += 1
        elif (c in _DATE_SEP and end + 1 < len(text) and text[end + 1].isdigit()
              and text[end - 1].isdigit()):
            end += 1
        else:
            break
    return start, end


# Public legal authorities are NOT PII: statute/reporter citations and court names
# are public references, and blacking them out wrecks a legal document's usability
# (O1). This mirrors the carve-out the LLM detection prompt already applies. Used to
# drop ID_NUMBER / ORGANIZATION spans that fall INSIDE such a reference.
_PUBLIC_AUTHORITY_RE = re.compile(
    r"(?i)\b(?:"
    r"\d+\s+U\.?\s?S\.?\s?C\.?(?:\s*§+\s*|\s+)\d+[A-Za-z0-9()-]*"       # 42 U.S.C. 1983
    r"|\d+\s+C\.?\s?F\.?\s?R\.?(?:\s*§+\s*|\s+)[\d.]+"                    # 12 C.F.R. 226.1
    r"|\d+\s+U\.?\s?S\.?\s+\d+"                                           # 410 U.S. 113
    r"|\d+\s+F\.?\s?(?:2d|3d|4th|Supp\.?(?:\s?\dd)?)\s+\d+"               # 347 F.3d 500
    r"|(?:Superior|District|Supreme|Circuit|Appellate|Bankruptcy|Municipal"
    r"|Family|Probate|Federal|Tax|Juvenile|Magistrate)\s+Court"
    r"(?:\s+of\s+(?:the\s+)?[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})?"   # Superior Court of California
    r"|Court\s+of\s+Appeals(?:\s+for\s+the\s+[A-Za-z]+\s+Circuit)?"
    r"|\b(?:First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth"
    r"|Eleventh|D\.?C\.?|Federal)\s+Circuit\b"
    r")"
)


def _drop_public_authority_overreach(
    spans: list[dict[str, Any]], text: str
) -> list[dict[str, Any]]:
    """O1: keep public legal authorities readable. Drop ID_NUMBER / ORGANIZATION
    spans wholly inside a statute/reporter citation or court name. Conservative: only
    those two types are dropped, so a real client name (PERSON) or any other PII that
    happens to sit near a citation is still redacted."""
    regions = [(m.start(), m.end()) for m in _PUBLIC_AUTHORITY_RE.finditer(text)]
    if not regions:
        return spans
    kept: list[dict[str, Any]] = []
    for s in spans:
        if s["type"] in ("ID_NUMBER", "ORGANIZATION") and any(
            r0 <= s["start"] and s["end"] <= r1 for r0, r1 in regions
        ):
            continue
        kept.append(s)
    return kept


def _deid_ner_spans(
    text: str, deid_ner, min_score: float = 0.5, *, strict: bool = False
) -> list[dict[str, Any]]:
    """Spans from the de-identification transformer pipeline.

    ``deid_ner`` is a HuggingFace token-classification pipeline built with
    ``aggregation_strategy='simple'`` (entity-group dicts with char offsets).
    Precision guards tuned against observed false positives:
      * ``min_score`` drops low-confidence noise (a bare "policy 12345" scored
        0.44 as PHONE).
      * boundary-snapping prevents partial-number redaction.
      * PHONE/ID spans must contain a digit (kills "Call" -> PHONE at 0.72).
    Unknown, non-skipped labels still fail CLOSED to OTHER_PHI.
    """
    try:
        results = deid_ner(text)
    except Exception as exc:
        import logging

        logging.getLogger("redactor").error(
            "deid_ner_failed_degraded exc_type=%s", type(exc).__name__
        )
        # STRICT: the de-id layer was loaded (expected to run) and threw. Do NOT
        # silently drop its coverage — fail closed so the caller withholds.
        if strict:
            raise RedactionUnavailable("deid_ner_error") from exc
        return []
    spans: list[dict[str, Any]] = []
    for r in results:
        if float(r.get("score", 0.8)) < min_score:
            continue
        raw = str(r.get("entity_group", r.get("entity", ""))).upper()
        norm = raw.replace("-", "").replace("_", "")
        if norm in _DEID_SKIP_LABELS or not norm:
            continue
        etype = _DEID_TYPE_MAP.get(norm, "OTHER_PHI")
        try:
            start, end = int(r["start"]), int(r["end"])
        except (KeyError, TypeError, ValueError):
            continue
        if end <= start:
            continue
        start, end = _snap_to_token(text, start, end)
        if etype in _DEID_DIGIT_REQUIRED and not any(c.isdigit() for c in text[start:end]):
            continue
        spans.append(
            {"type": etype, "start": start, "end": end,
             "score": float(r.get("score", 0.8)), "source": "deid"}
        )
    return spans


# High-signal medical acronyms the statistical model misses. Matched
# CASE-SENSITIVE and whole-token on purpose: "AIDS" the condition vs "aids"
# the verb, "MI" etc. are ambiguous lowercased, so we require the canonical
# uppercase form to avoid scrambling ordinary prose. Human-in-the-loop review
# is the safety net for anything outside this conservative set.
_MEDICAL_ACRONYMS: tuple[str, ...] = (
    "HIV", "AIDS", "PTSD", "COPD", "HCV", "HBV", "TBI", "STI", "STD",
    "CD4", "AUD", "OUD", "SUD", "MDD", "GAD", "OCD", "ADHD", "ESRD",
    "CKD", "ALS", "PTSD",
)


def _medical_acronym_spans(text: str) -> list[dict[str, Any]]:
    """Whole-token, case-SENSITIVE spans for high-signal medical acronyms."""
    if not text:
        return []
    spans: list[dict[str, Any]] = []
    for term in _MEDICAL_ACRONYMS:
        pattern = re.compile(r"(?<![A-Za-z])" + re.escape(term) + r"(?![A-Za-z])")
        for m in pattern.finditer(text):
            spans.append(
                {
                    "type": "MEDICAL_CONDITION",
                    "start": m.start(),
                    "end": m.end(),
                    "score": 0.95,
                    "source": "medical",
                }
            )
    return spans


@dataclass
class RedactionResult:
    redacted: str
    token_map: dict[str, str]
    entities: list[dict[str, Any]]


def _protected_term_spans(
    text: str,
    protected_terms: list[str | dict[str, Any]],
    *,
    source: str = "term",
) -> list[dict[str, Any]]:
    """Build whole-token, case-insensitive spans for declared vault terms.

    Shared by ``redact_scoped`` (terms ONLY) and ``redact`` (terms ON TOP of full
    NER + backstops) so the two paths can't drift on matching rules:
      * Case-insensitive.
      * Whole-token (word boundaries) so "France" doesn't redact inside
        "Frances"; the original casing in the text is preserved by ``_emit``.
      * Longest-first so a shorter term can't eat the prefix of a longer one
        (e.g. "Acme" vs "Acme Corp"). Mirrors the gateway/Unredact ordering.
      * De-duped on the lowercased term (same word declared twice counts once;
        first category wins).

    ``protected_terms`` items may be plain strings or ``{"term", "category"}``
    dicts; when a category is given it becomes the token TYPE, otherwise the
    default ``PROTECTED`` is used. Returns raw spans; the caller runs ``_dedupe``
    so overlaps with NER/backstop spans (or among terms) collapse
    deterministically.
    """
    # Normalize to (term, category) and drop empties. De-dupe on the lowercased
    # term so the same word declared twice doesn't double-count; first category
    # wins.
    norm: list[tuple[str, str]] = []
    seen: set[str] = set()
    for item in protected_terms:
        if isinstance(item, dict):
            term = str(item.get("term", "")).strip()
            category = str(item.get("category") or "PROTECTED").strip().upper()
            # Reviewer MEDIUM-1: category becomes the token TYPE and rides into
            # the [REDACTED_<TYPE>_NNN] token, so a stray "]" or space would
            # break the gateway's bracketed un-redaction. Restrict to a safe
            # token alphabet; fall back to PROTECTED if nothing survives.
            category = re.sub(r"[^A-Z0-9_]", "", category) or "PROTECTED"
        else:
            term = str(item).strip()
            category = "PROTECTED"
        if not term:
            continue
        key = term.lower()
        if key in seen:
            continue
        seen.add(key)
        norm.append((term, category or "PROTECTED"))

    if not text or not norm:
        return []

    # Longest-first so overlapping terms resolve to the longest match.
    norm.sort(key=lambda tc: len(tc[0]), reverse=True)

    spans: list[dict[str, Any]] = []
    for term, category in norm:
        pattern = re.compile(
            r"(?<!\w)" + re.escape(term) + r"(?!\w)", re.IGNORECASE
        )
        for m in pattern.finditer(text):
            spans.append(
                {
                    "type": category,
                    "start": m.start(),
                    "end": m.end(),
                    "score": 1.0,
                    "source": source,
                }
            )
    return spans


def redact_scoped(
    text: str,
    protected_terms: list[str | dict[str, Any]],
) -> RedactionResult:
    """Scoped redaction: hide ONLY the supplied protected terms, not detected PII.

    This is the legacy matter-vault path (docs/specs/redaction-modes.md §4):
    instead of running NER, we redact case-insensitive, whole-token matches of an
    explicit vocabulary, leaving public references untouched. Matter context now
    uses FULL redaction (NER + backstops + terms) via ``redact``; this entrypoint
    is retained for the explicit "scoped" service mode and existing callers.

    Each match emits the SAME ``[REDACTED_<TYPE>_<NNN>]`` token format as full
    mode, so the gateway's un-redaction (string-replace against the token map) is
    completely unaffected. Matching rules live in ``_protected_term_spans`` so
    full and scoped modes can never diverge.
    """
    spans = _protected_term_spans(text, protected_terms)
    # Neutralize pre-existing token-shaped literals here too (Reviewer
    # CRITICAL-2) so scoped mode can't be collision-injected either.
    spans.extend(_existing_token_spans(text))
    if not spans:
        return RedactionResult(redacted=text, token_map={}, entities=[])

    spans = _dedupe(spans)
    spans.sort(key=lambda s: s["start"])
    return _emit(text, spans)


# Presidio entity allowlist. We pass this EXPLICITLY to ``analyze(entities=...)``
# so only these recognizers fire. Two reasons (51-scenario UAT, 2026-06):
#
#   1. MISCLASSIFICATION: Presidio's default registry loads every country-specific
#      recognizer (IN_PAN, IN_AADHAAR, AU_ABN, UK_NHS, SG_NRIC, ...). A US 16-digit
#      credit-card number was matched as IN_PAN (Indian Permanent Account Number,
#      count 33) because those patterns overlap on digit/letter runs. Restricting
#      to a US/global set removes the foreign false-positives entirely.
#
#   2. OVER-REDACTION: DATE_TIME (ordinary dates) is intentionally EXCLUDED. A bare
#      date is not PII on its own and redacting every date scrambles legal prose
#      into uselessness. Genuinely sensitive identifiers below are still caught.
#
# Names/orgs/locations come from the spaCy NER mapping in main.py (PERSON,
# ORGANIZATION, LOCATION, NRP) and are listed here so the analyzer surfaces them.
_PRESIDIO_ENTITY_ALLOWLIST: tuple[str, ...] = (
    # NER (spaCy → Presidio mapping in main.py)
    "PERSON",
    "ORGANIZATION",
    "LOCATION",
    "NRP",
    # Contact / direct identifiers
    "EMAIL_ADDRESS",
    "PHONE_NUMBER",
    "URL",
    "IP_ADDRESS",
    # US financial / government identifiers
    "US_SSN",
    "US_ITIN",
    "US_PASSPORT",
    "US_DRIVER_LICENSE",
    "US_BANK_NUMBER",
    "CREDIT_CARD",
    "IBAN_CODE",
    "CRYPTO",
    "MEDICAL_LICENSE",
    # NOTE: DATE_TIME deliberately omitted (over-redaction). Country-specific
    # recognizers (IN_PAN, IN_AADHAAR, AU_*, UK_*, SG_NRIC, ...) deliberately
    # omitted (misclassification of US data).
)

# Research ("baseline") tier: the SMALL, certain set of research-safe reference
# entity types left READABLE in open-research mode. Everything else the ensemble
# detects -- SSN, financial + government IDs, medical conditions/medications,
# DOB / personal dates, email / phone / IP, URLs, nationality/religion (NRP), and
# ANY type not listed here -- is redacted before inference. A denylist by
# construction: the keep-set is the whole allowlist, so a type we did not
# anticipate (or a future recognizer) fails SAFE (stripped, never leaked). Names,
# orgs, and place references are what legal RESEARCH needs to stay useful;
# confidential client work belongs in a matter (full-protect) or under the manual
# Protect flag, both of which redact these too.
#
# Deliberately NOT kept readable (adversarial-review findings):
#   - URL: can embed bearer/reset tokens, API keys, or opaque account/record IDs
#     that match no PII pattern, so a kept URL would leak them verbatim. Research
#     links arrive via web_search tool results (forwarded verbatim), not here.
#   - NRP (nationality / religion / political group): GDPR special-category data.
#   - street-level LOCATION (a span with a leading house number): a specific
#     residence -- carved out in _baseline_readable, not a place reference.
# Passed to redact(readable_types=...) by main.py's "baseline" mode; None (the
# default) means full redaction, unchanged.
RESEARCH_READABLE_TYPES: frozenset[str] = frozenset(
    {"PERSON", "ORGANIZATION", "LOCATION"}
)


def _baseline_readable(span: dict[str, Any], text: str, readable_types) -> bool:
    """True if ``span`` should be LEFT READABLE in the baseline tier.

    Membership in ``readable_types`` is necessary but not sufficient: a
    street-level LOCATION (leading house number, e.g. "42 Rue de Rivoli" /
    "123 Elm") is a specific residence, not a research-safe place reference, so it
    is redacted even though bare city/state/country names stay readable.
    """
    if span["type"] not in readable_types:
        return False
    if span["type"] == "LOCATION":
        if text[span["start"]:span["end"]].lstrip()[:1].isdigit():
            return False
    return True


def _date_appositive_to_name(
    date_span: dict[str, Any], person_spans: list[dict[str, Any]], text: str
) -> bool:
    """True if a date sits in a separator-only gap immediately next to a name.

    This is how an unlabeled date of birth appears ("Maria Cruz (1952-08-19)",
    "John Smith, 05/22/1990"). Requiring the gap to be ONLY whitespace/punctuation
    (``_APPOSITION_GAP_RE``) keeps an action date with a verb between it and the
    name ("John Smith signed on 03/15/2024") from being mistaken for a birthdate.
    """
    ds, de = date_span["start"], date_span["end"]
    for p in person_spans:
        if p["end"] <= ds:
            gap = text[p["end"]:ds]
        elif de <= p["start"]:
            gap = text[de:p["start"]]
        else:
            continue  # overlapping spans are not apposition
        if _APPOSITION_GAP_RE.match(gap):
            return True
    return False


def redact(
    text: str,
    *,
    analyzer=None,
    anonymizer=None,
    medical_nlp=None,
    deid_ner=None,
    deid_min_score: float = 0.5,
    entities: tuple[str, ...] | list[str] | None = None,
    readable_types: frozenset[str] | set[str] | None = None,
    protected_terms: list[str | dict[str, Any]] | None = None,
    strict: bool = False,
    personal_dates: bool = False,
    llm_client=None,
) -> RedactionResult:
    """Returns redacted text + token map (FULL mode: NER + backstops [+ terms]).

    Token names follow `[REDACTED_<TYPE>_<NNN>]` so the gateway can do a simple
    string-replace on the way back. NNN is a 3-digit zero-padded counter per
    entity type, in order of appearance.

    ``entities`` restricts which Presidio recognizers run. Defaults to
    ``_PRESIDIO_ENTITY_ALLOWLIST`` (US/global set, no over-broad DATE_TIME and no
    foreign country identifiers). Pass an explicit list to override; pass ``[]``
    only if you truly want NER suppressed (the regex backstops still run).

    ``protected_terms`` (the matter vault) adds whole-token, case-insensitive
    spans for declared terms ON TOP of NER + backstops, via the same shared
    ``_protected_term_spans`` helper that ``redact_scoped`` uses. This is the
    full-protect path for matter context: catch every detected entity AND any
    declared codename/identifier that NER would miss (e.g. "Project Zephyr").
    Overlaps with NER spans collapse in ``_dedupe`` like any other span.

    ``strict`` is the "safe for lawyers" fail-closed switch. When True, the
    primary NER layer (Presidio/spaCy) is REQUIRED: if it is not loaded, or if it
    (or any loaded PHI layer) throws mid-request, we raise ``RedactionUnavailable``
    instead of silently continuing on the regex backstops. The caller (main.py)
    turns that into a 503 so the gateway withholds the text rather than forwarding
    under-redacted content to the model. When False (default, dev posture),
    behavior is unchanged: layers degrade loudly-but-gracefully to the regex floor.

    ``personal_dates`` toggles HIPAA Safe-Harbor "personal-date" mode. Wire it
    from the ``REDACTOR_PERSONAL_DATES`` env flag in main.py; default OFF so
    general legal redaction is unchanged (only a date in strict apposition to a
    name is scrubbed, as a DOB). When ON (the medical-legal / full-protect
    posture), a model-tagged DATE that is associated with an INDIVIDUAL —
    governed by a personal-event verb (seen/treated/examined/admitted/
    discharged/diagnosed/injured/died/deceased/born/hospitalized) or anchored by
    a name in the same clause — is scrubbed as PERSONAL_DATE, while an
    INSTITUTIONAL/case date (filed/served/hearing/entered/executed/signed/dated/
    recorded/docketed/notarized) stays readable. Distinct token TYPEs keep the
    tokens semantically honest: DATE_OF_BIRTH only for actual birthdates,
    PERSONAL_DATE for treatment/admission/death/etc. See _resolve_date_candidate.
    """
    spans: list[dict[str, Any]] = []
    if entities is None:
        entities = _PRESIDIO_ENTITY_ALLOWLIST

    # STRICT readiness gate: the primary NER layer must be loaded. Refusing here
    # (rather than proceeding on regex-only coverage that misses names/orgs/
    # locations) is the whole "rivals a human" guarantee. redact_scoped does NOT
    # run NER by design, so this gate applies to full mode only.
    if strict and analyzer is None:
        raise RedactionUnavailable("ner_unavailable")

    # Neutralize pre-existing token-shaped literals first (Reviewer CRITICAL-2).
    spans.extend(_existing_token_spans(text))

    if analyzer is not None:
        try:
            entity_filter = list(entities) or None
            try:
                results = analyzer.analyze(
                    text=text, language="en", entities=entity_filter
                )
            except TypeError:
                # Analyzer doesn't accept an entities filter (older Presidio or a
                # test stub). Fall back to an unfiltered analyze; downstream dedupe
                # is unaffected. This is NOT the degraded-to-regex path.
                results = analyzer.analyze(text=text, language="en")
            for r in results:
                # Drop NER false positives where a bare identifier-label word is
                # tagged as a name (e.g. "MRN"/"SSN" -> PERSON/ORGANIZATION).
                if (
                    r.entity_type in ("PERSON", "ORGANIZATION")
                    and text[r.start:r.end].strip().upper() in _NER_LABEL_STOPWORDS
                ):
                    continue
                spans.append(
                    {
                        "type": r.entity_type,
                        "start": r.start,
                        "end": r.end,
                        "score": float(r.score),
                        "source": "presidio",
                    }
                )
        except Exception as exc:
            # If spaCy/Presidio fails (e.g., model not loaded), continue with
            # regex backstops alone. Graceful degrade per AGENTS.md rule 20 —
            # but NEVER silently: regex-only coverage is materially weaker
            # (misses names/orgs), so an operator must be able to see it.
            # Metadata only — never log text content.
            import logging

            logging.getLogger("redactor").error(
                "presidio_analyze_failed_degraded_to_regex exc_type=%s",
                type(exc).__name__,
            )
            # STRICT: never serve regex-only after the required NER layer threw.
            # Fail closed so the gateway withholds instead of forwarding
            # under-redacted text (names/orgs/locations would leak).
            if strict:
                raise RedactionUnavailable("ner_analyzer_error") from exc

    # Biomedical NER pass (PHI): diagnoses/conditions (DISEASE) and
    # drugs/medications (CHEMICAL). Optional and separate from Presidio so the
    # engine stays a pure function; main.py builds the model once and passes it
    # in. Same graceful-but-loud degrade as the Presidio path: if the medical
    # model is absent or errors, the acronym + context backstops below still
    # run, but condition/medication names will leak, so an operator must see it.
    if medical_nlp is not None:
        try:
            mdoc = medical_nlp(text)
            for ent in mdoc.ents:
                etype = _MEDICAL_LABEL_MAP.get(ent.label_)
                if etype is None:
                    continue
                # Reviewer HIGH-2: don't redact ubiquitous non-drug chemicals.
                if (
                    etype == "MEDICATION"
                    and ent.text.strip().lower() in _CHEMICAL_STOPWORDS
                ):
                    continue
                # The biomedical model mislabels form-label / legal-role words as
                # a condition/medication ("DOB"->MEDICATION, "Lessee"->CONDITION).
                # Route medical spans through the same stopword guard as NER.
                if ent.text.strip().upper() in _NER_LABEL_STOPWORDS:
                    continue
                spans.append(
                    {
                        "type": etype,
                        "start": ent.start_char,
                        "end": ent.end_char,
                        "score": 0.85,
                        "source": "medical",
                    }
                )
        except Exception as exc:
            import logging

            logging.getLogger("redactor").error(
                "medical_ner_failed_degraded exc_type=%s",
                type(exc).__name__,
            )
            # STRICT: the biomedical layer was loaded (expected to run) and threw.
            # Don't silently drop condition/medication coverage — fail closed.
            if strict:
                raise RedactionUnavailable("medical_ner_error") from exc

    # De-identification transformer pass: learned, context-aware coverage of the
    # identifiers the hand-written context backstops are brittle about (medical
    # record / ID / phone / location in free text). Optional; absence simply
    # leaves the regex/heuristic floor below in charge (Reviewer + ops can see it
    # via the medical_ner/deid degrade logs). Union-redacted with everything else.
    if deid_ner is not None:
        spans.extend(
            _deid_ner_spans(text, deid_ner, min_score=deid_min_score, strict=strict)
        )

    # LLM-prompt detection layer (opt-in, SOVEREIGN model only). Additive high-recall
    # pass for context-dependent PII (aliases/initials, unusual names, relational and
    # quasi-identifiers) that NER/regex structurally miss. Union-only and scored below
    # the deterministic layers so they win ties in _dedupe; the module's substring
    # mapping is a hallucination guard (never emits a span not present verbatim). In
    # strict mode a model outage raises (fail closed); otherwise it returns []. Placed
    # before date resolution so LLM-found names also anchor date apposition.
    if llm_client is not None:
        from .llm_redact import llm_pii_spans

        # The LLM layer ALWAYS fails open (strict=False), even when the request is
        # strict. It is an ADDITIVE recall booster; the "safe for lawyers" floor is
        # the Presidio + de-id ensemble, which strict already gates. A model outage
        # (common while Forge is being tuned) must NEVER withhold a redaction the
        # core layers completed, and must never surface as an unmapped 500. So we
        # degrade to the ensemble and log, rather than propagate LlmRedactionError.
        # Tag provenance here (llm_redact.py stays untouched): every span this layer
        # returns is stamped source="llm" so the propose/review UI can show which
        # layer found it. Existing spans already carry type/start/end/score.
        for _lspan in llm_pii_spans(text, client=llm_client, strict=False):
            _lspan.setdefault("source", "llm")
            spans.append(_lspan)

    # Date-candidate resolution (Reviewer R1): resolve model DATE candidates now
    # that every name span (Presidio + de-id) is collected. A date in immediate
    # apposition to a name ("Maria Cruz (1952-08-19)", "John Smith, 05/22/1990") is
    # an identifying DOB a human redacts; a standalone filing/contract date is not.
    # With personal_dates ON, resolution is broadened to HIPAA Safe-Harbor personal
    # dates (treatment/admission/death anchored to a person) while institutional
    # case dates stay readable. See _resolve_date_candidate for the full rule.
    _person_spans = [s for s in spans if s["type"] == "PERSON"]
    _resolved: list[dict[str, Any]] = []
    for _s in spans:
        if _s["type"] != _DATE_CANDIDATE_TYPE:
            _resolved.append(_s)
            continue
        _rtype = _resolve_date_candidate(_s, _person_spans, text, personal_dates)
        if _rtype is not None:
            _s["type"] = _rtype
            # L3: the de-id model can under-tag a date ("1952-08" of "1952-08-19"),
            # and alnum-only snapping won't cross the "-", leaving the day in the
            # clear. Re-expand across date separators so the WHOLE date is covered.
            _s["start"], _s["end"] = _expand_date_span(text, _s["start"], _s["end"])
            _resolved.append(_s)
        # else: not an identifying date -> drop (stays readable)
    spans = _resolved

    # Medical acronyms the statistical model misses (HIV, AIDS, ...).
    spans.extend(_medical_acronym_spans(text))

    # Multi-word diagnoses the model misses wholesale (opioid use disorder,
    # hepatitis C). Reuse the whole-token, longest-first term matcher.
    spans.extend(
        _protected_term_spans(
            text,
            [{"term": p, "category": "MEDICAL_CONDITION"} for p in _MEDICAL_PHRASES],
            source="medical",
        )
    )

    for m in _CASE_NUMBER_RE.finditer(text):
        spans.append(
            {
                "type": "CASE_NUMBER",
                "start": m.start(),
                "end": m.end(),
                "score": 0.99,
                "source": "regex",
            }
        )

    for etype, pattern in _BACKSTOPS:
        for m in pattern.finditer(text):
            spans.append(
                {
                    "type": etype,
                    "start": m.start(),
                    "end": m.end(),
                    "score": 0.95,
                    "source": "regex",
                }
            )

    # Context-anchored identifiers (MRN / badge / policy). Redact capture
    # group 1 (the value), leaving the preceding label word in place.
    for etype, pattern in _CONTEXT_BACKSTOPS:
        for m in pattern.finditer(text):
            spans.append(
                {
                    "type": etype,
                    "start": m.start(1),
                    "end": m.end(1),
                    "score": 0.95,
                    "source": "regex",
                }
            )

    # Full-protect: also redact the declared matter-vault terms (codenames,
    # client/opposing-party names, identifiers) that NER may not flag. Score 1.0
    # so a declared term wins ties in _dedupe against a lower-confidence overlap.
    if protected_terms:
        spans.extend(_protected_term_spans(text, protected_terms))

    # O1: keep public legal authorities (statute/reporter cites, court names)
    # readable — drop ID_NUMBER/ORGANIZATION spans inside them. Runs BEFORE the
    # declared-terms are protected? No: after, but protected_terms are PROTECTED-
    # type, never ID_NUMBER/ORGANIZATION, so a declared term is never dropped here.
    spans = _drop_public_authority_overreach(spans, text)

    # Research / baseline tier: leave the research-safe reference entities
    # (RESEARCH_READABLE_TYPES: names/orgs/places/nationality/links) READABLE and
    # redact everything else the ensemble found -- high-risk PII (SSN, financial +
    # government IDs, medical, DOB, contact) plus any type not on the keep-list.
    # A denylist by construction, applied AFTER every detection layer so it is
    # independent of which layer (Presidio/regex/medical/deid/llm) found a span:
    # the type alone decides. ``None`` (default / full mode) redacts everything.
    if readable_types is not None:
        spans = [s for s in spans if not _baseline_readable(s, text, readable_types)]

    # Dedupe overlaps: prefer earlier-start, longer-span, higher-score.
    spans = _dedupe(spans)
    spans.sort(key=lambda s: s["start"])
    return _emit(text, spans)


def detect(text: str, **kwargs: Any) -> list[dict[str, Any]]:
    """Detect-only entrypoint: resolved spans WITHOUT emitting tokens.

    This is the PROPOSE side of the human-in-the-loop redaction flow. It runs the
    exact same detection ensemble as :func:`redact` (same ``**kwargs`` — analyzer,
    medical_nlp, deid_ner, protected_terms, strict, personal_dates, llm_client,
    ...), returns the same deduped, start-sorted span list, but does NOT produce
    redacted text or a token map. Each span carries the SHARED provenance/score
    metadata:

        {type, start, end, score, source, text}

    where ``source`` names the layer that found it (regex / presidio / deid /
    medical / term / llm) and ``text`` is the verbatim slice being proposed for
    redaction. The document layer (document_redact.propose_document) enriches
    these into the full span contract (id, page, rects, confidence) for the UI to
    review; nothing is burned in until :func:`redact` (or apply_document) runs on
    the human-approved subset. Detection logic and results are IDENTICAL to
    redact() — this only withholds the emit step.

    Fails closed exactly like redact(): in strict mode a required-layer outage
    raises RedactionUnavailable, so a detect-only call NEVER silently returns an
    under-detected span list.
    """
    result = redact(text, **kwargs)
    for span in result.entities:
        # score is the engine's internal confidence field; expose the verbatim
        # slice so a reviewer can see exactly what would be burned in. Additive
        # only: type/start/end/score/source are already present.
        span.setdefault("text", text[span["start"]:span["end"]])
    return result.entities


def _emit(text: str, spans: list[dict[str, Any]]) -> RedactionResult:
    """Render ``spans`` into redacted text + token map.

    Shared by full and scoped modes so both produce the identical
    ``[REDACTED_<TYPE>_<NNN>]`` token format (NNN is a 3-digit, per-type counter
    in order of appearance). Spans must already be deduped and start-sorted.
    """
    counters: dict[str, int] = {}
    token_map: dict[str, str] = {}
    out: list[str] = []
    cursor = 0
    for span in spans:
        start, end, etype = span["start"], span["end"], span["type"]
        if start < cursor:
            continue
        counters[etype] = counters.get(etype, 0) + 1
        token = f"[REDACTED_{etype}_{counters[etype]:03d}]"
        # Slice the known wrapping brackets (Reviewer MEDIUM-1): str.strip("[]")
        # strips the CHARACTER SET {[,]} from both ends, so a TYPE containing a
        # bracket (possible via a user-supplied vault category) would corrupt the
        # map key and break un-redaction. token[1:-1] removes exactly one wrapping
        # "[" and "]".
        token_map[token[1:-1]] = text[start:end]
        out.append(text[cursor:start])
        out.append(token)
        cursor = end
    out.append(text[cursor:])
    return RedactionResult(redacted="".join(out), token_map=token_map, entities=spans)


def _dedupe(spans: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not spans:
        return spans
    spans = sorted(spans, key=lambda s: (s["start"], -(s["end"] - s["start"]), -s["score"]))
    keep: list[dict[str, Any]] = []
    last_end = -1
    for s in spans:
        if s["start"] >= last_end:
            keep.append(s)
            last_end = s["end"]
        elif s["end"] > last_end:
            # PARTIAL overlap (Reviewer CRITICAL-1): a later span starts inside
            # the kept span but extends past it. Dropping it would leak the tail
            # [last_end, s.end) — e.g. a scispaCy DISEASE span whose start is
            # eaten by a shorter spaCy PERSON span would leave the condition's
            # tail unredacted. MERGE instead: extend the kept span to the union
            # so nothing sensitive is ever left in the clear. The kept span's
            # TYPE is retained; redaction completeness, not the label, is what
            # matters, and text[start:end] still restores the full span verbatim.
            keep[-1] = {**keep[-1], "end": s["end"]}
            last_end = s["end"]
    return keep
