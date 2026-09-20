# Agent handoff — 2026-09-20

## Task and human context

Take over this repository for the human's next requested issue. No new coding
item has been assigned at handoff. The human is doing **solo QA on Ysgramor**,
approved the map selector (#144: “this looks really good”), and asked for docs
and an end-of-conversation handoff. Keep updates short and complete a narrow,
verified change before expanding scope. Prior runs spent too long profiling.

This checkpoint gathers the completed shared-play, synchronization, solo-mode
and map-selector work. Those changes were previously deployed from a dirty
working tree; the human clarified that commits happen at conversation end.
`AGENTS.md` had an existing human edit before this work and is excluded from
the checkpoint. Preserve it. Do not assume remaining uncommitted files are
disposable.

## Start here

1. Read `AGENTS.md`, `docs/lessons.md`, this handoff and `docs/shared-play.md`.
2. Run `tools/session_start.sh` and inspect `git status` and recent commits.
   **Known reporting gap #155:** startup reads only `.local/gate.log` and its
   process regex misses the managed shared services. It can report an old gate
   and “nothing of ours” while the host is running. Check the explicit evidence
   and services below; do not start a duplicate server.
3. Wait for the human's next issue. For an explicitly requested autonomous run,
   follow `docs/overnight.md` and the live tracker, human-filed bugs first.

## Where to play

| Purpose | URL |
|---|---|
| Human's current solo QA, this machine (Ysgramor) | `http://localhost:5173/?solo=1` |
| Same solo mode through the existing remote link | `https://ysgramor.tail6e864b.ts.net:5173/?solo=1` |
| Shared player 1, Ysgramor | same addresses without `solo=1` |
| Shared player 2, Artemis laptop in Japan | `http://localhost:5174/` **opened on Artemis** |

`solo=1` bypasses the match connection and runs the normal browser simulation
against AI. It does not reset the shared match. F10 → Game Settings chooses
map/seed; Random clears the seed for a fresh board; Start Game applies it.
Changing fields alone does not change the match. Restart repeats a known setup.
Map choices persist, and menu-launched solo matches resume on reload. Explicit
map/seed URLs still request a fresh solo board.

## Installed services and state

- Both machines have an enabled user unit named `open-empires-shared.service`.
  Ysgramor runs `tools/shared-host.mts` on 5173; Artemis runs
  `tools/shared-join.mjs` on 5174. Use `systemctl --user status ...` locally
  and `ssh artemis 'systemctl --user status ...'` remotely.
- The host is a Node simulation inside the Vite service, not a browser tab.
  Artemis serves artwork locally and proxies application code and WebSockets
  to Ysgramor. No lobby, accounts, public multiplayer infrastructure or worker
  was added. This is intentionally a two-person household setup.
- Shared state: `.local/shared-match.json`, saved every five seconds and on
  clean shutdown. Pre-fix backup: `.local/shared-match-before-sync-fix.json`.
  Preserve both. A service restart pauses the match; F3 resumes it.
- Solo state lives in that browser tab's `sessionStorage`; map preference is
  small `localStorage` metadata. Do not replace a human's live tab with a probe.
- Restart the service after simulation/host changes, preserving its checkpoint.
  Presentation modules have HMR; `main.ts` and simulation changes reload tabs.
  `npm run dev -- --port 5175` runs independent standalone development alongside
  the installed service.
- Temporary test servers, tunnels and imports were stopped. Leave the two
  managed user services and existing Tailscale routes intact.

## What shipped and where

### Shared play and #153

- `src/shared/server.ts`, `match.ts`, `protocol.ts`: single authoritative clock,
  ordered commands, join/recovery snapshots, pause/speed, checkpoint persistence,
  player-2 AI handover and host-only restart. Snapshot transfer has a separate
  backpressure allowance until acknowledged, so large Windsor joins survive.
- `src/shared/checksum.ts`: stable object-key ordering, preserved array order,
  fast native serialization for primitive terrain/fog arrays. **Legacy replay
  checksums in `src/sim/checksum.ts` retain their original byte representation.**
- `src/shared/playback.ts`, `client.ts`: 100 ms wall-clock buffer, bounded work
  batches, MessageChannel immediate scheduling, view-only position interpolation
  and diagnostics. No simulation ticks are skipped.
- `src/main.ts`, `view/world.ts`, `view/minimap.ts`: player-relative UI/fog,
  rendering/picking at interpolated positions, same-map recovery retaining the
  scene, HUD, camera and valid selection. `view/assets.ts` bounds sprite loads
  and cools down failed retries; it does not implement texture eviction.
- `tools/shared-host.mts`, `shared-join.mjs`, `install-shared.mjs`: launchers,
  local-asset gateway and user-service installer. Join needs only Node.

### Map selector #144

- `src/view/hud.ts`, `style.css`: map/seed form in F10, native seed validation,
  Random/Start Game, and read-only guest controls.
- `src/match-setup.ts`: registry-derived choices, valid positive uint32 seeds,
  stored preferences. `src/dev-session.ts` keeps launch metadata outside game
  state; old sessions remain readable. Unknown legacy setup is not invented:
  choose Start Game once to establish repeatable restart settings.
- `src/main.ts`: starts selected maps, rebuilds terrain/fog/minimap, resets
  per-match view state and shields input/select editing from gameplay hotkeys.
  The debug import is deferred until view initialization is complete.
- `tools/import_content.py`: imports labels and standard map names from owned
  localization IDs. `screenmapselection.json` and `editorbottommappanel.json`
  were inspected; the compact native form is a recorded project approximation,
  not a recreation of the full DE map catalogue (`docs/ledger.md`).
- Launch metadata is carried separately in shared snapshots/checkpoints, so
  naming the map/seed does not alter authoritative or replay checksums.

## Verification and evidence

Latest full gate: **GREEN**, `.local/map-menu-final-gate.log` (19:15 start):
**429 Vitest tests, build, 80 owned import tests, real-browser smoke**.
`.local/gate.ok` is the gate sentinel; later non-Markdown changes need new checks.
This handoff documentation requires no additional full gate.

- `tools/map_menu_smoke.mts`: all six choices, actual key/click paths, invalid
  seeds and input hotkey isolation, Islands seed 2, reload persistence, Windsor
  392 ↔ standard 120 map transitions with a terrain pixel check, random seed,
  host/guest restrictions, matching state and saved setup. Latest result:
  `.local/map-menu-final-smoke.log`, GREEN.
- `tools/shared_smoke.mts`: two real clients, training clicks, forced same-map
  recovery preserving selection/rebuild count, 1,500+ fast-forward ticks without
  unintended resync, local PNGs/tree rendering, reload and host restart.
  `.local/shared-sync-final-smoke.log` is GREEN.
- Artemis profiling used a copy of the human's save: 9,387 ticks across speeds,
  then 6,075 at 10x after optimization, no resyncs. Final host/guest agreed at
  tick 51,026, hash `7c3f9a8f`. See `docs/shared-play.md` for measurements.
- Last full content regeneration: `.local/map-menu-import.log`, exit 0;
  1,919 cached atlases reused. No decoder edit or fresh atlas conversion was
  needed for the map labels.

Browser probes must use private ports with explicit Vite root/config. With
multiple tabs, use page-local `window.__empiresDebug(...)`; HTTP `/__debug`
broadcasts and can answer from the wrong page. `sim` includes `synchronizationHash`,
legacy `checksum`, setup and timing/counter diagnostics. `snapshot` exports state;
`resync` requests deliberate diagnostic recovery.

## What failed and what not to repeat

- Raw `JSON.stringify` hashes falsely disagreed on identical states after JSON
  dropped undefined properties and later assignments reordered keys. The human's
  save reproduced this after 318 ticks. `structuredClone` hid it in initial tests;
  wire tests now use JSON. Do not “fix” this by comparing fewer gameplay values.
- Rebuilding the entire presentation for every recovery amplified the false
  alarms. Preserve the scene on same-map corrections.
- Chained `setTimeout(0)` clamps limited fast catch-up. MessageChannel ready work
  reduced the observed 10x peak queue from 372 to 32 ticks.
- Copying gigabytes of HD art across Tailscale was abandoned. Artemis regenerated
  its owned x1 assets locally; Ysgramor retains x2. Do not repeat the copy/import
  unless the task actually changes assets.
- Background browser RAF waits stalled early probes. Bring a page to the front
  for clicks and use explicit polling for state readiness. Puppeteer modifiers
  use key down/press/up, not Playwright-style `press('Control+a')`.
- WSL restarted during an earlier gate. An interrupted log is not a passing run;
  the final complete gate above supersedes those attempts.

## Remaining gaps and constraints

- #154: cold uncompressed Three.js dependency transfer to Japan measured only
  28.5 KB/s for a 2.55 MB chunk. Profiling preloaded a byte-identical dependency
  to model a warm cache; this is **not** a cold-start improvement. No compression
  or production code cache was implemented.
- #152: sprite pages still have no eviction. Do not claim bounded GPU memory.
- Profiling used forced SwiftShader: roughly 5.8 fps paused versus 5.9 at 10x
  demonstrates no additional speed-related collapse, **not** native-GPU FPS.
  A long two-human match and hardware-GPU performance remain unverified.
- #144 and #153 have detailed implementation/evidence comments. Reconcile their
  tracker state with the published handoff checkpoint; do not reimplement them.
- Artemis clone: `/home/gszep/Documents/repos/age-of-empires`; served assets:
  `.local/shared-runtime/public` there (about 1.7 GB, x1). Its clone was not
  fast-forwarded: preserve the pre-existing `docs/lessons.md` edit and reconcile
  the installed gateway/installer files before any future git update. Node is
  under NVM and may not be on the noninteractive SSH PATH.
- Keep the original-content-first rule, open fallback, authoritative `src/sim/`,
  versioned replay compatibility and MIT/licensing boundaries. Never commit
  `.local/`, `.tools/`, `public/imported/`, game files or credentials. Never reset
  Tailscale routes or rewrite published `origin/main` history.
