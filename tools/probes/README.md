# Probes

Scripts that ask the game a question. They are not tests — nothing here runs in
the gate — but they are how most rendering, UI and movement questions in this
project get answered without a human looking at a screen. Some are meant to be
copied and thrown away; `pathing.ts` and `farm_mapping.py` are meant to be
re-run, because a doc cites their numbers.

Run them from the repo root: `npx tsx tools/probes/snapshot.ts`.

## Maintained issue-acceptance checks

These scripts live directly under `tools/` and start private Vite/browser
fixtures. Run `npx tsx tools/<name>.mts`; they supplement the gate's general
browser smoke and are maintained regression tools.

- **`audio_smoke.mts`** — #114's real select/move/attack and paid house-build
  gestures; observes native media playing, owned weapon/hammer frame events,
  completion and terrain ambience. Chrome decodes played WAVs and measures
  non-silent PCM; looking away suppresses offscreen combat and unseen terrain.
  Mixer/reference calibration is separately tracked as #243.
  #248 adds actual four-layer ambient fade playback and a real militia-training
  completion whose horn and500ms-delayed voice are both observed playing.
- **`music_smoke.mts`** — #115's27 real owned soundtrack tracks, native seek/end
  transitions and wrap, one live source, gesture unlock, pause/resume,
  hidden/foreground, restart and absent-audio fallback. `MUSIC_SOAK=1` also
  waits for a natural complete111-minute playlist with scene redraws frozen;
  the real audio player and native end callbacks continue throughout.
- **`options_smoke.mts`** — #141's real settings/menu controls, four owned
  training-key profiles, explicit unbound keys, left-handed navigation, exact
  owned score/diplomacy/health colours and minimap pixels, volume changes,
  preference/speed-key persistence, bounded centered geometry and Cancel.
  Also runs with `OPEN_FALLBACK=1`. `map_menu_smoke.mts` additionally verifies
  that saved local speed never overwrites shared authority on join/reload,
  while an explicit options Apply reaches both private clients.
- **`ai_fishing_smoke.mts`** — #91's actual player2 example AI from an untouched
  Islands seed2 opening, using normal speed keys and the normal simulation/AI
  loop. A read-only observer records paid dock completion, ship creation and
  real fish deposits; only afterwards does F4 reveal the dock/ship for rendering
  and selection checks. Also runs with `OPEN_FALLBACK=1`.

- **`regicide_smoke.mts`** — real mode checkbox/Start Game, King sprite/colour/
  voice request, reload/restart and return to random map; two actual400-gold
  Treason clicks, pixel-verified minimap X blink/expiry at a hidden garrisoned
  King, no fog/research leakage, real shelter/occupied-Castle flag and royal
  Delete confirmation/defeat. Loads a v2 headless record through file input and
  verifies its checksum using the browser's real replay clock. Simultaneous
  public King deletions verify the draw popup without a false victory/defeat.
- **`regicide_shared_smoke.mts`** — two actual owned-content v2 browser clients
  on a private authoritative host: guest mode control is read-only, a real
  Treason click pays once and both synchronization hashes agree, mode switches
  reach both clients, and reconnect/checkpoint preserve Regicide. The managed
  host and its live checkpoint are untouched.

- **`diplomacy_smoke.mts`** — enabled native diplomacy menu, locked two-player
  relations, original tribute icon states, draft/Clear/Cancel, Shift/right-click/
  CTRL-all, real Coinage/Banking research and fee deductions, market destruction,
  and read-only replay through file input. Also run with `OPEN_FALLBACK=1`.

- **`relic_placement_smoke.mts`** — generated Islands seed 130, untouched terrain,
  resources and relic positions, staged Castle-age monk/monastery/transport.
  Real right-click pickup of a home relic and the fifth relic on resource land20;
  public outward/return transport, deposits and 60 gold/minute. Shares the journey
  with `relic-journey.test.ts`, which also checks JSON continuation throughout.

- **`civilization_rules_smoke.mts`** — private synthetic second profile through
  the real owned-manifest loader: resumed mixed sides, owner-specific command
  prices, forbidden unit/research filtering, actual training HP, and real house
  placement with the profile's footprint/cost. It proves catalogue plumbing,
  not real Frankish bonuses, unique-unit artwork or conversion inheritance.

- **`tree_fog_smoke.mts`** — #88's accepted visual correction: opaque canopy
  pixels must be identical with ground fog on and F4 reveal, remembered trees
  retain full silhouettes at half linear brightness, and visible shadows match
  their owned masks × Default strength. `TREE_FOG_SCREENSHOTS=1` also saves
  geometry crops under `.local/`. This is the test for the human's comparison.
- **`tree_shadow_smoke.mts`** — the distinct cold-load regression: hold the
  shadow PNG until its tree enters fog memory, then verify texture arrival,
  frozen pose, sRGB darkening and unchanged simulation checksum. Passing this
  alone did **not** establish that #88's visible-canopy problem was fixed.
- **`sprite_residency_smoke.mts`** — #152's repeated walk/idle/expiry/reload
  cycles, decoded-byte and GPU-texture release, unchanged paused pixels and
  synchronization hashes. A private transform advances only the cache clock.
- **`outline_residency_smoke.mts`** — #172's late occlusion after an old contour
  page expires. Missing current art stays hidden and the real renderer continues
  returning pixels without reviving the disposed binding.
- **`composite_outline_smoke.mts`** — #173's actual owned Galley sail contour
  behind the native town-center occluder, measured in sRGB against the same frame
  with only the layer mask hidden. Animated ground is excluded from the A/B.
  Delays the first page request, retires/expires the old page, holds/reloads at the
  asset-loader boundary (decoded browser images may bypass network), and tests
  an empty frame without changing simulation state.
  For #238, `CONTOUR_FAR=1` repeats it at a far 392×392 surveyed-map position;
  `CONTOUR_KIND=villager` tests an ordinary contour. Run all four combinations.
  Each also checks actual draw orders, every opaque contour sample under a real
  placement-footprint mesh, and pixel-identical camera round trips.
  For #119, `CONTOUR_KIND=monk` checks the idle contour; add
  `CONTOUR_ANIMATION=attack` for the attack-art fixture. `CONTOUR_ROOT` selects
  an absolute isolated full-import worktree and `CONTOUR_SCALE=1` asserts the
  base-resolution atlas was used. See `docs/source-integrity.md` for recovery
  evidence; these paused render fixtures do not test conversion gameplay.
- **`terrain_scatter_smoke.mts`** — #55's owned DAT plant sprites in a private
  paused grass fixture and a natural Islands3 opening. Compares sRGB pixels with
  scatter on/off, checks unexplored/foundation suppression, deterministic reload
  and unchanged sim hash. For #250, a second A/B hides only the owned shadow
  materials: every changed pixel must darken, using the imported profile colour/
  strength and drawing below ground fog. Saves `.local/scatter55-fixture.png` and
  `.local/scatter55-islands.png`. Source density/masked-density calibration is
  separate (#249); this probe proves visibility, not exact native distribution.
- **`transport_capacity_smoke.mts`** — #251's loaded-ram boarding. Actual
  overflow/exact-fit right-clicks and cursors, recursive20/20 HUD, a converted
  carrier's stored capacity, intact nested payload and reload hash. Also run
  with `OPEN_FALLBACK=1`. Private coastal fixture, no shared-match mutation.
- **`farm_occupancy_smoke.mts`** — #82/#156's real group right-click assigns one
  farmer. `ENEMY_FARM=1` exercises abandoned-farm capture: owned gather cursor,
  no hover/remote capture, preserved HP, new-owner food banking and reload.
  `OPEN_FALLBACK=1` runs without owned graphics. Opponent initial resources are
  zero so AI training cannot confound the stockpile comparison.
- **`resource_feedback_smoke.mts`** — #70's real unaffordable train/research/build
  clicks. Zero-resource fixture checks enabled buttons, food/gold/wood messages
  and unchanged simulation hash. `OPEN_FALLBACK=1` verifies fallback reasons;
  owned mode compares the imported strings. Pair with
  `population_queue_smoke.mts` for queued production blocked by housing.
- **`map_spacing_smoke.mts`** — #90's natural Arabia/Islands/Black Forest openings
  at seeds3/7. Records resource positions/counts, screenshots and full-board
  minimaps; checks every resource kind exists, no page errors and deterministic
  fresh-seed reload. `MAPGEN_REF=<git-ref>` substitutes only that revision's
  generator in the private Vite server for baseline inspection. Outputs stay
  under `.local/map90-{before,after}-*`; production fog and shared play are untouched.
  `MAPGEN_OUTPUT=<prefix>` preserves prior receipts when reusing the probe for
  another generator change (for example `MAPGEN_OUTPUT=rms56`).
- **`context_cursor_smoke.mts`** — #51's native CUR requests and embedded
  hotspots, 15 real hover/right-click action cases, read-only hover, unexplored
  Gaia rejection, and remembered-resource position/stock instead of hidden live
  data. Also run with `OPEN_FALLBACK=1` for CSS fallback and the same public orders.
- **`sampler_residency_smoke.mts`** — #172's exact Three sampler-cache failure:
  draw page A, switch to B, expire A, then create another B object. Real basic
  and player-ramp rendering must retain identical pixels and unchanged state.
- **`compression_smoke.mts`** — #154's actual Three.js wire sizes, decoded
  byte identity, gzip/Brotli negotiation, cache validation and cold/warm browser
  navigation. Uses open fallback to isolate module transfer from owned artwork.
- **`atlas_sharing_smoke.mts`** — #162's ten-ship A/B with per-animation versus
  shared URLs: fewer decoded bytes/GPU textures, identical rendered PNG pixels
  and simulation hash. Internally rewrites legacy URLs to the same source bytes.
- **`view_lifecycle_smoke.mts`** — #164's actual house-preview/cancel, restart
  and reveal/retire cycles keep GPU geometry allocations bounded; same-seed
  restart preserves pixels and simulation hash. Also run with `OPEN_FALLBACK=1`.
- **`training_queue_smoke.mts`** — separate active unit plus counted waiting
  runs, source-scale 3/3/1 layout, refunds without interrupting the current
  unit, and fourteen waiting entries plus the active one. Also run with
  `OPEN_FALLBACK=1` for the open-content UI.
- **`scorpion_smoke.mts`** — real training/research clicks, Heavy Scorpion art
  and attack display, then a right-click attack.
- **`elevation_placement_smoke.mts`** — #176's real barracks build buttons and
  clicks: red steep-site preview rejects without spending or changing state;
  green one-level ramp preview creates a paid, rendered foundation. Also run
  with `OPEN_FALLBACK=1`. Private accessors read the actual preview material and
  camera projection; building input still goes through the normal UI.
- **`group_movement_smoke.mts`** — #83's real 25-unit ground right-click settles
  into a compact two-dimensional group with all arrivals rendered.
- **`herd_food_smoke.mts`** — #85/#136's AI brings sheep to its TC before
  slaughter and banks the food; a human sheep independently completes its public
  move order. `OPEN_FALLBACK=1` verifies fallback rendering. The AI eats one sheep,
  and an unattended carcass
  loses food at the imported rate with real selection and the remaining-food HUD.
- **`ai_buildings_smoke.mts`** — #86's resource-constrained AI saves from 125
  wood, completes a blacksmith, and renders a building the player can select.
- **`corpse_resight_smoke.mts`** — #120's old corpse survives JSON reload and a
  real scout move out of/back into sight without replaying its death animation.
- **`garrison_edges_smoke.mts`** — #137's real bell/return buttons, production
  self-rally and training, ram boarding/unload, plus rendered player-colour pixels
  in the imported garrison flag rectangles reported through `entities`.
  #245 additionally checks native cell15/B for bell and cell10/G for building
  ungarrison, and exercises those keys through the actual browser input path.
- **`minimap_markers_smoke.mts`** — actual minimap pixels for live and remembered
  building dots, reveal parity, and the absence of a farm marker.
- **`minimap_relief_smoke.mts`** — #96's actual sRGB canvas pixels for all three
  imported grass/forest shades, live/remembered tree overlays, fog/reveal, flat
  water, fallback/old/replaced palettes and a 392×392 board. The isolated browser
  fixture checks state immutability and a four-sided hill's screen-right lighting
  against the human's editor reference. It verifies the coarse orientation and
  palette use, not DE's exact diagonal/corner slope classification.
- **`world_relief_smoke.mts`** — #160's production world-terrain meshes in a
  private Three.js browser fixture (`world_relief_fixture.ts`). A symmetric hill
  has both screen-right faces brighter than both left faces. Uses 5×5
  linear-sRGB crops at 2/3 native projection scale, normalized by an unshaded
  draw of identical geometry/UVs to cancel texture variation. Checks imported
  grass and open fallback, unchanged geometry/UVs and simulation checksum.
  Orientation is reference-informed; neither exact DE lighting strength nor
  the missing original reference RGB is asserted.
- **`shore_blend_smoke.mts`** — #148's real production loader/ground geometry/
  blend material against the imported DE water-shape alpha bytes: 31 mask
  configurations and 775 linear-sRGB samples. Diagnostic red beach/cyan water
  isolate alpha from animated water, terrain texture and foam. Also exercises
  the classic-manifest fallback and asserts simulation immutability. Source
  sampling correctness is measured; exact DE engine UV selection is inferred.

## General probes

- **`performance_soak.mts`** (under `tools/`) — sustained Linux/SwiftShader
  two-AI browser workload using public commands and actual speed/map controls.
  `SOAK_MINUTES=30 npx tsx tools/performance_soak.mts` cycles Arabia, Windsor,
  Black Forest and Senlac; `SOAK_UNTIL=<ISO timestamp>` supplies a hard run end.
  `SOAK_SPEEDS=1,3,5` selects Normal/Extra Fast/10x stress indices; samples report
  the actual multiplier. `MATCH_TICKS`, `SOAK_MAPS` and `SAMPLE_MS` control the
  workload. JSON lines separate startup/transitions, steady samples, victory or
  tick/wall-limit endings, completion and interruption. Samples include timing
  distributions, sprite bytes/evictions, GPU allocations, JS heap, active/pending/
  fading audio sources, music playhead and Linux available memory. Audio samples
  enforce the 24-source budget, including delayed and fading layers. Map changes
  pause through the public F3 key before opening setup; transition failures save
  a snapshot and UI diagnostics under `.local/performance-soak-transition-*.json`.
  Draws end rounds alongside victories. No artificial cache clock or forced GC; stops before host
  memory exhaustion. SIGINT/SIGTERM close the private browser/server.

- **`sim_performance.mts`** — record/compare path hashes and raw-JSON state
  hashes every 1,000 ticks across three imported 12,000-tick AI matches. Run
  `npx tsx tools/probes/sim_performance.mts record .local/sim-before.json`, then
  `compare` after the optimization. Reports stepping/AI times without flaky
  wall-clock assertions; use an idle host for measurements. `MAP=windsor
  SEEDS=3 TICKS=60000` exercises a full surveyed-map match (stops on victory);
  use the same settings for record and compare.

- **`atlas_sharing.py`** — record/compare every sprite/particle PNG hash and
  non-URL manifest field before/after sharing. Run
  `uv run --locked python tools/probes/atlas_sharing.py record .local/atlas-before.json`,
  regenerate through `npm run import:aoe2`, then run the same command with
  `compare` instead of `record`. Reports unique page, RGBA and PNG byte counts.

- **`snapshot.ts`** — build a state in Node through the simulation's own
  `applyCommand`/entity list, hand it to the page as a dev-session snapshot,
  then read what it drew. This is how you photograph a state a fresh match
  cannot reach: a Castle Age town, an army mid-fight, a building mid-collapse.
  Do not add cheats to the debug protocol and do not play twenty minutes.
- **`panel.mjs`** — start a private server, open the only page attached to it,
  and read the HUD out of the DOM and the minimap out of its canvas. HUD
  questions are DOM questions; keep screenshots for geometry.
- **`pathing.ts`** — nine measurements of what the movement actually does, in
  the simulation with no browser at all: detour ratios, whether a group ever
  settles, a crowd through a one-tile gap, a goal nothing can reach, and what
  one order to fifty units costs the tick it lands on. `docs/pathing-review.md`
  is the write-up of a run of it. Not throwaway — re-run it after anything
  that touches `nav.ts`, movement, or the cost of a tick.
- **`sea.mts`** — an Islands sea read back as numbers: the mean colour of a
  tile in the shallow rim and one in the open body, against the 2026-09-19
  composite's (75-82, 165-172, 207-220) and (72, 138, 181) (issue #94),
  plus the minimap's histogram and a crop of each. `MAP=`, `SEED=`, `EXTRA=`
  (a query string the water shader once read switches from), `OUT=`. Not
  throwaway: re-run it after anything that touches `water.ts`, the terrain
  pass or the minimap.
- **`coast.mts`** — photograph a beach tile with land behind it and water
  before it at zoom 1, for the edge's shape against the reference's coast
  crop (#116), and read `edge` profiles across it. `MAP=`, `SEED=`, `OUT=`.
- **`harbour.mts`** — stage a dock with a fishing ship at work beside a
  school and photograph it: the naval slice's acceptance picture. A snapshot
  handed to the page, then `look` and `pixels`; remember a snapshot is
  declined when the URL fixes a map or a seed.
- **`hudshot.mts`** — the HUD at the reference's own 2000x1125, with each
  label's computed font. Crop the same boxes from it and from the reference
  screenshot and stack them at 5x: that is how the face, weight, size and
  digits were settled (issue #92; `docs/ledger.md`). `MAP=`, `SEED=`, `LOOK=x,y`, `NAME=`, `OUT=`.
- **`scroll.ts`** — issue #31: holds ArrowDown for real, blurs the window
  without a keyup (the alt-tab case), and reads an entity's screen position
  to see whether the camera is still panning.
- **`trebuchet.ts`** — issue #30: stages an unpacked trebuchet bombarding a
  house through a snapshot and samples the animation name and frame over a
  few seconds, plus the projectile art key in flight.
- **`sm2dis.py`** — disassemble the Shader Model 2 build inside one of the
  reference's compiled shaders (`resources/_common/shaders/d3d11/*.so`): the
  arithmetic the constants feed, once `strings` has named them. The water's
  surface (`water.ts`) was read with it; `TerrainBlend_ps` (#116) is next.
  Resources only, never the executable.
- **`farm_mapping.py`** — draws the farm onto the real diamond and measures its
  furrow pitch, which is the answer issue #22 settled: both sheets carry forty
  furrows to the span and the farm shows about twelve across its three tiles.
  Re-run it after anything that touches `FARM_TILES_PER_SPAN` or the terrain
  import; it warns if the count has drifted from what the reference shows.

`snapshot.ts` and `panel.mjs` start their **own** Vite server on their **own**
port and open the only page attached to it (`pathing.ts` needs no browser and
`farm_mapping.py` no game). The shared dev server broadcasts to every attached page
and answers with whichever replies first, so a browser tab somebody left open
on 5173 will answer your measurement from its own match. Pass `root` and
`configFile` explicitly or `createServer` takes the working directory as the
project and serves a 404.

## The reference corpus

`.local/reference/` (gitignored: the images are the reference's) holds the
crops of AoE2DE that measurements are compared against, one line each in
`.local/reference/index.md`: file, what it shows, the game's display
resolution and any crop scale, and the date. Before calibrating anything
visual, look there; if the corpus lacks the thing, ask the human for a
screenshot — three of theirs settled six defects the agent's own metrics
had passed (`docs/reviews/2026-09-19.md` §5). Compare in the space the
`pixels`/`edge` reply names, at the same pixel scale (`hudshot.mts` renders
at the reference's 2000x1125 for exactly that).

Every DE capture from 2026-09-19 has the Enhanced Graphics Pack installed,
and since c501d56 so does our import (#150, #151): texture detail compares
like for like, at DE's default zoom against our 0.8.
`islands-coast-2026-09-19.png` is the coast reference: DE Islands at its
default zoom, 2000x1125 as captured (tropical biome, so its colours are
`CC_JUNGLE`'s; shapes and scale only), with straight and stepped shores,
foam mid-roll and beach-to-grass crossings. Compare ours at zoom 0.8.

Seeded 2026-09-19 with the five HUD crops from the human's 2026-09-17
random-map screenshot (2000x1125, 0.52 of the 3840-wide widget space):
`hud-{top,bottom,menu,score,age}-2026-09-17.png`. The two Islands
screenshots from 2026-09-19 (the minimap and sea; the sun glints and HUD
text) exist only in the chat and are asked for on issue #103.
