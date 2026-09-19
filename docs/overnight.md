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

## During the run

- **One item at a time, in the tracker's order**: bugs, then decisions the
  human has answered, then enhancements. An item is done only when its own
  check passes and `tools/gate.sh` is green; then commit and push before the
  next. If it cannot be finished, revert to the last green state, say why on
  the issue, and move on — a half-shipped feature is worse than an honest gap.
- **The clock is `date`, not memory.** Run it before every progress note. A
  run once wrapped up at dawn believing it was mid-afternoon because it had
  narrated the time for five hours.
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
- **The morning report is generated, not recalled**: commits from
  `git rev-list --count <start>..HEAD`, issues from `gh`, and a section
  headed *not verified* listing every claim the run could not check, every
  approximation it introduced, and every fixture clock it widened. Counts
  recalled from memory were wrong in four of the last five reports.
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
- **The open fallback's Imperial Age** (#125) — undecided whether the
  fallback grows a third age or stays a demonstration.
