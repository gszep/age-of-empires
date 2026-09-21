# Agent handoff — 2026-09-21

## Human request and stopping point

The human requested, in sequence, **#79, #87, #132, #143, #146, #147 and
#97**, then explicitly asked: **“commit and push, update docs, prep handoff.”**
This checkpoint publishes the accumulated, verified implementation work.
The last implementation request was #97; **no next issue is assigned**, and
the human explicitly declined another issue recommendation at its completion.
They want unit completeness before returning to AI progression work.

Implementation base: `3ea48a3`. The checkpoint commit identifies all seven
issues; use `git log` and their verification comments for its hash. The older
September 20 handoff and its #88 acceptance evidence remain in Git history.

## Repository and operational state

- Workspace: `/home/fraser/repos/age-of-empires`, branch `main`.
- **`AGENTS.md` had a pre-existing human edit. It is intentionally left out of
  this checkpoint and should remain the only local modification after publish.**
- Never commit owned depots, converted assets, `.local/`, `.tools/`, credentials
  or crash dumps. Preserve the saved match and unfamiliar user work.
- **The managed shared host is stopped.** Its saved checkpoint no longer matches
  the rules/version; restarting it blindly caused a loop. See #157/#158.
  The last check was `ActiveState=inactive`, `SubState=dead`, `NRestarts=9`.
  It was stopped, not disabled, so inspect it again after a WSL restart.
- Preserve `.local/shared-match.json`,
  `.local/shared-match-before-sync-fix.json`, browser saves and Tailscale routes.
  The error message suggesting moving the checkpoint aside is not permission
  to discard the human's match. Shared rollout needs compatibility handling or
  an explicitly agreed new match with the checkpoint retained.
- Configured Ysgramor URLs remain `http://localhost:5173/?solo=1` and
  `https://ysgramor.tail6e864b.ts.net:5173/?solo=1`; they require the host to be
  running. Verification used private servers, not that paused deployment.
- Artemis rollout/two-machine acceptance was not performed. The previous
  handoff records `/home/gszep/Documents/repos/age-of-empires`, its local
  gateway on 5174 and `.local/shared-runtime/public`; reconfirm its current
  state and preserve its existing documentation edits before changing it.

## Verification — the actual current gate

**Full gate GREEN:** `.local/issue97-final-d1646.log`, exit **0** in
`.local/issue97-final-d1646.exit`, started **2026-09-21 16:48 BST** after the
Ubuntu storage migration. It passed:

- **602 Vitest tests across 44 files**;
- TypeScript typecheck and Vite production build;
- **82 owned-content import tests**;
- real-browser debug smoke, including queueing past the population cap.

`.local/gate.ok` is the gate-start-stamped sentinel. Only Markdown updates
followed the verified code. Existing fixture time limits were not widened.

**Final naval browser check:** `.local/issue97-naval-final-d1659.log`, exit
**0** in its matching `.exit` file. All four scenarios passed after the gate:
dock buttons/shared upgrade art, boarding and shore-targeted unloading,
fish-trap placement/income, and rendered fire projectiles.

The latest complete owned-content regeneration is
`.local/issue97-import6.log`: the full `npm run import:aoe2` pipeline,
**2,777 cached atlases reused** plus the new fish-trap decay atlases. There
were no decoder changes requiring a full atlas rebuild. Reload tester pages
after importing because manifests are fetched once per page load.

Maintained browser checks added in this checkpoint (run with `npx tsx`):

| Script | Verified behavior |
|---|---|
| `tools/build_gather_smoke.mts` | Real right-click construction into automatic gathering at all three camp types |
| `tools/fishing_continuation_smoke.mts` | Deplete, bank, return through fog, fish again; exact 17-food deposit |
| `tools/villager_gather_smoke.mts` | Real hunter/farmer orders bank 35/10 food |
| `tools/population_queue_smoke.mts` | Shift queues five beyond housing, 100% wait/message, portrait refund, house releases queue |
| `tools/ai_house_recovery_smoke.mts` | Page AI replaces a deleted builder and completes the same paid house with zero wood |
| `tools/ai_camps_smoke.mts` | Page AI skips a redundant mill and completes one at a separate patch while wood remains |
| `tools/naval_units_smoke.mts` | Four final naval scenarios above |

The first six passed during their implementation sessions; the naval check
was rerun after the final full gate. All start private Vite servers with explicit
root/config and close their browser/server afterward. No temporary test or
import processes remain running.

## Delivered behavior

- **#79:** participating camp builders automatically choose visible nearby
  trees, nearer gold/stone, or berries/free owned farms for mills. Queued
  commands take precedence. The mill restriction is the human's clarification:
  no herdables, huntables or fish in construction continuation.
- **#87:** clearance is checked outside a resource's complete footprint rather
  than inside a deep fish's own collision box. Fishing ships remember their
  working position when a node disappears during banking, return, then choose
  a currently visible replacement. Stop/new orders cancel the continuation.
- **#132:** all eight villager task variants consume owned gathering rates and
  capacities, with their own technology effects. Hunters gather at 0.41/s into
  35, farmers 0.53/s into 10. Loads retain task identity when their source
  disappears; that internal field is excluded from public observations.
- **#143:** paid training queues may exceed housing. A finished unit stays at
  100% until its full population cost fits, then releases before the next entry
  trains. The owned housing message is displayed; cancellation refunds remain
  valid. Simultaneous producers cannot take the same final population slot.
- **#146:** the AI resumes unstaffed paid houses without buying another one,
  recognizes builders still approaching, treats rounded 100% foundations as
  unfinished, reserves assignments against other decisions and keeps builders
  out of its demolition force.
- **#147:** camp selection scans onward for useful unserved supply, excludes
  fish from land-economy mill targets and respects pending foundations. Mills
  have a conservative redundancy guard across the full placement cycle;
  useful nearby lumber/mining camps remain possible per the human's distinction.
- **#97:** the current Britons dock roster includes galley/galleon, hulk,
  fire and demolition lines, Cannon Galleon, Transport Ship and Trade Cog.
  The shared Medium/Heavy Warships researches resolve automatic child upgrades;
  Cannon Galleon requires Chemistry. Britons' unavailable Carrack/Elite Cannon
  Galleon are excluded. Transport capacity is the owned **20**; passengers keep
  loads/population/research, unload at shore and are lost when the carrier sinks.
  Fishing ships build exclusive **100-wood / 700-food** traps with manual
  rebuilding and the owned 60-second depleted/rubble art. Composite hull/sail
  clocks, offsets, masks and underwater art are imported; fire shots use the
  owned flame flipbook with an inferred emitter binding.

### Contract changes

The observation contract is **version 3**. Version 2 added own-only
`buildTargetId`; v3 adds naval kinds, `fish-trap` and the `unload` order.
`ungarrison.target` optionally names a transport's destination shore.
Match configuration, result and recording formats remain **version 1**.
See `docs/agent-runtime.md` and the JSON schemas. Enemy build assignments stay
private; simulations, scripts and UI continue to use public commands.

### Approximations and remaining scope

`docs/ledger.md` records the chosen/inferred details: continuation/search bounds,
AI placement/recovery policy, fractional-capacity rounding and task-switch
banking; transport landing/conversion/loss, demolition blast interpretation,
negative attack arithmetic, flame-emitter representation, trap construction and
manual reseeding, and the inherited trade-income formula. These are not claims
of complete DE engine equivalence or pixel-identical presentation.

Shipwright's train-time/wood-cost attributes **101/104** remain under **#128**;
owned evidence was added there. The example AI does not yet operate the naval
economy (#91). These and the remaining unit-completeness items are context,
not authorization to start more work. New shared-play acceptance, hardware-GPU
performance and exact reference calibration of the inferred naval rules have
not been performed.

## WSL crash, cleanup and migration

- Ubuntu was moved with WSL's supported command to **`D:\WSL\Ubuntu`**.
  Registry and Windows launch checks passed. Linux paths, including the repo
  and SteamCMD depot path, stay the same. Node is **v24.20.0**.
- C: went from about **5.9 GiB free / 98% full** to **86 GiB free**; D: has
  about **1.2 TiB free**. The final gate and naval browser test completed after
  migration with no matching new kernel I/O, machine-check or OOM entries.
- The human confirmed their Windows Terminal shortcut works with
  `wt.exe -p "Ubuntu" wsl.exe -d Ubuntu --cd ~`.
- Approved cleanup removed the old `dist/` and `.tools/import-venv`, reclaiming
  **5.59 GiB**. Home-cache deletion was blocked by session permissions and apt
  needed a password; manual commands were provided to the human. Current
  dependencies, owned depots, imported content and saved matches were preserved.
  The final production build recreated `dist/`, as expected.
- Raw source depots occupy about **40 GiB**, active imported assets **6.8 GiB**.
  A metadata audit found about **1.11 GiB** of potentially duplicate atlases
  across 231 groups; a sample was byte-identical. Evidence is on **#152**.
  These are referenced assets, not files to delete without importer changes.
- Crash files are local-only under `.local/wsl-crashes/`. The Sep 20 panic
  reports a fatal machine check/processor context corruption. Sep 21 dumps show
  OpenCode and `gettext` SIGBUS in executable mappings and journald SIGSEGV.
  System package checksum checks passed; surviving logs do not establish an
  OOM cause. **The original crash cause remains unproven.** Do not conflate the
  hardware report, storage pressure and service restart loop into one diagnosis.
- The shared host had thousands of restarts on its permanent checkpoint mismatch
  before it was stopped. **#157/#158** record the duplicate reports. Keep it
  stopped until compatibility/recovery is addressed, preserving the checkpoint.

## Start the next session here

1. Run `tools/session_start.sh`, then inspect actual Git/service/process state.
   **#155 remains relevant:** that summary reads the old default gate log and
   misses managed services. Trust the explicit logs above, `.local/gate.ok`,
   `ps` and `systemctl --user` instead.
2. Preserve the human's `AGENTS.md` edit. Do not stash/reset unfamiliar work.
3. Read issue comments and the ledger. The seven issues above belong to this
   checkpoint, not a fresh implementation queue. Wait for the human's next
   request; no new issue was selected at this handoff.
4. Start long jobs with a PID/unique exit-file handle. After a disconnect/reboot,
   first confirm the process still exists. Report stage progress using live
   logs; a stale tool wait is not a running gate.
5. Further source edits require fresh verification. Commit only green work,
   push each requested checkpoint, and never rewrite published history or commit
   owned assets, credentials, saved matches or crash dumps.
