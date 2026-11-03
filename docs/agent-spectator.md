# Live agent spectator (development preview)

Open `http://localhost:5173/?agents=2` with the local Vite server running.
Choose two models from the local OpenCode catalogue, then explicitly start a
match. Stop cancels work; a retained replay can be downloaded. Opening the page
does not start generation. Model calls may consume provider quota or money;
request-count/time limits are not a dollar spending guarantee.

This preview is deliberately **dev-only, fallback-rules and tactical 2D**.
It is not the normal Three.js/owned-art spectator experience. Normal solo play
and startup remain at `?solo=1`. An unavailable OpenCode service or model is
reported explicitly; no builtin bot is silently substituted.

The server uses the official OpenCode client and stateless text generation.
Models receive their player-filtered canonical observation and command schema;
commands undergo protocol and simulation validation. The browser has no player
command endpoint. Local Start/Stop require same-origin and capability checks;
provider credentials and raw error payloads are not exposed to the browser.
Snapshot/command streams reconstruct the shared simulation and verify initial,
periodic and terminal consistency. Overflow requires a fresh snapshot.

## Verification and limits

November 3 combined-main checks: 131 selected tests passed, the fake-provider
Chrome smoke passed, the owned startup smoke passed, and full `verify:owned`
passed in 819.9 seconds. Browser coverage includes live accepted commands,
late joining, Stop, downloaded replay bytes/checksums, ended-state reload,
error states, local security checks, and normal-game training/HMR/reload.

**No live-provider generation or paid match was run.** TLS coverage exercises
socket metadata, not real HTTPS/WSS handshakes. In-flight browser reload and
slow-network behavior are not fully established. Full-renderer spectating,
owned-rules matches and autonomous bug-report validation remain follow-ups.
Private evidence: `.local/agents352-verification/`.
