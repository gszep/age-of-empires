import { resolve } from 'node:path';
import { checkShell, recordToolProgress } from '../../tools/harness-safeguards.mjs';

// V2 definition (id/setup), not a V1 function returning named hooks.
// No SDK runtime import: the helpers and this entrypoint also run in Node tests.
export default {
  id: 'safeguards',
  async setup(ctx) {
    const directory = ctx.location.directory;
    await ctx.tool.hook('execute.before', event => {
      if (event.tool !== 'shell') return;
      const input = event.input;
      if (typeof input?.command !== 'string' ||
          (input.workdir !== undefined && typeof input.workdir !== 'string')) {
        throw new Error('Refused: shell guard requires a command string and optional workdir string.');
      }
      checkShell(directory, input.command, resolve(directory, input.workdir ?? '.'));
    });
    await ctx.tool.hook('execute.after', event => {
      if (event.status === 'completed') recordToolProgress();
    });
  },
};
