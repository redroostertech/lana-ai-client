#!/usr/bin/env bash
#
# stage-timescaledb.sh — idempotently stage the timescaledb extension into a
# bundled (relocatable) PostgreSQL 17 tree.
#
# WHY: client/supervisor/postgres-init.js now refuses to enable
#      `shared_preload_libraries = 'timescaledb'` unless the timescaledb library
#      is actually present in the discovered Postgres install (boot-safety — a
#      missing preload library aborts Postgres startup entirely). If a bundle is
#      produced without timescaledb, the hypertable migrations silently degrade.
#      This script copies the timescaledb .dylib + extension control/sql into the
#      bundled PG's pkglibdir + sharedir/extension so the feature works.
#
# relocate-postgres.sh already bundles timescaledb on machines where the
# Homebrew `timescaledb` formula is linked into postgresql@17. This script is the
# standalone / repair path for the packaging (Phase B) run and is safe to run
# repeatedly — it no-ops when timescaledb is already staged.
#
# USAGE:
#   scripts/stage-timescaledb.sh <BUNDLED_PG_ROOT> [TIMESCALEDB_SRC_PREFIX]
#
#   BUNDLED_PG_ROOT        e.g. .../Contents/Resources/postgres  (dir with Cellar/)
#   TIMESCALEDB_SRC_PREFIX optional; defaults to `brew --prefix timescaledb`.
#                          Must contain lib/timescaledb/postgresql@17/*.dylib and
#                          share/timescaledb/timescaledb*.{control,sql}.
#
# EXIT: 0 on success or already-present; non-zero on a real failure.

set -euo pipefail

log()  { printf '  [stage-timescaledb] %s\n' "$*"; }
die()  { printf '  [stage-timescaledb] ERROR: %s\n' "$*" >&2; exit 1; }

PG_ROOT="${1:-}"
[ -n "$PG_ROOT" ] || die "usage: stage-timescaledb.sh <BUNDLED_PG_ROOT> [TIMESCALEDB_SRC_PREFIX]"
[ -d "$PG_ROOT" ] || die "bundled PG root not found: $PG_ROOT"

# Resolve the Cellar bin so pg_config reports the RELOCATED pkglibdir/sharedir
# (the top-level postgres/bin pg_config resolves to empty on some layouts).
PG_CONFIG=""
for c in "$PG_ROOT"/Cellar/postgresql@17/*/bin/pg_config "$PG_ROOT"/bin/pg_config; do
  [ -x "$c" ] && { PG_CONFIG="$c"; break; }
done
[ -n "$PG_CONFIG" ] || die "no pg_config under $PG_ROOT"

PKGLIBDIR="$("$PG_CONFIG" --pkglibdir)"
SHAREDIR="$("$PG_CONFIG" --sharedir)"
[ -n "$PKGLIBDIR" ] && [ -n "$SHAREDIR" ] || die "pg_config returned empty pkglibdir/sharedir ($PG_CONFIG)"
EXTDIR="$SHAREDIR/extension"
log "pkglibdir : $PKGLIBDIR"
log "extension : $EXTDIR"

# Already staged? Then no-op (idempotent).
if [ -f "$PKGLIBDIR/timescaledb.dylib" ] && [ -f "$EXTDIR/timescaledb.control" ]; then
  log "timescaledb already present; nothing to do."
  exit 0
fi

# Locate the source timescaledb tree.
SRC_PREFIX="${2:-}"
if [ -z "$SRC_PREFIX" ]; then
  if command -v brew >/dev/null 2>&1; then
    SRC_PREFIX="$(brew --prefix timescaledb 2>/dev/null || true)"
  fi
fi
[ -n "$SRC_PREFIX" ] && [ -d "$SRC_PREFIX" ] || die "timescaledb source prefix not found. Install it (brew install timescaledb) or pass TIMESCALEDB_SRC_PREFIX. See docs at end of this script."

SRC_LIB_DIR="$SRC_PREFIX/lib/timescaledb/postgresql@17"
SRC_SHARE_DIR="$SRC_PREFIX/share/timescaledb"
[ -d "$SRC_LIB_DIR" ]   || die "expected dylibs at $SRC_LIB_DIR"
[ -d "$SRC_SHARE_DIR" ] || die "expected control/sql at $SRC_SHARE_DIR"

mkdir -p "$PKGLIBDIR" "$EXTDIR"

# 1. Libraries (dereference any symlinks with -L).
log "copying timescaledb libraries -> $PKGLIBDIR"
cp -L "$SRC_LIB_DIR"/timescaledb*.dylib "$PKGLIBDIR"/

# 2. Extension control + version SQL.
log "copying timescaledb control/sql -> $EXTDIR"
cp -L "$SRC_SHARE_DIR"/timescaledb*.control "$EXTDIR"/ 2>/dev/null || true
cp -L "$SRC_SHARE_DIR"/timescaledb*.sql "$EXTDIR"/

# 3. Verify.
[ -f "$PKGLIBDIR/timescaledb.dylib" ]   || die "post-copy check failed: missing $PKGLIBDIR/timescaledb.dylib"
[ -f "$EXTDIR/timescaledb.control" ]     || die "post-copy check failed: missing $EXTDIR/timescaledb.control"
log "timescaledb staged successfully."
