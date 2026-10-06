# Zero-time research calibration (#254)

## Native evidence, 2026-10-04

Current Steam **101.103.54800.0 (#185872)**; not the pinned executable. Two
separately saved native-editor scenarios used a blank grass map, Feudal player1,
one male Villager,1000wood and zero food/gold/stone, no buildings and no triggers.
One used Franks, the control Britons. Custom victory allowed the experiment to
continue. The owned definitive economic-build menu was used to place and finish
a real60-wood farm after the match had begun. No Mill or TC was built, and no
technology was explicitly researched.

- **Franks:** wood fell1000→940; the selected completed farm retained **243food**
  after a little harvesting. This exceeds the unupgraded175 capacity outright.
- **Britons control:** after stopping the worker, the farm retained **165food**
  and the villager carried **10food**, with zero banked: **175total**. The farm
  was paid and built through the same commands, with no Mill.

These are newly constructed farms, not editor-preplaced farms whose initialization
order might differ. The experiment establishes that a Feudal Frankish farm can
receive its free upgrade without a completed Mill. It does not independently
measure the exact activation tick, Teuton Murder Holes/Herbal Medicine, or every
later-age/free technology. Pinned-runtime confirmation remains open.

Native scenarios were saved through the game as
`OpenEmpires-20261004-franks-no-mill` and `OpenEmpires-20261004-britons-no-mill`.
Private captures under `.local/` include `native254-franks-real.png` (setup),
`native254-build-menu.png` (sole villager/no buildings), `native254-farm-food.png`
(Frankish243), and `native254-britons-{stopped,farm-selected}.png` (10+165 control).
The earlier `franks-confirmed` filename was an unsuccessful selector attempt;
only the later `franks-real` and in-game **Franks** labels establish the test civ.

## Pinned source and correction

Re-read `empires2_x2_p1.dat` through the resolved owned depot:

- Horse Collar14 has required count1 of101/758.101 is Feudal Age;758 is a
  foreign civ36 alternative. Its research locations68/2556 are separate fields.
- Heavy Plow13 requires count2 of102/14/761; Crop Rotation12 requires count2
  of103/13/766. Foreign alternatives do not bypass the Frankish age chain.
- Frank tree258 zeroes costs and research times of14/13/12.
- Teuton tree262 zeroes research times of322/441;322 retains200food in the source
  despite the owned free-tech description, as previously documented.

The scheduler incorrectly added a completed research-location requirement after
the imported prerequisite check. Automatic nodes now follow the explicit
prerequisites; `triggeredByBuildings` still requires its building. Ordinary paid
research still requires the appropriate producer through the public command path.

Applying that interpretation to the other zero-time technologies is **inferred
from the shared DAT representation**, not newly measured native Teuton parity.
The source-backed age/predecessor gates, disabled/foreign-node rejection,
resource bills and once-only research journal are preserved.

## Regression boundary

The simulation regression builds farms without a Mill at Feudal/Castle/Imperial
and verifies250/375/550food, no research payment, preserved age gates, no duplicate
bonus/refill after subsequent Mill completion, and JSON continuation. The native
measurement above covers Feudal; the later-age amounts also use owned effects.
The maintained full-profile browser scenario now actually places the early farm
**before** the Mill for both Britons and Franks, then retains its existing paid
age/unique-unit/research and art checks. No clocks are widened.

## Teuton native evidence, 2026-10-06

**Measured on current build 185872, not pinned 48987.** All HP, resource,
clock and panel readings below were **observed visually**, not extracted from
native memory. PID 22012; fullscreen 2560×1440; UHD remained unchecked, with
no graphics change or restart. Editor Tests only, Casual 1.5 speed.

Private evidence root (not committed):
`.local/worktrees/issue-254-zero-time/.local/native/` relative to the primary
checkout. Each named PNG has an action/foreground/PID JSON receipt beside it.

Player 1 was Teutons, initially one female Villager, 2000 wood, 1000 food,
zero gold/stone. The blank-map fixture acquired a Watch Tower, then an adjacent
Player 2 Battering Ram. There was **no University or Monastery**. No research
command, resource cheat or research trigger was used.

| Outcome | Observed result | Captures under evidence root |
| --- | --- | --- |
| Close-range fire without University | Castle Age: adjacent attacking ram fell **169→165/175 HP**, clock **00:12→00:21**. Tower was the only attacker. | `zero-ram-before.png`, `zero-ram-after.png` |
| Age control, unchanged tower/ram positions | Dark Age: ram remained **175/175 HP**, **00:10→00:19**, while damaging the tower. | `zero-dark-before.png`, `zero-dark-after.png` |
| Starting resource bill | Editor configured **1000 food**; Castle and Dark Tests retained **1000**. No residual 200-food deduction was observed at Castle initialization. | `zero-food.png`, both ram pairs |
| Later paid research venues | University was built during Test: wood **2000→1800**. Monastery followed: **1800→1625**. Food remained **1000**; captured panels have no Murder Holes/Herbal Medicine button identified. Panel evidence is supplementary, not the proof of pre-venue activation. | `zero-university-panel.png`, `zero-monastery-verified.png` |
| Healing without Monastery | In a fresh Castle Test, a one-shot **Damage Object 30** trigger wounded the villager to **10/40**. Boarding the tower and unloading yielded **17/40**, clock **00:10→00:26**. Neither research venue existed in this fresh Test. | `zero-damage-object.png`, `zero-injured.png`, `zero-healing-paused.png` (1/10 occupancy), `zero-healed-final.png` |
| Healing age control | Dark Test, same path/tower, Damage Object **15** gave **10/25→11/25**, clock **00:10→00:27**. Different max HP is visible (Castle-start upgrades); neither result hit maximum HP. | `zero-control-quantity-fixed.png`, `zero-control2-injured.png`, `zero-control2-paused.png`, `zero-control2-final.png` |
| Cleanup | Main menu, build **185872** visible; no scenario explicitly saved. | `zero-final-main-menu.png` |

The healing sequence used the same paused boarding order, eight-wall-second
resume delay, pause, passenger-icon unload, brief resume and idle-villager
selection. Clock spans include walking/unloading, not solely time garrisoned;
integer HP is rounded. Thus **faster healing without a Monastery** is measured,
not an exact rate or multiplier. The ram comparison establishes adjacent fire,
not an independently read numeric minimum-range attribute. Together these
outcomes support Murder Holes and Herbal Medicine activation without their
research locations, consistent with the implementation's explicit DAT gates.

Failures retained rather than counted as evidence: initial attempts to wound
the villager through an enemy Militia failed because it fled; the first
Monastery placement missed the builder (use the later `real-*`/`verified`
captures); the first Dark healing control edited the trigger **description**
instead of its effect, leaving 30 damage and killing the 25-HP villager
(`zero-control-final.png`). Selecting the Damage Object effect row and verifying
Quantity 15 fixed that fixture; only `zero-control2-*` is accepted.

**Remaining scope:** these are separate editor starting-age Tests, not a paid
in-match age-up. Exact activation tick/fixed-point ordering, resource accounting
across a live Castle completion, precise healing multiplier, and pinned-runtime
confirmation remain open under #254. There is no observed contradiction requiring
a runtime change. Existing automatic scheduling, prerequisites, once-only journal
and acceptance tests are unchanged. No build/checkpoint/import was run for this
documentation-only calibration.
