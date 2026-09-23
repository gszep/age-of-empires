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
  node tools/report-data.mjs issues "$since"
fi
echo "## Tests and gate"
node tools/report-data.mjs gate
echo "- test files changed: $(git diff --name-only "$start"..HEAD | grep -cE '\.test\.ts$|test_import' )"
echo "- timeout/clock-related added diff lines (review candidates, not a count of widened clocks): $(git diff "$start"..HEAD -- 'src/**/*.test.ts' vite.config.ts | grep -cE '^\+.*(timeout|maxTimeSeconds|maxTicks|Ticks\b.*[0-9]{4,})' )"
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
