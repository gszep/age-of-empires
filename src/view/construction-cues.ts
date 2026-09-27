import type { PlayerId, ReadonlyGameState } from '../sim/types';

/** Read-only completion detection, including off-screen owned foundations.
 * Starting/reconnecting establishes a baseline; existing buildings stay quiet.
 */
export class ConstructionCues {
  private foundations = new Set<number>();

  poll(state: ReadonlyGameState, player: PlayerId): number[] {
    const completed: number[] = [];
    const foundations = new Set<number>();
    for (const entity of state.entities) {
      if (entity.owner !== player || entity.dead) continue;
      if (entity.buildProgress !== undefined) foundations.add(entity.id);
      else if (this.foundations.has(entity.id)) completed.push(entity.id);
    }
    this.foundations = foundations;
    return completed;
  }
}
