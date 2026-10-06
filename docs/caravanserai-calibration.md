# Caravanserai native calibration (#269)

2026-10-06. **BLOCKED / partial:** healing and healing non-stacking observed;
speed increase/loss observed, but geometric boundary and speed stacking not
resolved. Short-route displayed payout comparison only. No runtime change.

## Scope and provenance

Measured on **current installed build 185872, not pinned 48987**, with owner
approval. Screenshot readings below are **observed visually**, except the
explicit pixel extraction. PID 22012; fullscreen 2560×1440; inherited UHD-off
settings unchanged. Single-player Scenario Editor Test, Imperial Persian P1,
Casual 1.5 displayed speed. No cheats or paid research. No scenario saved.
Final `cara-final-main-menu.png` verifies main menu/version; its JSON records
PID 22012 and rectangle `(0,0,2560,1440)`.

Durable evidence: `.local/native/` in worktree
`/home/fraser/repos/age-of-empires/.local/worktrees/issue-269-caravanserai`.
PNG originals, controller JSON receipts, DAT comparison text and test logs are
local evidence, deliberately **not committed owned assets**. Reproduction
coordinates are below; the local helpers are not shipped project tools.

At base `b43eae1`, `tools/import-spec.json` has no Persian profile or enabled
Persian civ. `src/sim/types.ts` has no Caravanserai kind, and `src/sim/` has no
Caravanserai implementation. `civilizations.ts` only admits loaded, enabled
profiles. The issue body's account of a bounded Persian integration is **not
the state of this checkout**; #186 remains the implementation work item.
The existing circular `updateHealingAuras` is for other mechanics, not a
Caravanserai adapter. `game.ts:updateTrader` still accumulates DAT work rate per
travel tick: this is the existing trade approximation, not native formula parity.
No new rule or regression expectation was invented for an absent feature.

The worktree started clean, without a partial diff or supplied cheap-worker
attempt/check log. Inherited recipes describe other calibration runs, not a
prior #269 failure. No acceptance tests were removed or weakened.

## DAT comparison (read-only, no import)

Resolved pinned depot with `tools/depot.py`. Compared against installed
`D:\SteamLibrary\steamapps\common\AoE2DE\resources\_common\dat\empires2_x2_p1.dat`
using locked genieutils. SHA-256:

| DAT | SHA-256 |
| --- | --- |
| Pinned | `ce3530df36cf0b333a9751cb0ff94460fe904f811feecec8ae9794701622b4cf` |
| Installed | `4aa2f0a719e88e5f1502517eddb27c669aeb40c2fe9d8c4f3eec7751c01e7baa` |

The files differ. Nevertheless, complete Persian civ8 unit records 1754
(Caravanserai), 128 (empty cart) and 204 (full cart) compare equal. Gaia's
complete 1754 record also compares equal. Both DATs enable Caravanserai through
tech552 for Persians (tech518 for Hindustanis), effect574. Both have task155
class19 rows with values1.2/60, range8 and flags5/4; footprint half-extents2/2.
These source flags do **not** independently establish native geometric anchors.
See `cara-dat.txt`, `cara-cart-types.txt`, `cara-source-comparison.txt`.

Opening tech223/effect212 and tech259/effect242 also compare equal in the
inspected dumps: first +50 resources91/92, then +50 resources0/1 after223.
No native standard-opening/Regicide lifecycle was exercised. Zero-resource
editor Tests are not evidence for or against either alias interpretation.

## Fixture and healing

Fixed Persian civ, not Random. Two editor Trade Cart (Empty) objects, first
at `(1280,700)`, second `(650,450)`; Villager `(1900,950)`. A single default-on,
non-looping Damage Object trigger subtracts50 from the first cart. Source A
placed `(1600,700)`, source B `(1100,500)`. These are placement clicks, **not
asserted world centres**. Separate fresh Tests preserve starting positions.

| Sources | Captures (`.png`) | Displayed clock | HP |
| --- | --- | --- | --- |
| A | `cara-heal-start` → `cara-heal-end` | 00:12 → 00:27 | 31/70 → 46/70 |
| A+B | `cara-two-heal-start` → `cara-two-heal-end` | 00:12 → 00:28 | 31/70 → 47/70 |
| B only | `cara-b-heal-start` → `cara-b-heal-end` | 00:12 → 00:27 | 31/70 → 46/70 |
| Neither | `cara-none-start` → `cara-none-end` | final 00:29 | 20/70 → 20/70 |

Both sources independently heal this recipient. Together they do not double
its healing. Readings support **1 HP/game-second = 60/minute** here; none reach
the70HP cap. Integer clocks/HP do not determine fractional cadence, pulse
phase, cap behavior, other recipients, diplomacy or capture/garrison semantics.

## Movement: positive signal, unresolved geometry

With only B present, the paused first cart receives a right-click move to
`(2350,700)`; repeat on the source-free fixture. `cara-race.ps1` locally resumes,
captures11 full frames, then pauses in `finally`. Its nominal500ms wait excludes
capture/save overhead: **frame indices are not game seconds**. Read each clock.
Camera stays fixed. `cara-{b,none}-race-{0..10}.png` and matching JSON retain
the samples; `cara-race-contact.png` is only a derived viewing aid.

Pixel extraction finds the selected cart's32px black health-bar outline;
`cara-race-positions.txt` records its left x. This is a stable screen-space
displacement marker, not a world-coordinate decoder.

| Run / frames | Displayed game seconds | Left x / displacement |
| --- | --- | --- |
| B, 0→3 | 27→31 | 1273→1726 /453px |
| No source, 0→3 | 29→33 | 1272→1656 /384px |
| B, 5→7 | 34→36 | 1991→2240 /249px |
| No source, 5→7 | 35→38 | 1912→2175 /263px |

Early displayed-clock displacement ratio453/384≈1.18 supports the DAT1.2
speed multiplier, but each clock endpoint is integer-quantized. Wall receipts
give early durations2.457/2.531s (about184/152px per wall second); late
durations1.640/1.771s (about152/149px per wall second). The speed advantage
disappears farther along the route. This is **not a precision1.2 fit**.

The transition lies in the sampled segment near bar-left x1726–1991. Building
placement snap, sprite anchor, recipient radius and refresh timing were not
resolved to world coordinates. Therefore these captures do **not** choose
square versus circle, centre versus footprint-edge distance, exact inclusion
at8, or an aura refresh interval. Two-source movement was not measured.

## Trade: bounded integer-display comparison

Delete the damage trigger. Keep Persian P1; add fixed Teuton P2, personality
None, with market `(2100,400)`; P1 market `(900,900)`. Only the first cart is
ordered to trade; the other cart and villager remain idle. Compare no source
against A at its original placement, with markets unchanged.

| Source | Captures | Displayed bank / carried |
| --- | --- | --- |
| None | `cara-trade-start`, `cara-trade-visible-end`, `cara-trade-bank-end` | bank0→3→7; middle carry3 |
| A | `cara-a-trade-start`, `cara-a-trade-scout-end`, `cara-a-trade-end` | bank0→3→7 |

This short route showed no displayed payout reduction with the aura. It is
consistent with unchanged payout per trip, **not proof of exact fractional
payout or the distance formula**: market-arrival events were not captured
individually and the3→7 increment warns against calling the payout exactly3.
The source-free initial roof click only moved the cart; retasking the now
visible market started trade. Consequently compare amounts, **not elapsed
times from Test start**. Longer-distance and precisely counted trips remain open.

## Rejected setup and tested coordinates

- First Test, with only carts/building, immediately defeated. `cara-one-paused`
  is rejected as gameplay evidence. Continue `(1280,960)`, add Villager, retest.
- Persian civ: Players, dropdown `(1207,1309)`, End, **reopen**, then
  `(1040,712)`. Inspect civ name. One-player selector and Imperial age use
  inherited recipes. P2 fixed separately to Teutons before trade comparisons.
- Units search Trade Cart: Empty row `(130,200)`; Buildings Caravanserai and
  Market each row `(130,200)`. Cart selection in Test `(1280,675)`.
- Damage Object quantity50; Set Objects→cart body `(1280,678)`. No fractional
  damage input. Delete the entire trigger before payout tests.
- Editor delete A at body `(1620,655)`, B at `(1135,465)`; verify disappearance.
- On the failed initial trade approach, cart ended near `(2130,300)`; select
  there and right-click visible market body `(2040,425)` to start trade.
  `cara-trade-visible-end` confirms bank/carry and movement, not just a click.

## Checks and remaining acceptance

- `npx vitest run src/sim/economy-strategy.test.ts --maxWorkers=1`: exit0,
  **12 passed, 1 skipped**, 41.07s on this host. Log `cara-vitest.log`.
  Skip: Dark-start AI progress acceptance requires `AI_PROGRESS_ACCEPTANCE=1`.
  No imported manifest exists in this tree; imported-only early-return branches
  in the suite did not establish owned-profile coverage.
- `npx tsc --noEmit -p .`: exit0; log `cara-tsc.log`.
- No runtime/tests changed; these are baseline checks, not new aura coverage.
- No owned checkpoint, import, push, service restart, integration or deployment.
  All native controllers exited; game PID22012 remains at the main menu.

Keep #269 open. Next bounded measurement needs surveyed world-coordinate
centre/edge/corner fixtures, a stationary boundary control plus a crossing
trace, one/two-source speed comparison, and longer counted trade deliveries.
Opening aliases, regeneration subsecond cadence/cap, capture/garrison and
Citadels are unmeasured. Native results from185872 do not certify pinned48987.
