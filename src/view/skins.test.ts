import { describe, expect, it } from 'vitest';
import { skinFamilies, skinRoll, skinnedKey, type SkinnedEntity } from './skins';

const manifest: Record<string, SkinnedEntity & { category: string }> = {
  villager: { category: 'unit' },
  'villager-lumberjack': { category: 'unit-variant' },
  'villager-female': { category: 'unit', skinOf: 'villager', skin: 'female', chance: 50 },
  'villager-female-lumberjack': { category: 'unit-variant', skinOf: 'villager-lumberjack', skin: 'female' },
  militia: { category: 'unit' },
};

describe('skins', () => {
  const families = skinFamilies(manifest);

  it('groups a family under the base kind, with the odds the file states on it', () => {
    expect([...families.keys()]).toEqual(['villager']);
    const [female] = families.get('villager')!;
    expect(female.chance).toBe(50);
    expect(female.keys.get('villager')).toBe('villager-female');
    expect(female.keys.get('villager-lumberjack')).toBe('villager-female-lumberjack');
  });

  it('draws about half the villagers female, and each one the same way every time', () => {
    let female = 0;
    for (let id = 1; id <= 2000; id++) {
      const key = skinnedKey(families, { id }, 'villager', 'villager');
      expect(key).toBe(skinnedKey(families, { id }, 'villager', 'villager'));
      if (key === 'villager-female') female++;
    }
    expect(female).toBeGreaterThan(900);
    expect(female).toBeLessThan(1100);
    // Consecutive ids are not simply alternating: the roll is a hash, not parity.
    const first = Array.from({ length: 16 }, (_, i) => skinRoll(i + 1) < 0.5);
    expect(first).not.toEqual(first.map((_, i) => i % 2 === 0));
    expect(first).not.toEqual(first.map((_, i) => i % 2 === 1));
  });

  it('follows the roll on the base kind into the task variant', () => {
    const id = Array.from({ length: 200 }, (_, i) => i + 1)
      .find(i => skinnedKey(families, { id: i }, 'villager', 'villager') === 'villager-female')!;
    expect(skinnedKey(families, { id }, 'villager', 'villager-lumberjack')).toBe('villager-female-lumberjack');
    const male = Array.from({ length: 200 }, (_, i) => i + 1)
      .find(i => skinnedKey(families, { id: i }, 'villager', 'villager') === 'villager')!;
    expect(skinnedKey(families, { id: male }, 'villager', 'villager-lumberjack')).toBe('villager-lumberjack');
  });

  it('deals different faces for different matches, from the seed', () => {
    const faces = (salt: number) => Array.from({ length: 12 }, (_, i) => skinnedKey(families, { id: i + 2 }, 'villager', 'villager', salt));
    expect(faces(7)).toEqual(faces(7));
    expect(faces(7)).not.toEqual(faces(42));
  });

  it('leaves anything without a skin alone, and a family without stated odds undrawn', () => {
    expect(skinnedKey(families, { id: 3 }, 'militia', 'militia')).toBe('militia');
    expect(skinnedKey(undefined, { id: 3 }, 'villager', 'villager')).toBe('villager');
    const unstated = skinFamilies({
      villager: {},
      'villager-x': { skinOf: 'villager', skin: 'x' },
    });
    expect(unstated.size).toBe(0);
  });
});
