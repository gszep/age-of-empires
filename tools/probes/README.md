# Probes

Throwaway scripts that ask the running game a question. They are not tests —
nothing here runs in the gate — but the two techniques they demonstrate are how
most rendering and UI questions in this project get answered without a human
looking at a screen. Copy one, change the middle, delete it afterwards.

Run them from the repo root: `npx tsx tools/probes/snapshot.ts`.

- **`snapshot.ts`** — build a state in Node through the simulation's own
  `applyCommand`/entity list, hand it to the page as a dev-session snapshot,
  then read what it drew. This is how you photograph a state a fresh match
  cannot reach: a Castle Age town, an army mid-fight, a building mid-collapse.
  Do not add cheats to the debug protocol and do not play twenty minutes.
- **`panel.mjs`** — start a private server, open the only page attached to it,
  and read the HUD out of the DOM and the minimap out of its canvas. HUD
  questions are DOM questions; keep screenshots for geometry.

Both start their **own** Vite server on their **own** port and open the only
page attached to it. The shared dev server broadcasts to every attached page
and answers with whichever replies first, so a browser tab somebody left open
on 5173 will answer your measurement from its own match. Pass `root` and
`configFile` explicitly or `createServer` takes the working directory as the
project and serves a 404.
