# Project status

Delivered scope, measurements, compatibility evidence, and known
discrepancies. Gaps that represent work to do live in `backlog.md`.

## Run and play

```bash
npm install
npm run dev
```

- Public open-content URL: <https://empires.gszep.com/>
- Canonical local/imported desktop URL: <http://localhost:5173/>
- Tailnet/mobile QA URL (preserved): <https://calcifer.tail6e864b.ts.net:5173/>

Controls and hotkeys are listed in the root `README.md`. The essential loop is left/drag selection, right-click context orders, villager build commands, town-center/barracks training, and destruction of the opposing town center. `F10 → Load replay…` plays a headless record and checks its periodic hashes.

## Delivered scope

- Fixed-tick deterministic 1v1 simulation with integer resources, gathering/drop-off/depletion, building placement/construction, population, production queues, and rally orders.
- Deterministic tile A*, footprint obstruction, repathing/separation, DAT armor classes/minimum damage, discrete windup/release/cooldown, corpses, and defensive acquisition.
- Authoritative explored/current visibility, filtered observations, and legal last-seen memory.
- Patch-matched DAT rules, palettes, and AoE2DE entity/widgetui assets through a byte-identical local import; open fallback remains playable.
- WEST/Dark Age desktop composition with dimetric world, task animations, composite town center, fog, command/selection panels, minimap, menus, hotkeys, pointer interactions, and landscape scaling.
- Versioned JSON public contracts; browser, built-in AI, JSONL subprocess, deadline subprocess, WebSocket, and MCP strategies share `applyCommand`.
- Full-state FNV-1a periodic checksums, command-stream records, Node verification, and browser playback.
- Process-isolated paired batches with configurable concurrency, Wilson 95% intervals, strategy hashes, per-match results, and replay records.
- Opt-in live model boundary using existing machine authentication: one ephemeral/no-tools/no-session call, thinking disabled, compact filtered input, one constrained action, 64 KiB process-output ceiling, 120-second deadline, and no stored observation/response/credential.

## Deliberately omitted

The target does not include Castle+ ages, other civilizations, formations, naval play, campaigns, random-map parsing, multiplayer networking, diplomacy, relics, gates/walls, or a genetic-algorithm framework. Of the technology tree only Loom and the Feudal Age are researchable. Mobile has no separate or simplified gameplay. All SLD layers convert through the local decoder.

## Measurements and gate evidence

Measured on calcifer:

- 16 paired-seed matches in 16 concurrent Node processes: **17,756 simulated seconds in 115.771 wall seconds (153.37× aggregate real time)**.
- Outcomes: 12 decided, 4 timeout draws; strategy-one mirror win rate 0.5, Wilson 95% interval `[0.2538, 0.7462]`.
- All 16 replay records re-simulated with **0 checksum failures**.
- Browser file replay reported `Replay verified: 1 checksums match` for a six-second imported-rules record.
- Headless Chrome software-rendering sample at 1920×1080: 4.0 fps, 8.3 MiB JS heap used / 13.8 MiB total after selection-ring pooling. A run without the forced SwiftShader flag reported 6.0 fps and 12.9/21.8 MiB, but headless Chrome still did not establish representative hardware acceleration; this is a known measurement limitation, not a desktop GPU claim.
- 844×390 landscape Chrome smoke retained the complete top bar, world, command frame, and minimap.
- Opt-in live-agent scenario completed successfully through the authenticated pi/OpenAI-Codex provider with one schema-valid command.

Batch artifacts are intentionally ignored under `.local/batches/phase6-16/`.

## Compatibility evidence and discrepancies

The importer integration resolves every consumed DAT graphic/rule and widgetui source, hashes inputs, and regenerates byte-identically. Viewer smoke tests loaded imported atlases and WEST UI without application console errors; selection, gather orders, fog expansion, and browser replay were exercised through Chrome DevTools Protocol. Timing, resource conservation, hidden information, pathing, combat release, protocol validation, and replay determinism have focused tests.

Known discrepancies are single-terrain ground without the multi-terrain blend masks, missing fire/corpse delta overlays, and some mirror-AI matches that stalemate until the configured timeout.

The ground samples the imported DAT terrain texture (slot 0, `Grass`/`g_grs`) at the authored `terrain_dimensions` tile span; `terrain/blends` and `terrain/masks` are not consumed, so terrain-to-terrain transitions are absent rather than approximated. The DAT gives each terrain a `blend_type` (grass 0, both farm slots 1) and a `blend_priority`, but nothing in the owned files maps a `blend_type` to one of the ten files in `terrain/blends/`, nor says how a 512x512 blend is indexed against a tile — its shapes are irregular parcels that straddle every even split. `overlay_mask_name` (grass -> `masks/grass.png`) is a noise texture, and the `terrain_unit_masked_density` field beside it suggests it drives decorative scatter rather than the ground's appearance. Farms are terrain too (slots 7 and 29, `Farm1`/`Farm Cnst1`): the DAT gives them no SLD, so they draw as their own patch of the isometric grid.

### Player colour comes from the game palette

Player colour is a palette substitution, not a tint. Two measurements settled
how:

- The SLD player-colour layer is **coverage**. Its interior is a solid 255 and
  only the BC4 block edges carry intermediate values, so it says *where* the
  owner's colour goes, not how bright it is.
- The **main graphics layer** carries the shade: under full coverage those
  pixels are neutral greys (mean channel spread 1.8 on the barracks, 6.8 on the
  militia) whose range tracks the rest of the sprite's shading.

The ramp that grey indexes is the game palette's eight-shade block at the DAT's
own `player_colours[i].player_color_base` — `original.pal` 16..23 for player
one, `(0,0,82)` through `(205,250,255)`, the colours AoE2 has always drawn blue
player colour with. The DAT's `minimap_color` for the same players resolves
through that palette to pure blue, red, green, yellow, cyan, magenta, grey and
orange in order, which is what confirms the ordering rather than assuming it.
The 16x16 blends in `playercolor_*.pal` are DE's editable hue-to-target table
and are **not** consumed: nothing a sprite carries indexes them.

`convert_sld.py` therefore packs the player-colour sheet as the main layer's
grey in RGB and the mask's coverage in alpha, and `import_content.py` emits each
player's block plus the grey player's block as the shade axis. The renderer
resolves the grey to a 256-texel ramp per player and samples it in a TSL node
material, so one texture read gives both the shade and the coverage. A militia
now renders 357 distinct blues from its own palette block where it previously
drew one flat `#1a6cff`.

The town center's own art carries no player-colour layer: its colour is entirely
in its annex pieces, which is why it used to render grey. Each annex now draws
its own player-colour sheet through the same ramp, and a pixel sample over the
building returns 3,258 player-blue pixels in 2,783 shades.

Art the engine draws itself has no unit to resolve it from, so `import-spec.json`
gained an `effects` section that finds a graphic by its own name and refuses a
name matching anything but exactly one. The gather-point flag is the first:
`WaypointFlag Britons`, 90 frames, drawn at a selected building's rally point in
the owner's colour.

### Every production building trains its Dark/Feudal list

Audited against `creatable.train_locations` for the imported civilisation, which
is the only list that counts — the DAT's `unit.name` fields are AoK leftovers
that never moved with the ids, so unit 7 is called XBOWM and draws
`u_arc_skirmisher_*`.

| Building | Trains in this slice | Left in the DAT |
|---|---|---|
| Town center | villager | herdables (sheep, goat, turkey…) |
| Barracks | militia, spearman | man-at-arms and above, eagle scout, civ uniques |
| Archery range | archer, skirmisher | crossbowman, elite skirmisher, cavalry archer, hand cannoneer |
| Stable | scout cavalry | knight line, camels, civ uniques |
| Market | trade cart | trade cog (water) |
| Mill, lumber camp, mining camp, house, outpost, watch tower, blacksmith | nothing | nothing |

What is left out is age-gated or another civilisation's, which is the omitted
scope above — except the herdables, which are their own item.

### Ages and technologies

A building researches one technology at a time. Cost, research time, the
building it happens at, and what it changes all come from the DAT rather than
from a table here:

- **Loom** — 50 gold, 25 seconds at the town center. Its +15 hit points and
  +1 melee / +2 pierce armour are decoded from the effect's own commands
  (attribute 0 and the packed armour attribute 8), and the hit points reach the
  villagers already standing on the map, as in AoE2.
- **Feudal Age** — 500 food, 130 seconds at the town center. This is tech 101,
  which the DAT calls "Middle Age" while its effect is called "Feudal Age" —
  the same name-versus-data trap as the units, so the effect name is what the
  importer asserts.

Which age a thing belongs to is not a list here either: the importer finds the
"(make avail)" technology that enables each unit and reads the age technology in
its requirements. That makes market, blacksmith, archery range, stable, watch
tower, archer, skirmisher, spearman, scout cavalry and trade cart all Feudal,
and barracks, house, mill, camps, outpost, farm, militia and villagers Dark —
which is exactly DE's tech tree for this slice. Placement and training refuse
anything past the player's age, and the command grid hides it.

The built-in AI never ages up: it builds and trains only Dark Age things, so its
matches (and the batch measurements above) are unaffected by the gate.

### Food on the hoof

Gaia's animals are units, not resource nodes: they walk, they can be killed, and
they carry the food the DAT stores on them — 100 for a sheep, 140 for a deer,
340 for a boar. Four sheep stand by each town center, with two deer and a boar
out on the map.

A herdable joins whoever comes closest and follows them, unless units of both
players are within range, in which case it stays gaia's — AoE2's rule. Working
one turns it into a carcass on the spot, which is what the game does too. Deer
bolt from anything that is not gaia; a boar answers a wound by charging whoever
made it, which is what makes luring one a decision. A carcass outlives the
three-second corpse window for as long as there is food on it, and the villager
that killed it switches to carrying the meat home under the DAT's own hunter
art (unit 122, `u_vil_male_hunter_*`).

Two knowing simplifications: hunting banks at the forager's rate and carry
capacity rather than the hunter's own DAT numbers (0.41 a second into 35, where
the simulation has one rate per resource and one capacity), and the built-in AI
does not herd or hunt at all. Both are recorded in `backlog.md`.

### Trade pays what the road costs

The market trains the DAT's trade cart (unit 128, 100 wood + 50 gold, 51s), and
a cart ordered onto a foreign market shuttles: it loads there and banks gold on
reaching its own market. How much is the cart's own data rather than a constant
from outside it — `bird.work_rate` (0.2875 per second) for every second spent
travelling since its last delivery, capped at `resource_capacity` (100). A
longer route is worth more, as in AoE2. The engine's own coefficient (the
community's 0.46 gold per tile) is not in the owned files, so it is not used;
this is a documented substitution, not a match.

The remainder rides on to the next run, the way a villager's gather progress
does: flooring it away left a short route paying nothing at all rather than
paying a little.

AoE2 pays a cart at both ends of the route and ours pays only on arriving home,
which halves the delivery frequency at the same gold per second of travel. A
route the cart cannot walk — a market sealed in by trees, which the default map
can produce — ends the order rather than leaving the cart walking on the spot.

A death leaves what the DAT says it leaves: `unit.dead_unit_id` names a unit
whose standing graphic is the art left behind — `u_*_decayA_x1` for each unit
and villager task variant, `n_tree_stump_generic_x1` for a spent tree or berry
bush. The renderer plays the dying graphic once and then holds that art. Both
last only as long as the simulation's three-second corpse window, where AoE2
keeps a stump for the rest of the match. Buildings are left out of the chain on
purpose: their death graphic is longer than that window, so rubble would never
be reached (see `backlog.md`).

### The outline layer is a contour, and it is for occlusion

The SLD outline layer is not BC-compressed like the others. Its payload is a
`u16` offset per 4x4 block row into a command stream, where a byte under `0x80`
skips that many blocks and `0x80|n` draws `n` of them from two bytes each — the
block's sixteen pixels, row by row, least significant bit first. Every row's
commands cover exactly its blocks and consume exactly its bytes; the decoder
raises otherwise, and all 78 consumed sources walk clean.

What comes out is a one-pixel contour lying *inside* the sprite (98% of the
barracks' lit pixels fall on opaque art, covering 18% of it), not a silhouette
and not a halo. That is what AoE2 draws through a building standing in front of
a unit, in the colour the DAT names in `player_colours[i].unit_outline_color` —
pure blue for player one, pure red for player two. The renderer shows a unit's
contour when a building or tree with a greater isometric depth covers at least
half of its art — the same sorting the painter's-order draw already uses. That
half is an approximation: a sprite's box includes its transparent margins, so
the real game's per-pixel test is what this stands in for, and a unit merely
brushing a tree's bounding box would otherwise light up. On a small sprite the
contour is most of the silhouette (86% of a villager's lit pixels), so a hidden
villager reads as a coloured shape, exactly as it does in the game.

### The import pipeline is openage-free

`tools/sld_layers.py` decodes every consumed SLD layer — BC1 main graphics
plus the BC4 shadow and player-colour masks — and was verified byte-identical
to the previously used openage decoder across all 29,783 imported frames
before the swap. The openage checkout, its C++/Cython build, and the
per-atlas subprocess isolation that guarded against its crashes are gone;
`tools/requirements.txt` is down to genieutils-py and Pillow.

Two format facts discovered on the way, both violated by
`b_west_stable_age2_x1.sld` (the file that crashed openage): the header field
the public documentation records as "unknown, always 0x10" is the frame-data
start offset (14 in the stable), and per-layer 4-byte padding is relative to
that start, not to the file. With both honoured, the stable's 90 frames walk
cleanly to the file's final byte; the stable and the scout cavalry it trains
are imported from it.

### Audio import is unblocked

Patch-matched sound depots 813783 and 813787 are now recorded and documented.
`tools/wwise_pck.py` reads their AKPK indices, while `tools/import_audio.py`
hashes the `sounds.json` event name with Wwise's lowercase FNV-1 ID, follows the
HIRC Event → Play Action → container/sound graph, and extracts only referenced
DIDX media. The externally installed, permissively licensed `vgmstream-cli`
then decodes that media to deterministic browser-playable WAV without vendored
decoder code.

The first consumed cue is the widget-authored `button_ui` alias:
`Play_Button_UI` resolves in bank 232745270 to media 56802692 and decodes to a
0.239456-second mono 22.05 kHz cue. It plays for HUD command/menu clicks in the
owned-content mode; the open fallback remains silent. Integration tests verify
the source resolution and byte-identical regeneration. Broader simulation
sound triggers and localized unit acknowledgements are not wired yet.

## Verification

```bash
npm test
npm run build
npm run test:import
npm run batch -- --matches 16 --concurrency 16 --seed-start 100 --max-time 1800 --out .local/batches/phase6-16
npm run test:live-agent   # opt-in; requires valid existing machine provider auth
```

