# DAT field consumption audit (#54)

Refreshed 2026-09-28 against the pinned owned DAT, current importer, published
content and runtime. This replaces the old blanket description of these fields
as unread. A field mentioned by a script is not necessarily imported; a field
present in a manifest is not necessarily used correctly at runtime.
Scope is the original ticket's named fields and its later manual-audit
follow-ups, not an exhaustive survey of every attribute in every civilisation.

DAT SHA-256: `ce3530df36cf0b333a9751cb0ff94460fe904f811feecec8ae9794701622b4cf`.
The root was resolved with `tools/depot.py`. Values below are sampled from
Britons (`civs[1]`), except sheep/deer/boar from Gaia (`civs[0]`). Other
civilisations can differ. Diagnostic output remains ignored at
`.local/dat54-audit.json`; no new game-data export is committed.

## Now imported and consumed

| Original concern | Current import and consumer | Boundary |
| --- | --- | --- |
| Garrison capacity/type/healing | `import_content.py` publishes capacity, type mask and healing; `game.ts` checks boarding, heals occupants and supports producer self-rally. | Admission/egress policies and native calibration remain explicit in the ledger. Garrison is no longer an absent feature. |
| Garrison graphics | `creatable.garrison_graphic` is resolved through file-bearing deltas into age-specific flags; `sprites.ts` renders them. | Parent IDs and leaf graphics differ: TC109 parent4566 is not the same thing as a file-bearing flag ID. |
| Firepower and TC arrows | `type_50.garrison_firepower`, primary/secondary projectiles and projectile limits feed actual volleys and attribute130 effects. TC109 has primary−1, secondary54, maximum11. | The empty TC's absent primary is modelled, not a missing projectile-art bug. Exact volley arithmetic is still an identified interpretation. |
| Loaded transports | Capacity is imported; `garrisonCount` includes nested passengers in admission, observation and HUD (#251). | Old over-capacity cargo is preserved; native carrier-conversion exceptions remain #178. |
| Corpse/age rubble | `dead_unit_id`, corpse lifetime storage and age replacements supply death/decay art and clocks. | This does **not** consume the separate `destruction_rubble_graphic_id` below. |
| Language and audio | Name/create/help/hotkey IDs, `bird` move/attack events, building construction events and graphic frame sounds are imported and used. | Wwise mixing/spatial calibration is #243; the original selection/train-only claim is obsolete. |
| Terrain plants | Used terrain rows retain unit/density/masked-density/centering; eligible owned plant art and shadows render (#55/#250). | `maskedDensity` is preserved metadata, not an applied placement rule; #249 tracks calibration. |
| Terrain restrictions | Unit restriction indices and nonzero entries in `passable_buildable_dmg_multiplier` become published allowed-terrain rows; navigation/building placement use them. Row7 is no longer unread. | The importer restricts rows to represented terrain IDs and treats nonzero as passable; it does not implement a generic terrain damage-multiplier system. |

## Remaining unconsumed fields and unresolved semantics

| Field | Pinned examples / corroborating XS name | Current gap and required care |
| --- | --- | --- |
| `dead_fish.min_collision_size_multiplier` | Villager83=.25; infantry74/93≈.8; Knight38/Scout448=.5; ram35/422/548≈.1; Archer4=1. | Not imported. `nav.ts::separateUnits` skips travelling/engaged pairs and separates stationary units by their full radii. Values alone do not establish when/how native collision shrinks; the old issue's causal explanation was stronger than its evidence. |
| `building.foundation_terrain_id` | XS `cFoundationTerrain=34`; completed TC109/House70=27; Farm50=7; Dock45 and TC construction head621=−1. | Not imported as a general foundation rule. `updateFarmView` handles named farm terrain slots, not arbitrary building foundations. The old “every building except farms” claim is false. A terrain ID alone does not prove persistent authoritative terrain mutation after rubble disappears. |
| `building.destruction_rubble_graphic_id` | XS `cDestructionRubbleGraphic=88`; TC109=556 (`b_foundation_town_center_rubble_x1`), House70=499 (`b_foundation_house_rubble_x1`). | Not imported/rendered separately. These are foundation-rubble graphics, distinct from the already supported dead-unit decay chain. Determine composition, timing and persistence before adding a second layer or replacing existing rubble. |
| `creatable.idle_attack_graphic` | XS `cIdleAttackGraphic=82`; Militia74=1102, Villager83=1282, Spearman93=1061; ram35=686. | Not imported as an armed-idle slot. Exact selection/transition lifetime is not established by the ID; existing standing/walk/attack animation support is not a consumer of this field. |
| `type_50.break_off_combat` | Archer4=16, TC109=2, ram35=18, Mangonel280=26. | Not consumed; bit meanings are unverified. Existing acquisition/pursuit rules are hand-authored. Related siege automation is #131. |
| `old_attack_reaction` | Villager83, Monk125 and Gaia sheep/deer=2; boar=4; Knight38=3; packed Trebuchet331=1. | Not consumed. The parser's legacy field name and differing values do not establish a current DE reaction state machine. |
| `creatable.min_conversion_time_mod`, `.max_conversion_time_mod`, `.conversion_chance_mod` | XS111/112/113 respectively. Scout448=3/1/2; TC109 chance modifier3 with time modifiers0/0. | Not imported. `monastery.ts::conversionWindow` uses caster base timing plus target-player178/179 adjustments, not these target-unit values. Chance and time are different fields; do not add chance2 as two seconds. Current uniform timing and modern modifier semantics remain #128/#178. |
| `type_50.friendly_fire_damage` | XS `cFriendlyFireDamage=119`; sampled units read1. | Not imported as a general multiplier. Existing direct-hit/splash/self-destruct owner filtering is explicit code. A value1 does not alone specify which allies can be hit or when automatic fire must be suppressed (#131/#242). |
| `terrain_block.tile_sizes` |19 entries; ordinary tile96×48, slope variants include heights24/72 and `delta_y`±12; final half-width entries48×48. | Not imported as the full native slope-shape table. Existing96×48 projection and sampled corner elevation do not establish all19 shapes/topology (#134). |

## Garrison and command follow-up remains explicit

The original garrison paragraph is largely delivered (#75/#137/#161's
implementation/#245/#251). Do not reopen those completed consumers merely
because their source fields appeared in an old inventory.

The later manual audit added actual remaining work: heavy-damage ejection,
selective unloading, stance/patrol/guard/follow state and full formations. These
are recorded in #54 and [manual-audit.md](manual-audit.md), not silently declared
implemented by an importer field. Ram numeric/eligibility calibration remains
#161, conversion/cargo exceptions #178, siege automatic-fire safeguards #131,
and general technology/modifier coverage #128.

## Verification and disposition

- Read source values in one batch, including construction-head/dock exceptions
  and the scout's separate time/chance modifiers; checked named XS aliases.
- Traced importer → metadata → runtime paths rather than treating a text-search
  hit as consumption. Compared the relevant movement, farm-ground, conversion
  and garrison implementations.
- Five owned integration tests passed: garrison publication, terrain restriction
  rows, terrain scatter rows, live-animal decay and world audio publication.
- No simulation, importer, asset or timing changes in this audit. Earlier
  lifecycle/garrison gameplay tests remain recorded in their feature receipts.

The original documentation action is complete: the cheat-sheet now includes the
remaining fields and the garrison omission claim has been corrected. **#54 stays
open as a narrowed remaining-consumer/semantics inventory**, so collision,
foundation and combat gaps are not lost merely to reduce the issue count.
