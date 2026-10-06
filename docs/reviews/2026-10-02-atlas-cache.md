# Layer-aware cache: real decoder-change verification (#257)

## Result

The layer-aware and clean corrected imports produced **24,715 byte-identical
published files**, and their complete cache metadata was byte-identical too.
On this single owned x1 workload, layer-aware invalidation saved **31.03% of
atlas-stage elapsed time** and **32.67% of aggregate atlas-stage CPU time**.

| Corrected decoder | Global invalidation, clean publication | Layer-aware cache |
| --- | ---: | ---: |
| Regenerated source/frame-count/layer groups |4898|2340|
| Reused groups |0|2558|
| Atlas-stage elapsed |2415.81s (40m15.81s)|1666.23s (27m46.23s)|
| Atlas-stage user CPU |9189.89s|6186.98s|
| Atlas-stage system CPU |19.25s|13.43s|
| Aggregate atlas-stage CPU |9209.14s|6200.41s|

This saves 749.58s elapsed and 3008.73s aggregate CPU in the measured atlas stage.
Groups are work items, including empty masks, not equal-cost units or PNG pages.
The52.23% reduction in regenerated groups is therefore not a52.23% timing claim.

## Controlled workload and method

- Source revision: `0829ea9131aa4ed5a99c65d26072cecac86f6d5f`; seven profiles,
  including Byzantines and the distinct fish imports.1170 consumed SLD sources.
- Actual historical change: `_rgb565` before5be3f31 expanded channels by shifting;
  the current helper uses bit replication. The probe verifies that these decoder
  versions differ in no other AST node and change only main/player-colour
  dependency fingerprints. This is a real output-changing decoder correction.
- The current publisher is used in both arms. The global control uses the legacy
  cache schema with the genuine old decoder hash, causing all entries to miss;
  it is not a timing claim about the entire historical repository release.
- Each phase runs the complete **`npm run import:aoe2`** entrypoint. The baseline
  really decodes with the old helper and creates a schema2 cache. Its publication
  is retained for the layer-aware arm; the global arm starts with a clean
  publication directory and the equivalent legacy cache metadata.
- Three phases run sequentially under GNU time, nice 10 and the default four
  workers. A timing wrapper around the atlas stage is the only shell change in
  the private exports. Cold audio/UI work is excluded from the cache speedup:
  whole-pipeline times were 2661.43s global and 1940.60s layer-aware, but are not the
  numbers used for the headline comparison.
- The old baseline took 2421.87s in its atlas stage,2667.02s overall, with0 hits.
  Copying the baseline and final full-tree hashing are preparation/verification,
  outside the timed import stages.

The base/x1 depot view omits optional1039811 only in these private exports.
The first attempt stopped before atlas publication on the truncated Slavic monk
source, now#277. The successful study used the existing owner-downloaded pinned
813784 recovery read-only:1170/1170 inputs validate, and its only difference from
the default consumed x1 files is that complete monk source. See
[source integrity](../source-integrity.md). Live x2 assets and original depots
were not modified; no benchmark export is a deployed release.

## Correctness evidence

Independent baseline inventory and actual conversion logs agree:

| Layer | Baseline groups | Regenerated after BC1 change | Reused |
| --- | ---: | ---: | ---: |
| Main |1170|1170|0|
| Player colour |1170|1170|0|
| Shadow |1170|0|1170|
| Outline |1170|0|1170|
| Damage |218|0|218|

- Full corrected publication-tree digest (sorted relative paths and each file's
  SHA256): `67269af2b5107bcabcc76816b29115b3929bcfdf2ab181a00538b41ea6788202`.
- Identical corrected cache SHA256:
  `b0efc463b0895eb4c9d9090ef94937a1790a383b005f9b670fb63f39c89b26ad`.
- Against the old baseline, encoded bytes change on1166 main and884player-colour
  pages; no shadow/outline/damage page changes. The cache-aware publication is
  exactly equal to the clean corrected publication, including metadata/UI/audio.
- Independent Pillow decoding confirms actual pixel changes, not just different
  PNG encodings. Measurement space is **decoded PNG RGBA8 without colour-space
  conversion**, not rendered screen colour. `animal-skeleton/idle.png` has 1404
  changed nontransparent texels; example(59,4): `[136,120,88,255]`→`[140,121,90,255]`.
  `arbalester/attack-playercolor.png` has70028changed nontransparent texels;
  example(41,8): `[78,78,78,15]`→`[80,80,80,15]`. Corrected cached/fresh decoded arrays
  agree. This does not claim native GPU interpolation or battlefield pixel parity.
- The existing five fixture tests also pass dependency-boundary changes,
  namespace-independent multipage relocation, missing-page rejection, unchanged
  legacy migration and changed/unknown-schema rejection.

## Reproduce and limits

Maintained probe: `tools/probes/atlas_cache_benchmark.py`; usage and resource
requirements are in [probes](../../tools/probes/README.md). The successful command:

```sh
uv run --locked python -u tools/probes/atlas_cache_benchmark.py \
  --out .local/cache257-study-r2 --revision 0829ea9 \
  --resources-depot .local/monk119-recovery --stage-timeout 3600
```

Use a new output directory when reproducing. Receipts are under
`.local/cache257-study-r2/`: `report.json`, `publication-hashes.json`,
`pixel-evidence.json`, per-stage logs, exit files and GNU-time records. The
decoded-pixel verification was added after the timed study and run against its
unchanged exports with `--verify-pixels`; it does not require re-running or
reinterpreting the timing measurements.

This is one ordered x1 measurement on this host, not an x2 prediction, a repeated
statistical benchmark, a memory improvement or a physical-GPU/FPS claim. The
production decoder/cache implementation was not changed by this verification.

Checkpoint gate:1267 TypeScript tests/104 files,8 existing skips, build,
186 Python/owned tests and real-browser smoke GREEN in831s
(`.local/cache257-gate.log`). No fixture clock or assertion was weakened.
