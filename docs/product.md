# What we are building

Owner-aligned direction, October 5, 2026. This is a priority contract, not a list
of delivered capabilities; those belong in [status](status.md).

## Play and experimentation are one loop

Faithful human play creates engagement. Engagement creates an interactive
verification loop: the two players spot problems in movement, animation, visuals,
state transitions and gameplay that would be cumbersome for an agent to establish
through screenshots or video. Agents investigate, repair and turn recurring
failures into inexpensive checks. Better play produces better feedback.

Headless simulation, text/protocol observations and metadata validation complement
human judgement. Prefer these when they can establish the outcome faster than
realtime. Use a human for the perceptual or experiential question that remains;
do not ask them to perform a machine-checkable chore. Learn the split together
and revise it as the environment hardens.

The immediate supported deployment is **Ysgramor and Artemis**, used by a
long-distance couple. A working, coherent game on these machines matters more
than general-purpose hosting or speculative platform coverage. Do not make
opening a playable build wait on unrelated infrastructure or exhaustive imports.

## North star

“This week we'd like to play a co-op campaign of the Siege of Vienna. Can you
make it for us?”

Historical battle descriptions and accounts supply objectives, narrative and
participants; survey/geographic data supplies terrain. Agents should eventually
assemble and validate cooperative campaigns and skirmishes from them. Real-world
maps are therefore a central differentiator, not a decorative experiment.

Once the environment is dependable, open-ended agent experimentation and self-play
should discover strategies. The current deterministic headless runner, public
commands, observations and replay records are foundations for that work—not a
claim that campaign generation or open-ended learning is already implemented.

## Scope and fidelity

Long-term, aim toward the supported AoE2 experience. Near-term, choose a strategic
subset that makes the next experience playable. Core controls, legible rendering,
coherent state transitions and reliable shared play deserve priority. A rare
civilisation bug discovered while playing can be welcome exploration; exhaustive
tech-tree parity is not a prerequisite for every session.

Preserve source provenance and distinguish supported, approximate, missing and
unverified behaviour. Explain coverage in terms of what a chosen scenario needs,
not raw test counts or unqualified “civilisation complete” labels. Do not turn
tolerance of rare bugs into hiding known failures or quietly changing assertions.

## Engineering budget

- Target **1–5 minutes** for normal CI/test/build feedback; report measured wall
  time, machine and scope. A sum of parallel task times is not elapsed time.
- Keep one authoritative simulation and public command boundary. Cheap replay,
  privacy and shared-state checks are useful; every additional receipt, audit,
  compatibility layer or full simulation must justify its cost.
- Prefer maintained narrow libraries. Keep offline Python where its DAT/image/GIS
  libraries earn their place; it is not a second gameplay runtime.
- Parallelize independent work within measured CPU/memory budgets. Split a large
  serial workload before assuming more workers will accelerate it.
- Select checks conservatively: uncertain dependencies run the full suite. Main
  and scheduled full runs remain the backstop. Fix stale inputs before interpreting
  their failures as gameplay regressions.
- Preserve useful human feedback as a seed, commands/replay, tick and relevant
  view settings where possible. Build new capture UI only when manual capture is
  demonstrated friction; a feedback framework is not the next campaign.

See [research choices](research-directions.md) for evidence and deliberately
deferred ideas. Choose work by its contribution to this loop, not by how much
infrastructure it creates.
