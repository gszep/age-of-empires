# Agent Brief

Open Empires Lab is a playable AoE2-compatible game and agent experimentation
environment. Browser and Node runners share one authoritative TypeScript
simulation; Three.js is only a view.

## Product priorities

- Read `docs/product.md`: human play and agent experimentation reinforce each
  other. Faithful, engaging play on **Ysgramor and Artemis** enables rapid human
  feedback; agents use faster-than-realtime headless/protocol/metadata checks.
- The north star is generated historical co-op campaigns from battle accounts
  and real geography, followed by open-ended strategy discovery/self-play as the
  environment hardens. Current 1v1 play is groundwork, not delivered co-op.
- Choose a coherent playable subset before exhaustive AoE2 parity. Prioritize
  shared play, controls, readable visuals and meaningful interactions. Rare edge
  cases need not prevent play; never hide known failures to make a check green.
- Active civilisation development is capped at **three**: Britons is the initial
  baseline; one Native American choice is pending #314; the third slot is unchosen.
  Defer other civilisation implementations and unique-mechanic calibration. Preserve
  shipped content and regression coverage; shared fixes may benefit it incidentally.
- Prefer shared task/state/animation contracts (#315) over per-civilisation tuning.
  Work from milestone 1 and `priority-push`, excluding `deferred` even when an issue
  also has `bug` or `decision`. Re-triage new blockers to focused play; do not expand
  the roster or a native calibration matrix without an explicit scope change.
- Target 1–5 minute normal verification. Measure before adding machinery; retain
  expensive checks only where they establish an outcome cheaper checks cannot.
  Do not block a playable preview on unrelated checks or full asset regeneration.
- Preserve a seed/replay/tick/view context for useful human reports; ask humans
  for perceptual judgement, not work the protocol can answer automatically.

## Start Here

- Run `tools/session_start.sh` first. It reports git divergence, checkpoint/import
  freshness, relevant processes, and the GitHub issue inventory. The active milestone
  is the work queue: within it, human-filed bugs first, then answered `decision` issues, then
  enhancements. File newly discovered gaps with evidence instead of leaving
  them only in prose (`docs/backlog.md`).
- Read `docs/lessons.md` before working; its rules are grouped by the moment
  they apply. Autonomous runs also follow `docs/overnight.md`, one verified and
  pushed item at a time.
- Use `README.md` for the human overview, `docs/play.md` for controls, `docs/architecture.md` for
  boundaries, `docs/status.md` for delivered scope/evidence, and
  `docs/ledger.md` for every approximation. Prune stale status/lessons at
  handoff rather than only appending.

## Hard Boundaries

- `src/sim/` is authoritative. Rendering, UI, agents, debug tools, and imported
  assets may issue public commands but never mutate game state directly.
- Before inventing any rule, value, string, layout, visual, timing, icon, or
  cue, inspect the patch-matched owned DAT/RMS/AI/XS, `widgetui`, graphics,
  localization, shader resources, and sound metadata. Import original content
  deterministically where it exists. Record unavoidable approximations or
  remembered behavior as inferred in `docs/ledger.md` in the same change.
- Do not disassemble `AoE2DE_s.exe`. Compiled shader resources under
  `resources/_common/shaders/d3d11` may be inspected; `tools/probes/sm2dis.py`
  handles their documented Shader Model 2 chunks.
- Preserve the open fallback for users without owned content, but do not lower
  imported-mode fidelity to match it. Desktop is canonical; mobile is remote
  QA only.
- Never commit Steam credentials, game files, converted Microsoft assets,
  `.local/`, `.tools/`, or `public/imported/`. Do not copy GPL/AGPL code into
  this MIT repository.
- Preserve the existing Tailscale routes and Vite mobile URL; never run
  `tailscale serve reset`. Never rebase or rewrite commits on `origin/main`.

## Commands And Verification

```bash
npm install
npm run dev
npx vitest run src/sim/naval.test.ts
npx vitest run src/sim/naval.test.ts -t "works a fish"
uv run --locked python -m unittest discover -s tools -p 'test_import_aoe2.py' -k test_a_sheet_that_fits_keeps_the_one_page_shape -v
npm run verify:owned > .local/verify-owned.log 2>&1
```

- `npm run build` is the typecheck (`tsc --noEmit`) plus Vite build; there is no
  separate lint or formatter task. Python dependencies are locked by `uv`; use
  `uv run --locked`, never ad-hoc `pip` installs.
- `npm run verify` runs conservative selected tests alongside public typecheck/build;
  `verify:full` runs all public tests/build. The checkpoint `npm run verify:owned`
  additionally runs owned import tests and real-browser smoke. Redirect output to
  a file, never through a pipe. `.local/checkpoint.ok` is written only after the owned checkpoint passes, stamped at
  start; any later non-Markdown edit invalidates it. See `docs/TESTING.md`.
  Markdown-only commits need no checkpoint. Commit only green work and push each
  commit; model-provider tests remain opt-in.
- Verification builds with `OPEN_CONTENT_ONLY=1`: do not copy the local owned
  asset tree into `dist` on every check. Owned checks still read source depots and
  `public/`. Per-stage logs/timings are under `.local/verification/`.
- Vitest uses about one worker per physical core (4–8), a 30 s test timeout, and a
  macrotask yield after each test. CPU contention can otherwise report a worker
  RPC failure after every assertion passed. `--maxWorkers=1` now overrides the
  default; `VITEST_MAX_FORKS`/`VITEST_MAX_THREADS` still work for checkpoint runs.
  Run the owned checkpoint on an idle host.
- For long jobs, keep a PID/file handle and wait with
  `tools/wait_for.sh pid|file|gone <target> [timeout]`; do not use `pgrep -f`,
  `pkill -f`, bare `sleep`, or sleep loops. After starting or killing work,
  inspect the process table because wrapper termination can leave children.

## Working Style

- For requested multi-item work, use the issue-backed coordinator/worker contract
  in `docs/orchestration.md`. Independent workers may
  use separate durable worktrees; one coordinator serializes integration, imports,
  owned checkpoints and rollout. No two workers edit the same checkout.
- The default coordinator is Opus 5.5; bounded workers use Haiku 4.5, with one
  focused retry before Astra escalation. Writable children first acknowledge an
  initialization-only prompt, then the parent moves their session into the worktree
  before resuming the assignment. Prompt paths alone do not relocate patch tools.
- After a substantial integrated batch, run a safe-point compression round:
  remove demonstrated dead code/stale prose, consolidate duplicates,
  retain behavioral coverage, and report source-line and build/checkpoint timing deltas.
  Never trim during a rollout or competing edits; a justified no-op is acceptable.

- Complete one playable behaviour end to end before broadening content. A
  production building needs its trainable unit, and a mechanic needs its
  feedback; finish the missing part or file the gap as an issue.
- Turn broad mandates into an explicit checklist with verification per item,
  and report unmet items at handoff.
- Before an interactive handoff, run the checks relevant to the changed code,
  even when no commit is being made. The owned checkpoint still applies at commit time.
- Prefer narrow maintained libraries over custom commodity infrastructure,
  fixture-tested before adoption (`docs/library-strategy.md`).

## Imports

- `npm run import:aoe2` is the only full regeneration entrypoint. It resolves
  `AOE2DE_DEPOT_ROOT` (default SteamCMD app `813780` layout, not a normal game
  install), then runs content, SLD, UI, blend, and optional audio import in the
  required order. Never publish a manifest by running only one stage. Source
  depot/manifest pins are in `tools/aoe2-source.json`; setup is in
  `docs/owned-assets-setup.md`.
- Before changing `import_content.py`, use the genieutils field table in
  `tools/README.md`; do not guess attribute names. Query missing fields with
  `uv run --locked python tools/datq.py fields|get|grep <expr>` and extend the
  table. More than two or three questions should use one script because each
  `datq.py` call reloads the DAT.
- Decoder cache fingerprints are layer-dependent (`tools/atlas_cache.py`):
  shared geometry/packing and `convert`/`convert_mask`/`page_path`/`save_pages`
  edits invalidate all layers; BC1 edits invalidate main/player-colour. Batch
  decoder edits; full rebuild cost grows with the enabled profiles. Never restart before
  checking the process table. `convert_sld.py --terrain-only` is only for a
  terrain-slot change; otherwise run the full pipeline.
- With depot `1039811` present, sprites use `_x2.sld` at manifest `scale: 2`
  and draw at half size; sheets above 8192 px continue in `pages`. Probes must
  divide frame boxes by `atlas.scale`, and source-name tests use the suite's
  `sld(stem)` helper. Measure current disk/residency sizes rather than relying on
  an old single-profile estimate. Watch memory after art-size changes. Conversion
  concurrency is CPU/memory-aware; `AOE2_IMPORT_JOBS` overrides it explicitly.
- Tint masks must remain white/neutral RGB plus alpha because the renderer
  multiplies material colour through them. Re-imported manifests are fetched
  once per page load, so reload tester tabs before investigating stale art.

## Rendering And Debugging

- AoE2 handedness is `+x` down-left and `+y` down-right (`src/view/iso.ts`).
  Direction-to-screen changes must also cover minimap mapping, sprite facing,
  blend neighbours, tile corners, surveyed-map transpose, and water framing;
  `docs/status.md` lists the full projection invariant. To verify a projection
  change, compare against a mirrored earlier screenshot: layout must match to
  the tile, while sprites themselves must not be mirrored.
- Tile and shader-world frames differ. DAT footprints/gate axes/RMS use tile
  space; water shader world space mirrors tile x. The eye is along world
  `(1, -1)`, and water positions are normalized by map size before `mapScale`.
- Edits to `src/view/{world,sprites,hud,assets}.ts` hot-swap. Changes to
  `src/main.ts`, `src/sim/`, `src/protocol/`, or `src/view/iso.ts` require a
  full reload; the dev-session snapshot restores the match. A URL containing
  `?map=` or `?seed=` deliberately declines that snapshot.
- WebGPU does not render in Node. Browser/render verification uses a real
  browser through `/__debug`; headless Chrome uses SwiftShader. Probes and
  measurements must start a private Vite server on a private port with explicit
  `root` and `configFile`: the shared bridge broadcasts to every attached tab
  and accepts whichever response arrives first. `entities` returns at most 200.
- With a game page open, POST `{"type":"sim"}`, `{"type":"entities"}`,
  `{"type":"pixels"}`, or `{"type":"edge"}` to `/__debug`; POST
  `{"type":"command","command":...}`, `select`, or `look` to stage public
  player actions. Use `/__debug/screenshot` only for geometry. Full examples
  and probe-specific invariants are in `tools/probes/README.md`.
- Pixel replies name their colour space; compare only in that space and at the
  reference crop's scale. A screenshot may supplement a passing measurement,
  never overrule a failing number. Reference captures and their settings are
  indexed in `.local/reference/index.md`; current captures use the Enhanced
  Graphics Pack.
