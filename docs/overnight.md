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

- [ ] **Player-colour palette ramps.** The flat tint washes out shading. The
  authoritative ramps are `depot_813781/resources/_common/palettes/
  playercolor_{blue,red,...}.pal` (JASC-PAL, 256 rows); the SLD player-colour
  mask value is an index into the ramp, not a coverage alpha. Import the
  consumed ramps through the pipeline (hash the sources, deterministic
  output) and make the renderer map mask intensity through the player's ramp.
  *Verify:* `{"type":"pixels","entity":<militia id>}` mean colour moves off
  the flat saturated blue toward ramp values; screenshot side-by-side reads
  as shaded cloth, not neon.
- [ ] **Town-center (annex) player colour.** `src/view/sprites.ts` applies
  the colour mask only to the body piece; annex meshes get none, so the TC
  renders grey. Export annex playercolor masks (the importer already
  converts `annex*-playercolor` atlases — check they exist for the TC) and
  composite them like the body's. *Verify:* entity pixel sample over the TC
  contains the player ramp colours; `colorTint` reported for annexes.
- [ ] **Sprite outlines.** Export the SLD outline layer (BC1, same command
  walk — `tools/sld_layers.py` already skips it by length; decode it
  instead) and draw the thin dark contour. *Verify:* import test asserts
  outline atlases exist for militia; pixel sample along a unit's silhouette
  darkens; screenshot inspection.
- [ ] **Rally-point flags.** Rally points work but draw nothing. Resolve the
  gather-point flag graphic from the DAT (search graphics for the flag used
  on gather-point placement; do not hand-draw), import it, render at the
  rally target while a production building is selected. *Verify:* entities
  query shows the flag view; screenshot with a rally point set.
- [ ] **Corpse decay and tree stumps.** Dead-unit chains (`dying_graphic` →
  corpse/decay, felled tree → stump) are recorded but not imported. Import
  and render them so bodies and stumps persist briefly. *Verify:* kill a
  unit headlessly, entity query shows the corpse state rendering; tree
  depletes to a stump.
- [ ] **Terrain blend edges.** `depot_813782/resources/_common/terrain/
  {blends,masks}` are local and unconsumed; farm patches currently sit on
  hard edges against grass. Consume the blend masks for the terrain pairs in
  use. *Verify:* pixel samples across a farm/grass boundary show a gradient,
  not a step; import regenerates byte-identically.

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

