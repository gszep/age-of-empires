# Autonomous target: playable Dark Age skirmish

## Stop condition

Deliver a mobile-playable, deterministic 1v1 Dark Age skirmish with imported AoE2DE visuals and data-backed economy, construction, production, combat, visibility, an external strategy protocol, and reproducible headless batches.

It is complete when:

- a human can gather food/wood/gold, return resources, build houses/barracks, train villagers/militia, fight, and win;
- the example AI performs the same loop through the public command interface;
- units navigate around buildings/resources without drifting through them;
- combat uses discrete attack timing, DAT armor classes/minimum damage, and activity-driven animation;
- player observations cannot reveal hidden enemy state;
- an arbitrary subprocess strategy can play through JSONL without a browser;
- at least 16 seeded headless matches run concurrently and produce replayable results;
- any match can be replayed in the browser with matching periodic checksums;
- landscape Chrome on karasu remains usable.

Do not expand to additional ages, civilizations, naval play, campaigns, or multiplayer networking before this target passes.

## Phase 1 — Generalize imported content

Replace the one-off militia packaging internals with a small declarative import specification while retaining militia as the fixture. Add villager, town center, barracks, house, tree, berries, and gold.

Import only fields consumed by the slice: IDs, costs, HP, speed, collision/clearance, capacity, train/build times, attacks/armor, tasks, graphic IDs, frame timing, and source provenance. Import idle/walk/work/build/attack/death visuals as applicable. Keep generated content local and hashed.

**Gate:** one command regenerates byte-identical manifests/atlases; integration tests resolve every required DAT reference and source file.

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

## Phase 5 — Visibility, viewer, and mobile UX

Add explored/currently-visible state and player-filtered memory with `lastSeenAt`. Visibility is authoritative simulation state. Add isometric terrain/depth ordering, shadows, player-color masks, health/construction indicators, and concise selection/task UI.

Do not replace Three.js unless an imported-asset mobile benchmark demonstrates a concrete problem. Preserve open placeholders when local assets are absent.

**Gate:** privileged truth and player observations differ correctly; mobile controls remain usable; imported assets load without console errors; frame time and memory are recorded on a representative match.

## Phase 6 — Batches, replay, and live agents

Add canonical snapshots/checksums and command-stream replay. Run independent worlds in Node worker threads or processes; do not add ECS/WASM/GPU compute before profiling.

Add synchronous and deadline strategy modes, then MCP/WebSocket adapters. A model provider is relevant only here: add one opt-in live integration that authenticates from the existing machine environment, completes a short structured observation/action scenario, limits tokens/cost, and records no secret or proprietary state.

Add paired seeds, result summaries, confidence intervals, and strategy artifact hashes. Do not build a full GA framework if a maintained optimization library fits behind the evaluator; the project owns evaluation semantics, not generic selection/crossover algorithms.

**Gate:** 16 concurrent seeded matches, deterministic replay in browser, arbitrary JSONL strategy, and one successful opt-in live model-agent scenario.

## Final handoff report

Report:

- mobile URL and controls;
- implemented and deliberately omitted mechanics;
- measured headless throughput and mobile performance;
- compatibility evidence and known discrepancies;
- exact test commands and results;
- the smallest recommended next milestone.
