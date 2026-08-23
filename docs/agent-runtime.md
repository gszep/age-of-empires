# Agent-native runtime and strategy execution

These are first-class project-owned layers, not features delegated to the renderer or a generic RTS engine.

## Product boundary

```text
                     authoritative simulation kernel
                    commands ↓              ↑ observations
                              agent gateway
              ┌──────────────────┼──────────────────┐
         human/browser      strategy workers      replay driver
                                  │
                   ┌──────────────┼──────────────┐
                TypeScript      Python       any subprocess
                                  │
                         search coordinator
                    seeds × matchups × candidates
```

The simulation owns state transitions. The agent gateway owns the stable public observation/action contract. A strategy can never mutate world state directly.

## Structured realtime visibility

The canonical observation is structured and versioned. Screenshots are optional presentation evidence, never the primary input.

An observation includes only information legitimately observable by that player unless the caller has an explicit evaluator/debug capability:

- simulation time, tick, player, civilization, age, and population;
- resources, gather rates, queues, capacity, idle time, and alerts;
- own entities with stable IDs, positions, health, tasks, queues, and orders;
- visible enemy entities plus remembered entities with `lastSeenAt`;
- known terrain, resource clusters, visibility, and spatial summaries;
- legal actions and reasons rejected actions would be illegal;
- deltas since the previous observation;
- optional event history and derived strategic summaries.

One canonical schema produces several encodings:

- compact typed/MessagePack representation for batch execution;
- JSON for SDKs and debugging;
- deterministic concise text for language-model agents;
- tensor/spatial-plane adapters for conventional ML;
- browser overlays and trace viewers.

The text representation is derived from structured state, so it cannot become a second source of truth.

## Universal strategy contract

A strategy is a stateful program implementing the conceptual contract:

```ts
interface Strategy {
  initialize(context: MatchContext): Promise<void> | void;
  observe(observation: PlayerObservation): Promise<Command[]> | Command[];
  finish(result: MatchResult): Promise<void> | void;
}
```

Strategies may maintain arbitrary private state, planners, databases, behavior trees, learned models, or call other services where the selected security profile permits it.

The language-neutral process protocol is the foundation. JSON Lines is the initial transparent transport; a binary encoding can be negotiated later. TypeScript and Python SDKs are conveniences over that protocol, not privileged implementations. Any language capable of reading stdin and writing stdout can be a strategy.

Supported execution profiles should be:

1. **Trusted in-process:** fastest; TypeScript initially, suitable for built-in policies and parameter search.
2. **Local subprocess:** arbitrary language and dependencies; isolated stdout protocol and resource limits.
3. **Sandboxed portable module:** WASI/component model if tournament portability becomes valuable.
4. **Remote agent:** WebSocket or RPC adapter for coding agents and model services.
5. **Recorded command source:** replay exactly what a nondeterministic strategy previously produced.

“Arbitrary complexity” belongs in external strategy processes. The core should not invent another constrained AoE scripting language.

## Agentic coding tools

Coding agents participate in two ways.

### Agent as strategy author

The agent can:

1. inspect the strategy SDK, semantic game content, traces, and evaluation reports;
2. create or edit unrestricted TypeScript, Python, Rust, or other strategy code;
3. run focused matches and tests;
4. inspect structured failures, rejected commands, and event traces;
5. iterate with hot reload;
6. submit a content-hashed strategy artifact for seeded evaluation.

A strategy package can contain arbitrary modules and tests. Its manifest declares entry point, runtime, observation version, requested capabilities, and decision budget.

### Agent as live strategy

The coding/model agent itself can join the action-observation loop:

```text
observe → reason/tool calls → commands → advance simulation → observe
```

Adapters:

- a CLI/JSONL protocol as the durable universal interface;
- an MCP server exposing `reset`, `observe`, `act`, `step`, `runUntil`, `snapshot`, and `fork` tools;
- WebSocket streaming for remote agents and the browser;
- SDK wrappers for direct model/API integrations.

MCP is an adapter, not the core protocol, because coding tools and MCP implementations vary. This also lets ordinary shell-capable coding agents participate without custom integration.

## Timing modes

Language-model latency requires explicit semantics:

- **Synchronous research:** simulation pauses at a decision boundary until the agent answers. Best for reasoning and debugging.
- **Realtime deadline:** observations stream while the strategy has a wall-clock deadline; timeout yields no-op or a configured fallback command.
- **Accelerated headless:** deterministic code policies run as fast as possible; external LLMs normally make coarse macro-decisions rather than every low-level action.
- **Hybrid:** a language model updates goals, production priorities, or plans at coarse intervals while deterministic strategy code handles micro and legality between calls.

Decision cadence is part of the match configuration and result. An LLM must not receive extra simulation time invisibly.

## Batched evolutionary exploration

The search coordinator is also project-owned. It treats a strategy artifact—not only a numeric vector—as a candidate:

```text
candidate source/content hash
  × opponents
  × paired train seeds
  × held-out evaluation seeds
  × civilizations/maps
  → match outcomes, traces, confidence intervals, fitness/Pareto metrics
```

It provides:

- N independent headless worlds across workers/processes;
- no rendering or wall-clock sleep;
- fixed paired seeds/common random numbers;
- compile/build caching by strategy hash;
- deterministic strategy RNG streams;
- early elimination/racing and confidence intervals;
- leagues and competitive coevolution;
- snapshot/fork evaluation from shared mid-game states;
- machine-readable traces and concise agent-readable failure summaries;
- resource limits so pathological candidates cannot stall a generation.

Genetic operators can act on parameters, policy graphs, source modules, or whole strategy packages. Coding agents can serve as semantic mutation/crossover operators: generate a candidate, run evaluations, inspect traces, and revise code.

## Reproducibility

A match record contains:

- game-content and rules hashes;
- observation/action protocol version;
- strategy source/artifact hashes;
- seed and independent RNG stream states;
- accepted command stream and rejected-command diagnostics;
- periodic canonical state checksums;
- runtime/model metadata where available.

External LLM strategies are not assumed reproducible when rerun. Their accepted command stream is authoritative for replay, allowing the resulting match to be reproduced without calling the model again.

## Security and fairness

Strategy manifests request capabilities such as filesystem, network, model API, and wall-clock access. Batch and tournament defaults deny them. Subprocesses receive:

- player-filtered observations, never hidden world state;
- CPU, memory, output, and decision-time budgets;
- isolated working directories;
- deterministic environment metadata where practical;
- protocol validation and command legality checks.

Trusted in-process policies are a performance optimization and must not be used for untrusted submissions.

## Ownership decision

We own:

1. observation and action schemas;
2. player visibility/filtering and deterministic text rendering;
3. the process protocol and SDK conformance suite;
4. live-agent/MCP/WebSocket adapters;
5. strategy packaging, capability declarations, and diagnostics;
6. the headless batch runner and evolutionary/search coordinator;
7. snapshots, forks, traces, checksums, and replay records.

External libraries may provide serialization, process isolation, worker pools, optimization algorithms, or model clients. They do not define gameplay state, visibility, legal actions, strategy semantics, or evaluation methodology.
