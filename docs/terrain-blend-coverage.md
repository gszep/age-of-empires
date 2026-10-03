# DE terrain/farm blend coverage — #116

2026-10-01. Native shape consumption now covers every family used by the
existing terrain-pair table. Exact native engine UV selection and matched-DE
crossing calibration remain open; source-alpha agreement is not that evidence.

## Delivered

The full importer publishes deterministic64×64 windows (96×96 for `watershore`
after #284), replicated gutters and source hashes for these modes:

| Mode | Owned sheet | Use in the current pair table |
|---|---|---|
| 0 | `waterwater.png` | water/water |
| 1 | `watershore.png` | water/land |
| 2 | `landland.png` | ordinary land |
| 3 | `farmland.png` | farm/land |
| 4 | `snowland.png` | snow crossings |
| 5 | `icewater.png` | ice crossings |
| 6 | `roadland.png` | road crossings |
| 7 | `shallowswater.png` | shallows/water |

The additional owned `herbwatershore.png` and `reserved.png` were inspected but
have no established consumer in this table. Their indices are not guessed from
directory order. Native availability is checked per family; a missing family
uses the existing classic mask and diamond UVs.

Farm and construction-farm patches now choose the **pair's family**, rather
than treating DAT `blendType` as a family index. Farm type1 on grass type0 uses
mode3, not mode1/watershore. Each patch tile reads its receiving terrain, so a
farm crossing a road can use mode6 there. Native patches include the four
diagonal corner neighbours; classic fallback retains its side-only ring. A
single mesh owns coalesced material groups when several families meet it.
Moved placement previews rebuild their patch and dispose the old geometry and
materials, refreshing both texture origin and receiving-family selection.

## Source and sampler evidence

Read all ten512-square sheets under owned
`depot_813782/resources/_common/terrain/blends`, the DAT-derived terrain rows
in the full content extraction, and the `TerrainBlend_vs/ps.so` resources.
Farm7 and construction-farm29 both have blend type1 and no overlay mask;
grass0 uses type0, road24 type5, beach2 type2 and water1 type3.

The pixel shader's reflection and instructions distinguish:

- `sBilinear`, slot1: `g_MaskTexture` at t2 and `g_BlendTexture` at t3.
- `sAnisotropic`, slot4: `g_TileTexture` at t0 and `g_LayerTexture` at t1.

The implementation previously assigned anisotropy16 to the overlay mask too.
Changing **that mask** to anisotropy1 reduced the diagnostic crossing error from
0.030495 to0.001896, against the same source samples and unchanged0.025 limit.
Terrain pictures retain their separate filtering policy. Exact mip/minification
state is not recoverable from these sampler names alone.

Pixel shader SHA-256:
`6148e4f1c7c641297715b011c8e2dd5c21feb2aa18355151eb2e4fa7f7162861`.
Both SM2 and SM4 resources were inspected, never the game executable. The vertex
shader passes the blend UV input through; it does not supply an engine window
lookup table.

New family source hashes:

| Sheet | SHA-256 |
|---|---|
| landland | `a3fe2e345fe5f89d4ad54869a6ba42f784313bac6bb2408f0cfbdc02dfdefb14` |
| farmland | `35a87f800953270a53f25178cb5d9e5cbf91c3cb70d1a0a74c8856e449e0dc37` |
| snowland | `cfc3e1e4c32687cc25e08ad935950d539856bd8429c6543d0ddaabe5c10ac66f` |
| icewater | `06bc2cf36bdf15211cc7704e6b036967e89b9b664cd4ea08fe63912a16fc9ce8` |
| roadland | `01d3d90fbf69027756abc6143201d485d6f4406ff2b1899587e57490709756eb` |

## Verification

`npm run import:aoe2` completed through content, sprite, UI, blend and audio
publication: `.local/blend116-import.log`, exit0. All3162 sprite/layer atlas
groups were reused; the blend change does not invalidate the sprite decoder.

`tools/land_blend_smoke.mts` uses a private Vite server and real browser, actual
imported mask textures, production geometry and materials. Diagnostic red/cyan
terrain isolates alpha; source sampling accounts for the pixel centre and UV
orientation. The eight category pairs include synthetic combinations solely
to exercise every family route; they do not assert new map/civilisation data.

| Check | Samples | Maximum alpha error, linear-sRGB readback |
|---|---:|---:|
| Eight families ×31 configurations | 6200 | 0.001996 |
| Existing two-way land gating policy | 50 | 0.001896 |
| Grown/construction farm sides, corners and solid interior | 450 | 0.001743 |
| Existing water-boundary regression | 775 | 0.001996 |

The probe also checks partial-manifest fallback, visible corner contribution,
and simulation checksums around the rendering passes. The source-window
orientation/contour and deterministic-publication import tests now cover all
eight families. Focused view tests passed87 cases, including mixed-background
farm materials, construction scale, fallback and moving-preview disposal.

Receipts: `.local/land116-browser-r3.log`,
`.local/land116-shore-regression.log`. The failed sampler measurements remain
in `.local/land116-browser{,-r2}.log`; no tolerance or timeout was widened.
A real-texture overview is `.local/land116-crossings.png`. It supplements the
numbers and is **our renderer**, not a DE reference capture.

Full gate **GREEN**, `.local/land116-gate.log`, exit0,13m52s:1117 Vitest tests
across89 files (the same7 inapplicable cases skipped), build,164 Python/import
tests and real-browser debug smoke. Only Markdown edits followed gate start.

```bash
npx tsx tools/land_blend_smoke.mts
npx tsx tools/shore_blend_smoke.mts
```

## Remaining calibration

The window cuts, classic-table family bindings, edge-variant selection and
maximum-alpha unions for compound edges remain the documented interpretation
from#148, extended to compatible source layouts. Native farm corner inclusion
uses that same neighbour topology. No native draw-call capture established the
exact UV rectangles used for every configuration.

The owned pixel shader specifies an RGB lerp plus independent shape alpha.
The existing renderer's shape×overlay coverage, texture-role assignments and
reverse land pass remain an integration interpretation. The two-terrain probe
verifies that policy and its sampling; it does not establish native ordering at
three-terrain junctions or full equivalence of the engine's texture bindings.

A patch-matched DE capture of a controlled grass/beach/road crossing and both
farm stages, with known tiles/zoom, is still needed to settle physical crossing
widths, placement and those binding/ordering questions. #116 remains open for
that acceptance rather than declaring visual parity from self-comparison.

## Shoreline tile-grid correction (#284, October3)

The reported Islands seed2 coast was reproduced on a private browser. The pale
tile pattern persisted with foam and the animated surface disabled. Changing
corner suppression did not remove it; opacity gain and synthetic boundary
correction were rejected as substitutes for complete source windows.

The64-pixel `watershore` cuts truncate the authored fades: the original first
edge's terminal row retains at least18% sand at its worst source sample. The
new160-sample production-renderer join check measured15.2% exposed sand before
the fix, despite the existing775 interior samples matching the imported atlas.

`watershore` now uses96-pixel original-source windows, with border variants
positioned clear of the sheet's other motifs. Other families retain their
existing64-pixel cuts. Per-family `tile` metadata is consumed by ground and
terrain-patch UVs; old imports still use the common layout. Original samples,
the authored irregular contour and source hash are preserved; no gain, blur or
repainted alpha is used. The new join check requires less than2.5% exposed sand
in linear-sRGB, alongside the unchanged0.025 source-alpha error limit.

The96-pixel extent and exact cut coordinates are **inferred**, not a recovered
native-engine UV table. This fixes the demonstrated truncated-fade defect; #116
still owns exact DE crossing-width and junction calibration.

Verification on the regenerated assets: maximum exposed-sand fraction at the160
sampled joins fell from0.152 to0.008, with the same0.025 acceptance limit. All775
shore and6200 family interior samples remain within0.002001 of the source alpha;
the50 land-crossing and450 farm checks also pass. The full import reused4898
sprite/layer atlases and completed all stages. Same-camera seed2 captures are
`.local/shore284-all.png` and `.local/shore284-after-all.png`; foam/surface-off
controls are retained beside them. No simulation-state changes were observed.
Full gate GREEN: `.local/shore284-gate.log`, exit0,790s;1384 Vitest passes with
the same8 skips,200 Python passes, typecheck/build and real-browser debug smoke.
The focused view suite passed39 tests and the two new owned-source window tests
passed. Existing orientation/contour and deterministic-publication checks also
passed with their original thresholds.

## Native capture compatibility, October2 calibration run

Native desktop automation now reaches the scenario editor, paints terrain,
places a real farm and saves a separately named scenario. The first controlled
fixture is `OpenEmpires-20261003-terrain116`: blank144-square grass map,
Default colour mood/water definition, a5×5 Beach stamp,3×3 Farm and Farm0%
terrain stamps, and a separate player-one Farm building. Eye candy is disabled.
Grid-on captures establish the painted footprints independently of texture edges.

The installed executable reports `101.103.54800.0 (#185872) 25464371`.
It is **not the pinned source build**:

| Input | Pinned depot | Installed native game |
| --- | --- | --- |
| DAT SHA-256 | `ce3530df36cf0b333a9751cb0ff94460fe904f811feecec8ae9794701622b4cf` | `4aa2f0a719e88e5f1502517eddb27c669aeb40c2fe9d8c4f3eec7751c01e7baa` |
| DAT version / civilisation rows | VER8.9 /60 | VER8.9 /63 |
| TerrainBlend VS/PS, Water VS/PS | byte-identical to installed resources | byte-identical to pinned resources |
| Water definitions / colour-correction JSON | byte-identical | byte-identical |
| landland/farmland/watershore/waterwater sheets and grass overlay | byte-identical | byte-identical |

For terrain IDs0,2,24, the only row difference is absolute blend priority
(111→110,131→130,146→145); their relative ordering is unchanged. Farm7,
construction29 and water1/22/23 rows are identical. These checks establish
asset compatibility for this fixture, **not equivalence of engine-set UVs,
draw ordering or shader constants across executable versions**.

Private evidence is indexed in `.local/reference/index.md`. Captures are
full-resolution2560×1440 desktop PNGs, display/sRGB, default-zoom slider50%,
UHD unchecked. Diagnostic settings disable depth of field, bloom, sharpen,
vignette, map lighting and game-object antialiasing; gamma remains1.0.
These settings intentionally isolate crossings and are not comparable to the
older enhanced-pack, postprocessed reference corpus without normalization.
The original options screen and source comparison receipt are retained privately.

No runtime value is tuned from these pictures yet. The Farm terrain brush and
real Farm building were both captured so that a painted-terrain result cannot
silently stand in for building rendering. Exact pixel/alpha comparison, a road
junction and construction gameplay remain unverified. Reading the native saved
scenario directory was denied by the unattended harness; no alternative read
route was attempted. A permitted scenario export plus a matching native build
would enable stronger tile/engine provenance. #116 and its human-acceptance
umbrella#113 remain open.
