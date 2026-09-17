/**
 * Where each button sits in the command grid.
 *
 * The reference's grid is fifteen cells, five across and three down, and the
 * DAT states a cell for everything a building trains or researches
 * (`button_id`, 1-15 across then down). A line shares its cell -- the militia
 * and the champion are both the barracks' 1, Forging and Blast Furnace both
 * the blacksmith's 1, the three ages the town center's 11 -- which is what
 * keeps a button where the hand expects it when a technology lands and the
 * thing beside it disappears. A button with no stated cell takes the first
 * free one.
 *
 * The hotkey is the cell's own letter, the reference's grid layout: the top
 * row Q W E R T, the middle A S D F G, the bottom Z X C V B.
 */
export const GRID_CELLS = 15;
export const GRID_KEYS = ['q', 'w', 'e', 'r', 't', 'a', 's', 'd', 'f', 'g', 'z', 'x', 'c', 'v', 'b'] as const;

/** The letter for a cell, 1-15. */
export function gridKey(slot: number): string | undefined {
  return GRID_KEYS[slot - 1];
}

/**
 * Lay buttons out: a stated slot first, in the order given; whatever has none
 * or finds its cell taken goes to the next free cell. Returns fifteen cells,
 * empty ones `undefined`, and drops what does not fit.
 */
export function placeCommands<T extends { slot?: number }>(buttons: T[]): (T | undefined)[] {
  const cells: (T | undefined)[] = new Array(GRID_CELLS).fill(undefined);
  const spill: T[] = [];
  for (const button of buttons) {
    const at = button.slot !== undefined ? button.slot - 1 : -1;
    if (at >= 0 && at < GRID_CELLS && cells[at] === undefined) cells[at] = button;
    else spill.push(button);
  }
  for (const button of spill) {
    const free = cells.indexOf(undefined);
    if (free === -1) break;
    cells[free] = button;
  }
  return cells;
}
