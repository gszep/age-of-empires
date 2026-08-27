#!/usr/bin/env bash
# Wait on a process or a sentinel file — never on a command-line pattern.
#
# `while pgrep -f script.py; do sleep; done` matches the waiting shell's own
# command line, so the loop never exits (sixteen of them ran all night once;
# see docs/lessons.md). This waits on the thing itself: a PID that can be
# signalled, a file that appears, or a file that disappears.
#
# Usage:
#   tools/wait_for.sh pid  <PID>  [timeout-secs]   # until the process exits
#   tools/wait_for.sh file <PATH> [timeout-secs]   # until the file exists
#   tools/wait_for.sh gone <PATH> [timeout-secs]   # until the file is removed
#
# Start the job so it hands you a handle first, e.g.:
#   long_job.py & echo $! > .local/job.pid
#   tools/wait_for.sh pid "$(cat .local/job.pid)" 1200
#
# Exits 0 when the condition is met, 2 on timeout (default 1800 s), 64 on a
# usage error. Polls every 5 seconds.
set -eu

mode="${1:-}"
target="${2:-}"
timeout="${3:-1800}"
interval=5

usage() {
  sed -n '2,19p' "$0" | cut -c3-
  exit 64
}
[ -n "$mode" ] && [ -n "$target" ] || usage

waited=0
while :; do
  case "$mode" in
    pid) kill -0 "$target" 2>/dev/null || exit 0 ;;
    file) [ -e "$target" ] && exit 0 ;;
    gone) [ -e "$target" ] || exit 0 ;;
    *) usage ;;
  esac
  if [ "$waited" -ge "$timeout" ]; then
    echo "wait_for: timed out after ${timeout}s waiting for $mode $target" >&2
    exit 2
  fi
  sleep "$interval"
  waited=$((waited + interval))
done
