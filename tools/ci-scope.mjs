import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { currentDocuments } from './check-current-docs.mjs';

// Deliberately an allow-list, not "all Markdown": agent instructions, hidden
// configuration, source-adjacent files and unknown locations require full CI.
export function ordinaryDocumentation(path) {
  // These Markdown documents are executable test inputs, not a docs-only change.
  if (currentDocuments.includes(path)) return false;
  if (typeof path !== 'string' || !/^[A-Za-z0-9_/-]+(?:\.[A-Za-z0-9_-]+)*\.md$/.test(path)) return false;
  const parts = path.split('/');
  if (parts.some(part => !part || part.startsWith('.'))) return false;
  if (['AGENTS.md', 'CLAUDE.md', 'SKILL.md'].includes(parts.at(-1))) return false;
  return ['README.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md'].includes(path)
    || (parts[0] === 'docs' && parts.length > 1);
}

// git diff --raw --no-abbrev --no-renames -z: header NUL path NUL.
// Only regular non-executable Markdown files qualify; symlinks, mode changes,
// malformed/truncated output and empty diffs all fall back to full checks.
export function classifyDiff(raw) {
  if (typeof raw !== 'string' || !raw.endsWith('\0')) return 'full';
  const records = raw.slice(0, -1).split('\0');
  if (records.length % 2 !== 0) return 'full';
  for (let i = 0; i < records.length; i += 2) {
    const header = /^:(\d{6}) (\d{6}) ([a-f0-9]{40}) ([a-f0-9]{40}) ([AMD])$/.exec(records[i]);
    if (!header || !ordinaryDocumentation(records[i + 1])) return 'full';
    const [, before, after, oldHash, newHash, status] = header;
    const zero = '0'.repeat(40);
    if (status === 'A' && !(before === '000000' && after === '100644' && oldHash === zero && newHash !== zero)) return 'full';
    if (status === 'D' && !(before === '100644' && after === '000000' && oldHash !== zero && newHash === zero)) return 'full';
    if (status === 'M' && !(before === '100644' && after === '100644' && oldHash !== zero && newHash !== zero)) return 'full';
  }
  return 'docs';
}

export function selectScope({ event, base, head, cwd = process.cwd() }) {
  if (event !== 'pull_request' || ![base, head].every(sha => typeof sha === 'string' && /^[a-f0-9]{40}$/.test(sha) && !/^0+$/.test(sha))) return 'full';
  try {
    return classifyDiff(execFileSync('git', [
      'diff', '--raw', '--no-abbrev', '--no-renames', '--no-ext-diff', '-z', `${base}...${head}`, '--',
    ], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 }));
  } catch {
    // Missing history, invalid revisions, output limits or Git errors are not
    // evidence that a change is documentation-only.
    return 'full';
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const scope = selectScope({ event: process.env.GITHUB_EVENT_NAME, base: process.env.CI_SCOPE_BASE, head: process.env.CI_SCOPE_HEAD });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `scope=${scope}\n`);
  console.log(`Public CI scope: ${scope}`);
}
