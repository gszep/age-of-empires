# Dark Age skirmish handoff

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
- Patch-matched DAT rules and AoE2DE entity/widgetui assets through a byte-identical local import; open fallback remains playable.
- WEST/Dark Age desktop composition with dimetric world, task animations, composite town center, fog, command/selection panels, minimap, menus, hotkeys, pointer interactions, and landscape scaling.
- Versioned JSON public contracts; browser, built-in AI, JSONL subprocess, deadline subprocess, WebSocket, and MCP strategies share `applyCommand`.
- Full-state FNV-1a periodic checksums, command-stream records, Node verification, and browser playback.
- Process-isolated paired batches with configurable concurrency, Wilson 95% intervals, strategy hashes, per-match results, and replay records.
- Opt-in live model boundary using existing machine authentication: one ephemeral/no-tools/no-session call, thinking disabled, compact filtered input, one constrained action, 64 KiB process-output ceiling, 120-second deadline, and no stored observation/response/credential.

## Deliberately omitted

The target does not include Feudal+ ages, other civilizations, technologies, formations, naval play, campaigns, random-map parsing, multiplayer networking, diplomacy, trade, relics, gates/walls, or a genetic-algorithm framework. Mobile has no separate or simplified gameplay. Imported player-color/shadow supplemental SLD layers remain disabled because the pinned openage decoder crashes nondeterministically; tinting is the documented fallback.

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

Known discrepancies are the unstable supplemental player-color/shadow layers, single-terrain ground without the multi-terrain blend masks, approximate tint-based team colors, missing fire/corpse delta overlays, and some mirror-AI matches that stalemate until the configured timeout.

The ground samples the imported DAT terrain texture (slot 0, `Grass`/`g_grs`) at the authored `terrain_dimensions` tile span; `terrain/blends` and `terrain/masks` are not consumed yet, so terrain-to-terrain transitions are absent rather than approximated.

## Verification

```bash
npm test
npm run build
npm run test:import
npm run batch -- --matches 16 --concurrency 16 --seed-start 100 --max-time 1800 --out .local/batches/phase6-16
npm run test:live-agent   # opt-in; requires valid existing machine provider auth
```

## Smallest recommended next milestone

Stabilize conversion of SLD player-color and shadow mask layers (or adopt a fixture-proven maintained decoder revision), then add imported terrain tiles/blending. This is the narrowest improvement to the largest remaining visual discrepancy without expanding gameplay scope.
