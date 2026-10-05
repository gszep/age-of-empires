# Open Empires Lab

An AoE2-compatible game and experimentation lab, built so a long-distance couple
can play together—and help agents make it better through play.

Our north star: **“This week, we'd like a co-op campaign of the Siege of Vienna.
Can you make it for us?”** Historical accounts and real geography should become
playable campaigns; a hardened environment should also let agents discover new
strategies through self-play. These are goals, not features we claim to have finished.

Human play and agent experimentation reinforce each other. Players notice awkward
animations, visuals and interactions immediately; agents reproduce problems and
use fast headless, protocol and metadata checks wherever possible. We build a
coherent, enjoyable subset before chasing every obscure native-game edge case.

## Play

```bash
npm ci
npm run dev
```

Open **http://localhost:5173/?solo=1** for a local game. If the installed shared
service already uses that port, run `npm run dev -- --port 5175` instead.

Current scope includes solo AI and two-seat **competitive** shared play, several
maps, and ten owned-content civilisations. Co-op teams and generated campaigns
are still to be built. **Ysgramor and Artemis are the supported play machines.**

- [Controls and supported gameplay](docs/play.md)
- [Two-machine shared play](docs/shared-play.md)
- [Import your owned AoE2DE assets](docs/owned-assets-setup.md)
- [Delivered scope and known gaps](docs/status.md)

## Under the hood

One deterministic TypeScript simulation runs in both browser and Node. Humans,
agents and replays issue the same commands; Three.js renders the game. Offline
Python tools import owned game content and geographic data. Microsoft assets
stay on your machines; the public build has an open-content fallback.

See [project priorities](docs/product.md), [architecture](docs/architecture.md),
[verification](docs/TESTING.md), and [research choices](docs/research-directions.md).
