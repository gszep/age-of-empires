import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRelease } from './shared-release.mjs';

it('freezes changed application code and manifests without copying bulk art or overwriting a release', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'shared-release-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    mkdirSync(resolve(root, 'src'));
    mkdirSync(resolve(root, 'public/imported'), { recursive: true });
    writeFileSync(resolve(root, 'src/main.ts'), 'old');
    execFileSync('git', ['add', 'src/main.ts'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'], { cwd: root });
    writeFileSync(resolve(root, 'src/main.ts'), 'new');
    writeFileSync(resolve(root, 'package-lock.json'), '{}');
    writeFileSync(resolve(root, 'public/imported/manifest.json'), '{"version":2}');
    writeFileSync(resolve(root, 'public/imported/body.png'), 'art');
    const destination = resolve(root, '.local/releases/test');
    const release = createRelease(root, destination);
    writeFileSync(resolve(root, 'src/main.ts'), 'later');
    writeFileSync(resolve(root, 'public/imported/manifest.json'), '{}');
    expect(readFileSync(resolve(destination, 'src/main.ts'), 'utf8')).toBe('new');
    expect(readFileSync(resolve(destination, 'public/imported/manifest.json'), 'utf8')).toBe('{"version":2}');
    expect(readFileSync(resolve(destination, 'public/imported/body.png'), 'utf8')).toBe('art');
    expect(release.files['src/main.ts']).toBeTruthy();
    expect(() => createRelease(root, destination)).toThrow('never overwritten');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
