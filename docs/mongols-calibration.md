# Mongols calibration (#305)

## Provenance and limits

2026-10-06, **measured on current build 185872, not pinned 48987**,
owner-authorized installed DE process 22012. All screenshot readings below are
**observed visually**, not internal engine values. Single-player scenario editor
only; fullscreen 2560×1440, inherited UHD-unchecked configuration unchanged.
No game restart, multiplayer, save overwrite or service change. Final main menu
capture confirms version 101.103.54800.0 (#185872).

Evidence root (ignored, retain with this worktree):
`/home/fraser/repos/age-of-empires/.local/worktrees/issue-305-mongols/.local/native/`.
Every named capture has a full-resolution `.png` and an action-receipt `.json`.
Montages are derived crops; originals remain authoritative.

Pinned source was independently read through `tools/depot.py` / the DAT test
loader: `.local/nomads-source.log`. Tech 487/effect 542 replaces House
70/463/464 with 191; automatic 641/effect 681 requires 487 and Imperial 103
and replaces 70/463/464/465/191 with 192. Replacements are class 3 Houses,
resource 4 amount 5 flag 8, versus normal flag 4. Nomads costs 300 wood,
150 gold, 40 source seconds. No executable was inspected.

## Nomads observations

Fixture: one Mongol Villager, two Houses, one Castle, custom victory with no
conditions. Castle provides 20 population space. Fresh Tests reset the fixture;
the Castle-Age sequence below is one continuous test with paid research.

| Action | Population readout | Capture basename |
| --- | --- | --- |
| Imperial editor Test, initial | 1/30 | `mongols-baseline` |
| Delete first House in Imperial | 1/30 | `mongols-house-after-delete` |
| Fresh Castle-Age Test, initial | 1/30 | `mongols-castle-control` |
| Delete first House before research | 1/25 | `mongols-control-after-delete` |
| Pay and complete Nomads | 1/25 | `mongols-nomads-paid` |
| Delete remaining pre-research House | 1/25 | `mongols-nomads-delete-existing` |
| Villager completes new House near first deleted House's site | 1/30 | `mongols-rebuilt` |
| Delete that new House | 1/30 | `mongols-rebuilt-deleted` |

`mongols-nomads-tooltip2` identifies Nomads and its price. Paid capture shows
wood 5000→4700, gold 5000→4850; construction subsequently costs 25 wood.
Research does not recover a House lost before completion. Each subsequently
completed House adds another five space, retained after deletion; existing
Houses are not counted twice when research finishes. The Imperial start has no
Nomads button and already retains deleted-house support; it is **not** a
controlled in-match Castle→Imperial transition.

Cap test: fresh Castle-Age Test with population limit **25**, same 30-space
fixture. Research Nomads, delete both Houses: still 1/25
(`mongols-cap25-before`, `mongols-cap25-delete-b`). Delete Castle and confirm:
**1/10**, `mongols-cap25-confirmed`. Both Houses' five-space contributions
survive despite the display cap: retain the unclipped storage, clip only the
effective cap. `mongols-cap25-result` is the confirmation modal, **not** the
post-deletion result. Overview: `nomads-pop-panels.png`.

## Initial HP observations (superseded by discriminating continuation below)

Editor age presets apply earlier-age technology automatically. These fixtures
include Bloodlines; they do not select the no-Bloodlines branch or establish
research completion order. Unit identity is read from the panel, not inferred
from a capture filename.

| Actual unit | Mongols Castle | Mongols Imperial | Teutons Imperial control |
| --- | --- | --- | --- |
| Scout Cavalry | 74/74 | not sampled | 65/65 |
| Light Cavalry | not sampled | 98/98 | not sampled |
| Steppe Lancer | 92/92 | 98/98 | 80/80 |
| Elite Steppe Lancer | 116/116 | 124/124 | not sampled |
| Mangudai | 80/80 | 80/80 | not sampled |
| Cavalry Archer | 70/70 | 70/70 | 70/70 |

Captures `hp-{castle,imperial}-{light,steppe,elite-steppe,mangudai,ca}` and
`hp-control-{light,steppe,ca}`. **The Castle/control `light` files actually
show Scout Cavalry**: lowering editor age reset the line. Teuton Steppe Lancer
is an editor-placed foreign unit, not evidence of trainability. Crop montages:
`hp-imperial-panels.png`, `hp-other-panels.png`.

Those initial integers alone could not distinguish 97.99976 from 98 or 98.048.
They did not justify an arithmetic change. The continuation below supplies
controlled paid orderings and a survival threshold, rather than treating these
initial panels as hidden floating-point measurements.

## Discriminating HP continuation (same build, PID and settings)

The installed game's executable path resolved to `D:\SteamLibrary\steamapps\common\AoE2DE\AoE2DE_s.exe`.
Only its sibling **DAT**, not the executable, was read. Installed DAT SHA256:
`4aa2f0a719e88e5f1502517eddb27c669aeb40c2fe9d8c4f3eec7751c01e7baa`.
`.local/hp-live-source.log` and `.local/hp-comparison.log` establish **identical
pinned/installed effect commands for 286/288/287/388/435** and identical base
HP for Scout, Light Cavalry, Hussar, both Steppe Lancers, Mangudai and Cavalry
Archer. Patch drift in those values does not explain the observed difference.

### Candidate arithmetic and decisive outcomes

Candidates preserve the existing imported multipliers 1.2, 1.08333 and 1.084,
and Bloodlines +20; no replacement nominal13/12 multiplier. The Bloodlines
branches perform ×100, −2000, ×multiplier, +2000, ×.01. The table compares
unrounded simulation values against round-only-at-the-end and **nearest integer
after each HP command** (half upward for these positive values).

| Imperial case | Previous float | Final-only nearest | Per-command nearest | Native observed visually |
| --- | ---: | ---: | ---: | --- |
| Light Cavalry, no Bloodlines | 78.048 | 78 | 78 | 78/78; 77 damage→1/78; **78 damage kills** |
| Hussar, no Bloodlines | 97.56 | 98 | 98 | 98/98; 97 damage→1/98 |
| Hussar, Bloodlines before Castle | 117.4997 | 117 | 118 | 118/118 |
| Hussar, Bloodlines after Castle/before Imperial | 117.4997 | 117 | 118 | 118/118 |
| Hussar, Bloodlines after Imperial | 117.56 | 118 | 118 | 98→118 |
| Scout, Bloodlines before Castle | 78.49982 | 78 | 79 | 79/79 |
| Scout, Bloodlines after Castle/before Imperial | 78.49982 | 78 | 79 | 79/79 |
| Scout, Bloodlines after Imperial | 78.536 | 79 | 79 | 59→79 |

Floor/truncation would give no-Bloodlines Hussar97/Scout58, contrary to98/59.
Ceiling would give no-Bloodlines Light Cavalry79, contrary to78 and death at78.
Keeping float78.048 would survive78 damage, contrary to the fixture. Final-only
rounding gives Bloodlines Hussar117 and Scout78, contrary to118/79. Per-command
nearest matches all measured rows: e.g. Hussar9000×1.08333 =9749.97→9750;
(9750+2000)×.01 =117.5→118. These observations calibrate the bounded Mongol
adapter, **not a universal HP-rounding law for every civilisation/effect**.

Damage fixture: two Hussars at Imperial, then two Light Cavalry. Options →
disable Bloodlines prevents its automatic earlier-age grant; the control panel
independently confirms the missing20HP. One enabled, nonlooping, conditionless
Damage Object trigger targets exactly one unit. The other is an untouched
control. With Bloodlines enabled, Hussar117 damage yielded1/118. With it
disabled, Hussar97 yielded1/98. Accepted Light targets: **77→1/78**, **78→dead**,
**79→dead**, fresh Test each time. No fractional Quantity was used.

Accepted captures (all `.png/.json` under the evidence root):

- `cont-hussar117-{damaged,control}`, `cont-nobl97-{hussar,control}`.
- `cont-retarget77-result`, `cont-real78-{input,result}`,
  `cont-real79-{input,result}`. Dead result has a corpse, no selectable unit,
  population4→3, and the untouched control still present.
- `cont-light-target` / `cont-nobl78-light` were a **failed retarget** (full HP),
  not an accepted78-damage survival. Reset target, then click the actual body
  at `(1280,885)`; the positive77-damage control verified correct targeting.

Paid order fixture: start **Feudal**, Bloodlines enabled but unresearched,
5000 food/gold, Town Center, Stable, Market, Castle, editor-preserved Hussars
and Scouts. Earlier placement of Light Cavalry became **Scout Cavalry** on
lowering age; final captions name the real panel identity. Hussars remaining
in Feudal are editor actors, not a claim that they can be trained there.
No research/damage triggers in these tests. Pay Bloodlines (150F/100G), Castle
(800F/200G) and Imperial (1000F/800G) in each of the three orders. Wait for
completed age/banner and unit readback, not just elapsed wall time.

- Before Castle: `cont-beforecastle-hussar`95, `cont-beforecastle-castle-hussar`110,
  `cont-beforecastle-imperial-hussar`118,
  `cont-beforecastle-imperial-light` **Scout79**, despite the historical filename.
- After Castle: `cont-aftercastle-nobl-hussar`90,
  `cont-aftercastle-bl-hussar`110, `cont-aftercastle-imperial-hussar`118,
  `cont-aftercastle-imperial-scout`79.
- After Imperial: `cont-afterimperial-castle-scout`54,
  `cont-afterimperial-nobl-{hussar,scout}`98/59,
  `cont-afterimperial-bl-{hussar,scout}`118/79.
- `cont-paid-panels.png` is the labelled crop montage. Full captures retain
  age and resource bars. The initial disabled-tech reselect accidentally picked
  Architecture; it was restored before all paid-order Tests. Captures retained.

The implementation now marks only HP effects in branches286/288/287/388 with
`integerHitPoints`, rounds each marked write, and leaves every multiplier and
mutual-exclusion prerequisite unchanged. Other effects/legacy manifests remain
unchanged. Tests cover all three paid orders, injured/existing/new troops,
non-promoted Scouts, Hussars, Steppe upgrades, JSON and the final one-damage
public shot after staged77 damage. New no-Bloodlines Steppe HP78/104 follows
the same source effect commands; its survival thresholds were not independently
measured here. Sub-integer combat damage/current-HP display rules outside this
max-HP branch adapter were not generalized.

Continuation checks: eight owned Python tests passed; TypeScript passed;
targeted Mongols/population/buildings/civilization-bonuses Vitest **55 passed,
four existing open-building skips** (24.47s). First continuation run exposed
seven failures: existing units used a second unrounded research-completion path
while newly created units used rounded rules. One shared HP combiner fixed both
paths without weakening assertions or widening clocks. A separate private
final-only-rounding mutant fails four Bloodlines tests (118/79 versus117/78).
Logs and exact commands are in `.local/handoff-305.md`.

## Candidate implementation and remaining acceptance

The uncommitted candidate adapts replacement storage to a House rule, retaining
five support on completed loss in an optional per-player counter. It neither
retains rubble nor changes fallback content. Missing legacy counters mean zero;
no historical pre-Nomads losses are reconstructed. Imperial automatic research
sets the same rule without granting population again. Public-command tests
cover build/research/delete/combat, foundations, owner isolation, cap clipping,
rubble expiry and JSON continuation.

**Inferred capture policy, not native-validated:** the existing converted-building
snapshot carries House persistence with the building and credits its current
owner on destruction. Capture/recapture remains explicitly unverified and
ledgered, not a claimed reference match or a requirement to wait for further
native measurement before integration. Native enemy-destruction timing,
unfinished-House loss and a paid Castle→Imperial transition were not measured.
The HP continuation now resolves the sampled no-Bloodlines survival threshold
and all three paid Bloodlines orderings. Capture/recapture was not attempted
again: it needs a separate two-owner population fixture and cannot be inferred
from the one-player HP scenario. It remains explicitly unverified as authorized.

Full import is needed to publish newly available Nomads metadata, but was **not
run**. Source-only test extraction is private `.local/mongols-content.json`;
no published manifest or converted assets changed. Owned checkpoint and browser
research-button acceptance remain coordinator gates. Exact executed checks and
process receipt are in `.local/handoff-305.md`.

Shared admission is now **v7**: v6 clients do not implement retained housing or
the new integer-HP effect metadata and must not simulate the same match. The
checkpoint envelope stays **v5**, with v4/v5 loading and the existing matching-
rules hash guard unchanged. Real-wire coverage rejects v6 without a snapshot,
reopens the unchanged v5 checkpoint twice, and continues its queued research
and training without inserting retained-housing state.

Replay acceptance includes a recorded public build/research/delete stream:
Nomads House loss retains five capacity, paid Bloodlines and ages select286/287,
and Scout HP reaches79. Its JSON replay checks every recorded checksum and
the final housing/HP outcomes. An independent open-content recording from
pre-change commit `5a7db664e0978d968afa28f9e0e389a3f4301edd` is frozen in
`src/headless/fixtures/pre-mongols-v4.json`; all six old hashes still match.
No native controls were used for this review revision; another agent owns the
live game. The menu captures below are historical, not a current game-state claim.

Review checks: **89** simulation/shared tests passed, **four** existing open-
building skips (47.19s); both selected headless replay tests passed (3.50s,
11 unrelated cases deselected); **eight** Python tests passed (43.759s).
TypeScript and diff checks passed. Exact commands/logs and the initial config
type-inference correction are recorded in `.local/handoff-305.md`.

Initial pass left main menu: `mongols-final-main-menu.png/json`. A batched exit hit
the shell's 120-second limit at the editor confirmation; a process-table check
found no remaining controller, a fresh capture identified the modal, and one
confirmed click completed the exit. No scenario was saved.
Continuation final main menu: **`cont-final-main-menu.png/json`**, same PID22012,
unchanged settings, no saved scenario and no remaining native controller.
