# Conditioning map generation on the real world

`map-generation-design.md` reconstructs the original's generator and stages it as
M1–M4. This note is the extension: driving that generator from real geography,
satellite land cover, old map scans or a hand-drawn schematic, so a campaign can
be laid on the ground the events actually happened on — at 1:1 where the subject
fits the board, and as a deliberate miniature where it does not. Nothing here is built,
and the staging at the end assumes M1–M3 have landed.

## The constraint that decides the architecture

The simulation is deterministic and `canonicalSnapshot` hashes it; replays and
the 16-seed batch depend on the same seed producing the same board. Nothing that
is a model, a network fetch, or a floating-point geo library may run inside
`createGame`. So the pipeline splits, and the split is not a compromise — it is
the same shape this project already uses for owned content:

```
offline (tools/, Python)                    online (src/sim, TypeScript)
fetch → reproject → resample → classify  →  map descriptor  →  the M1–M4 phases
      → repair → quantise → hash             (committed, hashed)   (deterministic)
```

`import_content.py` already turns owned binaries into a hashed `content.json`
the simulation reads without knowing where it came from. A map descriptor is the
same trick applied to geography. Everything speculative — the models, the
imagery, the reprojection — lives on the left of that arrow, and the right-hand
side stays a pure function of `(descriptor bytes, seed)`.

**The original agrees.** AoE2 DE's own Real World maps are not a generator: they
are a scenario with a random map script loaded on top. The terrain, elevation
and coastline are fixed to match the real place; only start positions and some
resource distribution are randomised. Fixed geography plus a random object pass
is the shipped answer to exactly this problem, and it is what the split above
produces.

## The four levers, conditioned

The four levers from `map-generation-design.md` each take a different kind of
real-world input, and none of them needs a new phase:

| lever | conditioned by | how |
|---|---|---|
| base terrain and lands | a land/water mask | the mask *is* the land layer; `create_land` becomes "these tiles" |
| terrain clumps | land cover classification | a per-tile **bias field**, not a paste |
| elevation | a DEM | resample, quantise, then legalise |
| connections | slope, rivers, roads | real slope becomes `terrain_cost`; the path finds the pass itself |

The middle row is the one that matters and the one that is easy to get wrong.
The naive thing is to classify the imagery and write the answer straight into
the terrain grid. That produces a satellite photo, not an Age of Empires map:
speckled single tiles, ragged unwalkable edges, forests with holes, nothing a
mining camp can be sited against. The generator's growth loop already has the
hook to do it properly — the cost is

```
cost = random(100) - clumping * neighbours + 250
```

and `avoid_player_start_areas` is already a per-tile scalar field consulted
probabilistically. Conditioning is one more term:

```
cost = random(100) - clumping * neighbours + 250 - bias[tile]
```

Forest clumps then *prefer* to grow where the real forest is, but they still
grow as AoE2 clumps: round enough to walk around, cleaned of pinholes, spaced by
`spacing_to_other_terrain_types`, kept off the start areas. The map looks like
the place and plays like the game. The bias field defaults to zero and the
existing behaviour is unchanged, which is what makes this an extension rather
than a rewrite.

## What the data actually gives

| source | what | resolution | licence |
|---|---|---|---|
| Copernicus DEM GLO-30 | global surface elevation | 30 m | free, open; AWS open data mirror |
| ESA WorldCover v200 | 11-class land cover | 10 m | CC BY 4.0; AWS open data mirror |
| **EA LIDAR Composite DTM/DSM** | **England, bare-earth and surface** | **1 m, ±15 cm** | **OGL — free commercial reuse** |
| **EA Vegetation Object Model** | **canopy-top height, vegetation only** | **1 m, >2.5 m threshold** | **OGL** |
| **Ancient Woodland Inventory** | woods continuously wooded since 1600 | polygons | **OGL** |
| **National Forest Inventory** | forest type incl. coppice | polygons | **OGL** |
| **Register of Historic Battlefields** | ~50 English battlefield extents | polygons | **OGL** |
| **OS Terrain 50** | GB heights, contours, coastline | 50 m | **OGL** |
| **OS Open Rivers** | GB watercourses, topological network | vector | **OGL** |
| **OS VectorMap District** | GB woodland, water, roads, buildings | vector | **OGL** |
| **NLS georeferenced OS County Series** | Britain as surveyed 1840s–1900s | ~1–2 m/px scans | CC BY-SA 3.0, **redistribution restricted** |
| GEBCO | bathymetry | ~450 m | open |
| OpenStreetMap | rivers, roads, coastline | vector | **ODbL — share-alike on derived data** |
| Natural Earth | coarse coastlines | 1:10m | public domain |

Two of these are unusually good fits and neither needs an API key — both are
Cloud-Optimised GeoTIFFs on the AWS open data registry, so a bbox read is a
range request and `rasterio` is the only new dependency.

**WorldCover's classes map almost one-to-one onto the DAT's terrain families**,
which is the piece of luck the whole idea rests on:

| WorldCover class | terrain family |
|---|---|
| Tree cover | Forest / Pine Forest / Jungle / Snow Forest by latitude |
| Shrubland, Grassland | Grass, Grass2, Grass3 |
| Cropland | Dirt / Farm |
| Built-up | Road, Road2 |
| Bare / sparse | Desert, Dirt |
| Snow and ice | Snow, Ice |
| Permanent water | Water → Med Water → Deep Water by the chain |
| Wetland, Mangrove | Shallows, Marsh |

The biome swap the scripts do with `#define FROZEN_MAP` becomes a latitude
lookup on the same table. And the **beach comes free**: the engine's own
post-terrain sweep turns any land tile bordering water into Beach, so a real
coastline gets a real shore without asking.

**Attribution is a real obligation, not a footnote.** WorldCover is CC BY 4.0
and Copernicus DEM carries its own required credit line. The public build at
`empires.gszep.com` ships whatever the descriptor was built from, so the
importer should write the attribution string *into* the descriptor and the view
should show it, the same way the owned/open content split is already handled.
OSM's ODbL share-alike is the one to be careful with; prefer Natural Earth or
the raster sources for anything that ships.

### Ordnance Survey, which changes the plan for Britain

The global sources above are the floor. For Great Britain there is something an
order of magnitude better, and it happens to be the exact ground this project
should care about: **the imported content is the Britons**, and the campaigns
that writes itself are British battles.

**Elevation: 1 m instead of 30 m.** The Environment Agency's LIDAR Composite
covers about 99% of England at 1 m with a stated ±15 cm RMSE, as GeoTIFF in 5 km
tiles on the OS National Grid, under the Open Government Licence — free
commercial reuse with attribution. Scotland and Wales have equivalent national
LIDAR programmes on the same licence. That is not a marginal improvement over
Copernicus GLO-30; it is a different kind of map. At a 10 m tile pitch it is a
hundred samples per tile, which means the *shape of the ground at battle scale*
survives: the ridge at Senlac, the slope Harold's shield wall stood on, the
marsh edge at Bosworth. Thirty-metre global data cannot see any of that.

**And it separates the ground from what grows on it, which is the real prize.**
Copernicus GLO-30 is a *surface* model: its elevation includes canopy and
buildings, so a forest arrives as a bump in the hill and there is no honest way
to take it out again. The EA publishes the layers apart — DTM (bare earth), DSM
(surface), and a **Vegetation Object Model**: a 1 m raster where each pixel is
canopy-top height above ground for classified vegetation above 2.5 m, in 5 km
GeoTIFF tiles under OGL. The elevation layer and the forest layer arrive already
separated and already classified; we do not even have to difference them
ourselves. The National LIDAR Programme point cloud sits underneath, classified
into ground and low/medium/high vegetation, if individual stems are ever wanted.

### What "individual trees" is actually worth

At a 10 m tile pitch one real tree is a hundredth of a tile, so real trees cannot
become game trees one-for-one — but that is not where the value is. The VOM
splits into three kinds of feature, and this game already has a mechanism for
each:

- **Woodland blocks** — contiguous canopy over some area. These become forest
  terrain clumps, biased by the growth loop, and they are the wood you walk
  around.
- **Hedgerows and tree lines** — linear canopy two to five metres wide, so two to
  five pixels at 1 m, and unmistakable. This is the one to be excited about. At a
  10 m pitch a hedgerow is a **one-tile-wide line of forest tiles**, and in this
  project's own model that is already a thing you cannot shoot through and must
  walk around until you cut it. Real field boundaries become tactical terrain for
  nothing, out of a rule the game has had since the first commit. An enclosed
  English field system is a maze of soft walls, and nobody has to author it.
- **Lone trees and copses** — isolated canopy objects. These map exactly onto the
  scattered-object tree pass the scripts already use (30 oaks on Arabia, 100 on
  Black Forest). A real lone oak becomes a game tree, one for one, and that
  mapping does work.

Three real features, three existing mechanisms, no new phase.

### The historical layers, which are the campaign

LIDAR sees 2022. Three more OGL datasets say what was there before, and they are
what turn a real place into a real *date*:

- **Ancient Woodland Inventory** (Natural England, OGL): 22,000-odd sites in
  England, defined as continuously wooded **since at least 1600 AD**, and
  identified in part from old maps. Intersect it with the VOM and the modern
  plantation drops out while the woods a medieval army would have marched round
  stay. This is the single best available answer to "which of these woods was
  actually there", and it is a shapefile.
- **National Forest Inventory** (OGL): interpreted forest type — broadleaved,
  conifer, mixed, **coppice**, coppice-with-standards, shrub. It picks which tree
  art a wood gets, and coppice is a medieval woodland management category showing
  up in a modern government dataset.
- **Register of Historic Battlefields** (Historic England, OGL, EPSG:27700):
  boundary polygons for the roughly fifty registered English battlefields.
  That is the campaign index. The list of bounding boxes is a download, not a
  research project. Scotland keeps its own Inventory of Historic Battlefields.

So the whole pipeline for a battle map is: **battlefield polygon → bbox and pitch
→ DTM for the ground, VOM for the vegetation, Ancient Woodland as the historical
filter, NFI for the species, OS Open Rivers for the water and the fords →
descriptor.** Every layer in that sentence is Open Government Licence: free
commercial reuse, no key, attribution only.

Two honesties to carry. The VOM is fully automated with no manual QC beyond
visual checks, so it will have artefacts — which makes the cellular-automaton
repair pass matter more, not less. And **the ground is timeless but the
vegetation is dated**: a hedge visible in 2022 is probably Victorian enclosure,
not Norman. Use LIDAR for the DTM always; choose the vegetation layer by the
century being depicted — Ancient Woodland for the deep past, the NLS County
Series for anything after 1840, the VOM when the modern landscape is the point.

**Land cover: vectors instead of a classifier.** OS VectorMap District (OGL)
gives woodland, hydrology, roads and building footprints as clean vectors for
all of GB, and OS Open Rivers gives watercourses as a *topological* link-and-node
network with flow direction. Rasterising a vector woodland polygon to the tile
grid is exact where classifying a satellite image is a guess, and the river
network is directly what the connection phase wants: a river is a chain of
tiles, a ford is where a connection crosses it, and both are edges in a graph we
are handed rather than pixels we have to infer.

**And the historic sheets, which are the actual point.** For a 1066 or a 1485
map, modern land cover is worse than useless — it tells you where the motorway
and the housing estate are. The OS County Series six-inch and 25-inch sheets
(1840s–1900s), georeferenced and served by the National Library of Scotland,
show Britain before most of the industrial reshaping: woods, marshes, commons,
field boundaries, mills, tracks, and the drainage as it was. It is not 1066, but
it is centuries closer than a Sentinel-2 composite, and for anything pre-
enclosure it is the earliest systematic survey that exists.

That is also the leg where the computer vision is already built: **MapReader**
(Living with Machines / Turing Institute) is a Python patch-classification
pipeline whose flagship case study is roughly 16,000 nineteenth-century OS
sheets of Britain, about 30.5 million patches. The tool and the data were made
for each other, and the output — a per-patch label — is exactly the label map
the descriptor wants.

**The licence caveat, stated plainly.** The NLS layers are CC BY-SA 3.0 and
their terms forbid reselling the tiles, making them available for onward use on
other sites, or passing them to third parties, and tie a subscription to one
domain. So: fine to fetch in the **offline** authoring step and derive a label
map from; not fine to proxy from `empires.gszep.com` or ship as tiles. The
derived descriptor is a derivative work and carries the attribution and the
share-alike with it. The underlying OS sheets are old enough to be out of Crown
copyright; it is the digitised images that carry terms, which is a distinction
worth keeping straight rather than assuming either way. The OGL sources (EA
LIDAR, OS OpenData) have none of this friction and should be the default.

This reorders the work: **Britain first**, on OGL data at 1 m, with the global
Copernicus/WorldCover path as the fallback for everywhere else.

## Scale, which is the first thing to decide

A 120x120 board is a scale choice before it is anything else:

| tile pitch | board covers | fits |
|---|---|---|
| 10 m | 1.2 km | one battlefield: Hastings' front (~1 km) |
| 30 m | 3.6 km | Waterloo (~4 km front), just; one DEM sample per tile |
| 50 m | 6 km | Constantinople's land walls (5.5 km) |

Globally, **30 m is the sweet spot**: Copernicus GLO-30 gives exactly one
elevation sample per tile and nothing has to be invented by interpolation, while
WorldCover at 10 m gives nine samples per tile — a majority vote, and a majority
vote with a tie-break is a better classifier than any resampling filter, because
it can weight towards the classes that make interesting ground.

**In Britain the constraint disappears and a sharper one replaces it.** With 1 m
LIDAR every pitch from 10 m up is oversampled, so the data no longer decides.
What decides is that **hedgerow detail and battlefield extent pull the pitch in
opposite directions**. A hedge is one tile wide at 10 m and invisible at 30 m; a
registered battlefield polygon is one to five kilometres across, which at 10 m is
100 to 500 tiles. On a 120x120 board those cannot both be satisfied:

| battlefield | rough extent | tiles at 10 m |
|---|---|---|
| Hastings | ~1.5 x 1 km | 150 x 100 |
| Naseby | ~2 km | 200 |
| Bosworth | ~3 km | 300 |

So keeping the hedgerows means a bigger board. AoE2's own sizes run to 480x480
and this is a 1v1 slice, so 240x240 is not outlandish — but `MAP_TILES` is a
constant today and the pathfinder, the visibility grid and the minimap are all
tuned around 14,400 tiles; 240x240 is four times that. **That is a measurement,
not an assumption**, and it should be measured before the pitch is chosen rather
than after.

The honest caveat: AoE2's own scale is not a scale. A town center is four tiles
across and a villager walks a kilometre a minute. Pick the pitch for
playability, record it in the descriptor, and do not pretend it is a survey.

## Fidelity: 1:1 where it fits, a miniature where it does not

Everything above assumes a faithful window onto real ground. That is the right
answer for a raid on Windsor Castle and the wrong answer for the siege of
Vienna, and the difference should be a **setting**, not a fork in the code.

The arithmetic is unforgiving and worth writing down, because it is the whole of
the problem:

```
real extent = tile pitch x board size
```

Three quantities, and a map may pin only two. The board follows player count —
this is a 1v1 slice today, but four or eight players want more ground, exactly as
AoE2's own map sizes grow with the lobby. So once the subject and the player
count are fixed, **something has to give**, and there are only three honest ways
to give it:

- **Coarsen.** Raise the pitch. Uniform, truthful, and it destroys detail from
  the bottom up: at 30 m the hedgerows go, at 100 m Vienna's curtain wall is one
  tile and its bastions are gone.
- **Crop.** Keep the pitch, take the part that matters. The siege of Vienna
  becomes the assault on one bastion, at full fidelity, and the rest of the city
  is off the board. Often the best answer, and the one most likely to be
  overlooked.
- **Compress.** Keep the landmarks legible at a size the game can play and
  squeeze the empty ground between them. Non-uniform, deliberately untrue to
  distance, and the only way to fit a whole city onto a board a person can play.

### This has a name, and a century of prior art

Compression is not a hack; it is **cartographic generalisation**, which is what
every map at every scale has always done. Its operators are named and its
literature is old: *selection* (drop what does not matter), *simplification*,
*aggregation* (merge neighbours into one), *collapse* (an area becomes a line or
a point), **exaggeration** (draw a feature larger than truth so it stays
visible), and **displacement** (move things apart when exaggeration makes them
collide). It is normally run as a **constraint problem**: legibility constraints
against fidelity constraints, and the generaliser satisfies as many as it can.

That is exactly our problem, with one substitution — *minimum legible size on
paper* becomes **minimum playable size in tiles**. A wall is not a wall until it
is a tile thick. A settlement is not a settlement until it can hold the buildings
that make it one. A chokepoint that is one tile wide is not a chokepoint, it is a
bug. So each feature class gets a floor, and a feature below its floor is
*exaggerated up to it* rather than lost:

| feature | floor, in tiles | why |
|---|---|---|
| curtain wall, hedgerow | 1 wide | anything thinner is not an obstacle |
| gate, ford, mountain pass | 3–5 wide | narrow enough to hold, wide enough to fight in |
| wood | 3 across | below that it reads as scattered trees |
| settlement | enough for a town center and its neighbours | it must be a place, not a motif |
| hill worth holding | ~6 across plus a ramp | an army has to stand on it |

Those numbers are defaults to tune against the rules, not facts — the floors
should be read off the building footprints and weapon ranges the DAT already
gives, the way every other number in this project is.

### The compression algorithm

Exaggerate, then carve. Once landmarks have been promoted to their floors the
map overflows, and the overflow has to come out of the ground nobody fights
over. **Seam carving** (Avidan and Shamir, SIGGRAPH 2007) is the right tool and
it is almost embarrassingly well suited: build an importance raster, then
repeatedly remove the minimum-cumulative-importance connected seam crossing the
map, by dynamic programming, until the board fits. Seams bend *around* the
citadel and the ridge and come out of the empty fields, which is precisely
"shrink the landscape, keep the castle." It is deterministic, it is cheap, and
it runs offline where the descriptor is built.

I found no prior use of it on terrain, so treat that as an adaptation to
prototype rather than a citation to trust. The neighbouring idea, if it
disappoints, is a cartogram: warp area by an importance field rather than
deleting seams of it.

Then legalise, which is not optional after any warp: connectivity, corridor
widths, and the buildable flat ground each start needs.

### The dial, as settings

The four points on the dial are one parameter set, not four code paths:

| preset | pitch | warp | for |
|---|---|---|---|
| **Survey** | fine enough that the smallest tactical feature is ≥1 tile | none | a castle raid, a bridge, a hillfort |
| **Battlefield** | uniform, coarse enough to hold the field | none | Hastings, Naseby, Bosworth |
| **Miniature** | coarse | importance-weighted compression | Vienna, Constantinople, a campaign region |
| **Emblematic** | irrelevant | heavy; geography is a motif | a scripted campaign scenario |

and the knobs behind them, all descriptor fields:

- `pitchMetres`, `boardTiles`, `players`
- `fidelity` — the preset, which is only a set of defaults for the rest
- `strategy` — `coarsen | crop | compress`, or a permitted order to try them in
- `floors` — the minimum playable size per feature class
- `importance` — the per-feature-class weights the seam carver reads
- `invariants` — what compression may not break (below)

### What must survive any amount of licence

Distance may lie. These may not:

- **Topology.** What is north of what, which bank the attacker came from, which
  side of the river the town is on, what order the ridges come in. Compression
  may move things closer; it may never reorder or reflect them.
- **Relief.** The hill is still uphill, and by the same sign if not the same
  magnitude.
- **The named things are present.** If the account of the battle names it, it is
  on the board.

And the descriptor should **record the transform it applied** — preset, pitch,
compression ratio, which seams came out — so the map can say what it did. That
is the same discipline `status.md` already applies to every other divergence
from the reference, and it is the difference between artistic licence and an
error.

One consolation for anyone uneasy about all this: **the game already compresses
time far more violently than we are proposing to compress space.** A siege that
took two months plays in twenty minutes; four centuries of technology arrive
before lunch. A city rendered as a playable citadel is the same bargain, made in
the other dimension, and it needs no apology.

## Where each modern method earns its place

**Cellular automata — yes, and it is already in the design.** `cleanTerrain` *is*
a cellular automaton: a local majority rule over the four- and eight-
neighbourhood, iterated to a fixed point. The extension is to run a biased
version of it over a classified raster before the growth phase — the classic
4-5 rule that turns noise into caves, with the real classification as the bias.
This is the cheapest and highest-value piece of the whole note: it is what turns
a speckled 10 m classification into blobs a unit can path around, while keeping
the actual shape of the actual forest. Build it first.

**Conditional image generation — yes, but offline, and for sketches, not
satellites.** The field is real and current: Terrain Diffusion Network (2023)
does sketch-guided terrain synthesis, TerraFusion (2025) generates heightmap and
texture jointly from hand-drawn sketches with a latent diffusion model, and
sketch→30 m/px heightmap models are being published for exactly this use. Two
honest observations, though:

- *Where real data exists, the data is the answer.* A diffusion model
  conditioned on a DEM produces a plausible DEM; we already have the true one.
  Adding a model there buys nondeterminism and a weights dependency for nothing.
- *Where it earns its keep is the sketch.* A hand-drawn battle plan, an
  eighteenth-century schematic, a designer's scribble of "ridge here, marsh
  there, ford in the middle" — turning that into a full 120x120 label map is
  precisely the conditional-generation problem, and there is no data to look up.

So: an offline `sketch → label map` step, emitting the same descriptor as the
geo importer, with the model output being a **discrete label map or heightfield,
never RGB pixels**. We need classes, not a picture. And because it is offline,
the artifact is committed and hashed and the sim never learns a model exists.

**Wave function collapse — not for terrain here.** WFC reproduces a local tile
grammar from an exemplar, which is a real strength, but the terrain layer
already has growth, CA and ground truth; WFC at 120x120 with a connectivity
constraint is slow, backtracks, and can fail — three properties this project's
determinism budget has no room for. Keep it in the back pocket for two things it
would be genuinely good at: laying out a historical town's streets and building
footprints from an exemplar block, and choosing decoration variants once the
terrain is fixed.

**An LLM as the descriptor author — yes, and it is the campaign story.** "The
Battle of Hastings, 14 October 1066" → a bounding box, a tile pitch, terrain
overrides for the marsh that has since been drained, starting forces, and
victory conditions, emitted as a descriptor a human then edits. The
nondeterminism sits in authoring, the output is checked into the repo, and this
is an agent-native project already. This is how a campaign gets written without
a scenario editor.

**Playability repair — mandatory, and the part everyone skips.** Real ground is
unbalanced and frequently unplayable: one start on a ridge and one in a bog, no
flat 4x4 for a town center, two halves with no path between them. This is
search-based PCG and it is measurable:

- start-site selection by score (buildable flat area, resource proximity,
  distance from the other start) rather than `random_placement`;
- a connectivity flood fill, and if the starts are disconnected, hand the
  problem to the connection phase — which already carves corridors;
- resource parity within the distance bands, which the object phase already
  enforces by construction;
- a fairness metric reported by the headless batch, which is the instrument this
  repo already has for exactly this kind of question.

## Staged, after M1–M3

**C1. The descriptor, and a fixed terrain layer.** Extend the map descriptor
that M1–M3 introduces with an optional baked `terrain: Uint8Array` and an
optional per-tile `bias` field, both integer and both hashed with the rest.
Prove it with a hand-painted 120x120 PNG turned into a map by a twenty-line
script. No network, no geo dependency, no model. This proves the entire
architecture for almost nothing, and every later stage is just another producer
of the same artifact.
*Acceptance:* a painted PNG generates a playable board; the same descriptor and
seed give the same checksum on two machines.

**C2. The geo importer, Britain first.** `tools/import_terrain.py`: bbox and tile
pitch in, descriptor out, with two backends behind one interface. The **GB
backend** takes a bbox — from a Registered Battlefields polygon, if the map is a
battle — and reads EA LIDAR 1 m DTM for the ground and the Vegetation Object
Model for what grows on it, splits the VOM into woodland blocks, hedgerows and
lone trees, filters it through the Ancient Woodland Inventory when the date calls
for it, takes species from the National Forest Inventory, and rasterises OS Open
Rivers for water and fords — all Open Government Licence, no key, no
share-alike. The **global backend** reads
Copernicus DEM and WorldCover windows from the AWS COGs and reprojects to a local
UTM. Both resample by majority vote, class-map through the table above, and
attach the attribution string.
*Acceptance:* one British battlefield bbox produces a board whose ridge is the
real ridge and whose river is in the right place; one non-GB bbox produces a
recognisable coastline through the fallback; both artifacts carry their source
hashes and licence text the way `content.json` does.

**C3. The bias hook and CA repair.** The `- bias[tile]` term in the growth cost,
and a biased cellular-automaton smoothing pass over the classification before
growth. This is the stage where the output stops looking like a satellite photo.
*Acceptance:* side-by-side of raw classification and conditioned generation on
the same bbox; the conditioned one has no single-tile speckle, no unwalkable
one-tile gaps, and forests you can still recognise as the real ones.

**C4. Playability repair and start selection.** Scored start sites, connectivity
guarantee, and a fairness number in the batch report.
*Acceptance:* sixteen real-world boards all decide, and the batch prints a
fairness figure per board rather than the run being asserted fair.

**C5. The fidelity dial.** The parameter set above, and the two things behind it
that are real work: exaggeration to the per-feature floors, and importance-
weighted seam carving to fit the board. Survey and Battlefield need neither and
should keep working with the warp disabled, which is the test that the dial is a
setting rather than a mode.
*Acceptance:* the same subject generated at Survey, Battlefield and Miniature;
the Miniature keeps every named landmark and every topological invariant, and
the descriptor records the compression it applied.

**C6. Historic sheets and sketches.** The offline `image → label map` producer,
in two forms: MapReader patch classification over georeferenced OS County Series
six-inch sheets, which is the pipeline that tool was built for and the data it
was built on; and a sketch-conditioned model for a hand-drawn plan where no
survey exists. Same descriptor, same hash discipline, and the historic land
cover replaces the modern classification while the LIDAR elevation stays — the
ground has not moved since 1860, only what grows on it.
*Acceptance:* one nineteenth-century OS sheet and one hand-drawn schematic each
produce a playable board; the NLS attribution and share-alike ride along in the
descriptor; neither adds a runtime dependency.

## What to decide before starting

1. **Britain first, or the world first.** The Britain path is better data (1 m
   versus 30 m), a cleaner licence (OGL versus attribution-plus-share-alike),
   vectors instead of a classifier, and it matches the only civilisation this
   project imports. The world path is more general and much coarser.
   Recommendation: build the GB backend first and the global one as the
   fallback, behind one interface, so the descriptor never learns which ran.
2. **Tile pitch, and therefore board size — now the biggest decision here.**
   10 m keeps hedgerows as one-tile walls but needs 200–300 tiles to hold a real
   battlefield; 30 m fits any battlefield on the board we have and loses every
   hedge. Recommendation: measure the pathfinder, visibility and minimap at
   240x240 first, and if they hold, take 10 m and the bigger board — the
   hedgerow-as-soft-wall is the most distinctive thing this whole idea produces
   and it is the first casualty of a coarse pitch. Note this is only the
   *Battlefield* preset's answer; Survey and Miniature answer it differently,
   which is exactly why it is a setting and not a constant.
3. **How real is real.** Terrain real, resources fair fiction — which is what DE's
   own Real World maps do. The alternative (place gold where gold was) makes a
   history lesson and a bad game. Recommendation: say so in `status.md` as a
   named design choice so nobody has to rediscover it.
4. **Where the descriptor lives.** Committed JSON beside `content.json`, or
   fetched at runtime. Committed is the only option that keeps replays honest.
5. **Whether the public build ships real-world maps at all.** They carry
   attribution obligations and file weight that the open-content fallback does
   not. Recommendation: ship one, with its attribution visible, as the proof.

## What the build found (2026-08-29, the run that built C1 and C2)

- **The EA data needs no portal and no human.** The doc worried the download
  portal might be interactive; it is, but beside it every layer used here is
  a WCS 2.0 coverage that answers a plain HTTP GetCoverage with a GeoTIFF
  subset of any EPSG:27700 bounding box: the LIDAR Composite DTM 1m at
  `environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wcs`
  and the Vegetation Object Model 2022 beside it. `tools/import_terrain.py`
  is the importer; `rasterio` reads the result and was the one new
  dependency, exactly as predicted.
- **C1 and C2 are built.** The descriptor's baked-terrain layer is proved by
  `tools/maps/painted-proof.png` -> `paint_map.py` -> the `painted-proof`
  map, and the `senlac` map is the registered battlefield at Battle, East
  Sussex: DTM for the ground, VOM for every wood and hedgerow line, start
  areas cleared and the clearing recorded, attribution and coverage hashes in
  the descriptor. The importer samples a **diamond** window — tile (0,0) is
  the window's north corner, +x runs SE, +y runs SW — so the isometric view
  puts true north at the top of the screen and the board can be laid over an
  OS sheet without rotating either; the descriptor's `source.orientation`
  records this and `source.centre` the diamond's centre. Baked ground is deliberately unmirrored — DE's own Real
  World shape — while the object pass still mirrors.
- **Surveyed relief now reaches the screen, but not gameplay.** `senlac.json`
  and `windsor.json` carry quantised levels plus datum and metres-per-level;
  shared terrain/fog vertices and entities draw those levels. M5 remains open
  for slope-aware pathing, cliffs and the original's downhill combat rule.
- **The global Copernicus/WorldCover backend is not built.** Both AWS COGs
  answer range reads (checked), so the fallback path is open; Britain-first
  consumed the night. Recorded in `backlog.md`.
