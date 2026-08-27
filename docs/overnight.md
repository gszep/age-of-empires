# Overnight run checklist

The work queue for autonomous runs, built by comparing the current game
against the reference AoE2DE data in the owned depots. Work strictly top to
bottom, **one item at a time**: an item is done only when its verification
step passes and the quality gate (`npm test`, `npm run build`,
`npm run test:import`) is green, then commit before starting the next. If an
item cannot be finished, revert to the last green state, record what blocked
it here, and move on — a half-shipped feature is worse than an honest gap.
Do not mark an item done on "looks done": run its check.

Use the debug protocol (`AGENTS.md` → Visual debug protocol) and
`npm run debug:smoke` for rendering verification. Record discoveries in
`docs/lessons.md` and keep `docs/backlog.md` and `docs/status.md` truthful as
items land.

## A. Visual fidelity (no new gameplay, all source data already local)

- [x] **Player-colour palette ramps.** Done, but not where this item pointed:
  the mask value *is* a coverage alpha (solid 255 inside, BC4 edge noise
  outside) and the shade lives in the main layer's greys, while the ramp is the
  game palette's 8-shade block at the DAT's `player_color_base` — not
  `playercolor_*.pal`. The importer packs shade+coverage into the player-colour
  sheet and emits each player's block; the renderer looks the grey up through
  it. *Verified:* militia cloth renders 357 distinct palette blues (was one flat
  `#1a6cff`), and the debug readback was fixed to report screen colours.
- [x] **Town-center (annex) player colour.** The importer already produced
  `annex0/annex2-idle-playercolor`; the TC's *body* art carries no
  player-colour layer at all, so its colour is entirely in the annexes and the
  renderer drew none of it. Each annex now gets its own ramp piece.
  *Verified:* pixel sample over the TC returns 3,258 player-blue pixels in
  2,783 shades (was none), and `colorTint` is reported for it again.
- [x] **Sprite outlines.** The layer is not BC1 and not a dark contour: it is
  its own per-block-row command stream (see status.md) holding the one-pixel
  contour AoE2 shows *through* a building standing in front of a unit, in the
  colour the DAT names in `unit_outline_color`. Exported as a tintable mask
  and drawn on occlusion rather than always. *Verified:* import tests assert
  the walk and the militia's outline atlas; a villager walked behind the town
  center renders 198 pixels of the DAT's pure blue and none in the open.
- [x] **Rally-point flags.** No unit in the DAT points at the waypoint flag, so
  the importer resolves it by its own graphic name (`WaypointFlag Britons`, 90
  frames) through a new `effects` section of the spec, and fails if the name
  matches anything but one graphic. Drawn over every sprite at the rally target
  while its building is selected, player colour and all. *Verified:* the
  entities query reports the rally point, and a screenshot with the town center
  selected shows the British flag flying at it.
- [x] **Corpse decay and tree stumps.** The DAT models what a death leaves
  behind as its own unit at `dead_unit_id`, and its standing graphic is the
  art: `u_*_decayA_x1` per unit and task variant, `n_tree_stump_generic_x1`
  for a spent tree or berry bush. Imported through a new `dead` slot; the
  renderer switches from the dying graphic to it once that graphic has played
  out. *Verified:* an entity query (which now reports corpses) shows a killed
  villager move from `villager/death` to `villager/decay`, and a spent tree to
  `tree-oak/decay`.
- [ ] **Terrain blend edges. Blocked on evidence, not effort.** What the owned
  files do say: the DAT gives each terrain a `blend_type` (grass 0, both farm
  slots 1) and a `blend_priority` (grass 111, Farm1 186, Farm Cnst1 180), and
  `terrain/blends/` holds ten 8-bit masks — `farmland.png` the only farm-named
  one. What they do not say is which file a `blend_type` selects, or how a
  512x512 mask is indexed against a tile: its shapes are irregular parcels that
  straddle any 2x2 or 4x4 split, so it is neither one plot nor an atlas of edge
  tiles. `masks/` is a different thing again — `overlay_mask_name` (grass ->
  `masks/grass.png`) is noise, and the neighbouring `terrain_unit_masked_density`
  field suggests it drives decorative scatter rather than the ground's look.
  Picking a blend file by its name and an anchoring by eye would invent a
  visual, which is what the download-first rule exists to prevent. Needs either
  a mapping found in the owned data or a side-by-side against the installed
  game.

## B. Tech tree toward a faithful Dark→Feudal slice

- [x] **Trade cart at the market (the reported gap).** Unit 128 TCART imported
  with its idle/walk/laden/death/decay art, trained at the market for
  100 wood + 50 gold in 51s. The route's economics are the cart's own DAT
  fields rather than the community's gold-per-tile constant, which is not in
  the owned data: it earns at `bird.work_rate` (0.2875/s) for every second on
  the road since its last delivery, capped at `resource_capacity` (100), loads
  at a foreign market and banks whole gold at its own, the remainder riding on
  to the next run. *Verified:* simulation tests build both markets, train a
  cart, and watch gold rise only on the return leg — refusing a route onto the
  cart's own market, and ending the order rather than walking on the spot when
  the far market is walled off. In the live match a cart trained at the market
  renders in player colour, swaps to its laden art on the way home, and pays.
- [x] **Stable and scout cavalry.** Stable (unit 101, 175 wood, 50s) and scout
  cavalry (448, 80 food, 30s, and the only thing the stable trains in this
  slice) imported from the DAT, including `b_west_stable_age2_x1.sld` — the
  file that used to crash the decoder. *Verified:* an import test resolves both
  and names that source; a simulation test builds the stable, trains a scout,
  and checks the stable trains nothing else.
- [x] **Archery-range audit — skirmisher.** The skirmisher is unit 7, which the
  DAT calls "XBOWM" — its identity comes from `u_arc_skirmisher_*`, not its
  name. Imported (25 food + 35 wood, 26s) with its minimum range of 1 tile
  honoured, so a skirmisher with an enemy on top of it holds rather than
  shooting. The audit of every production building's
  `creatable.train_locations` is a table in status.md; what is left out is
  age-gated, another civilisation's, or the herdables (their own item).
  *Verified:* the archery range's trainable list is exactly archer and
  skirmisher, and a simulation test shows the minimum range biting and then
  releasing.
- [x] **Herdables and hunting.** Four sheep by each town center, two deer and a
  boar out on the map, all gaia units carrying the food the DAT stores on them
  (100, 140, 340). A sheep walks over to whoever comes closest — and stays put
  while two players are near it — then follows them; working it turns it into a
  carcass, as in AoE2. Deer bolt from anything that is not gaia; a wounded boar
  turns on whoever wounded it. A carcass outlives the corpse window while it
  still has food on it, and the villager that made it carries the meat home as
  the DAT's hunter (unit 122). *Verified:* simulation tests for each behaviour,
  and in the live match a claimed sheep renders with a player-blue collar
  through the palette ramp while `villager-hunter/work` turns `sheep/idle` into
  `sheep/death` then `sheep/decay` and banks 10 food.
- [x] **Technologies + Feudal age-up.** A building researches one technology at
  a time; cost, research time, building and effects all come from the DAT.
  Loom (50 gold, 25s at the town center) reads its +15 hit points and +1/+2
  armour off the effect commands and heals the villagers already standing
  there. The Feudal Age (500 food, 130s) is tech 101 — which the DAT calls
  "Middle Age" while its *effect* is called "Feudal Age", the same name-versus-
  data trap as the units. Which age a thing belongs to is read from the tech
  that turns it on, so the gate is the DAT's: market, blacksmith, archery
  range, stable, watch tower, archer, skirmisher, spearman, scout cavalry and
  trade cart are all Feudal. *Verified:* a determinism test replays a research
  to an identical checksum; a gate test refuses each Feudal building by name in
  the Dark Age and lets it through after; and the live match walked the whole
  loom → herd → age-up → market chain.

## C. Audio (depot 813783 and vgmstream-cli are installed locally)

- [x] **Selection and acknowledgement voices.** Not through `sounds.json`,
  which holds only UI events: a unit's voice is a Wwise id the DAT already
  carries (`wwise_selection_sound_id`, `wwise_train_sound_id`), so the
  resolver takes an id as well as a name. Those events cover every
  civilisation through one switch container on `Civilization`; its switch
  table is decoded so only the imported civ's branch is taken — the militia's
  three Britons files, exactly the three the DAT lists for civ 1. *Verified:*
  an import test resolves every consumed cue to owned media and asserts the
  narrowing (178 → 3, and nothing at all for an unknown civ rather than
  everything); fifteen aliases are in the audio manifest, and a simulation
  test checks every trainable unit has the `<kind>-select` alias the view
  asks for.
- [x] **Alert and feedback cues.** Ten cues from `sounds.json` — under attack
  (unit and town), population capped, farm depleted, gather point set, error,
  age up, technology researched, victory, defeat — imported through the same
  pipeline. `src/view/cues.ts` reads them out of observed state and answers
  with alias names; the simulation never raises them, because it does not know
  about sound. *Verified:* nine tests drive the watcher over real matches —
  wounding a building raises the town alert once and not again for ten
  seconds, wounding a unit raises the other one, somebody else's losses raise
  neither, and a resumed match says nothing on its first look. A guard test
  checks every cue the watcher can name is in the audio manifest.
  *Not covered:* `sounds.json` names no construction-complete cue, so that one
  is absent rather than approximated; a trained unit is announced by its own
  voice instead (see the item above).

## D. Stretch (large; only after A–C are clean)

- [ ] **Palisade walls and gates.** Wall-segment placement (drag lines),
  gate pathing. Big obstruction-map surface — keep nav tests green.
- [ ] **Water: shoreline terrain, dock, fishing ship.** Requires map-gen
  water, shore tiles, and boat pathing — a subsystem, not an item. Scope a
  design note first; do not start it mid-run.

