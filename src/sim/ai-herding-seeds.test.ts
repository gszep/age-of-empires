import { herdingComparison } from './test-helpers/herding';

// Vitest parallelises by file; this file runs seeds 7 and 42 alongside ai-herding.test.ts' seed 1
herdingComparison([7, 42]);
