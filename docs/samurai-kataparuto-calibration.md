# Samurai and Kataparuto native calibration (#259)

2026-10-06 — **Packing continuation PASS; Samurai remains BLOCKED.** Measured on
current build **185872, not pinned 48987**, with the owner's explicit approval.
All screenshot readings below were **observed visually**, not extracted from
native simulation state. Packing is corrected below; this is not full #259 parity.

## Provenance and setup

- Live Windows PID **22012**, executable
  `D:\SteamLibrary\steamapps\common\AoE2DE\AoE2DE_s.exe`.
  Main-menu version reads `101.103.54800.0 (#185872) 25464371`.
- Fullscreen captures are 2560×1440. Graphics/settings were not changed;
  inherited UHD-unchecked configuration was not independently reopened.
- Blank editor Test scenarios only, Imperial Japanese Player 1; Teutons control.
  F11 shows **Casual – 1.5 / Standard**. No 1.25× run was made.
  Commands were queued while F3-paused, then resumed for bounded frame traces.
- No previous worker patch or failing test log existed in this clean worktree.
  The exact prior attempt in the issue comment was blocked by native-file access
  before measurements. Inherited macro recipes were read before driving DE.
- Local evidence root (not committed):
  `/home/fraser/repos/age-of-empires/.local/worktrees/issue-259-samurai/.local/native/`.
  Full PNGs and controller JSON receipts remain there. `sample-action.ps1`
  records full frames and actual capture intervals; requested 200 ms spacing
  was usually exceeded by PNG capture cost (~400 ms). Frame index is **not**
  game time. Use each frame's F11 clock. No native asset is committed.

### Installed versus pinned DAT

Both DATs were parsed before gameplay; full selected-field output is
`dat-comparison.txt`. Pinned root was resolved through `tools/depot.py`.

| DAT | SHA-256 |
| --- | --- |
| Pinned depot 813781 `resources/_common/dat/empires2_x2_p1.dat` | `ce3530df36cf0b333a9751cb0ff94460fe904f811feecec8ae9794701622b4cf` |
| Installed `D:\SteamLibrary\steamapps\common\AoE2DE\resources\_common\dat\empires2_x2_p1.dat` | `4aa2f0a719e88e5f1502517eddb27c669aeb40c2fe9d8c4f3eec7751c01e7baa` |

The files differ, but the inspected Japanese fields agree:
Samurai291/560 speed1, work rate1, ability3, max charge1,
recharge `0.03333330154418945`, event0, type1, target0, projectile−1.
Task133 is 2/6 (elite2/7), range1.25, flag2001, all graphic IDs−1.
Trebuchets42/331 have work rate4.5. Effect59 is identical: unit42 work×4,
reload×.75, plus reload×.75 on1942/1923. This was a selected-field comparison,
not a claim that the builds or complete DATs are equivalent. The continuation
found a **task125 difference**, detailed below; task133 agreement does not imply
task125 agreement.

## Kataparuto: repeated commands and paid research

Fixture: Villager1280,700; normal Samurai1100,800; Elite1100,1000;
deployed Trebuchet1450,800; Castle1900,450 (editor placement pixels).
P1 food/wood/gold5000. In Test, select trebuchet1460,790.
Pack button118,1250; **Unpack button50,1250**. The unit panel said
Trebuchet, not Elite Trebuchet; no separate Elite Trebuchet was tested.

Kataparuto was hover-identified at Castle176,1315, purchased, and allowed to
finish. `sam-kata-paid`, `sam-kata-complete`, `sam-kata-ready` and
`jp-k-pack1-before` preserve the sequence. Wood5000→4450 and gold5000→4700;
food remained5000. No forced research trigger or cheat was used.

| Accepted trace prefixes | Observed outcome |
| --- | --- |
| `jp-b-pack1`, `jp-b-unpack1`, `jp-b-pack2`, `jp-b-unpack2` | Two complete Japanese cycles before Kataparuto; roughly11–12 game seconds per transition |
| `jp-k-pack1`, `jp-k-unpack1`, `jp-k-pack2`, `jp-k-unpack2` | Two complete cycles after paid Kataparuto; roughly3 game seconds per transition |
| `teuton-pack1`, `teuton-unpack1` | Fresh Teuton Test, one complete control cycle; roughly11–12 game seconds per transition |

Specific readable anchors, avoiding sub-second precision claims:

- `jp-b-pack1-before`: paused00:12; `jp-b-pack1-16`:00:22,
  **Packing90%**; `jp-b-pack1-19`:00:24, packed.
- `teuton-pack1-before`:00:12; frame18:00:23 still packing;
  frame19:00:24 packed.
- `jp-k-pack1-before`:02:24; frame4:02:26 still packing;
  frame5:02:27 packed.

These rejected the previous **4.5-second base / 1.125-second Kataparuto** interpretation.
They support a large speedup consistent with the DAT×4, not exact tick rounding.
The DAT work-rate field is not itself a duration. A candidate `50/workRate`
would fit these coarse observations, but **50 was not established as the native
work requirement** in that first pass. The continuation below resolves its
current-build source and corrects the runtime; these earlier traces are retained.

Rejected preliminary attempts: `jp-base-unpack1`, `jp-base-pack2`,
`jp-base-unpack2` clicked118,1250 on a packed unit (the wrong button).
They are not successful cycles. The later `jp-b-*` runs use the verified buttons.

## Packing-only continuation: source and tighter cycles

The owner's refreshed assignment authorized only the packing correction.
`packing-dat.txt` dumps both units' complete fields, tasks and referenced
graphics from both builds. `packing-source-check.txt` records the focused
comparison and non-publishing extractor assertions:

| Input | Pinned DAT | Installed185872 DAT |
| --- | --- | --- |
| 331 task125 target/work1/work2/gather | −1/0/0/0 (all60 civ records) | 42/50/1/1 (all63 civ records) |
| 42/331 `bird.work_rate` | 4.5 | 4.5 |
| 331/42 `building.transform_unit` | 42/331 | 42/331 |
| Construction graphic137 | 3 frames, duration0 | 3 frames, duration0 |
| Kataparuto59/effect59 on42 | type5, attribute13, amount4 | same |

**Cause:** `src/sim/data.ts` treated `work_rate=4.5` as seconds. It is a rate.
The **installed** task125 explicitly supplies50 work, yielding
`50 / 4.5 = 11.111…` game seconds for both transitions; Kataparuto multiplies
the deployed rate to18, yielding `50 / 18 = 2.777…`. The untimed three-frame
construction graphic cannot supply a frame-count×duration clock. Train time
also happens to be50, but is not used: regression fixtures deliberately vary it.

**Version correction:** an intermediate claim that both DATs stated work50 was
wrong. The first extractor test failed on the pinned target−1 task. That failure
led to the explicit two-build comparison above, not a weakened assertion or
substitution of installed assets for pinned ones. The pinned legacy task does
not establish its engine's default work; using50 with pinned content is now an
explicit **current-build-calibrated compatibility default**, not pinned parity.

### Timing method and cycle table

Fresh one-player Japanese Imperial fixture: Villager1280,700;
Trebuchet1450,800; Castle1900,450. No enemies, no combat, no early victory.
Three complete pack/unpack cycles on the same normal Trebuchet, then paid
Kataparuto and three more cycles on that engine. `pack2-kata-tooltip/paid/complete/ready`
show research and wood5000→4450, gold5000→4700. No forced technology effect.

`packing-sample.ps1` queues the appropriate button while paused, resumes with
F3, and samples the F11 clock and selected-unit panel at100 ms requested spacing.
Each PNG contains unscaled clock `(1120,0,800,45)` and panel
`(0,1210,1180,210)` crops. Each JSON records monotonic before/after capture
timestamps. The last nonempty progress bar and first absent bar were detected
by red pixels, then **visually checked**, including the resulting unit name and
command buttons. This is UI observation, not a native engine-state probe.

F11 reads **Casual1.5** throughout. Clock changes over the~10-second normal
captures are consistent with1.5 game seconds per wall second; no requested
frame interval was substituted for an actual timestamp. The timed column below
is **F3-call→visible-transition elapsed wall time ×1.5**, from the last-progress
capture start through the first-complete capture end. These windows include
input/render latency, not exact native timer bounds. Sampling/capture windows
are~0.22–0.27 game seconds wide; conservatively report engine durations only as
**about11.1±0.3 and2.8±0.3 game seconds**, not native50 ms tick precision.
F11's integer clock alone has up to a second of endpoint quantization.

All prefixes below are relative to `.local/native/`, suffixed with frame number
and `.png`; full receipts use the same prefix and `.json`.

| Prefix | F11 before→first complete | Last progress→first complete frames | Timed window (game s) |
| --- | --- | --- | --- |
| `p2-normal-pack1` | 00:13→00:24 | 73→74 | 10.95–11.21 |
| `p2-normal-unpack1` | 00:28→00:39 | 74→75 | 11.11–11.35 |
| `p2-normal-pack2` | 00:43→00:54 | 73→74 | 10.97–11.20 |
| `p2-normal-unpack2` | 00:58→01:09 | 74→75 | 11.11–11.35 |
| `p2-normal-pack3` | 01:13→01:24 | 73→74 | 10.97–11.21 |
| `p2-normal-unpack3` | 01:28→01:39 | 74→75 | 11.10–11.35 |
| `p2-kata-pack1` | 02:59→03:02 | 17→18 | 2.57–2.79 |
| `p2-kata-unpack1` | 03:06→03:09 | 18→19 | 2.71–2.95 |
| `p2-kata-pack2` | 03:13→03:16 | 17→18 | 2.55–2.81 |
| `p2-kata-unpack2` | 03:20→03:23 | 18→19 | 2.71–2.97 |
| `p2-kata-pack3` | 03:27→03:29 | 17→18 | 2.57–2.82 |
| `p2-kata-unpack3` | 03:34→03:36 | 18→19 | 2.72–2.96 |

`packing-results.json` records timer calculations; `packing-results-{0,1,2}.png`
are review sheets. Normal pack/unpack both agree with50/4.5 at this precision;
Kataparuto both agree with50/18. The roughly one-sample difference between pack
and unpack is not treated as a measured direction-specific engine offset.

Runtime `TICKS_PER_SECOND=20` counts **simulation/game seconds**, independent of
wall-clock playback speed. Therefore the corrected transitions use
`round(20×50/4.5)=222` ticks (**11.10 game s**) and
`round(20×50/18)=56` ticks (**2.80 game s**), not durations divided again by1.5.
Existing nearest-tick quantization remains; native engine rounding and
in-progress research handling are not resolved by these samples.

## Samurai: meter, buildings and unit combat

Two-player continuation: P1 Japanese Imperial, P2 Teutons Dark, personality
None visually confirmed in `sam-p2-none`. Added enemy House1750,1000 and
Battering Ram1800,750. The original trebuchet auto-attacked: that first setup
was rejected; it was removed before the accepted `sam-building-approach` trace.
The Castle remained, so enemy HP loss is **not** isolated Samurai damage.

- **A white charge bar is visible**, separate from blue HP, below the selected
  portrait and above the selected unit. Both Samurai and Elite show it.
  `sam-building-ready-crop` preserves the normal unit's full bar.
- **Building attack did not visibly consume it in this trace.**
  `sam-building-approach-before` through `-after` shows approach and attacks;
  the bar remains full. `sam-building-hp` reads House496/550 at00:26,
  while `sam-charge-tooltip` preserves the Samurai's full bar at the same clock.
  The hover produced no explanatory charge tooltip. This does not prove every
  building/attack phase behaves identically.
- **Unit combat visibly depleted the bar.** `sam-ram-approach-*` follows the
  same Samurai retargeted to the ram: the full bar becomes nearly empty and
  displayed attack changes **10+3→10+2**. This contradicts a universal
  non-depleting interpretation of event0. It does not establish exactly which
  strike or damage component consumed charge.
- **Elite also depleted it.** In the fresh `elite-ram-approach-*` run,
  `sam-stop-hover` shows Elite Samurai80/80, attack12+2 and a low charge bar at
 00:30. This is an editor-placed Elite, not a measured paid upgrade transition.
- **Recharge was only partially observed.** After No Attack Stance and Stop
  (both tooltip-verified), a move-away order starts `elite-recharge-*`.
  The bar grows between00:30 and00:45. A victory screen then interrupts the
  trace; no empty-to-full time is accepted. The earlier normal-unit wait also
  ended in victory. Do not turn the DAT's ~30-second reciprocal into a native
  recharge measurement.

Successive full frames are retained, but placement pixels, sprite animation and
obstacles do not establish exact world distances. No accepted measurement of
2/6/7 boundaries, the speed multiplier, burst duration or centre-versus-contact
distance was obtained. A spare enemy villager did not rescue the recharge
fixture: it died. Personality None did not remove native reactions. A diplomacy
click sequence was attempted but not verified in its resulting pane; no allied,
stationary-target premise is accepted. After repeated early-victory failures,
the run stopped rather than labelling another uncontrolled trace calibration.

## Runtime comparison and bounded handoff

`src/sim/data.ts` now divides packed `packingWork` by deployed `workRate`;
`src/sim/rules.ts` retains inverse scaling for research. The open fallback and
legacy manifests use the documented50-work current-native default. The extractor
publishes explicit current-build work but omits the absent legacy value, and
rejects unreviewed task shapes. `convert_sld.py` already copies entire entity
dictionaries, so no publication allow-list edit is needed; publication assertions
cover the field in root and civilisation entities. No import was run or manifest
published. The existing pinned manifest can use the corrected default immediately.

Public-command tests cover three cycles before/after **paid** Kataparuto,
completion at222/56 ticks, old manifests, independently varied work/rate, and a
train-time decoy. Existing shot cadence, manual orders, automatic deployment,
JSON continuation and AI siege acceptance are retained. No fixture tick budgets
or timeouts were increased. The only runtime behavior changed is packing time.

### Review correction: recordings, saved transitions and shared admission

The reviewer correctly found that recordings stored only `rulesOrigin`, then
reconstructed current rules. Applying the new mapping to an old recording
changed its timers and checksums. **Recording format6** now identifies calibrated
packing; new matches carry `packingVersion:1`, and even old launch-config
versions produce current recordings. Replaying v1–v5 removes that marker and
uses `useLegacyPacking` to reconstruct the pre-change rule mapping (open4.5s;
imported deployed work rate treated as seconds), including every civilisation
profile. The existing research modifier then preserves **90/23 ticks**. The
adapter clones modified rule branches and does not mutate the supplied rules.

Frozen `src/headless/fixtures/pre-packing-v5.json` was generated and independently
replayed by the untouched61a2d73 engine; its provenance and SHA-256 are in the
fixture directory's README. It failed at tick100 against the first packing
patch and now matches all nine original checksums and six90/23-tick transitions.
A separate v6 public-command recording completes at222/56 ticks. Existing
pre-score, pre-research-queue and pre-Mongols checksum coverage is retained;
synthetic legacy fixture setup now explicitly selects the packing policy too.

The saved-transition test no longer advances only20+200 ticks (short of222).
It advances both original and JSON-restored states by the actual remaining
timer, asserts deployed pose and absent timer in both, then compares hashes.
Additional snapshot checks preserve both legacy90-tick and current222-tick
embedded rules across JSON, including subsequent commands.

**Shared deployment warning:** no shared admission/checkpoint version bump or
admission exception was added. Snapshots already carry their rules and timers;
they do not run the recording adapter. However, a persisted shared checkpoint's
pre-change rules hash differs from the new rules: startup correctly refuses it
with **EX_CONFIG78**, preserving its bytes. The pre-biome terrain-only exception
does not authorize this packing change. Tests retain the actual frozen pre-biome
hash as a rejection against current rules and positive terrain-only coverage
against matching packing rules. The coordinator must arrange matching rules or
an explicit saved-match decision before any later rollout; **do not deploy this
work over an existing checkpoint blindly**. No deployment/service restart or
native-game interaction occurred during review fixes.

Requested synchronization: `git fetch origin; git merge --autostash origin/main`
reported **Already up to date**. HEAD/local main/fetched origin main were all
`61a2d738b61bec82efdd01e08f990f3347dd1df9`; the tree already contained recording-v5
biomes/shared-v8 changes. No conflict or main-checkout edit occurred. The original
uncommitted diff and files were backed up under `.local/native/pre-review*`.

`src/sim/game.ts` latches `attackApproachTarget` by centre distance and multiplies
movement speed during pursuit. That path has no Samurai-specific depletion or
recharge state. Existing Japanese tests establish this implementation, not the
observed charge-bar behavior. Do not relax/remove those tests to hide the gap.

**No Samurai runtime change was made.** Its charge consumption/damage contract
remains unresolved, not acceptable merely because existing tests pass.
Next Samurai fixture should remove
the Castle and unrelated attackers, explicitly preserve an isolated enemy away
from combat, verify diplomacy/stances, and capture through a complete recharge.
Establish tile positions and compare move versus attack on the same path before
fitting trigger distances or speed. The packing-only continuation does not close
those Samurai gaps.

Still unverified: exact transition/tick rounding; research during packing;
full recharge; exact consumption event and charge damage; movement thresholds,
pursuit/cancellation; paid Elite upgrade; conversion; native save/reload;
pinned-build engine equivalence. #259 remains open.

### Outcome checks and final state

- Initial pass's targeted checks (then-unchanged implementation):
  `CIV_PROFILE_CONTENT=/home/fraser/repos/age-of-empires/public/imported/aoe2/manifest.json npx vitest run src/sim/japanese.test.ts src/sim/trebuchet.test.ts --maxWorkers=1`
  **exit0; 34 passed, 1 skipped;16.87s**. Japanese24 passed using the existing
  shared manifest read-only. Trebuchet owned-only case skipped because that suite
  uses its hard-coded worktree manifest path; its10 open tests passed.
- Continuation red check: seven packing regressions failed against the old
  runtime (`packing-red.log`, exit1). First extractor check also failed on the
  pinned/current task difference (`packing-extractor-test.log`); initial tsc
  exposed a fixture tuple annotation (`packing-tsc.log`). All were corrected;
  logs remain intact.
- Packing continuation's pre-review Vitest: Japanese, trebuchet, AI siege, siege safety and
  specialists, `--maxWorkers=1`, both `CIV_PROFILE_CONTENT` and
  `SPECIALIST_CONTENT` set to the existing shared manifest above:
  **142 passed, zero skipped, five files,49.90s, exit0**
  (`packing-final-vitest.log`). Includes owned and open AI/siege cases.
- Narrow read-only Python extractor unittest
  `test_packing_work_is_task125_not_training_or_graphic_time`: **pass,13.595s**
  (`packing-final-extractor.log`);
  pinned source absence, current-shape work independent of training, and unknown
  shape rejection covered. Installed DAT extractor assertion also passed in
  `packing-source-check.txt`. No full import/publication was performed.
- `npx tsc --noEmit -p .`: **exit0**, empty `packing-handoff-tsc.log`.
- Final review verification: **263 passed, zero skipped,18 files,188.86s**,
  exit0 (`review-final-vitest.log`). Same owned-manifest environment and one
  worker as above; adds headless packing/biome/full runner tests, research queue,
  score, Regicide and every `src/shared` suite. Final
  `npx tsc --noEmit -p .`: **exit0** (`review-final-tsc.log`);
  `git diff --check`: clean. Frozen recording SHA-256 unchanged.
- Review failures retained: `review-replay-red.log` (old recording fails at100);
  `review-compat-first.log` (three synthetic legacy setups lacked the new policy
  selection); `review-targeted.log` (historical packing hashes correctly rejected
  plus worktree-relative `tsx` lookup failures). Test helper now resolves installed
  `tsx/cli` rather than assuming a local node_modules copy. Admission guards and
  existing frozen checksum values were not relaxed.
- No owned checkpoint, import pipeline, deployment, service restart, push or
  commit. Source/test/doc changes remain uncommitted. Native game was untouched
  during review fixes. Full asset publication
  acceptance is deferred to the coordinator's import/checkpoint slot.
- `pack2-final-main-menu.png/json`: final main menu, PID22012, same version and
 2560×1440 rectangle. No scenario explicitly saved. No capture/controller
  process remains; no background job was launched. The earlier
  `sam-final-main-menu` capture is retained as the initial pass's endpoint.
