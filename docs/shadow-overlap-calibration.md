# Native shadow overlap evidence (#288)

2026-10-06, installed DE 101.103.54800.0 (#185872), **not pinned 48987**.
2560×1440 fullscreen, default zoom 50%, UHD unchecked, shadows enabled.
No runtime code change. All colour values below are **sRGB screenshot bytes**,
not linear-light values. Native editor, flat grass, Teuton Feudal Watch Towers.

## Controlled same-pixel comparison

Two neighbouring 1×1 towers were placed with centres one diagonal tile apart
(48 screen px right, 24 down). Captured both, each separately, and bare terrain
with the editor's Delete tool (no rubble). Camera/zoom/terrain were unchanged.
All accepted captures have the placement grid off. ROI x=1580..1615,
y=625..645 is exposed terrain left of both building bodies, not their artwork.

| Pixel (x,y) | Bare terrain RGB | A only | B only | Both |
|---|---|---|---|---|
| 1600,635 | 161,175,81 | 54,59,29 | 109,119,56 | **44,47,24** |
| 1610,635 | 158,177,88 | 49,54,29 | 89,99,51 | **42,46,25** |
| 1600,645 | 168,173,86 | 82,85,44 | 103,107,54 | **49,51,28** |
| 1610,645 | 153,168,80 | 64,69,35 | 81,88,44 | **43,48,25** |

Within that conservative ROI, retain pixels where both single shadows lower
green by at least 15 and RGB attenuation ratios differ by less than .1 between
channels. All **603** retained pixels become more than 2 green bytes darker
than the darker individual shadow. Mean additional RGB darkening is
14.91/15.51/7.44; green range 5..51 bytes.

**Conclusion:** native exposed overlapping shadows can darken further. A strict
non-accumulating union (take the darkest single-shadow result) is contradicted
by this fixture. This does not identify the exact blend equation or justify any
arbitrary multiplicative implementation. In particular it does not settle
multi-part TC self-overlap policy or restore its missing cast-shadow asset.

## Private evidence

All files are in the durable #161 worktree's `.local/native/`:

- `shadow288-nearAB.png`, `shadow288-A.png`, `shadow288-nearB.png`,
  `shadow288-towerGround.png`: accepted full-window both/A/B/ground controls.
- Corresponding `-crop.png`: identical 50×40 ROI, origin (1570,615).
- `shadow288-nearAB-crop.png` was replaced by the measurement crop; use the
  full image to inspect complete tower geometry.
- `shadow288-measurements.json`: samples and aggregate results.
- Earlier house and horizontally separated tower attempts are retained but
  rejected: no established exposed overlap. Test mode with only houses ended
  in defeat; this evidence is explicitly the editor compositor, not that test.
- `speed-final-x-close.png` records the inherited graphics settings. No graphics
  settings were changed, and no game restart occurred.

East-Asian TC and an in-match repetition remain unmeasured. The compositor
finding is useful evidence against imposing a universal union rule, not full
acceptance for #288.
