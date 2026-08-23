# Library strategy: adopt, evaluate, or reference

The project should not build commodity infrastructure from scratch, but it also should not force AoE-specific authoritative behavior into a generic engine abstraction. The policy is:

- **Adopt** mature, actively maintained libraries at narrow replaceable boundaries.
- **Evaluate** libraries where their behavioral choices may alter strategy outcomes.
- **Reference** production engines when licensing, language, or architecture prevents direct reuse.
- **Implement** only the project-defining layer: AoE semantics, deterministic state transitions, observations/actions, snapshots, and batch execution.

## Adopt now

| Concern | Choice | Reason |
|---|---|---|
| AoE DAT import | `genieutils-py` 0.1.2 as an external Python tool | Successfully parsed our patch-matched `VER 8.9` DAT, avoids writing a binary parser; LGPL remains isolated from the MIT runtime |
| AoE SLD conversion | openage converter as an external tool | Strongest maintained format implementation; outputs PNG atlas and hotspot metadata; GPL tool remains outside runtime |
| Rendering | Three.js `WebGPURenderer` with WebGL 2 fallback | Already proven on the phone; supports the desired WebGPU path and keeps rendering separate |
| Schemas | JSON Schema plus Ajv when generated content is introduced | Standard, language-neutral contracts for Python importer, TypeScript runtime, agents, and future SDKs |
| Testing | Vitest now; add `fast-check` for invariant/property testing | Mature TypeScript test workflow and reproducible generative tests |
| RMS parsing | Evaluate MIT-licensed Mangudai before writing a parser | Native JS/TS AST; use `rms-check` externally as a GPL compatibility oracle |
| Browser concurrency | Native Web Workers and structured clone first | Standard platform API; add Comlink only if message boilerplate becomes material |

`aoe2-genie-tooling` 1.2.4 was also tested, but rejected for this pinned manifest because its parser reported 22,449 trailing bytes. This is why every library choice needs a real fixture rather than relying only on advertised format support.

## Strongest modern browser RTS reference

[VOIDSTRIKE](https://github.com/braedonsaunders/voidstrike) is the closest architectural reference found: TypeScript, Three.js/WebGPU, an authoritative simulation worker, fixed steps, deterministic ordering/quantization, command-based lockstep, state checksums/Merkle diagnostics, Recast Navigation, and worker-isolated AI/vision/pathfinding. It is MIT-licensed.

It is unusually relevant but still a young game repository with limited adoption, not a stable reusable engine package. We should use it as a source-level reference and selectively reuse small MIT-licensed patterns with attribution only after tests justify them—not fork its large Next/React/Phaser/networking stack.

Useful source areas:

- `src/engine/workers/` — simulation/main-thread boundary;
- `src/engine/core/GameLoop.ts` and `SystemRegistry.ts` — fixed updates and explicit system dependencies;
- `src/engine/network/` and `ChecksumSystem.ts` — commands and desync localization;
- `src/utils/DeterministicMath.ts` — quantization discipline;
- `src/engine/pathfinding/` — Recast boundary;
- `src/engine/animation/` — state-driven animation separation.

## Evaluate before adopting

### ECS: Miniplex vs bitECS

Do not introduce an ECS for the current entity count. Plain typed state is easier to inspect, serialize, snapshot, and expose to agents.

If profiling identifies entity iteration/storage as a bottleneck:

- **Miniplex** (MIT): ergonomic TypeScript/plain-object entities; lower migration cost.
- **bitECS** (MPL-2.0): data-oriented typed arrays and better high-count potential; more intrusive and license obligations must be preserved.

An ECS does not create determinism. Stable IDs, fixed ticks, explicit system ordering, deferred structural changes, seeded RNG, and canonical serialization remain our responsibility.

### PixiJS vs Three.js

PixiJS is the strongest mature sprite-heavy 2D renderer and may batch AoE atlases more naturally. Three.js remains the current choice because:

- it already works on the target phone;
- the user explicitly values Three.js/WebGPU tooling;
- VOIDSTRIKE validates the broad browser-RTS architecture;
- switching renderers before measuring atlas performance would not improve simulation research.

Keep the renderer adapter narrow. Re-evaluate PixiJS if the imported-sprite spike shows unacceptable batching complexity, memory, or mobile frame time.

### Recast Navigation

`recast-navigation-js` is active, MIT-licensed, backed by mature Recast/Detour, supports dynamic tile-cache obstacles, and integrates with Three.js. It is a strong library for navmesh games.

AoE2 movement is grid/clearance/formation-sensitive. Recast crowd behavior may change wall gaps, congestion, surrounds, and regrouping. Run focused compatibility scenarios before adopting it as authoritative navigation. It may still be valuable for the viewer/editor or a named modern-navigation profile.

### Local collision avoidance

RVO2/ORCA is a mature Apache-2.0 reference implementation. It should not be adopted automatically: reciprocal avoidance can produce smooth crowds that do not behave like AoE2 units. Compare it against simple deterministic separation and measured AoE scenarios.

### Fixed-point libraries

The current TypeScript fixed-point/lockstep packages found are young and lightly adopted. Prefer integer ticks, integer IDs/resources, quantized positions, and a tiny tested integer RNG before adding an immature numeric dependency. Cross-browser/native checksum tests should drive any fixed-point migration.

## Production engines to reference, not embed

| Engine | Primary lesson | Why not direct dependency |
|---|---|---|
| OpenRA | deterministic command pipeline, replay reuse, sync hashes, fog | GPL/C# and a full game framework |
| 0 A.D. | formations, obstruction manager, pathfinding, visibility | GPL C++/JS engine coupled to 0 A.D. |
| Recoil Engine (active Spring continuation) | large armies, movement classes, synced/unsynced simulation, LOS | GPL C++/Lua, broad 3D engine |
| openage | AoE format semantics, activities/events, flow-field research | GPL C++/Python and incomplete replacement gameplay |
| MicroRTS-Py | vectorized AI environment API and action masks | deliberately simplified mechanics; use API ideas, not simulation |

## Explicit non-goals

We will not:

- write our own DAT or SLD binary decoder;
- embed Microsoft assets in Git or deployment artifacts;
- fork a complete GPL RTS engine into the MIT browser project;
- add a general physics engine for RTS collision;
- add an ECS, state-machine framework, networking stack, or GPU compute layer before a measured need;
- let rendering/navigation library state become the authoritative game state.

## Decision rule

A library is adopted when it has:

1. a clear maintained upstream and license;
2. a narrow adapter boundary;
3. deterministic behavior where simulation-critical;
4. browser and Node compatibility where required;
5. representative benchmarks and parity tests;
6. less lifecycle cost than the code it replaces.

This is deliberately conservative: using a mature library for parsing, rendering, schema validation, or generic navigation avoids reinvention. Owning the small deterministic AoE rules kernel prevents a framework from becoming a second source of truth.
