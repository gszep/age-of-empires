/** Small deterministic protocol fixtures; no owned assets or production tuning. */
import { FALLBACK_RULES } from './data';
import { activateAutomaticTechnologies, applyCommand, createGame, stepGame } from './game';
import { updateVisibility } from './visibility';

export function gothicCeilingFixture(populationLimit?: number) {
  const rules = structuredClone(FALLBACK_RULES);
  const goths = structuredClone(FALLBACK_RULES);
  goths.civilization = { ...goths.civilization, key: 'goths' };
  goths.playerAttributes = { ...goths.playerAttributes, unitLimit: 0 };
  // Pinned DAT tech406 -> effect418: resource32 add10, requires Imperial103.
  // Minimal gate/effect fixture, not a substitute for the owned Gothic roster.
  goths.civilizationBonuses = { treeEffectId: -1, teamEffectId: -1, nodes: {
    '103': { key: 'imperial-age', automatic: false, age: 3,
      requiredTechs: [], requiredTechCount: 0, effects: [] },
    '406': { key: 'automatic-406', automatic: true,
      requiredTechs: [103], requiredTechCount: 1,
      effects: [{ resource: 'unitLimit', operation: 'add', amount: 10 }] },
  } };
  rules.civilizations = { goths };
  const state = createGame(281, rules, { 1: 'goths', 2: rules.civilization.key },
    'arabia', 'random-map', populationLimit);
  const imperial = () => { state.players[1].age = 3; activateAutomaticTechnologies(state); };
  return { state, imperial };
}

export function publicWonderFixture(enabled = true) {
  const rules = structuredClone(FALLBACK_RULES);
  Object.assign(rules.buildings.wonder, { buildable: true, buildSeconds: .1 });
  const state = createGame(110, rules, undefined, 'arabia', 'random-map', 150, enabled);
  const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
  state.entities = state.entities.filter(e => e.kind === 'town-center' || e.id === worker.id);
  state.terrain.fill(0); state.elevation.fill(0);
  state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!.position = { x: 10.5, y: 10.5 };
  state.entities.find(e => e.owner === 2 && e.kind === 'town-center')!.position = { x: 90.5, y: 90.5 };
  // Owner scouts the whole footprint normally; enemy has never explored it.
  worker.position = { x: 24, y: 20 };
  for (const p of [1, 2] as const) {
    state.visibility[p].explored.fill(0);
    state.visibility[p].visible.fill(0);
    state.visibility[p].memory = {};
  }
  updateVisibility(state);
  Object.assign(state.players[1], { age: 3, wood: 10000, gold: 10000, stone: 10000 });
  const result = applyCommand(state, { kind: 'build', player: 1, builderIds: [worker.id],
    building: 'wonder', target: { x: 26.5, y: 20.5 } });
  if (!result.ok) throw new Error(`Wonder fixture: ${result.reason}`);
  const wonder = state.entities.at(-1)!;
  const finish = () => {
    for (let i = 0; i < 500 && wonder.buildProgress !== undefined; i++) stepGame(state);
    if (wonder.buildProgress !== undefined) throw new Error('Wonder fixture did not complete');
  };
  return { state, wonder, finish };
}
