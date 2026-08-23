#!/usr/bin/env bash
# One command regenerates every imported manifest/atlas/UI asset byte-identically.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/tools/bootstrap.sh"
"$ROOT/.tools/import-venv/bin/python" "$ROOT/tools/import_content.py"
PYTHONPATH="$ROOT/.tools/openage-src" \
  "$ROOT/.tools/import-venv/bin/python" "$ROOT/tools/convert_sld.py"
"$ROOT/.tools/import-venv/bin/python" "$ROOT/tools/import_ui.py"
