# Handoff — verified Briton gameplay

## Completed task

The user's latest assignment was **“work on finishing the britons.”** Briton
playable/random-map acceptance is recorded in closed issue **#179**, with the
shared limitations below. Do not resume the earlier all-civilisation run or
enable more profiles without a new assignment. Britons and Franks remain the
only enabled owned profiles; Franks' completion issue is separate.

Pushed implementation checkpoints:

- `db2c9c0`: fortifications, building age stats, Petards/Siege Towers, ram crews,
  relic/monastery gameplay, Warwolf/deployed siege effects, Shipwright/Caravan,
  garrison firepower and original-price production refunds.
- `605f7f7`: Siphons, random-map Spies, Guilds, Coinage and Banking, including
  source art, public commands, UI and observation v6.
- `41811c7`: acceptance evidence and tracker/documentation reconciliation.

The prior bonus/profile checkpoint is `4ba51db`; converted-rule snapshots and
additional/replacement town centres are in `0458053`. Historical HUD evidence
is in `docs/reviews/2026-09-24-issue58.md` and `0458053:docs/handoff.md`.

## Verification

**Final gate GREEN:** `.local/britons-final-gate-r1.log`: **906 Vitest tests /
70 files**, production build, **124 owned-import tests**, real-browser debug
smoke. One Vitest worker; no test timeout widened. Source/test changes preceded
the run; subsequent documentation-only edits do not invalidate it.

The full import passed in `.local/britons-final-import.log`; no decoder changes
or partial manifest publication. Dedicated browser evidence:

- `tools/briton_final_smoke.mts`: actual clicks on all five final research
  buttons, buy/sell payments, tribute fees 30% → 20% → 0%, dynamic Spies
  pricing/reveal, and Siphons flight/impact. The original grenade A/B check
  changed **729 sRGB pixels**. Log: `.local/britons-final-research-browser.log`.
- `tools/monastery_smoke.mts`: published relic/carry art, real Drop Relic,
  deposit/income, Devotion and Warwolf buttons, public unpack/attack, actual
  splash damage. Log: `.local/britons-monastery-browser-diagnostic.log`.
- Maintained earlier acceptance: `tools/buildings_smoke.mts`,
  `tools/specialists_smoke.mts`, `tools/civilization_profiles_smoke.mts` and
  `tools/town_center_smoke.mts`. Advanced scenarios are snapshot-staged;
  subsequent commands and rule clocks exercise the real simulation.

The intermediate `db2c9c0` gate passed 898 tests, build, 123 import tests and
browser smoke (`.local/britons-playable-gate-r5.log`). Earlier failures exposed
stale inventory/volley assertions, terrain-cache initialization, sibling-worktree
test discovery and browser-listener readiness. Their fixes preserve actual
source invariants; the sheep simulation test required one worker to avoid its
unchanged 30-second timeout. Browser staging also needed sufficient wood for
Warwolf and targets inside, rather than exactly on, the splash boundary.

## Explicit limitations

- **Relics:** Arabia places five through a documented RMS-zone approximation.
  Other-map placement remains #130/#95. No relic/wonder victory was added;
  wonder presentation/countdown belongs to #110.
- **Market/tribute:** fees are DAT-backed; price bases, movement, bounds and
  rounding are documented engine inferences. The compact tribute page is not
  the full diplomacy dialog (#138); CTRL-all tribute is not implemented.
- **Spies:** random-map reveal/pricing is implemented. Regicide/Treason is not
  an implemented game mode.
- **Siphons:** mode-6 charge behavior uses owned values and original projectile/
  impact art. Initial charge, recharge/attack cadence and vanish interpretation
  remain explicit inferences, not measured closed-engine parity.
- **Conversion:** #178 retains its unit-local snapshot policy and reference
  caveats. Captured deployed trebuchets retain both forms when repacked.
- General render/audio/native-interface gaps retain their existing issues.

`docs/ledger.md` is the source/inference record, and
`docs/civilization-coverage.md` carries the profile/acceptance boundaries.

## Files and operations

- Core: `src/sim/{rules,technologies,buildings,relics,monastery,relic-placement,
  market,fire-charge,game}.ts`; public UI in `src/main.ts`.
- Import: `tools/{import_content,buildings,naval,civilization_profiles}.py`,
  `tools/import-spec.json`; all regeneration through `npm run import:aoe2`.
- Production receipts, relic ownership/income, faith and charge are serialized
  simulation state. Observation v6 includes market/research quotes; match/replay
  formats remain v1.
- Temporary implementation worktrees belong in persistent ignored storage,
  not `/tmp`: the original unintegrated patches were lost after restart.
  `.local/**` is excluded from Vitest discovery. The reconstructed monastery
  worktree remains in `.local/briton-monastery`; it is not an active worker.
- No import, gate or private browser/probe jobs remained at handoff. The managed
  shared service stayed active with zero restarts (wrapper 631, node 1201).
  It was not redeployed; preserve it and existing Tailscale routes.
- Solo QA: **http://localhost:5173/?solo=1** or
  **https://ysgramor.tail6e864b.ts.net:5173/?solo=1**. Reload existing tabs for
  the new imported manifest. This is not an Artemis asset-runtime deployment.

Start subsequent work with `tools/session_start.sh`, `docs/lessons.md` and the
live tracker. Keep owned assets, credentials, `.local/` and saves out of Git.
