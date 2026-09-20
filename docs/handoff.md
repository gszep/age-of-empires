# Agent handoff — 2026-09-20

## Task and human acceptance

The human accepted the corrected tree/fog/shadow presentation for #88 with
**“ok, this is good. update the docs and hand off”**, then explicitly requested
**“commit and push”**. This checkpoint publishes the verified session work.
This session implemented **#145, #140, #127, #82, #84 and #88**, in that order.
No further coding issue has been assigned. Prepare for the human's next request;
do not start another issue merely because the tracker lists these as open.

The human is doing **solo QA on Ysgramor**, most recently on
`http://localhost:5173/?solo=1&seed=2`. Keep updates concise. The latest #88
acceptance follows a rejected first attempt; preserve that distinction below.

## Repository state — preserve before doing anything

- Workspace: `/home/fraser/repos/age-of-empires`, branch `main`.
- Implementation base was `2cc51c5` (shared play and map selection). The six
  fixes and their detailed issue evidence are included in this checkpoint;
  consult `git log` for its commit ID rather than treating their old issue
  titles as missing implementations.
- `AGENTS.md` was already edited by the human before this session. Preserve
  that edit and keep it separate from any requested implementation checkpoint.
- New implementation files included in this checkpoint:
  `src/sim/farm-occupancy.test.ts`, `src/sim/scorpion.test.ts`,
  `src/view/render-order.ts`, and the six smoke scripts listed below. They are
   maintained work, not disposable scratch files.
- Do not stash/reset the tree or overwrite unfamiliar changes. Read
  `AGENTS.md`, `docs/lessons.md`, `README.md`, `docs/status.md` and
  `docs/ledger.md` before resuming.

## Current verification

**Full gate GREEN:** `.local/tree-fog-gate.log`, exit 0 in
`.local/tree-fog-gate.exit`, started 2026-09-20 at 23:16.
**453 Vitest tests, build, 81 owned import tests, real-browser debug smoke.**
`.local/gate.ok` is the sentinel. Only Markdown handoff edits followed the
last verified code; new non-Markdown edits require fresh checks.

Latest complete content regeneration: `.local/tree-fog-import.log`, exit 0.
**1,967 cached atlases reused.** This includes scorpions, placement-side terrain,
minimap modes, queue strings and Default shadow settings. No decoder edit or
hour-long atlas regeneration was needed. Reload QA tabs after an import.

| Dedicated check | What passed |
|---|---|
| `tools/training_queue_smoke.mts` | Reference-scale 3/3/1 **waiting** batches, active portrait, exact refunds, unchanged active progress when cancelling a waiting unit, stable click targets, full-queue wrapping and an empty waiting row; also passed with `OPEN_FALLBACK=1` |
| `tools/scorpion_smoke.mts` | Actual train/research buttons, upgrade replacement art and displayed pierce attack, right-click combat |
| `tools/farm_occupancy_smoke.mts` | Group right-click produces one rendered farmer gathering food |
| `tools/minimap_markers_smoke.mts` | Actual minimap sRGB readback: four backing pixels for live/remembered building markers; F4 preserves size; no farm marker |
| `tools/tree_shadow_smoke.mts` | Held shadow PNG arrives after a tree becomes a fog snapshot; frozen pose and simulation checksum preserved |
| `tools/tree_fog_smoke.mts` | Complete visible and remembered canopies, owned shadow-mask strength, no unseen-tree disclosure; passed again after the full gate |

Run these with `npx tsx tools/<script>.mts`. They create private Vite servers
and browser fixtures. Pixel comparisons use `/__debug` readback and state their
colour space; screenshots supplement geometry checks. The shadow probes expose
view handles through a private-server transform, never a shared tester tab.

The #88 canopy check sampled **620 opaque leaf pixels**: before correction,
all changed when F4 revealed the ground behind an already-visible tree, with
maximum sRGB difference 215; afterward **none change, maximum difference 0**.
Remembered canopy maximum error is **0.841 sRGB bytes** against half linear
brightness. **190 ground-shadow samples** have mean linear-alpha error
**0.0029** against the owned mask × Default strength 1.

`TREE_FOG_SCREENSHOTS=1 npx tsx tools/tree_fog_smoke.mts` writes geometry crops:
`.local/tree-fog-visible-fixed.png`, `.local/tree-fog-memory-fixed.png`, and
`.local/tree-shadow-visible-fixed.png`. The human's two screenshots (queue,
then DE/ours tree comparison) are conversation attachments, indexed in
`.local/reference/index.md`; their original image files are not on disk.

## What changed

### #88 — accepted after the screenshot correction

- `src/view/world.ts`, `render-order.ts`, `sprites.ts`, `scatter.ts`, and
  `src/main.ts`: ground fog draws below whole sprite bodies, with bounded
  terrain/farm/shadow order on both 120- and 392-tile boards. Visible trees
  show whole canopies. Remembered sprites dim RGB ×0.5 while retaining their
  opaque silhouettes. Scenery explicitly checks its anchor tile, preventing
  unseen decorations from appearing above the lowered ground fog.
- `import_content.py` imports the owned `colorcorrection.json` Default
  `shadow_strength`/`shadow_color`; `convert_sld.py` publishes `shadows`,
  `assets.ts` reads it and `configureShadow` uses it. The arbitrary extra
  **0.55 multiplier was removed** in favour of Default **1.0/black**.
- The earlier, retained fix lays out valid frames before textures arrive and
  uses `refreshEntityTextures` to finish cached fog views without choosing
  newer frames/ages or reading newer entity state. HMR bindings are wired.
- **What failed:** the first acceptance test proved only a cold-texture case.
  The human rejected it because the actual fog overlay still sliced crowns.
  The screenshot-driven canopy and visible-shadow tests above are the relevant
  acceptance evidence. The final human response was “ok, this is good.”
- Default profile selection and direct alpha composition are still limited
  approximations, recorded in the ledger; full biome grading/compositing is
  #149, and animated fog is #117. Do not call the entire DE frame pixel-identical.

### #82 and #84 — farms and minimap

- `src/sim/game.ts` derives exclusive farm reservations from live gather
  orders, including approach and drop-off. Surplus group members use nearby
  free farms or idle; automatic continuation and queued orders respect claims.
  Only one participating builder becomes the farmer. Stop, retasking and death
  release the reservation; old duplicate orders resolve deterministically.
  Owned farm help string **26149** states the one-worker limit.
- `src/view/minimap.ts` uses uniform snapped **2×2 backing-pixel** building
  markers (about 3×3 CSS pixels at the 2000px reference scale), with the same
  path for live/fog-memory buildings. Imported `minimap_mode` hides farms (0);
  other modelled buildings use 1. Exact per-building marker sizing is inferred.
- A 40-minute Islands/102 simulation completed **48,000 ticks**, median
  **1.620 ms**, p99 **8.893 ms**, worst **33.062 ms**; no winner because the
  existing AI lacks boats. No fixture timeouts were widened.
- New gap **#156**: the same tooltip permits abandoned enemy farms, but the
  current gathering rule admits only owned farms. This is separate work.

### #145, #140 and #127 — fish, queue and scorpions

- `mapgen.ts`, `data.ts`, importer: shore fish honour DAT unit 69's
  `placement_side_terrain` beach alternatives **2/35** on both mirrored
  placements. Four-seed regressions and browser Islands/3 passed; that board
  has 46 shore fish, all beside beach. Old saved boards need a fresh match.
- `hud.ts`, `style.css`, `main.ts`, command schema and `game.ts`: optional
  `cancel-train.index` preserves legacy last-entry cancellation. Index 0 is
  active; waiting batches begin at 1. Portrait nodes persist across updates.
  Cancelling a waiting batch refunds one unit without resetting active progress.
- **Human queue clarification:** the screenshot's first “3 militia” means
  three waiting militia **in addition to** the active militia. Thus four
  militia precede the spearmen. Consecutive waiting runs group as 3/3/1 without
  merging the final militia into the first run. Maximum queue remains fifteen
  total: one active plus fourteen waiting. The separate active portrait and
  two-line creation status use imported labels and measured 70px reference
  portraits. Within-batch cancellation order and green tint alpha remain
  documented approximations. Population-cap queuing is still #143.
- Imported Scorpion **279**, Heavy Scorpion **542**, bolts **367/627**, and
  technology **239**, with animations/icons/voices. Bolts hit enemies once along
  a swept path, spare allies and retain flight data after shooter death.
  Collateral uses the bolt's DAT attacks, including tech 239's **+4 pierce**:
  upgraded primary/collateral pierce is **14/10**, not a guessed half-damage rule.
  Travel to maximum range +3 is inferred. Upgrades also replace active/waiting
  training entries. Types, schemas, rules and UI all include the new line.

## Services, play and rollout

- Solo: `http://localhost:5173/?solo=1` or
  `https://ysgramor.tail6e864b.ts.net:5173/?solo=1`.
  The comparison used `?solo=1&seed=2`. Explicit `?map=`/`?seed=` declines the
  dev-session snapshot; menu-launched solo setups resume normally on reload.
- Shared: Ysgramor on 5173, Artemis on **its own** `http://localhost:5174/`.
  Both have `open-empires-shared.service`; Ysgramor was verified active at
  handoff. It runs `tools/shared-host.mts`. Artemis's gateway serves local art.
- Preserve `.local/shared-match.json` and
  `.local/shared-match-before-sync-fix.json`, browser saves, and Tailscale routes.
  The running shared host has preceding rules. The session's rule changes make
  its saved rules hash incompatible with a simple restart. **Shared rollout
  requires an explicitly agreed new match with the checkpoint preserved.**
  Artemis also needs the new owned content imported locally. Neither rollout
  nor new two-machine acceptance was performed in this session.
- Artemis clone: `/home/gszep/Documents/repos/age-of-empires`; served art:
  `.local/shared-runtime/public` there (x1). Preserve its pre-existing
  `docs/lessons.md` edit. Its clone was not fast-forwarded; reconcile installed
  gateway files before updating it. Noninteractive Node may need its NVM PATH.
- Prior shared-play/map-menu code and verification are documented in
  `docs/shared-play.md` and issues #144/#153. They are the committed baseline,
  not new work to redo. Public deployment has not been updated in this session.
- Temporary probes/imports/gates/browser processes have exited. Leave the
  managed shared services intact. Use a private port for further QA.

## Gate monitoring and next-agent instructions

1. Run `tools/session_start.sh` first, then inspect the actual tree. **#155**:
   startup still reads the obsolete default gate log and can say “nothing of
   ours” while the shared service is active. Trust the explicit current log
   above, `.local/gate.ok`, process table and `systemctl --user` instead.
2. The human asked about repeated gate timeouts. Those were **120-second
   monitoring windows**, not failed gates. The gate takes over six minutes.
   Use a handled background job and `tools/wait_for.sh file <exit-file> 600`
   with a tool timeout greater than 600 seconds. Use a fresh exit-file name so
   a previous result cannot satisfy the new wait. Run on an idle host.
3. Read the issue comments before choosing work. The six issues above are
   implemented in this checkpoint. **No next implementation is assigned.**
   Follow an explicit new user request; use the live tracker for an authorized
   autonomous run rather than a stale list in this handoff.
4. For subsequent changes, start from this checkpoint and review the full
   working tree. Preserve the human's `AGENTS.md` edit;
   never include owned assets, `.local/`, `.tools/` or credentials. Run the
   required gate after any code edits, then commit/push as requested.
5. Remaining relevant follow-ups: #149 final grading/compositing, #117 animated
   fog, #155 truthful startup/progress reporting, #152 texture eviction,
   #154 cold Artemis transfer performance, and #156 abandoned enemy farms.
   These are context, not authorization to begin them.

Hardware-GPU performance measurements, full DE post-processing, grouped-queue
click semantics/tint alpha, and rollout to Artemis remain unverified. Every
approximation and its source lives in `docs/ledger.md`. The simulation remains
authoritative; renderer/debug/agent code never mutates it directly. Do not
rewrite published history or copy GPL/AGPL code or owned game assets into Git.
