# Project status

What is delivered, what is measured, and how it is verified. The current
session/deployment handoff is in [handoff.md](handoff.md). What is
approximated rather than read is in `docs/ledger.md`; what is still to do is
the issue tracker (`docs/backlog.md` says how it is used). The evidence for
each feature is in the commit that shipped it and on its issue — this file
does not repeat it.

## Run and play

On the installed Ysgramor service, use **http://localhost:5173/?solo=1**
for the human's current solo QA, or the same path through
**https://ysgramor.tail6e864b.ts.net:5173/**. Removing `solo=1` joins the shared
match. Artemis joins through its own **http://localhost:5174/** gateway.

Both managed household services were active with zero automatic restarts at
the 2026-09-23 performance handoff. Verification uses private servers rather
than altering the shared match; current deployment details are in `handoff.md`.

For a fresh standalone installation:

```bash
npm install
npm run dev
```

- Public open-content URL: <https://empires.gszep.com/>
- Local imported desktop URL: <http://localhost:5173/>
- Tailnet/mobile QA URL: `https://<host>.tail6e864b.ts.net:5173/` — the
  host is the machine running Vite (`calcifer` or `ysgramor`); both are in
  `vite.config.ts`'s `allowedHosts`.
- `?map=<name>&seed=<n>` deals a named solo board (`arabia`, `islands`,
  `black-forest`, `windsor`, `senlac`, `painted-proof`). Omitting setup uses the
  remembered choice, or Arabia/42 on a first visit. F4 reveals the map;
  `+`/`-` step the game speed.

Controls and hotkeys are in `README.md`. `F10 → Load replay…` plays a
headless record and checks its periodic hashes.

`F10 → Game Settings` chooses the map and seed without editing a URL (#144).
Start Game rebuilds the board and minimap; Random requests a fresh seed;
Restart repeats the chosen setup. Solo sessions remember their setup across
reloads, while shared selection belongs to the host and is sent to the guest.

## Delivered scope

**Simulation** (`src/sim`, authoritative, fixed 20 Hz tick, deterministic):
integer resources with gathering, drop-off and depletion; building placement,
construction, repair (#74), garrison (#75), destruction with each age's
collapse and rubble (#61) and fire (#73); population and housing; fifteen-deep
refundable training queues (#7), indexed cancellation (#140), and Shift-for-five (#76); rally points; tile
A* with footprint obstruction, repathing and separation; the DAT's armour
classes, minimum damage, discrete windup/release/cooldown, `accuracy_dispersion`
misses (#45) and blast levels (#46); projectiles aimed once at launch;
corpses that decay by food eaten and are selectable while worth something
(#14); the DAT's hunter, shepherd and farmer villagers (#71), startled deer,
herdable sheep; the Britons' technologies from `CivTechTrees` with
the DAT's effect commands (types 0, 1, 3, 4, 5), prerequisites and ages, the
Feudal, Castle and Imperial Ages and every land upgrade line to the champion;
the trebuchet packed and unpacked (#28); scorpions and the Heavy Scorpion
upgrade with pass-through bolts and DAT-backed collateral damage (#127);
monks that heal and convert;
palisade walls and owner-only gates; the wonder (no victory, #110); the
trade cart; the dock, naval roster and fish on the DAT's `terrain_restrictions`
(#81); fog with explored memory and legal last-seen observations.

Shore fish honour the DAT's neighbouring-beach placement requirement (#145).
The current Britons dock roster is implemented (#97): galley/galleon, fire,
demolition and hulk lines; Cannon Galleon gated by Chemistry; Transport Ship
and Trade Cog. The shared Medium/Heavy Warships researches include the DAT's
automatic child upgrades. Transports carry twenty land units, preserve loads
and population, unload at shore through the public command/UI, and lose cargo
when sunk. Fishing ships build and exclusively work 700-food Fish Traps.
Owned hull/sail composites, colour/shadow/outline masks and trap underwater art
are imported; fire shots use the owned flame flipbook with an inferred binding.
`src/sim/naval-units.test.ts` checks training, combat, research, cargo, trade and
trap income under both rule modes; `tools/naval_units_smoke.mts` checks dock
buttons/upgrades, real boarding/unload targeting, trap placement and visible
fire shots. Observation v4 retains the naval kinds/unload order and adds own
gather-target IDs plus edible carcasses (zero HP, remaining food).
Fishing ships carry on to deep fish using footprint-aware clearance and remember
their working position when a fish disappears during a dock trip (#87).
`src/sim/fishing-continuation.test.ts` covers full/partial loads, another ship
depleting the node, JSON reload determinism, visibility/range bounds and Stop;
`tools/fishing_continuation_smoke.mts` exercises the round trip from a real click.
Farms reserve one farmer through travel and drop-off; group orders, construction
completion, queued orders and automatic continuation respect occupancy (#82).
Villagers use each DAT task variant's gathering rate and carry capacity (#132),
including hunter 0.41/s into 35 and farmer 0.53/s into 10, with variant-specific
research effects. `src/sim/villager-gather.test.ts` checks actual collection and
banking across all eight tasks, both rule modes, task switches, vanished carcasses
and JSON replay; `tools/villager_gather_smoke.mts` checks hunter/farmer banked loads
from real browser right-clicks. Whole-resource capacity rounding remains inferred.
Resource-camp builders automatically gather nearby visible trees, gold/stone,
or (mills) berries/free farms, respecting queued orders (#79); regression tests
in `src/sim/build-gather.test.ts` cover selection, exclusions and actual banking.
`tools/build_gather_smoke.mts` checks real right-click construction-to-gathering
with imported content for all three camps. The AI retains active builders and
tries its other existing placement lists when house/range locations fill up;
the passive-opponent regression keeps its original 2400-second bound.
The AI also resumes paid, unstaffed house foundations without spending wood
again (#146), gives separate houses distinct workers, and keeps building orders
out of its demolition force. Own `buildTargetId` in observation v2 distinguishes
an approaching builder from abandonment; a rounded 100% foundation is still
unfinished. `src/sim/ai-house-recovery.test.ts` covers recovery, assignment
privacy and JSON replay; `tools/ai_house_recovery_smoke.mts` verifies the page's
AI replaces a deleted builder and completes the same house with zero wood.
AI drop-site planning rejects redundant nearby mills across the entire placement
cycle, searches onward for distinct unserved patches, excludes fish from mill
targets, and respects unfinished camps even when their progress rounds to 100%
(#147). Useful closer lumber/mining camps remain eligible. Ten regressions in
`src/sim/ai-camps.test.ts` cover these cases; `tools/ai_camps_smoke.mts` verifies
the page AI completes a mill at the separate berry patch with wood still available.
Upgrades replace active and waiting training entries as well as living units.
Paid training queues can exceed available housing (#143); completed units wait
at 100% without advancing the queue until their population cost fits. The HUD
shows the owned housing message. `src/sim/population-training.test.ts` covers
payments, refunds, housing completion, simultaneous producers and JSON replay;
`tools/population_queue_smoke.mts` checks real Shift-click queueing, the blocked
status, portrait cancellation and resumption after a house is built.

**Board** (`src/sim/mapgen.ts`): the original's two primitives from the owned
RMS scripts — cost-ordered clump growth and banded candidate scans — with
`cleanTerrain`; Arabia with four of its eleven biomes and its forest ponds;
Black Forest; Islands with the engine's beach sweep and the water-masking
depth chain; leaf litter and the script's aesthetic scatter; painted boards
and two surveyed boards (Windsor, Senlac) from Environment Agency LIDAR with
visual elevation; mirror-symmetric halves; the match seed mixed before any
draw (#44).

**View** (`src/view`, never mutates state): dimetric projection with AoE2's
handedness (below); DAT terrain textures with blendomatic edge blending
(#42) and DE's overlay masks across land crossings (#116; the water's edge
is still blendomatic's, #148); fog as a rounded per-tile contour with
`colorcorrection.json`'s levels; the reference's water shader read whole from its SM2 build (the
height field, its drifts, the dome, the glint) over the tile in linear light;
shore foam from the reference's own frame atlases, one to a shore tile (#89);
SLD sprites decoded locally (main, shadow, player-colour, outline and damage
layers) with the keyframe delta rule (#78); player colour through the
palette's own block; occlusion contours; task animations on the
simulation's clock (#72); the HUD laid out from the widget files — command
grid with the DAT's `button_id` cells and action icons, selection panel with
stat row, group portraits and counted training-queue batches with a separate
active-production portrait/status (#140), resource panel with gatherer counts and age
bar, menu panel, minimap with four buttons and a flare, score panel — in the
reference's face and colours (#69), names and tooltips from the strings file
(#48), portraits in the owner's colour (#77), context refusals in the
reference's words (#70); unit voices and the feedback cues from the owned
audio.

Minimap buildings use compact, equal-sized live and fog-memory markers (#84),
with farms hidden according to the DAT's `minimap_mode`.
Minimap relief (#96) now consumes each terrain's imported
three-shade palette. Live/remembered woods use the Forest palette, with flat
sRGB (21,118,21), instead of the old sampled (41,140,33). Plateaus, old manifests
and the open fallback stay usable; palette changes refresh the cache. Nine
focused tests, the sRGB browser pixel probe `tools/minimap_relief_smoke.mts`,
the existing minimap-marker browser check and typecheck pass. The pixel probe
also checks fog/reveal, state immutability and a 392×392 buffer (roughly 9–16 ms
draw samples). The human's editor reference supplied on 2026-09-22 corrected the
provisional axis: screen-right-facing hill slopes are light and left-facing
slopes dark. A four-sided-hill regression and actual canvas pixels pin both
front faces and both back faces. The precise discrete slope classifier remains
inferred, as recorded in the ledger; this is not a pixel-identical recreation of
the editor's unknown height grid. The current green working-tree gate includes these edits.

**Agents and protocol**: versioned JSON contracts; browser, built-in AI,
JSONL subprocess, deadline subprocess, WebSocket and MCP strategies share
`applyCommand`; FNV-1a periodic checksums, command-stream records, Node
verification and browser playback; process-isolated paired batches with
Wilson intervals; an opt-in live-model boundary (`RUN_LIVE_AGENT=1`).

**Household shared play**: one Node-hosted match, two human seats, late-join
snapshots and tick-ordered command replication with periodic checksum checks;
reconnect and disk checkpoints; player-specific cameras, selection, HUD and
fog; transport-stable checksums, bounded buffered playback, interpolated
presentation and same-map recovery without scene rebuilding (#153).
Artemis's local gateway serves its own assets while fetching code and
match traffic from Ysgramor. See `docs/shared-play.md` for setup and evidence.
Its isolated base-asset runtime was refreshed on 2026-09-23 (#171): the live
gateway now serves 117 entities, no redundant source/frame/layer atlas URLs,
and garrison flags for 13 entities. Full base-content gate and fleet/garrison
pixel probes passed; the optional Enhanced Graphics Pack test was skipped.

Host HTTP modules now negotiate gzip/Brotli (#154); control routes and already
compressed images are excluded, and the gateway preserves encoding headers.
The 2,552,483-byte Three.js dependency transfers as 474,805 gzip / 445,736
Brotli bytes, decoded byte-identically. On 2026-09-22 Artemis's direct private
host probe completed Brotli in 14.0 s and gzip in 26.7 s; the uncompressed
request timed out at 120 s after 2,209,922 bytes. These sequential network
samples are variable-throughput observations, not a controlled speed ratio.
`tools/compression_smoke.mts` verifies real cold/warm navigation and conditional
304s; `tools/shared_smoke.mts` verifies commands, joins, reload and recovery
through the local gateway with compression enabled.

Shared-match snapshots also negotiate WebSocket DEFLATE (#174), with independent
compression streams and ordinary server tick/control messages explicitly plain.
The actual imported Windsor snapshot was 3,162,658 wire bytes without the
extension and 95,679 with it; decoded 3,162,648-byte JSON and SHA-256 matched.
Sequential private-host transfers to Artemis measured 4.504 s and 1.501 s on
that run. These are network observations, not fixed speedup guarantees. Clients
declining compression still work; a real-host fixture checks a large uncompressed
50-command tick as well as snapshot identity and negotiation.

**Import** (`tools/`): patch-matched DAT rules, palettes, terrain, blend
masks, overlay masks, water and foam atlases, widgets, fonts, strings,
particles, hotkeys and audio through a byte-identical local pipeline
(`tools/import_aoe2.sh`, openage-free); the open fallback stays playable
without any of it. With the Enhanced Graphics Pack downloaded (depot
1039811, #150/#151) every sprite is sourced from its `_x2` file at scale 2
and drawn at half size, where its drawn pixels land within one x1 pixel of
the base art's; sheets over 8192 px continue on pages. The base depots
alone still import at x1. Sprite pages load on first use rather than all
at start -- loading the whole pack up front took the machine down (WSL,
15 GB) -- so a sprite may be absent
until its page finishes loading. Unused pages now release both GPU
textures and decoded images after two minutes, or after one minute under a
512 MiB soft-budget pressure (#152). Current scene art (including frozen fog
views) remains resident even above that budget; this is not a total-memory
cap or camera-frustum streaming. `tools/sprite_residency_smoke.mts` verifies
repeated walk/idle/evict/reload cycles, reduced GPU texture counts, unchanged
paused pixels and simulation hashes. Every DE capture in the reference corpus was taken with
the pack installed, so texture detail now compares like for like.

Identical source-SHA/frame-count/layer atlases share one canonical URL (#162),
with per-use frame layout and scale intact. The import now references 1,930
sprite/particle pages instead of 2,767 (5.71 GB PNG versus 6.92 GB). Existing
legacy files are retained; this is a fresh-output/reference reduction, not a
claim that migration deleted 1.21 GB from disk. The full PNG/layout audit and
a repeated import were byte-identical after normalizing only URLs. In the
ten-ship idle/attack browser A/B, decoded sprite residency fell from
3,881,869,760 to 874,990,464 bytes and GPU texture count from 128 to 65, with
identical rendered sRGB PNGs and simulation hashes. `atlas_sharing_smoke.mts`
recreates legacy URLs privately, so it also works with a fresh shared import.

Retired entity/preview views dispose their own geometries and materials (#164),
including ownership replacement, fog/view retirement, replay and presentation
rebuilds. Shared atlas/palette textures survive. The real build-house/cancel
and same-seed restart probe formerly grew GPU geometries by 3 per preview and
19 per restart; it now stays at 38 in imported mode and 15 in open fallback.
Repeated reveal/retire cycles also plateau. Recreated-world pixels and paused
simulation hashes match; farm-patch replacement also releases its old material.

Fog snapshots finish binding late sprite pages without changing their frozen
pose or reading newer entity state (#88). In particular, a tree that leaves
sight before its shadow sheet arrives no longer keeps a permanently missing
shadow. That initial fix did not address the human's visible-canopy report.
Ground fog now draws below whole sprites; remembered sprites are dimmed in RGB
rather than cut through by the ground contour. Decorative scenery separately
checks its anchor tile, so this does not reveal unknown objects. Shadows use
the imported Default profile strength instead of an extra 0.55 multiplier.
The screenshot-driven browser check measures opaque canopy pixels across F4,
remembered-canopy brightness, and visible-ground shadow coverage against the
owned mask. Final biome-specific grading/compositing is still #149.
The human accepted this corrected presentation on 2026-09-20 (“ok, this is
good”). The acceptance evidence is recorded on #88 and in
`tools/tree_fog_smoke.mts`; `docs/handoff.md` records current operational state.

**Not drawn** (#149): DE's frame is composited offscreen through
`CombineTerrainSpriteSMP` with bloom, the biome's colour grade, vignette and
sprite supersampling, then an antialias and unsharp pass; ours draws
straight to the canvas. Nor the ground's scatter and layer (#55).

## Deliberately omitted

Other civilisations (#122) and their bonuses (#123); selectable formations;
campaigns; public multiplayer;
diplomacy; relics (#130); stone walls; a genetic-algorithm framework;
separate mobile gameplay. Skipped technologies are recorded individually, each
with its reason in the manifest's `skippedTechnologies` (#128). The open
fallback stops at the Castle Age (#125).

## Measurements

### Garrison follow-on (#137)

The town bell recalls workers into its selected town center and restores their
previous orders/routes on release; its icons, cell, labels and start/stop audio
come from owned UI/sound metadata. Production self-rally holds newly trained
units up to capacity. Rams carry six infantry/villager passengers and can unload
or release them on destruction. Garrison flags use recursively resolved DAT
graphics, per-age positions and player-colour masks, including remembered
occupancy without exposing passenger counts. Observation v5 adds the bell command,
own bell state and public flag presence.

The villager's negative firepower now contributes flat DPS according to the
community attribute documentation; actual volley tests cover researched building
damage and the town center's absent primary arrow. Exact engine classifications
and bell routing assumptions are recorded in the ledger. Crew speed/attack
bonuses are the explicit follow-on #161.

Dedicated browser check `tools/garrison_edges_smoke.mts` passes real bell toggles,
work return, self-rally/training/unload, ram right-click boarding/unload, and
rendered blue flag pixels (TC 54, barracks 55, ram 105 in that fixture).
The final browser check also verifies `1/6 garrisoned` on a loaded ram and both
owned bell audio requests. The full gate is **GREEN**,
`.local/issue137-gate-r3.log`: **658** Vitest tests, production build, **85**
Python/import tests and general browser smoke. The idle-host retry passed with
the same single-worker settings and unchanged test limits after the earlier
host-contention timeouts. The implementation and its documented approximations
are included in the #96/#137 checkpoint.

### Performance verification

The 2026-09-23 run replaced repeated fog-memory scans with an invocation-local
live index (#165), reused bounded A* scratch storage without changing its f/h/tile
order (#166), reused each gatherer's target lookup (#167), and fast-pathed resource
kind checks (#168). Three imported 12,000-tick matches (seeds 3/7/19) retained
identical raw-JSON state hashes every 1,000 ticks while stepping fell
**50.087 → 34.025 s (32%)**. A full Windsor match retained its terminal state at
tick 34,231. The 392×392 short-search microbenchmark fell 542 → 24 ms for 2,000
queries; this is not a 20× whole-game/FPS claim. Same-tick fog changes, alternating
board sizes, failed searches, cache-copy isolation, economy regressions and real
movement/gathering browser actions cover the changes.

Sustained verification found and fixed two additional lifetime problems. A
60-second warm grace avoids worker-trip churn (#170): seven-minute evictions
586 → 44, at an estimated sprite footprint of 1,051 → 1,459 MiB. Sprite builder
keys now follow texture UUID/lifetime (#172), preventing Three r180 from cloning
a cleared sampler after A→B→expire A→new B. Basic/ramp pixels remain identical;
missing, pending and empty contours cannot revive retired bindings.

The final **156.67-minute** private browser run (#169) completed with **156
samples, no page/asset errors and no invalid bindings**, across all four maps
and 1.5×/2×/10× speeds. Six victories, one tick limit and one wall limit ended
eight workloads; the ninth was partial at cutoff. Estimated sprite footprint
peaked 3,329.88 MiB and ended 2,065.58 MiB; host available memory stayed above
9.14 GiB. Three samples had pending body pages, so zero first-use pop-in is not
claimed. Windsor seed 10 at 10× retained step spikes (worst sampled p95 189.1 ms),
tracked in **#175**. Earlier failures and interrupted segments are not counted as
passes. These SwiftShader measurements do not establish physical-GPU FPS.

The generated [run report](reviews/2026-09-23-performance.md) contains the exact
workload table, byte/timing comparisons, deployment and verification limits.
`tools/performance_soak.mts` records timing/residency data and failure snapshots;
`tools/probes/sim_performance.mts` records and compares deterministic traces.

The maintained open-ground pathing probe now discovers/asserts a clear
20-tile corridor (#5) instead of using a seed-200 destination occupied by a
tree. It reaches the goal in 485 ticks at a 0.97 travel ratio. The ten-minute
match probe records zero stuck ticks in 51,641 moving ticks; the other fixture
results retain their reported wall counts rather than claiming a redesigned
formation or generator.

### Earlier checkpoint measurements

All on the 120x120 generated board unless stated; older figures are not
comparable because the board changed under them.

- **Paired batch, 2026-08-29** (16 seeds, 2400 s clock): 14 decided, 2
  timeout draws, **0 replay checksum failures**, 32/32 Feudal, 4 Castle.
  The trade-off curve across seven configurations is on #124; the
  smith/no-smith A/B is 7-7 (null).
- **Per-tick cost** (seed 102, 900 s, warm, 1308 live entities): median
  0.95 ms, p90 1.09 ms, p99 1.49 ms, worst 6.07 ms against the 50 ms budget.
  A fifty-unit order lands in 8.85 ms warm (`docs/pathing-review.md`).
- **Browser** (headless Chrome, SwiftShader, 1280x800): ~25 ticks/s at the
  default speed, 17.5 at Slow (ratio 1.45 of the 1.50 asked); the absolute
  rate is software rendering, the ratio is the claim.
- **Import**: every consumed DAT graphic, rule and widget resolves; the
  local SLD decoder is byte-identical to openage's on all 29,783 frames it
  replaced; every modelled unit's stats match the DAT (487 values, 0
  mismatches, #36).
- **Tests**: 658 vitest, 85 Python/import tests, and the
  browser smoke (`tools/debug_smoke.mjs`: a private server, real clicks and
  keys). Fidelity assertions skip without the owned content; the gate says
  how many skipped.

The latest gate's actual log/status is recorded in `.local/gate.latest.json`
and shared by session-start and morning-report through `tools/report-data.mjs`
(#159). Tracker windows compare timestamp instants, paginate all updated issues,
and include issues opened and closed within the same run. Timeout-related added
diff lines are review candidates, not a claim that fixture clocks were widened.
The four issue-specific naval browser
scenarios also passed in `.local/issue97-naval-final-d1659.log`: dock buttons
and upgrades, boarding and shore unloading, fish-trap construction/income,
and visible fire shots.
Earlier dedicated browser checks cover single-farmer group orders, live/fog-memory
minimap marker pixels, counted queues (imported and fallback), scorpions, and
delayed tree-shadow texture arrival, complete visible/remembered canopies and
visible shadow coverage against the owned mask and Default strength.

Group arrival (#83) no longer degenerates into an axis-aligned line: stationary
collision normals break positional ties in two dimensions. Ten- and 25-unit
public-command regressions check compactness, personal space and settlement;
`tools/group_movement_smoke.mts` verifies a real 25-unit right-click in imported
mode (2.186×2.083 tiles, radius 1.160). This is collision separation, not the
reference's selectable formation system; its numerical tie-break is in the ledger.

Shared-host incompatible checkpoint startup (#157/#158) now exits with
non-retryable status 78 and preserves the saved bytes. The installed service
also bounds transient retries, and session-start reports its failed/running
state and restart count (#155). CLI regressions cover version/rules mismatch,
malformed JSON, retryable port conflicts and compatible checkpoint restoration.
Ysgramor's incompatible checkpoint was preserved byte-for-byte while its service
entered `failed/78` without increasing the restart count. At 21:37 BST the human
authorized ending matches unused by both machines for one hour. After over three
hours down, that checkpoint was archived and the host restored; localhost and
the existing Tailscale shared endpoints respond, with zero restarts.
The private two-browser shared smoke passed adoption, training, synchronization,
reconnection and checkpoint restoration; a transient systemd probe recovered
on its second attempt under the same restart policy.

Herd food (#85): the AI shares one animal target and can see edible carcasses;
automatic shepherd continuation finishes carcasses and follows an already chosen
next animal. Sheep/deer spoil at the live DAT unit's 0.25 food/s, boar at 0.4,
even when nobody gathers. The full cached import published those rates.
`tools/herd_food_smoke.mts` verifies one AI sheep killed, a separately unattended
carcass losing five food over twenty game seconds, real carcass selection, and
the HUD showing 95 food. Regression tests cover automatic continuation without
AI correction, hidden foreign carcasses, own-only target IDs and JSON replay.
The older collection-rate fixtures explicitly disable spoilage to isolate
collection/capacity; the new suite also accounts for both food sinks together.

AI Feudal construction (#86) now reserves wood against discretionary economic
expansion and archer purchases. Fresh imported seeds 1/7 complete blacksmiths
at 1300.2/1614.85 game seconds; before the change neither had a blacksmith by
match end/the 1800-second probe cap. Seed 42 completes a range at 1570.2 seconds
and wins at 1813.05 before building its smith. The private browser fixture
starts the AI with only 125 wood and verifies a completed, rendered, selectable
blacksmith by tick 2672. Four regressions cover saving, construction completion,
urgent housing and releasing the reserve; broader later-age strategy remains #124.

Corpse resight (#120) uses the simulation's existing corpse countdown to recover
death age, including from old JSON saves. A recreated view resumes the correct
death frame or corpse stage; a paused match cannot advance that clock. Tests
cover resight, reload and mid-death frames. The imported browser check moves a
scout out of and back into sight, verifies the old view was removed, and reads
`villager-female/decay` both before and after resight without replaying the death.

## The reference's default zoom is 0.8 of ours

DE at its default zoom draws the 2x assets at 0.80 -- a 77-pixel tile
against our 96 at zoom 1 (`islands-coast-2026-09-19.png`: a 143-texel
mangrove stands 115 px, the water's repeat vector is (404, 202) px). A match
here now opens at zoom 0.8, so a composite at each game's default compares
like with like.

## The projection has AoE2's handedness

`worldToIso` sends +x down-**left** and +y down-**right**; tile (0, 0) is
the diamond's top corner. Everything that turns a tile direction into a
screen direction leans on it: `worldToIso`/`isoToWorld`, the minimap's
`toCanvas`/`fromCanvas` and image transform, `directionIndex` (facing into
sprite frame), the blend-mask neighbour table and tile-corner uv assignment,
the wall run frames and the gate's art key, the water's world frame, and
the two surveyed boards (transposed on import). Player 1's town, at
x = W/4, is on the screen's right. A change to any of it is verified by
mirroring an earlier screenshot and laying the new one beside it: layout
lands on the mirror to the tile, sprites are not mirrored.

## Verification

```bash
tools/gate.sh              # npm test, npm run build, npm run test:import, npm run debug:smoke
npm run batch -- --matches 16 --concurrency 16 --seed-start 100 --max-time 2400 --out .local/batches/gate
npm run test:live-agent    # opt-in
```

The batch's `summary.json` carries `decided`, `timeouts`, `replayFailures`
and `throughput`; a change that moves any of them is worth explaining.

Two things the gate does not measure, run by hand after anything touching the
map, the pathfinder or the frame loop: the **worst tick** over a full match
(`tools/probes/pathing.ts` is the shape), and **a real page** driven through
a player's own input path — `page.mouse.click`, `page.keyboard.press` — read
back through `/__debug`, on a private Vite server (`AGENTS.md`;
`tools/probes/README.md` names the probes that do this).
