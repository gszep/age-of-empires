import { describe, expect, it } from 'vitest';
import { runMatch } from './runner';
import { builtinStrategy } from './strategies';
import { validateMatchResult, explain } from '../protocol/validate';

describe('headless matches', () => {
  it('completes a builtin-vs-idle match with a winner and valid result', async () => {
    // The clock is the fixture's, not the invariant's: the invariant is that
    // the AI beats an opponent who does nothing. It killed at ~24 minutes
    // until the Q1 rebalance taught it to hold its army home, tech at the
    // blacksmith and boom first -- the kill now lands around thirty.
    const { result } = await runMatch(
      { version: 1, seed: 7, maxTimeSeconds: 2400 },
      { 1: { decide: () => [] }, 2: builtinStrategy() },
    );
    expect(result.winner).toBe(2);
    expect(validateMatchResult(result), explain(validateMatchResult)).toBe(true);
    // The invariant is the 2400 sim-second cap above; the wall clock only has
    // to fit a ~27-sim-minute win simulated under the whole suite's load. It
    // ran 57-61 s alone and 93-98 s under the suite on a busy WSL2 box on
    // 2026-09-18, on main and on a branch alike, so 90 s was a coin toss.
  }, 150_000);
});
