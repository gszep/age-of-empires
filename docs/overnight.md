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

The previous queue (N1–N8) is finished and folded into `docs/status.md`, along
with the twelve `bug` issues open at the time and the whole of the technology
work.

**Since then the human has playtested and filed thirteen more** (2026-08-28),
twelve of them tagged `bug`. They are the queue now — the standing priority on
this repo is that `bug` issues come before anything in this file, so start at
Q0 below and only reach Q0b when the issue list is clear. The three
`enhancement` issues (#5 pathing, #6 multi-unit selection, #7 spawn queue)
were untouched by design until 2026-08-28, when the human put them into the
queue behind the bugs — they are Q0b — and added a new last item, Q8, for
terrain generation. The order is Q0, Q0b, Q1-Q7, then Q8.

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

### Q0. The twelve open `bug` issues from the 2026-08-28 playtest

Read each one on GitHub before starting it; the human's own words are the
specification and several carry screenshots. Grouped by what they are actually
about, because they are not twelve independent bugs:

- **Gathering behaviour** — #19 (a villager does not reliably move to the next
  pile when one is exhausted), #21 (villagers auto-target sheep once the
  bushes are gone, which spends the herd without being asked). One target-
  selection rule sits behind both.
- **Farms** — #22 (the farm texture has too many rows), #24 (no auto-reseed at
  the mill), #23 (mill technologies not implemented — Horse Collar and Heavy
  Plow are two of the skipped forty-eight, and `status.md` records that they
  change attributes 13 and 14 on DAT units 214 and 259, the farm's own
  gatherers; this is a real and reachable piece of work).
- **Combat** — #18 (melee combat ranges not working), #26 (arrow damage
  upgrades not working). #26 is the more alarming of the two: the blacksmith
  attack line is imported and tested, so either the effect is not reaching the
  projectile or the projectile's damage is not read from the shooter. Check
  `releaseAttack` and `struckBy` in `src/sim/game.ts` first.
- **Rendering** — #20 (houses flicker between alternate house models several
  times a second — almost certainly the age-variant art choice being made per
  frame rather than per building), #17 (sheep discovered in fog reappear
  unclaimed when the fog returns — the same class of bug as the corpse that
  replays its death, and `backlog.md` describes that one's cause).
- **Missing content** — #28 (trebuchet), #27 (wonder, untagged), #25 (true
  villager build menus).

Two of the twelve were diagnosed before the run started, so they lead:

- **#20** is `src/view/sprites.ts`'s variation rule keyed on the literal name
  `idle`. A Feudal+ house draws `idle-feudal`, whose manifest entry is three
  *variations* (`frames: 3, directions: 1, frameSeconds: 0`), so it falls into
  the animation branch, takes the 0.1s default for a zero frame time, and
  cycles all three house models three times a second.
- **#26** is not `releaseAttack` or `struckBy`. The importer writes a `combat`
  block only for buildings that fight: `castle` and `town-center` carry
  armours, `house`, `barracks`, `mill` and `outpost` have no `combat` key at
  all. `computeDamage` skips every attack class the target has no armour entry
  for, so an arrow into a house scores zero and returns the `Math.max(1, ...)`
  floor — one damage, forever, upgrade or no upgrade. Farms take the fallback
  rules, which do carry a class-3 entry, which is exactly why the human saw
  upgrades work there and nowhere else. The fix is in the importer, and it is
  a checksum change.

The human approved this order on 2026-08-28: **#20, #26, #18, #19+#21, #17,
#22, #23, #24, #25, #28, #27** — the diagnosed two first, then by shared cause.
Two scope decisions came with it: **#24**'s reseed ships with its HUD toggle
**defaulting off**, so no existing match changes behaviour silently; and
**#27** ships as a buildable structure **with no victory condition**, with the
countdown-victory decision recorded in `backlog.md` for the human rather than
taken here.

*Verify:* each issue closed with the check its own thread asks for, the gate
green, and the fix committed and pushed on its own. Do not batch them.

### Q0b. The three enhancement issues

Behind the bugs, and in the human's own order: **#5** (pathing algorithm is
poor), **#6** (multi-unit selection), **#7** (spawn queue). Read each on GitHub
before starting it. These change how the game is played rather than repairing
it, so each wants the same treatment as a bug: one at a time, its own
verification, its own commit.

*Verify:* as Q0 — the check the thread asks for, the gate green, committed and
pushed on its own.

### Q1. The example AI cannot afford the Castle Age and a win at once

The batch is 16/16 decided again, and no match reaches the Castle Age: they
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
