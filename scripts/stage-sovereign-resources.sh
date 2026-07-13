#!/usr/bin/env bash
#
# stage-sovereign-resources.sh — assemble the LANA One sovereign-stack native
# resources into a staging dir that electron-builder's `extraResources` picks
# up and copies verbatim into the packaged app's Contents/Resources (see
# electron-builder.lana-one.js). This is PHASE B of docs/specs/
# LANA_ONE_PACKAGING_PLAN.md: relocate/collect Postgres, MinIO, llama-server,
# the embedding model, and the docling/unstructured Python venvs.
#
# Produces (default STAGE_DIR = build/sovereign-resources/, relative to this
# script's client/ dir):
#   postgres/                  <- scripts/relocate-postgres.sh's Cellar-mirroring
#                                  tree (Cellar/postgresql@17/<ver>/bin, lib/, share/)
#   minio/minio  minio/lib/    <- relocated MinIO binary + vendored dylibs
#   llama-server/llama-server  <- relocated llama-server binary
#   llama-server/lib/          <- its vendored dylibs (ggml/llama/openssl)
#   models/<embed-gguf>        <- the embedding GGUF (chat GGUFs are NOT staged;
#                                  they are downloaded at runtime, see §4 of the plan)
#   python/docling/venv/        <- copy of the docling Python 3.11 venv
#   python/docling/model-cache/ <- copy of ~/.cache/docling/models
#   python/unstructured/venv/   <- copy of the unstructured Python 3.11 venv
#   MANIFEST.json               <- what got staged, from where, sizes, status
#
# Postgres is NOT relocated by this script — that is the bespoke job of
# scripts/relocate-postgres.sh (owned separately; produces the Homebrew-
# Cellar-shaped layout supervisor/bootstrap.js's resolveBundledPaths()
# expects, so PG's own make_relative_path() resolves sharedir/pkglibdir with
# no absolute-path overrides). This script SHELLS OUT to it when present and
# otherwise documents the dependency (a missing/non-executable
# relocate-postgres.sh does not abort staging of the other components; it is
# recorded as "missing-dependency" in the manifest so CI/CD can gate on it).
#
# MinIO and llama-server ARE relocated here, via the generic
# scripts/relocate-macho.sh helper (recursive mach-O dependency vendoring +
# @rpath rewrite).
#
# Idempotent: a component whose destination already exists is left alone
# (skipped, recorded in the manifest as "skipped-existing") unless --force.
#
# USAGE:
#   stage-sovereign-resources.sh [options]
#
# OPTIONS (all have dev-box-sane defaults; override for CI or another Mac):
#   --stage-dir DIR              output root (default: build/sovereign-resources)
#   --pg-src DIR                 Homebrew postgresql@17 opt prefix, passed to
#                                 relocate-postgres.sh --src (default: auto-detect
#                                 /opt/homebrew/opt/postgresql@17 or /usr/local/opt/postgresql@17)
#   --relocate-postgres-script F path to relocate-postgres.sh (default: sibling script)
#   --minio-src F                minio binary (default: auto-detect on PATH/brew)
#   --llama-server-src F         llama-server binary (default: ~/llama.cpp/build/bin/llama-server)
#   --embed-model-src F          embedding GGUF (default: ~/.llama-models/nomic-embed-text-v1.5.f16.gguf)
#   --docling-venv-src DIR       docling venv (default: ~/.venv/docling)
#   --docling-cache-src DIR      docling model cache (default: ~/.cache/docling/models)
#   --unstructured-venv-src DIR  unstructured venv (default: ~/.venv/unstructured)
#   --skip-postgres              don't invoke relocate-postgres.sh
#   --skip-python                don't stage the docling/unstructured venvs
#   --force                      re-stage every component even if already present
#   -h, --help
#
# Exit code is always 0 on a completed (best-effort) run; check MANIFEST.json
# (or grep this script's stderr for "MISSING"/"WARN") for anything that
# didn't get staged. This mirrors relocate-postgres.sh's own philosophy: this
# is a dev/CI convenience tool, not a hard gate — the electron-builder step
# and afterpack-sign-resources.js are what actually fail a real release build
# if a required resource is absent.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

log()  { printf '\033[1;36m[stage]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[stage] WARN:\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31m[stage] ERROR:\033[0m %s\n' "$*" >&2; }

# ---------------------------------------------------------------------------
# Defaults (overridable via flags below)
# ---------------------------------------------------------------------------
STAGE_DIR="$CLIENT_DIR/build/sovereign-resources"
RELOCATE_MACHO="$SCRIPT_DIR/relocate-macho.sh"
RELOCATE_POSTGRES_SCRIPT="$SCRIPT_DIR/relocate-postgres.sh"

if [[ -d /opt/homebrew/opt/postgresql@17 ]]; then
  PG_SRC="/opt/homebrew/opt/postgresql@17"
else
  PG_SRC="/usr/local/opt/postgresql@17"
fi

if [[ -x /opt/homebrew/bin/minio ]]; then
  MINIO_SRC="/opt/homebrew/bin/minio"
elif [[ -x /usr/local/bin/minio ]]; then
  MINIO_SRC="/usr/local/bin/minio"
else
  MINIO_SRC="$(command -v minio || true)"
fi

LLAMA_SERVER_SRC="$HOME/llama.cpp/build/bin/llama-server"
EMBED_MODEL_SRC="$HOME/.llama-models/nomic-embed-text-v1.5.f16.gguf"
DOCLING_VENV_SRC="$HOME/.venv/docling"
DOCLING_CACHE_SRC="$HOME/.cache/docling/models"
UNSTRUCTURED_VENV_SRC="$HOME/.venv/unstructured"
# The lana-one Node backend = the parent of this client submodule (lana-one/).
BACKEND_SRC="${LANA_ONE_BACKEND_SRC:-$(cd "$CLIENT_DIR/.." && pwd)}"
# Node runtime bundled to run the backend (ABI matches its node_modules; avoids
# electron-rebuild). Defaults to the node on PATH.
NODE_SRC="${LANA_ONE_NODE_SRC:-$(command -v node || true)}"

SKIP_POSTGRES=0
SKIP_PYTHON=0
SKIP_BACKEND=0
FORCE=0

usage() { sed -n '2,60p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage-dir) STAGE_DIR="$2"; shift 2;;
    --pg-src) PG_SRC="$2"; shift 2;;
    --relocate-postgres-script) RELOCATE_POSTGRES_SCRIPT="$2"; shift 2;;
    --minio-src) MINIO_SRC="$2"; shift 2;;
    --llama-server-src) LLAMA_SERVER_SRC="$2"; shift 2;;
    --embed-model-src) EMBED_MODEL_SRC="$2"; shift 2;;
    --docling-venv-src) DOCLING_VENV_SRC="$2"; shift 2;;
    --docling-cache-src) DOCLING_CACHE_SRC="$2"; shift 2;;
    --unstructured-venv-src) UNSTRUCTURED_VENV_SRC="$2"; shift 2;;
    --skip-postgres) SKIP_POSTGRES=1; shift;;
    --skip-python) SKIP_PYTHON=1; shift;;
    --skip-backend) SKIP_BACKEND=1; shift;;
    --force) FORCE=1; shift;;
    -h|--help) usage; exit 0;;
    *) err "unknown arg: $1"; usage; exit 2;;
  esac
done

mkdir -p "$STAGE_DIR"

# ---------------------------------------------------------------------------
# Manifest accumulation (newline-delimited "name|status|source|dest|bytes|note"
# records; rendered to JSON at the end). bash 3.2-compatible (macOS system
# bash) — no associative arrays.
# ---------------------------------------------------------------------------
MANIFEST_RECORDS=""

add_record() {
  # $1=name $2=status $3=source $4=dest $5=note
  local name="$1" status="$2" source="$3" dest="$4" note="$5" bytes=0
  if [[ -e "$dest" ]]; then
    bytes="$(du -sk "$dest" 2>/dev/null | awk '{print $1 * 1024}')"
    [[ -z "$bytes" ]] && bytes=0
  fi
  MANIFEST_RECORDS="$MANIFEST_RECORDS
$name|$status|$source|$dest|$bytes|$note"
}

human_size() {
  local bytes="$1"
  awk -v b="$bytes" 'BEGIN {
    split("B KB MB GB TB", units, " ");
    u = 1;
    while (b >= 1024 && u < 5) { b /= 1024; u++ }
    printf "%.1f%s", b, units[u]
  }'
}

already_staged() {
  # $1 = dest path. Non-empty existing dir/file counts as "already staged".
  [[ -e "$1" ]] && [[ "$FORCE" -eq 0 ]]
}

# ---------------------------------------------------------------------------
# 1. Postgres — via scripts/relocate-postgres.sh (not owned by this script)
# ---------------------------------------------------------------------------
stage_postgres() {
  local dest="$STAGE_DIR/postgres"
  if [[ "$SKIP_POSTGRES" -eq 1 ]]; then
    log "postgres: skipped (--skip-postgres)"
    add_record "postgres" "skipped-by-flag" "$PG_SRC" "$dest" ""
    return
  fi
  if already_staged "$dest"; then
    log "postgres: already staged at $dest (use --force to re-run)"
    add_record "postgres" "skipped-existing" "$PG_SRC" "$dest" ""
    return
  fi
  if [[ ! -x "$RELOCATE_POSTGRES_SCRIPT" ]]; then
    warn "postgres: $RELOCATE_POSTGRES_SCRIPT not found or not executable."
    warn "postgres: DEPENDENCY: this stage needs scripts/relocate-postgres.sh to"
    warn "postgres: produce a relocatable PG17(+vector+timescaledb) tree. Run it"
    warn "postgres: manually first: scripts/relocate-postgres.sh --src <brew-prefix> --dest $dest"
    add_record "postgres" "missing-dependency" "$PG_SRC" "$dest" "relocate-postgres.sh not found/executable"
    return
  fi
  log "postgres: relocating from $PG_SRC into $dest ..."
  if "$RELOCATE_POSTGRES_SCRIPT" --src "$PG_SRC" --dest "$dest"; then
    add_record "postgres" "staged" "$PG_SRC" "$dest" ""
    log "postgres: staged ($(du -sh "$dest" 2>/dev/null | awk '{print $1}'))"
  else
    err "postgres: relocate-postgres.sh failed"
    add_record "postgres" "failed" "$PG_SRC" "$dest" "relocate-postgres.sh exited non-zero"
  fi
}

# ---------------------------------------------------------------------------
# 2. MinIO — copy + relocate-macho.sh
# ---------------------------------------------------------------------------
stage_minio() {
  local dest_dir="$STAGE_DIR/minio" dest_bin="$STAGE_DIR/minio/minio"
  if already_staged "$dest_dir"; then
    log "minio: already staged at $dest_dir (use --force to re-run)"
    add_record "minio" "skipped-existing" "$MINIO_SRC" "$dest_dir" ""
    return
  fi
  if [[ -z "$MINIO_SRC" || ! -x "$MINIO_SRC" ]]; then
    warn "minio: no minio binary found (looked at $MINIO_SRC and PATH); skipping."
    warn "minio: install via 'brew install minio' or pass --minio-src <path>."
    add_record "minio" "missing-dependency" "${MINIO_SRC:-<not found>}" "$dest_dir" "minio binary not found"
    return
  fi
  log "minio: staging from $MINIO_SRC ..."
  mkdir -p "$dest_dir"
  cp -f "$MINIO_SRC" "$dest_bin"
  chmod u+w,+x "$dest_bin"
  "$RELOCATE_MACHO" "$dest_bin" "$dest_dir/lib"
  "$RELOCATE_MACHO" --self-test "$dest_bin" "$dest_dir/lib" \
    || warn "minio: self-test reported stray Homebrew references (see above)"
  add_record "minio" "staged" "$MINIO_SRC" "$dest_dir" ""
  log "minio: staged ($(du -sh "$dest_dir" 2>/dev/null | awk '{print $1}'))"
}

# ---------------------------------------------------------------------------
# 3. llama-server — copy + relocate-macho.sh
# ---------------------------------------------------------------------------
stage_llama_server() {
  local dest_dir="$STAGE_DIR/llama-server" dest_bin="$STAGE_DIR/llama-server/llama-server"
  if already_staged "$dest_dir"; then
    log "llama-server: already staged at $dest_dir (use --force to re-run)"
    add_record "llama-server" "skipped-existing" "$LLAMA_SERVER_SRC" "$dest_dir" ""
    return
  fi
  if [[ ! -x "$LLAMA_SERVER_SRC" ]]; then
    warn "llama-server: not found at $LLAMA_SERVER_SRC; skipping."
    warn "llama-server: build it (llama.cpp CMake build) or pass --llama-server-src <path>."
    add_record "llama-server" "missing-dependency" "$LLAMA_SERVER_SRC" "$dest_dir" "llama-server binary not found"
    return
  fi
  log "llama-server: staging from $LLAMA_SERVER_SRC ..."
  mkdir -p "$dest_dir"
  cp -f "$LLAMA_SERVER_SRC" "$dest_bin"
  chmod u+w,+x "$dest_bin"
  "$RELOCATE_MACHO" "$dest_bin" "$dest_dir/lib"
  "$RELOCATE_MACHO" --self-test "$dest_bin" "$dest_dir/lib" \
    || warn "llama-server: self-test reported stray Homebrew references (see above)"
  add_record "llama-server" "staged" "$LLAMA_SERVER_SRC" "$dest_dir" ""
  log "llama-server: staged ($(du -sh "$dest_dir" 2>/dev/null | awk '{print $1}'))"
}

# ---------------------------------------------------------------------------
# 4. Embedding model — copy only (chat GGUFs are downloaded at runtime, see
#    §4 of the packaging plan: hardware-gated model selection).
# ---------------------------------------------------------------------------
stage_models() {
  local dest_dir="$STAGE_DIR/models" dest_file
  dest_file="$dest_dir/$(basename "$EMBED_MODEL_SRC")"
  if already_staged "$dest_file"; then
    log "models: embed model already staged at $dest_file (use --force to re-run)"
    add_record "embed-model" "skipped-existing" "$EMBED_MODEL_SRC" "$dest_file" ""
    return
  fi
  if [[ ! -f "$EMBED_MODEL_SRC" ]]; then
    warn "models: embedding GGUF not found at $EMBED_MODEL_SRC; skipping."
    warn "models: download it or pass --embed-model-src <path>. This model is"
    warn "models: HARD-REQUIRED at runtime (embeddings always run local, never Forge)."
    add_record "embed-model" "missing-dependency" "$EMBED_MODEL_SRC" "$dest_file" "embedding GGUF not found (hard-required)"
    return
  fi
  log "models: staging embed model from $EMBED_MODEL_SRC ..."
  mkdir -p "$dest_dir"
  cp -f "$EMBED_MODEL_SRC" "$dest_file"
  add_record "embed-model" "staged" "$EMBED_MODEL_SRC" "$dest_file" "chat GGUFs intentionally NOT staged; downloaded at runtime"
  log "models: staged ($(du -sh "$dest_file" 2>/dev/null | awk '{print $1}'))"
}

# ---------------------------------------------------------------------------
# 5/6. Python venvs (docling, unstructured) — copy only.
#
# CAVEATS (documented here, not solved by this script):
#   - Notarization: every .so/.dylib C-extension inside these venvs must be
#     Developer-ID signed under mac.hardenedRuntime:true. That is handled by
#     scripts/afterpack-sign-resources.js (walks all of Contents/Resources by
#     Mach-O magic-number sniff, not by extension), but it is the single
#     heaviest/slowest part of the sign+notarize pipeline (multi-GB, thousands
#     of files) — see docs/specs/LANA_ONE_PACKAGING_PLAN.md §3/§7.
#   - Shebang portability: each venv's bin/python*-invoking scripts (pip,
#     docling-serve, uvicorn, ...) have a shebang baked in at venv-creation
#     time (`#!/Users/<you>/.venv/docling/bin/python3.11`) that embeds the
#     ORIGINAL absolute source path, not the staged/installed one. A raw copy
#     preserves that broken shebang. This script does NOT rewrite shebangs
#     (the correct in-bundle path is only known at install time, and doing it
#     safely — plus fixing pyvenv.cfg's `home` key — is Phase C bundling
#     work, not staging); supervisor/bootstrap.js's resolveBundledPaths()
#     currently points at `<venv>/bin/docling-serve` / `<venv>/bin/uvicorn`
#     directly, so this MUST be resolved (e.g. invoke via
#     `<venv>/bin/python3.11 -m ...` instead of the shebang'd script, or
#     rewrite shebangs post-install) before the bundled docling/unstructured
#     services can actually spawn. Tracked as an open Phase B/C risk.
# ---------------------------------------------------------------------------
stage_python_component() {
  local label="$1" venv_src="$2" dest_dir="$3" extra_src="${4:-}" extra_label="${5:-}"
  local venv_dest="$dest_dir/venv"
  if [[ "$SKIP_PYTHON" -eq 1 ]]; then
    log "$label: skipped (--skip-python)"
    add_record "$label" "skipped-by-flag" "$venv_src" "$dest_dir" ""
    return
  fi
  if already_staged "$venv_dest"; then
    log "$label: already staged at $venv_dest (use --force to re-run)"
    add_record "$label" "skipped-existing" "$venv_src" "$dest_dir" ""
  elif [[ ! -d "$venv_src" ]]; then
    warn "$label: venv not found at $venv_src; skipping."
    warn "$label: create it (python3.11 -m venv $venv_src && pip install ...) or pass --${label}-venv-src <path>."
    add_record "$label" "missing-dependency" "$venv_src" "$venv_dest" "venv not found"
  else
    log "$label: copying venv from $venv_src (this can take a while; multi-GB) ..."
    mkdir -p "$dest_dir"
    # -R -P: recursive, preserve symlinks as symlinks (do NOT dereference --
    # venvs are full of bin/ symlinks to python3.x, and the version-suffixed
    # .dylib symlink chains matter for the C-extension .so files too).
    cp -R -P "$venv_src" "$venv_dest"
    add_record "$label" "staged" "$venv_src" "$venv_dest" "shebangs still reference the SOURCE venv path (see script header caveat)"
    log "$label: venv staged ($(du -sh "$venv_dest" 2>/dev/null | awk '{print $1}'))"
  fi

  if [[ -n "$extra_src" ]]; then
    local extra_dest="$dest_dir/model-cache"
    if [[ "$SKIP_PYTHON" -eq 1 ]]; then
      : # already recorded above
    elif already_staged "$extra_dest"; then
      log "$extra_label: already staged at $extra_dest (use --force to re-run)"
      add_record "$extra_label" "skipped-existing" "$extra_src" "$extra_dest" ""
    elif [[ ! -d "$extra_src" ]]; then
      warn "$extra_label: not found at $extra_src; skipping (docling will re-download models on first run)."
      add_record "$extra_label" "missing-dependency" "$extra_src" "$extra_dest" "model cache not found; will be re-downloaded at runtime"
    else
      log "$extra_label: copying model cache from $extra_src ..."
      mkdir -p "$dest_dir"
      cp -R -P "$extra_src" "$extra_dest"
      add_record "$extra_label" "staged" "$extra_src" "$extra_dest" ""
      log "$extra_label: staged ($(du -sh "$extra_dest" 2>/dev/null | awk '{print $1}'))"
    fi
  fi
}

# ---------------------------------------------------------------------------
# Run all stages
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# 7. Node backend — the lana-one Node app (src + scripts + package.json +
#    node_modules) that the supervisor spawns. Copied verbatim; native modules
#    are run by the bundled node (stage_node), matching their build ABI.
# ---------------------------------------------------------------------------
stage_backend() {
  local dest="$STAGE_DIR/backend"
  if [[ "$SKIP_BACKEND" -eq 1 ]]; then
    log "backend: skipped (--skip-backend)"; add_record "backend" "skipped-by-flag" "$BACKEND_SRC" "$dest" ""; return
  fi
  if already_staged "$dest"; then
    log "backend: already staged at $dest (use --force to re-run)"; add_record "backend" "skipped-existing" "$BACKEND_SRC" "$dest" ""; return
  fi
  if [[ ! -d "$BACKEND_SRC/src" ]] || [[ ! -f "$BACKEND_SRC/package.json" ]]; then
    warn "backend: source not found at $BACKEND_SRC (need src/ + package.json)"; add_record "backend" "missing-dependency" "$BACKEND_SRC" "$dest" "src/ or package.json missing"; return
  fi
  log "backend: staging from $BACKEND_SRC (src + scripts + node_modules) ..."
  mkdir -p "$dest"
  # Copy the runtime pieces; exclude the client submodule + VCS + logs.
  rsync -a "$BACKEND_SRC/src" "$dest/" 2>/dev/null
  [[ -d "$BACKEND_SRC/scripts" ]] && rsync -a "$BACKEND_SRC/scripts" "$dest/" 2>/dev/null
  [[ -d "$BACKEND_SRC/config" ]] && rsync -a "$BACKEND_SRC/config" "$dest/" 2>/dev/null
  cp "$BACKEND_SRC/package.json" "$dest/" 2>/dev/null || true
  cp "$BACKEND_SRC/package-lock.json" "$dest/" 2>/dev/null || true
  rsync -a --exclude='.cache' "$BACKEND_SRC/node_modules" "$dest/" 2>/dev/null
  if [[ -d "$dest/node_modules" ]] && [[ -f "$dest/src/index.js" ]]; then
    add_record "backend" "staged" "$BACKEND_SRC" "$dest" ""
    log "backend: staged ($(du -sh "$dest" 2>/dev/null | awk '{print $1}'))"
  else
    err "backend: staging incomplete"; add_record "backend" "failed" "$BACKEND_SRC" "$dest" "src/index.js or node_modules missing after copy"
  fi
}

# ---------------------------------------------------------------------------
# 8. Node runtime — a node binary that runs the backend (ABI-matched to its
#    node_modules). Relocated so any Homebrew dylib deps are vendored.
# ---------------------------------------------------------------------------
stage_node() {
  local dest_dir="$STAGE_DIR/node" dest_bin="$STAGE_DIR/node/node"
  if already_staged "$dest_dir"; then
    log "node: already staged at $dest_dir (use --force to re-run)"; add_record "node" "skipped-existing" "$NODE_SRC" "$dest_dir" ""; return
  fi
  if [[ -z "$NODE_SRC" ]] || [[ ! -x "$NODE_SRC" ]]; then
    warn "node: no node binary found (set LANA_ONE_NODE_SRC)"; add_record "node" "missing-dependency" "$NODE_SRC" "$dest_dir" "node binary not found"; return
  fi
  log "node: staging runtime from $NODE_SRC ..."
  mkdir -p "$dest_dir"
  cp "$NODE_SRC" "$dest_bin"
  if [[ -x "$RELOCATE_MACHO" ]]; then "$RELOCATE_MACHO" "$dest_bin" "$dest_dir/lib" >/dev/null 2>&1 || true; fi
  chmod +x "$dest_bin"
  add_record "node" "staged" "$NODE_SRC" "$dest_dir" ""
  log "node: staged ($("$dest_bin" --version 2>/dev/null || echo '?'))"
}

log "staging into $STAGE_DIR"
stage_postgres
stage_minio
stage_llama_server
stage_models
stage_python_component "docling" "$DOCLING_VENV_SRC" "$STAGE_DIR/python/docling" "$DOCLING_CACHE_SRC" "docling-model-cache"
stage_python_component "unstructured" "$UNSTRUCTURED_VENV_SRC" "$STAGE_DIR/python/unstructured"
stage_backend
stage_node

# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------
MANIFEST_PATH="$STAGE_DIR/MANIFEST.json"
TOTAL_BYTES=0
{
  printf '{\n'
  printf '  "generatedAt": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "stageDir": "%s",\n' "$STAGE_DIR"
  printf '  "resources": [\n'
  first=1
  while IFS='|' read -r name status source dest bytes note; do
    [[ -z "$name" ]] && continue
    TOTAL_BYTES=$((TOTAL_BYTES + ${bytes:-0}))
    [[ "$first" -eq 1 ]] && first=0 || printf ',\n'
    printf '    { "name": "%s", "status": "%s", "source": "%s", "dest": "%s", "sizeBytes": %s, "sizeHuman": "%s", "note": "%s" }' \
      "$name" "$status" "$source" "$dest" "${bytes:-0}" "$(human_size "${bytes:-0}")" "$note"
  done <<< "$MANIFEST_RECORDS"
  printf '\n  ],\n'
  printf '  "totalSizeBytes": %s,\n' "$TOTAL_BYTES"
  printf '  "totalSizeHuman": "%s"\n' "$(human_size "$TOTAL_BYTES")"
  printf '}\n'
} > "$MANIFEST_PATH"

log "manifest: $MANIFEST_PATH"
log "total staged size: $(human_size "$TOTAL_BYTES")"

MISSING_COUNT="$(printf '%s\n' "$MANIFEST_RECORDS" | awk -F'|' '$2=="missing-dependency" || $2=="failed" {c++} END {print c+0}')"
if [[ "$MISSING_COUNT" -gt 0 ]]; then
  warn "$MISSING_COUNT component(s) were not staged — see $MANIFEST_PATH (status: missing-dependency/failed)."
fi
log "done."
