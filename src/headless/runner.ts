import { applyCommand, createGame, gameTimeSeconds, stepGame } from '../sim/game';
import { FALLBACK_RULES, TICK_SECONDS, type GameRules } from '../sim/data';
import { describeObservation, observe } from '../sim/observe';
import type { Command, PlayerId } from '../sim/types';
import type { MatchConfig, MatchResult, RejectedCommand, StrategyInputMessage } from '../protocol/types';

export interface Strategy {
  /** Receive one observation message; return commands to apply now. */
  decide(input: StrategyInputMessage): Promise<Command[]> | Command[];
  stop?(): void | Promise<void>;
}

export async function runMatch(
  config: MatchConfig,
  strategies: Record<PlayerId, Strategy>,
  rules: GameRules = FALLBACK_RULES,
): Promise<MatchResult> {
  const maxTime = config.maxTimeSeconds ?? 1800;
  const decideInterval = config.decideIntervalSeconds ?? 0.5;
  const state = createGame(config.seed, rules);
  const rejectedCommands: RejectedCommand[] = [];
  const pendingRejections: Record<PlayerId, RejectedCommand[]> = { 1: [], 2: [] };

  const stepsPerDecision = Math.max(1, Math.round(decideInterval / TICK_SECONDS));
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
          const result = applyCommand(state, command);
          if (!result.ok) pendingRejections[player].push({ time: gameTimeSeconds(state), player, reason: result.reason, command });
        }
        rejectedCommands.push(...pendingRejections[player]);
      }
    }
    stepGame(state);
  }

  await Promise.all([strategies[1].stop?.(), strategies[2].stop?.()]);

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
  return result;
}

function summary(state: ReturnType<typeof createGame>, player: PlayerId) {
  return {
    food: state.players[player].food,
    wood: state.players[player].wood,
    gold: state.players[player].gold,
    population: state.players[player].population,
    entities: state.entities.filter(e => e.owner === player).length,
  };
}
