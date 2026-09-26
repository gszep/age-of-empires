# Handoff — shared limitations, serial checkpoints

## Active assignment

Continue from relic checkpoint **508a2f2** with exclusive serial main authority:
two-player diplomacy interface, then Regicide/Treason. No subagents. Commit/push
authorization is explicit; each checkpoint requires a green gate. Market/charge/
conversion auditing beyond direct dependencies belongs to the coordinator.

## Diplomacy checkpoint

- Native Diplomacy button opens the actual two-player dialog, also reachable
  from the market. Imported WPFG columns, row sizes, fonts, tribute icon states
  and existing native frame/buttons replace the compact tribute command page.
- Existing matches are locked opposing teams. Ally/Neutral/Enemy controls and
  Allied Victory are shown disabled; Lock Teams is checked. No unlocked relation
  changes, shared vision or cooperative victory is offered.
- Draft100/Shift500/CTRL-all, right-click subtraction, Clear, Cancel/Escape and
  OK. One public `tribute-batch` atomically validates all resources before paying.
  CTRL-all resolves using execution-time stock and fees, including the sender
  fee in the budget. Missing/destroyed markets and malformed/stale commands fail
  without partial payment. Old single-resource commands remain accepted.
- Modal input containment, focus return, view teardown and read-only replay are
  covered. The dialog changes no simulation state until its public command.
- Source reads: `widgetui/diplomacy.json`, `dialog/dialogdiplomacy.xaml`,
  `SystemResourcesDiplomacyItem.xaml`, sibling fonts/buttons and English
  strings30350–30356/9851–9865/99857–99859/30630. Inferences are in the ledger.
- Full pipeline: `.local/diplomacy-import-r2.log`, exit0; atlas cache reused.
  `tools/diplomacy_smoke.mts` passes owned and `OPEN_FALLBACK=1` runs, including
  actual research/payment clicks and replay file input. Focused market tests and
  owned UI extraction contract pass. Full gate **GREEN**, exit0:
  `.local/diplomacy-gate-r1.log` — **931 tests /72 files**, build,
  **126 owned-content tests**, real-browser debug smoke. One worker; no widened
  test clocks. No source changes followed the gate start.
- Corrected the ledger claim that the user approved the exact conversion
  inheritance inference: authorization covered work, not that agent decision.

## Next: Regicide/Treason

Not implemented by the diplomacy checkpoint. Add real setup/persistence/restart/
shared/headless/replay mode, King434 with original content, king-loss outcomes
including nested garrison/transport and simultaneous losses, repeatable400-gold
Treason with temporary flashing minimap X rather than permanent Spies reveal.
Do not claim an exact reveal duration if sources only say “a few seconds.”

Reads already made:
- Modern `includes/regicide.inc`: King nearest villager distance5, castle within
  circular13 toward centre, zone4/forest3/cliff3/edge4. Normal villagers.inc
  Regicide branch creates10 villagers (not the ordinary couples-therapy2+1).
- Islands `GeneratingObjects.inc`2606–2673: King6–8 box band,7 additional
  villagers at6, GNR_REGICIDECLASSIC castle at10 box distance.
- Localization28408/41112/41114: Treason400 per use, temporarily reveals enemy
  Kings to team as flashing minimap X; no exact duration stated there.
- `Constants.xs`: startingVillagers84, startingFood/Wood/Stone/Gold91–94;
  Spies183, temporaryMapReveal209. Inspect actual values/config before inventing
  extra starting resources. King DAT and graphics still need the planned read.

## Prior verified work and operations

- Relics508a2f2:5 Arabia/4 Black Forest/5 Islands; owned RMS numeric refdata;
  prerequisite land/start corrections;50 seeds/map; generated Islands collection
  and transport browser journey. Gate929 tests/72 files, build,125 import tests,
  browser smoke. #130 retains native placement calibration; #95 retains fish gaps.
- Britons/Franks remain the only enabled profiles. #179 records prior Briton
  acceptance; #178 retains conversion inference boundaries. No all-civ expansion.
- Preserve managed shared service and Tailscale routes. Private probes use their
  own Vite ports, explicit root/config. Solo QA: localhost:5173/?solo=1.
- Owned assets, `.local/`, saves and credentials stay out of Git. Full import
  regeneration only through `npm run import:aoe2`; one-worker full gate on idle host.
