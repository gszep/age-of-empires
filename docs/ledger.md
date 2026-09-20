# Ledger of approximations

Every value, rule or picture in imported mode that is **not** read from the
owned files, with where it came from and where it lives. `AGENTS.md`'s
"downloaded-content first" rule requires each to be recorded here the day it
ships; a reader who wants "what is hand-authored" reads this file and nothing
else. The open fallback (`src/sim/data.ts` `FALLBACK_RULES`, the fallback
palettes in `src/view`) is hand-authored by definition and is not listed.

Source classes: **owned** — read from a file (listed only where the reading
is the approximation); **engine** — behaviour the closed runtime has and the
files do not state; **inferred** — from memory of the game or its community
references, unverified against a file; **human** — a number the human read
off the reference; **measured** — fitted to a reference screenshot;
**chosen** — the agent's own number.

## Simulation

| What | Shipped as | Source | Where | Issue |
|---|---|---|---|---|
| Starting resources | 200 food / 200 wood / 100 gold / 200 stone | game setting (the reference's Standard); the DAT's `civs[1].resources[0..3]` are 0 | `data.ts` `rulesFromManifest` | #109 |
| Herdable claim rule | claimed by whoever comes within its line of sight | inferred rule; the distance is the DAT's `line_of_sight` (3) | `data.ts` `animal`, `game.ts` | — |
| Training refused at the population cap | "population cap reached" at queue time | chosen; the reference queues past the cap and waits for houses | `game.ts` `applyCommand` | #143 |
| Drop-site `accepts` | hand table | chosen; `dropsites.json` and `bird.drop_sites` state it | `data.ts` | #52 |
| Speed / train / reload / frame defaults when a manifest field is absent | `?? 0.8`, `?? 25`, `?? 2`, `?? 10` | chosen; only reached when a manifest key is missing (`imported-rules.test.ts` holds the stated ones) | `data.ts` `rulesFromManifest` | — |
| Game-speed multipliers | 1.0 / 1.5 / 1.7 / 2.0 | inferred (Steam, AoEZone threads); the names and the Default are owned strings 20033-20036 | `main.ts` | — |
| A foundation's line of sight | 0 | chosen against observed behaviour (issue #1); DAT has no construction-time LOS | `visibility.ts` | — |
| Conversion odds | uniform over the DAT's 5-9 s window | chosen shape; both ends owned | `game.ts` | — |
| Blast falloff | none inside `blast_width` | chosen; DAT states no falloff | `game.ts` | — |
| Miss scatter, fallback rules only | 1 tile | chosen; imported units use `accuracy_dispersion` | `game.ts` `MISS_TILES` | — |
| Trade gold | `bird.work_rate` × travel seconds, capped at `resource_capacity`, paid on arrival | chosen substitution; the community's 0.46/tile and DE's pay-both-ends are not in the files | `game.ts` | — |
| Trebuchet packed/unpacked pairing | named by hand (331 ↔ 42) | chosen; task 109 names no target unit | `data.ts` | — |
| Farm re-sow from the mill | option, off by default | engine convenience; DAT gives the farm one build location | `game.ts` | — |
| Repair targets beyond the class table (a farm) | repairs at the building rate | chosen | `game.ts` | — |
| `garrison_heal_rate` unit | hit points a second | inferred | `game.ts` | — |
| Villager `garrison_firepower` −2.5 | one arrow | inferred (the reference's rule) | `game.ts` | — |
| Garrison categories by DAT class | editor table | chosen | `game.ts` `GARRISON_CATEGORY` | — |
| Shift-click queue count | 5 | inferred (the reference's count); `hotkeys.json` binds nothing | `main.ts` | — |
| Shift-click route: an unshifted order or Stop clears the route | rule | inferred | `game.ts` | — |
| Delete confirmation | `hero_mode` bit 32 | owned (corrected from "buildings ask") | `data.ts` | — |
| Auto-continue bound | 3 × line of sight, visible only | chosen; the human asked for "approximately their line of sight" | `game.ts` | — |
| Carcass keeps its food; decay follows food, not time | rule | chosen at the human's request (reference rots by time) | `game.ts` | — |
| A claimed sheep stands still | rule | chosen at the human's request (reference follows) | `game.ts` | #136 |
| Corpse window, fallback rules only | 3 s | chosen | `game.ts` | — |
| Animal think interval | 5 ticks | chosen | `game.ts` `ANIMAL_INTERVAL` | — |
| Engagement tolerances | `radius + 1.6`, margins 0.15-0.4, spawn ring +0.2, node pop ≤ 0.12 | chosen | `game.ts` | — |
| Hunter and farmer gather rates | the forager's 0.31 into 10 | chosen; DAT gives 0.41/35 and 0.53/10 | `game.ts` | #132 |
| Technology prerequisites | every listed requirement this game offers | chosen; DAT states `required_tech_count` | `import_content.py` | #129 |
| Unmodelled attributes 23, 130, 48, 49 | recorded per technology, not applied | owned but unmodelled | manifest `unmodelled` | #128 |
| Forty-eight skipped technologies | not researchable, reason each | owned | manifest `skippedTechnologies` | #128, #97, #127 |
| Age variants' hit points | not applied | owned, not applied | — | #126 |
| Mirror-symmetric board | exact mirror | chosen divergence; the paired batch rests on it | `mapgen.ts` | — |
| Black Forest seed 7 | one far-gold pair dropped | chosen compromise | `mapgen.ts` | — |
| Straggler clearance, neutral wood counts | scaled from the script | chosen | `mapgen.ts` | — |
| Water-masking depth chain | applied as the converged rule (shallow ≤ 5 tiles) | chosen; the include grows clumps | `mapgen.ts` | #95 |
| Single land tiles at sea | dropped | chosen (no RMS evidence) | `mapgen.ts` | — |
| Beach sweep | every land tile with open water among eight neighbours becomes Beach | **inferred**; scripts confirm only that the engine does a sweep | `mapgen.ts` | #113 |
| Dock placement | reaches the water and touches the land | inferred | `game.ts` `placementLegal` | — |
| A ship is afloat or nowhere; final approach slides along the bank | rule | inferred from the table's shape | `game.ts` `groundAllows`, `moveTowardOnGround` | — |
| `FISH_A` (salmon) | dealt as the snapper | chosen | `mapgen.ts` | #95 |
| Islands resource islets | not dealt | — | `mapgen.ts` | #95 |
| The AI never orders a villager onto a boar | rule | chosen (deliberate) | `ai.ts` | — |
| AI tuning constants | `ARMY_BEFORE_AGE`, `FARM_SPOTS`, camp costs… | chosen; strategy, not fidelity | `ai.ts` | #124 |
| The wonder wins nothing | rule | decision pending | `game.ts` | #110 |
| Relics | absent | deliberate | — | #130 |
| The 2026-08-28 genie-rms read | algorithm understanding only; code written fresh | GPL source read, recorded under #112 | `mapgen.ts` | #142 |

## View

| What | Shipped as | Source | Where | Issue |
|---|---|---|---|---|
| Order-flash cadence and colour | 0.2 s on/off for 1.2 s, marker colour | chosen; `unit_selection_color_1/2` hold palette 0, no widget | `main.ts` `ORDER_FLASH_*` | — |
| Occlusion contour threshold | ≥ half the sprite's box covered | chosen (stands in for the per-pixel test) | `sprites.ts` `HIDDEN_FRACTION` | — |
| Selection outline width and colour, scene background | 2.5 px, `0xf5f0dc`, `0x18140c` | chosen | `main.ts`, `world.ts` | — |
| Damage soot curve | linear in hit points lost | chosen; the shader's curve is unread | `sprites.ts` | — |
| Which build targets take the seed-sowing graphic | the farm | inferred (engine rule) | `sprites.ts` | — |
| Farm furrow pitch | `FARM_TILES_PER_SPAN = 10` (twelve furrows across) | **human** ("approx 12"); `terrain_dimensions` shown not to mean tiles per span | `world.ts` | — |
| Farm furrow orientation | quarter turn | human ("amend by 90 degrees"), retired by the handedness flip | `world.ts` | — |
| Fog edge softness | `FOG_EDGE_INNER/OUTER` 0.425/0.575 | chosen, then halved by eye | `world.ts` | — |
| Fog sampler | cubic B-spline | chosen; the shader names bilinear (pulls the contour inward a fraction of a tile) | `world.ts` | — |
| Fog levels | unseen 1.0, explored 0.5 | owned (`colorcorrection.json`); black-when-animate-off from the option's string and web reading | `world.ts` | #117 |
| Blend shapes | blendomatic's 31 masks over eight neighbours | engine's classic algorithm; DE's own `terrain/blends/*.png` (512 square, a border fade, a 64-px hole, a 128-px diamond, four slits) are windowed by engine vertex data `TerrainBlend_ps` does not state | `world.ts`, `import_blends.py` | #116, #113 |
| Land crossings through the overlay masks, both ways | the higher terrain over the lower's tile at shape × its `overlay_mask_name`, and the lower back over the higher's tile the same way | owned: `TerrainBlend_ps` gates the layer by `g_MaskTexture` at the tile's uv; **inferred**: that the pass runs both ways (the reference's sand-to-grass crossing is a band of each in the other, and one way exposes the tile's edge), and that `g_OverlayForEdges` is on for land and off for water (the reference's shore is a rim; the water mask is a marble that exposed the tile) | `world.ts` `masked` | #116 |
| Water surface arithmetic | `Water_ps`'s SM2 build, read: height field summed over rgb, three drifting layers, central difference at 0.05, normal over 0.1, dome through `skyDomeMtx`, glint at `specularPower` | owned; register map c0 = (seaFloorIntensity, skyIntensity, specularIntensity, specularPower), c1 = (waveAnimationSpeed, waveRepeatLength, waveAmplitude, mapScale), c2 = (seaFloorScale, lightDirection), c3-c5 specularColor/waterColour/skyColor, c6-c7.xy skyDomeMtx, c7.z time, c7.w terrainScale, c8.x SampleBlendTexture; s4 surface, s5 floor, s0 dome, s1 visibility, s2 depth, s3 beach blend | `water.ts` | #94 |
| Water world frame | world x = tile -x, world y = tile +y; the eye looks along world (1, -1) at 30 degrees | measured: the sun `(0.7, -0.68, 0.45)` reaches the eye only from beyond the surface, and the surface's rows lie at the down-left tile axis's 155 degrees in the reference | `water.ts` `VIEW` | #94 |
| Water `g_terrainScale` | 1, so the Default preset repeats every `20 * 0.0045 * mapWidth` tiles (10.8 on 120) | engine-set, unstated; measured: the reference's streaks decorrelate along their length at that repeat's rate | `water.ts` `TERRAIN_SCALE` | #94 |
| Water `g_time` unit | seconds times the preset's `water_normals_def.velocity` (0.125 in every preset), on the wall clock | inferred: the velocity has no shader input of its own; at a second per second the human found the drift fast | `water.ts` | #94 |
| Water dome orientation | the dome's v not turned over: a flat sea looks up the lower-right quarter (83, 126, 169) | measured: the only quarter whose body sits under both of the reference's zones at one weight | `water.ts` `skyDomeMatrix` | #94 |
| Water surface weight | `1 - (1 - opacity/255)^2` = 0.235 for the 32/255 classes, summed in linear light | measured: the 2026-09-19 composite's rim and open sea sit above their textures by one weight in all three channels (six numbers within 4%); the form is two layers of the stated opacity, whether the engine draws two is unread | `water.ts` `surfaceOpacity` | #94 |
| Water glint scale | 0.15 of the shader's, standing in for `g_VisibilityTexture`'s blue channel, which the engine fills | measured: at 1 a white dash on every mirroring facet, and the reference's open sea has none (99.9th percentile 16 over the mean at 0.52 of 1080p; 0.15 gives 13, 0.3 gives 25) | `water.ts` `GLINT_SCALE` | #94 |
| Water shimmer | three fifths of the reference's fine contrast (high-pass std 3.2 against 5.2 at 0.52 of 1080p), symmetric as the reference's is | measured gap; the wobble reads a smooth quarter of the dome | `water.ts` | #94, #113 |
| Shore foam frame placement | one 256-texel frame in each shore-side water tile's own 96x48 screen rectangle; `diag` for a single land edge, `ortho` across two adjacent ones; the far side is the frame turned over | owned: `WaveAnim_ps` (white at the atlas's red), the frames' 45/0-degree crests and their roll; **measured** (`islands-coast-2026-09-19.png`): the reference's band is ten pixels with a two-pixel core at its 0.8 zoom, which is the frame at one tile, and the crest's arrival at 82 texels then lands three pixels inside the tile edge; **inferred**: that a stepped pair takes `ortho`, and the quarter turn for a run down the screen (the reference shows no such run) | `foam.ts` | #89 |
| Shore foam tempo and phase | 28 frames a second through a loop of 112, the sequence's last sixteen frames faded over its first (the 128th to the first is a cut, five times any other step, which ran along the coast as a wave); the human times DE's roll at about four seconds; a coast rolls together, each tile's phase a fiftieth of the roll on from its neighbour's along either axis (a coin per tile made each tile's crest leap on its own), the mirrored pair changing every twelve tiles | chosen; the reference shows a stretch at one point of the roll | `foam.ts` `FRAME_RATE`, `PHASE_TILES`, `VARIANT_TILES` | #89 |
| Shore foam gaps | no frame on a water tile tucked into a corner (land on two adjacent sides and on a flanking diagonal) or in a one-tile channel (land on opposite sides) | inferred from `islands-coast-gaps-2026-09-19.png`: the cove's inner edges and an inward bend carry none, straight runs and stair-steps do | `foam.ts` | #89 |
| Shore foam strength | the frames' alpha at 0.4 | measured: the reference's band along a straight shore is red +25 to +60 over the water's 80 with no bright core (white at 0.15-0.35) where the frames carry 0.3-0.75; the blend state is the engine's | `foam.ts` `STRENGTH` | #89 |
| Default zoom | 0.8 | measured (the reference's default draws the 2x assets at 0.80) | `main.ts` | — |
| DE's default zoom | 0.80 of ours (a 77-px tile) | measured: a 143-texel mangrove stands 115 px, the water's repeat vector is (404, 202) px | `docs/status.md` | — |
| Minimap wood tone | (41, 140, 33) | measured off DE's minimap; trees carry `minimap_color` 0 | `minimap.ts` | #96 |
| Minimap building squares | too large | reported | `minimap.ts` | #84 |
| Fogged minimap dim | `REMEMBERED_FACTOR` 0.55 | chosen | `minimap.ts` | — |
| Minimap flare | 4 s pulsing ring | chosen; `sounds.json` names the cue only | `minimap.ts` `FLARE_MS` | — |
| Double-click window | 350 ms | chosen | `main.ts` | — |
| HUD text | Georgia Bold at 0.70 × PointSize, Palatino's lining digits | measured against the SDF atlas (`combined.txt`); the atlas itself is the face | `hud.ts`, CSS | #92 |
| Font index → face mapping | inferred | inferred | `import_ui.py` | — |
| Names drop a trailing parenthetical qualifier | rule | chosen; the file's own buildable gate argues for it | `names.ts` | — |
| Stop / Back / Cancel / pack / unpack / build-page cells | the cells the layout leaves | chosen | `main.ts` | — |
| The AI's computer name | dealt by seed from `civilizations.json`'s table | chosen dealing, owned table | `ai.ts` | — |
| Under-attack alert rearm | 10 s | chosen; `sounds.json` names the cue, not its rearm | `cues.ts` `ALERT_INTERVAL` | — |
| Fallow-farm alert grace | 0.5 game seconds | chosen | `cues.ts` `RESEED_GRACE` | — |
| Aesthetic scatter | view-only sprites | chosen (the script deals objects) | `world.ts` | — |
| Nearctic snow dusting | not dealt | tried, reverted | — | #118 |
| Deer startle | hop 1.5 tiles, rest 14-20 s | inferred (AoE wiki); the 1-tile trigger is the DAT's `search_radius` | `data.ts` | — |
| The monk's occlusion contour | absent at x1 | decoder invariant fails on the base depot's outline layers; the pack's x2 layers pass it, so with the pack the monk has its contour | manifest `skippedMasks` | #119 |
| Which file the Enhanced Graphics Pack draws, and at what size | the DAT's `<stem>_x1.sld` becomes the pack's `<stem>_x2.sld`, drawn at half size | inferred: the DAT names `_x1` only; the pack ships a `_x2` for each and its drawn pixels sit within one x1 pixel of the x1 art's once halved about the hotspot (`test_the_pack_sources_every_sprite_at_twice_the_density`); `widgetui/build_atlas.ps1` states the UI's UHD level is twice HD, nothing states the sprites' | `depot.py` `Graphics.source`, `sprites.ts` `applyFrame` | #151 |

## Adding a row

A row is added in the same commit as the value. "Where" is a file and a
symbol; "Source" is one of the classes above; an inferred rule says so even
when the result looks right. When a row is later read from a file, delete it
— `git log` keeps the record.
