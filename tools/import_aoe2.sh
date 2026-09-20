#!/usr/bin/env bash
# One command regenerates every imported manifest/atlas/UI asset byte-identically.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/tools/bootstrap.sh"
# AOE2DE_DEPOT_ROOT, or the SteamCMD/Steam download locations tools/depot.py
# knows about -- the same resolution the integration tests use.
DEPOT_ROOT="$(uv run --project "$ROOT" --locked python "$ROOT/tools/depot.py")"
DAT="$DEPOT_ROOT/depot_813781/resources/_common/dat/empires2_x2_p1.dat"
SOUNDS="$DEPOT_ROOT/depot_813781/resources/_common/dat/sounds.json"
BLENDOMATIC="$DEPOT_ROOT/depot_813781/resources/_common/dat/blendomatic_x1.dat"
HOTKEYS="$DEPOT_ROOT/depot_813781/resources/_common/dat/hotkeys.json"
STRINGS="$DEPOT_ROOT/depot_813781/resources/en/strings/key-value/key-value-strings-utf8.txt"
PALETTES="$DEPOT_ROOT/depot_813781/resources/_common/palettes"
WIDGETUI="$DEPOT_ROOT/depot_813782/widgetui"
FONTS="$DEPOT_ROOT/depot_813781/resources/_common/fonts"
TERRAIN="$DEPOT_ROOT/depot_813782/resources/_common/terrain/textures/2x"
GRAPHICS="$DEPOT_ROOT/depot_813784/resources/_common/drs/graphics"
# The Enhanced Graphics Pack (depot 1039811): optional, preferred when present.
UHD_GRAPHICS="$DEPOT_ROOT/depot_1039811/resources/_common/drs/graphics"
AUDIO_PACK="$DEPOT_ROOT/depot_813783/wwise/Base.pck"

for required in "$DAT" "$SOUNDS" "$BLENDOMATIC" "$HOTKEYS" "$STRINGS" "$PALETTES" "$WIDGETUI" "$TERRAIN" "$GRAPHICS"; do
  if [ ! -e "$required" ]; then
    echo "Missing owned AoE2DE depot content: $required" >&2
    echo "Set AOE2DE_DEPOT_ROOT to app_813780; see tools/README.md." >&2
    exit 2
  fi
done

UHD=()
if [ -d "$UHD_GRAPHICS" ]; then
  UHD=(--uhd-graphics "$UHD_GRAPHICS")
  echo "Enhanced Graphics Pack found; sprites import at x2." >&2
else
  echo "Enhanced Graphics Pack (depot 1039811) not found; sprites import at x1." >&2
fi

uv run --project "$ROOT" --locked python "$ROOT/tools/import_content.py" \
  --dat "$DAT" --graphics "$GRAPHICS" "${UHD[@]}" --palettes "$PALETTES" --strings "$STRINGS"
uv run --project "$ROOT" --locked python "$ROOT/tools/convert_sld.py" \
  --graphics "$GRAPHICS" "${UHD[@]}" --terrain "$TERRAIN"
uv run --project "$ROOT" --locked python "$ROOT/tools/import_ui.py" \
  --widgetui "$WIDGETUI" --sounds "$SOUNDS" --hotkeys "$HOTKEYS" --fonts "$FONTS"
uv run --project "$ROOT" --locked python "$ROOT/tools/import_blends.py" \
  --blendomatic "$BLENDOMATIC"

if [ -f "$AUDIO_PACK" ]; then
  if ! command -v vgmstream-cli >/dev/null; then
    echo "Owned Wwise audio found, but vgmstream-cli is missing." >&2
    echo "Install vgmstream (macOS: brew install vgmstream), then rerun." >&2
    exit 2
  fi
  uv run --project "$ROOT" --locked python "$ROOT/tools/import_audio.py" \
    --pack "$AUDIO_PACK" --content "$ROOT/.local/aoe2de/content.json"
else
  rm -rf "$ROOT/public/imported/aoe2/audio"
  echo "Optional audio depot 813783 not found; continuing without audio." >&2
fi
