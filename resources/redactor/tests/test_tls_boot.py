"""Redactor TLS boot proof (security-posture-audit G6, wire-level).

WHY THIS EXISTS: G6 Hop 1 (redactor TLS) was first exercised on PRODUCTION and
failed — the redactor stayed on http and chat 502'd until rollback. The first
real test of "does the redactor actually serve https with this cert env" was
prod. This test moves that proof OFF prod: it materialises an env-delivered
PEM exactly as ``entrypoint.sh`` does, boots a real uvicorn TLS listener against
``redactor.main:app``, and asserts:

  * GET  /healthz       returns 200 over https with the self-signed CA trusted
  * POST /redact        returns a 200 redaction over https with the
                        X-Lana-Service-Secret enforced

It runs with NO Docker and NO heavy ML models: the engine ``redact`` call is
stubbed, and a throwaway self-signed cert is minted in-process with the stdlib +
``cryptography`` (already a transitive dep of presidio). If ``cryptography`` is
unavailable the cert-minting tests skip, but the entrypoint cert-materialisation
logic (the part that bit us — env PEM -> file -> *_FILE flag) is still asserted
with a static fixture so the regression is always covered.

This is the unit-level companion to deploy/railway/tls/dryrun_redactor_tls.sh
(the Docker/local end-to-end harness the orchestrator runs before prod).
"""

from __future__ import annotations

import os
import socket
import ssl
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

# requests is a presidio transitive dep; fall back to urllib if it is absent so
# the test never hard-depends on it.
try:  # pragma: no cover - import shim
    import requests  # type: ignore

    _HAVE_REQUESTS = True
except Exception:  # pragma: no cover
    _HAVE_REQUESTS = False

try:
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID

    _HAVE_CRYPTO = True
except Exception:  # pragma: no cover
    _HAVE_CRYPTO = False


SECRET = "internal-service-secret-xyz"
REPO_REDACTOR = Path(__file__).resolve().parents[1]
ENTRYPOINT = REPO_REDACTOR / "entrypoint.sh"


def _free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _mint_self_signed(common_name: str = "localhost") -> tuple[bytes, bytes]:
    """Mint a throwaway self-signed cert (the CA == the leaf for a single host).

    Returns (cert_pem, key_pem). SAN covers localhost + 127.0.0.1 so a TLS client
    pinning the cert as its CA verifies the hostname. This mirrors what
    gen-internal-certs.sh produces (ECDSA P-256, serverAuth) but self-contained."""
    key = ec.generate_private_key(ec.SECP256R1())
    subject = issuer = x509.Name(
        [x509.NameAttribute(NameOID.COMMON_NAME, common_name)]
    )
    import datetime

    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.utcnow() - datetime.timedelta(minutes=5))
        .not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=1))
        .add_extension(
            x509.SubjectAlternativeName(
                [
                    x509.DNSName("localhost"),
                    x509.IPAddress(__import__("ipaddress").ip_address("127.0.0.1")),
                ]
            ),
            critical=False,
        )
        .add_extension(
            x509.ExtendedKeyUsage([x509.ExtendedKeyUsageOID.SERVER_AUTH]),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )
    cert_pem = cert.public_bytes(serialization.Encoding.PEM)
    key_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return cert_pem, key_pem


# ---------------------------------------------------------------------------
# 1. Entrypoint cert-materialisation (the exact step that bit us in prod).
#    Runs the real entrypoint.sh with the PEM env vars + a no-op uvicorn shim and
#    asserts it (a) writes the PEM to a file, (b) chooses the serve_tls branch,
#    (c) passes --ssl-certfile/--ssl-keyfile. No Python TLS server needed.
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not ENTRYPOINT.exists(), reason="entrypoint.sh missing")
def test_entrypoint_materialises_pem_and_selects_tls(tmp_path):
    cert_pem = b"-----BEGIN CERTIFICATE-----\nMIIB-fake\n-----END CERTIFICATE-----\n"
    key_pem = b"-----BEGIN EC PRIVATE KEY-----\nMHcfake\n-----END EC PRIVATE KEY-----\n"

    tls_dir = tmp_path / "lana-tls"
    # A fake `uvicorn` on PATH that just echoes its args + env and exits 0, so the
    # entrypoint's exec is observable without booting a real server.
    binstub = tmp_path / "bin"
    binstub.mkdir()
    fake_uvicorn = binstub / "uvicorn"
    fake_uvicorn.write_text(
        "#!/usr/bin/env sh\n"
        'echo "UVICORN_ARGS: $*"\n'
        'echo "CERTFILE_CONTENTS_PRESENT:$( [ -s \\"$REDACTOR_SSL_CERTFILE\\" ] && echo yes || echo no )"\n'
    )
    fake_uvicorn.chmod(0o755)

    env = dict(os.environ)
    env["PATH"] = f"{binstub}:{env['PATH']}"
    env["PORT"] = "18081"
    env["REDACTOR_TLS_DIR"] = str(tls_dir)
    env["REDACTOR_SSL_CERT_PEM"] = cert_pem.decode()
    env["REDACTOR_SSL_KEY_PEM"] = key_pem.decode()
    # Ensure the *_FILE overrides are NOT set so the PEM-materialise path runs.
    env.pop("REDACTOR_SSL_CERTFILE", None)
    env.pop("REDACTOR_SSL_KEYFILE", None)

    out = subprocess.run(
        ["sh", str(ENTRYPOINT)],
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    combined = out.stdout + out.stderr
    # It must have chosen the TLS branch and logged the greppable serve_tls event.
    assert "redactor.entrypoint.serve_tls" in combined, combined
    assert "--ssl-certfile" in combined and "--ssl-keyfile" in combined, combined
    # The PEM must have been written to disk and be non-empty.
    assert (tls_dir / "server.crt").read_bytes() == cert_pem
    assert (tls_dir / "server.key").read_bytes() == key_pem


@pytest.mark.skipif(not ENTRYPOINT.exists(), reason="entrypoint.sh missing")
def test_entrypoint_materialises_base64_and_selects_tls(tmp_path):
    """PREFERRED path (the prod fix): cert/key delivered as base64 *_B64 env vars
    are base64-decoded back to the original PEM on disk and the entrypoint selects
    the serve_tls branch. Base64 is env-safe (single line, no newline mangling)."""
    import base64

    cert_pem = b"-----BEGIN CERTIFICATE-----\nMIIB-fake-b64\n-----END CERTIFICATE-----\n"
    key_pem = b"-----BEGIN EC PRIVATE KEY-----\nMHc-fake-b64\n-----END EC PRIVATE KEY-----\n"

    tls_dir = tmp_path / "lana-tls"
    binstub = tmp_path / "bin"
    binstub.mkdir()
    fake_uvicorn = binstub / "uvicorn"
    fake_uvicorn.write_text("#!/usr/bin/env sh\necho \"UVICORN_ARGS: $*\"\n")
    fake_uvicorn.chmod(0o755)

    env = dict(os.environ)
    env["PATH"] = f"{binstub}:{env['PATH']}"
    env["PORT"] = "18081"
    env["REDACTOR_TLS_DIR"] = str(tls_dir)
    env["REDACTOR_SSL_CERT_B64"] = base64.b64encode(cert_pem).decode()
    env["REDACTOR_SSL_KEY_B64"] = base64.b64encode(key_pem).decode()
    for k in (
        "REDACTOR_SSL_CERT_PEM",
        "REDACTOR_SSL_KEY_PEM",
        "REDACTOR_SSL_CERTFILE",
        "REDACTOR_SSL_KEYFILE",
    ):
        env.pop(k, None)

    out = subprocess.run(
        ["sh", str(ENTRYPOINT)], env=env, capture_output=True, text=True, timeout=30
    )
    combined = out.stdout + out.stderr
    assert out.returncode == 0, combined
    assert "redactor.entrypoint.serve_tls" in combined, combined
    assert '"mode":"base64"' in combined, combined
    assert "--ssl-certfile" in combined and "--ssl-keyfile" in combined, combined
    # The base64 must have round-tripped back to the EXACT original PEM bytes.
    assert (tls_dir / "server.crt").read_bytes() == cert_pem
    assert (tls_dir / "server.key").read_bytes() == key_pem


@pytest.mark.skipif(not ENTRYPOINT.exists(), reason="entrypoint.sh missing")
def test_entrypoint_fails_loud_on_bad_base64(tmp_path):
    """A present *_B64 that won't base64-decode must EXIT NON-ZERO and never reach
    a uvicorn invocation. Fail loud — silently booting plaintext is what hid the
    prod failure (uvicorn stayed http while the operator believed TLS was on)."""
    binstub = tmp_path / "bin"
    binstub.mkdir()
    fake_uvicorn = binstub / "uvicorn"
    # If uvicorn is ever reached, it would print this marker — it must NOT appear.
    fake_uvicorn.write_text("#!/usr/bin/env sh\necho UVICORN_WAS_REACHED\n")
    fake_uvicorn.chmod(0o755)

    env = dict(os.environ)
    env["PATH"] = f"{binstub}:{env['PATH']}"
    env["REDACTOR_TLS_DIR"] = str(tmp_path / "lana-tls")
    env["REDACTOR_SSL_CERT_B64"] = "@@@@not-valid-base64@@@@"
    env["REDACTOR_SSL_KEY_B64"] = "@@@@not-valid-base64@@@@"
    for k in (
        "REDACTOR_SSL_CERT_PEM",
        "REDACTOR_SSL_KEY_PEM",
        "REDACTOR_SSL_CERTFILE",
        "REDACTOR_SSL_KEYFILE",
    ):
        env.pop(k, None)

    out = subprocess.run(
        ["sh", str(ENTRYPOINT)], env=env, capture_output=True, text=True, timeout=30
    )
    combined = out.stdout + out.stderr
    assert out.returncode != 0, combined
    assert "tls_error" in combined, combined
    assert "UVICORN_WAS_REACHED" not in combined, combined
    assert "serve_plaintext" not in combined, combined


@pytest.mark.skipif(not ENTRYPOINT.exists(), reason="entrypoint.sh missing")
def test_entrypoint_fails_loud_on_half_cert_pair(tmp_path):
    """Cert set but key missing must EXIT NON-ZERO rather than serve plaintext —
    a half-delivered pair can't terminate TLS and silent fallback hid the prod
    break."""
    import base64

    binstub = tmp_path / "bin"
    binstub.mkdir()
    fake_uvicorn = binstub / "uvicorn"
    fake_uvicorn.write_text("#!/usr/bin/env sh\necho UVICORN_WAS_REACHED\n")
    fake_uvicorn.chmod(0o755)

    env = dict(os.environ)
    env["PATH"] = f"{binstub}:{env['PATH']}"
    env["REDACTOR_TLS_DIR"] = str(tmp_path / "lana-tls")
    env["REDACTOR_SSL_CERT_B64"] = base64.b64encode(b"-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----\n").decode()
    for k in (
        "REDACTOR_SSL_KEY_B64",
        "REDACTOR_SSL_CERT_PEM",
        "REDACTOR_SSL_KEY_PEM",
        "REDACTOR_SSL_CERTFILE",
        "REDACTOR_SSL_KEYFILE",
    ):
        env.pop(k, None)

    out = subprocess.run(
        ["sh", str(ENTRYPOINT)], env=env, capture_output=True, text=True, timeout=30
    )
    combined = out.stdout + out.stderr
    assert out.returncode != 0, combined
    assert "tls_error" in combined, combined
    assert "UVICORN_WAS_REACHED" not in combined, combined


@pytest.mark.skipif(not ENTRYPOINT.exists(), reason="entrypoint.sh missing")
def test_entrypoint_plaintext_when_no_cert_env(tmp_path):
    """DEFAULT-OFF guarantee: no cert env -> serve (plaintext), never serve_tls."""
    binstub = tmp_path / "bin"
    binstub.mkdir()
    fake_uvicorn = binstub / "uvicorn"
    fake_uvicorn.write_text("#!/usr/bin/env sh\necho ok\n")
    fake_uvicorn.chmod(0o755)

    env = dict(os.environ)
    env["PATH"] = f"{binstub}:{env['PATH']}"
    for k in (
        "REDACTOR_SSL_CERT_PEM",
        "REDACTOR_SSL_KEY_PEM",
        "REDACTOR_SSL_CERTFILE",
        "REDACTOR_SSL_KEYFILE",
    ):
        env.pop(k, None)

    out = subprocess.run(
        ["sh", str(ENTRYPOINT)], env=env, capture_output=True, text=True, timeout=30
    )
    combined = out.stdout + out.stderr
    assert "redactor.entrypoint.serve_plaintext" in combined, combined
    assert "serve_tls" not in combined, combined


# ---------------------------------------------------------------------------
# 2. Real uvicorn TLS listener: prove the app actually SERVES https with a cert,
#    /healthz is 200 over TLS with the self-signed CA trusted, and /redact returns
#    a 200 redaction over TLS with the service secret enforced. This is the exact
#    behaviour prod needed and never validated before going live.
# ---------------------------------------------------------------------------


def _stub_engine(monkeypatch):
    from redactor import main as main_module
    from redactor.engine import RedactionResult

    def _fake_redact(text, **_kwargs):
        return RedactionResult(
            redacted="Counsel for [REDACTED_PERSON_1] filed the motion.",
            token_map={"[REDACTED_PERSON_1]": "Jane Roe"},
            entities=[{"type": "PERSON", "start": 12, "end": 20, "score": 0.99}],
        )

    monkeypatch.setattr(main_module, "redact", _fake_redact)
    monkeypatch.setattr(main_module, "_INTERNAL_SERVICE_SECRET", SECRET)


@pytest.mark.skipif(not _HAVE_CRYPTO, reason="cryptography not installed")
def test_app_serves_https_healthz_and_redact_over_tls(monkeypatch, tmp_path):
    _stub_engine(monkeypatch)

    cert_pem, key_pem = _mint_self_signed()
    cert_file = tmp_path / "server.crt"
    key_file = tmp_path / "server.key"
    cert_file.write_bytes(cert_pem)
    key_file.write_bytes(key_pem)

    import uvicorn

    from redactor import main as main_module

    port = _free_port()
    config = uvicorn.Config(
        main_module.app,
        host="127.0.0.1",
        port=port,
        ssl_certfile=str(cert_file),
        ssl_keyfile=str(key_file),
        log_level="warning",
        lifespan="on",
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        base = f"https://localhost:{port}"
        _wait_until_serving(base, cert_file)

        # --- GET /healthz over TLS, CA-pinned (no skip-verify) ---
        h = _get(base + "/healthz", ca=cert_file)
        assert h.status == 200, h.body
        assert h.json["ok"] is True

        # --- POST /redact over TLS WITHOUT the secret -> 401 (auth enforced) ---
        unauth = _post_json(base + "/redact", {"text": "x"}, ca=cert_file)
        assert unauth.status == 401, unauth.body

        # --- POST /redact over TLS WITH the secret -> 200 redaction ---
        ok = _post_json(
            base + "/redact",
            {"text": "Counsel for Jane Roe filed the motion."},
            ca=cert_file,
            headers={"X-Lana-Service-Secret": SECRET, "X-Lana-Service": "api"},
        )
        assert ok.status == 200, ok.body
        assert "[REDACTED_PERSON_1]" in ok.json["redacted"]
        assert "Jane Roe" not in ok.json["redacted"]
    finally:
        server.should_exit = True
        thread.join(timeout=10)


@pytest.mark.skipif(not _HAVE_CRYPTO, reason="cryptography not installed")
def test_https_handshake_fails_without_trusted_ca(monkeypatch, tmp_path):
    """Negative proof: a client that does NOT trust the self-signed CA fails the
    handshake (there is no skip-verify path). This confirms the listener really is
    presenting the cert and that verification is doing work."""
    _stub_engine(monkeypatch)
    cert_pem, key_pem = _mint_self_signed()
    cert_file = tmp_path / "server.crt"
    key_file = tmp_path / "server.key"
    cert_file.write_bytes(cert_pem)
    key_file.write_bytes(key_pem)

    import uvicorn

    from redactor import main as main_module

    port = _free_port()
    config = uvicorn.Config(
        main_module.app,
        host="127.0.0.1",
        port=port,
        ssl_certfile=str(cert_file),
        ssl_keyfile=str(key_file),
        log_level="warning",
        lifespan="on",
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        base = f"https://localhost:{port}"
        _wait_until_serving(base, cert_file)
        # Default system trust store does NOT include our throwaway CA.
        with pytest.raises(Exception):
            _get(base + "/healthz", ca=None, verify_default=True)
    finally:
        server.should_exit = True
        thread.join(timeout=10)


# ---------------------------------------------------------------------------
# Tiny TLS HTTP client helpers (stdlib urllib so the test does not hard-depend on
# requests; uses requests when available for clarity).
# ---------------------------------------------------------------------------


class _Resp:
    def __init__(self, status, body):
        self.status = status
        self.body = body

    @property
    def json(self):
        import json

        return json.loads(self.body)


def _wait_until_serving(base: str, ca: Path, timeout: float = 30.0) -> None:
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            r = _get(base + "/healthz", ca=ca)
            if r.status == 200:
                return
        except Exception as e:  # not up yet
            last = e
        time.sleep(0.25)
    raise RuntimeError(f"redactor TLS server never became ready: {last}")


def _ssl_ctx(ca: Path | None, verify_default: bool):
    if verify_default:
        return ssl.create_default_context()
    ctx = ssl.create_default_context(cafile=str(ca))
    return ctx


def _get(url, ca, verify_default=False):
    if _HAVE_REQUESTS:
        verify = True if verify_default else str(ca)
        r = requests.get(url, verify=verify, timeout=10)
        return _Resp(r.status_code, r.text)
    import urllib.request

    ctx = _ssl_ctx(ca, verify_default)
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, context=ctx, timeout=10) as resp:
        return _Resp(resp.status, resp.read().decode())


def _post_json(url, payload, ca, headers=None, verify_default=False):
    import json

    body = json.dumps(payload).encode()
    hdrs = {"content-type": "application/json", **(headers or {})}
    if _HAVE_REQUESTS:
        verify = True if verify_default else str(ca)
        r = requests.post(url, data=body, headers=hdrs, verify=verify, timeout=10)
        return _Resp(r.status_code, r.text)
    import urllib.error
    import urllib.request

    ctx = _ssl_ctx(ca, verify_default)
    req = urllib.request.Request(url, data=body, headers=hdrs, method="POST")
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=10) as resp:
            return _Resp(resp.status, resp.read().decode())
    except urllib.error.HTTPError as e:
        return _Resp(e.code, e.read().decode())
