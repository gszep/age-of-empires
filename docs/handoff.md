# Handoff

Current operational pointers; delivered scope is in [status](status.md), and the
tracker is the queue. Keep checkpoint narratives in feature evidence or dated
reviews. Do not append old test counts here as if they describe the latest tree.

## Source and verification

- Saracens (#187) are implemented as the eighth selectable
  owned profile. Full import and dedicated private-browser acceptance pass;
  final gate `.local/saracens-final-gate.log` is GREEN:1403 tests/111 files (eight existing
  skips), build,204 owned-import tests and general debug smoke. No timeout
  widening. [Coverage](civilization-coverage.md#saracens-187) records outcomes;
  #285 tracks aura calibration/text discrepancy and #271 the three missing
  regional Trade Cart events shared with Persians. Duplicate#286 was consolidated
  into#271. This source change has not been deployed to the installed household release.
  Final regeneration after consolidation passed (`.local/saracens-final-import.log`);
  the complete gate ran865s, including the real-browser smoke.
- Shoreline tile-grid correction (#284): `watershore` now uses complete
  96-pixel source windows with per-family UV layout metadata. The full import,
  shoreline/land/farm probes and checkpoint gate passed; see the
  [correction evidence](terrain-blend-coverage.md#shoreline-tile-grid-correction-284-october3).
  Regenerated shore assets need the updated viewer. Exact native UV and
  crossing-width calibration remains #116; broader visual acceptance is #113.
- Gameplay baseline: `70bda6c` (#280). Owned match-speed
  names are Slow/Casual/Normal/Fast; new preferences and pristine shared hosts
  default to Normal (1.7). Existing saved indices retain their multipliers.
  [Issue evidence](https://github.com/gszep/age-of-empires/issues/280#issuecomment-5966448309)
  records the full import, feature receipts and green gate. Sustained wall-clock,
  factory-reset and pinned-runtime calibration remain open.
- Population ceilings (`bea4e91`, #253) and opt-in Wonder victory (`66bee0a`,
  #110) are implemented across solo/shared/replay flows. See
  [Wonder evidence](wonder-victory.md) and the ledger for native calibration and
  automatic map-size-default limits. Public agent exposure is tracked in #281.
- Run `tools/session_start.sh` for the actual latest gate and local process
  state. Feature receipts bind to code/imported metadata; an earlier green
  receipt is not fresh verification after later edits.
- Earlier siege, gate, import, audio and deployment receipts are preserved in
  the [October 2 handoff snapshot](reviews/2026-10-02-handoff.md), originally
  [recorded at this immutable revision](https://github.com/gszep/age-of-empires/blob/70bda6c4e22d6dd1bf20f962a9d6f6b6131f3e09/docs/handoff.md).

## Installed household release

The last recorded authorised rollout is October 2, protocol 2, seven profiles;
later source changes above have not been deployed. Source protocol 4 and
installed protocol 2 are distinct. [Shared play](shared-play.md) describes use.

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
  Persian browser acceptance and gate remain required. See
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
