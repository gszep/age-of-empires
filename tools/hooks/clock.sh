#!/usr/bin/env bash
# PostToolUse hook: every N tool calls, hand the model the real time. A
# nineteen-hour run once narrated its own clock, drifted seven hours and
# wrapped at dawn believing it was afternoon (docs/reviews/2026-09-19.md §4).
set -u
counter="${CLAUDE_PROJECT_DIR:-.}/.local/hook-calls"
mkdir -p "$(dirname "$counter")"
n=$(( $(cat "$counter" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$counter"
if [ $(( n % ${CLOCK_EVERY:-25} )) -eq 0 ]; then
  printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"clock: %s (tool call %s this session)"}}\n' "$(date '+%Y-%m-%d %H:%M %Z')" "$n"
fi
exit 0
