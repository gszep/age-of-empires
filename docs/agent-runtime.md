# Agent runtime: the implemented boundary and the next experiments

Human play and agent experimentation share one environment; see
[product priorities](product.md). Headless checks should shorten the feedback
loop, not become a separate game that only passes its own tests.

## One simulation, several clients

```text
human/browser ─┐
strategy      ─┼─ public commands → authoritative simulation → observations
replay driver ─┘
```

`src/sim/observe.ts` is the canonical player-filtered observation. Enemy orders,
production and hidden state are not strategy inputs. Text descriptions derive
from structured observations, not from a second interpretation of the world.

`src/protocol/types.ts` is authoritative for versions: observations are **v9**
(including own-building waiting research); new match configs/results/records
are **v3**. Replay of v1/v2 retains the pre-queue research rules, including
rejection of research commands sent to a busy building. Legacy v1 records mean random map
and cannot carry newer mode/population/Wonder settings. Explored terrain is
run-length encoded with unknown cells retained as unknown. Shared-network and
dev-snapshot versions are separate contracts, not observation versions.

## What runs today

`src/headless/runner.ts` accepts a strategy with `decide(input)` returning public
commands and an optional `stop()`. It passes observations and rejected-command
feedback to each player, validates commands through the simulation, and records
commands plus periodic checksums. Replay runs those commands without calling
the original model or strategy again.

`src/headless/strategies.ts` supplies trusted in-process, JSONL subprocess,
deadline subprocess, WebSocket and MCP adapters. They return the same commands;
MCP is an adapter, not the core protocol. Ordinary subprocess strategies can be
written in any language. Trusted in-process strategies are not a sandbox.

```bash
npm run match -- --seed 7 --p1 builtin --p2 idle --replay .local/match.json
npm run batch -- --matches 16 --concurrency 8 --out .local/batches/run
npm run test:live-agent # explicit opt-in; uses existing machine authentication
```

The browser can load a headless replay. `src/headless/batch.ts` provides concurrent
paired evaluation. Map, seed, rules/profile and decision cadence belong in the
experiment's description; comparing unlike conditions is not a strategy gain.

## Timing and feedback

- **Synchronous:** a match waits at decision boundaries for the strategy.
- **Deadline:** a bounded external response window keeps a slow strategy from
  controlling wall-clock progress indefinitely; inspect the adapter's diagnostics.
- **Accelerated:** deterministic policies run without rendering or realtime waits.

Use these existing modes before inventing a training framework. For a player
report, capture the map/seed, tick or replay, relevant commands, asset/code
revision and camera settings. Headless state can establish that a projectile
exists and impacts correctly; a person may still be the fastest judge of whether
its animation looks right. Neither result substitutes for the other.

## Later, when the environment is dependable

Historical co-op scenarios need teams, objectives and a scenario contract before
an account-to-campaign generator. Their asymmetry can be intentional: paired
competitive win-rate symmetry is not the acceptance criterion for a siege.

For strategy discovery, start with a small versioned opponent pool, paired seeds,
held-out seeds and a matchup table. Keep the existing command/replay boundary.
Only then consider counter-strategy generation, program evolution, leagues or
learned policies. [Research choices](research-directions.md) explains the sources.

Not implemented: an evolutionary/search coordinator, tournament-grade capability
sandbox, general snapshot-fork evaluator, tensor/MessagePack observation adapters,
or automatic historical campaign generation. These are possible extensions, not
requirements to build pre-emptively or claims about current isolation.
