#!/usr/bin/env bash
# Prepare the locked Python environment for the offline tools. SLD decoding is
# local pure Python, so no openage checkout, C++ toolchain, or Cython is needed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
command -v uv >/dev/null || {
  echo "uv is required: https://docs.astral.sh/uv/getting-started/installation/" >&2
  exit 2
}
cd "$ROOT"
uv sync --locked
