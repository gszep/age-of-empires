# Arabia snow calibration (#118)

## Scope and acceptance (2026-10-06)

Evidence-first native survey, using owner-approved installed DE build **185872**,
not pinned build 48987. Keep fullscreen 2560×1440 and UHD unchecked. Fresh
single-player Tiny 1v1 Arabia, All Visible; at most 15 boards, never Play Again.
Identify NEARCTIC_TEMPERATE against the owned RMS palette before interpreting
pale terrain as POWDER_LIGHT (125). Capture whole-map world views and minimap;
measure coverage, four-neighbour component sizes and tile perimeter²/area.
Do not fit code from unvalidated colour masks or substitute pixel components
for tile components. Any implementation requires an explicit inferred fit,
legacy seed preservation, focused tests and TypeScript checking.

## Inherited evidence

Issue #118 reports the 2026-09-19 attempt was reverted: 6% in 24 clumps with
clumping_factor -10 became contiguous 20–40-tile blobs using growClumps.
Its 2026-10-06 comment records the separately completed eleven-biome work
(ca82aba), leaving snow blocked on native evidence. This checkout starts clean
at 94dc0ff; there is no worker partial diff or failing-check log in this tree.
The issue description, not a recovered execution trace, is the evidence for
that earlier failed visual attempt.

The historical receipt is commit `0b539cf26b38f829bda9749af5ef67b6d0f7dcc5`.
Its diff only adds the failed visual attempt to the backlog; it contains no
implementation or numerical test results. No reconstruction of that reverted
patch is represented as the original attempt.

## Outcome: BLOCKED on tile-level measurement, not native access

**No generator change.** A nearctic board was found on fresh attempt 5. Its
snow has visibly mottled interiors within broad localised patches. That is
not evidence that negative clumping scatters disconnected *tiles*: the native
material itself has thousands of disconnected bright pixel components.
Changing growClumps from this picture would conflate material coverage with
terrain placement. The requested tile-component census remains unmeasured.

### Source checks

Resolved the owned root with `uv run --locked python tools/depot.py` before
searching. The installed game is at `D:\SteamLibrary\steamapps\common\AoE2DE`.
Installed and pinned `resources/_common/drs/gamedata_x2/Arabia.rms` are identical:
SHA256 `dfd91bb5654955d1cd7554017dc165dd08bc9b9efbde081f212f80fb680d6500`.

- Lines 438–481: NEARCTIC_TEMPERATE, pine stragglers, base3, blends0/9/12/3,
  forest19, edge89, variations10/19, forest blend0, litter89/110. Winter/spring
  is a separate 50/50 draw. This is the palette used to identify attempt5.
- Lines 1219–1228: POWDER_LIGHT, base BASE_TERRAIN, land_percent6,
  number_of_clumps24, clumping_factor−10, **set_scale_by_groups and
  terrain_mask1**. These last two directives must not disappear from a fit.
- Installed DAT differs from pinned DAT, so it was separately parsed with
  the locked genieutils dependency. Both give terrain125 the **same three
  minimap palette indices (55,236,54) as grass0,9,12**. Thus a minimap colour
  threshold cannot identify snow uniquely. Pale/grey minimap resource dots
  must not be counted as snow. This invalidates a snow-only minimap census,
  not merely a particular threshold choice.
- Installed125: `Snow Soft Light`, texture `g_sn2`, 10×10 tile repeat,
  blendType7, blendPriority159, overlay `snow_light.png`. Pinned priority160;
  the other listed properties agree. The installed DAT SHA256 is
  `4aa2f0a719e88e5f1502517eddb27c669aeb40c2fe9d8c4f3eec7751c01e7baa`.
- Installed/pinned `terrain/masks/snow_light.png` are identical, SHA256
  `e8134515012b60038eef197c71ba6b457d8a870c175dce1192797fa192a4bf38`.
  This 512×512 RGB mask is 55.5988% zero in red, 24.7063% red>127,
  14.9357% red255 (mean63.1733). At red>127 it has **3456 four-neighbour
  pixel components**. These are source-mask channel values, not sRGB light
  measurements and not terrain tiles.

Independent code diagnosis: growClumps inserts only four-neighbour candidates
of an accepted tile. A negative factor changes frontier cost but cannot create
an isolated component away from its seed. However, that invariant alone does
not establish a mismatch with native placement. `paintBiome` has no125 pass
today. The renderer builds opaque terrain bases and applies overlay masks at
terrain transitions; no claim is made here that it reproduces native
`terrain_mask1` through the interior of a multi-tile snow patch. Masked
underlay/compositing is a competing explanation for the old “frozen lakes”,
not a proven rendering bug or permission to edit outside this assignment.

### Native capture receipt

All local evidence below is intentionally ignored, retained under
`.local/native/` **in this durable worktree**, not in main or committed assets.

| Fresh board | Evidence | Result |
|---|---|---|
| 1 | snow-01-board.png | Different tree/ground palette; no nearctic acceptance |
| 2 | snow-02-board.png | Different tree/ground palette; no nearctic acceptance |
| 3 | snow-03-board.png | Arid palette; rejected |
| 4 | snow-04-board.png | Arid palette; rejected |
| 5 | snow-05-board.png | Pine stragglers, mixed forest, ground palette and pale snow; nearctic accepted visually |

`snow-settings.png` records Arabia/Tiny[120]/All Visible, human versus
Standard AI, Random Map. Each previous game was quit to the score screen and
main menu; no Play Again. Board5 paused at displayed **00:00:06**, Casual1.5;
not tick zero. No native numeric seed was captured. No cheats, editor fixture,
save-file edits or executable inspection were used.

World coverage: `snow-05-{north,west,east,south}.png` plus
`snow-05-grid-U-V.png`, U,V each12/36/60/84/108 (25 views), and
`snow-05-contact.png`. These survey the map including all boundaries; trees,
HUD and the pause banner still obscure some ground. They are not a registered,
fully unoccluded tile mosaic. `snow-05-board-crop.png` is the minimap.
Each full capture has a timestamp/PID/rectangle JSON receipt.

Actual exercised coordinates, real2560×1440 pixels:
Single Player490,450 → Skirmish974,940; map browser2008,512 → Arabia710,660
→ Confirm1270,1270. Start1320,1236, wait6.5s, F3, camera2300,1290.
Grid camera clicks: x=2304+2(V−U), y=1183+U+V; these are survey targets,
**not validated native tile coordinates**. Quit: F10 →1280,547 →1065,780;
score Main Menu533,1236. JSON receipts omit Clicks; this records them.

### Statistics and their limits

Requested units: tile area, four-neighbour tile components, exposed tile-edge
perimeter; compactness P²/A. No-data compactness is undefined, not zero.

| Board | Snow coverage, whole map | Components | Patch sizes (tiles) | P²/A |
|---|---:|---:|---|---|
| Native5, 120×120 | **Not recoverable from this classifier** | Unmeasured | Unmeasured | Unmeasured |
| Current Arabia seeds4,14,18,21,26, each120×120, marker1 | 0% each | 0 each | Empty each | Undefined |

Headless seeds were selected using the actual independent dressing stream,
then both NEARCTIC_TEMPERATE and mapgenVersion1 were asserted after createGame.
Results: `snow-headless.json`; executable scratch probe `snow-headless.mts`.
The missing snow is the current baseline, not a regression introduced here.
The historical 20–40-tile assertion is not a measured current candidate.

To test the proposed world-colour route rather than merely dismiss it, two
exposed snow crops and a grass control were segmented at original resolution.
8-bit **sRGB screenshot** predicate: B>130, B−R>16, B−G>8. Pixel P is counted
on four-neighbour exposed pixel edges. Boxes below are x0,y0,x1,y1:

| Crop | Box | Pale pixels / crop | Pixel components | Pixel area min/median/p90/max | Median pixel P²/A |
|---|---|---:|---:|---|---:|
| A | 680,300,1100,620 | 11.5156% | 726 | 1/2/31.5/1397 | 18 |
| B | 1450,495,1780,660 | 16.6354% | 348 | 1/2/26/3772 | 18 |
| Grass control | 1390,180,1610,330 | 0% | 0 | Empty | Undefined |

These are **pixel diagnostics, not a substitute for the requested tile table**.
The crops cut patches; their area percentages are neither whole-board snow
coverage nor RMS land_percent. Changing the colour differences to8/4 and24/12
gives A12.4382%/10.6436%, 697/732 components; B17.7631%/15.3701%,
320/356 components. Hundreds of tiny components survive within each visibly
localised snowy region. Owned mask fragmentation independently explains why
that does not identify hundreds of snow tiles or clumps.

`snow-05-mask-{A,B,control}.png` shows the accepted diagnostic masks in magenta;
all were visually reviewed. `snow-pixel-stats.json`, `snow-measure.py` retain
the exact calculation and threshold sweep. Source metadata is in
`snow-source-metadata.json`. No synthetic morphology was used to manufacture
a tile count or desired patch shape.

## Checks, final state, bounded next step

- Headless probe: exit0, five asserted nearctic marker1 boards, no snow.
- Pixel diagnostic: exit0, masks reviewed; **tile classification acceptance
  failed** because it cannot separate placement from the material mask.
- `vitest run src/sim/mapgen.test.ts --maxWorkers=1`: **27/27 passed**,
  35.54s Vitest duration /36s wall; `snow-mapgen-test.log`.
- `tsc --noEmit`: **exit0**, 11s wall; `snow-tsc.log`.
- No runtime/test changes, no new approximation, no fixture clock changes,
  no checkpoint/import/build/deployment/restart/commit/push.
- Final `snow-options-pane.png` verifies Full screen2560×1440, UHD unchecked,
  default zoom50%, gamma1.00; depth of field/bloom/sharpen enabled at100%.
  No graphics settings changed. `snow-options-cancel.png` verifies final main
  menu, build185872; **PID22012 left running**, no controller/probe jobs left.

Next bounded calibration should isolate the directives, not re-roll more
ordinary boards: obtain native tile labels via an approved save/scenario
reader, or use an owner-approved diagnostic RMS with a unique-colour opaque
terrain and controlled base, comparing factor−10/0/positive with and without
terrain_mask1. That would distinguish frontier geometry from compositing.
Neither diagnostic custom content nor a save parser was introduced in this
assignment. Until that measurement exists, retain #118 and the unchanged
legacy/new-marker generators. Native seed parity, full-map tile coverage and
native component/compactness distributions remain unresolved.
