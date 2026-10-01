/** One durable integration worktree at a time. Research needs no writable tree. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function integrationWorktree(root, action, name, base = 'HEAD') {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Use a simple work item name');
  const parent = resolve(root, '.local/worktrees'), target = resolve(parent, name);
  mkdirSync(parent, { recursive: true });
  const lock = resolve(parent, '.integration-lock');
  try { mkdirSync(lock); } catch { throw new Error('Integration operation already active; inspect its owner before removing a stale lock'); }
  try {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const active = git(['worktree', 'list', '--porcelain']).split('\n').filter(line => line.startsWith(`worktree ${parent}/`));
  if (action === 'create') {
    if (active.length) throw new Error(`Integrate/retire the existing slice first: ${active.join(', ')}`);
    mkdirSync(parent, { recursive: true });
    git(['worktree', 'add', '-b', `work/${name}`, target, base]);
  } else if (action === 'retire') {
    // git's normal removal refuses dirty or untracked work; never --force.
    git(['merge-base', '--is-ancestor', `work/${name}`, 'HEAD']);
    git(['worktree', 'remove', target]);
  } else throw new Error('Use create or retire');
  return target;
  } finally { rmdirSync(lock); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, name, base] = process.argv.slice(2);
  console.log(integrationWorktree(process.cwd(), action, name ?? '', base));
}
