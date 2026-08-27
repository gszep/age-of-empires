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

- **Hunting pays the forager's wage.** The DAT gives the hunter villager its
  own work rate (0.41 a second) and carry capacity (35); the simulation has one
  rate per resource and one global capacity, so hunting banks at the forager's
  0.31 into 10. Per-task rates would need `gatherRatePerSecond` to become
  per-variant, which touches every gatherer.
- **The built-in AI never leaves the Dark Age.** It has no notion of research,
  so it never takes Loom or the Feudal Age, and everything Feudal — the market,
  the archery range, the stable, and every unit they train — is out of its
  reach. Its matches are Dark Age militia wars.
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
  stalemates — all 16 of the paired batch decide — but it gathers, houses,
  builds a barracks and attacks in threes, and that is the whole repertoire.
