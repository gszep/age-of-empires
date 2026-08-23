# Reference implementations and evidence hierarchy

This document turns the agreed pipeline into a source policy:

```text
DAT + RMS + AI/XS scripts
        ↓
existing parsers and accumulated open-source knowledge
        ↓
our versioned semantic content model
        ↓
clean simulation implementation
        ↓
focused validation against a legally owned game
```

The objective is behavioral compatibility without treating `AoE2DE_s.exe` as source code. There is no single complete open-source AoE2DE implementation. Reliability comes from triangulating several kinds of evidence and recording provenance per mechanic.

## Evidence ranking

1. **Installed, patch-matched data and official interfaces:** DAT, RMS, AI/XS constants, official modding docs and update notes.
2. **Multiple independent AoE-specific implementations or measurements:** openage plus another engine/tool or reproducible experiment.
3. **One mature AoE-specific implementation:** useful, but label uncorroborated details.
4. **Mature generic RTS implementation or published algorithm:** suitable where AoE behavior is not known or exact compatibility is not strategically material.
5. **Our explicit design choice:** acceptable only when named as such and covered by a compatibility test plan.

Every imported mechanic should record source patch, evidence links, confidence, assumptions, and validation cases. “Industry standard” is not itself evidence that AoE2 uses one particular implementation, especially for pathfinding, formations, collision, targeting, and timing.

## AoE-specific sources

### 1. openage — primary accumulated engine reference

**Repository:** <https://github.com/SFTtech/openage>
**Use for:** Genie format semantics, conversion, event-driven simulation concepts, entity abilities, time curves, movement/pathfinding research, and historical reverse-engineering notes.
**Reliability:** highest breadth among open AoE engine efforts, active, extensively documented. Its replacement simulation is incomplete and is not a cycle-perfect AoE2DE oracle.
**License:** GPLv3-or-later project; do not copy runtime code into this MIT repository.

Important areas:

- `openage/convert/` — source data and asset conversion;
- `doc/reverse_engineering/` — Genie behavior research;
- `doc/code/game_simulation/` and `libopenage/simulation/`;
- `libopenage/event/` — predicted/event-driven changes;
- `libopenage/pathfinding/` — hierarchical cost/integration/flow fields.

Use openage as an external converter and design reference. Calling a GPL converter does not require copying its implementation into our runtime, but its output still contains proprietary AoE content and remains local.

### 2. Siege Engineers tooling — primary transparent data interpretation

- [aoe2techtree](https://github.com/SiegeEngineers/aoe2techtree) (MIT) transparently converts DAT fields into player-facing statistics and includes calculations such as attack delay.
- [GenieTooling attribute reference](https://gokumodder.github.io/aoe2-genie-tooling/units/attributes.html) documents modern unit/projectile fields.
- [rms-check](https://github.com/SiegeEngineers/rms-check) is a mature RMS parser/linter across AoC, UserPatch, HD, and DE, but is GPL-3.0.
- [aoc-reference-data](https://github.com/SiegeEngineers/aoc-reference-data) is useful corroborating data, but no repository license was detected during review; do not copy it into distributed code/data without clarification.

For our TypeScript stack, [Mangudai](https://github.com/mangudai/mangudai) is an MIT-licensed RMS AST/parser candidate. Parsing syntax is only part of the work; execution semantics still need tests against official RMS behavior.

### 3. Installed official scripting surface

The downloaded patch contains:

```text
resources/_common/xs/Constants.xs
resources/_common/xs/xs.txt
resources/_common/ai/*.per
Docs/All/TC Random Map Scripting Guide.doc
Docs/All/* CP Strategy Builder.doc
```

These files and [official AoE modding documentation](https://support.ageofempires.com/hc/en-us/sections/8633386298644-Creating-Mods) expose object attributes, tasks, AI facts/actions, map commands, and some derived engine values. Official update notes are important because scripting functions increasingly expose calculated values such as attack delay.

The scripts reveal policy and available observations/actions, not the hidden implementation of pathfinding or collision.

### 4. Older independent engine implementations

- [freeaoe](https://github.com/sandsmark/freeaoe) (GPL-3.0): direct Genie data use, map/scenario loading, movement, attacks, buildings, AI scripting, and pathfinding. Smaller than openage and easier to inspect, but incomplete and largely inactive.
- [Open Empires](https://github.com/jubalskaggs/openempires) (GPL-3.0): a small C99/SDL2 AoC reverse-engineering experiment. Inactive and minimally adopted; use only as independent corroboration.

Both target older Genie/AoC behavior rather than the current DE patch. Agreement between them and openage is stronger evidence for inherited Genie semantics; disagreement must be resolved by patch-specific validation.

### 5. Combat and data experiments

[aoe2-unit-analyzer](https://github.com/ddk220-light/aoe2-unit-analyzer) extracts current DE data and contains a tick-based battle simulator. It is a useful inventory of modern mechanics and experiment design, not a complete spatial oracle. No repository license was detected during review, so its code must not be copied without permission.

### 6. Game instrumentation and replay evidence

- [aoc-mgz](https://github.com/happyleavesaoc/aoc-mgz) and `mgz-fast` parse recorded settings and command streams.
- [LibreMatch delta-play-replay](https://github.com/librematch/delta-play-replay) explores replay-time state/delta capture through the game's replay gRPC interface. It is AGPL-3.0 and should remain a separate validation tool.
- [AoE2 AI Module](https://github.com/FLWL/aoe2-ai-module) and `pyage2` demonstrate external facts/actions against selected game versions, but hooking is brittle and neither is a complete DE specification.
- CaptureAge is high-quality operational evidence but proprietary, not a reusable implementation.

Prefer replay/scenario-only instrumentation over live hidden-state hooks. It is safer, more reproducible, and less likely to create cheat functionality.

## Generic RTS references

These are production-grade references for well-trodden engineering, not evidence of exact AoE2 behavior.

### OpenRA — determinism, commands, replay, sync diagnostics

**Repository:** <https://github.com/OpenRA/OpenRA>
**Best for:** fixed simulation ticks, deterministic command streams, replay through the same order pipeline, state sync hashes, out-of-sync diagnostics, deterministic A* tie-breaking, shroud/fog.
**License:** GPL-3.0; study concepts, do not copy code into the MIT core.

This is the clearest end-to-end reference for our required invariant: UI, external agents, replays, and networking all submit commands to the same simulation.

### 0 A.D. / Pyrogenesis — formations and obstruction

**Current upstream:** <https://gitea.wildfiregames.com/0ad/0ad>
**Best for:** formation-controller entities, long/short pathfinding, unit motion, obstruction rasterization, range/visibility, data-driven entity components.
**License:** principally GPL-2.0-or-later.

Study the interaction among `Formation`, `UnitAI`, `UnitMotion`, `Pathfinder`, `Obstruction`, and visibility components. Its old GitHub mirror is archived; use the current Gitea source.

### Spring RTS — scale and synced/unsynced boundaries

**Repository:** <https://github.com/spring/spring>
**Best for:** large unit counts, hierarchical movement classes, deterministic synchronized simulation, simulation/render-script separation, LOS/radar sensor systems.
**License:** GPL-family; verify individual files/dependencies.

Spring is mature but large. Use it after OpenRA/0 A.D. when scale or sensor behavior is the specific question.

### Published pathfinding/local-avoidance references

- Elijah Emerson, [“Crowd Pathfinding and Steering Using Flow Field Tiles”](https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter23_Crowd_Pathfinding_and_Steering_Using_Flow_Field_Tiles.pdf): production hierarchical portal routing plus cached cost/integration/flow fields from *Supreme Commander 2*.
- Frank Cheng, [“Pathing in Age of Empires IV”](https://www.gdcvault.com/play/1028036/): hierarchical A*, flow fields, formations, and steering in a modern Age title. This is AoE IV evidence, not AoE2 evidence.
- Raymi Klingers, **“Age of Empires: 25+ Years of Pathfinding Problems with C++”** (Meeting C++ 2025): first-party historical context on Age obstruction, fixed point, formations, regressions, and testing. Treat it as architectural evidence unless a statement explicitly identifies an AoE2DE behavior.
- [RVO2](https://github.com/snape/RVO2) (Apache-2.0): official ORCA reciprocal collision-avoidance implementation. It is permissively licensed and reliable, but ORCA may produce movement that feels unlike AoE2. Use only behind an explicit movement profile and validate strategic consequences.

For AoE-sized groups, start with deterministic grid A* plus simple stable local separation. Add hierarchical/flow-field routing only when profiling or group behavior requires it. A sophisticated standard algorithm that produces the wrong congestion, walling, or surround behavior is worse than a simple, testable approximation.

## Recommended references by subsystem

| Subsystem | Primary evidence | Secondary implementation reference | Validation |
|---|---|---|---|
| Costs, stats, armor, techs | patch-matched DAT | openage converter; aoe2techtree | official UI/XS queries and focused scenarios |
| Animation/attack timing | DAT graphic/task fields; official scripting values | aoe2techtree; openage docs | frame-by-frame scenario recordings |
| Economy/task loops | DAT tasks; AI/XS interfaces | openage activities; freeaoe | fixed-map gather/build/production timing tests |
| Combat formulas | DAT attack/armor classes and effects | openage research; unit-analyzer experiments | controlled one-hit and sustained-combat scenarios |
| Projectiles | DAT projectile/task fields | openage research | static/moving target grids across seeds |
| RMS maps | official RMS guide and scripts | Mangudai/rms-check | map statistics and fixed-seed snapshots |
| AI strategy compatibility | installed `.per` scripts and official AI docs | AI Module/pyage2 as historical API references | scripted scenario facts/actions |
| Commands/replays | `.aoe2record` command stream | aoc-mgz; OpenRA architecture | native/WASM replay checksums |
| Determinism | our explicit contract | OpenRA; Spring | cross-runtime golden hashes |
| Navigation | focused AoE2DE tests and first-party talks | openage; 0 A.D.; published flow fields | path suites, congestion, wall gaps, regrouping |
| Collision/formations | focused AoE2DE tests | 0 A.D.; openage; RVO2 only as optional profile | chokepoint, surround, crossing-army scenarios |
| Fog/visibility | DAT LOS plus official behavior | OpenRA shroud; 0 A.D. range manager | reveal/retain/target scenario matrix |

## Clean implementation policy

Because this repository is MIT-licensed while most engine references are GPL:

1. Do not paste or mechanically translate GPL/AGPL source.
2. Write behavioral specifications and tests before implementation.
3. Cite the observation, document, data field, or algorithm paper used.
4. Implement from the specification in our own structure and terminology.
5. Keep GPL converters/validators as separate developer tools rather than linked runtime dependencies.
6. Never commit proprietary original or converted AoE assets/data.
7. Record the exact Steam depot manifests used for every compatibility profile.

Current downloaded manifests:

```text
813781: 3067258457468070797  # core content / DAT / scripts
813782: 3503932408267359574  # art resources
813784: 8087696953400240386  # game resources / SLD graphics
```

## Practical conclusion

The strongest combination is:

- **AoE semantics:** installed DAT/RMS/AI/XS plus openage and Siege Engineers tooling;
- **simulation architecture:** OpenRA's deterministic command/replay discipline;
- **movement/formations:** focused AoE2 measurements informed by openage and 0 A.D.;
- **scale:** Spring and published flow-field work only when necessary;
- **truth test:** controlled scenarios and replay/state traces from the owned, manifest-pinned game.

This avoids guessing most numerical and data-driven behavior. For emergent systems such as pathfinding and collision, it replaces guessing with an explicit evidence-and-validation process rather than pretending that one generic RTS algorithm is automatically AoE2-compatible.
