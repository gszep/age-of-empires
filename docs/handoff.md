# Handoff — two-player diplomacy and Regicide/Treason

## Assignment and checkpoints

Serial exclusive-main implementation; no subagents. User authorized work and
commit/push, **not exact engine inferences**. Relics are in 508a2f2; diplomacy is
pushed as **ec26a02**. This checkpoint delivers Regicide with the green receipt below.
Market/charge/conversion audit beyond direct dependencies remains with the
coordinator; no all-civilisation expansion or unrelated #138 surfaces were taken.

## Acceptance checklist

- [x] Two-player Diplomacy opens from the native button and market, using owned
  WPFG geometry/fonts/icon states. 100/Shift500/CTRL-all, right-click subtraction,
  Clear/Cancel/OK, atomic payment, current fees/stock and market-loss rejection.
  Replay is read-only. Existing opposing teams remain locked; relation and Allied
  Victory controls are disabled. No unlocked/allied gameplay is offered.
- [x] Regicide setup checkbox and direct `?mode=regicide` selection; mode persists
  through save/reload/restart, shared snapshots/checkpoints, headless and replay.
- [x] King434 source stats/flags/art/icon/voice in both enabled profiles.75HP,
  speed1.32, LOS6, unarmed/untrainable, conversion immunity and Delete confirmation.
  Public shelter works and displays the original occupied-building flag.
- [x] Ten villagers and Castle/player. Modern RMS bands plus **Black Forest's
  REGICIDE_BACKWARD override**, and Islands' separate classic bands. Source
  contract: `src/sim/refdata/regicide.json` / `tools/regicide_reference.py`.
- [x] Royal survival scans nested carriers. Combat loss ends the game; razed
  buildings can release their King, sinking ships lose cargo. Simultaneous
  losses draw, with explicit state/protocol/result and HUD explanation.
  Nested population is counted recursively by each passenger's owner, including
  an immune King aboard a converted enemy carrier.
- [x] Repeatable400-gold Treason: current King/carrier positions on the minimap,
  flashing X, no research queue/journal or normal fog reveal. Random-map Spies
  is mode-isolated. JSON continuation preserves the paid reveal window.
- [x] 50 seeds per RMS map; all six maps deterministic/JSON-continuable. Real
  shared-wire tests cover payment, mode restart/checkpoint, invalid modes and
  old-client rejection. The existing relic transport journey still passes.
- [x] `tools/regicide_smoke.mts`: real setup/King click/voice, reload/restart,
  return to RM, paid Treason with blink/expiry pixels at hidden garrisoned King,
  shelter/flag, royal Delete defeat, actual-file-input v2 replay verification.
  Simultaneous public King deletions also verify the draw popup without a false
  winner/defeat frame.
- [x] `tools/regicide_shared_smoke.mts`: two real clients, guest setup locked,
  actual Treason click/payment and equal hashes, both mode switches, reconnect.
- [x] Final Regicide full gate: **960 tests /73 files**, build,
  **128 owned-content tests**, real-browser debug smoke; exit0 in
  `.local/regicide-gate-r3.log`. One worker, unchanged test timeouts.

## Verification receipts

- Diplomacy: `.local/diplomacy-gate-r1.log` GREEN, **931 tests /72 files**, build,
  **126 owned-content tests**, browser smoke. Owned and fallback dedicated browser
  checks pass. Full pipeline `.local/diplomacy-import-r2.log`, exit0.
- Regicide full pipeline `.local/regicide-import-r1.log`, exit0. Original King
  layers were converted; existing atlases reused. Source contracts pass for both
  profiles. Focused Regicide/session/relic checks pass; private solo and
  two-client browser evidence above. No test clock widened.
- Final gate regressions were contract assumptions, now corrected: spawn-only
  King definitions are not trainable offers, observation pins follow v7, and the
  King retains only its actually present owned name rather than invented
  creation/help text. No non-Markdown edit followed the final gate start.
- A diplomacy probe's retained `$eval` handle could detach between CDP calls,
  yielding a zero rectangle. Querying/measuring in one browser turn fixes that
  probe race; it does not change gameplay or widen clocks.

## Exact boundaries and operations

- #240 tracks native calibration:10-second Treason lifetime, half-second blink,
  X size, live tracking/refresh semantics and Castle/no-age/no-queue availability;
  inherited starting-resource preset; King garrison-category mapping, immunity
  inside converted carriers and extra task109/Guard13 semantics. These are agent
  integration choices, not user-approved facts or measured DE parity.
- RMS adapter uses seeded scans, integer positions, simplified actor exclusion
  and existing land IDs. Cliff rules are vacuous without cliff entities (#134).
  Survey/proof starts are explicitly authored nearest-legal placements.
- #124 records absent King-specific shelter/escort/Treason strategy decisions;
  King is not treated as an army unit. #130/#95 retain relic/fish calibration gaps.
- Observation **v7**, new records/results **v2** with mode. Legacy record **v1**
  requires no mode and means RM. Shared **v2** rejects v1 clients/checkpoints;
  incompatible checkpoints remain preserved. Dev save **v3** accepts old v2 only
  when mode is absent. Mode metadata is checked rather than guessed.
- Private tests never use the shared debug broadcast or managed checkpoint.
  The existing managed shared service remains active; it has **not been deployed
  to protocol2**. New shared clients need a matching host deployment. Preserve
  its live match/checkpoint and Tailscale routes; follow `docs/shared-play.md`.
- Britons/Franks remain the only enabled profiles. No owned/converted assets,
  credentials, `.local/` or saves belong in Git. Only full import pipeline runs
  publish assets. Gate uses one worker on an idle host.
