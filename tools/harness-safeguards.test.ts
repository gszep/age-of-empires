import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import safeguards from './harness-safeguards.mjs';

it('the OpenCode hook rejects prohibited waits and missing/stale gates, but permits a fresh gate', async () => {
  const hooks = await safeguards({ directory: process.cwd() });
  const root = mkdtempSync(resolve(tmpdir(), 'harness-guards-'));
  const run = (command: string) => hooks['tool.execute.before']({ tool: 'bash' }, { args: { command, workdir: root } });
  try {
    execFileSync('git', ['init', '-q', root]);
    mkdirSync(resolve(root, '.local'));
    writeFileSync(resolve(root, 'app.ts'), 'code');
    execFileSync('git', ['add', 'app.ts'], { cwd: root });
    await expect(run('pgrep -f import')).rejects.toThrow('Refused');
    await expect(run('sleep 10')).rejects.toThrow('Refused');
    await expect(run('git commit -m fixture')).rejects.toThrow('no green gate');
    writeFileSync(resolve(root, '.local/gate.ok'), '');
    utimesSync(resolve(root, '.local/gate.ok'), 1, 1);
    await expect(run('git commit -m fixture')).rejects.toThrow('changed since');
    const future = new Date(Date.now() + 1000);
    utimesSync(resolve(root, '.local/gate.ok'), future, future);
    // The private sentinel itself is untracked in this fixture: ignore it as in the project.
    writeFileSync(resolve(root, '.git/info/exclude'), '.local/\n');
    await expect(run('git commit -m fixture')).resolves.toBeUndefined();
    await expect(run('tools/wait_for.sh file .local/job.exit 600')).resolves.toBeUndefined();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
