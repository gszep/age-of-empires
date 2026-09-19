#!/usr/bin/env bash
# PreToolUse hook (Bash): refuse the waits that never end.
#
# `pgrep -f`/`pkill -f` match the asking shell's own command line; a bare
# `sleep` or an `until … sleep` loop blocks the tool until its timeout and
# is then backgrounded and hand-polled. Both recurred across fifteen sessions
# with the rule written down (docs/reviews/2026-09-19.md §4). The one way to
# wait: start the job with a handle, then `tools/wait_for.sh pid|file|gone`.
#
# Reads the tool call as JSON on stdin; exit 2 blocks the call and hands the
# message on stderr back to the model.
set -u
cmd=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null) || exit 0
[ -z "$cmd" ] && exit 0
# The guard's own tests quote these patterns; let them through.
case "$cmd" in *guard_bash*) exit 0;; esac
reason=""
if grep -qE '\bp(grep|kill)\s+(-[a-zA-Z]*f|-f)' <<<"$cmd"; then
  reason="pgrep -f / pkill -f match the shell running them (sixteen waiters leaked once)."
elif grep -qE '\b(until|while)\b[^\n]*\bsleep\b' <<<"$cmd"; then
  reason="a sleep loop blocks the tool until its timeout, then gets backgrounded and hand-polled."
elif grep -qE '(^|[;&|(]|\bthen\b|\bdo\b)\s*sleep\s+[0-9]' <<<"$cmd"; then
  reason="a bare sleep is a wait without a handle."
fi
[ -z "$reason" ] && exit 0
cat >&2 <<MSG
Refused: $reason
Start the job with run_in_background (or 'job & echo \$! > .local/job.pid'),
then wait on the handle: tools/wait_for.sh pid|file|gone <target> [timeout].
To list processes, use 'ps -eo pid,etime,args | grep <name> | grep -v grep'.
MSG
exit 2
