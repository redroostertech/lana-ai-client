"""Entry point for LANA's loopback redactor program (PyInstaller, scripts/build-redactor.sh).

The client (electron-redactor.js) starts it with --host 127.0.0.1 and a free port, and gives it
a new INTERNAL_SERVICE_SECRET and REDACTOR_STRICT=1 on every launch. It never listens beyond
loopback. Modelled on BLOT's blot_redactor.py.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

import uvicorn


def configure_ocr_runtime() -> None:
    """Point the OCR wrapper at a Tesseract runtime packaged beside the program, when there is one."""
    executable = os.environ.get("LANA_TESSERACT_PATH")
    tessdata = os.environ.get("LANA_TESSDATA_DIR")
    if tessdata:
        os.environ["TESSDATA_PREFIX"] = str(Path(tessdata))
    if not executable:
        return
    try:
        import pytesseract

        pytesseract.pytesseract.tesseract_cmd = executable
    except Exception:
        # The redactor's OCR guard reports OCR as unavailable.
        return


def main() -> None:
    parser = argparse.ArgumentParser(description="LANA local redactor")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    configure_ocr_runtime()
    uvicorn.run("redactor.main:app", host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
