# Handoff

Current operational pointers; delivered scope is in [status](status.md), and the
tracker is the queue. Keep checkpoint narratives in feature evidence or dated
reviews. Do not append old test counts here as if they describe the latest tree.

## Source, releases and deployment (October 18)

### Integrated main and served versions

- Main is at **`8542c81`** (October 18). The AoE2DE binary-audit learnings
  program landed through PRs #335–#343, each behind a green owned checkpoint and
  green CI: the local checksum-mismatch receipt (#332), the formation-slots
  measured no-adopt evaluation (#333), shift-queue regression tests and
  Shift-queued building placement (#290), the native-machinery decompile notes,
  the 90 s relic-journey test timeout, and the public deploy pipeline.
- **Household host** (Ysgramor) serves `.local/releases/autonomous-20261018-364824c`
  (source `364824c`, protocol 10, fingerprint `163697cb…`, recorded in
  [shared-play](shared-play.md)); the previous release remains for rollback.
- **Public client** is deployed automatically from GitHub Actions:
  `empires.gszep.com` serves revision `empires-00004-knw` from main. The
  workflow (`.github/workflows/deploy.yml`) authenticates via Workload Identity
  Federation scoped to this repository — no stored secrets, no human account —
  and gates on `verify:full` plus `deploy/gcp.sh`'s public-only boundary check.
  Failed deploys never dark the site; watch runs with
  `gh run list --workflow=deploy.yml`.

### Environment facts you will hit immediately

- **Owned checks require the 185872 source facade on Artemis** (#334): the local
  SteamCMD depot content is still the pre-repin build, so `npm run verify:owned`
  without `AOE2DE_DEPOT_ROOT=~/.local/share/aoe2de-185872-facade` fails 23
  import-consistency assertions. The facade symlinks the six depots at
  Artemis's Steam client install (build 25464371, the pinned reference). Until
  #334 lands a permanent resolution, export the variable wherever owned checks
  run on Artemis; Ysgramor's own depot tree remains valid there.
- gcloud on Artemis: `contact@gszep.com` was re-authenticated October 18 into
  the private `empires-deploy` config only; the human `default` config is
  unchanged. Actions deploys do not use this login at all.

## What the decompilation rounds produced, and how to use them

### Committed, durable evidence (read these first)

- [aoe2de-binary-learnings.md](aoe2de-binary-learnings.md) — the behavioral
  comparison: what the native audit showed, what we deliberately retain
  (plain-data rules/instance split, single-runtime architecture), and the
  candidate gaps with their evidence limits.
- [aoe2de-native-machinery-notes.md](aoe2de-native-machinery-notes.md) — prose
  analysis of the 11 priority decompiles (ActionObject::stop cluster,
  UnitAIModule teardown, task-bounds guards, PeriodicTask, cheat handler,
  scenario list, name tables, xDS assertion), including which decompiles were
  too poor to analyze and why.
- [formation-slots-evaluation.md](formation-slots-evaluation.md) — the measured
  **no-adopt** decision on formation slots (0.60–1.08 tile arrival radii at seed
  42 across 9/12/25-unit, mixed-radii, reverse and long-distance groups). Do not
  re-open formation slots without new native measurements (#311) first; the
  harness `tools/formation_slots_eval.mts` stays for re-measurement.

### Private raw evidence (Artemis only, never committed)

`/home/gszep/Documents/repos/age-of-empires/.local/worktrees/rea-audit-20261014/.local/rea-audit/`:
full objdump disassembly of all 24 binaries (`disasm/*.asm`, ~1.3 GB),
both-build string xref corpora (`disasm/big-xrefs*.json`, 1,866+1,919
referenced strings with function attribution), the `.pdata` function-table diff,
string-set build diffs, the recovered source-tree inventory (330 files:
`Aoc/Source/Game/{ai,objects,World,Comm,XS}`, RelicLink `Worldwide*`, XAL,
WPFG), `learnings-brief.md`, and the 11 priority pseudocode functions
(`ghidra/targeted-decompiles.c`, 5,238 lines). Behavioral facts only; never copy
pseudocode or disassembly into the repository.

### Leverage points worth acting on

- **Shared contract naming (#315)**: native diagnostics name the real contract —
  `ActionAttack::setState`, `ActionGather::update: state=%d (%s), timer=%f`,
  `ActionObject::stop (state, worldTime)`, `UnitAIModule`, task-bounds guards,
  `PeriodicTask`, `GiveResourceTaskProcessor`. Adopt vocabulary where it
  reduces confusion; ours stays authoritative where it is clearer.
- **Formation vocabulary**: column/line categories, widest line,
  per-slot offset/depth, `AttackPlanType`, locked types — useful for any future
  group-movement work after #311 native capture, per the no-adopt decision.
- **Desync telemetry**: native settings strings (`DesyncTrackingEnabled`,
  `DesyncUploadsWanted`, `SimulationFps`) motivated the #332 receipt; further
  desync diagnostics should build on that receipt rather than new formats.
- **Cheats**: a native `CheatCode` machinery cluster with classic strings is
  compiled into the exe (machinery notes §cheat handler). A bounded, playful
  slice if ever prioritized; keep it gated like `CheatsEnabled`.
- **UI strings** worth mining for shared-play polish: `RightClickGarrisonDropdown`,
  `MinimapFilter*`, `BattleFormations`, minimap player stats.
- **Do not re-litigate the no-adopts**: formation slots (measured), TLS/lock-free
  machinery (unsuitable by design), binary-verbatim class hierarchies
  (our JSON-serializable entities are deliberate).

### Reproducing decompiles cheaply (the hard-won method)

Full-binary auto-analysis of the 71 MB exe is all-or-nothing: ~13 CPU-hours were
lost across seven attempts before the working method landed. Use the targeted
path instead: Ghidra headless with `-noanalysis` + a postScript that creates
each function from its `.pdata` RUNTIME_FUNCTION start and decompiles it —
11 functions in ~10 minutes. The scripts (`DisableSlowAnalyzers`,
`DumpAnalyzerOptions`, `TargetedDecompiles`) live in the audit worktree's
`ghidra/direct-scripts/`; Ghidra projects must live in dot-free paths. If you
must run full analysis: disable "Decompiler Parameter ID"/"Decompiler Switch
Analysis" first, supervise under systemd (session-attached shells die with
server restarts), and verify configuration with the options-dump before
committing hours.

## Standing follow-ups

- #334: make `tools/depot.py` consider the installed-copy facade, or refresh
  the SteamCMD content, so owned checks are not env-dependent.
- #290: confirm Shift-queued placement in play and close, or name the actual
  failing interaction.
- Deploy-gate consolidation: the deploy workflow re-runs `verify:full` although
  the same commit's CI already did; gating on that result brings deploys from
  ~13–18 min toward ~7 and CI/build near the 10-minute target.
- The post-batch safe-point compression round is due (seven PRs landed
  October 18).
- The improvement queue after that is the tracker's: Inca follow-ups (#321,
  #322), in-game chat (#318), the smallest two-human co-op scenario (#316),
  and the #333-recommended movement mechanics (slowest-member speed limiting,
  garrison-position preservation) behind replay-compat gates.
