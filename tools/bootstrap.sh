#!/usr/bin/env bash
# Prepare the Python environment for the import pipeline. SLD decoding is done
# by the local pure-Python tools/sld_layers.py, so no openage checkout, C++
# toolchain, or Cython build is required any more.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$ROOT/.tools/import-venv"

[ -x "$VENV/bin/python" ] || python3 -m venv "$VENV"
"$VENV/bin/python" -m pip install --quiet -r "$ROOT/tools/requirements.txt"
