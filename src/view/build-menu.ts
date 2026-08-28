/**
 * The villager's build menu, laid out the way the DAT states it.
 *
 * AoE2 puts two build buttons on a villager -- economic buildings and military
 * buildings -- and each opens a page of the command grid. The DAT gives every
 * building the villager can put up a **build button id**, which is its slot in
 * that grid, and although it never says which page a building belongs to it
 * says the page's *shape*: two buildings may share a slot only when they are
 * on different pages. Every collision in the Britons' list is one economic
 * building against one military one:
 *
 * | slot | economic | military |
 * | --- | --- | --- |
 * | 1 | house | barracks |
 * | 2 | mill | archery range |
 * | 3 | mining camp | stable |
 * | 4 | lumber camp | siege workshop |
 * | 6 | farm | outpost |
 * | 7 | blacksmith | palisade wall |
 * | 8 | market | — |
 * | 9 | monastery | watch tower |
 * | 10 | university | — |
 * | 12 | wonder | — |
 * | 13 | — | castle |
 *
 * That is the reference for the layout, and it is also a check: the split that
 * was here before put the blacksmith and the monastery on the military page,
 * where they collided with the palisade wall and the watch tower. A test
 * asserts no page collides with itself, so the next building added cannot
 * quietly land in the wrong half (issue #25).
 */
import type { GameRules } from '../sim/data';
import type { BuildingKind } from '../sim/types';

export type BuildPage = 'economic' | 'military';

/**
 * The military half. Membership is the DAT's own pairing wherever a slot
 * collides, and the reference game's grouping for the four that do not:
 * the market, the university and the wonder are economic, the castle is not.
 */
export const MILITARY_BUILDINGS: ReadonlySet<string> = new Set<string>([
  'barracks', 'archery-range', 'stable', 'siege-workshop',
  'outpost', 'watch-tower', 'castle',
  // Walls and their gates are placed by dragging rather than from a slot --
  // the DAT gives the gate no build button at all -- but they belong with the
  // defences, which is where AoE2 puts them.
  'palisade-wall', 'palisade-gate',
]);

export const pageOf = (kind: string): BuildPage =>
  MILITARY_BUILDINGS.has(kind) ? 'military' : 'economic';

/**
 * The buildings on one page, in the DAT's own order. Anything the DAT gives no
 * build button -- a gate, which is dragged rather than picked -- sorts after
 * what does, by name, so the slots that are stated stay where they are stated.
 */
export function buildMenu(rules: GameRules, age: number, page: BuildPage): BuildingKind[] {
  return (Object.keys(rules.buildings) as BuildingKind[])
    .filter(kind => rules.buildings[kind].buildable
      && (rules.buildings[kind].age ?? 0) <= age
      && pageOf(kind) === page)
    .sort((a, b) => {
      const left = rules.buildings[a].buildButton ?? Infinity;
      const right = rules.buildings[b].buildButton ?? Infinity;
      return left - right || a.localeCompare(b);
    });
}
