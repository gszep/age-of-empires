# Incendiaries native calibration (#252)

2026-10-06 — **BLOCKED / partial evidence; no runtime change.** Measured on
current build **185872, not pinned 48987**, under the owner's explicit approval.
All screenshot readings below were **observed visually**, not telemetry.

## Environment and source comparison

Live Windows PID **22012**, installed executable
`D:\SteamLibrary\steamapps\common\AoE2DE\AoE2DE_s.exe`. Single-player editor
Tests only; 2560×1440 fullscreen retained, inherited UHD-unchecked setting not
changed. Casual 1.5, Standard; P1 Goths/Castle, P2 Teutons/Dark in the final
fixtures (names/ages visible in selected-unit panels). No service restart,
import, owned checkpoint, deployment, or executable disassembly.

Resolved the pinned depot with `tools/depot.py`. Parsed both DATs with the
locked project's genieutils, read-only:

| DAT | SHA-256 |
|---|---|
| Pinned `depot_813781/resources/_common/dat/empires2_x2_p1.dat` | `ce3530df36cf0b333a9751cb0ff94460fe904f811feecec8ae9794701622b4cf` |
| Installed `D:\SteamLibrary\steamapps\common\AoE2DE\resources\_common\dat\empires2_x2_p1.dat` | `4aa2f0a719e88e5f1502517eddb27c669aeb40c2fe9d8c4f3eec7751c01e7baa` |

Technology **910**, effect **916**, and Gaia unit **2624** are each identical
as parsed objects between these files. Effect916 changes the four source ship
IDs 529/532/1103/1302 to dying graphic1751 and dead unit2624. Unit2624 has
HP−1, attacks10/class4 and5/class60, blast width3 and level2, dying graphic9347.
These are attack/armour classes, not unit classes: class4 is melee. This run
did not independently establish class60's localized label or target population.
Do not report a universal15 damage. Fishing Ship13 has melee armour1 and no
class60 armour entry in either inspected Gaia definition.

Relevant **differences**, not a whole-DAT equivalence claim:

- Fire Galley1103 class11 attack: pinned1 → installed0.
- Fire Ship529 and Fast Fire Ship532 ordinary dying graphic:2762 →813.
- Fishing Ship13 search radius:12 →30. Other parsed fields of these four
  inspected Gaia units matched. Archer4 and Dock45 also matched as parsed units.

Raw local receipts: `inc-dat.txt`, `inc-dat-differences.txt` in the evidence
directory below. No source assets were added to git.

## Native attempts and bounded observations

Evidence directory (ignored, durable on this host):
`/home/fraser/repos/age-of-empires/.local/worktrees/issue-252-incendiaries/.local/native/`.
Each action has a PNG and JSON receipt; crops retain their corresponding full
capture. No earlier #252 worker diff/failing-check log was present: this tree
started clean. Inherited coordinate recipes were read, not treated as outcomes.

Fixture: P1 Villager1280,700; shallow-water pond; Fire Ship1100,850;
P1 Fishing Ship1220,850; P2 Fishing Ships980,850 and1450,900; later P2
Villager1900,800. These are editor **pixel placement attempts**, not measured
world coordinates or a certified radius fixture. Research Technology effect:
source Player1, Force checked, Item ID910 (`inc-tech910-crop.png`). The native
panel confirms configuration, not a positive damage control.

| Capture(s) | Observed result / limit |
|---|---|
| `inc-before-fire`, `inc-before-own` | At00:13 selected Gothic Fire Ship120/120; own Fishing Ship50/50. |
| `inc-delete-pulse` | Delete followed by one resume/pause pulse:00:14, visible flame/smoke at the former ship position, with hull gone from that position. Deletion did not suppress all death feedback. This alone does **not** establish that the damaging Incendiaries payload fired. |
| `inc-own-after-delete`, `inc-delete-late-paused` | Own Fishing Ship remains50/50 at00:14 and00:24. Its unchanged HP is observed, but no positive in-radius enemy control makes this insufficient to certify the friendly-fire exclusion. |
| `inc-kill-config`, `inc-kill-p2-top-hp`, `inc-kill-p2-bottom-hp` | Research910 then Damage Object120 in one startup trigger killed the ship; both selected P2 fishing ships read50/50 at00:12. Their movement and unvalidated research/death ordering make this **inconclusive**, not evidence of zero explosion damage. |
| `inc-control-tech-off`, `inc-control-p2` | Attempted no-tech control (Item ID−1); no matched, stationary positive damage result was established. Not an accepted differential measurement. |
| `inc-timer1`, `inc-timedkill`, `inc-timed-top-hp`, `inc-timed-bottom-hp`, `inc-timed-pause` | Attempt to separate research from lethal damage using a second trigger/Timer1: both P2 fishing ships and own fishing ship still50/50 at00:12. No death frame or successful blast control captured; do not infer native timing or damage from this attempt. |

Early Tests were rejected: initial premature defeat; incorrect Diplomacy player
selection; later fire-ship attacks and fishing-ship fleeing. AI personality None
does not freeze unit reactions. The first negative damage result prompted a
separate timer attempt, not weaker acceptance criteria. Research activation,
trigger ordering, geometry and movement were not isolated well enough to assign
a single native cause. No code fix is justified by these data.

## Comparison, checks and remaining acceptance

`src/sim/game.ts`'s shared `kill` lifecycle currently applies the researched
death payload immediately, stores replacement art/duration, and includes Delete.
The existing Gothic regression asserts enemy damage, own-unit exclusion, death
art, JSON determinism, and deletion damage. Preserved unchanged.

- `npx tsc --noEmit -p .`: **exit0** (`inc-tsc.log`).
- `npx vitest run src/sim/goths.test.ts --maxWorkers=1`: **exit0**,1 passed,
  **18 skipped** because this worktree has no imported manifest (`inc-vitest.log`).
  This first run did **not** execute Incendiaries coverage.
- Read-only reuse of the existing primary-checkout manifest:
  `CIV_PROFILE_CONTENT=/home/fraser/repos/age-of-empires/public/imported/aoe2/manifest.json npx vitest run src/sim/goths.test.ts -t Incendiaries --maxWorkers=1`:
  **exit0**, Incendiaries1 passed,18 name-filtered;2.40s total (`inc-targeted.log`).
  This checks the existing implementation, not native equivalence. No regeneration.

**Still required:** validated research-positive damage control; exact enemy/own
ship and land-unit HP loss; class60 target semantics; docks; clear inside/outside
radius comparison; killed-versus-deleted damaging payload comparison; explosion
damage time versus sinking animation; real conversion/Heresy exceptions. Neither
conversion nor land/building fixtures were reached. Fine radius boundaries and
layer composition remain unmeasured. #252 must remain open.

Next attempt should establish research success independently (paid Imperial
research or a validated forced-research control), freeze reactions through a
verified stance/trigger, and capture one stationary enemy's HP before/after a
delayed lethal trigger. Only then expand targets or measure timing. The local
recipe notes identify tested UI controls but do not certify that whole fixture.

Final `inc-final-main-menu.png/json`: main menu, build185872, PID22012,
rectangle(0,0,2560,1440),2026-10-06T08:43:03+01:00. No scenario explicitly saved;
no controller/background job left running. Runtime/tests untouched; documentation
left uncommitted for coordinator review.
