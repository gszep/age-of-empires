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
than treating DAT `blendType` as a family index. Farm type 1 on grass type 0 uses
mode 3, not mode 1/watershore. Each patch tile reads its receiving terrain, so a
farm crossing a road can use mode 6 there. Native patches include the four
diagonal corner neighbours; classic fallback retains its side-only ring. A
single mesh owns coalesced material groups when several families meet it.
Moved placement previews rebuild their patch and dispose the old geometry and
materials, refreshing both texture origin and receiving-family selection.

## Source and sampler evidence

Read all ten 512-square sheets under owned
`depot_813782/resources/_common/terrain/blends`, the DAT-derived terrain rows
in the full content extraction, and the `TerrainBlend_vs/ps.so` resources.
Farm7 and construction-farm 29 both have blend type 1 and no overlay mask;
grass 0 uses type 0, road 24 type 5, beach2 type 2 and water 1 type 3.

The pixel shader's reflection and instructions distinguish:

- `sBilinear`, slot 1: `g_MaskTexture` at t2 and `g_BlendTexture` at t3.
- `sAnisotropic`, slot 4: `g_TileTexture` at t0 and `g_LayerTexture` at t1.

The implementation previously assigned anisotropy16 to the overlay mask too.
Changing **that mask** to anisotropy 1 reduced the diagnostic crossing error from
0.030495 to0.001896, against the same source samples and unchanged 0.025 limit.
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
publication: `.local/blend116-import.log`, exit 0. All3162 sprite/layer atlas
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
eight families. Focused view tests passed 87 cases, including mixed-background
farm materials, construction scale, fallback and moving-preview disposal.

Receipts: `.local/land116-browser-r3.log`,
`.local/land116-shore-regression.log`. The failed sampler measurements remain
in `.local/land116-browser{,-r2}.log`; no tolerance or timeout was widened.
A real-texture overview is `.local/land116-crossings.png`. It supplements the
numbers and is **our renderer**, not a DE reference capture.

Owned checkpoint **GREEN**, `.local/land116-gate.log`, exit 0,13m52s:1117 Vitest tests
across 89 files (the same 7 inapplicable cases skipped), build,164 Python/import
tests and real-browser debug smoke. Only Markdown edits followed checkpoint start.

```bash
npx tsx tools/land_blend_smoke.mts
npx tsx tools/shore_blend_smoke.mts
```

## Remaining calibration

### Reopened #284: square coast outline (2026-10-10)

The October 3 opaque-water join fix below does **not** resolve the human's
square notches. Diagnosis reproduced the gold/scout/sheep coast at world
(47.5,59.5), Islands seed2, default zoom0.8, F4 reveal and F3 pause. A fresh
browser needs `?solo=1&seed=2&map=islands`: without a saved Islands preference,
the reported `?solo=1&seed=2` URL opens Arabia. Debug `look` accepts `entity`
or `rect:[x,y,0,0]`, not top-level `x`/`y`. Both mistakes invalidated the earlier
worker's coast diagnosis. Its unknown IDs128/122/100 were dry South American
forest/Grass Flowers1/Dry Grass, not fog or water.

The valid coast has Grass2=12 (priority119, type0), Beach=2 (131,2), Water,
Shallow=1 (166,3), and offshore Water, Medium=23 (178,3), decoded from the owned
manifest. All357 tile elevations in the inspected21×17 region are zero.
The grid naturally steps in whole tiles; that alone cannot distinguish a
generator defect from failure to blend its outline. No generator/replay change
is justified by this investigation.

There is a concrete failure in the **inferred native window layout at
blend-to-blend joins**, in both watershore and landland:

- Beach tiles(46,55)/(46,56) use watershore columns22/19 (two adjacent water
  edges versus a diagonal water neighbour). At their common edge, local x=0.3,
  production bilinear UV sampling gives alpha0.718039/0.358039: a0.360 jump.
- Grass2 tiles(47,58)/(47,59) use landland columns22/8. At their common edge,
  local x=0.4, alpha is0.456471/0.097255: a0.359216 jump.
- These published columns are byte-identical to the original source cuts:
  watershore22=(320,224),19=(0,416),96²; landland22=(320,256),8=(0,64),64².
  This is not a stale import, GPU orientation error, foam or elevation seam.
  Reading `TerrainBlend_ps.so` again establishes independent shape alpha, not
  the engine's window selection. It does not authorize synthetic stitching.

A real-GPU, flat-colour draw of the captured seed2 terrain through `createGround`
retains the notches without surface water or foam. Across792 same-base joins,
sampled0.07 tiles apart away from vertices, the maximum normalized linear-sRGB
channel jump is0.736 with production land gating, and0.348 with land gating
disabled. The latter isolates the shape problem; disabling gating is **not a
proposed fix**. Hiding all blends gives zero same-base jumps. Classic masks do
not solve it either (maximum0.708876 with the existing land gating). The separate
source-edge test above removes finite pixel spacing from the diagnosis.

Baseline outline statistic: in the1000×500 gold-centred crop,19.75% of water
and38.04% of land 50%-coverage contour crossings lie within0.06 tiles of an
integer tile axis (linear-sRGB diagnostic colours). This is a reproducible
baseline, **not** a calibrated DE acceptance limit or a before/after success.
The prior worker's local DE-reference copy shows rounded sub-tile transitions
even on its stepped coast; the external originals were denied by this session's
image reader, so neither a verified two-reference comparison nor a numerical
DE contour comparison is claimed.

Existing smokes remain green on this visibly defective baseline: shore775
source samples (max error0.002),160 opaque-water joins (exposure0.008);
land6200 shape/50 crossing/450 farm samples (errors0.002/0.001896/0.001743).
They check correct sampling of the inferred windows, not compatibility between
neighbouring windows. `world.test.ts`:30 passes; public-content build passes.
No production code, imported assets or existing acceptance thresholds changed.

**Bounded next work:** establish the native UV rectangles/topology for adjoining
single-edge, diagonal and adjacent-edge windows against a matched native coast
or editor fixture; include both sides of every join, not just interiors and
opaque-water joins. Preserve those fixtures plus the actual seed2 contour
baseline. Correct `tools/import_blends.py:de_masks` only with that evidence;
audit the separately inferred two-way land overlay policy if discontinuities
remain. Re-publication would require the **blend stage** of the full
`npm run import:aoe2` pipeline under the coordinator's slot: the current packed
atlases already contain the incompatible cuts, so a view-only fix cannot sample
source pixels outside them. Decoder geometry and sprite conversion need no
change. Do not resize/blur/remap alpha merely to meet a metric. Then repeat the
two existing smokes, source tests, real seed2 before/after contours and native
comparison before claiming the human bug fixed. No reimport was run here.

Durable investigation artifacts are under the issue284 worktree's ignored
`.local/`: `astra284-before-{full,coast}.png`, `astra284-snapshot.json`,
`astra284-tile-map.txt`, `astra284-isolation.json`, `astra284-source-joins.json`,
and their diagnostic scripts/logs. These are handoff evidence, not shipped
assets or maintained regression coverage. No after-fix image exists.

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

The reported Islands seed 2 coast was reproduced on a private browser. The pale
tile pattern persisted with foam and the animated surface disabled. Changing
corner suppression did not remove it; opacity gain and synthetic boundary
correction were rejected as substitutes for complete source windows.

The64-pixel `watershore` cuts truncate the authored fades: the original first
edge's terminal row retains at least 18% sand at its worst source sample. The
new 160-sample production-renderer join check measured 15.2% exposed sand before
the fix, despite the existing 775 interior samples matching the imported atlas.

`watershore` now uses 96-pixel original-source windows, with border variants
positioned clear of the sheet's other motifs. Other families retain their
existing 64-pixel cuts. Per-family `tile` metadata is consumed by ground and
terrain-patch UVs; old imports still use the common layout. Original samples,
the authored irregular contour and source hash are preserved; no gain, blur or
repainted alpha is used. The new join check requires less than 2.5% exposed sand
in linear-sRGB, alongside the unchanged 0.025 source-alpha error limit.

The96-pixel extent and exact cut coordinates are **inferred**, not a recovered
native-engine UV table. This fixes the demonstrated truncated-fade defect; #116
still owns exact DE crossing-width and junction calibration.

Verification on the regenerated assets: maximum exposed-sand fraction at the 160
sampled joins fell from 0.152 to0.008, with the same 0.025 acceptance limit. All775
shore and 6200 family interior samples remain within 0.002001 of the source alpha;
the 50 land-crossing and 450 farm checks also pass. The full import reused4898
sprite/layer atlases and completed all stages. Same-camera seed 2 captures are
`.local/shore284-all.png` and `.local/shore284-after-all.png`; foam/surface-off
controls are retained beside them. No simulation-state changes were observed.
Owned checkpoint GREEN: `.local/shore284-gate.log`, exit 0,790s;1384 Vitest passes with
the same 8 skips,200 Python passes, typecheck/build and real-browser debug smoke.
The focused view suite passed 39 tests and the two new owned-source window tests
passed. Existing orientation/contour and deterministic-publication checks also
passed with their original thresholds.

## Native capture compatibility, October2 calibration run

Native desktop automation now reaches the scenario editor, paints terrain,
places a real farm and saves a separately named scenario. The first controlled
fixture is `OpenEmpires-20261003-terrain116`: blank 144-square grass map,
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
construction29 and water 1/22/23 rows are identical. These checks establish
asset compatibility for this fixture, **not equivalence of engine-set UVs,
draw ordering or shader constants across executable versions**.

Private evidence is indexed in `.local/reference/index.md`. Captures are
full-resolution2560×1440 desktop PNGs, display/sRGB, default-zoom slider 50%,
UHD unchecked. Diagnostic settings disable depth of field, bloom, sharpen,
vignette, map lighting and game-object antialiasing; gamma remains 1.0.
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
