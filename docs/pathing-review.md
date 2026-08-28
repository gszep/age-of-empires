# Pathing review

Issue #5 asked for the pathing to be *reviewed*, with best practice researched,
on the suspicion that it "likely relates to collision and building/unit/resource
placement". This is that review: what was measured, what the reference practice
is, what was changed, and what is still open.

The short version: **the pathfinder is sound, and nine measurements failed to
reproduce a defect.** One real cost was found and halved. What is missing is
the case the report was written from — see "What is still open".

## What was measured

All figures from the imported rules on the current 120x120 board, in the
simulation with no browser. `tools/probes/pathing.ts` runs all nine; re-run it
after anything that touches `nav.ts`, movement, or the cost of a tick.

| question | result |
| --- | --- |
| walk 20 tiles across open ground | travelled 19.4, **ratio 0.97**, arrived |
| ten units sent to one point | 10/10 arrive, spread 110 ticks, **all settle by tick 602**, zero drift after, all within 1.8 tiles |
| round an 11-tile wall | ratio **2.18** against a geometric detour of about 2.0 |
| round one town center | ratio **1.14**, four direction changes |
| twelve units through a one-tile gap | **12/12 through**, first at tick 100, last at 155, none stuck |
| a goal sealed inside a wall ring | **gives up at tick 142** and stays out, rather than walking on the spot |
| ordered onto a building | stops **2.09 tiles** out, at the footprint edge |
| ten minutes of a real match | **zero stuck ticks** across 49,261 moving ticks, zero units ever stuck |
| the tick a 50-unit order lands on | **22.35ms** before this change, **11.95ms** after — both measured in a cold process; **8.85ms** when the whole probe runs and the JIT is warm |

## What the implementation already does

Measured against the standard references
([Amit's A* pages](https://theory.stanford.edu/~amitp/GameProgramming/index.html),
and the flow-field literature below), the tile layer is textbook:

- **8-connected A*** with an **octile heuristic** and a true `sqrt(2)` diagonal
  cost, so diagonal moves are not free and paths are not over-diagonal.
- **No corner cutting**: a diagonal step is refused when either orthogonal
  neighbour it passes is blocked. This is the classic defect that lets units
  slip through the corner between two trees, and it is already guarded.
- A **binary heap** open list ordered by *f*, then *h*, then tile index. The
  tile index makes the order total, so the pop sequence is fixed and equal-cost
  paths are stable across runs and platforms — a deterministic simulation
  cannot use a heap that breaks ties arbitrarily.
- **Nearest-reachable fallback**: a goal that cannot be reached returns the path
  to the closest tile that can, rather than nothing. Returning nothing had
  callers read it as "arrived".
- **Per-player grids**, because a gate is a hole in its owner's wall and a wall
  to everybody else.
- A **continuous final approach** inside the tile path, so units stop at a
  footprint's edge rather than at a tile centre.

## What was changed

**A per-tick path cache.** A group ordered to one point asks the same question
once per unit; the answer is the same whenever both ends reduce to the same
tiles, because the search is over tiles and nothing else. The cache is a
`WeakMap` on the tick's own grid, so entries expire with the grid and there is
nothing to invalidate.

It stands aside when either end's tile is blocked: `nearestFreeTile` breaks its
ties on the *fractional* target, so two units in one tile can legitimately get
different answers, and the cache would be wrong rather than slow. Each caller
gets its own copy, because a walker shifts waypoints off the front of its path.

The tick a 50-unit order lands on went from **22.35ms to 11.95ms**, and 25
units from 11.81ms to 7.68ms, against a 50ms tick. Those were measured in a
cold process, one size per run; running `tools/probes/pathing.ts` end to end,
with the JIT warm, the same ticks come out at **8.85ms for fifty and 5.72ms for
twenty-five**, with ordinary ticks at 0.18-0.26ms. Take the warm figures as the
real ones and the cold pair as the before/after — a single unit ordered across
the map appears to cost 11.83ms cold and 0.68ms warm, which is warm-up and not
pathfinding. Three full matches of six
thousand ticks each produce **byte-identical checksums** with the cache on and
off, which is the proof that it is a saving and not a change.

## What best practice says, and what it would cost here

The standard answer for many units moving to one destination is a **flow
field** (a Dijkstra map from the goal, each cell holding the direction to step)
rather than one A* per unit. Flow fields were introduced for exactly this in
*Supreme Commander 2* and *Planetary Annihilation*, and they win when agent
counts reach the hundreds or thousands
([jdxdev](https://www.jdxdev.com/blog/2020/05/03/flowfields/)).

That is not this game's shape yet. A match here runs tens of units, not
thousands, the measured spike is now half a tick, and a flow field would:

- change every path, and so every checksum and every stored replay;
- need its own local-avoidance layer, since a field alone puts units into local
  optima and through each other — the same references note that collision
  resolution, not flocking, is what makes it look right;
- still need the continuous "step towards" layer for the last tile, which is
  the part this game already has.

The honest recommendation is **not to build one yet**. The trigger to revisit
is unit counts in the hundreds or a measured order-tick spike that matters
against the 50ms budget; both are `overnight.md`'s Q6 territory.

The other standard finishing step, **path smoothing** (string-pulling a tile
path into straight segments), is worth less here than it usually is: the
measured detour ratios are 1.14 around a building and 2.18 around a wall whose
geometric detour is 2.0, so there is very little staircase left to remove.

## What is still open

**The case the report was written from.** Nine measurements did not reproduce
"poor pathing", so the review cannot say what the human saw, and guessing at it
would be inventing a defect to fix. The question is on issue #5: which units,
doing what, and what did they do that looked wrong? A single description turns
this from a review into a bug.

Two known and recorded gaps sit next to it, neither of them the pathfinder:

- **Forest clumps have ragged interiors** (`backlog.md`): a wood grown outward
  one free tile at a time leaves holes, so a wood reads as a blob with gaps
  rather than a solid mass. The pathfinder refuses to cut the corners between
  them; what is arguable is the shape of the wood.
- **Units are nudged apart by separation** rather than reserving space, so a
  crowd around one point settles into a ring 1.8 tiles wide rather than a
  formation. AoE2 assigns each unit a slot in the group's destination. That is
  a formation feature rather than a pathing one, and it has never been asked
  for here.
