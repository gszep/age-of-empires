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

- [ ] **Trade cart at the market (the reported gap).** DAT: unit 128 TCART,
  trains at 84 (market), 100 wood + 50 gold, 51s. Trade gold accrues by
  cart round-trips between own market and an allied/enemy-distance market;
  for the 1v1 slice, use distance-based gold per DE's formula against the
  opposing market. Complete the loop end to end: train button, unit,
  routing, gold income. *Verify:* headless match script trains a cart and
  gold increases on arrival; unit renders with player colour.
- [ ] **Stable and scout cavalry.** Unblocked: the local decoder reads
  `b_west_stable_age2_x1.sld` (see status.md). Add spec entries + sim rules
  for stable (unit 101) and scout cavalry (448). *Verify:* import test
  resolves the stable's atlases; headless match builds a stable and trains a
  scout; smoke screenshot.
- [ ] **Archery-range audit — skirmisher.** The range trains archers only;
  DE's Feudal range also trains skirmishers. Resolve the skirmisher unit in
  the DAT (DE ids differ from legacy — use the cheat-sheet, don't guess),
  import, add to sim. Then audit every production building against
  `creatable.train_locations` and record any remaining gap in backlog.md.
  *Verify:* per building, the sim's trainable list matches the DAT's
  age-appropriate list or the difference is recorded.
- [ ] **Herdables and hunting.** TC-area sheep and map deer/boar are core
  Dark Age food. Gaia units with capture-on-proximity (sheep), hunt
  behaviour (deer flee, boar retaliates), villager hunter task variant
  (VMHUN art already in the DAT). *Verify:* headless script captures a
  sheep and food income flows; boar fights back before dying.
- [ ] **Technologies + Feudal age-up.** The sim has no tech system. Smallest
  faithful slice: research queue at a building, cost/time from the DAT,
  effects applied to rules (start with Loom, then Feudal Age gating the
  Feudal buildings we already ship — market, blacksmith, range, stable,
  watch tower become age-locked as in DE). *Verify:* replay determinism
  holds across a research; Feudal buildings reject placement in Dark Age;
  existing tests updated deliberately, never deleted.

## C. Audio (depot 813783 and vgmstream-cli are installed locally)

- [ ] **Selection and acknowledgement voices.** Resolve unit select/move/
  attack acknowledgement events through `sounds.json` → the PCK/BNK HIRC
  graph (`import_audio.py` already walks it for `button_ui`), import the
  cues, and play them from the view on selection and orders. *Verify:*
  import test resolves each consumed event to owned media byte-identically;
  the aliases wired appear in the audio manifest.
- [ ] **Alert and feedback cues.** Under-attack alert, construction
  complete, training complete, resource-depleted, population-capped —
  events named in `sounds.json`. Play from observation-driven view state,
  never from inside the sim. *Verify:* headless-driven attack on the
  player's building triggers the alert path in the view (unit-testable via
  the HUD's sound hook); cues listed in the manifest.

## D. Stretch (large; only after A–C are clean)

- [ ] **Palisade walls and gates.** Wall-segment placement (drag lines),
  gate pathing. Big obstruction-map surface — keep nav tests green.
- [ ] **Water: shoreline terrain, dock, fishing ship.** Requires map-gen
  water, shore tiles, and boat pathing — a subsystem, not an item. Scope a
  design note first; do not start it mid-run.

