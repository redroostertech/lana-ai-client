#!/usr/bin/env bash
# ============================================================================
# LANA One — Redactor sidecar launcher (the sovereign-privacy MOAT)
# ============================================================================
# Stable entrypoint the supervisor (Lane 5 / service-topology) spawns to bring
# up the on-device Presidio + spaCy de-identification service. Mirrors the
# parent repo's sidecar/timesfm/run.sh pattern (self-contained venv + exec the
# server) so the supervisor can treat every sidecar the same way.
#
# CONTRACT (do not break — Lane 5 depends on it):
#   * Invoke as:   REDACTOR_PORT=8091 client/resources/redactor/run.sh
#   * The service listens on ${REDACTOR_PORT:-8091}, host ${REDACTOR_HOST:-127.0.0.1}.
#   * FastAPI app is redactor.main:app (served via uvicorn), health at GET /healthz.
#     The /redact* endpoints require a service secret (Depends(require_service_secret));
#     Lane 5 must pass that secret via the redactor's env when it fronts the service.
#   * Exits NON-ZERO (fail loud) if provisioning is incomplete and cannot self-heal,
#     so the supervisor treats a broken redactor as a hard error rather than
#     silently degrading the moat.
#
# IDEMPOTENT: the venv + pip install run ONCE. A sentinel file records a
# successful provision keyed by this script's dependency set; subsequent boots
# skip straight to `exec uvicorn`. Delete the sentinel (or set REDACTOR_FORCE_REINSTALL=1)
# to re-provision.
#
# PROVISIONING IS DEFERRED: on a fresh machine the FIRST invocation performs the
# heavy pip install (Presidio + spaCy + en_core_web_lg, ~hundreds of MB). LANA
# One triggers that from its in-app setup step, not at package time. The optional
# de-id transformer layer (torch + transformers, multi-GB) is OFF by default and
# only installed when REDACTOR_INSTALL_ML=1.
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Config (all overridable by the supervisor via env) ----------------------
REDACTOR_HOST="${REDACTOR_HOST:-127.0.0.1}"
REDACTOR_PORT="${REDACTOR_PORT:-8091}"
VENV_DIR="${REDACTOR_VENV:-$HOME/.venv/lana-redactor}"
PYTHON_BIN="${REDACTOR_PYTHON:-python3}"
# Bump when the dependency set changes so an old venv re-provisions on next boot.
PROVISION_TAG="presidio2.2.355+spacy3.7.5+lg3.7.1$([ "${REDACTOR_INSTALL_ML:-0}" = "1" ] && echo '+ml' || true)"
SENTINEL="${VENV_DIR}/.lana-redactor-provisioned"

log() { echo "[redactor] $*"; }
die() { echo "[redactor] ERROR: $*" >&2; exit 1; }

command -v "$PYTHON_BIN" >/dev/null 2>&1 || die "python interpreter '$PYTHON_BIN' not found on PATH"

# --- Provision the venv (idempotent) -----------------------------------------
needs_provision() {
  [ "${REDACTOR_FORCE_REINSTALL:-0}" = "1" ] && return 0
  [ -x "${VENV_DIR}/bin/python" ] || return 0
  [ -f "$SENTINEL" ] || return 0
  [ "$(cat "$SENTINEL" 2>/dev/null || true)" = "$PROVISION_TAG" ] || return 0
  return 1
}

if needs_provision; then
  log "provisioning venv at ${VENV_DIR} (tag: ${PROVISION_TAG})"
  if [ ! -x "${VENV_DIR}/bin/python" ]; then
    "$PYTHON_BIN" -m venv "$VENV_DIR" || die "failed to create venv at ${VENV_DIR}"
  fi
  # shellcheck disable=SC1091
  source "${VENV_DIR}/bin/activate"

  python -m pip install --upgrade pip >/dev/null || die "pip self-upgrade failed"

  # Base moat: FastAPI + Presidio (analyzer/anonymizer) + spaCy + the
  # en_core_web_lg model (a direct-URL dependency declared in pyproject.toml, so
  # `pip install .` pulls it automatically) + the true-document-redaction deps.
  log "installing base redactor dependencies (Presidio + spaCy + en_core_web_lg)"
  python -m pip install "${SCRIPT_DIR}" || die "base redactor install failed"

  # Optional de-id transformer layer (obi/deid_roberta_i2b2 via torch +
  # transformers). Heavy (multi-GB); OFF unless explicitly requested. On macOS
  # the default PyPI torch wheel is CPU/MPS, so the extra installs cleanly.
  if [ "${REDACTOR_INSTALL_ML:-0}" = "1" ]; then
    log "installing optional de-id ML layer (torch + transformers) — this is large"
    python -m pip install "${SCRIPT_DIR}[deid]" || die "de-id ML layer install failed"
  fi

  # Belt-and-suspenders: ensure the spaCy model is importable even if a future
  # pyproject drops the direct-URL pin. No-op when en_core_web_lg is present.
  if ! python -c 'import en_core_web_lg' >/dev/null 2>&1; then
    log "en_core_web_lg not importable after install; fetching via spacy download"
    python -m spacy download en_core_web_lg || die "spaCy en_core_web_lg download failed"
  fi

  printf '%s' "$PROVISION_TAG" > "$SENTINEL"
  log "provisioning complete"
else
  # shellcheck disable=SC1091
  source "${VENV_DIR}/bin/activate"
fi

# --- Serve -------------------------------------------------------------------
# Bind loopback by default (sovereign desktop: nothing off-box should reach the
# cleartext-PII hop). The supervisor may override REDACTOR_HOST if it fronts the
# service behind its own auth/TLS.
log "starting redactor on ${REDACTOR_HOST}:${REDACTOR_PORT} (app: redactor.main:app)"
cd "${SCRIPT_DIR}"
exec uvicorn redactor.main:app \
  --host "${REDACTOR_HOST}" \
  --port "${REDACTOR_PORT}" \
  --log-level info
