# REA resume plan (issue #349) — corrected second draft

This replaces the first draft, which overstated coverage and prototype
readiness. It is a factual inventory of the read-only audit tree
`…/age-of-empires/.local/worktrees/rea-audit-20261014/.local/rea-audit/`
("the audit") plus an upstream-first continuation plan. Private prototype
notes live in `…/issue-349-rea-coverage/.local/rea-349/` (git-ignored).
This document carries addresses, counts and conclusions only; no
disassembly or pseudocode.

## 1. Provenance

| Identity | Value | Evidence |
| --- | --- | --- |
| Depot `AoE2DE_s.exe` | build 101.103.48987.0, sha256 `6378ca6f…a321a4`, 71,648,568 bytes | `pdata-function-diff.json`, `ghidra/analyze-depot.json` |
| Installed `AoE2DE_s.exe` | build 101.103.54800.0, sha256 `124744bf…458ff`, 72,166,200 bytes | same |
| `.pdata` table size | 166,730 entries (depot) / 169,274 (installed) — RUNTIME_FUNCTION entries/ranges, **not** a proven census of semantic functions | same |
| Build table diff | 5,533 entries byte-changed at common RVAs; 163,739/161,195 entry addresses added/removed. These are table-entry address differences, **not** added/removed functionality. RVA sample lists in the JSON are capped (500/500/2000). | same |
| Tools | Ghidra 12.1.4 PUBLIC (`audit/tool/…/support/analyzeHeadless`), Java 21.0.12.1 via `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64` (PATH default is Java 17), REA 6.4.0 CLI receipts | audit logs, `rea-package.json` |
| Reusable reference scripts | `audit/ghidra/direct-scripts/*.java`, `fast-targeted-run.sh`, `supervised-full-run.sh` | read 2026-10-31 |

## 2. Validated inventory

- **Raw disassembly (complete)**: `disasm/manifest.txt` records `objdump -d`
  for all 22 depot PEs plus both installed images, `exit=0`
  (`AoE2DE_s.exe.asm` 973,727,959 bytes; installed 981,311,901). Raw
  disassembly is not decompiled or semantic coverage.
- **Discovery corpora**: `disasm/big-xrefs.json` (6,689 code-referenced
  strings with function attribution over 18,464,144 asm lines),
  `big-xrefs-installed.json`, `mechanics-targets.json` (159 entries),
  `string-xrefs.json`, `keyword-map.json`, `pdata-function-diff.json`.
- **Targeted Ghidra decompile attempts (depot build)**: **22 distinct
  addresses attempted; 21 emitted pseudocode bodies; 1 explicit failure** —
  `0x1400cc2e0`, "Response buffer size exceeded" (`targeted-decompiles.c`
  line 837), i.e. the decompiler response cap, not a timeout. Breakdown:
  11 priority addresses (`ghidra/targeted-decompiles.c`, 5,238 lines),
  4 in `issue-320-astra/batch2.c`, 1 in `issue-321/settlement-predicate.c`,
  6 section-round probes in `issue-320/issue-320-decompiles.c`.
- **Emitted bodies are not equally usable.** Decompiler warnings are
  retained in the artifacts: bad/overlapping instruction warnings at
  `targeted-decompiles.c` lines 263–265 (`0x1414da8b0`),
  `batch2.c` lines 24–51 (`0x1409d57c0`, `0x1409d55e0`), and throughout the
  issue-320 probes (lines 1–23: bad-instruction data, truncated flow,
  `halt_baddata`). The issue-320 addresses are section-round probes, not
  mechanic functions.
- **Semantic coverage is UNKNOWN.** The 22 addresses comprise selected
  string-led targets and six section-round probes; whether each corresponds
  to a `.pdata` entry was not checked, no denominator of *semantic functions*
  exists, and no coverage
  percentage is claimed.

## 3. Whole-binary attempts: symptoms, not diagnosis

| Attempt | Retained evidence | Recorded outcome |
| --- | --- | --- |
| REA-mediated analyze | `ghidra/analyze-depot.json` | `provider_timeout`, `timeout_ms: 10,800,000` (180 min), "Ghidra startup deadline elapsed" |
| Supervised full run 1 | `ghidra/full-run-20261017-190532.log` | stall-watchdog kill (`STALL_DETECTED`), `FINAL_STATUS=FAIL … exit 143` |
| Supervised full run 2 | `ghidra/full-run-20261017-210938.log` | log ends with no final status — terminal state **unknown** |
| Direct headless | `ghidra/direct-headless.log` | log ends with no final status — terminal state **unknown** |

- The earlier "~13 CPU-hours lost across seven attempts" account is not
  supported by retained logs and is not repeated.
- No retained artifact attributes the failures to a root cause (memory,
  stack, a specific analyzer); describe the symptoms only.
- `aoe2de-native-machinery-notes.md` claims `0x1400d6bd0` "timed out
  partway"; the artifact contains a ≈3,978-line body with no failure
  marker. The claim is unsupported by the retained evidence.
- Small-binary receipts: `preflight-a4.log` — 16 s full analysis of
  BsSndRpt64.exe with "Decompiler Parameter ID"/"Decompiler Switch Analysis"
  disabled, verified by an options dump; `preflight-b.log` — script-error
  handling; `issue-320-astra/batch1.log` — Ghidra refuses project paths with
  dot-elements (3 s failure), batch2 with a dot-free project succeeded.

## 4. Continuation is upstream-first

- **Await the upgrade worker's operational validation of native PR6170
  (resumable directories) and PR5662 (per-function timeout).** The chunk
  approach below is contingent on that validation; the custom prototype in
  §6 is **not adopted**, and **no production runnable command is offered
  here**. The audit's own scripts remain reference receipts, not adopted
  tooling.
- **Chunk selection policy**: first choose unresolved *behavior* questions
  from the reviewed WPFG/widget evidence (the UI-evidence worker's findings),
  then locate candidate handlers with the xref corpora. A successful
  decompile export is not UI understanding.
- Targets are depot-build addresses. The two builds' layouts differ
  wholesale; never translate RVAs between builds — re-derive targets per
  build from string evidence, and keep build identities attached to every
  result.

## 5. Available xref leads (examples, not exhaustive)

From `disasm/big-xrefs.json` instruction references (depot build; my
extractions were capped, so each list is a sample, not the complete set):

- `ScreenMultiplayerBrowser` → at least `0x1401ee490, 0x14157c180,
  0x1418d9f40, 0x1418d9f90, 0x1419d66d0, 0x1419d7580, 0x1419d8b40,
  0x1419dc580`
- `Age2ScreenCoopCampaignLobbyClient` → `0x140251440`;
  `Age2ScreenCoopCampaignLobbyHost` → `0x140251ee0`
- `ScenarioSlideShow` → `0x140d4a7b0, 0x140d4ab70, 0x140f67b50,
  0x140f67bd0, 0x140fec7c0, 0x141974460, 0x14197d360, 0x14197d3f0,
  0x14197d4a0, 0x14198f4b0` (capped)
- `AVUI::TriggerActionList` → `0x140281ad0`;
  `MultiplayerPregameJoinSession::requestLobbyInfo::<lambda_1>::operator ()`
  → `0x140e65bc0`

These are leads for locating handlers of *chosen* behaviors. They are not,
by themselves, a justified pause/start/match-setup chunk. In the extracted
samples, no pause-menu handler is provable — the only pause strings with
code references are Wwise audio APIs. RTTI descriptors for `UIScreenMainMenu`,
`Age2ScreenSimpleMainMenu`, `UICreateMultiplayerGameDialog`,
`PaphosCampaignPage` and `widgetuiscreen` callbacks are present in the
corpus; naming their code requires a vtable-chain pass once the reviewed
evidence names which behaviors matter.

Measured planning receipts (no extrapolation beyond them): batch2 = import
plus 4 addresses in 38 s (`batch2.{start,end,exit}`); the 11-address
priority run's output mtime is ≈4 minutes after its filename start
timestamp. No per-chunk duration estimate is claimed.

## 6. Prototype record (private notes, not adopted)

A prototype (driver, `ChunkDecompiles.java`, wrapper, mock) exists under
`.local/rea-349/prototype/`. It informed the design discussion only.
Recorded deficiencies — deliberately not fixed here:

- per-address result files share one namespace across binary/config keys,
  so a different binary or config can overwrite prior results;
- the final success branch ignores exhausted (permanent) failures, so a run
  can report OK while permanently failed addresses remain in the chunk;
- reuse trusts journal `ok` lines without verifying the result file or a
  hash of it;
- caller-supplied binary sha and config hashes are not validated;
- interrupted attempts leave no journal line, so attempt counts undercount
  real tries;
- per-address outputs use an atomic-rename fallback and are not fsync'd
  (journal lines are);
- concurrency, power-loss behavior and child-process cleanup are
  unverified.

Therefore the prototype is not production-safe, not durable, and does not
by itself prevent cross-build result mixing; those are validation goals for
the upstream work in §4, not properties of this code.

Fixture outcomes, stated narrowly (records in `.local/rea-349/`):

- Real run on owned `BsSndRpt64.exe` (4 addresses, one an intentional
  non-function): three `ok` per-address outputs; the non-function address
  recorded `create_failed` on two attempts; the retry run reported
  `reused=3` and `FINAL_STATUS=FAIL` while the tool exited 0; an earlier
  argument-shift exception in the same fixture was caught by the journal
  check, not by the exit code.
- Mock: the journal records 4 successes and 2 fails across three runs; the
  first run's log records `tool_rc=124` (batch timeout). No chronology or
  timing claims beyond these records.
- The fixture wrapper hardcodes `BsSndRpt64.exe`, a 60 s timeout, its own
  JVM flags, and deletes its fixed scratch directory on each run. It is not
  a general or game-binary command (reusing it could mislabel a game
  SHA), and the first draft's "nothing deleted" statement was wrong.

## 7. Continuation rules

- No whole-binary autoanalysis of the 71 MB exe: no retained whole-binary
  attempt has evidence of successful completion (§3 symptoms).
- Ghidra project locations must be dot-free (receipt); disable "Decompiler
  Parameter ID"/"Decompiler Switch Analysis" for analysis-scale runs and
  verify via the options dump before spending time (receipt).
- Read artifacts, not prior summaries; keep build identities attached to
  every experiment.
- Raw disassembly/pseudocode stays in ignored private areas; committed
  documents carry addresses, counts and conclusions only.
