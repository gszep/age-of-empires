# SLD block decoding contract — #256

Investigated2026-09-30; regenerated-content verification2026-10-01.

## What was established

The #163 comparison mixed two different problems:

1. **A decoder error:** RGB565 endpoints were shifted into8-bit channels with
   zero low bits. White became248/252/248. The required promotion replicates the
   high bits; white is255/255/255. `sld_layers.py::_rgb565` now does that.
2. **Permitted hardware differences:** legacy BC1–BC5 interpolation is not
   bit-exact across GPU vendors. Our RTX4060 interpolation differences are
   within the published Direct3D contract. Changing the portable importer to
   imitate those differences would make it NVIDIA-specific, not universally
   reference-correct.

The deterministic PNG reference now uses correctly promoted BC1 endpoints and
retains its existing round-to-nearest interpolated colours. BC4 masks retain
their existing floor-to8-bit representation. The latter is a quantized export
of a higher-precision scalar format, **not** an exact BC4 hardware decoder.
No vendor formula or output-dependent tuning was introduced in production.

## Primary sources

Read the [D3D11.3 functional specification](https://microsoft.github.io/DirectX-Specs/d3d/archive/D3D11_3_FunctionalSpec.htm):

- §19.5.2 permits promotion/rounding variants within an absolute error plus3%
  of the larger original/promoted endpoint span. Required0/1 values stay exact.
- §19.5.3 defines UNORM promotion by repeating high bits into the new low bits.
- §19.5.6 defines BC1 endpoint promotion, mode selection, reference interpolation
  and alpha. Its absolute error term is1/255; sRGB is linearized before filtering.
- §19.5.9 defines BC4 normalized rational interpolation, exact endpoints and
  special0/1 entries, an absolute term of1/65535, and at least UNORM16 filtering.

Retrieved document SHA-256:
`b3eeee598d3d0737f6aaff7121cd0fff9a2265e35b682ab7f6e62b4b45f476f9`.
Microsoft's [block compression overview](https://learn.microsoft.com/en-us/windows/win32/direct3d10/d3d10-graphics-programming-guide-resources-block-compression)
corroborates layout/mode/interpolation. Fabian Giesen's
[GPU BCn decoding survey](https://fgiesen.wordpress.com/2021/10/04/gpu-bcn-decoding/)
explains why NVIDIA's green and BC4 interpolation differ from ordinary rational
interpolation. It is corroborating research, not code imported into this project.

## Owned shader inspection

`SpritesSLD_ps.so` has an SM4 shader but no SM2/Aon9 fallback; the existing
`sm2dis.py` therefore printed no shader body. `dxbc_disassemble.ps1` invokes
Windows' installed `D3DDisassemble` for a `.so` resource only. The game executable
was not inspected or disassembled. Its assembly output remains private.
Shader SHA-256:
`d5a387a943d8977642d63833e2f0671bfe5eec3718be5cd0b4d5128873064f05`.

The resource reflection names five `g_diffuseAtlases`, four `g_damageAtlases`,
five `g_teamAtlases`, a meta texture and the terrain-attribute surface. The
colour pass samples diffuse data directly, tests alpha against.5, and samples
team coverage from the team texture's red channel. It derives luma with
.299/.587/.114 and applies the `gTeamLuminance`/`gTeamColorMode` and team-colour
parameters. There is no RGB565 bit expansion in this shader: texture decoding
happens before those operations.

This supports separating source decoding from tint/compositing. Reflection
does not reveal the resource-view format bound at runtime, and this inspection
is **not a capture of DE's final pixels**. Existing player-ramp and compositor
approximations are not reclassified as native parity by this work.

## Hardware verification

The existing native Windows RTX4060 probe now supports a decode-only run with
RGBA32Float readback. This avoids confusing8-bit render-target quantization
with the precision of BC4 sampling. It tests:

- Six owned samples:256 literal blocks each, main/shadow for villager, militia
  and galley, with source hashes recorded in the original evaluation.
-65,536 authored BC1 blocks covering every RGB565 endpoint against a fixed
  bijective endpoint permutation, with all four selectors in each block. This
  is not an exhaustive sweep of all2^32 pairs of complete RGB565 colours.
-65,536 authored BC4 blocks covering **every byte endpoint pair** and all eight
  selectors, including equal endpoints and both interpolation modes.

Across **2,121,728 texels**, the float readbacks have **zero violations** of
the specification's bounds and exact0/1 requirements. **793,496 endpoint texels**
agree exactly with the correctly rounded f32 conversions of promoted endpoints.
The analysis also compares an independent Pillow BC decoder. Its interpolated
values do not exactly match NVIDIA either; byte equality to one decoder is not
the standard's hardware requirement.

```bash
uv run --locked python tools/probes/block_compression_fixture.py --synthetic
BC_PROBE_MODE=decode BC_PROBE_READBACK=1 node tools/probes/block_compression_desktop.mjs > .local/probes/bc256-decode.log 2>&1
uv run --locked python tools/probes/block_decode_analysis.py > .local/probes/bc256-analysis.json
uv run --locked python -m unittest discover -s tools -p 'test_sld_color_decode.py' -v
```

The analysis exits nonzero on a contract/endpoint violation. Authored regression
blocks additionally exercise actual atlas colours, equal-endpoint transparency,
frame/hotspot geometry, and player-shade generation with unchanged coverage.
Source extraction remains diagnostic-only and does not publish a manifest.

## Integration and remaining boundary

This correction changes main sprite RGB and the luma derived for player-colour
pages. It does not change source alpha, masks, keyframe inheritance, frame boxes,
hotspots or simulation rules. It invalidates every atlas through the existing
decoder fingerprint. The full `npm run import:aoe2` is required, including UI,
blend and audio stages; a partial manifest publication is not sufficient.

Regenerated-content evidence:

- Full import exited0 (`.local/bc256-import.log`):3162 source/layer groups,
  zero cached atlases reused;11438 aliases continue sharing URLs. UI, blend
  and audio stages completed.
- The published manifest SHA-256 is **unchanged** from the pre-import receipt,
  including atlas frame metadata and imported gameplay rules.
- `block_decode_atlas.py` passed27 published crops /300,032 pixels across
  villager, militia and galley main, shadow and player-colour layers, sampling
  first/middle/last frames and verifying source boxes/hotspots.
- `atlas_sharing_smoke.mts` passes after regeneration: legacy-URL and shared-URL
  fleets have identical rendered sRGB pixels and simulation hashes. The fixture
  records3,886,724,288 versus879,238,400 decoded sprite bytes. Its265MB manifest
  now travels over private gzip HTTP rather than CDP interception, avoiding the
  protocol's response-body size limit without reducing fixture content.
- Full gate **GREEN**, `.local/bc256-gate.log`, exit0,14m00s:1108 Vitest tests
  across89 files (the same7 inapplicable cases skipped), public bundle build,
  164 Python/owned-content tests, and real-browser debug smoke. No test timeouts
  were widened. Only Markdown edits followed the gate start.

Native compression rollout remains separate under#163. The earlier requirement
of zero differences between one8-bit PNG and every legacy hardware BC decoder
cannot be a portable acceptance rule. Source bytes, geometry, endpoint/alpha
invariants and the actual format tolerances must be distinguished from that
expectation. This does not authorize arbitrary lossy re-encoding, broad image
thresholds, or changing the simulation hash. Full-renderer tint, filtering,
multi-page and residency/fallback checks are still needed before enabling it.
