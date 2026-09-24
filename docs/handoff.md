# Agent handoff — player rules and interaction/rendering checkpoint

## Task and stopping point

The user's final instruction was: **“fix 238 then wrap up — commit, update docs,
hand off.”** Finish this checkpoint and wait for the next user instruction;
there is no authorization to start an unattended roster-expansion run.

This document accompanies the combined checkpoint based on `b9c9d8a`. Use
`git log -1`, `git status` and `tools/session_start.sh` for its final commit,
remote divergence and gate status. The receiving agent starts with this briefing,
`docs/status.md`, `docs/ledger.md`, and the live GitHub tracker.

## Delivered scope

- **#53 — named player attributes:** import the complete named XS/DAT initial
  table, resource IDs and source hash. `playerAttributeFor` applies completed
  research to farm capacity and repair costs. Unknown names remain undefined;
  importing other attributes does not implement their mechanics or live counters.
- **Civilisation foundation, not a finished second civilisation:** complete
  per-player rulesets resolve through `src/sim/civilizations.ts`. Gameplay,
  costs, availability, placement/navigation, HUD and save/restart/replay use the
  appropriate owner. Gaia/map generation still use the root. The additional
  manifest catalogue remains empty until real source-backed profiles are ready.
- **All-civilisation audit and tracker:** 59 non-Gaia definitions, 53 base-era
  and six Antiquity-era. #122 is the parent of 59 individual issues, labelled
  `civilisation`. Start the first real matchup with Britons completion **#179**
  and Franks **#180**, after their shared dependencies. Full plan and audit
  interpretation: `docs/civilization-coverage.md`.
- **#173 — composite contours:** retire old layer-mask references every frame
  and use the same nonempty/loaded-page contract as ordinary contours; remove
  the never-assigned `atlasKey` gate. Missing, delayed and empty masks cannot
  revive disposed bindings.
- **#51 — context cursors:** 18 byte-identical native CUR files with actual
  header dimensions/hotspots. Hover and right-click share pure command/order
  classification. Hover does not reserve farms or reset work. Picking and
  selection read visible entities or last-seen Gaia metadata, not hidden live
  positions/stocks; vanished remembered Gaia targets fall back to movement.
- **#52 — drop sites:** derive building `accepts` and task-specific
  `gather.dropSites` from DAT lists plus JSON worker/target/resource selectors.
  Raw DAT lists remain provenance. Carried tasks survive source disappearance;
  authoritative empty lists stay empty. Livestock acceptance is metadata only.
- **#238 — map-independent ordering:** bound the existing render passes using
  the monotone mapping already used for ground layers. Sprite bodies/scatter,
  piece offsets, projectiles, contours and rally flags retain their within-pass
  order without crossing fog or placement overlays on larger maps. Piece offsets
  must be applied **before** compression; normal sprite groups keep default order.
- **#5:** closed at the user's request pending a concrete recurrence. The user
  will reopen with evidence; this does not declare all pathing reference-perfect.

## Verification and evidence

Final full gate **GREEN**, `.local/wrapup-gate.log`: **775 Vitest tests / 60 files**,
production TypeScript/Vite build, **103 Python/import tests**, and real-browser
debug smoke. It ran with three Vitest workers on the idle host. All source/test
edits preceded the run; only Markdown changed afterward. No timeouts were widened.

Maintained acceptance checks completed for this checkpoint:

- `tools/composite_outline_smoke.mts`: near and far, with default Galley and
  `CONTOUR_KIND=villager`; use `CONTOUR_FAR=1` for the far 392×392 fixture.
  Before #238 the far ship body/contour/occluder orders were **6150 / 5015 / 6205**
  and only **32** blue contour pixels survived. Afterward the Galley gives **321**
  blue pixels at both positions; the villager gives **147** at both positions.
  All **153 / 89** opaque contour samples respectively are covered correctly by
  the real placement-footprint mesh. Camera round trips preserve identical PNGs;
  delayed loading, retirement/expiry/reload, empty frames and simulation hashes pass.
  Logs: `.local/issue238-before-repro.log`, `.local/issue238-{near,far}-{composite,unit}-verified.log`.
- `tools/tree_fog_smoke.mts`: 620 opaque canopy samples unchanged by reveal,
  owned shadow alpha mean error 0.0029 across 190 samples, remembered-canopy error
  below one sRGB byte. `.local/issue238-fog-regression.log`.
- `tools/outline_residency_smoke.mts`: ordinary contour retirement remains safe.
  `.local/quickwins-outline-regression.log`.
- `tools/context_cursor_smoke.mts`, owned and `OPEN_FALLBACK=1`: 15 real
  hover/right-click outcomes, last-seen resource selection, hover immutability,
  native requests/hotspots or CSS fallback. `.local/issue51-{owned,fallback}-smoke-final.log`.
- `tools/civilization_rules_smoke.mts`: real commands/UI through a private
  synthetic second profile; **not** real Frankish art or bonus acceptance.
  `.local/civilization-rules-smoke-r2.log`.
- Full owned regeneration completed in `.local/quickwins-import-r2.log`, reusing
  all 1,984 sprite atlas entries. #238 changes only rendering; no further import
  is needed for its ordering helpers. No fixture timeouts were widened.

Browser/render measurements use a real private Chrome page with SwiftShader.
They do not establish physical-GPU FPS or full DE compositor equivalence.

## What was learned / failed attempts

- Counting any contour pixels was too weak: the far-map bug still left 32.
  Require proper pass ordering and compare translated near/far results.
- Animated water/foam confounded contour A/B measurements. The diagnostic hides
  ground while retaining the actual native ship/unit and TC occluder.
- Browser-decoded images can bypass a second network event. Reload-delay tests
  hold the asset-loader boundary; the first-load test holds the actual request.
- `flag32x32.cur` is **48×48**, hotspot **(9,43)**; convert's hotspot is (15,15).
  Preserve header metadata, not filename assumptions.
- Gold/stone task targets can be Gaia-only; player DAT slots may be empty.
  Resolve their classes from the imported entities. The first drop-site attempt
  missed these; regression coverage now catches that case.
- One old exact farmer-metadata assertion needed the new owned drop-site IDs.
  No gameplay expectations or timeout bounds were weakened to get a green gate.

## Remaining work — requires a new user task

1. **#178, conversion inheritance:** stored HP/maxHP survives conversion while
   derived rules currently use the recipient. A public-order synthetic case
   changed rule HP 80/attack 20 to rule HP 40/attack 4 while stored maxHP stayed 80.
   Establish reference inheritance before enabling real mixed-civilisation play;
   do not guess donor/recipient retention or future-upgrade behavior.
2. **#123/#129:** gated passive/team effects, cost and production-rate consumers,
   required-count prerequisites and automatic/free research. Some automatic
   candidates have impossible slots or game-mode gates and must not run by default.
3. **#179/#180:** real Britons–Franks roster/art/voice/icon and selection work.
   Imported definitions absent from a civ's tree must not become trainable:
   Frankish node 8 is Town Watch (`Use Type Tech`), not the Longbowman unit.
   Extra/replacement TC construction **#177** is needed to exercise the Briton discount.
4. Existing map/render work remains: #134 cliffs/exact elevation topology,
   #113/#116 terrain blending, #94 water, #149 compositor, #93 survey regeneration.
   Older mapping/performance evidence is in `docs/status.md`, `docs/ledger.md`
   and `docs/reviews/2026-09-23-performance.md`.

## Relevant files

- `src/sim/{civilizations,rules,data,game}.ts` — owner rules, attributes, commands,
  pure context planning, gathering and deposits.
- `src/view/{render-order,sprites,scatter}.ts` — bounded passes and mask lifetime.
- `src/view/{cursors,selection}.ts`, `src/main.ts` — native pointers and visible/
  remembered interaction without simulation mutation.
- `tools/{import_content,import_ui,audit_civilizations}.py`, `tools/import-spec.json`
  — source-backed data/cursors and the repeatable coverage inventory.
- `src/sim/{civilizations,player-attributes,drop-sites}.test.ts`,
  `src/view/{cursors,render-order,sprites}.test.ts`, `tools/test_import_aoe2.py`
  — focused outcome/import regressions. The browser scripts above are maintained.

## Constraints and operations

- Run session-start and read the lessons before continuing. Use public commands;
  simulation state belongs to `src/sim`. Inspect owned sources before inventing
  mechanics/values; all approximations remain in the ledger.
- Preserve the open fallback, Steam credentials, owned/converted assets, `.local/`
  and saved matches. None belong in Git. No disassembly of the game executable.
- Preserve the managed shared host and Tailscale routes; do not reset/restart
  deployment as part of a code-only handoff. This checkpoint did not deliberately
  restart the shared service or update Artemis's separate asset runtime.
- Play: `https://ysgramor.tail6e864b.ts.net:5173/` (`?solo=1` for solo QA);
  Artemis uses `http://localhost:5174/`. Refresh imported assets only through
  `npm run import:aoe2`, then reload tabs. Verify active runtime paths first.
- Use private Vite ports for probes, and PID/exit-file handles for long jobs.
  Never rewrite published history. Commit only green work and push each commit.
- No Paseo agent-launch tool/CLI is available here. This is the self-contained
  receiving-agent briefing; no new agent is claimed to have been launched.
