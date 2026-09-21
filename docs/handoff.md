# Agent handoff — 2026-09-21 autonomous run

## Mandate and stopping point

The human authorized about three hours of autonomous work, starting with **#83**
and then logical tracker issues. The run started at **17:50 BST**, with a target
stop of **20:50 BST**, from `da0f977`. Each completed implementation is gated,
committed and pushed separately. The earlier worker/naval checkpoint is
`3af7bc1`; its scope and evidence remain in `docs/status.md` and its issue threads.

## Delivered this run

- **#83 — group arrival:** compact two-dimensional separation replaces the
  axis-only overlap tie-break that trapped arriving units in a long line.
  This is collision correction, not selectable DE formations.
- **#157/#158 — shared-host restart loop:** incompatible rules/version or
  malformed checkpoint JSON exits with non-retryable status 78. The installed
  service preserves the checkpoint and bounds transient retries. A real
  transient-service probe recovered on its second attempt.
- **#155 — session-start accuracy:** managed service state and restart count
  are reported even without a live process. The gate records its actual named
  output log and result in `.local/gate.latest.json`.
- **#85 — herd food:** AI shares one animal target, observes edible carcasses,
  and automatically continues onto an already selected next animal. Imported
  DAT rates spoil sheep/deer at 0.25 food/s and boar at 0.4, even unattended.
- **#86 — AI Feudal buildings:** reserve wood for the range/blacksmith against
  extra camps/farms and archer purchases, preserving urgent housing and initial
  food/drop-off infrastructure. Imported seeds 1/7 now complete blacksmiths;
  seed 42 builds a range and wins before its smith. Broader stable/market/Castle
  building and unit policies remain **#124**.
- **#120 — corpse resight:** implementation, dedicated browser check and final
  full gate pass. The simulation's
  existing corpse countdown supplies death age across view recreation and JSON
  reload; no new state timestamp is needed.

## Verification

Read `.local/gate.latest.json` and `tools/session_start.sh` for the latest run.
Completed gates: `.local/issue83-gate-r2.log`,
`.local/issues157-158-155-gate-r3.log`, `.local/issue85-gate-r2.log`, and
`.local/issue86-gate.log`, and **`.local/issue120-gate.log`**. The final gate has
**624 Vitest tests** and **84 Python/import tests**, plus typecheck/build and
real-browser debug smoke; `.local/issue120-gate.exit` is **0**.

All dedicated checks below passed in private real-browser fixtures:

| Command (`npx tsx tools/<script>`) | Evidence |
|---|---|
| `group_movement_smoke.mts` | 25-unit right-click; 2.186×2.083-tile arrival footprint, radius 1.160 |
| `shared_smoke.mts` | Two-browser adoption, training, synchronization, reload/reconnect and saved-match restart |
| `herd_food_smoke.mts` | One AI sheep killed; unattended corpse loses five food in twenty game seconds; selection/HUD shows 95 |
| `ai_buildings_smoke.mts` | AI starts with 125 wood, gathers enough, finishes a blacksmith by tick 2672, rendered/selectable |
| `corpse_resight_smoke.mts` | Saved corpse draws decay; scout leaves, old view is removed, scout returns to decay rather than death |

The full owned import completed in `.local/issue85-import.log`, reusing **2,781
atlases** and publishing food-decay metadata. Reload tester pages after imports.
No decoder changes or new full atlas rebuild were needed.

Six-worker gates hit existing full-match wall-clock timeouts. Three workers
passed the shared-host gate; subsequent gates use
`VITEST_MAX_FORKS=1 VITEST_MAX_THREADS=1 tools/gate.sh`. **No fixture timeouts
were widened.** Existing gathering-rate fixtures explicitly disable spoilage
to isolate collection/capacity; new tests measure both food sinks together.

## Operational state and recovery

- Workspace `/home/fraser/repos/age-of-empires`, branch `main`. The old
  uncommitted `AGENTS.md` rewrite was revised, committed and pushed as `da0f977`
  with the human's approval before this run.
- Ysgramor's `open-empires-shared.service` is **failed/78**, with **NRestarts=9**
  unchanged after verification. It is no longer retrying. The checkpoint SHA-256
  stayed `25cce32d50c6e76b96d3f290aa2ae774d3ea38d1d5474f7ef2d621a37fc236db`.
- Preserve `.local/shared-match.json`, earlier saved checkpoints, browser saves
  and Tailscale routes. Restore matching rules/version or obtain agreement to
  retain the old save and start a new match; see `docs/shared-play.md`.
- The configured household URLs on port 5173 require recovery of the host.
  Verification used private ports. Artemis installation/rollout and hardware-GPU
  acceptance were not performed; its local gateway remains a separate machine.
- Ubuntu is under `D:\WSL\Ubuntu`; Linux repo/depot paths are unchanged. Prior
  WSL crash evidence remains local-only in `.local/wsl-crashes/`. Its cause is
  unproven; do not equate storage pressure, machine-check reports and the now-fixed
  service loop. Asset duplication/eviction remains **#152**.

## Contract, approximations and remaining evidence

Observation **v4** adds own-only `gatherTargetId` and visible edible carcasses
with zero HP/remaining food. Earlier own-only `buildTargetId`, naval kinds and
unload commands remain. Match configuration/result/recording formats stay v1.

`docs/ledger.md` records the chosen collision-normal perturbation, integer food
spoilage accounting and herd/Feudal-building strategy policies. These are not
claims of complete DE formation or AI equivalence.

The historical `tools/probes/pathing.ts` first “open ground” case failed on the
current generated board (seed 200, 4000 ticks, no arrival). Its hard-coded open
ground precondition needs validation; evidence was added to **#5**. The remaining
gap/courtyard checks passed and the ten-minute match had zero stuck ticks.
The corpse visual fix does not address water/shore fidelity (#148/#113) or the
blocked monk-outline decoder (#119).

Start the next session with `tools/session_start.sh`, then read the tracker,
`docs/lessons.md` and the relevant issue comments. Preserve unfamiliar work;
use handled background jobs, run the full gate before code commits and push
each checkpoint. Never commit owned content, saved matches or crash dumps.
