#!/usr/bin/env bash
set -euo pipefail

# Builds the Docling runtime archive for THIS computer's platform (docling/docling-runtime-pin.json):
#
#   1. downloads the pinned python-build-standalone CPython 3.11 and checks its sha256
#   2. installs exactly the packages in docling/locks/<platform>.txt into it, every file checked
#      against the lock's hashes (pip --require-hashes --no-deps), CPU torch
#   3. strips what never runs (headers, tests, pip, console scripts), compiles byte code with
#      fixed hashes (it never has to be written on the person's computer)
#   4. checks it starts: imports docling_serve, torch and onnxruntime from a copy in another folder
#   5. writes lana-runtime.json and packs a deterministic <platform>.tar.gz, then prints its size,
#      sha256 and the pin entry for docling/docling-runtime-pin.json "archives"
#
# No PyInstaller, no venv (a venv bakes its folder into its scripts): the archive unpacks
# anywhere and runs as <folder>/python/bin/python3 -I -B -u -m docling_serve (python\python.exe on Windows):
# -I ignores the person's Python settings, -B never writes byte code, -u keeps the log unbuffered.
# Each platform builds on a matching computer; this refuses any other target.
#
#   scripts/build-docling-runtime.sh [platform] [--work DIR] [--out DIR]
#     platform  macos-arm64, macos-x64, windows-x64 or linux-x64 (default: this computer's)
#     --work    scratch folder (default: a new temp folder, removed afterwards)
#     --out     where the archive goes (default: build/docling-runtime)

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
pin="$root_dir/docling/docling-runtime-pin.json"
target=""
work_dir=""
out_dir="$root_dir/build/docling-runtime"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --work) work_dir="$2"; shift 2 ;;
    --out) out_dir="$2"; shift 2 ;;
    -*) echo "Unknown option $1" >&2; exit 2 ;;
    *) target="$1"; shift ;;
  esac
done

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) host="macos-arm64" ;;
  Darwin-x86_64) host="macos-x64" ;;
  Linux-x86_64) host="linux-x64" ;;
  MINGW*-x86_64|MSYS*-x86_64|CYGWIN*-x86_64) host="windows-x64" ;;
  *) echo "This computer ($(uname -s) $(uname -m)) has no Docling runtime platform." >&2; exit 1 ;;
esac
target="${target:-$host}"
if [[ "$target" != "$host" ]]; then
  echo "This computer builds $host, not $target. Build each platform on a matching computer." >&2
  exit 1
fi

pin_get() { node -p "const v = require('$pin')$1; if (v === undefined) { process.exit(3) } v"; }
version="$(pin_get .runtimeVersion)"
py_url="$(pin_get ".python.builds['$target'].url")" || { echo "No pinned Python for $target." >&2; exit 1; }
py_sha="$(pin_get ".python.builds['$target'].sha256")"
lock_rel="$(pin_get ".packages.locks['$target']")" || { echo "No lock file for $target. Compile docling/locks/$target.txt first (see the lock's header)." >&2; exit 1; }
lock="$root_dir/$lock_rel"
source_builds="$(node -p "require('$pin').packages.sourceBuilds.join(',')")"

if command -v sha256sum >/dev/null 2>&1; then sha_of() { sha256sum "$1" | cut -d' ' -f1; }
else sha_of() { shasum -a 256 "$1" | cut -d' ' -f1; }; fi

if [[ -z "$work_dir" ]]; then
  work_dir="$(mktemp -d)"
  trap 'rm -rf "$work_dir"' EXIT
fi
mkdir -p "$work_dir" "$out_dir"
stage="$work_dir/stage"
rm -rf "$stage" "$work_dir/relocated"
mkdir -p "$stage"

# 1. Python
py_archive="$work_dir/$(basename "${py_url//%2B/+}")"
if [[ ! -f "$py_archive" || "$(sha_of "$py_archive")" != "$py_sha" ]]; then
  echo "Downloading Python $(pin_get .python.version) ($(pin_get .python.release)) for $target"
  curl -fL --retry 2 -o "$py_archive" "$py_url"
fi
if [[ "$(sha_of "$py_archive")" != "$py_sha" ]]; then
  echo "The Python download did not match its pinned sha256. Stopping." >&2
  exit 1
fi
tar -xzf "$py_archive" -C "$stage"
if [[ "$target" == windows-* ]]; then py="$stage/python/python.exe"; else py="$stage/python/bin/python3"; fi
"$py" -I -B -c 'import sys; assert sys.version_info[:2] == (3, 11), sys.version'

# 2. Packages: only what the lock names, only with its hashes. The packages that publish no
# wheel (sourceBuilds) are built here from their hashed source with setuptools from the lock.
only_binary=(--only-binary ':all:')
if [[ -n "$source_builds" ]]; then only_binary+=(--no-binary "$source_builds" --no-build-isolation); fi
export PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_INPUT=1 PYTHONDONTWRITEBYTECODE=1
if [[ "$target" == macos-* ]]; then export MACOSX_DEPLOYMENT_TARGET=14.0; fi
"$py" -I -B -m pip install --no-cache-dir --no-deps --require-hashes --no-compile "${only_binary[@]}" -r "$lock"
"$py" -I -B -m pip check

# 3. Strip, then byte code with fixed hashes, paths relative to the runtime folder. -I ignores
# PYTHONDONTWRITEBYTECODE, so every Python run here passes -B: otherwise imports leave timestamp
# byte code that goes stale (and gets rewritten) once the archive unpacks somewhere else. -f replaces
# any that slipped through, and check-pyc stops the build if one is left.
"$py" -I -B "$root_dir/scripts/docling-runtime-pack.py" strip "$stage" "$target"
"$py" -I -B -m compileall -q -f -j 0 --invalidation-mode unchecked-hash -s "$stage" -p "" "$stage/python" > "$work_dir/compileall.log" 2>&1 || {
  echo "Files that did not compile (old templates and test data inside some packages; never imported):" >&2
  grep -E "^\*\*\*|Error" "$work_dir/compileall.log" | head -20 >&2 || true; }
"$py" -I -B "$root_dir/scripts/docling-runtime-pack.py" check-pyc "$stage"

# 4. It must start from a folder it was not built in.
cp -R "$stage" "$work_dir/relocated"
if [[ "$target" == windows-* ]]; then rpy="$work_dir/relocated/python/python.exe"; else rpy="$work_dir/relocated/python/bin/python3"; fi
(cd "$work_dir" && "$rpy" -I -B -c '
import sys, docling_serve, docling, torch, torchvision, onnxruntime, rapidocr
assert torch.version.cuda is None, "CUDA torch"
assert sys.prefix.endswith("relocated/python") or "relocated" in sys.prefix, sys.prefix
print("relocated import ok:", sys.prefix, "torch", torch.__version__)
')
rm -rf "$work_dir/relocated"

# 5. Manifest and archive.
if [[ "$target" == windows-* ]]; then entry='["python/python.exe","-I","-B","-u","-m","docling_serve","run"]'; else entry='["python/bin/python3","-I","-B","-u","-m","docling_serve","run"]'; fi
"$py" -I -B "$root_dir/scripts/docling-runtime-pack.py" manifest "$stage" "{\"runtimeVersion\":\"$version\",\"platform\":\"$target\",\"python\":\"$(pin_get .python.version)+$(pin_get .python.release)\",\"entry\":$entry}"
archive="$out_dir/$target.tar.gz"
stats="$("$py" -I -B "$root_dir/scripts/docling-runtime-pack.py" pack "$stage" "$archive")"
"$py" -I -B "$root_dir/scripts/docling-runtime-pack.py" check "$archive"

size="$(wc -c < "$archive" | tr -d ' ')"
sha="$(sha_of "$archive")"
unpacked="$(node -p "JSON.parse('$stats').unpackedBytes")"
files="$(node -p "JSON.parse('$stats').files")"
echo ""
echo "Archive:  $archive"
echo "Size:     $size bytes ($(( size / 1048576 )) MB), unpacked $unpacked bytes in $files files"
echo "sha256:   $sha"
echo ""
echo "Pin entry for docling/docling-runtime-pin.json \"archives\":"
echo "  \"$target\": { \"url\": \"https://models.lanaai.io/docling/runtime/$version/$target.tar.gz\", \"sizeBytes\": $size, \"sha256\": \"$sha\", \"unpackedBytes\": $unpacked, \"files\": $files }"
