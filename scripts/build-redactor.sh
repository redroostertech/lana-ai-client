#!/usr/bin/env bash
set -euo pipefail

# Builds build/redactor/lana-redactor/: one folder holding the program lana-redactor (lana-redactor.exe
# on Windows) with Python,
# the redactor at the commit in redactor/redactor-pin.json, Presidio, spaCy and en_core_web_lg beside it.
# Packaged the way BLOT packages the same redactor (blot-framework sidecar/redactor/build-sidecar.sh),
# but as one folder, not one file: a one-file build unpacks about 670 MB into the temp folder on every
# launch (30 to 47 seconds, measured 2026-11-09) and leaves it behind after a crash.
# Run it on each target OS and processor before packaging; the package step refuses to build
# without it (scripts/redactor-before-pack.js).
#
#   LANA_REDACTOR_SRC     a lana-redactor checkout at the pinned commit, with no local changes
#   LANA_REDACTOR_PYTHON  the Python to build with (default python3). Prepare it once with:
#                           python -m pip install "$LANA_REDACTOR_SRC" pyinstaller
#                           PYTHON=python "$LANA_REDACTOR_SRC/install-models.sh"

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
pin="$root_dir/redactor/redactor-pin.json"
source_dir="${LANA_REDACTOR_SRC:?Set LANA_REDACTOR_SRC to a lana-redactor checkout}"
python_bin="${LANA_REDACTOR_PYTHON:-python3}"
output_dir="$root_dir/build/redactor"

want="$(node -p "require('$pin').commit")"
have="$(git -C "$source_dir" rev-parse HEAD)"
if [[ "$have" != "$want" ]]; then
  echo "lana-redactor is at $have, the client pins $want. Check out the pinned commit." >&2
  exit 1
fi
# Refuse to ship a locally edited copy (BLOT's verify-vendored check, for a checkout).
if [[ -n "$(git -C "$source_dir" status --porcelain -- redactor pyproject.toml)" ]]; then
  echo "lana-redactor has local changes under redactor/ or pyproject.toml. Build from a clean checkout." >&2
  exit 1
fi

# A build missing the names layer would produce a program that refuses every request.
if ! "$python_bin" -c "import presidio_analyzer, presidio_anonymizer, spacy, en_core_web_lg, fitz, docx, uvicorn, PyInstaller" 2>/dev/null; then
  echo "The build Python is missing the redactor, its models or PyInstaller. Prepare it with:" >&2
  echo "  $python_bin -m pip install '$source_dir' pyinstaller" >&2
  echo "  PYTHON=$python_bin $source_dir/install-models.sh" >&2
  exit 1
fi
model_version="$("$python_bin" -c "import en_core_web_lg; print(en_core_web_lg.__version__)")"
want_model="$(node -p "require('$pin').spacyModel.version")"
if [[ "$model_version" != "$want_model" ]]; then
  echo "en_core_web_lg is $model_version, the client pins $want_model." >&2
  exit 1
fi

mkdir -p "$output_dir"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
rm -rf "$output_dir/lana-redactor"
"$python_bin" -m PyInstaller --noconfirm --clean --onedir \
  --name lana-redactor \
  --paths "$source_dir" \
  --collect-all redactor \
  --collect-all presidio_analyzer \
  --collect-all presidio_anonymizer \
  --collect-all spacy \
  --collect-all en_core_web_lg \
  --collect-all fitz \
  --collect-all docx \
  --workpath "$work_dir/work" \
  --specpath "$work_dir" \
  --distpath "$output_dir" \
  "$root_dir/redactor/lana_redactor.py"
echo "Built $(ls -d "$output_dir"/lana-redactor/lana-redactor*)"
