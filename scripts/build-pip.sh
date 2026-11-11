#!/usr/bin/env bash
set -euo pipefail

# Builds build/pip/lqe (lqe.exe on Windows): Pip, the LANA.cpp engine the client starts for chat
# and search embedding (electron-pip-supervisor.js), from the commit pinned in pip/pip-pin.json,
# with LANA.cpp's distribution contract (portable, no build-machine-only instructions; on macOS
# arm64 with Metal and a 13.3 floor, checked the way LANA.cpp's engine-release workflow checks it;
# on macOS x64 on the CPU backend with the same floor, checked by scripts/verify-pip-macos-x64.js).
# The compile date is fixed to the commit's date (SOURCE_DATE_EPOCH), so the same commit builds
# the same bytes and the sha256 in the pin can be checked on every build.
# Run it on each target system and processor before packaging; the package step refuses to build
# without it or with a different file (scripts/pip-before-pack.js).
#
#   LANA_PIP_SRC         a LANA.cpp checkout at the pinned commit, with no local changes
#   LANA_PIP_SKIP_TESTS  1 skips LANA.cpp's own tests (ctest); they run by default

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
pin="$root_dir/pip/pip-pin.json"
source_dir="${LANA_PIP_SRC:?Set LANA_PIP_SRC to a LANA.cpp checkout}"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) key="macos-arm64"; exe="lqe" ;;
  Darwin-x86_64) key="macos-x64"; exe="lqe" ;;
  Linux-x86_64) key="linux-x64"; exe="lqe" ;;
  MINGW*-x86_64|MSYS*-x86_64) key="windows-x64"; exe="lqe.exe" ;;
  *) echo "No Pip build for $(uname -s)-$(uname -m)." >&2; exit 1 ;;
esac

want="$(node -p "require('$pin').commit")"
version="$(node -p "require('$pin').version")"
build_id="$(node -p "require('$pin').build")"
flags="$(node -p "(require('$pin').cmake['$key'] || []).join(' ')")"
if [[ -z "$flags" ]]; then
  echo "pip/pip-pin.json has no cmake flags for $key." >&2
  exit 1
fi
have="$(git -C "$source_dir" rev-parse HEAD)"
if [[ "$have" != "$want" ]]; then
  echo "LANA.cpp is at $have, the client pins $want ($version). Check out the pinned commit." >&2
  exit 1
fi
if [[ -n "$(git -C "$source_dir" status --porcelain --untracked-files=no)" ]]; then
  echo "LANA.cpp has local changes. Build from a clean checkout." >&2
  exit 1
fi

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
SOURCE_DATE_EPOCH="$(git -C "$source_dir" log -1 --format=%ct)"
export SOURCE_DATE_EPOCH
# shellcheck disable=SC2086
cmake -S "$source_dir" -B "$work_dir/build" -DCMAKE_BUILD_TYPE=Release $flags
cmake --build "$work_dir/build" --parallel --config Release
if [[ "${LANA_PIP_SKIP_TESTS:-}" != "1" ]]; then
  ctest --test-dir "$work_dir/build" --output-on-failure -C Release
fi
binary="$(find "$work_dir/build/src" -maxdepth 2 -name "$exe" -type f | head -1)"
reported="$("$binary" --version)"
if [[ "$reported" != "lqe $version ($build_id, built "* ]]; then
  echo "The build reports \"$reported\", expected lqe $version ($build_id). A -dirty build is never packaged." >&2
  exit 1
fi
if [[ "$key" == "macos-x64" ]]; then
  # LANA.cpp's verifier at the pinned commit accepts only darwin-arm64, so macos-x64 gets the
  # same checks from scripts/verify-pip-macos-x64.js (x86_64 only, 13.3 floor, pinned version
  # and build, system libraries only). ctest has already run above.
  node "$root_dir/scripts/verify-pip-macos-x64.js" "$binary" "$version" "$build_id" 13.3
elif [[ "$key" == macos-* ]]; then
  arch="${key#macos-}"
  echo "$reported" > "$work_dir/version.txt"
  # The checker wants LANA.cpp's release asset name.
  cp "$binary" "$work_dir/lqe-darwin-$arch"
  python3 "$source_dir/scripts/verify_release_artifact.py" --binary "$work_dir/lqe-darwin-$arch" --platform darwin --arch "$arch" \
    --version "$version" --build "$want" --reported-version "$work_dir/version.txt" \
    --cmake-cache "$work_dir/build/CMakeCache.txt" --macos-minimum 13.3
  if otool -tvV "$binary" | grep -Eiq '(^|[[:space:]])(smmla|ummla|usmmla|bfmmla|bfdot|bfmlal[bt]?)([[:space:]]|$)'; then
    echo "The build contains an Arm v8.6 instruction the oldest supported Apple silicon lacks." >&2
    exit 1
  fi
fi

mkdir -p "$root_dir/build/pip"
cp "$binary" "$root_dir/build/pip/$exe"
chmod 755 "$root_dir/build/pip/$exe"
sha="$(node -p "require('$root_dir/scripts/local-ai-pins.js').sha256File('$root_dir/build/pip/$exe')")"
bytes="$(wc -c < "$root_dir/build/pip/$exe" | tr -d ' ')"
echo "Built build/pip/$exe: $reported, $bytes bytes, sha256 $sha"
pinned="$(node -p "(require('$pin').builds['$key'] || {}).sha256 || ''")"
if [[ -z "$pinned" ]]; then
  echo "pip/pip-pin.json has no sha256 for $key yet. Record: \"$key\": { \"sha256\": \"$sha\", \"bytes\": $bytes }" >&2
  exit 1
fi
if [[ "$pinned" != "$sha" ]]; then
  echo "This build does not match the pin for $key ($pinned). The pin changes only with a new LANA.cpp commit." >&2
  exit 1
fi
echo "Matches the pin for $key."
