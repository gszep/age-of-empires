# genie-rms reference-reading record (#142 / #112)

Recorded retroactively on 2026-09-28 from the original Claude Code JSONL tool
traces and project Git history. This completes the record requested by #142
under the human's decision in [#112](https://github.com/gszep/age-of-empires/issues/112).
It changes documentation, not the generator or its dependencies.

## Source and purpose

- Repository: <https://github.com/genie-js/genie-rms>.
- Licence checked at the time through GitHub's repository metadata; the saved
  response reports **`GPL-3.0`**. This is the historical identifier returned,
  not a newly inferred licence variant.
- Source URLs used **`master`**. An immutable upstream revision was not retained
  in the inspected trace, so this record does not manufacture a commit pin or
  equate today's branch with the version read then.
- Purpose: understand map-generation algorithms and inform a fresh TypeScript
  implementation: land/terrain clump growth, candidate ordering, square distance
  bands, tight/loose object placement, terrain cleaning and generator phase shape.
  This was algorithm reference material, not a patch-matched DE engine oracle.

## What was read

Two sessions contributed to the work:

| Phase | Original session | Verified source access |
| --- | --- | --- |
| Design research | `251ae499-f1c7-4f2f-b178-c78f0dc97a71` | README; full displayed reads of `src/LandGenerator.js`, `TerrainGenerator.js`, `ObjectsGenerator.js`, `Map.js`, `ElevationGenerator.js`, `CRandom.js`, `Module.js`; selected `StackNode.js` content and `Controller.js` searches; `rms/Arabia.rms` and `src/land_resources.inc` excerpts. |
| M1/M2 implementation | `b309d3f4-af53-4abf-b135-1afd581252f7` | `TerrainGenerator.js` and `ObjectsGenerator.js` Read calls; `Map.js` cleaning section; `Module.js` and `StackNode.js` slices. `LandGenerator.js` and `ElevationGenerator.js` were also downloaded in this phase, but a download alone is not a full read. |

The design session also downloaded/listed `CliffGenerator.js`,
`ConnectionGenerator.js`, `World.js`, `std_resources.inc` and `random_map.def`,
and later downloaded demonstration maps. Those fetches/searches are not presented
as evidence that every file was read in full. The attempted separate
`src/CleanerTerrain.js` fetch in the implementation session returned **404**;
the successful cleaning read was in `Map.js`.

## Trace anchors and chronology

Original logs are retained locally under
`~/.claude/projects/-home-fraser-repos-age-of-empires/<session>.jsonl`.
The line numbers below are audit-time locators; UUIDs/tool-use IDs give stronger
anchors if a log is later reserialized. Raw sessions and upstream source bodies
are not copied into this repository.

- Design session lines 59–148, **2026-08-28 21:44–21:47 UTC**
  (**22:44–22:47 BST**): source fetches, displayed reads and searches.
  Line162 at21:49:10 UTC writes `docs/map-generation-design.md`.
  The design was committed in **`b337daf`**, 2026-08-28 23:54:03 BST.
- Implementation session lines 699–700, **2026-08-28 23:15:20 UTC**
  (**2026-08-29 00:15:20 BST**): repository-tree and licence query, tool
  `toolu_01GK3RNsk8BAqnK2NT8iWzAn`; result contains `GPL-3.0`.
- Line703,23:15:24.890 UTC, message UUID
  `2bb5a89d-c389-44d3-b7fd-ee2e06a37e4a`: the implementing agent states it will
  read for algorithm understanding only and implement from scratch.
- Lines707–743,23:15–23:16 UTC: successful generator/cleaner/stack reads.
  Terrain Read ID `toolu_01EXj3B52xx4XNVjvUu8wtuL`; object Read ID
  `toolu_01TKauBH5wczTqjyiBNTZCkN`.
- Lines764–785,23:17–23:18 UTC: the agent locates and reads the owned
  `depot_813784/resources/_common/drs/gamedata_x2/Arabia.rms` and
  `land_resources.inc` before implementation. This distinguishes reference
  algorithm reading from the separately consulted owned script values.
- Line806,23:21:17.219 UTC, Write ID `toolu_01BZCouz32ZwgQrSxysTwixe`:
  project `src/sim/mapgen.ts` is written.
- **`fbd277aa079293a805fbce262ca01614cc1435ec`**, 2026-08-29 **00:51:28 BST**
  (=2026-08-28 23:51:28 UTC), introduces the 404-line generator plus map tests
  and integration. Its message records cost-ordered round-robin growth,
  two-pass cleaning, candidate scans, owned resource-band rereads and retained
  mirroring. The commit links Claude session
  `session_01R7ZUqi78RehThLoGAPPesX`.

The issue's “2026-08-28” date therefore covers the UTC implementation activity;
some of it and the implementation commit fall on August29 in local BST.

## Originality and integration boundary

**Originality statement:** the project implementation was written fresh, not
adopted as a GPL runtime module, as explicitly declared by the implementing
agent in the contemporaneous trace. The commit introduces the project's own
`mapgen.ts`; its `package.json` has no `genie-rms` dependency. The current tracked
file inventory contains no vendored `genie-rms` tree or upstream generator/stack
files. This records the author's declaration and the integration history; it is
not a new line-by-line source-similarity examination.

The implementation uses project RNG/state/entity interfaces and retains
deliberate divergences such as mirrored starts. The reading does not establish
exact DE RNG, phase ordering, clump defaults, cleaning or placement parity.
The owned scripting guide is the primary specification; its **#56** audit and
default corrections are recorded in `map-generation-design.md`. `genie-rms` is
corroborating implementation evidence, not a replacement for that guide. No
upstream code, old temporary checkout or raw transcript was
added during this documentation update.
