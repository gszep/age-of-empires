import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function checkClaims(claims, issues) {
  return claims.flatMap(claim => {
    const issue = issues.find(issue => issue.number === claim.issue);
    return issue?.state === claim.state ? [] : [`#${claim.issue}: declared ${claim.state}, tracker ${issue?.state ?? 'missing'}: ${claim.claim}`];
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const claims = JSON.parse(readFileSync(resolve(root, 'docs/current-claims.json'), 'utf8'));
  const issues = JSON.parse(execFileSync('gh', ['issue', 'list', '--state', 'all', '--limit', '500', '--json', 'number,state'], { cwd: root, encoding: 'utf8', timeout: 30_000 }));
  const errors = checkClaims(claims, issues);
  console.log(`Current-scope declarations checked: ${claims.length}; source: docs/current-claims.json (historical prose excluded).`);
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
}
