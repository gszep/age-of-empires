/** Installed-DE setup choices measured October 3, 2026; see ledger #253.
 * This is a match ceiling, not housing and not a civilisation bonus. */
export const POPULATION_LIMITS = [25, 50, 75, 100, 125, 150, 175, 200, 225, 250, 300, 400, 500];

/** Omission preserves the rules bundle's historical ceiling (including uncapped legacy rules). */
export function validPopulationLimit(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && POPULATION_LIMITS.includes(value));
}
