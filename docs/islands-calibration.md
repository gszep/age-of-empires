# Islands: partial native calibration, 2026-10-06

## Outcome

**BLOCKED for the requested complete five-map fish census and water-mask fit.**
Five fresh native maps and a 50-seed generator sweep were obtained, with a
decisive counterexample to the current deep-fish coastal restriction. Counts
by native fish type, every fish's distance, per-island totals, global minimum
spacing and sub-three-tile channels were **not** fully measured. The partial
comparison below must not be presented as completion of #95.

Selected native **Snapper and Dorado** in sample N1 are approximately **28.8
and 18.7 tiles from land**, respectively. Our generator puts every deep fish
within **four Chebyshev tiles**, at most **5.66 Euclidean tiles**, of non-water.
Even generous screenshot uncertainty cannot reconcile these observations.
The current near-land proxy is contradicted on owner-authorized build185872.

No runtime, reference-data or test changes were made. The observation rejects
the existing proxy; it does not establish the exact replacement zone predicate,
spacing metric, scaling/rounding, phase order or RNG. In particular, merely
inverting `nearNonWater(..., 4)` would introduce another uncalibrated rule.

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
| Generator, all deep fish, seeds1–50 | Full coordinates retained locally | 1–5.66 | 1–4 |

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
| Generator1–50 | tick0 | **0** beyond seven box tiles | All deep fish1–5.66 | All deep fish2–3.61 |

Native subset minima are **not global minima**, and species are mixed. They
cannot settle spacing4 versus8 or square versus circular exclusion. N1's
selected panels establish Dorado/Snapper; other sample species and exact season
IDs were not selected/read back. Vegetation appearance is not a season census.

### Exact generator statistics

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

## Checks, evidence and bounded handoff

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

The next useful step is a complete native object/terrain coordinate census or
an exhaustive, indexed world survey with species selections, then controlled
zone-clearance boundary fixtures. Preserve the offshore positive controls.
Replace the known-false near-land assertion only alongside a source-supported
rule and new outcome coverage; retain determinism, species, non-fish stability,
resource-islet shore coverage and spacing checks. Do not silently reinterpret
this partial survey as a successful census or close #95/#274.
