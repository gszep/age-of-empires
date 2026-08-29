# Map generation: what the original does, and what to build

`backlog.md` records two map complaints — the middle of a 120x120 board is
empty, and a forest grown one free tile at a time has holes in it. Both are the
same gap: the generator here is a hand-rolled scatter, and the original's is a
small set of reusable primitives run in a fixed order. This note is the
research, not an implementation. Nothing below is built.
`map-conditioning-design.md` extends it: driving the same phases from real
geography, and the fidelity dial between a 1:1 map and a playable miniature.

## Where the evidence comes from, and how good it is

- **`genie-rms`** (github.com/genie-js/genie-rms), a reverse-engineered
  evaluator whose modules are named after the decompiled functions
  (`RGE_RMM_Objects_Generator__place_object` is left in a comment). It is the
  only public thing that states the algorithms rather than the script syntax.
  Its own README calls land positioning "buggy" and terrain/object generation
  "probably inaccurate compared to AoC" — so treat it as the *shape* of the
  algorithm, evidenced, and not as exact numbers.
- **The shipped includes**, `land_resources.inc` and `Arabia.rms`. These are
  data, not reconstruction, and they are what `OPENING` in `game.ts` was already
  transcribed from — the counts and distance bands there match line for line.
- **The DE scripting reference** for what an attribute means and its range.

**Not** from the owned files: `.local/aoe2de` holds only `content.json` and the
atlas cache, and the real scripts live in the resources depot (813784) under
`resources/_common/random-map-scripts`. Before any number here is treated as
fact, that depot should be pulled and the numbers read out of it, the way the
DAT numbers are elsewhere in this project.

## Seven phases over one grid

`PLAYER_SETUP` → `LAND_GENERATION` → `ELEVATION_GENERATION` →
`CLIFF_GENERATION` → `TERRAIN_GENERATION` → `CONNECTION_GENERATION` →
`OBJECTS_GENERATION`.

Two things in that order matter. Terrain runs *after* elevation and cliffs, so a
terrain clump can be told to place only within a height band and cliffs are
already in the way. Objects run last, over finished ground, which is why every
object rule is a question about terrain and zones rather than about other
objects.

## Nearly all of it is two primitives

### 1. Cost-ordered round-robin growth

One `StackNode` per tile, shared by every phase, threaded onto a linked list
kept sorted ascending by `totalCost`; a pop takes the head. Growth is then:

- Seed. A land seeds a `base_size` square (default 3, so 7x7) at its origin and
  stamps its zone id into a search map. A terrain or elevation clump seeds one
  tile taken from a randomised list of the whole map, and then *removes* the
  candidates within `2*sqrt(tiles/clumps)` of it so clumps start apart.
- Grow, **one tile per land or clump per outer pass**, until each has its
  quota. That round robin is the fairness mechanism: two lands racing for the
  same ground advance at the same rate and meet in the middle.
- On placing a tile, push its four neighbours with

  ```
  cost = random(100) - clumping_factor * neighbours + 250
  ```

  where `neighbours` counts same-zone or same-type tiles nearby. Lower cost pops
  sooner, so a tile with more filled neighbours is taken first: high
  `clumping_factor` fills concavities and gives round blobs, low values leave
  the order near-random and give tendrils and ragged edges. It is one line, and
  it is the whole of the shape control.

Each phase differs only in the accept test:

- **Lands.** `border_fuzziness` rejects a tile with probability proportional to
  how far past the land's border it is (`fuzziness * distance`, capped at 101),
  so 0 means borders are suggestions and 100 means they hold. A second test
  refuses any tile whose neighbourhood already contains *another* land's zone —
  that, not the positioning, is what keeps two players' lands from merging, and
  it is the part the reverse engineering says is buggy.
- **Elevation.** Accept if the tile is at the base elevation; hills grow the
  same way, height by height.
- **Terrain.** Accept if the tile is still `base_terrain`, is inside
  `min/max_height`, and has `spacing_to_other_terrain_types` clear of anything
  that is neither the base nor the new type. `set_avoid_player_start_areas` is
  not a hard radius: a "hotspot" map holds `radius - distance` faded around each
  player start, and the tile is rejected with that as a percentage — so forests
  thin out towards a town center rather than stopping at a line.

Then **`cleanTerrain`**, which is the piece we do not have at all. Two passes,
repeated while anything changed and over a widening rectangle: pass one fills
any tile whose north and south, or east and west, neighbours are the terrain;
pass two fills tiles that are only diagonally connected. It is what removes the
single-tile pinholes and the diagonal squeezes from a grown clump. `backlog.md`
records 19 open tiles in the interior of a 63-tile wood and a determined unit
threading a diagonal gap — this function is the original's answer to exactly
that, and it does it without making the shape a circle.

### 2. A randomised candidate scan for objects

`create_object` does not sample a position and retry. It builds a list:

- Take every tile in the bounding box `origin ± max_distance_to_players`, then
  push `width*height/4` *further* tiles drawn at random from the same box.
  Duplicates are the point — this weights the order rather than shuffling it.
- Pop until the group count is met. At pop time, reject the tile if: it is
  within `min_distance_to_players` of any player start (tested per axis, so the
  exclusion is a square, not a disc); it is not in the same land zone as the
  player's origin; `max_distance_to_other_zones` is set and the eight compass
  points at that radius are not all the same zone (the "is there actually room
  here" test that keeps gold out of pockets); or the terrain is wrong.
- Place the group. `set_tight_grouping` flood-fills outward from the tile with
  random costs — a contiguous lump, which is why seven gold sit in a clump you
  can put one mining camp on. `set_loose_grouping` runs a second candidate scan
  inside `group_placement_radius`. `group_variance` jitters the count.
- Then clear every candidate within `min_distance_group_placement` so the next
  group of the same object lands elsewhere.

The consequence worth carrying over: **the distance bands are boxes, not
rings.** Our polar scatter puts resources on an annulus; the original's put them
in a square band with the corners included, which is a visibly different map.

### The random stream

MSVCRT `rand()`, one stream shared by every phase, seeded once per map. Our
xorshift in `random.ts` is as good; what has to match is that phase order and
draw order within a phase are fixed, because the whole map is one stream and any
reordering is a different map. That is already how `createGame` works.

### There is no mirroring

Each player's objects are drawn independently. Fairness comes from equal counts,
equal-rate land growth and the distance bands — not from symmetry, which is why
Arabia is famously not fair. `createGame` mirrors every placement exactly. That
is a deliberate difference and probably the right one for a 1v1 evaluation
harness, but it should be a named choice rather than an accident.

## Measured against what is here now

| the original | `game.ts` today |
|---|---|
| terrain grid, many types | one texture, no per-tile terrain |
| lands, elevation, cliffs, connections | none |
| forest is terrain that carries a tree per tile | trees are entities; `solid: true` gets the same feel |
| growth ordered by a clumping cost, then `cleanTerrain` | `growClump` pops the frontier uniformly, never cleans |
| candidate scan over a square band | polar scatter with 60 retries over an annulus |
| independent draws per player | exact mirror |
| neutral objects between the lands | nothing between the lands |

`OPENING` is a faithful transcription of `land_resources.inc`. The data is
right; the search that consumes it is not the original's.

## What makes one map different from another

There is no map type in the engine. Black Forest and Islands run the same code
in the same order; what differs is four levers in the script, and the properties
the terrain ids carry in the DAT.

**Lever 1 — what the map is before anything is carved.** `base_terrain` fills
the whole grid, and lands are cut *out* of it. This one line decides the genre:

| map | base terrain | player lands | what that makes |
|---|---|---|---|
| Arabia | GRASS3 / DIRT | 25%, base 9, fuzziness 15 | open land, lands barely matter |
| Black Forest | **FOREST** | GRASS 50%, base 13, avoidance 6 | clearings cut out of a wood |
| Arena | **FOREST** | GRASS inside a central 60% land | a walled arena in a wood |
| Islands | **WATER** | 35%, base 9, borders 7, avoidance 9 | one island each |
| Oasis | GRASS/DIRT | 30%, base 7, avoidance 5 | ring of forest, pool in the middle |
| Crater Lake | GRASS | outside an 85% WATER land | a shore around an inland sea |

Islands is not an islands algorithm. It is Arabia with the base terrain set to
water and the land avoidance raised so lands cannot touch.

**Lever 2 — lands are boxes with zone ids.** `left/right/top/bottom_border` are
percentages of the map that a land must stay inside, and they are how every
central feature is built: Oasis's forest is a land with 20% borders (so, the
central 60%) and its pool is one with 40% borders (the central 20%); Gold Rush's
badlands are 85% land inside 15% borders; Crater Lake's sea is 85% inside 10%.
`zone` names the land's zone, `other_zone_avoidance_distance` is how many tiles
it must keep from a different zone, and `min_placement_distance` how far origins
start apart. Player lands then declare no borders at all and are pushed to the
outside by avoidance alone. The generator has no concept of "centre" or "ring" —
those are box constraints plus a repulsion distance, and nothing else.

The 1999 scripts use no `circle_radius` and no `land_position`; those came later.
Player placement is `random_placement` — the engine's circle-with-variation —
and everything else is shape by constraint.

**Lever 3 — terrain replacement chains.** `create_terrain` only converts tiles
that currently hold its `base_terrain`, so terrains stack in order and the
`base_terrain` field is the dependency edge. Islands does WATER → MED_WATER (40%,
10 clumps, spacing 2) → DEEP_WATER (20%, 6 clumps, spacing 3), and the depth
rings fall out of the chain. Black Forest does the reverse of Arabia: GRASS →
FOREST at 20% to thicken the wood, then FOREST → GRASS at 7% to punch glades in
it. A biome is the same numbers with the terrain names swapped — `start_random`
picks `DESERT_MAP` or `FROZEN_MAP` at the top and every block downstream is an
`if` over which terrain id to use. The layout does not change at all.

**Lever 4 — connections, which is how a map decides whether you can walk.**
`create_connect_all_players_land` finds a cheap path between land origins and
repaints it, with a per-terrain `terrain_cost` and a per-terrain `terrain_size`
(width, and a border width). Black Forest's is the whole map: FOREST costs 2 and
GRASS 1 so the path prefers open ground, FOREST is replaced by GRASS at
`terrain_size FOREST 3 1` — a three-wide corridor — and grass is left at size 0.
That is the famous single road through the wood, and it is four lines of table.
`create_connect_teams_lands` runs again over the same map painting ROAD2, which
is why allies get a road and enemies get a gap.

**What the terrain id itself brings, without the script asking.** This is the
part that would be ours to import rather than to implement:

- **Terrains carry objects.** `Terrain` in the DAT has `TerrainUnitID[30]`,
  `TerrainUnitDensity[30]`, `TerrainUnitCentering[30]` and
  `NumberOfTerrainUnitsUsed` — the slot names what is scattered on it and how
  thickly. That is why Black Forest's entire base terrain is FOREST and the
  script places only 100 extra oaks: the trees come with the ground. The
  importer reads `dat.terrain_block.terrains[id]` already and takes four fields
  from it; these are three more.
- **Terrains decide who may walk.** The terrain-restriction table
  (`water-design.md`) is what makes a water land a naval map and a forest land a
  wall. The generator paints ids and knows nothing about it.
- **Beaches are automatic.** After terrain generation the engine sweeps the map
  and turns any non-water tile with a water tile in its eight neighbours into
  Beach — Ice Beach for snow and ice. No script asks for a shoreline.
- **Elevation and terrain are coupled both ways.** `set_flat_terrain_only` and
  the height limits keep a terrain off hills; and elevation names a
  `base_terrain` of its own, which is how Black Forest puts 4300 tiles of hill
  on the forest and only 700 on the grass — hilly woods, flat clearings.

The consequence for us is a design one: a map type is **data**, not code. If M1
and M2 are built as parameterised phases with a small descriptor in front of
them — base terrain, a list of lands, a list of terrain clumps, a connection
table, the object list we already have — then Black Forest is a descriptor and
not a feature.

## What to build, in order

**M1. A terrain grid and the growth primitive.** `GameState` gains
`terrain: Uint8Array` of DAT terrain ids — this is `water-design.md`'s W1, and
it should be done once, for both. With it, a single `growRegion` helper: seeded
clumps, round-robin, the `random(100) - clumping*neighbours + 250` cost, and
`cleanTerrain` afterwards. `growClump` becomes one caller of it.
*Acceptance:* the wood measured on seed 7 has no open interior tile and no
diagonal-only gap, and a determinism replay still checksums clean.

**M2. Object placement as a candidate scan.** Replace `placeGroup` with the
list-and-pop search: square distance bands, tight and loose grouping,
`min_distance_group_placement`, and the room test. `OPENING` gains the
`min_distance_group_placement` and `max_distance_to_other_zones` fields it
already has values for in the include and currently drops.
*Acceptance:* no group overlaps another; a seed sweep shows resources in the
corners of the band, not only on a ring; the 16-seed batch still decides 16.

**M3. The middle of the map.** A terrain-generation phase — neutral forest
clumps at Arabia's own numbers (12% of the map, 10 clumps, spacing 5, avoiding
start areas) — plus the neutral objects the includes place and we do not: 5
relics at 25+ tiles from any player, and 30 scattered trees at map scale. This
is the `backlog.md` item, and after M1 and M2 it is configuration rather than
new machinery.
*Acceptance:* a screenshot of the board with something to fight over between the
two openings; the AI still finds its own wood.

**M4. Land generation and connections.** Not deferred, on reflection: reading
the scripts changed this. Black Forest and Arena need no water at all — they are
`base_terrain FOREST` with grass lands carved out and a connection table cutting
a three-wide road through the wood, and this project already has solid woods
that a unit must walk round. Land generation is M1's growth loop with a zone id,
a border box and an avoidance distance; connections are a cheapest path between
land origins that repaints a corridor. Together they are one more phase each and
they buy a second map type that plays completely differently from the first.
*Acceptance:* Black Forest generates as a descriptor, not as code; the road is
the only route between the two clearings, and the pathfinder finds it.

Water maps still wait on `water-design.md` W2, because a water land is only a
map once something floats.

**M5. Elevation and cliffs.** Defer, and know why: elevation is not decoration.
The original gives a damage bonus for attacking downhill (widely quoted as
±25%, and it is in the DAT — read it rather than trust the number), and it
changes the renderer's tile geometry and the minimap. That is a combat and a
view subsystem, not a map one.

## The things to decide before starting

1. **Mirroring.** Keep it (fair by construction, and the batch's paired seeds
   depend on nothing else) or drop it for the original's independent draws
   (real maps, unfair openings, and a headless evaluation that has to say so).
   Recommendation: keep it, and put the reason in `status.md` as a named
   discrepancy rather than leaving it implicit.
2. **Forests: terrain or objects.** M1 makes both possible. Objects work today
   and carry gather amounts; terrain-with-trees is what the original does and is
   what makes `cleanTerrain` meaningful for the ground as well as for the trees.
   Recommendation: keep trees as entities and run the clump growth over a
   *mask*, so the shape is the original's and the resource model is unchanged.
3. **Descriptor or code.** A map type in the original is a script; here it would
   be a data structure the phases read. Building M1–M3 against a descriptor
   costs a little more now and makes M4 nearly free; hardcoding the one map we
   have costs nothing now and means writing the generator twice.
   Recommendation: descriptor, and keep it in `data.ts` beside the rules.
4. **Checksum churn.** A terrain grid is hashed by `canonicalSnapshot`, and M2
   changes every map on every seed. Both invalidate stored replays. Better to
   take that once, with M1 and M2 landing together, than twice.

## What the build found (2026-08-29, the run that built it)

M1-M4 are built (`src/sim/mapgen.ts`), and the run corrected this note in
four places worth keeping:

- **The owned scripts are not where this note said.** The depot's
  `resources/_common/random-map-scripts` directory exists and is empty; the
  real scripts live in `depot_813784/resources/_common/drs/gamedata_x2/` —
  DE-era `Arabia.rms` (biome themes, 1756 lines), `Black_Forest.rms`, and the
  same `land_resources.inc` the OPENING numbers came from. The DE Arabia
  global forest is 6-10% of the map in 10-14 clumps at spacing 6; the 12%/10
  clumps quoted above was the 1999 public copy's reading.
- **Black Forest's clearing is stated, not guessed:** `create_player_lands`
  with `land_percent 44` shared across players, `base_size 14` with
  `set_circular_base`, `clumping_factor 2`, avoidance 6 — a stamped round
  core with a soft fringe, which is exactly how it is now implemented. A
  first attempt growing 3400 tiles from a bare seed wandered into an amoeba;
  the circular base is not decoration, it is the shape.
- **Deviations taken and kept:** the mirror stays (named in `status.md`);
  the road's tiles are reserved against objects, because a gold lump in the
  one corridor is a wall the script's terrain-repaint would never allow;
  border tiles take trees, or the map rim is a second road; lone stragglers
  keep two clear tiles from every other tree, because a one-tile gap beside a
  wood reads and walks as the pinhole `cleanTerrain` exists to close.
- **`cleanTerrain` was implemented from the decompiled truth table** (both
  passes, fixed point) and its guarantees are asserted in `mapgen.test.ts`
  rather than sampled by eye.
