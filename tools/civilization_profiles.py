"""Source identity and roster contracts, separate from runtime bonus semantics."""
import copy
import json


def tree_unit_id(dat, civ_index, entity):
    """A reviewed replacement's tree ID, or a reciprocal construction head."""
    if "treeUnitId" in entity:
        return entity["treeUnitId"]
    uid = entity["unitId"]
    unit = dat.civs[civ_index].units[uid]
    if entity.get("category") == "building" and unit and unit.building and unit.building.head_unit > 0:
        head = dat.civs[civ_index].units[unit.building.head_unit]
        if head and head.building and head.building.stack_unit_id == uid:
            return head.id
    return uid


def catalogue(dat, dat_path, spec, hashes, strings, attribute_ids):
    from import_content import civilization_entry, player_attributes, sha256
    path = dat_path.parent / "civilizations.json"
    definitions = json.loads(path.read_text())["civilization_list"]
    if len(definitions) != len(dat.civs):
        raise ValueError("civilisation metadata / DAT index mismatch")
    hashes["civilizations.json"] = sha256(path)
    result = {}
    for index, definition in enumerate(definitions):
        if not index or definition.get("era") != "base":
            continue
        key = definition["tech_tree_name"].lower()
        profile_spec = {**spec, "civIndex": index,
                        "civilization": {"key": key, "treeFile": definition["tech_tree_name"] + ".json"}}
        entry = civilization_entry(dat, dat_path, profile_spec, hashes, strings)
        entry.update(era="base", hudStyle=definition["hud_style"],
                     internalName=definition["internal_name"],
                     enabled=key == spec["civilization"]["key"] or key in spec.get("enabledCivilizations", []),
                     extracted=key == spec["civilization"]["key"] or key in spec.get("profileCivilizations", []),
                     emblemImage=definition.get("emblem_image_path"),
                     techTreeImage=definition.get("tech_tree_image_path"),
                     uniqueUnitImages=definition.get("unique_unit_image_paths", []))
        entry["playerAttributes"] = player_attributes(dat.civs[index].resources, attribute_ids)
        entry["treeEffectId"] = dat.civs[index].tech_tree_id
        entry["teamEffectId"] = dat.civs[index].team_bonus_id
        tree = json.loads((dat_path.parent / "CivTechTrees" / entry["treeFile"]).read_text())
        entry["roster"] = [dict(node) for node in tree["civ_techs_buildings"] + tree["civ_techs_units"]]
        imported_ids = {row["unitId"] for row in spec["entities"]}
        imported_ids.update(tree_unit_id(dat, index, row) for row in spec["entities"]
                            if row.get("civ") != "gaia")
        entry["missingRoster"] = sorted({int(node["Node ID"]) for node in entry["roster"]
                                        if node["Use Type"] in ("Unit", "Building")
                                        and node["Node Status"] != "NotAvailable"
                                        and int(node["Node ID"]) not in imported_ids})
        result[key] = entry
    requested = set(spec.get("profileCivilizations", [])) | set(spec.get("enabledCivilizations", []))
    if requested - result.keys():
        raise ValueError(f"unknown or non-base civilisation: {sorted(requested - result.keys())}")
    if any(row["enabled"] and not row["extracted"] for row in result.values()):
        raise ValueError("enabled civilisation has no extracted profile")
    return result


def profile_spec(spec, entry):
    result = copy.deepcopy(spec)
    result.pop("profileCivilizations", None)
    result.pop("enabledCivilizations", None)
    result["civIndex"] = entry["datIndex"]
    result["civilization"] = {"key": entry["key"], "treeFile": entry["treeFile"]}
    result["audio"] = {"switch": entry["internalName"]}
    for effect in result.get("effects", []):
        if effect["key"] == "rally-flag":
            effect["graphic"] = "WaypointFlag " + entry["internalName"]
    return result


def art_entities(content):
    """Stable namespace; shared-atlas grouping still deduplicates identical sources."""
    result = dict(content["entities"])
    for civ, profile in sorted(content.get("civilizations", {}).items()):
        result.update({f"civilizations/{civ}/{key}": entity for key, entity in profile["entities"].items()})
    return result


def shared_combat_specs(dat, spec):
    """Roster additions using existing single-projectile/melee mechanics.

    Stable DAT keys do not depend on English localization. New mechanic families
    must be reviewed before extending the spec (siege towers are not ordinary
    transports, and petards require explosion/self-destruction semantics).
    """
    known = {row["unitId"] for row in spec["entities"]}
    additions = []
    for row in spec.get("combatRoster", []):
        uid = row["unitId"]
        if uid in known:
            continue
        unit = dat.civs[spec["civIndex"]].units[uid]
        additions.append({"key": f"dat-unit-{uid}", "unitId": uid, "category": "unit",
                          "sounds": ["select", "train"], "animations": {
                              name: {"slot": slot} for name, slot in
                              (("idle", "standing"), ("walk", "walking"), ("attack", "attack"),
                               ("death", "dying"), ("decay", "dead"))}})
        if row.get("composite"):
            additions[-1]["composite"] = True
        if row.get("decay") is False:
            additions[-1]["animations"].pop("decay")
        known.add(uid)
        projectile = unit.type_50.projectile_unit_id
        if projectile >= 0 and projectile not in known:
            additions.append({"key": f"dat-projectile-{projectile}", "unitId": projectile,
                              "category": "projectile", "animations": {"idle": {"slot": "standing"}}})
            known.add(projectile)
    return additions
