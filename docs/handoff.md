# Agent handoff — Briton playable checkpoint

## Task and stopping point

The user authorized direct MAIN integration, checkpoint commits and pushes, and
then closure of the five remaining Briton research mechanics. Scope is Britons,
not additional civilisations. Fortifications, specialists, relics/monastery,
Warwolf/deployed trebuchet effects, Shipwright, Caravan, garrison firepower and
original-price training refunds are committed/pushed as `db2c9c0`. Siphons,
random-map Spies, Guilds, Coinage and Banking now have gameplay consumers,
actual UI/browser evidence and a green final checkpoint gate.

Use `git log -1`, `git status` and `tools/session_start.sh` for the completion
commit, divergence and gate status. Read `docs/status.md`, `docs/ledger.md`,
`docs/civilization-bonuses.md`, `docs/civ-roster-integration.md` and the live
tracker. The earlier HUD handoff is preserved at `0458053:docs/handoff.md`;
its follow-up references below remain historical context.

## Current civilisation scope

- Complete independent supported-roster profiles, per-profile bonus graphs and
  namespaced art/icons/voices; 53 base-era inventory rows, only Britons/Franks enabled.
- Counted prerequisites and automatic/free research; work-rate-aware production,
  research and observation countdowns; source-derived cost, gathering, range/sight
  and cavalry HP effects. Conversion snapshots from #178 remain authoritative.
- Real menu selection, reload and Restart; completed Longbowman/Throwing Axeman
  training with foreign unique buttons absent; actual castle/unit atlas identity,
  names/icons, age-specific building payments and free farm lifecycle.
- Corrected disabled-child upgrade folding, source tree aliases for ram/gate,
  and legacy fixtures that omitted now-enforced prerequisites. No timeout widening.
- Published assets have been regenerated through the full pipeline. The existing
  tower/wall and specialist browser probes passed; published monastery/Warwolf
  clicks and impact checks passed in `.local/britons-monastery-browser-diagnostic.log`.
- Current checkpoint gate: **GREEN**, `.local/britons-playable-gate-r5.log`:
  **898 tests / 68 files**, build, **123 import tests**, real-browser debug smoke.
  R4 passed the tests/imports, then exposed a startup race in
  the general smoke: canvas presence preceded debug-listener installation.
  The smoke now waits for listener readiness within its unchanged startup limit;
  its focused rerun passed. No clocks were widened. R3's three stale import
  assertions now verify explicit zero blast fields and implemented monk effects.
- The earlier profile/import determinism checkpoint is preserved in `4ba51db`
  and its `.local/civ-profiles-*` evidence. It is not the latest gate result.
- Final-five evidence: `.local/britons-final-import.log` (full pipeline),
  `.local/britons-final-research-browser.log` (all five actual research buttons,
  buy/sell/tribute, live Spies price/reveal and 729 sRGB impact pixels), 149 focused
  TypeScript tests and four focused owned-source tests. Observation is now v6;
  match/replay formats remain v1. Final gate log: `.local/britons-final-gate-r1.log`.
  **GREEN: 906 Vitest tests / 70 files, build, 124 owned-import tests and general
  browser smoke**, one worker and no widened clocks. This completes the requested
  Briton random-map research scope under the source/inference boundaries in the
  ledger; it is not an all-civilisation or closed-engine parity claim.

## Earlier HUD delivered scope (historical)

- Compact, independently expiring notification stack with owned research and
  creation strings. Height follows visible lines instead of the template maximum.
- Separate lower-centre red housing warning for **ready but population-blocked
  paid production**, plus the actual yellow `PopulationFlash` widget. Full
  population alone does not trigger the visible warning.
- Global two-row research/training indicators; click selects the producer.
- Black/gold deletion confirmation from native WPFG/XAML, including imported
  frame slices, Times/Trajan fonts, Yes/No and close button. Lifecycle abort is
  distinct from explicit No and never dispatches a deletion.
- Full victory/defeat presentation with owned crests, divider, typography and
  localized Return/Leave controls. Return dismisses without changing the finished
  match. Leave opens the existing match launcher. Dismissal survives HMR, and
  ending a match safely aborts a pending deletion prompt.
- Animated end-screen embers, isolated from simulation RNG and cleaned up on
  dismissal. A small defeated-player announcement also uses its owned widget.
- Source-backed generic OK popup for replay-loading failures. Symbolic `IDS_*`
  localization keys are imported alongside numeric IDs. UI palettes retain the
  earlier CSS-variable/URL support.
- HUD scale now reaches the correct 2/3 at 2560×1440 instead of hitting the old
  0.62 ceiling. HUD rebuilds preserve the reference font class.

## Verification and evidence

Final full gate **GREEN**, `.local/issue58-reference-gate.log`: **775 Vitest tests
/ 60 files**, TypeScript/Vite build, **107 Python/import tests**, and real-browser
debug smoke. All source/test edits preceded the run; only Markdown changed
afterward. No fixture timeout was widened.

Additional maintained checks, run separately from the four-step gate:

```bash
npx tsx tools/feedback_smoke.mts
OPEN_FALLBACK=1 npx tsx tools/feedback_smoke.mts
```

Both pass. Coverage includes actual research/combat, blocked versus merely full
population, producer selection, file-chooser error flows, Yes/No/Escape/close,
mixed deletion and abort, read-only rebuild, message expiry, 1440p native geometry,
both players losing, changing ember pixels, Return/Leave and starting another seed.
Import tests reconstruct the source nine-slice images byte-for-byte and verify
consumed XAML metrics, fonts, localization and population-flash colour units.

Owned assets were regenerated using `npm run import:aoe2`;
`.local/issue58-native-import.log` records the native-resource pipeline pass.
The browser probe uses a private Vite server and real Chrome/SwiftShader. The
performance-soak script follows the new Leave route, exercised by the feedback
smoke; the long soak and physical-GPU FPS were not remeasured.

## Reference settings and remaining approximations

The human supplied captures at **2560×1440, HUD 100%, tooltip 75%, Normal
notification duration, Readability Panels on, colour-blind Off, unique player
and health colours, Safe Delete on**. Chat shows 2000×1125 previews. The original
PNG bytes are not in the repository; observations/settings are in
`docs/ui-reference.md` and the local reference index. Current local 1440p renders:
`.local/issue58-{confirmation,notification,housing,defeat}-owned.png`.

The human accepted the generic OK popup's owned-source layout/art without a
runtime screenshot; do not request that capture again as a prerequisite.
Font rasterization/line metrics, dimmer strength, glint omission, notification
timing, global-queue aggregation and ember emitter parameters remain explicit
approximations in `docs/ledger.md`. The emitter uses owned shader-derived
quadratic falloff with chosen distribution/velocity/colours/count. It is not a
time-identical reconstruction of DE's closed-runtime emitter.

## What was learned / failed attempts

- Empty/legacy widget JSON is not the last source: its WPFG/XAML sibling supplied
  the actual dialog. Reusing replay parchment was wrong; the human capture caught it.
- Teardown must not mean No: No intentionally deletes unflagged members of a
  mixed selection. An explicit `aborted` result prevents HMR from deleting units.
- A negative-z notification background needs a persistent stacking context after
  opacity reaches one. Pixel checks caught what nine DOM-cell assertions missed.
- Per-particle canvas filters saturated SwiftShader. Pre-rasterized sprites and
  two batched blend passes replaced the prototype; its orphan browser processes
  were terminated and the final tests run on an idle host.
- After changing viewport size, wait for the HUD resize scale before measuring
  its box. This was a probe synchronization fix, not a widened timeout.

## Follow-up work

- By explicit user assignment, **#110** owns wonder UI/countdown, **#138** owns
  technology-tree/objectives, and **#141** owns remaining palette integration and
  its options selector. These do not block closing #58. #110's “a then b” decision
  is already answered: do not ask the human to decide it again.
- **#119**, missing monk contours, was recommended as the next bounded bug; the
  user chose to finish/review #58 first. Inspect the failing idle/attack outline
  walks without weakening decoder validation. A decoder change invalidates the
  atlas cache and entails the full import. No work on #119 was started here.
- **#113** remains the other high-priority visual bug. Use the live queue rather
  than treating this list as authorization to begin.
- The requested Briton #179 gameplay scope is verified. Shared limitations remain
  other-map relic placement (#130/#95), exact charge/market calibration, the full
  diplomacy surface (#138), Regicide/Treason and the existing conversion-policy
  parity questions (#178). Do not expand the civilisation catalogue implicitly.
  #177 construction and the shared bonus/prerequisite/profile infrastructure are implemented.
  #178 retains explicit reference caveats under the user-approved inferred policy;
  see `docs/civilization-coverage.md` for the bounded supported-gameplay milestone.

## Relevant files

- `src/view/{hud,feedback,native-feedback}.ts`, `src/view/style.css` — widget/native
  layout, modal lifecycles, queues and animated presentation.
- `src/main.ts` — public-command integration and read-only production/outcome view.
- `tools/{import_feedback,import_ui,import_content}.py`, `tools/import-spec.json`
  — native resources, widget metadata, numeric and symbolic localization.
- `tools/feedback_smoke.mts`, `tools/test_import_aoe2.py` — acceptance regressions.
- `docs/reviews/2026-09-24-issue58.md` — review findings, resolutions and final
  reference-driven evidence; `docs/ui-reference.md` — source/measurement boundaries.

## Constraints and operations

- Run session-start and read the lessons before continuing. Use public commands;
  simulation state belongs to `src/sim`. Inspect owned sources before inventing
  mechanics/values; all approximations remain in the ledger.
- Preserve the open fallback. Keep Steam credentials, owned/converted assets,
  `.local/` and saved matches out of Git. No disassembly of the game executable.
- Preserve the managed shared host and Tailscale routes. At this handoff,
  `open-empires-shared.service` is active/running, `NRestarts=0`, `ExecMainStatus=0`.
  This is a local code/import checkpoint, not an Artemis asset-runtime deployment.
- Play: `https://ysgramor.tail6e864b.ts.net:5173/` (`?solo=1` for solo QA);
  Artemis uses `http://localhost:5174/`. Refresh imported assets only through
  `npm run import:aoe2`, then reload tabs. Verify active runtime paths first.
- Use private Vite ports for probes, and PID/exit-file handles for long jobs.
  Never rewrite published history. Commit only green work and push each commit.
- No Paseo agent-launch tool/CLI is available here. This is the self-contained
  receiving-agent briefing; no new agent is claimed to have been launched.
