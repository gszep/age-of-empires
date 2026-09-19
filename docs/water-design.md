# Water

`overnight.md` item **D2** asked for shoreline terrain, a dock and a fishing
ship, and said to scope it before starting. This was that scope; it is now
also the record of what is built. Everything below that names a number, a
unit or a terrain slot was read out of the owned DAT (`empires2_x2_p1.dat`,
civ 1) or the owned `Arabia.rms`; anything not evidenced is marked as a
decision rather than a fact.

## Where it stands (2026-09-18)

Built, in `src/sim` and the importer:

- **W1, the terrain grid** -- `GameState.terrain` has been there since the
  map generator was rebuilt (`map-generation-design.md` M1).
- **W3, the shore** -- terrain blending landed with issue #42, and it is
  blendomatic's own mode 3 that draws water over its neighbours, so the
  beach-ring workaround this note once recommended was never needed.
- **The passability table.** `terrain_restrictions` is imported per row
  (`manifest.terrainRestrictions`), every entity carries the row it obeys
  (`terrainRestriction`), and `buildNavGrid`, `placementLegal` and the spawn
  search all ask it. "A land unit may not enter water" is nowhere in the
  code: it is row 7 having no entry for `Water, Shallow`. Windsor's Thames,
  which used to be walked across, is now water.
- **Ponds on Arabia.** `Arabia.rms` deals `WATER_SHALLOW` clumps inside the
  woods (30% none, 40% 16 tiles, 25% 32, 5% 48, scaled by area, ringed by a
  tile of forest). They are grown from their own seed-derived stream so no
  board dealt before them moved an object, and they are mirrored like the
  wood. This is the visual check: a pond in a wood, drawn through the
  blend masks, with a villager that will not wade in.

- **W2, the coast** -- `?map=islands` (2026-09-19): one island per player
  from the owned `Islands.rms`, the engine's beach on every shore, water a
  land unit cannot cross. The engine's beach sweep is the generator's, on
  every board. The sea is two terrains, as the script's `F_WaterMasking.inc`
  leaves it: `Water, Shallow` five tiles out from any coast, `Water, Medium`
  beyond, each drawn as its own tile with the preset's surface over it.
- **The surface** -- `src/view/water.ts` is the reference's `Water_ps`
  reconstructed from its inputs and `water_def.json`'s presets; see
  `status.md` for the one calibrated constant.

Not built: **W4 the dock** and **W5 the fishing ship and fish** -- the DAT
reading for both is below and still holds, and Islands is now a board they
can be verified on.

## Why it was a subsystem and not an item

Every feature before it had been a new entity on the same board: a kind in
the rules, art through the importer, a rule in `src/sim`. Water was the first
that changed the board itself, and three things that were constants stopped
being constants -- the map has more than one terrain (`GameState.terrain`,
checksum-visible), passability is decided by what a tile *is* and *who is
asking* as well as by what stands on it (the restriction row, a second axis
beside the gate's per-owner one), and terrain meets terrain (the blend masks).
All three are now in.

## What the DAT already gives, for free

The owned files are unusually complete here, which is the good news.

**Terrain slots.** The water family is authored and named, each with the same
`name_2` texture handle, tile span and minimap colour the importer already
reads for Grass and the farm:

| id | name | texture | span | blend priority | blend type |
|---|---|---|---|---|---|
| 1 | Water, Shallow | `g_wtr` | 10x10 | 166 | 3 |
| 22 | Water, Deep | `g_wt2` | 10x10 | 176 | 3 |
| 23 | Water, Medium | `g_wt3` | 10x10 | 178 | 3 |
| 4 | Shallows | `g_sha` | 10x10 | 139 | 4 |
| 2 | Beach | `g_bch` | 10x10 | 131 | 2 |
| 107 | Beach, Wet | `g_beach_wet` | 10x10 | 134 | 2 |

`terrain_entry` in `tools/import_content.py` needs no change to bring these in:
adding six ids to the spec's `terrain` block is the whole import.

**Passability, as a table rather than a guess.** `dat.terrain_restrictions` is
53 rows of per-terrain multipliers, and each unit names the row it obeys. The
three rows this slice would use, read out and named:

- restriction **3** — deep-water craft: shallow, medium, deep, ocean, azure,
  shallows, beach, ice, mangrove.
- restriction **6** — the dock: the same water set plus `Ice` (35).
- restriction **13** — the fishing ship (unit 13's own value) and the deep-sea
  fish: the restriction-3 set again.
- land units are restriction **7** (villager, militia, spearman, archer),
  **20** (trade cart) and **28** (scout). All three cross `Beach` (2),
  `Shallows` (4) and `Shallows, Azure` (59) and refuse every open-water slot —
  which is AoE2's own behaviour of wading through shallows, already authored.
  "A land unit may not enter water" is therefore not a rule to write; it is a
  table to read, and it comes with the shallows exception for free.

**The three units.**

- **Dock**, unit 45 (`DOCK`): 1800 hit points, 150 wood, built by the villager
  (unit 118) in 35 seconds, collision 1.5 — three tiles square — restriction 6.
  Its standing graphic is 215, which carries no file of its own: the art is in
  its first delta, `b_dark_dock_age1_x1`. That is exactly the `base` slot the
  palisade already uses, so the importer needs nothing new. Foundation art is
  `b_misc_foundation_dock_x1`.
- **Fishing ship**, unit 13 (`FSHSP`): 50 hit points, 75 wood, 1 population,
  trained at the dock in 40 seconds, speed 1.26, collision 0.4, art
  `u_shp_fishing_ship_x1`, work rate 0.24 a second, carry capacity 15, drop
  sites the dock (45). Its task list names its targets by class: 5 (deep-sea
  fish), 33 (shore fish) and 31, plus a fish trap it can build.
- **Fish**, gaia units carrying food in `resource_storages` type 17: shore fish
  69 (`FISHS`, `a_fish_shore_x1`, 200 food, half-tile collision, restriction
  19) and the deep-sea family 455–458 (`a_fish_dorado/salmon/tuna/snapper`, 225
  food, one-tile collision). Shore fish sit in shallows and are worked from the
  shore; the rest need a boat.

Note that the villager fisherman units (56, 57) are `enabled 0` in this DAT —
shore fishing is done by the ordinary villager, and there is no separate
fisherman art to import.

## What has to be built

In dependency order. Each stage is meant to be shippable on its own, with the
gate green, and to leave the game playable if the next stage never happens.

**W1. A terrain grid in the simulation.** Done -- see above.

**W2. Water on the map and off the pathfinder.** Done. `buildNavGrid` takes
the walker's restriction row and blocks what the row refuses, with the
terrain layer cached per row for the match; Islands puts a sea between the
players and the beach sweep (`beachify`) paints `Beach` on every land tile
with open water among its eight neighbours -- row 7 walks it, row 4 refuses
it, which is why the table was imported whole.

**W3. Terrain rendering that does not embarrass the shore.** Done: the blend
pass is the engine's eight-neighbour algorithm with the mode table, the
beach is one tile of sand, and the water is drawn through the reference's
own shader inputs (`status.md`, "Water").

**W4. The dock.** A building whose placement rule is new: it must sit on the
shore, straddling land and water. In the DAT that is restriction 6 plus a
three-tile footprint; in this codebase it is `placementLegal` learning to ask
about terrain as well as about footprints. The gate already made placement
footprint-aware per axis, so the seam is open.
*Acceptance:* a placement test that refuses the dock inland and on open water
and accepts it on a shoreline; a live screenshot of one standing in the water.

**W5. The fishing ship and the fish.** A trained unit with a restriction row, a
gather task against a gaia entity that carries food, and the dock as its drop
site — which is the villager loop with a different set of legal tiles. Shore
fish are worth doing in the same change because they are the same 200 food and
need no boat, and because "a production building that trains nothing" is exactly
the gap `lessons.md` says not to ship again.
*Acceptance:* a fishing ship trained at a dock walks out, works a fish to
exhaustion, banks food at the dock, and never leaves water; the observation and
command schemas name the new kinds, and the guard test in `observe.test.ts`
proves it.

## Deliberately out of scope

Warships, transports and the naval half of the tech tree; fish traps (unit 199
is `enabled 0` in this DAT and is a Feudal technology's business); the
non-navigable beach family; ice; and any map script. Water is a coast on a
generated map, not a map type.

## What is next

The dock on Islands' shore (W4), then the fishing ship and the fish (W5).
Both are entities on a board that now exists; neither changes the board.
