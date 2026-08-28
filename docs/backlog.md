# Backlog

Known gaps, ordered roughly by player impact. The curated, ordered work
queue for autonomous runs — with per-item verification steps — is
`overnight.md`; this file is the fuller inventory. Each entry names the evidence and
the likely fix path so a fresh session can pick it up without re-deriving it.
When a session finishes or abandons an item, update it here; completed items
are deleted, not ticked.

## Audio

Unit selection and training voices and the ten feedback cues are wired (see
status.md). Remaining coverage: combat sounds (each attack graphic has its own
DAT sound id), building construction and completion, and the ambient loops
terrain slots name in `wwise_sound_id`. `sounds.json` names no
construction-complete cue, so that one has no owned source to draw on.

- **The under-attack alert's rearm window is approximated.** The per-target
  memory is in (a fight that goes on is one alert; something else being hit
  meanwhile is its own), but how long a thing must be left alone before being
  hit again is news is not in the owned files — `sounds.json` names the cue and
  not its rearm — so ten seconds stands as an approximation.
- **In-game music is missing.** Only voices and feedback cues play. Find the
  music tracks in the owned audio depot (Wwise music events / ambient
  containers) and wire a playlist; if the events are not resolvable through
  the owned metadata, record that here instead of approximating.

## Rendering

- **Terrain blends/masks** are not consumed; terrain-to-terrain transitions
  are absent (single-terrain maps hide this today). The blocker is a mapping,
  not the pipeline: nothing in the owned files says which `terrain/blends/`
  file a terrain's `blend_type` selects, nor how a 512x512 blend is indexed
  against a tile. See the note in `overnight.md` for what was measured.
- **Fire delta overlays** on damaged buildings are not imported.
- **The monk draws no occlusion contour.** Its idle and attack outline layers
  are the only consumed sources that fail `tools/sld_layers.py`'s walk
  invariant (`outline row 13: covered 0 of 7 blocks, consumed 11 of 11 bytes`,
  and an empty buffer on attack), so both are in the manifest's `skippedMasks`
  and a monk behind a building simply has no contour. The invariant is the
  decoder working as intended; what these two layers encode differently has not
  been measured.
- **A corpse re-seen through fog replays its death.** Playtest report, now
  half fixed: the decay *stage* is right, because it is derived from the food
  left rather than from a clock, and the remaining food is right too. What
  survives is the death animation playing again, because `view.diedAt` is
  stamped when the view is created and a corpse coming back out of fog gets a
  new view. Wants the death's age carried on the entity or the view keyed
  through the gap.
- **Building rubble is one spec line away, and would not show.** Every
  building's `dead_unit_id` names its rubble art (`b_*_rubble_x1`), which the
  importer's `dead` slot already knows how to reach — but a building's death
  graphic runs 8.3 s while `kill()` gives every corpse a 3 s window, so the
  building vanishes mid-collapse and the rubble would never draw. Adding the
  spec line means making the corpse window follow the death animation's length
  first, which is a simulation change (and a checksum change).

## Water

Not started, and deliberately: it changes the board rather than adding to it.
`docs/water-design.md` is the scope — the DAT's water terrain slots, the
terrain-restriction rows that decide who floats and who wades, and the dock
(unit 45), fishing ship (unit 13) and fish, staged as W1–W5. The one open
question is the shore seam, which is the blend-mask mapping that also blocks
terrain blends above.

## Civilisations

- **Only the Britons exist, and only their tree.** The importer reads one
  civilisation's units and one civilisation's tech tree; a second would be a
  data addition (another `CivTechTrees/*.json` and another `civIndex`) rather
  than a refactor, but nothing selects between them yet and the match config's
  civilisation field has one legal value.
- **Civilisation bonuses are not implemented.** The Britons' foot archers get
  no extra range, their shepherds work at the ordinary rate, their town centers
  cost full wood from the Castle Age, and Yeomen is not free. These live in the
  DAT as civ-specific effect commands rather than in the tech tree, and were
  deliberately left out of the tech-tree work.
- **The HUD does not say who you are playing.** The civilisation is in the
  observation and the match record but no panel shows it.

## Simulation

- **The example AI closes out a game only because matches end early.** The
  batch is decisive again — 16 of 16, 0 timeouts — but that was bought by
  fixing the opening's housing stall, not by teaching the strategy to finish:
  every match is settled in the Feudal Age, and none of the 32 player-slots
  reaches the Castle Age. When both economies did survive into a long game, four
  of sixteen ran out the thirty-minute clock, because neither side can finish
  an opponent as rich as itself — the army marches at the enemy town center,
  grinds against its garrison, and reinforcements arrive one at a time, while
  the endgame raze only sends villagers in once the enemy field is completely
  clear. That failure is dormant rather than fixed, and it will resurface the
  moment the strategy is made to last longer. The trade-off curve between
  economy and decisiveness is recorded in `status.md`.
- **The AI eats sheep, and it does not help.** It claims and works them now
  (six claimed within eight minutes, verified), but its food income is
  unchanged: 159 food in the first four minutes with the herd and 159 without,
  383 against 385 at eight minutes. On this map the berries are nearer than
  the sheep (7.5 tiles against 9.5) and both yield food at the same rate, so
  there is nothing to gain — in AoE2 the gain comes from walking a sheep home
  and eating it under the town center with no return trip, and herdables no
  longer follow anybody here (see below). The queue's N2 verification asked
  for measurably higher early food income and it is not met; this is why.
- **The open fallback stops at the Castle Age.** The hand-written rules in
  `src/sim/data.ts` name only `feudal-age` and `castle-age`, so a player
  without the owned files gets neither the Imperial Age nor any of the
  sixty-six imported technologies — the fallback's tech list is three entries
  long. The Imperial tests in `castle-age.test.ts` `skipIf` the manifest is
  absent for this reason. Whether the fallback should grow a third age or
  stay a Dark-through-Castle demonstration has not been decided.
- **The AI will not touch a boar.** Deliberate: seventy-five hit points and
  seven damage a hit, and AoE2's answer is to lure it home with one villager
  while the rest wait. Ordering two villagers onto one loses both.

- **Trade is unverifiable in normal play.** The cart's loop is proven by
  tests, but a human cannot check it: trading needs a foreign market and the
  built-in AI never builds one. It reaches the Feudal Age now, so the market is
  within its reach — it puts up only camps, houses, a barracks and an archery
  range. Teaching it the market, or an allied player slot, is what makes trade
  observable in a real match.
- **Ageing up changes how a building looks but not how tough it is.** The
  DAT's age technologies replace each building with the next age's unit, and
  those units carry more hit points as well as different art: a barracks goes
  1200 -> 1500 in the Feudal Age, a house 550 -> 750, a mill 600 -> 800. The
  art is imported and drawn (issue #13); the hit points are not applied,
  because doing so is a simulation change and belongs with the technology
  effects rather than with the renderer. Each age's variant also has its own
  rubble unit (`Barracks Age2 (Rubble)` and friends), so a razed Feudal
  barracks still leaves the Dark Age rubble.
- **The naval and scorpion upgrade lines are absent.** Every land unit
  upgrade the Britons have is researchable; what is left is the dock's ships
  and the scorpion, which are units this slice does not have at all rather
  than upgrades it is missing. They arrive with the units, not before them.
- **The built-in AI's wish list is three technologies long.** Loom, the
  man-at-arms and the crossbowman — the ones whose building it actually puts
  up. Sixty-six are researchable; it buys three, in a fixed order, with
  whatever the next age is not waiting for. A strategy that chose among them
  by what it is fighting would be a real improvement, and so would building a
  blacksmith at all: the armour and attack lines are the best value in the
  tree and it never sees them.
- **Some technologies apply only part of what they say.** Where an effect
  command names an attribute this game does not model, the technology is still
  imported and the attribute is recorded in its `unmodelled` list rather than
  dropped. Today that is attribute 23 (search radius) on eight technologies —
  Fletching, Bodkin Arrow, Bracer, Block Printing, Chemistry, Siege Engineers,
  Yeomen and the Castle and Imperial Ages — attribute 130 on four (Bodkin
  Arrow, Bracer, Chemistry, Fletching), and attributes 48 and 49 on the
  Imperial Age alone. Forty-eight further nodes are left out entirely, each
  with its own reason, in the manifest's `skippedTechnologies`.
- **Technology prerequisites are the DAT's own list, not its count.** The DAT
  states a `required_tech_count` alongside the requirements — Hand Cart needs
  two of three — and the importer instead requires every listed technology that
  this game also offers. That happens to be exactly right for all fifteen
  chains the Britons have, because the extra entries are always the age
  technology or a bookkeeping node, but it is not the general rule.
- **A monk carries no relic, and a monastery holds none.** Relics are named in
  the omitted scope; a monk that could pick one up would need the relic entity,
  the carry state, and the gold trickle.
- **A castle trains only the British longbowman.** The importer reads civ 1, so
  the castle's other trainable units (trebuchet — Imperial — and petard) and
  every other civilisation's unique unit are absent.
- **Hunting pays the forager's wage.** The DAT gives the hunter villager its
  own work rate (0.41 a second) and carry capacity (35); the simulation has one
  rate per resource and one global capacity, so hunting banks at the forager's
  0.31 into 10. Per-task rates would need `gatherRatePerSecond` to become
  per-variant, which touches every gatherer.
- **The built-in AI stops at the Feudal Age.** It researches now — Loom in all
  32 player-slots of the paired batch, the Feudal Age in 28 — but the Castle
  Age in none, because matches decide before the food is banked. Everything
  Castle and above (the monastery, the siege workshop, the castle, the
  university, and every unit they train) is therefore unreachable in a played
  match even though the simulation offers it. Whether that wants a richer
  strategy or a longer clock has not been decided.
- **A gate does not shut itself.** AoE2 closes a gate when an enemy is in it,
  which is what stops an attacker walking in behind a retreating villager. Here
  the art opens for the owner's units and passability is decided per player, so
  an enemy is stopped by the closed gate at all times and never squeezes
  through — but the two rules are not the same rule, and making them one means
  giving the simulation a gate state the checksum can see.
- **The example AI's repertoire is still short.** All 16 of the paired batch
  decide; it scouts, sites lumber camps, mining camps and mills against the
  resources it finds, holds the barracks until the wood is banked nearby, works
  sheep, ages up and buys three technologies. Beyond that it gathers, houses
  and attacks in threes, and that is the whole of it — no blacksmith, no
  market, no stable, and no choice among the sixty-six technologies it could
  research.
- **The middle of the map is empty.** Player openings come from
  `land_resources.inc`; the neutral forests, relics and contested resources the
  scripts put between the players do not, so a 120x120 board is two furnished
  corners and a lot of grass.
- **Forest clumps have ragged interiors.** A wood is grown outward from a seed
  one free tile at a time, which gives an organic edge and leaves holes: 19 of
  63 interior tiles were open in the wood measured on seed 7. No straight route
  crosses a clump and the pathfinder goes round, but a determined unit could
  thread a diagonal gap in some of them. Filling the interior would fix it and
  would also make the shapes read as blobs rather than woods; nobody has
  decided which matters more.
- **Herdables no longer walk home behind a scout.** A claimed sheep stops where
  it stands and is ordered about by hand, which is what makes it controllable
  at all (the simulation used to overwrite its order four times a second). The
  original's herding — sheep trailing the unit that converted them, so you walk
  them home with the scout — is gone with it. The middle ground, if it is
  wanted, is following only until the first order.
- **The example AI's camp siting is one node deep.** It builds a camp between
  home and the nearest known node of a resource, one per resource until the
  barracks is up and three thereafter, and never re-sites one whose wood has
  been cut out from under it. It is enough to keep an economy running and no
  more; two of the sixteen batch seeds have turned on it so far.

## Interface

- **Game speed does not survive a reload.** `+` and `-` step the original's
  four settings plus two fast-forward steps, and it resets to Normal on refresh,
  because the speed is a view preference and the saved session holds game state.
  Persisting it means deciding where a view preference lives. There is also no
  options screen to set it from — the reference has a Game Speed dropdown on
  both the options screen and the lobby (`GameSpeedDropdown`,
  `GameSpeedDropDown`), and neither exists here.

## Debug tooling

- **The protocol now answers geometry as well as state.** `entities` reports
  `amount`/`resourceKind`, the `frame` actually drawn, and a `shape` tag for
  walls and gates (`run-x`, `run-y`, `joint`, `post`, `gate-x`, `gate-y`);
  `sim` reports `selected` and `flashTarget`. Those settled the carcass decay
  question, the order-flash rule and the palisade orientation without a
  screenshot. Keep screenshots for what genuinely needs looking at — the
  palisade's frame-to-meaning mapping did, and compositing the arrangement
  offline was what settled it. Grow the protocol whenever a screenshot loop
  repeats.
