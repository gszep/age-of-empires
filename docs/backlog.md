# Backlog

Known gaps, ordered roughly by player impact. The curated, ordered work
queue for autonomous runs — with per-item verification steps — is
`overnight.md`; this file is the fuller inventory. Each entry names the evidence and
the likely fix path so a fresh session can pick it up without re-deriving it.
When a session finishes or abandons an item, update it here; completed items
are deleted, not ticked.

## Tech tree completeness

The overnight tech-tree run added buildings faster than the units they train:

- **Stable is not imported** — the local decoder now reads its SLD (the
  crash that excluded it is fixed, see status.md), so what remains is
  content work: spec entries plus sim rules for the stable and the scout
  cavalry it trains.

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

- **A unit ordered somewhere unreachable walks on the spot.** `findPath`
  answers a blocked goal with `nearestFreeTile`, which can land inside a pocket
  the walker cannot reach — a market placed at (19, 9) on the default map seals
  one — and `moveAlong` then reports "arrived" every tick. `updateTrader` now
  ends the order when that happens, but `updateGatherer`, `updateBuilder` and
  `updateAttacker` still ignore the same signal, so a villager sent to a walled
  resource freezes in `moving` for good. The fix is either a reachable-tile
  search in `nav.ts` or handling the give-up return at every call site.
- **Mirror-AI stalemates**: some built-in-vs-built-in matches stall to the
  timeout; the example AI never breaks a defensive equilibrium.
