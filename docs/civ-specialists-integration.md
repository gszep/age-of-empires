# Specialist integration contract

Integrated from `/tmp/opencode/aoe-civ-specialists` (base `0458053`) over `4ba51db`.
Scope: petard portion of #131, ram crew #161 and siege-tower coverage #179/#180.
Relic/monk and the reviewed combat/economy work are now integrated in MAIN.

## Behaviour and metadata

- Petard 440 trains at castle 82, self-destructs once on attack contact and blasts
  nearby enemies. Interception/deletion applies no attack damage; death still has
  owned visual feedback.
- Siege Tower 1105 trains at workshop 49, holds ten foot passengers and has no
  attack. Right-clicking a completed enemy class-27 wall issues `cross-wall`:
  approach the nearest cardinal face, remain outside, unload onto free ground
  immediately beyond the footprint. Blocked passengers remain aboard.
- Living class-6 passengers add ram/tower speed and ram anti-building attack.
  Villagers ride without bonuses; unloading reverses them. Crew is derived live,
  never baked into `convertedRules`; projectile lead prediction reads it too.
- Petard's owned flipbook uses the saved corpse clock, including renderer frame/
  animation diagnostics, rather than the death parent's misleading idle source.

Optional entity metadata: `infantryCrew`, `passengerTypes`, `unloadOverWall`,
`detonateOnAttackOnly`, `deathEffect`. Existing self-destruct/capacity fields remain.
Every complete profile uses the same extractor; death effects join existing root
particles, and full entity publication needs no decoder/packer change.

Ram `treeUnitId: 1258` controls availability while 35 retains effects/stats.
Main already accounts for the alias in the catalogue. New semantic keys stay
outside ordinary `dat-unit-N`. Public commands remain `order`/`ungarrison`;
observation adds `cross-wall` and both unit kinds to its enums.

## Save/replay and passenger audit

Saves/shared snapshots and replay checksums retain whole dynamic entities and
nested garrisons, with no serializer field allow-list to extend. Boarding and
egress move the whole passenger object, preserving wounds, loads, queues and
conversion provenance. Tests cross JSON shared snapshots with wounded carrying
converted passengers, then compare deterministic continuation. Undefined optional
properties disappear normally in JSON; all defined payload fields are checked.

## Evidence and limits

`tools/probe_specialists.py` reads pinned Briton/Frank records 440/1105/1258/35/
422/548, tasks, creatable/combat data, trees, graphics, localization and XS.

- Petard: HP 50, speed .8, 65 food/20 gold, 25 s; attacks 26:100, 11:500,
  4:25, 20:60, 22:900; blast .5, level 2. The issue's 82 is its producer.
- Tower: HP 175, speed .96, 100 wood/120 gold, 36 s, capacity 10, no attacks;
  task 14 targets class 27 (`cTaskTypeUnloadOverWall`); help 26445/3123 describes
  crossing enemy walls. Art slots 9292/9296/9293 and flag 9572 are owned.
- Death 5461 → delta 12217 → `impact_petard.json`: `impact_explosions.png`
  frames 90..174, 85 frames, 1.5 seconds, scale .6.
- **Inferred constants:** +.05 tiles/s per infantry for ram/tower, +10 class-11
  attack per infantry for ram, and foot-passenger mask 11. Inspected sources prove
  the mechanic, not those numbers. #161's patch-matched numeric calibration is
  distinct from implementation tests and remains open.
- **Inferred/chosen semantics:** attack-only petard damage, owner immunity/full
  blast damage, cardinal landing with .1 clearance and 0/±half-half-extent offsets.
  No diagonal/gate crossing or native unloading cadence claim; ordinary land-
  carrier egress/destruction keeps the earlier #137 approximation.

## Verification

`src/sim/specialists.test.ts` runs fallback and both owned profiles: production,
damage/bystanders/interception, crew distance/damage/unload, conversion snapshots,
capacity/destruction, three wall materials, double-wall refusal and JSON/shared
continuation. Python tests check identities/tasks/flags/particle chains; sprite
tests check saved-clock frame selection/expiry.

`tools/specialists_smoke.mts` uses private port 5268 and published original assets:
real production buttons, boarding/unload, measured ram travel/damage, loaded-cargo
reload, tower right-click crossing and petard damage/rendered particle pixels in
the reported colour space. Gameplay clocks are unmodified.
