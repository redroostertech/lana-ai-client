#!/usr/bin/env sh
# Lana Cloud - Redactor container entrypoint.
#
# Serves the redactor via uvicorn. TLS (security-posture-audit G6, wire-level) is
# OPT-IN and default OFF.
#
# CERT DELIVERY (Railway-friendly): Railway containers can't easily mount files,
# so the server cert+key are delivered as ENV VARS and written to a tmp path at
# boot here; we then point the existing REDACTOR_SSL_CERTFILE / REDACTOR_SSL_KEYFILE
# flags at those files.
#
# TWO delivery encodings (prefer BASE64):
#   * BASE64 (PREFERRED): REDACTOR_SSL_CERT_B64 / REDACTOR_SSL_KEY_B64 hold the
#     PEM base64-encoded on a SINGLE line (base64 -w0). This is env-safe: a
#     multi-line PEM pushed straight through a Railway env var gets its newlines/
#     whitespace mangled, so uvicorn never gets a valid cert and silently stays
#     plaintext (this is exactly what broke G6 Hop 1 in prod). Base64 has no
#     newlines, so it survives the env round-trip intact.
#   * RAW PEM (legacy/fallback): REDACTOR_SSL_CERT_PEM / REDACTOR_SSL_KEY_PEM hold
#     the raw multi-line PEM. Kept working for a known-good value, but the env
#     path is fragile — use base64 on Railway.
# An explicit REDACTOR_SSL_CERTFILE / REDACTOR_SSL_KEYFILE (a real file mount)
# WINS over both and is never clobbered.
#
# TLS engages when BOTH REDACTOR_SSL_CERTFILE and REDACTOR_SSL_KEYFILE end up
# pointing at readable, non-empty files: uvicorn terminates TLS so the gateway
# can reach the redactor over https:// (the most sensitive internal hop — it sees
# cleartext PII). When neither a cert env var nor the *_FILE flags are set (the
# DEFAULT), uvicorn serves PLAINTEXT exactly as before, so shipping this image
# without any cert env changes nothing.
#
# FAIL LOUD: if a cert env var IS set but can't be materialised into a readable,
# non-empty file (bad base64, empty value, unwritable dir, half a pair), we EXIT
# NON-ZERO rather than silently booting plaintext. Silent fallback is what hid
# the prod failure: the operator believed TLS was on while uvicorn stayed http.
#
# NOTE: uvicorn reads the cert at boot, so enabling TLS (or rotating the cert)
# requires a container RESTART.
set -eu

PORT="${PORT:-18081}"
TLS_TMP="${REDACTOR_TLS_DIR:-/tmp/lana-tls}"

log() { echo "$1"; }
die() { echo "$1" >&2; exit 1; }

# materialise_b64 <b64-env-value> <dest-file> <label>
# base64-decode the value to dest; fail loud on decode error / empty result.
materialise_b64() {
  _val="$1"; _dest="$2"; _label="$3"
  mkdir -p "$TLS_TMP" || die "{\"event\":\"redactor.entrypoint.tls_error\",\"label\":\"${_label}\",\"reason\":\"mkdir ${TLS_TMP} failed\"}"
  # `base64 -d` (GNU coreutils / BusyBox / macOS) decodes; capture failure.
  if ! printf '%s' "$_val" | base64 -d > "$_dest" 2>/dev/null; then
    die "{\"event\":\"redactor.entrypoint.tls_error\",\"label\":\"${_label}\",\"reason\":\"base64 decode failed (is the value base64 -w0 of the PEM?)\"}"
  fi
  if [ ! -s "$_dest" ]; then
    die "{\"event\":\"redactor.entrypoint.tls_error\",\"label\":\"${_label}\",\"reason\":\"decoded cert file is empty\"}"
  fi
  chmod 600 "$_dest"
  log "{\"event\":\"redactor.entrypoint.tls_decoded\",\"label\":\"${_label}\",\"mode\":\"base64\",\"path\":\"${_dest}\"}"
}

# materialise_pem <pem-env-value> <dest-file> <label>
# Write a raw PEM verbatim; fail loud if the result is empty.
materialise_pem() {
  _val="$1"; _dest="$2"; _label="$3"
  mkdir -p "$TLS_TMP" || die "{\"event\":\"redactor.entrypoint.tls_error\",\"label\":\"${_label}\",\"reason\":\"mkdir ${TLS_TMP} failed\"}"
  printf '%s' "$_val" > "$_dest"
  if [ ! -s "$_dest" ]; then
    die "{\"event\":\"redactor.entrypoint.tls_error\",\"label\":\"${_label}\",\"reason\":\"written PEM file is empty\"}"
  fi
  chmod 600 "$_dest"
  log "{\"event\":\"redactor.entrypoint.tls_decoded\",\"label\":\"${_label}\",\"mode\":\"raw_pem\",\"path\":\"${_dest}\"}"
}

# --- Cert delivery from env (G6) ---------------------------------------------
# Precedence per slot: explicit *_FILE (mount) > *_B64 (preferred) > *_PEM (raw).
# A *_FILE already set means "use the mount" — skip env materialisation.

# Server cert.
if [ -z "${REDACTOR_SSL_CERTFILE:-}" ]; then
  if [ -n "${REDACTOR_SSL_CERT_B64:-}" ]; then
    materialise_b64 "$REDACTOR_SSL_CERT_B64" "$TLS_TMP/server.crt" "cert"
    REDACTOR_SSL_CERTFILE="$TLS_TMP/server.crt"; export REDACTOR_SSL_CERTFILE
  elif [ -n "${REDACTOR_SSL_CERT_PEM:-}" ]; then
    materialise_pem "$REDACTOR_SSL_CERT_PEM" "$TLS_TMP/server.crt" "cert"
    REDACTOR_SSL_CERTFILE="$TLS_TMP/server.crt"; export REDACTOR_SSL_CERTFILE
  fi
fi

# Server key.
if [ -z "${REDACTOR_SSL_KEYFILE:-}" ]; then
  if [ -n "${REDACTOR_SSL_KEY_B64:-}" ]; then
    materialise_b64 "$REDACTOR_SSL_KEY_B64" "$TLS_TMP/server.key" "key"
    REDACTOR_SSL_KEYFILE="$TLS_TMP/server.key"; export REDACTOR_SSL_KEYFILE
  elif [ -n "${REDACTOR_SSL_KEY_PEM:-}" ]; then
    materialise_pem "$REDACTOR_SSL_KEY_PEM" "$TLS_TMP/server.key" "key"
    REDACTOR_SSL_KEYFILE="$TLS_TMP/server.key"; export REDACTOR_SSL_KEYFILE
  fi
fi

# --- Fail loud on a half-delivered cert pair ---------------------------------
# If exactly ONE of cert/key is configured, uvicorn can't serve TLS. Exiting
# here is louder than booting plaintext (which is what hid the prod failure).
if [ -n "${REDACTOR_SSL_CERTFILE:-}" ] && [ -z "${REDACTOR_SSL_KEYFILE:-}" ]; then
  die '{"event":"redactor.entrypoint.tls_error","reason":"cert configured but key missing (set REDACTOR_SSL_KEY_B64)"}'
fi
if [ -z "${REDACTOR_SSL_CERTFILE:-}" ] && [ -n "${REDACTOR_SSL_KEYFILE:-}" ]; then
  die '{"event":"redactor.entrypoint.tls_error","reason":"key configured but cert missing (set REDACTOR_SSL_CERT_B64)"}'
fi

# --- Serve -------------------------------------------------------------------
if [ -n "${REDACTOR_SSL_CERTFILE:-}" ] && [ -n "${REDACTOR_SSL_KEYFILE:-}" ]; then
  # Both files must be readable & non-empty, or uvicorn would crash opaquely —
  # fail loud with a clear reason instead.
  [ -r "$REDACTOR_SSL_CERTFILE" ] && [ -s "$REDACTOR_SSL_CERTFILE" ] || \
    die "{\"event\":\"redactor.entrypoint.tls_error\",\"reason\":\"certfile unreadable/empty\",\"path\":\"${REDACTOR_SSL_CERTFILE}\"}"
  [ -r "$REDACTOR_SSL_KEYFILE" ] && [ -s "$REDACTOR_SSL_KEYFILE" ] || \
    die "{\"event\":\"redactor.entrypoint.tls_error\",\"reason\":\"keyfile unreadable/empty\",\"path\":\"${REDACTOR_SSL_KEYFILE}\"}"

  log "{\"event\":\"redactor.entrypoint.serve_tls\",\"port\":\"${PORT}\",\"cert\":\"${REDACTOR_SSL_CERTFILE}\",\"key\":\"${REDACTOR_SSL_KEYFILE}\"}"
  exec uvicorn redactor.main:app \
    --host 0.0.0.0 --port "${PORT}" \
    --ssl-certfile "${REDACTOR_SSL_CERTFILE}" \
    --ssl-keyfile "${REDACTOR_SSL_KEYFILE}"
fi

log "{\"event\":\"redactor.entrypoint.serve_plaintext\",\"port\":\"${PORT}\"}"
exec uvicorn redactor.main:app --host 0.0.0.0 --port "${PORT}"
