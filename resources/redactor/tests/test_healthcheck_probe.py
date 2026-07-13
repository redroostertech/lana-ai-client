"""Unit test for the container healthcheck probe (security-posture-audit G6).

The probe (healthcheck.py) is what answers Docker/Railway's healthcheck. It must:
  * exit 0 when /healthz returns 200 (over http OR https — it tries both),
  * exit 1 when nothing is listening,
so a slow-but-healthy boot, once it finishes loading models, reports healthy on
either scheme. These tests stand up a trivial 200/non-200 server on a loopback
port and assert the probe's exit code, without Docker.
"""

from __future__ import annotations

import http.server
import importlib.util
import socket
import threading
from pathlib import Path

import pytest

PROBE = Path(__file__).resolve().parents[1] / "healthcheck.py"


def _load_probe():
    spec = importlib.util.spec_from_file_location("redactor_healthcheck", PROBE)
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mod)
    return mod


def _free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class _OK(http.server.BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, *a):  # silence
        pass


@pytest.mark.skipif(not PROBE.exists(), reason="healthcheck.py missing")
def test_probe_exits_0_on_http_200(monkeypatch):
    port = _free_port()
    srv = http.server.HTTPServer(("127.0.0.1", port), _OK)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    try:
        monkeypatch.setenv("PORT", str(port))
        mod = _load_probe()
        assert mod.main() == 0
    finally:
        srv.shutdown()


@pytest.mark.skipif(not PROBE.exists(), reason="healthcheck.py missing")
def test_probe_exits_1_when_nothing_listening(monkeypatch):
    port = _free_port()  # nothing bound here
    monkeypatch.setenv("PORT", str(port))
    mod = _load_probe()
    assert mod.main() == 1
