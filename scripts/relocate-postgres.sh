#!/usr/bin/env bash
#
# relocate-postgres.sh — produce a RELOCATABLE PostgreSQL 17 tree (+ pgvector,
# +timescaledb) that can run from inside a macOS .app bundle instead of the
# Homebrew keg.
#
# WHY: Homebrew's `postgres` binary links ~8 non-system dylibs via hardcoded
# /usr/local/opt + /usr/local/Cellar paths (gettext/libintl, zstd, lz4,
# openssl@3 ssl+crypto, krb5/gssapi + its 4 sub-libs, icu4c@78 i18n+uc+data).
# Those absolute load commands break the moment /usr/local is absent (a clean
# customer Mac, or a sandboxed .app). This script vendors every non-system
# dylib into the tree and rewrites all load commands to @rpath, then lays the
# tree out so PostgreSQL's built-in make_relative_path() resolves sharedir +
# pkglibdir RELATIVE to the binary (no absolute /usr/local dependency at all).
#
# LAYOUT PRODUCED (DEST acts as the analog of the Homebrew prefix /usr/local):
#   DEST/Cellar/postgresql@17/<ver>/bin/   <- postgres, initdb, psql, ...
#   DEST/Cellar/postgresql@17/<ver>/lib/   <- vendored non-system dylibs (rpath)
#   DEST/lib/postgresql@17/                <- pkglib: vector.so, timescaledb*.so
#   DEST/share/postgresql@17/              <- sharedir: initdb templates + ext control/sql
# This deep bin path (4 components after the prefix: Cellar/postgresql@17/<ver>/bin)
# is INTENTIONAL: PostgreSQL computes sharedir/pkglibdir by stripping exactly that
# many trailing components from the running binary's dir and re-appending
# "share/postgresql@17" / "lib/postgresql@17". Mirroring the Homebrew shape makes
# that math land inside DEST with zero env/GUC overrides.
#
# USAGE:
#   relocate-postgres.sh --src <brew-opt-prefix> --dest <dir> [--smoke] [--port N]
#     --src   Homebrew postgresql@17 opt prefix (default: /usr/local/opt/postgresql@17)
#     --dest  output tree root         (default: /tmp/pg-reloc)
#     --smoke run initdb + start + CREATE EXTENSION vector/timescaledb + query, then stop
#     --port  smoke-test port          (default: 5544)
#
# Idempotent: re-running rebuilds DEST from scratch. Uses only --src + --dest;
# never touches the running dev Postgres.
#
set -euo pipefail

SRC="/usr/local/opt/postgresql@17"
DEST="/tmp/pg-reloc"
SMOKE=0
PORT=5544

while [[ $# -gt 0 ]]; do
  case "$1" in
    --src)   SRC="$2";  shift 2;;
    --dest)  DEST="$2"; shift 2;;
    --smoke) SMOKE=1;   shift;;
    --port)  PORT="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

log() { printf '\033[1;36m[relocate]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[relocate] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

command -v install_name_tool >/dev/null || die "install_name_tool not found (need Xcode CLT)"
command -v otool >/dev/null            || die "otool not found (need Xcode CLT)"

# Resolve the real Cellar keg + version behind the opt symlink.
PG_BINDIR="$("$SRC/bin/pg_config" --bindir)"       # e.g. /usr/local/Cellar/postgresql@17/17.10/bin
PG_SHAREDIR="$("$SRC/bin/pg_config" --sharedir)"   # e.g. /usr/local/share/postgresql@17
PG_PKGLIBDIR="$("$SRC/bin/pg_config" --pkglibdir)" # e.g. /usr/local/lib/postgresql@17
PG_VERSION="$("$SRC/bin/pg_config" --version | awk '{print $2}')"
KEG_VER="$(basename "$(dirname "$PG_BINDIR")")"     # e.g. 17.10

# Derive the compiled-in prefix ("/usr/local") + the share/pkglib suffixes so the
# relocated tree reproduces the same relative geometry make_relative_path expects.
PREFIX="$(dirname "$(dirname "$PG_SHAREDIR")")"     # /usr/local  (share is <prefix>/share/<name>)
SHARE_NAME="$(basename "$PG_SHAREDIR")"             # postgresql@17
PKGLIB_NAME="$(basename "$PG_PKGLIBDIR")"           # postgresql@17

log "src prefix (opt) : $SRC"
log "cellar bindir    : $PG_BINDIR  (ver $PG_VERSION, keg $KEG_VER)"
log "sharedir         : $PG_SHAREDIR"
log "pkglibdir        : $PG_PKGLIBDIR"
log "dest tree        : $DEST"

# Destination geometry mirroring the Homebrew prefix.
DEST_BIN="$DEST/Cellar/postgresql@17/$KEG_VER/bin"
DEST_VLIB="$DEST/Cellar/postgresql@17/$KEG_VER/lib"   # vendored dylibs (rpath target)
DEST_PKGLIB="$DEST/lib/$PKGLIB_NAME"
DEST_SHARE="$DEST/share/$SHARE_NAME"

log "wiping + recreating $DEST"
rm -rf "$DEST"
mkdir -p "$DEST_BIN" "$DEST_VLIB" "$DEST_PKGLIB" "$DEST_SHARE"

# ---------------------------------------------------------------------------
# 1. Copy the binaries we actually ship at runtime.
# ---------------------------------------------------------------------------
BINS=(postgres initdb psql createdb pg_ctl pg_isready pg_config)
for b in "${BINS[@]}"; do
  [[ -f "$PG_BINDIR/$b" ]] || die "missing binary: $PG_BINDIR/$b"
  cp -f "$PG_BINDIR/$b" "$DEST_BIN/$b"
  chmod u+w "$DEST_BIN/$b"
done
log "copied binaries: ${BINS[*]}"

# ---------------------------------------------------------------------------
# 2. Copy sharedir (initdb templates + extension control/sql). -L dereferences
#    the pgvector symlinks Homebrew leaves in extension/.
# ---------------------------------------------------------------------------
cp -RL "$PG_SHAREDIR/." "$DEST_SHARE/"
log "copied sharedir ($(du -sh "$DEST_SHARE" | awk '{print $1}'))"

# ---------------------------------------------------------------------------
# 3. Copy the ENTIRE pkglib (deref symlinks — pgvector's vector.dylib is one).
#    initdb itself dlopen()s standard modules from $libdir (dict_snowball,
#    plpgsql, ...), so a partial pkglib breaks initdb. We ship the whole dir;
#    it is small and keeps every stock extension available. vector.dylib +
#    timescaledb*.dylib come along for free.
# ---------------------------------------------------------------------------
cp -RL "$PG_PKGLIBDIR/." "$DEST_PKGLIB/"
chmod -R u+w "$DEST_PKGLIB"
# Prune build/dev artifacts the running SERVER never loads: the pgxs build-system
# subtree (+ its test binaries), static archives (*.a), and the CLIENT libraries
# (libpq/libecpg/libpgtypes — those belong to psql, which gets them from the
# vendored lib/ via rpath, not from pkglib). Leaving them in only drags absolute
# /usr/local load commands + notarization surface into the bundle for no benefit.
rm -rf "$DEST_PKGLIB/pgxs"
find "$DEST_PKGLIB" -maxdepth 1 -type f \
  \( -name '*.a' -o -name 'libpq.*' -o -name 'libecpg*' -o -name 'libpgtypes*' \) -delete
log "copied + pruned pkglib ($(find "$DEST_PKGLIB" -maxdepth 1 -type f | grep -c .) modules, incl. vector + timescaledb)"

# ---------------------------------------------------------------------------
# 4. Recursively vendor every NON-system dylib into DEST_VLIB.
#    A dep is "system" if it lives under /usr/lib or /System (those are on every
#    Mac and dyld resolves them). Everything else (Homebrew opt/Cellar, or an
#    already-@loader_path icu sibling) gets copied + queued.
# ---------------------------------------------------------------------------
is_system() { [[ "$1" == /usr/lib/* || "$1" == /System/* ]]; }

# Given a raw dependency path as printed by otool, resolve it to a real file on
# disk relative to the dylib that referenced it (handles @loader_path icu deps).
resolve_dep() {
  local dep="$1" owner_dir="$2"
  case "$dep" in
    @loader_path/*) echo "$owner_dir/${dep#@loader_path/}";;
    @rpath/*)       echo "";;   # already-rewritten, skip
    @executable_path/*) echo "";;
    /*)             echo "$dep";;
    *)              echo "";;
  esac
}

# bash 3.2 (macOS system bash) has no associative arrays; track vendored
# basenames as a newline-delimited string instead.
VENDORED=""              # newline-separated list of vendored basenames
is_vendored() { printf '%s\n' "$VENDORED" | grep -qxF "$1"; }
QUEUE=()

# Seed the queue with the non-system deps of every binary AND every pkglib
# module (the extensions/.so's may pull their own dylibs, e.g. timescaledb).
seed_from() {  # $1 = mach-o file, $2 = owner dir to resolve @loader_path against
  while IFS= read -r line; do
    dep="$(echo "$line" | awk '{print $1}')"
    [[ "$dep" == /* || "$dep" == @loader_path/* ]] || continue
    is_system "$dep" && continue
    QUEUE+=("$dep|$2")
  done < <(otool -L "$1" 2>/dev/null | tail -n +2)
}
for b in "${BINS[@]}"; do seed_from "$DEST_BIN/$b" "$PG_BINDIR"; done
for so in "$DEST_PKGLIB"/*; do
  [[ -f "$so" ]] || continue
  seed_from "$so" "$PG_PKGLIBDIR"
done

while [[ ${#QUEUE[@]} -gt 0 ]]; do
  entry="${QUEUE[0]}"; QUEUE=("${QUEUE[@]:1}")
  dep="${entry%%|*}"; owner_dir="${entry##*|}"
  real="$(resolve_dep "$dep" "$owner_dir")"
  [[ -z "$real" ]] && continue
  [[ -e "$real" ]] || { log "WARN: unresolved dep $dep (owner $owner_dir)"; continue; }
  base="$(basename "$real")"
  is_vendored "$base" && continue
  cp -f "$real" "$DEST_VLIB/$base"
  chmod u+w "$DEST_VLIB/$base"
  VENDORED="$VENDORED
$base"
  # enqueue this dylib's own non-system deps
  local_owner="$(dirname "$real")"
  while IFS= read -r line; do
    d="$(echo "$line" | awk '{print $1}')"
    [[ "$d" == /* || "$d" == @loader_path/* ]] || continue
    is_system "$d" && continue
    QUEUE+=("$d|$local_owner")
  done < <(otool -L "$real" | tail -n +2)
done
VENDORED_LIST="$(printf '%s\n' "$VENDORED" | grep -v '^$' | sort -u)"
log "vendored $(printf '%s\n' "$VENDORED_LIST" | grep -c .) dylibs: $(echo $VENDORED_LIST)"

# ---------------------------------------------------------------------------
# 5. Rewrite load commands.
#    - Every vendored dylib: set its id to @rpath/<base>, and rewrite each of
#      its non-system dep references to @rpath/<base-of-dep>.
#    - Every binary: rewrite each non-system dep to @rpath/<base>, and add an
#      LC_RPATH of @executable_path/../lib pointing at DEST_VLIB.
# ---------------------------------------------------------------------------
rewrite_deps() {           # $1 = mach-o file
  local f="$1"
  while IFS= read -r line; do
    local dep; dep="$(echo "$line" | awk '{print $1}')"
    [[ "$dep" == /* || "$dep" == @loader_path/* ]] || continue
    is_system "$dep" && continue
    [[ "$dep" == @rpath/* ]] && continue
    local base; base="$(basename "$dep")"
    # only rewrite deps we actually vendored (leave unknown system-ish ones)
    if is_vendored "$base"; then
      install_name_tool -change "$dep" "@rpath/$base" "$f" 2>/dev/null || true
    fi
  done < <(otool -L "$f" | tail -n +2)
}

while IFS= read -r base; do
  [[ -z "$base" ]] && continue
  f="$DEST_VLIB/$base"
  install_name_tool -id "@rpath/$base" "$f" 2>/dev/null || true
  rewrite_deps "$f"
done < <(printf '%s\n' "$VENDORED_LIST")

for b in "${BINS[@]}"; do
  f="$DEST_BIN/$b"
  rewrite_deps "$f"
  # add rpath (ignore error if already present)
  install_name_tool -add_rpath "@executable_path/../lib" "$f" 2>/dev/null || true
done

# pkglib .so modules are dlopen'd BY postgres, so their @rpath resolves against
# postgres's LC_RPATH (@executable_path/../lib -> vendored dylibs). Rewrite any
# non-system deps they carry (e.g. timescaledb -> openssl) to @rpath.
for so in "$DEST_PKGLIB"/*; do
  [[ -f "$so" ]] || continue
  rewrite_deps "$so"
done
log "rewrote load commands (bin + pkglib) + added @executable_path/../lib rpath to binaries"

# ---------------------------------------------------------------------------
# 6. Sanity: no vendored binary/dylib may still reference /usr/local.
# ---------------------------------------------------------------------------
LEAKS=0
while IFS= read -r f; do
  if otool -L "$f" 2>/dev/null | tail -n +2 | grep -qE '/usr/local'; then
    echo "  LEAK: $f still references /usr/local:" >&2
    otool -L "$f" | tail -n +2 | grep '/usr/local' >&2
    LEAKS=1
  fi
done < <(find "$DEST_BIN" "$DEST_VLIB" "$DEST_PKGLIB" -type f)
if [[ "$LEAKS" -eq 0 ]]; then
  log "OK: no /usr/local references remain in bin/, vendored lib/, or pkglib/"
else
  die "relocation incomplete: /usr/local references remain (see above)"
fi

log "relocated tree ready: $DEST  ($(du -sh "$DEST" | awk '{print $1}'))"

# ---------------------------------------------------------------------------
# 7. Optional smoke test — proves the tree runs with /usr/local made invisible.
# ---------------------------------------------------------------------------
if [[ "$SMOKE" -eq 1 ]]; then
  DATA="$DEST/_smoke_data"
  SOCK="$DEST/_smoke_sock"
  rm -rf "$DATA" "$SOCK"; mkdir -p "$SOCK"
  PGBIN="$DEST_BIN"

  # A deliberately minimal env: DYLD_* cleared so nothing leaks in from the host
  # Homebrew, and PATH does NOT include /usr/local. If it runs here, it runs in a
  # bundle. (We cannot chmod /usr/local unreadable without sudo, but a clean env +
  # the leak check above is a strong proxy.)
  export PGDATA="$DATA"
  unset DYLD_LIBRARY_PATH DYLD_FALLBACK_LIBRARY_PATH PGSHAREDIR || true

  log "SMOKE: initdb"
  "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust --encoding=UTF8 \
    --locale=en_US.UTF-8 -L "$DEST_SHARE" >/dev/null

  # timescaledb must be preloaded for CREATE EXTENSION to succeed.
  {
    echo "shared_preload_libraries = 'timescaledb'"
    echo "unix_socket_directories = '$SOCK'"
    echo "listen_addresses = '127.0.0.1'"
    echo "port = $PORT"
    echo "dynamic_library_path = '\$libdir'"
  } >> "$DATA/postgresql.conf"

  log "SMOKE: starting postgres on 127.0.0.1:$PORT"
  "$PGBIN/pg_ctl" -D "$DATA" -l "$DATA/server.log" -w start \
    || { echo "--- server.log ---"; cat "$DATA/server.log"; die "server failed to start"; }

  cleanup() { "$PGBIN/pg_ctl" -D "$DATA" -m fast stop >/dev/null 2>&1 || true; }
  trap cleanup EXIT

  PSQL=( "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -X )

  log "SMOKE: createdb lana_smoke"
  "$PGBIN/createdb" -h "$SOCK" -p "$PORT" -U postgres lana_smoke

  log "SMOKE: CREATE EXTENSION vector + query"
  "${PSQL[@]}" -d lana_smoke -c "CREATE EXTENSION vector;"
  "${PSQL[@]}" -d lana_smoke -c "SELECT '[1,2,3]'::vector AS v, '[1,2,3]'::vector <-> '[1,2,4]'::vector AS dist;"

  log "SMOKE: CREATE EXTENSION timescaledb"
  if "${PSQL[@]}" -d lana_smoke -c "CREATE EXTENSION timescaledb;" ; then
    "${PSQL[@]}" -d lana_smoke -c "SELECT extversion FROM pg_extension WHERE extname='timescaledb';"
    log "SMOKE: timescaledb OK"
  else
    log "SMOKE: timescaledb FAILED (see above) — vector still passed"
  fi

  cleanup; trap - EXIT
  rm -rf "$DATA" "$SOCK"
  log "SMOKE: PASSED — relocated tree initdb'd, served, and loaded vector"
fi

log "done."
