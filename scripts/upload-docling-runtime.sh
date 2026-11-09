#!/usr/bin/env bash
set -euo pipefail

# Publishes one built Docling runtime archive to the model bucket (lana-models, served as
# models.lanaai.io), at the versioned key the client pins, and reads it back to prove it.
# Run by a person with the R2 keys, after scripts/build-docling-runtime.sh and after the pin
# (docling/docling-runtime-pin.json "archives") holds the archive's size and sha256.
#
#   scripts/upload-docling-runtime.sh <archive> [platform]
#
#   1. checks the archive's size and sha256 against the pin (nothing goes up that the client
#      would refuse)
#   2. refuses when the key already holds an object: a published version never changes; bump
#      runtimeVersion instead
#   3. uploads to lana-models/docling/runtime/<version>/<platform>.tar.gz as application/gzip,
#      through the backend's R2 helper (LANA-AI scripts/release/r2.sh, credentials from its .env,
#      never printed)
#   4. reads it back through the bucket (r2.sh sha) and through https://models.lanaai.io (size and
#      sha256), and fails unless both match the pin
#
#   R2_SH   the backend's r2.sh (default: ../LANA-AI/scripts/release/r2.sh beside this repo)

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
pin="$root_dir/docling/docling-runtime-pin.json"
archive="${1:?Usage: scripts/upload-docling-runtime.sh <archive> [platform]}"
platform="${2:-$(basename "$archive" .tar.gz)}"
r2="${R2_SH:-$root_dir/../LANA-AI/scripts/release/r2.sh}"
bucket="lana-models"

[[ -x "$r2" || -r "$r2" ]] || { echo "No R2 helper at $r2. Set R2_SH to LANA-AI/scripts/release/r2.sh." >&2; exit 2; }
url="$(node -p "(require('$pin').archives['$platform'] || {}).url || ''")"
want_size="$(node -p "(require('$pin').archives['$platform'] || {}).sizeBytes || ''")"
want_sha="$(node -p "(require('$pin').archives['$platform'] || {}).sha256 || ''")"
[[ -n "$url" ]] || { echo "The pin has no archive for $platform." >&2; exit 1; }
key="${url#https://models.lanaai.io/}"

if command -v sha256sum >/dev/null 2>&1; then sha_of() { sha256sum "$1" | cut -d' ' -f1; }
else sha_of() { shasum -a 256 "$1" | cut -d' ' -f1; }; fi

# 1. The local file is the pinned one.
have_size="$(wc -c < "$archive" | tr -d ' ')"
have_sha="$(sha_of "$archive")"
if [[ "$have_size" != "$want_size" || "$have_sha" != "$want_sha" ]]; then
  echo "This archive is $have_size bytes, sha256 $have_sha; the pin says $want_size bytes, $want_sha." >&2
  exit 1
fi

# 2. Never overwrite a published version.
if bash "$r2" ls "$bucket/$key" 2>/dev/null | grep -q .; then
  echo "$bucket/$key already exists. A published runtime never changes: bump runtimeVersion and rebuild." >&2
  exit 1
fi

# 3. Upload.
echo "Uploading $archive to $bucket/$key"
bash "$r2" up "$archive" "$bucket/$key" application/gzip

# 4. Read back, through the bucket and through the public address the client uses.
bucket_sha="$(bash "$r2" sha "$bucket/$key")"
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
curl -fsSL -o "$tmp" "$url"
public_size="$(wc -c < "$tmp" | tr -d ' ')"
public_sha="$(sha_of "$tmp")"
content_type="$(curl -fsSI "$url" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print $2}')"
echo "bucket sha256:  $bucket_sha"
echo "public sha256:  $public_sha ($public_size bytes, $content_type)"
if [[ "$bucket_sha" != "$want_sha" || "$public_sha" != "$want_sha" || "$public_size" != "$want_size" ]]; then
  echo "Read-back does not match the pin. Do not ship this client until it does." >&2
  exit 1
fi
echo "Published and verified: $url"
