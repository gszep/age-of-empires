# OpenCode stream-timeout investigation

Recorded 2026-10-01; tracker: [#261](https://github.com/gszep/age-of-empires/issues/261).

## Delivered safeguard

`opencode.jsonc` sets `provider.openai.options.timeout` to **600000ms**: a
ten-minute total provider-request deadline. Header and chunk-idle defaults are
retained. The build agent can read the OpenCode log directory, while its file-edit
permissions deny changes there. These are tool permissions, not an OS sandbox.

The installed CLI accepted the merged configuration. The current OpenCode
process started at2026-10-01T15:15:11Z, after the config edit at15:13:53Z, and
actual Read-tool access to the log directory succeeded after restart.

Verification before commit: merged-config deadline check, resolved log read/edit
permission checks and unattended preflight all passed. The owned checkpoint
passed in17m28s (`.local/timeout261-gate.log`, exit 0):1186 Vitest tests across 91
files,7 existing inapplicable skips, build,172 Python/import tests and real-browser
debug smoke. No application rules or test timeouts changed for this safeguard.

## Incident evidence

The Japanese overnight request started at2026-09-30T23:21:46Z through OpenAI's
AI-SDK runtime. OpenCode recorded an unfinished `apply_patch` tool-input part at
23:21:56Z, with no completed arguments or edit-permission event. It ended only
on user cancellation at2026-10-01T07:25:44Z. No earlier timeout/retry was logged
for that request. Relevant log records:76424–76426 and77004–77005.

A concurrent session recorded connection/socket failures at23:31,23:35 and 23:36.
These demonstrate nearby connectivity trouble, not the exact network trigger
or on-wire contents of the stalled request.

The affected process was **1.18.33**: it installed 1.18.34 in the background but
continued running the old version. Session creation/log records75806–75807
establish this distinction. The later restart activated 1.18.34; its release
notes do not claim a timeout fix.

## Controlled verification

The installed 1.18.34 CLI was run against a local mock OpenAI-compatible provider
with dummy credentials, isolated HOME/XDG directories and no model inference.
The mock began a tool call without completing its arguments.

| Case | Result |
| --- | --- |
| Silent stream;300ms chunk deadline | Connection closed after 324ms |
| Heartbeat comments every 80ms;300ms chunk deadline; no total deadline | Still open after 2500ms; stopped by the fixture's observation limit |
| Same heartbeat stream;1200ms total deadline | Connection closed after 1194ms |
| Completed model response;600ms provider deadline; slow local shell tool | Tool completed in1813ms; follow-up model response succeeded |

All four checks passed. This establishes a reproducible idle-watchdog gap and
verifies that the total-request mechanism bounds it without terminating a
healthy tool after the provider response finishes. The millisecond settings
accelerate the fixture; the project uses the same option at ten minutes.
The original request's precise transport failure remains unproven, and no live
paid-model failure was deliberately induced.

Version-matched implementation:
[provider.ts lines 37–125](https://github.com/anomalyco/opencode/blob/v1.18.33/packages/opencode/src/provider/provider.ts#L37-L125).
The idle timer resets on body bytes, including heartbeat comments. A total
`AbortSignal.timeout` is attached only when configured. The
[retry policy](https://github.com/anomalyco/opencode/blob/v1.18.33/packages/opencode/src/session/retry.ts)
allows up to five transient retries, so this is a per-request bound, not a
ten-minute bound on an entire turn or an eight-hour bound on a run.

Original local fixture artifacts were `/tmp/opencode/timeout-probe.mjs` and
`/tmp/opencode/stream-timeout-lkXlWj/`; those are temporary, not maintained test
dependencies. The measurements above and issue thread are the durable evidence.

## Other events and context policy

- Six ten-minute `wait_for.sh` monitoring expiries did not kill the child jobs.
  Monitor expiry must be distinguished from a failed child exit status.
- Chinese browser-r2 timed out because a live source edit reloaded its fixture
  paused. Subsequent acceptance ran with source frozen; the lesson is recorded.
- The long Chinese import was active conversion work, aggravated by canonical
  atlas-path cache invalidation; its follow-up is#257.
- Chinese request contexts grew from 300233 to642881 tokens. Several steps spent
  150–288 seconds before a tool started; no compaction part was recorded.
  This is evidence of substantial pre-tool latency, not proof that context size
  caused the overnight stall.
- The user's normal policy is to ask for wrap-up around 60% context. Honour that
  with a safe checkpoint and concise handoff, then compact/start fresh. Merely
  resuming the same conversation retains its accumulated context. This policy
  does not replace a transport deadline when the session cannot accept input.
