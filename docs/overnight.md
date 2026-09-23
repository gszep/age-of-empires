# Overnight run checklist

The standing rules for an autonomous run. **The queue itself is the issue
tracker** — `tools/session_start.sh` prints it, bugs first — and nothing in
this file names an open item, because a list written here was wrong within a
day every time it was tried (`docs/reviews/2026-09-19.md`, §7). History lives
in `git log` and `docs/status.md`.

## Before the run

1. `git pull`, then `tools/session_start.sh`. It says whether the manifest is
   stale (re-run `tools/import_aoe2.sh` if so — about three minutes with a
   warm atlas cache, an hour if a decoder file changed), what is running, and
   what the gate last said.
2. Read `AGENTS.md` and `docs/lessons.md`. The lessons are grouped by the
   moment they apply; read the group before you reach that moment, not after.
3. **Ask the human before starting.** Every overnight run that opened with
   numbered questions and got numbered answers delivered its whole list with
   nothing reverted; the ones that did not, stopped early or ran the wrong
   item. Paste the answers into the run's first commit message or the issue
   thread, and confirm the stopping rule below.
4. **Verify unattended permissions before promising readiness.** For OpenCode,
   run `tools/session_start.sh --unattended` (or
   `node tools/unattended_preflight.mjs` on its own). It checks the installed binary's
   merged `build` permissions, the resolved owned depot, and noninteractive
   GitHub/repository access. Any remaining approval rule fails preflight.
   `opencode.jsonc` permits the known depot paths and returns errors instead of
   prompting for unknown external paths, secret-file reads or repeated calls.
   Resolve the depot with `uv run --locked python tools/depot.py`; never guess
   a Steam directory and start an external search there.
5. **Configuration on disk is not the running session.** After permission edits,
   restart OpenCode (or recreate/restart its hosting server/session) and use
   the `build` agent. Before the clock starts, use the actual Read tool on the
   `dropsites.json` path printed by preflight, and verify a scratch edit and a
   shell command in that session. Resolve any approvals while the human is
   still present. Check selected-provider authentication too; the CLI permission
   probe deliberately makes no model calls. Do not claim an eight-hour run is
   ready based on project instructions or `gh auth status` alone.

## During the run

- **One item at a time, in the tracker's order**: bugs, then decisions the
  human has answered, then enhancements. An item is done only when its own
  check passes and `tools/gate.sh` is green; then commit and push before the
  next. If it cannot be finished, revert to the last green state, say why on
  the issue, and move on — a half-shipped feature is worse than an honest gap.
- **The clock is `date`, not memory.** Run it before every progress note;
  `tools/hooks/clock.sh` also prints the time every twenty-five tool calls.
  A run once wrapped up at dawn believing it was mid-afternoon because it
  had narrated the time for five hours.
- **An unavailable action is a blocker, not a request to wait.** Record it and
  move to another eligible item during an unattended run. Do not retry denied
  actions through another tool. Check the deadline immediately after a long
  tool return; an approval wait consumes the real run window too.
- **When the queue empties early, keep going down the tracker** (the human's
  rule, 2026-09-19). A run stops at the deadline the human gave, not when the
  work looks done.
- **Decoder items first and alone.** Anything touching `tools/sld_layers.py`
  or the `convert`/`convert_mask` functions in `convert_sld.py` costs an
  hour's re-decode; start it before anything else and do not overlap it.
- **Concurrent items go in worktrees**, never in one tree. The last time six
  features shared a tree during an import, splitting them into commits took
  two and a half hours and three tries.
- **Tuning has a budget.** Two batches without movement means the variable
  is wrong: instrument the state over time, do not try a third value. Ship
  the best measured configuration and record the curve.
- **A fixture clock widened to keep a test green is a finding**, not a fix:
  name it in the morning report every time.
- **Verification reaches the layer the player uses.** A rules-table test is
  not a damage test; a sim test is not a button test; a picture cannot
  overrule a failing number (`AGENTS.md`, verification).
- Reference behaviour you do not have a file for is *inferred*: write it in
  the ledger as such, never as fact.

## After the run

- **Hygiene pass, last of all**: list what is running by the process table,
  not by memory; kill the litter; name what deliberately survives.
- **The morning report is generated, not recalled**:
  `tools/morning_report.sh <start-commit> [since-ISO-time]` prints the commits, the issues
  closed and opened, the gate, the ledger rows added and a *not verified*
  section to fill in by hand — every claim the run could not check, every
  approximation, every fixture clock widened. Pass the recorded run-start time
  when it differs from the start commit's timestamp. Counts recalled from memory
  were wrong in four of the last five reports.
- Update `docs/lessons.md` (rules, grouped by trigger, only if the tracker
  cannot hold it) and `docs/status.md` (what shipped and its evidence), and
  prune both — a hand-off that only appends is the failure mode.

## Deliberately not started

Named here so a run does not re-derive the reason; each has an issue.

- **Civilisation bonuses** (#123) — ruled out of the tech-tree work by the
  human; they are civ-specific effect commands, not tree nodes.
- **The monk's occlusion contour** (#119) — its outline layers fail the
  decoder's walk invariant; guessing would undo what makes the decoder
  trustworthy.
- **Relics** (#130) and **the wonder's victory** (#110) — mechanics the
  human has not asked for; a relic today would be invisible scenery.
