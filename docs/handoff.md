# Handoff — audio-first autonomous run, 2026-09-27

## Assignment and play

User-authorized window: **09:46–20:46 BST**, audio #57 first, then logical
non-civilisation work, one fully gated and pushed checkpoint at a time.
Britons/Franks remain the only enabled profiles.

- Solo desktop: <http://localhost:5173/?solo=1>
- Tailnet solo QA: <https://ysgramor.tail6e864b.ts.net:5173/?solo=1>
- Fishing opening: <http://localhost:5173/?solo=1&map=islands&seed=3>
- Shared deployment remains blocked by **#241**: managed live host protocol1
  versus current frontend protocol2. Preserve its live state and routes until
  a state-preserving migration is verified.

## Delivered checkpoints

| Commit | Issue | Delivered and verified |
| --- | --- | --- |
| `be0e695` | #57 | Both shared audio packs, cross-bank resolution, complete streams rather than embedded prefixes, lazy reads and inventory tests. |
| `5810300` | #114 | Distinct order voices, frame-driven combat/work/death sounds, construction completion and visible-terrain ambience; browser playback/PCM checks. |
| `944a730` | #115 | Owned in-game playlist: 27 complete tracks, 6676.378775 seconds, one live music source; full natural cycle and wrap verified. |
| `380817c` | #239 | Producer selection retains ordinary cursor; explicit Set Gather Point/T arms flag/left-click placement, with cancellation and right-click shortcut checks. |
| `3283a6e` | #245 | Native zero-based command sequences: town bell cell15/B, building ungarrison cell10/G; actual key execution verified. |
| `7eab67b` | #141 | Persisted speed, music/sound volume, four owned hotkey profiles and interface colour-blind palettes; owned UI, reload/cancel, palette pixels and private shared-speed authority checks. |
| `6ffea73` | #247 | SLD validation before cached atlas publication. Selected sources569/569 pass; x1 counterparts567/569, with two damaged monk files. |
| `13a7bc5` | #91 | Fog-safe observation-v8 explored terrain/elevation and observation-only AI docks/fishing. Natural owned seeds2/3/7 and owned/fallback browser openings bank fish. |
| `8b1aad8` | #248 | Wwise Play-action layers, delay/ranges, probability and linear fades. Browser measures training horn/voice separation at500.8ms; delayed/fading sources remain cancellable within24-source budget. |

Each feature checkpoint passed the full gate before push. Last feature gate:
`.local/audio248-gate.log`, **997 Vitest tests /81 files**, build,
**149 Python/owned-content tests**, real-browser debug smoke, exit0.
Source boundaries and inferred integration choices are in
[audio-reference.md](audio-reference.md), [ai-fishing.md](ai-fishing.md),
[source-integrity.md](source-integrity.md) and [ledger.md](ledger.md).

## Endurance verification and final tooling

`tools/performance_soak.mts` now reports active/pending/fading/playing audio
sources and music playhead. Samples assert the24-source cap and that pending
and fading layers belong to active sources. Public F3 pauses before map setup;
draws end rounds, and failed transitions save state/UI diagnostics. No fixture
timeout was widened.

- **Successful rerun:** `.local/audio-run-soak-r2.log`, exit0,
  **19:26:00–20:05:00 BST** (39 minutes), **150 samples**, **19 completed
  tick-limit rounds**, 20 rounds started, all five maps: Black Forest, Senlac,
  Islands, Arabia and Windsor. Private WebGL2/SwiftShader browser, both seats
  driven through public commands, speed index5 (10x), 12000-tick round target,
  15-second sampling. No recorded page/render/missing-asset errors. Sampled
  maxima: active24, pending2, fading4, playing24. Minimum available Linux RAM
  **8,902,656,000 bytes**; maximum sampled JS heap **866,420,396 bytes**.
- **Earlier partial run:** `.local/audio-run-soak.log`, exit1 after54 samples
  and three completed Islands/Arabia/Windsor rounds. Next-map Submit timed out.
  The old harness captured no transition snapshot, so its cause is unproven.
  Pausing before setup removes a possible live-match/end-dialog race; the rerun
  verifies19 transitions, not a diagnosis of that earlier failure. This receipt
  is explicitly not a green whole soak.
- **Natural soundtrack cycle:** `.local/music115-soak-r2.log`, exit0, all27
  tracks and wrap over111 minutes. The shorter mixed-map soak does not replace
  that dedicated playlist verification.
- **Final tooling gate GREEN:** `.local/audio-final-gate.log`, exit0;
  **997 Vitest tests /81 files**, build, **149 Python/owned-content tests**,
  real-browser debug smoke. Only Markdown changed after gate start.

These bounded measurements do not establish native-GPU performance, unbounded
memory stability, native DE audio mix parity or all victory/draw paths.
The successful mixed-map rounds ended at tick limits.

## Remaining blockers and next work

1. **#241 — preserve shared match during protocol migration.** Passive audit
   found no default `.local/shared-match.json` and no established5173 sockets;
   joining itself can change seats/AI/pristine state. No verified read-only
   export/migration path exists yet. See [shared-reference-audit.md](shared-reference-audit.md).
2. **#119 — repair source bytes.** x1 monk idle/attack files become zero-filled
   at exactly1MiB. Restore patch-matched sources; never relax the decoder's exact
   walk. Selected x2 sources pass; no owned bytes were modified.
3. **#113 — water/terrain fidelity.** Existing reference calibration remains.
4. **#110 — wonder countdown.** Human approval is already recorded; settings
   now exist. Exact map-size defaults/query-clock conversion remain unverified
   after the task120/manual/strings/AI read. No guessed countdown was added.
5. **#243/#244 — remaining audio.** Container weights/continuous loops/bus DSP/
   spatial calibration remain; MUSIC17/27/30 lack complete owned streams.
   Optional813787 is absent. Embedded prefixes are excluded from the playlist.
6. **#246 — battlefield colour-blind palettes.** Interface palettes ship;
   sprite shader reflection does not establish the transform. SHDR exists but
   Aon9 does not; the256-entry LUT cannot simply replace the8-shade ramp.
   Windows blocked the inspection script by execution policy; no bypass tried.
7. **#59/#124 — broader AI.** A bounded eight-file Promisory policy audit is
   recorded; fishing is implemented, broader source reading/strategy remains.

Observation is **v8**. Shared wire remains **v2**, recordings/results **v2**,
dev snapshots **v3**; legacy compatibility boundaries are in the protocol docs.
Prior diplomacy/Regicide evidence is preserved in `docs/status.md` and their
feature commits; Regicide calibration remains #240, Siphons semantics #242.

## Operations

At the final20:25 BST check, all private soak/gate browser/server processes had exited.
Managed `open-empires-shared.service` remained active, MainPID631 / Node1201,
NRestarts0. Tailscale routes and the managed match were untouched. Final gate
used three Vitest workers and unchanged test clocks.
Owned content, converted assets, local logs and snapshots remain ignored.
