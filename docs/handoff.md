# Handoff — Byzantine checkpoint, 2026-10-02

## Active authorised run

The owner authorised the supervised worker to implement Byzantines#185, then
Persians#186, then achievable logical tracker work until **2026-10-02 17:00 UTC**,
with wrap-up from16:30 UTC. GREEN commits/pushes and privately verified household
deployment updates, including necessary restart/reset, are authorised. Native DE
launch/control and additional agents are not. The durable brief/progress/report
paths are `.local/autonomous-20261001-{brief,progress,report}.md`; actual worker
start was2026-10-01T21:30:37Z at da81bf3. Continue the run after this checkpoint.

## Current source checkpoint

- Byzantines adds Cataphract/elite and Camel Rider/elite definitions, complete
  available-tree roster coverage, independent MEDI buildings/HUD/flags/icons/voices,
  age HP/free sight/discount/reload/healing bonuses, Logistica and Greek Fire.
- Shared consumers now handle research-cost/time multiplication, the healing
  task's HP amount and resource89, fixed melee collateral, and building projectile
  replacement. The ledger and#267 retain native healing/blast/HP-rounding questions.
- A blocking seven-profile manifest failure became#268:551,770,741 bytes exceeded
  V8's string ceiling. Schema4 interns repeated frame arrays while keeping each
  atlas's pages/scale/count. Legacy inline metadata still loads; missing refs fail.
  Whole-manifest expansion reproduced SHA256
  `9380ea82b21c3108f24479a3e5e2531bdd24537137527d422c866d6875e28367` exactly;
  compact pending-profile metadata was52,882,276 bytes/2334 unique frame arrays.
  This changes neither PNGs nor decoder/packing functions.

## Verification

- Four owned-source contracts pass: `.local/byzantines-source-tests-r2.log`.
-52 focused Byzantine/Teuton/monastery/elevation outcomes pass on published
  schema4 metadata: `.local/byzantines-focused-r5.log`.
- Generic building suite:56pass/7existing Gothic skips
  (`.local/byzantines-buildings-r2.log`). Expectations now include Byzantine
  house/wall HP multipliers; damage/wounds/replay checks and clocks are retained.
- Both pending and **published enabled** private-browser acceptance pass:
  `.local/byzantines-browser-r5.log`, `.local/byzantines-published-acceptance.log`.
  Real menu/restart/reload, MEDI HUD/castle, unique icons/units/upgrades, discounted
  Camel Riders and Imperial payments, Logistica collateral, healing, house/tower
  placement, naval upgrades and both Greek Fire projectile identities/damage run.
- Registered `byzantines`, `atlas-metadata`, and owned/fallback `cargo` receipts
  pass; `node tools/acceptance.mjs check HEAD` accepts them. Logs:
  `.local/atlas268-acceptance.log`, `.local/byzantines-cargo-acceptance.log`.
  The atlas receipt includes general real-browser pixel/command smoke.
- Full enabled import passes (`.local/byzantines-enabled-import.log`), reusing
  all4850 atlas groups. Initial new MEDI art conversion reused4101 prior groups.
- Full checkpoint gate **GREEN**, exit0, **13m05s**:
  `.local/byzantines-gate.log` / `.exit`;1218 TypeScript tests/100 files,
  8existing skips, build,184 owned/Python tests and general real-browser smoke.
  No fixture clock or timeout was widened.

Earlier failures are retained: combined source/focused shell exceeded120seconds
after the source contracts and Teuton suite passed; no children remained. The
subsequent full focused run passed with retained handles. Browser fixture fixes
wait for HUD refresh, use integer-centred two-tile house placement, and stage the
tower target in range only after paid research, using actual source HP. Research
correctly recalculated the old custom10000HP building to900HP. Assertions were
preserved, including actual damage after the final target staging.

## Live household deployment

- Host:<http://localhost:5173/>; solo:<http://localhost:5173/?solo=1>.
- Tailnet:<https://ysgramor.tail6e864b.ts.net:5173/>.
- Artemis local-art gateway:<http://localhost:5174/>.
- Ysgramor still serves `.local/releases/review-followthrough-final`, fingerprint
  `a90b773162af5fb34ce0a50b883c7eb81369b7efbeb7c414febbfaef5b676361`.
  This pinned code/JSON predates the Byzantine and fish-fog/startup-diagnostics
  source changes. No new release has been switched in this checkpoint.
- The host was explicitly paused for each full bulk-asset publication and restored
  afterwards; latest restoration23:25 UTC, active/NRestarts0. No current
  `.local/shared-match.json` existed to archive. Socket inspection found two
  unchanged loopback ESTAB receive queues and a CLOSE-WAIT socket; those were
  accounted for by the authorised pause rather than assumed to be absent users.
  Existing service-wrapper SIGTERM exit143 marks an explicit stop as failed; it
  is not a restart loop. Tailscale routes remain unchanged.
- Last verified Artemis deployment is
  `.local/shared-gateway-review241/tools/shared-join.mjs`, using the preserved
  `.local/performance-runtime-bebb06e/public` base-art import. Its last inventory
  had117 base-Briton entities and no extra profiles. **#266 is required for current
  remote roster-art acceptance.** Protocol2 alignment alone does not prove that art.
- Private acceptance precedes future release switches. Archive useful match state
  if one appears. Code/JSON are release-pinned; bulk assets/dependencies are shared.
  No generic incompatible-checkpoint migration is claimed.

## Prior checkpoint and remaining scope

The October1 [post-mortem follow-through](reviews/2026-10-01.md) added acceptance
receipts, installed-harness safeguards, finite supervised job leases, durable
worktrees, layer-aware atlas caches, documentation checks and shared protocol repair.
Baseline da81bf3 also fixes fish art in fog and captures browser startup diagnostics;
its gate was GREEN,1193 TypeScript tests/8skips and177 Python tests. The intermittent
startup cause remains unproven; diagnostics are not a claimed root-cause fix.

Seven owned profiles are now enabled in current source. Scoped civilisation
completion does not establish native-DE parity. Native terrain/compositing,
conversion exceptions, audio/missing streams, zero-time research/population settings,
Japanese/Chinese/Byzantine calibration and wonder countdown remain tracked.
The restored#124 Dark-Age-start AI acceptance is explicitly failing/opt-in and is
separate from the Feudal-start component case. Follow the authorised brief's next
item, Persians#186, after the verified Byzantine checkpoint is pushed.
