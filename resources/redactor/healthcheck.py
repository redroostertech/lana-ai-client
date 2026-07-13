#!/usr/bin/env python
"""Container healthcheck probe for the redactor (security-posture-audit G6).

Exits 0 if GET /healthz returns 200, else 1. Tries https first then http, so the
SAME probe works whether the redactor is serving plaintext (default) or TLS (cert
env set). This is a LIVENESS probe of our own port, so it does NOT verify the
self-signed internal CA — trust is the gateway/api's job, not the container's
self-check. (The OFF-PROD dry-run harness, by contrast, DOES pin the CA — that is
where cert correctness is proven; see deploy/railway/tls/dryrun_redactor_tls.sh.)

Why this exists as a file rather than an inline HEALTHCHECK one-liner: the FULL
image (Dockerfile.full) has no curl, and a multi-scheme probe is unreadable
crammed into a Dockerfile CMD. The Dockerfile's --start-period is what actually
tolerates the slow model-loading boot; this script just answers the probe.
"""

from __future__ import annotations

import os
import ssl
import sys
import urllib.request


def _ok(url: str, ctx: ssl.SSLContext | None) -> bool:
    try:
        with urllib.request.urlopen(url, context=ctx, timeout=8) as resp:
            return resp.status == 200
    except Exception:
        return False


def main() -> int:
    port = os.getenv("PORT", "18081")
    unverified = ssl._create_unverified_context()  # liveness, not a trust decision
    if _ok(f"https://127.0.0.1:{port}/healthz", unverified):
        return 0
    if _ok(f"http://127.0.0.1:{port}/healthz", None):
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
