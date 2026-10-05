/** Named durable workers share one registry and a short-lived operation lock. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function integrationWorktree(root, action, name, base = 'HEAD') {
  if (action !== 'create' && action !== 'retire') throw new Error('Use create or retire');
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/.test(name)) throw new Error('Use a simple work item name');
  if (typeof base !== 'string' || !base || base.startsWith('-') || /[\s\x00-\x1f\x7f]/.test(base)) throw new Error('Use a valid base commit or ref');
  const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  // Git lists the primary checkout first, even when called from a linked tree.
  // NUL records preserve paths containing spaces or newlines without Git quoting.
  const registry = () => git(['worktree', 'list', '--porcelain', '-z']).split('\0\0').map(record => record.split('\0'));
  const primary = registry()[0];
  if (primary.includes('bare')) throw new Error('A primary checkout is required');
  const canonical = realpathSync(primary[0].slice('worktree '.length));
  const parent = resolve(canonical, '.local/worktrees'), target = resolve(parent, name);
  mkdirSync(parent, { recursive: true });
  const lock = resolve(parent, '.integration-lock');
  try { mkdirSync(lock); } catch { throw new Error('Integration operation already active; inspect its owner before removing a stale lock'); }
  const owner = resolve(lock, 'owner.json');
  try {
    writeFileSync(owner, JSON.stringify({ pid: process.pid, action, name, started: new Date().toISOString() }) + '\n', { flag: 'wx' });
    let baseCommit;
    try { baseCommit = git(['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`], canonical); }
    catch { throw new Error(`Invalid base commit or ref: ${base}`); }
    const active = registry().find(record => record[0] === `worktree ${target}`);
    if (action === 'create') {
      if (active) throw new Error(`Worker already exists: ${name}`);
      git(['worktree', 'add', '-b', `work/${name}`, target, baseCommit], canonical);
    } else {
      if (!active) throw new Error(`Unknown worker: ${name}`);
      if (!active.includes(`branch refs/heads/work/${name}`)) throw new Error(`Worker branch changed: ${name}`);
      if (git(['status', '--porcelain', '--untracked-files=all'], target)) throw new Error(`Worker has dirty or untracked work: ${name}`);
      try { git(['merge-base', '--is-ancestor', git(['rev-parse', 'HEAD'], target), baseCommit], canonical); }
      catch { throw new Error(`Worker has unmerged commits relative to ${base}: ${name}`); }
      // Git silently deletes ignored files. Only ordinary reproducible dependency
      // and build directories are disposable; .local evidence/patches must move
      // to the primary checkout before retirement, as must any other ignored work.
      const disposable = new Set(['node_modules/', 'dist/', '.venv/']);
      const ignored = git(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'], target)
        .split('\0').filter(path => path && !disposable.has(path));
      if (ignored.length) throw new Error(`Preserve ignored worker artifacts before retirement: ${ignored.join(', ')}`);
      // Git also protects locked trees; never force removal.
      git(['worktree', 'remove', target], canonical);
    }
    return target;
  } finally { unlinkSync(owner); rmdirSync(lock); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, name, base] = process.argv.slice(2);
  console.log(integrationWorktree(process.cwd(), action, name ?? '', base));
}
