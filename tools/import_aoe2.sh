#!/usr/bin/env bash
# One command regenerates every imported manifest/atlas/UI asset byte-identically.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPOT_ROOT="${AOE2DE_DEPOT_ROOT:-$HOME/Steam/steamapps/content/app_813780}"
DAT="$DEPOT_ROOT/depot_813781/resources/_common/dat/empires2_x2_p1.dat"
SOUNDS="$DEPOT_ROOT/depot_813781/resources/_common/dat/sounds.json"
WIDGETUI="$DEPOT_ROOT/depot_813782/widgetui"
GRAPHICS="$DEPOT_ROOT/depot_813784/resources/_common/drs/graphics"

for required in "$DAT" "$SOUNDS" "$WIDGETUI" "$GRAPHICS"; do
  if [ ! -e "$required" ]; then
    echo "Missing owned AoE2DE depot content: $required" >&2
    echo "Set AOE2DE_DEPOT_ROOT to app_813780; see tools/README.md." >&2
    exit 2
  fi
done

"$ROOT/tools/bootstrap.sh"
"$ROOT/.tools/import-venv/bin/python" "$ROOT/tools/import_content.py" \
  --dat "$DAT" --graphics "$GRAPHICS"
PYTHONPATH="$ROOT/.tools/openage-src" \
  "$ROOT/.tools/import-venv/bin/python" "$ROOT/tools/convert_sld.py" \
  --graphics "$GRAPHICS"
"$ROOT/.tools/import-venv/bin/python" "$ROOT/tools/import_ui.py" \
  --widgetui "$WIDGETUI" --sounds "$SOUNDS"
