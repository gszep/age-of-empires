import { afterEach, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyDiff, ordinaryDocumentation, selectScope } from './ci-scope.mjs';

const a = 'a'.repeat(40), b = 'b'.repeat(40), zero = '0'.repeat(40);
const modified = (path: string) => `:100644 100644 ${a} ${b} M\0${path}\0`;
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('accepts only ordinary documentation locations', () => {
  for (const path of ['README.md', 'CONTRIBUTING.md', 'docs/architecture.md', 'docs/reviews/2026-10-04.md']) {
    expect(ordinaryDocumentation(path), path).toBe(true);
    expect(classifyDiff(modified(path)), path).toBe('docs');
  }
});

it('requires full checks for configuration, agent instructions, code and unknown paths', () => {
  for (const path of ['.opencode/commands/test.md', '.claude/skills/foo.md', '.github/workflows/ci.yml',
    'AGENTS.md', 'docs/AGENTS.md', 'docs/CLAUDE.md', 'docs/SKILL.md', 'docs/.opencode/foo.md',
    'docs/status.md', 'docs/handoff.md', 'docs/backlog.md', 'docs/overnight.md',
    'docs/.hidden.md', 'src/README.md', 'unknown/guide.md', 'package-lock.json', 'vite.config.ts',
    'docs/data.json', 'docs/../README.md', '/docs/a.md', 'docs//a.md', 'docs/a\nb.md', 'docs/a\\b.md', 'docs/a.MD']) {
    expect(classifyDiff(modified(path)), path).toBe('full');
  }
  expect(classifyDiff(modified('README.md') + modified('src/main.ts'))).toBe('full');
});

it('fails closed on empty, malformed, truncated, renamed and non-regular records', () => {
  for (const raw of ['', '\0', modified('README.md').slice(0, -1), 'README.md\n',
    `:100644 100644 ${a} ${b} R100\0src/code.ts\0docs/code.md\0`,
    `:100644 120000 ${a} ${b} T\0README.md\0`,
    `:100644 100755 ${a} ${b} M\0README.md\0`,
    `:100644 100644 ${zero} ${b} M\0README.md\0`,
    modified('README.md') + 'broken\0']) expect(classifyDiff(raw)).toBe('full');
});

it('accepts regular documentation additions and deletions', () => {
  expect(classifyDiff(`:000000 100644 ${zero} ${b} A\0docs/new.md\0`)).toBe('docs');
  expect(classifyDiff(`:100644 000000 ${a} ${zero} D\0docs/old.md\0`)).toBe('docs');
});

it('uses the merge base, detects code-to-doc renames, and falls back on unavailable history', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ci-scope-'));
  roots.push(cwd);
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(cwd, 'README.md'), 'initial');
  writeFileSync(join(cwd, 'code.ts'), 'code');
  git('add', '.'); git('commit', '-qm', 'base');
  const initial = git('rev-parse', 'HEAD');
  git('checkout', '-qb', 'docs');
  writeFileSync(join(cwd, 'README.md'), 'updated');
  git('commit', '-qam', 'docs');
  const head = git('rev-parse', 'HEAD');
  git('checkout', 'main');
  writeFileSync(join(cwd, 'code.ts'), 'upstream code');
  git('commit', '-qam', 'upstream');
  const base = git('rev-parse', 'HEAD');
  const scope = (event: string, base: string, head: string) => selectScope({ event, base, head, cwd });
  expect(scope('pull_request', base, head)).toBe('docs');
  expect(scope('push', initial, head)).toBe('full');
  expect(scope('workflow_dispatch', initial, head)).toBe('full');
  expect(scope('pull_request', '', head)).toBe('full');
  expect(scope('pull_request', '--help', head)).toBe('full');
  expect(scope('pull_request', zero, head)).toBe('full');
  expect(scope('pull_request', a, head)).toBe('full');
  expect(scope('pull_request', head, head)).toBe('full');
  git('checkout', 'docs');
  mkdirSync(join(cwd, 'docs'));
  git('mv', 'code.ts', 'docs/code.md');
  git('commit', '-qm', 'rename');
  expect(scope('pull_request', initial, git('rev-parse', 'HEAD'))).toBe('full');
});
