# Backlog

The backlog is the GitHub issue tracker. `tools/session_start.sh` prints an issue
inventory, not permission to work on every open ticket. Apply the active scope
below before choosing work.

## Current play-first push

Milestone **1: Play-first: focused roster and shared systems** is the active queue
in Project **Open Empires Lab #1**. The agent execution queue requires
`priority-push` **AND** `urgent` **AND** `important`, excluding deferred/blocked:

```bash
gh issue list --state open --milestone 'Play-first: focused roster and shared systems' --label priority-push --label urgent --label important --search '-label:deferred -label:blocked'
```

The roster is **Britons + Inca**, selected in **#314 (resolved)**; Inca work is #199.
Do not activate Aztecs, Maya or fill the unused third slot by default.
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

- **Urgency and importance.** `urgent` blocks the next playable step or needs
  immediate action; `important` materially serves play or campaign creation.
  Agents require both, not either. Important-only work is the planned backlog.
  Empty or blocked ready queues are reported, not filled by self-promotion.
- **Labels.** Apply the milestone and the three-label intersection above first.
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
  **Agents: urgent and important** is the saved execution view. **Milestone
  delivery** includes completed work; **Important, not urgent** and **Deferred**
  keep future work visible without feeding it to agents. Todo is queued work,
  not a claim someone is implementing it. In Progress needs a current owner/run.
  See [orchestration.md](orchestration.md) for setup and compression checkpoints.
