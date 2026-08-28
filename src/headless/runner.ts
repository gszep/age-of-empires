import { applyCommand, createGame, gameTimeSeconds, stepGame } from '../sim/game';
import { FALLBACK_RULES, TICK_SECONDS, type GameRules } from '../sim/data';
import { checksumState } from '../sim/checksum';
import { describeObservation, observe } from '../sim/observe';
import type { Command, PlayerId } from '../sim/types';
import type { MatchConfig, MatchRecord, MatchResult, RejectedCommand, StrategyInputMessage } from '../protocol/types';

export const CHECKSUM_INTERVAL_TICKS = 100;

export interface Strategy {
  /** Receive one observation message; return commands to apply now. */
  decide(input: StrategyInputMessage): Promise<Command[]> | Command[];
  stop?(): void | Promise<void>;
}

export async function runMatch(
  config: MatchConfig,
  strategies: Record<PlayerId, Strategy>,
  rules: GameRules = FALLBACK_RULES,
): Promise<{ result: MatchResult; record: MatchRecord }> {
  const maxTime = config.maxTimeSeconds ?? 1800;
  const decideInterval = config.decideIntervalSeconds ?? 0.5;
  const state = createGame(config.seed, rules, config.civilizations);
  const rejectedCommands: RejectedCommand[] = [];
  const pendingRejections: Record<PlayerId, RejectedCommand[]> = { 1: [], 2: [] };
  const recordedCommands: MatchRecord['commands'] = [];
  const checksums: MatchRecord['checksums'] = [];

  const stepsPerDecision = Math.max(1, Math.round(decideInterval / TICK_SECONDS));
  try {
    while (!state.winner && gameTimeSeconds(state) < maxTime - 1e-9) {
      if (state.tick % stepsPerDecision === 0) {
        for (const player of [1, 2] as PlayerId[]) {
          const observation = observe(state, player);
          const input: StrategyInputMessage = {
            type: 'observation',
            observation,
            text: describeObservation(observation),
            rejected: pendingRejections[player],
          };
          pendingRejections[player] = [];
          const commands = await strategies[player].decide(input);
          for (const command of commands) {
            if (command.player !== player) {
              pendingRejections[player].push({ time: gameTimeSeconds(state), player, reason: 'command for another player', command });
              continue;
            }
            recordedCommands.push({ tick: state.tick, command });
            const result = applyCommand(state, command);
            if (!result.ok) pendingRejections[player].push({ time: gameTimeSeconds(state), player, reason: result.reason, command });
          }
          rejectedCommands.push(...pendingRejections[player]);
        }
      }
      stepGame(state);
      if (state.tick % CHECKSUM_INTERVAL_TICKS === 0 || state.winner) {
        checksums.push({ tick: state.tick, hash: checksumState(state) });
      }
    }
  } finally {
    await Promise.all([strategies[1].stop?.(), strategies[2].stop?.()]);
  }

  const result: MatchResult = {
    version: 1,
    seed: config.seed,
    timeSeconds: Math.round(gameTimeSeconds(state) * 100) / 100,
    players: {
      1: summary(state, 1),
      2: summary(state, 2),
    },
    rejectedCommands,
  };
  if (state.winner) result.winner = state.winner;
  const record: MatchRecord = {
    version: 1,
    seed: config.seed,
    rulesOrigin: rules.origin,
    civilizations: { 1: state.players[1].civilization, 2: state.players[2].civilization },
    decideIntervalSeconds: decideInterval,
    maxTimeSeconds: maxTime,
    commands: recordedCommands,
    checksums,
    result,
  };
  return { result, record };
}

export interface ReplayOutcome {
  ok: boolean;
  mismatchTick?: number;
  expected?: string;
  actual?: string;
  checked: number;
}

/** Re-run a recorded command stream and verify the periodic checksums. */
export function replayRecord(
  record: MatchRecord,
  rules: GameRules = FALLBACK_RULES,
  onTick?: (state: ReturnType<typeof createGame>) => void,
): ReplayOutcome {
  const state = createGame(record.seed, rules, record.civilizations);
  const commands = [...record.commands];
  const checksums = new Map(record.checksums.map(entry => [entry.tick, entry.hash]));
  const lastTick = record.checksums.at(-1)?.tick ?? 0;
  let checked = 0;
  while (state.tick < lastTick) {
    while (commands.length && commands[0].tick === state.tick) {
      applyCommand(state, commands.shift()!.command);
    }
    stepGame(state);
    onTick?.(state);
    const expected = checksums.get(state.tick);
    if (expected !== undefined) {
      const actual = checksumState(state);
      checked++;
      if (actual !== expected) {
        return { ok: false, mismatchTick: state.tick, expected, actual, checked };
      }
    }
  }
  return { ok: true, checked };
}

function summary(state: ReturnType<typeof createGame>, player: PlayerId) {
  return {
    food: state.players[player].food,
    wood: state.players[player].wood,
    gold: state.players[player].gold,
    stone: state.players[player].stone,
    population: state.players[player].population,
    entities: state.entities.filter(e => e.owner === player).length,
  };
}
