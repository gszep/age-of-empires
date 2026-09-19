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
- **`sea.mts`** — an Islands sea read back as numbers: the mean colour of a
  tile in the shallow rim and one in the open body, against the reference
  screenshot's (82, 172, 220) and (64, 135, 183) (issue #94),
  plus the minimap's histogram and a crop of each. `MAP=`, `SEED=`, `EXTRA=`
  (a query string the water shader once read switches from), `OUT=`. Not
  throwaway: re-run it after anything that touches `water.ts`, the terrain
  pass or the minimap.
- **`harbour.mts`** — stage a dock with a fishing ship at work beside a
  school and photograph it: the naval slice's acceptance picture. A snapshot
  handed to the page, then `look` and `pixels`; remember a snapshot is
  declined when the URL fixes a map or a seed.
- **`hudshot.mts`** — the HUD at the reference's own 2000x1125, with each
  label's computed font. Crop the same boxes from it and from the reference
  screenshot and stack them at 5x: that is how the face, weight, size and
  digits were settled (issue #92; `docs/ledger.md`). `MAP=`, `SEED=`, `LOOK=x,y`, `NAME=`, `OUT=`.
- **`scroll.ts`** — issue #31: holds ArrowDown for real, blurs the window
  without a keyup (the alt-tab case), and reads an entity's screen position
  to see whether the camera is still panning.
- **`trebuchet.ts`** — issue #30: stages an unpacked trebuchet bombarding a
  house through a snapshot and samples the animation name and frame over a
  few seconds, plus the projectile art key in flight.
- **`farm_mapping.py`** — draws the farm onto the real diamond and measures its
  furrow pitch, which is the answer issue #22 settled: both sheets carry forty
  furrows to the span and the farm shows about twelve across its three tiles.
  Re-run it after anything that touches `FARM_TILES_PER_SPAN` or the terrain
  import; it warns if the count has drifted from what the reference shows.

`snapshot.ts` and `panel.mjs` start their **own** Vite server on their **own**
port and open the only page attached to it (`pathing.ts` needs no browser and
`farm_mapping.py` no game). The shared dev server broadcasts to every attached page
and answers with whichever replies first, so a browser tab somebody left open
on 5173 will answer your measurement from its own match. Pass `root` and
`configFile` explicitly or `createServer` takes the working directory as the
project and serves a 404.

## The reference corpus

`.local/reference/` (gitignored: the images are the reference's) holds the
crops of AoE2DE that measurements are compared against, one line each in
`.local/reference/index.md`: file, what it shows, the game's display
resolution and any crop scale, and the date. Before calibrating anything
visual, look there; if the corpus lacks the thing, ask the human for a
screenshot — three of theirs settled six defects the agent's own metrics
had passed (`docs/reviews/2026-09-19.md` §5). Compare in the space the
`pixels`/`edge` reply names, at the same pixel scale (`hudshot.mts` renders
at the reference's 2000x1125 for exactly that).

Seeded 2026-09-19 with the five HUD crops from the human's 2026-09-17
random-map screenshot (2000x1125, 0.52 of the 3840-wide widget space):
`hud-{top,bottom,menu,score,age}-2026-09-17.png`. The two Islands
screenshots from 2026-09-19 (the minimap and sea; the sun glints and HUD
text) exist only in the chat and are asked for on issue #103.
