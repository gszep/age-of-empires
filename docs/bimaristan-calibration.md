# Bimaristan native calibration (#285)

## Current-build experiment, 2026-10-04

Native Steam **101.103.54800.0 (#185872)**, fullscreen2560×1440, default
zoom 50%, Enhanced Graphics unchecked. This is current-build evidence, not the
pinned executable's acceptance. See [speed calibration](speed-calibration.md)
for the display/settings evidence and why game-clock intervals matter.

The native editor was used directly to create a blank flat-grass scenario:

- Player1 Saracens, Imperial start; one ordinary Monk and one Monk with Relic,
  separated widely across the visible map.
- Custom victory with no selected condition, allowing a controlled test.
- One enabled non-looping trigger: Damage Object, player1, quantity 20; then
  Research Technology, player1, **Bimaristan**, item ID28, Force unchecked.
- The actual tested units had 45 maximum HP, including the starting-age upgrades.
  This is not a claim about unupgraded30-HP monks.
- No building, allied healer or other friendly unit was present. The ordinary
  Monk and relic carrier were initially idle and outside each other's healing
  range. The native test launched at Casual1.5 after the earlier Game-pane reset.

### Direct observations

| State | Native game clock | Selected unit | HP | Native regeneration indicator |
|---|---|---|---|---|
| Isolated | 05:45 | Monk | 25/45 | 0 |
| Isolated | 10:46 | Monk with Relic | 25/45 | 0 |
| Isolated, later | 24:01 | Monk with Relic | 25/45 | 0 |
| Relic carrier moved next to ordinary Monk | 30:04 | Monk with Relic | 45/45 | 1 |
| Same neighbouring pair | 33:45 | Monk | 45/45 | 1 |

The neighbouring pair is the important positive control: the ordinary Monk has
no other healer, and a relic carrier cannot perform ordinary direct healing.
Its recovery therefore supports a functioning relic-carrier aura. The relic
carrier's own recovery can include the ordinary Monk's direct healing and is
not a separate aura-rate measurement.

These observations support **no self-healing** and **aura healing while carrying
a relic** in this current build, matching the existing implementation. The
displayed regeneration value 1 must not be treated as a fractional-rate readout.

### Timed one/two/zero-emitter control

A second manually staged layout replaced the ordinary Monk with a Knight and
placed two relic carriers nearby, well inside the source range. The Knight had
120 maximum HP after Imperial-start upgrades. The same 20-damage/research trigger
was gated by a60-game-second Timer. The Knight was given No Attack (`F`, the
owned definitive binding), preventing automatic pursuit out of the fixture.
Native restart was used for each run. Public Delete removed one or both relic
carriers before the damage event for the corresponding controls; dropped relics
are visible in the captures. No ordinary monk/direct-healing source was present.

The capture process sampled the F11 clock and selected-unit HP once per wall
second, with monotonic/UTC brackets. Compare **game** times rather than sample
indices, since startup/selection lengths differ. The displayed integer clock and
HP introduce endpoint quantization; these measurements discriminate doubled
healing, not individual engine scheduling ticks.

| Living nearby relic carriers | Selected Knight observations, game time → HP |
|---:|---|
| 2 | 00:59→120; 01:00→100; 01:03→104; 01:06→108; 01:09→112; 01:12→115; 01:15→119; 01:17→120 |
| 1 | 00:58→120; 01:00→101; 01:03→104; 01:06→108; 01:08→112; 01:11→115; 01:14→119; 01:16→120 |
| 0 | 20-damage event leaves 100/120, still 100/120 at02:01 |

The one- and two-emitter curves are consistent with the owned 75HP/minute
(1.25HP/game-second) interpretation and **non-additive overlapping Bimaristan
auras**. A second emitter did not halve the recovery time. The zero-emitter
control rules out ordinary Knight regeneration as the cause. A separate sample
of one relic carrier receiving the other's aura recovered 25→45 over approximately
16 game seconds, consistent with the same rate.

The first one-emitter attempt was rejected: the Knight had pursued an enemy
before the intended selection, and no selected Knight HP was captured. The
replacement run set No Attack earlier and verified selection. No invalid run
is included in the table. Two-emitter capture selection and zero/one-emitter
deletions were also verified in full-screen captures.

Current-build evidence supports the existing rate interpretation and
non-additive overlap in this interior fixture. The October 6 continuation below
also measures garrison suppression and the team-bonus tooltip discrepancy.
Exact centre/edge range policy, first-tick/expiry scheduling, conversion
inheritance and save/reload remain open. All pinned-runtime acceptance remains
distinct from these newer-build measurements.

### Evidence and reproducibility boundary

Private screenshots are under `.local/`:

- `native285-research-verified.png`: native Bimaristan name, ID28 and trigger.
- `native285-globalvictory.png` and `native285-triggers.png`: unit separation
  and editor staging; the former precedes the Custom selection.
- `native285-self-monk-result.png`, `native285-self-relic-result.png` and
  `native285-right-click-debug.png`: isolated HP/clock observations.
- `native285-relic-short-click.png`, `native285-relic-aura-recipient.png`:
  neighbouring pair and recovery.
- `native285-knight-{two,one-r2,zero}-{0..65}.png` and corresponding JSON:
  timed Knight curves; their `-contact.png` files collect the damage/recovery
  windows. `native285-{knight-selected,one-r2-selected,zero-selected}.png`
  verify the selected unit, emitter counts and dropped relics.
- `native285-stack-{0..65}.png`: selected relic carrier's own recovery curve;
  despite its initial filename, this was **not** the Knight overlap measurement.
- `native285-knight-one-*` without `-r2`: rejected selection/pursuit attempt.

The attempted generated scenario was **not loaded**, so parser round-trip checks
are not native gameplay evidence. Its GPL parser was evaluated only in a private
external locked environment; no parser code or dependency entered the repository.
The actual experiment above was staged through the native editor controls.

Native automation detail: with right-button drag scrolling enabled, a250ms
synthetic right press did not issue the expected move. A50ms press/release did,
and movement was verified before interpreting healing. The earlier failed move
attempts are retained and are not counted as aura-range observations.

## Team bonus and garrison continuation, 2026-10-06

**Measured on current build 185872, not pinned 48987.** All screenshot readings
below were **observed visually**. Same live PID22012, fullscreen2560×1440;
graphics settings were not changed (inherited UHD unchecked). Editor Test only;
no scenario saved. No runtime or regression-test changes: the accepted native
outcomes agree with the existing implementation.

### Installed versus pinned source

Read-only parsing used the pinned root resolved by `tools/depot.py` and installed
`D:\SteamLibrary\steamapps\common\AoE2DE`. DAT SHA256 values:

- Pinned: `ce3530df36cf0b333a9751cb0ff94460fe904f811feecec8ae9794701622b4cf`.
- Installed: `4aa2f0a719e88e5f1502517eddb27c669aeb40c2fe9d8c4f3eec7751c01e7baa`.

Both effect409 commands are type4, target class0, attribute9, packed5379
(21×256+3). Both Archer4 and Skirmisher7 have DAT unit class0 and base class21
attack0. Thus class0 here selects **attacking units**, not target armour.
Both English120158 descriptions still say +2 against buildings.

Both effect28 commands invoke XS function7, whose work75/1, range5, owner4,
combat-level2, search-wait109 and gather-type21 match. The XS implementation
is **not identical**: pinned explicitly adds tasks for listed recipient classes;
installed uses `xsModifyObjectTasks` with a class-removal mask excluding
buildings, siege and ships. These experiments do not establish equivalence for
all recipient classes, nor justify replacing the pinned target list.

### Team-bonus tooltip control

One-player Dark-start blank fixture: Villager, Archer, Skirmisher; no research
or triggers. Restarted the same layout with Teutons as the control. Civilization
and selected unit names were verified in each capture. Native tooltip spelling:

| Unit | Saracens | Teutons control |
|---|---|---|
| Archer | Standard Buildings: **3**; Piercing Damage:4; Spearmen:3 | No Standard Buildings line; Piercing Damage:4; Spearmen:3 |
| Skirmisher | Standard Buildings: **3**; Archers:3; Piercing Damage:2; Spearmen:3 | No Standard Buildings line; Archers:3; Piercing Damage:2; Spearmen:3 |

This resolves the **current-build attack readout** in favour of DAT +3, not
description +2. It is not a measured building-HP strike or a non-Saracen ally
test. Preserve DAT arithmetic and original localization; do not silently change
either to make the discrepancy disappear.

### Garrisoned ordinary and relic-carrying monks

Saracen Imperial-start fixture: one relic carrier, Guard Tower, Crossbowman
(the earlier Archer upgraded with the starting age), spare Villager and distant
Skirmisher. A non-looping Timer60 trigger damages the selected Crossbowman20
and researches Bimaristan28 for Player1, Force unchecked. Before the trigger,
Alt-right-click garrisons the monk; the Crossbowman moves beside the tower.
Host selection verifies **1/5** and the passenger portrait. The patient remains
outside. There is no second monk or other healer.

| Passenger | Garrisoned patient HP / game clock | After unloading |
|---|---|---|
| Monk with Relic | 15/35 at01:29; still15/35 at02:01 | 35/35 at02:30 |
| Ordinary Monk (same carrier dropped its relic before boarding) | 15/35 at01:29; still15/35 at02:02 | 35/35 at02:32 |

Both support no exterior healing from the garrisoned source in this fixture.
The unloaded relic carrier is the decisive passive-aura positive control:
it cannot directly heal. Recovery after unloading the ordinary Monk can include
direct healing, so it is not a separate aura-rate measurement. Research took
effect while the source was inside; an already-active aura entering a building,
garrisoned recipients, other hosts and immediate expiry timing remain unmeasured.
No exact world-space distance is inferred from placement pixels.

### Rejected attempts, remaining work and evidence

Initial plain right-clicks moved monks beside the tower rather than boarding;
captures named `bim-garrison-*` and `bim-board-*` are **not** garrison evidence.
The first distant patient stayed wounded until the relic carrier moved closer;
this is not a range5 boundary measurement. Owned localization3914 identifies
Alt-right-click garrisoning; only the subsequent occupancy-verified runs count.

The conversion attempt is rejected. After adding Player2 Teutons/None and a
Monk/Knight, Test camera positions changed: the old Player1 monk/drop click did
not select the intended unit. By01:20 the Player1 monk was absent and population
had fallen2→1, before any verified conversion order/ownership transition. The
cause was not isolated. No captured-monk healing observation was obtained.
Do not treat this as aura loss or conversion inheritance evidence. A fresh
fixture must verify positions, prevent automatic reactions and isolate the
converter from the wounded recipient. Conversion research inheritance, exact
range5 boundary and allied team-bonus readouts remain unresolved under #285.

Private evidence is retained in the durable `issue-285-bimaristan` worktree's
`.local/native/` (not committed assets):

- `bim-source-compare.txt`, `bim-host-source.txt`: source fields and XS comparison.
- `bim-{sara,control}-{archer,skirm}-attack.png`: four attack tooltips.
- `bim-{damage-value,timer-value,research-verified}.png`: trigger staging.
- `bim-r2-host.png`, `bim-r2-patient-{before,after}.png`,
  `bim-r2-positive-after.png`: relic passenger and HP controls.
- `bim-ordinary-r3-{host,patient,after,unloaded-select}.png`,
  `bim-ordinary-positive-result.png`: ordinary passenger and HP controls.
- `bim-conv-*.png`: rejected conversion setup and changed camera/roster.
- `bim-final-main-menu.png` and JSON: final main menu, build185872,
  PID22012 and2560×1440 rectangle, at2026-10-06T09:15:51+01:00.

The local `alt-click.ps1` wrapper releases Alt in `finally`; no controller or
background calibration job remains. No game restart, import, checkpoint,
service restart or rollout was performed.

### Repository checks

No runtime/test edits were made. Existing acceptance coverage was retained:

- `CIV_PROFILE_CONTENT=/home/fraser/repos/age-of-empires/public/imported/aoe2/manifest.json npx vitest run src/sim/saracens.test.ts --maxWorkers=1`:
  **10 passed**, exit0,6.86s, using the existing October6 manifest read-only.
- `npx tsc --noEmit -p .`: exit0.
- `git diff --check`: exit0.

The first test invocation used the old October3
`/home/fraser/repos/age-of-empires/.local/saracens-content.json`: all10 failed
at fixture creation with `arabia: cannot place 2/2 relics for 1 without weakening
RMS constraints`, before Saracen assertions. The unchanged suite passes with
the current manifest; no fixture constraints were weakened and no import ran.
Logs: `bim-vitest.log`, `bim-vitest-current.log`, `bim-tsc.log` in the evidence
directory. Passing simulated captured-aura coverage is not native conversion
calibration. Full owned verification was not run without the coordinator slot.
