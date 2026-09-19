# Project status

What is delivered, what is measured, and how it is verified. What is
approximated rather than read is in `docs/ledger.md`; what is still to do is
the issue tracker (`docs/backlog.md` says how it is used). The evidence for
each feature is in the commit that shipped it and on its issue — this file
does not repeat it.

## Run and play

```bash
npm install
npm run dev
```

- Public open-content URL: <https://empires.gszep.com/>
- Local imported desktop URL: <http://localhost:5173/>
- Tailnet/mobile QA URL: `https://<host>.tail6e864b.ts.net:5173/` — the
  host is the machine running Vite (`calcifer` or `ysgramor`); both are in
  `vite.config.ts`'s `allowedHosts`.
- `?map=<name>&seed=<n>` deals a named board (`islands`, `black-forest`,
  `windsor`, `senlac`, `painted-proof`; none for Arabia); F4 reveals the map;
  `+`/`-` step the game speed.

Controls and hotkeys are in `README.md`. `F10 → Load replay…` plays a
headless record and checks its periodic hashes.

## Delivered scope

**Simulation** (`src/sim`, authoritative, fixed 20 Hz tick, deterministic):
integer resources with gathering, drop-off and depletion; building placement,
construction, repair (#74), garrison (#75), destruction with each age's
collapse and rubble (#61) and fire (#73); population and housing; fifteen-deep
refundable training queues (#7) and Shift-for-five (#76); rally points; tile
A* with footprint obstruction, repathing and separation; the DAT's armour
classes, minimum damage, discrete windup/release/cooldown, `accuracy_dispersion`
misses (#45) and blast levels (#46); projectiles aimed once at launch;
corpses that decay by food eaten and are selectable while worth something
(#14); the DAT's hunter, shepherd and farmer villagers (#71), startled deer,
herdable sheep; the Britons' sixty-six technologies from `CivTechTrees` with
the DAT's effect commands (types 0, 1, 3, 4, 5), prerequisites and ages, the
Feudal, Castle and Imperial Ages and every land upgrade line to the champion;
the trebuchet packed and unpacked (#28); monks that heal and convert;
palisade walls and owner-only gates; the wonder (no victory, #110); the
trade cart; the dock, fishing ship and fish on the DAT's `terrain_restrictions`
(#81); fog with explored memory and legal last-seen observations.

**Board** (`src/sim/mapgen.ts`): the original's two primitives from the owned
RMS scripts — cost-ordered clump growth and banded candidate scans — with
`cleanTerrain`; Arabia with four of its eleven biomes and its forest ponds;
Black Forest; Islands with the engine's beach sweep and the water-masking
depth chain; leaf litter and the script's aesthetic scatter; painted boards
and two surveyed boards (Windsor, Senlac) from Environment Agency LIDAR with
visual elevation; mirror-symmetric halves; the match seed mixed before any
draw (#44).

**View** (`src/view`, never mutates state): dimetric projection with AoE2's
handedness (below); DAT terrain textures with blendomatic edge blending
(#42) and DE's overlay masks across land crossings (#116; the water's edge
is still blendomatic's, #148); fog as a rounded per-tile contour with
`colorcorrection.json`'s levels; the reference's water shader read whole from its SM2 build (the
height field, its drifts, the dome, the glint) over the tile in linear light;
shore foam from the reference's own frame atlases, one to a shore tile (#89);
SLD sprites decoded locally (main, shadow, player-colour, outline and damage
layers) with the keyframe delta rule (#78); player colour through the
palette's own block; occlusion contours; task animations on the
simulation's clock (#72); the HUD laid out from the widget files — command
grid with the DAT's `button_id` cells and action icons, selection panel with
stat row and group portraits, resource panel with gatherer counts and age
bar, menu panel, minimap with four buttons and a flare, score panel — in the
reference's face and colours (#69), names and tooltips from the strings file
(#48), portraits in the owner's colour (#77), context refusals in the
reference's words (#70); unit voices and the feedback cues from the owned
audio.

**Agents and protocol**: versioned JSON contracts; browser, built-in AI,
JSONL subprocess, deadline subprocess, WebSocket and MCP strategies share
`applyCommand`; FNV-1a periodic checksums, command-stream records, Node
verification and browser playback; process-isolated paired batches with
Wilson intervals; an opt-in live-model boundary (`RUN_LIVE_AGENT=1`).

**Import** (`tools/`): patch-matched DAT rules, palettes, terrain, blend
masks, overlay masks, water and foam atlases, widgets, fonts, strings,
particles, hotkeys and audio through a byte-identical local pipeline
(`tools/import_aoe2.sh`, openage-free); the open fallback stays playable
without any of it. The base depots only: the Enhanced Graphics Pack is
pinned (#150, decided for the pack) but not yet imported (#151), and every
DE capture in the reference corpus was taken with it installed.

**Not drawn** (#149): DE's frame is composited offscreen through
`CombineTerrainSpriteSMP` with bloom, the biome's colour grade, vignette and
sprite supersampling, then an antialias and unsharp pass; ours draws
straight to the canvas. Nor the ground's scatter and layer (#55).

## Deliberately omitted

Other civilisations (#122) and their bonuses (#123); formations; warships,
transports and fish traps (#97); the scorpion (#127); campaigns; multiplayer;
diplomacy; relics (#130); stone walls; a genetic-algorithm framework;
separate mobile gameplay. Forty-eight technologies are not researchable, each
with its reason in the manifest's `skippedTechnologies` (#128). The open
fallback stops at the Castle Age (#125).

## Measurements

All on the 120x120 generated board unless stated; older figures are not
comparable because the board changed under them.

- **Paired batch, 2026-08-29** (16 seeds, 2400 s clock): 14 decided, 2
  timeout draws, **0 replay checksum failures**, 32/32 Feudal, 4 Castle.
  The trade-off curve across seven configurations is on #124; the
  smith/no-smith A/B is 7-7 (null).
- **Per-tick cost** (seed 102, 900 s, warm, 1308 live entities): median
  0.95 ms, p90 1.09 ms, p99 1.49 ms, worst 6.07 ms against the 50 ms budget.
  A fifty-unit order lands in 8.85 ms warm (`docs/pathing-review.md`).
- **Browser** (headless Chrome, SwiftShader, 1280x800): ~25 ticks/s at the
  default speed, 17.5 at Slow (ratio 1.45 of the 1.50 asked); the absolute
  rate is software rendering, the ratio is the claim.
- **Import**: every consumed DAT graphic, rule and widget resolves; the
  local SLD decoder is byte-identical to openage's on all 29,783 frames it
  replaced; every modelled unit's stats match the DAT (487 values, 0
  mismatches, #36).
- **Tests**: 404 vitest (≈160 s on six workers), 72 import tests, and the
  browser smoke (`tools/debug_smoke.mjs`: a private server, real clicks and
  keys). Fidelity assertions skip without the owned content; the gate says
  how many skipped.

## The reference's default zoom is 0.8 of ours

DE at its default zoom draws the 2x assets at 0.80 -- a 77-pixel tile
against our 96 at zoom 1 (`islands-coast-2026-09-19.png`: a 143-texel
mangrove stands 115 px, the water's repeat vector is (404, 202) px). A match
here now opens at zoom 0.8, so a composite at each game's default compares
like with like.

## The projection has AoE2's handedness

`worldToIso` sends +x down-**left** and +y down-**right**; tile (0, 0) is
the diamond's top corner. Everything that turns a tile direction into a
screen direction leans on it: `worldToIso`/`isoToWorld`, the minimap's
`toCanvas`/`fromCanvas` and image transform, `directionIndex` (facing into
sprite frame), the blend-mask neighbour table and tile-corner uv assignment,
the wall run frames and the gate's art key, the water's world frame, and
the two surveyed boards (transposed on import). Player 1's town, at
x = W/4, is on the screen's right. A change to any of it is verified by
mirroring an earlier screenshot and laying the new one beside it: layout
lands on the mirror to the tile, sprites are not mirrored.

## Verification

```bash
tools/gate.sh              # npm test, npm run build, npm run test:import, npm run debug:smoke
npm run batch -- --matches 16 --concurrency 16 --seed-start 100 --max-time 2400 --out .local/batches/gate
npm run test:live-agent    # opt-in
```

The batch's `summary.json` carries `decided`, `timeouts`, `replayFailures`
and `throughput`; a change that moves any of them is worth explaining.

Two things the gate does not measure, run by hand after anything touching the
map, the pathfinder or the frame loop: the **worst tick** over a full match
(`tools/probes/pathing.ts` is the shape), and **a real page** driven through
a player's own input path — `page.mouse.click`, `page.keyboard.press` — read
back through `/__debug`, on a private Vite server (`AGENTS.md`;
`tools/probes/README.md` names the probes that do this).
