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
