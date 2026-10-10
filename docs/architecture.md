# Architecture: one simulation for play and experimentation

The product purpose is [human play feeding agent-assisted improvement](product.md),
leading toward generated historical co-op scenarios and open-ended strategy
discovery. Ysgramor and Artemis are the immediate deployment target. Real-geography
maps serve that purpose; exhaustive native parity and broad hosting are not
prerequisites for the next playable experience.

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

### Shared task and animation contract

Owned DAT tasks and graphics provide a common data shape across profiles. The
importer's `find_task` selects action/class/unit records and raises on missing
matches; `animation_entry` imports frame counts, directions, frame duration,
mirroring and frame-linked sound events (`tools/import_content.py`). The runtime
shares attack windup/release/volley paths (`src/sim/game.ts`), while
`chooseAnimation` and frame advancement (`src/view/sprites.ts`) use activity/task
state and imported metadata. This is evidence for shared, data-driven machinery,
not proof of every scheduling rule inside the native executable.

Investigate common transition, release, loop/reset and sound synchronization
contracts once with representative focused-roster units (#315). Separate source
facts from inferred scheduling. Do not create per-civilisation timing tables or
another animation framework without a demonstrated shared gap. The three-civ
development cap is defined in [product priorities](product.md).

### Delivered implementation

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
independent reviewed supported-roster profiles, bonus graphs and namespaced
assets. Selection carries both identities through solo/shared restarts and saves.
Full civilisation roster/effect coverage remains tracked work. Converted entities carry plain-data unit/building-rule
snapshots consumed by `unitRulesForEntity` / `buildingRulesForEntity`; creation and player-level systems still
resolve through the player's catalogue. Captured production buildings retain their work rate while new units use
the recipient's catalogue. Mobile cargo retains original owners and is ejectable
only by the carrier owner (user-supplied rule, 2026-09-30). Research traverses nested
cargo by each entity's owner. The remaining inheritance split and queue/building-cargo policy are inferred, with
remaining evidence gaps in `docs/civilization-coverage.md` and `docs/ledger.md`.

Rendering uses bounded pass-local sort keys (`view/render-order.ts`): ground,
fog, sprite bodies, projectiles, contours, rally flags and placement overlays keep
their relative passes regardless of map extent. Body piece offsets are applied
before bounding, preserving their existing depth order. This is a view-only
implementation policy, not a substitute for the reference compositor (#149).

Game mode (`random-map` / `regicide`) is authoritative match input. Regicide
starting actors, King survival through nested carriers, repeatable Treason and
draw outcomes live in `src/sim/regicide.ts`/`game.ts`; minimap markers consume a
read-only King-position channel, never mutate fog. Observation v11 adds the
observer's effective population ceiling and announced Wonder timers/locations
for both players without revealing hidden entities. It retains v10's public
score totals for both players and v9's mode,
draw, temporary positions and run-length encoded explored terrain/elevation for
fog-safe coastal planning, plus own-building waiting research. New records/results
are v4 with score accounting (v3 introduced research queue rules); v1–v3
replay retains pre-score hashes and v1/v2 replay retains busy-building research
rejection through an absent `researchQueueVersion` state marker. Legacy v1
recordings are accepted only without a mode field and mean random map. Shared
protocol 6 additionally carries the authoritative match population ceiling and
opt-in Wonder completion deadlines/win state, and rejects pre-score simulation
clients. Persisted shared checkpoints v4 remain loadable without changing their
state or legacy research rules; subsequent saves write a v5 envelope.
Dev snapshot 3 admits mode-less v2
snapshots as legacy random maps. A mode is not inferred from a map filename.
