#!/usr/bin/env bash
# ============================================================================
# LANA One — TimesFM + Hermes sidecar staging (venv / deps provisioner)
# ============================================================================
# The TimesFM and Hermes sidecars live in the PARENT repo (sidecar/timesfm,
# sidecar/hermes) and are bundled as part of the backend tree. Their SOURCE is
# already present; this script provisions the RUNTIME they need so the supervisor
# (Lane 5) can spawn them. It does NOT add their service specs — Lane 5 owns that.
#
# What it provisions:
#   * TimesFM: a Python venv at ${TIMESFM_VENV:-~/.venv/timesfm} with
#     sidecar/timesfm/requirements.txt installed. (The parent's
#     sidecar/timesfm/run.sh EXPECTS this venv and errors out if it is missing —
#     it does not create it — so this script fills that gap.)
#   * Hermes: a Node sidecar (server.mjs) that imports only Node built-ins + its
#     own local .mjs files. No venv and no `npm install` are required; this
#     script only VERIFIES node is present and the entry file exists.
#
# IDEMPOTENT: a per-sidecar sentinel records a completed provision; re-runs skip
# the heavy pip install. Set SIDECAR_FORCE_REINSTALL=1 to force.
#
# PROVISIONING IS DEFERRED: the TimesFM requirements include torch/transformers
# (multi-GB). Run this from the in-app setup step, not at package time. Pass
# --check to only verify what is already staged without installing anything.
#
# LAUNCH CONTRACT for Lane 5 (ports — see report):
#   * TimesFM:  TIMESFM_HOST=127.0.0.1 TIMESFM_PORT=8092 bash sidecar/timesfm/run.sh
#               PORT 8092 — NOT 8090 (the backend owns 8090); the run.sh default
#               of 8090 MUST be overridden.
#   * Hermes:   HERMES_SIDECAR_PORT=8094 node sidecar/hermes/server.mjs
#               8094 is server.mjs's own default (its existing port); keep it.
# ============================================================================
set -euo pipefail

# Resolve the parent repo's sidecar/ tree. Override with SIDECAR_ROOT when the
# bundled layout differs (e.g. inside the packaged app).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_SIDECAR_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)/sidecar"
SIDECAR_ROOT="${SIDECAR_ROOT:-$DEFAULT_SIDECAR_ROOT}"

TIMESFM_DIR="${SIDECAR_ROOT}/timesfm"
HERMES_DIR="${SIDECAR_ROOT}/hermes"
TIMESFM_VENV="${TIMESFM_VENV:-$HOME/.venv/timesfm}"
PYTHON_BIN="${SIDECAR_PYTHON:-python3}"
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

log() { echo "[sidecars] $*"; }
warn() { echo "[sidecars] WARN: $*" >&2; }
die() { echo "[sidecars] ERROR: $*" >&2; exit 1; }

[ -d "$SIDECAR_ROOT" ] || die "sidecar root not found: ${SIDECAR_ROOT} (set SIDECAR_ROOT)"

# --- TimesFM (Python venv) ---------------------------------------------------
stage_timesfm() {
  [ -d "$TIMESFM_DIR" ] || { warn "timesfm dir missing at ${TIMESFM_DIR}; skipping"; return 0; }
  local reqs="${TIMESFM_DIR}/requirements.txt"
  [ -f "$reqs" ] || die "timesfm requirements.txt missing at ${reqs}"
  local sentinel="${TIMESFM_VENV}/.lana-timesfm-provisioned"

  if [ "$CHECK_ONLY" = "1" ]; then
    if [ -x "${TIMESFM_VENV}/bin/python" ] && [ -f "$sentinel" ]; then
      log "TimesFM venv OK: ${TIMESFM_VENV}"
    else
      warn "TimesFM venv NOT provisioned at ${TIMESFM_VENV} (run without --check)"
    fi
    return 0
  fi

  command -v "$PYTHON_BIN" >/dev/null 2>&1 || die "python '$PYTHON_BIN' not found"
  if [ "${SIDECAR_FORCE_REINSTALL:-0}" != "1" ] && [ -x "${TIMESFM_VENV}/bin/python" ] && [ -f "$sentinel" ]; then
    log "TimesFM already provisioned at ${TIMESFM_VENV}; skipping"
    return 0
  fi

  log "provisioning TimesFM venv at ${TIMESFM_VENV} (installs torch/transformers — large)"
  [ -x "${TIMESFM_VENV}/bin/python" ] || "$PYTHON_BIN" -m venv "$TIMESFM_VENV" || die "venv create failed"
  # shellcheck disable=SC1091
  source "${TIMESFM_VENV}/bin/activate"
  python -m pip install --upgrade pip >/dev/null || die "pip upgrade failed"
  python -m pip install -r "$reqs" || die "timesfm requirements install failed"
  deactivate || true
  touch "$sentinel"
  log "TimesFM provisioning complete"
}

# --- Hermes (Node — no venv) -------------------------------------------------
stage_hermes() {
  [ -d "$HERMES_DIR" ] || { warn "hermes dir missing at ${HERMES_DIR}; skipping"; return 0; }
  local entry="${HERMES_DIR}/server.mjs"
  [ -f "$entry" ] || die "hermes entrypoint missing at ${entry}"
  if command -v node >/dev/null 2>&1; then
    log "Hermes OK: node $(node --version), entry ${entry} (no venv / npm install needed)"
  else
    warn "node not found on PATH — Hermes needs Node.js at runtime"
  fi
}

stage_timesfm
stage_hermes
log "done (check-only=${CHECK_ONLY})"
