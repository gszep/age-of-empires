# Overnight run checklist

The work queue for autonomous runs, built by comparing the current game against
the reference AoE2DE data in the owned depots. Work strictly top to bottom,
**one item at a time**: an item is done only when its verification step passes
and the quality gate (`npm test`, `npm run build`, `npm run test:import`) is
green, then commit and push before starting the next. If an item cannot be
finished, revert to the last green state, record what blocked it here, and move
on — a half-shipped feature is worse than an honest gap. Do not mark an item
done on "looks done": run its check.

Use the debug protocol (`AGENTS.md` → Visual debug protocol) for rendering
verification, and prefer its fields to screenshots: `entities` reports
`amount`, `resourceKind` and the `frame` actually drawn, and `sim` reports
`selected` and `flashTarget`. To reach a state a fresh match cannot — a Castle
Age town, an army mid-fight — build it in Node through `applyCommand` and hand
it to the page as a dev-session snapshot (`docs/lessons.md` has the recipe);
do not add cheats to the protocol and do not play twenty minutes to get there.

Wait on long jobs by handle, never by pattern — `tools/wait_for.sh` against a
PID or sentinel file, not `pgrep -f`. End every run with a hygiene pass:
enumerate the processes the run started (background tasks, dev servers,
headless browsers, waiters), kill the litter, and state what is deliberately
left running.

## Where this queue stands

The previous queue (A–D, visual fidelity through palisades) is finished and its
findings are folded into `docs/status.md`; only **terrain blends** (blocked on
evidence — see status.md, do not reattempt without new evidence) and **water**
(scoped in `docs/water-design.md`, deliberately not started) survive from it.

What landed since, from playtesting rather than from a list:

1. **Selection markers follow the DAT's obstruction shape** — a ring under a
   unit, the `outline_size` box on the ground under a building or resource, and
   a flat box over a carcass (the corpse is its own DAT unit). An enemy told to
   expect company blinks its marker; nothing else does.
2. **The Castle Age**, and the monastery, siege workshop and castle with the
   knight, cavalry archer, longbowman, battering ram, mangonel and monk. Monks
   heal and convert; a mangonel's stone lands with a blast.
3. **The default game speed** is the setting the reference calls Default
   (1.5x). The match used to open at 1x, which is AoE2's Slow.
4. **Carcasses** are selectable and orderable while they hold food, rot by how
   much has been eaten rather than by the clock, and show the food left.
5. **Hunting** uses the DAT hunter's bow (3 tiles, projectile 509); working a
   herdable draws the shepherd; a deer is startled from one tile, hops 1.5, and
   then grazes for 14–20 seconds instead of being walked away indefinitely.

**The one thing to understand before picking up N1:** the simulation is now
well ahead of what a played match shows. Three ages, six Castle Age units and
three Castle Age buildings exist and are covered by tests, and the built-in AI
still opens with Dark Age militia and never researches anything, so none of it
appears in a match anybody watches. That is what the top of this queue is for.

## N. The queue

### N1. Teach the built-in AI to age up

`src/sim/ai.ts` has no notion of research, so Loom, the Feudal Age and the
Castle Age are all out of its reach, and with them the market, archery range,
stable, blacksmith, monastery, siege workshop, castle and every unit they
train. This is the largest gap between what the simulation supports and what
the game shows, and it blocks N2 and N3 from being observable.

Read `applyCommand`'s `research` branch for the rules the AI must satisfy
(building idle, age reached, cost affordable). Bank toward the age rather than
spending everything on villagers; the observation already carries `age` and
`researched`.

*Verify:* a 16-match paired batch (`npm run batch -- --matches 16 --seed-start
1`) in which at least half the matches reach the Feudal Age and at least one
reaches the Castle Age, still 16/16 decided with 0 replay checksum failures.
Record the new age distribution in `docs/status.md`.

### N2. Teach it to hunt and herd

It picks gather targets by `kind === 'resource'`, which animals are not, so the
whole Dark Age food opening — four sheep by each town center, deer and boar out
on the map — is invisible to it and its economy runs on berries and farms.

*Verify:* a batch in which the AI's food income in the first four minutes is
measurably higher than the current baseline (record both), and a simulation
test that an AI-driven player claims and works a sheep.

### N3. Import technology icons

`import_ui.py` takes Buildings, Units, StatIcons and MenuIcons, so research
buttons are text-only while every other button has its art. The DAT gives each
tech an `icon_id` (the manifest already carries it for `castle-age`); the icon
category to add is the researches sheet.

*Verify:* the command panel with a town center selected shows an icon on the
Loom, Feudal and Castle buttons — read `.command-button` background images out
of the DOM rather than looking.

### N4. Minimap player colours from the DAT

`src/view/minimap.ts` reads `PLAYER_COLORS`, the open-content fallback, while
the manifest carries each player's own `minimapColor`. The minimap has no
`ContentAssets` handle; plumbing one through is the whole job.

*Verify:* a pixel probe of the minimap returns the DAT's blue and red rather
than `#1a6cff`/`#e02b2b`.

### N5. A spent forage bush should leave nothing

Playtest report: an exhausted bush briefly draws the generic tree stump,
because the `dead` slot routes bushes through `n_tree_stump_generic_x1`. Check
the bush's own `dead_unit_id` against the reference before deciding what it
should leave; if the DAT assigns it nothing, it should draw nothing.

*Verify:* an entities query on a worked-out bush reports no decay art, and the
import test asserts whatever the DAT actually says.

### N6. Building rubble, and a corpse window that follows its animation

Every building's `dead_unit_id` names its rubble (`b_*_rubble_x1`) and the
importer's `dead` slot already knows how to reach it, but `kill()` gives every
corpse a 3-second window while a building's death graphic runs 8.3s — so a
building vanishes mid-collapse and the rubble would never draw. The corpse
window has to follow the death animation's length first, which is a simulation
change and a checksum change.

*Verify:* a razed barracks plays its collapse to the end and leaves rubble
(entities query: `barracks/death` through to `barracks/decay`), and the
determinism tests still pass with the new window.

### N7. The under-attack alert nags

Playtest report: while a building is under sustained attack the cue fires every
few seconds. The obvious hypothesis is wrong and was checked — `cues.ts` writes
`alertedAt` only when the cue fires, so nothing resets it per hit. The defect is
that `ALERT_INTERVAL` is one global ten-second throttle rather than one per
newly attacked target, which also means a second building attacked inside that
window is silently ignored. That second half is the worse bug.

*Verify:* a cues test drives a sustained attack on one building and asserts one
alert rather than a stream, and a second test attacks a *different* building
inside the window and asserts it is still announced.

### N8. Blacksmith and university technologies

The tech system already reads cost, time, building and flat effects from the
DAT; this is breadth. Do the blacksmith's armour and attack lines first — they
are flat modifiers of the shape Loom already uses. Unit *upgrades*
(man-at-arms, crossbowman, pikeman, light cavalry) are **not** this item: they
need a rule that replaces one unit kind with another, which is its own change.

*Verify:* each new technology is refused before its age and applies its DAT
effect after, with a determinism test across a research.

## Blocked or deliberately not started

- **Terrain blend edges.** Blocked on evidence, not effort. The DAT gives a
  `blend_type` and `blend_priority` and `terrain/blends/` holds ten masks, but
  nothing says which file a type selects or how a 512x512 mask indexes against
  a tile. Picking one by name and anchoring it by eye would invent a visual,
  which is what the download-first rule exists to prevent. Needs a mapping
  found in the owned data or a side-by-side against the installed game.
- **Water.** `docs/water-design.md` scopes it as W1–W5 from the owned DAT. It
  changes the board rather than adding to it; do not start it mid-run. Its one
  open question is the shore seam, which is the same blend-mask mapping that
  blocks the item above.
- **The monk's occlusion contour.** Its idle and attack outline layers are the
  only consumed sources that fail `tools/sld_layers.py`'s walk invariant, so
  they sit in the manifest's `skippedMasks`. The invariant is the decoder
  working as intended; what those two layers encode differently has not been
  measured, and guessing would undo the thing that makes the decoder
  trustworthy.
