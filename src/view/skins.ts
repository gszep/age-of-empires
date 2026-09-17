/**
 * Skins: another DAT unit drawn in place of the one the simulation knows.
 *
 * Half the reference's villagers are female. The DAT keeps her as unit 293
 * beside the male 83 with identical rules, her own art and her own voice, and
 * a counterpart for every task unit; `objreplacement.json` states the odds
 * (issue #50). The importer carries each as an entity marked `skinOf` and
 * `skin` (the family), with `chance` on the base unit's skin.
 *
 * Which villager is which is decided here, from the entity id alone, so the
 * simulation never sees it: same seed, same sheep, same trees, and a villager
 * keeps her face across a reload because her id does not change.
 */
import type { Entity } from '../sim/types';

export interface SkinnedEntity {
  skinOf?: string;
  skin?: string;
  chance?: number;
}

/** A family of skins: the base's odds, and each skinned key's replacement. */
export interface SkinFamily {
  name: string;
  chance: number;
  keys: Map<string, string>;
}

/** Skin families by the base key they replace, from the manifest's entities. */
export function skinFamilies(entities: Record<string, SkinnedEntity>): Map<string, SkinFamily[]> {
  const families = new Map<string, SkinFamily>();
  for (const [key, entity] of Object.entries(entities)) {
    if (!entity.skinOf || !entity.skin) continue;
    let family = families.get(entity.skin);
    if (!family) {
      family = { name: entity.skin, chance: 0, keys: new Map() };
      families.set(entity.skin, family);
    }
    family.keys.set(entity.skinOf, key);
    if (entity.chance !== undefined) family.chance = entity.chance;
  }
  // Index by the base kind: the entity whose chance the file states. A family
  // with no stated odds is never drawn, rather than drawn at a guess.
  const byBase = new Map<string, SkinFamily[]>();
  for (const [, entity] of Object.entries(entities)) {
    if (!entity.skinOf || !entity.skin || entity.chance === undefined) continue;
    const family = families.get(entity.skin)!;
    const list = byBase.get(entity.skinOf) ?? [];
    if (!list.includes(family)) list.push(family);
    byBase.set(entity.skinOf, list);
  }
  return byBase;
}

/**
 * A number in [0, 1) that is a function of the id and the match's seed and
 * nothing else, spread well enough that neighbouring ids do not come out
 * alike (a villager's id and the next villager's differ by one). The seed is
 * there because the same three ids open every match: without it the opening
 * trio would wear the same faces in every game ever dealt.
 */
export function skinRoll(id: number, salt = 0): number {
  let x = Math.imul((id ^ salt) | 0, 0x9E3779B1) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85EBCA6B) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0xC2B2AE35) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0; // `^` yields a signed word; keep it unsigned
  return x / 4294967296;
}

/**
 * The key to draw and speak with for this entity, given the key its art or
 * voice would otherwise use: the skin's counterpart when the roll says so,
 * the key itself otherwise. `base` is the entity's own kind, which is what
 * the odds are stated on; `key` may be one of its task variants.
 */
export function skinnedKey(
  families: Map<string, SkinFamily[]> | undefined, entity: Pick<Entity, 'id'>, base: string, key: string,
  salt = 0,
): string {
  const candidates = families?.get(base);
  if (!candidates?.length) return key;
  let roll = skinRoll(entity.id, salt) * 100;
  for (const family of candidates) {
    if (roll < family.chance) return family.keys.get(key) ?? key;
    roll -= family.chance;
  }
  return key;
}
