#!/usr/bin/env bash
#
# LANA One client launcher.
#
#   ./start.sh                    Normal dev run (connect-only; the client talks to
#                                 a separately-running backend via discovery/login).
#
#   ./start.sh --force-package    Boot the STAGED sovereign bundle AS-IF-INSTALLED:
#                                 the supervisor brings up the bundled Postgres +
#                                 backend + models from build/sovereign-resources,
#                                 exactly like a packaged install, from a plain
#                                 `electron .` run (no electron-builder package).
#                                 Requires the bundle: run `npm run stage:sovereign`
#                                 first. Sets LANA_ONE_FORCE_PACKAGE=1 (honored ONLY
#                                 when unpackaged, so it can never affect a real
#                                 install) + the supervisor/edition/cloud env.
#
#   ./start.sh --force-package --fresh
#                                 ...with a wiped userData (fresh Postgres init).
#
# Flags: --force-package|--bundled, --fresh, --user-data-dir=DIR
#
set -euo pipefail
cd "$(dirname "$0")"

FORCE_PACKAGE=0
FRESH=0
USER_DATA_DIR="${LANA_ONE_USER_DATA_DIR:-$HOME/Library/Application Support/LanaOne-dev}"

for arg in "$@"; do
  case "$arg" in
    --force-package|--force_package|--bundled) FORCE_PACKAGE=1 ;;
    --fresh) FRESH=1 ;;
    --user-data-dir=*) USER_DATA_DIR="${arg#*=}" ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "[start.sh] unknown arg: $arg" >&2 ;;
  esac
done

if [[ "$FORCE_PACKAGE" -eq 1 ]]; then
  export LANA_ONE_SUPERVISOR=1
  export LANA_ONE_FORCE_PACKAGE=1
  export LANA_ONE_EDITION=1
  export IS_LANA_ONE=true
  export LANA_CLOUD_ORIGIN="${LANA_CLOUD_ORIGIN:-https://one.lanaai.io}"
  export LANA_ONE_RESOURCES_PATH="${LANA_ONE_RESOURCES_PATH:-$PWD/build/sovereign-resources}"

  if [[ ! -d "$LANA_ONE_RESOURCES_PATH/backend" ]]; then
    echo "[start.sh] ERROR: staged bundle not found at $LANA_ONE_RESOURCES_PATH" >&2
    echo "[start.sh]        run 'npm run stage:sovereign' first, then retry." >&2
    exit 1
  fi

  if [[ "$FRESH" -eq 1 ]]; then
    echo "[start.sh] --fresh: wiping userData $USER_DATA_DIR"
    rm -rf "$USER_DATA_DIR"
  fi
  mkdir -p "$USER_DATA_DIR"

  echo "[start.sh] force-package: booting the staged sovereign bundle as-if-installed"
  echo "[start.sh]   resources: $LANA_ONE_RESOURCES_PATH"
  echo "[start.sh]   userData:  $USER_DATA_DIR"
  echo "[start.sh]   cloud:     $LANA_CLOUD_ORIGIN"
  exec npm run electron -- --user-data-dir="$USER_DATA_DIR"
fi

# Normal dev run.
exec npm run electron
