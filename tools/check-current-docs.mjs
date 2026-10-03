import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const currentDocuments = ['docs/status.md', 'docs/handoff.md', 'docs/backlog.md', 'docs/overnight.md'];
const start = '<!-- current-claims:start -->';
const end = '<!-- current-claims:end -->';

export function renderClaims(claims) {
  return [start, ...claims.map(claim => `- #${claim.issue} (${claim.state}): ${claim.claim}.`), end].join('\n');
}

// Bounded regression guards for #264, not a natural-language documentation audit.
// Historical evidence belongs outside the four current-scope documents above.
const staleClaims = [
  ['completed civilisation called open', /#(?:179|180)\b[^.!?\n]{0,100}\b(?:remain(?:s)?|still|are|is)\s+open\b/i],
  ['delivered work called pending', /\b(?:Warwolf|fortifications?|specialists?|relics?)(?:[\s,/]+(?:and\s+)?(?:Warwolf|fortifications?|specialists?|relics?))*\s+(?:work\s+)?(?:(?:is|are|remains?)\s+)?(?:pending|not implemented|not delivered)\b/i],
  ['terrain plants called undrawn', /\b(?:ground scatter|terrain plants|scatter\s*#55)\b[^.!?\n]{0,80}\b(?:not|isn't|aren't)\s+(?:yet\s+)?drawn\b/i],
  ['Franks selected as next', /\b(?:next(?:\s+civilisation)?\s*(?:is|:|are)?\s*(?:the\s+)?Franks|Franks\s+(?:is|are)\s+next)\b/i],
];

export function checkDocuments(claims, documents) {
  const errors = [];
  const status = documents['docs/status.md'] ?? '';
  if (status.split(start).length !== 2 || status.split(end).length !== 2 || !status.includes(renderClaims(claims))) {
    errors.push('docs/status.md: current-claims block missing, duplicated or different from docs/current-claims.json');
  }
  for (const path of currentDocuments) {
    if (typeof documents[path] !== 'string') {
      errors.push(`${path}: current-scope document missing`);
      continue;
    }
    // Join wrapped prose, retaining paragraph boundaries to avoid unrelated matches.
    for (const paragraph of documents[path].split(/\n\s*\n/)) {
      const prose = paragraph.replace(/\s+/g, ' ');
      for (const [name, pattern] of staleClaims) {
        if (pattern.test(prose)) errors.push(`${path}: ${name}: ${prose}`);
      }
    }
  }
  return errors;
}

export function checkClaims(claims, issues) {
  return claims.flatMap(claim => {
    const issue = issues.find(issue => issue.number === claim.issue);
    return issue?.state === claim.state ? [] : [`#${claim.issue}: declared ${claim.state}, tracker ${issue?.state ?? 'missing'}: ${claim.claim}`];
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const claims = JSON.parse(readFileSync(resolve(root, 'docs/current-claims.json'), 'utf8'));
  // Query declared issues directly: a growing tracker must not evict old completions.
  const issues = claims.map(claim => JSON.parse(execFileSync('gh', ['issue', 'view', String(claim.issue), '--json', 'number,state'], { cwd: root, encoding: 'utf8', timeout: 30_000 })));
  const documents = Object.fromEntries(currentDocuments.map(path => [path, readFileSync(resolve(root, path), 'utf8')]));
  const errors = [...checkClaims(claims, issues), ...checkDocuments(claims, documents)];
  console.log(`Current-scope declarations checked: ${claims.length}; source: docs/current-claims.json; mirrored block: docs/status.md.`);
  console.log(`Targeted #264 wording guards: ${currentDocuments.join(', ')}. Historical reviews, ledger and other prose are excluded; this is not a full documentation audit.`);
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
}
