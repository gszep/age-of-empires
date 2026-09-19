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
| Starting resources | 200 food / 200 wood / 100 gold / **0 stone** | chosen (fallback leaked); reference Standard is 200 stone | `data.ts` `startingResources` | #105 |
| Onager projectile speed | 5 | chosen (fallback leaked); DAT projectile 656 is 3.5 | `data.ts` `rulesFromManifest` | #105 |
| Herd / flee ranges | 2.5 / 5 tiles | chosen (fallback leaked); DAT holds the sheep's task ranges | `data.ts` | #105 |
| Drop-site `accepts` | hand table | chosen; `dropsites.json` and `bird.drop_sites` state it | `data.ts` | #52 |
| Speed / train / reload / frame defaults when a manifest field is absent | `?? 0.8`, `?? 25`, `?? 2`, `?? 10` | chosen | `data.ts` `rulesFromManifest` | #105 |
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
| Blend pass | blendomatic's 31 masks over eight neighbours | engine's classic algorithm; DE's own masks and `TerrainBlend_ps` unread | `world.ts`, `import_blends.py` | #116, #113 |
| Water facet tilt, ripple repeat, sun placement | 120 per unit amplitude, 6 tiles, behind the camera | measured (reference glints); `mapScale`'s unit and `sun_direction`'s frame unstated | `water.ts` | #94 |
| Water red | 12-24 short of the reference in both zones | measured gap | `water.ts` | #94, #113 |
| Shore foam | not drawn | atlases read, placement unmeasured | — | #89 |
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
| The monk's occlusion contour | absent | decoder invariant fails on its outline layers | manifest `skippedMasks` | #119 |

## Adding a row

A row is added in the same commit as the value. "Where" is a file and a
symbol; "Source" is one of the classes above; an inferred rule says so even
when the result looks right. When a row is later read from a file, delete it
— `git log` keeps the record.
