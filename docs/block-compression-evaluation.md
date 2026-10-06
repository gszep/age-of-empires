# Sprite block compression evaluation — #163

2026-09-30. **Decision: retain PNG/RGBA8 in production. Direct source BC1/BC4
uploads save GPU memory but fail the current pixel-preservation requirement.**
Resolve the decoding boundary in #256 before implementing a full compressed
atlas path. This is a negative result for direct source-block substitution, not
a claim that every compressed representation is unsuitable.

**Follow-up #256:** the [decoding contract](block-decode-contract.md) now separates
an actual RGB565 promotion error (corrected) from specification-permitted vendor
interpolation. The measurements below are the **pre-correction baseline**; current
probe runs use the corrected endpoints. Zero byte differences from a single PNG
cannot be the universal native BC1–BC5 contract. Production compressed loading is
still not enabled; this report's original strict-parity rejection is not evidence
that hardware sampling is intrinsically less faithful to DE.

## Scope and source inspection

- Resolved the owned root through `tools/depot.py`; sampled the pinned Enhanced
  Graphics Pack's actual SLD blocks. No executable inspection or lossy encoding.
- `sld_layers.py` reads BC1 main data, BC4 shadow/damage/player-coverage data,
  and a distinct outline bit stream. At this checkpoint its RGB565 expansion shifted bits rather
  than extending them to the full 8-bit range. Its interpolation uses integer
  arithmetic. A synthetic white endpoint became 248/252/248 in those PNGs.
- `convert_sld.py`/`sld_layers.py` generate four-channel pages. Shadows/outlines
  use neutral white RGB plus coverage alpha. Player-colour pages synthesize
  main-layer luma in RGB and separate mask coverage in alpha.
- `assets.ts` uploads sprites without mipmaps, with linear filtering and sRGB
  interpretation except player-colour data pages. `SpriteResidency.bytes` counts
  decoded RGBA8 dimensions; it is not a measured physical GPU-memory counter.
- Three r180 already maps BC1 and BC4 formats to WebGPU. Format support alone
  does not make source blocks equivalent to the current decoded pages. A BC4
  texture supplies red, not the white-RGB/alpha layout existing materials expect.
  A KTX/DDS container does not repair those semantic differences.

Production import, atlas packing, renderer and residency code were not changed.
The diagnostic fixture is a grid of literal blocks, not a regenerated asset
manifest. All extracted bytes and PNGs remain under ignored `.local/probes/`.

## Desktop environment and method

Native Windows Brave product version **154.1.96.59**, NVIDIA **RTX4060**, driver
**32.0.15.8129**. WebGPU reports `nvidia` / `lovelace`,
`isFallbackAdapter=false`, and `texture-compression-bc`. This is not SwiftShader.

For each of villager, militia and galley, sample 256 literal blocks from the main
and shadow streams using the existing command walker. Render each4096-pixel
sample twice through PNG and once through native BC. The PNG readback is checked
against the decoder's original bytes, not only against another PNG draw. BC4
coverage is presented as opaque greyscale data to avoid canvas premultiplication.
Main layers are tested as both unorm data and sRGB textures. No filtering or
compositing hides a decoding discrepancy: the probe uses `textureLoad` into an
RGBA8 render target. Fully transparent RGB is ignored, but alpha is compared.

The adapter feature controls compressed use; explicitly selecting PNG exercises
the uncompressed route. This is a diagnostic branch, not a new production loader.
The desktop acceptance runner requires hardware BC support so it cannot report
software/no-BC results as hardware measurements. Production keeps its existing
PNG path on every backend.

## Pixel result

All PNG-vs-decoder and repeated PNG comparisons have **zero changed pixels**.
The two fresh desktop browser processes agree exactly on every comparison.

| Source | BC1 changed pixels /4096, unorm data | Maximum channel error /255 | BC4 shadow changed pixels /4096 | Maximum coverage error /255 |
|---|---:|---:|---:|---:|
| Villager | 2945 | 7 | 649 | 5 |
| Militia | 2603 | 7 | 693 | 4 |
| Galley | 3417 | 7 | 528 | 3 |

BC1 alpha is unchanged in these samples. With sRGB textures rendered to a
linear-light 8-bit target, main-layer differences reach16/255; changed pixels are
2448,1879,3244 respectively. These are separately labelled colour spaces, not
interchangeable error scores. The numbers establish failure of byte parity; they
do not measure perceived error or native DE's final composited appearance.

Source SHA-256:

| File | SHA-256 |
|---|---|
| `u_vil_male_villager_idleA_x2.sld` | `c665f600450bd9294477f4c0dee70d476d32e470b52e4852c9aa791ce002a377` |
| `u_inf_militia_idleA_x2.sld` | `c20483477745145c27c1c56086bd54aa790d42494979a73143a5eaeb6825a633` |
| `u_shp_galley_x2.sld` | `7372edf2e1b7eaaa09c4a8f000466727fe7b6a57b73a77faea5b2bd3d2407f96` |

## GPU memory result

A separate allocation experiment creates and initializes eight 2048×2048 textures
in each fresh browser process and waits for submitted GPU work. Windows
`Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory` is queried for
that isolated browser's process tree before/after allocation and after destroy.
This avoids treating network/file size or a texture-object count as VRAM usage.

| Format | Uploaded block/texel payload | Measured dedicated GPU-memory increase | Total committed increase |
|---|---:|---:|---:|
| RGBA8 | 134,217,728 bytes | 134,258,688 bytes | 152,084,480 bytes |
| BC1 | 16,777,216 bytes | 16,703,488 bytes | 28,631,040 bytes |

The measured dedicated increase is approximately128MiB versus 16MiB. OS counters
include driver allocation granularity and other work in the isolated GPU process;
they need not equal the logical payload exactly. Immediate destroy did **not**
return the entire counter increase to baseline: driver/browser pooling or delayed
reclamation remains visible. The test does not claim immediate physical eviction.

This is an allocation experiment, not the whole fleet benchmark from #162. It
does not establish full-game memory reduction, frame-time improvement, or decoded
CPU-memory savings. Those tests are only worthwhile after the fidelity contract
passes.

## Reproduce and next boundary

From WSL on the Windows desktop with Brave installed and the owned content
extraction available:

```bash
uv run --locked python -m unittest discover -s tools -p 'test_block_compression_probe.py' -v
uv run --locked python tools/probes/block_compression_fixture.py
node tools/probes/block_compression_desktop.mjs > .local/probes/bc163-desktop.log 2>&1
```

The runner uses a private Vite localhost5280 server (`BC_PROBE_PORT` overrides), a
fresh headless Windows browser profile per allocation format and the hardware
adapter. It stops only those browser process trees. Measurements and source
metadata are in `.local/probes/bc163-{rgba,bc,summary}.json`. The two synthetic
fixture tests pass, as do JavaScript syntax checks and the hardware experiment;
the experiment's adoption result is explicitly **false**.

#256 tracks the prerequisite: establish the intended CPU/native decoding contract
against reference evidence before changing either path. A future implementation
must additionally prove keyframe/delta reconstruction,4×4 alignment/padding,
multi-page geometry, synthesized player shading, mask swizzles, fallback loading,
residency/disposal and full-renderer pixel/simulation-hash equivalence. No full
atlas regeneration was needed for this evaluation; any production regeneration
must still go through `npm run import:aoe2`.
