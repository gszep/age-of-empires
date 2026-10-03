import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkClaims, checkDocuments, currentDocuments, renderClaims } from './check-current-docs.mjs';

const claims = JSON.parse(readFileSync(new URL('../docs/current-claims.json', import.meta.url), 'utf8'));
const documents = Object.fromEntries(currentDocuments.map(path => [path, readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')]));

it('detects stale open/closed declarations and absent tracker records', () => {
  const claims = [{ issue: 179, state: 'OPEN', claim: 'roster pending' }, { issue: 55, state: 'CLOSED', claim: 'plants drawn' }];
  expect(checkClaims(claims, [{ number: 179, state: 'CLOSED' }, { number: 55, state: 'CLOSED' }])).toEqual([
    '#179: declared OPEN, tracker CLOSED: roster pending',
  ]);
  expect(checkClaims(claims, [])).toHaveLength(2);
});

it('keeps the actual current documents consistent with the completion registry', () => {
  expect(checkDocuments(claims, documents)).toEqual([]);
});

it.each([
  '#179/#180 remain open.',
  'Warwolf/fortification/specialist/relic work is pending.',
  'Warwolf is pending.',
  'Ground scatter #55 is not\nyet drawn.',
  'Terrain plants are not drawn.',
  'Next: Franks.',
  'Franks are next.',
])('rejects the stale #264 claim in every current-scope document: %s', prose => {
  for (const path of currentDocuments) {
    const errors = checkDocuments(claims, { ...documents, [path]: `${documents[path]}\n\n${prose}` });
    expect(errors.some(error => error.startsWith(`${path}:`))).toBe(true);
  }
});

it('rejects missing, edited and duplicated status declarations', () => {
  const block = renderClaims(claims);
  for (const replacement of ['', block.replace('(CLOSED)', '(OPEN)'), `${block}\n${block}`]) {
    expect(checkDocuments(claims, {
      ...documents, 'docs/status.md': documents['docs/status.md'].replace(block, replacement),
    })).toHaveLength(1);
  }
  expect(checkDocuments(claims, { ...documents, 'docs/handoff.md': undefined })).toEqual([
    'docs/handoff.md: current-scope document missing',
  ]);
});

it('excludes historical evidence and allows explicitly remaining native calibration', () => {
  expect(checkDocuments(claims, {
    ...documents,
    'docs/reviews/old.md': '#179/#180 remain open. Ground scatter #55 is not drawn. Next: Franks.',
    'docs/ledger.md': 'Historical checkpoint: Warwolf is pending.',
    'docs/handoff.md': 'Relic placement calibration remains pending under #130. Native Warwolf timing is not verified. Scoped #179/#180 completion does not establish native parity.',
  })).toEqual([]);
});
