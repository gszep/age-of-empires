# Building progression integration contract

Integrated from `/tmp/opencode/aoe-civ-buildings` (base `0458053`) over profile/
bonus checkpoint `4ba51db`. Scope: #126 and building coverage for #179/#180.

## Behaviour and schema

- Semantic keys: `stone-wall`, `fortified-wall`, `stone-gate`, `fortified-gate`,
  `guard-tower`, `keep`. `*-gate-y` is art, not a public building kind.
- Public build validation and military menu expose the current paid tier.
  Fortified Wall upgrades walls and gates, including foundations; tower promotion
  preserves entity IDs, damage, orders, queues and passengers.
- `ageStats`: `{id, hp, lineOfSight, armors, includedTechs?}` by age, using the
  same DAT replacements as artwork even where the image is reused.
- `availabilityId` is a typed tree node, distinct from the part's stat `datId`.
  The catalogue accounts for construction aliases. Gate metadata supplies a
  two-tile centre opening within a four-tile footprint; posts remain solid.
- `garrison.volley.arrowUnitId` connects secondary arrow effects to projectile
  tables through `dat-projectile-N`, not new trainable units.

## Owned evidence

Resolved with `tools/depot.py`; core 813781, manifest `3067258457468070797`.
Read DAT, Briton/Frank trees, English localization and owned graphics.

| Source | Meaning |
|---|---|
| 117/155 | Stone/Fortified Wall: HP 1080/3000, melee armour 8/12, pierce 10/12; 5 stone, 10 s, slot 8 |
| 64/88, 63/85 | Stone/fortified doorways x/y: HP 1650/4000, melee armour 6, pierce 6/7 |
| 487/490, 488/491 | Construction heads and full previews: 30 stone, 70 s, x-head slot 11 |
| 78/91, 67/90 | Open transforms; 81/95 and 80/92 are posts at ±1.5 tiles |
| 79/234/235 | Watch/Guard/Keep, class 52; 35 wood + 125 stone, 80 s, slot 9; Guard/Keep HP 1500/2250, pierce attack 7/8 |
| Tech 140 | Guard Tower: 100 food + 250 wood, 30 s; 79 → 234 and projectile 505/518 effects |
| Tech 63 | Keep: 500 food + 350 wood, 75 s; 79/234 → 235; Guard + Imperial gates; Franks unavailable |
| Tech 194 | Fortified Wall: 200 food + 100 wood, 50 s; 117 → 155 and all gate parts/heads |
| 101/102/103 | House 70 → 463/464/465, barracks 12 → 498/132/20, mill 68 → 129/130/131, TC 109 → 71/141/142 and other age replacements |
| 71/72 | Generic sole-age HP changes for stone walls/gates and palisades |
| 610/611 | Arrowslits children: `[608,140,775]` / `[608,63,775]`, count 2; each adds another pierce point to towers and secondary arrows. 775 belongs to civ 37 |

`tools/probes/building_wall_art.py` composes all five stone/fortified frames at
owned hotspots divided by x2 scale: 0/1 x/y, 2 post/junction, 3/4 horizontal/
vertical screen diagonals. Contact sheets stay outside publication.

## Integration invariants

Every profile expands the reviewed building spec. Only generic sole-age stat-only
automatic effects normalize into baselines; `includedTechs` prevents journal
reapplication. Source float precision is retained. Paid/counted/civ/mixed effects
stay in the regular graph. Relevant generic automatic descendants are now also
discovered with full prerequisite slots, so 610/611 await the paid upgrades and
the foreign alternative cannot satisfy the gate. This is not unconditional
activation of unrelated scenario technologies.

After research, building HP synchronizes once from effective rules; buildings
skip the later scalar HP loop and promoted unit IDs keep their exclusion.
Absolute damage retention, proportional foundation gains, shared gate HP,
owner passage and proximity-open display are **inferred**, not closed-runtime
parity. Diagonal gates/native open-close timing remain #133. Views retain owner-
profile lookup and separate stone versus palisade frame conventions.

## Verification

`tools/test_building_roster.py` checks both sources, all imported age variants,
paid tiers, gate composites and Arrowslits thresholds. `src/sim/buildings.test.ts`
measures public commands, actual damage, foundations/occupied promotions, posts/
doorway navigation, secondary volleys, conditional 610/611 damage and JSON
continuation. Fixtures provide age prerequisites and shorten construction/research
clocks explicitly; no test timeout is widened.

`tools/buildings_smoke.mts` uses private port 5266, real wall drags, gate/tower
placement and paid research with normal gameplay clocks accelerated only via
public speed keys. It checks both owned profiles and actual atlas bindings;
`OPEN_FALLBACK=1` checks open mode. Regeneration is always `npm run import:aoe2`.
Checkpoint logs/counts are recorded in status/handoff.
