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
- **WebGPU does not render in Node.** The viewer uses `THREE.WebGPURenderer`;
  there is no plain-Node headless render path. Headless Chrome with SwiftShader
  does run the full game (slowly, ~4 fps) and is how automated visual checks
  work — see the debug protocol in `AGENTS.md`.

## Simulation and data import

- **Don't guess genieutils attribute names.** Nine `AttributeError` iterations
  were spent probing the DAT schema. Rule: consult the cheat-sheet in
  `AGENTS.md`, and when a field is missing from it, `dir()` the object once and
  extend the cheat-sheet instead of trial-and-erroring.
- **The pinned openage decoder is unsound on this data.** It corrupts the heap
  on BC4 mask layers (reproducible on upstream) and crashes on the stable's
  outline branch. The clean-room decoder in `tools/sld_layers.py` exists
  because of this; extend it rather than reaching back into openage.

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
