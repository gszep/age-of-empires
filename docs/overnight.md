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

**Start at Q3** (herdables that follow). The standing priority holds: anything
newly tagged `bug` outruns everything in this file — check the issue list
first.

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

1. **Re-run the importer.** `npm run import:aoe2`. The atlas packer changed on
   2026-08-29 (sheets capped at the GPU's 8192 limit), which invalidates the
   whole atlas cache: the first regeneration takes the best part of an hour,
   single-threaded, and is normal — do not restart it.
2. **Read `docs/lessons.md`.** The last three entries are from the overnight
   run: the tail-pipe trap reproduced one layer up against the gate script
   itself, a vitest run that fails with every test green, and background jobs
   dying with the shell that spawned them.

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

**What is left is two questions to the human, not work.** Do not guess at
either; both were left open deliberately, and picking an answer would be
inventing a fact.

- **#22, farm textures.** The DAT pins the frame layout — `frame_count` is the
  product of `terrain_dimensions` for every slot, and Grass's slope frames
  start at `shape_id` 100, so its flat frames really do occupy 0..99 — but it
  never says *which* frame a tile draws, which is engine behaviour. What the
  game draws today is the authored density at the reference's own 96x48 tile,
  so it cannot be called wrong from the data. Three candidates were rendered
  onto the real diamond by `tools/probes/farm_mapping.py`, which writes the
  sheet to compare against, and the question is on the issue. Resume when the human
  answers; nothing else in the farm work is blocked on it.
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

`docs/water-design.md` scopes water as W1–W5 and it is deliberately not
started; its one open question is the shore seam, which is the same blend-mask
mapping that blocks terrain blends.

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

### Q7. Building rubble per age, and the hit points an age gives

Two loose ends left by the age work, both small and both in `backlog.md`. Each
age variant has its own rubble unit (`Barracks Age2 (Rubble)`), so a razed
Feudal barracks leaves Dark Age rubble. And those variants carry more hit
points than the Dark Age original — a barracks goes 1200 to 1500, a house 550
to 750 — which is a real effect of ageing up that is not applied.

*Verify:* a razed Feudal barracks leaves the Feudal rubble, and a house built
after the Feudal Age has 750 hit points where one built before has 550 — with
a determinism test across the change, because it is a checksum change.

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

The two blockers named when this item was written both still stand and are
handled in the plan rather than absorbed: terrain-to-terrain **blend edges** are
blocked on a mapping nobody has found, so a multi-terrain map ships with hard
seams and says so; and **elevation** is a change the renderer, pathfinder, fog
and checksum all have to agree on, which is why it is staged late and behind a
question about what adjacency the original actually permits.

*Verify:* stated per stage in `docs/map-build-plan.md`, each with a determinism
test, because every stage changes the checksum.

## Blocked or deliberately not started

- **Terrain blend edges.** Blocked on evidence, not effort. The DAT gives a
  `blend_type` and `blend_priority` and `terrain/blends/` holds ten masks, but
  nothing says which file a type selects or how a 512x512 mask indexes against
  a tile. Picking one by name and anchoring it by eye would invent a visual,
  which is what the download-first rule exists to prevent. Needs a mapping
  found in the owned data or a side-by-side against the installed game.
- **Water.** `docs/water-design.md` scopes it as W1–W5 from the owned DAT. It
  changes the board rather than adding to it; do not start it mid-run.
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
