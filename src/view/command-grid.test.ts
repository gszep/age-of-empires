import { describe, expect, it } from 'vitest';
import { gridKey, placeCommands } from './command-grid';

describe('the command grid', () => {
  it('keeps a button at its stated cell whatever else is on the panel', () => {
    const before = placeCommands([{ id: 'militia', slot: 1 }, { id: 'spearman', slot: 2 }, { id: 'man-at-arms', slot: 6 }]);
    const after = placeCommands([{ id: 'man-at-arms-unit', slot: 1 }, { id: 'spearman', slot: 2 }, { id: 'long-swordsman', slot: 6 }]);
    expect(before.map(b => b?.id)).toEqual(['militia', 'spearman', undefined, undefined, undefined, 'man-at-arms', ...Array(9).fill(undefined)]);
    expect(after.map(b => b?.id)[1]).toBe('spearman');
    expect(after.map(b => b?.id)[5]).toBe('long-swordsman');
  });

  it('gives an unslotted button the first free cell, after the slotted ones are down', () => {
    const cells = placeCommands([{ id: 'reseed' }, { id: 'horse-collar', slot: 1 }, { id: 'stop', slot: 10 }]);
    expect(cells[0]?.id).toBe('horse-collar');
    expect(cells[1]?.id).toBe('reseed');
    expect(cells[9]?.id).toBe('stop');
  });

  it('spills a button whose cell is taken rather than dropping it', () => {
    const cells = placeCommands([{ id: 'villager', slot: 1 }, { id: 'militia', slot: 1 }]);
    expect(cells[0]?.id).toBe('villager');
    expect(cells[1]?.id).toBe('militia');
  });

  it('names the cells by the grid layout letters', () => {
    expect(gridKey(1)).toBe('q');
    expect(gridKey(6)).toBe('a');
    expect(gridKey(11)).toBe('z');
    expect(gridKey(15)).toBe('b');
    expect(gridKey(16)).toBeUndefined();
  });
});
