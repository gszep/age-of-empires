# Agent handoff — mapping checkpoint

## Request and stopping point

The user asked for #134, then #176, then #160, and resumed the recommended
#148 shoreline work after a network outage. They explicitly requested updated
docs, a commit/push, and a handoff when that work was done. No further unattended
run is authorized. The earlier ten-hour performance run is historical; its
inventory and measurements remain in [the performance report](reviews/2026-09-23-performance.md).

Implementation base: `e415493`. This handoff accompanies the mapping checkpoint;
use `git log -1`, `git status` and `tools/session_start.sh` for the actual commit,
tree and gate state. Do not infer current service state from old PIDs.

## Delivered changes

- **#134, partial:** shared authoritative tile-level sampling for combat/view;
  ×1.25 downhill and ×0.75 uphill damage, including melee, missed projectiles,
  splash and piercing victims. Projectiles retain the launch point after the
  shooter disappears. Arabia global hills and Black Forest clearing/forest
  hills are deterministic and mirrored; surveyed relief now affects combat.
- **#176:** import DAT `hill_mode` into building rules. Flat-only TCs, one-level
  relief for ordinary buildings, unrestricted houses/farms/gates/towers. Public
  placement, preview and wall preview share the rule. Rejection does not spend
  or retask. Initial TC footprints are minimally levelled to their centre sample
  (needed at Windsor's two starts); source survey arrays are untouched.
- **#160:** world terrain and blend-overlay hillshade use `+dx-dy`, lighting
  screen-right slopes and shading left slopes. Projection, height data,
  altitude tone and shading strength are unchanged by this correction.
- **#148:** DE `watershore`, `waterwater`, `shallowswater` PNG alpha windows now
  supply water-boundary shapes. The importer publishes square mask sheets and
  source hashes; renderer UVs follow tile axes instead of the classic iso
  diamond. Land/farm paths and older manifests retain classic masks.
- **#125, decision resolved:** retain the Dark-through-Castle open fallback;
  no Imperial expansion planned. Both household computers have owned assets.

## Relevant files

- `src/sim/elevation.ts`, `game.ts`, `mapgen.ts` — sampling, damage, starting pads,
  construction checks and hill generation.
- `src/sim/data.ts`, `tools/import_content.py` — DAT hill-mode transport/defaults.
- `src/view/world.ts`, `assets.ts`, `tools/import_blends.py` — hillshade,
  square-vs-diamond mask UVs, owned-water mask import/selection.
- `src/sim/elevation{,-placement}.test.ts`, `src/view/world.test.ts`,
  `tools/test_import_aoe2.py` — gameplay, map, mesh and import regressions.
- `docs/ledger.md` — every approximation; `docs/status.md` — delivered scope.

## Verification and evidence

Final combined gate: **GREEN**, `.local/mapping-checkpoint-final-gate.log`, run
on **2026-09-24 from 00:11 +01:00** after final source review:
**728 Vitest tests / 55 files**, production TypeScript/Vite build, **92 Python/
import tests**, and the real-browser debug smoke. Run directly with
`VITEST_MAX_FORKS=3 VITEST_MAX_THREADS=3 tools/gate.sh` on the idle host.
No test clock/timeout has been widened. Only Markdown was edited after GREEN.

Maintained acceptance checks (all run through private Vite/browser fixtures):

- `tools/elevation_placement_smoke.mts`, including `OPEN_FALLBACK=1`: actual red
  invalid-slope preview/rejection/no spend, green ramp preview/paid rendered
  foundation. An initial probe raced the next render frame; it now waits for
  the foundation to be rendered rather than asserting immediately after input.
- `tools/world_relief_smoke.mts`: equal-height, identical-terrain world pixels;
  normalized linear-sRGB right-face factors 0.946/0.948, left 0.809/0.809. The
  pre-fix front pair were both ≈0.949. Geometry/UVs/checksum remain unchanged.
- `tools/minimap_relief_smoke.mts`: exact sRGB palette/fog pixels and state
  immutability, including the 392×392 board.
- `tools/shore_blend_smoke.mts`: production loader/geometry/material, all 31
  mask configurations, 775 linear-sRGB alpha samples; max source-sampling error
  **0.002**, 603 samples visibly differ from classic masks. State unchanged.
- Full owned regeneration completed with 1,984 sprite atlas entries reused;
  native mask publication is byte-identical on repeated generation.
- Islands geometry crops: `.local/probes/issue148-{before,after}/coast.png`.
  They supplement alpha measurements, not a matched-reference contour proof.

Named logs live under `.local/issue{134,176,160,148}-*`. The earlier #176 full
suite had 724 passes and one 150-second headless timeout while Windows was
running Cyberpunk at ~421% CPU. The unchanged test passed alone in 58.3 seconds.
The build, all then-current 90 import tests, and browser checks passed separately.
That failed gate is historical, not proof of the final checkpoint's result.

## Remaining work, evidence limits and next task

- **#134 stays open:** explicit cliffs/obstructions, exact engine elevation
  cleaning/topology, Arabia spawn-specific elevation and remaining map passes.
  Ordinary slopes are traversable; no invented slope speed or DEM cutoff.
- **#177:** extra/replacement town centers are independently disabled by
  `building('town-center', false)`. Inspect age/prerequisite rules before exposing
  the action; TC slope legality is tested directly, UI acceptance uses barracks.
- **#116/#113:** remaining DE land/farm shape families and visual calibration.
  Shore window locations and opposite/three-edge max-alpha unions are inferred,
  not a recovered engine UV table. The reference still differs in water/foam
  calibration (#94) and final compositing (#149).
- Base hill damage factors are community-sourced: DAT resources 211/212/272/273
  are civilisation modifiers, zero for Britons, not the base ±25% rule. Exact
  slope/corner construction behavior and minimal starting pads are also ledgered.
- **Suggested next mapping task: #93**, regenerate Windsor/Senlac surveys to
  remove pre-transpose spare clearings. Preserve orientation/source attribution,
  verify starting sites and compare the boards. Ask the user before starting.
  General bug-first priority still applies outside their chosen mapping focus.
- Physical-GPU/desktop FPS and pixel-identical DE coastline/lighting were not
  measured. Browser checks use SwiftShader; the editor lighting reference has
  no local image bytes or original height grid.

## Operations and constraints

- Ysgramor's managed shared host survived/restarted normally after the user's
  reboot; preserve its saved match, service and routes. Check live status before
  restarting anything. No deliberate deployment restart accompanied this work.
- Play: <https://ysgramor.tail6e864b.ts.net:5173/>; solo adds `?solo=1`.
  Artemis remains <http://localhost:5174/>. Its gateway proxies current code
  from Ysgramor but serves local assets. Re-run `npm run import:aoe2` in its
  active owned-assets runtime to receive `hillMode` and `blends.native`; this
  session regenerated Ysgramor only. Reload tabs after regeneration.
- Last documented Artemis active asset runtime:
  `/home/gszep/Documents/repos/age-of-empires/.local/performance-runtime-bebb06e/public`.
  Verify it before changing it; preserve older runtimes and local changes.
- The interruption was investigated read-only. Tests had finished at 19:48 BST;
  Windows logged a TP-Link USB Wi-Fi driver disconnect at 22:27, failed reconnects,
  and successful reconnection after the 23:16 restart. Intel Ethernet resets and
  DHCP failures predated this session and continued after reboot. No IP-conflict
  or resource-exhaustion event was found in the checked window. No network,
  driver, DHCP, DNS, firewall or Tailscale settings were changed.
- Do not commit owned/converted content, `.local/`, credentials or saved matches.
  Do not reset Tailscale, rewrite published history, or disassemble the game exe.
- No Paseo agent-launch tool/CLI is available in this session. This file is the
  self-contained receiving-agent briefing; no new agent is claimed to be running.
