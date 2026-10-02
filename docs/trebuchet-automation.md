# Trebuchet automation (#131)

## Playable behavior

- Right-click an enemy with a packed trebuchet: it approaches to firing range,
  spends the resolved setup time, then fires. An already deployed engine packs
  and approaches when its explicitly ordered target is beyond range.
- Idle trebuchets automatically select a visible enemy building inside both
  their search/sight bound and their deployed firing envelope. They unpack if
  necessary and fire without moving. Automatic targets inside minimum range,
  outside range, lost from sight, destroyed or converted are released. A later
  acquisition can select another eligible building.
- Move orders take priority over automatic acquisition. A move cancels an
  unfinished unpack, or finishes packing an already deployed engine before
  travel. Repeated move/pack requests preserve a running pack clock.
- Manual Pack clears queued work and holds the engine packed until another
  player command. Group Pack/Unpack continues to apply to every selected engine.
- The optional automatic-order marker, setup countdown and manual-pack hold are
  authoritative entity fields retained by JSON snapshots and checksums.

## Source and inference boundary

The bundled **AoK Manual, printed p81 / physical page84**, explicitly says that
right-clicking an enemy with a packed trebuchet moves it into range, unpacks it
and starts attacking. Owned help26381 requires packing to move and unpacking to
attack, with a minimum range. This replaces the previous packed right-click
behavior, which classified an enemy as a plain move destination.

Pinned DAT331/42 supplies the existing imported ranges16/4, LOS19,
search radius18, work rate4.5, projectile371 and attack/reload/graphic clocks.
331's task109 has `auto_search_targets=1`, `search_wait_time=3` and no target
unit;42's attack and pack tasks also have automatic search enabled. These fields
support automatic transformation/search but do not establish the exact runtime
meaning of its wait or target selection. Japanese Kataparuto uses the existing
resolved work-rate modifier, including for automatic setup.

**Inferred integration:** idle building-only acquisition, nearest-target/id
tie-break, existing10-tick acquisition cadence, existing circular target/radius
range tolerances, no automatic pursuit, completion of setup if its target
disappears midway, immediate cancellation of unfinished unpack on a move, and
manual Pack holding until the next command. The packed/unpacked unit pairing
remains explicitly named331↔42. Native stance, retarget, interruption and task
wait semantics remain calibration under#131/#259. There is no new native-DE
runtime capture or claim of exact modern engine parity.

## Example-AI finishing policy

`ai-siege.ts` reads only the public observation. Promisory `finaling.per`81–88
trains trebuchets with at least10 military units and enemy buildings, using a
four-engine lower quota and twelve-engine upper quota. `units.per`12145–12164
selects completed idle castles and trains through the engine's permission check.
The example adapts the lower quota:

- Castle Age or later,10 known own infantry/archer-line soldiers, and a known
  enemy building enable castle preparation. Upgraded infantry/archers still count.
- Up to two existing non-food workers gather the missing stone for one castle;
  ordinary wood/gold assignments resume once it exists. Paid unstaffed castle
  foundations receive replacement builders using the existing recovery policy.
- Imperial Age reserves200wood/200gold and a population slot for trebuchet
  production, counting active castle training toward a four-engine limit.
- Idle engines target visible buildings first, then known building memories by
  distance/id. Memory produces a coordinate move; a subsequently visible target
  receives a public attack order. Existing attack orders are left alone.
- An `ExampleAiOptions.siege=false` control disables this policy. Archer
  production also follows completed Crossbowman/Arbalester upgrades.

The650-stone castle budget and200wood/200gold engine budget are conservative
owned baseline prices. The simulator charges the selected civilisation's actual
price. Worker selection, resource reservations, reuse of existing candidate
building sites, memory priority and integrating the script's quota into this
smaller strategy are **chosen policies**, not a translation of the whole AI.
Natural-start progression and siege balance remain part of#124.

## Verification

- `npx vitest run src/sim/trebuchet.test.ts src/sim/ai-siege.test.ts`:
 21deployment/control/replay outcomes and5AI outcomes. Open and owned scenarios
 verify actual damage, not just a rule-table value.
- The late-game AI fixture supplies Imperial Age, an army, housing and640stone;
 gathering the balance, construction, training, approach and bombardment use
 ordinary public commands and unchanged clocks. Two enemy TCs preserve the
 current last-TC defeat precondition; an outpost explicitly reveals the targets.
 This is not a natural-Dark-Age-start AI performance claim.
- `npx tsx tools/trebuchet_smoke.mts` and
 `OPEN_FALLBACK=1 npx tsx tools/trebuchet_smoke.mts` exercise actual Stop, paid
 train, right-click attack/move and group Pack/Unpack UI. Owned runs check the
 original packed/deployed sprite bindings; open runs check the rendered fallback.
- Registered feature scenario: `trebuchet-automation` in `tools/acceptance.json`.
 Current checkpoint results and logs are in [handoff](handoff.md).
