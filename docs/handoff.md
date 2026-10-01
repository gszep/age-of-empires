# Handoff — post-mortem follow-through, 2026-10-01

## Follow-up checkpoint: #258 and #265

- #258 preserves the resource node in rendered fog snapshots. The real-browser
  `fish-fog` regression failed before the fix (fish bound to berries artwork)
  and passes for deep fish, shore fish and berries through scout departure/return.
- #265 now captures navigation/readiness failures before browser shutdown:
  `.local/browser-diagnostics/startup-*/{events,page,renderer}.json` retain request,
  console/init-error, DOM/readiness, GPU and host-load evidence. Node-side evidence
  is written first; each subsequent diagnostic query is bounded to five seconds.
  Original startup errors propagate and the60-second readiness clock is unchanged.
- The intentional real-browser failure fixture passes, with an acceptance receipt
  in `.local/acceptance/browser-startup.json`; `fish-fog` was also reverified on
  the combined tree. This is diagnostics coverage, not a proven startup-cause fix.
- Full gate **GREEN**, `.local/issue265-gate.log`, **17m05s**:1193 TypeScript tests
  passed (8 explicit skips), build,177 Python tests and general browser smoke.
  No existing assertions or timeouts were relaxed. Earlier failed gate evidence
  remains in `.local/fish258-gate.log`; its standalone recheck also timed out.
  Two instrumented standalone checks and the final gate passed, so the original
  intermittent startup cause remains unproven.
- These follow-up changes are included in this source checkpoint. The pinned
  shared release still predates them.

## Work in this checkpoint

The owner requested the six corrective actions from the
[post-mortem](reviews/2026-10-01.md) and authorised committing/pushing the verified
checkpoint. No new civilisation or native gameplay policy was
introduced. [Checkpoint workflow](checkpoint-workflow.md) documents the tools.

- **Shared deployment (#241):** the owner explicitly confirmed no current match
  needed preservation. Passive inspection found the host already at protocol2
  after its reboot. The actual remaining join failure was the gateway's hardcoded
  version1, now replaced with the host's config and player2 override.
- Ysgramor serves pinned code/JSON metadata from
  `.local/releases/review-followthrough-final`; Artemis runs
  `.local/shared-gateway-review241/tools/shared-join.mjs` with its unchanged
  `.local/performance-runtime-bebb06e/public` base-art path. Both endpoint configs
  report protocol2, both services are active with zero restarts, routes unchanged.
  The final release includes private Vite-cache isolation. Its fingerprint is
  `a90b773162af5fb34ce0a50b883c7eb81369b7efbeb7c414febbfaef5b676361`.
  Private CLI startup checked all release hashes and matching host/frontend
  version before installation (`.local/review-release-start.log`). No household
  connections were present when switching; no checkpoint needed archiving.
- Final read-only Artemis inventory found117 base-Briton entities and no extra
  civilisation profiles in its retained asset manifest. #266 tracks a current
  isolated base-art regeneration and actual remote asset acceptance. The wire
  fix and private current-assets smoke do not establish complete six-civ art on
  that older deployed import. Its existing files were preserved.
- The private candidate's two-browser smoke passed actual train clicks, equal
  state, selection-preserving resync, guest reload,1500+ ticks without unintended
  resyncs, local guest art, and checkpoint restart/reconnect. Log:
  `.local/review241-smoke-r3.log`. Earlier failures remain: r1 exposed the real
  gateway mismatch; r2 exposed the old probe's detached-button click. The probe
  now uses the same real locator click as maintained civilisation acceptance.
- **Acceptance (#263):** registry/runner binds results to code and imported JSON,
  exposes unmapped paths, and records fixture/assertion/clock scope notes.
  Original #124 Dark-Age-start acceptance was restored as a separately named
  opt-in case. It still fails to build a range by six minutes; the Feudal-start
  component remains separate. This is not a newly passing AI acceptance claim.
- **Active harness/supervision (#262):** auto-discovered OpenCode plugin invokes
  existing wait/commit guards. Installed-CLI mock-provider smoke proves refusal
  of prohibited waits and missing/stale gates plus a successful gated scratch
  commit. Fresh-process preflight checks the evidence fingerprint and CLI version.
  **Restart OpenCode to activate it in the user's session.**
- External supervised runs have total and completed-tool-idle deadlines,
  finite live-PID job leases, process-group termination and durable status. The
  wrapper must launch a run; it does not supervise an already-running chat.
  Tool completion is not proof of integrated feature progress or quota headroom.
- **Integration:** one managed worktree under `.local/worktrees`, with a creation
  lock and refusal to retire dirty/unmerged work. Existing .local test exclusions
  remain. Unrelated old worktrees were preserved.
- **Cache (#257):** per-layer fingerprints and source/frame/layer lookup survive
  canonical namespace changes; all pages are copied to new canonical locations.
  Unknown cache schemas/changed legacy fingerprints miss safely. A known,
  unchanged whole-decoder legacy hash can migrate without unnecessary decoding.
  Source integrity still runs before reuse.
- Full import passed: all4101 groups reused; root/UI/audio manifest SHA256s are
  byte-identical before/after (`.local/review257-import.log`, exit0). Dependency
  mutation, cached-vs-clean fixture decode, multipage relocation and legacy tests
  pass. No wall-time speedup is claimed without a controlled real workload.
- **Docs (#264):** status pruned from970 lines to a current-scope summary; obsolete
  Briton/Frank/scatter claims removed. Startup now states the actual scope of its
  heuristic scan. A small explicit completion registry is checked against GitHub;
  it does not certify arbitrary historical prose.

## Final verification

- **Full gate GREEN**, `.local/review-followthrough-gate-r2.log`, exit0, **16m42s**:
  **1193 TypeScript tests/98 files**,8 explicit skips, build, **177 Python tests**
  and real-browser debug smoke. No existing timeout was widened. The skips are
  seven generic Gothic fortification cases unavailable in that profile plus the
  explicit #124 opt-in scenario; Gothic rejection/non-spending tests run normally.
- The first gate passed unit/build/import stages but timed out on browser startup.
  An instrumented unchanged-code rerun passed, then the whole second gate passed.
  The first remains failed evidence; root cause is unproven. #265 tracks missing
  startup diagnostics (implemented in the follow-up above). Do not describe
  this as a fixed renderer/cache regression.
- Final shared browser receipt: `.local/acceptance/shared.json`, pass against
  code/metadata fingerprint `927b246d02d0b5ac43580c3ffe5ee167bb12626ba7ee3d6b27f39fec67daf15c`;
  log `.local/review263-shared.log`. The AI counterpart records status1/failure at
  the same fingerprint (`.local/review263-ai.log`), not a hidden successful check.
- Installed CLI auto-discovery smoke and unattended preflight pass. Evidence:
  `.local/harness.ok.json`; current smoke directory
  `.local/harness-probes/run-RW5o4c`. Existing live OpenCode still needs restart.
- The second full gate itself ran under the external supervisor with40-minute
  total/30-minute idle limits and exited0; durable state:
  `.local/runs/review-gate-r2/status.json`. Short fixtures separately exercise
  stuck/heartbeat processes, deadline termination and finite long-job leases.
- Final process inspection found no private gate/import/browser jobs. Only the
  intended managed shared service survives. Artemis's gateway remains active,
  NRestarts0; both installed configs report v2 with the correct player seats.
- #257's real decoder-change timing benchmark/full fresh owned re-decode remain
  unmeasured. Cached-vs-clean fixture outputs and unchanged published manifests
  are verified; no elapsed-time saving is asserted.
- This checkpoint includes the implementation files, post-mortem and workflow
  documents. Restart OpenCode after updating to activate the new safeguards.

## Play and remaining product work

- Solo: <http://localhost:5173/?solo=1>.
- Shared host: <http://localhost:5173/>; Artemis gateway:<http://localhost:5174/>.
- Tailnet:<https://ysgramor.tail6e864b.ts.net:5173/>.
- Six owned profiles remain enabled: Britons, Franks, Goths, Teutons, Japanese,
  Chinese. General native calibration is not implied by scoped completion.
- #258's fog resource fix and #265's diagnostics are verified in the follow-up
  checkpoint above. Native terrain/compositor,
  conversion exceptions, audio/missing streams, zero-time research, population,
  Japanese/Chinese calibration and wonder countdown remain in the tracker.
  This process task did not resolve them.
- Source-changing imports or npm installs must not mutate shared art/dependencies
  during an active match. Releases pin code and JSON, not all bulk asset bytes.
  Incompatible checkpoints still fail with78; no generic migration is supplied.
