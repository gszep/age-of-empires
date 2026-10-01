# DE terrain/farm blend coverage — #116

2026-10-01. Native shape consumption now covers every family used by the
existing terrain-pair table. Exact native engine UV selection and matched-DE
crossing calibration remain open; source-alpha agreement is not that evidence.

## Delivered

The full importer publishes deterministic64×64 windows, replicated gutters and
source hashes for these modes:

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

The64-pixel cuts, classic-table family bindings, edge-variant selection and
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
