# Architecture decision: optimize for learning first

## Decision

Start with one deterministic **TypeScript simulation core** used directly by both the browser and the Node match/batch runner. Use Three.js's `WebGPURenderer` with its WebGL 2 fallback strictly as a view. Do not add Rust, WebAssembly, an ECS framework, a network service, or GPU compute until measurements justify them.

This supersedes the initial research report's Rust-first recommendation for the prototype phase.

## Why this is leaner

- Coding agents and browser devtools can inspect and hot-reload the entire stack.
- There is no JS/WASM boundary or duplicated type/schema generation.
- Browser and future Node simulations import the exact same `src/sim` modules.
- Fixed-step deterministic state transitions are enough to validate rules and replay design.
- Independent matches can later run in Node worker threads or processes.
- The renderer is replaceable without changing game state.

WebGPU is not currently used for simulation. Three.js selects WebGPU where supported and falls back to WebGL 2, keeping mobile verification broad without maintaining two renderers.

## Alternatives considered

### TypeScript simulation + Canvas 2D

The smallest possible implementation and a good debugging view. It becomes cumbersome for camera movement, instancing, animation, terrain, and effects. Three.js adds some bundle size but reduces viewer work and preserves a path to WebGPU.

### TypeScript simulation + Three.js WebGLRenderer

Stable and sufficient. `WebGPURenderer` now includes a WebGL 2 fallback; using its conservative material subset allows one viewer while testing WebGPU-capable devices. We can switch to plain WebGLRenderer if mobile initialization proves unreliable.

### Rust native core + WASM browser build

Likely attractive when simulation throughput or memory becomes limiting. It adds a toolchain, bindings, serialization/lifetime concerns, slower hot reload, and harder browser debugging. Introduce only after representative benchmarks show TypeScript cannot meet a stated throughput target.

### Rust server + thin browser client

Good for authoritative multiplayer, but wrong for the first slice: it requires networking and prevents the phone from running/replaying the same simulation locally.

### GPU-batched simulation

Potentially useful at very large population sizes, but branching event-driven RTS worlds map poorly to GPU kernels until the rules and data layout stabilize. CPU workers are the first scaling step.

### Fork openage

Provides deep format and engine knowledge, but its size, incomplete gameplay, C++/Python stack, and GPL obligations make it a poor rapid-prototype base. A time-boxed compatibility spike remains worthwhile later.

## Upgrade triggers

Keep TypeScript until one of these occurs under a representative benchmark:

- simulation consumes more than 80% of optimization wall time;
- Node cannot meet the agreed simulated-game-hours/second target across available cores;
- per-world memory prevents the desired batch size;
- deterministic native/browser parity cannot be maintained;
- browser main-thread simulation causes visible input latency after using a Web Worker.

Before changing language, try in order:

1. profile and remove allocations from hot paths;
2. run browser simulation in a Web Worker;
3. run Node matches in worker threads/processes;
4. use typed arrays or data-oriented storage only for measured hotspots;
5. move isolated kernels to WASM;
6. move the full core to Rust only if the simpler interventions are insufficient.

## Current state

The slice has grown well past the first horizontal cut: deterministic
pathfinding, obstruction, DAT-backed combat, fog of war, projectiles,
construction, drop-sites, the Dark, Feudal and Castle Age building sets, ages
and technologies, monks and siege, replay verification, and concurrent headless
batches are all in. `docs/status.md` is the accurate
inventory; the issue tracker lists the known gaps (`docs/backlog.md` says how it is used). Desktop/laptop remains the
canonical play target and mobile a remote verification surface only.

The immutable match rules bundle holds a default civilisation plus optional
complete additional profiles. `sim/civilizations.ts` resolves player-owned rules;
Gaia and map generation use the root. Commands, per-player research lookups,
placement/navigation and UI read through that boundary. The importer publishes
independent Briton/Frank supported-roster profiles, bonus graphs and namespaced
assets. Selection carries both identities through solo/shared restarts and saves.
Full civilisation roster/effect coverage remains tracked work. Converted entities carry a plain-data unit-rule
snapshot consumed by `unitRulesForEntity`; creation and player-level systems still
resolve through the player's catalogue. The inheritance split is inferred, with
remaining evidence gaps in `docs/civilization-coverage.md` and `docs/ledger.md`.

Rendering uses bounded pass-local sort keys (`view/render-order.ts`): ground,
fog, sprite bodies, projectiles, contours, rally flags and placement overlays keep
their relative passes regardless of map extent. Body piece offsets are applied
before bounding, preserving their existing depth order. This is a view-only
implementation policy, not a substitute for the reference compositor (#149).
