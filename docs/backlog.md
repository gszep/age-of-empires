# Backlog

Known gaps, ordered roughly by player impact. The curated, ordered work
queue for autonomous runs — with per-item verification steps — is
`overnight.md`; this file is the fuller inventory. Each entry names the evidence and
the likely fix path so a fresh session can pick it up without re-deriving it.
When a session finishes or abandons an item, update it here; completed items
are deleted, not ticked.

## Audio

Only the `button_ui` click cue is wired. The Wwise pipeline
(`import_audio.py` + `vgmstream-cli`) is proven; remaining work is coverage:
unit selection/acknowledgement voices, training/construction cues, combat
sounds, and under-attack alerts, each resolved through `sounds.json` events.

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
- **Mirror-AI stalemates**: some built-in-vs-built-in matches stall to the
  timeout; the example AI never breaks a defensive equilibrium.
