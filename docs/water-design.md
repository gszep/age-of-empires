# Water: a design note, not an implementation

`overnight.md` item **D2** asks for shoreline terrain, a dock and a fishing
ship, and says to scope it before starting. This is that scope. Nothing here is
built. Everything below that names a number, a unit or a terrain slot was read
out of the owned DAT (`empires2_x2_p1.dat`, civ 1) during the run that wrote
this note; the commands are in the session, and anything not evidenced is
marked as a decision rather than a fact.

## Why it is a subsystem and not an item

Every feature shipped so far has been a new entity on the same board: a kind in
the rules, art through the importer, a rule in `src/sim`. Water is the first
that changes the board itself. Three things that are currently constants stop
being constants:

- **The map has one terrain.** `createGround` lays a single texture over the
  whole grid and `GameState` has no per-tile terrain at all. Water needs one,
  and `canonicalSnapshot` hashes every field of `GameState` that is not
  `rules` — so a terrain grid is checksum-visible, and every stored replay's
  checksums change the day it lands.
- **Passability is a footprint question.** `buildNavGrid` blocks tiles that
  something stands on. With water it also has to block tiles by what they *are*
  and by *who is asking*: land units off water, ships off land. The per-owner
  grid the palisade gate introduced is the shape of the answer but not the
  answer — this is per unit *class*, and both axes now vary.
- **Terrain meets terrain.** Today no two terrains ever touch, which is exactly
  why the missing blend masks (item A6) have never shown. A grass tile beside a
  water tile with no blend is a hard sawtooth edge, and it is the first thing
  anyone will look at.

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

**W1. A terrain grid in the simulation.** `GameState` gains
`terrain: Uint8Array` of DAT terrain ids, one per tile, generated with the map.
`createGame` fills it with Grass, which is what it means today, so W1 alone
changes no behaviour and no checksum beyond the field's presence. Rules gain a
terrain table: id, name, and the restriction rows that may enter it.
*Acceptance:* a determinism test replays a match to an identical checksum with
the grid present; the existing suite is untouched.

**W2. Water on the map and off the pathfinder.** Map generation grows a water
region (a coast along one edge is the smallest thing that is still a real
coast); `buildNavGrid` gains the unit's restriction row and blocks tiles the row
refuses. Land units path around a lake. Nothing floats yet.
*Acceptance:* nav tests for a land unit ordered across water — it goes round, or
stops on the shore, and never stands on a water tile; a batch run still decides
16 of 16 and replays clean.

**W3. Terrain rendering that does not embarrass the shore.** This is the item
that is currently blocked, and it should be treated as W2's real cost rather
than as a detail. `createGround` becomes per-tile textured, which is
straightforward; the blend between two terrains is not. What was measured for
A6 and recorded in `overnight.md` still stands: nothing found in the owned files
says which file under `terrain/blends/` a terrain's `blend_type` selects, nor
how a 512x512 blend mask is indexed against one tile. Until that mapping is
evidenced, the honest options are (a) ship W3 with hard tile edges and say so,
(b) ship the beach slots as a one-tile-wide authored shore ring, which is art
the DAT does give and which hides most of the seam, or (c) block W3 the way A6
is blocked. **Recommendation: (b).** A beach ring is real AoE2 terrain used the
way AoE2 uses it, it needs no mask mapping, and it degrades honestly.

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

## The one thing to decide before starting

W3. If the answer is (b) — a beach ring — the whole subsystem is five staged
changes with no unknowns in it, and the blend mapping stays exactly as blocked
as it is today, which is a gap this project has already recorded honestly. If
the answer is (a) or (c), W2 ships something that looks wrong, and the run
should say so out loud in `status.md` rather than let a screenshot say it.
