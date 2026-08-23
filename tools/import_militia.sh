#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/tools/bootstrap.sh"
"$ROOT/.tools/import-venv/bin/python" "$ROOT/tools/import_militia.py"
PYTHONPATH="$ROOT/.tools/openage-src" \
  "$ROOT/.tools/import-venv/bin/python" "$ROOT/tools/convert_sld.py"
