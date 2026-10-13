# Native sheep calibration (#308)

Updated **2026-10-13**, installed build **185872**, 2560×1440, Casual1.5.
**Overall BLOCKED: P1 instrument and boundary row passed; P2/precedence instrument
still fails.** No simulation changes, commit, import, checkpoint or deployment.
The durable worktree is `.local/worktrees/issue-308-scenarios`.

## Pipeline and source hypotheses

Owner-authored task → committed JSON spec → private AoE2ScenarioParser0.9.7
adapter → native editor load/Save As → full spec/readback comparison → fresh Test.
GPL-importing adapters and game assets remain ignored. B1's exact sub-tile
(15.25,12.75) readback and five positive/no negative labels remain passed;
see [`tools/scenarios/README.md`](../tools/scenarios/README.md).

Coordinator-supplied `.local/native308/b2-source.out` covers both DATs:

- Pinned: `ce3530df36cf0b333a9751cb0ff94460fe904f811feecec8ae9794701622b4cf`.
- Installed reference: `4aa2f0a719e88e5f1502517eddb27c669aeb40c2fe9d8c4f3eec7751c01e7baa`.
- Both: sheep594 LOS3/search radius4/speed≈0.7; villager83 LOS4/search radius4/speed≈0.8.

**H3:** sim `src/sim/game.ts:3477–3494` at `f56c30e` (`3495–3509` at `a56b8bf`) uses inclusive center distance ≤ herdRange;
`src/sim/data.ts:1852–1854` derives imported range from sheep LOS3 and labels
the rule inferred. **H4:** sheep search radius4 or claimant LOS4 is the threshold.
Those two interpretations of4 are not distinguishable with this claimant.
Sim arbitration refuses any claim contested by different players, even if one
is nearer; nearest/player-slot/reference-ID/spatial alternatives remain to test.

## Minimal instrument: S0/S1

`tools/scenarios/sheep-instrument.json`: one active human P1 Briton, None AI,
Dark Age, custom victory, no P2. S0: sheep(20.5,20.5), villager(22.5,20.5).
S1: isolated Gaia sheep(8.5,8.5). Setup Timer0/execute-on-load applies speed0 and
Freeze Object to explicit references. No ownership-changing effects or unit orders.

**Owner-agnostic guards:** each alarm ANDs inverted Objects-in-Area conditions for
Gaia and all eight player slots, using the specific unit constant and inclusive
3×3 tile rectangle around its initial tile. It fires only when *every* owner lacks
that unit type there. The empty-area control uses the same conjunction to prove
that this negative predicate can fire. Separate per-owner positive conditions
report ownership at1/10/30s. No DAT-class filter is used.

| Check | Observed |
| --- | --- |
| S0 sheep owner, 1/10/30s | P1/P1/P1 |
| S0 villager owner, 1/10/30s | P1/P1/P1 |
| S1 sheep owner, 1/10/30s | Gaia/Gaia/Gaia |
| Owner-agnostic missing guards | No alarms |
| Empty-area alarm positive control | `OK-EMPTY-GUARD` fired |
| Gaia-only diagnostic on captured S0 | `DIAG S0 NOT-GAIA` fired without movement |
| Attack warnings | None |

This demonstrates **H-guard's mechanism**: changing owner makes a Gaia-filtered
query false without displacement. It does not retroactively explain every older
alarm. Evidence: `.local/native308/s0-09-chat.png`, `s0-10-history-top.png`.

### Fixed-camera pixel measurement

No input/camera movement during the timed capture series. Earliest visible frame
is **game second1**, not the requested exact0; earlier retained frames are loading
screens. This first-second gap is explicit. Native clocks10 and30 were captured.
The sheep/villager blue ownership/cloth masks were compared by exhaustive integer
translations within ±8px in full-resolution crops:

| Unit | Initial blue bounds (x1,y1,x2,y2) | Best shift at10s | Best shift at30s | 30s IoU / next best |
| --- | --- | --- | --- | --- |
| Villager | 1418,651,1431,664 | 0,0 | 0,0 | .883929 / .729508 |
| Sheep | 1332,696,1340,705 | 0,0 | 0,0 | .891892 / .666667 |

Zero translation is the unique best match for both. **Exact mask identity fails
at30s** (pose/shading pixels change); this was retained, not reported as byte-equal
sprites. Evidence: `s0-fixed-{1500,7500,21000}.png`,
`s0-pixel-measurement.json`, `measure-s0.py` in `.local/native308/`.
The measurement establishes no visible displacement at the sampled times, not
subpixel engine coordinates or an unsampled continuous trajectory.

## P1-only boundary row

After S0/S1 passed, `tools/scenarios/sheep-boundary.json` used nine independent
sheep/villager pairs on a 20-tile grid and one sheep-alone control. Same one-player
instrument, no P2, specific-ID owner-agnostic guards. Native Save As preserved
all positions. All10s and30s owner readouts agree; **no guard/attack warnings**.

| Initial center distance | Owner at10s and30s |
| --- | --- |
| 1.00 positive | P1 |
| 2.75 | P1 |
| 3.00 | P1 |
| 3.25 | P1 |
| 3.50 | Gaia |
| 3.75 | Gaia |
| 4.00 | Gaia |
| 4.25 | Gaia |
| 6.00 negative | Gaia |
| No claimant | Gaia |

Observed initial-distance bracket **[3.25,3.5)** on this axis/setup. This disagrees
with both simple center-radius3 and center-radius4 hypotheses. It does **not**
identify a replacement radius, footprint/contact formula, diagonal boundary or
cadence. All-station sub-tile runtime positions were not independently read;
pixel validation was on the minimal pair, and guards detect departure from3×3
areas, not tiny shifts. Carry those limits into the bug investigation; do not
blindly change the sim constant to3.25. Captures: `boundary-14-chat.png` and
`boundary-{15,16,17,18}-history.png` under `.local/native308/`.
The measured discrepancy and these limits are filed as **[#329](https://github.com/gszep/age-of-empires/issues/329)**;
no runtime fix is included here.

## Neutral precedence: remaining failure, stopped

`tools/scenarios/sheep-precedence.json` specifies Neutral and Enemy variants.
Only **Neutral** was natively run this round. It adds isolated P1-only/P2-only
positive controls and sheep-alone S1. Both directions are Neutral in the native
Save As **and the paused game's Diplomacy panel** (`neutral-20-diplomacy.png`).

| Station | P1/P2 distances | Labels at10s/30s | Valid result? |
| --- | --- | --- | --- |
| E1: P1 left/lower ref | 2/2 | P1/P1 | No: P2 villager missing guard |
| N1: P1 nearer | 1/2 | P1/P1 | No: P2 villager missing guard |
| N2: P2 nearer | 2/1 | Missing | No |
| E2: sides reversed | 2/2 | Missing | No |
| E3: reference order reversed | 2/2 | Missing | No |
| E4: sides and reference order reversed | 2/2 | Missing | No |
| P1-only positive | 2/none | P1/P1 | Passed |
| **P2-only positive** | none/2 | **Missing; sheep and villager guards fired** | **Failed** |
| S1, sheep alone | none/none | Gaia/Gaia | Passed |

Owner-agnostic guards now fail specifically for P2 villagers and several sheep,
including isolated P2C. Attack warnings still appear despite confirmed Neutral.
This is **not explained solely by a Gaia-owner filter or Enemy diplomacy**.
Movement, task/identity change, disappearance/death and P2-specific condition
semantics remain to distinguish. A missing label is never counted as Gaia.
Full logs: `neutral-{14-chat,15-history,16-history,17-history,18-history}.png`.
Stop condition honoured: no further Enemy Test or precedence batch. Its generated
file is retained but has no native acceptance. No owner-priority hypothesis is
rejected from the invalid Neutral run. No Celts/resource97 result is claimed.

## Final P2 controller round: H-AI remains unresolved

The generated **and native-saved** older P2 records agree: active=true,
human=false, ai_type2 (None), personality `NoneAi`, and the minimal
`(defrule(true)=>(disable-self))` script (with a preceding constant declaration).
The actual stored human flag is `DataHeader.player_data_1[1].human=0`;
there is no extra Human-only field exposed by the inspected player manager.
Full inspection: `.local/native308/p2-player-inspection.txt`.

`sheep-p2-human.json` changes human=true and retains None AI. The native editor
maps this to **Player Type: Either**, not a forced human controller; the dropdown
has only **AI/Either** (`p2human-05-player2.png`, `p2human-06-type-options.png`).
Native Save As preserves human=true and the None AI payload. Test still loses
the P2 villager from its any-owner3×3 guard after1s. A paused P2 view shows a long
explored corridor away from the start (`p2human-17-p2-view.png`).

Source-backed custom-controller controls were then tested without changing units,
geometry, diplomacy or the guard. The installed and pinned `E3-p2.per` are
byte-identical, SHA-256
`6443a80d627c9f33388de40e74a9c07267cc1bc8b68924865cc640d7d5f29b46`.
Its villagers/military initialization rules set gathering/exploration controls
to zero. A final variant adds the zero minimum-civilian-explorers and zero
initial-exploration-required commands read from installed
`Promisory/general.per:226` and `Promisory/scoutcontrol.per:81`.
These are **probe interventions, not claims of complete AI disablement**.

| P2-only control | Sheep at1/10/30s | Villager / guard | Outcome |
| --- | --- | --- | --- |
| human=true / Either, None AI | P2/P2/P2 | P2 at1s, then missing guard; no10/30s label | Failed |
| Either, installed E3 passive rules | P2/P2/P2 | Same failure; explored corridor visible | Failed |
| Either, passive + explicit zero exploration controls | P2/P2/P2 | Same missing guard and missing10/30s label | Failed |
| S1 sheep-alone, all three runs | Gaia/Gaia/Gaia | No S1 missing alarm | Passed |

No attack warnings were needed to reject these minimal runs: the villager guard
alone fails. No new Neutral/Enemy precedence matrix was run. **The simple
human-flag fix is rejected as sufficient; H-AI as the underlying cause is not
conclusively accepted or rejected.** We have not demonstrated live human control
of P2 or independently acknowledged execution of these AI initialization rules.
Do not equate stored script text or a successful file open with an inactive AI.

### A newly checked failure channel

The first custom-script attempt raised native **ERR5001: File open failed**.
Its Save As already had `Files.ai_error_present=1`, although player script text
matched. That run is rejected, retained under `p2passive-*`. A named custom AI
needs user-profile `.per` and empty `.ai` files as well as scenario data.
After installing uniquely named files into the existing user-profile AI folder,
fresh native Save As clears the error. The private validator now explicitly
rejects nonzero native AI-error flags, in addition to checking script/name/type.
The corrected file-open check does **not** make the failed runtime guards pass.

| Probe / native file under `.local/scenarios/native-rt/` | Field checks | Native SHA-256 |
| --- | --- | --- |
| `OpenEmpires-308-sheep-p2-human-rt.aoe2scenario` | 3,753 | `becde1084a9f799d0e1089f00abae3e7da911d917d89520218618a899b64f512` |
| `OpenEmpires-308-sheep-p2-passive-ready.aoe2scenario` | 3,755 | `547f5b9131172bebcf7da9fd617d48a3fc45b08d1ebd0a2d0193e8cd55bd40f8` |
| `OpenEmpires-308-sheep-p2-noexplore-rt.aoe2scenario` | 3,755 | `0fc9cd1f1b479f0697e3e9e43aa1231a085284cb4783d81298a05389bd7cd84c` |

Final specs: `tools/scenarios/sheep-p2-human.json` SHA-256
`df19d7cd9832248d09ddd5777cfa08ea4614f443d1647516d88b5a12a5fab89e`,
`tools/scenarios/sheep-p2-passive.json` SHA-256
`a1b91bd21ee4bd70b0310ba77d30fde8261debe3a12f7015ca86d19fe9b9176d`.
The latter now describes NoExplore; the original passive spec/script is retained
in `.local/scenarios/p2-passive-rejected/` for its exact earlier reproduction.

Evidence: `.local/native308/{p2human-14-chat,p2human-16-history-middle,
p2ready-11-chat,p2ready-12-history,p2ready-14-p2-view,noexplore-14-chat,
noexplore-15-history}.png`. Source scripts and extraction adapters stay ignored;
no owned AI code is in the committed-spec directory.

## Earlier native readback checks and hashes

Each count below also has explicit reference-ID and custom-victory checks.

| Spec | Checks passed | Native Save As SHA-256 |
| --- | --- | --- |
| `sheep-instrument.json` | 2,850 | `1550c2d9af4522f43284ef983ce1cfad095428b7e836bcf46b157cb38c5dd76d` |
| `sheep-boundary.json` | 7,529 | `c1e18e2695ec5f115c7aa4906d29ebd13be384bb587ffe58bdfd8a797434665c` |
| `sheep-precedence.json` / NEUTRAL | 7,466 | `a094a31e9195376f1459936cf802c64d241701214b6b38766986755b6717de6b` |

Spec hashes, respectively:
`07555fc08efcfcf56cc8903c2151d1b9533aec2114bf318e4c72b516315dad7c`,
`3776d4fa75d773321dbc19b13eabdde005dce74de97eedf9b375d0acb1c700d6`,
`1b7d597e11d50fda8bd44816701351938b3db16ac9e877122759c11d28da593e`.
Generated-file SHA-256 (before native Save As):

| Fixture | SHA-256 |
| --- | --- |
| `sheep-instrument.aoe2scenario` | `a578d7d90dc3a5ad8b076fc439069e0678ab8dbb6c87ad701827d350fb60dc62` |
| `sheep-boundary.aoe2scenario` | `ade63791779540a56aae4932a604a3a7a289a5c2bd4dab53f209a9a52e3d8031` |
| `sheep-precedence-NEUTRAL.aoe2scenario` | `907e9d97a2bbce5a1ed7a60190e455bc697866f73c73b4fda8d388bc4b386cfb` |
| `sheep-precedence-ENEMY.aoe2scenario` (not run natively) | `ebe5c15e9407dd32123b7364c75edffcd651382e26ec228e58b5f903ce465395` |

Files/readback/comparison JSON live in `.local/scenarios/native-rt/`;
the private adapter is `.tools/scenario/instrument.py`. Invoke it with pinned
parser as documented in `tools/scenarios/README.md`, action `generate` or
`compare`, spec path, output path, and optional `NEUTRAL`/`ENEMY` argument.

The instrument specs are not fully self-describing; the private adapter adds:
- per unit, a `GUARD-<name>` trigger from `guard_start_game_seconds` that fires
  `BAD-MISSING <name>` only if the unit's 1-tile area holds no matching object
  for Gaia *and* every guarded player (owner-agnostic);
- per readout unit, sample time `t` and owner `p`, a trigger live only in the
  one-second window `[t, t+1)` that reports `<name>=P<p>@<t>`;
- a `DIAG-GAIA-FILTER` diagnostic at 2 s over the first unit with a Gaia filter
  (fires on conversion without displacement), and an empty-area positive control
  `OK-EMPTY-GUARD` at (35.5, 35.5) from 1 s.
A fresh clone cannot regenerate these scenarios without re-implementing these
rules; the durable worktree `.local/worktrees/issue-308-scenarios` retains the
adapters and receipts; copies are kept in the primary checkout's ignored `.tools/scenario/` (adapters) and `.local/evidence/issue-308/` (scenarios, readbacks, captures).

## Retained failures and bounded handoff

Earlier October12 B2 files remain rejected: quantity0 Modify Attribute did not
round-trip; original/r2 setup lacked native acknowledgement; r3 acknowledged but
emitted drift/attack warnings. They retain their original specs, adapters, hashes,
comparisons and captures in `.local/scenarios/b2-rejected-*` and
`.local/native308/b2-*`. Their green field checks were never used to hide native
failures. The first source-access denial and coordinator resolution remain in the
index history. Current evidence index: `.local/native308/index.json`.

Remaining gate: independently establish **live P2 controller assignment or AI-rule
execution**, rather than changing another stored flag and assuming its effect.
The minimal villager is initially counted and subsequently absent; controller
orders, unit/task identity and actual position need a joint readout before another
precedence matrix. Reference IDs are distinct from
player-grouped serialization order; neither has been calibrated as arbitration.

All created Windows scenarios are retained (this round: instrument + native rt,
boundary + native rt, precedence NEUTRAL + native rt, generated ENEMY only).
No persistent settings, graphics, Steam or credentials changed. Custom victory,
speed/freeze and Neutral diplomacy are private fixture settings only. This final
round also retains **four unique AI dependency files** in
`%USERPROFILE%\Games\Age of Empires 2 DE\76561198049987770\resources\_common\ai\`:
`OpenEmpires-308-Passive.{ai,per}` and `OpenEmpires-308-NoExplore.{ai,per}`.
No Steam-installation file or pre-existing user file was modified. These local
dependencies are required to reproduce the custom-AI scenarios, not distributed
project content. Closed chat/diplomacy, quit Test, then editor. Final `p2-final-06-main-menu.png`:
**game PID16560 running at main menu/build185872**, no controller process remains.
