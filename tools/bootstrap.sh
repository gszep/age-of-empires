#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$ROOT/.tools/import-venv"
OPENAGE="$ROOT/.tools/openage-src"
OPENAGE_REV="9a5a7ccbfc20c2de658fc746462cd4a69aa758ef"

[ -x "$VENV/bin/python" ] || python3 -m venv "$VENV"
"$VENV/bin/python" -m pip install --quiet -r "$ROOT/tools/requirements.txt"

if [ ! -d "$OPENAGE/.git" ]; then
  git clone --quiet https://github.com/SFTtech/openage.git "$OPENAGE"
fi
git -C "$OPENAGE" fetch --quiet origin "$OPENAGE_REV"
git -C "$OPENAGE" checkout --quiet --detach "$OPENAGE_REV"

EXT_SUFFIX="$($VENV/bin/python -c 'import sysconfig; print(sysconfig.get_config_var("EXT_SUFFIX"))')"
if [ ! -f "$OPENAGE/openage/convert/value_object/read/media/sld$EXT_SUFFIX" ]; then
  NUMPY_INCLUDE="$($VENV/bin/python -c 'import numpy; print(numpy.get_include())')"
  cd "$OPENAGE"
  CPPFLAGS="-I$NUMPY_INCLUDE" CXXFLAGS="-I$NUMPY_INCLUDE" \
    "$VENV/bin/cythonize" -i -3 --cplus \
    openage/convert/value_object/read/media/sld.pyx \
    openage/convert/value_object/read/media/slp.pyx \
    openage/convert/value_object/read/media/smp.pyx \
    openage/convert/value_object/read/media/smx.pyx \
    openage/convert/service/export/png/binpack.pyx \
    openage/convert/processor/export/texture_merge.pyx
fi
