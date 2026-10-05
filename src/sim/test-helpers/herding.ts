import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { exampleAiCommands } from '../ai';
import { applyCommand, createGame, stepGame } from '../game';
import { FALLBACK_RULES, rulesFromManifest, TICK_SECONDS, type GameRules } from '../data';
import { observe } from '../observe';

export function herdingComparison(seeds: number[]) {
  const modes: [string, GameRules][] = [['fallback', FALLBACK_RULES]];
  if (existsSync('public/imported/aoe2/manifest.json')) {
    modes.push(['owned', rulesFromManifest(JSON.parse(readFileSync('public/imported/aoe2/manifest.json', 'utf8')))]);
  }
  describe.each(modes)('%s four-minute herding comparison', (_mode, rules) => {
    it.each(seeds)('banks more food on seed %i than the otherwise identical no-herding strategy', seed => {
      const play = (herding: boolean) => {
        const state = createGame(seed, rules);
        let banked = 0, clock = 0;
        for (let tick = 0; tick < 240 / TICK_SECONDS; tick++) {
          const before = state.players[2].food;
          stepGame(state); banked += Math.max(0, state.players[2].food - before);
          clock += TICK_SECONDS;
          if (clock >= 0.5) {
            for (const command of exampleAiCommands(observe(state, 2), { herding })) applyCommand(state, command);
            clock = 0;
          }
        }
        return banked;
      };
      expect(play(true)).toBeGreaterThan(play(false));
    });
  });
}
