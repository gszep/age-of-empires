import { it, expect } from 'vitest';
import { checkClaims } from './check-current-docs.mjs';

it('detects stale open/closed declarations and absent tracker records', () => {
  const claims = [{ issue: 179, state: 'OPEN', claim: 'roster pending' }, { issue: 55, state: 'CLOSED', claim: 'plants drawn' }];
  expect(checkClaims(claims, [{ number: 179, state: 'CLOSED' }, { number: 55, state: 'CLOSED' }])).toEqual([
    '#179: declared OPEN, tracker CLOSED: roster pending',
  ]);
  expect(checkClaims(claims, [])).toHaveLength(2);
});
