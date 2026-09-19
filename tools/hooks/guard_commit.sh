#!/usr/bin/env bash
# PreToolUse hook (Bash): no `git commit` without a gate newer than the change.
#
# The gate was piped to `tail` and a red build sailed into origin/main
# (`39aa106`); the rule was prose. `tools/gate.sh` now writes `.local/gate.ok`
# only on GREEN, and this refuses a commit when any changed tracked file is
# newer than that sentinel. A commit that touches only Markdown needs no
# gate: nothing in the gate reads the docs.
set -u
cmd=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null) || exit 0
grep -qE '\bgit\b[^|;&]*\bcommit\b' <<<"$cmd" || exit 0
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
changed=$( { git diff --cached --name-only; git diff --name-only; git ls-files --others --exclude-standard; } | sort -u)
[ -z "$changed" ] && exit 0
nondoc=$(grep -vE '\.md$' <<<"$changed" || true)
[ -z "$nondoc" ] && exit 0
if [ ! -f .local/gate.ok ]; then
  echo "Refused: no green gate on record. Run tools/gate.sh (it writes .local/gate.ok on GREEN) before committing: $(echo "$nondoc" | head -3 | tr '\n' ' ')" >&2
  exit 2
fi
newer=$(echo "$nondoc" | while read -r f; do [ -e "$f" ] && [ "$f" -nt .local/gate.ok ] && echo "$f"; done)
if [ -n "$newer" ]; then
  echo "Refused: changed since the last green gate: $(echo "$newer" | head -5 | tr '\n' ' '). Run tools/gate.sh again." >&2
  exit 2
fi
exit 0
