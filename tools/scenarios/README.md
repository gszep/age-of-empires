# Exact-coordinate scenario fixtures (#308, phase A)

Later instrument/boundary/P2-controller specs and outcomes are documented in
[`docs/scenario-calibration.md`](../../docs/scenario-calibration.md). They include
failed controls; file generation/readback success is not native acceptance.
Custom AI probes additionally need their uniquely named `.ai`/`.per` dependencies
in the user's scenario-resource AI directory. The private validator checks native
`Files.ai_error_present`; matching embedded script text alone previously concealed
a native file-open failure. These owned-derived AI files are never committed.

## Licence and provenance

[AoE2ScenarioParser](https://github.com/KSneijders/AoE2ScenarioParser), pinned to
**0.9.7**, is GPL-3.0. The owner approved separate local-tool use, not incorporation
into this MIT project. Only this README and fixture specifications belong in
`tools/scenarios/`. No parser code, importing scripts, binaries, or game data are
committed. Run the parser only with:

```sh
uv run --no-project --with AoE2ScenarioParser==0.9.7 python <private-script>
```

The importing adapters (`generate.py`, `read.py`, `verify.py`, `test_verify.py`)
live in ignored `.tools/scenario/`; inputs, outputs, readbacks and logs live in
ignored `.local/scenarios/`. These are **local worktree handoff files**, not tools
available in a fresh clone. Keep this durable worktree for phase B. The first
`uv` invocation may download dependencies; it is not inherently offline.

`coords-probe.json` is an agent-authored fixture implementing the owner-approved
task, not extracted game content. Generation starts from the parser's bundled
**1.59** default, resizes it, replaces units/triggers and sets the requested
players. Existing private editor saves also parse as 1.59. Reference target is
installed build **185872** (#312); the file format alone does not prove native
compatibility. Phase A was offline; native phase B1 results are recorded below.

## Fixture contract

- 40×40, 1,600 grass tiles (terrain 0), elevation 0.
- P1 `BRITONS`, P2 `INCAS`; `DARK_AGE` (parser value 2); mutual `ENEMY`
  (value 3). Both use None AI; P1 is human, P2 computer. Exactly two active players.
  Parser player indices include Gaia at 0; diplomacy slots instead start with P1.
- P1 male villagers (83) at (10.5,10.5), (20.5,10.5), (15.25,12.75);
  P2 militia (74) at (30.5,30.5); Gaia sheep (594) at (20.5,20.5). All z=0.
  IDs were checked against the pinned parser dataset; editor input confirms
  a male villager at (56.5,55.5). Binary quarter/half coordinates are exact.
- Five enabled, non-looping `OBJECTS_IN_AREA` conditions (id 5), quantity 1,
  owner and unit-type filters, alive object-state 2, not inverted. Each rectangle
  names one tile: both integer endpoints are the tile's index, not index+1.
  These are **tile-presence** probes, not sub-tile coordinate measurements;
  exact fractions must be checked in the saved file.
- Each condition emits one `SEND_CHAT` (id 3) to P1: **OK-V1**, **OK-V2**,
  **OK-V3**, **OK-M1**, **OK-S1**. Short labels avoid overlapping instruction
  panels and can be captured together in chat. String id -1 uses literal text.
- **BAD-E0** uses the same valid P1 villager filter in empty tiles (5,5)–(8,8).
  It must not appear. The area is checked empty of *all* placed objects, not
  merely an impossible object type. All triggers use ordinary condition
  evaluation (`execute_on_load=false`), not unconditional startup execution.

No fixed stance, frozen movement, victory override, gate-boundary experiment or
ownership-precedence experiment is claimed here. None AI and separation reduce
interference but do not prove units remain stationary. Phase B must check initial
messages promptly and reject runs with movement/ownership changes. Native area
evaluation, Gaia filtering, chat delivery and sub-tile preservation passed the
bounded B1 run below; continuous stationary/frozen behavior is not established.

## Local generation and outcome checks

Run from this worktree root; log parser chatter separately from JSON:

```sh
uv run --no-project --with AoE2ScenarioParser==0.9.7 python .tools/scenario/generate.py \
  tools/scenarios/coords-probe.json .local/scenarios/coords-probe.aoe2scenario \
  > .local/scenarios/generate.json 2> .local/scenarios/generate.log
uv run --no-project --with AoE2ScenarioParser==0.9.7 python .tools/scenario/read.py \
  .local/scenarios/coords-probe.aoe2scenario \
  > .local/scenarios/readback/coords-probe.json 2> .local/scenarios/readback/coords-probe.log
uv run --no-project --with AoE2ScenarioParser==0.9.7 python .tools/scenario/verify.py \
  tools/scenarios/coords-probe.json .local/scenarios/coords-probe.aoe2scenario \
  .local/scenarios/input/OpenEmpires-20261004-britons-no-mill.aoe2scenario \
  > .local/scenarios/verify.json 2> .local/scenarios/verify.log
uv run --no-project --with AoE2ScenarioParser==0.9.7 python .tools/scenario/test_verify.py
```

`coords-probe.compare.json` records 170 exact checks, spec/output SHA-256 and
`native_verified=false`: map, terrain/elevation census, players/civs/age/AI,
both diplomacy directions, all positions with no extra units, trigger state/order,
every specified condition/effect parameter and control-area geometry. Full
readback includes the parser's remaining trigger defaults. Mutation tests reject
12 deliberate corruptions. Generation errors are fatal, including trigger errors.

### Unmodified editor-file round trip: scope and caveats

`verify.py` reads the Britons editor save, writes a separate file with the same
basename, re-reads it, and compares **all parsed section fields**, not just units.
`editor-roundtrip.compare.json` and the adjacent `.before.json`/`.after.json`
under `roundtrip-no-reconstruction/` record zero parsed-field differences using
the parser's `skip_reconstruction=True` mode, appropriate only for an **unmodified**
file. Generation always uses normal manager reconstruction and write validation.

This is **not byte identity or native acceptance**. The serializer changes an
empty unit caption from a zero-length string to a one-byte NUL string: decompressed
payload 123,112 → 123,113 bytes, same parsed empty caption and identical header.
`roundtrip-byte-diagnosis.txt` and `roundtrip-caption-evidence.txt` retain evidence.
Separately, normal manager reconstruction changes `Map.map_color_mood` from
`Default` to `default`. That strict round-trip comparison **fails** and is retained
in `editor-roundtrip.reconstructed.compare.json`; the native impact is unverified.
An initial different output basename also changed `DataHeader.filename`, as the
parser explicitly does on write; its failed comparison is retained too. Do not
interpret the successful spec checks as approval of arbitrary editor-file rewrites.

## Phase B1 native result — 2026-10-12

**PASS for load/save/trigger acceptance**, installed build **185872**, PID16560,
2560×1440, inherited Casual1.5 speed. Native Save As retained all five positions
exactly, including (15.25,12.75); all **170 spec checks passed** on the native file.
P1 Britons/P2 Inca, Dark Age, two players and None AI were also inspected in the
editor. Its map-generation size dropdown showed Small [144]; that is not the
loaded map's dimensions: the engine-saved terrain is **40×40 / 1,600 grass tiles**.

All five OK labels appeared by **00:00:01**. At paused **00:02:30**, chat history
contained exactly those five and no BAD-E0. P1 villagers and P2 militia remained
visually stationary across sampled captures, with no combat; militia was in
**Aggressive Stance**, not forcibly frozen. Gaia sheep was not continuously
visible under fog, so its later movement is not established. No unit orders issued.

Evidence index: `.local/native308/index.json`; key captures `15-test-start.png`,
`20-militia-stance.png`, `22-chat-history.png`, `31-final-main-menu.png`.
Native file/readback/comparison: `.local/scenarios/native-rt/`.
The generic comparison receipt's `native_verified=false` is an automatic offline
default; the separate B1 index records the native provenance and UI observations.

Retained Windows files: `OpenEmpires-308-coords-probe.aoe2scenario` and
`OpenEmpires-308-coords-probe-rt.aoe2scenario`. Input SHA-256 begins `860fce599f1f`;
native Save As SHA-256 begins `384639f0958c` (full hashes in local receipts).
Initial focus attempts were rejected safely; clicking the visible game logo
restored focus. An exit misclick opened Options; Cancel closed it without changing
or applying settings. No graphics, Steam or authentication changes. Final game
state: **running at main menu**; no controller process remains. At the end of phase B1
(2026-10-12) the boundary and precedence experiments had not yet run; their
current status is in `docs/scenario-calibration.md`.

## Native reproduction procedure

Coordinator-owned native slot only; do not launch/control the game from phase A.

1. Record the installed build (target **185872**), current settings and fixture
   SHA-256. Copy `.local/scenarios/coords-probe.aoe2scenario` to the Windows user's
   scenario folder, **not** the Steam installation:
   `%USERPROFILE%\Games\Age of Empires 2 DE\76561198049987770\resources\_common\scenario\`.
   Use a new, non-existing name such as
   `OpenEmpires-308-coords-probe-20261012-A.aoe2scenario`; choose a fresh suffix if
   occupied. This profile path is the source of the existing input saves; confirm
   the active profile before copying. Keep the original Linux output untouched.
2. Open the native scenario editor and load that named scenario. Check the map,
   players/ages, mutual enemies, five units, six triggers and integer tile areas.
   **Save As** a second unique name, e.g.
   `OpenEmpires-308-coords-probe-20261012-A-editor.aoe2scenario`, without moving
   units or changing settings. Copy this editor-saved file back to ignored local
   storage. Run `read.py` and compare it to the spec using `verify.py` (substitute
   the native-saved filename for its generated-file argument). Inspect failures;
   do not normalize coordinate, civ, diplomacy or trigger differences away.
3. Use editor **Test** as P1. Without issuing orders, capture chat promptly:
   expect exactly one each of OK-V1, OK-V2, OK-V3, OK-M1, OK-S1 and **no BAD-E0**.
   If messages are missing, misplaced, or units move first, retain the failed
   run; do not infer success from the static readback. Record build, hashes,
   settings, elapsed game time, screenshots/video and any ownership changes.
4. Exit Test and reload the untouched fixture for each reset. Do not save a
   running/moved state over it. Restore changed settings and leave the game at
   the main menu. Only after this passes should the coordinator proceed to
   the separate boundary and ownership-precedence experiments in #308.
