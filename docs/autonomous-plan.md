# Autonomous target: playable Dark Age skirmish

## Stop condition

Deliver a desktop-first, deterministic 1v1 Dark Age skirmish with imported AoE2DE visuals and data-backed economy, construction, production, combat, visibility, an external strategy protocol, and reproducible headless batches. Mobile remains a secondary remote quality-control surface.

It is complete when:

- a human can gather food/wood/gold, return resources, build houses/barracks, train villagers/militia, fight, and win;
- the battlefield, HUD, command grid, selection panel, minimap, menus, icons, typography, colors, density, hotkeys, and pointer interactions closely match AoE2DE's WEST/Dark Age desktop presentation;
- the example AI performs the same loop through the public command interface;
- units navigate around buildings/resources without drifting through them;
- combat uses discrete attack timing, DAT armor classes/minimum damage, and activity-driven animation;
- player observations cannot reveal hidden enemy state;
- an arbitrary subprocess strategy can play through JSONL without a browser;
- at least 16 seeded headless matches run concurrently and produce replayable results;
- any match can be replayed in the browser with matching periodic checksums;
- landscape Chrome on karasu remains usable for verification without influencing desktop layout decisions.

Do not expand to additional ages, civilizations, naval play, campaigns, or multiplayer networking before this target passes.

## Source priority for compatibility

The owned, patch-matched Steam content is the primary implementation input, not merely visual inspiration. Before introducing a hard-coded value or handmade substitute, search the downloaded DAT, RMS, AI/XS, graphics, `widgetui`, localization, and sound metadata. Prefer, in order:

1. deterministic local conversion/import of the original asset or datum;
2. project code implementing behavior described by those inputs;
3. focused runtime observation or documented reference where behavior lives only in the executable;
4. a clearly recorded approximation only when the first three are unavailable.

This applies to entity statistics, animation IDs/timing, terrain and entity art, player colors, UI geometry, panel textures, icons, labels, hotkeys, widget states, and sound-event selection. Derive generated manifests and layout constants from source files rather than transcribing or eyeballing them. Keep imported Microsoft content local and ignored, and keep the open fallback usable, but optimize fidelity for owners who run the importer.

## Phase 1 — Generalize imported content

Replace the one-off militia packaging internals with a small declarative import specification while retaining militia as the fixture. Add villager, town center, barracks, house, tree, berries, and gold.

Import only fields consumed by the slice: IDs, costs, HP, speed, collision/clearance, capacity, train/build times, attacks/armor, tasks, graphic IDs, frame timing, and source provenance. Import idle/walk/work/build/attack/death visuals as applicable.

Following `docs/ui-reference.md`, also import the minimal WEST UI set from `widgetui`: top/resource and bottom bars, map/command/selection/menu panels, food/wood/gold/population symbols, unit/building/action icons, button states, and relevant menu decoration. Extract consumed geometry, anchors, fonts, material references, hotkeys, tab order, and click-sound aliases from the current `resourcepanel.json`, `commandpanel.json`, `mappanel.json`, `blankbottompanel.json`, `icons.json`, `materials.json`, and `sounds.json`; do not manually recreate values already present there. Convert DDS icons locally through Pillow or another maintained decoder. Keep all generated content local and hashed.

**Gate:** one command regenerates byte-identical manifests/atlases/UI assets; integration tests resolve every required DAT and widget reference/source file.

## Phase 2 — Stable public contracts and headless execution

Define compact versioned TypeScript types and JSON Schemas for content, commands, player observations, match configuration, events, and results. Avoid a schema framework unless Ajv demonstrably saves code at the Python/TypeScript boundary.

Add:

- canonical player-filtered observations;
- deterministic concise text derived from those observations;
- rejected-command diagnostics;
- a JSONL subprocess strategy protocol;
- a Node headless match CLI;
- the existing AI as the first strategy package.

Keep browser and subprocess inputs on the same `applyCommand` path.

**Gate:** the subprocess AI completes a match headlessly; malformed protocol input fails clearly; hidden enemy entities never appear in a player observation.

## Phase 3 — Economy and construction

Implement fixed-tick activity loops:

- villagers walk to a resource, gather to capacity, walk to a valid drop site, deposit, and repeat;
- resource nodes deplete;
- buildings have footprints, placement legality, construction progress, and builder contribution;
- production queues consume the imported resource types and time;
- houses determine population capacity;
- rally points produce commands through the same public interface.

Use integer resource quantities and simulation ticks. Keep rendering interpolation out of state.

**Gate:** focused tests match imported/validated gather, build, and train timings within declared tolerances; resources are conserved; replay hashes are stable.

## Phase 4 — Navigation, obstruction, and combat

Create an AoE-focused compatibility suite before selecting navigation/local-avoidance behavior: direct path, blocked destination, building detour, one-tile gap, crossing groups, surround, and dynamic building insertion.

Evaluate maintained libraries described in `docs/library-strategy.md`; adopt through a narrow adapter only if deterministic fixture results are suitable. Otherwise implement the smallest deterministic grid search required by the suite, citing OpenRA/0 A.D./openage algorithm references without copying GPL code.

Implement:

- static/dynamic obstruction and deterministic spatial queries;
- stable path tie-breaking and repathing;
- discrete attack cooldown/release events;
- armor classes, minimum damage, range, death, and target invalidation;
- activity-driven idle/walk/work/build/attack/death animation transitions;
- defensive AI behavior.

**Gate:** no damage before range/release; no movement through footprints; navigation scenarios and combat golden tests pass; militia cannot erase a town center because of placeholder DPS.

## Phase 5 — Visibility and AoE2DE-faithful viewer

Add explored/currently-visible state and player-filtered memory with `lastSeenAt`. Visibility is authoritative simulation state. Add isometric terrain/depth ordering, shadows, player-color masks, health/construction indicators, and selection/task feedback.

Recreate AoE2DE's desktop information architecture rather than inventing a generic responsive HUD:

- compact resource/population strip across the top and menu controls at the edge;
- bottom WEST-styled frame with selected-object portrait/stats, command-button grid, production queue, and minimap;
- imported unit/building/technology/action icons with normal/hover/pressed/disabled states;
- AoE-like parchment, stone/wood/metal borders, gold highlights, player colors, serif display text, compact numeric labels, notifications, tooltips, pause/settings, victory/defeat, and skirmish setup menus;
- AoE-like keyboard hotkeys, mouse selection, drag selection, edge/camera movement, pointer tooltips, and command feedback.

Use original imported `widgetui` layouts, textures, icons, fonts where available, and sound-event assignments in the owned-content mode; they are implementation inputs, not just mood-board references. Drive layout constants from generated metadata and reproduce runtime behavior around them. Desktop/laptop layout and interaction fidelity wins whenever it conflicts with touch convenience. Mobile may scale the complete desktop composition, add safe-area padding, and enlarge controls only behind a narrow-screen mode; it must not move core panels, remove information, simplify commands, or create separate gameplay behavior. UI state and button legality come only from canonical observations. Preserve an open placeholder skin when imported assets are absent.

Do not replace Three.js unless representative desktop profiling demonstrates a concrete problem.

**Gate:** desktop side-by-side reference checks show the same recognizable composition and states; keyboard/mouse play is complete; privileged truth and player observations differ correctly; imported assets load without console errors; desktop frame time and memory are recorded. Run a secondary mobile smoke test without blocking desktop-fidelity work.

## Phase 6 — Batches, replay, and live agents

Add canonical snapshots/checksums and command-stream replay. Run independent worlds in Node worker threads or processes; do not add ECS/WASM/GPU compute before profiling.

Add synchronous and deadline strategy modes, then MCP/WebSocket adapters. A model provider is relevant only here: add one opt-in live integration that authenticates from the existing machine environment, completes a short structured observation/action scenario, limits tokens/cost, and records no secret or proprietary state.

Add paired seeds, result summaries, confidence intervals, and strategy artifact hashes. Do not build a full GA framework if a maintained optimization library fits behind the evaluator; the project owns evaluation semantics, not generic selection/crossover algorithms.

**Gate:** 16 concurrent seeded matches, deterministic replay in browser, arbitrary JSONL strategy, and one successful opt-in live model-agent scenario.

## Final handoff report

Report:

- desktop URL, controls, hotkeys, and secondary mobile verification URL;
- implemented and deliberately omitted mechanics;
- measured headless throughput and desktop performance;
- compatibility evidence and known discrepancies;
- exact test commands and results;
- the smallest recommended next milestone.
