# Handoff

Current operational pointers; delivered scope is in [status](status.md), and the
tracker is the queue. Keep checkpoint narratives in feature evidence or dated
reviews. Do not append old test counts here as if they describe the latest tree.

## Source and verification

### Calibration follow-up tracker (October 9)

The remaining tooling and scope blockers are now filed, rather than left only
in the calibration-run conversation:

- [#308](https://github.com/gszep/age-of-empires/issues/308): exact-coordinate
  native fixtures for gates, aura boundaries, trample and livestock precedence.
- [#309](https://github.com/gszep/age-of-empires/issues/309): saved-scenario reader
  and complete terrain/object censuses; licence and format validation precede
  adopting a library. Supports #308 and map-placement calibration.
- [#310](https://github.com/gszep/age-of-empires/issues/310): paired damage and
  ordinary-combat experiments for hidden HP fractions; depends on #308.
- [#311](https://github.com/gszep/age-of-empires/issues/311): timestamped native
  video for projectile, charge, recoil, explosion and fog timing.
- [#312](https://github.com/gszep/age-of-empires/issues/312): owner decision on
  retaining the pinned executable versus a deliberate permanent reference-build
  migration; startup diagnostics remain #279.
- [#313](https://github.com/gszep/age-of-empires/issues/313): owner decision on
  deferring Caravanserai behind #186 or making Persians a scope exception.
- Audio loopback capture and comparison prerequisites were added to existing
  #243, not duplicated. Related calibration issues have dependency comments.

These are follow-up requests, not implemented tools or new permissions. The
October 5–6 current-build acceptance was run-specific; it did not repin assets.
Recorder installation/elevation and a new-civilisation exception still require
explicit approval. No calibration acceptance is waived by these dependencies.

### Verified source and deployment

- Latest verified source: `57e8d2f` (#95), pushed October 6; later commits are
  Markdown-only. Owned checkpoint `npm run verify:owned` GREEN in 696 s
  (build 19 s, test 290 s, serial 89 s, owned import tests 287 s, browser smoke
  28 s; `.local/verification/1791294547507-1822338/`). No timeout widening.
  Full owned import last regenerated for #259 (October 6). Nothing from the
  October 5–6 calibration run was deployed on October 10 (see below). Reload
  open tabs to pick up new art/strings.
- Deployed October 10, 17:15 BST: release `autonomous-20261010-9193e62` (commit
  `9193e62`, #138 minimap colour/filter modes + Objectives screen; full import;
  verify:owned GREEN 721 s). Release shared/minimap/objectives smokes green before
  the switch; active, NRestarts 0, 200 local and Tailscale. Rollback: the earlier
  October 10 release `autonomous-20261010-4b1c697`. Chat split to #318.
  Closed October 10 under the play-first scope with residuals kept as inferred:
  #41, #110, #131, #133, #178, #138.
- Earlier October 10 deployment, 13:31 BST, after a human report that Celts were not
  selectable: Ysgramor runs `.local/releases/autonomous-20261010-4b1c697`
  (source equals verified `57e8d2f` plus Markdown), fingerprint `605a2b21…5434`.
  The release's own `shared_smoke.mts` and `celts_smoke.mts` passed privately;
  its `shared-host.mts` served on private port 5299; no shared checkpoint
  existed. Afterwards the service was active, NRestarts 0, 200 locally and over
  Tailscale, serving Celts code and manifest profile. This carries Saracens,
  Turks, Vikings, Mongols, Celts and the calibration run. Rollback:
  `node tools/install-shared.mjs host <abs path to autonomous-20261005-c519be9>`.
  Artemis was not checked or refreshed (its local art predates these profiles).
- **October 5–6 calibration run** (coordinator handoff
  `.local/orchestrator/handoff.md`; per-issue evidence under
  `.local/orchestrator/evidence/`). Owner decision for this run: the installed
  DE 101.103.54800.0 (#185872) counts as calibration evidence, recorded as
  "current build, not pinned 48987"; screenshot readings are "observed
  visually". Native control: `.local/native-control.ps1` with tested macros and
  coordinates in `.local/native-macro.sh` / `.local/native-recipes.md`.
  - Closed: #161 ram crew, #253 population ceilings, #254 zero-time research,
    #288 TC cast shadows, #291 relic/garrison flags, #293 research queue, #139
    score, #281 agent ceilings/Wonder timers, #300 doc spacing, #302 Turks,
    #175 path spikes, #305 Mongol Nomads/HP rounding, #301 Vikings/per-effect
    cost rounding, #128 (audit), #59 Promisory reading, #285 Bimaristan,
    #93 (already regenerated), #280 speed.
  - Partial, issue open with evidence: #138 tech tree (other menu surfaces
    remain), #92 top-bar SDF text (selection panel parked in
    `.local/worktrees/issue-92-more-labels`: native weight mismatch), #118
    11 Arabia biomes (snow dusting unmeasurable from captures), #95 offshore
    deep fish (counts/water mask), #131 packed trebuchets no longer auto-deploy,
    #259 packing 11.1/2.8 s (Samurai charge ~30 s recharge, kept vs houses,
    spent vs rams; not modelled), #260 Chinese research floor + volley split,
    #242 Siphons charge vs buildings, #267 healing stacking (trample, building
    HP rounding open), #178 conversion stats (agree), #133, #252, #269, #304,
    #306, #130, #117 (evidence docs only).
  - Version markers now: observation protocol 11 (v9 research queue, v10
    score, v11 ceilings/Wonders), match/recording format 9 (score, biomes,
    packing, Siphons, trebuchet targeting, Islands fish), shared admission 9,
    shared checkpoint 5. Older
    recordings/snapshots replay through one version-aware initialiser. Existing
    shared checkpoints whose rules changed (packing) are rejected at startup and
    preserved — plan the household rollout accordingly.
  - Not merged: #124 AI queue/Market (`.local/worktrees/issue-124-ai-finishing`;
    batch regressed: research rejections 282→6518, no natural Markets) and
    #299 import-test profiling (`.local/worktrees/issue-299-import-tests`).
  - Harness lessons: Haiku workers could not drive the native UI (no reliable
    screenshot reading/navigation) — native tasks went straight to Astra;
    fine unit positioning in the DE editor remained unreliable, so prefer
    readouts and coarse inside/outside setups. The commit guard inspects the
    primary checkout's staged files even for worktree pushes. Background
    launches inside long chained shell commands may start late: wait on the
    PID and confirm the log exists before trusting a done-file.
- Deployed October 5, 12:11 BST: the Ysgramor household host runs release
  `autonomous-20261005-c519be9` (protocol 4), carrying #287/#289 and today's
  fixes; see [shared play](shared-play.md#installed-arrangement) for the
  verification and rollback. Artemis was unreachable over SSH, so a live guest
  join and its older local art remain unverified.
  Owned art was regenerated twice (full cached import, about 9 minutes each);
  reload open tabs to pick up the new terrains and strings.
- October 5 fixes, each with a dedicated real-browser smoke under `tools/`:
  - #297 Cannon Galleon shots draw every imported projectile layer; the ball
    is `idle-layer-1` behind an empty shadow-only first layer
    (`cannon_galleon_smoke.mts`: 82 ball pixels, 0 before).
  - #296 farms under construction step through `Farm Cnst1/2/3` (terrains
    29-31) at equal thirds of build progress (inferred; ledger), then `Farm1`
    (`farm_construction_smoke.mts`). Older imports keep the first stage.
  - #294 aged town center annexes no longer borrow the Dark Age player-colour
    mask; the Asian Castle/Imperial `front` SLDs have none (`tc_annex_color_smoke.mts`).
  - #295 research in progress shows its tech icon in the selection panel with
    "Researching N%" (owned strings 4309/42100); clicking it sends the new public
    `cancel-research` command, which refunds the paid cost (`research_cancel_smoke.mts`).
  - `Ctrl+Alt+R` gives the local player 1000 of each resource in solo play
    (`cheat-resources`, not in the protocol schema; ledger). It works in every
    build, release included; restrict it to dev if the household should not have it.
  - The verification term "gate" is retired: `npm run verify:owned` writes
    `.local/checkpoint.ok` (commit guard) and `.local/checkpoint.latest.json`
    (session start); `tools/gate.sh` is removed. The installed-CLI harness smoke
    was re-run after the guard change. Dated reviews and old `.local/*-gate.log`
    paths keep their names.
- #287 (cold sprite flicker) and #289 (selecting units over farms), fixed in
  `7511606`, are closed after re-verification on `e6d5a9c`: first-appearance,
  sprite/outline residency, farm selection (owned and fallback) and farm
  occupancy smokes pass. Both are deployed; a physical-GPU look at the flicker
  remains, so reopen if the symptom persists on the household release.
- #290 (Shift queueing) is parked at the human's request. Shift-queued
  waypoints, resources and foundations work in browser and sim probes. Two
  candidate gaps await the human's description: Shift-placing several
  buildings was never implemented, and orders queued behind a gather never run
  because gathering does not finish.
- Mongols (#190) and Celts (#191) are the eleventh and twelfth selectable profiles
  (October 5). Full import, `tools/{mongols,celts}_smoke.mts` and the owned
  checkpoint pass; see the [integration receipt](civilization-coverage.md#mongols-and-celts-integration-receipt-october-5).
  `verify:owned` now runs the herding comparisons serially after the parallel
  stage (#307). Not deployed. Open: #304/#306.
- Turks (#188) and Vikings (#189) are the ninth and tenth selectable profiles
  (October 5, coordinator-integrated from two escalated worker trees). Full import,
  `tools/{turks,vikings}_smoke.mts` and the owned checkpoint pass; see the
  [integration receipt](civilization-coverage.md#turks-and-vikings-integration-receipt-october-5).
  Not deployed to the household release. #303 was an art-probe race in
  `tools/civ_browser.mts` (fixed; renderer unchanged).
- Saracens (#187) are implemented as the eighth selectable
  owned profile. Full import and dedicated private-browser acceptance pass;
  [coverage](civilization-coverage.md#saracens-187) records outcomes;
  #285 tracks aura calibration/text discrepancy and #271 the three missing
  regional Trade Cart events shared with Persians. Duplicate#286 was consolidated
  into#271. This source change has not been deployed to the installed household release.
  Final regeneration after consolidation passed (`.local/saracens-final-import.log`).
- Shoreline tile-grid correction (#284): `watershore` now uses complete
  96-pixel source windows with per-family UV layout metadata. The full import,
  shoreline/land/farm probes and owned checkpoint passed; see the
  [correction evidence](terrain-blend-coverage.md#shoreline-tile-grid-correction-284-october 3).
  Regenerated shore assets need the updated viewer. Exact native UV and
  crossing-width calibration remains #116; broader visual acceptance is #113.
- Gameplay baseline: `70bda6c` (#280). Owned match-speed
  names are Slow/Casual/Normal/Fast; new preferences and pristine shared hosts
  default to Normal (1.7). Existing saved indices retain their multipliers.
  [Issue evidence](https://github.com/gszep/age-of-empires/issues/280#issuecomment-5966448309)
  records the full import, feature receipts and green owned checkpoint. Sustained wall-clock,
  factory-reset and pinned-runtime calibration remain open.
- Population ceilings (`bea4e91`, #253) and opt-in Wonder victory (`66bee0a`,
  #110) are implemented across solo/shared/replay flows. See
  [Wonder evidence](wonder-victory.md) and the ledger for native calibration and
  automatic map-size-default limits. Public agent exposure is tracked in #281.
- Run `tools/session_start.sh` for the actual latest owned checkpoint and local process
  state. Feature receipts bind to code/imported metadata; an earlier green
  receipt is not fresh verification after later edits.
- Earlier siege, gate, import, audio and deployment receipts are preserved in
  the [October 2 handoff snapshot](reviews/2026-10-02-handoff.md), originally
  [recorded at this immutable revision](https://github.com/gszep/age-of-empires/blob/70bda6c4e22d6dd1bf20f962a9d6f6b6131f3e09/docs/handoff.md).

## Installed household release

The current rollout is October 10 (above). The notes below describe the
October 2 rollout (protocol 2, seven profiles) and are kept for rollback history. [Shared play](shared-play.md) describes use.

- Ysgramor: `.local/releases/autonomous-20261002-43e10ad`;
  <http://localhost:5173/> and <https://ysgramor.tail6e864b.ts.net:5173/>.
- Artemis gateway: <http://localhost:5174/>;
  `/home/gszep/Documents/repos/age-of-empires/.local/owned-runtime-0d86953`,
  advanced to source `385da49`, proxying the `43e10ad` frontend with local x1 art.
- The snapshot's [deployment receipt](reviews/2026-10-02-handoff.md#live-deployment-26695275276)
  records exact revisions, inventories, hashes, acceptance and rollback paths.
  Its joint health check was October 2 at 08:59 UTC; later Artemis SSH attempts
  timed out. This is not a current remote-health claim. Tailscale routes and
  rollback releases were preserved.

## Resume points and fidelity limits

- **Persians #186:** not enabled. #271's approved exception permits exactly
  three absent Trade Cart events; the isolated eight-profile audio fixture
  passes, not a complete Persian publication. Staged implementation is preserved
  in `.local/worktrees/persians186-blocked`, branch `work/persians186-blocked`,
  base `f94b18e`, with `.local/persians186-blocked.patch`. Recheck that worktree
  before integrating with current main; full regeneration, integration outcomes,
  Persian browser acceptance and owned checkpoint remain required. See
  [source-gap evidence](audio-reference.md#reviewed-persian-trade-cart-source-gaps-271)
  and the historical snapshot for diagnostic logs; aura/payout calibration is #269.
- **Owned source #277:** recovered Slavic monk x1 validates, but default-depot
  copy-back remains open. [Source integrity](source-integrity.md).
- **Native runtime #279:** pinned executable startup fails; observations from
  the installed newer build do not establish pinned-runtime equivalence.
- **AI #124:** Dark-Age-start acceptance is still failing/opt-in; the passing
  staged Feudal/late-game fixtures do not prove natural-start progression.
- Eight source-enabled civilisations are scoped completions, not native-DE parity.
  Terrain/final compositing, conversion exceptions, audio mixing/missing streams,
  automatic research timing, RMS placement and combat/bonus calibration retain
  their explicit [ledger](ledger.md) and tracker boundaries. Gate/trebuchet native
  trigger and automation calibration remain #133/#131.

## Documentation checks

The process follow-through (#262/#263/#264/#265) is complete. The
[checkpoint workflow](checkpoint-workflow.md) describes installed-CLI enforcement
verification and tree/asset-bound acceptance receipts, including scope-change
review. Restart OpenCode after safeguard/plugin changes before an unattended run;
fresh-process evidence does not certify an already-running server. Browser startup
failures retain diagnostics as described in [maintained probes](../tools/probes/README.md).

`node tools/check-current-docs.mjs` checks three scoped completion declarations
against GitHub and their exact block in status. Targeted #264 wording guards
cover status, handoff, backlog and overnight. Historical reviews, ledger and
other prose are excluded; this is not a general semantic freshness audit.
