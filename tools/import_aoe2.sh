#!/usr/bin/env bash
# One command regenerates every imported manifest/atlas/UI asset byte-identically.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPOT_ROOT="${AOE2DE_DEPOT_ROOT:-$HOME/Steam/steamapps/content/app_813780}"
if [ ! -d "$DEPOT_ROOT" ] && [ -z "${AOE2DE_DEPOT_ROOT:-}" ]; then
  # Common SteamCMD/Steam client download locations, tried in order.
  for candidate in \
    "$HOME/.local/share/Steam/steamcmd/linux32/steamapps/content/app_813780" \
    "$HOME/.local/share/Steam/steamapps/content/app_813780" \
    "$HOME/.steam/steam/steamapps/content/app_813780"; do
    if [ -d "$candidate" ]; then
      DEPOT_ROOT="$candidate"
      break
    fi
  done
fi
DAT="$DEPOT_ROOT/depot_813781/resources/_common/dat/empires2_x2_p1.dat"
SOUNDS="$DEPOT_ROOT/depot_813781/resources/_common/dat/sounds.json"
WIDGETUI="$DEPOT_ROOT/depot_813782/widgetui"
TERRAIN="$DEPOT_ROOT/depot_813782/resources/_common/terrain/textures/2x"
GRAPHICS="$DEPOT_ROOT/depot_813784/resources/_common/drs/graphics"
AUDIO_PACK="$DEPOT_ROOT/depot_813783/wwise/Base.pck"

for required in "$DAT" "$SOUNDS" "$WIDGETUI" "$TERRAIN" "$GRAPHICS"; do
  if [ ! -e "$required" ]; then
    echo "Missing owned AoE2DE depot content: $required" >&2
    echo "Set AOE2DE_DEPOT_ROOT to app_813780; see tools/README.md." >&2
    exit 2
  fi
done

"$ROOT/tools/bootstrap.sh"
"$ROOT/.tools/import-venv/bin/python" "$ROOT/tools/import_content.py" \
  --dat "$DAT" --graphics "$GRAPHICS"
"$ROOT/.tools/import-venv/bin/python" "$ROOT/tools/convert_sld.py" \
  --graphics "$GRAPHICS" --terrain "$TERRAIN"
"$ROOT/.tools/import-venv/bin/python" "$ROOT/tools/import_ui.py" \
  --widgetui "$WIDGETUI" --sounds "$SOUNDS"

if [ -f "$AUDIO_PACK" ]; then
  if ! command -v vgmstream-cli >/dev/null; then
    echo "Owned Wwise audio found, but vgmstream-cli is missing." >&2
    echo "Install vgmstream (macOS: brew install vgmstream), then rerun." >&2
    exit 2
  fi
  "$ROOT/.tools/import-venv/bin/python" "$ROOT/tools/import_audio.py" \
    --pack "$AUDIO_PACK"
else
  rm -rf "$ROOT/public/imported/aoe2/audio"
  echo "Optional audio depot 813783 not found; continuing without audio." >&2
fi
