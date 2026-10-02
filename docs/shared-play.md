# Household shared play

One host on Ysgramor, two player seats, one match. No account or lobby setup.

For an independent solo match against the AI, add `?solo=1` to either play
URL. This bypasses the match connection and uses the normal browser simulation,
map/seed options and local session saving. Remove the parameter to join shared
play again.

Startup discovery distinguishes a missing shared endpoint from a failed one
(#276). HTTP/network/JSON/configuration failures leave the loading notice visible
and retry at the existing1500ms reconnect cadence; they do not start a separate
solo game or overwrite the saved match. A later valid configuration joins without
a reload. Standalone404, a successful HTML fallback, explicit `enabled:false`,
and `?solo=1` retain independent play. A protocol mismatch is shown explicitly
and requires reloading matching client code.

## Installed arrangement

- Ysgramor: `open-empires-shared.service` runs a pinned release's `tools/shared-host.mts` on
  localhost:5173 behind the existing Tailscale route. Your usual link is unchanged.
- Artemis: the same user-service name runs `tools/shared-join.mjs` on
  localhost:5174. Open **http://localhost:5174/** on Artemis.
- Since October2's08:08UTC update, Ysgramor serves
  `.local/releases/autonomous-20261002-385da49`, fingerprint
  `19a0d8b4735b4abd5c971b7b6bd5979cb9ffd58d2518d9bdfe3b9e0ce51a3ee6`.
  Artemis's gateway and isolated owned base-art runtime are under
  `/home/gszep/Documents/repos/age-of-empires/.local/owned-runtime-0d86953`;
  that candidate directory now contains source385da49 (recorded in its
  `.local/source-revision.txt`), including the reset-socket gateway fix.
  `MATCH_ASSETS` points to its `public` directory. The gateway follows the host
  protocol and selects player2. Both services report protocol2/active/NRestarts0.
- Both machines now have seven profiles with184 definitions per profile.
  Artemis serves4598 x1 sprite pages; Ysgramor serves4750 x2 pages. Both have3666
  audio aliases and0 missing referenced files, and their simulation-rules hashes
  agree. Each renderer uses its own frame metadata/scale. Fresh remote186 owned
  tests,49 fish outcomes and original-species/fog browser acceptance pass; the one
  x2-only import test is inapplicable to Artemis's base import. Earlier Byzantine,
  Chinese and A/B acceptance evidence remains in the preceding deployment logs.
- Actual cross-machine acceptance passed both train clicks, equal state,
  selection-preserving resync, guest reload,1500+ticks without unintended resyncs,
  local guest PNG delivery and checkpoint restart. A second check used the actual
  pinned host entrypoint for Islands fish/islet/art, Byzantine/Japanese menu,
  paid training and reload acceptance before installation. Logs and exact hashes
  are in [handoff.md](handoff.md).
- The preceding5ced752 host release and Artemis `owned-runtime-a208f7c` remain
  intact for rollback, alongside older rollback directories. The original dirty
  Artemis clone was preserved. No current shared checkpoint existed before or
  after stopping the old host; route JSON is byte-identical before/after the
  authorised switch. Private QA processes were stopped and ports rechecked.
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

Large snapshots negotiate the standard WebSocket `permessage-deflate` extension
with independent streams (#174); clients without it receive the same plain JSON.
Ordinary host ticks, settings and errors explicitly bypass compression, so their
delivery does not acquire compression buffering. Snapshot-backlog acknowledgement
and the application protocol version are unchanged.

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
restart the match. **F10 → Game Settings → Start Game** selects a map,
seed and Regicide mode; Random clears the seed field for a fresh board. The guest's controls
are read-only. URL map/seed parameters do not replace a running shared match.
Launch metadata travels in snapshots and checkpoints. Unlike map/seed launch
metadata, game mode also belongs to authoritative state and replay hashes.
Mode-less legacy data means random map; inconsistent mode metadata is rejected.
Old saves without launch metadata remain readable under their matching rules/version.
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
After editing simulation/host code, deploy matching host and browser versions
only after verifying checkpoint compatibility. Recovery requires the saved
version **and rules hash** to match; otherwise retain the old runtime/rules
and prove a migration privately first. Bump `SHARED_VERSION` when checkpoint
compatibility changes.
Regicide uses **shared protocol2**; version1 clients/checkpoints are deliberately
not silently reinterpreted. The implementation acceptance used private hosts;
it does not itself replace a live managed match or archive its checkpoint.
A checkpoint with a different version or rules hash is preserved and fails
startup with status 78 (`CONFIG`), as does malformed checkpoint JSON. The
service does not retry that permanent failure. Restore the matching game
rules/version to resume it, or explicitly move the checkpoint aside to start
a new match. The diagnostic prints the exact saved path.

**Historical 2026-09-26 audit:** live config returned protocol1 while its mutable Vite root
serves protocol2 frontend modules. Reload therefore fails the client's version
check. No default checkpoint was present during passive inspection, so recovery
of any in-memory match is not established. No v1→v2 migration exists; matching-
version recovery tests do not prove one. The managed service was left running.
See [deployment evidence and required preservation work](shared-reference-audit.md#deployment-and-deferred-dependencies).

**2026-10-01 resolution:** the owner confirmed no current match needed preservation.
A passive recheck found the rebooted host already at protocol2. The real two-browser
acceptance then exposed another mismatch: `shared-join.mjs` hardcoded version1.
It now fetches the host config and overrides only the player seat; failed host
config requests return502. Both installed endpoints now report version2 with
their respective seats. Private two-browser acceptance passed clicks, reload,
1500+ ticks without unintended resyncs and checkpoint restart. This is a fresh
deployment, not proof of a generic v1→v2 migration.

The host installer requires a verified snapshot generated by
`tools/shared-release.mjs`. Application code and JSON metadata are copied and
hashed; mutable main no longer supplies the running frontend. Bulk art and npm
dependencies are shared local resources: don't replace them during active play.
See [checkpoint workflow](checkpoint-workflow.md) for candidate verification.

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
node tools/shared-release.mjs unique-release-name
# Verify the candidate privately before installing it:
node tools/install-shared.mjs host /absolute/path/to/.local/releases/unique-release-name
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

### Private cross-machine acceptance

`tools/shared_smoke.mts` defaults to its private local host5201/gateway5202 and
two local pages. It also accepts the paired environment variables
`SHARED_GUEST_URL` and `SHARED_GUEST_BROWSER_URL`: the guest page then runs in a
dedicated remote Chrome, while the host page remains local. All original click,
checksum, reload/resync,1500-tick and checkpoint-restart assertions remain active.

For a two-machine check, prepare a separate remote gateway pointing to this
private host through an SSH reverse tunnel, plus a dedicated remote headless
Chrome/CDP port through a local tunnel. Keep those ports bound to127.0.0.1 and
use a separate temporary browser profile. For example, remote15201 forwards to
local5201; remote gateway15202 uses that host and the candidate local-art directory;
local15222 forwards to the dedicated remote CDP15222. Then run:

```bash
SHARED_GUEST_URL=http://127.0.0.1:15202 \
SHARED_GUEST_BROWSER_URL=http://127.0.0.1:15222 \
npx tsx tools/shared_smoke.mts
```

The guest URL is interpreted by the remote browser. The probe closes its created
guest page and disconnects CDP; the operator retains ownership of the remote
browser/gateway/tunnel processes and must clean them by recorded PID. Existing
household services and a user's interactive browser are separate from this setup.
Failure diagnostics are saved under `.local/browser-diagnostics/shared-{host,guest}`
with the original error and bounded requests/DOM/GPU evidence; clocks are unchanged.

### Watcher scope and frozen releases

Vite's dev watcher excludes the resolved project's `.local/` archives/worktrees
and `public/imported/` bulk assets. Its own `src/` still hot-reloads, including
when the project root happens to live under an ancestor `.local/` directory.
Imported metadata continues to require a page reload after publication.

An inline `watch: null` was found to disappear during Vite config merging (#273).
Pinned hosts now use the merge-stable `immutableWatch` ignore-all option and
`hmr: false`; actual watcher-registration tests verify both behaviours. Excessive
filesystem scanning previously delayed small compressed module responses by
seconds and exceeded the private shared probe's30-second navigation limit.

Local asset responses have `X-Empires-Assets: local`. A missing local file
returns 404 and names the path. Sprite loads have bounded concurrency and
failed loads retry after a cooldown; local storage still requires image
decoding and GPU memory. Page eviction remains tracked as #152.

The gateway also handles a host closing an idle HTTP keep-alive socket just as
Node reuses it (#275). Before any response headers, an `ECONNRESET` on a reused
socket permits one fresh-connection retry for a body-free GET/HEAD. POSTs,
body-bearing requests, fresh-socket errors and partial responses are not replayed.
This is a bounded transport recovery policy, not a change to match commands.
Retry diagnostics name the method/path; a failed retry still returns502. An
interrupted response is terminated without crashing the gateway.

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
