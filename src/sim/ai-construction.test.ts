import { expect, it } from 'vitest';
import { exampleAiCommands } from './ai';
import { addNode, applyCommand, createGame, stepGame } from './game';
import { observe } from './observe';

it('does not steal an active builder to place the next house', () => {
  const state = createGame(79);
  const workers = state.entities.filter(e => e.owner === 1 && e.kind === 'villager');
  const home = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
  for (const worker of workers) worker.order = { kind: 'build', targetId: home.id };
  state.players[1].wood = 25;
  const commands = exampleAiCommands(observe(state, 1));
  expect(commands.filter(c => c.kind === 'build')).toEqual([]);
});

it('builds a house using another existing location list when the house list is occupied', () => {
  const state = createGame(79);
  state.entities = state.entities.filter(e => e.owner !== 0);
  state.terrain.fill(0);
  const home = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
  for (const [x, y] of [[-1, -4], [2, -4], [-4, -2], [5, -4], [-4, 1],
    [8, -4], [-7, -2], [8, -1], [-7, 1], [5, 7]]) {
    addNode(state, 'tree', { x: home.position.x + x, y: home.position.y + y });
  }
  stepGame(state);
  state.players[1].wood = 25;
  // A scouted board: the AI must know all occupied candidate positions.
  state.visibility[1].visible.fill(1);
  const commands = exampleAiCommands(observe(state, 1));
  const build = commands.find(c => c.kind === 'build');
  expect(build).toBeDefined();
  expect(build?.kind === 'build' && build.building).toBe('house');
  expect(applyCommand(state, build!).ok).toBe(true);
});
