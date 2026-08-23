import { describe, expect, it } from 'vitest';
import { runMatch } from './runner';
import { builtinStrategy, subprocessStrategy } from './strategies';
import { parseStrategyLine } from '../protocol/validate';
import { validateMatchResult, explain } from '../protocol/validate';

describe('headless matches', () => {
  it('completes a builtin-vs-idle match with a winner and valid result', async () => {
    const result = await runMatch(
      { version: 1, seed: 7, maxTimeSeconds: 900 },
      { 1: { decide: () => [] }, 2: builtinStrategy() },
    );
    expect(result.winner).toBe(2);
    expect(validateMatchResult(result), explain(validateMatchResult)).toBe(true);
  });

  it('is deterministic for the same seed and strategies', async () => {
    const config = { version: 1 as const, seed: 21, maxTimeSeconds: 120 };
    const a = await runMatch(config, { 1: builtinStrategy(), 2: builtinStrategy() });
    const b = await runMatch(config, { 1: builtinStrategy(), 2: builtinStrategy() });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('records rejected commands with diagnostics instead of applying them', async () => {
    const result = await runMatch(
      { version: 1, seed: 3, maxTimeSeconds: 1 },
      {
        1: { decide: () => [{ kind: 'train', player: 1, buildingId: 99_999, unit: 'villager' }] },
        2: { decide: () => [] },
      },
    );
    expect(result.rejectedCommands.length).toBeGreaterThan(0);
    expect(result.rejectedCommands[0].reason).toContain('not owned');
  });

  it('runs the example AI as a JSONL subprocess to victory', async () => {
    const result = await runMatch(
      { version: 1, seed: 7, maxTimeSeconds: 900, decideIntervalSeconds: 5 },
      {
        1: { decide: () => [] },
        2: subprocessStrategy('npx tsx src/headless/builtin-strategy-cli.ts', 30_000),
      },
    );
    expect(result.winner).toBe(2);
  }, 120_000);

  it('fails clearly on malformed subprocess output', async () => {
    await expect(
      runMatch(
        { version: 1, seed: 1, maxTimeSeconds: 1 },
        { 1: subprocessStrategy('echo not-json'), 2: { decide: () => [] } },
      ),
    ).rejects.toThrow(/invalid JSON/);
    await expect(
      runMatch(
        { version: 1, seed: 1, maxTimeSeconds: 1 },
        { 1: subprocessStrategy('echo \'{"type":"commands"}\''), 2: { decide: () => [] } },
      ),
    ).rejects.toThrow(/strategy message/);
  }, 30_000);
});

describe('strategy line parsing', () => {
  it('accepts a valid commands message', () => {
    const message = parseStrategyLine(
      '{"type":"commands","time":0,"commands":[{"kind":"train","player":1,"buildingId":4,"unit":"villager"}]}',
    );
    expect(message.commands).toHaveLength(1);
  });

  it('rejects commands with unknown fields or kinds', () => {
    expect(() =>
      parseStrategyLine('{"type":"commands","time":0,"commands":[{"kind":"cheat","player":1}]}'),
    ).toThrow(/strategy message/);
  });
});
