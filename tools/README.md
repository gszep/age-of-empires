# Local import tools

Tools in this directory define reproducible import steps. Tool installations, source game files, and generated proprietary content live in ignored directories.

```text
.tools/          the import pipeline's Python virtualenv
.local/aoe2de/   local source configuration and intermediate data
public/imported/ browser-ready local atlases/manifests
```

No Steam credentials, Steam configuration, DAT files, SLD files, or converted Microsoft assets belong in this repository.

See [`docs/owned-assets-setup.md`](../docs/owned-assets-setup.md) for patch-matched SteamCMD downloads and source paths on macOS, Linux, and Windows/WSL2. `tools/depot.py` resolves the depot root — `AOE2DE_DEPOT_ROOT` first, then the usual SteamCMD/Steam download locations — for both `npm run import:aoe2` and the integration tests.

## Pipeline

`npm run import:aoe2` (= `tools/import_aoe2.sh`) regenerates everything byte-identically:

1. `bootstrap.sh` runs `uv sync --locked` to prepare the pinned Python tool
   environment from `pyproject.toml` and `uv.lock` (import, image, and
   geospatial dependencies). Use `uv run --locked python tools/<tool>.py` for
   direct invocations; do not install packages with pip.
2. `import_content.py` reads the declarative `import-spec.json` and extracts the
   entities, technologies, ages, civilisation and player attributes from the
   patch-matched DAT and the JSON beside it (`eras.json`, `objreplacement.json`,
   `civilizations.json`), with the reference's names, button text and tooltips
   from `--strings` (`resources/en/strings/key-value/key-value-strings-utf8.txt`).
   Historically it extracted the
   Dark Age slice (militia, villager + task variants, town center, barracks,
   house, berries, gold, oak tree) from the patch-matched DAT with
   `genieutils-py`, resolving graphic IDs from semantic slots/task fields and
   hashing every source file into `.local/aoe2de/content.json`.
3. `convert_sld.py` converts every referenced SLD with the local
   `sld_layers.py` decoder — BC1 main layer, BC4 shadow and player-colour
   masks, and the outline layer's own command stream — producing
   `public/imported/aoe2/<key>/<state>.png` plus the combined manifest. The
   player-colour sheet carries the main layer's grey in RGB and the mask's
   coverage in alpha, because that grey indexes the player's palette block.
   Sheets convert in parallel (`--jobs`, four by default; a worker on a
   large x2 sheet holds two gigabytes). Decoding all of it still takes the
   better part of an hour, so an atlas is reused from
   `.local/aoe2de/atlas-cache.json` when its source hash, its frame count and a
   fingerprint of the decoder's own code are unchanged — adding one unit costs
   under a minute, and editing the decoder still regenerates everything.
   `--fresh` ignores the cache; a fresh run was verified to produce
   byte-identical atlases and manifest. When only DAT terrain slots changed,
   `convert_sld.py --terrain-only` updates those DDS textures in an existing
   manifest without needlessly decoding every SLD first.
   With the Enhanced Graphics Pack downloaded (depot `1039811`, beside the
   base depots) both steps take `--uhd-graphics` and every sprite is sourced
   from its `_x2` file at `scale` 2 -- twice the pixels per screen unit, drawn
   at half size (`depot.py` `Graphics`, issue #151). A sheet that outgrows
   the 8192 device limit continues on further pages (`<state>-p1.png` …),
   each a texture of its own; the manifest lists them under `pages` and
   every frame names its page. The whole import measured 57 minutes on four
   workers (2026-09-20), and `public/imported/` grows to 5.5 GB. The game
   loads a sprite page the first time a frame needs it (`spriteTexture`):
   loading all 1,839 up front took the machine down.
4. `import_ui.py` extracts the WEST widget-UI subset (resource/command/map/
   bottom/menu/score panels, materials, entity + action + stat icons,
   click-sound aliases from `sounds.json`, `UIColors.json`, and the faces the
   spec names from `--fonts`) into `public/imported/aoe2/ui/`, converting DDS
   through Pillow and copying PNG and TTF byte-identically.
5. When sound depot 813783 and `vgmstream-cli` are available,
   `import_audio.py` follows consumed cues through the owned PCK/BNK HIRC
   graph, extracts only referenced DIDX media, and writes deterministic
   browser-playable WAV cues under `public/imported/aoe2/audio/`. Widget cues
   arrive as event names to hash; unit voices arrive as the Wwise ids the DAT
   already holds, narrowed to the imported civilisation's branch of the
   `Civilization` switch container.

`npm run test:import` runs the integration suite (`test_import_aoe2.py`) against
the owned fixture, including determinism checks.

## Recorded approximations and source gaps

Every approximation is a row in `docs/ledger.md`. Import-side gaps the
manifest records itself: `skippedMasks` (the monk's outline layers, #119),
`skippedTechnologies` (forty-eight, with reasons), `skippedAtlases`, and in
the UI manifest `rawTextures`/`missingMaterials` (`stat_icon_*` and
`submenu_*` resolve inside the executable; `staticons/` is imported raw) and
`unresolvedTexture` (a few dangling refs in `materials.json`, kept as
evidence rather than substituted). Forager and gold-miner work animations use
the task `proceeding` graphic because the DAT's `working` graphic is `-1`.

## genieutils DAT cheat-sheet

Field names in `genieutils-py` are non-obvious and guessing them costs a
failed run each time. The ones this importer consumes (`unit` is an entry of
`dat.civs[n].units`):

| What you want | Where it lives |
|---|---|
| id, name, HP, LOS, icon | `unit.id`, `.name`, `.hit_points`, `.line_of_sight`, `.icon_id` |
| footprint / clearance | `unit.collision_size_x/_y`, `unit.clearance_size` |
| selection marker shape and size | `unit.obstruction_type` (5 = round unit outline, others square/footprint), `unit.outline_size_x/_y` (half-extents in tiles, can exceed the collision box) |
| movement speed, walk graphic | `unit.speed`; `unit.dead_fish.walking_graphic` |
| idle / death graphics | `unit.standing_graphic`, `unit.dying_graphic` |
| cost and train time/location | `unit.creatable.resource_costs`; `unit.creatable.train_locations[0].unit_id/.train_time` |
| combat (attacks, armor, range, projectile) | `unit.type_50.*` — `.attacks`, `.attack_graphic`, `.projectile_unit_id`, `.graphic_displacement` (launch offset, z = height) |
| projectile arc | `unit.projectile.projectile_arc` (fraction of shot distance, sign varies) |
| how far a miss lands from the aim | `unit.type_50.accuracy_dispersion`, in tiles — 0.33 for the archer line, 0.2 for the set-up trebuchet (unit 42; the packed 331 reads accuracy 92 and no dispersion, and never shoots) |
| a second look for the same unit (the female villager) | `resources/_common/dat/objreplacement.json`: `object_id` 83 → `replacement_object` 293 at `chance` 50, and the reverse. The task counterparts (212, 354, 218, 581, 220, 216, 590) are found by matching `bird.tasks`; the spec names them as `skinOf` entries and `test_import_aoe2.py` checks the match (issue #50) |
| what the reference calls it, and its tooltip | not in the DAT: `resources/en/strings/key-value/key-value-strings-utf8.txt`, indexed by `unit.language_dll_name`, `.language_dll_creation` and `.language_dll_help − 79000` (a technology's `.language_dll_description` is its button text; `.language_dll_hotkey_text − 139000` is its letter). A projectile's ids are junk (issue #48) |
| whether Delete asks first, and what a monk may not take | `unit.creatable.hero_mode`, a flag field: 1 full heal, **2 cannot be converted**, 4 regenerates, 8 defensive stance, 16 protected formation, **32 asks before Delete**, 64 hero glow. Reads 0, 32 or 34 across this roster: the town center, watch tower, monastery, castle and wonder ask; the town center, monastery, castle and wonder cannot be converted (issue #47) |
| what a blast may hurt | `unit.type_50.blast_attack_level` on the shooter against `unit.blast_defense_level` on the bystander — hit when defense ≥ attack. Units 3, buildings 2, trees 1, bushes and mines 0; mangonel 2, onager line and trebuchet 1 (issue #46) |
| villager tasks (gather/build) | `unit.bird.tasks[*]` — `.action_type`, `.class_id`, `.unit_id`, `.resource_in/_out`; rates on `unit.bird.work_rate`; drop-offs in `unit.bird.drop_sites` |
| carried resources | `unit.resource_storages`, `unit.resource_capacity` |
| building construction / annexes | `unit.building.construction_graphic_id`, `unit.building.annexes` |
| corpse / rubble / stump | `unit.dead_unit_id` — the unit whose `standing_graphic` is the decay art |
| player colour and contour | `dat.player_colours[i].player_color_base` (start of the eight-shade block in `original.pal`), `.minimap_color`, `.unit_outline_color` |
| graphic playback | `graphic.file_name`, `.frame_count`, `.angle_count`, `.frame_duration`, `.mirroring_mode` |
| a graphic with no unit behind it | `dat.graphics[*].name` — the gather-point flag is `WaypointFlag <Civ>` |
| a unit's build slot in the villager menu | `unit.creatable.train_locations[*].button_id` — the DAT states the *slot*; which page it is on is engine behaviour, and two buildings share a slot only when they are on different pages |
| a technology's cost, time and place | `tech.resource_costs`; `tech.research_locations[*].location_id` and `.research_time` — **not** `tech.research_time`, which does not exist |
| what a technology does | `dat.effects[tech.effect_id].effect_commands` — **not** `.effect_configs`. `command.type`: 0 set, 1 **resource modifier** (player attribute: `a` = resource id, `b` = 0 set / 1 add, `d` = amount), 2 enable unit, 3 upgrade unit, 4 add, 5 multiply |
| where a player attribute starts | `dat.civs[i].resources[id]` — a farm's food is resource 36 and starts at 175, which is why the mill's technologies can change it |
| a terrain slot | `dat.terrain_block.terrains[i]` — `.name_2` is the texture, `.terrain_dimensions` the frame grid, `.frame_data[0].frame_count` the flat-tile frames (always the product of the dimensions), `.blend_type`/`.blend_priority`, `.colors` three `original.pal` indices — the minimap shade for a tile sloping up, flat, and sloping down (flat is `[1]`), `.is_water` the water class (4 shallow, 1 medium, 2 deep, 8 walkable shallows, 16 beach, 32 land) |
| a unit's minimap dot | `unit.minimap_color`, an `original.pal` index (may be negative: take it mod 256); gaia's resources and animals carry one, trees 0 |
| a task's numbers | `bird.tasks[*].work_value_1/_2` and `.work_range` — note the underscores; there is no `work_value1` or `target_diff` |
| a unit's class | `unit.class_` with the trailing underscore; `unit.unit_class` does not exist |
| an attack or armour | `unit.type_50.attacks[*]` / `.armours[*]` — `.class_` and `.amount`; there is no `.type`, and `armours` is British-spelled |
| whether anything walks round a building | `unit.collision_size_z` (0 means no height to walk into) **and** `unit.obstruction_class` (0) **and** no annexes. All three: the town center reads 0 and 0 like a farm, and obstructs through its four annexes (see `docs/ledger.md`, issue #40) |
| a building's annexes | `unit.building.annexes[*].unit_id`, with 0 meaning an empty slot |
| the terrain blend masks | not in the DAT at all: `resources/_common/dat/blendomatic_x1.dat`, decoded by `tools/import_blends.py`. Nine modes of 82,390 bytes, each 31 masks of `tile_size` 2353 — the pixel count of a 97x49 diamond whose rows run 1, 5, 9 … 97 … 5, 1 |
| an age's collapse and rubble | on the variant unit the age technology's `upgrade unit` command names (`age_variants`): its own `dying_graphic` and `dead_unit_id` (issue #61) |
| what a building burns with | `unit.damage_graphics[*]` — `.graphic_id` a composite with no file of its own, `.damage_percent` 25/50/75 (the fraction of hit points *lost*); its `graphic.deltas[*]` are the flames at `.offset_x/_y` from the hotspot (y down), each a graphic whose `.particle_effect_name` is the DE particle DE draws instead of the HD sprite (`fire_small_left`; definitions in `resources/_common/particles/`, frames in `textures/atlases/fire.json`) (issue #73) |
| soot on a damaged building | not in the DAT: the SLD's fourth layer, `LAYER_DAMAGE` 0x08, a per-pixel weight; `convert_sld.py` packs it as `idle-damage` for buildings (issue #73) |
| repair | the repairer task unit (156 VMREP, 222 VFREP): `bird.work_rate` 12.5 hit points a second; `bird.tasks` with `.action_type` 106 (`cTaskTypeRepair`) name by `.class_id` what it mends and `.work_value_1` how fast (default row 1.0, siege and ships 0.25); the price is `dat.civs[i].resources[270]` (units) and `[271]` (buildings), 0.5 (issue #74) |
| garrison | `unit.garrison_capacity`; `unit.building.garrison_type` (flag field: 1 villagers, 2 infantry and foot archers, 4 cavalry, 8 monks, 16 livestock, 32 siege), `.garrison_heal_rate`; the volley is `unit.creatable.total_projectiles` to `.max_total_projectiles`, extra arrows `.secondary_projectile_unit` with that unit's own `type_50.attacks`; a unit adds `unit.type_50.garrison_firepower` (archers 1.0, villagers **−2.5** — unexplained) (issue #75) |
| the reference's key bindings | not in the DAT either: `resources/_common/dat/hotkeys.json`, 457 bindings over 27 groups, four layouts apiece. `import_ui.py --hotkeys` resolves the ones the spec names |

Fields that do **not** exist, and cost a failed call each time somebody assumes
they do: `unit.clearance_size_x` (it is the tuple `clearance_size`),
`unit.collision_size` (it is `collision_size_x`/`_y` — the opposite convention
to clearance), `unit.transform_unit_id` (a packed and unpacked siege engine are
two units and the DAT does not say which is the other; see `docs/ledger.md`),
`unit.type_50.attacks[*].type` (it is `.class_`).

`tools/survey.py` lists every owned basename under `dat/`, `xs/`,
`particles/`, `widgetui/*.json` and the shaders that nothing in the repo
cites, and every DAT unit field no importer or doc names (`--importers`
asks the stricter question against the importers alone). Run it before
writing "not in the owned files" anywhere: the same audit by hand found
sixteen gaps in an hour on 2026-09-17.

`tools/datq.py` reloads the whole DAT on every invocation, which takes tens of
seconds. Asking it more than two or three questions is slower than writing a
one-shot script that parses once and prints everything you want.

When a needed field is missing here, look it up once —
`uv run --locked python tools/datq.py fields 'dat.civs[1].units[128]'`
(or `grep <term> <expr>`, which also searches this table) — and extend this
table. Do not trial-and-error attribute names.

`unit.name` is not an identity: they are AoK leftovers that never moved with
the ids (unit 74 "SPRMN" is the militia; unit 7 "XBOWM" is the skirmisher).
Identify a unit by the file name of its graphics and by its numbers.

## Library notes

1. `genieutils-py` 0.1.2 parsed the downloaded `VER 8.9` DAT;
   `aoe2-genie-tooling` 1.2.4 left 22,449 bytes unparsed and is not used.
2. Pillow decodes the DDS icon textures (BC-compressed) directly.
3. `vgmstream-cli` decodes Wwise media as an external permissively licensed
   tool; no decoder code or owned audio enters the repository.
