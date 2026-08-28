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

**Start at Q1.** Q0 (the twelve playtest bugs) and Q0b (the three enhancement
issues) are finished — the section below records what is left of them, which is
two questions waiting on the human and no work.

The standing priority on this repo is that `bug` issues come before anything in
this file, so **check the issue list first**: anything newly tagged `bug`
outruns Q1. The order after that is Q1–Q7, then Q8 (terrain generation), which
the human added on 2026-08-28 and wants last.

Two things a fresh session needs before touching anything:

1. **Re-run the importer.** `npm run import:aoe2`. Five items in the last run
   changed it — building armour, the mill technologies, the villager build
   slots, the trebuchet and the wonder — and `public/imported/` is gitignored,
   so none of that exists until you regenerate it. The atlas cache makes it
   quick except for genuinely new sprites.
2. **Read `docs/lessons.md`.** Three of its entries were written by the last
   run and all three are about tests that passed while the game was broken.

What landed, in one paragraph each, because the next run should know what it is
standing on. **Combat**: a shot is aimed once and can miss — `accuracy_percent`
decides whether it was aimed true, and Ballistics decides whether it leads a
moving target. **The tree**: sixty-six technologies read from
`CivTechTrees/BRITONS.json` and the DAT's own effect commands, including
fifteen unit upgrades through to the champion and the elite longbowman, with
the DAT's own prerequisite chains. **The ages**: Dark through Imperial, each
one's cost, time and effects from the DAT, and the Imperial Age's twenty-four
technologies behind it — but only in imported mode, because the open
fallback's hand-written rules still stop at the Castle Age. **The board**:
farms draw, buildings wear their age, a razed building falls all the way down
and leaves its rubble for the sixty seconds the DAT allows it, and enemy units
do not linger in the fog.
**The strategy**: the built-in AI ages up, hunts, farms, builds an archery
range and buys Loom and the man-at-arms.

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

**The batch was re-measured after all of it** and is in `status.md`: 16/16
decided, 0 timeouts, **0 replay checksum failures**, 431x throughput, and 30 of
32 player-slots reaching the Feudal Age and **none the Castle**. That last
number is why Q1 is next and why its subject has not changed.

### Q1. The example AI cannot afford the Castle Age and a win at once

**This is the top of the queue. Its subject did not change under Q0, but the
evidence did — read this before touching the strategy.**

The batch was re-measured on 2026-08-28 after the whole of Q0: **16/16
decided, 0 timeouts, 0 replay checksum failures, 431x throughput**, matches
running 1050 to 1619 seconds, and **30 of 32 player-slots in the Feudal Age
and none in the Castle**. Technologies bought across the batch: Loom 32 times,
the Feudal Age 30, the man-at-arms 8. That is the current state of the game;
the paragraphs below are the older analysis and still hold.

One thing did change, and it is the useful clue. Against the *passive*
opponent fixture the AI now **does** buy the Castle Age — fixing the villager
that idled whenever a pile ran out (#19) is worth that much food — and it wins
five hundred seconds later for it, 1460 to 1957 seconds, because the wish list
is still three items long and it spends 800 food and 200 gold on an age rather
than on finishing. So the economy is no longer the binding constraint in a
one-sided game, and in a paired game the matches still end before the age is
affordable. What is missing is a strategy that can *finish*.

The batch is 16/16 decided, and no match reaches the Castle Age: they
end first. Push the economy and the Castle Age arrives in four to six of
sixteen — along with four to six draws. Seven configurations were measured and
the economy end of that trade-off is exhausted; what is missing is a strategy
that can *finish* a won game, so that a longer match is not also an undecided
one.

Neither side can close out an opponent as rich as itself. The army marches at
the enemy town center and grinds; reinforcements arrive one at a time; the
endgame raze only sends villagers in once the enemy field is completely clear,
which stops being true the moment the other side has an economy of its own.

*Verify:* a 16-match paired batch that is 16/16 decided with 0 replay checksum
failures **and** at least one match reaching the Castle Age. Record the new
distribution in `status.md`.

### Q2. A blacksmith the AI never builds

The armour and attack lines are the best value in the tree — Forging is +1
attack for every melee unit for 150 food — and the strategy has no blacksmith,
so it has never seen them. Its wish list is three technologies long and fixed
in order; sixty-six are researchable.

*Verify:* a batch in which the AI researches at least one blacksmith line, and
its army measurably out-fights the same strategy without it (run the two
against each other and record the win rate).

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

### Q6. Re-measure the per-tick cost

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

### Q8. A map that looks like Age of Empires

Last, and only once everything above is done. The board today is two furnished
corners and a lot of grass: player openings come from `land_resources.inc`,
every tile is the same grass terrain, the ground is flat, and the middle of the
map holds nothing. The human asked for a genuine AoE2 map — variation in where
resources sit, in the trees, in the terrain underfoot, and **elevation** — and
noted that the reference data should describe it.

It should: the owned depot ships the random map scripts, and they are the
specification. `create_terrain`, `create_elevation`, `create_object` with their
`number_of_tiles`, `set_scaling_to_map_size`, clumping and spacing parameters
say what the original actually asks the engine to do, and `lessons.md` already
records the cost of reading the numbers without reading the instruction —
scattering objects over a disc is not how the original makes a forest. Find the
map script this slice is matched to, read what it says about terrain mixes,
elevation passes and neutral resource placement, and build from that rather
than from an idea of what a map looks like.

Two known blockers sit next to this and must not be quietly absorbed into it:
terrain-to-terrain **blend edges** are blocked on a mapping nobody has found
(see below), so a multi-terrain map will have hard seams until that is settled;
and elevation is a change to the board that the renderer, the pathfinder, the
fog and the checksum all have to agree on. Scope it in a design doc first, the
way `docs/water-design.md` scopes water, and stage it — do not start it as one
change.

*Verify:* stated per stage in that design doc, each stage with a determinism
test, because every one of them changes the checksum.

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
