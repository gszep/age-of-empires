# Overnight run checklist

The work queue for autonomous runs. Work strictly top to bottom, **one item at a
time**: an item is done only when its verification step passes and the quality
gate is green, then commit and push before starting the next. If an item cannot
be finished, revert to the last green state, record what blocked it here, and
move on — a half-shipped feature is worse than an honest gap. Do not mark an
item done on "looks done": run its check.

Run the gate with `tools/gate.sh`, not by hand. Piping a step to `tail` hands
`&&` the status of `tail`, which is always 0, and a broken build sails straight
into a commit — that happened twice in one run, once in the ad-hoc chain and
once in the first script written to replace it. The script reads `PIPESTATUS`
on the line after the command and has been tested against a deliberate
failure. `GATE_TAIL` sets how many lines of each step it echoes; the full
output of the failing step lands in `.local/gate-step.log`.

Use the debug protocol (`AGENTS.md` → Visual debug protocol) for rendering
verification, and prefer its fields to screenshots: `entities` reports
`amount`, `resourceKind`, the `frame` actually drawn and a `shape` tag for
walls and gates; `sim` reports `selected` and `flashTarget`. To reach a state a
fresh match cannot — a Castle Age town, an army mid-fight, a building
mid-collapse — build it in Node through `applyCommand` and hand it to the page
as a dev-session snapshot — `tools/probes/snapshot.ts` is a working example to
copy, and `tools/probes/panel.mjs` reads the HUD out of the DOM and the minimap
out of its canvas. Do not add cheats to the protocol and do not play twenty
minutes to get there.

Wait on long jobs by handle, never by pattern — `tools/wait_for.sh` against a
PID or sentinel file, not `pgrep -f`. Before restarting a background job that
looks stuck, check whether it is still running: three atlas conversions once
ran at once, each making the others slower, and it looked exactly like a hang.
End every run with a hygiene pass: enumerate the processes the run started,
kill the litter, and state what is deliberately left running.

## Where this queue stands

**Start with the open issues, bugs first.** The standing priority holds:
anything tagged `bug` outruns everything in this file. **The 2026-09-17
overnight run closed the playtest's list**: #78 (the Feudal mill — an SLD
decoder defect, a delta frame inherits from its keyframe, not the frame
before; every long delta run was re-decoded), #61 (a razed building falls as
its age and leaves its age's rubble), #76 (Shift queues five), #77
(portraits in the owner's colour, through the sprites' palette ramp), #71
(a farm is sown with the seed-sowing graphic and worked in the farmer's own
art), #73 (soot from the SLD damage layer and the DAT's fires from the
reference's own particle flipbooks), #74 (repair, from the repairer task
unit: 12.5 a second, siege at a quarter, half price), #75 (garrison: in,
banked, healed, out, and the town center shoots for those inside), and the
note on #70 (an unaffordable press goes through and is told why in the
reference's words). Each has a section in `status.md` and the DAT rows are
in `tools/README.md`. What is still open: **#5** (pathing, blocked on the
human), **#41** (invalid), and the reference-audit enhancements #49–#60.
Then Q3 below.

**The morning after (2026-09-18), from the human's look at it:** a
selected group's "3 selected" sat over the parchment's frame and its
portraits were out of sight — the group now shows its portraits alone,
from `ObjectImage`'s corner at the button pitch, as the reference does
(`4d407cb`, `1acf10f`); and every HUD label looked too big — the widget
files say `Style: Normal` on all of them and the reference's own glyph
atlas measures as Georgia *Regular* at the file's PointSize, so the bold
the last session inferred by eye is gone, the parchment's text is the
files' dark brown, and the outlines are the files' (`1acf10f`). Both are
in `status.md`.

**Three things a fresh session needs from that run.** The atlas cache
fingerprint now covers only the decoder (`sld_layers.py`) and the two
conversion functions, so editing the manifest dict in `convert_sld.py` no
longer costs the hour — but a decoder edit still does, masks included (this
run paid it twice). Reading a PNG's alpha back through a canvas loses the
RGB of every alpha-0 pixel (premultiplication): anything a texture encodes
in alpha beyond coverage is split out by the importer into its own mask.
And zero-context patch splitting (`git apply --unidiff-zero`) places a pure
insertion at the wrong offset with no error — this run's commits were
staged by rebuilding files by content from the index, and gated with the
working tree saved to a tarball and restored, never stashed (a stash pop
conflicted on the docs).

**The 2026-09-17 session** (18 commits, `cebb47b`..`37a191a`) did three
things. First an audit of the owned reference material — every file basename
under the depot's `dat/`, `xs/`, `widgetui/`, `particles/` and every DAT unit
field, grepped against the repo — which found sixteen unread things and filed
them as **#45–#60**; five were bugs and are fixed (a miss lands the DAT's
`accuracy_dispersion`; a blast catches by `blast_defense_level ≥
blast_attack_level`, so mangonels hit buildings and onagers fell trees;
Delete asks only where `hero_mode` bit 32 says; names, tooltips and button
text come from the strings file; half the villagers are women). Then the
HUD, from a screenshot of the reference at the same 0.52 scale: **#62–#69**
all closed — the match opens on the town center, the bottom panel is the
one 2404-wide collection it is, the selection panel's contents and stat
row sit in `Clipped`'s boxes, the resource panel has gatherer counts and
the age bar, the menu panel has its six buttons and the civ shield, the
minimap has its four buttons with a working flare, a score panel (toggled
by the player-stats ribbon), Georgia Bold and `UIColors.json`. Then **#72**:
the attack animation runs on the simulation's swing (`swingSeconds`), so a
trebuchet's rock leaves at the DAT's `frame_delay` frame and the engine
stands through the rest of its reload. Also on the way: every command has
a fixed grid cell from the DAT's `button_id` (hotkeys are now the cell's
letter: build pages Q/W, Stop G), the grid's own buttons wear the action
sheet, an order to a non-point is refused, and `playerAttributes` — never
published since #23 — reaches the manifest. Every item has a section in
`status.md`, and the cheat-sheet in `tools/README.md` grew nine rows.

**Two things a fresh session needs to know from that day**, beyond the
lessons: the import pipeline now takes the strings file and the fonts
directory (`import_aoe2.sh` passes both; `--strings` on `import_content.py`,
`--fonts` on `import_ui.py`), and editing `convert_sld.py` for any reason
invalidates the whole atlas cache — its own source is in the fingerprint —
so a one-line change to the manifest dict costs a twenty-minute re-decode.
Do not restart it. And a tester's browser tab goes stale across re-imports:
after regenerating the manifest, ask for a reload before believing a report.

**The 2026-09-14/15 overnight run emptied the issue list.** The human
reordered the queue for it — map generation first, then terrain blending, then
the issues in order — so Q3 was not reached and is still where a fresh session
starts. Closed: #42 terrain blending (from `blendomatic_x1.dat`, which had
never been opened, so the "blocked on a mapping nobody has found" note in this
file was simply wrong), #43 Arabia's biomes, #34 leaf litter under trees, #40
farms walked over rather than round, #37 delete, #38 shift-click routes, #39 the
key-binding audit, #36 every unit's stats checked against the DAT, and #44 the
degenerate match seed. Only **#5 (pathing)** is left, still blocked on the human
for which units doing what, and **#41**, which the human tagged invalid.

**The 2026-09-18/19 run built water and rebuilt the blend.** In order:
issue #41's fog edge (a per-tile visibility texture snapped to a rounded
contour, levels from `colorcorrection.json`); Arabia's forest ponds and the
DAT's `terrain_restrictions` table as passability; then, overnight, Islands
as a descriptor, the engine's beach sweep, the blend pass rewritten as the
eight-neighbour algorithm once the mask bytes were read as keep-base alpha,
a gutter in the mask atlas, the water surface drawn through
`water_def.json`'s presets, the script's aesthetic scatter as view-only
sprites, and the leaf-litter patches dealt as the script deals them. Every
stage has a section in `status.md`. The morning after, the water's colour
formula was read off the shader's own SM2 build (the `Aon9` chunk -- see
`lessons.md`), which replaced the calibrated open-water colour, and the
minimap took each terrain's texture tone (issue #80). What remains
approximated: the fog edge's softness, the water's depth alpha and ripple
scale, and the minimap rule itself. Tried and reverted: the nearctic snow
dusting (`backlog.md`). Left measured but not built: the shore foam.

**A fresh session starts here:** `git pull`, re-run the three manifest
steps if `public/imported/aoe2/manifest.json` lacks `water` or `blends`
(`tools/import_aoe2.sh` does all of it), open `?map=islands&seed=2` and
`?seed=3`, press F4, and read `docs/water-design.md` "What is next" -- the
dock and the fishing ship are the queue's head, on a board that now exists.
`.local/probes/pond.ts` (`MAP=`, `SEED=`, `LOOK=x,y`, `OUT=`) is the
screenshot probe every picture in `status.md`'s last six sections came
from; it is untracked, so recreate it from the pattern in
`tools/probes/snapshot.ts` if it is gone.

**The 2026-09-13 session** cleared the bugs filed after the last overnight run:
#32 (a lumberjack going idle at the camp — the continuation remembered which
*kind* it had worked but not which resource, and a spent node is swept up three
seconds after it empties), #35 (the minimap and the command grid placed by eye
rather than from the widget files, and the `Anchor` field the grid needs being
stripped by the importer), and #33 (the spent-farm alert crying about every
farm the auto-reseed option re-sowed). Each has its evidence on the issue and a
section in `status.md`. It then closed **#22 (farm textures)** once the human
answered its open question. **Still open and blocked on the human, not on
work: #5 (pathing)** — see Q0b below. The rest of the
issue list is enhancements: #34, #36, #37, #38, #39.

**The 2026-08-29 overnight run** closed three fresh bugs (#29 town watch, #30
the trebuchet's oversized atlas and its rock, #31 the stuck-key camera), then
built the whole of `docs/map-build-plan.md` — M1 through M4, C1 and C2: the
generator is the original's two primitives from the owned scripts, Black
Forest and the painted-proof and `senlac` (the real ground at Battle, East
Sussex) generate from descriptors, and map types ride in the match record.
That plan's own dawn section records where each stage landed. It then resumed
this queue and did **Q1 and Q2 together** (the blacksmith is both the second
Feudal building and the finishing power), and re-measured **Q6** on the new
board (in `status.md`, beside the old figures).

Two things a fresh session needs before touching anything:

1. **Re-run the importer if the tree is older than 2026-09-15.** The
   2026-09-14/15 run regenerated all of it — the atlas cache was invalidated by
   the 8192 cap and had to be rebuilt from scratch, which took about an hour
   single-threaded and is normal; do not restart it if you see it running. That
   run also added terrain slots, the blend masks and the hotkeys, so the
   pipeline is now `import_content` → `convert_sld` → `import_ui` →
   `import_blends`, in that order. Two traps met there: `convert_sld` rewrites
   the whole manifest, so anything merged into it afterwards (blends) is lost if
   you re-run it and stop; and `convert_sld --terrain-only` refreshes terrain
   without touching entities, which is minutes rather than an hour when all you
   changed is a terrain slot.
2. **Read `docs/lessons.md`.** The last four entries are from that run: a
   "blocked on evidence" note that meant nobody had opened the file; a cosmetic
   feature that must not draw on the stream deciding the board; improving a
   distribution surfacing the bugs its old bias hid; and a fixture that assumes
   a board testing the board rather than the behaviour.

What the run before this one left (combat, the tree, the ages, the board) is
in `status.md`; what this run added, in one paragraph. **The board is a
place**: real terrain bands as boxes, tight resource lumps, solid cleaned
woods, a contested middle, Black Forest behind one road, and a real British
battlefield with its hedgerows — the ridge itself waits on the elevation
renderer (M5, deferred, in `backlog.md`). **The strategy** holds its army
home until it is one, builds the blacksmith and buys its lines, keeps its
farmers farming through the endgame raze, and re-pins gatherers whose slot
resource was found after they went to work.

## The queue

### Q0 and Q0b: done, and the two questions left over

**Q0 — eleven of the twelve `bug` issues closed** on 2026-08-28: #17 (fog
remembering a sheep you have since claimed), #18 (an attacker that stopped at
the edge of its reach and threw away its swing), #19 and #21 (one rule for what
a worker turns to next), #20 (a house cycling three models a second), #23 (the
mill's technologies, and effect command type 1 with them), #24 (re-sowing a
fallow farm, off by default), #25 (the villager build menu from the DAT's own
button slots), #26 (building armour, and then the attacker loop reading the
base rules instead of the researched ones), #27 (the wonder, without a victory
condition), #28 (the trebuchet). Each has the evidence on its own thread and a
section in `status.md`.

**Q0b — all three enhancements closed**: #5 (reviewed, see
`docs/pathing-review.md`), #6 (a group shown as its members, and double-click),
#7 (a fifteen-deep training queue).

**What is left is one question to the human, not work** (#22 was answered on
2026-09-14 and is closed). Do not guess at it; it was left open deliberately,
and picking an answer would be inventing a fact.

- **#22, farm textures — answered and closed 2026-09-14.** The human's answer
  was *about twelve furrows across one farm*, which against the forty each
  sheet carries per span is ten tiles to the span. `terrain_dimensions` turned
  out not to be readable as tiles-per-span at all: it is 6x6 for the grown farm
  and 3x3 for the one being built, so honouring it halved a farm's furrow pitch
  the moment it finished building. Every farm drawing the same arrangement went
  with it. See `status.md`.
- **#5, pathing.** Nine measurements failed to reproduce the defect the issue
  reports, and the review says so. The question — which units, doing what — is
  on the issue. Two adjacent things were noted and are in `backlog.md`: ragged
  forest interiors, and a crowd settling into a ring rather than a formation.

**The batch was re-measured after all of it** and is in `status.md`; the
2026-08-29 run then re-measured it again after the map rebuild and the
strategy work — see Q1 below for where it stands now.

### Q1. The Castle Age and a win at once — advanced to 14/16 with 4 Castles

**Worked on 2026-08-29, most of the way there, and honestly not all of it.**
The batch at a 2400-second clock: **14 decided, 2 timeout draws, 0 replay
checksum failures, 32/32 Feudal, 4 player-slots in the Castle Age** — the
first Castle Ages a paired batch has ever reached. Q1's verify asked for
16/16 *and* a Castle; five more configurations were measured in one night
(the curve is in `status.md`) and the two ends now overlap instead of
excluding each other. What was found and fixed on the way: farms went fallow
forever because nobody had ever asked the mill to re-sow them (the toggle now
rides in the observation); the marching rule produced literal standoffs —
both armies idle at home, pinned below the march threshold by their own food
equilibrium — fixed by pooled waves of five; and a defend-the-town rule was
tried, measured repelling every mirror-matched attack into a 4/16 batch, and
reverted. **What is left:** the two remaining draws are slow sieges still in
motion at the cap. The next lever is finishing power, not economy — siege
units, or villagers joining a raze whose defenders are merely outnumbered
rather than absent.

### Q2. The blacksmith — built and bought, not yet decisive

**Worked on 2026-08-29.** The strategy builds a blacksmith once the range is
up (falling back across every spot list, because a strategy with no smith
buys no technology) and its wish list carries fletching, forging and both
armour lines. All four were measured researched in the slower
configurations; at the decisive equilibrium the shipped config lands on,
matches end around minute 27 and the smith often goes up too late to pay.
The A/B (builtin vs `builtin-nosmith`, a strategy variant kept for exactly
this) measured **7-7 with 2 draws** — a null result: the smith is in the
repertoire and does not yet decide games. **What is left:** an earlier smith (before the range, as real openings
order it) was not measured; try it with the finishing-power work above.

### Q3. Herdables that follow you home

The one thing that would make hunting worth doing. A claimed sheep stands where
it is, so eating it means walking to it — and on this map the berries are
nearer, which is why teaching the AI to hunt changed its food income by nothing
at all (159 food in the first four minutes either way; the measurement is in
`backlog.md`). AoE2's gain comes from walking a sheep under the town center and
eating it with no return trip.

The history matters: herdables used to follow, and it was removed because the
simulation overwrote their orders four times a second, which made them
uncontrollable. The middle ground named in `backlog.md` is following only until
the first order.

*Verify:* a claimed sheep follows the unit that claimed it until given an order
of its own, and the AI's food income in the first four minutes is measurably
higher than the 159 recorded now.

### Q4. The naval slice, or an honest note that it is out of scope

Naval is the largest single block of what is skipped, but it is not all of it:
of the forty-eight, **sixteen** are technologies the British simply do not
have, **eleven** are researched at the dock, **five** more change only ship
attributes, and one upgrades to the heavy scorpion. The rest are land
technologies blocked on other things — see Q5 and the four-group breakdown in
`status.md`. Do not read "skipped" as "naval".

`docs/water-design.md` scopes water as W1–W5; W1, W3, the passability
table and Arabia's ponds are in, and the naval half (a coast, the dock, the
fishing ship) waits on a water map type -- see its "Where it stands".

If water is not going to be built, say so in `status.md` and stop listing its
technologies as gaps.

### Q5. Read effect command type 1, and gain six technologies

**Type 1 is now read** — issue #23's mill technologies are made of it, and
`RESOURCE_ATTRIBUTES` in `tools/import_content.py` plus `PlayerAttribute` in
`src/sim/data.ts` are where a resource id becomes something the game has. What
is left for this item is the six technologies' own resource ids and the two
things they change: a market fee and a conversion resistance, neither of which
the simulation has yet. The paragraph below is the original statement of it.

The importer reads effect commands of type 0, 4 and 5 — set, add and multiply
on a *unit* attribute — and type 3, upgrade unit. It has never looked at
**type 1, the resource modifier**, which changes a player-level attribute
rather than a unit's. Six of the twenty technologies recorded as reaching
nothing are blocked on exactly that and nothing else: Coinage, Banking and
Guilds adjust a market fee; Faith, Devotion and Theocracy adjust conversion
resistance. `a` is the resource id, `b` chooses set or add, `d` is the amount.

This is the best value left in the tree per unit of work — one command type
for six technologies — and it is only visible because `skippedTechnologies`
now records what each refused technology was asking for.

*Verify:* the six are researchable and each measurably changes what it names
(a trade run pays more after Coinage; a monk resists conversion after Faith),
with a determinism test across one of them.

### Q6. Re-measure the per-tick cost — done 2026-08-29

**Measured and recorded in `status.md`**: seed 102, 900 sim-seconds, warm,
both example AIs playing, 1308 live entities on the generated board — median
0.95ms, p90 1.09ms, p99 1.49ms, worst 6.07ms against the 50ms budget. The
worst tick halved against the old figures while the board quintupled its
entities. The original item below stands as history.

### Q6 (history). Re-measure the per-tick cost

`status.md`'s tick distribution — median 0.58ms, p99 1.72ms, worst 11.7ms —
was measured before the shot model, the technology tree, five-minute corpses
and an AI economy three times the size. Batch throughput went up rather than
down over the same period, which is weak evidence that nothing regressed, but
it is aggregate wall clock across sixteen processes and would not show a
worst-tick spike. The worst tick is the number that matters: it was 105ms
before the pathfinder's open list became a heap.

**Part of this is already measured, from a different direction.** The pathing
review (#5, `docs/pathing-review.md`) timed the tick a group order lands on,
which is the worst-tick case this item is worried about: a fifty-unit order
cost **22.35ms** of the fifty-millisecond budget and a per-tick path cache took
it to **11.95ms**, both in a cold process. Warm, running the whole probe, the
same tick is **8.85ms** and ordinary ticks are 0.18-0.26ms — so measure warm,
and beware that a cold single measurement reads about ten milliseconds high. What
is still unmeasured is the 900-second single-match distribution the item asks
for, and in particular the worst tick in a real match rather than a staged
order.

*Verify:* the same 900-second single-match measurement on seed 102, recorded
beside the old figures rather than replacing them.

### Q7. The hit points an age gives — rubble done, hit points left

The rubble half closed with issue #61 on 2026-09-17: each age's collapse and
rubble follow the variant unit. What is left is that those variants carry
more hit points than the Dark Age original — a barracks goes 1200 to 1500, a
house 550 to 750 — which is a real effect of ageing up that is not applied.

*Verify:* a house built after the Feudal Age has 750 hit points where one
built before has 550 — with a determinism test across the change, because it
is a checksum change.

### Q8. A map that looks like Age of Empires — now scoped, and next

**Promoted on 2026-08-28 from last to next. Follow `docs/map-build-plan.md`.**

The board today is two furnished corners and a lot of grass: player openings
come from `land_resources.inc`, every tile is the same grass terrain, the ground
is flat, and the middle of the map holds nothing. The human asked for a genuine
AoE2 map and said the reference data should describe it. It does, and it has now
been read:

- `docs/map-generation-design.md` — what the original's generator actually is.
  Seven phases, and nearly all of it two primitives: a cost-ordered round-robin
  growth loop whose one-line cost decides every shape on the map, and a
  randomised candidate scan for objects over square distance bands. It also
  names the function this codebase is missing — `cleanTerrain` — which is the
  original's own answer to the ragged forest interiors in `backlog.md`.
- `docs/map-conditioning-design.md` — the extension the human asked for after:
  driving the same phases from real geography (Ordnance Survey and Environment
  Agency LIDAR for Britain, Copernicus and WorldCover elsewhere), and the
  fidelity dial between a 1:1 battlefield and a deliberately miniaturised city.
- `docs/map-build-plan.md` — **the run plan**: invariants, a staged queue with a
  test per stage, the evidence still to be gathered, and an explicit licence to
  deviate from all of it when the ground says otherwise.

Of the two blockers named when this item was written, one is gone and one
stands. **Blend edges** were called blocked on a mapping nobody had found;
`blendomatic_x1.dat` had the mapping and nobody had opened it, so edges now fade
(issue #42) and a multi-terrain board no longer ships with hard seams. **Elevation**
still stands: it is a change the renderer, pathfinder, fog and checksum all have
to agree on, which is why it is staged late and behind a question about what
adjacency the original actually permits.

*Verify:* stated per stage in `docs/map-build-plan.md`, each with a determinism
test, because every stage changes the checksum.

## Blocked or deliberately not started

- **Terrain blend edges.** Done, the engine's way (2026-09-19): every tile
  reads its eight neighbours and each higher terrain is drawn through the
  one blendomatic mask for the configuration, with the mode looked up from
  the two blend types -- `status.md`, "Terrain edges fade". What is left is
  optional: DE's own 512x512 masks, whose indexing is in the compiled shader.
- **Water's naval half.** The board is done -- Islands (`?map=islands`), the
  engine's beach, the passability table, the reference's water shader -- and
  the dock and fishing ship (`docs/water-design.md` W4/W5) are entities on
  it. They no longer change the board and can be started mid-run.
- **The monk's occlusion contour.** Its idle and attack outline layers are the
  only consumed sources that fail `tools/sld_layers.py`'s walk invariant, so
  they sit in the manifest's `skippedMasks`. The invariant is the decoder
  working as intended; what those two layers encode differently has not been
  measured, and guessing would undo the thing that makes the decoder
  trustworthy.
- **Civilisation bonuses.** Deliberately out of scope for the tech-tree work:
  they live in the DAT as civ-specific effect commands rather than in the tree,
  and the human ruled them out for that run. The Britons' archer range, faster
  shepherds, cheaper town centers and free Yeomen are all absent.
