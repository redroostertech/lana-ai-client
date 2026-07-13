#!/usr/bin/env bash
#
# relocate-macho.sh — GENERIC mach-O relocation helper.
#
# WHY: a mach-O binary or dylib built against Homebrew (/usr/local/opt/... on
# Intel, /opt/homebrew/opt/... on Apple Silicon) hardcodes those absolute load
# commands. That breaks the moment the file is copied into an app bundle on a
# machine without that exact Homebrew layout. This script makes ANY mach-O
# file (executable, .dylib, or .so) relocatable: it recursively walks its
# non-system dependency closure, vendors every non-system dylib into a
# destination lib dir, and rewrites every load command (+ dylib ids) to
# @rpath, adding an @loader_path-relative LC_RPATH so the whole thing runs
# with no absolute Homebrew path baked in.
#
# It is intentionally NOT postgres-specific (see scripts/relocate-postgres.sh
# for that bespoke, Homebrew-Cellar-shaped relocation, which predates and
# does not call this script) — this one is reused for standalone binaries
# like llama-server and minio by scripts/stage-sovereign-resources.sh, and is
# generic enough for any future mach-O file that needs the same treatment.
#
# USAGE:
#   relocate-macho.sh <macho-file> <dest-lib-dir>
#
#     Rewrites <macho-file> IN PLACE:
#       1. Walks `otool -L <macho-file>`.
#       2. Skips system libs (/usr/lib/**, /System/**) and already-@rpath /
#          @loader_path / @executable_path deps.
#       3. Resolves every remaining dep (absolute Homebrew path, or an
#          @rpath dep resolved via the file's own LC_RPATH entries) to a
#          real file on disk.
#       4. Copies that file into <dest-lib-dir> (once; idempotent) and
#          recurses into ITS OWN non-system deps the same way, so the whole
#          transitive closure lands flat in <dest-lib-dir>.
#       5. `install_name_tool -id`'s every copied dylib to
#          @rpath/<basename>, and `-change`'s every rewritten dep reference
#          (in <macho-file> AND in every copied dylib) to @rpath/<basename>.
#       6. Adds an LC_RPATH to <macho-file> — @loader_path/<relative-path-to
#          -dest-lib-dir> — if one isn't already present.
#
#   relocate-macho.sh --self-test <macho-file> [dest-lib-dir]
#
#     Verification mode, no relocation performed. Runs `otool -L` on
#     <macho-file> (and, if <dest-lib-dir> is given, on every .dylib/.so
#     inside it) and FAILS (exit 1) if any load command still references
#     /usr/local or /opt/homebrew. Prints a PASS/FAIL line per file plus a
#     summary. Intended to run right after a normal relocation call, e.g.:
#       relocate-macho.sh ./minio ./lib && relocate-macho.sh --self-test ./minio ./lib
#
# Idempotent: safe to re-run against an already-relocated file/tree — deps
# that are already @rpath (or already vendored) are left alone, and
# install_name_tool calls that would no-op (already-correct id, dep already
# rewritten) are swallowed rather than treated as errors.
#
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"

log()  { printf '\033[1;36m[relocate-macho]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[relocate-macho] WARN:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[relocate-macho] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<EOF
Usage:
  $SCRIPT_NAME <macho-file> <dest-lib-dir>
  $SCRIPT_NAME --self-test <macho-file> [dest-lib-dir]
  $SCRIPT_NAME --help

See the header comment in this file for full behavior.
EOF
}

command -v otool >/dev/null              || die "otool not found (need Xcode CLT)"
command -v install_name_tool >/dev/null  || die "install_name_tool not found (need Xcode CLT)"

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

is_system_dep() { [[ "$1" == /usr/lib/* || "$1" == /System/* ]]; }

# List the raw dependency paths of a mach-O file (first column of otool -L,
# skipping the "file:" header line).
list_deps() {
  otool -L "$1" | tail -n +2 | awk '{print $1}'
}

# List this file's own LC_RPATH search paths (raw, may contain @loader_path
# or @executable_path tokens).
list_rpaths() {
  otool -l "$1" 2>/dev/null | awk '
    /cmd LC_RPATH/ { getline; getline; sub(/^ *path /, ""); sub(/ \(offset.*/, ""); print }
  '
}

# Resolve a raw @rpath/<name> dependency to a real file on disk by walking
# the owning file's LC_RPATH entries (expanding @loader_path/@executable_path
# against the owning file's own directory — good enough for a dev-box source
# tree being staged, which is the only place this ever needs to resolve).
resolve_rpath_dep() {
  local dep="$1" owner="$2" owner_dir rp candidate
  owner_dir="$(cd "$(dirname "$owner")" && pwd)"
  local name="${dep#@rpath/}"
  while IFS= read -r rp; do
    [[ -z "$rp" ]] && continue
    case "$rp" in
      @loader_path|@executable_path) candidate="$owner_dir";;
      @loader_path/*|@executable_path/*) candidate="$owner_dir/${rp#*/}";;
      /*) candidate="$rp";;
      *) candidate="$owner_dir/$rp";;
    esac
    if [[ -e "$candidate/$name" ]]; then
      echo "$candidate/$name"
      return 0
    fi
  done < <(list_rpaths "$owner")
  echo ""
}

# Resolve any raw dependency string to a real file on disk, or "" if it
# should be skipped (system lib, unresolved @rpath, etc).
resolve_dep() {
  local dep="$1" owner="$2"
  is_system_dep "$dep" && { echo ""; return 0; }
  case "$dep" in
    @rpath/*)
      resolve_rpath_dep "$dep" "$owner"
      ;;
    @loader_path/*|@executable_path/*)
      local owner_dir; owner_dir="$(cd "$(dirname "$owner")" && pwd)"
      local rel="${dep#*/}"
      local candidate="$owner_dir/$rel"
      [[ -e "$candidate" ]] && echo "$candidate" || echo ""
      ;;
    /*)
      echo "$dep"
      ;;
    *)
      echo ""
      ;;
  esac
}

# Pure-bash relative path from directory $1 to directory $2 (both must
# exist). bash 3.2-compatible (macOS system bash) — no associative arrays,
# no external `realpath`/`python` dependency.
relpath() {
  local from to
  from="$(cd "$1" && pwd)"
  to="$(cd "$2" && pwd)"
  [[ "$from" == "$to" ]] && { echo "."; return 0; }
  local IFS=/
  local -a from_parts to_parts
  read -r -a from_parts <<< "$from"
  read -r -a to_parts <<< "$to"
  local i=0
  while [[ $i -lt ${#from_parts[@]} && $i -lt ${#to_parts[@]} && "${from_parts[$i]}" == "${to_parts[$i]}" ]]; do
    i=$((i + 1))
  done
  local up="" j
  for ((j = i; j < ${#from_parts[@]}; j++)); do up="../$up"; done
  local down=""
  for ((j = i; j < ${#to_parts[@]}; j++)); do down="$down${to_parts[$j]}/"; done
  local result="${up}${down}"
  result="${result%/}"
  [[ -z "$result" ]] && result="."
  echo "$result"
}

# newline-delimited "already processed" set (bash 3.2 has no assoc arrays)
SEEN=""
mark_seen() { SEEN="$SEEN
$1"; }
was_seen() { printf '%s\n' "$SEEN" | grep -qxF "$1"; }

# Does this mach-O file already carry an LC_RPATH equal to $2?
has_rpath() {
  list_rpaths "$1" | grep -qxF "$2"
}

# install_name_tool -change, but only if the old value is actually present
# (idempotent: a second run where the dep is already @rpath/<base> would
# otherwise fail with "no such load command").
safe_change() {
  local f="$1" old="$2" new="$3"
  list_deps "$f" | grep -qxF "$old" || return 0
  install_name_tool -change "$old" "$new" "$f" 2>/dev/null || \
    warn "install_name_tool -change failed on $f ($old -> $new); leaving as-is"
}

safe_set_id() {
  local f="$1" newid="$2"
  install_name_tool -id "$newid" "$f" 2>/dev/null || \
    warn "install_name_tool -id failed on $f (-> $newid)"
}

safe_add_rpath() {
  local f="$1" rp="$2"
  has_rpath "$f" "$rp" && return 0
  install_name_tool -add_rpath "$rp" "$f" 2>/dev/null || \
    warn "install_name_tool -add_rpath failed on $f ($rp)"
}

# ---------------------------------------------------------------------------
# Core: relocate one file's dependency closure into dest-lib-dir, recursing
# into every newly-vendored dylib. Rewrites happen on the copies AND (for the
# top-level file only) on the original.
# ---------------------------------------------------------------------------

# vendor_closure <owner-file> <dest-lib-dir>
# Copies + rewrites every non-system dep of <owner-file>, recursively.
vendor_closure() {
  local owner="$1" dest="$2" dep real base target rel_rpath rpath_value

  while IFS= read -r dep; do
    [[ -z "$dep" ]] && continue
    is_system_dep "$dep" && continue

    # Resolve the dep to a real file on disk. This handles absolute Homebrew
    # paths AND @rpath/@loader_path/@executable_path deps (via the owning
    # file's own LC_RPATH entries, which may themselves be absolute
    # dev-box paths — exactly the case that must be vendored, not skipped).
    real="$(resolve_dep "$dep" "$owner")"
    if [[ -z "$real" ]]; then
      warn "could not resolve dependency '$dep' of $owner; leaving unrewritten"
      continue
    fi
    base="$(basename "$real")"
    target="$dest/$base"

    if [[ "$real" == "$target" ]]; then
      : # already the vendored copy itself (idempotent re-run); nothing to copy.
    elif [[ ! -e "$target" ]]; then
      cp -f "$real" "$target"
      chmod u+w "$target"
      safe_set_id "$target" "@rpath/$base"
    fi

    # Rewrite the owner's reference to this dep to @rpath/<base> (a no-op,
    # safely skipped, if it already reads that way).
    safe_change "$owner" "$dep" "@rpath/$base"

    # Recurse into the vendored copy's own deps (idempotent via SEEN).
    if ! was_seen "$target"; then
      mark_seen "$target"
      # The vendored copy needs its own siblings resolvable via @rpath from
      # its own dir (which IS dest, so @loader_path == dest here).
      safe_add_rpath "$target" "@loader_path"
      vendor_closure "$target" "$dest"
    fi
  done < <(list_deps "$owner")
}

relocate_file() {
  local target="$1" dest="$2"
  [[ -f "$target" ]] || die "not a file: $target"
  mkdir -p "$dest"

  vendor_closure "$target" "$dest"

  rel_rpath="$(relpath "$(dirname "$target")" "$dest")"
  if [[ "$rel_rpath" == "." ]]; then
    rpath_value="@loader_path"
  else
    rpath_value="@loader_path/$rel_rpath"
  fi
  safe_add_rpath "$target" "$rpath_value"

  log "relocated $target (deps vendored into $dest, rpath $rpath_value)"
}

# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

check_file_clean() {
  local f="$1" bad
  bad="$(list_deps "$f" | grep -E '^(/usr/local|/opt/homebrew)' || true)"
  if [[ -n "$bad" ]]; then
    echo "  FAIL: $f" >&2
    echo "$bad" | sed 's/^/    still references: /' >&2
    return 1
  fi
  echo "  PASS: $f"
  return 0
}

self_test() {
  local target="$1" dest="${2:-}"
  [[ -f "$target" ]] || die "not a file: $target"

  local total=0 failed=0
  total=$((total + 1))
  check_file_clean "$target" || failed=$((failed + 1))

  if [[ -n "$dest" && -d "$dest" ]]; then
    while IFS= read -r -d '' f; do
      total=$((total + 1))
      check_file_clean "$f" || failed=$((failed + 1))
    done < <(find "$dest" \( -name '*.dylib' -o -name '*.so' \) -print0)
  fi

  log "self-test: $((total - failed))/$total clean"
  if [[ "$failed" -gt 0 ]]; then
    die "self-test FAILED: $failed file(s) still reference /usr/local or /opt/homebrew"
  fi
  log "self-test PASSED"
}

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

case "${1:-}" in
  -h|--help|"")
    usage
    [[ "${1:-}" == "" ]] && exit 2
    exit 0
    ;;
  --self-test)
    [[ -n "${2:-}" ]] || { usage; exit 2; }
    self_test "$2" "${3:-}"
    ;;
  *)
    [[ -n "${2:-}" ]] || { usage; exit 2; }
    relocate_file "$1" "$2"
    ;;
esac
