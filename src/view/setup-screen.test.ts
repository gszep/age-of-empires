import { describe, expect, it } from 'vitest';
import { setupBottomBar } from './setup-screen';

describe('setup bottom bar (#349)', () => {
  it('keeps the native order Technology Tree | Reset | Randomize | Start Game', () => {
    expect(setupBottomBar().map(entry => [entry.id, entry.label])).toEqual([
      ['techtree', 'Technology Tree'], ['reset', 'Reset'],
      ['randomize', 'Randomize'], ['start', 'Start Game'],
    ]);
  });

  it('cites the native locale ids', () => {
    expect(setupBottomBar().map(entry => entry.locale)).toEqual([9799, 4012, 13577, 9710]);
  });

  it('greys the unsupported actions in place with stated reasons', () => {
    const unsupported = setupBottomBar().filter(entry => entry.reason);
    expect(unsupported.map(entry => entry.id)).toEqual(['techtree', 'reset', 'randomize']);
    for (const entry of unsupported) expect(entry.reason!.length, entry.id).toBeGreaterThan(0);
    expect(setupBottomBar().find(entry => entry.id === 'start')!.reason).toBeUndefined();
  });
});
