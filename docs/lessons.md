# Lessons

Operational knowledge distilled from working sessions. Read this before starting
work; append new lessons at the end of a session. Each entry is one hard-won
fact plus the rule it implies. Delete entries that stop being true — git history
keeps the record.

## Rendering and assets

- **Mask atlases must be neutral white.** The renderer multiplies
  `material.color` through the texture, so a mask sheet packed as black RGB
  renders every player colour as black. This failed *silently* — nothing
  errored, the art just looked wrong. Rule: any convention that can fail
  silently gets a guard test the moment it is discovered
  (`test_import_aoe2.py` now asserts mask sheets carry no colour).
- **Verify sampling before blaming assets.** A "low-res grass" report led to a
  deep investigation that ended by SHA-256-proving the imported texture was
  identical to the installed game's. The actual causes were `anisotropy = 1`
  and `NearestFilter`. Rule: when imported art looks wrong, check filtering,
  mipmaps, and colour pipeline first; hash-compare the source only afterwards.
- **The DAT usually already knows.** The arrow launch height lived in
  `graphic_displacement`, the felled-tree art was the `dying` graphic, farm
  ground is terrain slots 7/29. Rule: before approximating any visual or
  timing, search the DAT and widgetui data first (see the field cheat-sheet in
  `AGENTS.md`); approximations are a last resort and get recorded in
  `docs/status.md`.
- **Player colour is a palette block, not a tint.** The SLD player-colour layer
  is *coverage* — its interior is a solid 255 and only the BC4 block edges hold
  intermediate values — while the shading lives in the main layer, which paints
  those pixels in greys. The ramp that grey indexes is the game palette's
  8-shade block at the DAT's own `player_colours[i].player_color_base`
  (`original.pal` 16..23 is the classic blue), *not* the 16x16 blends in
  `playercolor_*.pal`, which are DE's editable hue-to-target table. Rule: a
  layer's meaning is a measurement, not a name — histogram it before deciding
  what it encodes.
- **An exact walk is the proof a format was read right.** The SLD outline
  layer looked like a filled silhouette full of block-shaped holes until the
  invariant was checked: every block row's commands must cover exactly its
  blocks and consume exactly its bytes. They did — on all 78 consumed sources
  — which meant the reading was right and the "holes" were the sprite's
  interior. It is a contour, not a silhouette. Rule: verify a decode against
  an invariant the format itself enforces before trusting (or doubting) what
  the pixels look like.
- **The debug pixel readback was lying, darkly.** Captures render into an
  offscreen `RenderTarget`, which is linear by default, so the output transfer
  the canvas applies was skipped and every colour came back as its linear
  counterpart — grass reading `#384808` when the screen showed `#788838`. That
  is a ~2.2 gamma of error in exactly the tool used to check colour work. Rule:
  when a measured colour is off by roughly a power, suspect the measurement's
  colour space before the art; the render target now takes
  `renderer.outputColorSpace`.
- **A Group's renderOrder silently outranks every child's.** Three sorts by
  groupOrder before renderOrder, and a Group's own renderOrder becomes its
  children's groupOrder. Selection markers sat in a Group at 900 while sprites
  live in groups at 0, so a marker mesh's carefully chosen 950 never competed
  with a body's 1000+ — markers painted over every building, and nothing
  errored. Rule: renderOrder values only order objects whose enclosing groups
  tie; put layered meshes in groups with default renderOrder and express the
  layer on the mesh, and verify layering with a pixel probe at a point where
  the wrong order shows a colour the right order hides.
- **WebGPU does not render in Node.** The viewer uses `THREE.WebGPURenderer`;
  there is no plain-Node headless render path. Headless Chrome with SwiftShader
  does run the full game (slowly, ~4 fps) and is how automated visual checks
  work — see the debug protocol in `AGENTS.md`.

## Simulation and data import

- **Don't guess genieutils attribute names.** Nine `AttributeError` iterations
  were spent probing the DAT schema. Rule: consult the cheat-sheet in
  `AGENTS.md`, and when a field is missing from it, `dir()` the object once and
  extend the cheat-sheet instead of trial-and-erroring.
  That lesson recurred seven times in the 2026-08-28 run — `clearance_size_x`,
  `collision_size`, `effect_configs`, `research_time`, `target_diff`,
  `work_value1`, `unit_class` — so, following the rule below about converting a
  recurring lesson into structure, the cheat-sheet now carries every field that
  run had to discover *and a list of the plausible names that do not exist*.
  Two more things worth knowing before reaching for `datq.py`: it reloads the
  whole DAT per invocation, so more than two or three questions is slower than
  a one-shot script; and the DAT's naming is not self-consistent — a unit's
  clearance is the tuple `clearance_size` while its collision is
  `collision_size_x`/`_y`.
- **All SLD decoding is local.** `tools/sld_layers.py` handles every layer
  (verified byte-identical to the openage decoder it replaced, which corrupted
  the heap on masks and crashed on the stable); extend it rather than adding a
  decoder dependency.
- **A DAT unit's internal name is a lie; its graphic file name is not.** Unit
  74 is called SPRMN and is the militia. Unit 7 is called XBOWM and draws
  `u_arc_skirmisher_*` — it is the skirmisher, while unit 24 (CARCH) draws
  `u_arc_crossbowman_*`. The names are AoK leftovers that never moved with the
  ids. Rule: identify a DAT unit by `dat.graphics[...].file_name` and its
  numbers (cost, hit points, train time), never by `unit.name`.
- **A DAT field that reads like a boolean may be a flag field.** A
  projectile's `smart_mode` is 0 until Ballistics sets it, so importing it as
  `bool(smart_mode)` looked exactly right — until the effect itself was read
  and turned out to write 1 on ninety projectiles and 3 on fourteen others,
  which already carry a second flag. Rule: before importing a small integer as
  a boolean, look at the whole set of values it takes across the file and at
  what writes it; `{1, 3}` is a bitfield answering a different question.

- **Distrust "always" in reverse-engineered specs.** The SLD header field
  documented as "unknown, always 0x10" is really the frame-data start offset,
  and layer padding aligns to it — the stable uses 14 and crashed every
  decoder that hardcoded 16. When a file breaks a format assumption, treat the
  file as the specification: a clean walk that ends exactly at the last byte
  is the proof.

- **Composite the sprite offline before mapping frames to meaning — and
  composite *every* arrangement, not the easy ones.** The palisade's five
  deltas carry no labels. Rendering each as a run along each axis settled the
  two runs and the lone post in one picture: the frame that tiles seamlessly
  *is* that axis's run. But the corner was never drawn, only reasoned about
  from what the leftover frames looked like — and it was wrong, so every
  corner drew a low straight section for weeks. Drawing the right-angle and the
  T took one more composite and was unambiguous: frame 2 closes all four arms,
  frame 3 leaves the angle open. Rule: prove the index by drawing the
  arrangement, and draw one for every state the index can take; the frames you
  reason about instead of rendering are the ones that end up wrong.

- **A DAT axis label is not this projection's axis.** `worldToIso` sends +x
  down-right; AoE2 sends its own +x down-left. Everything symmetric hides it,
  so it surfaced only on the palisade gate, where the unit that obstructs 2x1
  along the DAT's x draws stakes running the other way — and every gate lay
  across the wall it was built into. Rule: a DAT field named for an axis
  describes the original's handedness, not ours. Where a box and a picture both
  come from the DAT, they may need different units; measure which sprite lies
  along the run rather than trusting the label that says it does.

- **A predicate that lists its members by hand will be missed.** `isBuilding`
  is a hardcoded set, and the palisade was added to the rules, the schemas and
  the renderer without being added to it — so units strolled through walls and
  a foundation drew as a finished building, with every test green. Rule: when a
  kind is added, a test asserts every key of `FALLBACK_RULES` answers to
  `isBuilding`/`isUnit`; type-checking will not do it for you.
- **A condition that is only asked sometimes is only right sometimes.** The
  victory check hung off a `newlyDead` flag that combat never sets, because an
  attack resolves its own kill the moment the blow lands. Matches usually ended
  anyway, on the next berry bush to run out — until one did not, and ran the
  full half hour over a razed town center. Rule: gating a cheap check on a
  "something happened" flag is an optimisation, and it needs the same proof
  that the flag covers every way the thing can happen.
- **A unit that cannot find a way must stop, not walk through the wall.** The
  escape hatch for a walker boxed into its own tile let it step straight at its
  destination, which is right for a villager stuck in a wood line and wrong for
  anything facing a palisade. Rule: distinguish what gaia put there from what a
  player built — the grid marks them apart — and let a walker squeeze out of
  scenery but never through somebody's wall.

- **Measure which layer is slow before rewriting any of them.** The 120x120
  map halved the browser frame rate, and the obvious suspects were the fog mesh
  and the nav grid. Disabling one loop at a time found it in the minimap, which
  stroked a diamond path per tile — fourteen thousand paths, several times a
  second. Replacing that with one pixel per tile and a single `drawImage` under
  the matrix that reproduces the isometric mapping (it is linear, so a canvas
  transform is exact) left the big map running faster than the small one had.
  Rule: an experiment that switches one suspect off costs a minute and is worth
  more than any amount of reasoning about which layer "must" be the cost.
- **Making the board realistic exposes what the players were not doing.** On a
  32x18 map the trees were five tiles from the town center, so an AI with no
  drop-site logic and no scouting looked fine. At AoE2's own distances it spent
  its entire starting wood on a barracks and then queued villagers behind
  fifty-second round trips. Rule: distances are a gameplay rule like any other,
  and a strategy tuned against toy distances is not tuned at all.

- **An automatic continuation needs a bound, and sight is the honest one.** A
  villager whose sheep ran out picked the nearest bush *on the whole map*,
  through fog, because the search that fed it had no radius and no visibility
  test — invisible on a 32x18 board and absurd on a full-size one. Rule: when
  a unit decides for itself what to do next, it may only consider what its
  owner can presently see and what is within a stated distance; if the answer
  is nothing, idle is the correct answer. Reaching further is a decision, and
  decisions belong to whoever is playing.

- **A one-tile footprint has to be on a tile.** Resources were placed at the
  fractional positions the generator computed, so each blocked the four tiles
  it straddled instead of the one it stood on, and a forest became nearly
  solid. Rule: anything a tile grid will read must be snapped to that grid when
  it is placed, not rounded when it is read.
- **"Small maps" is a comment with an expiry date.** The pathfinder scanned its
  whole open list for the minimum — fine at 576 tiles, quadratic in the
  frontier at 14,400, and worth a hundred-millisecond tick when one villager
  looked for a way into a wood. Rule: when a data-structure choice is justified
  by the size of something, say so in the comment (this one did) and re-read
  those comments the day that size changes.
- **A performance fix should prove it changed nothing else.** Swapping the open
  list for a heap could quietly have changed which equal-cost path a unit
  takes, which a deterministic simulation cannot afford. Keeping the same total
  order (f, then h, then tile index — the tile makes it total) meant the pop
  sequence was unchanged, and running three seeds to twelve thousand ticks for
  byte-identical checksums is what turned that from an argument into evidence.

- **Scattering objects over a disc is not how the original makes a forest.**
  55 trees spread through a radius-7 circle is 36% density: sparse enough to
  walk through, which is not a wood. The script uses `create_terrain` with
  `number_of_tiles`, filling a contiguous area and putting a tree on every tile
  of it — so the shape is grown, not sampled. Rule: read what the script asks
  the *engine* to do, not just the numbers it passes; "tiles" and "objects" are
  different instructions.
- **Making terrain impassable creates a class of unreachable targets.** Once a
  wood was solid, every tree inside it was a target nothing could stand next
  to, and villagers sent at one re-pathed across the whole wood every tick to
  learn that again. Rule: when an obstacle becomes real, the code that picks
  targets has to learn the same thing — and a cheap approximation of "can
  anything stand here" (four grid lookups) beats discovering it by pathfinding.

- **The dev-session snapshot is how you photograph a state nobody can reach
  yet.** Verifying the Castle Age in the running game meant reaching an age that
  costs 1300 resources and twenty minutes of gathering, which no debug command
  can grant. Building the state in Node with the sim's own `applyCommand`, then
  writing it into `sessionStorage` as a dev-session snapshot before the page
  loads, put a finished castle and every new unit on screen in seconds. Rule: to
  see a late-game rendering change, construct the state through the simulation's
  public entry points and hand it to the page as a snapshot — do not add a cheat
  to the debug protocol, and do not play twenty minutes to get there.
  `tools/probes/snapshot.ts` is that recipe as a script you can run: it names
  the `sessionStorage` key, the `{version, rulesOrigin, state}` shape, and why
  `rules` is deliberately left out of it.
- **Making a thing clickable is three layers, and the middle one was missed.**
  Carcasses were made selectable and the fix was verified twice — the sim
  predicate by unit test, the click by driving a real mouse — and ordering a
  villager onto one still failed, because `applyCommand`'s own target lookup
  filtered `!e.dead` and answered "target does not exist". Selection and
  commands are separate paths to the same entity and neither implies the
  other. Rule: when a class of entity becomes interactable, walk every layer
  that resolves an entity by id — picking, the command entry, and the tick
  loop that services the order — and test the command entry directly; a view
  test and a predicate test together still leave the layer between them unrun.
- **A reasonable-sounding refinement re-created the bug it was fixing.**
  Carcasses were made clickable, and picking was then biased toward living
  units because a click near a villager is "probably meant for the villager".
  Villagers eating a carcass stand right on it, so every test click landed on a
  villager and the carcass was as unclickable as before. It was caught only
  because the check drove a real mouse at the thing the bug report described.
  Rule: verify a fix by performing the user's action, not by asserting the
  condition you just wrote; and be suspicious of a tie-break added on intuition
  when the existing rule (nearest wins) already covered every other case.
- **Ask the panel what it is showing, not a screenshot.** The build menu, the
  train buttons and the research button were all checked by reading
  `.command-button` titles out of the DOM — text that says "Build Castle (650
  stone) (G)". That caught the fifteen-slot overflow immediately and needed no
  eyes. Rule: HUD questions are DOM questions; keep screenshots for geometry.
  The same applies to anything that blinks: three rounds of pixel sampling
  failed to settle whether the order flash fired on a tree, because a
  two-tenths-of-a-second band in a histogram is a bad signal and a wandering
  villager is worse. Reporting `flashTarget` through the `sim` query answered
  it in one run — and revealed that two of those rounds had been measuring a
  click that never landed, because the target had slipped back into fog. Rule:
  when a check needs three attempts, stop sampling the consequence and report
  the decision; and give a staged scene a stationary observer so visibility is
  never the variable under test.

- **Look upstream of the symptom, three times if necessary.** Four of sixteen
  matches were drawing, so the obvious reading was "the armies are too small
  to finish" and two rounds of tuning went into army size and farm counts,
  changing nothing. Tracing one stalled match showed neither side had trained
  a *single* soldier in thirty minutes, and no barracks until minute twenty --
  because the population sat at 5/5 for the first four minutes, because
  housing was only bought when one place was left, because the opening two
  hundred wood had gone on a camp. The fix was in the first thirty seconds of
  the match, four causal steps above where the problem showed. Rule: when a
  measure does not move, stop adjusting the thing you think causes it and
  print the actual state over time; the answer is usually earlier and duller
  than the theory.

- **A strategy change that improves one number can silently break the game it
  plays.** Teaching the example AI to age up worked -- sixteen of sixteen
  matches reached the Feudal Age where none had before -- and it also stopped
  the AI being able to beat an opponent that did nothing at all, which three
  existing tests caught and no batch metric would have. Four separate causes,
  none of them the research code: cutting wood gatherers from two in six to
  one in eight starved the lumber camp and the barracks; farming from the
  Feudal Age spent the barracks' hundred and seventy-five wood sixty at a
  time; a new "is this spot free" check counted wandering villagers as
  obstacles, so no barracks site ever qualified; and the endgame raze counted
  enemy *villagers* as a reason to hold back, so against a passive opponent the
  field was never clear. Rule: when tuning a strategy, the batch's headline
  numbers are not the test suite -- keep a fixed adversary in the suite whose
  defeat is not negotiable, and read the whole causal chain before adjusting
  the thing you just changed.

- **Measure the baseline before deciding a number is bad.** "Twelve hundred
  wood banked and twenty food" looked like an obviously wrong gatherer split,
  and rebalancing it made the AI strictly worse -- because the first two
  hundred and seventy-five wood buys the buildings the whole military opening
  depends on, and only the wood after that is surplus. Rule: a resource that
  looks over-gathered at the end of a match may have been exactly right at the
  start of it; check what the early spend is before rebalancing the income.

- **The DAT states more than you expect; look before approximating.** Three
  times in one run a number that looked like it needed inventing turned out to
  be in the file. How long a corpse lies there is a type-12 resource storage
  draining at the corpse unit's own rate (300 seconds for a unit, 60 for
  rubble) rather than a window somebody has to choose. Which building art an
  age uses is an `upgrade unit` command on the age technology, not a naming
  convention. Which technologies a civilisation gets is a `Node Status` in a
  file shipped beside the DAT. Rule: when about to pick a number, spend five
  minutes dumping the fields of the thing it belongs to and the effect
  commands of whatever changes it — the miss rate on that search is lower than
  it feels, and the approximations you do keep are then genuinely the ones the
  files do not answer.

- **A test that pins a roster breaks on every addition and says nothing when
  it does.** `expect(trainedHere).toEqual(['archer', 'cavalry-archer',
  'skirmisher'])` failed three times in one afternoon as units were added, and
  each failure was a line to edit rather than a fact to learn. Rewritten to
  assert the rule — everything on that building which exists only as the far
  end of an upgrade is offered only once the upgrade is researched — it covers
  every unit added since and would catch a real defect. Rule: assert the
  invariant, not the inventory; if an exact list is genuinely the point, say
  why in the test.

- **A test that asserts what the rules say cannot see whether the game reads
  them.** Issue #26 was "attack upgrades do nothing", and the first fix -- the
  importer had been dropping every non-combat building's armour -- was real,
  large, and not the whole bug. The test written beside it asserted that
  `unitRulesFor` returned 5 after Fletching, which it did; the attacker loop
  read `state.rules.units[kind]` instead and dealt 4 for the rest of the match.
  The defect survived a green gate, a determinism check and an issue comment
  claiming it fixed. It was found only when a *different* piece of work needed
  to know where combat reads its numbers. Rule: when a technology, an upgrade
  or a modifier is meant to change an outcome, the test measures the outcome --
  the hit points the target loses, the food the player banks -- and never the
  intermediate table. A lookup function returning the right number proves the
  lookup, and the bug is usually in who calls it.

- **A simulation feature can be complete and completely unreachable.** The
  training queue was right in the rules, right in five tests, and impossible to
  use: the train button's `enabled` still read `!producer.training`, so the
  moment a building started training, the button that queues behind it went
  grey. Four clicks in a real browser produced one villager. Nothing in the
  test suite could see it, because the tests call `applyCommand` and a player
  cannot. Rule: a feature reached through a button is verified by *pressing the
  button* in a running page, not by asserting the command it would send; and
  when a rule changes what is allowed, search the interface for the old rule
  spelled as an enablement.

## Process

- **Complete one playable behaviour end to end** (from the working style
  rules) is easy to violate on broad autonomous runs: the tech-tree run
  shipped a market that trains nothing. Rule: for every production building
  added, the unit it trains ships in the same change, or the gap is recorded
  in `docs/backlog.md` before the run ends.
- **Autonomous runs need acceptance criteria.** "Build out more of the tech
  tree" produced good work and silent gaps. Rule: turn broad mandates into a
  checklist first, verify each item against the checklist before finishing,
  and report unmet items explicitly.
- **Never rebase published commits.** A worktree rebase quietly rewrote an
  already-pushed commit; it was caught and repaired by replaying commits.
  Rule: integrate worktree branches with merge or by cherry-picking onto the
  pushed tip, and check `git log origin/main..` before any history edit.
- **Precise observational bug reports are gold.** "Black colouring on the mill
  and the barracks" pinpointed a multiply-through bug immediately. When
  reporting or relaying visual defects, name the entity, the state, and the
  colour seen — and prefer the debug protocol's numbers over adjectives.
- **`pgrep -f` and `pkill -f` match the shell that is running them.** The
  pattern is tested against whole command lines, and the wrapper shell running
  `while pgrep -f herd.py; do sleep 15; done` has `herd.py` in its own command
  line — so the loop matched itself, the condition never went false, and the
  wait never ended. Sixteen of these accumulated over one long run, each waking
  every fifteen seconds against a script that had finished hours earlier; the
  same footgun had already killed a task with `pkill -f`, which matched and
  terminated its own wrapper (exit 144). Rule: do not wait on a background job
  by polling for its name. Wait on the thing itself — run it with
  `run_in_background` and read the task result, or have it write a pid file or
  a sentinel file and poll that. If a `-f` pattern is genuinely the only
  handle, exclude the watcher (`pgrep -f pat | grep -v $$`) and prove the
  loop terminates before leaving it running.
- **The debug bridge answers from whichever page replies first.** A speed
  measurement taken against the shared dev server came back negative, then
  zero: a browser tab somebody else had left open on 5173 was answering some of
  the queries from its own match, thousands of ticks along. Rule: a script that
  measures rather than observes starts its own Vite server on its own port and
  opens the only page attached to it — and passes `root` and `configFile`
  explicitly, because `createServer` takes the working directory as the project
  otherwise and serves a 404.
- **A lesson takes hold in proportion to how structural it is.** Comparing two
  post mortems: every lesson that became something the process walks through —
  the checklist with embedded verification, the quality gate, commit-and-push,
  the debug protocol — held for fifteen hours and across a compaction. Every
  lesson that stayed prose describing one incident recurred: "don't guess DAT
  names" was violated eight more times, and the pkill self-match was rewritten
  as pgrep sixteen times. Prose is read at hour zero and must be remembered at
  the moment of temptation at hour five. Rule: when a lesson recurs, stop
  re-recording it and convert it into structure — a tool that makes the right
  way easier than the wrong way (`tools/wait_for.sh`, `tools/datq.py`), a
  checklist line, or a hook.
- **A pipe between a check and the thing that trusts it throws the answer
  away, and it does it twice.** The quality gate was being run as `npm test |
  tail -5 && npm run build | tail -2 && ...`, and `&&` sees the status of
  `tail`, which is always 0 — so a `tsc` error sailed through a green-looking
  gate into a commit and was found two items later by a run that happened not
  to pipe. The gate was then moved into `tools/gate.sh` to read `PIPESTATUS`,
  and *that* had the same defect one layer down: the step ran as `if ! $step |
  tail -6; then :; fi`, and `:` is a command, so it reset `PIPESTATUS` before
  the next line read it. Only the failing case was affected, which is the only
  case the check exists for — a run reported GATE GREEN over `FAILED
  (failures=1)`. Rule: read a status on the line after the command produced it
  and never through a construct that runs anything in between; and when a
  fix's own machinery repeats the bug, test the fix against a deliberate
  failure before trusting it.

- **A doc that points at a gitignored path is a doc that is wrong for
  everyone but you.** `docs/overnight.md` opened with "run the gate with
  `.local/gate.sh`" and later sent the reader to "`.local/probes/`, which has
  half a dozen working examples" — and `.gitignore` contains `.local/`, so
  neither existed for anybody else, including the next session on the same
  machine after a clean checkout. The instruction had been true when written
  and was never false in a way that showed up locally. Rule: when a doc names
  a path, check it is tracked (`git ls-files --error-unmatch <path>`) before
  the doc ships; tooling worth writing a doc about is worth committing, so
  move it out of `.local/` rather than editing the sentence around it.

- **A patch script that asserts every edit and writes once loses every edit
  when one assertion fails.** The shape is `s = read(); for old, new: assert
  old in s; s = s.replace(...)` and a single `write()` at the end — so the
  first failed assertion aborts before the write and the successful
  replacements vanish with it. This shipped a real defect once: commit
  `9ba70f4` claimed to wire `accuracyPercent` through and did not, because one
  of its assertions failed and the whole patch was discarded silently while the
  commit went ahead. It then happened again on a documentation patch, which is
  how it was noticed a second time. The failure is quiet in both directions —
  nothing is written, and nothing says so unless you go back and look. Rule:
  in a multi-edit patch script, report per-edit hit or miss and write what
  succeeded (`for i, (old, new): if old not in s: print("MISS", i) else:
  ...`), then check the report. Do not let one edit's failure decide the
  others' fate, and never commit a patch script's work without reading its
  output.

- **Re-running a slow job because it "seems stuck" is how it gets stuck.** The
  atlas conversion normally takes under a minute, so when the manifest had not
  changed after forty seconds it was started again, and again — three of them
  ended up decoding the same sprites at once, each making the others slower,
  and the next one timed out at 115 seconds and looked like a hang. Nothing
  errored; the log file was simply block-buffered and empty. Rule: before
  restarting a background job, check whether it is still running (`ps -eo
  pid,etimes,args` filtered in a script, never a `-f` pattern that matches the
  asking shell) and pass `-u` to a Python job whose progress you intend to
  watch. A second copy of a CPU-bound job is never the fix.

- **A leaked waiter is invisible until somebody looks.** None of the sixteen
  produced output, failed, or slowed anything down; they were found only
  because a human noticed the process list. Rule: a run that starts background
  waits ends by listing what it left running, and says which processes are
  meant to outlive it — here the Vite dev server and the debug harness — and
  which are litter.

- **The tail-pipe trap reproduced itself one layer up, against the script
  built to prevent it.** `tools/gate.sh` reads `PIPESTATUS` correctly — and
  was then run as `tools/gate.sh | tail -3 && git commit`, which hands `&&`
  the status of `tail`, and a red gate committed and pushed (`39aa106`; every
  test in it was green, so the damage was luck). The trap is not a property of
  the gate's insides: it re-arms at every call site that pipes. Rule: run the
  gate with output redirected to a file (`tools/gate.sh > log 2>&1; status=$?`)
  and read the status variable on the next line; never put a pipe between a
  command and the thing that trusts its exit.

- **A green test run can still be a red run.** Twice tonight every test passed
  and vitest exited 1: `[vitest-worker]: Timeout calling "onTaskUpdate"`. The
  worker's pending RPC reply is seen only when its event loop turns, and a
  file of back-to-back CPU-bound sim tests can hold the loop for minutes —
  the reply's own sixty-second timer is then overdue and fires first. Yields
  *inside* the two slowest tests did not fix it, because the starvation is
  across tests, not within one. The fix that held is structural: a global
  `afterEach` yielding one macrotask (`src/test-setup.ts`), plus capped
  workers so contention does not stretch every test. Rule: an async runner
  under sync CPU load starves in ways that blame the wrong test; give the
  event loop a guaranteed turn at a boundary the runner owns.

- **A `&`-backgrounded job dies with the shell that spawned it when the
  harness times that shell out.** A sixteen-match batch was started with
  `(...)& ` followed by a wait in the same command; the command hit its
  ten-minute limit, the harness killed the process group, and the batch died
  after its matches but before its replay-verification summary — leaving
  results on disk and no verdict. Rule: a job meant to outlive the command
  that starts it is started with `setsid` (its own process group) writing an
  exit-file, and waited on from a *separate* command via the file.

- **Python tooling is a locked uv project, not an ad-hoc venv.** The first
  Windsor terrain pass had to install NumPy and rasterio into the old import
  venv by hand because its requirements file described only the sprite tools.
  Rule: every Python tool dependency belongs in `pyproject.toml`/`uv.lock`, all
  setup and execution goes through `uv sync/run --locked`, and independent
  coverage fetches and NumPy reductions use bounded parallel workers rather
  than serialising work on this many-core machine.

- **Map resolution and simulation density are separate decisions.** Windsor at
  15 m/tile needs 153,664 terrain cells to preserve recognizable roads and
  water, but turning all 22,401 canopy cells into entities would make the
  browser pay for detail the ground texture already carries. Rule: retain the
  complete authoritative terrain raster and deterministically thin repeated
  scenery entities (`bakedTreeStride`), with tests for the resulting bound.
- **A terrain-only import must not wait behind all sprite decoding.** Adding
  three DAT terrain slots and invoking the full converter without an atlas
  cache spent fifteen minutes decoding unrelated SLDs before the harness killed
  it. Rule: use `convert_sld.py --terrain-only` when validating terrain slots
  against an existing manifest; the full pipeline remains the clean-build gate.
- **Minimap dots scale with the board, not the UI panel.** A tree was always a
  3-pixel square, which is right on 120x120 but makes one tree cover roughly ten
  terrain cells on Windsor's 392x392 raster; 5,635 thinned trees therefore read
  as much denser forest than exists. Rule: preserve the classic size at 120 and
  scale resource dots down to a one-pixel floor as map resolution rises.

- **A memory kept because the thing can vanish has to cover everything read
  off it.** `lastWorked` exists precisely because a spent node is swept out of
  the entity list and the continuation still needs to know what the worker had
  been doing — and it remembered the *kind* only, while the resource was still
  read off the vanished node. So the half that had been fixed worked and the
  half beside it failed, in the same two lines, for a year. It also could not
  have been patched by remembering harder: every tree, bush, gold and stone
  node is kind `resource`, so the kind cannot answer which resource it was.
  Rule: when a field is added because an entity may be gone by the time it is
  needed, walk every other field the same code reads off that entity and ask
  the same question of each; a vanishing thing does not take away one property
  at a time.

- **A strategy that repairs its own units hides the bugs in the units' rules.**
  The lumberjack going idle at the camp cost the built-in AI 0.4 idle
  villager-seconds in 900 and not one banked resource, because the strategy
  re-tasks its own idle villagers within a second or two. Sixteen-match batches
  had run over that defect for weeks. The whole cost fell on the human playing
  by hand, who has no such loop and simply watches a villager stand there.
  Rule: a bug reported by somebody playing is measured at the level they meet
  it; a headline metric that does not move is evidence about the *strategy*,
  not about the fix, and a player-facing defect can be invisible to every
  batch number the project has.

- **A watcher polling faster than the simulation resolves will see the state
  in between.** The spent-farm alert is raised by the view comparing this
  frame's state to the last, and a farm is replaced one tick after it empties
  — so a poll running every 16 ms across a 50 ms tick reliably caught the gap
  and cried about every farm the auto-reseed option silently re-sowed. Nothing
  was wrong with either side: the simulation resolves it correctly and the
  watcher reports what it sees. Rule: when a watcher announces a change that
  the simulation finishes over more than one tick, hold the announcement long
  enough for the rest of it to arrive, and decide from the outcome rather than
  from the first frame of it.

- **An extractor's allow-list is a silent filter, and the code downstream
  cannot tell an absent field from an absent widget.** `strip_widget` keeps a
  tuple of field names; an `Anchor` widget carries its origin in a field of
  that name rather than in a `ViewPort`, so the command grid's anchor never
  reached the manifest and the HUD, finding nothing, quietly kept the
  hand-tuned CSS that was wrong. Worth knowing alongside it: a panel's art and
  the widget that draws it are the same rectangle — `map-panel.png` is 860x413
  and so is `Background` — so a widget's box inside that panel is directly a
  box inside our element, and every content position in a panel is a number
  the shipped files already state rather than something to nudge until it
  looks right. Rule: when an importer's output feeds a layout, assert the
  specific fields the layout reads, in the import test; "the widget is
  missing" and "the field was stripped" fail identically and neither says so.

- **A field that pins one thing is not thereby measuring another.** The farm's
  `terrain_dimensions` really does pin the frame layout — `frame_count` is the
  product of the dimensions for every slot in the file — and that was read as
  though it also said how much ground a frame covers. The check that broke it
  was free and never run: the *other* farm sheet has different dimensions (3x3
  against 6x6) for the same forty furrows, so the reading implied a farm
  re-ploughing itself at half the spacing the moment the crop came up, which
  nobody had noticed in a year of looking at farms. Rule: when a field is used
  for a second purpose it was not verified for, find the other rows that field
  takes and check the second reading against them; a value that is right about
  its own job can be silently wrong about the one next to it.

- **Ask what a wrong answer would have to be, not only whether yours looks
  right.** Three candidate farm mappings were rendered for the human to choose
  between, and the answer they gave — twelve furrows — was none of the three.
  Because the candidates were expressed as a measurable quantity rather than as
  pictures, the reply converted straight into a scale (twelve over three tiles
  against forty to the span is ten tiles to the span) and into the discovery
  above. Rule: when putting a question to the human, ask for a number they can
  read off the reference rather than a choice among your options; a count comes
  back usable even when every option was wrong, and a picked option cannot tell
  you that they all were.

- **A rejected snapshot photographs the wrong thing and says nothing.**
  `loadSession` declines a stale snapshot by design and starts a fresh match,
  which is right for the browser and silent for a probe: `tools/probes/
  snapshot.ts` had been writing `version: 1` since the version went to 2, so it
  screenshotted an ordinary opening while claiming to show a staged scene. It
  surfaced only because a farm id in the reply did not match one that had been
  staged. Rule: a probe that stages state asserts the page actually resumed it
  before reading anything back, and the version it writes is imported from the
  loader rather than copied — a fixture that silently falls back is worse than
  one that fails.

- **The file that answers a "blocked on evidence" question may simply never
  have been opened.** Terrain blending sat in `backlog.md` and `overnight.md`
  for weeks as blocked because "nothing says which `terrain/blends/` file a
  `blend_type` selects". `blendomatic_x1.dat` says, sits beside the DAT in the
  same depot directory the importer already reads, and nobody had looked at it.
  Ten minutes of `ls` over `resources/_common/dat/` was the whole cost. Rule:
  before recording something as blocked on missing evidence, enumerate the
  owned files you have *not* read and say why each cannot answer it; "I could
  not find it in the files I looked at" is a different claim from "the files do
  not contain it", and only the second is a blocker.

- **The owned compiled shaders name their inputs, and that is often the whole
  answer.** `resources/_common/shaders/d3d11/*.so` are DXBC blobs, and
  `strings` on one lists its samplers and constants -- `g_VisibilityTexture`
  with `sBilinear`, `g_fogFadeAmount`, `g_OverlayForEdges`, `g_MaskTexture`
  beside `g_BlendTexture`. That told issue #41 the fog edge is a filtered
  per-tile texture and not art, without disassembling anything. And the names
  are the search key for the values: `g_FogTintColor` and `g_fogCellSize` are
  `fog_tint_color` and `fog_cell_size` in
  `terrain/colorcorrection_json/colorcorrection.json`, beside
  `fog_seen_land_mult` -- which is how the explored level became a read number
  rather than a guess, an hour after it had been written up as unknowable.
  Rule: before writing "lives in a compiled shader" as a reason something is
  unknowable, run `strings` over it, then grep the depot's JSON for each name
  with the `g_` prefix dropped.

- **A DAT colour field may be a palette index.** `Terrain.colors` is three
  indices into `original.pal` -- the minimap shade and its lighter and darker
  neighbours -- and the importer had shipped them as RGB for months. Nobody
  noticed because grass's indices (55, 236, 54) happen to be green; water's
  (19, 19, 19) would have been black, and only water showed it. Rule: a
  three-byte field on a 256-colour-era format is an index until a palette
  lookup proves otherwise; the player colours already went through the
  palette in the same file, three functions up.
- **The manifest is assembled by two tools, and the second one's key is not
  the first one's to lose.** `convert_sld.py` rebuilds the manifest dict and
  `import_blends.py` adds `blends` to it afterwards; re-running the atlas
  step alone published a manifest without `blends`, and every terrain edge
  went hard with no error anywhere -- the first pond screenshot was taken
  over it and the shore was read as a rendering bug. `convert_sld.py` now carries `blends`
  through and the import test asserts it. Rule: when a file is written by a
  pipeline, re-run the pipeline (`tools/import_aoe2.sh`), not the step; and
  a key the game reads gets a presence guard the day it is added.

- **A mask byte's meaning is settled by the mask that has only one
  reading.** Blendomatic's bytes were taken as overlay alpha for a day, and
  every screenshot passed, because a mask opaque along one edge is the
  mirror of the mask for the opposite neighbour -- the wrong reading is the
  right shape from the other side. Mask 30, for a tile out-ranked on every
  side, keeps its centre and gives up its edges under one reading and the
  reverse under the other, and only one of those is a thing an engine would
  draw. Rule: when a decode has a symmetry that lets two readings both look
  right, find the one input the symmetry does not cover and test that.
- **Pillow reads the DDS.** `waterSurfaceFE.dds`, the sky domes and the sea
  floors open with `Image.open` and convert like any PNG; no DirectX
  tooling is needed for the water textures, and `convert_water` in
  `tools/convert_sld.py` is twenty lines.

- **A hard limit in a growth algorithm draws a straight line, and the
  script has a field for exactly that.** Islands' first coasts were dead
  straight wherever the land met the half-map margin or the border box,
  because a tile was either allowed or not. `border_fuzziness` is the
  engine's answer -- a tile's chance of being taken fades over that many
  tiles -- and reading it as such gave ragged coasts in one change. Rule:
  when a generated shape has a straight edge nothing in the reference has,
  look for the constraint that cut it and for the script field that softens
  it before inventing noise.
- **Judge a dressing pass against the reference before shipping it.** The
  nearctic `POWDER_LIGHT` pass, painted at the script's own numbers through
  this generator's growth, came out as white blobs the size of the real
  ponds and read as frozen lakes; the script's negative clumping means
  something this growth does not do. The numbers were right and the picture
  was wrong. Rule: a pass copied from a script is verified by a screenshot
  next to the reference's, not by its numbers matching.

- **A cosmetic feature must not draw on the stream that decides the game.**
  Dressing the board in a biome needed random numbers, and taking them from the
  match's own generator shifted every draw after it — so choosing what colour
  the ground is dealt a different board for every existing seed, broke three
  strategy fixtures and moved the AI from winning at 1957 seconds to 2350 of a
  2400-second cap. Giving the dressing its own stream, derived from the match
  seed, made the change invisible to everything but the eye: same seed, same
  sheep, same trees, different colour. Rule: a feature that only affects how
  something *looks* gets its own derived random stream, and a test asserts the
  object layout for a seed is byte-identical across the change.

- **Improving a distribution surfaces the bugs its old bias was hiding.**
  Mixing the match seed — a plainly correct fix to an xorshift whose first draw
  was 0.0001 for seed 1 — immediately failed a map invariant that had passed
  for months: two trees on one square. The generator plants each mask tile at
  its own position and again at its mirror, and `cleanMask` mends pinholes
  without regard for which half it is in, so a tile that is itself the mirror of
  another took two trees. The old degenerate distribution simply never grew a
  wood onto the centre line. Rule: when a randomness fix breaks tests, read each
  failure as a find before reading it as fixture churn — the new boards are the
  first honest sample of the space the generator always claimed to cover.

- **A fixture that assumes a board tests the board, not the behaviour.** A
  regression test for "a lumberjack carries on to the next tree" placed its two
  trees at a hardcoded offset from the town center. On a re-dealt board that
  offset landed outside the player's sight — where going idle is the *correct*
  answer — so the test failed while the code was right, and the obvious repair
  (nudge the numbers until it passes) would have left it asserting nothing. Rule:
  a fixture establishes the preconditions its behaviour needs — clear ground,
  within sight, far enough to outlast the timer — by searching for them and
  asserting it found them, never by trusting a seed to provide them.

- **Audit the reference by listing its files, not by remembering them.** A
  session that asked "which owned files has nobody opened?" answered it in
  an hour with two greps: every basename under the depot's `dat/`, `xs/`,
  `widgetui/` and `particles/` against every reference in `tools/`, `src/` and
  `docs/`, and every DAT unit field against the names the importers use. It
  turned up sixteen things — a miss radius the DAT states, the blast rule its
  rows settle, the strings file, the female villager, a 683 MB audio pack the
  pipeline never opens — and five of them had been recorded as approximations
  "because the owned files do not say". Rule: before writing "not in the
  owned files", run the inventory; the cost is minutes, and the phrase is only
  true of files somebody has listed.

- **The publish step copies keys by name, and a key it does not name is
  silently gone.** `convert_sld.py` assembles `manifest.json` from a literal
  dict; `technologies` was once left out of it and the game ran on the
  fallback rules without a failure, and `playerAttributes` was left out from
  the day it was added — the DAT's farm food never reached the game, which
  ran on the fallback's identical 175 for a month. Both were caught by the
  numbers happening to agree. Rule: a new content key is three edits —
  `import_content.py`, the dict in `convert_sld.py`, and the publish test's
  list of rule-bearing keys — and the test is the one that matters.
- **Editing the atlas decoder invalidates the whole cache.**
  `decoder_fingerprint` used to hash `convert_sld.py` itself, so adding one
  key to the manifest dict re-decoded 1,500 atlases for twenty minutes; it
  now hashes `sld_layers.py` and the two conversion functions, so only a
  decoding change costs the hour (structure, not prose — the lesson recurred
  the day the fires needed a manifest key). Rule: know that before touching
  the decoder, batch such edits, and never restart the run (three at once
  look like a hang — see above).
- **Check a panel against a screenshot of the reference at the same scale,
  not against the widget file alone.** `commandpanel.json` says the parchment
  is anchored TopRight in a 2246-wide collection, which put it 358 in; the
  reference screenshot at 0.52 scale put its left edge at 521, which is
  2404 − 1888 — the file's `xopen`, the collection's real width. Nothing in
  the JSON says which of `xclosed`/`xopen` is normal play. Rule: when a
  widget's position has two readings, measure the reference; a pixel run
  along one row of a screenshot settles it in a minute.
- **A material the widget file names may be a placeholder the engine swaps.**
  `CivEmblem`, the tech-tree button's `IconsMenuTechtreeAztecs`, the resource
  panel's `AgeupCastleAge`, the map panel's shared `MinimapFilterEconomy` on
  two buttons: each is substituted per civilisation, per age or per mode at
  runtime, and the real one (`CivEmblemBritons`, `IconsMenuTechtreeBritons`,
  `ButtonsShieldDark-AgeNormal`, `MinimapColorFullNormal`) is in the material
  table under a name the file never uses. Rule: when a widget's art looks
  wrong or missing, search the material and texture tables for the thing you
  expect to see, name it in the spec's `ui.materials`, and record the
  substitution.
- **A tester's tab is a snapshot of the day it was opened.** View edits
  hot-swap, sim edits reload and resume the saved session, and the manifest is
  fetched once per load — after six re-imports a tab has run a mix of all of
  them, and a report from it (a longbowman that would not promote) reproduced
  nowhere. Rule: after regenerating anything under `public/imported/`, ask for
  a reload before investigating a report, and say so when handing over a test
  server.
- **The debug protocol's `entities` puts coordinates under `position`, and
  takes no resource filter.** A probe that read `x`/`y` off the top level sent
  an order to `{}`; one that passed `resourceKind` got every entity back and
  picked the town center as the nearest tree. The first is now refused at
  `applyCommand`; the second is filtered client-side. Rule: read a query's
  answer once before writing the loop that trusts it.


- **A decoder that draws plausible pictures on short runs can be wrong on
  the long one, and the format's own economy is the test.** SLD delta
  frames were inherited from the previous frame for a year; on the two- and
  three-frame runs most sheets use that is indistinguishable from the truth
  (inherit from the last keyframe), and on the Feudal mill's ninety-frame
  run it left every sail position behind as a sliver. Rendering candidates
  and looking settled it, but the *proof* was arithmetic: an encoder never
  draws a block it could have skipped, so under the right reference no drawn
  block equals the inherited one, and under the wrong one thirty thousand
  do. Rule: when a format has an inheritance or prediction rule, test the
  reading against what an encoder would never do — a count that is zero
  under the right rule and large under the wrong one — not against how the
  short cases look; and when a sheet has both a moving box and a long run,
  it is the sheet to test on.

- **A canvas premultiplies, so alpha is not a channel you can carry data
  in.** The reference's icons keep the owner's colour weight in the PNG's
  alpha with the shading in the RGB, and the first tint read them back
  through `drawImage`/`getImageData` — which had already multiplied every
  alpha-0 pixel's colour to black, so every portrait came out the darkest
  shade of blue. Nothing errored; the probe that measured the colour lost
  the same data the same way and agreed. Rule: a browser will hand back only
  what it would draw; anything a texture encodes in its alpha beyond
  coverage is split out by the importer into its own opaque mask (as the
  sprite masks already are), and a probe that measures a colour reads the
  mask, not the alpha.

- **A zero-context patch places a pure insertion wherever the line numbers
  say, and says nothing.** Splitting one working tree into per-item commits
  with `git diff -U0` and `git apply --cached --unidiff-zero` put a module
  constant inside the function above it (valid syntax, wrong scope — a
  `ReferenceError` at run time) and a test method inside the body of another.
  The gate caught both; a `py_compile` of the staged file would have caught
  one for free. Rule: stage a subset by rebuilding the file from the index
  with content anchors (the same old/new edits that made the change), never
  by line-numbered hunks; and gate what is staged by saving the working
  tree to a tarball, checking the index out, and restoring — a `stash pop`
  merges, and merged against a subset of itself it conflicts on the docs.

- **A test suite run beside a CPU-bound job fails on its timeouts, not on
  its assertions.** Two tests that pass alone in 22 s and 61 s failed the
  full run at 33 s and 96 s against 30 s and 90 s limits while the atlas
  decode and a browser probe were running. Rule: the gate runs on an idle
  machine; when a long job is going, wait for it, and read a timeout under
  load as contention before reading it as a regression.

- **A weight, a face or a size inferred "from the look" is a measurement
  not taken.** The HUD was set in Georgia Bold because the reference's
  labels looked bold, and every label came out about a fifth too wide; the
  human called them too big. Two strings measured in the reference
  screenshots against the widget files' PointSize — "Dark Age" 172 design
  px wide at 44, "Frazzle: 241/241" 309 at 48 — fit Georgia Regular (181,
  321) and not Bold (209, 369), and the files had said `Style: Normal` on
  every label all along. Rule: when a widget file states a property, use
  it, and when the face is unnamed, measure a string's width against the
  reference before choosing; a glyph atlas the reference ships
  (`fonts/combined.txt`, rasterised at 64 px) is the face itself.
