import { MAPS } from './sim/mapgen';

/** Match-launch metadata, separate from authoritative state and replay hashes. */
export interface MatchSetup { map: string; seed: number }
export const MAX_MAP_SEED = 0xffffffff;

export function validMatchSetup(value: unknown): value is MatchSetup {
  if (!value || typeof value !== 'object') return false;
  const setup = value as Partial<MatchSetup>;
  return typeof setup.map === 'string' && Object.hasOwn(MAPS, setup.map)
    && typeof setup.seed === 'number' && Number.isInteger(setup.seed) && setup.seed > 0 && setup.seed <= MAX_MAP_SEED;
}

const PREFERENCE = 'open-empires-lab:map-setup';

export function loadMapPreference(): MatchSetup | undefined {
  try {
    const setup: unknown = JSON.parse(localStorage.getItem(PREFERENCE) ?? 'null');
    return validMatchSetup(setup) ? setup : undefined;
  } catch { return; }
}

export function saveMapPreference(setup: MatchSetup): void {
  try { localStorage.setItem(PREFERENCE, JSON.stringify(setup)); } catch { /* optional preference */ }
}

export function mapChoices(strings: Record<string, string>): { id: string; label: string }[] {
  const names: Record<string, string | undefined> = {
    arabia: strings.mapArabia, 'black-forest': strings.mapBlackForest, islands: strings.mapIslands,
  };
  return Object.keys(MAPS).map(id => ({
    id, label: names[id] ?? id.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' '),
  }));
}
