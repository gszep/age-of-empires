import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { footprint } from './footprint.mjs';

test('counts tracked working text without following links or counting assets and deleted files', () => {
  const root = mkdtempSync(join(tmpdir(), 'empires-footprint-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  try {
    git('init');
    git('config', 'user.name', 'Fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    writeFileSync(join(root, 'with space.md'), 'first\nsecond');
    writeFileSync(join(root, 'binary'), Buffer.from([0, 10]));
    writeFileSync(join(root, 'gone'), 'gone\n');
    symlinkSync('with space.md', join(root, 'link'));
    git('add', '.');
    git('commit', '-m', 'fixture');
    unlinkSync(join(root, 'gone'));
    writeFileSync(join(root, 'untracked'), 'not included\n');
    writeFileSync(join(root, 'with space.md'), 'first\nsecond\n');
    expect(footprint(root)).toMatchObject({ files: 1, lines: 2, bytes: 13, binary: 1, symlinks: 1, missing: 1 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
