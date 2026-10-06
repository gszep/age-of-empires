# Native gate calibration — partial (#133)

2026-10-06. **BLOCKED for completion**, not a native-parity pass.
Observed visually on installed DE **build 185872, not pinned 48987**, with
owner authorization. PID 22012; fullscreen 2560×1440; inherited UHD-unchecked
settings were not changed. Single-player Scenario Editor/Test only. No cheats,
research effects or gate-state triggers. No scenario was saved.

## Accepted observations

Player 1 was Teutons, Dark Age, with one female Villager. An editor-placed
`Palisade Gate (down.)` was subsequently replaced by `Gate (down.)` (stone).
The owner's ordinary move orders produced these visible outcomes:

| Fixture | Observed visually | Evidence under `.local/native/` |
| --- | --- | --- |
| Palisade, passage | Lowered grille at clock 00:51–00:53; raised at 00:54–00:55; lowered at 00:56, with the villager still nearby | `gate-return-pulse1.png` through `gate-return-pulse8.png`; `gate-return-contact-sheet.png` |
| Stone, passage | Closed beside the idle owner at 00:24; raised during passage at 00:25–00:26; lowered at 00:27, owner behind the right post | `gate-stone-adjacent.png`, `gate-stone-pulse1.png` through `gate-stone-pulse6.png`; `gate-stone-contact-sheet.png` |
| Stone, stationary doorway | Grille remained raised with the stationary owner under it at 00:26 and 00:35 | `gate-stationary-paused.png`, `gate-stationary-hold.png` |
| Stone, departure | After ordering that owner away, still raised at 00:36; lowered at 00:37 | `gate-depart-pulse1.png` through `gate-depart-pulse3.png`; `gate-stationary-contact-sheet.png` |
| Diagonal-to-tile-grid placement | Editor successfully placed `Palisade Gate (hori.)`, screen-horizontal rather than following either tile axis | `gate-diagonal-grid.png`, `gate-diagonal-clear.png` |

The last placement is verified after leaving Place mode, not merely from its
red overlapping placement preview. It establishes an editor placement/art
variant, **not** paid construction, collision topology or diagonal passage.

Palisade and stone therefore share the observed qualitative open/pass/close
behavior. The stationary stone control rules out a requirement that the owner
must keep moving to hold it open. It does not identify the contact formula.
These are sampled rendered poses, not a readback of native obstruction state.
The one-second displayed-clock brackets are **not** measured close delays:
the instant of leaving the trigger region was not independently established.

## Geometry and rejected attempts

The initial editor fixture used Villager placement `(1280,700)` and gate
placement `(1600,700)`. In Test, approach destinations were `(1408,796)`,
`(1446,790)`, `(1494,766)` and `(1542,742)`, followed by passage to `(1734,646)`
and return to `(1542,742)`. Stone passage used `(1686,670)`; the stationary
doorway control used `(1590,718)` then departure to `(1542,742)`.
Coordinates are full-resolution **screen pixels**, not world coordinates.

Captures named `gate-{four,three,two,one}-paused` are attempted distance
buckets, **not validated tile distances**. Grid captures exist, but the Test
camera shift, snapped gate center and actual unit destination were not tied to
an authoritative tile-coordinate reading. Do not turn those filenames into a
measured one-tile threshold or a new constant. Approach was across the doorway;
a separate approach along the gate's long axis was not calibrated.

The allied fixture placed a Player 2 Villager at `(1800,850)` and selected
mutual Ally in the editor (`gate-mutual-ally.png`). Ctrl+Shift+F2 changed the
Test view. The selected red villager moved away instead of remaining at the
ordered doorway: `gate-ally-door-order.png` → `gate-ally-door-paused.png`.
A focused retry explicitly verified Player 2 Personality **None**
(`gate-fix-ai-pane.png`), but the subsequent initial Test capture again showed
the unit displaced (`gate-ally2-switch.png`). Neither attempt establishes
allied gate behavior. The Player Type list exposed AI/Either, not a tested
human-only control. No further uncontrolled retries were counted as evidence.

Enemy-in-doorway closure, owner/enemy simultaneous contact, Gaia and diplomatic
neutral exclusion were **not measured**. Fortified gates were not tested.

## Comparison and remaining work

`src/sim/gates.ts` currently uses an owner-only axis-aligned 2.5-tile center
box, other non-Gaia players as enemies, doorway half-extents plus unit radius
for enemy contact, and immediate pre-movement-tick transitions. Gaia is ignored.
The existing owned-DAT/source audit is recorded in the ledger and issue;
this run did not repeat the DAT extraction or inspect executable code.

The native gate shutting while its owner remains visually adjacent makes the
broad center-box rule suspect. **No replacement radius, contact predicate or
delay is justified by these captures.** Runtime and all existing regression
coverage remain unchanged rather than replacing an admitted inference with
another uncalibrated formula. Native parity remains blocked on:

1. Tile-identified stationary buckets and approach along both directions;
   distinguish doorway contact from a wider owner trigger region.
2. A controlled second-player fixture that retains orders, for enemy contact,
   allied and diplomatic-neutral cases; a separate non-converting Gaia case.
3. Departure/contact-boundary timestamps independent of the rendered pose.
4. Diagonal construction and passage, not merely editor placement.

## Checks and handoff

- `npx vitest run src/sim/gates.test.ts --maxWorkers=1`: **15/15 passed**,
  exit 0, reported duration 4.43 s; `.local/gate-vitest.log`.
- `npx tsc --noEmit -p .`: **passed**, exit 0; `.local/gate-tsc.log`.
- These validate the unchanged implementation, not native fidelity.
- No owned checkpoint, import, browser smoke, deployment, service restart or
  push. `tools/gates_smoke.mts` was not run (no runtime/view edits).
- Initial worktree at `6597afa` was clean: no cheap-worker partial diff or
  gate-specific failed-check artifact was supplied. Inherited control recipes
  and their rejected positioning attempts were read before native work.
- Final `gate-final-main-menu.png` and matching JSON confirm main menu,
  PID 22012, 2560×1440, build 185872. Native controller calls completed; no
  controller/test background process remains. Game process intentionally lives.

Evidence is retained in the durable issue-133-gate worktree's ignored
`.local/native/`; do not commit the game screenshots or discard that directory
when integrating the two documentation files.
