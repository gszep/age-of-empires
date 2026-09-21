# Lessons

Rules that were paid for, grouped by the moment they apply. Read the group
before you reach its moment. Each entry is the rule and the one fact that
earned it; the incidents are in `git log` and `docs/reviews/`. What
`AGENTS.md` already states is not repeated here. A rule that recurs is not
re-recorded — it becomes a tool, a test or a hook (`docs/reviews/2026-09-19.md`
§3: every prose rule from August recurred; every structural one held).

## Before approximating anything

- **Dump the fields first.** A corpse's lifetime is a type-12 resource
  storage on the corpse unit; an age's building art is an `upgrade unit`
  command on the age technology; a civ's tree is a `Node Status` beside the
  DAT. Five minutes over the owning object's fields and the effect commands
  that touch it has a lower miss rate than it feels.
- **"Not in the owned files" is only true of files somebody has listed.**
  Blending sat blocked for weeks while `blendomatic_x1.dat` sat beside the
  DAT. Before recording a block, enumerate the owned files not yet opened and
  say why each cannot answer; grep a script's *includes* before saying it
  lacks something (`Islands.rms` names one water; `F_WaterMasking.inc` is the
  depth chain).
- **Run `strings` over the compiled shader, then grep the depot JSON for each
  name with `g_` dropped.** That is how the fog's levels went from "engine
  side" to `colorcorrection.json` in an hour; and the SM2 build gives the
  arithmetic when the inputs are known (`AGENTS.md`). Calibrate only after
  both.
- **A read constant that is a direction has a frame.** The water's
  `sun_direction` reaches the eye only in the shader's world frame, which
  is the tile frame with x mirrored (`docs/ledger.md`, "Water world
  frame"); a specular term that measures zero is a light in the wrong
  place, not a small one. Two independent facts pin a frame -- the sun's
  glint and the texture's streak angle settled this one; one fact leaves a
  mirror open, and "behind the camera" was the mirror.
- **Two facts pin a frame; one leaves a mirror open.** The water's sun
  and its streak angle together fixed the shader's world frame; the sun
  alone had put it "behind the camera", the mirror of the truth.
- **A statistic of a picture is not the picture.** The foam's crest
  *position* traced smoothly through all 128 frames while the 128th to the
  first was a cut five times any other step; a continuity check compares
  the frames, not a number read off them.
- **Ask what the reference was captured with.** A day of comparisons ran
  against DE with the Enhanced Graphics Pack installed (#150) while we
  imported the base art; shapes and placement survived that, texture
  detail did not until the pack was imported too (#151). The corpus index
  says so at the top -- a capture's settings are part of its entry.
- **A human-supplied number is a measurement with a name.** "About twelve
  furrows" shipped as `FARM_TILES_PER_SPAN = 10`; the ledger says whose
  number it is. Ask the human for a count they can read off the reference,
  not a choice among your candidates — all three candidates were wrong.
- **Reference behaviour you remember from play is inferred, not read.** Say
  so in the ledger (sheep following, the beach rule, the dock's "touch the
  land"); the reference has been wrong from memory more than once
  (`hero_mode` bit 32 decides who asks before Delete, not "buildings").

## Before reading a DAT field

- **A unit's name is a lie; its graphic file name is not.** Unit 7 `XBOWM`
  draws the skirmisher. Identify by `graphics[...].file_name` and numbers.
- **A small integer may be a bitfield** (`smart_mode` takes `{1, 3}`); **a
  three-byte colour may be palette indices** (`Terrain.colors`); **a tuple
  has positions** (those three are up-slope, flat, down-slope — the middle
  is the ground); **a field that pins one thing may not measure another**
  (`terrain_dimensions` pins the frame layout, not tiles per span — the
  other farm sheet proves it). Look at the whole set of values a field takes
  across the file before importing it.
- **A DAT axis label is the original's handedness.** Measure which sprite
  lies along the run.
- **Gaia's units live in `civs[0]`, and `unit_class` is `class_`.** Both cost
  a failed probe more than once; `tools/datq.py` and the cheat-sheet in
  `tools/README.md` exist so the third time does not happen.

## Before decoding or importing a format

- **An exact walk is the proof.** A decode is right when every row's
  commands cover exactly its blocks and consume exactly its bytes, ending at
  the file's last byte; "always 0x10" in a spec is the stable's 14.
- **Test an inheritance rule against what an encoder would never do.** SLD
  deltas inherited from the previous frame for a year; under the right rule
  (the keyframe) zero drawn blocks equal the inherited one, under the wrong
  one thirty thousand do. Short runs look right either way.
- **A symmetric decode has two readings that both look right.** Find the one
  input the symmetry does not cover (blendomatic's mask 30) and test that.
- **A file-less standing graphic is a composition.** The dock is its first
  delta *with a file*; the fish is its `(Underwater)` delta through
  `n_alpha_underwater.palx`. An atlas of empty frames means the picture is in
  a delta.
- **Composite every arrangement before mapping frames to meaning.** The
  palisade corner was reasoned about instead of drawn and was wrong for
  weeks.
- **A canvas premultiplies.** Anything a texture keeps in alpha beyond
  coverage is split into its own opaque mask by the importer; a probe reads
  the mask.
- **A new content key is three edits**: `import_content.py`, the manifest
  dict in `convert_sld.py`, and the publish test's list of rule-bearing keys.
  `playerAttributes` went unpublished for a month because the fallback's
  number happened to agree.
- **An extractor's allow-list is a silent filter.** `strip_widget` dropped
  `Anchor`; the HUD kept its hand-tuned CSS. Assert the specific fields a
  layout reads, in the import test.
- **A material a widget names may be a placeholder the engine swaps**
  (`CivEmblem` → `CivEmblemBritons`). Search the material table for what you
  expect to see and record the substitution.
- **A crop is not the invariant; the picture against the hotspot is.** The
  pack's x2 frames are cut on BC1 blocks, so their boxes differ from twice
  the x1 box by up to eight pixels and a size test failed twice; the drawn
  pixels' box relative to the hotspot, halved, lands within one x1 pixel.
- **Pillow reads the DDS.** No DirectX tooling.
- **Direct3D's v runs down the image; three's runs up.** `v = 1 - v` on any
  UV read from a D3D shader.

## Before measuring a picture

- **State the colour space beside every number.** The debug readback was
  linear for a day; the water was calibrated in the wrong space for a night;
  a factor of two between an owned constant and a measurement is a
  colour-space question before it is a calibration. The canvas is sRGB;
  DE's water offset fits one weight in linear light across both zones and
  all three channels, where a display-space add had fitted two channels
  and left red twenty short for a week.
- **A number that fails is not overruled by a picture that passes.** Fire was
  declared visible after `pixels` said `orange=0` twice. The picture may add
  to a passing number, never replace a failing one.
- **Fit size and weight together, over the reference crop at the same pixel
  scale.** Two sessions measured the HUD's weight from widths and got
  opposite answers; the glyph atlas (`combined.txt`) is the face's identity.
- **Check a panel against a reference screenshot at the same scale, not the
  widget file alone.** `xopen` versus `xclosed` is not stated; a pixel run
  along one row settles it.
- **A dressing pass is judged by a screenshot beside the reference, not by
  its numbers matching.** The nearctic snow at the script's own numbers read
  as frozen lakes.
- **HUD questions are DOM questions; blink questions are state questions.**
  Read `.command-button` titles; report `flashTarget` through `sim`. Three
  rounds of pixel sampling measured clicks that never landed.
- **Check filtering and mipmaps before hashing the source.** The "low-res
  grass" was `NearestFilter`.
- **A Group's renderOrder outranks every child's.** Express the layer on the
  mesh, groups at default, and verify layering with a pixel probe where the
  wrong order shows a colour the right one hides.
- **A per-tile coin turns a seam into a wave.** Random phases per shore
  tile made every tile's crest leap on its own; a gradient along the coast
  then marched the atlases' own cut down the shore. Find the seam in the
  data first, then decide what varies per tile.
- **A tie-break added on intuition re-creates the bug.** "Prefer the living"
  made carcasses unclickable again, because eaters stand on them.

## Before changing the simulation or the generator

- **Anything a tile grid reads is snapped when placed, not rounded when
  read.** Fractional resources blocked four tiles each.
- **When an obstacle becomes real, the target picker learns it too**, with a
  cheap footprint-perimeter check rather than a path per tick. Check outside
  the whole footprint: four lookups beside a deep fish's centre were still
  inside the fish itself, so automatic continuation rejected it (#87).
- **An automatic continuation is bounded by sight.** If nothing is visible
  within a stated distance, idle is the right answer; reaching further is a
  decision and belongs to the player.
- **A memory kept because the thing can vanish covers everything read off
  it.** `lastWorked` remembered the kind and not the resource, for a year;
  fishing also needed the working position after a node vanished during banking
  (#87), so its replacement search happened at sea rather than at the dock.
- **A condition gated on a "something happened" flag needs proof the flag
  covers every way it happens.** Combat never set `newlyDead`; a razed town
  ran the full half hour.
- **Let a walker squeeze out of scenery, never through somebody's wall.**
- **The final approach may enter a footprint, never ground the walker cannot
  stand on**; when the line leaves the ground it slides along the bank
  (`moveTowardOnGround`).
- **A passability row that admits open water is a boat's, and a boat is
  afloat or nowhere**; a row that admits the sea is a shore building's. The
  table is one field for passability and buildability.
- **A cosmetic feature gets its own random stream** derived from the match
  seed, and a test that the object layout for a seed is byte-identical across
  it. The biome draw once re-dealt every board.
- **A randomness fix that breaks tests has found something.** Mixing the
  seed exposed double-planting on the mirror line.
- **A performance fix proves it changed nothing else**: same total order
  (f, h, tile index), three seeds to twelve thousand ticks, byte-identical
  checksums.
- **Switch one suspect off before reasoning about which layer "must" be
  slow.** The 120x120 slowdown was the minimap stroking fourteen thousand
  paths.
- **"Small maps" in a comment is a date.** Re-read size-justified choices the
  day the size changes.
- **Read what the script asks the engine to do, not only the numbers.**
  `create_terrain … number_of_tiles` grows a wood; scattering 55 trees is 36%
  density. A straight edge nothing in the reference has is a hard limit the
  script has a field to soften (`border_fuzziness`).
- **Reassigning a list inside `for...of` filters nothing.** Filter before the
  loop or keep a mask.
- **Distances are a gameplay rule.** A strategy tuned on toy distances is not
  tuned.
- **A strategy that repairs its own units hides the bugs in the units'
  rules.** The idle lumberjack cost the AI nothing and the human everything;
  a player-facing defect is measured where the player meets it.
- **A watcher polling faster than the simulation resolves sees the state in
  between.** Hold an announcement until the outcome, not the first frame.
- **Map resolution and simulation density are separate decisions**
  (`bakedTreeStride`), and **minimap dots scale with the board**, one-pixel
  floor.

## Before tuning a strategy

- **When a measure does not move, print the state over time instead of
  adjusting the theory.** Four draws were "armies too small" for two rounds
  of tuning; the cause was population 5/5 in the first four minutes, four
  causal steps upstream. Two batches without movement → instrument.
- **The batch's headline is not the test suite.** Keep a fixed adversary
  whose defeat is not negotiable; aging up once made the AI unable to beat
  an opponent that did nothing, for four separate reasons.
- **Measure the baseline before calling a number bad.** Twelve hundred wood
  banked was the opening's buildings, correctly.

## Before writing or trusting a test

- **A network test uses the wire codec.** `structuredClone` preserves
  undefined properties that JSON drops. Their later insertion order produced
  different raw-JSON checksums for identical game values (#153); shared-play
  tests now cross JSON, and synchronization hashes order object fields.
- **The test measures the outcome, never the intermediate table.**
  `unitRulesFor` returned 5 after Fletching; combat read
  `state.rules.units[kind]` and dealt 4 for the match. Hit points lost, food
  banked — not the lookup.
- **A feature reached through a button is verified by pressing the button in
  a running page.** Five green sim tests and a greyed train button.
- **When a class of entity becomes interactable, walk every layer that
  resolves it by id** — picking, `applyCommand`, the tick loop — and test the
  command entry. A predicate test and a click test together leave the middle
  unrun.
- **Assert the invariant, not the inventory.** A pinned roster fails on every
  addition and says nothing.
- **A fixture searches for its preconditions and asserts it found them**
  (clear ground, within sight); a hardcoded offset tests the board.
- **A hand-listed predicate gets a completeness test** (`isBuilding` missed
  the palisade; every `FALLBACK_RULES` key answers to it).
- **A probe that stages state asserts the page resumed it**, and imports the
  snapshot version from the loader rather than copying it. A silently
  declined snapshot photographs an ordinary opening.
- **A timeout under a CPU-bound job is contention before it is a
  regression**; and a green run can exit 1 when the worker's RPC starves
  (`src/test-setup.ts` yields a macrotask after each test for that).
- **A widened fixture clock is a finding.** Name it in the report.
- **The renderer's own walk over fog memory is invisible to every protocol
  check** — `observe` filters it and the canvas does not — so a bug there
  (#17, a claimed sheep still drawn as a memory) is found only by looking.
  Test the renderer's filter directly.

## Before starting, waiting on, or restarting a job

- **Start with a handle, wait on the handle** (`AGENTS.md`). A `&` job dies
  with the shell the harness times out; a job meant to outlive its command is
  started with `setsid` writing an exit file and waited on from a separate
  command.
- **A monitoring timeout is not a job failure.** The six-plus-minute gate
  repeatedly outlived 120-second sentinel waits while every stage passed. Use
  a 600-second wait with a longer tool timeout, and a fresh exit-file name so
  a previous run cannot satisfy the new wait.
- **Before restarting a job that "seems stuck", look at the process table.**
  Three atlas conversions once ran at once and looked exactly like a hang;
  Python logs are block-buffered — pass `-u`.
- **Decoder edits cost the hour; batch them and run them first, alone.**
- **`convert_sld.py --terrain-only` for a terrain slot**; the full pipeline
  for everything else, and always the pipeline, never one step.
- **The gate runs on an idle machine.**
- **Managed restart loops are workload too.** Inspect `systemctl --user`
  state and `NRestarts`, not just a momentary process list: the shared host
  retried an incompatible checkpoint thousands of times while session-start
  reported nothing running (#157/#158).
- **Guest free space is not backing-drive headroom.** Ubuntu showed 891 GiB
  available inside its expandable VHD while Windows C: had 5.9 GiB left.
  Check the host volume before large imports/build copies; deletion inside
  Linux does not necessarily shrink the VHD immediately. This establishes
  storage pressure, not the cause of a machine-check panic.
- **After a disconnect or reboot, recheck the job handle before waiting.**
  An interrupted gate left a NUL-filled log and no process; an old tool wait
  was not evidence of a live job. Use a new named log/exit file when restarting.
- **An asset set that grows fourfold breaks whatever loaded it all at
  once.** The pack's 5.5 GB of sprite pages, fetched up front as the x1
  set had been, took the WSL VM down inside the gate's browser step (the
  "core dump" of 2026-09-20). After an import that changes the art's size,
  sample `free` during `debug:smoke` before running the gate.
- **A single-threaded hour on twelve cores is a loop to parallelise, not
  a wait.** The x2 conversion paced at five hours on one worker; four
  workers took 57 minutes, and the change was outside the decoder's
  fingerprint.
- **Killing a wrapper shell leaves its Python child running.** `kill` on
  `import_aoe2.sh`'s PID left `convert_sld.py` converting at full speed;
  read the table after a kill and kill the child by its own PID.
- **Never edit a shell script while it is running.** Bash reads a script
  incrementally, so an edit to `tools/gate.sh` mid-run hands the running
  copy a different file from the offset it had reached; kill the run,
  edit, restart. The sentinel guards against the other half: anything
  edited after a gate *started* counts as untested.
- **More than two or three DAT questions is a one-shot script.**
  `tools/datq.py` reloads the DAT per call; fourteen calls beside a running
  gate hit the tool timeout.

## Before declaring something done

- **Reproduce the visual symptom before selecting a cause.** The first #88
  regression proved late shadow textures could arrive in fog, while the
  human's comparison still showed crowns sliced by the ground-fog overlay.
  Comparing opaque canopy pixels with and without ground fog caught the
  reported defect; the loading test did not.

- **Do the user's action, not the assertion you just wrote.** A real click
  found what two verified layers missed.
- **When a check needs a third attempt, stop sampling the consequence and
  report the decision** — grow the protocol.
- **A multi-edit patch script reports per-edit hit or miss and writes what
  succeeded.** One that asserts and writes once shipped a commit that
  claimed to wire `accuracyPercent` and did not.
- **A zero-context patch places an insertion by line number and says
  nothing.** Stage a subset by rebuilding the file from the index with
  content anchors; gate it from a tarball of the tree, never a stash.
- **Counts in a report come from commands** (`git rev-list --count`,
  `grep -c`), and the clock from `date`. Four of five morning reports
  miscounted; one wrapped a nineteen-hour run at dawn on a narrated clock.
- **A report names a reachable path.** "Look at seed 3" with no `?seed=`
  cost a question.
- **List what was not verified**, every approximation introduced, and every
  fixture clock widened.

## Before committing and handing off

- **A doc that names a path checks the path is tracked**
  (`git ls-files --error-unmatch`). Tooling worth a doc is worth committing.
- **Read the gate's status on the line after it, never through a pipe or a
  `:`** (`AGENTS.md`); the script exists because prose did not hold.
- **Never rebase published commits**; integrate worktrees by merge or
  cherry-pick, and check `git log origin/main..` before any history edit.
- **A hand-off prunes.** Every consolidation that only appended left the next
  session a wrong queue; delete what is no longer true and cross-check the
  tracker.
- **`gh issue view` fails on the Projects GraphQL deprecation; use
  `gh issue view --json` or `gh api`.** **A `.ts` probe in the scratchpad
  fails under tsx's CommonJS transform; write probes as `.mts` under
  `.local/probes/`, where puppeteer also resolves.** Both cost a failed call
  in three sessions.
- **Python tooling is the locked uv project**: dependencies in
  `pyproject.toml`, everything through `uv run --locked`.
