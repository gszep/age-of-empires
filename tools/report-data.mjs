/** Shared, instant-based tracker/gate reporting for unattended runs (#159). */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

export function instant(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`invalid timestamp: ${value}`);
  return date;
}

export function fetchIssues(parameters) {
  // REST pagination includes old-created issues updated/closed in this window.
  // Unlike a fixed `gh issue list --limit`, it cannot silently stop at 100.
  // JSON lines also work with the installed older gh, which has --paginate
  // but predates --slurp. @json escapes embedded newlines in issue text.
  const args = ['api', '--paginate', '--jq', '.[] | @json', '-X', 'GET', 'repos/{owner}/{repo}/issues'];
  for (const [key, value] of Object.entries({ ...parameters, per_page: 100 })) args.push('-f', `${key}=${value}`);
  const output = execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return output.split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(issue => !issue.pull_request);
}

export function issueReport(since, fetch = fetchIssues) {
  const start = instant(since);
  const normalized = start.toISOString();
  // GitHub's REST `since` is strictly after; retain the inclusive boundary
  // locally and fetch one second earlier so a boundary event is not dropped.
  const issues = fetch({ state: 'all', since: new Date(start.getTime() - 1000).toISOString() });
  const after = value => value != null && instant(value) >= start;
  const ordered = rows => rows.slice().sort((a, b) => a.number - b.number);
  const closed = ordered(issues.filter(issue => after(issue.closed_at)));
  const opened = ordered(issues.filter(issue => after(issue.created_at)));
  const bugs = ordered(fetch({ state: 'open', labels: 'bug' }));
  const line = issue => `- #${issue.number} ${issue.title}`;
  return [
    `## Issues closed since ${normalized}`, ...closed.map(line), '',
    `## Issues opened since ${normalized}`, ...opened.map(issue =>
      `- #${issue.number} [${(issue.labels ?? []).map(label => label.name).join(',')}] ${issue.title}`), '',
    '## Still open, bugs first', ...bugs.map(line), '',
  ].join('\n');
}

function gateRunning(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  const process = spawnSync('ps', ['-p', String(pid), '-o', 'args='], { encoding: 'utf8' });
  return process.status === 0 && process.stdout.includes('gate.sh');
}

export function gateReport(root = '.', running = gateRunning) {
  const record = join(root, '.local/gate.latest.json');
  if (existsSync(record)) {
    try {
      const run = JSON.parse(readFileSync(record, 'utf8'));
      if (typeof run.started !== 'number' || typeof run.status !== 'string' || typeof run.log !== 'string') {
        throw new Error('missing gate record fields');
      }
      const status = run.status === 'running' && !running(run.pid) ? 'interrupted (gate process is gone)' : run.status;
      const lines = [`latest run started ${instant(run.started * 1000).toISOString()}: ${status}; log ${run.log}`];
      if (status === 'green' && !existsSync(join(root, '.local/gate.ok'))) lines.push('-> green run has no gate sentinel; rerun before committing code');
      return lines.join('\n');
    } catch (error) {
      return `cannot read latest gate record: ${error.message}; run tools/gate.sh`;
    }
  }
  const legacy = join(root, '.local/gate.log');
  if (existsSync(legacy)) {
    const status = readFileSync(legacy, 'utf8').split('\n').reverse().find(line => /GATE (GREEN|FAILED)/.test(line)) ?? 'no terminal result';
    return `legacy default log only (named runs may be newer): ${statSync(legacy).mtime.toISOString()}: ${status}`;
  }
  return 'no gate log in .local/ — run tools/gate.sh before the first commit';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const mode = process.argv[2];
    if (mode === 'gate') console.log(gateReport());
    else if (mode === 'issues') console.log(issueReport(process.argv[3]));
    else throw new Error('usage: node tools/report-data.mjs gate|issues <since-ISO-time>');
  } catch (error) {
    console.error(`Report data unavailable (not verified): ${error.message}`);
    process.exitCode = 1;
  }
}
