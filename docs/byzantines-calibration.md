# Byzantine calibration (#267)

## Provenance and outcome

2026-10-06: **measured on current build 185872, not pinned 48987**,
owner-authorized installed DE PID 22012. All screenshot readings are
**observed visually**, not internal engine values. Single-player editor Tests,
fullscreen 2560×1440; inherited UHD-unchecked configuration unchanged. No
restart, multiplayer, scenario save, import, service change, commit or push.
Final continuation capture `cont-final-main-menu.png` confirms the main menu
and build number (earlier handoff: `byz-final-main-menu.png`).

**Partial / BLOCKED for closing #267.** Healing stacking decisively disagreed
with the runtime and is corrected. Building panels were measured, but do not
discriminate internal fractional HP from rounded display. The continuation
established paid Logistica and one direct strike, but not a positive collateral
control or a reliable radius/eligibility boundary. Do not treat trample as calibrated.

Evidence root (ignored; retain the worktree):
`/home/fraser/repos/age-of-empires/.local/orchestrator/evidence/issue-267/native/`
(archived from the former `issue-267-byzantines` worktree).
Named observations have full-resolution PNGs and JSON action receipts. Derived
panel montages do not replace originals. Source dump: `.local/byz-source.log`.
The initial worktree was clean; no cheap-worker partial diff or failing-check
artifact was supplied, and the issue had no comments. The plain `gh issue view
267 --comments` failed on Projects deprecation; the JSON title/body/comments
request succeeded.

## Source comparison

Read both DATs with locked genieutils, resolving the pinned root through
`tools/depot.py`; no executable inspection:

| DAT | SHA-256 | Civ count |
| --- | --- | --- |
| Pinned depot 813781 `resources/_common/dat/empires2_x2_p1.dat` | `ce3530df36cf0b333a9751cb0ff94460fe904f811feecec8ae9794701622b4cf` | 60 |
| Installed `D:\SteamLibrary\steamapps\common\AoE2DE\resources\_common\dat\empires2_x2_p1.dat` | `4aa2f0a719e88e5f1502517eddb27c669aeb40c2fe9d8c4f3eec7751c01e7baa` | 63 |

Both have Monk125 task105 amount2, work rate1.25, team400 resource89=2;
Cataphracts40/553 blast damage−5 and base radius0; building effects
282/429/430/431 multiply HP by the same float32 encodings of
1.1/1.0909/1.0833/1.0769. Examined House70/463/464/465 base HP is
550/750/900/900 in both.

**Logistica differs:** pinned effect493 adds radius0.5 to40/553 and packed
attack262 (=class1 infantry, +6). Installed493 instead adds radius0.5 to
40/553/2703/2704, with no attack commands. Continuation source inspection
(`.local/byz-cont-source.log`) also finds base infantry attack40/553 changed
from9/12 to13/18; melee stays9/12. Do not remove the pinned
+6 because of current-build results. Radius reference point, hitbox boundary,
infantry/non-infantry eligibility, hill scaling and Greek Fire remain open.

## Healing observations

Castle-Age fixture: one War Elephant, two Monks (later three), a Knight,
Villager, House, Barracks and Fortified Palisade Wall. One player, custom
victory with no conditions. A non-looping, unconditional Damage Object trigger
subtracts400 from the Elephant. Monks start outside healing range; explicit
right-click orders are issued while F3-paused, then approach is allowed before
the measurement interval. No garrison or combat. F11 game clock, not controller
wall time, supplies the intervals; controller launch/capture overhead is real.

| Civ / active healers | Game clock | HP | Gain | Capture pair (`.png`) |
| --- | --- | --- | --- | --- |
| Byzantines / 1 | 00:34→00:50 | 99→183 /450 | 84 | `byz-one-start`, `byz-one-end` |
| Byzantines / 2 | 01:10→01:27 | 282→409 /450 | 127 | `byz-two-start`, `byz-two-end` |
| Byzantines / 2, fresh repeat | 00:41→00:55 | 171→276 /450 | 105 | `byz-repeat-start`, `byz-repeat-end` |
| Byzantines / 3 | 00:41→00:54 | 219→348 /450 | 129 | `byz-three-start`, `byz-three-end` |
| Teutons / 1 | 00:41→00:58 | 126→168 /470 | 42 | `control-one-start`, `control-one-end` |
| Teutons / 2 | 01:27→01:44 | 262→325 /470 | 63 | `control-two-start`, `control-two-end` |

Integer clock/HP readings have quantization uncertainty: 84/16 is not a new
5.25 rate. The intervals support approximately **5, 7.5, 10 HP/game-second**
for one/two/three Byzantine monks and **2.5, 3.75** for one/two Teuton monks.
Both two-monk Byzantine intervals exclude the old additive10 rate by much more
than one displayed second/HP. The third monk supports another half-rate
contribution, rather than a two-monk cap. Healing does stack, at a reduced rate.

The control is the same placed unit type and the same400-point wound, **not
identical maximum HP**: the Castle preset gives Teutons470 versus Byzantine450
(initial `control-heal-initial`70/470, `byz-heal-paused`50/450). Attempts to
disable Bloodlines selected other entries instead; those changes were undone.
An exact identical-stat control, subsecond cadence, capture/mixed-rate priority,
more than three healers, and pinned-executable confirmation remain unmeasured.
The within-Byzantine single/pair/repeat/triple comparison does not depend on
the control's20 extra HP. All measured intervals finish below maximum HP.

### Runtime change and verification

`src/sim/game.ts` previously accumulated every healer's full resolved rate.
It now tracks patients actually healed in the current tick: first contributing
healer full rate, subsequent contributors half rate. Approaching, stopped and
dead monks do not consume the slot; patients have independent slots. The set is
tick-local, not new serialized state. Existing fractional accumulation remains.
Native equal-rate pairs/triples establish the aggregate rate, **not** the
identity of the privileged healer: stable simulation traversal is the explicit
integration policy for mixed-rate cases. Larger groups extrapolate the observed
half-rate contribution and are not separately certified.

Public outcome regressions in `src/sim/monastery.test.ts` cover rates2.5/5,
one/two/three healers, stopping the first contributors, dead/distant exclusion,
independent patients and JSON continuation. Existing acceptance coverage remains.
First test attempt accidentally retained fallback range0 (zero healing); the
fixture now explicitly supplies range4 and asserts the public order is `heal`.
The corrected **pre-fix** regression failed with20 versus15 and40 versus30 HP
over four seconds (`.local/byz-healing-red2.log`). After the fix:

- `npx vitest run src/sim/monastery.test.ts src/sim/byzantines.test.ts --maxWorkers=1`:
  exit0, **16 passed, 14 skipped**, 7.62s (`.local/byz-targeted.log`).
  Byzantine owned tests skipped because this worktree has no imported manifest;
  this is not an owned-mode pass.
- `npx tsc --noEmit -p .`: exit0 (`.local/byz-tsc.log`).
- No owned checkpoint/import was run. Code is uncommitted for coordinator review.

Continuation rerun: same targeted command, **16 passed /14 skipped**, exit0,
4.42s (`.local/byz-cont-targeted.log`); same TypeScript command exit0
(`.local/byz-cont-tsc.log`). No further runtime/test edits were made.

## Logistica continuation: accepted observations and failed controls

Same native PID/build/settings. Two-player editor Test remains single-player.
Player1 Byzantines/Imperial, 5000 food/gold; non-Elite Cataphract and Castle.
Player2 Personality was explicitly set to **None**, but its civilization was
inadvertently left **Random**. Earlier attempts had edited Player1's personality,
not Player2's: `cont-actual-p2-none` is the verified correction. Mutual alliance
allowed research/approach; in-game Diplomacy then changed Player1's stance toward
Player2 to Enemy. No triggers were used in these combat Tests.

| Observation | Accepted reading / evidence |
| --- | --- |
| Logistica tooltip | 800 food/600 gold, `cont-safe-log-hover` |
| Paid and completed | 5000→4200 food, 5000→4400 gold, button gone and queue empty, `cont-new-log-paid` |
| Direct target, Khmer Militia | 40→16 HP, `cont-force-hp-target` → `cont-contact-target` |
| Nearby Khmer Militia | 40→40 HP over the same strike, `cont-force-hp-near` → `cont-contact-near` |

The Cataphract panel reads9+2 melee; installed base infantry attack13 explains
24 damage to the zero-melee-armour Militia in one hit. This does **not** establish
the pinned Logistica +6 increment. The strike was isolated by short F3 resume/pause
pulses (`-KeySteps '{F3}|{F3}'`); earlier pulses only approached/wound up, leaving
the target40/40. Use HP changes, not the number of helper calls, to count strikes.

Placement attempts in `cont-new-layout`: target `(1000,900)`, nearby infantry
`(1029,914)`, farther infantry `(1060,870)`, archers `(971,886)` and `(1000,948)`.
These are **screen coordinates, not certified simulation coordinates**. The
nominal near offset is approximately0.6 tile along an isometric grid axis if
48×24 pixels is its basis. That would lie inside the runtime's target-centred
0.5-plus-bystander-radius envelope. The zero collateral is therefore a candidate
disagreement, **not a green boundary check**: actual in-Test centre/edge distances
and a positive collateral control were not secured. No radius code was changed.

Why the rest is rejected:

- First combat Test ended before inspection. Default AI/diplomacy and friendly
  ranged units contaminated that group. This is not damage evidence.
- Archers moved/fled during approach even after Personality=None. Reusing their
  original pixels selected the Cataphract in some `near-archer` captures. Those
  panels do not measure archer collateral or stationary distance.
- The tighter repeat (`cont-tight-*`) rolled Thracians: panels show **Levy**, not
  Militia, with changed movement/selection. Deletion and picking in the overlapping
  group were not controlled. No tighter-radius conclusion is accepted.
- Friendly damage, buildings, before-Logistica control, positive fixed5 collateral,
  and the requested0.25/0.5/0.75/1.0 tile-from-edge sweep remain **unverified**.

The pinned localization `IDS_SCENARIOTIPS_2` explicitly documents Ctrl-G's four
grid modes (off-grid and/or stacked placement). Off-grid placement was exercised,
but a future fixture must verify the mode and in-Test positions, not infer them
from mouse coordinates. Fix Player2's civ and a non-moving stance before repeating.

## Building HP panels

Separate editor age-start Tests, not paid age-ups. All were undamaged.
Capture basenames: `byz-{dark,Feudal,Castle,Imperial}-{house,barracks,wall}`
and `control-{Dark,Feudal,Castle,Imperial}-{house,barracks,wall}`. The lower-case
`dark` spelling applies only to Byzantine captures. Montages:
`hp-dark-panels`, `hp-ages-panels`, `control-hp-panels`.

| Age | Byzantine House / Barracks / wall | Teuton House / Barracks / wall |
| --- | --- | --- |
| Dark | 605 /1320 /330 | 550 /1200 /300 |
| Feudal | 900 /1800 /600 | 750 /1500 /500 |
| Castle | 1170 /2340 /650 | 900 /1800 /500 |
| Imperial | 1260 /2940 /700 | 990 /2310 /500 |

The actual wall is **Fortified Palisade Wall**, not ordinary Palisade Wall:
searching the latter and choosing the first result selected the former. Do not
apply these observations to ordinary walls. The control Imperial House/Barracks
also include age-preset technology effects, so raw cross-civ ratios there do not
isolate the Byzantine bonus. Town Center, wounds, foundations and paid age-up
ordering were not measured.

House605/900/1170/1260 is consistent with the advertised10/20/30/40% bonuses,
but cannot select a numeric implementation: rounding each source multiplication
and displaying an unrounded chained product can produce the same panels. For
example, the chained Castle House value is approximately1169.95 and displays1170
under either nearest or ceiling display rounding. **No building-HP runtime/test
change is justified by these panels.** Retain the existing policy pending a
discriminating fractional-damage/repair or other internal-HP boundary probe.

### Continuation: ordinary Palisade and tower controls

Fresh one-player fixture, same Villager1280,700; Watch Tower1000,500 and
**ordinary Palisade Wall**1600,700 (second search row, not Fortified). Independent
age-start Tests for each civ. All readings observed visually; captures are
`cont-hp-{byz,control}-{Dark,Feudal,Castle,Imperial}-{tower,wall}`; montage
`cont-hp-panels`. The Imperial preset upgrades the placed tower to Guard Tower.

| Age | Byzantine tower / ordinary wall | Teuton tower / ordinary wall |
| --- | --- | --- |
| Dark | Watch935 /165 | Watch850 /150 |
| Feudal | Watch1020 /300 | Watch850 /250 |
| Castle | Watch1326 /325 | Watch1020 /250 |
| Imperial | Guard2100 /350 | Guard1650 /250 |

Source79 has850HP; Castle effect102 multiplies it by1.2 in both DATs. Guard234
has1500HP. Thus the clean tower baseline is850/850/1020/1500 before other
technology effects, not850 for every age or the Imperial control's1650. Ordinary
wall control150/250/250/250 isolates the civ factor directly. Both tables fit
exact base×1.1/1.2/1.3/1.4 at panel precision. House baseline550/750/900/900 gives
the earlier605/900/1170/1260; the control's Imperial990 is not its unmodified base.

The source float32 multipliers were also computed as chained doubles, chained
float32, and integer nearest rounding per command (`.local/byz-cont-source.log`):

| Example | Unrounded chained double | Native panel | Numeric discrimination |
| --- | --- | --- | --- |
| Feudal House | 899.992474 | 900 | Not final floor899 |
| Castle Watch Tower, baseline1020 | 1325.948105 | 1326 | Not final floor1325 |
| Imperial ordinary Palisade | 349.978804 | 350 | Not final floor349 |
| Dark Watch Tower | 935.000020 | 935 | Not naive double-ceiling936 |

Nearest-per-command, nearest-final, exact percentages, and **float32 chained
values displayed with ceiling** all predict these panels. Dark Tower's float32
product is exactly935. Neither these buildings nor the Houses discriminate those
remaining policies. The HP-only follow-up below rejects universal ceiling display,
but does not establish the Byzantine internal rounding stage.
The earlier scratch `.local/byz-rounding-models.log` incorrectly assumed1020 for
every Watch Tower age; it is superseded by the source-checked continuation log.
No wounded/foundation or paid age-up HP experiment was completed.

## HP-only follow-up: candidate scan and fractional control

2026-10-06, base `0d291e5`; **current build185872, not pinned48987, observed
visually**. Same PID22012, fullscreen2560×1440, inherited UHD-unchecked settings.
Only editor Tests; no restart, saved scenario, import, checkpoint, commit or push.
The clean worktree inherited no partial diff; archived prior patch, failed healing
checks and source/rounding logs were reviewed. Existing code/coverage is untouched.

**BLOCKED for an authoritative HP-rounding fix; docs-only progress.** Paid
Architecture rejects strict ceiling display. The integer-damage probes add a
candidate runtime disagreement, but do not locate quantization inside the engine.

New ignored evidence root:
`/home/fraser/repos/age-of-empires/.local/worktrees/issue-267-hp-rounding/.local/`.
`hp-models.py` / `hp-models.log` reread both DATs; hashes match the table above.
`hp-candidates.py` / `hp-candidates-byz.log` use the **Byzantine profile** of the
existing `byzantines-content.json` extract plus fresh DAT reads. The earlier
scratch `hp-candidates.log` used that extract's root Briton profile and is not
the accepted civilization/availability analysis. No import was run. Full PNGs,
JSON receipts and the `hp-readings.png` montage are under `native/`.

### Candidate computation

Both DATs encode incremental factors `1.100000023841858`, `1.09089994430542`,
`1.083299994468689`, `1.0769000053405762`, not independent1.1/1.2/1.3/1.4.
The following chains round each multiplication to float32. Nearest here means
positive half-up; ties-to-even is untested. These are arithmetic baselines, not
claims of normal availability in every age.

| Candidate | Base HP Dark/Feudal/Castle/Imperial | Imperial float32 chain | Nearest / ceiling panel |
| --- | --- | --- | --- |
| Mill / Lumber Camp |600/800/1000/1000 |1399.915161 |1400 /1400 |
| Outpost |500 throughout |699.957581 |700 /700 |
| Stone Gate |1650/1650/~2750/~2750 |3849.766846 |3850 /3850 |
| Stone Wall, before Fortified |1080/1080/~1800/~1800 |2519.847412 |2520 /2520 |
| Castle |4800 throughout |6719.592773 |6720 /6720 |
| Town Center |2400 throughout |3359.796387 |3360 /3360 |
| Dock |1800 throughout |2519.847412 |2520 /2520 |
| Fish Trap |250 throughout |349.978790 |350 /350 |
| Bombard Tower |2220 throughout |3107.812012 |3108 /3108 |
| Control Bombard Tower, Masonry then Architecture |2220→2442 |2686.199951 |**2686 /2687** |

The ordinary age-only examples do not discriminate the remaining panel models.
Control Keep2250×1.1×1.1 gives2722.5 (half-up/ceiling2723, ties-even2722), but
was not measured. Walls/gates include tech71's1.6666666269302368; normalized
baselines are not exact integers or proof of native command order. Palisade
tech72 is1.6666699647903442: control150 becomes250.000488 in float32, not250.
The earlier native control250 thus also cautions against universal strict ceiling;
substituting exact250 before modeling loses that distinction.

Both DAT trees disable Masonry50 and Architecture51 for Byzantines. Both effects
multiply applicable classes3/52 by float32(1.1): compounding, not additive20%.
Teutons lack Architecture; the missing button and owned tree caught this, and
**Spanish** supplied the paid control. Hoardings379 multiplies Castle HP by
1.2100000381469727 in both DATs despite the current “+1,000 HP” tooltip. It was
hovered, not purchased; that tooltip is not evidence of additive behavior.

### Native outcome table

One-player fixture, custom victory without conditions. Villager1280,700 keeps
the camera stable; Mill850,500, Castle1900,450, University1700,850 and Bombard
Tower1100,900 were editor-placed, not foundations. Players tab set Imperial;
all accepted panels verify building name and civ. Test selection coordinates:
Mill850,460; Castle1900,350; University1700,780; Tower1100,830.

| Civ / condition | Observed HP | Discrimination / capture basename |
| --- | --- | --- |
| Byzantines Imperial Mill |1400/1400 |None: `hp-byz-imperial-mill` |
| Byzantines Imperial Castle |6720/6720 |None: `hp-byz-imperial-castle` |
| Byzantines Imperial Bombard Tower |3108/3108 |None: `hp-byz-imperial-tower` |
| Teuton / Spanish Tower, Imperial preset Masonry |2442/2442 each |Integral control: `hp-control-imperial-tower`, `hp-spanish-tower-before` |
| Spanish Tower, paid Architecture completed |**2686/2686** |**Rejects strict ceiling2687**: `hp-spanish-tower-after` |

Architecture50,1250 was hover-verified. Food5000→4700, wood5000→4800;
button/queue gone, armour+1→+2 and University2310→2541 confirm completion
(`hp-spanish-architecture-hover`, `hp-spanish-architecture-done`). Gold5020
is visible afterward, not a gold cost. No cheats or forced research.

Two integer-damage probes followed:

- Fresh Spanish Test: non-looping Damage Object2686 targeting the tower, Timer150.
  Architecture paid again;01:42 tower2686/2686,02:40 rubble (`hp-boundary-before`,
  `hp-boundary-after`; fields `hp-damage-fields`, `hp-timer-value`). Unrounded
  2686.199951 minus2686 with death only at zero predicts survival, so that
  **combined model fails**. Stat rounding, trigger-damage quantization and a
  sub-HP death threshold are not separately identified. No2685 positive boundary
  repeat or ordinary-combat confirmation was completed.
- Byzantine Castle: Timer30, Damage6719,00:12→00:38 gives6720/6720→**1/6720**
  (`hp-byz-boundary-before/after`). **Target isolation failed** after Reset/Set
  Objects: all Player1 objects were damaged, killing the Villager and other
  buildings. The Castle panel is readable, but not an isolated control success.
  Integer6720−6719 and fractional6719.592773−6719 displayed nearest both give1.

### Implementation comparison and bounded handoff

`buildingRulesFor` / `applyBuildingEffect` multiply HP without rounding; the unit
`integerHitPoints` marker is not applied to buildings. The importer normalizes
source precision. `src/main.ts` passes raw maxHp to the HUD; `src/view/hud.ts`
ceilings current HP but prints maxHp directly. Native integer panels therefore
do not certify current presentation; the Spanish trigger boundary also remains
a candidate gameplay disagreement. Neither identifies the authoritative rounding
stage. No runtime, importer, marker or acceptance changes were made.

An optional old-extract lookup probe failed before returning HP: `hp-runtime.log`
reports Arabia relic-placement constraints; an isolated retry in
`hp-runtime-lookup.log` reports unloaded `open` civilization for Player2. Both
exit1 logs and the scratch probe are retained, not reported as passing checks.
Successful checks are the DAT/model computation and visual native observations.
No tsc/test/verify was run for this Markdown-only change; handoff uses
`git diff --check`. Earlier automated acceptance remains unchanged.

Next: repeat2685/2686 with a verified target and ordinary combat to separate
trigger semantics from HP/death quantization. Find a legal operation sequence
whose nearest-per-command and nearest-final predictions differ before selecting
a replay-compatible rule. Do not replace this with more Mill/Outpost panels.

Final `native/hp-final-main-menu.png` / JSON confirms main menu, build185872,
PID22012 and2560×1440. No controller remains active; settings/services unchanged.
The worktree/evidence remain intact, tracked changes uncommitted.

## Bounded continuation

Keep #267 open: repeat Cataphracts with a **fixed** defender civ, non-moving
bystanders and a positive collateral control, then verify positions, one strike
and before/after HP; separate current493/base attacks from pinned source. Then
discriminate building HP with more than rounded panels, including
paid age-ups/wounds/foundations. Repeat healing with an identical-stat control
and mixed-rate/captured monks if their slot priority matters. Native process
22012 remains running at the main menu; no owned controller/job is left active.
