# Chinese native calibration — #260

2026-10-06: **measured on current build 185872, not pinned 48987**, with
owner authorization. All screenshot readings below are **observed visually**.
Overall result: **partial / BLOCKED for full issue acceptance**. Research-price
rounding has a decisive native disagreement and a tested fix; weapon scheduling,
primary/secondary damage separation and the complete opening remain unresolved.

## Environment and provenance

- Existing Windows PID **22012**, executable
  `D:\SteamLibrary\steamapps\common\AoE2DE\AoE2DE_s.exe`.
- Fullscreen 2560×1440; inherited UHD-unchecked settings left unchanged. No game
  restart, service restart, import, checkpoint, integration, commit or push.
- Single-player editor Tests only, Casual 1.5. No cheats or research/damage
  triggers. Test starting ages automatically grant earlier-age technologies;
  these are separate starts, **not** a paid age-up experiment.
- Durable private evidence is this worktree's `.local/native/ch-*.png/json`;
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

Remaining #260 acceptance: repeat Chu Ko Nu volleys against a stationary
lower-pierce-armor high-HP target with isolated first/secondary impacts; establish
Elite hit/miss accounting; positively capture firearm strikes; stage actual water
for Lou Chuan and measured bystander geometry; test Rocketry/Chemistry order;
use a normal random-map opening for resource deductions and a paid age ladder for
transition timing. Farm rounding/reapplication and capture/in-flight semantics
also remain open. Native current-build evidence does not certify pinned48987.

## Verification and cleanup

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
  No controller/test process intentionally left running. Work remains uncommitted.
