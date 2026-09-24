# Backlog

The backlog is the GitHub issue tracker; `tools/session_start.sh` prints it
in working order. This file only records how the tracker is used, so a
session does not have to infer it.

- **Labels.** `bug` outranks everything: a bug filed by the human is worked
  before any queue. `decision` is a product or policy call only the human can
  make — the agent files it with a recommendation and does not act until it
  is answered; the answer is recorded as a comment and the issue closed.
  `enhancement` is scope the game does not have yet; `documentation` is a
  gap in the owned data's reading; `process` is the harness itself.
  `civilisation` groups the per-civilisation implementation issues under
  [#122](https://github.com/gszep/age-of-empires/issues/122). Its first milestone
  is Britons completion (#179) plus Franks (#180); the other roster issues follow
  that verified pair, with Antiquity civilisations in a separate era-dependent phase.
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
