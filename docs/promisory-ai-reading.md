# Promisory AI Script Analysis

**Date:** 2026-10-06  
**Source Repository:** Owned DE AI scripts, `resources/_common/ai/Promisory/`  
**Depot:** `app_813780/depot_813781`

---

## 1. Finishing Power: Siege Unit Production and Attack Timing

### Summary
The AI builds siege weapons (trebuchets, rams, mangonels) in the Castle/Imperial phases when military population grows and enemy buildings exist. Siege training is gated on prerequisite techs (Capped Ram), unit count thresholds, and active enemy presence rather than resource thresholds alone.

### Key Findings

**Trebuchet training conditions:**
- Requires `military-population >= 10` and `players-building-count >= 1` (any enemy has a building)
- Trains when `trebuchet-set < 4` OR `population >= 180`
- Caps at `trebuchet-set < 12` total
- No village commitment specified; training is building-only

**Battering Ram training conditions:**
- Gated on `ri-capped-ram >= research-available` (tech prerequisite)
- Trains when `battering-ram-line <= 0` (none exist) OR `military-population >= 20`
- No explicit razing/commit logic; trained opportunistically when conditions met

**Attack timing/strategic numbers:**
- No direct finalization rules for attack commitment in the scripts reviewed
- Strategic numbers like `sn-focus-player-number`, `sn-target-player-number` and `sn-military-superiority` guide target selection in `threats.per`, but specific "attack NOW" thresholds not documented in finaling scope
- Dock training is modulated by `sn-dock-training-filter` (0=prefer siege ships, 1=balance, 2=favor combat), dynamically adjusted based on enemy warboat presence

### Citations
- **Trebuchet training:** `finaling.per:83–88`

- **Battering Ram training:** `finaling.per:91–96`  

- **Attack target selection logic:** `threats.per:6–77` (focus-player and target-player selection via strategic numbers; no explicit siege finalization rule found)

### Implication for Example AI (`src/sim/ai.ts`)
- **Recommendation:** Implement a siege finalization rule that triggers when `military >= threshold` (e.g., 30 units) AND enemy has buildings AND siege unit count is still low. Gate it on `ri-capped-ram` research availability. Consider adding a commit goal like `(goal siege-rush yes)` to allocate villagers to siege building production once the tech completes, rather than waiting for opportunistic training.
- **Open gap:** No explicit "when to abandon razing" or "retreat from siege" heuristic. Current rules assume indefinite persistence.

---

## 2. Market, Stable, and Trebuchet Building Construction

### Summary
Market builds early (Feudal age) once resources allow. Stable builds only in Imperial age after infrastructure is in place. Trebuchet is trained, not built; siege-workshop is the prerequisite building, constructed in Castle age.

### Key Findings

**Market construction:**
- Built when `market-count < 1`, `current-age <= feudal-age`, and `excessWood >= market-cost`
- Requires `building-available market` and `town-center >= 1`
- Gated with 7-second timer to avoid repeated attempts
- Optional condition: `excessFood >= 100` (surplus food signals trade opportunity)

**Stable construction:**
- Builds only in Imperial age (`sn-current-age >= imperial`)
- Requires core infrastructure: `town-center >= 1`, `lumber-camp >= 1`, `mill >= 1`, `mining-camp >= 1`, `archery-range >= 1`
- Caps at `stable < 10` (builds up to 9 stables)
- No Feudal or Castle age build rule found; Stable is Imperial-only priority

**Siege-Workshop construction:**
- Built in Castle age (`current-age <= castle-age`) if `siege-workshop-count < 1`
- Requires `excessWood >= sw-cost` and `town-center >= 1`
- Uses same 7-second timer pattern as Market and Blacksmith
- Prerequisite for trebuchet training (provides siege-workshop building that trains trebuchets)

**Wonder construction:**
- Built if `wonder-count <= 0` and `can-build wonder`
- Placement zone size set to 12 tiles (compact near town-center)
- Constructed opportunistically when housing allows and gold/stone available

### Citations
- **Market:** `buildings.per:304–315`  

- **Stable (Imperial only):** `buildings.per:4067–4070`  

- **Siege-Workshop:** `buildings.per:353–361`  

- **Wonder:** `buildings.per:287–292`

### Implication for Example AI
- **Recommendation:** Phase Stable construction to Imperial age in the strategy layer; do not attempt Feudal Stable builds. Ensure Siege-Workshop is built before attempting siege unit training. Consider Market as a critical Feudal commerce node; prioritize its construction over secondary buildings. For Wonder, implement a victory-condition timer: if game-time exceeds threshold and Wonder is not begun, cancel or defer to focus on military defense.

---

## 3. Farm Re-Seeding

### Summary
**No active re-seeding rules found in Promisory AI scripts.** Farm management is delegated to the game engine's auto-reseed system.

### Key Findings
- Searches for `reseed`, `auto-reseed`, `disable-auto-farm` across all Promisory `*.per` files returned no results
- Farm count is monitored (e.g., `building-type-count-total farm >= maxfarms`) to adjust villager allocation ratios in `gatherers.per`
- Script-driven villager gathering percentages (`sn-food-gatherer-percentage`, etc.) are adjusted dynamically, but farm creation/seeding is not explicitly controlled

### Citation
- **Farm monitoring (not seeding):** `gatherers.per:126`  

### Implication for Example AI
- **Recommendation:** If manual farm seeding is required in the Open Empires simulation (e.g., unlike original DE where farms auto-reseed), add a rule that checks `farm-remaining-food <= threshold` and triggers a villager to right-click the farm. Otherwise, rely on engine default behavior. Confirm with AGENTS.md or docs/status.md whether farm seeds are manually managed in the playable build.

---

## 4. Production Queue Depth

### Summary
Training queue is **enabled globally** (`sn-enable-training-queue = 1`) in the initialization phase. No per-building queue-depth limit is configured; the game engine manages queue size.

### Key Findings

**Training queue state:**
- Initialized in `init.per:1032` as enabled (`sn-enable-training-queue 1`)
- Constants `amount-queued-count (80)` and `amount-training-count (81)` define storage slots for queue metadata, not depth limits
- Queue is enabled in all non-cheat game modes; rules for modulating queue state exist (e.g., `researches.per:6067–6073` shows conditional disable/enable), but default is enabled

**Trainer building assignments:**
- Barracks, Stable, Archery-Range, Siege-Workshop, Monastery, Dock, Port, Shipyard, Blacksmith, Market, University get 1–2 assigned builders per rule (`init.per:1024–1028, 1051–1056, 1064–1070`)
- No explicit "max queue length" rule; training continues as long as resources allow

### Citations
- **Training queue enabled:** `init.per:1032`  

- **Builder assignment example:** `init.per:1054–1056`  

- **Queue storage constants:** `defaultConstants.per:224–225`

### Implication for Example AI
- **Recommendation:** If Open Empires simulation enforces a finite queue depth (e.g., max 5 units queued per building), add a rule that checks `amount-queued-count < 5` before issuing `train` commands. Otherwise, the current global enable is sufficient. Note: No evidence that Promisory AI tries to cap queue depth per building; it assumes the engine will manage overflow/delay.

---

## 5. Research Order and Selection

### Summary
Research follows a strict priority: **Age advancement** (Feudal → Castle → Imperial) → **Unique unit/research** (civ-specific) → **Economic techs** (Wheel-Barrow, Double-Bit-Axe, Horse-Collar) → **Military upgrades** (Armor, Melee, Ranged, Siege) → **Civ-specific bonuses** (e.g., Panokseon, Stronghold). Breadth is limited; only ~20–30 techs per standard game due to cost/time constraints.

### Key Findings

**Age advancement (mandatory first):**
- Feudal: Trigger when `total-food >= 1200` OR `villager >= darkvills` (19–20 vills) or enemy is feudal  
- Castle: Auto-research when `can-research castle-age` (no conditions, prioritized)  
- Imperial: Auto-research when `can-research imperial-age` (no conditions, prioritized)

**Unique unit/research (immediate after age):**
- Researched ASAP after available if civilization has unique units (Goths, Britons, Mayans, etc.)
- Gated on sufficient resources and military milestones (e.g., champions for Goths, cavalry for Franks)

**Economic techs (Feudal–Castle):**
1. **Wheel-Barrow** (`riwheel-barrow`): Feudal-Castle border, ~25 villagers, food-heavy; enables farms to be more efficient  
2. **Double-Bit-Axe** (`ri-double-bit-axe`): Castle age or feudal-war strategy, when wood is not scarce  
3. **Horse-Collar** (`ri-horse-collar`): Castle+ age, triggers when mines are built or food supply stable  
4. **Hand-Cart** (`ri-hand-cart`): Imperial age, only if `villager >= 60` or `town-center >= 3` (rare, high-pop games)

**Military upgrades (Castle+):**
- **Armor suites:** Plate Mail, Plate Barding, Bracer sequenced by unit type availability  
- **Chemistry:** Enables hand-cannoneers and gunpowder units; researched when imperializing  
- **Siege techs:** Siege Ram, Siege Onager, Counterweights researched when `mangonel >= 4` or `siege-weapon >= 4`

**Sample research sequence (standard Britons game):**
1. Feudal-Age
2. Unique Unit Upgrade (Britons: Yeomen)
3. Castle-Age
4. Unique Research (Britons Longbow bonus)
5. Wheel-Barrow / Double-Bit-Axe / Horse-Collar (overlapping based on resource state)
6. Imperial-Age
7. Plate Barding / Armor / Chemistry
8. Siege Ram or Siege Onager (if military score suggests siege rush)
9. Civ-specific high-cost techs (e.g., War Wolf for Britons, if applicable)

### Citations
- **Feudal advancement:** `researches.per:50–77`  

- **Castle auto-research:** `researches.per:108–114`  

- **Wheel-Barrow (economic priority):** `researches.per:2273–2275`  

- **Siege tech gating (on unit count):** `researches.per:534–541` (Korean example, adapts to any civ)  

### Implication for Example AI
- **Recommendation:** Implement a research queue in `src/sim/ai.ts` that mirrors the Promisory sequence: **Age > Unique > Economic > Military > Civ-bonus**. Set thresholds per tech (e.g., Wheel-Barrow at `villager >= 25`, Plate Barding at `knights >= 5` or `castle-age`). Consider a "tech-timing budget" to avoid deadlock on expensive research; if game-time exceeds threshold without a tech completing, skip it and pursue next tier. Document which civs benefit most from which techs (e.g., Archers want Chemistry, Cavalry want Horse-Collar).

---

## 6. Camp Siting and Re-siting (Dropsite Distance Rules)

### Summary
The AI sets minimum dropsite distances to encourage workers to travel to established resource centers rather than building scattered mills/camps. Re-siting is triggered when resources are depleted far from existing dropsites.

### Key Findings

**Dropsite separation (primary rule):**
- **Wood:** `dropsite-min-distance wood >= 6` (at least 6 tiles from existing mills)
- **Stone:** `dropsite-min-distance stone >= 6` (similar for mining camps)
- **Food:** `dropsite-min-distance food < 255` (any distance acceptable; farm fields sprawl widely)
- **Strategic numbers:**
  - `sn-allow-adjacent-dropsites 1` (allow closely-spaced camps if needed, e.g., in lategame clustering)
  - `sn-dropsite-separation-distance 2` (preferred gap; can drop to 2 if map is tight)

**Re-siting trigger (wood example):**
- When `dropsite-min-distance wood >= 6` AND `dropsite-min-distance wood < map-size`, build a new Lumber Camp
- Condition: `wood-amount` must justify the cost; if excess wood is negative, skip
- Placement mode: `sn-placement-to-center 1` (favor town-center-relative placement over scattered expansion)

**Camp type selection:**
- **Market:** Placed near town-center (`sn-placement-to-center 1`)  
  - `up-set-placement-data my-player-number -1 c: market-neg-dist` (negative distance penalty to deter off-center placement)
- **Mills/Camps:** Placed relative to resource clusters  
  - `sn-preferred-settlement-placement` (3=wood, 4=stone, 6=food; directs builder priorities)

### Citations
- **Wood/Stone dropsite distance rules:** `buildings.per:179–203`  

- **Food placement (farms sprawl):** `buildings.per:94`  

- **Placement bias (Market near TC):** `buildings.per:217, 256–257`  

### Implication for Example AI
- **Recommendation:** Implement dropsite distance checks in `src/sim/ai.ts` resource pathfinding layer. Before building a Lumber Camp, check `dropsite-min-distance wood >= 6` (empirically). If < 6, route villagers to existing camps unless all are at < 50% capacity. Add a re-siting rule: if idle villager count > 3 and `dropsite-min-distance food >= 6`, queue a new farm dropsite. Consider tightening the 6-tile rule in early game (Dark/Feudal) to cluster efficiency, and loosening it in lategame (Imperial) when map control is secondary to army size.

---

## Open Questions / Gaps

1. **Razing commitment:** No explicit "commit army + vills to razing" rule found. Current siege training is opportunistic; a future rule should gate razing on `military-population >= threshold` and `enemy-has-buildings`.
2. **Farm auto-reseed:** Engine-driven; not scripted. Confirm if Open Empires simulation requires manual seeding.
3. **Attack retreat:** No "withdraw from failed siege" heuristic. Consider adding `(goal siege-active yes/no)` to modulate aggressive vs. defensive posture.
4. **Research breadth:** Promisory prioritizes 15–20 techs per game; higher-end matches may go deeper (40+). No explicit "stop researching" rule; assumes resources will dry up naturally.

---

## References

- **Full scripts location:** `/home/fraser/.local/share/Steam/steamcmd/linux32/steamapps/content/app_813780/depot_813781/resources/_common/ai/Promisory/`
- **Key files:** `finaling.per`, `buildings.per`, `researches.per`, `gatherers.per`, `threats.per`, `init.per`
- **Related Open Empires issues:** #59 (AI readiness), #124 (strategy discovery)
