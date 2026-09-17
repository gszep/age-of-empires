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
   Decoding all of it takes about twenty minutes, so an atlas is reused from
   `.local/aoe2de/atlas-cache.json` when its source hash, its frame count and a
   fingerprint of the decoder's own code are unchanged — adding one unit costs
   under a minute, and editing the decoder still regenerates everything.
   `--fresh` ignores the cache; a fresh run was verified to produce
   byte-identical atlases and manifest. When only DAT terrain slots changed,
   `convert_sld.py --terrain-only` updates those DDS textures in an existing
   manifest without needlessly decoding every SLD first.
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

- Forager and gold-miner work animations use the task `proceeding` graphic; the
  DAT `working` graphic is `-1` and the attack graphic is a placeholder file
  named `None` in this build.
- Main, shadow, and player-color SLD layers are converted by the local
  `sld_layers.py` decoder (verified byte-identical to the previously used
  openage decoder across all 29,783 imported frames before the swap); outline
  layers are readable but not exported or drawn yet.
- Building destruction graphics are converted without their fire-overlay delta
  graphics (for example graphic 419 deltas 12178–12183).
- Corpse/decay graphics and dead-unit chains (tree stumps) are not imported yet.
- `icons.json` stat/menu icon names (`stat_icon_*`, `submenu_*`) resolve inside
  the executable; `textures/ingame/staticons/` is imported raw and `submenu_*`
  art is absent from depot 813782. Both are recorded in the UI manifest as
  `rawTextures`/`missingMaterials`.
- The shipped `materials.json` has a few dangling texture refs (for example
  `AgeupCastleAge`, referenced by `resourcepanel.json`); these are kept as
  `unresolvedTexture` evidence instead of substituting art.

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
| a terrain slot | `dat.terrain_block.terrains[i]` — `.name_2` is the texture, `.terrain_dimensions` the frame grid, `.frame_data[0].frame_count` the flat-tile frames (always the product of the dimensions), `.blend_type`/`.blend_priority`, `.colors` the minimap colour |
| a task's numbers | `bird.tasks[*].work_value_1/_2` and `.work_range` — note the underscores; there is no `work_value1` or `target_diff` |
| a unit's class | `unit.class_` with the trailing underscore; `unit.unit_class` does not exist |
| an attack or armour | `unit.type_50.attacks[*]` / `.armours[*]` — `.class_` and `.amount`; there is no `.type`, and `armours` is British-spelled |
| whether anything walks round a building | `unit.collision_size_z` (0 means no height to walk into) **and** `unit.obstruction_class` (0) **and** no annexes. All three: the town center reads 0 and 0 like a farm, and obstructs through its four annexes (see `status.md`, issue #40) |
| a building's annexes | `unit.building.annexes[*].unit_id`, with 0 meaning an empty slot |
| the terrain blend masks | not in the DAT at all: `resources/_common/dat/blendomatic_x1.dat`, decoded by `tools/import_blends.py`. Nine modes of 82,390 bytes, each 31 masks of `tile_size` 2353 — the pixel count of a 97x49 diamond whose rows run 1, 5, 9 … 97 … 5, 1 |
| the reference's key bindings | not in the DAT either: `resources/_common/dat/hotkeys.json`, 457 bindings over 27 groups, four layouts apiece. `import_ui.py --hotkeys` resolves the ones the spec names |

Fields that do **not** exist, and cost a failed call each time somebody assumes
they do: `unit.clearance_size_x` (it is the tuple `clearance_size`),
`unit.collision_size` (it is `collision_size_x`/`_y` — the opposite convention
to clearance), `unit.transform_unit_id` (a packed and unpacked siege engine are
two units and the DAT does not say which is the other; see `status.md`),
`unit.type_50.attacks[*].type` (it is `.class_`).

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
