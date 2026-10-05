/** Repeatable tracked-text footprint; ignored game assets/builds are not source. */
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function footprint(root) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trimEnd();
  const files = git(['ls-files', '-z']).split('\0').filter(Boolean);
  const totals = { files: 0, lines: 0, bytes: 0, binary: 0, symlinks: 0, missing: 0 };
  for (const file of files) {
    const path = resolve(root, file);
    let stat;
    try { stat = lstatSync(path); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      totals.missing++;
      continue;
    }
    if (stat.isSymbolicLink()) { totals.symlinks++; continue; }
    const bytes = readFileSync(path);
    if (bytes.includes(0)) { totals.binary++; continue; }
    totals.files++;
    totals.bytes += bytes.length;
    // wc -l semantics, including files without a final newline.
    for (const byte of bytes) if (byte === 10) totals.lines++;
  }
  return {
    head: git(['rev-parse', 'HEAD']),
    scope: 'Working-copy tracked text; excludes binary files and symlinks. Stage new files before measuring.',
    ...totals,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(footprint(process.cwd()), null, 2));
}
