# Arabia relic placement: native sample, 2026-10-06

## Result and scope

**PASS for the bounded five-map observational comparison; #130 remains open.**
Five distinct native Tiny Arabia layouts each contained five relics. All 25
white minimap markers were also inspected as relic objects in paused world views.
The observed TC distances, spacing and edge clearance are compatible with the
existing policy at screenshot precision. There is no decisive rule correction;
no runtime, reference-data or acceptance-test changes were made.

This does **not** resolve native RNG, tile shuffling, actor rasterization,
`find_closest`, zone semantics or land-phase ordering. It is not a pinned-build
48987 result, a seed-matched comparison, or a Black Forest/Islands calibration.

## Reference and method

- Owner-authorized installed DE **185872**, version101.103.54800.0, PID22012.
  Fullscreen2560×1440, UHD unchecked, default zoom50%, unchanged during capture.
- Single-player Random Map, Default data, Arabia, Tiny(2 player)[120], one human
  and one Standard AI, All Visible, Standard resources/ages, Casual1.5, no cheats,
  Empire Wars, regicide or antiquity mode. Civilizations remained Random/All;
  some games therefore have Chronicles civilizations. No commands were issued
  to units. F3 paused at displayed **00:06, 00:04, 00:03, 00:06, 00:06**.
  These are early-start observations, not tick-zero captures.
- Each accepted game was launched afresh through Main Menu → Single Player →
  Skirmish. The numeric native seeds were not exposed/recorded. Distinct TC,
  terrain and relic layouts establish five different generated maps, but these
  samples cannot be reproduced from a native seed. Record Game was off.
- One **Play Again** attempt repeated sample1. Its `relic-2-paused` captures
  are excluded; sample2 uses **`relic-2-new-paused`**. Do not count six samples.
- Full frames and minimap crops were retained. Each relic was inspected by
  panning approximately15 minimap pixels to its right, keeping it clear of the
  central pause banner. No screenshots were used to infer hidden land IDs.

### Source comparison

Read `tools/relic_reference.py`, `src/sim/refdata/relic-placement.json`, the
placement implementation/tests and #130 including its older, superseded comments.
The pinned extractor exactly matched the checked-in JSON (read-only execution;
no import). The installed source is under
`D:\SteamLibrary\steamapps\common\AoE2DE\resources\_common\drs\gamedata_x2`.

| Source | SHA256 / comparison |
| --- | --- |
| Arabia.rms | Both `dfd91bb5654955d1cd7554017dc165dd08bc9b9efbde081f212f80fb680d6500` |
| includes/object_setup.inc | Both `6ff96ba08c641605fe94d875bc0f99283ebff9ed636dccf8b1d1d87a787b89dc` |
| includes/relics.inc pinned | `1b171f724290485ad867d9c0624e6de0e695f6160a5621671ce6a6e98066265b` |
| includes/relics.inc installed | `37bf69ff1a3e291e84483f69053149ae0a369478efb4499eb22a832e3e6e4c18` |

The relic include differs: installed `avoid_actor_area RELIC[_CENTRAL]_CAA_A…E`
statements are conditional on those constants. Arabia declares none of those
custom CAA constants. Numeric BALANCED distances/counts and its placement flags
are unchanged. This is not proof that other source includes or engine behavior
match. Installed scaling.inc specifies Tiny120, base100 and side/base, so the
player edge expression is8×1.2=9.6 before native rounding.

## Measurements

All coordinates below are **estimates**, not decoded native coordinates.
Crop origin is full-screen(2050,1185), dimensions500×250. Approximate diamond
vertices in that crop are top(252,4), left(16,128), right(488,128), bottom(252,252).
For crop point(u,v), let a=(u−252)/236 and b=(v−4)/124. The local tile frame is
`x=60(b−a), y=60(b+a)`: x goes down-left, y down-right, origin at the top.
This is a local geometric frame, not a decoded native coordinate convention.
White-dot centroids determine relic positions; TC centers are estimated from
the colored base clusters. Budget approximately **±2 tiles per position and
±3 tiles per distance**, including marker/TC-center/diamond-boundary ambiguity.
Decimals preserve the calculation, not sub-tile accuracy.

### Per-map comparison

TC/pair distances are Euclidean; box spacing is Chebyshev. Edge distance is
`min(x,y,120−x,120−y)`. All values are tiles.

| Sample | Clock | Count | Minimum relic–either TC | Minimum pair | Minimum pair, box | Minimum edge | Forest observation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| N1 | 00:06 | 5 | 31.9 | 24.9 | 24.9 | 14.0 | All on clear ground |
| N2 | 00:04 | 5 | 32.4 | 31.7 | 29.2 | 9.6 | All on clear ground |
| N3 | 00:03 | 5 | 31.8 | 27.8 | 25.3 | 17.0 | All on clear ground |
| N4 | 00:06 | 5 | 32.6 | 29.4 | 28.7 | 10.0 | All clear; R4 near forest fringe |
| N5 | 00:06 | 5 | 31.5 | 41.6 | 33.7 | 10.6 | All clear; R1 near forest fringe |
| Generator seeds1–50 | tick0 | 5 each | 32.04–32.10 | 25.96–47.42 | 25–44 | 12.5–30.5 | Minimum tree-box clearance2–8 |

No relic was visibly inside dense forest. “Near” is qualitative, not a validated
one-tile adjacency predicate: world views show open ground between the object and
tree trunks, but do not identify the native forest-zone mask. Do not promote this
to a quantitative forest-radius calibration.

Generator medians of per-map minima: TC32.04, pair34.70, box30.0, edge15.5,
tree-box2.5. Native counterparts: TC31.9, pair29.4, box28.7, edge10.6.
The samples are small/unpaired and the native estimates have wider error bars
than the generator's entire TC-distance range; these are descriptive statistics,
not evidence of a significant distribution difference. A preliminary visual
guess put N2's southern relic below the edge cutoff; the calibrated diamond
transform gives9.6 instead. **No edge-rule contradiction is accepted.**

### Positions relative to both TCs

TC1/TC2 estimates respectively: N1(85.4,29.2)/(89.4,88.2),
N2(20.8,44.5)/(98.1,79.5), N3(27.5,74.6)/(82.6,93.0),
N4(31.5,86.1)/(101.5,79.9), N5(23.0,36.5)/(83.6,95.0).
R numbers run top-to-bottom in the minimap, not native placement order.

| Sample/relic | Tile(x,y) | Δ from TC1 | Δ from TC2 |
| --- | --- | --- | --- |
| N1 R1 | 54.4,17.7 | −31.1,−11.5 | −35.1,−70.4 |
| N1 R2 | 51.1,54.9 | −34.4,25.6 | −38.3,−33.3 |
| N1 R3 | 33.0,92.3 | −52.5,63.0 | −56.5,4.1 |
| N1 R4 | 57.8,92.7 | −27.6,63.4 | −31.6,4.5 |
| N1 R5 | 106.0,56.1 | 20.5,26.9 | 16.5,−32.0 |
| N2 R1 | 46.6,24.6 | 25.8,−19.9 | −51.4,−54.9 |
| N2 R2 | 10.4,75.2 | −10.4,30.8 | −87.7,−4.3 |
| N2 R3 | 58.9,53.8 | 38.1,9.3 | −39.2,−25.7 |
| N2 R4 | 105.5,47.8 | 84.7,3.4 | 7.5,−31.7 |
| N2 R5 | 107.7,110.4 | 86.9,66.0 | 9.6,30.9 |
| N3 R1 | 29.7,42.4 | 2.2,−32.2 | −52.9,−50.6 |
| N3 R2 | 62.3,59.1 | 34.8,−15.5 | −20.3,−34.0 |
| N3 R3 | 91.5,43.5 | 64.0,−31.1 | 8.9,−49.6 |
| N3 R4 | 44.1,102.5 | 16.5,28.0 | −38.5,9.5 |
| N3 R5 | 103.0,68.7 | 75.5,−5.8 | 20.4,−24.3 |
| N4 R1 | 13.9,58.2 | −17.5,−28.0 | −87.6,−21.8 |
| N4 R2 | 43.8,48.6 | 12.3,−37.5 | −57.7,−31.3 |
| N4 R3 | 76.0,59.1 | 44.6,−27.1 | −25.5,−20.9 |
| N4 R4 | 60.2,103.7 | 28.7,17.6 | −41.3,23.8 |
| N4 R5 | 88.9,110.0 | 57.4,23.9 | −12.6,30.1 |
| N5 R1 | 42.4,10.6 | 19.3,−25.9 | −41.2,−84.4 |
| N5 R2 | 18.1,68.5 | −4.9,32.0 | −65.4,−26.5 |
| N5 R3 | 56.0,49.9 | 33.0,13.4 | −27.5,−45.1 |
| N5 R4 | 51.9,92.8 | 28.9,56.3 | −31.7,−2.2 |
| N5 R5 | 101.1,68.8 | 78.0,32.3 | 17.5,−26.2 |

## Policy interpretation and remaining work

- **Counts:** five in every native/generated sample, consistent with1+2/player.
  Screenshots do not expose which player pass placed a relic.
- **TC distance:** roughly32 for the closest relic in every map, compatible with
  circular32 for player relics. Apparent31.5 is within measurement uncertainty,
  not grounds to relax the existing test.
- **Central:** N1R2, N2R3, N3R2, N4R2, N5R3 are candidates compatible with the
  current analytic neutral area and central box-distance32. Their identity is
  inferred, not observed placement order. Additional player relics may also lie
  in the neutral area: the generator has1–3 relics there, not necessarily one.
- **Spacing:** measured minimum box spacing24.9–33.7 is consistent with24;
  it cannot settle square versus circular actor masks or boundary inclusivity.
- **Edge:** observed9.6–17.0 is compatible with player9.6/central4. Neither
  fractional-expression rounding nor a universal native minimum is established.
- **Forest/zone/path/cliff:** all objects visually accessible on open ground;
  no native path orders, forest masks, land/zone IDs or cliff distances were
  measured. Existing generated constraints pass, but native equivalence does
  not follow. Cliff exclusion remains vacuous in our runtime (#134).
- **RNG/orientation:** native starts visibly rotate; ours retains its documented
  horizontal mirrored layout. No attempt was made to fit native RNG or remove
  that known approximation from five unpaired maps.

Follow-up on #130 should use recorded numeric native seeds and decoded or
otherwise independently established coordinates/zone masks, then controlled
boundary fixtures. The screenshot corpus alone cannot close that issue.

## Checks, evidence and handoff

Worktree: `.local/worktrees/issue-130-relics`, base `1c316d8`. It was clean on
arrival: no partial diff or cheap-worker attempt/failing-check artifact for this
issue was present. Inherited native recipes were read; they contained editor
recipes but no tested skirmish recipe. Navigation was verified from captures.

Ignored, local-only evidence under this worktree's **`.local/native/`**:

- `relic-settings.png`, `relic-{3,4,5}-lobby.png`: mode/size/reveal settings.
- `relic-{1,3,4,5}-paused.png`, `relic-2-new-paused.png` and matching
  `-crop.png`: five full starting frames and minimaps.
- `relic-N-r1.png` through `relic-N-r5.png`, N=1…5:25 full world views;
  `relic-N-worlds.png` are supplementary montage crops, not replacements.
- `native-measurements.json`, `native-table.txt`, `measure.py`: pixel inputs,
  transform and derived measurements. These are local experiment receipts,
  not maintained/public tools.
- `generated-50.json`, `relic-stats.mts`: sequential `createGame(seed, undefined,
  undefined, 'arabia')` for seeds1…50, TC/relic coordinates and minima using
  `Math.hypot`, `boxDistance`, edge distance and nearest tree-box distance.
  Executed through the main checkout's installed `node_modules/.bin/tsx` against
  this worktree's source. The initial worktree-relative binary lookup failed
  because this worktree has no node_modules; no dependency install was needed.
- `pinned-policy.json`, `relic-source.diff`, `issue-130.json`: read-only source
  comparison and issue snapshot. No owned files/images are committed.
- `relic-tests.log`: `vitest run src/sim/relic-placement.test.ts --maxWorkers=1`
  **22/22 passed**,73.51s; includes the existing50-seed constraints for all three
  RMS maps and six-map deterministic/JSON continuation coverage. No tests,
  clocks or thresholds were weakened. No runtime edit, so no tsc/build required.
- `relic-options.png`: unchanged fullscreen/UHD settings. Final
  `relic-final-menu-restored.png`: main menu/build185872, no running match.
  Native-control JSON receipts retain timestamps, PID and2560×1440 bounds.

No import, owned checkpoint, push, deployment, main integration, application
restart, scenario save or lingering worker process. PID22012 remains the owner's
game at its main menu. The unrelated coordinator checkpoint seen at session
start was not controlled. `gh issue view --comments` failed on the known Projects
GraphQL deprecation; `--json body,comments` succeeded. No issue closure claim.
