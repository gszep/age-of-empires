# Overnight run checklist

The work queue for autonomous runs. Work strictly top to bottom, **one item at a
time**: an item is done only when its verification step passes and the quality
gate (`npm test`, `npm run build`, `npm run test:import`) is green, then commit
and push before starting the next. If an item cannot be finished, revert to the
last green state, record what blocked it here, and move on — a half-shipped
feature is worse than an honest gap. Do not mark an item done on "looks done":
run its check.

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

## The run this queue was written for

Agreed with the human on 2026-08-27, deadline **18:00 Friday 2026-08-28**.
Start nothing new after ~17:00; finish the item in hand, run the gate, commit,
push, hygiene pass, hand over. Refresh `status.md`/`backlog.md`/`lessons.md`
and this file at ~70% context and again at handover.

Four phases, in order. Phase 4 is not expected to finish; whatever is not
reached is written into `backlog.md` honestly rather than half-shipped.

Decisions already taken, so they are not re-litigated mid-run:

- The Britons tech tree is cut to nodes whose research building **and** target
  entity already exist in the simulation. Every excluded node is recorded with
  its reason in `docs/status.md`; entities are not stubbed just to hang a
  technology on one.
- Both players are Britons. Civilisation is a per-player match-config field so
  a second civilisation is a later data addition, not a refactor.
- Civilisation *bonuses* (archer range, shepherd rate, town-center wood, free
  Yeomen) are **out of scope** — they are not part of the tech tree.
- Issues are closed on GitHub with a one-line note naming the commit.
- Commit and push to `origin/main` per verified item; never rewrite pushed
  history.

## Phase 1 — the open `bug` issues

### P1.1 Buildings gain line of sight when placed but not yet fully built (#1)

A foundation should not see. Find where visibility gathers its sources and gate
a building's line of sight on `buildProgress === undefined`.

*Verify:* a visibility test that a fresh foundation reveals nothing beyond what
its builders already see, and that the same building reveals its `lineOfSight`
once complete.

### P1.2 Farms are invisible (#2)

Farms are drawn as terrain, not sprites — DAT terrain slots 7 (`Farm1`,
`g_fm1`) and 29 (`Farm Cnst1`, `g_fc1`), both present in the manifest, and
`sprites.ts` already selects between them. So this is a rendering defect, not a
missing import. Find why the terrain patch does not reach the screen.

*Verify:* a pixel probe over a finished farm returns the farm texture's colours
rather than grass, and the same over a foundation returns the construction
variant.

### P1.3 Enemy units in fog of war do not disappear (#4)

They default to a neutral pose instead of vanishing. Units are not remembered
in AoE2 — only buildings are. Check what `observe.ts`/`visibility.ts` puts in
last-seen memory against what the view draws from it.

*Verify:* an observation test that a unit which walks into fog leaves no
remembered entity while a building does, and an entities query in the running
game showing the enemy villager gone once the sight lapses.

### P1.4 Town Centre is the only building which permits setting rally points (#8)

*Verify:* a command test that a rally order lands on a barracks, archery range,
stable, siege workshop, castle and monastery, and that a unit trained there
walks to the flag.

### P1.5 Villagers should fire arrows when hunting (#9)

Believed already fixed by `6286149` ("Hunt with the bow the DAT gives a
hunter"). Verify against the reported behaviour before closing; if it is fixed,
close with the commit and do not re-implement.

*Verify:* an entities query on a villager hunting a deer shows the bow
animation and a projectile, not a melee strike.

### P1.6 Exhausted forage bushes briefly turn into tree stumps (#12)

The `dead` import slot routes bushes through `n_tree_stump_generic_x1`. Check
the bush's own `dead_unit_id` in the DAT before deciding what it should leave;
if the DAT assigns it nothing, it should draw nothing.

*Verify:* an entities query on a worked-out bush reports no decay art, and the
import test asserts whatever the DAT actually says.

### P1.7 Palisade walls and gates do not orient correctly (#15)

Walls orient vertically by default instead of taking the corner piece, and
gates do not snap to the axis of the palisade they join. The frame-to-meaning
mapping was proved once by compositing (see `lessons.md`); the defect is in
which frame the connection state selects.

*Verify:* build an L of palisade through `applyCommand` and read each segment's
frame — the corner tile draws the corner run, not a straight one — and a gate
dragged onto a horizontal line reports the horizontal orientation. Report the
orientation tag through the debug protocol as part of this item (the backlog
asks for it and this is the item that needs it).

### P1.8 Advancing to Feudal does not change building appearance (#13)

The largest of the bugs: age-specific building art is an importer change (the
DAT's per-age graphic sets for town center, house, mill, barracks) plus a
renderer change that selects the set by the owner's age. Read what the DAT
actually keys the variant on before adding a slot.

*Verify:* a dev-session snapshot at Feudal shows the Feudal art for all four
buildings by `frame`/atlas name in an entities query, and the import test
asserts the age sets came from the DAT.

## Phase 2 — arrows, then research

### P2.1 Arrow accuracy and ballistics (#3) — *split*

Landed as **P2.1a**: a shot is aimed once and can miss. What remains — Thumb
Ring and Ballistics, the two technologies that modify it — needs the general
effect machinery and, for Ballistics, the university, so both are folded into
**P2.4** rather than built twice. Issue #3 stays open until they are
researchable in a real match.

### P2.1a (landed) Arrow accuracy and ballistics (#3)

Arrows currently never miss. They should fire at where the target *is*, and
follow it; only Ballistics makes them lead a moving target. `accuracy_percent`
is a DAT attribute that is not implemented at all, and Thumb Ring modifies it —
so this lands before the tech tree, or those technologies would modify nothing.

Read the DAT for `accuracy_percent`, the projectile's own fields, and what
Ballistics' effect commands actually change, before choosing a miss model.
Record any part the owned data does not answer as a discrepancy in
`docs/status.md` rather than approximating silently.

*Verify:* a simulation test that a moving target is missed without Ballistics
at a rate matching the DAT's accuracy, hit reliably with it, and that a
research changes the outcome; plus a determinism test across the change.

### P2.2 Carry `technologies` through to the published manifest

`import_content.py` writes `technologies` into `.local/aoe2de/content.json`,
but `convert_sld.py` never copies it into `public/imported/aoe2/manifest.json`
— so `rulesFromManifest` finds no key and the game silently runs on the
hardcoded `FALLBACK_RULES`. It matches the DAT today, which is why nothing
caught it. Everything imported below depends on this.

*Verify:* the manifest carries `technologies`, a test asserts the imported
values reach `rulesFromManifest` (change one in a fixture and watch the rules
follow), and the import test guards the key's presence.

### P2.3 Civilisation as a match-config field, Britons for both players

*Verify:* the match config carries a civilisation per player, defaults to
Britons, round-trips through the schema and the replay record, and a
determinism test passes across it.

### P2.4 The Britons technology tree

Source of truth: `depot_813781/resources/_common/dat/CivTechTrees/BRITONS.json`
(170 nodes — 85 `Research`, 28 `UnitUpgrade`, 26 `Unit`, 29 buildings, 2
`UniqueUnit`, tagged by `Age ID` 1–4), cross-referenced against the DAT for
cost, time, research building and effect commands. Blacksmith armour and attack
lines first — they are flat modifiers of the shape Loom already uses — then the
`UnitUpgrade` rule that replaces one unit kind with another.

*Verify:* each technology is refused before its age and applies its DAT effect
after; a determinism test across a research and across an upgrade; and the
excluded nodes are listed with reasons in `docs/status.md`.

## Phase 3 — the N queue

Ordered as agreed: N3, N4, N6, N7, N8-remainder, then N1 and N2 last.

### N3. Import technology icons

`import_ui.py` takes Buildings, Units, StatIcons and MenuIcons, so research
buttons are text-only. The DAT gives each tech an `icon_id`; the icon category
to add is the researches sheet.

*Verify:* the command panel with a town center selected shows an icon on the
Loom, Feudal and Castle buttons — read `.command-button` background images out
of the DOM rather than looking.

### N4. Minimap player colours from the DAT

`src/view/minimap.ts` reads `PLAYER_COLORS`, the open-content fallback, while
the manifest carries each player's own `minimapColor` (blue `0,0,255`, red
`255,0,0`). The minimap has no `ContentAssets` handle; plumbing one through is
the whole job.

*Verify:* a pixel probe of the minimap returns the DAT's blue and red rather
than `#1a6cff`/`#e02b2b`.

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

`ALERT_INTERVAL` is one global ten-second throttle rather than one per newly
attacked target, so a sustained attack re-announces every ten seconds and a
second building attacked inside that window is silently ignored. The second
half is the worse bug.

*Verify:* a cues test drives a sustained attack on one building and asserts one
alert rather than a stream, and a second test attacks a *different* building
inside the window and asserts it is still announced.

### N8. Whatever the tech tree left

Phase 2 covers the blacksmith and university lines. This item is the sweep for
what P2.4's cut excluded and can now be included.

### N1. Teach the built-in AI to age up

`src/sim/ai.ts` has no notion of research, so Loom, the Feudal Age and the
Castle Age are out of its reach, and with them every building and unit they
open. Read `applyCommand`'s `research` branch for the rules the AI must satisfy
(building idle, age reached, cost affordable). Bank toward the age rather than
spending everything on villagers; the observation already carries `age` and
`researched`.

*Verify:* a 16-match paired batch (`npm run batch -- --matches 16 --seed-start
1`) in which at least half the matches reach the Feudal Age and at least one
reaches the Castle Age, still 16/16 decided with 0 replay checksum failures.
Record the new age distribution in `docs/status.md`.

### N2. Teach it to hunt and herd

It picks gather targets by `kind === 'resource'`, which animals are not, so the
whole Dark Age food opening is invisible to it.

*Verify:* a batch in which the AI's food income in the first four minutes is
measurably higher than the current baseline (record both), and a simulation
test that an AI-driven player claims and works a sheep.

## Phase 4 — Imperial Age

Expected to be reached only in part. Strict order so that whatever lands is
coherent: the age technology (tech 103) and the university → research icons →
building and unit icons → the new Imperial units and their art. A unit without
its art is not shipped; it is recorded in `backlog.md`.

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
