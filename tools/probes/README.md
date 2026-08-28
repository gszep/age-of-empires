# Probes

Scripts that ask the game a question. They are not tests — nothing here runs in
the gate — but they are how most rendering, UI and movement questions in this
project get answered without a human looking at a screen. Some are meant to be
copied and thrown away; `pathing.ts` and `farm_mapping.py` are meant to be
re-run, because a doc cites their numbers.

Run them from the repo root: `npx tsx tools/probes/snapshot.ts`.

- **`snapshot.ts`** — build a state in Node through the simulation's own
  `applyCommand`/entity list, hand it to the page as a dev-session snapshot,
  then read what it drew. This is how you photograph a state a fresh match
  cannot reach: a Castle Age town, an army mid-fight, a building mid-collapse.
  Do not add cheats to the debug protocol and do not play twenty minutes.
- **`panel.mjs`** — start a private server, open the only page attached to it,
  and read the HUD out of the DOM and the minimap out of its canvas. HUD
  questions are DOM questions; keep screenshots for geometry.
- **`pathing.ts`** — nine measurements of what the movement actually does, in
  the simulation with no browser at all: detour ratios, whether a group ever
  settles, a crowd through a one-tile gap, a goal nothing can reach, and what
  one order to fifty units costs the tick it lands on. `docs/pathing-review.md`
  is the write-up of a run of it. Not throwaway — re-run it after anything
  that touches `nav.ts`, movement, or the cost of a tick.
- **`farm_mapping.py`** — draws the candidate farm terrain mappings onto the
  real diamond, for the question issue #22 is waiting on. Runs under the import
  venv, because it reads the converted texture with PIL.

`snapshot.ts` and `panel.mjs` start their **own** Vite server on their **own**
port and open the only page attached to it (`pathing.ts` needs no browser and
`farm_mapping.py` no game). The shared dev server broadcasts to every attached page
and answers with whichever replies first, so a browser tab somebody left open
on 5173 will answer your measurement from its own match. Pass `root` and
`configFile` explicitly or `createServer` takes the working directory as the
project and serves a 404.
