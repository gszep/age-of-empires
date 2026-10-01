import { expect, it } from 'vitest';
import { selectScenarios, validReceipt } from './acceptance.mjs';

it('selects overlapping feature boundaries and never accepts stale, failed or different-command receipts', () => {
  expect(selectScenarios(['tools/shared-join.mjs'])).toContain('shared');
  expect(selectScenarios(['src/sim/rules.ts'])).toContain('cargo');
  expect(selectScenarios(['docs/status.md'])).toEqual([]);
  const commands = [['npx', 'tsx', 'probe.mts']];
  const receipt = { fingerprint: 'tree-assets', state: 'passed', commands };
  expect(validReceipt(receipt, 'tree-assets', commands)).toBe(true);
  expect(validReceipt(receipt, 'changed', commands)).toBe(false);
  expect(validReceipt({ ...receipt, state: 'failed' }, 'tree-assets', commands)).toBe(false);
  expect(validReceipt(receipt, 'tree-assets', [['other']])).toBe(false);
});
