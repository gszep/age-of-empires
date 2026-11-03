# Startup and match setup

Delivered November 3, 2026 for local standalone play.

- Fresh solo sessions open the start screen. `?solo=1&menu=1` explicitly opens
  it; `?solo=1&menu=0` deliberately enters a match for automation.
- Explicit map/seed/mode launches and successfully restored matches enter
  directly. Shared sessions bypass the solo start screen, including `menu=1`.
- Single Player opens separate Players, Game Settings and Map groups. Existing
  map, seed, population, civilisation and victory controls remain available.
- Solo Quit returns to startup without reloading or discarding the match.
  Return keeps the match paused, with an F3 hint. Shared Quit remains disabled.
- Valid replay loading enters visible playback; cancelled or rejected loading
  preserves setup. Covered game controls cannot receive keyboard/wheel input.

This is a source-informed composition, not complete native UI parity. Unavailable
native modes remain disabled; agent-versus-agent is not implemented here. Native
main-menu artwork and some effects remain absent. Responsive wrapping of long
labels and the lab controls are deliberate adaptations. See
`aoe2de-menu-evidence.md` for observed source facts versus inferred behavior.

Verification: independent source review, owned start/pause/feedback browser
smokes, and full `verify:owned` passed. The checkpoint took 811.6 seconds
(public build 18.1, public tests 284.9, serial tests 87.3, imports 412.5,
browser 26.0). Private evidence is under `.local/start-screen-verification/`.
The feedback transparency fixture now compares the same source-qualified
pixel before/after removing the background, with exact equality and an
opaque-fill negative control, rather than assuming neighboring pixels have
identical underlying content.
