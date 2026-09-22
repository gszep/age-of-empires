# Household shared play

One host on Ysgramor, two player seats, one match. No account or lobby setup.

For an independent solo match against the AI, add `?solo=1` to either play
URL. This bypasses the match connection and uses the normal browser simulation,
map/seed options and local session saving. Remove the parameter to join shared
play again.

## Installed arrangement

- Ysgramor: `open-empires-shared.service` runs `tools/shared-host.mts` on
  localhost:5173 behind the existing Tailscale route. Your usual link is unchanged.
- Artemis: the same user-service name runs `tools/shared-join.mjs` on
  localhost:5174. Open **http://localhost:5174/** on Artemis.
- Artemis's current import is generated from its owned base depots under
  `/home/gszep/Documents/repos/age-of-empires/.local/shared-runtime/public`.
  Ysgramor uses its own `public/imported/` HD import. The manifests keep each
  machine's frame metadata and image scale together.
- The gateway serves `/imported/` locally and proxies everything else,
  including the application code and match WebSocket, to Ysgramor. There is
  no need to update Artemis's application clone for each code change.

## Match behaviour

The server imports `src/sim/` and owns the clock, command order and AI.
Clients receive the host's actual rules and current snapshot, then reproduce
the accepted commands at each tick. A checksum every 100 ticks detects drift;
a mismatch or reconnection requests another snapshot. The synchronization hash
sorts object fields and preserves array order: JSON transport drops undefined
properties, so insertion order is not a reliable state invariant (#153).
Legacy v1 replay checksums remain unchanged. Art never selects rules.

Incoming ticks enter a 100 ms wall-clock buffer, independent of game speed.
Scheduled tasks drain at most a 4 ms work batch (one expensive tick/hash can
exceed that budget), yielding between batches so a catch-up burst does not
monopolize rendering. Ready batches use a MessageChannel so nested zero-delay
timers do not impose an artificial 4 ms catch-up ceiling. Displayed mobile-unit and projectile positions interpolate
between simulated ticks; simulation state is never interpolated or skipped.
Picking and selection markers use the displayed unit positions. Pause drains
earlier ticks before being displayed, and resume starts a fresh timing anchor.

Same-map snapshot recovery keeps terrain, scenery, fog geometry, HUD, camera,
loaded assets and valid selections. The normal scene update reconciles entity
ids. Only a changed map rebuilds the presentation.

Player 1 is Ysgramor; player 2 is Artemis. The AI controls player 2 until a
human first joins that seat. It stays disabled thereafter, including across
reconnections and host restarts. A player disconnecting pauses the match;
F3 resumes after reconnecting. Pause and speed are shared. Only player 1 can
restart the match. **F10 → Game Settings → Start Game** selects a map and
seed; Random clears the seed field for a fresh board. The guest's controls
are read-only. URL map/seed parameters do not replace a running shared match.
Launch metadata travels in snapshots and checkpoints, outside simulation state
and replay hashes. Old saves without this metadata remain loadable.
Their menu offers Start Game to choose a known setup; Restart becomes available
once the map and original seed are recorded, rather than guessing them.

The host saves `.local/shared-match.json` every five seconds and on shutdown.
If there is no checkpoint, the first player-1 browser can hand over its
existing dev-session snapshot, provided the rules match. Open that browser
first when moving an existing standalone match into shared play. Subsequent
joins always receive the host's state. Opening an old standalone link in a
different browser cannot recover another browser's session storage.

`npm run dev` remains standalone for development, replays and private probes;
use `npm run dev -- --port 5175` while the shared service occupies port 5173.
After editing simulation/host code, restart the shared service as well as
reloading browsers. Bump `SHARED_VERSION` when checkpoint compatibility changes.
A checkpoint with a different version or rules hash is preserved and fails
startup with status 78 (`CONFIG`), as does malformed checkpoint JSON. The
service does not retry that permanent failure. Restore the matching game
rules/version to resume it, or explicitly move the checkpoint aside to start
a new match. The diagnostic prints the exact saved path.

**Standing permission (human, 2026-09-21):** when neither Artemis nor Ysgramor
has accessed the shared match for at least one hour, an agent may terminate
that match without asking again. Verify inactivity from connection/access
evidence; checkpoint modification time alone is not last access, since the
host saves periodically. A host continuously down for over an hour also
establishes that neither machine could have accessed its match. Archive the
checkpoint when ending it and leave the host available for a new match. This
is operational permission, not an automatic expiry timer in the application.

## Operations

```bash
systemctl --user status open-empires-shared
systemctl --user restart open-empires-shared
journalctl --user -u open-empires-shared -n 50

# Install/update the user service on the appropriate machine:
node tools/install-shared.mjs host
node tools/install-shared.mjs join /absolute/path/to/asset/public
```

Reinstall an older service to apply the restart policy: `Restart=on-failure`,
`RestartPreventExitStatus=78`, at most five starts per 60 seconds. Transient
failures still retry after three seconds; after hitting the rate limit, repair
the cause, then `systemctl --user reset-failed open-empires-shared` and
`systemctl --user start open-empires-shared`. No checkpoint is automatically
deleted or replaced during incompatible startup.

`tools/session_start.sh` reports the managed service's active/substate, last
exit status, result and restart counter even when no process is running. The
gate records its actual redirected log and result in `.local/gate.latest.json`,
so named issue logs are reported instead of a stale default `gate.log`.
For a private host test, `MATCH_CHECKPOINT` overrides the saved path and
`MATCH_PORT` overrides the listener port; normal household defaults are unchanged.

The join script needs only Node, not npm dependencies. `MATCH_HOST` overrides
the default `https://ysgramor.tail6e864b.ts.net:5173`; `MATCH_ASSETS` is the
public directory containing `imported/`; `PORT` defaults to 5174.

Local asset responses have `X-Empires-Assets: local`. A missing local file
returns 404 and names the path. Sprite loads have bounded concurrency and
failed loads retry after a cooldown; local storage still requires image
decoding and GPU memory. Page eviction remains tracked as #152.

## Verification

```bash
npx vitest run src/shared/match.test.ts
npx tsx tools/shared_smoke.mts
npx tsx tools/map_menu_smoke.mts
tools/gate.sh > .local/gate.log 2>&1
```

The shared smoke starts private servers on 5201/5202 and drives two real
browser pages: adoption of an evolved Islands match, late joining, both
players' train-button clicks, independent home cameras, equal paused-state
checksums, locally served PNGs and a visible tree body, reload/rejoin, and
host restart with disk-checkpoint recovery. Its private checkpoint is
deleted on completion. Tests cover host ordering, ownership rejection, AI
commands and handover, training outcomes, restart, and deterministic clients.
The map-menu smoke additionally drives the actual map/seed controls in solo
and shared modes, validates seed input and keyboard isolation, checks reload
persistence, and verifies terrain after switching between 120- and 392-tile
boards.

For browser probes use the page-local dev hook
`await window.__empiresDebug({type: 'sim'})`; it includes the legacy `checksum`,
transport-stable `synchronizationHash`, player seat, connected/pause state,
pending ticks, hash/step timings, check/resync/snapshot counts and presentation
rebuild count. `snapshot` exports the full state; `resync` deliberately requests
a diagnostic recovery. HTTP `/__debug` still broadcasts and is unsuitable for distinguishing
two pages on the same host.

### Measured on 2026-09-20

- Real Chrome on Artemis, using its regenerated x1 import and a private host
  on Ysgramor over SSH/Tailscale: connected UI in 14.21 s from a cold browser;
  122 PNG responses served locally, zero remote PNG responses, zero page or
  imported-resource errors. A real player-2 train-button click spent 50 food.
- Both machines reported tick 126 and checksum `63d085c4` after that action.
  A tree body was visible and its 23,716-pixel readback was nonblank.
- The installed localhost:5174 gateway separately served a local tree sheet
  and opened its match WebSocket through the live HTTPS/Tailscale route.
- A 3,137,920-byte Windsor snapshot survived five seconds with its receiving
  TCP socket deliberately paused, then reproduced the host's tick-100 checksum.
  Snapshot bytes have their own backpressure allowance until acknowledged.
- Both owned DAT files had SHA-256
  `ce3530df36cf0b333a9751cb0ff94460fe904f811feecec8ae9794701622b4cf`.

### Desync and pacing follow-up (#153)

The human's save reproduced a false checksum mismatch 318 ticks after a JSON
join: the values were identical, but `path`, `pathGoal` and `carrying` had
different insertion order. The new hash sorts object fields; regression tests
exercise JSON transport instead of `structuredClone`. Primitive terrain/fog
arrays use native JSON encoding, avoiding a replacer call for every cell.

On Artemis, a copy of the human's saved match completed 9,387 ticks across
Slow, Normal, Extra Fast and 10x, with 94 successful checksum checks, no resyncs
and no scene rebuilds. A final 10x run after hash/scheduler optimization added
6,075 ticks and 61 successful checks, still with no resyncs. Its paused/faster
frame rates were 5.80/5.90 fps **under forced SwiftShader software rendering**;
the claim is stable frame rate, not hardware-GPU performance. Mean hash time
fell from about 32 ms in the initial run to 13.65 ms, and peak pending ticks
from 372 to 32 after removing nested-timer clamping. The final host and guest
agreed at tick 51,026, synchronization hash `7c3f9a8f`.

These are warm-dependency-cache measurements: the identical 2.55 MB Three.js
chunk was preloaded locally after cold transfers measured only 28.5 KB/s
(#154). Artwork remained local and game-state traffic crossed Tailscale.
The two-browser smoke also verifies 1,500+ fast-forward ticks without unintended
resyncs and a forced recovery with unchanged selection and scene-rebuild count.

These checks cover scripted play and reconnection, not a long two-human match
or a hardware-GPU performance benchmark. A worker is deferred: normal speeds
kept up and increased speed did not collapse measured rendering throughput.
Sprite-page eviction is still #152.

## Synchronization references

- [Ensemble's AoE networking account](https://www.gamedeveloper.com/programming/1500-archers-on-a-28-8-network-programming-in-age-of-empires-and-beyond): command replication, separate communications/rendering turns and metering.
- [Deterministic lockstep](https://gafferongames.com/post/deterministic_lockstep/): playback buffering and bounded catch-up.
- [Fixed-timestep rendering](https://gafferongames.com/post/fix_your_timestep/): view interpolation without changing simulation steps.
- [Factorio's serialization desync investigation](https://factorio.com/blog/post/fff-340): ordering and state reconstruction can undermine determinism.
