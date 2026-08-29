import { describe, expect, it } from 'vitest';
import { replayRecord, runMatch } from './runner';
import { builtinStrategy, mcpStrategy, subprocessStrategy, websocketStrategy } from './strategies';
import { WebSocketServer } from 'ws';
import { parseStrategyLine } from '../protocol/validate';
import { validateMatchRecord, validateMatchResult, explain } from '../protocol/validate';

describe('headless matches', () => {
  it('completes a builtin-vs-idle match with a winner and valid result', async () => {
    const { result } = await runMatch(
      { version: 1, seed: 7, maxTimeSeconds: 1800 },
      { 1: { decide: () => [] }, 2: builtinStrategy() },
    );
    expect(result.winner).toBe(2);
    expect(validateMatchResult(result), explain(validateMatchResult)).toBe(true);
    // The invariant is the 1800 sim-second cap above; the wall clock only has
    // to fit a ~27-sim-minute win simulated under the whole suite's load.
  }, 90_000);

  it('is deterministic for the same seed and strategies', async () => {
    const config = { version: 1 as const, seed: 21, maxTimeSeconds: 120 };
    const a = await runMatch(config, { 1: builtinStrategy(), 2: builtinStrategy() });
    const b = await runMatch(config, { 1: builtinStrategy(), 2: builtinStrategy() });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('records rejected commands with diagnostics instead of applying them', async () => {
    const { result } = await runMatch(
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
    // The clock is the fixture's, not the invariant's: the invariant is that
    // the AI beats an opponent who does nothing. It won at 1460s in the
    // Feudal Age until villagers stopped going idle when a pile ran out
    // (issue #19); with that economy it can now afford the Castle Age, buys
    // it, and razes the same town center at 1957s instead. That trade is the
    // subject of overnight.md's Q1 and is not this fixture's to resolve --
    // what it must keep catching is an AI that cannot finish at all.
    const { result } = await runMatch(
      { version: 1, seed: 7, maxTimeSeconds: 2400, decideIntervalSeconds: 5 },
      {
        1: { decide: () => [] },
        2: subprocessStrategy('npx tsx src/headless/builtin-strategy-cli.ts', 30_000),
      },
    );
    expect(result.winner).toBe(2);
  }, 120_000);

  it('replays a command stream with matching checksums and detects tampering', async () => {
    const { record } = await runMatch(
      { version: 1, seed: 12, maxTimeSeconds: 6 },
      { 1: builtinStrategy(), 2: builtinStrategy() },
    );
    expect(record.checksums.length).toBeGreaterThan(0);
    expect(validateMatchRecord(record), explain(validateMatchRecord)).toBe(true);
    expect(replayRecord(record)).toEqual({ ok: true, checked: record.checksums.length });
    const tampered = structuredClone(record);
    tampered.checksums[0].hash = '00000000';
    expect(replayRecord(tampered)).toMatchObject({ ok: false, mismatchTick: tampered.checksums[0].tick });
  });

  it('proceeds without late commands in deadline mode', async () => {
    const { record } = await runMatch(
      { version: 1, seed: 2, maxTimeSeconds: 0.2 },
      {
        1: subprocessStrategy('npx tsx src/headless/delayed-strategy-fixture.ts', { mode: 'deadline', deadlineMs: 5 }),
        2: { decide: () => [] },
      },
    );
    expect(record.commands).toEqual([]);
  });

  it('uses a WebSocket strategy with the public messages', async () => {
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>(resolve => server.once('listening', resolve));
    server.on('connection', socket => socket.on('message', raw => {
      const input = JSON.parse(String(raw));
      socket.send(JSON.stringify({ type: 'commands', time: input.observation.time, commands: [] }));
    }));
    const address = server.address();
    if (typeof address === 'string' || address === null) throw new Error('WebSocket fixture did not bind');
    try {
      const { record } = await runMatch(
        { version: 1, seed: 4, maxTimeSeconds: 0.05 },
        { 1: websocketStrategy(`ws://127.0.0.1:${address.port}`), 2: { decide: () => [] } },
      );
      expect(record.commands).toEqual([]);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('uses an MCP tool as a strategy through the SDK transport', async () => {
    const { record } = await runMatch(
      { version: 1, seed: 4, maxTimeSeconds: 0.05 },
      {
        1: mcpStrategy({ command: 'npx', args: ['tsx', 'src/headless/mcp-fixture-server.ts'], timeoutMs: 30_000 }),
        2: { decide: () => [] },
      },
    );
    expect(record.commands).toEqual([]);
  }, 45_000);

  it('reports a strategy that exits instead of crashing on its closed input', async () => {
    // Writing to a dead subprocess raises EPIPE asynchronously; unhandled, it
    // ends the process rather than the match.
    await expect(
      runMatch(
        { version: 1, seed: 1, maxTimeSeconds: 1 },
        { 1: subprocessStrategy('exit 0'), 2: { decide: () => [] } },
      ),
    ).rejects.toThrow(/subprocess/);
  }, 30_000);

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
