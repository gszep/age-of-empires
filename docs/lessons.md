# Lessons

Operational knowledge distilled from working sessions. Read this before starting
work; append new lessons at the end of a session. Each entry is one hard-won
fact plus the rule it implies. Delete entries that stop being true — git history
keeps the record.

## Rendering and assets

- **Mask atlases must be neutral white.** The renderer multiplies
  `material.color` through the texture, so a mask sheet packed as black RGB
  renders every player colour as black. This failed *silently* — nothing
  errored, the art just looked wrong. Rule: any convention that can fail
  silently gets a guard test the moment it is discovered
  (`test_import_aoe2.py` now asserts mask sheets carry no colour).
- **Verify sampling before blaming assets.** A "low-res grass" report led to a
  deep investigation that ended by SHA-256-proving the imported texture was
  identical to the installed game's. The actual causes were `anisotropy = 1`
  and `NearestFilter`. Rule: when imported art looks wrong, check filtering,
  mipmaps, and colour pipeline first; hash-compare the source only afterwards.
- **The DAT usually already knows.** The arrow launch height lived in
  `graphic_displacement`, the felled-tree art was the `dying` graphic, farm
  ground is terrain slots 7/29. Rule: before approximating any visual or
  timing, search the DAT and widgetui data first (see the field cheat-sheet in
  `AGENTS.md`); approximations are a last resort and get recorded in
  `docs/status.md`.
- **Player colour is a palette block, not a tint.** The SLD player-colour layer
  is *coverage* — its interior is a solid 255 and only the BC4 block edges hold
  intermediate values — while the shading lives in the main layer, which paints
  those pixels in greys. The ramp that grey indexes is the game palette's
  8-shade block at the DAT's own `player_colours[i].player_color_base`
  (`original.pal` 16..23 is the classic blue), *not* the 16x16 blends in
  `playercolor_*.pal`, which are DE's editable hue-to-target table. Rule: a
  layer's meaning is a measurement, not a name — histogram it before deciding
  what it encodes.
- **An exact walk is the proof a format was read right.** The SLD outline
  layer looked like a filled silhouette full of block-shaped holes until the
  invariant was checked: every block row's commands must cover exactly its
  blocks and consume exactly its bytes. They did — on all 78 consumed sources
  — which meant the reading was right and the "holes" were the sprite's
  interior. It is a contour, not a silhouette. Rule: verify a decode against
  an invariant the format itself enforces before trusting (or doubting) what
  the pixels look like.
- **The debug pixel readback was lying, darkly.** Captures render into an
  offscreen `RenderTarget`, which is linear by default, so the output transfer
  the canvas applies was skipped and every colour came back as its linear
  counterpart — grass reading `#384808` when the screen showed `#788838`. That
  is a ~2.2 gamma of error in exactly the tool used to check colour work. Rule:
  when a measured colour is off by roughly a power, suspect the measurement's
  colour space before the art; the render target now takes
  `renderer.outputColorSpace`.
- **WebGPU does not render in Node.** The viewer uses `THREE.WebGPURenderer`;
  there is no plain-Node headless render path. Headless Chrome with SwiftShader
  does run the full game (slowly, ~4 fps) and is how automated visual checks
  work — see the debug protocol in `AGENTS.md`.

## Simulation and data import

- **Don't guess genieutils attribute names.** Nine `AttributeError` iterations
  were spent probing the DAT schema. Rule: consult the cheat-sheet in
  `AGENTS.md`, and when a field is missing from it, `dir()` the object once and
  extend the cheat-sheet instead of trial-and-erroring.
- **All SLD decoding is local.** `tools/sld_layers.py` handles every layer
  (verified byte-identical to the openage decoder it replaced, which corrupted
  the heap on masks and crashed on the stable); extend it rather than adding a
  decoder dependency.
- **A DAT unit's internal name is a lie; its graphic file name is not.** Unit
  74 is called SPRMN and is the militia. Unit 7 is called XBOWM and draws
  `u_arc_skirmisher_*` — it is the skirmisher, while unit 24 (CARCH) draws
  `u_arc_crossbowman_*`. The names are AoK leftovers that never moved with the
  ids. Rule: identify a DAT unit by `dat.graphics[...].file_name` and its
  numbers (cost, hit points, train time), never by `unit.name`.
- **Distrust "always" in reverse-engineered specs.** The SLD header field
  documented as "unknown, always 0x10" is really the frame-data start offset,
  and layer padding aligns to it — the stable uses 14 and crashed every
  decoder that hardcoded 16. When a file breaks a format assumption, treat the
  file as the specification: a clean walk that ends exactly at the last byte
  is the proof.

- **Composite the sprite offline before mapping frames to meaning.** The
  palisade's five deltas carry no labels; guessing a connection table produced
  a fence that looked like separate stake bundles. Rendering each frame as a
  run along each axis answered it in one picture — the frame that tiles
  seamlessly *is* that axis's run. Rule: when art has to be indexed by game
  state, prove the index by drawing the arrangement, not by reading numbers.

## Process

- **Complete one playable behaviour end to end** (from the working style
  rules) is easy to violate on broad autonomous runs: the tech-tree run
  shipped a market that trains nothing. Rule: for every production building
  added, the unit it trains ships in the same change, or the gap is recorded
  in `docs/backlog.md` before the run ends.
- **Autonomous runs need acceptance criteria.** "Build out more of the tech
  tree" produced good work and silent gaps. Rule: turn broad mandates into a
  checklist first, verify each item against the checklist before finishing,
  and report unmet items explicitly.
- **Never rebase published commits.** A worktree rebase quietly rewrote an
  already-pushed commit; it was caught and repaired by replaying commits.
  Rule: integrate worktree branches with merge or by cherry-picking onto the
  pushed tip, and check `git log origin/main..` before any history edit.
- **Precise observational bug reports are gold.** "Black colouring on the mill
  and the barracks" pinpointed a multiply-through bug immediately. When
  reporting or relaying visual defects, name the entity, the state, and the
  colour seen — and prefer the debug protocol's numbers over adjectives.
