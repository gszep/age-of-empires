# Backlog

The backlog is the GitHub issue tracker. `tools/session_start.sh` prints an issue
inventory, not permission to work on every open ticket. Apply the active scope
below before choosing work.

## Current play-first push

Milestone **1: Play-first: focused roster and shared systems** is the active queue
in Project **Open Empires Lab #1**. Select `priority-push` and exclude `deferred`:

```bash
gh issue list --milestone 'Play-first: focused roster and shared systems' --label priority-push --search '-label:deferred'
```

Britons is the initial baseline; #314 selects one Native American civilisation.
Do not activate all candidate tickets or fill the optional third slot by default.
The roster cap is three. #315 investigates shared task/animation contracts, #316
defines a small playable co-op scenario, and #317 restores Artemis compatibility.
`shared-mechanic` distinguishes cross-civilisation questions, including those
deferred until they matter to the chosen experience. No exhaustive native parity
programme or new calibration framework is implied.

Calibration tooling #308/#309 is active only for reusable fixtures/readback that
answer a concrete shared question. #312 remains the reference-build decision.
Fine HP arithmetic, broad recording/audio work and unchosen-civilisation scope
are deferred. Historical evidence in [handoff](handoff.md) and the ledger remains
useful; an old acceptance checklist does not override the new priority scope.

- **Labels.** Apply `priority-push`/the milestone and exclude `deferred` first.
  Within that scope, human-filed `bug` issues outrank enhancements. A deferred
  issue is not reactivated merely because it also says `bug` or `civilisation`;
  re-triage when it blocks focused play or the owner changes scope.
  `decision` is a product or policy call only the human can
  make — the agent files it with a recommendation and does not act until it
  is answered; the answer is recorded as a comment and the issue closed.
  `enhancement` is scope the game does not have yet; `documentation` is a
  gap in the owned data's reading; `process` is the harness itself.
  `civilisation` groups the per-civilisation implementation issues under
  [#122](https://github.com/gszep/age-of-empires/issues/122), whose full-catalogue
  expansion is deferred. [Current scope](status.md) lists shipped profiles, not
  the active development roster. Antiquity
  civilisations require a separate era-dependent phase.
- **Filing.** When the agent notices a gap, it files an issue then and there
  with the evidence (the DAT field, the file, the measurement) and the fix
  path, in the repo's voice. A gap noted only in prose is a gap the next
  session will not find. Deliberate omissions are issues too, closed or held
  with the reason on them, so nobody re-derives the reasoning.
- **Closing.** An issue closes with the commit that fixes it and a comment
  saying how it was verified. The human may reopen; a reopened issue is a
  bug whatever its label.
- **Blocked on the human.** If an issue cannot proceed without an answer,
  the agent names the number and asks in the session; the human works from
  the list and answers there.
- **What lives elsewhere.** Design notes with a home (`docs/*-design.md`),
  the ledger of approximations (`docs/ledger.md`), and the rules that bit
  (`docs/lessons.md`).
- **Projects and parallel work.** Projects is a status view of these issues,
  not another backlog. The coordinator records bounded worker assignments and
  verification on the issue; only integrated, verified work moves to Done.
  See [orchestration.md](orchestration.md) for setup and compression checkpoints.
