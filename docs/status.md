# Project status

Delivered scope, measurements, compatibility evidence, and known
discrepancies. Gaps that represent work to do live in `backlog.md`.

## Run and play

```bash
npm install
npm run dev
```

- Public open-content URL: <https://empires.gszep.com/>
- Canonical local/imported desktop URL: <http://localhost:5173/>
- Tailnet/mobile QA URL (preserved): <https://calcifer.tail6e864b.ts.net:5173/>

Controls and hotkeys are listed in the root `README.md`. The essential loop is left/drag selection, right-click context orders, villager build commands, town-center/barracks training, and destruction of the opposing town center. `F10 → Load replay…` plays a headless record and checks its periodic hashes.

## Delivered scope

- Fixed-tick deterministic 1v1 simulation with integer resources, gathering/drop-off/depletion, building placement/construction, population, production queues, and rally orders.
- Deterministic tile A*, footprint obstruction, repathing/separation, DAT armor classes/minimum damage, discrete windup/release/cooldown, corpses, and defensive acquisition.
- Authoritative explored/current visibility, filtered observations, and legal last-seen memory.
- Patch-matched DAT rules, palettes, and AoE2DE entity/widgetui assets through a byte-identical local import; open fallback remains playable.
- WEST/Dark Age desktop composition with dimetric world, task animations, composite town center, fog, command/selection panels, minimap, menus, hotkeys, pointer interactions, and landscape scaling.
- Hunting is the DAT's hunter, not the plain villager: unit 122 (`VMHUN`) carries a three-tile reach and projectile 509 where the base villager (83) has neither, so a villager sent at game looses an arrow and draws the bow while doing it. That reach is also why a hunt now ends — a hunter no longer has to touch a moving deer. Working a herdable draws the shepherd instead (unit 592, `VMSHE`, task class 58), crook and all. Both projectile 509 and the tower's 504 draw `p_arrow_x1`, so the arrow already imported serves both.
- A deer is startled rather than chased off. The reference startles one from a single tile, moves it about a tile and a half, and then leaves it alone for 14 to 20 seconds; the trigger matches the DAT exactly, where a deer's `search_radius` is 1.0 against the sheep's and boar's 4.0. The hop distance and the rest are the community reference's numbers ([AoE wiki](https://ageofempires.fandom.com/wiki/Deer)), not the owned files', and are recorded here as such. What this replaces was a hand-picked five-tile flee re-issued four times a second, which walked a deer away from its hunters for as long as they followed and let one be caught only against an obstacle.
- A carcass rots by how much of it has been eaten, not by the clock. The DAT's decay graphic is thirty frames at a second each, measured from a whole body at frame 0 to 7% of its pixels at frame 29; AoE2 spends that half minute because its carcasses lose food to time, while ours keep every unit of food until somebody gathers it. Running the art on its own clock therefore reached the last frame while a boar still held three hundred food. The thirty stages are now spent across the food instead, so the corpse lasts exactly as long as it is worth something and how eaten it looks is how eaten it is (verified in the running game: frame 5 of 30 at 82 food, frame 28 at 6, then gone).
- A hunted animal's carcass is selectable for as long as there is food on it (issue 14): it takes the flat marker of the DAT's own corpse unit rather than the live animal's ring, shows the food remaining, and carries no health bar — `BOARX_D` has no hit points and obstructs nothing where `BOARX` obstructs like a unit. A corpse with nothing left, and a soldier's corpse, stay unclickable: in the DAT only huntables and herdables store food, and here only a carcass keeps an `amount`.
- Selection markers follow the DAT's obstruction shape: a round outline under units (obstruction type 5), the `outline_size` box drawn on the ground under buildings and resources — the box the DAT draws slightly larger than the collision box, and a gate's spanning its whole four-tile run. An enemy told to expect company blinks its own marker — only somebody else's, since a tree or your own mill blinking on every right-click is noise over the one question the flash answers, which of a crowd a group was just sent at. Its cadence and colour are approximated (0.2 s on/off for 1.2 s, in the marker colour) because no owned file states them — the DAT's `unit_selection_color_1/2` hold the unused palette index 0, and widgetui defines no such widget, so the behaviour lives in the closed runtime.
- The Castle Age and what it opens: monastery, siege workshop and castle, and the knight, cavalry archer, longbowman, battering ram, mangonel and monk, each gated by the age the DAT's own enabling technology names. A monk heals and converts, a mangonel's stone lands with a blast, and a castle shoots and supports twenty population.
- The Imperial Age, researched at the town center for the DAT's own 1000 food and 800 gold over 190 seconds, and the twenty-four technologies that wait on it — the plate armour lines, Chemistry, Bracer, Siege Engineers, Hoardings, Conscription, and the eight upgrades that end their line at the champion, halberdier, arbalester, cavalier, elite longbowman, onager, capped ram and heavy cavalry archer. It opens no new building and no new unit, which is what the Britons' own tree says. Age advancement is data-driven off each technology's `grantsAge`, so this is the Castle Age's code path with the DAT's third row of numbers in it — but the age exists only in imported mode: **the open fallback's hand-written rules stop at the Castle Age**, and the Imperial tests skip without a manifest.
- Versioned JSON public contracts; browser, built-in AI, JSONL subprocess, deadline subprocess, WebSocket, and MCP strategies share `applyCommand`.
- Full-state FNV-1a periodic checksums, command-stream records, Node verification, and browser playback.
- Process-isolated paired batches with configurable concurrency, Wilson 95% intervals, strategy hashes, per-match results, and replay records.
- Opt-in live model boundary using existing machine authentication: one ephemeral/no-tools/no-session call, thinking disabled, compact filtered input, one constrained action, 64 KiB process-output ceiling, 120-second deadline, and no stored observation/response/credential.

## Deliberately omitted

The target does not include other civilizations, formations, naval play, campaigns, random-map parsing, multiplayer networking, diplomacy, relics, or a genetic-algorithm framework. Palisade walls and gates are built; stone walls and their gates are not. Of the technology tree the forty-eight technologies listed under “Ages and technologies” below are not researchable, with the reason recorded per technology; civilisation bonuses and team bonuses are not modelled at all, being no part of the tree. Mobile has no separate or simplified gameplay. All SLD layers convert through the local decoder.

## Measurements and gate evidence

Measured on calcifer. Every number here is from the current board (120x120,
about 310 entities); anything older is not comparable, because the map size
changed underneath it.

- 16 paired-seed matches in concurrent Node processes, re-run after the shot
  model, the technology tree and the DAT's corpse lifetimes: **16 decided, 0
  timeout draws, 0 replay checksum failures**, mirror win rate 0.5,
  **393x aggregate real time** (43.4 seconds of wall clock for 17,058 simulated
  seconds). The zero replay failures are the load-bearing number: every one of
  those matches re-simulates to the same checksums after a session that changed
  how every shot is aimed, what sixty-six technologies do, and how long a body
  lies on the ground. Corpses lasting five minutes rather than three seconds cost
  nothing measurable — throughput went up, not down.
- **The built-in AI researches now, and the batch is decisive again.**
  **16 of 16 decided, 0 timeouts, 0 replay checksum failures**, a 0.5 mirror
  win rate at 340x real time, with **Loom in all 32 player-slots, the Feudal
  Age in 28 and Man-at-Arms in 10** — against a baseline where the strategy
  never researched anything at all.
  **No match reaches the Castle Age**, where the queue asked for at least one,
  and the reason is the opposite of the earlier failure: matches now *end*
  before eight hundred food is banked. The Castle Age is demonstrably
  reachable — a test drives the strategy into it, and earlier configurations
  reached it in four to six of sixteen matches while running out the clock in
  four to six others. That trade-off was measured across seven configurations
  and the economy end of it is exhausted: more farms and more villagers buy
  the Castle Age with draws, every time. What would buy both is a strategy
  that can finish a won game faster, which is `overnight.md`'s first item.
- **The population cap was the thing throttling all of it.** Housing was built
  only when one place was left, and a house takes time to raise, so a match
  opened at 5/5 population for its first four minutes — with one villager on
  wood earning about ten wood a minute, which is four minutes to afford the
  next house. The barracks did not go up until minute twenty and neither side
  ever trained a soldier. Housing now comes before anything else wood is spent
  on, and is bought three places ahead of the cap. That one change took the
  batch from 12 of 16 decided to 16 of 16.
- Per-tick cost over a full 900-second match (seed 102): median **0.58ms**,
  p99 **1.72ms**, worst **11.7ms**, against a 50ms budget at 20Hz. The median
  was never the problem; the worst tick is the number to watch, and it was
  105ms before the pathfinder's open list became a heap. **These three figures
  are stale and name the wrong session**: they predate the shot model, the
  sixty-six technologies, corpses that last five minutes rather than three
  seconds, and an AI economy roughly three times the size. The batch
  throughput above is the number that has been re-measured, and it went *up*
  (334-404x against 364x), which is weak evidence that nothing has regressed —
  but it is aggregate wall clock across sixteen processes, not a tick
  distribution, and it would not show a worst-tick spike. Re-measuring the
  per-tick cost is queued in `overnight.md`.
- Forests are solid: seed 7 grows two clumps of exactly 55 tiles, no row has a
  clear line through, and crossing one costs 1.66x the straight line while
  never stepping on a tree.
- Browser, headless Chrome on SwiftShader at 1280x800: about **16 ticks a
  second at Slow** and **170 at the 10x fast-forward** — the ratio is the
  meaningful part (the speed control scales as it should); the absolute rate is
  software rendering and is not a claim about a desktop GPU. Measured again
  after the default moved to Normal: **25.3 ticks/s at the default against 17.5
  at Slow, a ratio of 1.45** where the setting asks for 1.50 — the shortfall is
  the same software-rendering ceiling (Slow itself only reaches 0.87 of its own
  target), not the multiplier.
- Browser file replay reported `Replay verified: 1 checksums match` for a
  six-second imported-rules record.
- 844x390 landscape Chrome smoke retained the complete top bar, world, command
  frame, and minimap.
- Opt-in live-agent scenario completed successfully through the authenticated
  provider with one schema-valid command.

Batch artifacts are intentionally ignored under `.local/batches/`.

## Compatibility evidence and discrepancies

The importer integration resolves every consumed DAT graphic/rule and widgetui source, hashes inputs, and regenerates byte-identically. Viewer smoke tests loaded imported atlases and WEST UI without application console errors; selection, gather orders, fog expansion, and browser replay were exercised through Chrome DevTools Protocol. Timing, resource conservation, hidden information, pathing, combat release, protocol validation, and replay determinism have focused tests.

Known discrepancies are single-terrain ground without the multi-terrain blend masks and missing fire delta overlays on damaged buildings.

**Game speed** is the fifth. The owned files settle how many settings there are
and which one is the default, but not what they multiply by. `stringreference.json`
maps `IDS_SLOW_SPEED`/`IDS_NORMAL_SPEED`/`IDS_FAST_SPEED` to strings 13101-13103
("Slow", "Normal", "Fast"), and the hotkey strings 20033-20036 name four —
"Set Speed to Slow", **"Set Speed to Default"**, "Set Speed to Fast", "Set Speed
to Extra Fast". That the second setting is the one the game calls *Default* is
owned evidence, and it is why the match no longer starts at 1x, which is the
Slow setting and the reason play felt sluggish. The multipliers are engine
constants in code this project does not read, so the four values used —
1.0 / 1.5 / 1.7 / 2.0 — come from community references
([Steam](https://steamcommunity.com/app/813780/discussions/0/624417180895682149/),
[AoEZone](https://aoezone.net/threads/definitive-edition-game-speed.156338/)),
which agree on the set while disagreeing on whether the standard tournament
speed (Fast) is sometimes called "normal". Every duration the DAT states — a
25-second villager, a 130-second Feudal Age, 0.31 food a second — is in game
seconds, so the multiplier is the only thing standing between that data and the
pace a player feels.

**A foundation's line of sight** is the sixth. The DAT carries one
`line_of_sight` per unit and no construction-time variant — `unit.building`
holds the construction graphic, sound, foundation terrain and rubble, and
nothing about sight — so the owned data does not distinguish a foundation from
a finished building either way. A building under construction is given no line
of sight here, on the playtest report in issue #1 and because the alternative
makes throwing down foundations a free scouting tool, which DE's own community
reports as an exploit. It is a rule chosen against observed behaviour, not an
imported number.

Four Castle Age behaviours are approximations, because the owned files carry the
numbers but not the rules that use them:

- **A conversion's odds.** The DAT gives the monk's window — the earliest second
  a conversion may succeed (5) and the second by which it must (9) — but not the
  roll between them. The simulation spreads it uniformly across that window, so
  both ends are the DAT's and only the shape between them is chosen. Breaking
  off loses the progress.
- **Blast falloff.** `blast_width` (1 tile for the mangonel) is imported and
  everything inside it takes the full hit, including the shooter's own side, as
  in AoE2. What the neighbouring `blast_attack_level` implies about damage
  falling off with distance is not stated in the owned data, so there is none.
  Blast does not reach buildings.
- **The villager's build menu is split into an economic and a military page.**
  Seventeen buildings do not fit AoE2's fifteen-slot command panel, and the
  original splits them the same way; the DAT's `interface_kind` is a different
  grouping (it puts the blacksmith and monastery with the mills) and does not
  state this split, so the page each building sits on follows the reference
  game's UI rather than an owned file.
- **A monk shows no contour when something stands in front of it.** Its idle and
  attack outline layers are the only two of the consumed sources that fail the
  decoder's own walk invariant (`covered 0 of 7 blocks, consumed 11 of 11
  bytes`), so they are recorded in the manifest's `skippedMasks` and the monk
  simply draws without the occlusion contour every other unit gets.

The ground samples the imported DAT terrain texture (slot 0, `Grass`/`g_grs`) at the authored `terrain_dimensions` tile span; `terrain/blends` and `terrain/masks` are not consumed, so terrain-to-terrain transitions are absent rather than approximated. The DAT gives each terrain a `blend_type` (grass 0, both farm slots 1) and a `blend_priority`, but nothing in the owned files maps a `blend_type` to one of the ten files in `terrain/blends/`, nor says how a 512x512 blend is indexed against a tile — its shapes are irregular parcels that straddle every even split. `overlay_mask_name` (grass -> `masks/grass.png`) is a noise texture, and the `terrain_unit_masked_density` field beside it suggests it drives decorative scatter rather than the ground's appearance. Farms are terrain too (slots 7 and 29, `Farm1`/`Farm Cnst1`): the DAT gives them no SLD, so they draw as their own patch of the isometric grid.

### Player colour comes from the game palette

Player colour is a palette substitution, not a tint. Two measurements settled
how:

- The SLD player-colour layer is **coverage**. Its interior is a solid 255 and
  only the BC4 block edges carry intermediate values, so it says *where* the
  owner's colour goes, not how bright it is.
- The **main graphics layer** carries the shade: under full coverage those
  pixels are neutral greys (mean channel spread 1.8 on the barracks, 6.8 on the
  militia) whose range tracks the rest of the sprite's shading.

The ramp that grey indexes is the game palette's eight-shade block at the DAT's
own `player_colours[i].player_color_base` — `original.pal` 16..23 for player
one, `(0,0,82)` through `(205,250,255)`, the colours AoE2 has always drawn blue
player colour with. The DAT's `minimap_color` for the same players resolves
through that palette to pure blue, red, green, yellow, cyan, magenta, grey and
orange in order, which is what confirms the ordering rather than assuming it.
The 16x16 blends in `playercolor_*.pal` are DE's editable hue-to-target table
and are **not** consumed: nothing a sprite carries indexes them.

`convert_sld.py` therefore packs the player-colour sheet as the main layer's
grey in RGB and the mask's coverage in alpha, and `import_content.py` emits each
player's block plus the grey player's block as the shade axis. The renderer
resolves the grey to a 256-texel ramp per player and samples it in a TSL node
material, so one texture read gives both the shade and the coverage. A militia
now renders 357 distinct blues from its own palette block where it previously
drew one flat `#1a6cff`.

The town center's own art carries no player-colour layer: its colour is entirely
in its annex pieces, which is why it used to render grey. Each annex now draws
its own player-colour sheet through the same ramp, and a pixel sample over the
building returns 3,258 player-blue pixels in 2,783 shades.

Art the engine draws itself has no unit to resolve it from, so `import-spec.json`
gained an `effects` section that finds a graphic by its own name and refuses a
name matching anything but exactly one. The gather-point flag is the first:
`WaypointFlag Britons`, 90 frames, drawn at a selected building's rally point in
the owner's colour.

### Every production building trains its Dark/Feudal list

Audited against `creatable.train_locations` for the imported civilisation, which
is the only list that counts — the DAT's `unit.name` fields are AoK leftovers
that never moved with the ids, so unit 7 is called XBOWM and draws
`u_arc_skirmisher_*`.

| Building | Trains in this slice | Left in the DAT |
|---|---|---|
| Town center | villager | herdables (sheep, goat, turkey…) |
| Barracks | militia, spearman | man-at-arms and above, eagle scout, civ uniques |
| Archery range | archer, skirmisher, cavalry archer | crossbowman, elite skirmisher, hand cannoneer |
| Stable | scout cavalry, knight | camels, light cavalry, civ uniques |
| Siege workshop | battering ram, mangonel | scorpion, siege tower, and the upgrades of both |
| Monastery | monk | relics, and every monastery technology |
| Castle | longbowman (the British unique) | trebuchet, petard, other civs' uniques |
| Market | trade cart | trade cog (water) |
| Mill, lumber camp, mining camp, house, outpost, watch tower, blacksmith | nothing | nothing |

What is left out is age-gated or another civilisation's, which is the omitted
scope above — except the herdables, which are their own item.

### The civilisation is the Britons, and it is what the tree withholds

The importer has always read civilisation 1's units, and the DAT calls civ 1
"British" — so every stat in the game has been the Britons' all along without
anything saying so. Now it says so: the manifest names the civilisation, both
players start on it, and it rides in the match config, the observation and the
match record, so a replay rebuilds the match the way it was played.

What a civilisation *is*, mechanically, is mostly what it does without. The
depot ships a tech tree per civilisation beside the DAT
(`CivTechTrees/BRITONS.json`) and marks each node `NotAvailable` where that
civilisation does not get it. For the Britons that is ten technologies —
including Thumb Ring, Bloodlines, Crop Rotation and Stone Shaft Mining — eight
units including the Hussar, the Paladin and the Hand Cannoneer, and the bombard
tower. Those ids are imported and `applyCommand` refuses to research, train or
build anything on the list, naming the civilisation when it does.

Civilisation *bonuses* — the Britons' archer range, faster shepherds, cheaper
town centers, free Yeomen — are deliberately not implemented. They are not part
of the tech tree and are recorded in `backlog.md`.

Everything currently researchable or trainable is checked against that tree by
a test, so the game cannot offer something the Britons were never given.

### Ages and technologies

**Sixty-six technologies, and the list is the civilisation's own tree.** Three
were written out by hand here; now a `Research` node in `CivTechTrees/`
BRITONS.json names the technology, the building it happens at and the age it
appears in, and the DAT's effect commands say what it does. Nothing is
transcribed — not a cost, not an amount, not a prerequisite.

An effect command is an operation (set, add, multiply) on an attribute of
either a unit or a whole unit class, and most of the interesting ones are
class-wide: Loom is not "+15 hit points to the villager", it is "+15 to class
4", which is why every entity now carries its DAT class. The importer resolves
those against the entities this game has, so what reaches the rules is already
per-entity. Decoded that way, Forging is +1 attack against armour class 4 for
the melee classes, Fletching is +1 pierce attack, +1 range and +1 line of sight
for the archer classes, Wheelbarrow is x1.1 speed and more carrying, and the
Castle Age itself gives a scout and an outpost +2 line of sight and a watch
tower x1.2 hit points.

Prerequisites come from the DAT too: Iron Casting needs Forging, Bracer needs
Bodkin Arrow, Hand Cart needs Wheelbarrow. Without them a player could take
Blast Furnace without ever taking Forging and collect the same bonus for a
third of the clicks. The command refuses it and the panel does not offer it.

A building reads its own rules through research the way a unit does — hit
points, line of sight, armour, and every field of its attack. That was worth
finding: Arrowslits and Heated Shot imported correctly and then landed on
nothing, because only hit points were being applied. The same sweep found that
`tooClose` answered false for every building, so the tile of minimum range the
DAT gives a watch tower and a castle was never enforced and Murder Holes had
nothing to take away. Both are fixed, and a tower will now not shoot somebody
stood against its wall until that technology is researched.

The university is built now, and it is the technologies that made it worth
building: it trains nothing, and Ballistics, Chemistry, Masonry, Architecture,
Heated Shot, Arrowslits, Siege Engineers and Treadmill Crane are researched
there.

What the tree offers and this game cannot hold is recorded rather than dropped,
and each entry in `skippedTechnologies` says what that technology was actually
asking for rather than only that it was refused. Forty-eight of them, in four
groups:

- **Sixteen the British do not have** — the tree's own `NotAvailable`.
- **Eleven researched at the dock**, which is not imported.
- **One that upgrades to a unit that is not imported** (the heavy scorpion).
- **Twenty whose effects reach nothing here**, and these divide further, which
  is only visible now that each says which attribute it wanted and on what:
  - *Six change a player resource rather than a unit attribute.* Coinage,
    Banking and Guilds adjust a market fee; Faith, Devotion and Theocracy
    adjust conversion resistance. These are effect command **type 1**, a
    resource modifier, and this importer reads only types 0, 4 and 5 (set,
    add and multiply on a *unit* attribute) and type 3 (upgrade unit). Type 1
    is a category it never looks at — so these are not blocked on modelling an
    attribute but on reading a kind of command at all, and one change would
    unlock all six.
  - *Two more also decode to no attribute at all* and are not type 1: Fortified
    Wall upgrades to a stone wall this slice does not build, and Spies/Treason
    buys information rather than changing anything.
  - *One wants an attribute this game does not model on something it does
    have.* Herbal Medicine wants attribute 108 on the town center and the
    watch tower — garrison healing.
  - *The remaining eleven target units this slice has no equivalent of*: Horse
    Collar and Heavy Plow change the work rate and carry capacity of units 214
    and 259 (the farm's own gatherers), Guard Tower and Keep raise the attack
    of tower units we do not import, Siphons and Warwolf belong to siege units
    we lack, and the last five — Careening, Carvel Hull, Clinker Construction,
    Dry Dock and Shipwright — are naval.

A technology that keeps some of its effects and loses others carries an
`unmodelled` list naming the attributes, so a half-applied technology says so.

**Which technologies exist is now a property of the content**, so the command
schema names a technology by string where it used to enumerate three. The
contract that replaced it is that every technology the rules offer is a legal
command, which a test asserts.

**An upgrade is not a modifier, and it now works like one isn't.** The tree
states these as `UnitUpgrade` nodes rather than `Research`, naming the
technology that performs one separately from the unit it produces, and the DAT
states the swap as an `upgrade unit` effect command — the same command the age
technologies use on buildings. Researching one turns every militia a player
owns into a man-at-arms where it stands, keeping the damage it had taken
rather than being healed by promotion, and the barracks stops offering the
militia at all. A unit that exists only as the far end of an upgrade cannot be
trained before it: the DAT gives the man-at-arms no enabling technology of its
own, so without that rule it would sit in the Dark Age barracks beside the
unit it replaces.

**Fifteen unit upgrades are researchable**, each at its own building for the
DAT's own price, and every chain the Britons actually have is complete:

- militia → man-at-arms → long swordsman → two-handed swordsman → champion
- spearman → pikeman → halberdier
- archer → crossbowman → arbalester
- skirmisher → elite skirmisher, scout cavalry → light cavalry
- knight → cavalier, cavalry archer → heavy cavalry archer
- mangonel → onager, battering ram → capped ram
- **longbowman → elite longbowman**, the civilisation's unique unit

Each brings its unit with its art, its icon and its own selection and training
voices out of the owned audio, and each is refused before its own predecessor:
the DAT states those chains and nothing here transcribes them.

Two things that shape looked wrong and was not. The Champion technology
carries *four* upgrade commands — militia, man-at-arms, long swordsman and
two-handed swordsman all become champions — which is the DAT being thorough
rather than a mis-decode: anything still standing gets promoted. And the elite
longbowman is not a `UnitUpgrade` node at all but a `UniqueUnit` one carrying a
trigger tech, where the plain longbowman is a `UniqueUnit` with none, because
it simply exists.

What is left skipped is naval — the dock and its ships — plus the scorpion
line, and the four the Britons do without (hussar, paladin, siege ram, siege
onager), which their tree says outright.

Which age a thing belongs to is not a list here either: the importer finds the
"(make avail)" technology that enables each unit and reads the age technology in
its requirements. That makes market, blacksmith, archery range, stable, watch
tower, archer, skirmisher, spearman, scout cavalry and trade cart all Feudal;
monastery, siege workshop, castle, knight, cavalry archer, longbowman, mangonel
and monk all Castle; and barracks, house, mill, camps, outpost, farm, militia
and villagers Dark — which is exactly DE's tech tree for this slice. The
battering ram has no enabling technology of its own and imports as Dark Age; the
siege workshop it is trained at is what puts it in the Castle Age. Placement and training refuse
anything past the player's age, and the command grid hides it.

The built-in AI never ages up: it builds and trains only Dark Age things, so its
matches (and the batch measurements above) are unaffected by the gate.

### What the fog keeps

The DAT decides who lingers in the dark. In the gaia civilisation every
resource and every animal carries `fog_visibility` 1 — berries, gold, stone,
the oak, the sheep, the deer, the boar — while every unit and building a player
owns carries 0. So a wood or a gold pile you have found stays on your map at
the state you left it, and an enemy soldier who walks into the fog is simply
gone rather than standing there in a neutral pose (issue #4). The field is
imported per entity and asserted in `test_import_aoe2.py`, because a unit left
at the wrong value stands frozen with nothing failing.

Buildings are the exception the DAT does not state: they are 0 like every other
player-owned thing, and are still remembered as last-seen ghosts. That memory
is the engine's own record of the map rather than a unit flag, and it is where
the `buildProgress` and hit points a returning scout sees come from.

### A body lies there for as long as the DAT says

`kill()` gave every corpse a flat three-second window. A building's collapse
runs 8.3 seconds and a castle's 12.5, so a razed building vanished a third of
the way through falling down — and could never reach the rubble the DAT names
for it (`b_dark_barracks_age1_rubble_x1` and one for every other building).

The lifetime is stated, on the corpse unit rather than the live one: a
`resource_storages` entry of type 12 draining at that unit's own
`resource_decay`. It is 300 at 1.0 a second for every unit corpse in the file
and 60 for every building's rubble, and *only* dead units carry a type-12
entry — a live militia carries types 4, 11 and 19 instead, which is what says
this one is a clock and not a stockpile. Both numbers are imported and used;
the fallback three seconds now applies only to open content.

Five-minute corpses cost nothing measurable: the paired batch runs at 393x
real time, slightly faster than the 364x recorded before the change. A
huntable's carcass is unaffected either way — it keeps its food until somebody
eats it, and that rule already outlives this one.

### A shot is aimed once

Arrows used to steer: a projectile re-aimed at its target's live position every
tick, so nothing ever missed (issue #3). The reference is the opposite —
without Ballistics a ranged unit fires at the spot its target occupies at the
moment of release, and anything that is not standing still, or walking along
the line of fire, is missed ([AoE
wiki](https://ageofempires.fandom.com/wiki/Ballistics_(Age_of_Empires_II))).

The DAT carries both halves of it and neither was read before:

- **`accuracy_percent`** is the chance a shot is aimed true at all: an archer
  80, a crossbowman 85, a skirmisher 90, a longbowman 70, a cavalry archer 50,
  and 100 for a tower, a castle, a mangonel, a hunting villager and everything
  that fights hand to hand. Thumb Ring (tech 437, at the archery range) is an
  effect that *sets* that attribute to 100 for the archer classes, which is
  most of what that technology is.
- **`smart_mode`** on the projectile unit decides whether the shot leads a
  moving target. Every projectile ships at 0, and Ballistics (tech 93, at the
  university, Castle Age) is an effect that sets it to 1 on all forty of them.
  That is the whole of that technology.

A shot now flies to a fixed point and hits its target if the target's body is
still somewhere along the line it travels — which is what makes the reference's
three cases come out right: standing still is hit, walking across the shot is
missed, walking straight at the shooter is hit anyway. If it reaches its aim
untouched it lands, and whoever else is standing on that spot takes it instead.

**Ballistics is now researchable**, at a university, in the Castle Age, for
300 wood and 175 gold — which is what the DAT says. Measured: a watch tower
whose own accuracy is 100 shoots fifteen times at a villager walking straight
past it four tiles out, and lands *nothing* without the technology and 40
damage with it. The same fifteen shots either way; only the research differs.
The rule reads the effect rather than the technology's name, so it stays true
for any content that turns `smart_mode` on somewhere else.

**Thumb Ring, the other technology that changes this, the Britons do not
have** — their tree marks it `NotAvailable`, which is the real tech tree. So
accuracy is what the DAT gives each shooter and nothing in a Britons match
raises it.

**What a miss looks like is approximated.** The DAT states the odds but not the
scatter, so a shot that fails its accuracy roll is aimed one tile off in a
random direction. One tile is the board's own unit, and it is wider than any
unit and narrower than any building — which is why an arrow that goes wide of a
villager still lands inside the town center behind him, as in AoE2.

### The wonder is built, and wins nothing

Every number is the DAT's: 1000 wood, 1000 gold and 1000 stone, 4800 hit
points, five tiles across, 3500 build seconds spread across whatever villagers
are on it, Imperial, and slot 12 of the villager's economic page. It draws the
Britons' own `b_west_wonder_britons_x1`.

**It has no victory condition, deliberately.** AoE2's wonder starts a
countdown that ends the game, and adding one changes how a match can be won —
a product decision rather than an import, so it was put to the human and is
recorded in `backlog.md` instead of being taken here. A test asserts a
standing wonder wins nothing, so a countdown added later has to argue with it
rather than appear by accident.

### The trebuchet travels packed and shoots unpacked

The DAT keeps a trebuchet as two units — **331 `PTREB`** packed and **42
`TREBU`** unpacked — and states everything about each except which is the
other. So the pairing is named in the rules and every number is imported: 200
wood and 200 gold over 50 seconds at the castle in the Imperial Age, 150 hit
points, 0.8 tiles a second packed, and unpacked a sixteen-tile reach with a
four-tile minimum, a ten-second reload and 250 against buildings. Its stone is
projectile 371, `p_rock_x1`, at 3.5 tiles a second.

Packed it carries no attack at all, which is the DAT's own arrangement rather
than a rule invented here: a right-click on an enemy cannot become an attack
order, because the packed unit has nothing to attack with. Unpacked it cannot
move. Setting up or packing away takes the pair's own work rate, 4.5 seconds,
and nothing else happens while it does. Told to go somewhere, an engine that
is set up packs itself away first, as the reference does — but an order to
*attack* does not fold it up, because an engine already in range should shoot.

What the DAT does not say is which unit is the other one, and that is recorded
as the approximation it is. The pack/unpack task (`action_type` 109 on both)
names no target unit, and there is no `transform_unit_id` field.

Verified in the running game: the castle's panel reads `Train Trebuchet (200
wood, 200 gold)`; a packed engine's panel offers `Unpack (set up to shoot)`
and an unpacked one `Pack (fold up to move)`; and the two draw their own art —
`trebuchet/idle` on wheels and `trebuchet-unpacked/idle` on its frame, both in
player colour.

### The villager's build menu is the DAT's own layout

Selecting a villager offers two buttons — **Build economic buildings** and
**Build military buildings** — and opens neither until one is clicked, which
is what AoE2 does and what issue #25 asked for. Each page then lists its
buildings in the DAT's own order, with a Back button.

The layout is imported rather than arranged. Every building a villager can put
up carries a **build button id** in its `creatable.train_locations`, which is
its slot in the command grid. The DAT never says which *page* a building is
on, but it states the pages' shape: two buildings may share a slot only when
they are on different pages, and every collision in the Britons' list is one
economic building against one military one.

| slot | economic | military |
| --- | --- | --- |
| 1 | house | barracks |
| 2 | mill | archery range |
| 3 | mining camp | stable |
| 4 | lumber camp | siege workshop |
| 6 | farm | outpost |
| 7 | blacksmith | palisade wall |
| 8 | market | — |
| 9 | monastery | watch tower |
| 10 | university | — |
| 12 | wonder | — |
| 13 | — | castle |

That is also a check, and it found a real defect: the hand-written split this
replaced put the **blacksmith** and the **monastery** on the military page,
where the DAT's own numbers say they collide with the palisade wall and the
watch tower. A test asserts no page collides with itself, in both the imported
and the open rules, so the next building added cannot land quietly in the
wrong half. Walls and gates stay with the defences by the reference's
grouping: a wall is dragged rather than picked, and the DAT gives the gate no
build button at all.

### A fallow farm sown again, as an option that starts off

AoE2's own description of a farm is that it "provides a limited amount of food
before it goes fallow and must be rebuilt", and the DAT gives the farm exactly
one build location: unit 118, the builder villager, on button 6. The mill
produces nothing. So re-sowing from the mill is the engine's convenience and
not something the owned files describe — recorded here as the approximation it
is, and shaped as narrowly as the request allows (issue #24).

A player turns it on at one of their own finished mills, and it is **off until
they do**, so no existing match changes behaviour by itself. With it on, the
villager who empties a farm sows another where it stood and builds it, paying
the farm's own 60 wood; with too little wood, or the ground no longer free, it
falls through to the ordinary rule for what to work next. What the option
removes is the clicking, not the cost.

The toggle is a new `reseed` command — the player's own mill, and a boolean —
in the schema alongside the other six. Verified in the running game: a mill's
panel reads `Auto-reseed farms: off (60 wood each)`, and reads `on` after the
button is clicked.

### The mill's technologies, and the effect command that carries them

Horse Collar and Heavy Plow were among the forty-eight skipped, recorded as
"none of its effects reach anything imported". That reading was of the wrong
commands. The importer read effect command types 0, 4 and 5 -- set, add and
multiply on a *unit* attribute -- and both technologies are really made of
**type 1, the resource modifier**, which changes a player attribute addressed
by resource id.

The DAT states the whole of it, including a number this repo had hand-written
since the beginning:

- A farm's food is **resource 36**, and civ 1 starts it at **175** -- exactly
  the figure `FALLBACK_RULES` carried as a constant. It is a player attribute
  rather than the farm unit's storage, which is precisely why a technology can
  change it.
- **Horse Collar** (75 food, 75 wood, 20 s, Feudal) adds 75 to it.
- **Heavy Plow** (125 food, 125 wood, 40 s, Castle, and the DAT makes it
  require Horse Collar) adds 125 more.
- **Crop Rotation** would add another 175 and stays skipped, because the
  Britons' own tree marks it `NotAvailable`. That is the real tech tree, not a
  gap.

So a farm is 175 food, 250 after the collar and 375 after the plough, and a
farm already in the ground keeps what is left in it -- the research pays off
on the next one sown, as in AoE2. Verified in the running game: a mill in the
Feudal Age offers "Research Horse Collar (75 food, 75 wood)" in its panel.

Both technologies still record what they could not deliver. Heavy Plow's
`+1 carry capacity` for the farmer villagers is attribute 14 on DAT units 214
(`VFFAR`) and 259 (`VMFAR`), and this game has no farmer villager variant to
put it on, so it sits in the technology's `unmodelled` list rather than being
quietly dropped.

**This is the machinery Q5 was asking for.** Effect command type 1 is now
read; what the six technologies it names still need is their own resource ids
in `RESOURCE_ATTRIBUTES` and something in the simulation for a market fee and
a conversion resistance to change.

### An attacker stays with what it is attacking

A unit stopped moving the instant its target was inside the reach margin, and
a swing already under way was thrown away the moment the target drifted back
out of it. Together those made a unit with a real windup unable to land a blow
on anything that kept walking. A scout has 0.6 s of windup (frame delay 12 at
0.05 s a frame) and a villager covers 0.48 tiles in that time, which is
further than the 0.35-tile margin: the scout swung, lost the swing, closed the
gap, and swung again — for ever. Infantry hid it, because the DAT gives a
militia and a man-at-arms a frame delay of 0 and their blow lands on the tick
it starts (issue #18).

Two rules now, both narrow:

- **A swing is spent only while the attacker is in reach, and is not
  discarded when it is not.** Retasking aborts it, which is the reference's
  own rule ([attack delay](https://ageofempires.fandom.com/wiki/Attack_delay)),
  and that is handled where an order is given.
- **The reach margin is tolerance for landing a blow, not a place to stand.**
  An attacker closes to its weapon's own range — contact for a melee unit,
  four tiles for an archer — so the margin is slack it can lose without
  leaving reach.

Measured, scout cavalry against a villager walking steadily away, under both
imported and open rules:

| | before | after |
| --- | --- | --- |
| ticks between hits | 115 (5.7 s) | 40 (2.0 s, the reload) |
| hits in 60 s | 0 | 9, and the villager dies |
| moving/attacking flips | 663 | 1 |

The flip count is the other half of the report — each flip restarts the attack
animation, which is what "plays the very beginning of the attack animation,
then has to move closer, then plays the beginning again" was describing.

### A building has armour, and it decides what an upgrade is worth

Damage is scored class by class: for every class the attacker's attack names,
the target's armour of the same class is subtracted, and a class the target
has no entry for scores nothing at all. That is the reference's rule, and it
was already implemented — but the importer asked the DAT for a `combat` block
only when a unit *had an attack*, so of the nineteen imported buildings the
four that shoot carried armour and the other fifteen carried none.

A building with no armour entries matches no attack class, scores zero, and
falls to the minimum-damage floor. **Every building that does not shoot took
exactly one point of damage a hit, from anything** — a sword, an arrow, a
villager's hammer — and no blacksmith upgrade could move it (issue #26). Four
units and two animals were in the same position: a monk, a trade cart, a sheep
and a deer all have armours in the DAT and all of them were dropped.

Armour is now imported for anything that has it. What changed, in damage per
hit (the town center is here as a control — it shoots, so it already had its
armour and did not move):

| attacker | house | barracks | mill | archery range | palisade | town center |
| --- | --- | --- | --- | --- | --- | --- |
| villager | 8 | 6 | 6 | 5 | 4 | 3 |
| militia | 6 | 4 | 4 | 3 | 2 | 1 |
| man-at-arms | 10 | 8 | 8 | 7 | 6 | 5 |
| scout cavalry | 5 | 3 | 3 | 2 | 1 | 1 |
| archer | 1 | 1 | 1 | 1 | 1 | 1 |

Every number outside the last column was 1 before.

**A second defect sat behind the first, and the first fix's test could not
see it.** The attacker loop read `state.rules.units[kind]` -- the *base* rules
-- rather than `unitRulesFor`, so a researched attack upgrade changed what the
rules said and nothing a target ever felt. Measured: an archer dealt 4 to a
villager before Fletching and 4 after, while the rules read 5. The tower path
had always gone through `buildingRulesFor`, which is why Murder Holes worked
and this did not. `attackProfile`, `tooClose` and `updateAttacker` now read the
researched rules, and the regression test measures the **hit points the target
loses** rather than what the rules contain -- asserting on `unitRulesFor` is
what let this through the first time.

**The archer row is not a defect.** A house has 7 pierce armour against an
archer's 4, so an arrow scores the minimum whatever the blacksmith has said —
and Fletching, Bodkin Arrow and Bracer together only reach 7. That is why
archers do not raze towns in the original either, and it is the answer to the
half of issue #26 that reported upgraded arrows doing nothing to a house, a
barracks or a town center: they do nothing there because the DAT says so. The
upgrade itself does reach the shot, and is tested against a target whose
armour is below it.

The house is the sharpest illustration of the data being worth reading:
**-2 melee armour**, so a house takes *more* than a sword's face value.
Nothing would have invented that.

### Food on the hoof

Gaia's animals are units, not resource nodes: they walk, they can be killed, and
they carry the food the DAT stores on them — 100 for a sheep, 140 for a deer,
340 for a boar. Four sheep stand by each town center and four more further
out, with four deer and two boar on the map.

A herdable joins whoever comes closest, unless units of both players are within
range, in which case it stays gaia's — AoE2's rule — and then stands where it
is, ordered about by hand from then on (the reason is in `backlog.md`). Working
one turns it into a carcass on the spot, which is what the game does too. A
deer is startled from a tile away, hops a tile and a half and then grazes for
14-20 seconds; a boar answers a wound by charging whoever made it, arrow or
not, which is what makes luring one a decision. A carcass outlives the
three-second corpse window for as long as there is food on it, and any villager
may be sent to one. A villager working game draws the DAT's hunter (unit 122,
`u_vil_male_hunter_*`) and shoots with its bow; one working a herdable draws
the shepherd (592, `u_vil_male_shepherd_*`).

Two knowing simplifications: hunting and herding both bank at the forager's
rate and carry capacity rather than the hunter's or shepherd's own DAT numbers
(0.41 a second into 35, and 0.33 a second, where the simulation has one rate
per resource and one capacity) — the hunter and shepherd variants are art, not
rates — and the built-in AI does not herd or hunt at all. Both are recorded in
`backlog.md`.

### Trade pays what the road costs

The market trains the DAT's trade cart (unit 128, 100 wood + 50 gold, 51s), and
a cart ordered onto a foreign market shuttles: it loads there and banks gold on
reaching its own market. How much is the cart's own data rather than a constant
from outside it — `bird.work_rate` (0.2875 per second) for every second spent
travelling since its last delivery, capped at `resource_capacity` (100). A
longer route is worth more, as in AoE2. The engine's own coefficient (the
community's 0.46 gold per tile) is not in the owned files, so it is not used;
this is a documented substitution, not a match.

The remainder rides on to the next run, the way a villager's gather progress
does: flooring it away left a short route paying nothing at all rather than
paying a little.

AoE2 pays a cart at both ends of the route and ours pays only on arriving home,
which halves the delivery frequency at the same gold per second of travel. A
route the cart cannot walk — a market sealed in by trees, which the default map
can produce — ends the order rather than leaving the cart walking on the spot.

A death leaves what the DAT says it leaves: `unit.dead_unit_id` names a unit
whose standing graphic is the art left behind — `u_*_decayA_x1` for each unit
and villager task variant, `n_tree_stump_generic_x1` for a spent tree or berry
bush. The renderer plays the dying graphic once and then holds that art. Both
last only as long as the simulation's three-second corpse window — except an
animal's carcass, which stays while it still holds food and rots through the
thirty decay frames as that food is eaten — where AoE2 keeps a stump for the
rest of the match. Buildings are left out of the chain on
purpose: their death graphic is longer than that window, so rubble would never
be reached (see `backlog.md`).

### The outline layer is a contour, and it is for occlusion

The SLD outline layer is not BC-compressed like the others. Its payload is a
`u16` offset per 4x4 block row into a command stream, where a byte under `0x80`
skips that many blocks and `0x80|n` draws `n` of them from two bytes each — the
block's sixteen pixels, row by row, least significant bit first. Every row's
commands cover exactly its blocks and consume exactly its bytes; the decoder
raises otherwise, and all 78 consumed sources walk clean.

What comes out is a one-pixel contour lying *inside* the sprite (98% of the
barracks' lit pixels fall on opaque art, covering 18% of it), not a silhouette
and not a halo. That is what AoE2 draws through a building standing in front of
a unit, in the colour the DAT names in `player_colours[i].unit_outline_color` —
pure blue for player one, pure red for player two. The renderer shows a unit's
contour when a building or tree with a greater isometric depth covers at least
half of its art — the same sorting the painter's-order draw already uses. That
half is an approximation: a sprite's box includes its transparent margins, so
the real game's per-pixel test is what this stands in for, and a unit merely
brushing a tree's bounding box would otherwise light up. On a small sprite the
contour is most of the silhouette (86% of a villager's lit pixels), so a hidden
villager reads as a coloured shape, exactly as it does in the game.

### The import pipeline is openage-free

`tools/sld_layers.py` decodes every consumed SLD layer — BC1 main graphics
plus the BC4 shadow and player-colour masks — and was verified byte-identical
to the previously used openage decoder across all 29,783 imported frames
before the swap. The openage checkout, its C++/Cython build, and the
per-atlas subprocess isolation that guarded against its crashes are gone;
`tools/requirements.txt` is down to genieutils-py and Pillow.

Two format facts discovered on the way, both violated by
`b_west_stable_age2_x1.sld` (the file that crashed openage): the header field
the public documentation records as "unknown, always 0x10" is the frame-data
start offset (14 in the stable), and per-layer 4-byte padding is relative to
that start, not to the file. With both honoured, the stable's 90 frames walk
cleanly to the file's final byte; the stable and the scout cavalry it trains
are imported from it.

### Audio import is unblocked

Patch-matched sound depots 813783 and 813787 are now recorded and documented.
`tools/wwise_pck.py` reads their AKPK indices, while `tools/import_audio.py`
hashes the `sounds.json` event name with Wwise's lowercase FNV-1 ID, follows the
HIRC Event → Play Action → container/sound graph, and extracts only referenced
DIDX media. The externally installed, permissively licensed `vgmstream-cli`
then decodes that media to deterministic browser-playable WAV without vendored
decoder code.

Unit voices come from the DAT rather than from `sounds.json`, which holds only
UI events. Each unit carries `wwise_selection_sound_id` and
`wwise_train_sound_id` — already-hashed Wwise ids — so the resolver accepts an
id as well as a name. Those events cover every civilisation through a single
switch container keyed on `Civilization`, whose switch table is
`(switch id, count, children...)` records after a variable-length parameter
block; it is found by locating the group id and accepting only a walk where
every child is a real object. Narrowed to `Britons`, the militia's selection
voice is three files — exactly the three the DAT lists for civ 1 (`bvmms1..3`)
— where the unnarrowed event reaches 178. A switch value with no branch plays
nothing rather than everything, because the failure mode to guard is a silent
forty-language import.

Fifteen aliases are imported: a select and a train voice for each trainable
unit, plus the widget click. The view answers a selection and an order with the
same voice, which is what AoE2 does and what the DAT stores.

The first consumed cue is the widget-authored `button_ui` alias:
`Play_Button_UI` resolves in bank 232745270 to media 56802692 and decodes to a
0.239456-second mono 22.05 kHz cue. It plays for HUD command/menu clicks in the
owned-content mode; the open fallback remains silent. Integration tests verify
the source resolution and byte-identical regeneration. Ten feedback cues are wired from `sounds.json`: under attack for a unit and for
the town, population capped, farm depleted, gather point set, error, age up,
technology researched, victory and defeat. `src/view/cues.ts` raises them by
diffing observed state — hit points, researched technologies, population,
farms, the winner — so the simulation stays unaware of sound, and the watcher is
testable in Node without a browser. An attack alert stays quiet for ten seconds
after sounding, so a sustained fight is a warning rather than a siren, and the
first poll only records the world so a match resumed from a snapshot does not
alert for everything already damaged. `sounds.json` names no
construction-complete cue, so there is none rather than an approximation.

## The map

The board is 120x120 tiles, square, which is AoE2's "tiny" — the size two
players get. The game's own string table is where that number comes from: each
size's key encodes its tile dimension, `MAPSIZE_TINY` being 25120 next to
`MAPSIZE_SMALL` 25144 and `MAPSIZE_NORMAL` 25200.

The opening is laid out from `land_resources.inc`, the include every
Arabia-family random-map script pulls in for its player start. Its
`min/max_distance_to_players` become distance bands and its
`group_placement_radius` the spread, so each player gets six berries at 10-12
tiles, gold at 12-16, 18-26 and 25-35, stone at 14-18 and 20-26, four sheep at
10-12 and two more groups further out, four deer, two boar, and two forest
clumps of 55 trees — `PLAYER_FOREST_BASE_COUNT` times `PLAYER_FOREST_CLUMPS` at
their smallest. That is about 10,600 wood a side where the old board had 800.

Both halves are generated together, each object placed at its bearing and at
its mirror at once, so the two starts are exact reflections and neither can
land on the other. An object that finds nowhere to stand is dropped rather than
stacked: the script's count is what is asked for, not a promise the ground can
hold it. Everything sits in the middle of a tile, because a one-tile footprint
centred anywhere else straddles four tiles of the obstruction map.

Wood is the exception to "scatter over a disc". The script builds a forest with
`create_terrain`, which fills a contiguous area and puts a tree on every tile of
it, so a clump here is grown outward from a seed one free neighbour at a time
until it has its 55 tiles. The result is a wood in the AoE2 sense: seed 7's is
9x11 with no clear line through it in any row, crossing it costs 1.66 times the
straight line, and a path never once steps on a tree.

That is only true if nothing can walk into it, so a walker off the grid's path
may leave a blocked tile it is standing on but may not enter one — the escape a
unit needs to get out of a wood it was nudged into, without being a way in. And
a tree inside a wood is nobody's to cut: what a villager may work has to have a
free tile beside it to stand on, which is four grid lookups rather than a
pathfind across the whole wood, and it is why villagers eat a forest from the
edge inward.

Each player also starts with the scout the script gives them
(`create_object SCOUT`, one at 7-9 tiles). On a board this size it is not a
flourish. A town center sees eight tiles and the nearest berries are ten away,
so without something to ride out and look there is nothing known to gather from
and the match never starts.

*Not covered:* the middle of the map is empty grass. The script's neutral
forests and its relics, and the extra resources between the players, are not
generated.

## What the pathfinder costs

Three things made the 120x120 board stall, and all three were invisible at
32x18.

A one-tile resource placed anywhere but the middle of a tile straddles four
tiles of the obstruction map. Every tree, mine and bush did, so 276 resources
blocked 836 tiles and a forest was a wall with holes in it rather than
something to walk through. The map generator now snaps everything it places to
the tile it stands on: the same 280 resources block 312 tiles.

A tree inside a solid wood cannot be reached, and a villager sent at one used
to walk to the edge and shuffle there forever, re-pathing across the whole wood
every tick. Targets now need a free tile beside them, and a worker that gets as
close as the ground allows and is still out of reach takes the nearest thing it
can actually stand next to. Skipping that check cost the 99th-percentile tick
9.5ms; with it, 1.7ms.

The A* open list was a plain array scanned end to end for its minimum, which
the comment called "small maps" and meant it — the search was quadratic in the
size of its own frontier. It is now a binary heap ordered by the same total
order (f, then h, then tile index), so the node it pops is exactly the one the
scan would have found. Three seeds run to twelve thousand ticks give
byte-identical checksums before and after, which is the proof that this changed
no path, only what one costs.

Worst single tick across a full match, seed 102: **104.9ms before, 9.1ms
after**, against a tick budget of 50ms. The median was never the problem.

The third was the example AI siting its lumber camp on whichever side of the
tree a rotating list of bearings happened to reach first. A camp on the far
side leaves the walk exactly as long as it was, and the wood it cost is wood
not spent on a barracks; camps now go between the resource and home.

## Herdables

Which animals walk over to you and which have to be hunted is the DAT's own
line, not a rule invented here: task action type 107 — the auto-convert task —
is carried by the sheep (594), turkey, goat, llama, cow, pig, goose, chicken,
buffalo and capybara, and by nothing else. The boar (48), deer (65) and bear
(486) carry 6 and 7 instead. That is exactly the split the rules draw with
`herdRange` against `fleeRange`.

A claimed herdable stops where it stands and is its owner's to move from then
on: selectable, orderable, and left alone by the simulation. It used to follow
the nearest unit of its owner about, which meant every order given to it was
overwritten a quarter of a second later — the same as not being able to command
it at all. Nothing in the owned files describes following; that behaviour was
ours, and the conversion is the part the DAT actually models.

## Carrying on after the work runs out

When a villager's node is spent it looks for more of the same, and what counts
as "more" is bounded twice over. The nearest thing of the *same kind* wins
first — another sheep after a sheep, the next tree in the same wood — and only
then anything else yielding that resource. Nothing outside the owner's current
line of sight counts at all, however close, and nothing further than three
times the worker's own sight, which is about the width of one forest clump.
A worker with nothing in reach goes idle and waits to be told.

The same bound applies to building. A builder that finishes a piece carries on
to the nearest unfinished one joined to it, which is what builds a dragged wall
end to end, but not past what it can see: a foundation on the far side of the
map, joined to this one only by a wall somebody built an hour ago, is not
somewhere it sets off for.

This is the automatic behaviour only. An explicit order still sends a villager
wherever it is sent, and the example AI still tasks villagers onto nodes it
remembers through fog — that is a decision it makes, not something the unit
does on its own.

## A building wears its age

Ageing up in AoE2 does not restyle a building, it replaces it: the Feudal Age
technology (101) carries `upgrade unit` commands turning the barracks (12) into
"Barracks Age2" (498), the house into HOUS2, the mill into MILL2, and the town
center and each of its four annex pieces into their Feudal selves. Tech 102 and
103 do the same for the Castle and Imperial Ages. Reading those commands is how
each age's art is found — no unit id for a variant is written down anywhere in
this repository (issue #13).

The importer therefore gives every building an `idle-feudal`, `idle-castle` and
`idle-imperial` wherever the DAT names one, annexes included, and the renderer
picks the newest one at or below the owner's age. Not every building changes in
every age — a market first exists in the Feudal Age and is restyled only in the
Castle — so the lookup walks down the ages before falling back to the base art,
rather than dropping straight to it and losing an age the content does have.

What is *not* taken from those units is their hit points, which also rise with
the age (barracks 1200 to 1500, house 550 to 750, mill 600 to 800). That is a
simulation change and belongs with the technology effects; it is recorded in
`backlog.md`. Each age's variant likewise has its own rubble unit, so a razed
Feudal barracks still leaves the Dark Age rubble.

## The DAT's axes are mirrored against this projection

`worldToIso` sends +x down-**right** on screen; AoE2 sends its own +x
down-**left**. Nothing symmetric shows it — a town center or a barracks looks
the same either way — but anything the DAT labels by axis does. The palisade
gate is two units, 789 obstructing 2x1 along the DAT's x and drawing
`b_dark_gate_palisade_ne_closed`, and 793 the reverse; composited into a wall
run, 789's art lies across a gate laid along *our* x and 793's lies along it.

So a gate asks two different questions of the DAT and gets two different units:
the obstruction box comes from the unit whose collision matches the footprint
(`gateBoxKey`), and the picture from the unit whose stakes run the right way on
screen (`gateArtKey`). Conflating them is what left every gate lying across the
wall it was built into (issue #15). Flipping the projection to match the DAT's
handedness would remove the mirror and is not worth a board-wide change.

## Palisade walls

The palisade is one 1x1 building placed a tile at a time but dragged as a line:
`wallLine` walks the longer axis whole, so a diagonal drag becomes a staircase
of joined segments rather than a row of posts with gaps between them, and the
preview tints every tile in the line by whether it could stand there.

The DAT gives the palisade a single base graphic (`b_dark_wall_palisade_x1`,
graphic 587) with five deltas, and AoE2 picks between them by what a segment is
joined to. Which delta is which was measured rather than guessed: compositing
each one into the arrangement it has to serve, and keeping the one that joins
without a seam. Frame 1 tiles seamlessly along +x and frame 0 along +y; frame 4
is the lone stake bundle; and **frame 2** — a boxed post with a horizontal
brace — is the corner, the T and the cross, closing every arm where frame 3
leaves the outer angle open.

The first pass at this had 2 and 3 the other way round, which is why corners
drew as low straight sections rather than as corners (issue #15). Frame 3 was
described then as "iron bracing, the gate section"; the bracing is the corner
post's, and what frame 3 is actually for has not been identified. Nothing
draws it. The renderer clamps a shape index to the atlas, so a mapping that ran
off the end would collapse two shapes onto one picture silently rather than
fail — a test asserts all four indices land inside the imported atlas.

A dragged line of foundations would otherwise leave nine untouched, because each
`build` command retasks the same builders to the newest site. On finishing a
segment a builder carries on to a touching unfinished foundation of the same
kind, which is what AoE2 does with a wall drag and harmless everywhere else.

## Palisade gates

The gate is the first building that is not square: the DAT gives it as two unit
pairs, 789/790 lying along x and 793/794 along y, each a closed leaf and an open
one with identical numbers (240 hit points, 30 wood, 30 seconds) and mirrored
collision boxes of two tiles by one. Building rules therefore carry an optional
`footprint` of half-extents, placement and snapping work per axis, and the
importer can read one animation slot from a different unit — which is how the
open leaf is reached without inventing a second entity in the simulation.

Passability is per player. `buildNavGrid` takes an owner and leaves out the
finished gates that owner may walk through, so the owner of a gate walks a
different map from everybody else; only players who actually have one pay for
the extra grid. A foundation is nobody's doorway, including its owner's.

The view picks between the four leaves by footprint and by whether one of the
owner's units is within two and a half tiles, which is the art catching up with
the pathing rather than a second rule. Walls beside a gate read it as part of
their run, so the line joins up; so do the builders, who carry on down the whole
palisade rather than stopping at the piece somebody happened to task last.

Two DAT gate pairs are unused: 797/798 and 801/802 are two tiles square and
belong to a wall this slice does not build.

## Verification

```bash
npm test
npm run build
npm run test:import
npm run batch -- --matches 16 --concurrency 16 --seed-start 100 --max-time 1800 --out .local/batches/gate
npm run test:live-agent   # opt-in; requires valid existing machine provider auth
```

The batch's `summary.json` carries `decided`, `timeouts`, `replayFailures` and
`throughput`; a change that moves any of them is a change worth explaining.

Two things the gate does not measure, both worth running by hand after anything
that touches the map, the pathfinder or the frame loop:

- **Worst-tick cost.** Run a match tick by tick, time each `stepGame`, and
  report the median and the maximum. A regression here is a lurch the player
  feels and an average never shows.
- **A real page.** Open the game in headless Chrome and drive it through the
  same input path a player uses — `page.mouse.click`, `page.keyboard.press` —
  reading state back through `/__debug`. Start a **private Vite server on its
  own port** for this and open the only page attached to it: the debug bridge
  answers from whichever client replies first, and a browser tab somebody left
  open on 5173 will answer from its own match. Pass `root` and `configFile`
  explicitly to `createServer`, or it takes the working directory as the
  project and serves a 404.

