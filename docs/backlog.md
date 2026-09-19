# Backlog

Known gaps, ordered roughly by player impact. The curated, ordered work
queue for autonomous runs — with per-item verification steps — is
`overnight.md`; this file is the fuller inventory. Each entry names the evidence and
the likely fix path so a fresh session can pick it up without re-deriving it.
When a session finishes or abandons an item, update it here; completed items
are deleted, not ticked.

## Audio

Unit selection and training voices and the ten feedback cues are wired (see
status.md). Remaining coverage: combat sounds (each attack graphic has its own
DAT sound id), building construction and completion, and the ambient loops
terrain slots name in `wwise_sound_id`. `sounds.json` names no
construction-complete cue, so that one has no owned source to draw on.

- **The under-attack alert's rearm window is approximated.** The per-target
  memory is in (a fight that goes on is one alert; something else being hit
  meanwhile is its own), but how long a thing must be left alone before being
  hit again is news is not in the owned files — `sounds.json` names the cue and
  not its rearm — so ten seconds stands as an approximation.
- **In-game music is missing.** Only voices and feedback cues play. Find the
  music tracks in the owned audio depot (Wwise music events / ambient
  containers) and wire a playlist; if the events are not resolvable through
  the owned metadata, record that here instead of approximating.

## Rendering

- **Terrain blending is the engine's algorithm; the DE-era masks are not
  used.** Edges are blendomatic's 31 masks over the eight-neighbour
  configuration with the mode table (`status.md`, "Terrain edges fade").
  What DE itself draws with is `terrain/masks/*.png` (one per slot, the
  DAT's `overlay_mask_name`) and `terrain/blends/*.png` (per family), which
  `TerrainBlend_ps` names as `g_MaskTexture` and `g_BlendTexture`; how it
  indexes a 512x512 mask against a tile is in the compiled shader. Worth a
  look only if the classic edge ever reads as too soft against DE.
- **The water's red is short and its ripple scale is calibrated.** The
  combination is read from the shader's own SM2 build and the depth alpha is
  now the preset's own class opacity over the drawn tile (`status.md`,
  "Water"), which lands green and blue within eight of DE's Islands
  screenshot; red is 16-29 short in both zones, a neutral term the formula
  does not produce here (the dome lookup's exact matrix is a candidate --
  `skyDomeMtx` is derived from `sky_rotation`/`sky_scale`, not read). Still
  not in any file: the world unit behind `mapScale` (`RIPPLE_TILES`). The
  vertex wave displacement (`wave_amplitude`) is not drawn, and the
  surface's normal is the normal map's rather than the shader's height-tap
  gradient.
- **The minimap's woods are a measured tone.** Trees carry `minimap_color`
  0 in the DAT and DE draws every wood at (41, 140, 33); `src/view/minimap.ts`
  uses that reading. Elevation is not shaded on the minimap, though
  `minimapShades` now carries the up/down entries for it.
- **The shore foam is not drawn.** DE rolls foam along a `WATER_DEFAULT`
  coast (`enable_waves 1`; ponds are 0) through `WaveAnim_ps`
  (`g_WaterAnim1a-d`) from `terrain/water/atlas_v1_{ortho,diag}_{1-4}.png`.
  Measured 2026-09-19: each atlas is 2048 square, 8x8 frames of 256 px, and
  `diag_1` then `diag_2` is one 128-frame sequence of a foam line rolling
  across the frame and back (its centroid travels (93,171) to (135,115) and
  returns), `diag_3`/`diag_4` the same line mirrored, `ortho_1`/`ortho_2`
  and `_3`/`_4` the sequence for a shore that runs screen-orthogonally. What
  is not measured is the frame's footprint against the tile and the
  direction each pair faces; place one pair against a straight stretch of
  Islands coast and compare with a DE screenshot before wiring all four.
- **The fog has no clouds.** AoE2DE's "Animate Fog" option ("animate the fog
  of war with clouds") draws never-seen ground as a slowly drifting brown-grey
  cloud instead of flat black, and "Animate Fog Border" moves the edge between
  seen and explored. The constants are owned -- `colorcorrection.json`'s
  `fog_tint_color`, `fog_anim_speed`, `fog_cell_size`, and the combine
  shader's `g_Time`/`g_FogScreenULOffsets` -- but no cloud texture was found
  under a searchable name in the depot, so the noise may be procedural. Flat
  black is the option-off look and is what ships.
- **The nearctic biome's snow dusting is not dealt.** `Arabia.rms` runs
  `POWDER_LIGHT` (125, Snow Soft Light) over the base at 6% in 24 clumps with
  `clumping_factor -10` for `NEARCTIC_TEMPERATE` only. Tried 2026-09-19 and
  reverted: `growClumps` keeps a clump contiguous whatever the sign of the
  factor, so the pass came out as 20-40-tile blobs of white that read as
  frozen lakes beside the real ponds. What the engine does with a negative
  factor -- thin tendrils, or a scatter -- needs measuring against a DE
  nearctic board before it is worth painting.
- **Seven of Arabia's eleven biomes are not shipped.** Each is twelve terrain
  ids out of the same `MAP_CONSTANTS` block — a data addition, not work — and
  they are left out only so the import does not carry textures no board deals.
  The four that ship span the script's range.
- **The monk draws no occlusion contour.** Its idle and attack outline layers
  are the only consumed sources that fail `tools/sld_layers.py`'s walk
  invariant (`outline row 13: covered 0 of 7 blocks, consumed 11 of 11 bytes`,
  and an empty buffer on attack), so both are in the manifest's `skippedMasks`
  and a monk behind a building simply has no contour. The invariant is the
  decoder working as intended; what these two layers encode differently has not
  been measured.
- **The observation and the renderer read fog memory differently, and only
  one of them filters it.** `observe` drops any remembered entity that is
  currently visible, and everything a player owns is always visible to it, so
  a stale memory of something the player has since claimed never reaches a
  strategy. The renderer walks `visibility.memory` itself and skips only
  entries whose *tile* is fogged, so the same stale entry was drawn on screen
  (issue #17, fixed at the source -- memory of an owned entity is now
  dropped). Worth knowing: a bug in that map is invisible to every protocol
  check and visible only on the canvas.
- **A corpse re-seen through fog replays its death.** Playtest report, now
  half fixed: the decay *stage* is right, because it is derived from the food
  left rather than from a clock, and the remaining food is right too. What
  survives is the death animation playing again, because `view.diedAt` is
  stamped when the view is created and a corpse coming back out of fog gets a
  new view. Wants the death's age carried on the entity or the view keyed
  through the gap.

## Generator

- **`clearAround` under a `for...of` filters nothing.** The opening loop and
  `pickSeeds` in `mapgen.ts` reassign their candidate list inside a
  `for (const tile of order)`, which keeps iterating the original array, so
  `groupSpacing` and the seed separation are not enforced there. Found
  dealing the fish (whose spacing is a mask for that reason). Fixing it
  moves every wood and group on every seed, so it is a deliberate change
  with a look at the boards after, not a drive-by.

## Water

Ponds are on Arabia, Islands is a map, the beach and the passability table
are the engine's and the surface is the reference's shader
(`docs/water-design.md`, "Where it stands"). What is left is the naval half:

- **The example AI does not fish.** It builds no dock and its villagers skip
  fish nodes (`ai.ts`), because a fish two tiles off the bank is food a
  villager cannot reach and the nearest-food rule would re-send one to it
  every tick it went idle. A strategy that builds a dock and trains ships
  is the next piece of the naval half; the observation carries each node's
  kind (`node`) so it can tell a fish from a bush.
- **Warships, transports and fish traps** are out of scope by
  `water-design.md`'s own terms. The dock's tree nodes came in with it:
  Fishing Lines and Gillnets are researchable and reach the ship; the
  warship lines are listed as skipped (no research location or no effect
  in this DAT) and the ships they upgrade are not imported.
- **`FISH_A` is dealt as the snapper.** The salmon (456, six per map at
  scale) is the same 225 food and the same class; only its picture differs.
- **Islands deals no resource islets, and its depth chain is a rule.** The
  2023 script's four 1% `create_land`s (`land_id 20-23`) and their neritic
  fish are not dealt. `F_WaterMasking.inc` is applied as what it converges
  on -- shallow within five tiles of land, medium beyond -- rather than
  grown as its clumps; a pocket of sea too narrow to seed would stay
  shallow in DE and turns medium here.
- **Windsor's survey channels make a busy bank.** The Thames is water by the
  table and has the engine's beach, but the survey's water polygons include
  the lock cuts and weir channels as one-tile strips, so around (230, 90)
  the sweep paints sand rims along a lattice of channels and the reach reads
  busy rather than as a river. `tools/import_terrain.py` could close
  channels under two tiles wide, or the survey could be re-cut at a coarser
  water threshold.

## Civilisations

- **Only the Britons exist, and only their tree.** The importer reads one
  civilisation's units and one civilisation's tech tree; a second would be a
  data addition (another `CivTechTrees/*.json` and another `civIndex`) rather
  than a refactor, but nothing selects between them yet and the match config's
  civilisation field has one legal value.
- **Civilisation bonuses are not implemented.** The Britons' foot archers get
  no extra range, their shepherds work at the ordinary rate, their town centers
  cost full wood from the Castle Age, and Yeomen is not free. These live in the
  DAT as civ-specific effect commands rather than in the tech tree, and were
  deliberately left out of the tech-tree work.

## Simulation

- **The AI can now afford the Castle Age, and pays for it in time to win.**
  Villagers used to go idle whenever a pile ran out while they were away
  banking (issue #19), and fixing that is worth enough food that the built-in
  strategy buys the Castle Age where it never could before. Measured on the
  passive-opponent fixture, seed 7: it razed the enemy town center at 1460
  seconds in the Feudal Age before, and at 1957 seconds after, having spent
  800 food and 200 gold on the age instead of on the attack. Both are wins,
  and the trade is the wrong way round -- it is the same fixed wish list in a
  richer economy, which is exactly what `overnight.md`'s Q1 and Q2 are about.
  The headless fixture's clock was widened from 1800 to 2400 seconds to keep
  asserting the invariant (the AI beats an opponent who does nothing) rather
  than a time that now measures the strategy's priorities.

- **The example AI closes out a game only because matches end early.** The
  batch is decisive again — 16 of 16, 0 timeouts — but that was bought by
  fixing the opening's housing stall, not by teaching the strategy to finish:
  every match is settled in the Feudal Age, and none of the 32 player-slots
  reaches the Castle Age. When both economies did survive into a long game, four
  of sixteen ran out the thirty-minute clock, because neither side can finish
  an opponent as rich as itself — the army marches at the enemy town center,
  grinds against its garrison, and reinforcements arrive one at a time, while
  the endgame raze only sends villagers in once the enemy field is completely
  clear. That failure is dormant rather than fixed, and it will resurface the
  moment the strategy is made to last longer. The trade-off curve between
  economy and decisiveness is recorded in `status.md`.
- **The AI eats sheep, and it does not help.** It claims and works them now
  (six claimed within eight minutes, verified), but its food income is
  unchanged: 159 food in the first four minutes with the herd and 159 without,
  383 against 385 at eight minutes. On this map the berries are nearer than
  the sheep (7.5 tiles against 9.5) and both yield food at the same rate, so
  there is nothing to gain — in AoE2 the gain comes from walking a sheep home
  and eating it under the town center with no return trip, and herdables no
  longer follow anybody here (see below). The queue's N2 verification asked
  for measurably higher early food income and it is not met; this is why.
- **The open fallback stops at the Castle Age.** The hand-written rules in
  `src/sim/data.ts` name only `feudal-age` and `castle-age`, so a player
  without the owned files gets neither the Imperial Age nor any of the
  sixty-six imported technologies — the fallback's tech list is three entries
  long. The Imperial tests in `castle-age.test.ts` `skipIf` the manifest is
  absent for this reason. Whether the fallback should grow a third age or
  stay a Dark-through-Castle demonstration has not been decided.
- **The AI will not touch a boar.** Deliberate: seventy-five hit points and
  seven damage a hit, and AoE2's answer is to lure it home with one villager
  while the rest wait. Ordering two villagers onto one loses both.

- **Trade is unverifiable in normal play.** The cart's loop is proven by
  tests, but a human cannot check it: trading needs a foreign market and the
  built-in AI never builds one. It reaches the Feudal Age now, so the market is
  within its reach — it puts up only camps, houses, a barracks and an archery
  range. Teaching it the market, or an allied player slot, is what makes trade
  observable in a real match.
- **Ageing up changes how a building looks but not how tough it is.** The
  DAT's age technologies replace each building with the next age's unit, and
  those units carry more hit points as well as different art: a barracks goes
  1200 -> 1500 in the Feudal Age, a house 550 -> 750, a mill 600 -> 800. The
  art is imported and drawn (issue #13), and so are each age's own collapse
  and rubble (issue #61); the hit points are not applied, because doing so
  is a simulation change and belongs with the technology effects rather than
  with the renderer.
- **The naval and scorpion upgrade lines are absent.** Every land unit
  upgrade the Britons have is researchable; what is left is the dock's ships
  and the scorpion, which are units this slice does not have at all rather
  than upgrades it is missing. They arrive with the units, not before them.
- **The built-in AI's wish list is three technologies long,** and everything
  added since is invisible to it: it never builds a blacksmith, a mill
  technology, a trebuchet or a wonder, never turns the farm re-sowing on, and
  never queues more than one unit at a building. Loom, the
  man-at-arms and the crossbowman — the ones whose building it actually puts
  up. Sixty-six are researchable; it buys three, in a fixed order, with
  whatever the next age is not waiting for. A strategy that chose among them
  by what it is fighting would be a real improvement, and so would building a
  blacksmith at all: the armour and attack lines are the best value in the
  tree and it never sees them.
- **Some technologies apply only part of what they say.** Where an effect
  command names an attribute this game does not model, the technology is still
  imported and the attribute is recorded in its `unmodelled` list rather than
  dropped. Today that is attribute 23 (search radius) on eight technologies —
  Fletching, Bodkin Arrow, Bracer, Block Printing, Chemistry, Siege Engineers,
  Yeomen and the Castle and Imperial Ages — attribute 130 on four (Bodkin
  Arrow, Bracer, Chemistry, Fletching), and attributes 48 and 49 on the
  Imperial Age alone. Forty-eight further nodes are left out entirely, each
  with its own reason, in the manifest's `skippedTechnologies` — two fewer
  since issue #23, which took Horse Collar and Heavy Plow out of that list by
  reading effect command type 1. A technology that lands *something* now also
  reports what it did not: Heavy Plow's +1 carry for the farmer villagers is
  attribute 14 on DAT units 214 and 259, and this game has no farmer variant
  to put it on.
- **Technology prerequisites are the DAT's own list, not its count.** The DAT
  states a `required_tech_count` alongside the requirements — Hand Cart needs
  two of three — and the importer instead requires every listed technology that
  this game also offers. That happens to be exactly right for all fifteen
  chains the Britons have, because the extra entries are always the age
  technology or a bookkeeping node, but it is not the general rule.
- **A monk carries no relic, and a monastery holds none.** Relics are named in
  the omitted scope; a monk that could pick one up would need the relic entity,
  the carry state, and the gold trickle.
- **The wonder wins nothing, and whether it should is undecided.** It is
  buildable with every number the DAT gives it (issue #27), but AoE2's wonder
  starts a countdown that ends the match, and that changes how a game can be
  won rather than adding to what is in it. The human was asked and the
  decision is theirs: a countdown wants a length (AoE2 uses 200 years of game
  time, which is a map-setting this game has no equivalent for), a visible
  timer, an alert to the other player, and a rule for what a razed wonder
  does to it. `castle-age.test.ts` asserts a standing wonder wins nothing, so
  a countdown cannot arrive by accident.
- **A siege engine does not re-aim itself, and the AI never builds one.** The
  trebuchet is trainable, packs, unpacks and shoots, but nothing automates it:
  it does not unpack when an enemy building comes into reach, it is not part of
  the built-in strategy's wish list, and a group of them must be packed and
  unpacked one order at a time. The petard, the castle's other Imperial unit,
  is still absent.
- **The castle's petard is still absent.** The longbowman and the trebuchet
  are both trained there now (issue #28); the petard is the third thing the
  DAT lists at unit 82, and every other civilisation's unique unit is out of
  scope because the importer reads civ 1.
- **Hunting and farming pay the forager's wage.** The DAT gives the hunter
  villager its own work rate (0.41 a second) and carry capacity (35), and the
  farmer (259) 0.53 into 10; the simulation has one rate per resource and one
  global capacity, so both bank at the forager's 0.31 into 10. The farmer's
  rate is imported (`villager-farmer.gather`, issue #71) and not applied.
  Per-task rates would need `gatherRatePerSecond` to become per-variant,
  which touches every gatherer.
- **The built-in AI stops at the Feudal Age.** It researches now — Loom in all
  32 player-slots of the paired batch, the Feudal Age in 28 — but the Castle
  Age in none, because matches decide before the food is banked. Everything
  Castle and above (the monastery, the siege workshop, the castle, the
  university, and every unit they train) is therefore unreachable in a played
  match even though the simulation offers it. Whether that wants a richer
  strategy or a longer clock has not been decided.
- **A gate does not shut itself.** AoE2 closes a gate when an enemy is in it,
  which is what stops an attacker walking in behind a retreating villager. Here
  the art opens for the owner's units and passability is decided per player, so
  an enemy is stopped by the closed gate at all times and never squeezes
  through — but the two rules are not the same rule, and making them one means
  giving the simulation a gate state the checksum can see.
- **The example AI's repertoire is still short.** All 16 of the paired batch
  decide; it scouts, sites lumber camps, mining camps and mills against the
  resources it finds, holds the barracks until the wood is banked nearby, works
  sheep, ages up and buys three technologies. Beyond that it gathers, houses
  and attacks in threes, and that is the whole of it — no blacksmith, no
  market, no stable, and no choice among the sixty-six technologies it could
  research.
- **Elevation is visual but not yet gameplay.** Windsor and Senlac raise
  shared terrain/fog vertices and entities from their quantised surveyed
  levels. Pathfinding still treats every slope as level and combat has no
  downhill bonus; finish those authoritative parts of M5 in
  `docs/map-generation-design.md` before calling elevation complete.
- **The global geo backend is not built.** `tools/import_terrain.py` speaks
  only to the Environment Agency's WCS (Britain, OGL). The Copernicus GLO-30
  and ESA WorldCover COGs on AWS both answer HTTP range reads (checked
  2026-08-29), so the fallback for anywhere outside Britain is an afternoon's
  work behind the same descriptor interface.
- **Relics are not on the map, and deliberately.** M3 placed the neutral wood
  and the stragglers but not the five relics `land_resources.inc` asks for:
  no relic art is imported and a monk cannot pick one up, so a relic today
  would be invisible scenery. When relic mechanics arrive, note the mirror
  question: five is odd, and an exactly mirrored board wants two pairs plus a
  decision about the fifth.
- *(Closed 2026-08-29: the empty middle and the ragged forest interiors, both
  by the map generator rebuild — the neutral wood at the script's own density
  now sits between the players, and `cleanTerrain`'s two passes close every
  pinhole and diagonal squeeze, asserted in `mapgen.test.ts`.)*
- **Herdables no longer walk home behind a scout.** A claimed sheep stops where
  it stands and is ordered about by hand, which is what makes it controllable
  at all (the simulation used to overwrite its order four times a second). The
  original's herding — sheep trailing the unit that converted them, so you walk
  them home with the scout — is gone with it. The middle ground, if it is
  wanted, is following only until the first order.
- **The example AI's camp siting is one node deep.** It builds a camp between
  home and the nearest known node of a resource, one per resource until the
  barracks is up and three thereafter, and never re-sites one whose wood has
  been cut out from under it. It is enough to keep an economy running and no
  more; two of the sixteen batch seeds have turned on it so far.

## Interface

- **Garrison's edges.** Units shelter, heal, come out and the building
  shoots for them (issue #75); left: the town bell (`buttons.json` action
  163/165, cell 14, icons 49 and 61), the flag a garrisoned building flies
  (`creatable.garrison_graphic`), rams carrying infantry (`garrison_capacity`
  6 on a unit), production buildings holding the units they train (type 0,
  capacity 10), and what the villagers' `garrison_firepower` of −2.5 encodes
  — read as one arrow, the reference's rule, until the owned files say.
- **Four HUD buttons wear their Disabled art because nothing is behind them:**
  the tech tree, objectives, chat and diplomacy on the menu panel, and the
  minimap's colour and filter modes (player stats toggles the score panel;
  the flare works). `screentechtree.json` and `techtreepreviewpanel.json`
  specify the tech tree screen; the rest are #58.
- **The score panel shows no score.** The reference's is military + economy +
  technology + society (the post-game table's `ScoreStatsAnchor` headers in
  `commandpanel.json` name the columns); nothing computes it, so the row is
  number, name, civilisation and age.
- **The reference's per-unit hotkey letters are imported and unused.** The
  strings file carries each unit's letter (`language_dll_hotkey_text` −
  139000, "A" for the villager); the grid uses the cell's own letter, which
  is the reference's grid layout. Offering the classic layout too is a
  choice `hotkeys.json` supports with its four default sets.
- **The training queue has no portraits.** The reference draws each queued
  unit as a portrait along the parchment (`commandpanel.json`'s
  `QueueButtons` anchor, laid out by the engine), clickable to cancel that
  one; here the progress bar's label says "+N queued" and the last is
  cancelled from the grid. The anchor states only its origin, so the row's
  pitch is the 80x80 command button's.

- **Game speed does not survive a reload.** `+` and `-` step the original's
  four settings plus two fast-forward steps, and it resets to Normal on refresh,
  because the speed is a view preference and the saved session holds game state.
  Persisting it means deciding where a view preference lives. There is also no
  options screen to set it from — the reference has a Game Speed dropdown on
  both the options screen and the lobby (`GameSpeedDropdown`,
  `GameSpeedDropDown`), and neither exists here.

## Debug tooling

- **The protocol now answers geometry as well as state.** `entities` reports
  `amount`/`resourceKind`, the `frame` actually drawn, and a `shape` tag for
  walls and gates (`run-x`, `run-y`, `joint`, `post`, `gate-x`, `gate-y`);
  `sim` reports `selected` and `flashTarget`. Those settled the carcass decay
  question, the order-flash rule and the palisade orientation without a
  screenshot. Keep screenshots for what genuinely needs looking at — the
  palisade's frame-to-meaning mapping did, and compositing the arrangement
  offline was what settled it. Grow the protocol whenever a screenshot loop
  repeats.
