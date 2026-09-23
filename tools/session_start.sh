#!/usr/bin/env bash
# What a session needs to know before it touches anything, read from the
# things that cannot go stale: git, the issue tracker, the gate's last run,
# the manifest on disk and the process table. The prose queues used to carry
# this and were wrong within a day (docs/reviews/2026-09-19.md, §7).
#
# Usage: tools/session_start.sh [--no-fetch] [--unattended]
set -u
cd "$(dirname "$0")/.."

fetch=1
unattended=0
for arg in "$@"; do
  case "$arg" in
    --no-fetch) fetch=0 ;;
    --unattended) unattended=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ "$unattended" -eq 1 ]; then
  node tools/unattended_preflight.mjs || exit 1
fi

section() { printf '\n== %s ==\n' "$1"; }

section "tree"
if [ $fetch -eq 1 ]; then git fetch -q origin 2>/dev/null || echo "(fetch failed; offline?)"; fi
branch=$(git rev-parse --abbrev-ref HEAD)
behind=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo '?')
ahead=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo '?')
echo "branch $branch — $ahead ahead, $behind behind origin/main; head $(git log -1 --format='%h %ad %s' --date=short)"
dirty=$(git status --porcelain | wc -l)
[ "$dirty" -gt 0 ] && echo "working tree has $dirty changed path(s):" && git status --short | head -10
[ "$behind" != "0" ] && [ "$behind" != "?" ] && echo "-> git pull before starting; another session has pushed."

section "gate"
node tools/report-data.mjs gate

section "imported content"
m=public/imported/aoe2/manifest.json
if [ -f "$m" ]; then
  echo "manifest $(date -r "$m" '+%Y-%m-%d %H:%M'); last importer commit $(git log -1 --format='%ad %h' --date=short -- tools/import_content.py tools/convert_sld.py tools/import_ui.py tools/import_blends.py tools/import-spec.json tools/sld_layers.py)"
  [ "$m" -ot tools/import-spec.json ] && echo "-> manifest is older than tools/import-spec.json; re-run tools/import_aoe2.sh"
  python3 -c "import json,sys; d=json.load(open('$m')); missing=[k for k in ('blends','entities','technologies','terrain','playerAttributes','strings','water') if k not in d]; print('-> manifest lacks', missing, '(the three-step pipeline was not finished; AGENTS.md)') if missing else None" 2>/dev/null
else
  echo "no manifest — open fallback only; tools/import_aoe2.sh builds it (docs/owned-assets-setup.md)"
fi

section "running"
if command -v systemctl >/dev/null; then
  managed=$(systemctl --user show open-empires-shared.service --no-pager \
    -p LoadState -p ActiveState -p SubState -p Result -p NRestarts -p ExecMainStatus 2>/dev/null) || managed=""
  if [ -n "$managed" ] && ! grep -q '^LoadState=not-found$' <<< "$managed"; then
    printf 'managed open-empires-shared.service:\n%s\n' "$managed"
  else
    echo "managed shared service unavailable or not installed"
  fi
fi
procs=$(ps -eo pid,etime,args | grep -E 'vite|chrome|convert_sld|import_aoe2|gate\.sh|tsx .*probes|shared-host\.mts|shared-join\.mjs' | grep -v grep | grep -v session_start || true)
if [ -n "$procs" ]; then echo "$procs" | cut -c1-120; else echo "nothing of ours"; fi

section "issues (bugs first — anything tagged bug outranks every queue)"
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  for label in bug decision enhancement documentation process; do
    list=$(gh issue list --state open --label "$label" --limit 100 --json number,title --jq '.[] | "  #\(.number) \(.title)"' 2>/dev/null)
    [ -n "$list" ] && printf '%s:\n%s\n' "$label" "$list"
  done
  section "closed issues still named as open in the docs"
  closed=$(gh issue list --state closed --limit 300 --json number --jq '.[].number' 2>/dev/null)
  stale=0
  for n in $closed; do
    hits=$(grep -nE "(^|[^0-9])#$n([^0-9]|$)" docs/overnight.md docs/backlog.md 2>/dev/null | grep -iE 'open|left|remain|blocked|next|start' || true)
    [ -n "$hits" ] && echo "$hits" | cut -c1-140 && stale=1
  done
  [ $stale -eq 0 ] && echo "none"
else
  echo "gh is not authenticated; run: gh auth login   (the tracker is the queue)"
fi

section "next"
cat <<'EOF'
1. Read AGENTS.md, then docs/overnight.md's standing rules, then docs/lessons.md.
2. Bugs first, in issue order; then decisions the human has answered; then enhancements.
3. Run tools/gate.sh before every commit; push after every commit.
4. Before an unattended OpenCode run: tools/session_start.sh --unattended, then the live-session probes in docs/overnight.md.
EOF
