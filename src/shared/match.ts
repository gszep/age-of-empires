import { applyCommand, createGame, stepGame } from '../sim/game';
import { exampleAiCommands } from '../sim/ai';
import { observe } from '../sim/observe';
import { synchronizationHash } from './checksum';
import type { Command, GameState, PlayerId } from '../sim/types';
import type { HostMessage, MatchSettings } from './protocol';
import type { MatchSetup } from '../match-setup';

/** One trusted household match. Only this instance orders commands and ticks. */
export class SharedMatch {
  settings: MatchSettings = { paused: false, speed: 1, generation: 0 };
  humanTwo = false;
  private pending: { player: PlayerId; command: Command; reject: (reason: string) => void }[] = [];
  constructor(public state: GameState, public setup?: MatchSetup) {}

  enqueue(player: PlayerId, command: Command, reject: (reason: string) => void): void {
    if (command.player !== player) { reject('This order belongs to the other player'); return; }
    this.pending.push({ player, command, reject });
  }

  snapshot(): HostMessage {
    return { type: 'snapshot', state: this.state, settings: this.settings, setup: this.setup };
  }

  advance(): HostMessage {
    const commands: Command[] = [];
    for (const entry of this.pending.splice(0)) {
      const result = applyCommand(this.state, entry.command);
      if (result.ok) commands.push(entry.command);
      else entry.reject(result.reason ?? 'Order refused');
    }
    if (!this.humanTwo && this.state.tick % 10 === 0) {
      for (const command of exampleAiCommands(observe(this.state, 2))) {
        if (applyCommand(this.state, command).ok) commands.push(command);
      }
    }
    stepGame(this.state);
    return {
      type: 'tick', tick: this.state.tick, commands, settings: this.settings,
      hash: this.state.tick % 100 === 0 ? synchronizationHash(this.state) : undefined,
    };
  }

  restart(seed: number, map: string, civilizations = { 1: this.state.players[1].civilization, 2: this.state.players[2].civilization }): void {
    this.state = createGame(seed, this.state.rules, civilizations, map);
    this.setup = { map, seed, civilizations };
    this.pending = [];
    this.settings = { ...this.settings, paused: false, generation: this.settings.generation + 1 };
  }
}
