# Issue-backed orchestration

Adapted from `henkaku-center/chi` at
`171cd24704cb4ab47e8e7f36beee32c754f90a55`: its collaboration review discipline,
compression rounds and conservative CI. Chi's automatic threshold nudges and
claim-expiry mechanisms are planned features, not imported runtime capabilities.

## Authority and scheduling

This harness targets **OpenCode V2**. After upgrading from V1, restart OpenCode
to load the repository's V2 plugin and configuration, then run
`node tools/harness_smoke.mjs` and `node tools/unattended_preflight.mjs` before
starting an unattended coordinator. The smoke verifies the installed CLI's native
`shell` hooks; preflight verifies resolved role models and permissions. A V1
session or a passing application build does not validate this harness.

GitHub issues hold the request, acceptance, evidence and result. A GitHub Project
is a scheduling view of those same issues, never a second backlog. Bugs retain
priority over enhancements. Use one repository board with its existing Status
field; inspect actual fields/options instead of assuming IDs or renaming them.
The repository Project is **Open Empires Lab**, owner `gszep`, number **1**:
`https://github.com/users/gszep/projects/1`. It is linked to this repository and
uses Todo, In Progress and Done; In Progress includes review/verification.
Blockers belong in issue comments; do not create draft cards that duplicate issues.

Projects access requires `gh auth refresh -s project`. Setup and live helper
read/write/readback were verified on October 4, 2026 under #292, including all
114 then-open issues. Read current counts/status from GitHub rather than this
receipt. Issue-only work can continue when an operator lacks Project access.

The fixture-tested helper discovers IDs and refuses missing/ambiguous fields or
incomplete results. Supply the actual board number and exact Status option:

```bash
node tools/project.mjs inspect --owner gszep --project 1
node tools/project.mjs add --owner gszep --project 1 https://github.com/gszep/age-of-empires/issues/292
node tools/project.mjs status --owner gszep --project 1 https://github.com/gszep/age-of-empires/issues/292 "In Progress"
```

`status` updates an existing issue card; it does not close the issue. Read back
with `gh project item-list 1 --owner gszep --format json --limit COUNT`,
checking `totalCount` to avoid mistaking a truncated list for the complete board.

## One coordinator, bounded workers

The repository's default agent is `orchestrator`. The owner selected these tiers:

| Role | Model | Budget |
| --- | --- | --- |
| Coordinator | `anthropic/claude-opus-5-5#high` | Long-lived session, bounded by the agreed run deadline |
| Default worker | `anthropic/claude-haiku-4-5#high` | 32 steps; one attempt and one focused corrective retry |
| Escalation | `openai/gpt-6-astra#high` | 64 steps on the preserved task/worktree |
| Independent reviewer | `openai/gpt-6-astra#high` | 24 steps; read-only, no shell |

Model IDs were resolved from the installed catalogue. The coordinator delegates
to these role names without overriding the worker model. Workers cannot spawn
children, and the coordinator cannot bypass the tier through the unpinned
general/explore agents. Direct implementation by the coordinator is reserved for
integration glue and conflict resolution, not an entire backlog in one context.
Delegation is authorized for the requested scope. Start with two implementation
workers; increase only for disjoint work and available CPU.
One coordinator owns integration, source regeneration, the full gate and rollout.
Multiple orchestrators may coordinate separate issues, but must agree on one
integration owner before publishing to main.

Before dispatch, record on the issue:

```text
Task/issue:
Coordinator session and worker session:
Base SHA / branch / absolute worktree:
Owned paths and excluded shared interfaces:
Dependencies / acceptance / targeted checks:
Return: diff summary, exact checks, evidence paths, unresolved questions,
        commit SHA (if gated) or working-tree status, remaining processes.
```

Create each worker with `node tools/worktree.mjs create issue-N-topic origin/main`
after fetching. A worktree path in a prompt does **not** move patch tools. Use a
two-phase launch: first spawn the role with an initialization-only prompt that
forbids tools/work, retain its returned child session ID, then call
`tools.opencode.session_move` with that ID and the absolute worktree. Only after
the move succeeds, resume that same child with the assignment. Escalations follow
the same handshake and move to the stopped worker's tree; never run both writers
there simultaneously. Read-only source probes may stay in the primary checkout.
Workers read their checkout's AGENTS.md. Install dependencies
inside each tree; never symlink writable node_modules or generated manifests
from a running checkout. Owned depots are read-only inputs. Workers needing new
imports coordinate a single import slot and private output; never mutate the
household release's assets. `.local/**` remains excluded from suite discovery.

Do not run multiple full gates/imports concurrently. Workers run targeted checks
and return bounded changes. Under this repository's green-before-commit rule,
an ungated worker returns its intact worktree to the coordinator rather than
bypassing the commit guard. The coordinator schedules its gate/commit, then
integrates the branch normally and verifies the combined tree. Push completed
worker commits to their named branches; only the coordinator pushes main.

### Escalation and long-lived context

Worker returns must start with `PASS`, `NEEDS_ESCALATION`, or `BLOCKED`. A failed
outcome check gets one focused retry. A second unresolved failure, exhausted step
budget, or explicitly diagnosed complexity goes to Astra with the original
acceptance, worktree/base, partial diff, exact errors, attempted hypotheses and
remaining handles. Preserve the cheap worker's work. Do not weaken acceptance,
repeat the same attempt indefinitely or silently choose an expensive fallback.
Credential, network and absent-input failures are operational blockers; escalating
models cannot supply missing evidence or authorization. Astra returns PASS or a
precise blocker; further scope needs a coordinator decision.

Keep the issue/dependency map, decisions, child session IDs and short receipts in
the coordinator context. Leave detailed source/log investigation in child sessions.
Before context compaction or stopping, write a compact recovery handoff under
`.local/orchestrator/` and update the public issue with nonsensitive decisions and
evidence. This supports a long-lived session without pretending its context is
infinite or requiring the coordinator to reread every worker transcript.

For a new bounded run, select both role and model explicitly:

```bash
opencode run --agent orchestrator --model anthropic/claude-opus-5-5#high "Coordinate issue #N using docs/orchestration.md"
# Resume the same coordinator context; replace SESSION_ID with its real ID:
opencode run --session SESSION_ID --agent orchestrator --model anthropic/claude-opus-5-5#high "Continue the agreed scope"
```

Use `tools/run-supervised.mjs` around `opencode run --standalone` for an unattended run with an agreed deadline
and idle bound. Configuration does not retroactively change a session's selected
agent/model or start a daemon. Run the installed-CLI safeguard smoke and unattended
preflight first. A completed routing probe is not an unattended endurance test.

## Review, integration and recovery

1. Use the read-only Astra `reviewer` on returned changes and evidence. Check the
   reported symptom and public outcomes, not only implementation assertions.
   Reviews do not replace the coordinator's executed acceptance/gate checks.
2. Fetch main, inspect divergence, merge published history normally. Never rebase
   or force-push published commits. Integrate one branch at a time; resolve shared
   interface conflicts with the owning worker before moving to the next.
3. Freeze the combined tree. Run mapped acceptance and `tools/gate.sh` directly
   with output redirected to a unique log. Record skips and gate-stage timings.
   CI is additional evidence, not a replacement for the local owned-content gate.
4. Commit/push the verified result, attach SHA/checks to the issue, then update
   the Project. Done means integrated and verified, not merely worker-finished.
5. Retire with `node tools/worktree.mjs retire issue-N-topic` only after integration.
   Dirty or unmerged trees must survive. Move worker `.local/` evidence/recovery
   artifacts into the primary checkout's ignored storage and update issue paths
   first: retirement refuses ignored contents except reinstallable `node_modules/`,
   `dist/` and `.venv/`. Inspect surviving processes and list worktrees at handoff.
   Report blocked work explicitly.

Issue comments are a human-readable coordination record, not an atomic distributed
claim service. The worktree helper serializes filesystem operations, not agent
edits or remote ownership. After a crash inspect the lock owner, process table,
Git worktree list and issue comments; the lock's `owner.json` records PID, task,
operation and start time. A PID may have been reused: never delete a lock or tree
on age or PID existence alone.

## Compression checkpoint

After each substantial integrated feature batch and before expanding scope, ask
for a compression round over a bounded area. This is a safe-point repository
audit, not automatic chat compaction. Stop competing edits first; never do it
during a rollout.

- Record the base SHA and `node tools/footprint.mjs` output. Stage new files before
  the final measurement; ignored assets, binaries and symlinks are excluded.
- Audit dead paths, redundant wrappers, duplicated fixtures/logic, stale prose
  and avoidable build copies. Search callers and source contracts before deleting.
- Keep source provenance, regressions, replay determinism, owned/open behavior and
  live acceptance. Do not remove assertions, widen clocks or replace behavioral
  tests with constant checks to make CI faster. A no-op is a valid audit result.
- Measure after with the same tool and `git diff --numstat <base>`; report added,
  deleted and net lines, plus before/after build and full-gate stage seconds on
  comparable idle runs. Say when timing is unavailable; line savings are not a
  speed measurement. Keep logs in ignored `.local/` and summarize on the issue.
- Commit verified reductions as `refactor:` or `docs:` and push. Record retained
  complexity and follow-up issues. There is no automatic churn threshold yet.

## Public CI

The public workflow verifies open content only. Ordinary documentation-only PRs
and drafts skip heavy jobs while the stable required result still reports. Ready
PRs use conservative import-graph selection with critical/opaque consumers; uncertain
inputs run the full suite. Main and nightly runs execute all public checks.
Superseded PR runs cancel; main runs do not. PRs only restore npm download caches;
successful main pushes publish them. No owned assets or model credentials enter
GitHub Actions. See `docs/TESTING.md` for npm entrypoints and measured scope.
