#!/usr/bin/env bash
# Compatibility entrypoint for existing hooks/operators; npm owns verification.
set -euo pipefail
cd "$(dirname "$0")/.."
exec npm run verify:owned
