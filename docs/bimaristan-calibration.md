# Bimaristan native calibration (#285)

## Current-build experiment, 2026-10-04

Native Steam **101.103.54800.0 (#185872)**, fullscreen2560×1440, default
zoom50%, Enhanced Graphics unchecked. This is current-build evidence, not the
pinned executable's acceptance. See [speed calibration](speed-calibration.md)
for the display/settings evidence and why game-clock intervals matter.

The native editor was used directly to create a blank flat-grass scenario:

- Player1 Saracens, Imperial start; one ordinary Monk and one Monk with Relic,
  separated widely across the visible map.
- Custom victory with no selected condition, allowing a controlled test.
- One enabled non-looping trigger: Damage Object, player1, quantity20; then
  Research Technology, player1, **Bimaristan**, item ID28, Force unchecked.
- The actual tested units had45 maximum HP, including the starting-age upgrades.
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
displayed regeneration value1 must not be treated as a fractional-rate readout.

### Timed one/two/zero-emitter control

A second manually staged layout replaced the ordinary Monk with a Knight and
placed two relic carriers nearby, well inside the source range. The Knight had
120 maximum HP after Imperial-start upgrades. The same20-damage/research trigger
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
| 0 | 20-damage event leaves100/120, still100/120 at02:01 |

The one- and two-emitter curves are consistent with the owned75HP/minute
(1.25HP/game-second) interpretation and **non-additive overlapping Bimaristan
auras**. A second emitter did not halve the recovery time. The zero-emitter
control rules out ordinary Knight regeneration as the cause. A separate sample
of one relic carrier receiving the other's aura recovered25→45 over approximately
16game seconds, consistent with the same rate.

The first one-emitter attempt was rejected: the Knight had pursued an enemy
before the intended selection, and no selected Knight HP was captured. The
replacement run set No Attack earlier and verified selection. No invalid run
is included in the table. Two-emitter capture selection and zero/one-emitter
deletions were also verified in full-screen captures.

Current-build evidence now supports the existing rate interpretation and
non-additive overlap in this interior fixture. Exact centre/edge range policy,
first-tick/expiry scheduling, garrison suppression, conversion inheritance,
save/reload and the team-bonus text/DAT discrepancy remain open. All pinned-runtime
acceptance remains distinct from these newer-build measurements.

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
