import { resolve } from 'node:path';
import { normalizePath, type Plugin } from 'vite';

/** Inline watch:null is dropped by Vite's config merge. This object survives
 * merging and prevents immutable releases from registering file watchers. */
export const immutableWatch = { ignored: () => true };

/** Generated art and private archives are not HMR inputs. Use resolved-root
 * boundaries so a worktree under somebody else's .local still watches its src. */
export function gameWatchScope(): Plugin {
  return {
    name: 'game-watch-scope',
    configResolved(config) {
      if (config.server.watch === null) return;
      const watch = config.server.watch ?? {};
      const previous = watch.ignored;
      const roots = ['.local', 'public/imported'].map(path => normalizePath(resolve(config.root, path)));
      const ignored = (path: string) => {
        const normalized = normalizePath(path);
        return roots.some(root => normalized === root || normalized.startsWith(`${root}/`));
      };
      config.server.watch = { ...watch,
        ignored: [...(Array.isArray(previous) ? previous : previous ? [previous] : []), ignored] };
    },
  };
}
