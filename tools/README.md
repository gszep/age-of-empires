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

1. `bootstrap.sh` prepares `.tools/import-venv` (genieutils-py and Pillow only).
2. `import_content.py` reads the declarative `import-spec.json` and extracts the
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
   byte-identical atlases and manifest.
4. `import_ui.py` extracts the WEST widget-UI subset (resource/command/map/
   bottom/menu panels, materials, entity + action + stat icons, click-sound
   aliases from `sounds.json`) into `public/imported/aoe2/ui/`, converting DDS
   through Pillow and copying PNG byte-identically.
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

Fields that do **not** exist, and cost a failed call each time somebody assumes
they do: `unit.clearance_size_x` (it is the tuple `clearance_size`),
`unit.collision_size` (it is `collision_size_x`/`_y` — the opposite convention
to clearance), `unit.transform_unit_id` (a packed and unpacked siege engine are
two units and the DAT does not say which is the other; see `status.md`).

`tools/datq.py` reloads the whole DAT on every invocation, which takes tens of
seconds. Asking it more than two or three questions is slower than writing a
one-shot script that parses once and prints everything you want.

When a needed field is missing here, look it up once —
`.tools/import-venv/bin/python tools/datq.py fields 'dat.civs[1].units[128]'`
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
