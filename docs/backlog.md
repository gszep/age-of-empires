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

- **The under-attack alert nags during a sustained attack.** Playtest report:
  while a building is being attacked, the alert cue fires again every few
  seconds. It should announce a *newly* attacked target and then hold its
  tongue for a non-irritating interval; check what interval the reference
  uses and whether the cue watcher's rearm window resets on every hit rather
  than per target.
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
- **A spent forage bush shows a tree stump.** Playtest report: exhausted
  bushes briefly draw the generic stump before vanishing. The `dead` import
  slot routes bushes through `n_tree_stump_generic_x1`; verify against the
  bush's own `dead_unit_id` and the reference (a depleted bush should leave
  nothing), and stop sharing the tree's decay art if the DAT does not
  actually assign it.
- **A corpse re-seen through fog looks freshly killed.** Playtest report: a
  hunted animal's carcass left in fog and revisited restarts as if just
  killed. The last-seen memory (or the renderer's decay clock) is not
  carrying the corpse's age; re-sighting should show the current decay state
  and remaining food, not replay the death.
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

## Simulation

- **Carcasses cannot be selected.** Playtest report: there is no way to click
  a hunted animal's carcass to see how much food remains on it. It carries
  sim state a player is entitled to inspect; make it selectable with the
  remaining-resource readout the HUD already shows for bushes and trees.
- **Trade is unverifiable in normal play.** The cart's loop is proven by
  tests, but a human cannot check it: trading needs a foreign market and the
  built-in AI never builds one (it never leaves the Dark Age, below). Fixing
  the AI's Feudal gap, or an allied player slot, is what makes trade
  observable in a real match.
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

- **Game speed does not survive a reload.** `+` and `-` set 1x to 10x and it
  resets to 1x on refresh, because the speed is a view preference and the saved
  session holds game state. Persisting it means deciding where a view
  preference lives.

## Debug tooling

- **Geometric questions still need eyes; orientation metadata could answer
  them in text.** Which way a wall segment joins, which axis a gate lies
  along, whether a frame is the intended variant — today these are settled by
  screenshots, the slowest loop we have. The alternative: have the renderer
  report an orientation/variant tag per placed sprite (the delta or frame
  index it chose and the axis it believes it is on) through the entities
  debug query, so the palisade-gate class of question is answered by reading
  a field instead of a picture. Keep screenshots for what genuinely needs
  looking at; grow the protocol whenever a screenshot loop repeats.
