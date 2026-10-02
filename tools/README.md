# Local import tools

Tools in this directory define reproducible import steps. Tool installations, source game files, and generated proprietary content live in ignored directories.

```text
.tools/          the import pipeline's Python virtualenv
.local/aoe2de/   local source configuration and intermediate data
public/imported/ browser-ready local atlases/manifests
```

No Steam credentials, Steam configuration, DAT files, SLD files, or converted Microsoft assets belong in this repository.

`uv run --locked python tools/pdf_text.py "<owned PDF>" > .local/manual.json`
extracts prose with physical page numbers and SHA-256 using locked pypdf (#60).
`test_pdf_text.py` verifies compressed original text/blank pages and the owned
AoK conversion/market/Treason passages. Decorative glyphs/table layout may need
visual inspection; these shipped legacy manuals do not supersede current DAT
numbers. See `docs/shared-reference-audit.md` for the bounded findings.

`uv run --locked python tools/relic_reference.py` extracts the tiny two-player
standard-mode relic policy from the owned RMS and includes. The checked-in
numeric contract is `src/sim/refdata/relic-placement.json`; the owned import
suite compares it to the extractor result. Open and owned profiles consume the
same source values. It does not regenerate/publish an asset manifest or implement
a general RMS interpreter. Generator adapters and authored-map policy are
explicitly separated from source values in `docs/ledger.md`.

`uv run --locked python tools/regicide_reference.py` similarly extracts standard
Regicide starting-actor constraints and the400-gold Treason price into the
contract checked against `src/sim/refdata/regicide.json`. Black Forest's
`REGICIDE_BACKWARD` override is retained. Exact Treason timing is not in this
owned-value contract; it remains a labelled runtime inference (#240).

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
    `civilizations.json`), plus the complete named initial player-attribute table
    from `xs/Constants.xs` and the configured civilisation's DAT resources (#53),
    with the reference's names, button text and tooltips
    from `--strings` (`resources/en/strings/key-value/key-value-strings-utf8.txt`).
    Current metadata also includes node `placementSideTerrain`, building
    `minimapMode`, and `shadows` from the owned `colorcorrection.json` Default
    profile. `shadows` must pass through the published manifest and asset loader;
    it does not yet select a profile per biome.
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
   `.local/aoe2de/atlas-cache.json` when source hash, frame count and that layer's
   decoder dependencies match. `atlas_cache.py` partitions BC1, BC4 and outline
   dependencies; unknown/shared code and conversion/packing helpers remain
   conservative. Source identity is independent of the canonical civilisation
   namespace; reused pages are copied when the canonical URL changes. Unknown
   schemas miss safely. An unchanged legacy whole-decoder fingerprint permits
   explicit migration to schema2. Tests compare fresh/cached fixture decoding,
   multipage relocation and dependency changes. The first complete schema2 import
   reused4101 groups with byte-identical root/UI/audio manifests; no measured
    decoder-change speedup is claimed. `--fresh` ignores the cache.
    Published schema4 also interns repeated entity/annex frame arrays through
    `atlas_metadata.py` (`atlasFrames` / `framesRef`). The browser hydrates shared
    arrays before rendering; Python geometry probes call `expand_atlas_frames`.
    Source extraction and decoder caches retain their existing inline format.
   When only DAT terrain slots changed,
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
    It also copies the spec's native CUR files from `--cursors` (default beside
    the sounds DAT directory), retaining actual header dimensions/hotspots and
    source hashes. File suffixes are not size metadata: `flag32x32.cur` is 48×48.
5. `import_blends.py` publishes the classic blendomatic masks plus square DE
   windows for the eight mapped water/land/farm/road/snow/ice families under
   `terrain/blends/` (#116/#148).
   `blends.native` carries their dimensions/gutters/modes; source hashes are in
   the manifest. The 64-pixel window interpretation and edge unions are inferred
   (ledger #116/#148); their alpha bytes are owned. These sheets use tile-axis
   UVs, while the classic sheets use isometric-diamond UVs. This stage does not
   decode sprites; blend-only edits can reuse the existing SLD atlas cache.
6. When sound depot 813783 and `vgmstream-cli` are available,
   `import_audio.py` follows consumed cues through the owned PCK/BNK HIRC
    graph across repeated `--pack` inputs, prefers complete PCK streams over
    DIDX prefetch prefixes, and writes deterministic
   browser-playable WAV cues under `public/imported/aoe2/audio/`. Widget cues
   arrive as event names to hash; unit voices arrive as the Wwise ids the DAT
   already holds, narrowed to the imported civilisation's branch of the
    `Civilization` switch container.
    The full pipeline requires both `Base.pck` and `Base.1.pck` when the shared
    audio depot is present. `audio_inventory.py` audits banks/streams and numeric
    `--event` IDs without publishing assets; see `docs/audio-reference.md`.
    `--music` audits the `Ingame_Music` dialogue tree too. The full pipeline
    passes `import_audio.py --music` to decode complete numbered tracks; missing
    streams are reported in `music.unavailable`, never replaced by DIDX prefixes.
    The27 available tracks add about1.28GB of WAV, streamed one at a time by the
    browser. Direct test imports omit music unless explicitly requested.
    Consumed v154 Play actions retain separate media pools and their original
    delay/ranges, transition/fade time and probability (#248); `audio_inventory.py
    --event <id>` reports those layers. Container weights/loops and bus DSP remain
    a separate fidelity boundary, documented in `docs/audio-reference.md`.

`npm run test:import` runs the integration suite (`test_import_aoe2.py`) against
the owned fixture, including determinism checks.

## Recorded approximations and source gaps

`uv run --locked python tools/sld_integrity.py` audits the selected content's
SLD containers; `--base` audits x1 counterparts. The full atlas step performs
the same structural validation before cache reuse/publication. On2026-09-27 it
passed569 selected sources and found two zero-filled x1 monk tails; see
`docs/source-integrity.md` (#119/#247). Pixel decoding/cache fingerprints are
unchanged. Repair missing original bytes rather than relaxing the mask walk.

Every approximation is a row in `docs/ledger.md`. Import-side gaps the
manifest records itself: `skippedMasks` (the monk's outline layers, #119),
`skippedTechnologies` (each with its reason), `skippedAtlases`, and in
the UI manifest `rawTextures`/`missingMaterials` (`stat_icon_*` and
`submenu_*` resolve inside the executable; `staticons/` is imported raw) and
`unresolvedTexture` (a few dangling refs in `materials.json`, kept as
evidence rather than substituted). Forager and gold-miner work animations use
the task `proceeding` graphic because the DAT's `working` graphic is `-1`.

## genieutils DAT cheat-sheet

Terrain decoration rows (#55): `terrain.number_of_terrain_units_used` bounds the
parallel30-entry arrays `terrain_unit_id`, `terrain_unit_density`,
`terrain_unit_masked_density`, `terrain_unit_centering`. Centering is0/1; forest
rows include density1000 and collision-bearing class15 resources. View-only
plants are Gaia class14 with zero x/y/z collision and obstruction class0. Keep
zero-density rows and masked densities in the manifest; engine density units
and mask selection need calibration rather than silently dropping the fields.

`unit.placement_side_terrain` contains two alternative neighbouring terrain IDs
(-1 unused): shore fish (69) require 2 or 35 (beach), deep fish (456/458) neither.

Scorpion projectile units 367/627 have `projectile.hit_mode = 1` and
`vanish_mode = 1`, `collision_size_x = 0.1`, and their own `type_50.attacks`
for collateral damage. Heavy Scorpion technology 239 additionally changes
those projectile attacks (class 3 +4); importing only its unit swap loses this.

`unit.minimap_mode` is 0 for the farm, 1 for the other modelled buildings
(including the town center, castle, tower, wall and gate). It states visibility,
not a pixel size; `mappanel.json` likewise states MapView geometry, not marker size.
Farm help string 26149 states the one-villager limit explicitly; neither the
farm's resource capacity (15) nor garrison capacity (0) is a worker limit.

Field names in `genieutils-py` are non-obvious and guessing them costs a
failed run each time. The ones this importer consumes (`unit` is an entry of
`dat.civs[n].units`):

| What you want | Where it lives |
|---|---|
| id, name, HP, LOS, icon | `unit.id`, `.name`, `.hit_points`, `.line_of_sight`, `.icon_id` |
| footprint / clearance | `unit.collision_size_x/_y`, `unit.clearance_size` |
| building elevation placement | `unit.hill_mode`: Briton town center 109 = 2, house 70/farm 50/walls/towers/gates = 0, barracks 12/mill 68/camps 562/584/dock 45/castle 82 = 3. Thracian barracks = 0, TC = 2. Mode meaning is community-documented UGC attribute 187: 0 unrestricted, 2 flat only, 3 allows one elevation difference (1 unused/no hill corners). DAT owns the per-building choice, not our tile-height range interpretation (#176) |
| selection marker shape and size | `unit.obstruction_type` (5 = round unit outline, others square/footprint), `unit.outline_size_x/_y` (half-extents in tiles, can exceed the collision box) |
| movement speed, walk graphic | `unit.speed`; `unit.dead_fish.walking_graphic` |
| order acknowledgements and construction audio | `unit.bird.wwise_move_sound_id` / `.wwise_attack_sound_id`; `unit.building.wwise_construction_sound_id`. Signed event IDs normalize to uint32. Construction TC109 shares its selection event1357475385. These are separate from weapon animation sounds |
| graphic and ambient audio | `graphic.wwise_sound_id`, `.angle_sounds_used`, `.angle_sounds[*].frame_num/.wwise_sound_id` and `_2`/`_3` suffix pairs; terrain `.wwise_sound_id`. A zero graphic-wide ID does not mean the frame/direction sound entries are empty. Published as `animations.*.soundEvents` and terrain `soundEvent`; composite parents retain sound metadata even without their own file |
| idle / death graphics | `unit.standing_graphic`, `unit.dying_graphic` |
| cost and train time/location | `unit.creatable.resource_costs`; `unit.creatable.train_locations[0].unit_id/.train_time` |
| combat (attacks, armor, range, projectile) | `unit.type_50.*` — `.attacks`, `.attack_graphic`, `.projectile_unit_id`, `.graphic_displacement` (launch offset, z = height) |
| second ordinary attack | `unit.type_50.attack_graphic_2` is an optional second source graphic, distinct from `creatable.special_graphic` charged weapons. Import its own `.frame_duration` × shared `.frame_delay`, all composite deltas and sound events. Camel Riders use20×.025s for both; several naval primary parents are untimed placeholders with timed second composites. UGC attribute131 describes alternation; exact native first/reset/naval cadence remains#272 |
| melee collateral and monk healing | `unit.type_50.blast_damage`: Cataphracts40/553=-5, enabled by Logistica's `.blast_width` increase. UGC attribute115 documents negative fixed HP versus nonnegative normal-damage factor. Monk task105 `.work_value_1=2` times `.bird.work_rate=1.25`; Byzantine team400 sets resource89=2, owned help120156 says +100%. Native boundary/cadence interpretation remains#267 |
| projectile arc | `unit.projectile.projectile_arc` (fraction of shot distance, sign varies) |
| how far a miss lands from the aim | `unit.type_50.accuracy_dispersion`, in tiles — 0.33 for the archer line, 0.2 for the set-up trebuchet (unit 42; the packed 331 reads accuracy 92 and no dispersion, and never shoots) |
| a second look for the same unit (the female villager) | `resources/_common/dat/objreplacement.json`: `object_id` 83 → `replacement_object` 293 at `chance` 50, and the reverse. The task counterparts (212, 354, 218, 581, 220, 216, 590) are found by matching `bird.tasks`; the spec names them as `skinOf` entries and `test_import_aoe2.py` checks the match (issue #50) |
| what the reference calls it, and its tooltip | not in the DAT: `resources/en/strings/key-value/key-value-strings-utf8.txt`, indexed by `unit.language_dll_name`, `.language_dll_creation` and `.language_dll_help − 79000`; a technology's `.language_dll_description` is its button text. A projectile's ids are junk (issue #48) |
| native command hotkeys | unit `.language_dll_hotkey_text − 139000`; technology `.language_dll_description + 10000` bridge to `hotkeys.json` `string_index_list`. Both `shared_hotkey_group_list` and `hotkey_group_list` matter (idle-worker navigation is in the shared list). Action bindings use `button_action_list`; missing entries in a profile mean unbound, not another profile's default. Published UI `hotkeyProfiles` is presentation-only (#141) |
| whether Delete asks first, and what a monk may not take | `unit.creatable.hero_mode`, a flag field: 1 full heal, **2 cannot be converted**, 4 regenerates, 8 defensive stance, 16 protected formation, **32 asks before Delete**, 64 hero glow. Reads 0, 32 or 34 across this roster: the town center, watch tower, monastery, castle and wonder ask; the town center, monastery, castle and wonder cannot be converted (issue #47) |
| what a blast may hurt | `unit.type_50.blast_attack_level` on the shooter against `unit.blast_defense_level` on the bystander — hit when defense ≥ attack. Units 3, buildings 2, trees 1, bushes and mines 0; mangonel 2, onager line and trebuchet 1 (issue #46) |
| villager tasks (gather/build) | `unit.bird.tasks[*]` — `.action_type`, `.class_id`, `.unit_id`, `.resource_in/_out`; rates on `unit.bird.work_rate`; drop-offs in `unit.bird.drop_sites` |
| drop-site acceptance | `resources/_common/dat/dropsites.json`: intersect `building_id`, `worker_object_group`/`worker_object_list`, target `object_group`/`attribute_type` with each gather variant's DAT `bird.drop_sites` and same-action gather tasks. Targets such as gold 66 and stone 102 are Gaia-only; use the already extracted entity's `class`, not the player's possibly empty unit slot. `gather.dropSites` is the resolved imported-building subset; raw `dropSites` remains provenance. Building `accepts` is the supported resource union, including authoritative empty lists. XS Meat 15/Berries 16/Fish 17 normalize to food. `acceptsLivestock` is metadata; target-state flags are not simulated (#52) |
| carried resources | `unit.resource_storages`, `unit.resource_capacity` |
| Siphons charge chain | `unit.creatable.max_charge/recharge_rate/charge_event/charge_type/charge_target/charge_projectile_unit`: Fire Ships529/532/1103 start0/.04/0/0/64/2629; effect915 sets max1/type6. Projectile2629 `dead_fish.tracking_unit`677→graphic3823 `particle_effect_name=flamethrower_flame`; `dying_graphic`12726→`impact_grenade`. Its `projectile.smart_mode`1, `projectile_arc`.45 and `vanish_mode`2 are provenance, with bounded interpretation in the ledger |
| Siphons unresolved task/flags | same ships' `bird.tasks` action133 has `work_value_1/_2`2/8, `work_range`~1.2, `work_flag_2`2001. XS names ChargeAttack but supplies no parameter/mask semantics.2629 `type_50.friendly_fire_damage`1, `projectile.hit_mode`0/`vanish_mode`2/`area_effect_specials`0, dead-unit−1 and no lifetime resource are evidence, not a general implemented charge contract |
| naval capacity, volleys and fish traps | `unit.garrison_capacity` (transport 545: 20), `unit.creatable.total_projectiles` (Hulk 2626: 3); trap food is `dat.civs[n].resources[88]` (700), not trap 199's 15-food storage; fishing-ship tasks name trap gather/build factors in `work_value_1` |
| composite ship art | `graphic.deltas` plus `offset_x/_y` and `graphic.layer`; W/X placeholder parents and SLP -1 parents may have no source despite a filename. File-bearing hull/sail children have independent frame clocks; `naval.graphic_layers` resolves them |
| shared naval upgrades | research 35 has `effect_id = -1`; automatic techs 911 and 246 have no research location and sole prerequisite 35. Resolve their type-3 commands; do not discard the research or offer its child upgrades as separate buttons |
| building construction / annexes | `unit.building.construction_graphic_id`, `unit.building.annexes` |
| completed-building prerequisite and production | `unit.building.tech_id`: mill 68 triggers 110, castle 82 triggers 266. Import from each profile; do not infer from names. `unit.bird.work_rate` supplies production/research work |
| typed-tree aliases | reciprocal construction heads supply building availability (palisade 789 → 792 → 789). The reviewed ram spec maps unit 35 to tree node 1258: common automatic technology 712 replaces 1258 → 35 after Dark Age 104; both Briton/Frank records have 175 HP, speed ~0.6 and workshop 49 / 36 s / button 1. Cuman technology 706 is a distinct later gate; its profile is not enabled here. Explicit alias IDs also provide tree age/prerequisites; heads do not overwrite completed TC age |
| bonus cost attributes | XS `cResourceCost` 100 (multiply all resources), food/wood/gold/stone 103–106. Tree commands 101 edit tech costs (`a` tech, `b` resource, `c` 0 set / 1 add), 103 edit research time (`a` tech, `c` operation). XS effect IDs and DAT command IDs are separate namespaces |
| stacked building construction | `unit.building.head_unit` names the construction unit; follow it only when the head's `building.stack_unit_id` points back. TC 109 → 621 → 109: head owns paid 275 wood + 100 stone, `train_locations` builder 118 / button 11 / 150 seconds; completed 109 misleadingly has builder/button −1, 100 seconds and unpaid stone. Building connection 621 enables through tech 187 → required tech 102 (Castle); 109 has no enabling research. Tech 308 is `Shadow TC Foundation`, 722 `Shadow TC -- Age One`; neither defines a replacement-count predicate. XS resource 218 is `FeudalTownCenterLimit` (initial 1 for Britons/Franks), 48 `TownCenterUnavailable` (initial 0). See ledger #177 for the inferred replacement/count interpretation |
| corpse / rubble / stump | `unit.dead_unit_id` — the unit whose `standing_graphic` is the decay art |
| carcass food decay | live animal `unit.resource_decay`: Gaia sheep 594 and deer 65 = 0.25 food/s, boar 48 = 0.4. The `dead_unit_id` unit instead has type-12 lifetime storage at decay 1.0, not the food-loss rate |
| player colour and contour | `dat.player_colours[i].player_color_base` (start of the eight-shade block in `original.pal`), `.minimap_color`, `.unit_outline_color` |
| graphic playback | `graphic.file_name`, `.frame_count`, `.angle_count`, `.frame_duration`, `.mirroring_mode` |
| a graphic with no unit behind it | `dat.graphics[*].name` — the gather-point flag is `WaypointFlag <Civ>` |
| a unit's build slot in the villager menu | `unit.creatable.train_locations[*].button_id` — the DAT states the *slot*; which page it is on is engine behaviour, and two buildings share a slot only when they are on different pages |
| a technology's cost, time and place | `tech.resource_costs`; `tech.research_locations[*].location_id` and `.research_time` — **not** `tech.research_time`, which does not exist |
| what a technology does | `dat.effects[tech.effect_id].effect_commands` — **not** `.effect_configs`. `command.type`: 0 set, 1 **resource modifier** (player attribute: `a` = resource id, `b` = 0 set / 1 add, `d` = amount), 2 enable unit, 3 upgrade unit, 4 add, 5 multiply |
| where a player attribute starts | `dat.civs[i].resources[id]`, with names/indices from the **Attributes** section of `resources/_common/xs/Constants.xs` (later `cAttributeSet/Enable/...` are effect enums, not player attributes). Published as `playerAttributes` plus `playerAttributeIds`, with the XS SHA-256. Keys lowercase the first letter only; legacy `farmFoodAmount` retains the spelling for `cAttributeFarmFood` (36). Preserve zeros, negatives and the source's spelling, including `startingScoutID`. Reject absent DAT slots rather than substituting defaults (#53) |
| civilisation effects and automatic technology gates | `dat.civs[i].tech_tree_id` and `.team_bonus_id` index **effects**, not technologies. `dat.techs[t].civ`, `.required_techs`, `.required_tech_count`, `.research_locations[*].location_id` distinguish civ-specific automatic candidates from research. A positive required count with only -1 slots is not an unconditional bonus. The pinned `civilizations.json` list pairs with DAT order for inventory, but alternate-era metadata can reference another civ's unique techs (Achaemenid entries reuse Italian IDs); the audit records these rather than importing them as rules (#122/#123) |
| Heresy | technology439/effect188 type1 sets resource192 (`cAttributeHeresy`) to1; initial0. Monastery104,1000 gold/0 food,60 seconds. Localization28412 states death instead of enemy colour on conversion; cargo/demolition and faith details remain runtime inferences (#178) |
| Secondary training locations | `creatable.train_locations` is indexed, not just its first row. Huskarl41/555 slot0 is castle82/13s/button1/hotkey16104; dormant slot1 is−1/16s/button4/hotkey16748. Anarchy16/effect462 sets XS158 (`cTrainLocationsEntryMod`) to1, XS42 (`cTrainLocation`) to12, then resets158 to0. Tree759/761 are hidden secondary-producer aliases, not extra simultaneously trainable units |
| Gothic Loom trigger | TC109 annex619 has `building.tech_id=307`; automatic343 requires307 and effect341 sets technology22 research time to1 second. Annex bookkeeping must follow the completed parent building; do not make343 unconditional or drop its prerequisite |
| Gothic hunt and population | effect414 adds15 hunter capacity, multiplies resource268 (`huntingProductivity`) by1.23 and hunter work rate by.8130081296. Effect418 adds10 to resource32 (`unitLimit`) after Imperial. Yield versus collection rate and ceiling versus housing are separate consumers; native rounding/settings boundaries are in the ledger |
| Conversion task permissions | Monk125 `bird.tasks` action104: misleadingly named `unused_resource` is the required player attribute (27 monastery units,28 buildings,29 siege); `search_wait_time` holds failure-message IDs3091/3049/3093. `work_value_1/_2` give5/9 seconds for units and15/25 for buildings; positive `work_range` .5 requires adjacency for buildings and named ram/trebuchet targets. Unit-specific rows take precedence over class/default rows. Resource29 is absent from XS names but localization15029 says Enable Siege Conversion; published as `resource-29` |
| Teuton capacity, healing and free research | XS2 is garrison capacity;107 is maximum total projectiles. Effects335/352 add10/5 TC capacity/projectile maximum and5/4 tower capacity/projectile maximum. Effect345 sets player healRange90 to8; help120153 says +100% healing range, supporting inferred normal default4 when task/resource ranges are0. Tree262 sets Murder Holes time/stone to0 but leaves200 food; zero-time grants are automatic, with venue/ordering calibration under#254 |
| Standard transport age capacity | generic automatic1163 requires Castle102 and effect1166 adds5 capacity(attribute2) to class20;1164 requires Imperial103 and effect1167 adds10 more. Transport545 starts20, yielding20/20/25/35 across ages. The base-20 group-boarding fixture must be Dark Age rather than silently suppressing these owned bonuses |
| Fractional packed attacks | Bombard Tower64 adds768.5 to projectile54's attack: class3 and amount.5. Preserve the fractional low part rather than applying an integer byte mask. Other attack/armour packing and percentage interpretation are unchanged |
| Signed packed attacks | Japanese effect185 adds−9730 on cavalry-archer class36: decode class38 from the absolute high byte and retain−2 as the signed low part. A signed right shift invents class−39 and loses the skirmisher exception. Positive fractional low parts remain supported |
| Japanese approach task | Samurai291/560 `creatable.special_ability`3, `charge_type`1, `charge_event`0, `max_charge`1 and `bird.tasks` action133/flag2001; `work_value_1/_2`2/6 (elite2/7), `work_range`1.25. `dead_fish.running_graphic` and all task graphic slots are−1. UGC interpretation and native calibration limits are in ledger#259 |
| Yasama and Kataparuto | Yasama484/effect539 adds2 to XS102 total projectiles and107 maximum for79/234/235. Kataparuto59 multiplies42 `bird.work_rate` by4 and reload by.75; base work rate4.5 is imported, with packing-clock interpretation explicitly inferred |
| Missing upgrade node type | JAPANESE.json Elite Cannon Galleon691 has no `Node Type`, but `Use Type: Unit`, `Link ID: 420`, `Trigger Tech ID: 376`.376 has a paid Dock45 location and upgrades420→691; do not drop this button because an optional tree field is absent |
| Chinese starting grants | Automatic226 depends on639;302 on639/307. Effect7 a83/b619/c3 spawns three villagers at the TC annex; resource234 is spawnCap1. Read `entity.annexes[*].unitId` to resolve619 to TC109. StartingFood91/StartingWood92 are−200/−50;425 sets TC resource-storage attribute21 to15 and adds7 sight/search |
| Chinese economy | Player85 researchCostMod1/.95/.9/.85 is a live research-price factor, not a static table rewrite. Team402 makes hidden repeatable232 free; effect240 type1 a36/b0/c36/d1.1 copies/multiplies farm capacity and type6 multiplies69 by1.1. Localization15069 names Farm Food Multiplier (initial1), absent from XS and imported as `resource-69`. Pair the copy and multiplier rather than double-applying10%; reapplication/rounding is ledger#260 |
| Combat ability and volleys | `type_50.break_off_combat` is the UGC Combat Ability63 field:1 armour bypass,2 resist bypass,8 attack ground,16 bulk volleys. Chu Ko Nu73/559 total3/5 and secondary510; Rocket Carts1904/1907 total8/10. Source counts and animation clocks are separate from inferred inter-shot scheduling |
| Alternate weapons | Fire Lancer1901/1903 `creatable.charge_type`6/target127/event4 or5, max1/count3/projectile1925; special graphic13031/13067. Lou Chuan1948 type6/target127/event−3/count10/projectile1936 and special13017. Range modifier is attribute61; raw recharge float precision matters at the30-second threshold. Projectile hit_mode1 plus vanish_mode0 stops at the first interceptor, not pass-through |
| Chinese projectile upgrades | Rocketry483 redirects1936→1879, Chemistry47 redirects1936→1937 and510→522. base_id/copy_id equal each projectile's own id, so they supply no shared-line precedence rule. Preserve all attack commands, including duplicate1937 entries; native research-order semantics remain#260 |
| Unit population without a cost slot | Fire Lancer1901/1903 have no resource4 creatable cost, but `resource_storages` type4 amount−1/flag2 supplies population cost1. Use the owned storage instead of relying on an implicit one-population fallback |
| Incendiaries | technology910/effect916 sets fire-ship dead unit57 to2624 and dying graphic73 to blank1751.2624 has HP−1,10 class4/+5 class60 attack, radius3/level2 and death9347; delta12206 names `explosion_demo_ships`. Source help528007 confirms detonation on sinking; remaining native timing/deletion/friendly-fire/layering calibration is#252 |
| elevation modifiers, not the base hill rule | `dat.civs[i].resources[211/212/272/273]`; owned `Constants.xs` names attack higher/lower and damage higher/lower. All four are 0 for Gaia/Britons/Franks. Tatar elevation effect adds 0.25 to resource 211; Georgian defense effect adds −0.15 to 273. Do not mistake these for the base ×1.25/×0.75 engine rule (#134) |
| a terrain slot | `dat.terrain_block.terrains[i]` — `.name_2` is the texture, `.terrain_dimensions` the frame grid, `.frame_data[0].frame_count` the flat-tile frames (always the product of the dimensions), `.blend_type`/`.blend_priority`, `.colors` three `original.pal` indices — the minimap shade for a tile sloping up, flat, and sloping down (flat is `[1]`), `.is_water` the water class (4 shallow, 1 medium, 2 deep, 8 walkable shallows, 16 beach, 32 land) |
| a unit's minimap dot | `unit.minimap_color`, an `original.pal` index (may be negative: take it mod 256); gaia's resources and animals carry one, trees 0 |
| a task's numbers | `bird.tasks[*].work_value_1/_2` and `.work_range` — note the underscores; there is no `work_value1` or `target_diff` |
| a unit's class | `unit.class_` with the trailing underscore; `unit.unit_class` does not exist |
| DAT unit type | `unit.type` (archery range 87 = 80, building); distinct from `.class_`. The civilisation audit distinguishes a building's production `workRate` from a villager task's gathering consumer |
| an attack or armour | `unit.type_50.attacks[*]` / `.armours[*]` — `.class_` and `.amount`; there is no `.type`, and `armours` is British-spelled |
| whether anything walks round a building | `unit.collision_size_z` (0 means no height to walk into) **and** `unit.obstruction_class` (0) **and** no annexes. All three: the town center reads 0 and 0 like a farm, and obstructs through its four annexes (see `docs/ledger.md`, issue #40) |
| a building's annexes | `unit.building.annexes[*].unit_id`, with 0 meaning an empty slot |
| building age stats | `age_variants` IDs supply HP/LOS/armours with art. Sole-age generic effects 71/72 normalize into `ageStats` with `includedTechs` provenance to prevent double application |
| stone gate parts | 64/88 and fortified 63/85; `building.transform_unit` opens to 78/91 and 67/90. Heads 487/490 and 488/491 own four-tile previews; doorway is two tiles, posts at ±1.5. Fortified 63 retains old head 487; reviewed construction 488 follows tech 194 |
| tower secondary arrows | `creatable.secondary_projectile_unit` reaches 505/518. 140/63 and Arrowslits 608/610/611 modify these tables; `garrison.volley.arrowUnitId` is the consumer. Generic 610/611 require 2 of `[608,140,775]`/`[608,63,775]`; foreign 775 is disabled |
| specialist wall/crew tasks | tower 1105 task 14 targets class 27 (`cTaskTypeUnloadOverWall`), holds ten and has no attacks. Walls are class 27, gates 39, towers 52. Help proves ram bonuses; .05 speed/+10 class-11 constants remain inferred |
| deployed siege research | 331 packed / 42 deployed have independent `type_50` attacks, armour, range, accuracy and `bird.search_radius`. Warwolf 461/effect540 targets42: blast +.5, accuracy100. Import zero `blast_width` explicitly; a missing zero must not inherit fallback splash. Siege Engineers addresses both forms and must not double-apply |
| production and trader research | XS attribute101 modifies `creatable.train_locations[*].train_time`; Shipwright373/effect371 is ×.65. Caravan48/effect482 changes both speed and `bird.work_rate` ×1.2, consumed as trader accumulation as well as movement |
| the terrain blend masks | not in the DAT at all: `resources/_common/dat/blendomatic_x1.dat`, decoded by `tools/import_blends.py`. Nine modes of 82,390 bytes, each 31 masks of `tile_size` 2353 — the pixel count of a 97x49 diamond whose rows run 1, 5, 9 … 97 … 5, 1 |
| an age's collapse and rubble | on the variant unit the age technology's `upgrade unit` command names (`age_variants`): its own `dying_graphic` and `dead_unit_id` (issue #61) |
| what a building burns with | `unit.damage_graphics[*]` — `.graphic_id` a composite with no file of its own, `.damage_percent` 25/50/75 (the fraction of hit points *lost*); its `graphic.deltas[*]` are the flames at `.offset_x/_y` from the hotspot (y down), each a graphic whose `.particle_effect_name` is the DE particle DE draws instead of the HD sprite (`fire_small_left`; definitions in `resources/_common/particles/`, frames in `textures/atlases/fire.json`) (issue #73) |
| soot on a damaged building | not in the DAT: the SLD's fourth layer, `LAYER_DAMAGE` 0x08, a per-pixel weight; `convert_sld.py` packs it as `idle-damage` for buildings (issue #73) |
| repair | the repairer task unit (156 VMREP, 222 VFREP): `bird.work_rate` 12.5 hit points a second; `bird.tasks` with `.action_type` 106 (`cTaskTypeRepair`) name by `.class_id` what it mends and `.work_value_1` how fast (default row 1.0, siege and ships 0.25); the price is `dat.civs[i].resources[270]` (units) and `[271]` (buildings), 0.5 (issue #74) |
| garrison | `unit.garrison_capacity`; `unit.building.garrison_type` (flag field: 1 villagers, 2 infantry and foot archers, 4 cavalry, 8 monks, 16 livestock, 32 siege), `.garrison_heal_rate`; the volley is `unit.creatable.total_projectiles` to `.max_total_projectiles`, extra arrows `.secondary_projectile_unit` with that unit's own `type_50.attacks`; `unit.type_50.garrison_firepower` is 1.0 for archers and −2.5 for villagers. UGC attribute 130 documents positive as a DPS multiplier and negative as a flat-DPS addition; this interpretation is community documentation, not text in the DAT (#75/#137) |
| garrison flags and land carriers | `unit.creatable.garrison_graphic` is usually a file-less composite: recursively retain its file-bearing graphic deltas and `offset_x/_y`, separately for each age's variant. TC 109's Dark flag is graphic 4472 at (-31,-158); ram 35/422's flag is 11385 at (2,-24), capacity 6. Production buildings have type 0 and capacity 10; owned help 4944 explains self-rally training into the building (#137) |
| the reference's key bindings | not in the DAT either: `resources/_common/dat/hotkeys.json`, 457 bindings over 27 groups, four layouts apiece. `import_ui.py --hotkeys` resolves the ones the spec names |

### Surveyed fields not yet consumed (#54)

These are **not** additions to the supported-import list above. The current
read/import/runtime matrix is in [the DAT field audit](../docs/dat-field-audit.md).
Values are pinned Briton examples unless marked Gaia; do not infer engine
semantics merely from the field name or a nonzero value.

| Intended investigation | Field / owned XS alias | Source examples and boundary |
| --- | --- | --- |
| Moving collision limits | `unit.dead_fish.min_collision_size_multiplier` | Villager83=.25, infantry74≈.8, Knight38=.5, ram35≈.1, Archer4=1; not imported. Current moving/engaged units bypass pair separation; exact native shrink timing is unverified. |
| Foundation ground | `unit.building.foundation_terrain_id`; `cFoundationTerrain=34` | TC109/House70=27, Farm50=7, Dock45/TC head621=−1. Not a universal27 rule, nor proof of persistent terrain mutation. |
| Foundation rubble | `unit.building.destruction_rubble_graphic_id`; `cDestructionRubbleGraphic=88` | TC556/House499 resolve to foundation-rubble graphics. Distinct from the consumed `dead_unit_id` decay chain; lifecycle/composition still unverified. |
| Armed idle | `unit.creatable.idle_attack_graphic`; `cIdleAttackGraphic=82` | Militia74→1102, Villager83→1282, Spearman93→1061; source slot not currently published. |
| Combat reactions | `unit.old_attack_reaction` | Legacy reactions villager/sheep/deer/monk2, boar4, knight3, packed treb1 remain unconsumed. The separate misleadingly named `type_50.break_off_combat` field is now consumed as Combat Ability63 (table above), not this reaction policy. |
| Target-specific conversion | `creatable.min_conversion_time_mod/max_conversion_time_mod/conversion_chance_mod`; XS111/112/113 | Scout448 has3/1/2. Runtime currently applies target-player resistance adjustments, not these per-unit fields. Chance is not a seconds offset. |
| Friendly-fire scaling | `unit.type_50.friendly_fire_damage`; `cFriendlyFireDamage=119` | Sampled value1; hit eligibility, damage scaling and auto-fire risk are separate questions. No generic consumer. |
| Native slope shapes | `dat.terrain_block.tile_sizes[*].width/.height/.delta_y` |19 records, including96×24/48/72 and48×48 shapes. The renderer does not consume the complete table; #134 retains topology calibration. |

Terrain restrictions are already consumed through
`dat.terrain_restrictions[row].passable_buildable_dmg_multiplier`: nonzero
entries become allowed terrain IDs, limited to imported slots. This includes
row7; general damage multipliers are not thereby implemented.

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

`uv run --locked python tools/audit_civilizations.py --markdown .local/civilizations-audit.md`
inventories every owned civilisation against the current roster/decoder without
publishing assets or enabling unsupported civilisations. It writes detailed JSON
and a Markdown coverage matrix under `.local/`; the interpretation and first
mixed-civilisation acceptance plan are in `docs/civilization-coverage.md`.

The published manifest's `civilization`/`entities`/`technologies` describe the
root/default profile. `civilizations` contains independent complete profiles,
including converted entities and profile-local bonus graphs. Disabled profiles
cannot be selected. `civilizationCatalog` inventories 53 base-era trees with
extraction/enablement flags and missing roster IDs; inventory is not playability.
`civilization_bonuses` runs after every profile's technology extraction and edits
costs/times/work rates. See [bonus contract](../docs/civilization-bonuses.md) and
[roster contract](../docs/civ-roster-integration.md) for source evidence and tests.

`tools/datq.py` reloads the whole DAT on every invocation, which takes tens of
seconds. Asking it more than two or three questions is slower than writing a
one-shot script that parses once and prints everything you want.

The named table is **initial data**, not live food/population/score counters.
`rules.ts`'s `playerAttributeFor` reads it and applies completed research in
completion order. Farm capacity and unit/building repair costs consume this
lookup; open rules and older snapshots retain their existing field fallbacks.
Importing a name does not implement its mechanic: `SUPPORTED_PLAYER_ATTRIBUTES`
in `import_content.py` gates type-1 effects to those three consumers. Other
effects remain in `unmodelled`/`skippedTechnologies`, now with names as well as
resource IDs. To add a supported attribute, wire the gameplay consumer and
verify its observable outcome before extending that set and the TypeScript
`PlayerAttribute` union. New mechanics such as relic income remain separate work.

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
