# Project status

Current scope, not a chronological run log. Operational state and the latest
verification receipt live in [handoff.md](handoff.md); inferred or chosen rules
live in [ledger.md](ledger.md). The issue tracker is the work queue. Historical
checkpoint counts remain in git and [reviews](reviews/2026-10-01.md).

## Product direction

Human play and agent experimentation reinforce each other. The immediate target
is engaging shared play on Ysgramor and Artemis; the north star is historical
co-op campaigns generated from accounts and geography, then open-ended strategic
experimentation as the environment hardens. Current two-seat competitive play
does not yet deliver co-op teams or generated campaigns. [Priorities](product.md)
and [research decisions](research-directions.md) guide the next playable subset.

## Play

- Ysgramor: <http://localhost:5173/>; independent solo: <http://localhost:5173/?solo=1>.
- Tailnet: <https://ysgramor.tail6e864b.ts.net:5173/>.
- Artemis local-art gateway: <http://localhost:5174/>.
- Public open-content build: <https://empires.gszep.com/>.
- Standalone development: `npm install`, then `npm run dev`. When the managed
  host occupies 5173, use `npm run dev -- --port 5175`.
- Solo `?map=islands&seed=3` (plus `solo=1` on the shared host) selects a board;
  F10 settings select map/seed/civilisations/mode without editing the URL.
   Shared setup is controlled by player one. Controls are in [play](play.md).

On October 5 the Ysgramor host moved to release `c519be9` (protocol 4) after private two-player verification; Artemis was unreachable and keeps its October 2 art ([shared play](shared-play.md#installed-arrangement)). On October2 the authorised deployment switched both services to the verified
seven-profile setup, then added distinct Islands fish, gateway socket recovery
and43e10ad's explicit shared-startup recovery: a pinned Ysgramor host/frontend
and an isolated Artemis base-art runtime. Both configs were verified at protocol 2;
actual two-machine acceptance
and local guest-art delivery pass. Old assets/releases remain for rollback,
no current checkpoint needed archiving, and Tailscale routes are unchanged. Code
and JSON metadata are release-pinned; bulk art/dependencies remain shared local
resources. See [shared-play.md](shared-play.md).

## Delivered scope

| Area | Working scope | Evidence and limits |
| --- | --- | --- |
| Simulation | Fixed20Hz deterministic economy, construction/repair, production/refunds, gathering/hunting/farms, combat/projectiles/armour/elevation, garrisons/transports, research (queued per building, paid at queue time, #293) and fog memory; manual-derived player score (#139); per-step cost-effect rounding (#301) and floored discounted research (#302/#260); DAT-derived trebuchet packing (#259); packed idle trebuchets no longer auto-deploy (#131); Siphons charge kept vs buildings (#242); first-full/half-extra monk healing stacking (#267); Mangonel-family automatic friendly-blast avoidance; cached blocked-endpoint path queries (#175) | `src/sim/`; public-command outcome tests and deterministic replay; behaviour changes are recording-version gated (legacy recordings replay unchanged); targeting prediction/legacy-order boundaries in ledger |
| Civilisations | Britons, Franks, Goths, Teutons, Japanese, Chinese, Byzantines, Saracens, Turks, Vikings, Mongols and Celts with roster/research/bonus/art integration | [coverage](civilization-coverage.md), [bonus contract](civilization-bonuses.md); October 5–6 current-build (185872) calibrations: Turks #302, Vikings #301, Mongols #305 (Nomads persistent housing), Byzantines #267, Chinese #260, Saracen Bimaristan #285, conversion stats #178; Celts livestock#304 and Stronghold geometry#306 remain open, shared Trade Cart audio gaps#271; wider catalogue is inventory only |
| Buildings/specialists | Additional TCs, fortifications with authoritative automatic gate state, monasteries/relics (stored relics raise the building flag, #291), siege, ram foot-gunner crews (#302), conversion snapshots, nested cargo capacity and owner-preserving mobile-carrier conversion | [buildings](civ-buildings-integration.md), [specialists](civ-specialists-integration.md), [conversion](conversion-reference-checklist.md); gate trigger distance/timing remain inferred under#133 |
| Naval | Briton dock roster, transports, trade cogs and fish traps; enabled profiles' regional ships; distinct snapper/salmon/dorado and shore fish | Owned DAT/task/art imports; all four fish identities gather/deplete/bank in open and imported modes and retain original art in fog; no claim of every native exception |
| Modes/shared play | Solo and household two-seat play, reconnect/checkpoints, Regicide/Treason, locked diplomacy/tribute, configurable population ceilings and opt-in Wonder victory through menu/headless/replays | [shared play](shared-play.md), [Wonder evidence](wonder-victory.md); the Ysgramor host runs protocol 4 since October 5; a live Artemis join is unverified |
| Maps | Arabia, Black Forest, Islands, Windsor, Senlac and painted proof; RMS-inspired phases, surveys, elevation, relics and corrected spacing; global Islands fish reach both resource-islet coasts; new matches deal all eleven Arabia biomes (#118) and place Islands deep-water fish offshore per RMS zone clearance (#95) | [generation design](map-generation-design.md); home-land mirroring and native placement/slope semantics remain inferred; native Islands seasons/additional objects tracked in#274; Arabia snow dusting (#118), native fish counts/water mask (#95) and relic masks (#130) remain open; legacy seeds unchanged via map markers |
| Rendering | Owned x1/x2 sprites and ordinary A/B attack graphics, masks/contours/shadows, fog memory, source-backed water/foam, native blend families with shoreline tile-grid correction (#284), terrain plants and their shadows, Town Center DAT cast-shadow deltas and annex shadows (#288); multi-layer projectiles (#297), staged farm construction terrains (#296) and per-age annex player colour (#294) | [blend coverage and shoreline evidence](terrain-blend-coverage.md), [decode contract](block-decode-contract.md), October 5 smokes in [handoff](handoff.md); farm stage thresholds are inferred; native compositor and exact calibration remain open |
| UI | Native command cells/icons/cursors, garrison/training/production controls, notifications/confirmation/end screens, map menu and persistent options; units selectable over farms while right-click retains crop targeting (#289); research shown in the production slot and cancelled with a refund (#295), with queued research icons and indexed cancel (#293); score panel totals (#139); owned-mode technology tree from CivTechTrees (#138); top-bar labels from the owned distance-font atlas (#92); `Ctrl+Alt+R` solo resource cheat for testing | [UI reference](ui-reference.md), [feedback review](reviews/2026-09-24-issue 58.md), owned/fallback `tools/farm_selection_smoke.mts`, `tools/research_cancel_smoke.mts`; browser text rasterisation and some surfaces remain approximations |
| Audio | Voices, combat/construction/ambient playback, layered action timing and 27-track soundtrack | [audio reference](audio-reference.md); missing streams and native mix/spatial behaviour remain tracked |
| AI | Observation-only economy/building/combat strategy, coastal fishing, public-command sheep return and bounded late-game castle/trebuchet production and attacks | [fishing](ai-fishing.md), [siege](trebuchet-automation.md), herding outcomes; staged siege chain passes, AI stops housing at the effective population ceiling and answers announced enemy Wonder deadlines (#281) | natural-start progression/balance remains#124 (a queue/Market slice was measured and not merged) |
| Agents/replays | Browser/Node share commands; versioned observations (protocol 11: research queues, scores, own effective ceiling and announced Wonder timers) and records (format 9), subprocess/WebSocket/MCP agents, deterministic batch/replay tools | Provider-dependent tests opt-in; open fallback stops at Castle Age |

<!-- current-claims:start -->
- #179 (CLOSED): Briton scoped roster/research completion; native conversion exceptions remain separate.
- #180 (CLOSED): Frankish unique-tech/elite and Heresy acceptance completed.
- #55 (CLOSED): Terrain plants are drawn; density calibration and final compositing remain separate.
<!-- current-claims:end -->

Briton/Frank scoped completion includes fortifications, relics, Warwolf and unique
research. [Civilisation evidence](civilization-coverage.md#briton-completion-pass-2026-09-26)
and [terrain evidence](dat-field-audit.md) retain their source and fidelity limits.
Zero-time bonuses follow their explicit prerequisites without an extra producer
gate; a native paid Frankish farm without a Mill and a Briton control establish
the Feudal case ([calibration](free-research-calibration.md), #254). Current-build
Bimaristan rate/overlap/self/relic controls and speed/reset observations are in
[Bimaristan](bimaristan-calibration.md) and [speed](speed-calibration.md). The
October 5–6 run used the installed build 185872 as evidence by owner decision;
results are in [ram crew](ram-crew-calibration.md), [population](population-calibration.md),
[Turks](turks-calibration.md), [Vikings](vikings-calibration.md),
[Mongols](mongols-calibration.md), [Byzantines](byzantines-calibration.md),
[Chinese](chinese-calibration.md), [Samurai/Kataparuto](samurai-kataparuto-calibration.md),
[siege targeting](siege-targeting-calibration.md), [Siphons](siphons-calibration.md),
[conversion stats](conversion-stats-calibration.md), [Islands](islands-calibration.md),
[relics](relic-placement-calibration.md), [shadow overlap](shadow-overlap-calibration.md)
and partial [Caravanserai](caravanserai-calibration.md), [Stronghold](stronghold-calibration.md),
[Celtic livestock](celts-livestock-calibration.md), [Incendiaries](incendiaries-calibration.md),
[gates](gate-calibration.md), [fog animation](fog-animation-reference.md) and
[Arabia snow](arabia-snow-calibration.md) references. None closes pinned-runtime
acceptance (#279).

## Imports and fidelity boundaries

### HUD distance-font first surfaces (#92)

Owned resource values, population and age now use the reference's RGB distance
glyph atlas, losslessly subsetted by the UI importer. Accessible DOM text and
CSS fallback remain; other HUD text still uses the composite TTF face. The
private HUD browser probe covers nonblank pixels, unchanged-label caching,
DPR1/2 and fallback. A supplied build185872 capture now calibrates counter/age
weight and black outlines: all six matching labels meet the ledger's fixed
coverage/core/outline tolerances, including an estimated-native-background
outline control. White tint is widget-sourced; weight/edge/halo settings are
**fitted**, not native uniforms. Exact geometry, other scales and the modern
multi-page shader remain unverified; this is **not** native pixel parity or
completion of #92. See the
[ledger](ledger.md#92-first-owned-distance-font-surfaces-2026-10-06). Requires
coordinated full import before rollout; private output is not published.

The Persian audio publication blocker (#271) has a narrowly scoped, owner-approved
resolution: three absent Trade Cart events are explicitly `unavailable`, while
other missing events and broken audio still fail. The isolated eight-profile
audio fixture passes with4321 playable cues and exactly 3 gaps; the regular audio
browser acceptance passes. Persians itself is not enabled: its preserved profile
still needs integration, full regeneration, civilisation-specific browser checks
and the owned checkpoint. See [handoff](handoff.md) and
[audio evidence](audio-reference.md#reviewed-persian-trade-cart-source-gaps-271).

`npm run import:aoe2` is the only full publication entrypoint. It resolves pinned
owned depots, verifies source container integrity, imports DAT/RMS/UI/audio and
converts sprites/blends. Enhanced Graphics Pack art is sourced at scale 2 and
drawn at half size; atlases above 8192px continue on pages. Western x1 monk sources
were recovered and installed. A newly consumed Slavic x1 file still needs default
depot copy-back (#277); its existing original recovery copy validates. See
[source integrity](source-integrity.md).

Production uses PNG. Hardware block compression was evaluated, not deployed.
RGB565 endpoint promotion is corrected; permitted vendor interpolation is distinct
from that bug. [Compression evaluation](block-compression-evaluation.md) records
the measured allocation benefit and pixel-equivalence limits.

Sprites load on demand. Scene-required pages may exceed the 512MiB soft residency
budget; it is not a hard total-memory cap. Eviction, warm grace and idle expiry
are chosen application policies. Living units retain their last complete pose
while a cold body/colour/shadow/composite page loads, following position and
depth; first appearance waits for those layers together (#287). Other first-use
or expired art can still be temporarily absent. The private-browser regression
holds a first public move's pages:11/12 missing-body frames before,0/12 after.

Asset manifest schema4 interns repeated frame arrays while retaining every
hotspot/page/scale. Seven-profile metadata measured 552→53MB; whole-manifest
expansion reproduced its original SHA256. Legacy inline metadata remains readable.
This removes a reproduced JavaScript string-limit failure (#268); it does not
change the PNG decoder or establish an FPS improvement.

Layer-aware, namespace-independent atlas reuse has a full owned x1 verification:
24715cached/fresh publication files are byte-identical after a real BC1 correction;
the single controlled run saved 31.03% atlas elapsed time and 32.67% aggregate CPU.
See [cache verification](reviews/2026-10-02-atlas-cache.md) for inputs and limits.

Owned files do not settle every engine rule. Conversion exceptions, volley/charge
cadence, zero-time activation order, RMS window/placement semantics and
audio mixing remain explicitly qualified in the ledger. Closed scoped civilisation
tickets are not a claim of complete native-DE equivalence.

The machine-check, memory-pressure and provider-stall incidents have distinct
evidence. Do not reuse one incident's diagnosis for every later failure.

## Verification

Verification is exposed through npm: selected/full tests alongside public build,
then owned import tests and real-browser smoke for the complete checkpoint.
`npm run verify:owned` is the commit checkpoint; [testing](TESTING.md) records the policy;
`tools/session_start.sh` reports the actual latest run, not a recalled count.

The [orchestration workflow](orchestration.md) adds issue-backed Project helpers,
parallel durable worker worktrees, compression checkpoints and tracked-text
footprint measurements. Public GitHub Actions uses conservative PR selection
and full main/nightly checks, with a documentation-only PR fast path; it does not
replace the owned checkpoint. The linked `gszep` Project #1 has live helper
read/write/readback verification and the open backlog (#292). No automatic
distributed task claims or compression threshold service is claimed.

The harness targets OpenCode V2: Opus 5.5 coordinates bounded Haiku 4.5 workers,
with Astra escalation and independent review. Live role routing and resolved
permissions were verified on October 4, 2026. The installed-CLI safeguard smoke
passed eleven native-shell cases and completed-tool heartbeat recording; fixture
tests are supplementary, not a substitute for that execution evidence. Writable
children use an initialization/session-move handshake before implementation.

Feature-specific browser acceptance is additional. `node tools/acceptance.mjs plan
HEAD` lists mapped scenarios and unmapped changed paths; `run <scenario>
<scope-note>` records a pass/failure bound to code and imported JSON metadata.
`check HEAD` rejects stale/missing selected receipts. The registry is deliberately
explicit about known gaps and endurance tiers; it is not universal coverage.
Review its generated scope diff for changes to assertions, supplied state and
time limits. #124's Dark-Age-start acceptance remains opt-in and failing, separate
from the green Feudal-start component fixture.

Population setup (#253) is verified through real menu selection, solo reload and
restart, a headless record loaded through the browser file input, CLI/batch
replay and private host/guest checkpoint/rejoin. Paid production stays at100%
when the chosen ceiling is full despite spare houses, then releases after a loss;
Gothic Imperial+10 still requires housing. On the installed build 185872 the
reset-lobby default is 200 and Goths reach 210 only in Imperial with surplus
housing ([population calibration](population-calibration.md)); pinned-build
runtime remains unverified. [Population/Wonder evidence](wonder-victory.md) records
the checkpoint verification; latest checkpoint results come from session startup.

Established historical measurements, with their original scope:

- Three12,000-tick simulation runs:50.087→34.025s with checked state equivalence.
- Ten-ship estimated RGBA residency:3.88GB→0.875GB, identical rendered pixels.
-156.67-minute browser soak: no invalid bindings; peak estimated sprite data
  3,329.88MiB; the Windsor10× spike was later traced to repeated blocked-endpoint path searches and reduced (p95 131→42ms, #175). See [performance report](reviews/2026-09-23-performance.md).
-27-track natural music cycle and 39-minute combined audio/browser soak; the latter
  completed 19 tick-limit rounds. These are not physical-GPU FPS or AI victory claims.

## Projection invariant

AoE2 tile +x projects down-left and +y down-right; tile(0,0) is the diamond's top.
`worldToIso`/`isoToWorld`, minimap mapping/image transform, sprite facing,
blend-neighbour indices, tile-corner UVs, wall/gate axes, surveyed-map transpose
and water framing must agree. Player1 at x=W/4 is on the screen's right.
Verify a projection change against a mirrored previous layout to the tile;
sprites themselves must not be mirrored. Water shader-world x is the mirror of
tile x; the eye is along world(1,-1). DAT footprints and RMS remain in tile space.

## Remaining work

See the tracker, bugs first; [handoff](handoff.md) names operational blockers.
The scoped completion declarations in [current-claims.json](current-claims.json)
are checked against the tracker and the mirrored block above by
`node tools/check-current-docs.mjs`. Targeted #264 wording guards also read
status, handoff, backlog and overnight; reviews, ledger and other prose are
excluded. This bounded regression check does not certify arbitrary prose as fresh.
Not yet delivered: campaigns, public multiplayer, selectable formations,
unlocked diplomatic relations/cooperative victories, native final compositing,
all owned civilisations, complete RMS/elevation fidelity and several HUD surfaces.
The Wonder has an opt-in fixed 200-year completion countdown with owned banners,
public focus/notices and solo/shared/replay preservation; automatic map-size
defaults and matching-build calibration remain open ([evidence](wonder-victory.md)).
The [DAT](dat-field-audit.md), [manual](manual-audit.md) and
[provenance](genie-rms-provenance.md) audits distinguish actual remaining gaps from
old requests that were already implemented.
