import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { integrationWorktree } from './worktree.mjs';

it('bounds integration and refuses to discard dirty persistent work', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'worktree-policy-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    writeFileSync(resolve(root, '.gitignore'), '.local/\n');
    execFileSync('git', ['add', '.gitignore'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'], { cwd: root });
    const target = integrationWorktree(root, 'create', 'slice');
    expect(target).toBe(resolve(root, '.local/worktrees/slice'));
    expect(() => integrationWorktree(root, 'create', 'second')).toThrow('existing slice');
    writeFileSync(resolve(target, 'unfinished.ts'), 'valuable work');
    expect(() => integrationWorktree(root, 'retire', 'slice')).toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
