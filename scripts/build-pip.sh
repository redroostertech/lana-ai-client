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
#
# On Windows it runs under Git Bash and builds through LANA.cpp's own scripts\build.cmd (VS 2022
# Build Tools environment, clang-cl from LQE_CLANGCL, Ninja), as LANA.cpp's engine-release workflow
# does, with the Vulkan SDK in VULKAN_SDK. Its verifier needs python on PATH.

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
# Node and the Windows tools read C:/... paths, not Git Bash's /c/... ones.
if [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* ]]; then root_dir="$(cygpath -m "$root_dir")"; fi
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
# The tag is moved on purpose (pip/pip-pin.json), so a checkout fetched before a move still has
# the old tag. Refuse one whose tag names a different commit rather than build beside it.
tag="$(node -p "require('$pin').tag || ''")"
if [[ -n "$tag" ]]; then
  tagged="$(git -C "$source_dir" rev-parse --verify --quiet "refs/tags/$tag^{commit}" || true)"
  if [[ -n "$tagged" && "$tagged" != "$want" ]]; then
    echo "LANA.cpp's $tag is at $tagged here, the client pins $want. The tag was moved: run git fetch --tags --force." >&2
    exit 1
  fi
fi
if [[ -n "$(git -C "$source_dir" status --porcelain --untracked-files=no)" ]]; then
  echo "LANA.cpp has local changes. Build from a clean checkout." >&2
  exit 1
fi

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
SOURCE_DATE_EPOCH="$(git -C "$source_dir" log -1 --format=%ct)"
export SOURCE_DATE_EPOCH
if [[ "$key" == windows-* ]]; then
  : "${LQE_CLANGCL:?Set LQE_CLANGCL to the pinned clang-cl.exe (LANA.cpp engine-release workflow)}"
  work_dir="$(cygpath -m "$work_dir")"
  # build.cmd needs each -D option quoted ("-DLQE_VULKAN=ON"), or cmd splits it at the "=".
  {
    printf '@call "%s" %s' "$(cygpath -w "$source_dir/scripts/build.cmd")" "$(cygpath -w "$work_dir/build")"
    for flag in $flags; do printf ' "%s"' "$flag"; done
    printf '\r\n@exit /b %%errorlevel%%\r\n'
  } > "$work_dir/build.cmd"
  cmd //c "$(cygpath -w "$work_dir/build.cmd")"
else
  # shellcheck disable=SC2086
  cmake -S "$source_dir" -B "$work_dir/build" -DCMAKE_BUILD_TYPE=Release $flags
  cmake --build "$work_dir/build" --parallel --config Release
fi
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
if [[ "$key" == windows-* ]]; then
  # The checker wants LANA.cpp's release asset name.
  cp "$binary" "$work_dir/lqe-win32-x64.exe"
  "$work_dir/lqe-win32-x64.exe" --version > "$work_dir/version.txt"
  python "$source_dir/scripts/verify_release_artifact.py" --binary "$work_dir/lqe-win32-x64.exe" --platform win32 --arch x64 \
    --version "$version" --build "$want" --reported-version "$work_dir/version.txt" \
    --cmake-cache "$work_dir/build/CMakeCache.txt" --require-vulkan --require-clang-cl
  imports="$("$(dirname "$(cygpath -u "$LQE_CLANGCL")")/llvm-objdump.exe" -p "$binary" | sed -n 's/^.*DLL Name: *//p' | tr -d '\r')"
  if grep -Eiq '^(MSVCP|VCRUNTIME|VCOMP|LIBOMP)' <<< "$imports"; then
    echo "The build imports a runtime the installer does not carry: $(grep -Ei '^(MSVCP|VCRUNTIME|VCOMP|LIBOMP)' <<< "$imports" | tr '\n' ' ')" >&2
    exit 1
  fi
  if ! grep -qix 'vulkan-1.dll' <<< "$imports"; then
    echo "The build does not contain the Vulkan backend (no vulkan-1.dll import)." >&2
    exit 1
  fi
fi

mkdir -p "$root_dir/build/pip"
cp "$binary" "$root_dir/build/pip/$exe"
chmod 755 "$root_dir/build/pip/$exe"
if [[ "$key" == windows-* || "$key" == linux-* ]]; then
  # lqe needs the Vulkan loader (vulkan-1.dll, libvulkan.so.1); the package ships the pinned one
  # in pip/vulkan-fallback.
  node "$root_dir/scripts/fetch-vulkan-loader.js"
fi
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
