# Stronghold native calibration (#306)

2026-10-06. **BLOCKED / partial:** rate and equal-source non-stacking observed;
infantry positive and cavalry/archer negative controls observed. Cargo results
support ordinary healing without an extra aura, but lack a paired no-Stronghold
control. Exact geometry, task-flag meaning and unit1831 remain unresolved.
No decisive disagreement with the current implementation; no runtime/test edits.

## Provenance

Measured on **current installed build 185872, not pinned 48987**, with owner
approval. All screenshot readings below are **observed visually**. Native
PID22012, fullscreen2560×1440, inherited UHD-off settings unchanged. Single-player
Scenario Editor Test, fixed **Celts**, Imperial start, Casual1.5 speed, one player,
custom victory without conditions. No cheats, paid research or saved scenario.
Imperial editor starts include earlier-age research: this is not a paid Stronghold
activation test. The Militia search did not expose normal Militia at this age;
the measured infantry is **Long Swordsman**, not Militia.

Evidence directory: `.local/native/` in durable worktree
`/home/fraser/repos/age-of-empires/.local/worktrees/issue-306-stronghold`.
Full PNGs and controller JSON receipts are retained locally, not committed owned
assets. `sh-final-main-menu.png` verifies the final menu/build; its receipt records
PID22012 and rectangle `(0,0,2560,1440)`. Local recipes retain tested coordinates.

The checkout began clean at `037b7dd`, with no partial diff or supplied cheap-worker
attempt/failing-check log. Issue306 had no comments. Inherited recipes describe
other tasks, not a prior306 attempt. No acceptance coverage was removed.

## Read-only source comparison

Resolved pinned root through `tools/depot.py`; inspected both DATs with locked
genieutils, without importing/publishing content. Installed source:
`D:\SteamLibrary\steamapps\common\AoE2DE\resources\_common\dat\empires2_x2_p1.dat`.

| DAT | SHA-256 |
| --- | --- |
| Pinned | `ce3530df36cf0b333a9751cb0ff94460fe904f811feecec8ae9794701622b4cf` |
| Installed | `4aa2f0a719e88e5f1502517eddb27c669aeb40c2fe9d8c4f3eec7751c01e7baa` |

Complete tech482 and effect537 records compare equal. EffectFunction8 has the
same task assignments: work30/1, range7, owner4, combat flag4, wait109, gather21,
infantry class6 and WarriorPriestWithRelicID1831. Installed XS moves CastleID82
and WarriorPriestWithRelicID1831 from local declarations to global constants;
this does not decode the native scheduler or flag meaning.

Complete Celts unit74,4,1831 records compare equal. Differences in inspected
records: Castle82 gains annex2718 at offset2/2; Long Swordsman77's first attack
amount changes6→8; Knight38 blast_attack_level changes0→2. Do not call the full
unit records patch-identical. Castle garrison rate remains approximately0.2;
Herbal Medicine effect41 retains ×6 garrison-rate commands. Dumps:
`sh-dat.txt`, `sh-dat-diff.txt`, `sh-garrison-source.txt`.

## Stationary healing and overlap

Initial Long Swordsman placement `(1280,700)`, Castle A `(1600,700)`, B
`(1100,450)`. These are editor clicks, **not surveyed world centres**. A default-on,
non-looping Damage Object trigger subtracts50 from the infantry's60HP.
Each row is a fresh Test with the indicated sources and identical patient.

| Sources | Capture stems | Game clock | HP |
| --- | --- | --- | --- |
| A | `sh-one-start` → `sh-one-end` | 00:13→00:41 | 16→30 /60 |
| A+B | `sh-two-start` → `sh-two-end` | 00:12→00:41 | 16→30 /60 |
| B only | `sh-b-start` → `sh-b-end` | 00:13→00:42 | 16→31 /60 |
| Neither | `sh-none-start` → `sh-none-end` | 00:12→00:41 | 10→10 /60 |

Both Castles independently heal the same recipient. Together they do not double
healing. Observations support **30 HP/minute = 0.5 HP/game-second**, agreeing
with `updateHealingAuras`; they decisively exclude30HP/second. Integer clocks/HP
do not establish fractional cadence, first-pulse timing or exact cap behavior.
Equal-rate sources cannot distinguish strongest-source selection from other
non-additive policies for unequal sources.

## Eligibility and cargo

With A restored, separate20-damage trigger targets give:

| Recipient | Capture stems | Game clock | HP |
| --- | --- | --- | --- |
| Knight | `sh-knight-start` → `sh-knight-end` | 00:13→00:42 | 80→80 /100 |
| Crossbowman | `sh-archer-start` → `sh-archer-end` | 00:12→00:41 | 15→15 /35 |

They stood near A, placed `(1350,800)` and `(1280,800)` respectively. These
negative controls support the existing class filter, not an exhaustive proof
that class6 plus1831 are the only eligible identities. Unit1831 was not tested.

The original infantry successfully entered A using the explicit garrison button;
`sh-board3-check`/`sh-board3-hover` show1/20 occupancy and a Long Swordsman icon.
After unloading, `sh-cargo-baseline` shows32/60 at00:30. Reboarding via a short
F3 pulse gives1/20 at00:31 (`sh-reboard-pulse`); occupancy remains1/20 at00:48
(`sh-cargo-end`). Unload and another short pulse:54/60 at00:48
(`sh-cargo-out`). No endpoint reaches the cap.

This +22 over roughly18 game seconds, mostly inside, is consistent with ordinary
0.2×6 Herbal Medicine healing, not that rate plus0.5 aura healing. However,
boarding/unloading time is included, and Herbal Medicine activation was not
independently toggled/read back. **Supportive, not an isolated cargo-rate proof.**
A same-age no-Stronghold control and Castle-age/no-Herbal comparison remain needed.
The runtime's base0.2/no-extra-aura policy is not changed on this evidence.

## Geometry: rejected setup, not a calibration

An editor Move attempt did not move the original infantry. `sh-orth-move` and
`sh-orth-{start,end}` still show the original close fixture; the16→30 result is
**not** a measurement at the requested offset.

Two additional infantry were placed at clicks `(2000,900)` and `(2192,712)`.
Editor camera shifts and Test recentering invalidated the assumed offset mapping.
Initial Test selection clicked empty ground (`sh-geometry-orth-{start,end}`),
so those panels contain no HP measurement. Corrected selection `(2070,1005)`
gave40/60 at00:41 and00:58 (`sh-geometry-orth-selected`,
`sh-geometry-orth-late-end`): a far-away non-healing control only. The second
new infantry was not measured damaged. Neither provides matched-distance
orthogonal/diagonal evidence.

**No conclusion** about centre versus footprint edge, circle versus square,
inclusion exactly at7, recipient radius or search cadence. The existing inclusive
centre-circle implementation remains inferred. Follow-up should establish the
actual grid/world coordinates after each camera shift before interpreting HP.

Other rejected setup: direct right-click on the Castle moved infantry behind
the roof; `sh-boarded`/`sh-board-check2` show0/20. They are not cargo evidence.
The fresh explicit-button third attempt is the accepted admission observation.

## Checks and remaining work

- `npx vitest run src/sim/celts.test.ts --maxWorkers=1`: exit0, **21 skipped**,
  0.805s, because this worktree has no imported manifest (`sh-vitest.log`).
- Reused the existing main-checkout manifest read-only, without import:
  `CIV_PROFILE_CONTENT=/home/fraser/repos/age-of-empires/public/imported/aoe2/manifest.json npx vitest run src/sim/celts.test.ts --maxWorkers=1`:
  exit0, **21 passed**,15.39s (`sh-celts-profile-vitest.log`). Manifest SHA-256
  `c310cfe720c15af652e0a6a15b0f6f2dccd5cadfa1f4e21cbd571b71a6e55fb4`.
- `npx vitest run src/sim/monastery.test.ts --maxWorkers=1`: exit0,
  **16 passed**,4.09s (`sh-monastery-vitest.log`).
- `npx tsc --noEmit -p .`: exit0 (`sh-tsc.log`). No test clocks widened.
- No runtime/test changes, owned checkpoint, import, push, integration, service
  restart or deployment. These tests retain baseline acceptance, not proof of
  native geometry. All controllers exited; native game PID22012 remains at menu.

Keep #306 open: exact geometry, task flag4 versus2 semantics, unit1831, allied
ownership, construction/death edges, unequal overlapping auras and isolated
garrison scheduling are unverified. Results on185872 do not certify pinned48987.
