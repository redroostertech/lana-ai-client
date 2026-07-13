"""STRICT / fail-closed mode at the HTTP layer (the "safe for lawyers" posture).

In strict mode the redactor must NEVER return an under-redacted 200. Instead of
silently degrading to regex-only coverage it returns 503 {degraded, reason} so
the gateway WITHHOLDS the text rather than forwarding it to the model. It also
refuses to serve /redact unauthenticated. These tests assert that end-to-end via
the FastAPI TestClient, controlling the loaded models with monkeypatch so they
do not depend on the heavy spaCy/Presidio/torch stack being installed.
"""

from __future__ import annotations

import logging

import pytest
from fastapi.testclient import TestClient

from redactor import main as main_module

SECRET = "internal-service-secret-xyz"


class _ThrowingAnalyzer:
    """analyze() blows up mid-request, like a model that failed to initialize."""

    def analyze(self, text, language, entities=None):
        raise RuntimeError("presidio model unavailable")


class _FakeAnalyzer:
    """Returns no spans; enough to satisfy the strict readiness gate (not None)."""

    def analyze(self, text, language, entities=None):
        return []


@pytest.fixture
def no_model_load(monkeypatch):
    """Neutralize the heavy startup model builders so lifespan is fast and the
    test controls _analyzer / _medical_nlp / _deid_ner directly."""
    monkeypatch.setattr(main_module, "_build_analyzer", lambda: None)
    monkeypatch.setattr(main_module, "_build_medical", lambda: None)
    monkeypatch.setattr(main_module, "_build_deid", lambda: None)


def _client() -> TestClient:
    return TestClient(main_module.app)


def _authed(text: str = "John Smith SSN 123-45-6789") -> dict:
    return {"json": {"text": text}, "headers": {"X-Lana-Service-Secret": SECRET}}


# --- strict + analyzer unavailable => fail closed (not silent regex) -----------


def test_strict_analyzer_unavailable_returns_503_degraded(monkeypatch, no_model_load):
    monkeypatch.setattr(main_module, "_STRICT", True)
    monkeypatch.setattr(main_module, "_INTERNAL_SERVICE_SECRET", SECRET)
    monkeypatch.setattr(main_module, "_analyzer", None)
    with _client() as client:
        resp = client.post("/redact", **_authed())
    assert resp.status_code == 503
    detail = resp.json()["detail"]
    assert detail["degraded"] is True
    assert detail["reason"] == "ner_unavailable"


# --- strict + mid-request analyzer error => fail closed ------------------------


def test_strict_analyzer_mid_request_error_returns_503(monkeypatch, no_model_load):
    monkeypatch.setattr(main_module, "_STRICT", True)
    monkeypatch.setattr(main_module, "_INTERNAL_SERVICE_SECRET", SECRET)
    monkeypatch.setattr(main_module, "_analyzer", _ThrowingAnalyzer())
    with _client() as client:
        resp = client.post("/redact", **_authed())
    assert resp.status_code == 503
    assert resp.json()["detail"]["reason"] == "ner_analyzer_error"


# --- non-strict => current behavior preserved ----------------------------------


def test_non_strict_analyzer_unavailable_returns_200(monkeypatch, no_model_load):
    # Dev default: analyzer=None degrades to regex backstops and serves 200. The
    # SSN is still caught by the backstop; a NAME would leak (that is exactly the
    # silent degradation strict mode forbids), but the request is not refused.
    monkeypatch.setattr(main_module, "_STRICT", False)
    monkeypatch.setattr(main_module, "_INTERNAL_SERVICE_SECRET", "")
    monkeypatch.setattr(main_module, "_analyzer", None)
    with _client() as client:
        resp = client.post("/redact", json={"text": "John Smith SSN 123-45-6789"})
    assert resp.status_code == 200
    body = resp.json()
    assert "123-45-6789" not in body["redacted"]  # regex backstop fired


def test_non_strict_analyzer_mid_request_error_returns_200(monkeypatch, no_model_load):
    monkeypatch.setattr(main_module, "_STRICT", False)
    monkeypatch.setattr(main_module, "_INTERNAL_SERVICE_SECRET", "")
    monkeypatch.setattr(main_module, "_analyzer", _ThrowingAnalyzer())
    with _client() as client:
        resp = client.post("/redact", json={"text": "John Smith SSN 123-45-6789"})
    assert resp.status_code == 200
    assert "123-45-6789" not in resp.json()["redacted"]


# --- strict + unauthenticated => refused ---------------------------------------


def test_strict_unauthenticated_refused_503(monkeypatch, no_model_load):
    # Rollout shim is disabled in strict mode: no secret configured => refuse.
    monkeypatch.setattr(main_module, "_STRICT", True)
    monkeypatch.setattr(main_module, "_INTERNAL_SERVICE_SECRET", "")
    monkeypatch.setattr(main_module, "_analyzer", _FakeAnalyzer())
    with _client() as client:
        resp = client.post("/redact", json={"text": "hello"})
    assert resp.status_code == 503
    assert resp.json()["detail"]["reason"] == "auth_required_unconfigured"


def test_strict_missing_header_still_401(monkeypatch, no_model_load):
    # With a secret configured, a missing/wrong header is a normal 401 (auth), not
    # a degraded 503 — the enforcement path is unchanged in strict mode.
    monkeypatch.setattr(main_module, "_STRICT", True)
    monkeypatch.setattr(main_module, "_INTERNAL_SERVICE_SECRET", SECRET)
    monkeypatch.setattr(main_module, "_analyzer", _FakeAnalyzer())
    with _client() as client:
        resp = client.post("/redact", json={"text": "hello"})
    assert resp.status_code == 401


# --- strict happy path ---------------------------------------------------------


def test_strict_happy_path_returns_200(monkeypatch, no_model_load):
    monkeypatch.setattr(main_module, "_STRICT", True)
    monkeypatch.setattr(main_module, "_INTERNAL_SERVICE_SECRET", SECRET)
    monkeypatch.setattr(main_module, "_analyzer", _FakeAnalyzer())
    with _client() as client:
        resp = client.post("/redact", **_authed("SSN 123-45-6789"))
    assert resp.status_code == 200
    assert "123-45-6789" not in resp.json()["redacted"]


# --- healthz reflects strict readiness -----------------------------------------


def test_healthz_reports_strict_and_readiness(monkeypatch, no_model_load):
    monkeypatch.setattr(main_module, "_STRICT", True)
    monkeypatch.setattr(main_module, "_INTERNAL_SERVICE_SECRET", SECRET)
    monkeypatch.setattr(main_module, "_analyzer", _FakeAnalyzer())
    with _client() as client:
        resp = client.get("/healthz")
    body = resp.json()
    assert body["strict"] is True
    assert body["ready"] is True

    # Not ready when the required analyzer is missing.
    monkeypatch.setattr(main_module, "_analyzer", None)
    with _client() as client:
        resp = client.get("/healthz")
    assert resp.json()["ready"] is False


def test_startup_critical_when_strict_and_analyzer_missing(
    monkeypatch, no_model_load, caplog
):
    monkeypatch.setattr(main_module, "_STRICT", True)
    monkeypatch.setattr(main_module, "_INTERNAL_SERVICE_SECRET", SECRET)
    monkeypatch.setattr(main_module, "_analyzer", None)
    with caplog.at_level(logging.CRITICAL, logger="redactor"):
        with _client():
            pass
    assert any(
        "redactor.strict_ner_unavailable" in r.getMessage() for r in caplog.records
    )
