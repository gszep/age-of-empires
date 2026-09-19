#!/usr/bin/env bash
# The quality gate, with each step's own exit status intact.
#
# Two ways to lose that status, both met the hard way. Piping a step to `tail`
# hands `&&` the status of `tail`, which is always 0. And reading PIPESTATUS
# after an `if ! ...; then :; fi` reads the `:`, not the pipeline -- so the
# failure case, the only one that matters, reported success. Run the pipeline
# plainly and read PIPESTATUS on the very next line.
#
# Four steps: the unit tests, the build, the import tests, and the browser
# smoke (a private dev server, headless Chrome, the player's own clicks and
# keys read back through /__debug -- the layer `src/main.ts` lives in and no
# unit test reaches). On GREEN it writes `.local/gate.ok`, stamped with the
# time the gate *started*, so a file edited while it ran counts as untested;
# `tools/hooks/guard_commit.sh` refuses a commit whose changes are newer.
set -uo pipefail
# Repo root first: the log path below is relative to it.
cd "$(dirname "$0")/.."
GATE_LOG="${GATE_LOG:-.local/gate-step.log}"
mkdir -p "$(dirname "$GATE_LOG")"
rm -f .local/gate.ok
touch .local/gate.started
skipped_note=""
for step in "npm test" "npm run build" "npm run test:import" "npm run debug:smoke"; do
  echo "=== $step ==="
  $step > "$GATE_LOG" 2>&1
  status=$?
  tail -"${GATE_TAIL:-8}" "$GATE_LOG"
  if [ "$status" -ne 0 ]; then
    echo "GATE FAILED: $step (exit $status); full output in $GATE_LOG"
    exit "$status"
  fi
  # A fidelity test that did not run is not a fidelity test that passed
  # (issue #104): count the skips, and refuse a vacuous import suite on a
  # machine that has the owned content.
  case "$step" in
    "npm test")
      n=$(grep -oE '[0-9]+ skipped' "$GATE_LOG" | tail -1 | grep -oE '^[0-9]+' || true)
      [ -n "$n" ] && skipped_note="$skipped_note vitest:$n";;
    "npm run test:import")
      ran=$(grep -oE 'Ran [0-9]+ tests?' "$GATE_LOG" | tail -1 | grep -oE '[0-9]+' || true)
      n=$(grep -oE 'skipped=[0-9]+' "$GATE_LOG" | tail -1 | grep -oE '[0-9]+' || true)
      [ -n "$n" ] && skipped_note="$skipped_note import:$n"
      if [ "${ran:-0}" -eq 0 ] && [ -f public/imported/aoe2/manifest.json ]; then
        echo "GATE FAILED: the import suite ran 0 tests although the manifest exists; check tools/test_import_aoe2.py's DAT path"
        exit 1
      fi;;
  esac
done
if [ -n "$skipped_note" ]; then
  echo "skipped (not run, not passed):$skipped_note -- with the owned content only the opt-in live-agent test should skip"
fi
touch -r .local/gate.started .local/gate.ok
echo "GATE GREEN"
