"""Internal-service auth on the redactor (security-posture-audit G6).

The /redact endpoint sees CLEARTEXT (pre-redaction PII), so it is the most
sensitive internal hop. These tests cover the constant-time secret check AND the
safe-rollout shim (no secret configured -> serve + warn, so the enforcing build
can ship before the env var is set).

The engine's ``redact`` is monkeypatched to a deterministic stub so the tests do
not depend on the heavy spaCy/Presidio model being installed.
"""

from __future__ import annotations

import logging

import pytest
from fastapi.testclient import TestClient

from redactor import main as main_module
from redactor.engine import RedactionResult

SECRET = "internal-service-secret-xyz"


@pytest.fixture
def stub_engine(monkeypatch):
    """Replace the heavy NER call with a deterministic stub so the 200-path tests
    exercise auth + the handler without loading spaCy."""

    def _fake_redact(text, **_kwargs):
        return RedactionResult(redacted="[REDACTED]", token_map={"x": "y"}, entities=[])

    def _fake_redact_scoped(text, terms, **_kwargs):
        return RedactionResult(redacted="[REDACTED]", token_map={"x": "y"}, entities=[])

    monkeypatch.setattr(main_module, "redact", _fake_redact)
    monkeypatch.setattr(main_module, "redact_scoped", _fake_redact_scoped)


def _client() -> TestClient:
    # raise_server_exceptions default; lifespan runs the startup warning path.
    return TestClient(main_module.app)


# --- enforcement (secret configured) ---------------------------------------


def test_redact_401_when_secret_configured_and_header_missing(monkeypatch, stub_engine):
    monkeypatch.setattr(main_module, "_INTERNAL_SERVICE_SECRET", SECRET)
    with _client() as client:
        resp = client.post("/redact", json={"text": "hello"})
    assert resp.status_code == 401


def test_redact_401_when_header_wrong(monkeypatch, stub_engine):
    monkeypatch.setattr(main_module, "_INTERNAL_SERVICE_SECRET", SECRET)
    with _client() as client:
        resp = client.post(
            "/redact",
            json={"text": "hello"},
            headers={"X-Lana-Service-Secret": "nope"},
        )
    assert resp.status_code == 401


def test_redact_200_when_header_correct(monkeypatch, stub_engine):
    monkeypatch.setattr(main_module, "_INTERNAL_SERVICE_SECRET", SECRET)
    with _client() as client:
        resp = client.post(
            "/redact",
            json={"text": "hello"},
            headers={
                "X-Lana-Service": "api",
                "X-Lana-Service-Secret": SECRET,
            },
        )
    assert resp.status_code == 200
    assert resp.json()["redacted"] == "[REDACTED]"


def test_redact_200_when_secret_has_trailing_whitespace_exact_match(
    monkeypatch, stub_engine
):
    """M4 (G6 whitespace symmetry): a secret carrying trailing whitespace must
    authenticate when the SAME raw value is presented. The redactor no longer
    strips either side, so a byte-identical secret with trailing whitespace
    matches (previously the asymmetric .strip() made it a permanent 401)."""
    secret_with_ws = "internal-service-secret-xyz  "  # trailing spaces
    monkeypatch.setattr(main_module, "_INTERNAL_SERVICE_SECRET", secret_with_ws)
    with _client() as client:
        resp = client.post(
            "/redact",
            json={"text": "hello"},
            headers={"X-Lana-Service-Secret": secret_with_ws},
        )
    assert resp.status_code == 200
    assert resp.json()["redacted"] == "[REDACTED]"


def test_redact_401_when_presented_differs_only_by_whitespace(
    monkeypatch, stub_engine
):
    """The compare is byte-exact (no strip on either side): a header that differs
    from the configured secret ONLY by trailing whitespace is rejected."""
    monkeypatch.setattr(main_module, "_INTERNAL_SERVICE_SECRET", SECRET)
    with _client() as client:
        resp = client.post(
            "/redact",
            json={"text": "hello"},
            headers={"X-Lana-Service-Secret": SECRET + "  "},
        )
    assert resp.status_code == 401


# --- safe-rollout shim (no secret configured) ------------------------------


def test_redact_200_when_no_secret_configured(monkeypatch, stub_engine):
    """Rollout shim: with no secret set, /redact serves even with NO header so the
    enforcing build can deploy before the env var is provisioned."""
    monkeypatch.setattr(main_module, "_INTERNAL_SERVICE_SECRET", "")
    with _client() as client:
        resp = client.post("/redact", json={"text": "hello"})
    assert resp.status_code == 200
    assert resp.json()["redacted"] == "[REDACTED]"


def test_startup_warns_when_no_secret(monkeypatch, stub_engine, caplog):
    monkeypatch.setattr(main_module, "_INTERNAL_SERVICE_SECRET", "")
    with caplog.at_level(logging.WARNING, logger="redactor"):
        with _client():
            pass
    assert any(
        "redactor.auth_disabled_no_secret" in r.getMessage() for r in caplog.records
    )


def test_healthz_open_without_secret_header(monkeypatch):
    """/healthz stays unauthenticated even when a secret IS configured."""
    monkeypatch.setattr(main_module, "_INTERNAL_SERVICE_SECRET", SECRET)
    with _client() as client:
        resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
