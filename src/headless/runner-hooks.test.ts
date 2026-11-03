import { describe, expect, it } from 'vitest';
import { createGame } from '../sim/game';
import { checksumState } from '../sim/checksum';
import { FALLBACK_RULES } from '../sim/data';
import { builtinStrategy } from './strategies';
import { runMatch, type MatchHooks, type MatchStart } from './runner';
import type { Command, PlayerId } from '../sim/types';

describe('runMatch live hooks', () => {
  it('does not start another decision after abort and cleans up throwing init hooks', async () => {
    const controller = new AbortController();
    const players: number[] = [], stopped: number[] = [];
    const strategies = {
      1: { decide: () => { players.push(1); return []; }, stop: () => { stopped.push(1); } },
      2: { decide: () => { players.push(2); return []; }, stop: () => { stopped.push(2); } },
    };
    await runMatch({ version: 1, seed: 31, maxTimeSeconds: 1 }, strategies, FALLBACK_RULES, {
      signal: controller.signal,
      onDecision: event => { if (event.phase === 'end') controller.abort(); },
    });
    expect(players).toEqual([1]); expect(stopped.sort()).toEqual([1, 2]);
    stopped.length = 0;
    await expect(runMatch({ version: 1, seed: 31 }, strategies, FALLBACK_RULES, {
      onInit: () => { throw new Error('init failure'); },
    })).rejects.toThrow('init failure');
    expect(stopped.sort()).toEqual([1, 2]);
  });

  it('reports the initial state, every recorded command, ticks and decisions', async () => {
    const config = { version: 1 as const, seed: 31, maxTimeSeconds: 2 };
    const inits: MatchStart[] = [];
    const commands: { tick: number; command: Command }[] = [];
    const ticks: { tick: number; timeSeconds: number }[] = [];
    const decisions: { player: PlayerId; phase: string; tick: number; time: number }[] = [];
    const hooks: MatchHooks = {
      onInit: start => inits.push(start),
      onCommand: entry => commands.push(entry),
      onTick: progress => ticks.push(progress),
      onDecision: event => decisions.push({ player: event.player, phase: event.phase, tick: event.tick, time: event.time }),
    };
    const { record } = await runMatch(config, { 1: builtinStrategy(), 2: builtinStrategy() }, FALLBACK_RULES, hooks);

    expect(inits).toHaveLength(1);
    expect(inits[0].seed).toBe(31);
    const fresh = createGame(31);
    expect(inits[0].civilizations).toEqual({ 1: fresh.players[1].civilization, 2: fresh.players[2].civilization });
    expect(inits[0].map).toBe('arabia');
    expect(inits[0].decideIntervalSeconds).toBe(0.5);
    expect(inits[0].maxTimeSeconds).toBe(2);
    expect(inits[0].rulesOrigin).toBe('fallback');
    expect(inits[0].initialChecksum).toBe(checksumState(createGame(31)));

    // The command stream a spectator sees is exactly the recorded prefix.
    expect(commands).toEqual(record.commands);
    // Ticks are contiguous from the first step and time moves with them.
    expect(ticks.map(t => t.tick)).toEqual(ticks.map((_, index) => index + 1));
    for (let i = 1; i < ticks.length; i++) expect(ticks[i].timeSeconds).toBeGreaterThan(ticks[i - 1].timeSeconds);
    // Every decision that begins also ends, per player.
    for (const player of [1, 2] as PlayerId[]) {
      const events = decisions.filter(d => d.player === player);
      expect(events.filter(d => d.phase === 'begin')).toHaveLength(events.filter(d => d.phase === 'end').length);
      expect(events.length).toBeGreaterThan(0);
    }
  });

  it('supports synchronous decide() even with a live signal attached', async () => {
    const command: Command = { kind: 'stop', player: 1, entityIds: [1] };
    const hooks: MatchHooks = { signal: new AbortController().signal };
    const { record } = await runMatch(
      { version: 1, seed: 31, maxTimeSeconds: 1 },
      { 1: { decide: () => [command] }, 2: { decide: () => [] } },
      FALLBACK_RULES,
      hooks,
    );
    expect(record.commands.map(entry => entry.command)).toContainEqual(command);
  });

  it('aborts promptly while a decision never settles, keeping a valid partial record', async () => {
    const config = { version: 1 as const, seed: 31, maxTimeSeconds: 600 };
    const controller = new AbortController();
    const decisions: { player: PlayerId; phase: string; error?: string }[] = [];
    const stops: PlayerId[] = [];
    const never = new Promise<Command[]>(() => {});
    const hooks: MatchHooks = {
      signal: controller.signal,
      onDecision: event => decisions.push({ player: event.player, phase: event.phase, ...(event.error ? { error: event.error } : {}) }),
    };
    const strategies = {
      1: { decide: () => never, stop: () => { stops.push(1); } },
      2: { decide: () => never, stop: () => { stops.push(2); } },
    };
    const run = runMatch(config, strategies, FALLBACK_RULES, hooks);
    setTimeout(() => controller.abort(), 20);
    const { record } = await run;
    // The blocked decision is abandoned, not awaited forever.
    expect(record.commands).toEqual([]);
    expect(record.result.rejectedCommands).toEqual([]);
    // Player 1's decision began and failed on the abort; player 2 was never asked.
    expect(decisions).toEqual([{ player: 1, phase: 'begin' }, { player: 1, phase: 'fail', error: 'match aborted' }]);
    // The runner still stopped both strategies.
    expect(stops.sort()).toEqual([1, 2]);
  });

  it('aborts mid-run between decisions and returns a replayable prefix', async () => {
    const config = { version: 1 as const, seed: 31, maxTimeSeconds: 30 };
    const controller = new AbortController();
    const hooks: MatchHooks = {
      signal: controller.signal,
      onTick: progress => {
        if (progress.tick === 3) controller.abort();
      },
    };
    const { record, result } = await runMatch(config, { 1: builtinStrategy(), 2: builtinStrategy() }, FALLBACK_RULES, hooks);
    expect(result.timeSeconds).toBeLessThan(1);
    expect(record.commands.every(entry => entry.tick <= 3)).toBe(true);
  });

  it('behaves identically without hooks', async () => {
    const config = { version: 1 as const, seed: 21, maxTimeSeconds: 2 };
    const plain = await runMatch(config, { 1: builtinStrategy(), 2: builtinStrategy() });
    const withEmptyHooks = await runMatch(config, { 1: builtinStrategy(), 2: builtinStrategy() }, FALLBACK_RULES, {});
    expect(JSON.stringify(plain)).toBe(JSON.stringify(withEmptyHooks));
  });
});
