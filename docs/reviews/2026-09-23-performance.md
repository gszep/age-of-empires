# Run report — 2026-09-23 07:35 BST

Started from `1f9913f` (2026-09-22 21:42); head is `15de1d5`.
Commits: **14**, all pushed: yes.

This generated inventory precedes the final documentation handoff commit.
Authorized window: 2026-09-22 21:54:39 through 2026-09-23 07:54:39 +01:00.
No approval prompts blocked the run.

## Measured outcomes

| Area | Before → after | Evidence and scope |
|---|---|---|
| HD fleet sprite footprint | 3,881,869,760 → 874,990,464 bytes | Estimated RGBA pages, not whole-process RAM; GPU textures 128 → 65; rendered pixels identical |
| Artemis base fleet footprint | 1,014,989,440 → 228,268,096 bytes | Same x1 pixel/texture-count comparison on Artemis |
| Simulation stepping | 50.087 → 34.025 s | Three imported 12,000-tick matches, seeds 3/7/19; raw-JSON state hashes identical every 1,000 ticks |
| Large-map short searches | 542 → 24 ms | 2,000 uncached short A* routes on 392×392; exhaustive paths and full-match state preserved |
| Cold Three.js module | 2,552,483 → 445,736 bytes | Brotli; gzip 474,805 bytes; decoded bytes identical |
| Shared Windsor snapshot | 3,162,658 → 95,679 wire bytes | Actual private transfer to Artemis; decoded JSON/SHA identical; observed 4.504 → 1.501 s |
| Preview/restart geometry | +3 / +19 per action → flat | Actual controls; imported 38 geometries, fallback 15 |

The initial 10-second warm grace caused repeated worker-trip reloads. The
measured 60-second policy reduced seven-minute evictions 586 → 44, at a
1,051 → 1,459 MiB sprite-footprint cost. Mean JS frame work fell 17.14 → 9.61 ms
in those windows. The budget is soft; current art can exceed it.

## Sustained browser evidence

Final uninterrupted run: **04:57:20–07:34:00 +01:00**, **156.67 minutes**,
exit **0**, **156 samples**. Real renderer, normal cache clock, public AI
commands for both seats, and actual menu/speed/camera controls.

| Map / seed | Speed | Last tick | Ending |
|---|---:|---:|---|
| Black Forest / 3 | 2× | 31,747 | Victory |
| Senlac / 4 | 10× | 36,502 | Victory |
| Arabia / 5 | 1.5× | 36,198 | Tick limit |
| Windsor / 6 | 2× | 29,112 | Wall-clock limit |
| Black Forest / 7 | 10× | 33,221 | Victory |
| Senlac / 8 | 1.5× | 29,698 | Victory |
| Arabia / 9 | 2× | 26,981 | Victory |
| Windsor / 10 | 10× | 35,656 | Victory |
| Black Forest / 11 | 1.5× | 32,960 | Partial at cutoff |

- **Zero page/asset errors and zero invalid-binding samples.** Eight workloads
  ended: six victories and two explicit limits; the ninth was partial.
- Estimated sprite footprint peaked **3,329.88 MiB**, ending **2,065.58 MiB**.
  **4,135 evictions** completed. Available host memory stayed above **9.14 GiB**.
- JS heap peaked **843.57 MiB**, ending **177.30 MiB**; this is not total RSS/VRAM.
- Three samples had pending body pages, at most three bodies. This does not
  establish on-camera absence or zero first-use pop-in.
- Windsor seed 10 at diagnostic 10× had a worst sampled step p95 of
  **189.1 ms**. A later 200-step snapshot replay did not reproduce the earlier
  spike, but a final first-7,000-tick replay with the browser's AI cadence did:
  p95 125.37 ms, 464 ticks above 50 ms. A* search/frontier work dominated the
  CPU profile. The triggering queries and optimization remain **#175**.

The initial extended runs failed on Three r180's disposed sampler-template
lifetime. They remain **failed** evidence. The exact error was reduced to
A→B→dispose A→new B and fixed by texture-lifetime cache keys (#172). Basic/ramp
pixel regressions, an eight-minute run with two natural victories, and a
separate 30-minute Windsor workload preceded the final run above. Other
segments were deliberately interrupted for diagnosis or idle-host gates.
Raw final evidence: `.local/performance-soak-final.log` and its exit file;
maintained workload: `tools/performance_soak.mts`.

## Deployment and verification

- Latest implementation gate: **683 Vitest tests across 53 files**, build,
  **89 Python/import tests**, and real-browser debug smoke, all green.
- Artemis's isolated base runtime passed its gate: 681 Vitest, build/browser,
  88 Python/import passes plus one optional Enhanced Graphics Pack test skipped
  because that pack is absent. Its live manifest now has 117 entities, no
  redundant source/frame/layer URLs and garrison flags for 13 entities.
- Shared-play checks covered clicks, guest reload, snapshot recovery, 1,500+
  ticks without unintended resyncs, local artwork and host restart.
- Ysgramor's host was restarted onto the optimized implementation. Both managed
  services are active with zero automatic restarts. Artemis's normal gateway
  negotiated DEFLATE in a handshake-only check without joining a match.
- Final process inspection found no temporary local browser, Vite, import or
  test jobs. Managed household services deliberately survive. Artemis's main
  clone local changes and earlier asset runtime were preserved.

## Commits
- `dd4e578` Evict unused sprite pages and preserve frozen fog art (#152)
- `6c654a9` Compress host modules for cold remote loads (#154)
- `a2bc58e` Share identical source atlases across sprite animations (#162)
- `b3018bc` Dispose retired entity and building preview views (#164)
- `c5fa471` Index live entities during fog-memory validation (#165)
- `312ed17` Reuse bounded A-star workspace across path searches (#166)
- `4c5345e` Reuse gather targets within each worker update (#167)
- `1a9e5a1` Fast-path resource nodes in entity-kind guards (#168)
- `2e11a1c` Report run windows and latest gate evidence accurately (#159)
- `ca870a1` Measure sustained browser performance and residency (#169)
- `bebb06e` Keep recurring worker animation pages warm under pressure (#170)
- `7090c7c` Refresh Artemis base-asset runtime with shared atlases (#171)
- `d1edf32` Keep sprite sampler caches valid across texture eviction (#172)
- `15de1d5` Compress shared snapshots without buffering tick traffic (#174)

## Issues closed since 2026-09-22T20:54:39.000Z
- #152 Sprite pages are never evicted; a long match at x2 accumulates gigabytes of texture
- #154 Cold Artemis loads stall on an uncompressed 2.55 MB Vite dependency chunk
- #159 Morning report miscompares time zones and reports a stale default gate
- #162 Share identical sprite atlases to reduce active texture residency
- #164 Removed entity and placement views retain GPU geometry/material allocations
- #165 Fog-memory validation repeatedly scans the full entity array each tick
- #166 Reuse A-star scratch storage instead of allocating a full board for every search
- #167 Resolve a gather order target once instead of repeatedly scanning every entity
- #168 Fast-path resource nodes in hot entity-kind classification
- #169 Add sustained real-browser performance and texture-residency measurements
- #170 Sprite cache pressure churns normal gathering animations
- #171 Refresh Artemis isolated base-asset runtime without overwriting its dirty clone
- #172 Disposed sprite pages invalidate cached sampler bindings and stop rendering
- #174 Compress large shared-match snapshots without buffering ordinary tick traffic

## Issues opened since 2026-09-22T20:54:39.000Z
- #162 [enhancement] Share identical sprite atlases to reduce active texture residency
- #163 [enhancement] Evaluate block-compressed sprite uploads with PNG fallback
- #164 [bug] Removed entity and placement views retain GPU geometry/material allocations
- #165 [enhancement] Fog-memory validation repeatedly scans the full entity array each tick
- #166 [enhancement] Reuse A-star scratch storage instead of allocating a full board for every search
- #167 [enhancement] Resolve a gather order target once instead of repeatedly scanning every entity
- #168 [enhancement] Fast-path resource nodes in hot entity-kind classification
- #169 [enhancement] Add sustained real-browser performance and texture-residency measurements
- #170 [bug] Sprite cache pressure churns normal gathering animations
- #171 [enhancement] Refresh Artemis isolated base-asset runtime without overwriting its dirty clone
- #172 [bug] Disposed sprite pages invalidate cached sampler bindings and stop rendering
- #173 [bug] Composite ship contour layers stay disabled because atlasKey is never assigned
- #174 [enhancement] Compress large shared-match snapshots without buffering ordinary tick traffic
- #175 [enhancement] Investigate Windsor seed 10 simulation spikes during 10x fast-forward

## Still open, bugs first
- #113 Water and terrain blending do not yet meet the 2026-09-18 mandate
- #119 The monk draws no occlusion contour: its outline layers fail the decoder's walk invariant
- #148 Water's edge: the shore outline runs along tile diagonals; DE's blend-shape atlases are unwindowed
- #160 World terrain hillshade still lights both front faces unlike the editor reference
- #173 Composite ship contour layers stay disabled because atlasKey is never assigned

## Tests and gate
latest run started 2026-09-23T03:47:14.523Z: green; log /home/fraser/repos/age-of-empires/.local/snapshot-compression-gate.log
- test files changed: 8
- timeout/clock-related added diff lines (review candidates, not a count of widened clocks): 5

## Ledger rows added
- | Sprite page residency | 512 MiB soft budget, 60 s warm grace, 120 s idle expiry, 1 s sweep; scene requests override the budget, terrain/water pinned | **chosen** application memory policy, not DE runtime constants. #170's normal-gathering soak increased grace from 10 s: 586 → 44 evictions over seven-minute windows, at 1,051 → 1,459 MiB resident sprite data. Owned x2 dimensions supply byte estimates. Off-camera and remembered art remain active; expired art may be absent during PNG reload. Compressed upload remains #163 | `sprite-residency.ts` | #152, #170 |
- | Shared snapshot compression | negotiate permessage-deflate for snapshots ≥1 KiB, no context takeover; ordinary server ticks/settings/errors stay plain | **chosen** transport policy using the existing `ws` implementation and its default compression level, not DE networking behaviour; extension opt-out preserves the same raw JSON protocol | `src/shared/snapshot-compression.ts`, `server.ts` | #174 |

## Not verified

- Physical-GPU/desktop FPS was not measured; browser rendering used Chrome
  SwiftShader. Network timings are observations, not bandwidth guarantees.
- Sprite footprint estimates are width × height × RGBA8 bytes, not total RSS
  or physical VRAM, nor a hard 512 MiB cap.
- The two ledger policies above are chosen engineering policies, not read DE
  runtime constants. Simulation values and rendered source pixels were retained.
- **No existing fixture clock or timeout was widened.** The generated diff-line
  count includes new bounded transport waits, not widened test limits.
- The first outline-only hypothesis did not solve the sampler failure; binding
  instrumentation and the exact renderer reproduction followed. Earlier failures
  are retained, and no half-shipped feature was left in the tree.
- GPU-compressed sprite uploads remain **#163**; composite ship contour layers
  remain **#173**; the seed-specific fast-forward spike remains **#175**.
- First-use/expired-page loading can still be visible. Original Microsoft assets,
  saves, private failure snapshots and local logs were not committed.
