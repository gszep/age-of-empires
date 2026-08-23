# Open Empires Lab

A lean, agent-native RTS experiment. The current horizontal slice is a deterministic TypeScript simulation shared with a mobile browser viewer.

## Play

```bash
npm install
npm run dev
```

On calcifer, the current development server is available to the tailnet at:

<https://calcifer.tail6e864b.ts.net:5173/>

Rotate the phone to landscape. The fullscreen button requests an orientation lock where Chrome permits it.

### Controls

- Tap a blue villager, military unit, or building to select it.
- With a unit selected, tap ground to move, a resource to gather, or a red unit/building to attack.
- Select a villager to build a house or barracks, then tap the placement location.
- Select the town center or barracks to train units.
- “Select army” selects all of your militia.
- Destroy the red town center to win.

Pink circles are food and dark green octagons are wood. The red opponent runs the example AI.

## Commands

```bash
npm test
npm run build
npm run import:militia  # local owned AoE2DE depots only
npm run test:import     # live DAT/SLD integration
```

Imported Microsoft content is generated under ignored `public/imported/` and is never committed.

## Architecture

- `src/sim/` — authoritative renderer-independent rules, commands, state, and example AI
- `src/main.ts` — browser controls, fixed-step loop, HUD, and Three.js viewer
- `docs/architecture.md` — why the first implementation is TypeScript-first
- `docs/research-landscape.md` — initial ecosystem and literature survey
- `docs/reference-implementations.md` — evidence hierarchy and subsystem references
- `docs/library-strategy.md` — adopt/evaluate/reference decisions for external libraries
- `docs/agent-runtime.md` — structured observations, arbitrary strategy processes, live agents, and batched search
- `docs/autonomous-plan.md` — current execution phases and acceptance gates

This is an intentionally shallow horizontal slice, not yet an AoE II-compatible simulation. Construction, gathering, combat, and pathing are simplified so the complete play/evaluate loop can be tested first.
