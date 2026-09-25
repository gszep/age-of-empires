# Civilisation bonus integration contract

Shared extraction/runtime for #123/#129 and Briton/Frank checks in #179/#180.
Every complete root/additional profile carries its own `civilizationBonuses`.

## Profile schema

```ts
civilizationBonuses: {
  treeEffectId: number;
  teamEffectId: number;
  nodes: Record<string, {
    key: string;
    requiredTechs: number[];
    requiredTechCount: number;
    automatic: boolean;
    disabled?: boolean;
    age?: number;
    triggeredByBuildings?: string[];
    researchedAt?: string;
    effects: TechEffect[];
    upgrades?: { from: string; to: string }[];
    unmodelled?: string[];
  }>;
}
```

- Node keys are DAT technology IDs; `-1`/`-2` represent initial tree/team
  **effects**, whose actual IDs remain in the outer object.
- `key` names public research or `automatic-<id>` for hidden nodes. Public
  entries own their effects; their graph nodes have empty effect lists.
  `technologyFor` resolves both kinds.
- Public `requiredTechs`/`requiredTechCount` supersede legacy prerequisites.
  Unknown, disabled and foreign nodes do not satisfy counts; positive counts
  with no matching prerequisite remain blocked.
- `triggeredByBuildings` comes from `building.tech_id`. Automatic `researchedAt`
  means free research still needs its completed research building.
- `Player.researched` is the ordered completion journal, including hidden nodes;
  saves preserve once-only activation without a second mutable rules table.
  Hidden nodes emit no research-button completion message/audio.
- Building `workRate` advances production/research each tick. Cost effects support
  all-resource multiplication and individual resource set/add/multiply.
- `civilization_bonuses` updates profile technology costs/times and building work
  rates inside `extract`, after `technologies_from_tree`. Additional profiles use
  the same call/parsed DAT. Publication tests cover both levels.
- Current 1v1 gives each owner its own team effect; allied-team dispatch is future
  work, not permission to apply the opponent's effect.

## Source evidence

Resolved using `tools/depot.py`; core depot 813781, pinned manifest
`3067258457468070797`. Read `empires2_x2_p1.dat`, `CivTechTrees/{BRITONS,FRANKS}.json`
and `xs/Constants.xs` (cost attributes 100, 103–106, work 13).

| Source | Implemented effect/gate |
|---|---|
| Britons tree 254 / team 399 | technology disables; archery-range work ×1.1 |
| Tech 383 / effect 381 | shepherd units 592/590 work ×1.25, required count 0 |
| Tech 381 / effect 379 | TC wood ×0.5 after Castle Age 102, including source variants |
| Techs 382/403 / effects 380/415 | foot-archer class 0 range/sight +1 in Castle/Imperial, explicit skirmisher reversals |
| Tech 3 (Yeomen) | paid 750 wood/450 gold, 60 seconds |
| Franks tree 258 | farm techs 14/13/12 cost/time set to zero, gates retained |
| Franks team 403 | knight-line sight +2 |
| Tech 524 / effect 523 | foragers 120/354 work ×1.15 |
| Tech 290 / effect 285 | cavalry classes 12/23/47/36 HP ×1.2 after Feudal Age 101 |
| Techs 325/330 / effects 324/329 | castle cost ×0.85 in Castle, then ×0.882353 in Imperial |
| Farm tech 13 | `[102,14,761]`, count 2; alternative 761 belongs to civ 36 |
| Building 68 / 82 | `building.tech_id` 110 / 266 supplies mill/castle shadow completion |

Unsupported commands/targets remain in `unmodelled`, including search radius 23
and enable-unit effects. Rounding, activation order and free-research building
semantics are **inferred** in `ledger.md`; not DE runtime measurements or claims
that #128/#126/#130 are complete.

## Verification

`tools/test_civilization_bonuses.py` checks source extraction and deterministic
re-extraction, optionally writing `CIV_BONUS_EXTRACT` outside publication.
`src/sim/civilization-bonuses.test.ts` defaults to published owned graphs when
present, otherwise small source-command fixtures. Unit baselines and shortened
age/train/construction clocks are diagnostic fixtures. Outcomes cover public
gates, collection/banking, active/new/garrisoned cavalry HP, upgrades, captured
exclusions, JSON continuation, range combat, paid Yeomen, fog sight, production,
refunds, TC/castle payments and free farm research/new food. Before-Castle TC
payment deletes the old TC to respect #177.
Training/research observation countdowns divide remaining work by the active
building rate; tests compare those reported game-time seconds with completion.

`tools/civilization_profiles_smoke.mts` uses full published art/rules with
unmodified gameplay clocks, real menu choices and build/research/train input.
Conversion snapshots remain entity-level authority. Full civilisation completion
remains tracked on #179/#180 independently of this supported-profile milestone.
