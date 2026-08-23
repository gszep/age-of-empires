import { createInterface } from 'node:readline';
import type { StrategyInputMessage, StrategyOutputMessage } from '../protocol/types';

createInterface({ input: process.stdin }).on('line', line => {
  const input = JSON.parse(line) as StrategyInputMessage;
  setTimeout(() => {
    const output: StrategyOutputMessage = {
      type: 'commands',
      time: input.observation.time,
      commands: [],
    };
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }, 50);
});
