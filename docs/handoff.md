# Agent handoff — 2026-09-23

## Completed request

The human authorized a **ten-hour autonomous performance run**, starting with
#152. Window: **2026-09-22 21:54:39 → 2026-09-23 07:54:39 +01:00**.
Live unattended preflight/read/write/shell/GitHub probes passed; no approval
prompt blocked the run. Implementation base `1f9913f`, implementation checkpoint
`15de1d5`; all 14 implementation/tooling/deployment commits were gated as
required and pushed. This documentation handoff follows them.

The generated inventory, measurements, failed-run findings and verification
limits are in [the run report](reviews/2026-09-23-performance.md).

## Delivered performance changes

- **Sprite memory (#152/#162/#170):** lazy pages expire, identical source/frame/
  layer atlases share URLs, and warm retention avoids churn between worker trips.
  Policy: 512 MiB **soft** budget, 60 s warm grace, 120 s idle expiry; current
  scene art may exceed the budget. HD fleet estimated RGBA footprint fell
  **3.88 GB → 875 MB**, with identical pixels; GPU textures **128 → 65**.
- **Renderer lifetime (#164/#172):** retired entity/preview geometry and materials
  are disposed; texture-lifetime builder keys avoid Three r180's cleared sampler
  template; unavailable contours cannot revive expired bindings. Actual preview/
  restart geometry counts now stay flat. Basic/ramp pixels remain identical.
- **Simulation (#165–168):** invocation-local fog-memory lookup, reusable bounded
  A* workspace, one gather-target lookup per update, resource-kind fast path.
  Three 12,000-tick imported traces remain byte-identical; total stepping time
  **50.087 → 34.025 s (32%)**. Full Windsor terminal state also matches.
- **Loading (#154/#174):** HTTP gzip/Brotli for host modules; negotiated snapshot-
  only WebSocket DEFLATE. Three.js chunk **2.55 MB → 446 KB**. Actual Windsor
  snapshot **3.16 MB → 95.7 KB wire bytes**, with identical decoded JSON/SHA.
  Ordinary tick/control messages remain plain and extension opt-out works.
- **Tooling (#159/#169):** accurate timestamp/pagination/latest-gate reporting;
  sustained browser workloads with metrics, full error stacks and failure
  snapshots. The old open-ground pathing fixture now discovers a clear route.

## Verification

Latest implementation gate: `.local/snapshot-compression-gate.log`, **GREEN**,
started **2026-09-23 04:47:14 +01:00**:

- **683 Vitest tests / 53 files**;
- TypeScript/Vite build;
- **89 Python/import tests**;
- real-browser debug smoke.

Only Markdown changed afterward. Use `.local/gate.latest.json` or
`tools/session_start.sh` for the current gate record. **No existing fixture
clock or timeout was widened.**

Final uninterrupted browser run: **156.67 minutes**, **156 samples**, all four
maps and 1.5×/2×/10× speeds, **exit 0**. Eight workloads ended (six victories,
one tick limit, one wall-clock limit), plus one partial at cutoff. **No page/
asset errors or invalid-binding samples**. Available host memory stayed above
**9.14 GiB**; 4,135 evictions completed. Three samples had pending body pages,
so zero first-use pop-in is not claimed. Earlier failed/interrupted segments
remain explicitly separate in the report.

Maintained acceptance tools include `sprite_residency_smoke.mts`,
`atlas_sharing_smoke.mts`, `view_lifecycle_smoke.mts`,
`outline_residency_smoke.mts`, `sampler_residency_smoke.mts`,
`compression_smoke.mts`, `shared_smoke.mts` and `performance_soak.mts`, all under
`tools/`. `tools/probes/sim_performance.mts` records/compares full-state traces.

## Deployment and retained state

- Ysgramor's managed host is **active**, **NRestarts=0**, restarted onto the
  optimized code. No saved shared checkpoint existed at restart; the pristine
  host was retained. A handshake-only Artemis check negotiated compression
  without joining a match. Existing routes and ports are intact.
- Play: <https://ysgramor.tail6e864b.ts.net:5173/>; solo adds `?solo=1`.
  Artemis continues at **http://localhost:5174/**. Reload a page to fetch the
  refreshed manifest and current code.
- Artemis's active base-asset runtime is
  `/home/gszep/Documents/repos/age-of-empires/.local/performance-runtime-bebb06e/public`.
  It has 117 entities, shared atlas URLs and garrison metadata for 13 entities.
  Full base gate and fleet/garrison pixel checks passed. The optional Enhanced
  Graphics Pack-only test was skipped there (88 Python passes, one skip).
- Artemis's earlier `.local/shared-runtime/public` and main-clone local changes
  remain intact. Its gateway always fetches application code from Ysgramor;
  the runtime directory's commit label does not pin that proxied browser code.
- The old archived match remains at
  `.local/shared-match-expired-20260921-2137.json`. No saved matches or owned
  assets were committed. Shared-match expiry standing permission and setup are
  in `docs/shared-play.md`.
- Process inspection found no temporary local browser, Vite, import or test
  jobs. Both managed household services deliberately survive. Recheck process/
  service state at the next session rather than trusting historical PIDs.

## Remaining work and limits

- **#175:** Windsor seed 10 at diagnostic 10× had step-p95 spikes up to 189.1 ms
  and still finished a victory. Replaying the first 7,000 ticks with the browser's
  AI cadence reproduced p95 125.37 ms / 464 ticks above 50 ms. A* search/frontier
  work dominated the profile; identify the triggering queries before optimizing.
- **#163:** GPU block-compressed sprite uploads remain unimplemented. The cache
  budget is soft, and footprint estimates are not total RSS/VRAM measurements.
- **#173:** composite ship contours check an unassigned `atlasKey`; this separate
  visual gap was filed with code evidence. **#119**'s monk decoder issue remains.
- Physical-GPU/desktop FPS was not measured; browser checks used SwiftShader.
  Network timings are observations, not fixed guarantees. Cache and transport
  thresholds are chosen engineering policies recorded in the ledger.
- General human-filed visual bugs **#160/#148/#113**, ram crew bonuses **#161**,
  and other gameplay/content work remain in the tracker. This run did not
  authorize a further unattended window beyond its deadline.
