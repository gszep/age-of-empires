# Map generation: the build plan

An overnight run plan. `map-generation-design.md` is the research on what the
original does; `map-conditioning-design.md` is the research on driving it from
real geography and on the fidelity dial. **Neither is a specification.** They are
what one session could establish from public sources in an afternoon, and the
run that builds this will learn things they got wrong. That is expected. Read
the licence to deviate at the bottom before treating anything here as fixed.

## The goal, in one sentence

By morning the board should be a place: ground that varies, woods with insides,
something worth fighting over in the middle — and, if the night goes well, a
board generated from the real ridge at Senlac.

## What must not break, whatever else changes

These are the reasons this can be attempted without supervision. Everything else
is negotiable.

- **The gate is green at every commit.** `tools/gate.sh`, not by hand.
- **Determinism holds.** Same seed and same inputs, same checksum, on any
  machine. Every stage here changes the map, so every stage needs a determinism
  test, and any float that reaches `GameState` is a bug waiting for a different
  CPU.
- **Nothing speculative runs inside `createGame`.** No model, no fetch, no geo
  library. The generator is a pure function of `(descriptor, seed)`; everything
  else happens offline in `tools/` and lands as committed, hashed data. This is
  the one architectural decision that should not be revisited without saying so
  loudly.
- **The open fallback still plays.** A user without the owned files gets a
  worse map, not a broken one.
- **One item at a time, and no half-shipped feature.** If a stage cannot be
  finished, revert to green, write down what blocked it, and take the next one.
- **`MAP_TILES` stays 120 for the M-series.** Board size is a real question but
  it belongs to the conditioning work, not to rebuilding the generator.

## The ladder

Aim high; land honestly. Any of these is a good night, in increasing order of
ambition:

1. **Floor** — M1 to M3. The board looks like Age of Empires: real terrain
   underfoot, woods you can't thread, and a contested middle.
2. **Target** — M4 as well. Two map types exist, and the second one is Black
   Forest, generated from a descriptor rather than from code.
3. **Stretch** — C1 and C2. A descriptor built from real elevation renders as a
   playable board.
4. **The thing to be greedy for** — a British battlefield on screen, with its
   real ridge, from Open Government Licence data.

## The queue

Each item is an outcome and a test. How to get there is the run's business.

**M1. A terrain grid, one growth primitive, and `cleanTerrain`.**
`GameState` gains per-tile terrain; the generator gains the original's
cost-ordered round-robin growth and the two-pass hole filler that follows it.
`growClump` becomes one caller. Note this is also `water-design.md`'s W1 — build
it once, for both.
*Done when:* the wood on seed 7 has no open interior tile and no diagonal-only
gap (`backlog.md` records 19 of 63 open today), and a replay checksums clean.

**M2. Object placement as the original's candidate scan.**
Square distance bands, tight and loose grouping, group spacing, the room test.
`OPENING` already holds the right numbers from `land_resources.inc` and the
search that consumes them is wrong.
*Done when:* no group overlaps another, a seed sweep shows resources in the
corners of the band rather than only on a ring, and the 16-seed batch still
decides 16 with 0 checksum failures.

Land M1 and M2 in one push if you can — both invalidate every stored replay and
it is better to take that once.

**M3. The middle of the map.**
Neutral forest at Arabia's own numbers, relics, scattered trees. After M1 and M2
this should be configuration rather than machinery; if it isn't, that is a
signal M1 or M2 took a shortcut.
*Done when:* there is something to fight over between the two openings, the AI
still finds its wood, and a screenshot shows it.

**M4. Lands and connections, and Black Forest with them.**
Land generation is M1's growth with a zone, a border box and an avoidance
distance. Connections are a cheapest path between land origins that repaints a
corridor. Black Forest needs no water: base terrain forest, grass lands carved
out, a three-wide road cut through.
*Done when:* Black Forest generates from a descriptor, the road is the only
route between the clearings, and the pathfinder finds it.

**C1. The descriptor, proved with a painted PNG.**
Optional baked terrain and an optional integer bias field, both hashed. Prove
the whole architecture with a hand-painted image and twenty lines of script —
no network, no geo dependency, no model.
*Done when:* a painted PNG becomes a playable board and the same descriptor
gives the same checksum twice.

**C2. Real elevation and real ground.**
The offline importer. Britain first on Open Government Licence data if the data
can be reached; the global Copernicus/WorldCover path behind the same interface
if it cannot.
*Done when:* one real bounding box produces a board whose ridge is the real
ridge, and the artifact carries its source hashes and licence text the way
`content.json` does.

**C3 and beyond** — the bias hook, the CA repair, playability, the fidelity
dial — are in `map-conditioning-design.md` and are almost certainly not tonight.
Do not start one at 5am.

## Go and find out

Things the design docs assume and could not confirm. Each is worth a few minutes
early, because each can change the plan:

- **The real map scripts.** The resources depot (813784) carries
  `resources/_common/random-map-scripts`. Everything in
  `map-generation-design.md` about Arabia and Black Forest came from public
  copies of the 1999 scripts; the owned ones are the authority and the
  downloaded-content-first rule says to use them. If the depot pull needs
  credentials that are not available, say so and proceed on the public copies —
  they matched `land_resources.inc` line for line, so the risk is low.
- **Terrain units.** The DAT's terrain slots carry `TerrainUnitID`,
  `TerrainUnitDensity` and `NumberOfTerrainUnitsUsed` — the ground names what
  grows on it. If that is readable through the importer's DAT parser, forests
  may be data rather than a decision.
- **The elevation legality rule.** The original runs a `cleanElevation` after
  every hill and the reverse engineering leaves it a stub. What adjacency does
  AoE2 actually permit between neighbouring tile heights? Read it out of the DAT
  or the reference before building elevation on a guess.
- **Whether EA LIDAR can be fetched by a script at all.** The download portal
  may be interactive. Check this *early* — if it needs a human to download a 5 km
  tile, say so at midnight, not at four. The AWS-hosted Copernicus and WorldCover
  COGs are HTTP range reads and are the fallback that definitely works.
- **What a 240x240 board costs** the pathfinder, the visibility grid and the
  minimap. Not needed tonight, but it is one measurement and it decides the tile
  pitch later.

## Licence to deviate

The plan above is a hypothesis. Change it when the ground says so, and prefer a
better approach found at 2am over a worse one written in advance.

Specific places deviation is *expected* rather than merely allowed:

- **Seam carving on terrain has no prior art I could find.** If it disappoints,
  cartograms and plain importance-weighted crops are the neighbours. Do not
  force it.
- **The bias-term hook** (`- bias[tile]` in the growth cost) is a plausible
  reading of the algorithm, not a measured one. If conditioning wants a
  different shape — a seeding bias, or an accept test — take it and say why.
- **Terrain blends are a known blocker** (`overnight.md`). A multi-terrain map
  will have hard seams until somebody finds the mask mapping. Ship with hard
  edges and record it; do not invent a visual, and do not let this block M1.
- **Forests as terrain or as entities** is decided in the design doc
  (entities, over a grown mask) on reasoning, not evidence. If the DAT's terrain
  units say otherwise, the DAT wins.

Whenever you depart from the plan, do the thing this repo already does: write
down what you found, why it changed the approach, and what the new evidence was
— in `lessons.md` if it is operational, in the design doc if it changes the
design, in `status.md` if it changes what the game is. A design doc that is
wrong and corrected is worth more than one that is right and unread.

Search the internet freely. Both design docs were built that way, their sources
are named in them, and the parts most likely to be wrong are the parts
reconstructed from a decompilation rather than read from the owned files.

## When to stop and ask

The standing rule holds: continue autonomously unless blocked by credentials,
legal ambiguity, irreversible infrastructure, or a product decision with
materially different outcomes. Three specific ones live here:

- **Mirroring.** `createGame` mirrors both players exactly; the original does
  not. The design doc recommends keeping the mirror and recording it as a named
  discrepancy. Do that, and do not quietly remove it — it is what the paired
  batch's fairness rests on.
- **Licensed data in the public build.** Anything with an attribution or
  share-alike obligation that would ship to `empires.gszep.com` is a decision,
  not a detail. Build offline against it freely; ask before shipping it.
- **Board size.** Changing `MAP_TILES` changes every stored replay and every
  performance figure in `status.md`. Measure it, propose it, do not do it
  overnight.

## At dawn

Leave the repo honest: `status.md` truthful about what the map now is and what
it still isn't, `backlog.md` updated (the two map items it records — the empty
middle and the ragged forest interiors — should be closed by M1 and M3, so close
them and say by what), new operational facts in `lessons.md`, and this file
marked with where the queue actually got to. Then the hygiene pass: list what is
still running, kill the litter, name what deliberately survives.
