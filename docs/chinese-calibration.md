# Chinese native calibration — #260

2026-10-06: **measured on current build 185872, not pinned 48987**, with
owner authorization. All screenshot readings below are **observed visually**.
Overall result: **partial / BLOCKED for full issue acceptance**. Research-price
rounding has a decisive native disagreement and a tested fix. The volley follow-up
below supports the existing primary/secondary damage split, but not exact missile
scheduling, miss geometry or a general bystander rule. The complete opening remains
unresolved.

## Environment and provenance

- Existing Windows PID **22012**, executable
  `D:\SteamLibrary\steamapps\common\AoE2DE\AoE2DE_s.exe`.
- Fullscreen 2560×1440; inherited UHD-unchecked settings left unchanged. No game
  restart, service restart, import, checkpoint, integration, commit or push.
- Single-player editor Tests only, Casual 1.5. No cheats or research/damage
  triggers. Test starting ages automatically grant earlier-age technologies;
  these are separate starts, **not** a paid age-up experiment.
- Earlier private evidence is retained in the primary checkout's
  `.local/orchestrator/evidence/issue-260/native/ch-*.png/json`;
  controller receipts identify PID, time and window rectangle. DAT probe/results
  are `ch-dat.py`, `ch-dat-pinned.json`, `ch-dat-installed.json` there. These are
  ignored local evidence, not distributable game assets or tracked tooling.
- Initial worktree was clean, with no inherited partial diff or failing-check
  logs. #260 had no comments. `gh issue view 260 --comments` failed on deprecated
  Projects fields; `gh issue view 260 --json title,body,comments` supplied the issue.
  Inherited native recipes were read before acting; their unrelated failed
  fixtures were not treated as Chinese evidence.

Pinned root was resolved with `tools/depot.py`. Read-only DAT comparison:

| DAT | SHA-256 | Civilizations |
| --- | --- | --- |
| Pinned `depot_813781/resources/_common/dat/empires2_x2_p1.dat` | `ce3530df36cf0b333a9751cb0ff94460fe904f811feecec8ae9794701622b4cf` | 60 |
| Installed `D:\SteamLibrary\steamapps\common\AoE2DE\resources\_common\dat\empires2_x2_p1.dat` | `4aa2f0a719e88e5f1502517eddb27c669aeb40c2fe9d8c4f3eec7751c01e7baa` | 63 |

Chinese is civ index6 in both. Examined `type_50` and `creatable` fields agree
for Chu Ko Nu73/559 (counts3/5, secondary510), Rocket Cart1904/1907
(counts8/10), and Fire Lancer1901/1903 (type6, target127, event4/5,
projectile1925). Secondary510 has pierce3/melee0; bullet1925 has pierce3.
Lou Chuan1948's installed building attack is **180**, pinned **230**; its charge
fields agree. Rocketry projectile1879 changes its bonus armor class from pinned
**60** to installed **16**, amount5. Effect483 itself and the examined Chinese
starting/housing/discount effects agree. Chemistry/Fletching have additional
commands for newer units. Do not transplant installed balance changes into the
pinned rules or label current-build measurements pinned verification.

## Decisive prices and runtime correction

One Chinese villager, TC and Blacksmith; custom resources5000 food/wood/gold,
no gathering. Civilization and age are visible in every selected-building
capture. Tooltips were followed by real research orders and bank readouts:

| Age / technology | Tooltip | Bank before → after | Captures |
| --- | --- | --- | --- |
| Dark / Loom | 50G | Not purchased | `ch-dark-loom-hover` |
| Feudal / Fletching | 95F / 47G | 5000F/5000G → 4905F/4953G | `ch-feudal-fletching`, `ch-feudal-payment` |
| Castle / Bodkin Arrow | 180F / 90G | 5000F/5000G → 4820F/4910G | `ch-castle-bodkin`, `ch-castle-payment` |
| Imperial / Bracer | 255F / 170G | Not purchased | `ch-imperial-bracer` |
| Imperial / Plate Mail Armor | 255F / 127G | 5000F/5000G → 4745F/4873G | `ch-imperial-ring`, `ch-imperial-payment` |

`ch-imperial-ring` is a misleading action name: its actual tooltip is **Plate
Mail Armor**, not Ring Archer Armor. Purchases were captured while queued/in
progress; completed research is not necessary to establish acceptance payment.
No cancellation/refund was measured natively.

Both DATs set resource85 to 1, .949999988079071, .8999999761581421,
.8500000238418579 across ages; the importer normalizes these to1/.95/.9/.85.
There is no examined 25/20/15/10% ladder. The native prices support0/5/10/15%.

`researchCostFor` previously rounded after the player modifier, charging48G for
Fletching and128G for Plate Mail. New tests reproduced both failures before the
runtime edit (`ch-red.log`, exit1, two failed / one passed). It now truncates
the discounted fixed price, retaining the earlier Turkish pre-modifier integer
conversion. The multiplication uses float32 to preserve whole products of raw
DAT factors; that internal arithmetic model and its unmeasured generalization
remain **inferred**, not executable reverse-engineering. Native47.5→47 and
127.5→127 reject the old nearest-integer result. Spies' dynamic-price branch is
unchanged and remains uncalibrated.

Public fixtures cover observed costs through observation, exact-budget command
acceptance, zero bank and JSON-restored cancellation/refund. Owned tests exercise
the actual Fletching, Bodkin and Plate Mail technologies and completion. Existing
age progression, owner isolation, farm, projectile, replay and queue coverage is
preserved. The adjusted Loom47/42 expectations follow the corrected consumer;
those discounted Loom prices were **not** individually measured natively.

## Combat observations — not full weapon calibration

Blank land, P1 Chinese Castle, P2 Teutons with personality None and P2 allied to
P1; P1 remained hostile. A spare P1 villager kept the camera stable. Two stationary
P2 Siege Rams were placed at editor1550,500 and1550,900. Their visible baseline
was270/270. DAT Siege Ram armor is melee−1, pierce195. F3 half-wall-second pulses
captured HP, but pulses are **not** a precise native missile clock.

| Shooter | Readout sequence | Evidence and limits |
| --- | --- | --- |
| Chu Ko Nu | 270 → 269 → 267; later266 → 264 | `ch-target-before`, `ch-ckn-pulse4` through9; identity `ch-ckn-identity` (Chinese, attack8+1). Two sampled cycles remove3HP each. |
| Elite Chu Ko Nu | 270 → 269 → 267 → 266; later265 → 262 | `ch-elite-before`, `ch-elite-pulse1` through7; identity `ch-elite-identity` (Chinese, attack10+1). First sampled cycle removes4HP, second another4. Do not infer a four-projectile rule from this. |
| Rocket Cart | 270 → 246 → 206, then206 | `ch-cart-before`, `ch-cart-pulse1` through6. One sampled burst removes64HP. Compatible with eight8-damage impacts (5 melee minus−1 armor, plus2 siege bonus), not an independently counted missile trace. |

Rams' high pierce armor suppresses the distinction between primary and secondary
Chu Ko Nu damage: these are **not** accepted primary/secondary split measurements.
Elite misses/spread versus scheduling are not separated. No attack-stop timing
rule was changed to force agreement with the4HP outcome.

A third ram placed1610,945 still showed270/270 in `ch-cart-bystander`. There is
no independently measured world-space separation or pre-attack selected HP
capture for it; this is **not** proof of no collateral within a particular radius.

Fire Lancer approach/attack attempt (`ch-fire-target-before`, `ch-fire-pulse1`
through4, `ch-fire-readout`) left the target270/270 over the sampled window.
The lancer closed distance; no verified strike or isolated firearm discharge
was captured. Reject this as a zero-damage measurement. Lou Chuan, Heavy Rocket
Cart, Rocketry collateral/research order and Fire Lancer bystanders were not
measured. No combat runtime or combat acceptance assertion was weakened.

## Opening and bounded follow-up

The one-player Dark Test placed **one** villager and one TC, then showed **four
villagers / 15 capacity** (`ch-dark-tc`): supports +3 villagers and15 TC housing
in this editor start. Custom5000 resource values remained5000; editor resource
overrides are not a random-map opening. This does **not** settle−200F/−50W,
six-villager normal starts, Regicide, rebuilding a TC or exact spawn placement.

Remaining #260 acceptance: establish Chu Ko Nu/Elite per-missile hit/miss accounting
and timing beyond the damage-split observations below; positively capture firearm strikes; stage actual water
for Lou Chuan and measured bystander geometry; test Rocketry/Chemistry order;
use a normal random-map opening for resource deductions and a paid age ladder for
transition timing. Farm rounding/reapplication and capture/in-flight semantics
also remain open. Native current-build evidence does not certify pinned48987.

## Volley follow-up — 2026-10-06, current build185872

**Damage-split check passes; complete volley/collateral calibration remains BLOCKED.**
No runtime or test change. This follow-up started from clean `779f34e` in
`.local/worktrees/issue-260-volleys`; the earlier research fix was already integrated.
The original `ch-red.log` and DAT probe were read from the retained evidence at
`.local/orchestrator/evidence/issue-260/native/` in the primary checkout. The
earlier two failing price assertions are not new combat failures.

Private evidence for this follow-up is **this worktree's** `.local/native/cv-*`:
full PNGs and controller JSON receipts, plus visual-readback strip images.
`cv-dat.json` is a fresh read-only comparison of the same two DAT hashes above.
Counts3/5, secondary510 (pierce3/melee0), and target armour agree between DATs.
An additional source distinction is `creatable.projectile_spawning_area`:
normal73 `(0,0,1)`, Elite559 `(1,1,1)` in both. This field is not imported by
the current volley consumer; its exact native spatial interpretation is **not**
established by these screenshots.

All tests used the editor, blank level grass, Casual1.5, P1 **Chinese Castle**,
P2 **Teutons**, personality None, P2 allied to P1 while P1 remained hostile.
The alliance, not an assumption about None AI, kept targets stationary. Both
Chu Ko Nu tiers were editor-placed in Castle Age: visible attacks **8+1 / 10+1**.
No paid Elite upgrade, Imperial start, Chemistry or Rocketry was measured here.
No research/damage triggers or cheats. Each selected-target reading is paused;
`KeySteps '{F3}|{F3}'` advances approximately half a wall second. The table uses
the displayed **game clock**, not controller overhead as missile timing.
Automatic attacks during Test launch are excluded: table baselines can be wounded,
but each listed complete cycle is bracketed by later captured HP plateaus.

### Per-volley readbacks

`N` is normal Chu Ko Nu, `E` Elite. Clocks are mm:ss. Arrow-separated HP readings
are intermediate samples, **not** necessarily one sample per individual missile.
All values were observed visually, not inferred from the DAT count.

| Shooter / stationary target | Captured game-clock interval | HP readbacks per complete volley | Loss | Full-hit model | Evidence stems |
| --- | --- | --- | --- | --- | --- |
| N / War Elephant, 470HP, pierce2+1 | 00:12–00:14; 00:15–00:17; 00:19–00:21 | 445→439→437; 437→431→429; 429→423→421 | 8; 8; 8 | `(9−3)+2×1 = 8` | `cv-target-before`, `cv-normal-pulse01..12` |
| E / War Elephant, 470HP, pierce2+1 | 00:23–00:25; 00:26–00:28; 00:30–00:32 | 404→396→393; 393→385→382; 382→373→371 | 11; 11; 11 | `(11−3)+4×1 = 12` | `cv-elite-before`, `cv-elite-pulse01..12` |
| N / Battle Elephant, 250HP, pierce2 | 00:12–00:14; 00:15–00:17; 00:19–00:21 | 225→218→217; 217→210→209; 209→202→201 | 8; 8; 8 | `(9−2)+2×1 = 9` | `cv-battle-before`, `cv-battle-pulse01..12` |
| N / Farm, 480HP, pierce0 | 00:13–00:16; 00:17–00:19; 00:20–00:23 | 417→408→402; 402→393→387; 387→378→375 | 15; 15; 12 | `9+2×3 = 15` | `cv-farm-before`, `cv-farm-pulse01..13` |
| E / Farm, 480HP, pierce0 | 00:23–00:26; 00:27–00:29; 00:30–00:33; 00:34–00:36 | 367→353→347; 347→333→324; 324→313→304; 304→290→284 | 20; 23; 20; 20 | `11+4×3 = 23` | `cv-elite-farm-before`, `cv-elite-farm-pulse01..15` |
| E / War Elephant, 450HP, pierce2, nearby second elephant | 00:18–00:21; 00:22–00:25; 00:26–00:29; 00:29–00:31 | 450→439→437; 437→427→424; 424→413→411; 411→400→398 | 13; 13; 13; 13 | `(11−2)+4×1 = 13` | `cv-tight-target-before`, `cv-tight-target01..16` |

The zero-armour farm separates damage magnitudes: normal **9 then6**, and a full
Elite cycle **23**, agree with primary shooter strength plus secondary pierce3.
They reject all arrows using full shooter damage (27/55), or secondary arrows
inheriting the shooter's +1 (17/27). The unit controls support armour subtraction
and the minimum-one outcome, but do not independently determine every armour
class or fractional/collateral rule. Lower totals are retained as discrepancies
from an **all-hit** calculation, not relabelled as smaller DAT projectile counts.
Misses, spawning offsets and exact cadence are not separated by these samples.

### Neighbour test and reproducible limits

The accepted tight fixture was rebuilt from an empty scenario. P1 villager at
editor `(1280,700)`, Elite at `(1000,950)`; P2 target War Elephant `(1700,950)`,
neighbour placed `(1750,950)` with normal placement snapping. These are screen
placement coordinates, **not measured world-space centres/radii**. Test selection
used target `(1700,925)` and neighbour `(1790,900)`; the two selection rings and
panels are preserved in separate full frames. No other shooter or nearby target.

The Elite's **No Attack** stance was tooltip-verified (`cv-tight-stance`), then
it was moved to `(1300,950)` before a real right-click attack on the target.
Both elephants read **450/450 before the order**. `cv-tight-target01..16` loses
52HP in four cycles above; every corresponding `cv-tight-neighbour01..16` stays
**450/450**, through game00:31. Thus **no neighbour damage was observed at this
placement**. This is not proof that secondary arrows can never hit a neighbour,
nor a calibrated exclusion radius. An earlier wider vertical arrangement also
showed no damage, but its initial neighbour click selected nothing through fog;
only later selected baseline/control pairs are usable (`cv-pair-*`).

Rejected setup: attempting to replace farms with elephant pairs did not remove
the farms (`cv-neighbour-place`, `cv-farms-delete2`). No damage or collateral
claim uses that mixed layout; the clean/tight rebuild replaced it. No unchanged
HP from an unselected target is counted as a zero-damage measurement.

### Runtime comparison and handoff

`src/sim/game.ts` releases the primary with `combat.attacks`, snapshots subsequent
`volley.secondary.attacks`, subtracts each shared armour class and applies a
minimum of1. `releaseAttack` aims at the target with accuracy dispersion; ordinary
arrows can strike another entity at landing through `struckBy`. The importer
uses source counts and an **inferred animation-based interval**, without the
spawning-area field. The existing `chinese.test.ts` primary/secondary regression
deliberately enlarges a target to force full hits. It is useful arithmetic/count
coverage, **not** proof of native hit rate, spatial spread or timing.

The full-hit measurements support that damage split. The shortfalls do not
identify a sufficiently precise replacement for spatial/timing rules, so no
runtime approximation, weakened assertion or recording-version change was made.
Next bounded test: record individual missile trajectories against zero-armour
targets while varying range, orientation and measured neighbour offset. Establish
positive collateral if any, then reconcile the spawning-area consumer with
public-command outcomes and version-gate any behavior change.

`git diff --check` passed for this documentation-only follow-up. No Vitest/tsc,
verify/checkpoint, import, integration, commit, push, restart or deployment was
run. `cv-final-main-menu.png/json` confirms main menu, build185872, PID22012,
2560×1440 at15:54:38+01:00; inherited UHD-unchecked settings were unchanged.
No scenario saved. Process inspection found no remaining controller/test/typecheck
worker from this run; only the existing native game was intentionally left open.

## Earlier research-fix verification and cleanup

- `CIV_PROFILE_CONTENT=/home/fraser/repos/age-of-empires/public/imported/aoe2/manifest.json npx vitest run src/sim/chinese.test.ts src/sim/byzantines.test.ts src/sim/turks.test.ts src/sim/research-queue.test.ts src/sim/market.test.ts --maxWorkers=1`:
  **87 passed, zero skipped, exit0**,75.85s; `ch-tests.log`. Existing manifest
  read only; no regeneration or owned checkpoint.
- `npx tsc --noEmit -p .`: **exit0**, `ch-tsc.log`.
- Public-only `npx vitest run src/sim/chinese.test.ts --maxWorkers=1`:
  **3 passed / 30 owned cases skipped**, exit0,2.73s; `ch-public.log`.
  This is not a substitute for the zero-skip manifest-backed run above.
- `git diff --check`: exit0. Final process inspection found no remaining native
  controller, Vitest or typecheck worker from this run.
- Final `ch-final-main-menu.png/json`: main menu, version
  `101.103.54800.0 (#185872)`, same PID22012 and2560×1440. No scenario saved.
  No controller/test process intentionally left running. That research work was
  subsequently integrated as `98979f6`; it is not this follow-up's partial diff.
