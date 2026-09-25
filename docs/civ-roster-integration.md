# Civilisation roster integration contract

Integrated from `/tmp/opencode/aoe-civ-roster` over #177/#178, together with the
bonus worktree. No owned files are committed.

## Profiles and publication

- `profileCivilizations` requests complete supported-roster extraction;
  `enabledCivilizations` separately opts reviewed profiles into selection.
  Keys come from owned lowercased `tech_tree_name`. Invalid/non-base requests
  and enablement without extraction fail. `--profiles base` extracts base-era
  profiles but does not enable them.
- Root rules remain Britons. Each additional profile uses the same `extract`
  path and parsed DAT (`_dat`), including its own bonus graph/technology edits.
- `civilizationCatalog` inventories 53 base-era identities, not 53 playable civs:
  identity, era, HUD family, names/emblems, typed roster/missing IDs, initial
  player attributes, tree/team IDs and extraction/enablement status.
- `civilization.enabled: false` prevents creation/restore. Legacy synthetic
  profiles without that field retain their old behavior.
- Reviewed `combatRoster` additions use `dat-unit-<id>`: Hand Cannoneer 5,
  Bombard Cannon 36, Throwing Axeman 281/531, Paladin 569 and Carrack 2628.
  Protocol/classification/production support the namespace; absent IDs reject
  before spending. Typed tree absence denies foreign uniques even when a
  technology shares the numeric ID.
- Reciprocal construction heads supply building availability; a reviewed
  `treeUnitId` names a unit's source-backed tree alias. Ram 35 uses tree 1258
  (Dark-Age automatic replacement tech 712), while palisade 789 uses head 792.
  Explicit unit aliases supply tree age/prerequisites; construction heads do not
  overwrite the completed TC's replacement age. Missing-roster inventory counts
  these representations rather than reporting them as missing gameplay.
- Atlas jobs/audio aliases use `civilizations/<civ>/<entity>`. Published entities
  keep ordinary keys; identical sources share converted URLs. No decoder/packer
  fingerprint edit is needed.
- Owner identity selects sprites, skins, flags, projectiles, names/icons and
  voices. Conversion stats remain independent; art follows the recipient as an
  explicitly inferred presentation policy.
- `MatchSetup.civilizations` travels through preferences, solo/shared restart,
  restore and headless configuration. Both menu selects show loaded enabled
  profiles. HUD family/emblems and computer names use each owner.

## Acceptance and remaining scope

`tools/test_civilization_profiles.py` verifies owned inventory, availability,
distinct castle/rally art, voices and HUD bindings. The sim profile suite checks
public production/combat, foreign/unknown rejections without payment, observation
schema and restart identities. A locally enabled pending-profile fixture does not
publish enablement.

`tools/civilization_profiles_smoke.mts` privately verifies real menu selection,
reload/restart, unique training, absent foreign buttons, rendered atlas identity,
icons/names/castles, age payments and free farm lifecycle. `CIV_ACCEPT_PENDING=1`
changes only an unpublished in-memory enablement flag for pre-enablement checks.
Final acceptance runs without that override after full pipeline publication.

Britons/Franks are not complete. Missing roster IDs include building upgrades,
wall topology, petards and siege towers; supporting/age variants need interpretation
rather than blindly counting them as units. Separate worktrees own tower/wall and
petard/siege-tower/relic mechanics. Unsupported effects/resources remain in
provenance. Other base-era profiles need gameplay/art/HUD review before enablement.
Conversion #178 follows the documented inferred policy; remaining reference gaps
do not indefinitely block this limited supported-gameplay milestone.
