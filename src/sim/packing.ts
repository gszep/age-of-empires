import type { GameRules } from './data';
import type { GameState } from './types';

/** Replay initialization only. v1–v5 recordings identified rules by origin,
 * not by value: restore their rate-as-duration mapping before any commands.
 * Clone the changed branches, including civilisation profiles, so replay never
 * changes the caller's rules or a concurrently running current match. Saved
 * states already contain their rules and timers and must NOT run this adapter. */
export function useLegacyPacking(state: GameState): void {
  delete state.packingVersion;
  state.rules = legacyRules(state.rules);
}

function legacyRules(rules: GameRules): GameRules {
  const treb = rules.units.trebuchet;
  const unpacked = { ...treb.unpacked!,
    seconds: rules.origin === 'imported' ? treb.unpacked!.workRate ?? 4.5 : 4.5 };
  // The old open fallback did not publish workRate. Preserve that shape too:
  // converted units can copy rules into checksum-bearing dynamic state.
  if (rules.origin === 'fallback') delete unpacked.workRate;
  return { ...rules, units: { ...rules.units, trebuchet: { ...treb, unpacked } },
    ...(rules.civilizations ? { civilizations: Object.fromEntries(Object.entries(rules.civilizations)
      .map(([key, profile]) => [key, legacyRules(profile)])) } : {}),
  };
}
