# Research landscape: an agent-native AoE II-compatible RTS

_Last updated: 2026-03-26_

> **Prototype decision:** after reviewing implementation cost, the horizontal slice uses a TypeScript-first simulation shared by browser and Node. Rust/WASM is now an evidence-driven optimization path, not the starting requirement. See [architecture.md](architecture.md).

## Goal

Build an open-source, deterministic RTS simulation inspired by and mechanically compatible with Age of Empires II, optimized for:

- many seeded, headless matches running much faster than real time;
- batched evaluation for genetic algorithms, coevolution, and other search methods;
- unrestricted external agents with structured observations and actions;
- reproducible snapshots, replays, traces, and counterfactual branching;
- an optional browser viewer using Three.js/WebGPU;
- exactly one authoritative implementation of game rules and strategy interfaces.

A full AoE II simulation is not simple: economy is tractable, but collision, pathfinding, formations, projectile behavior, visibility, random-map generation, and numerous unit-specific mechanics form a large compatibility surface. The project should therefore make fidelity explicit and measurable rather than claim immediate frame-perfect compatibility.

## Executive conclusion

There is no mature open-source project that combines faithful AoE II mechanics, a standalone accelerated simulator, vectorized matches, an unrestricted agent API, and browser/WebGPU visualization.

The most useful existing work falls into four groups:

1. **Engine reimplementations:** openage is the strongest source of format knowledge, conversion logic, and engine architecture, but is not currently a usable complete game. freeaoe is smaller and older.
2. **Instrumentation of the proprietary game:** pyage2 and aoe2-ai-module prove useful APIs, but retain the exact throughput and deployment constraints this project is meant to remove.
3. **Optimization experiments:** AlphaScripter is the closest direct precedent for evolving AoE II strategies. RTS literature strongly supports genetic, coevolutionary, and online evolutionary planning.
4. **Research environments:** MicroRTS-Py, DeepRTS, and Planet Wars demonstrate efficient environment and agent APIs, but are not AoE-compatible.

**Recommended direction:** build a new renderer-independent deterministic simulation core, while treating openage and community tools as references/import adapters rather than adopting an unfinished general-purpose engine wholesale. Compile the same core to a high-throughput native runner and WebAssembly for the browser. Keep WebGPU in the viewer initially, not in authoritative game logic.

## AoE-specific projects

| Project | What it contributes | Main limitation for this project | License/status notes |
|---|---|---|---|
| [openage](https://github.com/SFTtech/openage) | Broad Genie-format conversion knowledge; semantic `nyan` content model; event-driven simulation; separation of simulation and presentation; headless architecture | README still describes gameplay as largely non-functional; large C++/Python codebase aimed at a general engine rather than massive batched research | GPLv3-or-later project; active development |
| [freeaoe](https://github.com/sandsmark/freeaoe) | Smaller C++ Genie-engine implementation; scenario loading, movement, attacks, and buildings | Incomplete and little recent development | GPL-3.0; last substantive repository push observed in 2022 |
| [pyage2](https://github.com/kachayev/pyage2) | Python/OpenAI-Gym-style environment; automated matches; full-speed mode; direct per-unit actions | Injects into legacy proprietary AoC on Windows; not standalone, safely sandboxed, or readily batchable | Apache-2.0 repository; last substantive push observed in 2021 |
| [aoe2-ai-module](https://github.com/FLWL/aoe2-ai-module) | gRPC bridge exposing internal AI facts/actions to external agents | DLL injection into the proprietary game; version-dependent and process-heavy | LGPL-2.1; last substantive push observed in 2021 |
| [AlphaScripter](https://github.com/mboop127/AlphaScripter) | Direct precedent: genetic evolution of AoE2 DE `.per` scripts, automated tournaments, mutation/crossover/annealing | Samples real game processes and inherits native scripting and speed limitations | No repository license detected; do not copy code without permission |
| [aoe2ai](https://github.com/lewisc64/aoe2ai) | Higher-level authoring/compiler for native AoE AI scripts | Generates the same constrained `.per` language; no simulation | Tooling/reference only |
| [aoe_build_sim](https://github.com/RilleP/aoe_build_sim) | Browser economy/build-order simulation | Narrow and old; no complete game or battle simulation | No repository license detected |
| [aoe2-unit-analyzer](https://github.com/ddk220-light/aoe2-unit-analyzer) | DE data extraction and tick-based battle simulation; useful mechanics inventory | Combat-focused rather than complete match simulation | No repository license detected at review time |
| [AoeCombatSimulator](https://github.com/Zukatah/AoeCombatSimulator) / [web version](https://github.com/Zukatah/AoeCombatSimulatorWeb) | Existing combat formulas and expected-outcome tooling | Abstract army outcomes, not spatial full-game simulation | Verify licenses before reuse |
| [aoc-mgz](https://github.com/happyleavesaoc/aoc-mgz) / [mgz-fast](https://github.com/AoEInsights/mgz-fast) | MIT-licensed replay parsing for settings, initial state, commands, timings, and build orders | A recording contains an initial snapshot and commands, not complete state at every tick; reconstruction still requires a compatible simulation | Useful for validation datasets and differential traces |
| [genie-dat](https://github.com/genie-js/genie-dat), [genieutils](https://github.com/sandsmark/genieutils), openage converter | Parsers and accumulated knowledge for Genie gameplay databases and assets | Version drift and proprietary source data; importing data is not game simulation | Prefer an optional importer from a user's legally owned installation |
| [LibreMatch delta-play-replay](https://github.com/librematch/delta-play-replay) | Open delta-state replay ideas and tooling | Not an AoE simulation engine | Useful replay/snapshot design reference |
| [awesome-aoe2](https://github.com/Arkanosis/awesome-aoe2) | Curated index of community tools and datasets | Index only | Continue surveying before implementation |

### openage assessment

openage is the closest conceptual match. Its architecture separates the authoritative simulation from presenter/rendering/input and uses event scheduling and time-dependent curves. This is a good fit for accelerated execution. Its converter also isolates version-specific Genie binary parsing from a semantic runtime model.

However, adopting it as the product core carries major costs:

- gameplay coverage is still incomplete;
- the architecture is broad and complex;
- C++/Python plus its content stack is less direct for browser delivery;
- batched independent worlds, cheap snapshots, and an agent protocol are not its primary product constraints;
- GPL reuse would determine the downstream distribution model.

Recommendation: run a short technical spike against openage before copying or forking anything. Specifically test whether one process can instantiate multiple independent headless simulations, control virtual time without sleeping, cheaply snapshot state, and compile a useful browser target. Unless those tests are unexpectedly strong, reuse its knowledge and conversion concepts, not its whole runtime.

## General RTS research environments

| Project | Useful lesson | Gap |
|---|---|---|
| [MicroRTS-Py](https://github.com/Farama-Foundation/MicroRTS-Py) | Maintained, efficient Python RTS environment; vectorized RL-oriented interfaces and action masks | Deliberately much simpler than AoE II |
| [Gym-µRTS paper](https://arxiv.org/abs/2105.13807) | Affordable full-game RTS research design and evaluation methodology | Not mechanically compatible |
| [DeepRTS](https://github.com/cair/deep-rts) | C++ simulator with Python bindings designed for high simulation throughput | Older project, no AoE fidelity or WebGPU |
| [Planet Wars RTS](https://github.com/SimonLucas/planet-wars-rts) | Clean `GameState -> Action` agent model, synchronous fast-forward runner, partial observability, agent isolation | Strategically much simpler |
| [TorchCraft](https://github.com/TorchCraft/TorchCraft) / [BWAPI](https://github.com/bwapi/bwapi) | Rich structured observations and external agent control for a commercial RTS | Depends on a proprietary legacy game and does not solve massive standalone batching |

The key lesson is to expose both a low-level action API and legal-action masks, while allowing decision intervals coarser than simulation events. Language-model agents should not be forced to emit hundreds of commands per simulated second.

## Evolutionary strategy research

The closest AoE-specific implementation is AlphaScripter. The stronger peer-reviewed literature is primarily based on StarCraft and generic RTS models:

- Ballinger, Louis, and Liu, **“Coevolving Robust Build-Order Iterative Lists for Real-Time Strategy Games”** (IEEE TCIAIG, 2016), DOI [`10.1109/TCIAIG.2016.2544817`](https://doi.org/10.1109/TCIAIG.2016.2544817). Competitive coevolution is especially relevant because optimizing against one fixed opponent tends to overfit.
- Wu and Markham, **“Evolutionary Machine Learning for RTS Game StarCraft”** (AAAI 2017), [paper page](https://ojs.aaai.org/index.php/AAAI/article/view/11109). Combines optimization of opening targets with minimum-time build-order planning.
- Justesen and Risi, **“Continual Online Evolutionary Planning for In-Game Build Order Adaptation in StarCraft”** (GECCO 2017), [PDF](https://sebastianrisi.com/wp-content/uploads/justesen_gecco17.pdf). Relevant to strategies that adapt after scouting or disruption rather than execute fixed schedules.
- Gmyrek, Antkiewicz, and Myszkowski, **“Genetic Algorithm for Planning and Scheduling Problem—StarCraft II Build Order Case Study”** (2023), DOI [`10.15439/2023F6015`](https://doi.org/10.15439/2023F6015). Treats build-order generation as constrained planning/scheduling.
- Miller and Aranha, **“Learning to Cheese: Using Genetic Algorithms to Generate Build Orders in StarCraft”** (2017), [record](https://cir.nii.ac.jp/crid/1050011097118370304). Evolves openings using outcomes from actual matches.

Design consequences:

- Support fixed train seeds and separate held-out evaluation seeds.
- Evaluate candidates over distributions of map layouts, civilizations, execution noise, and opponent policies.
- Treat outcomes as paired experiments where possible: candidate strategies should see the same seed set.
- Support common random numbers, confidence intervals, early stopping, and racing algorithms so weak candidates do not consume full match budgets.
- Preserve Pareto fronts (win rate, age timing, economy, army value, robustness, compute cost), not only one scalar score.
- Make competitive coevolution and league evaluation first-class; monitor cycling and non-transitive matchups.
- Permit snapshot/branch evaluation so many candidate decisions can continue from the same mid-game state.

## Recommended architecture

```text
                        immutable content package
                    (original data or user import)
                                  |
                                  v
+---------------- authoritative deterministic core ----------------+
| world state | rules | event queue | RNG streams | pathing | fog  |
| commands    | observations | snapshots | replay/checksum protocol |
+--------------+-------------------------+---------------------------+
               |                         |
        native batch runner          WASM/browser adapter
      (threads/processes/SIMD)             |
               |                    Three.js WebGPU viewer
       agent + search workers        timeline/debug overlays
               |
      JSONL / MessagePack / FFI
```

### Technology recommendation

- **Rust simulation core:** memory safety, native threads, good serialization, and a practical WebAssembly target. Use integers or carefully specified fixed-point arithmetic and explicit seeded RNG streams.
- **Native runner first:** benchmark CPU event-driven worlds before attempting GPU simulation. Independent matches parallelize naturally over cores; GPU compute is only justified after profiling a stable rules engine.
- **WASM browser build:** the viewer executes the same rules core for live games and replay reconstruction. Do not reimplement formulas in TypeScript.
- **Three.js WebGPURenderer:** optional presentation only. Rendering consumes immutable snapshots/interpolated transforms and cannot mutate simulation state.
- **Agent SDKs:** start with a process protocol (versioned JSONL for transparency, optional MessagePack/Cap'n Proto later) and a Rust in-process API for high-throughput trusted policies. Add Python and TypeScript clients without making either authoritative.

### One source of truth

“One source of truth” should mean:

1. One rules engine changes state.
2. One versioned command schema enters it.
3. One observation schema leaves it.
4. One strategy source artifact is used in training and visualization.
5. Replays store content/rules/strategy hashes, seed, and commands; they are verified by periodic checksums.

Avoid implementing a separate “fast approximate simulator” and “visual game.” Approximation levels should instead be explicit configurations or rule modules in the same core, and results must record which fidelity profile was used.

Strategies can be either:

- external programs implementing `observe -> commands` through the protocol;
- sandboxed WASM components, attractive for portable tournaments and reproducibility;
- declarative parameterized policy graphs for cheap GA mutation/crossover;
- trusted in-process Rust policies for maximum benchmark throughput.

All should target the same observation/action contract. An agent-authored TypeScript or Python strategy should be viewable by replaying its resulting command stream; it need not execute inside the browser.

### Agent-readable state

Provide structured data first and derive concise text from it. A useful observation has:

- simulation time, tick/event number, player/civilization/age;
- resource balances, gatherers, rates, capacity, and idle time;
- units/buildings with stable IDs, position, HP, activity, queues, and orders;
- known enemy entities with `last_seen_at` rather than hidden truth;
- researched/available technologies and legal-action masks;
- alerts and deltas since the previous observation;
- spatial summaries (regions, threats, resource clusters, travel estimates);
- optional exact debug state only for privileged evaluation.

Use a compact delta mode for agents and logs, but retain a canonical machine-readable schema. Text should be a deterministic renderer of that schema, never the authoritative state.

### Batching model

Start with N independent worlds per native process and a synchronous API:

```text
reset(seed[], matchup[]) -> observation[]
step_until(decision_time | event_filter, action[][]) -> observation[], reward[], done[]
snapshot(world_ids[]) -> snapshot_handles[]
fork(snapshot, candidate_actions[]) -> world_ids[]
```

Important optimizations:

- no wall-clock sleeps;
- no rendering allocations in headless mode;
- event-driven advancement between meaningful decisions;
- struct-of-arrays only where profiling supports it;
- deterministic per-system RNG streams so adding cosmetic randomness does not perturb combat;
- terminal prediction and racing/early elimination;
- worker isolation for untrusted agent code;
- metrics for simulated game-hours per wall-clock second, memory/world, and reproducibility.

## Fidelity and validation plan

Use named compatibility tiers:

1. **Economy sandbox:** resources, villagers, construction, production, prerequisites, ages, technologies, population.
2. **Abstract combat:** damage/armor/counters and production strategy without spatial micro.
3. **Spatial combat:** movement, pathing, collision, range, projectiles, formations, terrain, line of sight.
4. **Match compatibility:** random maps, civilizations, victory conditions, diplomacy, broad special mechanics.
5. **Patch profile:** mechanics/data tied to a named AoE release or an original open content pack.

Validation sources:

- focused golden tests for formulas and timings;
- differential experiments manually run in a legally owned AoE installation;
- parsed replay command/build-order datasets via aoc-mgz/mgz-fast;
- community mechanics documentation;
- property tests (resource conservation, deterministic replay, no illegal actions);
- replay checksums across native and WASM builds.

Record discrepancy budgets rather than hiding differences. Replay parsers alone cannot provide exact state trajectories, so they are evidence, not an oracle.

## Legal and licensing constraints

This section is engineering guidance, not legal advice.

- Do not distribute Microsoft executables, artwork, audio, maps, text, or extracted game databases.
- Ship an original open content pack for development and CI.
- If compatibility requires commercial data/assets, make conversion an optional local operation against a user's own installation, as openage does.
- Game mechanics and numerical facts require jurisdiction-specific legal review; copying database organization or expressive content can create additional risk.
- Avoid Microsoft/Age of Empires trademarks in the final product name and avoid implying endorsement.
- Preserve clean provenance for rules research, tests, and imported code.
- GPL code from openage/freeaoe can be used only if the project accepts the corresponding copyleft obligations. Code with no license (including AlphaScripter and some simulators at review time) is readable as a research lead but cannot be copied.

Choose the project's license before importing any code. A permissive clean implementation can consult public behavior documentation and interoperable file-format knowledge, but legal counsel should review the clean-room and data-import approach.

## Proposed first milestones

### M0 — evidence and benchmark contract (1–2 weeks)

- Define observation/action/replay schemas.
- Define determinism and throughput benchmarks.
- Select one AoE patch profile and one constrained scenario.
- Spike openage headless instancing/snapshot/browser feasibility.
- Inventory licenses and data provenance.

### M1 — economy laboratory

- Dark/Feudal economy, one civilization, fixed maps, production and technologies.
- Native batch runner plus deterministic text/JSON observations.
- Snapshot/fork and replay checksums.
- GA baseline against hand-authored build orders over many seeds.

### M2 — viewer without a second simulation

- Compile the core to WASM.
- Three.js/WebGPU map and entity rendering.
- Live stepping, replay scrubbing, strategy/source hashes, and debug overlays.
- Mobile quality-control route over Tailscale Serve.

### M3 — adversarial strategy search

- Abstract combat, scouting uncertainty, two-player matches.
- League/coevolution runner, paired seeds, confidence intervals, racing.
- Sandboxed agent protocol and TypeScript/Python SDKs.

### M4 — spatial fidelity

- Incrementally add pathfinding, collision, visibility, terrain, ranged combat, formations, and random maps.
- Expand differential validation and publish compatibility reports.

## Tailscale access from karasu to calcifer

Yes. The safest development setup is to leave the dev server on calcifer bound to loopback and publish it privately to the tailnet with [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve).

calcifer already has Tailscale Serve's default HTTPS endpoint proxying `/` to `localhost:8787` (probably the current pi/Paseo service), so do not replace or reset that route. Give Vite a separate private HTTPS listener:

```bash
# On calcifer
npm run dev -- --host 127.0.0.1 --port 5173
tailscale serve --bg --https=5173 5173
tailscale serve status
```

Then, while karasu is connected to the same tailnet, open:

```text
https://calcifer.tail6e864b.ts.net:5173/
```

This is private to the tailnet unless Funnel is explicitly enabled. Do **not** use `tailscale funnel` for this use case. `tailscale serve status` is safe for inspection; avoid `tailscale serve reset` because it would also remove the existing port-8787 proxy.

Tailscale Serve proxies WebSocket upgrades, so Vite HMR should normally work. If the page works but HMR does not, set Vite's HMR client to secure WebSockets on the same external port and explicitly allow the tailnet hostname:

```ts
// vite.config.ts
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    allowedHosts: ['calcifer.tail6e864b.ts.net'],
    hmr: { protocol: 'wss', clientPort: 5173 },
  },
})
```

Do not set `allowedHosts: true`. Alternatively, binding Vite to `0.0.0.0` and browsing to `http://calcifer:5173` can work over MagicDNS, but also exposes the port on calcifer's other interfaces and provides no HTTPS; Tailscale Serve is preferable.

## Immediate decision

Proceed with a small Rust/WASM vertical slice rather than a full engine fork, but gate that decision on the M0 openage spike. The first scientifically useful product is not a complete clone: it is a deterministic economy-and-production environment that can batch thousands of seeded evaluations, expose concise structured state to coding agents, fork snapshots, and render exactly the same simulation in a browser.
