#!/usr/bin/env bash
# The quality gate, with each step's own exit status intact.
#
# Two ways to lose that status, both met the hard way. Piping a step to `tail`
# hands `&&` the status of `tail`, which is always 0. And reading PIPESTATUS
# after an `if ! ...; then :; fi` reads the `:`, not the pipeline -- so the
# failure case, the only one that matters, reported success. Run the pipeline
# plainly and read PIPESTATUS on the very next line.
set -uo pipefail
# Repo root first: the log path below is relative to it.
cd "$(dirname "$0")/.."
GATE_LOG="${GATE_LOG:-.local/gate-step.log}"
mkdir -p "$(dirname "$GATE_LOG")"
for step in "npm test" "npm run build" "npm run test:import"; do
  echo "=== $step ==="
  $step > "$GATE_LOG" 2>&1
  status=$?
  tail -"${GATE_TAIL:-8}" "$GATE_LOG"
  if [ "$status" -ne 0 ]; then
    echo "GATE FAILED: $step (exit $status); full output in $GATE_LOG"
    exit "$status"
  fi
done
echo "GATE GREEN"
