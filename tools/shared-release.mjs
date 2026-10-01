/** Freeze application code and manifest metadata before switching the household host. */
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function createRelease(root, destination) {
  if (existsSync(destination)) throw new Error('Release destination already exists; releases are never overwritten');
  mkdirSync(resolve(destination, '.local'), { recursive: true });
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter(path => /^(src\/|tools\/|schemas\/|index\.html$|package(?:-lock)?\.json$|vite\.config\.ts$|tsconfig\.json$)/.test(path));
  const hashes = {};
  for (const path of files.sort()) {
    if (!existsSync(resolve(root, path))) continue;
    const bytes = readFileSync(resolve(root, path));
    hashes[path] = createHash('sha256').update(bytes).digest('hex');
    const target = resolve(destination, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    chmodSync(target, statSync(resolve(root, path)).mode & 0o777);
  }
  // Metadata is part of this release. Bulk artwork remains local and shared;
  // source-changing imports must be deployed/accepted separately, not during play.
  function assets(source, target) {
    mkdirSync(target, { recursive: true });
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      const from = resolve(source, entry.name), to = resolve(target, entry.name);
      if (entry.isDirectory()) assets(from, to);
      else if (entry.name.endsWith('.json')) {
        copyFileSync(from, to);
        hashes[to.slice(destination.length + 1)] = createHash('sha256').update(readFileSync(to)).digest('hex');
      } else symlinkSync(from, to);
    }
  }
  if (existsSync(resolve(root, 'public'))) assets(resolve(root, 'public'), resolve(destination, 'public'));
  symlinkSync(resolve(root, 'node_modules'), resolve(destination, 'node_modules'), 'dir');
  const release = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    created: new Date().toISOString(), files: hashes,
    fingerprint: createHash('sha256').update(JSON.stringify(hashes)).digest('hex'),
    dependencies: resolve(root, 'package-lock.json'), artwork: 'shared-local-files' };
  writeFileSync(resolve(destination, 'release.json'), JSON.stringify(release, null, 2) + '\n');
  return release;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const destination = resolve(root, '.local/releases', process.argv[2] ?? new Date().toISOString().replaceAll(':', '-'));
  if (!destination.startsWith(resolve(root, '.local/releases') + '/')) throw new Error('Release must be under .local/releases');
  const { fingerprint, revision } = createRelease(root, destination);
  console.log(JSON.stringify({ destination, fingerprint, revision }, null, 2));
}
