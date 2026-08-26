# Backlog

Known gaps, ordered roughly by player impact. The curated, ordered work
queue for autonomous runs — with per-item verification steps — is
`overnight.md`; this file is the fuller inventory. Each entry names the evidence and
the likely fix path so a fresh session can pick it up without re-deriving it.
When a session finishes or abandons an item, update it here; completed items
are deleted, not ticked.

## Tech tree completeness

The overnight tech-tree run added buildings faster than the units they train:

- **Market trains nothing** — no trade cart. Audit every production building:
  each must train the units the DAT assigns it, or be recorded here.
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

- **Rally-point flags** are absent; rally points work but give no visual.
- **Terrain blends/masks** are not consumed; terrain-to-terrain transitions
  are absent (single-terrain maps hide this today).
- **Fire/corpse delta overlays** on damaged/destroyed buildings are not
  imported.

## Simulation

- **Mirror-AI stalemates**: some built-in-vs-built-in matches stall to the
  timeout; the example AI never breaks a defensive equilibrium.
