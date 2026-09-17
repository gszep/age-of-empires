import { describe, expect, it } from 'vitest';
import type { Cost } from '../sim/data';

const cost = (food = 0, wood = 0, gold = 0, stone = 0): Cost => ({ food, wood, gold, stone });
import { displayName, plainHelp } from './names';

describe('what the reference calls things', () => {
  it('uses the imported string over the slug, and drops the editor qualifier', () => {
    expect(displayName('man-at-arms', 'Man-at-Arms')).toBe('Man-at-Arms');
    expect(displayName('villager-goldminer', 'Gold Miner')).toBe('Gold Miner');
    expect(displayName('villager', 'Villager (Male)')).toBe('Villager');
    expect(displayName('trade-cart', 'Trade Cart (Empty)')).toBe('Trade Cart');
    expect(displayName('palisade-gate-y', 'Palisade Gate (down.)')).toBe('Palisade Gate');
    // A parenthetical that is the name stays: only a trailing one goes.
    expect(displayName('x', 'Tree (Oak)')).toBe('Tree');
  });

  it('spells the slug out when nothing was imported', () => {
    expect(displayName('man-at-arms')).toBe('Man At Arms');
    expect(displayName('town-center', undefined)).toBe('Town Center');
  });

  it('renders the tooltip markup as plain text with the cost spelled out', () => {
    const help = 'Create <b>Villager<b> (<cost>)\\nGathers resources. Builds and repairs buildings.'
      + '\\n<GREY><i>Upgrades: HP, armor (Town Center).<i><DEFAULT>\\n<hp> <attack> <armor> <piercearmor> <range>';
    expect(plainHelp(help, cost(50))).toBe(
      'Create Villager (50 food)\nGathers resources. Builds and repairs buildings.\nUpgrades: HP, armor (Town Center).',
    );
  });
});
