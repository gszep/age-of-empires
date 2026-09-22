# Agent handoff — 2026-09-22

## Checkpoint and next action

The human requested **#96**, supplied the editor elevation reference, then
requested **#137** and a next-issue recommendation. Both implementations are
verified. The final request was to commit the pending changes, update docs and
prepare this handoff. Checkpoint base: `1b17202`; the implementation commit is
named **“Complete garrison controls and minimap relief (#137, #96)”**.

**Recommended next: #161 — infantry speed/attack bonuses for occupied rams.**
Carrying, capacity, unloading and flags now work. Owned help strings
26094/26289/26446 explicitly describe crew bonuses, but the per-passenger
constants and villager participation need patch-matched evidence. Test actual
travel distance and building HP loss, unload reversal and replay determinism.
This is a recommendation, not authorization for another autonomous run.

Other live follow-ons: **#160** world terrain hillshade still uses the old
lighting axis; **#159** morning-report timestamp/gate reporting; **#148/#113**
water/shore fidelity. The monk outline decoder remains blocked under **#119**.
The tracker, not this summary, is the complete queue.

## Delivered

### #96 — minimap relief and woods

- Terrain consumes its imported light/flat/dark `minimapShades`.
- Live and remembered woods use the owned Forest palette, flat sRGB
  **(21,118,21)**, replacing the old scaled-image sample **(41,140,33)**.
- The human's 2000×1125 editor screenshot corrected the provisional axis to
  **screen-right lighting**, `dHeight/dx - dHeight/dy`. Four-face hill tests
  pin both front and both back faces. The attachment is indexed in
  `.local/reference/index.md`; raw image bytes/height grid are unavailable.
- Palette cache refresh, fog/reveal, fallback/old manifests, neutral plateaus
  and 392×392 buffers are covered. Exact diagonal/corner classification,
  equal gradient weights and tree-overlay binding remain documented inferences.
- `src/view/world.ts` was not changed to match this axis; that is **#160**.

### #137 — garrison controls and feedback

- Town bell uses owned cell **14**, icons **49/61**, text/help and start/stop
  audio. It recalls the nearest eligible workers up to reserved free capacity,
  remembers jobs/routes, and restores them on release. Later player orders
  supersede recall; dead workers are not restored; manually sheltered units stay.
- Self-rally production holds newly trained units at the DAT capacity. Type-0
  buildings refuse outside returning units; overflow emerges outside.
- Battering/Capped Rams carry **six** infantry/villager passengers, reject
  archers/cavalry, move with cargo, unload on passable land and release on
  destruction where an exit exists. The HUD displays capacity.
- Garrison flags resolve `creatable.garrison_graphic` through owned graphic
  deltas, with per-age offsets, x2 scale and player-colour masks. Fog remembers
  occupancy without revealing counts or identities.
- Negative `garrison_firepower` uses the community-documented flat-DPS meaning;
  positive values multiply ranged DPS. Actual volley tests cover researched
  building damage and the town center's absent primary projectile.

**Observation protocol is v5**: `town-bell` command (`player`, `buildingId`,
`enabled`), own town-center `townBell`, and public `hasGarrison` on visible and
remembered entities. Counts remain own-only. Match/config/result/replay formats
remain v1. See `docs/agent-runtime.md` and the schemas.

The ledger explicitly records bell selection without a radius cutoff,
reservation/overflow/egress policy, ram passenger classes, and volley formula
assumptions. These are not claims of exact DE engine equivalence. Ram crew
speed/attack bonuses remain **#161**.

## Verification

**Full gate GREEN:** `.local/issue137-gate-r3.log`, exit **0** in its matching
`.exit`, started **2026-09-22 21:17 BST**:

- **658 tests across 48 Vitest files**;
- TypeScript typecheck and Vite production build;
- **85 Python/import tests**;
- real-browser debug smoke.

It covers both features and the final killed-worker/capacity-display fixes.
Only Markdown changed afterward. Gate freshness was checked before commit.
Use `.local/gate.latest.json` and `tools/session_start.sh`; the old
`tools/morning_report.sh` still needs #159's fix.

Dedicated checks (all passed; each starts/closes a private server/browser):

| Command | What it verifies |
|---|---|
| `npx tsx tools/minimap_relief_smoke.mts` | Exact sRGB palettes, four hill faces, live/remembered woods, fog/reveal, old/fallback/replaced palettes, state immutability, large buffer |
| `npx tsx tools/minimap_markers_smoke.mts` | Compact live/memory building dots, reveal parity, no farm marker |
| `npx tsx tools/garrison_edges_smoke.mts` | Real bell/work-return clicks, self-rally training/unload, ram boarding/unload, `1/6` capacity, blue flag pixels and both bell audio requests |

The final full import is `.local/issue137-import-audio.log` (exit 0), with
**2,845 cached atlases reused**. New flag art/metadata and bell audio are published
locally; no decoder edit or wholesale atlas regeneration was required.

Two earlier gates timed out in different existing long tests while Windows
ran a CPU-heavy game. After the human freed the host, the same
`VITEST_MAX_FORKS=1 VITEST_MAX_THREADS=1 tools/gate.sh` passed. **No fixture
timeout was widened.** WSL idle CPU is not proof that the Windows host is idle.

## Live service, saved matches and imports

- Workspace `/home/fraser/repos/age-of-empires`, branch `main`.
- Ysgramor's `open-empires-shared.service` deliberately remains **active/running**,
  **NRestarts=0**. It was reloaded for this code while no checkpoint or connections
  existed, so no joined match was discarded. Preserve existing Tailscale routes.
- Shared URL: <https://ysgramor.tail6e864b.ts.net:5173/>; solo adds `?solo=1`.
- **Standing human permission:** end a shared match once neither Artemis nor
  Ysgramor has accessed it for one hour. Establish inactivity from access evidence,
  not checkpoint modification time; archive its save. This is permission, not
  an implemented automatic expiry timer (`docs/shared-play.md`).
- The old incompatible match is intact at
  `.local/shared-match-expired-20260921-2137.json`, SHA-256
  `25cce32d50c6e76b96d3f290aa2ae774d3ea38d1d5474f7ef2d621a37fc236db`.
- **Artemis import/presentation parity was not verified.** Its local asset
  gateway needs the complete updated import before claiming flag/audio parity.
  Hardware-GPU acceptance was not performed; browser checks used headless Chrome.
- No temporary import, test or browser processes should remain. Recheck actual
  Git/service/process state at the next session; preserve unfamiliar changes.

Earlier delivered worker/naval and autonomous-run evidence lives in
`docs/status.md`, issue threads and Git history. Ubuntu remains under
`D:\WSL\Ubuntu`; Linux paths are unchanged. Local-only crash evidence remains
in `.local/wsl-crashes/`, with cause unproven. The historical pathing probe's
“open ground” seed-200 endpoints are blocked; **#5** records that fixture defect.
Never commit owned assets, saved matches, credentials or crash dumps.
