# Islands: offshore fish correction and partial native calibration, 2026-10-06

## Runtime correction after the survey

**PASS for the bounded, versioned offshore-placement correction and requested
checks.** The complete native census and water-mask calibration remain blocked.

The coordinator authorized correcting the demonstrated coastal restriction,
without further native game work. New Islands matches now carry
**`mapgenVersion: 2`** and keep deep fish **away from** land rather than requiring
them to be near it. Arabia retains marker1 and its existing eleven-biome map;
other maps are unchanged. Record format9 selects the new Islands generation;
formats1–8 and marker-less saved Islands states retain the old map byte-for-byte.
Shared admission is9 so older clients must reload; checkpoint format stays5.
No saved state is regenerated or upgraded on resume. These changes are left
uncommitted for coordinator integration.

### What the source actually constrains

`tools/depot.py` resolved the owned root. `Islands.rms` defines
`GNR_STANDARDFISH` and includes `GeneratingObjects.inc`; its normal branch is:

| Constraint | Shore/MELKARYBA | FISH_A | FISH_B |
| --- | --- | --- | --- |
| Requested objects | 9999 | 6 | 170 |
| Scale to map size | No | Yes | Yes |
| Gaia only | Yes | Yes | Yes |
| Per-player pass/minimum/maximum player distance | None | None | None |
| Group spacing | Temporary6 | 4 | 8 |
| `max_distance_to_other_zones` | Absent | 4 | 4 |
| `terrain_to_place_on`, forest/cliff exclusion | Absent | Absent | Absent |
| DAT placement-side terrain | Beach2/35 | None | None |

The **owned TC Random Map Scripting Guide**, command
`max_distance_to_other_zones`, says it specifies how close objects can be to
other zones and is useful for keeping them away from shore/enemy ships. Its
SHA256 is `413b05469c3109ec9f287d80cf105ec9e916e2529f4223c4657c908105a50d5c`.
This independent source establishes the direction of the constraint, beyond
what the screenshots alone could prove. The bug was the `nearLand` name and
`coast[tile] === 1` acceptance in `mapgen.ts`, copied into the reference JSON,
extractor and coastal tests. The field is now named `zoneDistance`.

Pinned DAT69/455/456/458 all use terrain restriction19, allowing IDs
1/15/22/23/26/57/58/95/96/97/98/99/114/116/130. The generated Islands sea uses
1 and23, both permitted. There is **no source justification to require only
medium/deep terrain23**: shallow water may be valid if the zone clearance holds.
No invented TC-distance, forest, cliff or deep-water-only filter was added.

This is a **source-backed direction correction within the existing adapter**,
not exact native zone rasterization. It retains the full-square, four-tile
near-non-water mask, accepting its complement only for marker2. Samples outside
the board are ignored by that existing mask. Full-square versus eight compass
samples, land-zone versus final coast boundaries, native retry/RNG and count
rounding remain uncalibrated. The fish RNG, shuffled candidates, area/10000
nearest-integer quotas and per-species square spacing are unchanged. The
higher deep-fish count is a side effect of more offshore candidates filling the
existing quota (owned scaled request 6/170; adapter requests 9/245 on 120×120),
not a native count target; the area/10000 denominator itself is unvalidated
(the RMS guide scales relative to Large maps). Shore
fish and preceding terrain/resources are unchanged. Relic positions can change
in new maps: relics run later, and moving fish footprints away from land changes
the nav-grid candidate sequence. Their existing50-seed count/distance/path
contract and fifth-relic transport/deposit acceptance remain intact.

### Before/after distribution: identical generated seeds1–50

Euclidean distances are fish-centre to nearest non-water tile centre. Quantiles
pool all deep fish, not per-map summaries. Native statistics are **partial,
unpaired observations**, not an equivalent census; do not compare their censored
range as though it were a full native distribution.

| Measure | Legacy Islands | Corrected Islands | Native evidence |
| --- | --- | --- | --- |
| Deep fish/map | 58–67 | 82–99 | Placement-capacity side effect, not a native count target; complete native count unmeasured |
| Shore fish/map | 60–72 | 60–72, identical positions | Complete count unmeasured |
| All deep fish across50 seeds | 3096 | 4456 | Not comparable to marker subset |
| Land-distance range | 1–5.66 | **5–31.89** | Retained offshore subset7.5–38.6, roughly±2 |
| Distance p10 / median / p90 | 1 / 2.83 / 5 | **5.39 / 10.82 / 20.62** | Not measured |
| Per-map maximum distance | 5.10–5.66 | **22.47–31.89** | Subset maxima25.5–38.6 |
| Fraction farther than10 /20 /30 tiles | 0 /0 /0% | **54.53 /11.65 /0.067%** | Not measured |
| Deep fish beyond7 box tiles/map | 0 | 51–68 | Retained marker components26–34, not totals |
| Minimum per-species box spacing | FISH_A≥4, Snapper8 | FISH_A≥4, Snapper8 | Exact metric not calibrated |

The near-coast-only discrepancy is removed. The correction is **not tuned to
make the maximum equal38**: native rotated/grown islands and our mirrored land
adapter differ. Native full distance/count distributions and the water-mask
fit remain open under#95; native seasons/Whale/Gaia Dock remain#274.

### Correction verification

- Focused fish/mapgen/legacy/relic/naval, browser/headless replay initialization,
  headless replay suites, shared suites and dev-session: **191/191 passed**,
  20 files,76.83s. Includes the existing50-seed Islands relic constraints and
  public-command fifth-relic transport/deposit with JSON parity.
- Eight frozen pre-change whole-state digests at tick0/tick20 remain unchanged.
  `pre-offshore-islands-v8.json` was generated and independently replayed by
  untouched `94dc0ff` before editing; both periodic hashes still pass. Its
  checked-in bytes equal the pre-edit receipt. Relabeling old/new recordings
  across the v8/v9 boundary fails as intended. Both clients' JSON/rejoin and
  restart select the appropriate old/current policy.
- `npx tsc --noEmit -p .`: exit0. Read-only owned fish-reference comparison:
  1/1 passed. `npx vitest run --maxWorkers=4 > .local/full-vitest.log 2>&1`:
  **1319 passed,302 skipped**,136 passed/11 skipped files (147 total),
  **306.26s**, exit0. Skipped/opt-in tests are not claimed as exercised.
- All50 before/after receipts independently confirm identical shore objects,
  corrected deep-fish box clearance and per-species spacing; aggregate
  quantiles/checks are saved in `.local/native/comparison-summary.json`.
- Initial new-test failures were investigated, not waived: a proposed equality
  of new/old relic positions ignored nav-grid candidate changes, and equality
  of all entity fields across record versions ignored pre-v4 score receipts.
  Their corrected assertions retain relic outcome coverage and normalize only
  the historical score field. A second run found the native Euclidean offshore
  threshold incorrectly applied to box distance (seed7: box20, Euclidean26.25);
  the final test uses Euclidean distance for that comparison and box distance
  for zone clearance. No existing frozen hash, timeout or source threshold
  was changed.
- No further native game actions, import, owned checkpoint, deployment,
  restart, push or main integration. Runtime/reference/tests are uncommitted.
  Local receipts: `.local/islands-focused{,-r2,-r3}.log`, `islands-tsc.log`,
  `islands-source-test.log`, `full-vitest.log`; under `.local/native/`,
  `generated-{before,after}-50.json`, corresponding summaries,
  `frozen-islands-digests.txt`, `freeze-islands.mts`, `owned-rms-guide.txt`.
  Full-run handles are `.local/full-vitest.{pid,started,finished,exit}`;
  shell PID1810761 and Vitest PID1810783 exited. No correction worker job remains.

## Initial native survey outcome (before the correction)

**BLOCKED for the requested complete five-map fish census and water-mask fit.**
Five fresh native maps and a 50-seed generator sweep were obtained, with a
decisive counterexample to the current deep-fish coastal restriction. Counts
by native fish type, every fish's distance, per-island totals, global minimum
spacing and sub-three-tile channels were **not** fully measured. The partial
comparison below must not be presented as completion of #95.

Selected native **Snapper and Dorado** in sample N1 are approximately **28.8
and 18.7 tiles from land**, respectively. The pre-correction generator put every deep fish
within **four Chebyshev tiles**, at most **5.66 Euclidean tiles**, of non-water.
Even generous screenshot uncertainty cannot reconcile these observations.
The old near-land proxy was contradicted on owner-authorized build185872.

The initial survey made no runtime, reference-data or test changes. Its
observation alone did not establish the replacement zone predicate. The later
owned-guide read above establishes clearance direction, while leaving exact
rasterization, spacing metric, scaling/rounding, phase order and RNG open.

## Setup and provenance

- Installed DE **185872**, version101.103.54800.0, PID22012, not pinned48987.
  Fullscreen2560×1440, default zoom50%, UHD unchecked. Graphics were inspected
  after capture and left unchanged; no restart occurred.
- Single-player Skirmish: Default data, Random Map, **Islands**, Tiny(2 player)
  **[120]**, one human versus one Standard AI, All Visible, Standard resources
  and ages, Casual1.5. Random civilizations/All remained selected; Antiquity,
  Empire Wars, Regicide, cheats and Record Game were unchecked.
- Each game was launched through Main Menu → Single Player → Skirmish, never
  Play Again. Distinct coastlines, starts and resource-islet arrangements prove
  five distinct layouts. Numeric native seeds were not captured, so these are
  not reproducible or seed-matched native samples.
- F3 paused at00:10,00:05,00:06,00:06,00:05. These are early-start observations,
  **not tick-zero**. No orders were issued to units. World views were panned by
  minimap clicks while paused. N1 includes selected-object panels; N2–N5 each
  include north, centre and south world views, not an exhaustive world mosaic.
- The worktree was clean at base `1c316d8`; no cheap-worker partial diff,
  attempt log or failed-check artifact for this assignment was present.
  Inherited editor recipes and #130's archived skirmish screenshots/receipts
  were read. The inherited recipe text itself lacked the skirmish coordinates.

### Read-only source comparison

Pinned root was resolved with `uv run --locked python tools/depot.py`.
Its RMS directory is `depot_813784/resources/_common/drs/gamedata_x2`.
Installed source is at
`D:\SteamLibrary\steamapps\common\AoE2DE\resources\_common\drs\gamedata_x2`.

| File | Pinned versus installed |
| --- | --- |
| `Islands.rms` | Only `ai_info_map_type ISLANDS 0 0 0` → `ISLANDS 0 0` in normalized diff |
| `GeneratingObjects.inc` | Installed adds placeholder/revealer temporary-not-tracked attributes; standard fish block unchanged |
| `F_WaterMasking.inc` | Byte-identical SHA256 `5402213ba3fc704b39e3b8587c28f83aa140ec14488a0e8f6f0ed59e3ae74d0a` |
| `F_seasons.inc` | Differs substantially; separately checked spring/Mediterranean fish456/458/69 and desert455/458/69, identical in both |

Full hashes/diffs are in the local evidence, not copied owned scripts. This is
not a claim that every include, DAT value or engine behavior matches builds.

Both standard fish blocks request global Gaia shore fish9999 with temporary
spacing6, then scaled FISH_A6/FISH_B170 with spacing4/8 and
`max_distance_to_other_zones 4`. That field name does **not** establish “must
be near land.” The existing reconstruction in
[map-generation-design](map-generation-design.md#2-a-randomised-candidate-scan-for-objects)
instead describes a same-zone clearance check. The new offshore observation
supports investigating that interpretation, without validating its eight-point
sampling, boundary inclusivity or application to global Gaia passes.

The unchanged water include requests successive grown clumps and replacements,
not a direct five-tile distance transform. Source evidence alone does not
establish the resulting raster in unseedable pockets.

## Measurements

### Native coordinate estimate and selection control

Minimap crops have full-screen origin(2050,1185), size500×250. Approximate
diamond vertices are top(252,4), left(16,128), right(488,128), bottom(252,252).
For crop point(u,v), use `a=(u−252)/236`, `b=(v−4)/124`, then
`x=60(b−a), y=60(b+a)`. This is a local geometric frame, not decoded native
coordinates. Distances below use estimated tile centres, not fish footprint
edges. Budget approximately **±2 tiles per distance**, including coastline,
marker and diamond calibration ambiguity; no sub-tile precision is claimed.

N1's selected Snapper changed exactly the nine fish-colour minimap pixels
centred at(252,27); selecting Dorado changed the nine centred at(246,46).
Thus species identification is attached to a measured minimap marker, not
guessed from a nearby sprite. Nearest flat land/forest pixels give:

| Selected native object | Estimated tile(x,y) | Nearest-land Euclidean | Nearest-land Chebyshev |
| --- | --- | --- | --- |
| N1 Snapper | 11.13,11.13 | 28.8 | 26.1 |
| N1 Dorado | 21.85,18.80 | 18.7 | 18.4 |
| Pre-correction generator, all deep fish, seeds1–50 | Full coordinates retained locally | 1–5.66 | 1–4 |

The selected N1 Whale panel is separately retained; it is not counted as a
fish species. Installed Gaia DAT69/455/456/457/458/459 share minimap colour169
(signed−87), whereas Whale2625 has67. Palette169 is RGB(165,196,108); the
captured flat marker core is **sRGB(163,194,107)**. Colour cannot distinguish
shore fish, deep fish species, or similarly coloured resources on land.

### Five-map partial comparison

The local image probe retains isolated6–12-pixel fish-colour components more
than seven estimated Chebyshev tiles from recognized flat land/forest pixels.
It deliberately excludes ambiguous coasts, overlapping markers, camera-frame
occlusion and map-edge clipping. The cutoff is an **observation filter**, not a
placement rule. These are counts of offshore marker components, **not complete
deep-fish counts**. Every retained component has its pixel/tile position and
nearest-land distances in `native-marker-measurements.json`.

| Sample | Clock | Offshore fish-colour components retained | Their nearest-land Euclidean range | Minimum pair distance within this subset |
| --- | --- | --- | --- | --- |
| N1 | 00:10 | 32 | 8.3–38.6 | 4.14 |
| N2 | 00:05 | 26 | 8.3–28.2 | 4.48 |
| N3 | 00:06 | 34 | 8.0–38.1 | 4.31 |
| N4 | 00:06 | 26 | 8.8–29.6 | 4.03 |
| N5 | 00:05 | 29 | 7.5–25.5 | 4.48 |
| Pre-correction generator1–50 | tick0 | **0** beyond seven box tiles | All deep fish1–5.66 | All deep fish2–3.61 |

Native subset minima are **not global minima**, and species are mixed. They
cannot settle spacing4 versus8 or square versus circular exclusion. N1's
selected panels establish Dorado/Snapper; other sample species and exact season
IDs were not selected/read back. Vegetation appearance is not a season census.

### Exact pre-correction generator statistics

Sequential `createGame(seed, undefined, undefined, 'islands')`, seeds1…50,
against this worktree's source and fallback rules. All boards120×120;6,479
fish in total. Every fish's coordinate, species, nearest non-water tile-centre
Euclidean/box distance and nearest land ID are retained. Nearest-land ties use
row-major first occurrence; these are geographic associations, not ownership.

Ranges below are across maps; pair columns are the per-map minima. Cross-species
spacing need not equal either species' own pass spacing.

| Group | Count/map | Distance to land, all fish | Minimum pair Euclidean | Minimum pair box |
| --- | --- | --- | --- | --- |
| All fish | 122–137 | 1–5.66 | 1 | 1 |
| Shore | 60–72 | 1–1.41 | 6 | 6 |
| Deep combined | 58–67 | 1–5.66 | 2–3.61 | 2–3 |
| Snapper | 49–58 | 1–5.66 | 8–8.06 | 8 |
| Salmon or Dorado, season's FISH_A | 9 | 1–5.66 combined | See per-species receipts | See per-species receipts |

The species not selected by a generated map has zero objects. These observed
counts do not prove native rounding or requested-count fulfillment.

| Generated association with nearest land | Shore/map | Deep/map | All/map |
| --- | --- | --- | --- |
| Player land1 | 25–31 | 22–32 | 50–59 |
| Player land2 | 24–31 | 21–28 | 46–59 |
| Resource land20 | 4–7 | 3–7 | 8–13 |
| Resource land23 | 5–7 | 2–8 | 7–14 |

### Water/coast observations and missing outcomes

All five minimaps show irregular, lobed home-island coasts, two smaller central
islets, a lighter coast-following water band and a darker open body. World views
show curved/blended transitions following those irregular coasts, not isolated
perfect circles. **Appearance does not discriminate native clump growth from
our distance-transform approximation.** No quantitative native depth-mask fit
or confidently tile-counted water pocket narrower than three tiles was obtained;
this is not evidence such pockets are absent.

The generated boards have14–62 water tiles/map belonging to cardinal runs of
length1–2 bounded by non-water at both ends. This deliberately narrow diagnostic
includes concave shoreline nooks; it is **not a count of channels or connected
pockets** and has no validated native counterpart. Generated medium-water
counts are5,112–5,540 tiles. The existing water test still asserts the exact
five-tile box-distance rim, which is an adapter invariant, not native proof.

Unmet acceptance: complete native shore/deep/species counts; distance for every
native fish; per-player-island totals; whole-map minimum spacing; calibrated
sub-three-tile pocket/channel detection; numerical grown-mask comparison.
Do not fill these with the source's requested counts or the offshore subset.

## Initial survey checks and evidence

- `vitest run src/sim/islands-fish.test.ts src/sim/mapgen.test.ts --maxWorkers=1`:
  **45/45 passed**,2 files,28.37s. No assertions, thresholds or clocks changed.
  Importantly, the green fish test includes the now-native-contradicted
  “within four tiles” adapter assertion. Green here does **not** mean parity.
- Headless50-seed sweep and native marker probe exited0. No runtime edits,
  therefore no tsc/build was required or run. No owned checkpoint/import,
  deployment, push, main integration or application restart was performed.
- `gh issue view 95 --comments` failed on the known Projects GraphQL
  deprecation; `--json title,body,comments` succeeded. No acceptance failure
  was waived or concealed.

Local-only evidence lives in this durable worktree,
`.local/worktrees/issue-95-islands/.local/native/` (not committed assets):

- `islands-settings.png`, `islands-{2,3,4,5}-lobby.png`, `islands-options.png`:
  map/mode/size/reveal and unchanged graphics settings.
- `islands-N-paused.png` and `-crop.png`, N=1…5; `clocks.png` supplements full
  frames. N1 `offshore`, `coast`, `fish-a`, `fish-b`, `whale`; N2–N5 `north`,
  `center`, `south`; matching JSON receipts preserve PID/time/window bounds.
- `islands-N-offshore-labels.png`, `measure-markers.py`,
  `native-marker-measurements.json`, `native-marker-summary.txt`: explicitly
  partial pixel measurements, not maintained/public native-decoder tooling.
- `islands-stats.mts`, `generated-50.json`, `generated-summary.txt`:
  all6,479 generated fish and diagnostics. The probe ran via the main checkout's
  installed `node_modules/.bin/tsx`; no new Node dependency was installed.
- `source-comparison.txt`, normalized `*.diff`, `native-minimap-fields.txt`,
  `islands-tests.log`: read-only source and verification receipts.

Final `islands-options-cancel.png` verifies the main menu/build185872 after
leaving Options without changes. No running match, saved scenario, background
probe or controller remains. PID22012 is the owner's game and was not stopped.
The unrelated coordinator checkpoint observed at session start was untouched.

The remaining calibration needs a complete native object/terrain coordinate census or
an exhaustive, indexed world survey with species selections, then controlled
zone-clearance boundary fixtures. Preserve the offshore positive controls.
The versioned correction above preserves the old near-land assertion for
legacy maps and adds current clearance/spacing/offshore outcome coverage.
Do not silently reinterpret
this partial survey as a successful census or close #95/#274.
