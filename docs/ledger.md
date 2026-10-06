# Ledger of approximations

## Research queues (#293)

Owned `depot_813782/widgetui/commandpanel.json` supplies the `QueueButtons`
anchor; English localization 42100/42108 describes active/waiting research
cancellation, 300178 describes the unit/technology queue, and 72608 explicitly
describes DE mixed queuing. Research uses existing DAT costs, times, prerequisites
and technology icons. **Inferred integration:** separate research FIFO paid on
enqueue, exact paid-cost refund on cancellation, player-wide duplicate exclusion,
and a single refund if a queued technology completes elsewhere before starting.
Default cancellation removes the last entry, matching our training command;
portrait clicks explicitly name the displayed index (active is zero).
Death/capture discard research without refunds, matching the existing capture policy.
The pre-existing concurrent training/research lanes remain: **DE's single mixed
queue is not modelled**. Waiting research is drawn before the training row using
the existing portrait geometry; no new native timing/layout calibration is claimed.
Protocol v9 exposes a detached, own-player-only research queue. Match format v3
enables these rules; v1/v2 replay states omit `researchQueueVersion` and retain
busy-building rejection, legacy duplicate admission and corpse research fields.
Legacy snapshots likewise retain their old research behavior.
Shared client admission is v5: v4 simulators cannot join. Checkpoint compatibility
is separate; the host still loads v4 checkpoints without adding a research marker,
preserving their state and paid research. Subsequent saves use a v5 envelope.

Every value, rule or picture in imported mode that is **not** read from the
owned files, with where it came from and where it lives. `AGENTS.md`'s
"downloaded-content first" rule requires each to be recorded here the day it
ships; a reader who wants "what is hand-authored" reads this file and nothing
else. The open fallback (`src/sim/data.ts` `FALLBACK_RULES`, the fallback
palettes in `src/view`) is hand-authored by definition and is not listed.

Source classes: **owned** — read from a file (listed only where the reading
is the approximation); **engine** — behaviour the closed runtime has and the
files do not state; **inferred** — from memory of the game or its community
references, unverified against a file; **human** — a number the human read
off the reference; **measured** — fitted to a reference screenshot;
**chosen** — the agent's own number.

## Turks profile and shared foot-gunner garrison adapter (#188)

- **Owned:** pinned DAT civ 10, tree effect 263, team effect 410, `TURKS.json`,
  English help 120159 and civilization metadata define this profile. Janissaries
  46/557 use the existing single-projectile model (projectile 380, accuracy
  50/65%, dispersion .75), not a new approximated gunpowder attack. Mining tech
  300 addresses gold workers 579/581 only; skins share one simulation worker.
  Team attribute 101 multiplies **train time** by .8; it does not reduce unit
  costs. Sipahi 491 adds 20 HP and Artillery 10 adds 2 range/sight/search radius
  to source-addressed targets. No new civilization-specific runtime branch.
- **Inferred engine adapter:** class 44 (`cHandCannoneerClass` in Constants.xs)
  now joins foot archers/infantry in garrison mask bit 2. DAT Janissaries and
  Hand Cannoneers share class 44 and creatable type 4 (ordinary Archer is
  class 0/type 3); original unit help calls Janissaries Foot Gunners. Mapping
  that class to bit 2 is inferred, not a claim that these fields encode it.
  The existing hand-maintained garrison table
  omitted this class entirely. Public castle admission/elite-upgrade coverage
  now exercises it; native admission/arrow-contribution calibration is not
  established by these fields. No mask or capacity has been changed.
- **Inherited inferences, not new native measurements:** zero-time research
  follows required-count gates, without requiring its paid research building
  (#254). Empty effects 95/285 are not substitute upgrade implementations:
  tree 263 sets Chemistry/Light Cavalry/Hussar prices and times to zero.
  HP remains fractional (Janissary 35 × 1.25 = 43.75); research payment uses
  the shared whole-resource rounding (Elite Cannon Galleon 525 × .5 = 262.5
  source wood, charged 263). Native HP/half-cost rounding still needs calibration
  as in #260/#267. The regression asserts this adapter policy, not DE parity.
  The 1v1 locked-enemy model applies the team bonus to its owner only; there is
  no allied-seat propagation claim. Conversion snapshots remain the #178 policy.
- **Scope retained:** foreign/scenario targets (e.g. Sipahi 1738/1740, Artillery
  1709) remain explicit `unmodelled` diagnostics, not extra trainable units.
  Tree type-8 commands `(a=235/236, b=12, c=-1, d=1)` address **technologies**
  Make Camels Available/Heavy Camel, not tower unit IDs: XS names the operation
  `cModifyTech` and attribute 12 `cTechStackingEnabled`. Repeat/stack activation
  is not implemented; the existing one-time camel availability/upgrade pipeline
  remains in use. These commands stay diagnostic. General
  Chemistry projectile-art replacements and shared specialist limitations are
  not solved by making Chemistry free. Full native calibration, imported
  browser acceptance and rollout remain coordinator work.
- **Owned audio gap / explicit silence:** an independent audit of all 534 Turks
  cues against Base.pck and Base.1.pck found exactly three absent event objects:
  Trade Cart selection 3167914911, training 955679769 and graphic 2892846699.
  Only these exact Turks aliases publish as unavailable under #271; all other
  graphs resolve with the original Turks switch. No borrowed voice, ignored
  malformed graph or asset is introduced. Extend #271 to include these aliases.

## Saracen healing aura and source discrepancy (#187/#285)

- **Owned:** DAT civ9/tree261/team409, current tree research28/454/368,
  `xs/Effects.xs` EffectFunction7 and `xs/Constants.xs` define the Bimaristan
  task's work values75/1, range5, target classes, owner4/combat-level2,
  search-wait109/gather-type21 and help string13404. The importer expands only
  this reviewed function into unit research effects; unknown script functions
  remain unsupported. Mameluke282/556 stats/art and bonuses are imported normally.
- **Inferred runtime:** interpret75 as HP/minute (1.25HP/s), use inclusive
  centre-distance range5, strongest-only overlapping auras, exclude the emitter
  itself and garrisoned sources/recipients, and continue during movement, healing,
  conversion and relic carrying. Apply fractional HP each fixed tick after unit
  actions. Captured monks retain the researched aura with their conversion rules;
  its beneficiaries follow their current owner. The two-seat locked-enemy model
  means owner4 ally targeting currently reduces to same-owner recipients.
  Current-build185872 native editor observations support no self-healing and a
  working relic-carrier aura: isolated monks stayed25/45, then both recovered
  when brought together. Timed Knight controls with0/1/2 relic-carrier emitters
  support75HP/minute and non-additive overlap: both healing runs recovered20HP
  in about16game seconds; zero emitters left the wound intact. Exact boundaries,
  scheduling and other policies remain inferred; pinned-runtime acceptance is still open. See
  [Bimaristan calibration](bimaristan-calibration.md) and #285.
- **Source mismatch:** team409 adds class21 attack+3 to DAT class0, whereas owned
  English120158 says+2 versus buildings. Preserve DAT arithmetic and original
  localization rather than silently editing either. Native resolution is #285.
- Feedback currently uses recipient health and original research text. The
  original aura overlay/tooltip marker remains part of particle-feedback #49.
  Existing market curve, conversion inheritance and projectile timing inferences
  still apply. Retired Zealotry/Madrasah impossible-prerequisite research is not
  offered; this is the pinned modern profile, not a remembered historical tree.
- **Owned source gap / explicit silence:** both supplied audio packs contain no
  HIRC objects for Saracen Trade Cart events3167914911,955679769,2892846699.
  The fresh all-cue audit found exactly these three unresolved events. Publish
  only their exact Saracens alias/ID/switch tuples as unavailable (#271), without
  substituted voices. Existing/broken events and missing streams still fail;
  recovered events automatically take the normal decode path. These are the same
  three underlying regional-cart events as the owner-reviewed Persian exceptions,
  with separately audited profile aliases; duplicate#286 was folded into#271.

## Opt-in Wonder countdown (#110)

- **Owned:** Wonder task120, existing building DAT stats, announcement/timer
  strings3019–3024/3058/11300/11301/300180/300182 and `wonderpanel.json` geometry/
  original player banners. String9786 gives300years/25minutes.
- **Measured on installed185872, not pinned engine:** paid completion announces
  200years;353game seconds elapse for71displayed years; eventual victory occurs
  with the opponent's TC standing. The trial and rejected house-only/preplaced
  fixtures are distinguished in [wonder-victory.md](wonder-victory.md).
- **Chosen scope:** fixed opt-in200years, five simulation seconds/year, off when
  omitted. This is not a recovered automatic map-size default table or full
  Standard victory. It applies wherever explicitly selected, including surveys.
- **Inferred integration:** only actual completion arms a deadline; each building
  retains its own deadline, with one earliest banner per side. Destruction or
  ownership change cancels it; a rebuild starts fresh. Combat/death and ordinary
  conquest/royal loss resolve before expiry; opposing simultaneous expiries draw.
  Display rounds remaining years up. Native boundary/tie/multiple-Wonder/Atheism
  behaviour is not claimed. A banner's public focus position does not reveal fog.
- **View adapters:** adjacent flags pack one source flag-width apart; original
  default player colours and browser text rendering are used. Import every player
  banner because the widget's blue material is an engine-swapped placeholder.
  Visible controls beat the menu PNG's transparent hit rectangle without raising
  the cloth above its art. Palette/compositor/SDF parity remains unverified.
- Optional state/config/record fields preserve omitted legacy checksums. Shared
  protocol4 rejects older simulators; installed services remain on protocol2.
  `sim/wonder.ts`, `view/wonder.ts`, `tools/wonder_smoke.mts`.

## Configurable population ceiling (#253)

- **Owned:** `screensingleplayercreate.json` PopulationDropDown names label13516
  ("Population:") and help93516 (maximum units each player can create). The
  importer publishes both. Existing XS resource32/Gothic effect418 remains the
  independent Imperial+10 modifier, not housing.
- **Measured on installed DE,2026-10-03:** native selector offers25,50,75,100,
  125,150,175,200,225,250,300,400,500. Full-resolution dropdown/min/max captures
  are indexed privately under `native253-population-*`. The installed executable
  is101.103.54800.0 (#185872), newer than the pinned DAT; these are not claimed
  as recovered pinned-engine constants. Its saved choice was250, which does
  **not** establish a factory default. **Observed on current build 185872:**
  the skirmish lobby Reset sets 200 (#280, [speed calibration](speed-calibration.md)).
  The rules-bundle default 200 matches that reset-lobby path, not a claimed
  universal clean-install or pinned-build default.
- **Implementation policy:** optional authoritative `state.populationLimit`
  overrides every side's base ceiling; per-player resource32 is added afterwards.
  Housing remains a separate bound. The menu uses these measured choices in the
  existing compact setup form, not the native lobby's full layout. No mid-match
  cap command is provided; Start Game applies the choice to a new match.
- **Compatibility:** absent fields retain rules-bundle defaults, including old
  uncapped rules, without inserting a new checksum field. Explicit limits travel
  in v2 configs/records and JSON snapshots; v1 cannot carry one. Shared protocol3
  rejects older simulators and incompatible checkpoints rather than silently
  ignoring the ceiling (subsequently protocol4 for Wonder victory). Installed services remain release-pinned on protocol2;
  this change does not deploy or migrate their live state.
- **Observed visually on current build 185872, not pinned 48987, 2026-10-06:**
  with the same 225 housing and limit 200, Goths Imperial shows 1/210,
  Goths Castle 1/200, and Teutons Imperial 1/200. Goths Imperial with no houses
  shows 1/0; Teutons at limit 300 confirms 1/225. These separate editor Test starts
  support a ceiling bonus, not free housing; they do not measure an in-match
  research transition. [Method, crops and failed setups](population-calibration.md).
  Pinned-runtime parity remains unverified (#279). `src/sim/population.ts`,
  `rules.ts`, `match-setup.ts`, `tools/map_menu_smoke.mts`.

## Persian Trade Cart unavailable audio (#271)

- **Owned absence:** DAT8 unit128 and death graphic4862 reference Wwise events
  3167914911,955679769 and2892846699, absent from the inspected pinned common and
  English bank object tables. Legacy sound305's ordinary cart filenames do not
  establish a native fallback. Detailed source evidence is in
  [audio-reference.md](audio-reference.md#reviewed-persian-trade-cart-source-gaps-271).
- **Human-approved application policy, 2026-10-02:** these exact Persian
  selection/training/death aliases may remain silent and explicitly listed as
  `unavailable` rather than blocking the civilisation import. No foreign/default
  voice or synthetic audio is substituted. Other cart sounds import normally.
  This is a source-gap exception, not native-DE audio parity or recovered media.
- **Strict boundary:** only the three reviewed alias/ID/switch tuples qualify,
  and only while the event has no object in any loaded bank. Existing broken
  events and all other missing cues still fail. If original playable definitions
  become available, normal decoding wins automatically. Code: `import_audio.py`.

## Catapult automatic friendly-blast avoidance (#278; calibration #131)

- **Owned intent:** bundled TC Manual printed3/5 (physical5/7) says Mangonels,
  Onagers and Siege Onagers avoid automatic attacks that may harm friendly units.
  These are legacy manual statements, not a measurement of current DE targeting.
  Pinned DAT280/550/588 gives blast radii1/1.25/1.5, levels2/1/1, friendly-fire
  damage1 and accuracy100. Existing resolved rules supply the actual radius,
  projectile speed, research effects and blast-defense eligibility.
- **Inferred prediction:** test current same-owner bodies using the existing
  circular splash geometry, around the target's current centre and nominal led
  aim when the existing Ballistics policy leads it. Do not simulate future
  friendly movement, interception or scatter; an already airborne shot may still
  hit a friend who subsequently enters. Same-owner eligible buildings are guarded
  too because the current splash consumer damages them. Generic DAT friendly-fire
  scaling remains separate#54 work.
- **Chosen control/state adapter:** unsafe automatic targets are skipped; a held
  automatic order rechecks every simulation step, cancels pending windup/volley,
  keeps its cooldown running and seeks a safe alternative at the existing10-tick
  acquisition cadence. An optional saved attack-order marker preserves that
  intent through JSON. Explicit attack/attack-ground and unmarked legacy orders
  retain their existing friendly-fire behavior. Other unit families are unchanged.
- The open fallback's Mangonel/Onager now also carry their owned Combat Ability26
  flags, restoring deliberate ground attack rather than weakening the new
  fallback acceptance. Native pursuit, prediction, override and retarget timing
  remain#131; no exact modern-DE parity is claimed.

## Household startup discovery (#276)

- **Application policy, not a DE networking model:** HTTP/network/JSON/config
  failures keep startup pending and preserve the saved match; retry uses the
  existing1500ms WebSocket reconnect cadence. Static404/successful HTML fallback,
  explicit disabled configuration and `?solo=1` establish standalone mode.
- **Chosen diagnostic:** the existing startup banner displays an unavailable/
  reconnecting notice with the HTTP/parse failure, and protocol mismatch requests
  a reload. The owned English table's `IDS_MPS_RECONNECTING` concerns an already
  lost Multiplayer Services connection, not this application's initial HTTP
  gateway discovery. No native DE recovery timing or message parity is claimed.

## Islands fish (#95; remaining seasons/content #274)

- **Owned:** `GeneratingObjects.inc` GNR_STANDARDFISH requests global Gaia shore
  fish (9999, temporary spacing6), then scaled FISH_A/FISH_B (6/170, spacing4/8,
  maximum land-zone distance4). DAT69/455/456/458 provide shore/dorado/salmon/snapper
  food, classes, placement restrictions, original underwater/leap graphics and
  localization. `tools/fish_reference.py` checks the numeric map reference.
- **Inferred adapter:** global shuffled tile candidates use the existing isolated
  fish RNG, area/10000 scaling with nearest-integer counts, square spacing and the
  existing near-non-water mask as a proxy for native land-zone distance. Removing
  compulsory fish mirroring permits the two unpaired resource-islet coasts; it
  does not reproduce native placement order, random draws or distance semantics.
- **Season boundary:** PH_SPRING/PH_MEDISOUTH supply salmon/snapper and PH_DESERT
  dorado/snapper. The borrowed Nearctic-temperate dressing uses the spring pair as
  an explicit inference. Native weighted Islands seasons and additional object
  passes remain#274; grown water-mask clumps remain#95/#130 calibration scope.

## Ordinary second attack graphics (#270; native cadence #272)

- **Owned:** `type_50.attack_graphic_2` supplies second attack artwork for Camel
  Riders, Long/Two-Handed Swordsmen, Huskarls, Teutonic Knights and naval composites.
  Both graphics' frame clocks, original sound events and file-bearing deltas are
  retained. Camel pairs have frameDelay20 and.025s frames; the selected other
  pairs have zero frame delay. No decoder/packing function changes are required.
- **Documented interpretation:** UGC attribute131 describes alternating the two
  graphics. **Inferred scheduling:** start with the primary, alternate on each
  started ordinary windup, retain the last choice across retasking/Stop and saves.
  Each chosen source clock drives its windup and cooldown. A charged special
  weapon keeps its own graphic/clock and resets the next ordinary choice to the
  primary. If an upgrade removes the second slot, stale state uses the primary.
- **Native limits:** first-choice, cancellation/reset and continuous naval recoil
  cadence remain#272. Naval parent placeholders can have zero duration while their
  second composite is timed; drawing both owned compositions does not establish
  the closed engine's exact animation scheduler. The cosmetic source choice is
  authoritative saved state, never a view-side random draw.

## Shared atlas frame metadata (#268)

- **Chosen wire representation:** asset manifest schema4 stores repeated entity/
  annex frame arrays in `atlasFrames`, keyed by SHA256 of canonical frame JSON.
  Each atlas keeps its own image/pages/size/scale/count and refers to `framesRef`.
  Browser hydration restores shared arrays before any renderer consumes them;
  legacy inline manifests remain accepted. Missing references fail rather than
  supplying guessed geometry. This is transport/memory encoding, not a gameplay
  approximation: no frame, hotspot, page index, source pixel or rule is removed.
- **Measured trigger:** adding the seventh profile produced551,770,741 bytes of
  minified JSON, exceeding V8's0x1fffffe8 string limit before tests or rendering
  could load it. The six-profile pinned release was452,630,984 bytes. Shared PNG
  URLs alone did not deduplicate the repeated frame arrays.

## Byzantine healing, trample and bonuses (#185; calibration #267)

- **Owned:** DAT7/tree256/team400; Cataphracts40/553 and Camel Riders329/330,
  independent tech gates, MEDI buildings/HUD/flags, icons and Byzantine voices.
  Tree research-cost operation2 multiplies Imperial food/gold by.67; operations0/1
  remain set/add. Free Town Watch/Patrol and staged building-HP factors are imported.
- **Owned:** healing task105 has work_value_1=2 and Monk work_rate=1.25; team400
  sets resource89 (`healRateModifer`, source spelling) to2, and help120156 says
  +100% healing. **Inferred integration:** task amount times work rate gives2.5HP/s;
  resource0 means the ordinary rate and a positive resource multiplies it. This
  corrects the old task-amount omission for all imported monks. Fractional progress
  uses the existing integer-HP accumulator. Captured monks freeze this resolved
  unit-local rate under the shared conversion policy. Native cadence/stacking and
  sentinel semantics remain#267.
- **Owned + documented interpretation:** Cataphract blast_damage=-5 and Logistica
  radius+.5/+6 infantry attack; UGC attribute115 describes negative area damage as
  fixed HP. **Inferred geometry:** use the existing target-centred radius plus
  bystander hitbox, exclude owner/direct target, respect blast defense classes and
  deal exactly5 collateral HP without armour/elevation scaling. Positive melee
  blast damage scales the ordinary damage calculation. No native boundary/hill
  calibration is claimed. Greek Fire's source radius/range changes and projectile
  replacements506→537/508→1798 reach building and unit shots; shared ranged splash
  assumptions remain unchanged.
- **Inferred numeric policy:** building HP retains the source's fractional chained
  factors1.1/1.0909/1.0833/1.0769, with existing wound/foundation handling rather than
  substituting exact10/20/30/40% values. Native rounding remains#267.
- **Owned graphic composition:** MEDI garrison parents retain legacy2260/2263
  names (`I`, `R`, `B`, `RTWC2GI`, `MRKT2GI`, `ARRG2GI`, `STBL2GI`, `DOCK2GI`,
  `BRKS2GI`) without corresponding SLD files. Their delta11380 supplies the DE
  flag, retaining each original offset. The TC uses y−159/−165/−180 by age.

## Chinese opening, research and weapons (#184; calibration #260)

- **Owned:** DAT6/tree257/team402;226 deducts starting food200/wood50 after
  Town Center Spawn639,302 requires639 and annex307 and spawns three83 villagers
  at annex619 with spawnCap234=1.425 sets TC first resource storage to15 and adds7
  sight/search. **Inferred integration:** the automatic graph grants once at the
  first eligible completed TC, using the existing safe production exit placement;
  no subsequent TC rebuild, save/reload or age change repeats it. Starting-resource
  adjustments apply once to the current opening bank, including Regicide's preset.
- **Owned:** researchCostMod85 is1/.95/.9/.85 through304/350/351/352. The price
  at command acceptance uses the current factor, including age advances and Spies.
  **Inferred integer policy:** nearest-integer per resource, consistent with the
  existing cost consumer; pending accepted research is not repriced. Dynamic prices
  are visible to the HUD and agents. Native half-resource rounding remains#260.
- **Owned:** team402 makes repeatable232 free/zero-time;232 copies resource36
  multiplied by1.1 and multiplies resource69 (localization15069: Farm Food
  Multiplier, initial1). **Inferred reapplication:** use that multiplier once on the final additive farm
  capacity once (including later Horse Collar/Heavy Plow), round when sowing and
  keep existing crops unchanged. The resource36 copy and69 multiplier are paired,
  not two independent10% increases. Other232 targets (pastures/Folwarks)
  remain diagnostics outside this roster; native reapplication details are#260.
- **Owned:** Chu Ko Nu73/559 fire3/5 projectiles, first from the shooter and
  subsequent from510; Rocket Carts1904/1907 fire8/10 shooter-strength rockets.
  **Inferred scheduling:** distribute non-bulk shots through the remaining owned
  attack-animation duration, quantized to the20Hz simulation clock. Pending shots
  snapshot their damage/art, cancel on retask/Stop or target loss, and survive JSON
  saves. Source counts/stats are not proof of native cadence/spread;#260 retains it.
  Their embedded aura task155 templates are dormant: Combat Ability is0, without
  the enabling32 bit documented by UGC. They are not unconditional Chinese buffs.
- **Owned + documented interpretation:** Fire Lancers1901/1903 use type6,
  target127, range modifier4/5, special graphics13031/13067 and three1925 bullets;
  raw recharge precision preserves the30-second threshold. Lou Chuan1948 uses
  type6/target127/range modifier−3 and ten1936 arrows. English help26601 identifies
  arrows versus units and the long-range primary versus buildings/siege.
  **Inferred targeting/timing:** use that split, full-charge readiness, source
  special-animation windup and source bulk flag16; recharge in ordinary on-map
  simulation ticks. Fire Lancers close to melee while charge is unavailable.
  A weapon-mode change restarts its windup/animation together; ordinary pursuit
  with the same weapon keeps the existing windup. Native switching policy is#260.
  Arrow range follows attribute61 separately from the primary weapon's range.
- **Owned:** Rocketry483 changes weapon attacks and redirects1936→1879;
  Chemistry redirects1936→1937 and510→522. Projectile tables retain their own
  research effects, including repeated source commands. **Inferred redirection:**
  the latest completed replacement for an original projectile ID wins, then follow
  its replacement chain; already fired/pending shots keep their payload. Native
  order-dependent Chemistry/Rocketry redirection is explicitly unresolved in#260.
- **Owned + UGC interpretation:** `type_50.break_off_combat` corresponds to
  Combat Ability63: bits1/2 ignore melee/pierce armour/resist that bypass,8 permits
  Attack Ground,16 releases a bulk volley. Projectile hitMode1/vanishMode0 intercepts
  the first enemy and disappears; vanishMode1 keeps the existing piercing path.
  Rocket splash shares the same armour-bypass calculation. **Inferred geometry:**
  existing swept-radius collision, nearest intercepted enemy and melee splash
  against enemies only; native blast/friendly-fire boundaries remain uncalibrated.
- **Owned UI:** Attack Ground label4123/help4923, hotkey action23 (Definitive T)
  and the imported action-sheet rock/ground icon60. **Chosen layout:** cell5 in the
  current compact command grid; the owned buttons.json subset has no ground-fire
  placement row. A selected artillery unit receives a public coordinate order;
  subsequent targeting, damage and cancellation remain simulation-owned.

## Japanese bonus and unique-unit integration (#183; calibration #259)

- **Owned:** Japanese DAT5/tree255/team406; automatic190/306/340/341/422–424
  supply cavalry-archer attack exceptions, fishing HP/work, camp prices and
  Feudal infantry reload. Negative packed command−9730 means class38/−2,
  cancelling the class15/+2 bonus against skirmishers. Values, research gates,
  Samurai291/560, Elite Cannon Galleon691, Asia art/flags and voices are imported.
  Elite Cannon Galleon's tree row lacks `Node Type`; its `Link ID`420 and
  `Trigger Tech ID`376 still identify the paid upgrade.
- **Owned:** Yasama484/effect539 adds2 to both total-projectile attribute102
  and maximum107 on Watch Tower/Guard Tower/Keep. The existing secondary-arrow
  damage/scatter model supplies those extra shots; native volley calibration
  remains part of the shared garrison boundary.
- **Inferred engine interpretation:** Kataparuto59 multiplies deployed
  trebuchet42 work rate by4 and reload duration by.75. Preserve the existing
 4.5-second packing baseline (now read from its work-rate field), scaling
  duration inversely with the researched work-rate change. New pack/unpack
  orders take1.125 seconds rounded to23 simulation ticks; already running
  transitions retain their accepted duration. Native work-rate/time conversion
  and tick rounding are not established by the DAT; tracked in#259.
- **Owned + community interpretation:** Samurai task133 carries initiation
  distances2–6 (elite2–7) and speed multiplier1.25, with flag2001, ability3,
  type1/event0. UGC's task133/attribute61 documentation describes attack
  approach speed and non-depleting event0. **Inferred integration:** measure
  centre distance, latch the boost for the ordered target during pursuit, clear
  it on retask/idle; move orders use ordinary speed. This bounded mode adds no
  speculative charge damage or cooldown. Both running/task graphic slots are
  absent, so the owned walking animation remains the visual. Exact native
  boundary/pursuit/damage semantics require#259, not a claim of measured parity.
- **Owned graphic placeholders:** Japanese `F` graphics reference legacy
  SLP2220 (including garrison-flag parents and ship composites), with no F.sld.
  Treat F like existing W/X/M/E placeholder parents and traverse its deltas;
  file-bearing child offsets and original Asian flag sprites are preserved.

## Heresy conversion death (#180, shared conversion caveats #178)

- **Owned:** technology439/effect188 sets player attribute192 (`heresy`) to1;
  its monastery cost is1000 gold and research time60 seconds. English help28412
  explicitly says converted units die instead of changing to the enemy's colour.
- **Inferred integration:** successful conversion spends the usual monk/group
  faith, reads the defending player's current Heresy attribute, and enters the
  existing death lifecycle without changing ownership or creating a conversion
  snapshot. Carrier unloading/sinking, relic release and demolition effects use
  that same lifecycle. The general conversion timing/faith model and the precise
  native Heresy cargo/demolition exceptions remain uncalibrated under#178;
  regression tests establish deterministic implementation, not native parity.

## Teuton monastery, fortification and bonus integration (#182)

- **Owned:** action104 task rows identify target-specific min/max windows,
  adjacency range, research permission attributes27/28/29 and failure strings.
  The importer now preserves these fields, including the source label15029 for
  the unnamed XS attribute29. Source hero immunity plus excluded wall/gate/farm
  classes implement the non-convertible structures named in help28315.
- **Inferred scheduling:** specific-unit tasks override class/default tasks;
  zero task range uses the monk's normal conversion range, positive range uses
  the task's adjacency distance. The existing uniform probability model is
  unchanged, now using15–25-second building windows. Per-unit conversion modifiers,
  resource182 odds, foundation eligibility and native exceptions remain#178.
- **Owned healing evidence:** Teuton effect345 sets healRange90 to8 and help120153
  describes +100% healing range. **Inferred engine default:** a0 task/initial
  resource range means normal range4; this corrects the former adjacent-only
  imported monk. Captured monks retain the resolved unit-local range snapshot.
- **Owned capacity and projectiles:** effects335/352 separately modify capacity2
  and maximum-projectiles107. Existing volley contribution/rounding interpretation
  remains inferred; capacities, free healing and infantry-powered castle arrows
  are measured through public orders and actual projectiles.
- **Zero-time grants (#254):** Murder Holes retains a200-food source cost after
  tree262 sets its time and stone to0, while owned help calls it free. Zero-time
  public technologies now auto-complete without payment or an extra research
  venue gate. **Measured on current build 185872, not pinned 48987:** a Castle
  Teuton tower damages an adjacent ram without University (Dark control does
  not); a wounded villager heals 10→17 without Monastery versus 10→11 in a
  comparable Dark control. Editor-start food remains 1000, not 800. Readings
  are observed visually; [captures and failed attempts](free-research-calibration.md)
  bound the evidence. Exact activation ordering, live age-up payment accounting
  and pinned confirmation remain open; no exact healing multiplier is claimed.
- **Building capture:** see the converted-entity section below for retained donor
  rules and the inferred queue/cargo policy. Bombard Tower construction gates,
  projectile506 and the .5 fractional class3 attack addition are owned; the
  shared projectile collision/blast model remains the existing approximation.

## Gothic shared mechanics (#181)

- **Owned:** Anarchy16 selects train-location entry1 with attribute158 and
  writes barracks12 through attribute42. Huskarl41/555 preserve castle13s/button1
  and secondary16s/button4/hotkey16748. **Inferred integration:** tree759/761 are
  represented by the corresponding41/555 secondary slot, based on the actual
  Anarchy commands and matching nonzero combat/cost/graphics; the extra zero
  attack entry on41 is not a different playable unit. Slots, queue start times,
  HUD cells and native hotkey bindings use the selected producer.
- **Owned:** TC annex619 triggers307, satisfying Gothic automatic343, whose
  effect sets paid Loom to1 second. **Inferred representation:** completion of
  a parent triggers its declared annex bookkeeping without separate sim actors.
- **Owned:** hunting productivity268×1.23, worker rate×.8130081296 and hunter
  capacity+15. **Inferred integration:** preserve integer carried/banked food,
  multiply output work by productivity, consume1/productivity source food per
  carried unit, and clamp only productivity-adjusted terminal residue below1e−9.
  Ordinary gathering keeps its previous path; decay still consumes raw carcass
  food. Native fractional/last-unit rounding remains uncalibrated.
- **Owned:** Imperial technology406/effect418 adds10 to unit-limit resource32,
  distinct from housing; help63208 describes200→210. **Chosen mode default:** new
  rules bundles default to200 population; explicit match setup may override it,
  while missing legacy fields retain
  uncapped behaviour. **Implementation, supported by current-build native
  observations:** cap is min(housing, ceiling+bonus), with no free houses.
  Configurable setup is implemented; #253's reset-lobby default and Gothic
  bonus/housing calibration are recorded above and in
  [population calibration](population-calibration.md), not pinned-runtime parity.
  This replaces the previous unlimited housing sum for new rule bundles.
- **Owned graphics:** Gothic garrison composites include the fileless`E`
  placeholder (e.g.2416); its file-bearing children remain traversed. No missing
  real asset is substituted and no atlas decoder rule changes.

## Incendiaries death replacement (#181/#252)

- **Owned:** technology910/effect916 replaces fire-ship death with unit2624:
  HP−1,10 melee/+5 class60 attack, radius3, blast level2, sink graphic9347 and
  child12206's`explosion_demo_ships`. Costs200 food/325 gold,50 seconds, requiring
  Imperial and Siphons. Help528007 explicitly specifies detonation when sunk.
- **Inferred integration:** apply the source payload immediately through the
  existing non-owner blast/death lifecycle, including public Delete and Heresy;
  retain the source death-art identity/duration in serializable entity state.
  The explosion particle uses the existing single-feedback renderer rather than
  native simultaneous sinking/explosion/water-splash compositing. Native delay,
  death-reason/friendly-fire exceptions and exact layering remain#252.

## Audio pack boundary (#57)

- **Owned:** shared PCK bank/stream tables, HIRC objects and DIDX prefetch
  entries. Complete PCK streams replace matching embedded prefixes. Repeated
  pack inputs resolve cross-bank references with bank-local ID precedence;
  ambiguous global IDs are excluded from fallback. See `docs/audio-reference.md`.
- **Remaining inferred resolver boundary:** random/sequence container children
  are found by matching packed IDs, not a complete versioned Wwise node parser.
  Per-action media pools do not reproduce container weights, continuous loops
  or bus DSP. Play-action layers/delays/fades/probability are preserved (#248). Music
  HIRC10–13 is inventoried; gameplay music uses its separate HIRC15 decision
  tree rather than this effects-only resolver.
  Decoded WAV identity is verified; reference mixer equivalence is not claimed.

## World audio playback (#114, calibration #243)

- **Owned:** separate selection, move and attack-acknowledgement event IDs,
  task/female variants, building construction IDs, terrain ambient IDs, and
  graphic-wide/per-direction `angle_sounds` frame events. Parent sound events
  survive file-less composite ship graphics. No simulation state is written.
- **Inferred timing:** a building's construction cue plays when an observed
  owned foundation becomes complete. Graphic-wide cues start at frame0; raw
  DAT frame numbers are interpreted on the existing zero-based sprite clock.
  These timings need reference-audio alignment, not just source-field tests.
- **Chosen playback:** cosmetic per-action round robin; one acknowledgement
  group; at most24 simultaneous/scheduled HTMLAudio elements; UI/voice gain1, world0.6,
  ambience0.18. Owned v154 Play-action delay/fade/probability and delay ranges
  are consumed (#248); chance/range draws are a separate match-seeded cosmetic
  stream. Sounds load lazily after a gesture and release on end/error,
  restart or hidden tab. World sounds are raised only from on-screen, actually
  visible frames (debug reveal does not bypass it). Already-triggered layers
  may finish after the camera moves. A missed interval emits at most
  one occurrence of each event per entity, not a fast-forward sound backlog.
- **Chosen ambient integration:** one layered event from the visible camera-centre
  terrain; change/leave/pause stops it, all layers ending permits another invocation
  with a minimum two seconds between starts. Continuous nested loop/weight
  semantics are not Wwise's full graph.
  There is no continuous distance attenuation, panning or imported bus DSP yet.
  First sight/reconnect sets a silent baseline; existing corpses do not cry
  again. #243 owns mixing, ambient timing and spatial/reference calibration.

## In-game soundtrack (#115)

- **Owned:** `Ingame_Music` HIRC15 and its MUSIC01–30 state hashes, source
  objects and complete media.27 streams are available across the shared packs;
  three have only prefetches and are explicitly excluded/tracked as #244.
  Source resolution fails closed on unexpected dialogue-tree layouts.
- **Chosen/inferred playlist:** ascending numbered states, repeat after the
  last available track, no civilisation intro/theme or chapter transitions.
  The localization's Classic description motivates that scope, but exact
  ordering is not asserted from the engine. Default gain0.35, pause with the
  match/hidden tab, restart at track one; one native media element at a time.
  Browser WAV playback preserves decoded PCM; Wwise bus DSP and music-mode
  selection remain outside this consumer (mixing #243). #141 supplies persisted
  music/sound volume controls, including silent pause at zero music volume.

## Explicit gather-point targeting (#239)

- **Human correction:** selecting a production building does not itself turn
  the pointer into the flag cursor. Only the Set Gather Point action arms it.
- **Owned:** buttons.json action51, icon45, zero-based sequence4 → cell5;
  hotkeys.json definitive T independently confirms the grid cell. Localization
 4144/4944 supplies the label/help. The UI import retains native command-button
  metadata rather than baking the new button's source values into imported mode.
- **Integration policy:** left-click issues public rally commands for the armed
  owned producers and returns to normal; Escape/right-click/selection change
  cancels without changing a rally. Ordinary right-click rally remains available.

## Local options and native hotkey profiles (#141)

- **Owned:** WPFG screenoptions and its audio/game/interface/hotkey tabs;
  original panel00 nine-slice,1810×1500 panel metrics, font sizes and native
  button resources. Localization supplies the option/profile/palette labels.
  Both shared and game-specific hotkey-group lists are read; unit hotkey-text
  IDs minus139000 and technology description IDs plus10000 identify native
  string bindings. Four native profiles preserve explicit missing bindings.
- **Chosen UI adapter:** the supported controls share one centered compact
  panel rather than reproducing all five full-screen tabs. Browser select/range
  controls and linear0–100 volume scaling are integration choices. Defaults
  preserve the preceding sound gain1/music gain.35 and Normal speed. Apply/OK
  persist a validated local preference; Cancel discards the uncommitted draft.
- **Boundary:** speed stays a pacing preference; shared changes use the public
  settings channel and joining/reloading never sends local saved speed. Keys
  and palettes remain view-only. Native ram unloadT/cell5 and relic dropQ/cell1
  replace the old generic unit-unload cell when the source bindings are known.
- **Palette scope:** owned UI roles colour score/diplomacy badges, text,
  non-default selection health bars and live/remembered minimap dots. The field
  is labelled Interface: Color Blind Mode. World sprites/portrait ramps still
  use their existing original.pal blocks; the separately inspected256-entry
  colour-blind sprite LUTs require their actual shader addressing (#246).

## Example fishing policy and explored-map input (#91)

- **Owned policy evidence:** Promisory watercontrol uses a14-tile deep-fish
  allowance and25-tile dock-centred search; units/buildings have conditional
  fishing goals and4/8/12-boat limits. Dock150 wood/radius1.5/row6/hill3 and
  ship75 wood/40s/row13 are the current DAT baseline. See the bounded eight-file
  reading in `docs/ai-fishing.md`; the scripts themselves are not copied.
- **Chosen adapter:** a fixed four-boat cap, baseline price reservations,
  housing/wood-economy precedence, restaffing paid dock foundations, rotating
  eight nearby coast candidates every three game seconds, coarse obstacle
  spacing and known-land/water component checks. One idle boat explores known
  water frontiers; current gather/bank orders are not repeatedly replaced.
  This is example-strategy policy, not DE's full buildability/search runtime.
- **Protocol choice:** observation v8 carries run-length encoded explored
  terrain/elevation as `[length,id,height]`, with−1 for unknown. Static ground
  is public once explored; no hidden tile or neighbour changes the output.
  The strategy never receives privileged GameState or queries placementLegal.
  Command acceptance remains authoritative. Simulation/record/shared-wire
  formats are unchanged by this observation/strategy addition.

## Civilisation roster / selection foundation (#122)

- **Owned:** identity, era, HUD family, display/computer names and emblems come
  from `civilizations.json`/localization. Typed tree nodes, including absence,
  determine availability. DAT entities, per-civ graphics, flags, icons and voices
  are extracted independently. `M` is another file-less SLP-2260 composition
  marker (Frankish garrison graph); child layers supply the art.
- **Chosen integration policy:** the 53 base-era inventory entries are not 53
  playable profiles. Extraction and enablement are separate. Reviewed DAT-keyed
  units use supported combat mechanics, not every unit with a train location.
- **Chosen UI adaptation:** two native HTML selects extend the existing map
  menu; the label is owned `IDS_MPS_CIVILIZATION`, not a reproduction of the full
  native lobby. HUD family/emblem use metadata; other families need review.
- **Inferred presentation:** captured units retain unit-local stat snapshots
  while their art/voice lookup follows the recipient profile. The shared supported
  roster includes foreign unique definitions for capture/upgrade rendering.
- **Owned alias evidence:** the palisade's completed 789 points to head 792,
  whose stack points back. Ram technology 712 (common, Dark Age 104 prerequisite)
  upgrades tree unit 1258 to the imported 35; both Briton/Frank records share
  name ID 5094, 175 HP, speed ~0.6, workshop 49, 36 seconds and button 1. The
  reviewed `treeUnitId` spec alias and reciprocal head lookup preserve these
  permissions under typed absence denial. Cuman tech 706 has different gates
  and is not enabled by this milestone. Catalogue missing IDs exclude represented
  aliases/heads, rather than calling each a missing playable unit.

## Petard, siege tower and ram crews (#131/#161/#179/#180)

- **Owned:** petard 440 trains at castle 82: HP 50, speed .8, 65 food/20 gold,
  25 seconds; attacks 26:100, 11:500, 4:25, 20:60, 22:900; blast .5, level 2.
  Tower 1105: capacity 10, speed .96, HP 175, 100 wood/120 gold, 36 seconds at
  workshop 49, no attacks. Task 14 targets class 27; XS calls it
  `cTaskTypeUnloadOverWall`, help 26445/3123 describes crossing enemy walls.
  Both civs, tasks and ram identity aliases were inspected.
- **Inferred crew constants:** living class-6 infantry adds .05 tiles/s to a
  ram/tower and 10 class-11 attack to a ram. Villagers add neither. Tower
  archers/monks can ride without speed. DAT/tasks/XS/help establish the mechanic,
  not these constants. Passenger mask 11 is inferred from the foot/mounted
  prohibition. Contributions stay live, never in conversion snapshots; #161's
  patch-matched numeric calibration remains open.
- **#161 secondary corroboration (2026-09-28):** the public Battering Ram and
  Capped Ram references document +.05 speed/+10 anti-building damage per infantry,
  excluding villagers and Siege Engineers amplification of the crew addition.
  This supports the existing constants but is not a pinned native-runtime
  measurement. Fresh actual-distance/HP/unload/browser checks pass; source links
  and the exact remaining boundary are in `docs/civ-specialists-integration.md`.
- **#161 current-build native (2026-10-06):** **measured on current build 185872,
  not pinned 48987**, **observed visually** in the native attack tooltip:
  Teuton Battering Ram All Buildings attack 150/160/170/190 for 0/1/2/4 Militia;
  unloading restores 150 and one Villager leaves 150. This supports the +10
  crew attack addition and villager attack exclusion. A follow-up simultaneous
  flat-ground race measured displacement 366/486/366 screen pixels for
  empty/four-Militia/one-Villager rams over the same interval: ratios
  1/1.328/1 (approximately ±.02), consistent with .6/.8/.6 tiles/s.
  Absolute tile speed and individual speed increments were not independently
  measured; this is current-build ratio corroboration, not a DAT import.
  Capped Ram only has a valid empty baseline. Method, rejected attempts and
  private capture paths: `docs/ram-crew-calibration.md`.
- **Inferred petard semantics:** one blast on attack contact, none on interception/
  deletion. Reuses demolition owner immunity, full damage within radius, armour/
  elevation and centre-to-target-radius resolution. This is not established by
  the DAT's numbers (including `friendly_fire_damage = 1`).
- **Chosen landing geometry:** completed enemy wall of the task class, nearest
  cardinal face, tower outside; passengers just beyond one footprint at offsets
  0/±half of its half-extent and .1 clearance. Blocked cargo retries; double walls
  cannot be jumped. Diagonal/gate crossing, cadence and ordinary egress/destruction
  retain explicit approximations.
- **Owned feedback:** death 5461 → delta 12217 → `impact_petard.json` uses
  `impact_explosions.png` frames 90..174, 85 frames, 1.5 s, scale .6, replacing
  the parent's misleading idle filename on the saved corpse clock. Tower slots/
  flags are its own. Native sound cues remain #114. See the specialist contract.

## Briton deployed research and paid production

- **Owned, 2026-09-26:** DAT technology 461/effect 540 adds blast width .5
  and sets accuracy 100 on deployed trebuchet 42, whose baseline blast is zero.
  Technology 377 addresses both packed class 51 and deployed class 54 separately;
  applying both to one attack would double Siege Engineers. The rule resolver
  retains the deployed target identity, armour, sight and search values separately.
  XS constants name blast/search attributes 22/23 and garrison firepower 130.
- **Owned:** Shipwright 373/effect 371 multiplies ship training time by .65
  and wood cost by .8; the localized description's “50% faster” is not used to
  replace the DAT multiplier. Caravan 48/effect 482 multiplies both speed and
  work by 1.2. Work now reaches trader income, and ship training reads the
  researched duration. Existing paid entries retain their original price in
  snapshots and refunds.
- **Inferred:** active paid production keeps its purchased clock; waiting
  production takes the effective duration when it begins. Legacy saves without
  price receipts refund their current rule cost because the original payment
  cannot be reconstructed. Search radius is limited by the unit's sight for
  autonomous acquisition. Existing blast geometry/damage interpretation remains
  the shared approximation; Warwolf does not introduce a second damage model.
- **Evidence:** `briton-research.test.ts` measures splash damage and projectile
  JSON continuation, actual Siege Engineers shot/range, Shipwright completion
  and cancellation after discounts/JSON. `test_briton_research.py` connects the
  consumed values to DAT effects. The published-manifest monastery browser probe
  also clicks Warwolf and verifies damage to a neighbouring unit. Its targets
  are inside the splash boundary, rather than on a floating-point boundary.

## Block-compressed sprite evaluation (#163)

**Measured on native RTX4060 WebGPU, 2026-09-30:** direct source BC1/BC4
substitution is not pixel-identical to the existing CPU decode/PNG path. Main
samples differ by up to7/255 in unorm data space (16/255 in linear-light readback
from sRGB textures); shadow data differs by up to5/255. PNG agrees with the
current decoder. An isolated eight-texture experiment measures about128MiB of
dedicated GPU allocation for RGBA8 versus16MiB for BC1; physical allocation is
not inferred from file size. **Decision:** keep PNG in production, reconcile
decode semantics under#256 before any compressed rollout. No approximation or
production decoder change was introduced. Scope, hashes, colour spaces and
reproduction: [evaluation](block-compression-evaluation.md).

**#256 follow-up:** the primary D3D11.3 specification requires high-bit
replication for RGB565 promotion. `_rgb565` now implements it: source white is
255/255/255, correcting the old248/252/248 export. The portable BC1 interpolation
rounding stays as before. BC4 retains its existing floor-to8-bit PNG export,
an explicitly quantized approximation to a format requiring at least UNORM16
sampling; it is not claimed to preserve native sub-byte mask precision.
The spec allows vendor-dependent BC1–BC5 interpolation within per-channel
bounds, so the earlier zero-PNG-difference requirement is not a universal
hardware-fidelity contract. Float readbacks on RTX4060 pass those bounds and
exact endpoints over2,121,728 texels. Shader-resource inspection confirms
post-sample luma/team processing, not a runtime bound-format capture. Source,
verification and rollout boundaries: [decode contract](block-decode-contract.md).

## Converted-entity inheritance (#178)

- **Owned inspection (2026-09-24):** root resolved with the main checkout's
  `tools/depot.py`. Pinned `depot_813781/resources/_common/dat/empires2_x2_p1.dat`
  Briton/Frank unit records 8/83/125 were read, including unit-local HP, speed,
  sight, attacks and terrain restriction. Longbowman 8 exists in both DAT civ
  arrays (35 HP, speed ~0.96, sight 7), independently of train availability.
  Loom effect 22 changes villager-class HP/armour; Ballistics effect 93 changes
  projectile smart-mode, not the shooter. `xs/Constants.xs` distinguishes
  `cUpgradeUnit = 3`, unit conversion modifiers, and player resources such as
  `cAttributeConvertResistance = 77`. English help 4925 says conversion changes
  player colour/control. These sources expose the data boundaries; none of
  these inspected entries specifies runtime inheritance. **2026-09-26 update:**
  the shipped English PDFs are now extracted with locked pypdf. AoK printed p33
  (PDF36) explicitly states that converted units retain their conversion-time
  attributes and cannot be upgraded. This is owned legacy prose, not a modern
  exception table; see [bounded audit](shared-reference-audit.md).
- **Owned legacy prose / community corroboration:** the AoE II section of
  <https://ageofempires.fandom.com/wiki/Conversion> (read 2026-09-24) says
  converted unit attributes lock, retain civilisation-specific properties and
  no longer receive upgrades, with exceptions for civilisation/player-side
  properties. This is not a patch-matched DE runtime measurement. `Entity`'s
  `convertedRules` snapshots resolved unit-local rules before ownership changes;
  `unitRulesForEntity` uses that snapshot, including for captured unique units
   and directly converted entities. HP/wounds are unchanged. Future research on either side and
  later reconversions cannot promote or alter these captured unit attributes.
  Research queues/production still use the receiving player's catalogue.
- **Explicit remaining reference gaps:** player-level attributes, build/tree
  permissions, economic gather rates/capacities and projectile Ballistics
  currently follow the recipient's existing systems. The DAT's separate task
  and projectile records motivate that distinction but do not prove the closed
  runtime's conversion exceptions. Gather-task switching (villagers/fishing
  ships), projectile smart-mode,
   special future civilisation abilities, and reconversion/building-passenger inheritance
  still need patch-matched DE captures before claiming full parity. Building
  conversion is now implemented by the Teuton pass below. Pre-existing snapshots without conversion
  provenance retain their legacy current-owner resolution; lost donor data
  cannot be reconstructed.
- **Building extension (#182):** `convertedBuildingRules` freezes the donor's
  resolved building stats before ownership changes. Combat, armour, sight,
  garrison/healing, production work rate, repair cost, navigation and owner HUD
  read that snapshot; later age/research promotions skip it. Existing HP/wounds
  persist. **Inferred integration:** former production/research queues and rally
  orders are cleared without refunds; future production uses recipient units and
  technology permissions at the retained building work rate. New active/waiting
  production entries receive the recipient's unit upgrades even though the
  building itself remains locked. Cargo uses the
   existing building-cargo capture/immunity policy, stopping at mobile carriers.
   Native queue/building-cargo/presentation
  exceptions remain#178, not source-established facts.
- **Evidence:** `src/sim/conversion-inheritance.test.ts` uses deliberately
  synthetic contrasting profiles and public monk orders, research, movement,
  combat, boarding/unloading and construction. It measures retained wounds,
  damage/armour, sight/range, speed, promotion exclusion, recipient farm food,
  JSON save continuation (transport-stable synchronization hash), and a recorded
  train/convert/research replay. Waypoint/overlap separation costs up to part of
  one initial movement tick, so the one-second displacement check allows 0.05
  tiles (3 donor vs 0.6 recipient); no test timeout was widened. Two owned Loom
  cases additionally measure preserved wounded HP and militia damage (3 with
  donor Loom's +1 melee armour, 4 without), despite subsequent recipient/donor
  research. Integration guards corpse/blast lookup for non-unit resource nodes;
   animals remain valid unit-rule consumers.
- **Mobile cargo correction (user-supplied behaviour, 2026-09-30):** the user
  states that converting a unit with garrison leaves passengers aboard under
  their original owners; only the carrier's new owner can eject them. Heavy
  nonlethal damage does not eject mobile cargo. `inheritConvertedUnit` therefore
  stops at a mobile carrier, preserving all nested cargo and existing provenance
  without creating passenger conversion snapshots. Unconverted passengers remain
  eligible for their own owner's research; the research walk now reaches nested
  cargo too. Population already counts each unit's owner recursively. This
  supersedes the earlier recursive mobile-capture inference and the legacy TC
  ram-ejection description for supported gameplay. It is a user-supplied rule,
  not a native capture made by the agent; building conversion cargo remains
  inferred. Tests cover ram/tower retention, forbidden former-owner ejection,
  new-owner ejection, original-owner upgrades, nested transport reconversion,
  wounded HP, nonlethal damage and JSON synchronization. The private
  `tools/conversion_cargo_smoke.mts` verifies real ejection clicks, captured HUD,
  enemy ownership and reload in owned and fallback modes.

## HUD feedback (#58)

- **Owned notifications:** `notificationpanel.json` origin (40,305), 600-wide
  BlackPanel Surround, grid step 32, inset (10,10), line size 40. The old 250-high
  template is a maximum, not a fixed-height box: **human capture** (2026-09-24,
  2560×1440, HUD 100%, Normal notifications, Readability Panels on) shows one
  line at 60 reference pixels including padding, two at 100. Bold white text
  replaces the template's brown placeholder; the HUD's existing 0.70 widget
  text scale remains **inferred**. Localized prompts 10213/10214, Yes/No
  4003/4004, research template 37157 and creation template 37159 are **owned**.
  UIColors palettes and UiColors.txt tags retain source alpha.
- **Native confirmation:** the empty `widgetui/dialogyesnoboxgeneral.json` has
  a substantive sibling in `wpfg/dialog/dialogyesnoboxgeneral.xaml`. The latter,
  `DialogBackgroundRect`, ButtonLarge and text/font resources now supply the
  black/gold frame, 560-wide buttons, 85×87 close button, 52-point Times New Roman
  Bold message and Trajan Pro Bold buttons. This supersedes reuse of the replay
  parchment dialog. Nine-slice PNG pixels and source dimensions are imported;
  auto row layout is mapped to CSS. Browser line-height 1.15, disabled kerning,
  drop shadow and 92% black modal dimmer are **inferred** from the supplied
  capture, not closed-runtime values. Browser focus/tab behaviour is used;
  simulation continues while confirmation is open. DAT eligibility and explicit
  mixed-selection No semantics are preserved; lifecycle abort dispatches no
  command. Captured match identity is checked before deletion.
- **Chosen feedback policy:** five recent messages, six wall-clock seconds per
  message, oldest overflow eviction, existing 250 ms panel fade; wrapping text
  scrolls to the newest line. The template's brown MultiColorTextBox placeholder
  is replaced with the owned White tag for readability over BlackPanel art.
  Font-face/index mapping and 0.70 text scale reuse the existing HUD inference.
  Attack/farm alert wording is project text after inspecting owned localization
  and sound aliases; research and newly created units use owned templates.
- **Blocked production:** warning requires an owned producer whose paid unit
  is ready but cannot fit under the population cap, matching the simulation's
  actual wait condition. Being at the cap with no blocked producer does not
  show it. Red wording 3075 is **owned**. The 828×134 panel, centre +200 from
  viewport centre, bottom inset 374 and 34-reference-pixel bold Times text are
  **human-capture-derived/inferred** from the supplied 2000×1125 preview of the
  2560×1440 screenshot; the nine-cell art is owned. `PopulationFlash` supplies
  its 140×72 box and normalized yellow alpha 0.7; one-second blinking is chosen.
- **Global queue:** `technologyprogresspanel.json` supplies origin (0,115),
  width 3050 and height 150. The screenshot's two-row setting gives 75×75 cells.
  Research/unit art is owned; click selects the producer through the existing
  view callback. One entry per paid slot, active/pending rows, green/yellow/red
  overlay amounts and count typography are **inferred** integration, not a
  complete reconstruction of engine aggregation. No production rules change.
- **Palette scope:** #141 now owns the persisted interface selector and its
  score/diplomacy, selection-health and minimap roles (above); source tags still
  supply default lower-HUD healthy bars and modal backdrop. World sprite LUTs
  remain #246. `GameMsgPanel.json` supplies nine empty full-
  screen anchors, not the message typography described in the original issue.
- **Defeat announcement:** collection origin (1140,110), 520×100 Surround,
  75×75 civilisation icon, 42×42 number badge and label at x=144.5 are **owned**
  from `GameNotificationPanel.json`; wording is the full symbolic localization
  key `IDS_GAME_NOTIFICATION_PANEL_DEFEAT`. Substituting the loser's existing
  score-row name/colour/civ icon for the template's Ashley/FlatColor/red
  placeholders is **inferred** runtime binding. It appears when the current
  two-player match reports a winner and expires after six wall-clock seconds
  (**chosen**, matching the message policy); it does not change defeat rules.
  The ObjectiveChangeAnchor belongs to future objectives work under #138.
- **Full end screen:** `wpfg/dialog/dialogendgame.xaml` supplies the 5160×1352
  frame at (-660,316), row layout, 200-point Trajan Pro title, divider and
  626-wide Return/Leave buttons. Frame/crest PNGs, separator, fonts, gradients
  and strings 9004/9005 plus `IDS_RETURN_TO_MAP`/`IDS_LEAVE_MAP` are **owned**.
  Shiny2's centre-preserving horizontal slices are mapped to a CSS grid;
  glint modulation is not reproduced. The supplied loss capture corroborates
  the crest/line/button positions. Browser line metrics/kerning and dimmer
  remain **inferred**. Return dismisses without changing the finished match;
  Leave opens this project's existing match launcher, since it has no DE
  postgame/main-menu shell. This is **chosen** navigation, not an imported
  achievements screen. Dismissal survives view hot reload.
- **End-screen embers:** `emberwindow.xaml` and `applicationwindow.xaml` bind
  alpha/additive overlays; `ember_ps.so`'s documented SM2 stream supplies a
  procedural capsule-distance quadratic fade. No ember emitter parameters or
  texture were found in the enumerated WPFG/particle resources. The browser
  pre-rasterizes that falloff and animates 900 independently seeded motes at
  30 fps; distribution, velocity, warm colours and scale are **chosen/inferred**
  from the human's animated-lights description and screenshot, not a measured
  DE trajectory. It uses no simulation RNG and stops on dismissal/destruction.
- **Generic OK popup:** `popupmessage.json` provides the centred 1280×720
  viewport, parchment, message rectangle, 442×60 button at (420,575), normal
  38-point and hover/pressed 45-point sizes; OK is owned string 4001. Using this
  modal for malformed/incompatible replay files and shared-mode replay refusal
  is **chosen project error presentation**, not an assertion about DE's error
  routing. Existing diagnostic wording is retained. Imported parchment corners
  preserve source alpha instead of painting the open-fallback beige behind it.
  Native modal focus/Escape behaviour and the existing 0.70 text scale remain
  approximations. The human explicitly accepted owned-source treatment without
  a runtime screenshot on 2026-09-24; this is not a #58 blocker or a claim of
  screenshot equivalence.

## Simulation

The [2026-09-26 bounded audit](shared-reference-audit.md) distinguishes owned
legacy prose from current DAT values for market/conversion/Treason. Siphons'
task133 and target64/vanish2 meanings remain unresolved under #242; their mere
presence is not an implemented rule. AoK's Lock Teams ally-only tribute also
conflicts with the current enemy-tribute adapter (#138); modern calibration is
pending. No user approval of these remaining interpretations is claimed.

### Town-center construction (#177)

The importer follows completed unit 109's `building.head_unit` to 621, whose
`stack_unit_id` points back to 109. **Owned** construction values (Britons and
Franks): 275 wood + 100 stone, 150 seconds, villager builder 118, button 11.
The finished unit retains its HP, annexes, hill mode 2, five population and
drop-site roles. Tech-tree building connection 621 enables through tech 187,
whose only prerequisite is Castle Age tech 102; there is no other building
prerequisite. Connection 109 has no enabling research. The age upgrade effects
also replace construction heads (621 → 617/484/597), with the same base cost,
button and time. This change implements no civilisation discounts.

**Inferred engine interpretation**, supported by owned data/scripts rather than
a DE runtime capture: before that age, allow a replacement only if the player
has no living TC, counting foundations immediately. `Constants.xs` names
resource 218 `FeudalTownCenterLimit` (Briton/Frank initial value 1), and resource
48 `TownCenterUnavailable` (0). `Promisory/buildings.per` 204–229 explicitly
rebuilds when the TC count is below one and no pending TC exists, without an
age condition; 399–413 additionally checks `town-center-foundation` (621).
DAT shadow techs 308/722 name the foundation and early TC but contain no
replacement predicate. We represent the finished building and foundation as
one entity, so one live-entity count implements the slot reservation. Dead
TCs/rubble do not consume it. Before-Castle construction has no additional
building prerequisite in the inspected sources. The diagnostic limit message
is project wording. Cuman early expansion and scenario TC prohibitions are
outside this Briton/Frank prerequisite; resource 218 is not treated as a live
counter. Old manifests missing construction-head metadata use the transcribed
open-rule cost/time/button until regeneration.

Verification: `src/sim/town-center.test.ts`, focused owned importer test
`test_town_center_construction_uses_the_head_not_the_finished_building`, and
`tools/town_center_smoke.mts` (private browser; `TC_CONTENT` optionally overlays
freshly extracted TC metadata in memory without publishing a partial import).

| What | Shipped as | Source | Where | Issue |
|---|---|---|---|---|
| Slope-sensitive building placement | DAT `hillMode` 0 allows any relief, 2 requires equal levels, 3 permits a maximum-minus-minimum of one level over every covered tile; old manifests use the transcribed open-rule modes. Unused/unrecognized nonzero modes use flat-only treatment | Building mode **owned** from `unit.hill_mode`, including Thracian barracks 0 versus Briton 3 and both TCs 2. Mode meanings **community-documented** in [UGC attribute 187](https://ugc.aoe2.rocks/general/attributes/attributes/#187-hill-mode). Applying them to half-open tile-centre samples, fractional survey differences and all one-level corner orientations is **inferred**, not a patch-matched runtime measurement of DE's discrete slope/corner topology. Existing red/green preview and rejected-click feedback reuse authoritative legality; diagnostic “placement is on unsuitable elevation” is project wording after inspecting owned placement messages 3094–3096 | `import_content.py`, `data.ts`, `elevation.ts`, `game.ts` | #176; exact topology remains #134 |
| Starting town-center pads | At match generation, level only tiles inside each player TC footprint to its centre tile's authored level; never mutate baked source arrays or terraform later construction | **chosen** minimal playability edit. Windsor's original starts span levels 0–1 and 1–2, violating owned TC `hill_mode` 2; Senlac and current generated starts already pass. Renderer, fog and combat receive the resulting authoritative grid before the initial visibility pass | `game.ts` `createGame`, `elevation.ts` `levelStartingFootprint` | #176 |
| Elevation combat | post-armour damage ×1.25 downhill, ×0.75 uphill, ×1 on equal ground; retains fractional HP, including multiplying the existing minimum damage; projectile origin versus each victim's impact-time tile level | **inferred** base multipliers from [community Elevation article](https://ageofempires.fandom.com/wiki/Elevation#Age_of_Empires_II). Owned tutorial 73020 confirms higher-ground advantage. XS `cAttributeElevationBonusHigher/Lower` (211/212) and `ElevationDamageHigher/Lower` (272/273) are modifiers: Gaia/Britons/Franks all zero in the pinned DAT; Tatar effect adds 0.25 to 211 and Georgian effect adds −0.15 to 273. Those are not the base rule. Launch-point lifetime, victim-at-impact timing, fractional survey comparisons and minimum-damage ordering are inferred integration, not runtime-measured; civilisation modifiers remain #123 | `sim/elevation.ts`, `game.ts` | #134 |
| Generated hills | Arabia non-extreme global roll; Black Forest clearing/forest passes; mirrored cost-grown footprints eroded inward into one-level eight-neighbour terraces, preserving a four-tile starting square; independent seed stream | Heights/counts/chances **owned** from `Arabia.rms` 265–278/897–925 and `Black_Forest.rms` 298–315; flat baseline 2 from help 30534, normalized to zero. **Chosen** growth/erosion, 100×100 quota scaling inherited from this generator, start protection and independent stream. Actual RMS spawn placeholders/biome-specific spawn elevation and engine `cleanElevation` are not reproduced; maxima are ceilings, not guaranteed peaks. Water remains flat; surveys are untouched; ordinary slopes retain existing traversal and LOS, cliffs require explicit geometry/obstructions | `mapgen.ts` `generateHills` | #134 |
| Stationary collision tie-break | add a 1e-6-tile, entity-id/golden-angle perturbation to collision normals; contact distance remains the sum of unit radii | **chosen** numerical symmetry breaking for #83's reproduced arrival line, not DE formation geometry. Inspected owned `selection_group_def.json` (selection categories) and `hotkeys.json` (box/line/staggered/flank actions 84–87); neither specifies collision resolution. Uses existing DAT-backed radii and no simulation RNG; explicit formation slots remain unimplemented | `nav.ts` `separateUnits` | #83 |
| Remaining DAT movement/foundation/combat fields | audited values, not silently supported rules | `dead_fish.min_collision_size_multiplier`, general foundation terrain/rubble, armed-idle art, reaction flags, target-unit conversion modifiers, generic friendly-fire scaling and full19-entry slope shapes remain unconsumed. Source values do not establish exact runtime semantics. Garrison/audio/terrain passability and plants have since gained consumers; see `docs/dat-field-audit.md` and `tools/README.md` for the current matrix and exceptions | importer/runtime audit only | #54 |
| Starting resources | 200 food / 200 wood / 100 gold / 200 stone | game setting (the reference's Standard); the DAT's `civs[1].resources[0..3]` are 0 | `data.ts` `rulesFromManifest` | #109 |
| Herdable claim rule | claimed by whoever comes within its line of sight | inferred rule; the distance is the DAT's `line_of_sight` (3) | `data.ts` `animal`, `game.ts` | — |
| Training beyond housing | paid queues may exceed the population cap; the active unit finishes at 100% and waits until its full population cost fits, then releases before the next entry trains | **inferred** engine timing from #143's reference behavior; housing message **owned** string 3005 (also 20607), production-halted strings 3075/3076 corroborate the state. Reuses the existing population-cap cue for a one-shot message and keeps the same message in the selected blocked producer's status; exact reference alert timing/layout not measured | `game.ts` `updateBuildingProduction`, `main.ts` | #143 |
| Drop-site acceptance | building resource sets and task-specific return-site lists come from worker DAT sites intersected with JSON worker/class/resource rows; a carried load retains its gathering task | **owned** `dropsites.json` plus `bird.drop_sites`/tasks; Gaia-only target classes come from the already imported resource rather than empty player DAT slots. Open/older manifests retain transcribed defaults. JSON target-state transitions are outside the current entity-state representation; imported `acceptsLivestock` is metadata, not livestock-delivery behavior. #136 separately implements AI sheep move orders to the TC, not an automatic simulator follow/delivery rule | `import_content.py` `import_drop_sites`, `data.ts`, `game.ts` `nearestDropSite` | #52/#136 |
| Speed / train / reload / frame defaults when a manifest field is absent | `?? 0.8`, `?? 25`, `?? 2`, `?? 10` | chosen; only reached when a manifest key is missing (`imported-rules.test.ts` holds the stated ones) | `data.ts` `rulesFromManifest` | — |
| Match-speed names and multipliers | Slow1.0 / Casual1.5 / Normal1.7 / Fast2.0; fresh local/pristine shared default index2 | Names **owned** strings13101/13126/13102/13103; nominal multipliers **measured** directly in native185872's game-clock overlay while using owned VK_ADD/VK_SUBTRACT bindings. Earlier20033–20036 "Default/Fast/Extra Fast" evidence was the **replay** hotkey group, not match presets. Numeric indices/multipliers are retained, so existing saved1 remains1.5 and is now labelled Casual. Current-build Game-pane reset displays Casual and reaches new editor tests; skirmish-lobby Reset instead selects Normal and launches a Normal1.7 match, supporting our fresh default for that path. Sustained current-build clock samples measure Slow1.000, Casual1.494, Fast2.000 and Normal1.628–1.667 depending on the sampled frame cap; these are observations, not replacement constants. Pinned runtime and native multiplayer defaults remain unverified; see `docs/speed-calibration.md`. Fast-forward5×/10× are still project extensions; fixed20Hz/replay state is unchanged | `main.ts`, `preferences.ts`, `shared/protocol.ts`, `tools/options_smoke.mts` | #280 |
| A foundation's line of sight | 0 | chosen against observed behaviour (issue #1); DAT has no construction-time LOS | `visibility.ts` | — |
| Conversion odds | uniform over the selected DAT task's window: ordinarily5–9 s for units,15–25 s for buildings, plus defender adjustments | chosen shape; task endpoints and ranges owned; per-unit modifiers/resource182 odds remain uncalibrated | `game.ts`, `monastery.ts` | #178 |
| Converted-unit stat inheritance | unit-local rules snapshot before ownership changes; stored HP/wounds persist; later research/promotions skip captures. Mobile passengers keep their owners and remain aboard, with ejection controlled by the carrier owner | **Owned legacy prose** supports conversion-time attribute retention/no upgrades (AoK p33); mobile cargo rule **user-supplied 2026-09-30**. Economic/projectile/reconversion/building-cargo exceptions remain **inferred**. Synthetic outcomes, owned Loom combat/HP and JSON/replay verify the implementation, not modern DE parity | `game.ts` `updateConverter`, `rules.ts` `unitRulesForEntity`, `types.ts` | #178 remains open |
| Blast falloff | none inside `blast_width` | chosen; DAT states no falloff | `game.ts` | — |
| Scorpion bolt travel and contact | swept circle, one hit per enemy, no friendly damage, full shooter attack on the intended target and projectile attacks on others; travels maximum range +3 | **inferred** engine interpretation of owned hit/vanish mode 1; extra three tiles and friendly immunity corroborated by [community Scorpion article](https://ageofempires.fandom.com/wiki/Scorpion_(Age_of_Empires_II)); radius, speed, primary/collateral attacks and upgrade effects owned | `game.ts` `releaseAttack`, `updateProjectiles` | #127 |
| Miss scatter, fallback rules only | 1 tile | chosen; imported units use `accuracy_dispersion` | `game.ts` `MISS_TILES` | — |
| Trade gold | `bird.work_rate` × travel seconds, capped at `resource_capacity`, paid on return | **chosen** formula. Owned legacy AoK p47/PDF50 establishes greater profit for longer routes, foreign counterparties, no stockpile goods consumed and banking at one's own market/dock; it does not establish the implemented equation, cap, distance metric or modern payout/rounding exceptions. See `docs/manual-audit.md` | `game.ts` | #128 |
| Trebuchet packed/unpacked pairing | named by hand (331 ↔ 42) | chosen; task 109 names no target unit | `data.ts` | — |
| Trebuchet automatic deployment and ordered approach | idle visible enemy buildings inside search/sight and firing bounds trigger setup and stationary fire; packed explicit attacks approach then set up; distant explicit targets trigger repacking; manual Pack holds until a new command | **Owned legacy prose**: AoK p81/PDF84 explicitly describes packed right-click approach/unpack/attack. Numeric ranges/clocks **owned** DAT331/42, including Japanese modifiers. Building-only auto-acquisition, inherited10-tick cadence (task109 wait3 remains uncalibrated), circular range tolerances, no automatic pursuit, target-loss/setup completion, move cancellation and manual hold **inferred**. [Contract](trebuchet-automation.md) | `game.ts`, `types.ts`; `trebuchet.test.ts`, `tools/trebuchet_smoke.mts` | #131/#259 |
| Farm re-sow from the mill | option, off by default | engine convenience; DAT gives the farm one build location | `game.ts` | — |
| Farm reservation and overflow | current gather order reserves a farm across owners during travel and banking; surplus direct orders choose a visible free owned farm within 3×LOS of the clicked farm, otherwise idle; one participating builder becomes its farmer | single-worker limit **owned** (farm help string 26149); reservation lifetime, cross-owner arbitration, overflow search and deterministic first-worker/lowest-id legacy conflict resolution **inferred**. Stop/death/retasking releases the reservation; queued orders re-evaluate on execution. Automatic continuation and mill-completion assignment retain their own-farm policy; foreign capture requires an explicit target | `game.ts` `farmWorker`, `farmAvailable`, `nearbyFreeFarm` | #82/#156 |
| Abandoned enemy farms | villagers can gather completed, nonempty farms without an incumbent; transfer ownership on entering the existing gathering range; preserve crop, HP and maximum HP; credit worker's owner and reseed at that owner's expense | Permission and one-worker rule **owned** (26149); farmer259 task5 targets farm50/class49, but inspected fields do not define capture timing/arbitration. Capture by starting to gather is corroborated by the [community Farm reference](https://ageofempires.fandom.com/wiki/Farm_(Age_of_Empires_II)); exact contact timing, retained crop/HP and order-reservation policy are **inferred/chosen**, not native-runtime calibrated. No remote/hover ownership mutation; friendly incoming claimants prevent surplus workers attacking the still-foreign farm. Enemy occupied farms retain normal hostile targeting; fish-trap ownership policy unchanged | `game.ts`; `farm-claim.test.ts`, `farm_occupancy_smoke.mts` | #156 |
| Gathering after camp construction | participating lumber-camp builders choose trees; mining-camp builders choose nearest gold/stone; mill builders choose berries/free owned farms; queued orders take precedence | target categories checked against owned `resources/_common/dat/dropsites.json` (562/584/68; farms `worker_num: 0`); narrower mill policy **human-specified** in #79, not the full food drop-off list. Worker-centred nearest selection, existing visible 3×LOS bound, elbow-room filter, id tie-break and priority over adjacent same-kind construction **inferred**; no full reachability guarantee | `game.ts` `workAfterBuilding` | #79 |
| Fishing continuation | check clearance outside the entire resource footprint; after banking a vanished node's load, return to the ship's last working position before selecting visible fish | half-extents **owned**: DAT Gaia 458 deep fish 1×1, 69 shore fish 0.5×0.5; ship 13 collision 0.4×0.4, LOS 5, terrain row 13. Remembered-position return and existing visible 3×LOS search **inferred**; the ship's owned `bird.search_radius = 12` has not been established as this task's continuation radius. No unseen fish are selected and no global reachability guarantee is added | `game.ts` `hasElbowRoom`, `updateGatherer`; `types.ts` `fishingPosition` | #87 |
| Example AI construction continuity | do not retask active builders; houses/ranges fall back to the other existing building-position lists | **chosen** strategy, not an imported engine rule. #79 changed idle-worker timing and exposed abandoned foundations and exhausted position lists on seed 7; passive-opponent victory retains its 2400-second bound | `ai.ts`, `ai-construction.test.ts` | #79; related #146, #86 |
| AI recovery of paid house foundations | one replacement per unstaffed owned house, oldest id first; prefer idle villagers, then nearest gatherer with id tie-break; reserve assignments against the rest of the same decision and keep builders out of demolition | **chosen** strategy. Owned `ai/Promisory/buildings.per` lines 1284–1304 exclude active builders when placing another house and reassign builders to pending houses; lines 11916–11929 also assign house builders. These support reassignment but do not specify our selection policy. Observation v2 exposes own `buildTargetId` instead of guessing assignments from proximity. Presence of `buildProgress`, including a rounded 1, identifies unfinished foundations. Reachability of a still-assigned builder remains the navigation system's responsibility | `ai.ts`, `observe.ts`, `ai-house-recovery.test.ts` | #146 |
| AI mill redundancy and camp supply | scan known unserved nodes rather than stopping at the nearest served node; exclude fish from the land economy's mill targets; unfinished camps still block another placement, including rounded 100% foundations. Mills require supply outside the existing mill's 8-tile service bound plus the 4.5-tile maximum placement radius, and a snapped placement farther than 8 tiles from existing mills. Lumber/mining camps retain the shorter-walk criterion | **chosen** strategy implementing #147's human distinction between mills and potentially useful adjacent lumber/mining camps; reuses existing 8/4.5 constants, not an owned minimum-mill-distance rule. Owned `Promisory/buildings.per` 3899–3911 explicitly considers a second mill for additional/distant forage; 2032–2042 permits adjacent lumber dropsites. DAT mill 68 collision half-extent 1 confirms the 2×2 placement. Selection still uses known resource memory and centre distances, not path-cost or a full resource-cluster model | `ai.ts` `supply` and camp loop; `ai-camps.test.ts` | #147 |
| AI Feudal infrastructure reserve | reserve the next archery range's 175 wood, then blacksmith's 150, against extra camps/farms and archer training; housing, first drop sites and first farm remain available; release once both buildings exist | **chosen** strategy fixing #86's repeated small-purchase starvation, reusing existing building prices. Owned `Promisory/buildings.per` 11217–11239 explicitly targets and builds a blacksmith after a lumber camp; our reserve and exceptions are not an import of its goal system. Fresh imported seeds 1/7 now finish blacksmiths; seed 42 finishes a range and wins before its smith. Further building/unit policy remains #124 | `ai.ts`, `ai-military-buildings.test.ts` | #86 |
| Example AI trebuchet finish | with10infantry/archer-line soldiers and known enemy buildings, prepare one castle from Castle Age; two non-food workers gather missing stone; reserve200W/200G and a population slot from Imperial; cap4 engines including active castle training; visible building attacks and coordinate moves to memory | Quota/army prerequisite adapted from **owned** `Promisory/finaling.per`81–88; producer policy corroborated by `units.per`12145–12164.650S castle and200W/200G engine are owned baseline budgets; actual public-command payment remains civilisation-specific. Worker choice, budget/placement integration, foundation recovery and target priorities **chosen**. Upgraded infantry/archers count and archer production follows upgrades. Staged paid end-to-end evidence, not natural-start balance parity. [Contract](trebuchet-automation.md) | `ai.ts`, `ai-siege.ts`, `ai-siege.test.ts` | #131/#124 |
| Repair targets beyond the class table (a farm) | repairs at the building rate | chosen | `game.ts` | — |
| `garrison_heal_rate` unit | hit points a second | inferred | `game.ts` | — |
| Briton relics | Gaia285 pickup → carrier286 → monastery104, persisted identity, gold income and drop/death release | **Owned** monk125 task132 (target285, result286, range0), carrier task136 (target104, result125, range1), Gaia285 HP30/radius0.5, resource191=30, original relic/carry art. Per-minute interpretation, integer banking with persisted fraction, nearest non-full owned monastery, unchanged monk collider/stat snapshot, damage immunity and deterministic release point are **inferred** integration. Reuses public ungarrison; Drop Relic wording is owned40106/41106, icon/cell reuse and count/faith text are **chosen** UI. Transport sinking retains existing passenger-loss policy. No relic victory (#110) | `relics.ts`, `game.ts`, `sprites.ts`, `main.ts` | #130 |
| Briton monastery research consumers | Devotion/Faith delay enemy conversion, Theocracy spares other participants' faith, Illumination accelerates recharge, Block Printing extends actual conversion range, Herbal Medicine increases actual garrison healing | **Owned** effects46/45 add1/4 to178/179;494 sets193;219 multiplies class18 attribute10 by1.875;220 adds3 range;41 multiplies class3/52 attribute108 by6. Monk reload1.6 as faith points/sec over100, additive seconds and participant charge policy are **inferred** engine semantics atop the existing uniform conversion window. `convertedRules` remains locked; player resources remain live. No new conversion permissions, chance or healing modifiers | `monastery.ts`, `rules.ts`, `import_content.py`; owned offered-tech assertions + outcome tests | #128 |
| Shared relic placement | Tiny Arabia 1 central + 2/player; Black Forest 2/player; Islands 2/player + 1 on land20 | **Owned** numeric/flag contract in `refdata/relic-placement.json`, deterministically extracted by `tools/relic_reference.py` and compared with owned RMS by the import suite. Arabia BALANCED and BF PLAYER use `includes/relics.inc`; Islands uses `GeneratingObjects.inc` PER2PL and `Islands.rms` 2498–2507. Circular player distances for Arabia/BF, box distances for Islands and Arabia central; spacing, forest exclusion, edge margins, land-ID/zone clearance and Arabia `require_path` are enforced without distance relaxation. Forest means tree entities; heights are not cliffs, and cliff exclusion is vacuous until #134 supplies cliff entities. No fictitious standard-mode resource actor areas: 10102/10202/10302 are Empire Wars-only | `relic-placement.ts`, `tools/relic_reference.py` | #130 |
| RMS placement adapter | seeded scans over generated land IDs, independent relic RNG; generated metadata survives saves | **Inferred**, not exact DE RNG/placement parity: forest/actor radii use square tile masks; zone clearance checks the entire square (the prior algorithm read documents eight compass samples); central actor2000 is the analytic union of radius3 boxes about the radius0.20×map-side neutral marker region, rather than 2048 sampled placeholders. Central spacer11500 uses actor1500 radius2 + spacer26; player spacing uses box24. Closest-first sorting implements `find_closest`; Islands has no closest/circular flag. Arabia's uncarved dry base has one land zone; BF retains grown clearing IDs; resource islets retain20/23. Exhausted constraints throw an explicit initialization error rather than silently dropping relics | `relic-placement.ts`, `mapgen.ts` | #130 |
| Arabia start geometry prerequisite | tiny two-player radius drawn from32–34%, rounded to tiles; existing horizontal mirroring retained | **Owned** `Arabia.rms` 832–838: `circle_radius rnd(32,34) 6`. **Chosen adapter** retains horizontal orientation, separate xorshift stream and omits variance6 jitter. Previous quarter-width starts were60 tiles apart: their32-tile box exclusions leave no valid central tile inside the radius24+actor3 neutral area. Correcting the source radius changes opening layouts; distances were not weakened. Shore carving can expose a forest diagonal; the dry corner is filled without planting on a beach | `game.ts`, `mapgen.ts` | #130 |
| Authored-map relic fallback | five seeded, initially accessible relics on Windsor, Senlac and painted-proof | **Authored**, not native RMS behavior: these survey/proof boards have no patch-matched DE script. Uses public relic mechanics, free ground and reachability from at least one start, without imposing unrelated Arabia placement distances | `relic-placement.ts` | #130 |
| Unsupported relic thresholds | Non-stockpile technology costs disable automatic nodes; legacy automatic699–702 return no technology/effects | **Owned** resource7 costs on699–702 are count prerequisites lost by old extraction. **Chosen fail-closed guard**, not implementation of Lithuanian bonuses or resource counters | `technologies.ts`, `import_content.py` | #130 |
| Market exchange / Guilds | public 100/500-unit buy/sell orders, shared prices, owner-specific researched fee, atomic rejection, JSON continuation and observation quotes | **Owned** resources78=.3 and T15→effect15 sets .15; localization41072–41078 specifies100/Shift500 and changing prices; hotkeys determine wood/food/stone cells7–9/12–14. **Owned legacy prose**, AoK pp46–47, establishes all-player shared prices updated after each transaction. Initial bases100 wood/food,130 stone; ±3/lot,20–10000 bounds and ceiling buy/floor sell remain **inferred**, not DAT values or measured DE parity. The manual's sell-wood70 is an example, not an initial table. [Audit](shared-reference-audit.md) lists inspected resource/AI/docs sources | `market.ts`, `main.ts`, observation v6 | #128/#179 |
| Tribute / Coinage / Banking | full recipient credit; same-resource sender fee; completed sender market; four-resource atomic confirmation and execution-time CTRL-all | **Owned** resource46=.3, T23→effect23=.2, T17→effect17=0; localization30353–30356 states100/Shift500/CTRL-all and same-resource fee. **Inferred integration**: ceiling fee on each resource total; CTRL-all is the maximum integer gift affordable including that fee (an indivisible remainder may remain); pending drafts reserve no simulation stock. One public `tribute-batch` validates all resources and current market/research/stock before paying; old single-resource commands remain valid. No trade-cart income change | `market.ts`, `schemas/command.schema.json` | #128/#179/#138 |
| Two-player diplomacy dialog | enabled native menu button and market entry, player/civilisation/stance rows, tribute buttons, Clear/OK/Cancel, keyboard-modal lifecycle and read-only replay | **Owned** `widgetui/diplomacy.json`, WPFG `dialog/dialogdiplomacy.xaml` and `SystemResourcesDiplomacyItem.xaml`: imported columns, row height, fonts, button dimensions and16 original tribute icon states; existing owned nine-slice/button theme. **Chosen two-player adaptation** reduces eight player rows to two and retains fixed opposing teams: Ally/Neutral/Enemy and Allied Victory are disabled, Lock Teams is shown checked. Unlocked relations/cooperative victory are not offered. Right-click subtract100/Shift500 and Ctrl-right clear interpret the owned right-mouse-sensitive buttons; exact subtraction runtime behavior, two-row vertical compaction and modal dimmer remain inferred. No native slider exists in this inspected template | `view/diplomacy.ts`, `hud.ts`, `import_feedback.py`, `main.ts` | #138 |
| Random-map Spies | live 200-gold-per-enemy-villager cost at command acceptance, HUD and observations; includes garrisoned living villagers; completed research shares all enemy unit/building LoS while keeping orders/queues private | **Owned** T408→effect420 sets resource183=1, base cost200/research1s/castle82/slot14; help28408 states the per-villager formula, enemy sight and locked-team ally exclusion. Current1v1 has no allied players. Zero villagers means zero price; no additional engine cap is inferred. Permanent research uses the existing journal; Regicide blocks both purchase and its visibility consumer (owned T117 is named Disable Spies, Regicide only) | `technologies.ts`, `visibility.ts`, `main.ts`, observation v7 | #179 |
| Regicide King | one King434/player, 75HP, speed1.32, LOS6, radius.3, unarmed/untrainable, conversion immune, asks before Delete; original idle/walk/death/decay/icon48/voice for Britons and Franks | Stats, no attacks, train location−1 and hero_mode34 **owned**. Original King garrison graphic is−1; sheltering uses the already imported Castle/TC occupancy flag. Task3 targets transport20/building3; mapping King class59 to civilian garrison mask1 is **inferred**. Explicit move/stop/shelter controls are supported; extra task109 (auto-search1/wait3, unnamed by the inspected XS enum) and Guard13 are not newly interpreted | `data.ts`, `game.ts`, `import-spec.json`, `import_content.py` | #240 |
| Regicide starting actors | ten villagers and a free Castle/player; modern King nearest5, Castle within circular13 with zone4/forest3/edge4; Arabia centre-facing, Black Forest edge-facing; Islands7 extra villagers at box6, King box6–8, Castle box10 | **Owned** narrow contract `refdata/regicide.json`, extracted by `tools/regicide_reference.py` from `includes/regicide.inc`, `villagers.inc`, Black Forest REGICIDE_BACKWARD and Islands GNR_REGICIDECLASSIC. **Inferred adapter** uses integer candidates, independent xorshift tie rolls, simplified actor exclusion/footprints and existing land IDs, before opening resources. Cliff distances1/3 are retained but vacuous without cliff entities; height is not a cliff. Authored survey maps choose nearest legal starts, not native RMS policy. Starting stockpiles inherit the existing random-map preset: selected RMS has no override, DAT91–94 are zero modifiers; exact native Regicide preset remains unverified | `regicide.ts`, `mapgen.ts`, `game.ts` | #240/#134 |
| Royal loss and immunity in carriers | scan living Kings recursively at carrier positions; loss of all own Kings ends Regicide even if other units survive; a razed building may release its King, a sunk transport loses cargo; simultaneous losses draw | Royal-loss condition **owned** strings13081/30171/9846. Mobile passengers retain their owners under the **user-supplied 2026-09-30** rule, including Kings and their nested carriers. Recursive survival/position accounting and end-of-tick simultaneous draw are **inferred integration**. Population follows each living unit's owner through nested cargo. Ordinary conquest tie policy is unchanged. Draw has an explicit protocol/state flag; HUD uses owned Game over wording plus authored simultaneous-loss explanation rather than declaring one player victorious | `regicide.ts`, `game.ts`, `rules.ts`, runner/protocol/HUD | #240/#178 |
| Regicide Treason | immediate400 gold/use from an owned completed Castle, repeatable, separate temporary King-position channel; no research journal/queue or normal fog reveal; live positions follow garrison/transport carriers | **Owned** localization28408/40112/41112:400 per use, enemy Kings to team, few seconds, flashing minimap X; T117 disables permanent Spies408 in Regicide. **Inferred** ten simulation seconds, refreshing from latest paid use, live rather than frozen positions, half-second blink, ten-backing-pixel X/line width2, completed-Castle availability without age/busy-research gating, and reuse of408's icon19/slot14. Current locked two-player teams contain one player each. Lifetime, presentation and action availability are not claimed as measured DE parity | `regicide.ts`, `minimap.ts`, `main.ts`, observation v7 | #240 |
| Siphons charge | only Fire Galley/Fire Ship/Fast Fire Ship mode6/event0/target64; ready normal attacks release one additional explosive projectile; one charge recovers at .04/s and keeps its reservoir through conversion/saves | **Owned** T909/effect915 sets attributes62=6,59=1 on1103/529/532; University209,45s,100food/175gold. Creatable fields name projectile2629: speed3, blast.5/level2, its own class attacks; smart mode1, arc.45, vanish mode2. Tracking677→graphic3823 names `flamethrower_flame`; dying graphic12726 names `impact_grenade` (85 original frames90–174,1.5s,scale.2). Full initial charge, one extra projectile per ready normal swing, no repeated damaging ticks during the retained impact, and ordinary blast friendly-fire are **inferred bounded engine semantics**, not a general charge engine or runtime calibration. Original impact art expires on saved simulation time; relics are immune to splash | `fire-charge.ts`, `game.ts`, `sprites.ts`, `tools/naval.py` | #179 |
| Garrison firepower and volley resolution | positive firepower multiplies ranged DPS; a negative value adds its magnitude as flat DPS (villager −2.5 → 2.5 DPS); sum contributions, divide by the researched building's pierce DPS, floor and cap; an absent primary projectile consumes neither the nominal base arrow nor its maximum slot | signed field **owned**; sign meaning **community-documented** in [UGC attribute 130](https://ugc.aoe2.rocks/general/attributes/attributes/#130-garrison-firepower). Ranged-DPS basis, flooring and absent-primary slot interpretation **inferred** engine integration, tested through actual released volleys. Replaces the old fixed-one-arrow treatment; not claimed as a patch-matched runtime measurement | `game.ts` `volleyArrows` | #137 |
| Town bell recall and return | nearest eligible owned villagers first, stable ID ties, up to free TC capacity minus incoming garrison reservations; remember interrupted order/queue, bank carried loads on entry, restore work on bell release; newer orders cancel the remembered task; newly trained villagers shelter while the bell rings | toggle/return behavior **owned** help 41111, button actions 163/165 at zero-based sequence14 → cell15/B with icons49/61 (#245); cue aliases `townbell_start/stop` **owned**. Global nearest-worker selection with no radius cutoff, reservation policy, preserving manually sheltered units and new-villager handling **chosen/inferred**; exact DE bell search radius/overflow routing is not stated by inspected files | `game.ts`, `main.ts`, observation v5 | #137 |
| Production and ram shelter | self-rally holds trainees; type-0 producers refuse returning units; overflow emerges outside. Rams carry infantry/villagers, reject archers/cavalry, unload to passable land and release on destruction where possible | self-rally **owned** help 4944; production capacity 10/type 0, ram 35/422 capacity 6 **owned**. Filtering/egress **inferred/chosen**; live crew constants and their remaining calibration caveat are recorded above | `data.ts`, `game.ts` | #137/#161 |
| Garrison categories by DAT class | editor table | chosen | `game.ts` `GARRISON_CATEGORY` | — |
| Shift-click queue count | 5 | inferred (the reference's count); `hotkeys.json` binds nothing | `main.ts` | — |
| Shift-click route: an unshifted order or Stop clears the route | rule | inferred | `game.ts` | — |
| Delete confirmation | `hero_mode` bit 32 | owned (corrected from "buildings ask") | `data.ts` | — |
| Auto-continue bound | 3 × line of sight, visible only | chosen; the human asked for "approximately their line of sight" | `game.ts` | — |
| Carcass food spoilage | sheep/deer lose 0.25 food/s, boar 0.4 after death, independent of gathering; fractional progress removes whole food units | rates **owned**: live Gaia DAT units 594/65/48 `resource_decay`, distinct from dead-unit type-12 lifetime. Whole-food accounting and starting decay immediately on death **chosen** integration with integer gathering. Corpse remains edible until empty; existing corpse visual lifetime remains separate | `import_content.py`, `data.ts`, `game.ts` | #85 |
| Coordinated herd feeding | AI chooses one known edible animal: carcass first, then an already assigned animal, then nearest home/id; automatic same-kind continuation prefers carcasses and already assigned animals within its existing visible bound | **human-requested** one-at-a-time policy in #85. Owned `Promisory/gatherers.per` 3753–3812 tracks current/next livestock and directs 1–7 shepherds to current livestock (8+ may use next); our single-target policy, rankings and corpse observation v4 are **chosen**, not a full import of that strategy. Own gather target IDs are public only to their owner | `ai.ts`, `observe.ts`, `game.ts` `nextToWork` | #85 |
| Claimed sheep and AI herding | human-controlled sheep keep ordinary orders; AI moves idle owned sheep to a completed TC before assigning shepherds | User clarified “bring sheep to TC”, not automatic discoverer-following. Owned `Promisory/gatherers.per`3637–3733 issues explicit livestock moves; legacy AoK Manual pp10/25 describes moving sheep to food drops. Earlier “reference follows” claim was unsupported (automatic scout-following is documented for AoE4). TC-centre target,2.5-tile readiness radius, idle-only sheep commands and redirecting old shepherd assignments away from incoming livestock are **chosen strategy**. Existing carcasses stay first; no simulator claim/follow rules or human orders changed | `ai.ts`, `ai-herding.test.ts`, `herd_food_smoke.mts` | #136 |
| Corpse window, fallback rules only | 3 s | chosen | `game.ts` | — |
| Animal think interval | 5 ticks | chosen | `game.ts` `ANIMAL_INTERVAL` | — |
| Engagement tolerances | `radius + 1.6`, margins 0.15-0.4, spawn ring +0.2, node pop ≤ 0.12 | chosen | `game.ts` | — |
| Villager task gathering | hunter 0.41/35, farmer 0.53/10, shepherd 0.33/10, forager 0.31/10, fisher 0.43/10, lumberjack 0.39/10, gold miner 0.38/10, stone miner 0.36/10 (rate/capacity); each variant's technology effects | **owned** DAT `bird.work_rate`/`resource_capacity` on 122/259/592/120/56/123/579/124, already published as `villager-*.gather`; open fallback copies these numbers. Heavy Plow gives farmer +1 capacity; Wheel Barrow's patch-specific class-4 multiplier is **1.2695**, Hand Cart's 1.5. Existing whole-resource collection rounds fractional capacity upward (**inferred**, not reference-measured); switching tasks uses the new target's capacity and banks an overfull load first (**inferred**). A carried load remembers its task if its source disappears; legacy loads lacking both source and task default to forager | `data.ts` `villagerGather`, `game.ts` `rateOn`/`holdOf` | #132 |
| Technology prerequisites and automatic bonuses | full nonnegative DAT prerequisite IDs plus `required_tech_count`; foreign/disabled alternatives remain unsatisfied. Completed buildings supply `building.tech_id`. Initial tree/team effects and eligible locationless/free research activate once in completion order, without an extra research-location building gate | gates, IDs, costs, amounts and triggers **owned**. **Measured current185872, not pinned48987:** newly paid Feudal Frankish farm without a Mill retains243food, versus Briton165+10carried=175; Castle Teutons fire at an adjacent ram without University and heal faster without Monastery than Dark controls, with no editor-start food deduction. Applying this to remaining zero-time technologies, fixed-point activation order and historical building-trigger persistence remain **inferred engine semantics**; live age-up accounting and pinned confirmation remain open. Positive counts with empty lists remain blocked. Legacy manifests retain their former all-listed path | `import_content.py`, `technologies.ts`, `game.ts`; [contract](civilization-bonuses.md), [native evidence](free-research-calibration.md) | #123/#129/#179/#180/#254 |
| Bonus prices and production | cost multipliers in completion order, then nearest whole resource (half up); production/research advances by building work rate | multipliers **owned**: TC wood ×0.5; castle ×0.85 then ×0.882353; range work ×1.1. Rounding/tick quantization **inferred**: TC wood 138, castle stone 553/488 are implementation outcomes, not DE measurements. Existing HP policy adds max-HP delta preserving absolute damage; converted entities skip bulk HP/upgrades | `rules.ts`, `game.ts` | #123/#178 |
| Bonus scope and remaining effects | current 1v1 applies each player's own team effect; unsupported commands/attributes remain diagnostic. No allied teams, timed locationless research or general enable/disable-unit effect execution | **owned** commands retained; range/sight, gathering, production, prices, cavalry HP, building age baselines, relic income and the documented monastery/market/Spies resources have consumers. This is not a general all-civilisation effect engine | `civilizationBonuses.nodes`, `import_content.py` | #123/#128/#126/#130/#180 |
| Remaining attribute coverage | 23 limits combat acquisition and 130 modifies actual garrison firepower; generic 48/49 and noncombat automatic-search semantics remain diagnostic or outside the implemented consumers | owned fields; consumer scope explicit rather than treating decoder recognition as completeness | `rules.ts`, `game.ts`, manifest `unmodelled` | #128 |
| Named player-attribute coverage | all named DAT initial values plus resource29 imported; research consumers include farm food, repair, relic gold, conversion permissions/resistance/Heresy/Theocracy, healing range, hunting productivity, population ceiling, Spies, market and tribute fees. Other resource effects remain unmodelled; initial food/population/score entries are not live counters | names/indices **owned** from XS, with29 identified by owned localization15029; values **owned** from configured civ. Lower-first-letter keys, legacy `FarmFood` → `farmFoodAmount` and numeric `resource-29` are schema conventions | `import_content.py`, `rules.ts`, `monastery.ts`, `relics.ts`, `market.ts` | #53/#128/#130/#182 |
| Skipped technologies | not researchable, reason each | owned | manifest `skippedTechnologies` | #128, #97 |
| Building age and paid upgrades | stable age variants select HP/armour/LOS; paid tower/wall/gate upgrades replace kind, retaining damage and scaling foundation gains by built fraction | baselines, IDs, costs/gates/armour **owned**; absolute damage retention, fractional foundation scaling and shared gate HP **inferred**. Generic sole-age rows 71/72 normalize into baselines with `includedTechs` preventing graph reapplication; source float precision retained | `tools/buildings.py`, `rules.ts`, `game.ts`; building contract | #126/#179/#180 |
| Gate topology, state and art | stone/fortified four-tile construction with two-tile doorway and solid posts; two axes preserved by upgrade. Palisade/stone/fortified gates carry checksum-visible `closed/open/blocked` state, shared physical collision and matching imported pose. Owner routes may approach a closed uncontested gate; enemy doorway contact closes it for everybody | geometry, links and graphics **owned**: DAT789↔790,793↔794,64↔78 change obstruction type2↔0; inspected gate tasks are empty and poses have one frame/zero duration. Help41104 supports automatic owner opening; AI constants identify closed/open units. **Inferred**: inherited2.5-tile centre-box owner range, enemy centre within doorway half-extents plus unit radius, enemy precedence, neutral wildlife ignored, instantaneous once-per-tick transition before movement, no close delay and absent legacy state treated as closed. Shared HP remains inferred; native trigger/timing and diagonal placement remain #133 | `gates.ts`, `nav.ts`, `game.ts`, `sprites.ts`; `gates.test.ts`, `tools/gates_smoke.mts` | #133 |
| Stone/fortified wall frames | x=0, y=1, post/junction=2, horizontal/vertical screen diagonals=3/4 | **Measured** by composing owned x2 frames at hotspots divided by scale (`tools/probes/building_wall_art.py`). Neighbour-footprint junction selection **inferred**; palisades keep their separate mapping | `sprites.ts` `wallShape` | #126 roster slice |
| Mirror-symmetric board | exact mirror | chosen divergence; the paired batch rests on it | `mapgen.ts` | — |
| Land versus terrain clumping defaults | omitted land factors use8 for player lands and resource islets; terrain/elevation growth retains20; explicit factors are preserved | **Owned** TC Random Map Scripting Guide LAND/TERRAIN_GENERATION definitions. Its historical land range1–15 is not imposed on modern RMS, which explicitly uses22 for Islands homes. The shared cost-growth/phase adapter remains reconstructed; guide contract comparison and source hash are in `docs/map-generation-design.md` | `mapgen.ts`, `mapgen-defaults.test.ts` | #56 |
| Candidate spacing enforcement | live exclusion masks for forest/pond seed scans and opening-group anchors; reserve after accepted placement | Fixes array reassignment during `for…of`. Preserves existing **inferred** square geometry: exclude only when both axis distances are strictly below the margin; exact boundary allowed. Existing spacing values, scan order and mirroring remain; no new native-RMS parity claim. Seeds now produce different woods/resources where exclusions previously failed; depleted candidate bands stop without violating spacing | `mapgen.ts`, `mapgen-spacing.test.ts`; private before/after browser comparisons | #90 |
| Black Forest seed 7 | one far-gold pair dropped | chosen compromise | `mapgen.ts` | — |
| Straggler clearance, neutral wood counts | scaled from the script | chosen | `mapgen.ts` | — |
| Water-masking depth chain | applied as the converged rule (shallow ≤ 5 tiles) | chosen; the include grows clumps | `mapgen.ts` | #95 |
| Single land tiles at sea | dropped | chosen (no RMS evidence) | `mapgen.ts` | — |
| Beach sweep | every land tile with open water among eight neighbours becomes Beach | **inferred**; scripts confirm only that the engine does a sweep | `mapgen.ts` | #113 |
| Dock placement | reaches the water and touches the land | inferred | `game.ts` `placementLegal` | — |
| Naval roster and research | current Britons galley/fire/demolition/hulk lines, Cannon Galleon, transport and trade cog; no unavailable Carrack/Elite Cannon Galleon | **owned** DAT and `CivTechTrees/BRITONS.json`; shared researches 34/35, including automatic children 911/246 with sole prerequisite 35; cannon unit prerequisite 47. Normal projectile/volley attack timing uses existing simulation rules; the Hulk's negative class-21 attack subtracts before the minimum damage (**inferred** arithmetic, not a reference damage measurement) | `tools/naval.py`, `import_content.py`, `data.ts`, `game.ts` | #97 |
| Ship composites and fire shot | flatten owned file-bearing hull/sail deltas in layer order with their own frame clocks, offsets and colour/shadow/outline masks; file-less fire projectile 676 uses `flamethrower_flame` | composite graphics **owned**, including placeholder W/X and file-less SLP -1 parents; underwater alpha from owned palette. Flame atlas/29 frames/scale endpoints **owned**; binding to projectile 676, mean start scale and one puff per projectile with flight-normalized animation **inferred**, not the closed engine's emitter. Hull occlusion decides the whole ship's contour | `naval.py`, `sprites.ts` | #97 |
| Demolition detonation | contact attack or lethal damage detonates once at the DAT radius; enemy units/buildings take full shared-class damage; friendly units are spared; deletion does not detonate | radius/attacks and self-destruction wording **owned**; interpretation of blast level 66 as low-bit level 2, full damage without falloff, death-trigger/friendly-fire rules **inferred** | `game.ts` `kill`, `applyBlast` | #97 |
| Transport boarding/unloading | capacity includes each carried unit and its nested passengers; rechecked on arrival, owner HUD/observation use the same count. Board at interaction range, preserve loads/population; Unload selects a shore, retains cargo offshore or when blocked; cargo is lost on sinking. Conversion leaves cargo aboard with original owners; only the carrier owner can unload it | capacity and load/unload action **owned** unit545/help26443; unload strings3053/4107, definitive hotkey Q. TC Manual p8/PDF10 explicitly counts ram passengers as well as the ram. #251 fixes the reproduced26-in20 undercount; legacy over-capacity saves retain cargo but admit no further boarders, a **chosen** compatibility policy. Captured carriers use their stored capacity. Mobile conversion retention/authority **user-supplied 2026-09-30**; adjacent landing samples (32 angles at carrier radius + passenger radius +0.6), eligibility, cargo loss and targeting-path semantics remain **inferred** | `garrison.ts`, `game.ts`, `observe.ts`, `main.ts` | #97/#251/#178 |
| Fish Trap economy | ship-built water-only trap, 100 wood, 700 food, one reserved fishing ship, manual rebuilding on depletion; ship's 0.24/s × task factor 1.45, dock drop-off | cost, resource 88, builder 13, task factor **owned**. Build duration derived as DAT 40 / (0.24 × build task 3.57); applying that work-rate interpretation and the existing multi-builder rule, exclusive reservation, open-water placement and no automatic reseed **inferred**. Fishing Lines/Gillnets affect collection/carry; construction uses the imported baseline duration | `import_content.py`, `game.ts` | #97 |
| Trade Cog income | dock-to-foreign-dock round trips, 0.375375 per travel second, capacity 200 | work rate/capacity/dock target **owned**; travel-time income reuses the existing trade-cart approximation rather than reproducing DE's distance formula | `game.ts` `updateTrader` | #97 |
| A ship is afloat or nowhere; final approach slides along the bank | rule | inferred from the table's shape | `game.ts` `groundAllows`, `moveTowardOnGround` | — |
| Placement-side neighbourhood | any of the eight neighbouring tiles satisfies the DAT's `placement_side_terrain` alternatives | inferred engine interpretation; the shore fish's beach IDs 2/35 are owned | `mapgen.ts` `dealFish` | #145 |
| Islands resource islets | tiny-map lands20/23, zones56/57, 1% each; gold2×3 on20, stone2 on23; fifth relic on20 | **Owned** `Islands.rms` 121–147,2498–2558: exactly **two** tiny-map islets (21/22/24 belong to larger branches), borders30%, fuzz10, avoidance7. **Inferred adapter** reserves connected islets before mirrored home growth, selects centres furthest from starts with seeded tie order, uses square base_size3 (omitted RMS engine default from earlier algorithm read), existing cost growth/default clumping and cleaning. This differs from native land-phase order/RNG, but retains quotas, named IDs and water separation. Fish now use global Gaia candidate scans, including both unpaired islet coasts; see the Islands fish section above for remaining season/distance inferences. | `mapgen.ts`, `refdata/relic-placement.json` | #130/#274 |
| Black Forest clearing quota | 44% of actual map area shared across players, not a fixed1580/player | **Owned** `Black_Forest.rms` 288–296: land_percent44, circular base14, clumping2, avoidance6. At120×120 this is3168/player before cleaning. Existing mirrored growth/road adapter remains inferred. The old half-size quota made source24-tile relic constraints infeasible | `mapgen.ts`, `refdata/relic-placement.json` | #130 |
| The AI never orders a villager onto a boar | rule | chosen (deliberate) | `ai.ts` | — |
| AI tuning constants | `ARMY_BEFORE_AGE`, `FARM_SPOTS`, camp costs… | chosen; strategy, not fidelity | `ai.ts` | #124 |
| The wonder wins nothing | current staged placeholder | human approved cosmetic first, then a reference countdown after settings; settings now exist, but exact map-size defaults/query-clock conversion remain unverified after the DAT task120/manual/strings/AI read recorded on #110 | `game.ts` | #110 |
| The 2026-08-28 UTC genie-rms read | algorithm understanding only; original project implementation written fresh as declared in the contemporary trace | Historical GitHub licence result `GPL-3.0`; inspected Land/Terrain/Objects/Elevation generators, Map cleaning, CRandom, Module/StackNode and script examples on upstream `master`. Exact upstream revision was not retained. Design/implementation sessions, successful versus failed reads, UTC/BST dates and commit `fbd277a` are reconstructed in `docs/genie-rms-provenance.md`. No runtime dependency or vendored upstream files; not a new source-similarity audit. Owned-guide precedence remains #56 | `mapgen.ts`; policy #112 | #142, recorded |

## View

| What | Shipped as | Source | Where | Issue |
|---|---|---|---|---|
| Sprite page residency | 512 MiB soft budget, 60 s warm grace, 120 s idle expiry, 1 s sweep; scene requests override the budget, terrain/water pinned | **chosen** application memory policy, not DE runtime constants. #170's normal-gathering soak increased grace from 10 s: 586 → 44 evictions over seven-minute windows, at 1,051 → 1,459 MiB resident sprite data. Owned x2 dimensions supply byte estimates. Off-camera and remembered art remain active. Living units hold their previous complete pose during cold frame loads (#287), still following position/elevation/depth; first appearance waits for body, colour, shadow and composite layers together. This is a **chosen** asynchronous presentation policy, not an inferred native animation rule; owned frame timing continues and optional contours load independently. Other expired art may be absent during PNG reload. Compressed upload remains #163 | `sprite-residency.ts`, `sprites.ts` | #152, #170, #287 |
| Order-flash cadence and colour | 0.2 s on/off for 1.2 s, marker colour | chosen; `unit_selection_color_1/2` hold palette 0, no widget | `main.ts` `ORDER_FLASH_*` | — |
| Occlusion contour threshold | ≥ half the sprite's box covered | chosen (stands in for the per-pixel test) | `sprites.ts` `HIDDEN_FRACTION` | — |
| World render-pass ordering | existing pass bases with each old within-pass depth/piece key mapped by `k / (1 + abs(k))`; bodies/scatter, projectiles, contours and rally flags cannot cross into other passes or placement overlays | **chosen** rendering implementation, extending the existing ground-layer policy rather than recovering the DE compositor. Relative body/piece ordering is preserved; piece offsets belong inside the bounded key. Near/far owned readbacks agree (321 Galley / 147 villager blue pixels), placement overlays cover every opaque contour sample, camera round trips and fog checks pass | `render-order.ts`, `sprites.ts`, `scatter.ts`; full reference compositor remains #149 | #238 |
| Context cursor bindings | owned native CUR files, actual header dimensions/hotspots; bindings follow the first selected unit's pure order plan, defensive targeting or a producer's rally command. Build/repair/unload modes take precedence; unsupported repair targets use CSS `not-allowed` | images/hotspots **owned** from `resources/_common/cursors`; selecting the `32x32` filename family and mapping current actions/group priority are **inferred** integration, not a recovered DE cursor-state table. `flag32x32.cur` is actually 48×48 with hotspot (9,43); convert is (15,15). Missing assets use the ordinary CSS cursor | `import_ui.py`, `view/cursors.ts`, `game.ts` `resolveUnitOrder`/`planContextCommand`, `main.ts` | #51 |
| Remembered Gaia interaction | hover/picking/selection read last-seen positions and metadata instead of hidden live objects; a vanished remembered target falls back to moving to the clicked last-seen location | **chosen** integration with existing authoritative visibility/memory; prevents the old picker bypass for unseen Gaia from leaking through new cursor feedback. Stale-target movement is a project UX fallback, not a measured DE command-resolution rule | `view/selection.ts` `contextTargets`, `main.ts`, `game.ts` `applyCommand` | #51 |
| Selecting units over farms | left-click selects the nearest eligible living unit when the distance picker would otherwise choose a farm; context orders/cursors retain the crop target | Ability to manually select the villager is **human-requested** (#289). Farm-only priority is a **chosen** picking policy consistent with the ground patch under unit art, not a recovered native hit-test algorithm. Retains the existing radius-adjusted distance and 0.9-tile tolerance, visibility/interpolation, and distance-based carcass/ordinary-building picking. Owned and fallback browser clicks cover the villager, exposed field, Shift selection and right-click gathering | `view/selection.ts` `pickTarget`, `main.ts`, `tools/farm_selection_smoke.mts` | #289 |
| Sprite shadow profile/composition | imported Default `shadow_strength` (1.0) and black `shadow_color`, applied to the owned mask over the ground | values **owned**, imported from `colorcorrection.json`; using Default for every biome and direct alpha blending rather than DE's final compositor remains **inferred**. The extra 0.55 multiplier was removed after the human rejected #88's first visual fix | `sprites.ts` `configureShadow`, `import_content.py` `shadow_profile` | #149 |
| World terrain hillshade | `+dx-dy` over shared corner heights, applied to base terrain and blend overlays; existing strength 0.035, base 0.82, normalized-altitude contribution 0.16 and clamp 0.68–1 retained | Direction **human/reference-informed** by the 2026-09-22 editor capture (index records orientation only; original bytes/height grid unavailable). Strength/altitude/clamp remain **chosen**, not DE shader equivalence. Owned `TerrainSolid_vs/ps` transform/sample the tile; `TerrainAttributes_ps` samples `g_LightmapTexture` into output zw, and `CombineTerrainSpriteSMP_ps` names base/ambient/diffuse lighting. Our vertex shade is not that lightmap/compositor. **Measured** normalized linear-sRGB 5×5 world crops at 2/3 native projection scale: imported right faces 0.946/0.948, left 0.809/0.809; before correction front faces were both ≈0.949. The unshaded identical-geometry/UV draw cancels texture variation; no absolute reference RGB calibration is claimed | `world.ts` `createGround`, `tools/world_relief_smoke.mts` | #160; full composite #149 |
| Selection outline width and colour, scene background | 2.5 px, `0xf5f0dc`, `0x18140c` | chosen | `main.ts`, `world.ts` | — |
| Damage soot curve | linear in hit points lost | chosen; the shader's curve is unread | `sprites.ts` | — |
| Which build targets take the seed-sowing graphic | the farm | inferred (engine rule) | `sprites.ts` | — |
| Resource cheat key | `Ctrl+Alt+R` adds 1000 of each resource to the local player; solo only | 1000 per resource matches AoE2's remembered `cheese steak jimmy's`/`lumberjack`/`robin hood`/`rock on` codes (**inferred**, not read from owned files). The key is **chosen**: every F-key and Alt+R are bound in the owned hotkey profiles, and there is no chat to type codes into (#138). Not in the protocol schema, so shared servers and agents reject it | `main.ts`, `game.ts` `cheat-resources` | — |
| Farm construction stages | under construction a farm shows `Farm Cnst1/2/3` (terrains 29/30/31, `g_fc1-3`) for build progress below 1/3, below 2/3 and the rest, then `Farm1` (7) | terrains and textures **owned**; the farm's `foundation_terrain_id` is 7 and the DAT gives no stage thresholds, so equal thirds are **inferred** | `sprites.ts` `farmTerrainSlot`, `import-spec.json` | #296 |
| Farm furrow pitch | `FARM_TILES_PER_SPAN = 10` (twelve furrows across) | **human** ("approx 12"); `terrain_dimensions` shown not to mean tiles per span | `world.ts` | — |
| Farm furrow orientation | quarter turn | human ("amend by 90 degrees"), retired by the handedness flip | `world.ts` | — |
| Fog edge softness | `FOG_EDGE_INNER/OUTER` 0.425/0.575 | chosen, then halved by eye | `world.ts` | — |
| Fog sampler | cubic B-spline | chosen; the shader names bilinear (pulls the contour inward a fraction of a tile) | `world.ts` | — |
| Fog levels | unseen 1.0, explored 0.5 | owned (`colorcorrection.json`); black-when-animate-off from the option's string and web reading | `world.ts` | #117 |
| Whole sprites at a fog boundary | ground fog below bodies; current visibility admits the whole sprite; last-seen sprites retain opaque silhouettes with RGB ×0.5; scenery obeys its anchor tile too | **human** comparison supplied for #88 shows whole trees over the ground contour; reusing Default's explored-ground multiplier for remembered sprites is **inferred**, pending the full reference compositor | `world.ts`, `sprites.ts` `dimFogSnapshot`, `scatter.ts` | #88, #149 |
| Blend shapes | all eight mapped land/farm/road/snow/ice/water families use DE square windows when present; each missing family falls back to classic diamond masks | **Owned** red-channel pixels from `terrain/blends/*.png`, with source hashes. **Inferred** window cuts:64×64 except96×96 `watershore` (#284); quarter windows for adjacent edge pairs, classic-table family binding and maximum-alpha unions for opposite/three-edge cases remain inferred. The old shore cuts stopped mid-fade (up to15.2% exposed sand in160 GPU join samples), revealing the tile grid. The wider shore cuts include the authored fade and avoid neighbouring atlas motifs; family-specific layout metadata preserves the other seven families and old-import compatibility. No synthetic noise, contrast gain or alpha remapping is applied. `TerrainBlend_vs` passes UVs through and does not establish these window dimensions or their exact native physical crossing width. Source sampling and join continuity are not DE parity; `herbwatershore`/`reserved` remain unmapped. See `terrain-blend-coverage.md` | `world.ts`, `assets.ts`, `import_blends.py`, `tools/land_blend_smoke.mts`, `tools/shore_blend_smoke.mts` | #284/#148/#116/#113 |
| Land crossings through the overlay masks, both ways | the higher terrain over the lower's tile at shape × its `overlay_mask_name`, and the lower back over the higher's tile the same way | **Owned:** `TerrainBlend_ps` uses an RGB lerp through `g_MaskTexture` at terrain UV and independent shape alpha. **Inferred:** texture-role assignments, the equivalent coverage model at overlaps, the reverse pass and land-on/water-off gating. **Sampler correction,2026-10-01:** reflection/instructions bind mask/blend through `sBilinear` s1 and terrain pictures through `sAnisotropic` s4; overlay masks now use anisotropy1 rather than16. The existing two-way-policy probe's error falls0.030495→0.001896 without widening its limit. Exact mip/minification state and native junction ordering remain uncalibrated | `world.ts` `masked`, `assets.ts`; `terrain-blend-coverage.md` | #116 |
| Farm blend families and corners | select the receiving terrain pair's family, refresh moved previews, use native diagonal corner windows; classic fallback retains the side-only ring | Farm7/construction29 blend type1 and absent overlay mask are **owned**. Pair-table use fixes confusing a terrain category with a family index (farm/grass uses3, not watershore1). Native25-tile versus classic21-tile patch coverage follows the existing inferred neighbour topology, not a recovered engine UV table. Mixed-family material groups and preview invalidation are **implementation**. Both stages pass450 source-alpha samples; furrow scale/orientation are preserved | `world.ts`, `sprites.ts`, `tools/land_blend_smoke.mts` | #116 |
| Water surface arithmetic | `Water_ps`'s SM2 build, read: height field summed over rgb, three drifting layers, central difference at 0.05, normal over 0.1, dome through `skyDomeMtx`, glint at `specularPower` | owned; register map c0 = (seaFloorIntensity, skyIntensity, specularIntensity, specularPower), c1 = (waveAnimationSpeed, waveRepeatLength, waveAmplitude, mapScale), c2 = (seaFloorScale, lightDirection), c3-c5 specularColor/waterColour/skyColor, c6-c7.xy skyDomeMtx, c7.z time, c7.w terrainScale, c8.x SampleBlendTexture; s4 surface, s5 floor, s0 dome, s1 visibility, s2 depth, s3 beach blend | `water.ts` | #94 |
| Water world frame | world x = tile -x, world y = tile +y; the eye looks along world (1, -1) at 30 degrees | measured: the sun `(0.7, -0.68, 0.45)` reaches the eye only from beyond the surface, and the surface's rows lie at the down-left tile axis's 155 degrees in the reference | `water.ts` `VIEW` | #94 |
| Water `g_terrainScale` | 1, so the Default preset repeats every `20 * 0.0045 * mapWidth` tiles (10.8 on 120) | engine-set, unstated; measured: the reference's streaks decorrelate along their length at that repeat's rate | `water.ts` `TERRAIN_SCALE` | #94 |
| Water `g_time` unit | seconds times the preset's `water_normals_def.velocity` (0.125 in every preset), on the wall clock | inferred: the velocity has no shader input of its own; at a second per second the human found the drift fast | `water.ts` | #94 |
| Water dome orientation | the dome's v not turned over: a flat sea looks up the lower-right quarter (83, 126, 169) | measured: the only quarter whose body sits under both of the reference's zones at one weight | `water.ts` `skyDomeMatrix` | #94 |
| Water surface weight | `1 - (1 - opacity/255)^2` = 0.235 for the 32/255 classes, summed in linear light | measured: the 2026-09-19 composite's rim and open sea sit above their textures by one weight in all three channels (six numbers within 4%); the form is two layers of the stated opacity, whether the engine draws two is unread | `water.ts` `surfaceOpacity` | #94 |
| Water glint scale | 0.15 of the shader's, standing in for `g_VisibilityTexture`'s blue channel, which the engine fills | measured: at 1 a white dash on every mirroring facet, and the reference's open sea has none (99.9th percentile 16 over the mean at 0.52 of 1080p; 0.15 gives 13, 0.3 gives 25) | `water.ts` `GLINT_SCALE` | #94 |
| Water shimmer | three fifths of the reference's fine contrast (high-pass std 3.2 against 5.2 at 0.52 of 1080p), symmetric as the reference's is | measured gap; the wobble reads a smooth quarter of the dome | `water.ts` | #94, #113 |
| Shore foam frame placement | one 256-texel frame in each shore-side water tile's own 96x48 screen rectangle; `diag` for a single land edge, `ortho` across two adjacent ones; the far side is the frame turned over | owned: `WaveAnim_ps` (white at the atlas's red), the frames' 45/0-degree crests and their roll; **measured** (`islands-coast-2026-09-19.png`): the reference's band is ten pixels with a two-pixel core at its 0.8 zoom, which is the frame at one tile, and the crest's arrival at 82 texels then lands three pixels inside the tile edge; **inferred**: that a stepped pair takes `ortho`, and the quarter turn for a run down the screen (the reference shows no such run) | `foam.ts` | #89 |
| Shore foam tempo and phase | 28 frames a second through a loop of 112, the sequence's last sixteen frames faded over its first (the 128th to the first is a cut, five times any other step, which ran along the coast as a wave); the human times DE's roll at about four seconds; a coast rolls together, each tile's phase a fiftieth of the roll on from its neighbour's along either axis (a coin per tile made each tile's crest leap on its own), the mirrored pair changing every twelve tiles | chosen; the reference shows a stretch at one point of the roll | `foam.ts` `FRAME_RATE`, `PHASE_TILES`, `VARIANT_TILES` | #89 |
| Shore foam gaps | no frame on a water tile tucked into a corner (land on two adjacent sides and on a flanking diagonal) or in a one-tile channel (land on opposite sides) | inferred from `islands-coast-gaps-2026-09-19.png`: the cove's inner edges and an inward bend carry none, straight runs and stair-steps do | `foam.ts` | #89 |
| Shore foam strength | the frames' alpha at 0.4 | measured: the reference's band along a straight shore is red +25 to +60 over the water's 80 with no bright core (white at 0.15-0.35) where the frames carry 0.3-0.75; the blend state is the engine's | `foam.ts` `STRENGTH` | #89 |
| Default zoom | 0.8 | measured (the reference's default draws the 2x assets at 0.80) | `main.ts` | — |
| DE's default zoom | 0.80 of ours (a 77-px tile) | measured: a 143-texel mangrove stands 115 px, the water's repeat vector is (404, 202) px | `docs/status.md` | — |
| Minimap wood overlay | use Forest terrain slot 10's imported relief palette for live and remembered trees unless the node has its own colour; flat RGB (21,118,21) | palette **owned**: terrain `colors` (197,235,53) through `original.pal` gives (37,116,57)/(21,118,21)/(0,114,0). Tree units 349/351/348 have `minimap_color=0`; using the forest palette for their existing resource-dot overlay is **inferred**, supported by DE Desert Islands reference pixels near (21,117,21). Replaces the scaled-image sample (41,140,33) in imported mode; resource-dot geometry remains approximate | `minimap.ts` | #96 |
| Minimap relief classification | choose the imported light/flat/dark shade from the sign of `dHeight/dx - dHeight/dy`; clamp boundaries, leave plateaus neutral, treat magnitude ≤1e-6 as numerical flatness | colours **owned**. Screen-right lighting **reference-informed** by the human's 2026-09-22 editor screenshot: +x projects down-left and +y down-right, so the provisional `-dx-dy` axis was wrong. Four-neighbour classification, equal axis weights, diagonal/corner treatment and tolerance remain **inferred/chosen**; no original height grid or raw reference-pixel comparison. Fog attenuation remains separate; missing shade metadata uses flat colour | `minimap.ts` `minimapReliefShade` | #96 |
| Minimap building squares | uniform snapped 2×2 backing pixels for live and remembered buildings, about 3×3 CSS pixels in the 2000px reference; farms hidden by DAT minimap_mode 0 | **measured** compact blue markers in `hud-bottom-2026-09-17.png`, sRGB; treating all mode-1 buildings uniformly **inferred**, since DAT and MapView state no per-building marker size | `minimap.ts` `drawBuilding` | #84 |
| Fogged minimap dim | `REMEMBERED_FACTOR` 0.55 | chosen | `minimap.ts` | — |
| Minimap flare | 4 s pulsing ring | chosen; `sounds.json` names the cue only | `minimap.ts` `FLARE_MS` | — |
| Double-click window | 350 ms | chosen | `main.ts` | — |
| HUD text | Georgia Bold at 0.70 × PointSize, Palatino's lining digits | measured against the SDF atlas (`combined.txt`); the atlas itself is the face | `hud.ts`, CSS | #92 |
| Font index → face mapping | inferred | inferred | `import_ui.py` | — |
| Names drop a trailing parenthetical qualifier | rule | chosen; the file's own buildable gate argues for it | `names.ts` | — |
| Stop / Back / Cancel / pack / unpack / build-page cells | the cells the layout leaves | chosen | `main.ts` | — |
| Training queue runtime placement | 70px portraits at Progress's x, 4px below its bottom; active portrait at the same x and StatusLabel's y; adjacent equal kinds grouped with counts | **measured** from the human's 2000×1125 barracks-queue screenshot (2026-09-20): active ≈(482,978), queue ≈(482,1029), 36px portraits at 36–37px pitch, groups 3/3/1; `commandpanel.json` gives the status/bar boxes but QueueButtons has no runtime geometry | `hud.ts` `setTrainingQueue`, `style.css` | #140 |
| Grouped queue interaction and active tint | groups count waiting units only; clicking a group cancels its first waiting entry; separate active portrait cancels index 0; green fill at 30% opacity tracks progress | **human-confirmed**: active militia is additional to the first three waiting militia. **Chosen**: cancellation within a waiting group and tint alpha; wrapping tested through 14 alternating waiting entries plus the active unit (15 total) | `hud.ts`, `style.css` | #140 |
| The AI's computer name | dealt by seed from `civilizations.json`'s table | chosen dealing, owned table | `ai.ts` | — |
| Under-attack alert rearm | 10 s | chosen; `sounds.json` names the cue, not its rearm | `cues.ts` `ALERT_INTERVAL` | — |
| Fallow-farm alert grace | 0.5 game seconds | chosen | `cues.ts` `RESEED_GRACE` | — |
| RMS aesthetic scatter | view-only sprites | chosen (the script deals objects); existing biome aesthetic passes remain separate from DAT terrain plants | `scatter.ts` | — |
| Scenery soft shadows | matching owned idle-shadow variant, own hotspot and atlas scale; existing ground-shadow pass500, owned Default profile strength/colour | **owned** SLD masks and profile values; reuses the entity-shadow renderer policy. Previously omitted by scatter. Plants/ground both use sRGB; measured flat Islands3 ground factor0.98 versus plant1.0 is a separate terrain-shading approximation. No guessed tint, blur or extra alpha attenuation added; full native composite/grade remains #149 | `scatter.ts`, `terrain_scatter_smoke.mts` | #250 |
| DAT terrain plants | import all used terrain-unit rows, draw only non-blocking Gaia scenery | Unit IDs, densities, masked densities, centering, graphics and variant counts are **owned**. Seven class14 plant types have zero collision/obstruction; resource-tree rows have no decoration key. Independent density/1000 probability (capped at1), tile/unit-seeded RNG, uniform uncentered jitter, position-hashed variants and hiding under known building/farm footprints are **inferred/chosen**. Masked density is retained but not yet applied; exact native row weights, mask semantics and density remain #249. Fog uses existing sprite policy and last-seen building memory; no sim entities/RNG/state are added or changed | `import_content.py`, `scatter.ts`; source contract and browser pixels/reload checks | #55/#249 |
| Nearctic snow dusting | not dealt | tried, reverted | — | #118 |
| Deer startle | hop 1.5 tiles, rest 14-20 s | inferred (AoE wiki); the 1-tile trigger is the DAT's `search_radius` | `data.ts` | — |
| Base monk source integrity | clean pinned x1 files restored and verified in the default depot | Original files were zero-filled after1MiB, not an alternate outline format. Fresh owner download and copy-back pass569/569 source walks; full isolated x1 import and idle/attack browser contours pass without decoder changes. Structural pre-cache validation prevents silent incomplete art; original/recovered hashes are in `docs/source-integrity.md` | `sld_integrity.py`, atlas-step preflight | #119/#247 |
| Which file the Enhanced Graphics Pack draws, and at what size | the DAT's `<stem>_x1.sld` becomes the pack's `<stem>_x2.sld`, drawn at half size | inferred: the DAT names `_x1` only; the pack ships a `_x2` for each and its drawn pixels sit within one x1 pixel of the x1 art's once halved about the hotspot (`test_the_pack_sources_every_sprite_at_twice_the_density`); `widgetui/build_atlas.ps1` states the UI's UHD level is twice HD, nothing states the sprites' | `depot.py` `Graphics.source`, `sprites.ts` `applyFrame` | #151 |
| Shared-match presentation pacing | 100 ms wall-clock input buffer; yield after a 4 ms work batch (or 32 messages); linear position interpolation between adjacent simulated ticks | chosen engineering policy for household play, not read DE networking behaviour; fixed-timestep and lockstep sources in `docs/shared-play.md` | `src/shared/playback.ts`, `src/shared/client.ts`, `main.ts` | #153 |
| Shared snapshot compression | negotiate permessage-deflate for snapshots ≥1 KiB, no context takeover; ordinary server ticks/settings/errors stay plain | **chosen** transport policy using the existing `ws` implementation and its default compression level, not DE networking behaviour; extension opt-out preserves the same raw JSON protocol | `src/shared/snapshot-compression.ts`, `server.ts` | #174 |
| Map selection UI | compact native map/seed controls in the existing menu, rather than the full reference catalogue; positive uint32 seeds, blank for a clock-generated seed | chosen project layout/policy after inspecting `screenmapselection.json` and `editorbottommappanel.json`; labels and standard map names imported from strings 9472, 9682, 9691, 10107, 10658, 10875, 10878, 10885; surveyed/proof names are project names | `hud.ts`, `match-setup.ts`, `import_content.py` | #144 |

## Adding a row

A row is added in the same commit as the value. "Where" is a file and a
symbol; "Source" is one of the classes above; an inferred rule says so even
when the result looks right. When a row is later read from a file, delete it
— `git log` keeps the record.

## Vikings source-backed runtime boundaries (#189, #301)

- **Regeneration:** Berserk 692/Elite 694 `creatable.rear_attack_modifier=40`,
  the legacy field corresponding to UGC/XS attribute 109 `cRegenerationRate`;
  hero_mode is 0. Owned help 26574/26576 explicitly says they regenerate HP.
  Import 40 HP/minute, rather than guessing a hero-mode constant. Continuous
  per-tick healing, max-HP clamping, healing while garrisoned in addition to
  building healing, and conversion-snapshot retention are **inferred scheduling
  semantics**, tested but not native-calibrated. Dead units never regenerate.
- **Chieftains:** tech 463/effect 517 adds 5 cavalry/+4 camel attack, increments
  resource 274 and invokes `Effects.xs` function 5. The reviewed adapter preserves
  its 20-gold Loot tasks on TradeBoat 2/Monk 18/RelicMonk 43/WarriorPriest 1831 and
  5 on Villager 4. It deduplicates the repeated RelicMonk task. Contrary to
  help 28312/120160, the script does not add a TradeCart 23 task, nor 5 gold for
  monks. Killer credit at a direct lethal attack, once per victim, no deletion
  reward, and productivity from the killer owner's live resource 274 are
  **inferred task semantics**. Converted infantry retain the task snapshot but
  read their current owner's resource. General splash/delayed-dead-shooter loot
  is not implemented (the supported Vikings infantry are melee, without blast).
  No blanket resource 33 support or invented tooltip-based reward is enabled.
- **Warships:** retain DAT 395=.9 then 501/502=.94117, not a hand-written exact
  10/15/20-percent discount from localization. Existing shared rounding occurs
  at payment/refund; native rounding is unmeasured. Team 411 is Dock cost×.85,
  not five resource attributes: 45/133/47/51/1189 are unit IDs, 100 the attribute.
- **Longboats:** 250/533 have dead_unit_id −1 and four total projectiles. Use
  existing ship composite art/death and simultaneous multi-projectile attacks;
  spread and per-projectile native damage/cadence remain shared inferred naval
  semantics (#260/#272). Bogsveigar 49 adds 1 attack to each line's shooter.
- **Free economy:** tree 276 sets 213/249 price and time to zero. Existing
  required-count activation, not empty automatic 392/400 effects, supplies the
  grant. Free research venue/order policy remains #254. Infantry 416 multiplies
  HP×1.2 from Feudal; 391/415 are inert, despite their old names.
  Wheelbarrow capacity×1.2695 then Hand Cart×1.5 yields fractional thresholds
  12.695/19.0425 from 10; the unchanged integer gather loop therefore banks
  13/20 on a full forager trip. Native capacity rounding remains uncalibrated
  under #301; this is not silently rounded down to the remembered 12/19.

## Celts unique unit and bonuses (#191)

- **Owned:** DAT civ 13, tree effect 275, team effect 401, `CELTS.json`, HUD
  family `CivWest`, English civilization help 120162. Woad Raider 232 / Elite
  534 have 70/85 HP, both base speed 1.17 and cost 70 food / 25 gold, trained
  at castle 82 in 10 seconds. Elite tech 370 costs 1000 food / 800 gold. Despite
  the upgrade help saying "faster", the pinned unit speeds are equal; no speed
  increase is invented beyond the age-gated infantry bonuses.
- **Owned passives:** tech 385 / effect 384 multiplies lumberjack units 123/218
  work by 1.15 from the start (not Castle Age). Tech 386 / effect 385 multiplies
  siege classes 13/55/54 and named additional unit IDs' reload by .8, also with
  no age prerequisite. These are siege weapons, not the workshop building's
  fire rate. Team effect 401 multiplies workshop 49/150 work by 1.2.
  Infantry techs 393/898/899/900 require Dark/Feudal/Castle/Imperial respectively
  and multiply class 6 / unit 1831 speed by 1.05/1.04762/1.04545/1.04348.
  Those source operands compound to approximately +5/10/15/20%; tests use the
  imported operands, not exact help-text percentages.
- **Owned unique research:** Stronghold tech 482 / effect 537 costs 250 food /
  200 gold, 30 seconds, Castle Age; reload ×.75 targets castle 82 and tower
  IDs 79/234/236/235 (including the unavailable Bombard Tower definition).
  Resource 33 = 8 invokes `Effects.xs` EffectFunction8: castle 82 gets aura
  task 155, work 30/1, range 7, owner 4, combat-level flag 4, search-wait 109,
  gather-type 21, help 13405, targets infantry class 6 and unit 1831. The
  adapter reads and guards this script's full statement order and count before
  extracting values; reordered assignments and inserted resets/reassignments
  are rejected by fixture tests. The shared `auras.ts` now admits living,
  completed building sources and matches target classes or unit IDs without
  civilization-name branches. The retained regression reaches 3 HP from 1 in
  four seconds; radius 7 is included and 7.01 excluded. Foundations, zero-HP
  and destroyed castles do not emanate healing; opponent infantry is excluded.
  Unit 1831 is not in the playable roster: its independent ID-mask consumer
  test uses a synthetic captured-rule identity (owned DAT class 43), not an
  invented trainable/visible Warrior Priest.
  A saved-scenario donor building-rule snapshot retains the aura after ownership
  changes, heals the new owner's infantry rather than the former owner's, and
  survives JSON continuation. This snapshot-consumer regression does not make
  normally conversion-immune castles convertible by monks.
  Furor Celtica tech 5 / effect 239 costs 750 food / 450 gold, 50 seconds,
  Imperial Age; HP ×1.4 includes both trebuchet forms and siege classes
  13/55/51/54 plus named additional IDs. Unimported foreign targets stay
  explicitly unmodelled, not fabricated units.
- **Deferred livestock protection (#304):** tech 405 / effect 417 **sets**
  resource 97 (`dominantSheepControl`) to 1. Help 120162 says livestock in Celt
  unit LOS cannot be stolen; it does not grant long-range ownership conversion.
  The ordinary shared herd-range/contested-claim loop cannot represent that
  precedence. Owner/Gaia/enemy livestock, competing protected owners, LOS
  sources, garrisons and leaving sight need a bounded shared consumer and native
  calibration. This command remains explicitly unmodelled.
- **Inherited inference:** per-tick movement, reload rounding, production work
  integration, damage-preserving HP increases and donor-stat capture remain
  shared engine policies, not native calibration receipts. Stronghold reuses
  the healing family's HP-per-minute / 60 interpretation, inclusive centre
  distance and strongest-overlap policy. Only deployed entities source or
  receive auras: garrisoned infantry gets ordinary castle healing (.2 HP/s,
  accumulated as whole HP), with no extra aura; ungarrison restores .5 HP/s.
  Tests measure 1 to 2 HP in six seconds inside, then 1 to 3 in four seconds
  outside, including JSON continuation. These scheduling/geometry/stacking/cargo
  choices are **inferred**. Its task flag differs from Bimaristan (4 versus 2),
  so native flag semantics, geometry, stacking, garrison and allied behavior need
  calibration under #306, not a claim that the script encodes our scheduler. Current locked
  two-player opponents supply the owner filter; allied teams are not offered.
- **Evidence boundary:** strict all-consumed-cue audit resolves every Celts cue
  against both pinned audio packs, with zero reviewed gaps. Source animation
  files and roster identities are tested; sprite publication, real UI/browser
  acceptance and the owned checkpoint remain coordinator work. A private
  extracted profile is not a published/playable-asset verification.

## Mongols source reconciliation and remaining boundaries (#190, #305)

- **Owned:** DAT civ 12/tree 277/team 407, `MONGOLS.json`, English 120161.
  Mangudai 11/561 use projectile 477 at 95% accuracy, not Janissary projectile
  380/75%. Source corpse 135 supplies decay art; no synthetic composite or decay
  suppression is needed. Steppe Lancer 1370/1372 is a regional stable line.
- **Owned bonuses:** tech 389/effect 388 multiplies hunter 122/216 work rate
  by 1.4. Tech 394/effect 393 multiplies cavalry-archer class 36 reload by .8.
  Team effect 407 adds 2 to XS attributes 1 (line of sight) and 23 (search
  radius) for 448/546/441/1707, not armour and not Steppe Lancers. Owner-local
  team effects follow the existing two-opponent model, not an implemented alliance.
- **HP branch consumer:** Castle techs 286/288 and Imperial 287/388 each disable
  the alternative with type 102. `disabledByTechs` derives reciprocal automatic
  exclusions only (other runtime disables remain unmodelled under #128), preserving this relationship
  from the DAT and checks completed research history, including after JSON reload.
  Bloodlines 435 is the extra prerequisite of 286/287. Their ×100, −2000,
  multiplier, +2000, ×.01 sequence excludes Bloodlines' additive 20 HP from the
  multiplier; these are HP operations, not costs. There is no Feudal HP bonus.
- **Inferred / uncalibrated:** existing deterministic float rounding and
  fixed-point automatic-research ordering remain engine adapters. Imperial
  no-Bloodlines tech 388 uses raw 1.083999991 → imported 1.084, whereas 287 uses
  1.083330035 → 1.08333. Tests retain 78.048 Light Cavalry and 104.064 Elite
  Steppe Lancer HP without Bloodlines, rather than silently forcing the nominal
  30% help-text value. With Bloodlines before Imperial, Light Cavalry reaches
  97.99976; afterward, 98.048. Native rounding/order calibration is #305
  (native launch remains #279); no reference parity is claimed by these tests.
- **Drill, owned:** tech 6/effect 457; Imperial Castle research (building 82),
  500 wood/450 gold, 60 seconds; speed ×1.5. Targets include rams, mangonels,
  scorpions and Siege Tower, not trebuchets. Imported definitions of foreign
  siege targets do not grant Mongols permission to train them.
- **Nomads deferred, #305:** tech 487/effect 542 upgrades houses 70/463/464 to
  Castle house 191; automatic 641/effect 681 upgrades house variants to Imperial
  house 192. Both use resource storage type 4, amount 5, flag 8; normal houses
  use flag 4. English 28280 says lost houses do not decrease population space.
  The current living-building housing sum has no persistent storage consumer,
  and replacement-house rules are absent. Nomads stays explicitly skipped and
  unresearchable. Implementing it requires completion/destruction/capture and
  save-state semantics, not relabelling these houses as cavalry archers.
- **Audio:** all consumed Mongols cue graphs resolve against both pinned base
  packs. No new #271 exception, substitution or relaxed missing-event guard.

## Relic storage garrison flags (#291)

- **Read:** pinned Briton monastery104 has capacity10 and
  `creatable.garrison_graphic=4786` (`CRCH3GW`), whose file-bearing layer11385
  is `GarrisonFlag WEST`, `b_west_garrison_flag_x1`, offset(-74,-221),90 frames
  at ~0.033333s. The existing import selects its owned x2 counterpart at scale2.
- **Owner-reported / inferred trigger:** stored building relics raise that same
  occupancy flag; carried monk relics do not. No distinct relic-only art or
  newly invented placement/timing is introduced. Exact native trigger semantics
  have not been calibrated in the live reference game. Open content retains the
  existing geometric player-colour flag.
- **Published coverage (2026-10-06 root manifest):** building entries with
  `garrisonFlags` are archery-range, barracks, bombard-tower, castle, dock,
  guard-tower, keep, market, monastery, siege-workshop, stable, town-center and
  watch-tower. Other flagged keys are battering-ram, capped-ram, dat-unit-548,
  siege-tower and transport-ship. Imported entries without `garrisonFlags`
  still draw zero flags; this change does not invent missing art or claim every
  profile/building is covered.
- **Visibility / protocol:** the existing `hasGarrison` public occupancy flag
  now includes stored relics, while private counts/contents remain owner-only.
  Fog uses the last-seen bit, never hidden live contents. No additional protocol-version bump is needed:
  no wire field/type changed and the documented occupancy-indicator contract is
  unchanged; this corrects the relic case of that contract.
