# Siphons native calibration (#242)

2026-10-06 — **PASS for the authorized building-exclusion fix; partial native
calibration**, not full Siphons parity acceptance.
Measured on current installed DE build **185872, not pinned 48987**, with the
owner's permission. Screenshot readings below were **observed visually**.
The continuation fixes building-target charge expenditure and adds public-order
regressions with JSON continuation; the prior acceptance coverage remains intact.
The checkout started clean, with no prior #242 patch, failed checks or
worker-attempt transcript supplied. The inherited native recipes were reviewed.

## Source comparison: PASS

Parsed both DATs with the locked project's `genieutils`, resolving the pinned
root through `tools/depot.py` before reading it. No executable inspection or
asset import was performed.

| Source | SHA-256 |
|---|---|
| Pinned `depot_813781/resources/_common/dat/empires2_x2_p1.dat` | `ce3530df36cf0b333a9751cb0ff94460fe904f811feecec8ae9794701622b4cf` |
| Installed `D:\SteamLibrary\steamapps\common\AoE2DE\resources\_common\dat\empires2_x2_p1.dat` | `4aa2f0a719e88e5f1502517eddb27c669aeb40c2fe9d8c4f3eec7751c01e7baa` |

Briton, Frank and Byzantine units 529/532/1103 match exactly for all six charge
fields: `0 / 0.03999999910593033 / 0 / 0 / 64 / 2629`. Their complete task133
records also match: work2/8, range1.2000000476837158, flag2001, auto-search0,
enable-targeting0 and no task graphics. Effect915 is identical, setting type6
and maximum1 on529/532/1103/1302. Technology909's printed records also agree:
Castle prerequisite, University209,45s,100F/175G.

For projectile2629, the complete `type_50`, `projectile` and `dead_fish` records,
speed, dead-unit ID and resource storages match in all three civs. This includes
attacks11:1/16:0/2:0/4:2/60:1, speed3, blast.5/level2, reload1, friendly-fire1,
smart1/hit0/vanish2/arc.44999998807907104, tracking677/mode2/density1,
dead-unit−1 and no lifetime storage. This is equality of the inspected fields,
not equality of the whole DAT or proof that the two engines behave identically.

## Native fixture and observations

Single-player editor Test; P1 **Byzantines, Castle Age**, P2 **Teutons, Dark Age**,
personality None. P1 initially neutral toward P2 in the accepted dock/transport
run; explicit attack orders worked. Native unit reactions are not disabled by
None. Casual1.5, Standard, fullscreen2560×1440; graphics settings were not
changed (inherited UHD unchecked). Only Byzantine Fire Ship was exercised;
Briton/Frank equality above is source evidence, not native civ coverage.

Paid University Siphons was hover-identified and researched:100F/175G spent,
5000F/5000G→4900F/4825G. The selected ship gains a white charge bar below its
blue HP bar. The ready panel's **attack** reads `2 (6)`; the depleted panel's
attack reads `3`. Range remains `2`. An interim investigation message misread
the attack row as range; no range-extension claim is accepted.

| Outcome | Evidence / limitation |
|---|---|
| Charge bar after research | `siphons-pre-research-ship`, `siphons-charged-ship`; bar absent before, full at the post-research observation. Research finished before this capture, so instantaneous initial fullness is not established. |
| Dock attack retains charge | In the third Test, Dock1800/1800→1775/1800 by01:12; ship's bar remains full during the attack at01:10. After attacking a transport and recharging, another Dock attack at01:47 again retains the full bar; Dock then1675/1800. This is positive building damage with no observed charge expenditure, not merely a failed attack order. |
| Transport attack spends charge | Same third Test, transport70/70 before the order;60/70 at01:13,56/70 at01:14,50/70 at01:15. The Fire Ship's bar is nearly empty at01:15. These are sampled HP totals, **not isolated single-hit or bonus-damage values**. |
| Recharge | After retreating, bar partial at01:15 and01:32, full at01:41. Consistent with the source1/.04≈25s, but release/completion were not bracketed tightly enough to calibrate an exact25-second threshold. |

## Authorized continuation: building exclusion

The regression reproduced the original defect: `fireChargeOf` checks the
*attacker's* target64 field only; `releaseFireCharge` formerly rejected only
ownership/Gaia/not-ready cases. A public attack order damaged a Dock **and spent
charge**, unlike the native observation. `game.ts` calls this handler on a ready
normal ranged release.

For new matches, the fix rejects `isBuilding(target.kind)` inside
`releaseFireCharge`, before spending charge or creating a projectile. This uses the existing generic
building category, not a hardcoded Dock name or ID. Ordinary building damage,
recharge, ship-target charge attacks and JSON continuation remain operational.
The owner explicitly authorized the building-category rule; **Dock is the native
building sample**, not a measurement of every building class.

A fresh source check (`siphons-target-fields.txt`) found:

| Object | DAT type / class / combat level | Relevant charge/task fields |
|---|---|---|
| Dock45 | 80 / 3 / 2 | no task133 |
| Transport545 | 70 / 20 / 4 | no task133 |
| Villager83 | 70 / 4 / 3 | no task133 |
| Fire Ships529/532/1103 | 70 / 22 / 4 | target64; task133 class−1/unit−1, enable-targeting0 |
| Samurai291/560 | 70 / 6 / 4 | type1/target0/event0; task133 class−1/unit−1, enable-targeting0 |

XS still only names `cChargeTarget=162`; inspected localization only labels
"Charge Target". Neither these records nor task133 supplies a class-bit mapping.
Consequently **no generic mask interpreter was invented**, and the shared
task133 number was not used to modify Samurai's separate approach behavior.
The guard is restricted to the existing Siphons mode6/event0/target64 handler.
Chinese alternate weapons (target127, events4/5/−3) are unchanged too.

Land-unit eligibility remains inferred as before; the existing villager-target
splash/replay test is retained, not weakened into a skipped or source-only test.
The attack-panel change and mixed native impacts still do not establish whether
charge replaces a normal release or adds a separate one.

### Recording/snapshot compatibility (review revision)

Merged coordinator-authorized `origin/main`98979f6 before this revision, retaining
its newer ledger and recording-v6 packing adapter. No native game interaction
was performed during review revision.

New games carry `siphonsVersion:1`; newly written records/results use **v7** even
when launched with an older config. Config/record/result schemas still accept
v1–v6. Replay initialization removes the new marker for v1–v6 records. In
`fire-charge.ts`, only the marked policy excludes buildings; absent markers
retain the previous charge expenditure **and** explosive projectile. Snapshots
already contain their policy and are not upgraded on JSON restore; in-flight
projectiles, spent reservoirs and recharge continue under that policy. This
does not change packing's separate marker/adapter or shared checkpoint admission.

The checked-in frozen `src/headless/fixtures/pre-siphons-v6.json` was generated
by an untouched98979f6 archive, not the code under test. Its old engine replayed
all four checksums independently. Public orders train a charged Fire Galley,
then attack a TC; at tick21 charge becomes0 and the extra projectile exists.
The controlled open fixture enlarges sight/range and allows TC land production
to isolate eligibility from navigation; it is not a gameplay balance preset.
See `src/headless/fixtures/README.md` for source commit, exact overrides and hash.

The unadapted building fix failed this frozen record at tick100 (expected
`983ee1bb`, actual `0305327d`). The marker adapter restores those unchanged
checksums. Regression coverage also verifies v7 building attacks keep charge,
rejects relabelled records, restores both policy snapshots before/after release,
and follows shared command ticks on two JSON clients. A new shared match after
restart uses the new marker; checkpoint restoration preserves its absence.

Review verification (all files left uncommitted):

- **146 passed / 19 files / 0 skipped,209.39s** with
  `CIV_PROFILE_CONTENT=/home/fraser/repos/age-of-empires/public/imported/aoe2/manifest.json npx vitest run src/sim/siphons.test.ts src/sim/chinese.test.ts src/sim/japanese.test.ts src/sim/attack-graphics.test.ts src/sim/mapgen-legacy.test.ts src/headless src/shared src/protocol --maxWorkers=1`.
  Includes Siphons4, Chinese33, Japanese25, attack-graphics8, frozen/current
  replay, two-client continuation, compatible checkpoint restoration and full
  headless matches (`siphons-review-checks.log`, exit0).
- Additional audit found three pre-v7 fixture initializers in score/research/
  Regicide tests still carrying the new marker. The failing run is retained as
  `siphons-review-legacy-fixtures-red.log`. Selecting `useLegacySiphons` alongside
  their existing packing adapter fixed initialization; **no historical expected
  hashes or assertions changed**. Rerun of those three complete suites:
  **60 passed / 3 files / 0 skipped,44.56s**
  (`siphons-review-legacy-fixtures-green.log`). Total distinct verified coverage:
  **206 tests / 22 files**, not a full owned checkpoint.
- Final `npx tsc --noEmit -p .`: exit0 (`siphons-review-final-tsc.log`).
  `git diff --check` passes. No fixture timeout widened. Byte comparison confirms
  the checked-in v6 recording equals the independently generated file; all main
  ledger lines outside the edited Siphons row remain present.

## Rejected attempts and remaining acceptance

- Initial allied fixture ended in victory immediately; no measurements accepted.
- First fishing-ship attack included approach, fleeing targets and multiple
  impacts. A stop-key attempt did not isolate combat. Its HP loss is not a
  first-hit bonus measurement; its waiting captures are not a recharge fit.
- Later P2 player switching recentered the camera. Repeated idle-worker clicks
  selected a fishing boat, not the intended land villager. No land-target result.
- The continuation's optional shore probe did create a selected **Fire Galley**
  in Feudal with a full charge bar (`cont-siphons-shore-ready`). This used a
  one-shot forced Research Technology909 trigger, not paid Feudal research.
  The shore villager was visible in the editor, but could not be positively
  selected/damaged in Test. Freeze Object was attempted, first with an incorrect
  P1 source filter, then P2; no target HP outcome was established. These captures
  do **not** prove either land-target eligibility or ineligibility. The initial
  continuation allied fixture also ended immediately and was discarded.
- No accepted bystander-ship HP comparison, line-versus-blast geometry, own-ship
  friendly-fire control, class-by-class damage, moving aim, repeated impact
  damage or vanish2 lifetime measurement. An explosion picture cannot establish
  any of those damage rules.
- No Fire Galley combat/Fast Fire Ship native result, Briton/Frank native result,
  unresearched combat control, isolated first-versus-later hit, exact release
  count, exact recharge threshold, conversion or save/load result.

Next bounded fixture should freeze target reactions through verified orders,
compare charged/unresearched single releases against the same transport, then
test a shore land unit and a second building. Record the charge bar and target
HP around each release before extending target eligibility or scheduling. Only
then add collocated enemy/own bystanders and post-impact damage samples. Preserve
the existing replay/recharge coverage when replacing the inferred policy.

## Evidence and checks

Ignored local evidence is retained under this durable checkout:
`.local/worktrees/issue-242-siphons/.local/native/` relative to the primary repo.
No native assets or screenshots are committed. Each action has PNG plus JSON
receipt (PID, timestamp, keys/clicks, rectangle); crops are supplementary.

- `siphons-dat-comparison.txt`: full inspected source records and
  `ALL_SELECTED_FIELDS_EQUAL True`.
- Research: `siphons-tooltip`, `siphons-paid`, `siphons-research-complete`,
  `siphons-charged-ship`; third-Test payment/completion:
  `siphons-test3-buy`, `siphons-test3-ready`.
- Dock: `siphons-dock-before`, `siphons-dock-approach-pause`,
  `siphons-dock-settle2`, `siphons-dock-retest-paused`, `siphons-dock-retest-hp`.
- Transport: `siphons-transport-before`, `siphons-transport-hp1`,
  `siphons-transport-pulse2`, `siphons-transport-pulse3`,
  `siphons-current-charge-tooltip`.
- Recharge: `siphons-recharge-t0`, `siphons-recharge-t1`, `siphons-recharge-t2`.
  `siphons-clock-panels.png` collects clock/panel crops; use full captures for
  geometry. Captures from rejected attempts are retained, not renamed as passes.
- Initial local-manifest attempt: typecheck passed, but both Siphons tests
  skipped. That attempt was **not** acceptance coverage (`siphons-vitest.log`).
- Continuation red check, owned manifest supplied: **1 failed / 3 passed**, no
  skips,5.64s. The new Dock regression failed specifically at `spent === false`,
  after its positive ordinary-damage assertion passed (`siphons-cont-red.log`).
- Continuation green check: **63 passed / 4 files / 0 skipped**,49.64s:
  Siphons4, Japanese24 (including Samurai approach), Chinese27 (including other
  charged weapons), attack graphics8. Command:
  `CIV_PROFILE_CONTENT=/home/fraser/repos/age-of-empires/public/imported/aoe2/manifest.json npx vitest run src/sim/siphons.test.ts src/sim/japanese.test.ts src/sim/chinese.test.ts src/sim/attack-graphics.test.ts --maxWorkers=1`.
  The existing primary publication is read-only; no assets were copied or
  regenerated (`siphons-cont-green.log`). Siphons tests now accept the existing
  `CIV_PROFILE_CONTENT` override and fail if an explicitly requested path is absent.
- `npx tsc --noEmit -p .`: **PASS**, exit0 (`siphons-cont-tsc.log`).
- New Dock/Transport regressions research through public commands, issue public
  attack orders, assert actual target HP loss and charge/projectile outcomes,
  and compare each of200 ticks with a JSON-restored continuation.
- No owned checkpoint/import, service restart, deployment or push. Only the
  explicit review-authorized main merge was performed. Changes remain
  uncommitted; no technologies or packing runtime code changed by this patch.

Final continuation `cont-siphons-final-main-menu.png/json` verifies build185872,
PID22012,2560×1440 at(0,0), main menu at2026-10-06T11:34:18+01:00.
No scenario was saved; no native controller remains running. The game itself
remains open. Earlier `siphons-final-main-menu` is the first pass's exit receipt.
Review revision did not touch the game; that receipt is historical, not a new
claim about the owner's current foreground state.
