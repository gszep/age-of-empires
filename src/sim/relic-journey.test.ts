import { expect, it } from 'vitest';
import { applyCommand, stepGame } from './game';
import { checksumState } from './checksum';
import { relicJourneyFixture, runRelicJourney } from '../../tools/relic_journey';
import type { GameState } from './types';

it('collects a home relic and transports Islands’ fifth relic to a monastery through public commands, with JSON replay parity', async () => {
  const fixture = relicJourneyFixture(), state = fixture.state;
  const restored = JSON.parse(JSON.stringify(state)) as GameState;
  await runRelicJourney(fixture, {
    snapshot: async () => state,
    command: async command => {
      expect(applyCommand(state, command)).toEqual({ ok: true });
      expect(applyCommand(restored, command)).toEqual({ ok: true });
    },
    step: async ticks => {
      for (let i = 0; i < ticks; i++) { stepGame(state); stepGame(restored); }
      expect(checksumState(state)).toBe(checksumState(restored));
    },
  });
});
