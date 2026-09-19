#!/usr/bin/env bash
# The morning report, generated rather than recalled: four of the last five
# were miscounted from memory and one cited a commit that does not exist
# (docs/reviews/2026-09-19.md §5). Prints what git and the tracker know and
# a "not verified" section the run fills in by hand.
#
# Usage: tools/morning_report.sh <start-commit-or-ref> [since-ISO-time]
#   e.g. tools/morning_report.sh f834ac9 2026-09-19T22:00
set -u
cd "$(dirname "$0")/.."
start="${1:?start commit or ref}"
since="${2:-$(git log -1 --format=%cI "$start")}"
now=$(date '+%Y-%m-%d %H:%M %Z')

echo "# Run report — $now"
echo
echo "Started from \`$(git rev-parse --short "$start")\` ($(git log -1 --format=%cd --date=iso "$start" | cut -c1-16)); head is \`$(git rev-parse --short HEAD)\`."
echo "Commits: **$(git rev-list --count "$start"..HEAD)**, all pushed: $([ "$(git rev-list --count origin/main..HEAD)" = 0 ] && echo yes || echo "NO — $(git rev-list --count origin/main..HEAD) unpushed")."
echo
echo "## Commits"
git log --reverse --format='- `%h` %s' "$start"..HEAD
echo
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  echo "## Issues closed since $since"
  gh issue list --state closed --limit 100 --json number,title,closedAt --jq ".[] | select(.closedAt >= \"$since\") | \"- #\(.number) \(.title)\"" | sort -t'#' -k2 -n
  echo
  echo "## Issues opened since $since"
  gh issue list --state open --limit 100 --json number,title,createdAt,labels --jq ".[] | select(.createdAt >= \"$since\") | \"- #\(.number) [\(.labels|map(.name)|join(\",\"))] \(.title)\"" | sort -t'#' -k2 -n
  echo
  echo "## Still open, bugs first"
  gh issue list --state open --label bug --limit 100 --json number,title --jq '.[] | "- #\(.number) \(.title)"'
  echo
fi
echo "## Tests and gate"
echo "- last gate: $(grep -E 'GATE (GREEN|FAILED)' .local/gate.log 2>/dev/null | tail -1 || echo 'no log') at $(date -r .local/gate.log '+%H:%M' 2>/dev/null || echo '?')"
echo "- test files changed: $(git diff --name-only "$start"..HEAD | grep -cE '\.test\.ts$|test_import' )"
echo "- fixture clocks or timeouts changed (check each): $(git diff "$start"..HEAD -- 'src/**/*.test.ts' vite.config.ts | grep -cE '^\+.*(timeout|maxTimeSeconds|maxTicks|Ticks\b.*[0-9]{4,})' )"
echo
echo "## Ledger rows added"
git diff "$start"..HEAD -- docs/ledger.md | grep -E '^\+\|' | grep -vE '^\+\|( What |-+\|)' | sed 's/^+/- /' || true
echo
cat <<'EOT'
## Not verified

<!-- Fill in by hand, one line each. Empty is a claim, so say "nothing" if
     that is true, and say why:
- claims the run could not check (no reference, no GPU, no human):
- approximations introduced (each must also be a ledger row above):
- fixture clocks or timeouts widened, and why:
- items reverted, and what was recorded:
- what is still running on the machine, and which of it is deliberate:
-->
EOT
