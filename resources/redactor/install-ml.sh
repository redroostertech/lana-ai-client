#!/usr/bin/env bash
# Install the redactor's full ML stack (PHI + de-identification) with the
# CORRECT torch wheel for this platform. This is the one place the torch
# platform/index quirk is handled, so a fresh environment can't get it wrong:
#
#   * Linux: the default PyPI torch wheel is the multi-GB CUDA build. We install
#     the CPU wheel from PyTorch's CPU index (which PEP 508 markers in
#     pyproject.toml cannot express). Works for any supported Python version.
#   * macOS / other: the default PyPI wheel is already CPU/MPS, so torch comes in
#     via the `sys_platform == 'darwin'` marker in the `deid` extra.
#
# Usage (from services/redactor):
#   ./install-ml.sh                 # uses `python` on PATH
#   PYTHON=.venv/bin/python ./install-ml.sh
set -euo pipefail

PYBIN="${PYTHON:-python}"
TORCH_VERSION="2.2.2"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "[install-ml] python: $("$PYBIN" --version 2>&1) on $(uname -s)"

if [ "$(uname -s)" = "Linux" ]; then
  echo "[install-ml] Linux: installing CPU torch==${TORCH_VERSION} from the CPU index"
  "$PYBIN" -m pip install \
    --index-url https://download.pytorch.org/whl/cpu "torch==${TORCH_VERSION}"
else
  echo "[install-ml] non-Linux: torch will come from the macOS marker in [deid]"
fi

echo "[install-ml] installing the package with both ML extras (.[ml])"
"$PYBIN" -m pip install -e "${HERE}[ml]"

echo "[install-ml] verifying model layers load..."
"$PYBIN" - <<'PY'
import spacy
spacy.load("en_core_web_lg"); print("  en_core_web_lg OK")
spacy.load("en_ner_bc5cdr_md"); print("  en_ner_bc5cdr_md OK")
import torch  # noqa: F401
print("  torch", torch.__version__, "OK")
PY

echo "[install-ml] done. Enable the de-id layer at runtime with REDACTOR_DEID=1."
