import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fetchIssues, gateReport, instant, issueReport } from './report-data.mjs';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn(), spawnSync: vi.fn() }));
const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); vi.clearAllMocks(); });

describe('run report evidence (#159)', () => {
  it('compares instants across zones and includes old-created closures and newly closed creations', () => {
    const fetch = vi.fn(parameters => parameters.labels ? [] : [
      { number: 83, title: 'older issue', created_at: '2025-01-01T00:00:00Z', closed_at: '2026-09-21T17:14:57Z' },
      { number: 84, title: 'too early', created_at: '2025-01-01T00:00:00Z', closed_at: '2026-09-21T16:00:00Z' },
      { number: 85, title: 'created and closed', created_at: '2026-09-21T16:46:33Z', closed_at: '2026-09-21T18:00:00+01:00', labels: [{ name: 'bug' }] },
    ]);
    const report = issueReport('2026-09-21T17:46:33+01:00', fetch);
    const [closed, opened] = report.split('## Issues opened');
    expect(closed).toContain('#83 older issue');
    expect(closed).toContain('#85 created and closed');
    expect(report).not.toContain('#84');
    expect(opened).toContain('#85 [bug] created and closed');
    expect(fetch).toHaveBeenCalledWith({ state: 'all', since: '2026-09-21T16:46:32.000Z' });
    expect(instant('2026-09-21T17:46:33+01:00').toISOString()).toBe('2026-09-21T16:46:33.000Z');
    expect(() => instant('not a timestamp')).toThrow();
  });

  it('requests all REST pages and excludes PRs without truncating at 100 issues', () => {
    const issues = Array.from({ length: 125 }, (_, index) => ({ number: index + 1, title: 'issue' }));
    vi.mocked(execFileSync).mockReturnValue([...issues, { number: 900, pull_request: {} }].map(issue => JSON.stringify(issue)).join('\n') + '\n');
    expect(fetchIssues({ state: 'all', since: '2026-09-21T16:46:32Z' })).toEqual(issues);
    expect(execFileSync).toHaveBeenCalledWith('gh', expect.arrayContaining(['--paginate', '--jq', '.[] | @json', 'state=all', 'per_page=100']), expect.any(Object));
  });

  function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'empires-report-'));
    directories.push(root);
    mkdirSync(join(root, '.local'));
    writeFileSync(join(root, '.local/gate.log'), 'GATE GREEN\n');
    const record = (status: string) => writeFileSync(join(root, '.local/gate.latest.json'), JSON.stringify({
      status, pid: 123, started: 1_000, log: '/repo/.local/named-issue-gate.log',
    }));
    return { root, record };
  }

  it('reports named failures and interruptions rather than a stale green default log', () => {
    const { root, record } = fixture();
    record('failed: npm run build');
    expect(gateReport(root)).toContain('failed: npm run build; log /repo/.local/named-issue-gate.log');
    record('running');
    expect(gateReport(root, () => false)).toContain('interrupted (gate process is gone)');
    expect(gateReport(root, () => true)).toContain(': running;');
    record('green');
    expect(gateReport(root)).toContain('green run has no gate sentinel');
    writeFileSync(join(root, '.local/gate.ok'), '');
    expect(gateReport(root)).not.toContain('no gate sentinel');
  });

  it('does not fall back to stale success when the latest record is malformed', () => {
    const { root } = fixture();
    expect(gateReport(root)).toContain('legacy default log only');
    writeFileSync(join(root, '.local/gate.latest.json'), '{broken');
    expect(gateReport(root)).toContain('cannot read latest gate record');
    expect(gateReport(root)).not.toContain('GATE GREEN');
  });
});
