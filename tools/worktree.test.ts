import { afterEach, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { integrationWorktree } from './worktree.mjs';

const roots: string[] = [];
const git = (root: string, ...args: string[]) => execFileSync('git', args, {
  cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}).trim();
function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'worktree policy-'));
  roots.push(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  writeFileSync(resolve(root, '.gitignore'), '.local/\n');
  git(root, 'add', '.gitignore');
  git(root, 'commit', '-qm', 'fixture');
  return root;
}
function commit(root: string) {
  writeFileSync(resolve(root, 'worker.txt'), 'valuable work');
  git(root, 'add', 'worker.txt');
  git(root, 'commit', '-qm', 'worker change');
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('keeps multiple durable named workers independently writable', () => {
  const root = fixture();
  const first = integrationWorktree(root, 'create', 'first');
  writeFileSync(resolve(first, 'unfinished.ts'), 'valuable work');
  const second = integrationWorktree(root, 'create', 'second');
  expect(first).toBe(resolve(root, '.local/worktrees/first'));
  expect(second).toBe(resolve(root, '.local/worktrees/second'));
  expect(git(first, 'branch', '--show-current')).toBe('work/first');
  expect(git(second, 'branch', '--show-current')).toBe('work/second');
  expect(() => integrationWorktree(root, 'create', 'first')).toThrow('already exists');
  integrationWorktree(root, 'retire', 'second');
  expect(existsSync(second)).toBe(false);
  expect(existsSync(resolve(first, 'unfinished.ts'))).toBe(true);
});

it('allows concurrent callers to create separate workers with retry on the operation lock', async () => {
  const root = fixture();
  const helper = fileURLToPath(new URL('./worktree.mjs', import.meta.url));
  const results = await Promise.all(['first', 'second'].map(name => new Promise<{ name: string; error: Error | null; stderr: string }>(done => {
    execFile(process.execPath, [helper, 'create', name], { cwd: root }, (error, _stdout, stderr) => done({ name, error, stderr }));
  })));
  expect(results.some(result => !result.error)).toBe(true);
  for (const result of results) {
    if (result.error) {
      expect(result.stderr).toContain('operation already active');
      integrationWorktree(root, 'create', result.name);
    }
    expect(git(resolve(root, '.local/worktrees', result.name), 'branch', '--show-current')).toBe(`work/${result.name}`);
  }
  expect(existsSync(resolve(root, '.local/worktrees/.integration-lock'))).toBe(false);
});

it('resolves nested linked-checkout invocation to the same registry and primary HEAD', () => {
  const root = fixture();
  const first = integrationWorktree(root, 'create', 'first');
  commit(first);
  const nested = resolve(first, '.local/nested');
  mkdirSync(nested, { recursive: true });
  const second = integrationWorktree(nested, 'create', 'second');
  expect(second).toBe(resolve(root, '.local/worktrees/second'));
  expect(git(second, 'rev-parse', 'HEAD')).toBe(git(root, 'rev-parse', 'HEAD'));
  expect(() => integrationWorktree(nested, 'retire', 'first')).toThrow('unmerged');
  integrationWorktree(nested, 'retire', 'second');
  expect(existsSync(second)).toBe(false);
  expect(existsSync(resolve(first, '.local/worktrees'))).toBe(false);
});

it('refuses dirty and untracked retirement, then retires only integrated commits', () => {
  const root = fixture();
  const worker = integrationWorktree(root, 'create', 'slice');
  writeFileSync(resolve(worker, 'worker.txt'), 'valuable work');
  expect(() => integrationWorktree(root, 'retire', 'slice')).toThrow('dirty or untracked');
  git(worker, 'add', 'worker.txt');
  expect(() => integrationWorktree(root, 'retire', 'slice')).toThrow('dirty or untracked');
  commit(worker);
  expect(() => integrationWorktree(root, 'retire', 'slice')).toThrow('unmerged');
  git(root, 'merge', '--ff-only', 'work/slice');
  writeFileSync(resolve(worker, 'worker.txt'), 'more valuable work');
  expect(() => integrationWorktree(root, 'retire', 'slice')).toThrow('dirty or untracked');
  git(worker, 'restore', 'worker.txt');
  integrationWorktree(root, 'retire', 'slice');
  expect(existsSync(worker)).toBe(false);
  expect(git(root, 'show', 'HEAD:worker.txt')).toBe('valuable work');
});

it('accepts an explicit base and retirement integration ref', () => {
  const root = fixture();
  const first = integrationWorktree(root, 'create', 'first');
  commit(first);
  const second = integrationWorktree(root, 'create', 'second', 'work/first');
  expect(git(second, 'rev-parse', 'HEAD')).toBe(git(first, 'rev-parse', 'HEAD'));
  integrationWorktree(root, 'retire', 'second', 'work/first');
  expect(existsSync(second)).toBe(false);
});

it('preserves ignored evidence while permitting disposable dependency/build directories', () => {
  const root = fixture();
  writeFileSync(resolve(root, '.gitignore'), '.local/\nnode_modules/\ndist/\n.venv/\n');
  git(root, 'add', '.gitignore');
  git(root, 'commit', '-qm', 'cache directories');
  const worker = integrationWorktree(root, 'create', 'slice');
  mkdirSync(resolve(worker, '.local'));
  writeFileSync(resolve(worker, '.local/recovery.patch'), 'valuable patch');
  expect(() => integrationWorktree(root, 'retire', 'slice')).toThrow('Preserve ignored worker artifacts');
  expect(existsSync(resolve(worker, '.local/recovery.patch'))).toBe(true);
  // Simulate the coordinator having archived the evidence elsewhere.
  rmSync(resolve(worker, '.local'), { recursive: true });
  mkdirSync(resolve(worker, 'node_modules'));
  writeFileSync(resolve(worker, 'node_modules/cache'), 'reinstallable');
  integrationWorktree(root, 'retire', 'slice');
  expect(existsSync(worker)).toBe(false);
});

it('does not force removal of locked workers or changed branches', () => {
  const root = fixture();
  const worker = integrationWorktree(root, 'create', 'slice');
  git(root, 'worktree', 'lock', worker);
  expect(() => integrationWorktree(root, 'retire', 'slice')).toThrow();
  expect(existsSync(worker)).toBe(true);
  git(root, 'worktree', 'unlock', worker);
  git(worker, 'checkout', '--detach');
  expect(() => integrationWorktree(root, 'retire', 'slice')).toThrow('branch changed');
  expect(existsSync(worker)).toBe(true);
});

it('shares the atomic operation lock across workers and leaves another owner’s lock intact', () => {
  const root = fixture();
  const worker = integrationWorktree(root, 'create', 'slice');
  const lock = resolve(root, '.local/worktrees/.integration-lock');
  mkdirSync(lock);
  writeFileSync(resolve(lock, 'owner'), 'another operation');
  expect(() => integrationWorktree(worker, 'create', 'second')).toThrow('operation already active');
  expect(() => integrationWorktree(worker, 'retire', 'slice')).toThrow('operation already active');
  expect(existsSync(resolve(lock, 'owner'))).toBe(true);
  expect(git(root, 'branch', '--list', 'work/second')).toBe('');
  rmSync(lock, { recursive: true });
  expect(() => integrationWorktree(root, 'retire', 'missing')).toThrow('Unknown worker');
  expect(existsSync(lock)).toBe(false);
  integrationWorktree(root, 'create', 'second');
  expect(existsSync(lock)).toBe(false);
});

it('validates names, actions and base commits without creating workers', () => {
  const root = fixture();
  for (const name of ['', '../escape', 'nested/name', '-option', 'has space', 'a\nb']) {
    expect(() => integrationWorktree(root, 'create', name)).toThrow('simple work item name');
  }
  expect(() => integrationWorktree(root, 'discard', 'slice')).toThrow('create or retire');
  for (const base of ['', '--detach', 'HEAD\n', 'missing-ref', 'HEAD:.gitignore']) {
    expect(() => integrationWorktree(root, 'create', 'slice', base)).toThrow(/base commit or ref/);
    expect(existsSync(resolve(root, '.local/worktrees/.integration-lock'))).toBe(false);
    expect(git(root, 'branch', '--list', 'work/slice')).toBe('');
  }
  integrationWorktree(root, 'create', 'slice', 'refs/heads/main');
});
