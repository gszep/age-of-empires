# Project status

Current scope, not a chronological run log. Operational state and the latest
verification receipt live in [handoff.md](handoff.md); inferred or chosen rules
live in [ledger.md](ledger.md). The issue tracker is the work queue. Historical
checkpoint counts remain in git and [reviews](reviews/2026-10-01.md).

## Play

- Ysgramor: <http://localhost:5173/>; independent solo: <http://localhost:5173/?solo=1>.
- Tailnet: <https://ysgramor.tail6e864b.ts.net:5173/>.
- Artemis local-art gateway: <http://localhost:5174/>.
- Public open-content build: <https://empires.gszep.com/>.
- Standalone development: `npm install`, then `npm run dev`. When the managed
  host occupies 5173, use `npm run dev -- --port 5175`.
- Solo `?map=islands&seed=3` (plus `solo=1` on the shared host) selects a board;
  F10 settings select map/seed/civilisations/mode without editing the URL.
  Shared setup is controlled by player one. Controls are in [README](../README.md).

On October 1 the owner confirmed no current match needed preservation. The
shared host/frontend were pinned together and the gateway's hardcoded protocol1
was corrected. Both deployed configs report protocol2. Code and JSON metadata
are frozen in the release; bulk art and installed dependencies are shared local
resources, not immutable assets. See [shared-play.md](shared-play.md).

## Delivered scope

| Area | Working scope | Evidence and limits |
| --- | --- | --- |
| Simulation | Fixed20Hz deterministic economy, construction/repair, production/refunds, gathering/hunting/farms, combat/projectiles/armour/elevation, garrisons/transports, research and fog memory | `src/sim/`; public-command outcome tests and deterministic replay; approximations in ledger |
| Civilisations | Britons, Franks, Goths, Teutons, Japanese, Chinese and Byzantines with roster/research/bonus/art integration | [coverage](civilization-coverage.md), [bonus contract](civilization-bonuses.md); wider catalogue is inventory only |
| Buildings/specialists | Additional TCs, fortifications, monasteries/relics, siege, conversion snapshots, nested cargo capacity and owner-preserving mobile-carrier conversion | [buildings](civ-buildings-integration.md), [specialists](civ-specialists-integration.md), [conversion](conversion-reference-checklist.md) |
| Naval | Briton dock roster, transports, trade cogs and fish traps; enabled profiles' regional ships | Owned DAT/task/art imports; naval/transport browser acceptance; no claim of every native exception |
| Modes/shared play | Solo and household two-seat play, reconnect/checkpoints, Regicide/Treason, locked diplomacy/tribute | [shared play](shared-play.md), [source audit](shared-reference-audit.md); public multiplayer and general migration are not delivered |
| Maps | Arabia, Black Forest, Islands, Windsor, Senlac and painted proof; RMS-inspired land/terrain/object phases, surveys, elevation, relic placement and corrected spacing | [generation design](map-generation-design.md); mirrored adapter and several native placement/slope semantics remain inferred |
| Rendering | Owned x1/x2 sprites and ordinary A/B attack graphics, masks/contours/shadows, fog memory, source-backed water/foam, native blend families, terrain plants and their shadows | [blend coverage](terrain-blend-coverage.md), [decode contract](block-decode-contract.md); native compositor and exact calibration remain open |
| UI | Native command cells/icons/cursors, garrison/training/production controls, notifications/confirmation/end screens, map menu and persistent options | [UI reference](ui-reference.md), [feedback review](reviews/2026-09-24-issue58.md); browser text rasterisation and some surfaces remain approximations |
| Audio | Voices, combat/construction/ambient playback, layered action timing and27-track soundtrack | [audio reference](audio-reference.md); missing streams and native mix/spatial behaviour remain tracked |
| AI | Observation-only economy/building/combat strategy, coastal fishing and public-command sheep return | [fishing](ai-fishing.md), herding outcomes; integrated early military progression/finishing power still incomplete |
| Agents/replays | Browser/Node share commands; versioned observations and records, subprocess/WebSocket/MCP agents, deterministic batch/replay tools | Provider-dependent tests opt-in; open fallback stops at Castle Age |

Briton/Frank scoped completion includes the previously pending fortification,
relic, Warwolf and unique-research work. Terrain plants and their owned shadows
are drawn. These statements supersede the stale early integration paragraphs
removed in the October1 post-mortem follow-through.

## Imports and fidelity boundaries

`npm run import:aoe2` is the only full publication entrypoint. It resolves pinned
owned depots, verifies source container integrity, imports DAT/RMS/UI/audio and
converts sprites/blends. Enhanced Graphics Pack art is sourced at scale2 and
drawn at half size; atlases above8192px continue on pages. Base x1 monk sources
were recovered and validated; see [source integrity](source-integrity.md).

Production uses PNG. Hardware block compression was evaluated, not deployed.
RGB565 endpoint promotion is corrected; permitted vendor interpolation is distinct
from that bug. [Compression evaluation](block-compression-evaluation.md) records
the measured allocation benefit and pixel-equivalence limits.

Sprites load on demand. Scene-required pages may exceed the512MiB soft residency
budget; it is not a hard total-memory cap. Eviction, warm grace and idle expiry
are chosen application policies. First-use/expired art can be temporarily absent.

Asset manifest schema4 interns repeated frame arrays while retaining every
hotspot/page/scale. Seven-profile metadata measured552→53MB; whole-manifest
expansion reproduced its original SHA256. Legacy inline metadata remains readable.
This removes a reproduced JavaScript string-limit failure (#268); it does not
change the PNG decoder or establish an FPS improvement.

Owned files do not settle every engine rule. Conversion exceptions, volley/charge
cadence, zero-time grants, population settings, RMS window/placement semantics and
audio mixing remain explicitly qualified in the ledger. Closed scoped civilisation
tickets are not a claim of complete native-DE equivalence.

The machine-check, memory-pressure and provider-stall incidents have distinct
evidence. Do not reuse one incident's diagnosis for every later failure.

## Verification

The checkpoint gate is exactly unit tests, build, owned import tests and general
real-browser smoke. `tools/gate.sh` records its current result and stage logs;
`tools/session_start.sh` reports the actual latest run, not a recalled count.

Feature-specific browser acceptance is additional. `node tools/acceptance.mjs plan
HEAD` lists mapped scenarios and unmapped changed paths; `run <scenario>
<scope-note>` records a pass/failure bound to code and imported JSON metadata.
`check HEAD` rejects stale/missing selected receipts. The registry is deliberately
explicit about known gaps and endurance tiers; it is not universal coverage.
Review its generated scope diff for changes to assertions, supplied state and
time limits. #124's Dark-Age-start acceptance remains opt-in and failing, separate
from the green Feudal-start component fixture.

Established historical measurements, with their original scope:

- Three12,000-tick simulation runs:50.087→34.025s with checked state equivalence.
- Ten-ship estimated RGBA residency:3.88GB→0.875GB, identical rendered pixels.
-156.67-minute browser soak: no invalid bindings; peak estimated sprite data
  3,329.88MiB; remaining Windsor10× spike. See [performance report](reviews/2026-09-23-performance.md).
-27-track natural music cycle and39-minute combined audio/browser soak; the latter
  completed19 tick-limit rounds. These are not physical-GPU FPS or AI victory claims.

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
are checked against the tracker by `node tools/check-current-docs.mjs`.
Not yet delivered: campaigns, public multiplayer, selectable formations,
unlocked diplomatic relations/cooperative victories, native final compositing,
all owned civilisations, complete RMS/elevation fidelity and several HUD surfaces.
The wonder's countdown is approved but unimplemented; settings are no longer its
blocker. The [DAT](dat-field-audit.md), [manual](manual-audit.md) and
[provenance](genie-rms-provenance.md) audits distinguish actual remaining gaps from
old requests that were already implemented.
