import { afterEach } from 'vitest';

// The sim-heavy files run seconds of pure CPU per test, back to back. A
// worker's pending RPC reply is only seen when its event loop turns, and by
// then the reply's own 60-second timer is overdue and fires first -- the run
// then fails with every test green. One real macrotask between tests lets
// every pending reply resolve while it is still fresh.
afterEach(() => new Promise<void>(resolve => setImmediate(resolve)));
