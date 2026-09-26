# Handoff — shared relic placement

## Completed task

The continuing shared-limit assignment is **source-backed relic placement**, with
exclusive serial main-tree authority and explicit commit/push authorization.
No agents were spawned. Briton playable/random-map acceptance remains recorded
in closed issue **#179**; do not resume the all-civilisation run. Britons and
Franks remain the only enabled owned profiles.

## Relic placement follow-up

- Numeric RMS reference data is in `src/sim/refdata/relic-placement.json`.
  `tools/relic_reference.py` deterministically extracts the narrow tiny/two-player/
  standard-mode branches; an owned import test compares every field. Both content
  modes consume this checked-in contract; no manifest key or asset import changed.
- Arabia: one central + two/player. Replaced the arbitrary central x-strip with
  an explicit neutral actor-area approximation and source distances/flags. Starts
  now use the source 32–34% radius; old 60-tile separation made the central 32-tile
  box exclusion infeasible inside the source neutral area.
- Black Forest: two/player at 24-tile distance/spacing. Fixed 44% clearing area
  (3168/player at 120×120), rather than relaxing relic distances.
- Islands: two/player with 18–26 box distance and 8 spacing, plus the fifth on
  land 20. Tiny has **two**, not four, resource islets: lands 20/23, zones 56/57,
  1% each, gold 2×3 and stone 2. Named land IDs survive generation and JSON saves.
- Windsor/Senlac/painted-proof: explicitly authored five-accessible-relic policy.
- Fifty seeds per RMS map pass placement/path/zone/forest/edge constraints and
  islet connectivity/avoidance. Six maps pass deterministic creation/JSON
  continuation. The full Islands journey checks JSON replay parity throughout.
- `npx tsx tools/relic_placement_smoke.mts` passed with published owned assets:
  generated Islands seed 130, staged monk/monastery/transport, untouched geography
  and relics, two real right-click pickups, home deposit, outward transport,
  fifth-relic return/deposit and 60 gold/minute, ending tick 5500.
- Exact native actor rasterization, start variance 6 jitter, RNG and land-phase
  order are not claimed. The mirrored generator reserves islets before homes;
  omitted islet base_size 3 remains inferred. Cliffs are absent (#134), not
  inferred from elevation. All details are in `docs/ledger.md`; #130 retains
  reference-calibration boundaries, #95 retains salmon/neritic fish.
- Gate regression evidence: the changed map exposed a fixed Town Watch tile,
  a synthetic beach-only rule applied before generating its arena, and a splash
  fixture at an exact floating-point boundary. Fixtures now test their intended
  preconditions. No simulation mechanics outside placement changed. The AI's
  seed-1 Dark-Age-to-range pacing gap is recorded on #124: Feudal by tick 4800,
  280 wood at tick 7200, but camp/house construction still preempts the range.
  Its unlock test now starts in Feudal; age research is tested separately.
  No test clock was widened.

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

**Relic-placement gate GREEN:** `.local/relic-placement-gate-r3.log`, exit 0:
**929 Vitest tests / 72 files**, production build, **125 owned-import tests**,
real-browser debug smoke. One worker; no widened test clocks. The private
relic journey passed separately with owned art. The second gate attempt was
stopped before an additional zero-seed normalization regression check; the
third gate covers that final tree. No source edits followed its start.

**Previous Briton gate GREEN:** `.local/britons-final-gate-r1.log`: **906 Vitest tests /
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

- **Relics:** map placement and collection/transport are covered above; native
  generator calibration remains #130. No relic/wonder victory was added;
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
