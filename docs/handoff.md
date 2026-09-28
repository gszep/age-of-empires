# Handoff — civilisation run checkpoint, 2026-09-28

## Current checkpoint

- Branch `main`. Autonomous run authorised through **2026-09-29T16:57:14Z**;
  started2026-09-28T20:57:14Z from60d37b4. Order: Franks, Goths, Teutons,
  Japanese, Chinese, Byzantines, Persians, Saracens, Turks, Vikings, Mongols,
  Celts; only then non-civilisation issues. Fix inhibiting bugs along the way,
  verify/gate/commit/push each checkpoint. Scope answers are recorded on#180.
- Franks completion pushed as**a770809**; #180 closed with evidence. Gothic
  completion is the current verified checkpoint; **Teutons#182 is next**.
- Latest full gate **GREEN**, `.local/goths-gate-r2.log`, exit0:
  **1076 Vitest tests /88 files**,7 inapplicable Gothic stone/tower tests skipped,
  build, **156 Python/owned-content tests**, real-browser debug smoke. Dedicated
  published Goth browser acceptance also passes (`.local/goths-browser.log`).
  Three workers, unchanged timeouts. Only Markdown changed after gate start.
- Gothic additions include secondary producer slots/hotkeys, gated fast Loom,
  hunting yield, population ceilings, Dromon and Incendiaries. New reference gaps
  are#252/#253; [coverage](civilization-coverage.md) and ledger distinguish source
  values from integration inferences. The first gate's availability regression
  was fixed and measured, not hidden by increasing a timeout.

## Play and deployment

- Solo desktop: <http://localhost:5173/?solo=1>
- Tailnet solo: <https://ysgramor.tail6e864b.ts.net:5173/?solo=1>
- Natural Islands opening: <http://localhost:5173/?solo=1&map=islands&seed=3>
- **#241 remains blocked:** the managed host speaks protocol1 while current
  clients expect protocol2. Preserve its live state and routes. Do not restart
  or join it as a diagnostic substitute for a verified state-preserving migration.
  See [shared-reference-audit.md](shared-reference-audit.md).
- The managed service remains active, MainPID631 / Node1201, NRestarts0. Tests
  use private Vite/browser instances and leave no private test service running.
- Observation **v8**, shared wire **v2**, recordings/results **v2**, dev snapshots
  **v3**. The nested `garrisoned` count is a correction to the existing private
  owner field, not a new field or an enemy-information channel.

## Completed interactive work

| Issue | Outcome | Main evidence |
| --- | --- | --- |
| #119 | Owner recovered clean pinned x1 monk files and copied them into the default depot. Both hashes verified,569/569 base sources pass, full isolated x1 import has no skipped masks, idle/attack contours pass. | [source-integrity.md](source-integrity.md), `.local/monk119-gate.log` |
| #55 | Owned terrain-unit rows and seven non-blocking plant types imported; deterministic view-only placement, fog and foundation coverage. | `terrain_scatter_smoke.mts`, `.local/scatter55-gate.log`; density calibration #249 |
| #250 | Fixed omitted owned plant shadows, matching body variant/scale/hotspot and owned shadow profile. Browser A/B isolates5885 darkened sRGB pixels. | `.local/scatter250-browser.log`, `.local/scatter250-gate.log`; full post-processing remains #149 |
| #70 | Verified existing resource-feedback behaviour and closed stale body request. Owned/fallback real clicks show warnings without state mutation; population queue check passes. | `resource_feedback_smoke.mts`, `.local/issue70-*-browser*.log` |
| #126 | Verified existing age HP/armour and deterministic continuation. Both browser profiles display wounded house733/750 →883/900 after real Castle Age research. | `.local/issue126-browser.log`,18 building tests plus owned replacement test |
| #90 | Replaced ineffective array reassignment with live spacing masks. Five new regressions and before/after browser layout checks. | `.local/map90-gate-r2.log`, `map_spacing_smoke.mts` |
| #156 | Explicit abandoned-farm capture on starting work; global order reservation, preserved crop/HP, new-owner income/reseed cost. Automatic gathering retains own-farm policy. | `.local/farm156-gate-r2.log`, `farm_occupancy_smoke.mts` with `ENEMY_FARM=1` |
| #136 | User clarified AI sheep return to TC, not automatic discoverer-following. AI uses public moves and waits before live dinner selection. | `.local/herd136-gate.log`, `ai-herding.test.ts`, `herd_food_smoke.mts` |
| #60 | Completed remaining English manual audit; page-level findings, hashes and legacy/current boundaries recorded. Found and filed #251. | [manual-audit.md](manual-audit.md),2 extraction tests |
| #251 | Counts incoming and existing nested cargo; exact fits, arrival races, legacy saves, conversion capacity, unload/sinking/JSON and private observation coverage. Both browser modes verify clicks,20/20 HUD and reload. | `.local/transport251-{owned,fallback}-browser.log`,14 new outcome tests and latest full gate |
| #142 | Recorded historical genie-rms reads/licence check/originality declaration from original traces, with explicit revision-pin limits. | [genie-rms-provenance.md](genie-rms-provenance.md) |
| #56 | Owned guide is primary; land defaults corrected to8, terrain20 retained. Four regressions, twelve before/after map hash cases and six browser cases pass. | `mapgen-defaults.test.ts`, `.local/rms56-gate.log`, contract audit in `map-generation-design.md` |

The original 2026-09-27 audio/options/AI-fishing checkpoints are already pushed;
their detailed sources and boundaries remain in `docs/status.md`,
[audio-reference.md](audio-reference.md), [ai-fishing.md](ai-fishing.md) and the
ledger. The27-track natural music cycle and39-minute five-map endurance receipts
remain `.local/music115-soak-r2.log` and `.local/audio-run-soak-r2.log`.

## Important measurements and boundaries

- **AI herding:** canonical player2 AI versus passive player1,240 game seconds,
  current generator and main-loop decision cadence, seeds1/7/42. Owned positive
  food deposits120/130/90 →200/310/200; fallback120/120/80 →180/240/190. Stockpiles
  after spending are a different metric. `herding:false` reproduces the old
  baseline exactly; `.local/herd136-{baseline,control,after}.log`. The2.5-tile
  staging tolerance is chosen strategy. Simulator/human sheep control is unchanged.
- **Spacing:** Arabia/Islands generated layouts change; checked Black Forest
  seeds3/7 keep identical hashes. Existing saved boards are not regenerated;
  older seed-based replays may diverge. The failed first gate exposed a navigation
  fixture targeting a new pond; the fixture is now explicitly dry without
  weakening arrival/collision assertions or time limits.
- **Farm capture:** the first gate exposed unintended automatic mill capture.
  The implementation was corrected to preserve that existing regression; only
  an explicit foreign target permits capture. Source permission is owned26149;
  precise capture/reservation/retained-stat semantics are documented integration
  choices, not a native runtime calibration.
- **Transport capacity:** legacy TC Manual p8/PDF10 counts ram passengers too.
  The audit reproduced26 entities in a capacity20 ship. The fix preserves all
  old cargo, prevents more boarding when over capacity and uses the carrier's
  current/stored capacity. Existing landing/conversion exceptions remain inferred.
- **Owned files:** the default monk sources are repaired. Owner-preserved
  `.sld.damaged` backups and ignored recovery evidence/worktree remain. No owned
  bytes, converted graphics, credentials, saves or `.local/` outputs belong in Git.

## Remaining work

- **#161:** implementation already existed and71 focused tests plus both browser
  profiles pass. Public references corroborate +.05 speed/+10 building attack per
  infantry; pinned native numeric calibration remains open. The issue was corrected
  rather than falsely closed. See [specialist contract](civ-specialists-integration.md).
- **#113/#149/#249:** terrain/water fidelity, native compositor/grade/bloom/AA,
  and exact terrain-plant density/masked placement remain unverified.
- **#110:** wonder countdown is approved; exact map-size timer defaults and
  clock units remain unresolved. Settings are implemented, not a blocker now.
- **#243/#244:** remaining audio mixing/spatial calibration and missing complete
  MUSIC17/27/30 streams. **#246:** battlefield colour-blind transform remains;
  interface palettes work. A Windows inspection script was denied by execution
  policy; no bypass was attempted.
- **#54/#131/#178/#128/#139:** the manual audit attached concrete source findings
  for remaining command/garrison edges, siege auto-fire friendly risk, conversion,
  trade and scoring. Legacy prose does not supply exact elevation multipliers or
  a trade-profit formula and does not override current DAT values.
- Remaining RMS phase/quota/terrain-height fidelity is documented in the #56
  contract audit and tracked with #130/#134; this is not a full native generator.

Britons/Franks/Goths are the enabled profiles. Gothic art/UI/audio and rules were
regenerated through the full pipeline (`.local/goths-enabled-import.log`). Fresh
installations need `npm run import:aoe2` for that content. Never overwrite the
preserved managed match.
