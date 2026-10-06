# Native siege targeting (#131)

2026-10-06, **current installed build185872, not pinned48987**, accepted by the
owner for this calibration. Observed visually in single-player editor Tests;
PID22012 throughout. Fullscreen2560×1440, existing UHD-unchecked settings left
unchanged, Casual1.5. P1 Teutons/Imperial; P2 Teutons/Dark, personality None
(native unit reactions still operate). No cheats, triggers, research, multiplayer,
restart or deployment. No scenario saved. Final game state: main menu.

## Observation table

Captures/JSON action receipts are durable, ignored local evidence under
`/home/fraser/repos/age-of-empires/.local/worktrees/issue-131-siege-targeting/.local/native/`.
Names below have `.png` suffixes; each has a matching `.json` receipt.

| Question | Observed answer | Capture/control | Runtime comparison |
| --- | --- | --- | --- |
| Idle packed trebuchet auto-unpacks/fires at a visible building in range? | **No** | `siege-packed-paused`: still packed at01:01; `siege-house-before`: house550/550. Only Unpack was then clicked; same house fell to0/550 in `siege-house-damage` at01:30. | **Disagreement fixed:** packed idle acquisition is now excluded. |
| Idle unpacked trebuchet auto-fires at that building? | **Yes** | `siege-unpack-order`, `siege-unpack-result`, `siege-house-damage`; no attack order issued. Same geometry gives the packed test a positive range/visibility control. | Agrees. |
| Idle unpacked trebuchet auto-targets a unit? | **No, for this villager** | `siege-unit-idle`: visible enemy villager25/25 at01:11, engine deployed. Explicit right-click subsequently killed that villager (`siege-unit-explicit`, `siege-unit-control` at01:36, corpse visible). | Agrees with building-only automatic selection. Not every unit class/retaliation tested. |
| Building versus nearer unit, both in range? | **Building selected** | `siege-priority-place` shows both targets; `siege-priority-result`: farther house reduced to rubble at00:52 while nearer villager remains standing; `siege-priority-unit` reads25/25. No target order, only Unpack. | Agrees. No building/building tie-break established. |
| Auto-repack with no eligible target for a while? | **No during measured interval** | House rubble and deployed engine at03:02 (`siege-empty-start`), still deployed at04:41 (`siege-empty-end`):99game seconds. | Agrees; not proof of an infinite timeout. |
| Mangonel holds automatic fire into adjacent friendly/enemy melee? | **Yes in ram fixture** | `siege-blast-shooter`, `siege-blast-enemy-before`, `siege-blast-own-before`: rams fight, enemy40/175, own52/175 at00:16; no shot in sampled pulses. Delete own ram while paused (`siege-blast-remove-friendly`); enemy dies by00:28 (`siege-blast-safe-end`) without a shooter order. | Supports#278; no change. |
| Onager same qualitative avoidance? | **Yes in same fixture** | `siege-onager-hold`, `siege-onager-enemy`, `siege-onager-own`: enemy40/175 at00:12, own ram adjacent. Delete friendly ram (`siege-onager-remove`); enemy dead at00:24 (`siege-onager-safe-end`), shooter visibly discharged. | Supports#278; no change. |

The catapult fixture is actual ram-on-ram melee, not a frozen HP test. Enemy
175→40 and friendly175→52 are consistent with three opposing ram strikes;
damage during the hold interval is not attributed to catapult splash. Both
engines remained idle until removal of the friendly obstruction. The positive
post-removal kill controls establish range/visibility and automatic fire, not
an exact search delay or projectile trajectory. These are sampled stills, not
a continuous frame-by-frame firing trace; precise blast-boundary claims would
require a stronger fixture. No contradictory result justifies changing#278.

Readback crops `siege-review-panels`, `siege-review-readbacks` and
`siege-review-world` preserve legible HP/clocks and target bodies from these
full captures. In particular, the priority house is rubble, not a selected
damaged-house HP panel; the Dark-Age enemy villager has25HP, not40.

## Reproduction and limits

Use the worktree's `source .local/native/macro.sh` and `RECIPES.md`. All placement
coordinates below are real2560×1440 pixels, not preview pixels or world tiles.
Set both civilizations explicitly; `siege-p2` verifies personality None and
`siege-p2-civ` the selected civilization. Start with custom victory/no conditions.

- Initial packed trebuchet: Units search Trebuchet, packed row285, P1 at1280,700.
  Keep P1 villager700,1000 and P2 villager2200,1000 to avoid early defeat.
  P2 House at1750,700; Test selects trebuchet1280,680 and house1710,690.
  Button50,1250 is Unpack. Let it idle first, then click only that button.
- Unit-only Test: delete the house, place P2 villager1710,700, same engine.
  After idle observation, explicit right-click is the positive attack control.
- Priority Test: retain nearer villager, add P2 house1900,700. New Test restores
  packed engine; click Unpack only. House selects1900,665.
- Catapults: delete engine, near villager and house; place P1 Mangonel1280,700,
  P2 Battering Ram1650,700, P1 Battering Ram1650,750. Search Mangonel or Onager
  row200. Test recenters on the spare villager: shooter1860,395, enemy2230,380,
  friend2235,445. Inspect actual names/owners, pause for readbacks, select own
  ram then Delete, resume. Repeat with Onager in the same editor placement.
- `siege-final-main-menu` verifies return to main menu and build185872; receipt
  retains PID22012 and window rectangle. Graphics settings were not changed.

No exact tile distances were inferred from editor pixels. No stance matrix,
retaliation, outside-range pursuit, hidden-target native control, allied-player
blast risk, moving-friendly prediction, Siege Onager, scatter/interception,
override behavior or retarget cadence was measured. Those#131 questions remain
open. This does not recalibrate packing duration;#259's50/4.5 baseline and
Kataparuto50/18 remain unchanged. No claim of pinned-build parity.

## Correction and verification

Cause: `acquireAutomaticTarget` admitted packed engines using deployed attacks
unless a previous manual Pack set a suppression marker. DAT automatic-search
flags were overinterpreted as idle deployment. New matches now exclude packed
engines from idle acquisition. Explicit attack approach/setup, manual Unpack,
deployed building fire and the example AI's explicit orders remain intact.
Existing saved-state fields are retained; the review correction below selects
legacy behavior for old recordings/snapshots rather than retrofitting them.

Regression coverage uses public Stop/Unpack/attack commands and actual HP loss.
Existing setup-clock, negative targeting, visibility, move cancellation, manual
Pack, JSON continuation and Kataparuto assertions remain covered. The browser
acceptance now checks packed idle followed by clicking Unpack and automatic
damage, retaining paid train/right-click/move/group controls and sprite checks.
The sight/move fixture now starts deployed so its sight assertion still tests
acquisition rather than the new packed guard. Its old100-tick movement sample
is replaced with the existing bounded2000-tick outcome helper to allow the
required222-tick packing cycle before travel; no test timeout was widened.

- Before runtime fix: `npx vitest run src/sim/trebuchet.test.ts --maxWorkers=1`
  failed exactly the new packed-idle check (`expected true to be falsy`);
  16passed/1failed/1owned skip,3.90s. Log `.local/siege-before.log`.
- `npx vitest run src/sim/trebuchet.test.ts src/sim/siege-safety.test.ts src/sim/ai-siege.test.ts --maxWorkers=1`:
  **37passed/7owned skips**,10.27s; `.local/siege-tests.log`.
- Same command with
  `CIV_PROFILE_CONTENT=/home/fraser/repos/age-of-empires/public/imported/aoe2/manifest.json`:
  **77passed, no skips**,30.37s; `.local/siege-owned-tests.log`. Existing manifest
  read only; no regeneration/import or owned checkpoint was run.
- `npx tsc --noEmit -p .`: **exit0**; `.local/siege-tsc.log`.
- `OPEN_FALLBACK=1 npx tsx tools/trebuchet_smoke.mts`: **exit0**, all three
  control groups GREEN; `.local/siege-open-smoke.log`. Private Vite5274 and
  browser closed normally. Owned browser acceptance not run in this worktree.

Initial worktree was clean at1c316d8; no cheap-worker partial diff, attempted
patch or failing-check artifacts were supplied. Work left uncommitted for the
coordinator's integration/checkpoint slot. No push, service restart or deployment.

## Replay compatibility review correction

The first guard applied to old states as well as new matches. That was a replay
regression. Recordingv8, the optional `trebuchetTargetingVersion:1` state marker,
and a pre-v8 replay adapter now distinguish the two policies, following#259/#242.
Versionless policy in a JSON snapshot means legacy suppression-aware automatic
deployment, not an invitation to migrate. Manual Pack still suppresses legacy
acquisition until Stop clears it. Current Stop leaves engines packed. Shared
snapshot/rejoin preserves both policies; shared restart creates a current match.

Per coordinator request, `git fetch && git merge origin/main` first reported
already up to date at1c316d8. No native game input, capture, restart or settings
change occurred during this correction.

The frozen v7 recording was generated with an untouched `git archive 1c316d8`
under `/tmp/opencode/issue-131-pre-change-v7`, with independently installed
dependencies. Its `src/sim/game.ts` SHA256 matched the Git blob
(`3d78d0e885458eed91cb74f301f6476d0245f185d76b01669c9804c9a232c211`).
Only the test rules factory and generator were added there; no engine source
was patched. That engine generated and independently replayed12checksums:
acquisition10, deployed233, first TC damage660. The immutable fixture and its
full provenance are in `src/headless/fixtures/`; generation receipt:
`.local/siege-frozen-generation.log`.

Before adding the adapter, the frozen regression failed at tick100
(expected15f2d14b, actual8c258b10), recorded in `.local/siege-replay-before.log`.
No frozen hashes were regenerated to fix it. Legacy packing/Siphons/mapgen
fixtures also remain unchanged; their tests select the appropriate old markers.

First review's targeted checks (not a full-suite result):

```sh
CIV_PROFILE_CONTENT=/home/fraser/repos/age-of-empires/public/imported/aoe2/manifest.json \
  npx vitest run src/sim/trebuchet.test.ts src/sim/ai-siege.test.ts \
  src/sim/siege-safety.test.ts src/headless src/shared src/protocol \
  src/sim/mapgen-legacy.test.ts src/match-setup.test.ts src/dev-session.test.ts \
  --maxWorkers=1
npx tsc --noEmit -p .
```

**171passed across21files, no skips,222.16s; TypeScript exit0.** Logs:
`.local/siege-review-tests.log`, `.local/siege-review-tsc.log`. This includes the
owned non-skipped trebuchet/AI/siege cases, frozen v4/v5/v6/v7 replay, new v8
recording, legacy/current JSON continuation, two-client rejoin/restart and actual
checkpoint-file preservation tests. Earlier focused replay/shared run:
38passed/6files,80.83s (`.local/siege-replay-targeted.log`). No test timeouts or
simulation clock bounds were widened in this review correction.

No owned checkpoint/import, native game operation, service restart, commit or
push. Owned browser acceptance remains unrun; the prior open smoke receipt above
predates the marker change. Native calibration gaps listed above remain open.

### Full-suite follow-up

The coordinator's subsequent owned checkpoint found three failures omitted from
that targeted run: Regicide v1 replay, research-queue v1/v2 replay, and frozen
pre-score v3 hashes. All three were reproduced locally before editing
(`.local/legacy-replay-before.log`:3failed/57passed). The headless loader already
removed the new marker correctly; the three independently constructed historical
test states did not. They now remove it alongside their existing packing/Siphons
adapters. Frozen expected hashes, including1b4d93c5, are unchanged.

The audit also found that the browser loader lacked the pre-v6 packing and
pre-v7 Siphons adapters as well as the new pre-v8 targeting adapter. Both browser
and headless loaders now call `src/sim/replay.ts`'s `createReplayGame`, so their
initialization boundaries cannot drift independently. Saved-state restoration
does not call this function. Eight new outcome tests cover every recording
version1–8, all marker boundaries, old/current packing duration, actual legacy
automatic deployment/damage and current packed idle. This is shared-initializer
coverage, not a newly executed browser replay UI acceptance.

- The three failed files plus `src/sim/replay.test.ts`: **68passed**,32.00s;
  `.local/legacy-replay-fixed.log`.
- Exact full public command:
  `npx vitest run --maxWorkers=4 > .local/full-vitest.log 2>&1`:
  **exit0;1288passed/302skipped across135passed/11skipped files
  (1590tests,146files),309.97s; zero failures**. No local owned manifest was
  installed or supplied for this public run; these skips are not owned coverage.
- `npx tsc --noEmit -p .`: **exit0**; `.local/legacy-replay-tsc.log`.
- `git diff --check`: clean. No hashes, assertions or timeouts were weakened.

The full-suite wrapper PID1739426 exited; receipt
`.local/full-vitest-review3.exit` contains0, with no surviving test process.
No native game operation, import, owned checkpoint, commit or push. The
coordinator still owns the integrated owned-checkpoint rerun.
