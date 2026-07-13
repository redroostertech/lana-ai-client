"""Tests for the LLM-prompt PII detection layer (redactor/llm_redact.py).

Fully hermetic: the LLM ``client`` is a plain STUB callable returning canned
model output. No network, no real model. Asserts the two things that make this
layer safe to union into the ensemble:

  1. Substrings map to CORRECT offsets (including a REPEATED substring -> two
     spans, and a NOT-IN-TEXT substring -> dropped, never fabricated).
  2. A MODEL-INVENTED substring is NEVER emitted (hallucination guard).

Plus: type mapping (incl. unknown -> OTHER_PHI), tolerant JSON parsing, and the
fail-open (non-strict) vs fail-closed (strict) contract on client errors.
"""

from __future__ import annotations

import json

import pytest

from redactor.llm_redact import (
    ForgeChatClient,
    LlmRedactionError,
    llm_pii_spans,
)


def _stub(payload):
    """Build a stub client returning ``payload`` as the model's raw content.

    ``payload`` may be a str (returned verbatim) or any JSON-serializable value
    (dumped to a JSON string), mimicking an OpenAI content string."""
    content = payload if isinstance(payload, str) else json.dumps(payload)

    def client(messages, *, model=None, timeout=30.0):
        assert messages[0]["role"] == "system"
        assert messages[1]["role"] == "user"
        return content

    return client


TEXT = (
    "Patient C.D. was seen by Dr. Alice Nguyen at Mercy Hospital. "
    "C.D. reported chest pain. Contact: alice@mercy.org. "
    "Cite 42 U.S.C. 1983 does not apply."
)


def test_offsets_repeated_and_type_mapping():
    client = _stub(
        [
            {"text": "C.D.", "type": "PERSON"},          # appears TWICE
            {"text": "Alice Nguyen", "type": "name"},     # alt label -> PERSON
            {"text": "Mercy Hospital", "type": "ORGANIZATION"},
            {"text": "alice@mercy.org", "type": "EMAIL"},
            {"text": "chest pain", "type": "medical_condition"},
        ]
    )
    spans = llm_pii_spans(TEXT, client=client)

    # Every emitted span's text is actually present at its offset (core invariant).
    for s in spans:
        assert TEXT[s["start"] : s["end"]]
        assert 0 <= s["start"] < s["end"] <= len(TEXT)

    def texts_for(t):
        return [TEXT[s["start"] : s["end"]] for s in spans if s["type"] == t]

    # Repeated substring -> two PERSON spans for "C.D." plus the doctor's name.
    cd_spans = [s for s in spans if TEXT[s["start"] : s["end"]] == "C.D."]
    assert len(cd_spans) == 2
    assert cd_spans[0]["start"] != cd_spans[1]["start"]

    assert "Alice Nguyen" in texts_for("PERSON")          # "name" -> PERSON
    assert texts_for("ORGANIZATION") == ["Mercy Hospital"]
    assert texts_for("EMAIL_ADDRESS") == ["alice@mercy.org"]  # "EMAIL" -> canonical
    assert texts_for("MEDICAL_CONDITION") == ["chest pain"]

    # Spans are start-sorted and non-overlapping (clean union into engine).
    starts = [s["start"] for s in spans]
    assert starts == sorted(starts)
    for a, b in zip(spans, spans[1:]):
        assert a["end"] <= b["start"]


def test_not_in_text_substring_is_dropped():
    client = _stub(
        [
            {"text": "Mercy Hospital", "type": "ORGANIZATION"},
            {"text": "Springfield General", "type": "ORGANIZATION"},  # not in TEXT
        ]
    )
    spans = llm_pii_spans(TEXT, client=client)
    rendered = [TEXT[s["start"] : s["end"]] for s in spans]
    assert "Mercy Hospital" in rendered
    assert "Springfield General" not in rendered
    assert len(spans) == 1


def test_model_invented_substring_never_emitted():
    """Hallucination guard: even a plausible fabricated SSN is dropped because
    it does not appear verbatim in the input."""
    client = _stub([{"text": "123-45-6789", "type": "US_SSN"}])
    spans = llm_pii_spans("No identifiers here at all.", client=client)
    assert spans == []


def test_unknown_type_maps_to_other_phi():
    text = "The gizmo code WX-9 is on file."
    client = _stub([{"text": "WX-9", "type": "SOME_MADE_UP_LABEL"}])
    spans = llm_pii_spans(text, client=client)
    assert len(spans) == 1
    assert spans[0]["type"] == "OTHER_PHI"
    assert text[spans[0]["start"] : spans[0]["end"]] == "WX-9"


def test_word_bounded_no_partial_match():
    # "Ann" must not match inside "Announcement"; only the standalone name.
    text = "Announcement: Ann arrived."
    client = _stub([{"text": "Ann", "type": "PERSON"}])
    spans = llm_pii_spans(text, client=client)
    assert len(spans) == 1
    assert text[spans[0]["start"] : spans[0]["end"]] == "Ann"
    assert spans[0]["start"] == text.index("Ann arrived")


def test_over_redaction_guard_drops_common_short_tokens():
    """D1: a degraded/injected model returning common short words on ordinary
    text yields NO spans (would otherwise black out the whole document), while a
    short STRUCTURED-ID substring is still kept."""
    text = "The patient has a cold and the account 4821 is on file."
    client = _stub(
        [
            {"text": "a", "type": "PERSON"},     # 1 char -> dropped
            {"text": "the", "type": "PERSON"},   # stopword -> dropped
            {"text": "4821", "type": "BANK_ACCOUNT"},  # short but structured ID -> kept
        ]
    )
    spans = llm_pii_spans(text, client=client)
    rendered = [(text[s["start"] : s["end"]], s["type"]) for s in spans]
    assert ("4821", "BANK_ACCOUNT") in rendered
    # No "a"/"the" spans survived.
    assert all(text[s["start"] : s["end"]] not in ("a", "the") for s in spans)
    assert rendered == [("4821", "BANK_ACCOUNT")]


def test_over_redaction_guard_only_stopwords_yields_nothing():
    """The prompt's canonical case: [("a","PERSON"),("the","PERSON")] -> []."""
    spans = llm_pii_spans(
        "The cat sat on a mat in the sun.",
        client=_stub([{"text": "a", "type": "PERSON"}, {"text": "the", "type": "PERSON"}]),
    )
    assert spans == []


def test_tolerates_markdown_fenced_json():
    fenced = 'Here you go:\n```json\n[{"text": "Mercy Hospital", "type": "ORGANIZATION"}]\n```\nDone.'
    client = _stub(fenced)
    spans = llm_pii_spans(TEXT, client=client)
    assert [TEXT[s["start"] : s["end"]] for s in spans] == ["Mercy Hospital"]


def test_tolerates_object_wrapped_array():
    client = _stub({"spans": [{"text": "Mercy Hospital", "type": "ORGANIZATION"}]})
    spans = llm_pii_spans(TEXT, client=client)
    assert [TEXT[s["start"] : s["end"]] for s in spans] == ["Mercy Hospital"]


def test_empty_array_returns_empty():
    assert llm_pii_spans(TEXT, client=_stub([])) == []


def test_blank_input_short_circuits():
    called = False

    def client(messages, *, model=None, timeout=30.0):
        nonlocal called
        called = True
        return "[]"

    assert llm_pii_spans("   ", client=client) == []
    assert called is False  # no model call for empty text


def test_client_error_fails_open_non_strict():
    def client(messages, *, model=None, timeout=30.0):
        raise RuntimeError("connection refused")

    assert llm_pii_spans(TEXT, client=client) == []


def test_client_error_raises_in_strict():
    def client(messages, *, model=None, timeout=30.0):
        raise RuntimeError("connection refused")

    with pytest.raises(LlmRedactionError):
        llm_pii_spans(TEXT, client=client, strict=True)


def test_llmredactionerror_from_client_fails_open_non_strict():
    # The real ForgeChatClient raises LlmRedactionError (e.g. inference_unreachable)
    # on transport failure. In NON-strict this ADDITIVE layer must fail OPEN (return
    # []) so a Forge blip never crashes redaction; only strict propagates it.
    def client(messages, *, model=None, timeout=30.0):
        raise LlmRedactionError("inference_unreachable")

    assert llm_pii_spans(TEXT, client=client) == []
    with pytest.raises(LlmRedactionError):
        llm_pii_spans(TEXT, client=client, strict=True)


def test_unparseable_output_fails_open_non_strict():
    assert llm_pii_spans(TEXT, client=_stub("I could not find any PII.")) == []


def test_unparseable_output_raises_in_strict():
    with pytest.raises(LlmRedactionError):
        llm_pii_spans(TEXT, client=_stub("not json at all"), strict=True)


def test_score_below_deterministic_layers():
    spans = llm_pii_spans(TEXT, client=_stub([{"text": "Mercy Hospital", "type": "ORGANIZATION"}]))
    assert spans and all(s["score"] < 0.9 for s in spans)


# --- default sovereign adapter (no network; post_json injected) --------------


def test_forge_chat_client_builds_sovereign_request_and_extracts_content():
    captured = {}

    def fake_post(url, headers, payload, timeout):
        captured["url"] = url
        captured["headers"] = headers
        captured["payload"] = payload
        return {"choices": [{"message": {"content": "[]"}}]}

    client = ForgeChatClient(
        "https://forge.internal/v1/chat/completions",
        model="lana-sovereign",
        api_key="k",
        post_json=fake_post,
    )
    out = client([{"role": "user", "content": "hi"}], timeout=5.0)
    assert out == "[]"
    assert captured["headers"]["x-sovereign"] == "true"
    assert captured["headers"]["Authorization"] == "Bearer k"
    assert captured["payload"]["model"] == "lana-sovereign"
    assert captured["payload"]["temperature"] == 0


def test_forge_chat_client_bad_shape_raises():
    def fake_post(url, headers, payload, timeout):
        return {"unexpected": True}

    client = ForgeChatClient("https://forge.internal", model="m", post_json=fake_post)
    with pytest.raises(LlmRedactionError):
        client([{"role": "user", "content": "hi"}])


def test_end_to_end_with_forge_client_stub():
    """The adapter and detector compose: fake transport -> ForgeChatClient ->
    llm_pii_spans, proving the injected-client contract end to end."""
    def fake_post(url, headers, payload, timeout):
        body = [{"text": "Mercy Hospital", "type": "ORGANIZATION"}]
        return {"choices": [{"message": {"content": json.dumps(body)}}]}

    client = ForgeChatClient("https://forge.internal", model="m", post_json=fake_post)
    spans = llm_pii_spans(TEXT, client=client)
    assert [TEXT[s["start"] : s["end"]] for s in spans] == ["Mercy Hospital"]
