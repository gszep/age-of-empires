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

- **The under-attack alert nags, and is deaf while it nags.** Playtest report:
  while a building is being attacked, the alert fires again every few seconds.
  The cause is not a rearm window resetting per hit — `cues.ts` writes
  `alertedAt` only when the cue actually fires — it is that the ten-second
  throttle is a single global timer rather than one per newly attacked target.
  So a sustained attack re-announces itself every ten seconds, and a *second*
  building attacked inside that window is not announced at all, which is the
  worse half. Wants a per-target memory, and the reference's own interval.
- **In-game music is missing.** Only voices and feedback cues play. Find the
  music tracks in the owned audio depot (Wwise music events / ambient
  containers) and wire a playlist; if the events are not resolvable through
  the owned metadata, record that here instead of approximating.

## Rendering

- **The minimap still uses hand-picked player colours.** `src/view/minimap.ts`
  reads `PLAYER_COLORS`, the open-content fallback, while the manifest now
  carries the DAT's own `minimapColor` per player. The minimap has no
  `ContentAssets` handle; plumbing one through is the whole job.

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

- **Trade is unverifiable in normal play.** The cart's loop is proven by
  tests, but a human cannot check it: trading needs a foreign market and the
  built-in AI never builds one (it never leaves the Dark Age, below). Fixing
  the AI's Feudal gap, or an allied player slot, is what makes trade
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
- **No unit upgrade or economic technology is researchable.** Loom, the Feudal
  Age and the Castle Age are; the blacksmith's armour and attack lines, the
  university, the monastery's own technologies, and every unit upgrade
  (man-at-arms, crossbowman, pikeman, light cavalry, elite skirmisher) are not.
  The tech system reads cost, time, building and effect from the DAT already —
  the work is breadth, plus upgrades needing a rule that replaces one unit kind
  with another rather than adding flat modifiers the way Loom does.
- **The university and the Imperial Age are not built.** The university is a
  Castle Age building that trains nothing, so it was left out until there are
  technologies for it to research; the Imperial Age (tech 103) and everything
  above the Castle Age is out of scope for now.
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
- **The built-in AI never leaves the Dark Age.** It has no notion of research,
  so it never takes Loom, the Feudal Age or the Castle Age, and everything above
  the Dark Age — the market, the archery range, the stable, the monastery, the
  siege workshop, the castle, and every unit they train — is out of its reach.
  Its matches are Dark Age militia wars. This is now the single biggest gap
  between what the simulation supports and what a played match shows.
- **Technology icons are not imported.** `import_ui.py` takes Buildings, Units,
  StatIcons and MenuIcons; research buttons therefore show text only.
- **The built-in AI ignores sheep, deer and boar.** It picks gather targets by
  `kind === 'resource'`, which animals are not, so the whole Dark Age food
  opening is invisible to it. Its matches still run on berries and farms.
- **A gate does not shut itself.** AoE2 closes a gate when an enemy is in it,
  which is what stops an attacker walking in behind a retreating villager. Here
  the art opens for the owner's units and passability is decided per player, so
  an enemy is stopped by the closed gate at all times and never squeezes
  through — but the two rules are not the same rule, and making them one means
  giving the simulation a gate state the checksum can see.
- **The example AI is a Dark Age militia rush and nothing else.** It no longer
  stalemates — all 16 of the paired batch decide — and it now scouts, sites
  lumber camps, mining camps and mills against the resources it finds, and
  holds the barracks until the wood is banked nearby. Beyond that it gathers,
  houses and attacks in threes, and that is the whole repertoire.
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
